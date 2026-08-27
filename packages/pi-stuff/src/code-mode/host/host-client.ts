import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type JsonInputValue, parseJsonValue } from "../../shared/json-value.js";
import type {
	CodeModeExecuteOptions,
	CodeModeWaitOptions,
	ExecutorContext,
	RuntimeResponse,
	SuiteSandboxTool,
} from "../protocol.js";
import { CodeModeDelegateRuntime } from "./delegate-runtime.js";
import {
	DEFAULT_EXEC_YIELD_MS,
	type DelegateResponseMessage,
	executionCellId,
	type HostMessage,
	MAX_OUTPUT_TOKENS,
	parseHostMessage,
	parseRuntimeResponse,
	runtimeOutcome,
	toWireToolDefinition,
} from "./host-protocol.js";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_QUEUED_WRITE_BYTES = 128 * 1024 * 1024;
const SHUTDOWN_GRACE_MS = 250;
const STARTUP_TIMEOUT_MS = 10_000;

interface Pending {
	context?: ExecutorContext;
	reject(error: Error): void;
	resolve(value: JsonInputValue): void;
	tools?: Map<string, SuiteSandboxTool>;
}

interface HostOperationRequest {
	readonly cellId?: string;
	readonly method: "session/execute" | "session/open" | "session/shutdown" | "session/terminate" | "session/wait";
	readonly request?: object;
	readonly sessionId: string;
}

type HostOutboundMessage =
	| DelegateResponseMessage
	| { readonly id: number; readonly type: "operation/cancel" }
	| { readonly id: number; readonly request: HostOperationRequest; readonly type: "operation/request" }
	| {
			readonly optionalCapabilities: string[];
			readonly requiredCapabilities: string[];
			readonly supportedVersions: [1];
			readonly type: "connection/hello";
	  };

export class CodeModeHostLostError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CodeModeHostLostError";
	}
}

export class CodeModeHostClient {
	private readonly binary: string;
	private buffer = Buffer.alloc(0);
	private child: ChildProcessWithoutNullStreams | undefined;
	private readonly delegateRuntime = new CodeModeDelegateRuntime((message) => this.send(message));
	private readonly initial = new Map<number, Pending>();
	private readonly pending = new Map<number, Pending>();
	private queuedWriteBytes = 0;
	private ready: Promise<void> | undefined;
	private requestId = 0;
	private readonly sessionId = randomUUID();
	private stderr = "";
	private readonly startupTimeoutMs: number;

	constructor(binary: string, startupTimeoutMs = STARTUP_TIMEOUT_MS) {
		this.binary = binary;
		this.startupTimeoutMs = startupTimeoutMs;
	}

	async start(signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		const ready = this.ready ?? this.startProcess();
		this.ready ??= ready;
		try {
			await waitForStartup(ready, this.startupTimeoutMs, signal);
		} catch (error) {
			this.failAll(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	async execute(options: CodeModeExecuteOptions): Promise<RuntimeResponse> {
		throwIfAborted(options.signal);
		await this.start(options.signal);
		throwIfAborted(options.signal);
		const id = ++this.requestId;
		const initial = new Promise<JsonInputValue>((resolve, reject) => this.initial.set(id, { reject, resolve }));
		void initial.catch(() => undefined);
		const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
		const started = this.requestWithId(
			id,
			{
				method: "session/execute",
				request: {
					enabled_tools: options.tools.map(toWireToolDefinition),
					max_output_tokens: MAX_OUTPUT_TOKENS,
					source: options.source,
					tool_call_id: options.context.toolCallId ?? `codemode-${String(id)}`,
					yield_time_ms: DEFAULT_EXEC_YIELD_MS,
				},
				sessionId: this.sessionId,
			},
			options.context,
			tools,
		);
		let cellId: string | undefined;
		const abort = (): void => this.cancelOperation(id, options.context, cellId);
		options.signal?.addEventListener("abort", abort, { once: true });
		try {
			cellId = executionCellId(await started);
			if (options.signal?.aborted) {
				abort();
				throw abortError();
			}
			return this.delegateRuntime.attach(parseRuntimeResponse(await initial));
		} catch (error) {
			this.rejectOperation(id, error instanceof Error ? error : new Error(String(error)));
			throw error;
		} finally {
			options.signal?.removeEventListener("abort", abort);
		}
	}

	async wait(cellId: string, yieldTimeMs: number, options: CodeModeWaitOptions): Promise<RuntimeResponse> {
		throwIfAborted(options.signal);
		await this.start(options.signal);
		throwIfAborted(options.signal);
		this.delegateRuntime.updateCellContext(cellId, options.context);
		const id = ++this.requestId;
		const abort = (): void => this.cancelOperation(id, options.context, cellId);
		options.signal?.addEventListener("abort", abort, { once: true });
		try {
			const value = await this.requestWithId(
				id,
				{
					method: "session/wait",
					request: { cell_id: cellId, yield_time_ms: yieldTimeMs },
					sessionId: this.sessionId,
				},
				options.context,
			);
			const response = runtimeOutcome(value);
			if (!response) throw new Error("Code Mode host returned an invalid wait outcome");
			return this.delegateRuntime.attach(parseRuntimeResponse(response));
		} finally {
			options.signal?.removeEventListener("abort", abort);
		}
	}

	async shutdown(): Promise<void> {
		const child = this.child;
		if (!child) return;
		try {
			await Promise.race([
				this.request({ method: "session/shutdown", sessionId: this.sessionId }),
				new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
			]);
		} catch {
			// Process teardown below is authoritative.
		}
		child.kill();
		this.failAll(new Error("Code Mode host shut down"));
	}

	private cancelOperation(id: number, context: ExecutorContext, cellId?: string): void {
		const error = abortError();
		try {
			this.send({ id, type: "operation/cancel" });
		} catch {
			// Host teardown is already authoritative.
		}
		this.rejectOperation(id, error);
		// The outer Pi Tool has no model-facing wait handle after cancellation.
		if (cellId) void this.terminate(cellId, context).catch(() => undefined);
	}

	private async terminate(cellId: string, context: ExecutorContext): Promise<void> {
		await this.start();
		this.delegateRuntime.updateCellContext(cellId, context);
		await this.request({ cellId, method: "session/terminate", sessionId: this.sessionId }, context);
	}

	private async startProcess(): Promise<void> {
		const child = spawn(this.binary, [], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
		this.child = child;
		this.buffer = Buffer.alloc(0);
		this.stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			if (this.child === child) this.onData(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (this.child === child) this.stderr = (this.stderr + chunk.toString()).slice(-16_384);
		});
		child.on("error", (error) => {
			if (this.child === child)
				this.failAll(new CodeModeHostLostError(`Code Mode host failed: ${error.message}`, { cause: error }));
		});
		child.on("close", (code) => {
			if (this.child !== child) return;
			this.failAll(
				new CodeModeHostLostError(
					`Code Mode host exited with code ${code ?? "unknown"}${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`,
				),
			);
		});
		const handshake = new Promise<void>((resolve, reject) =>
			this.pending.set(0, { reject, resolve: () => resolve() }),
		);
		this.send({
			optionalCapabilities: [],
			requiredCapabilities: [],
			supportedVersions: [1],
			type: "connection/hello",
		});
		await handshake;
		await this.request({ method: "session/open", sessionId: this.sessionId });
	}

	private request(request: HostOperationRequest, context?: ExecutorContext): Promise<JsonInputValue> {
		return this.requestWithId(++this.requestId, request, context);
	}

	private requestWithId(
		id: number,
		request: HostOperationRequest,
		context?: ExecutorContext,
		tools?: Map<string, SuiteSandboxTool>,
	): Promise<JsonInputValue> {
		return new Promise((resolve, reject) => {
			const pending: Pending = { reject, resolve };
			if (context) pending.context = context;
			if (tools) pending.tools = tools;
			this.pending.set(id, pending);
			try {
				this.send({ id, request, type: "operation/request" });
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private rejectOperation(id: number, error: Error): void {
		const pending = this.pending.get(id);
		this.pending.delete(id);
		pending?.reject(error);
		const initial = this.initial.get(id);
		this.initial.delete(id);
		initial?.reject(error);
	}

	private send(message: HostOutboundMessage): void {
		const child = this.child;
		if (!child?.stdin.writable) throw new Error("Code Mode host is not running");
		const payload = Buffer.from(JSON.stringify(message));
		if (payload.length > MAX_FRAME_BYTES) throw new Error(`Code Mode frame exceeds ${String(MAX_FRAME_BYTES)} bytes`);
		const header = Buffer.allocUnsafe(4);
		header.writeUInt32LE(payload.length);
		const frame = Buffer.concat([header, payload]);
		if (this.queuedWriteBytes + frame.length > MAX_QUEUED_WRITE_BYTES) {
			throw new Error(`Code Mode write queue exceeds ${String(MAX_QUEUED_WRITE_BYTES)} bytes`);
		}
		this.queuedWriteBytes += frame.length;
		child.stdin.write(frame, (error) => {
			this.queuedWriteBytes = Math.max(0, this.queuedWriteBytes - frame.length);
			if (error && this.child === child) {
				this.failAll(new CodeModeHostLostError(`Code Mode host write failed: ${error.message}`, { cause: error }));
			}
		});
	}

	private onData(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 4) {
			const length = this.buffer.readUInt32LE(0);
			if (length > MAX_FRAME_BYTES) {
				this.failAll(new Error(`Code Mode frame exceeds ${String(MAX_FRAME_BYTES)} bytes`));
				return;
			}
			if (this.buffer.length < length + 4) return;
			const payload = this.buffer.subarray(4, length + 4);
			this.buffer = this.buffer.subarray(length + 4);
			try {
				this.handleMessage(parseHostMessage(parseJsonValue(payload.toString("utf8"))));
			} catch (error) {
				this.failAll(error instanceof Error ? error : new Error(String(error)));
				return;
			}
		}
	}

	private handleMessage(message: HostMessage): void {
		if (message.type === "connection/ready") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.resolve(undefined);
			return;
		}
		if (message.type === "connection/rejected") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.reject(new Error(`Code Mode handshake rejected: ${JSON.stringify(message.reason)}`));
			return;
		}
		if (message.type === "operation/response") {
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (!pending) return;
			if (message.result.status === "error") {
				pending.reject(new Error(message.result.message));
				return;
			}
			const cellId = executionCellId(message.result.value);
			if (cellId && pending.context) this.delegateRuntime.bindCell(cellId, pending.context, pending.tools);
			pending.resolve(message.result.value);
			return;
		}
		if (message.type === "execute/initialResponse") {
			const pending = this.initial.get(message.id);
			this.initial.delete(message.id);
			if (!pending) return;
			if (message.result.status === "error") pending.reject(new Error(message.result.message));
			else pending.resolve(message.result.value);
			return;
		}
		if (message.type === "delegate/request") {
			this.delegateRuntime.handleRequest(message);
			return;
		}
		if (message.type === "delegate/cancel") {
			this.delegateRuntime.cancel(message.id);
			return;
		}
		this.delegateRuntime.closeCell(message.cellId);
	}

	private failAll(error: Error): void {
		for (const pending of [...this.pending.values(), ...this.initial.values()]) pending.reject(error);
		this.pending.clear();
		this.initial.clear();
		this.delegateRuntime.clear();
		this.queuedWriteBytes = 0;
		const child = this.child;
		this.child = undefined;
		this.ready = undefined;
		if (child && !child.killed) child.kill();
	}
}

function abortError(): Error {
	const error = new Error("Code Mode operation aborted");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

async function waitForStartup(ready: Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(
			() => reject(new Error(`Code Mode host startup timed out after ${String(timeoutMs)} ms`)),
			timeoutMs,
		);
	});
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				onAbort = () => reject(abortError());
				signal.addEventListener("abort", onAbort, { once: true });
			})
		: undefined;
	try {
		await Promise.race(aborted ? [ready, deadline, aborted] : [ready, deadline]);
	} finally {
		if (timeout) clearTimeout(timeout);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
	}
}
