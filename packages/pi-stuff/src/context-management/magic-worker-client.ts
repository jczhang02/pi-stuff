import { fileURLToPath } from "node:url";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	SessionEntry,
	SessionManager,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { type JsonInputValue, type JsonObject, parseJsonObject } from "../shared/json-value.js";
import { isRuntimeFunction } from "../shared/runtime-type.js";
import {
	MAGIC_WORKER_PROTOCOL_VERSION,
	type MagicWorkerContextSnapshot,
	type MagicWorkerEffectMessage,
	type MagicWorkerEvent,
	type MagicWorkerEventName,
	type MagicWorkerHostTool,
	type MagicWorkerInvocationResult,
	type MagicWorkerMessage,
	type MagicWorkerReadyMessage,
	type MagicWorkerRequest,
	type MagicWorkerResultMessage,
	type MagicWorkerSyncEffectMessage,
	type MagicWorkerToolDescriptor,
} from "./magic-worker-protocol.js";

interface PendingRequest {
	readonly onUpdate: AgentToolUpdateCallback<unknown> | undefined;
	readonly reject: (error: Error) => void;
	readonly resolve: (message: MagicWorkerReadyMessage | MagicWorkerResultMessage) => void;
}

interface MagicModule {
	readonly default: (pi: ExtensionAPI, onFatal?: MagicWorkerFatalHandler) => Promise<void> | void;
}

type MagicWorkerFatalHandler = (cause: unknown) => void;

interface ContextProjectionResult {
	readonly messages?: Extract<MagicWorkerEvent, { readonly type: "context" }>["messages"];
}

interface MessageReplacementResult {
	readonly message?: Extract<MagicWorkerEvent, { readonly type: "message_end" }>["message"];
}

interface SessionCancellationResult {
	readonly cancel?: boolean;
}

interface ToolContentResult {
	readonly content?: Extract<MagicWorkerEvent, { readonly type: "tool_result" }>["content"];
}

type MagicWorkerInvocationRequest =
	| Omit<Extract<MagicWorkerRequest, { readonly type: "command" }>, "id">
	| Omit<Extract<MagicWorkerRequest, { readonly type: "event" }>, "id">
	| Omit<Extract<MagicWorkerRequest, { readonly type: "tool" }>, "id">;

const BRANCH_COMMANDS = new Set(["ctx-recomp", "ctx-session-upgrade", "ctx-wrapup"]);

function errorMessage<Cause>(cause: Cause): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function requiredCall<T>(label: string, call: () => T): T {
	try {
		return call();
	} catch (error) {
		throw new Error(`Magic Context could not snapshot Pi ${label}: ${errorMessage(error)}`, { cause: error });
	}
}

function workerModel(ctx: ExtensionContext): MagicWorkerContextSnapshot["model"] {
	const model = ctx.model;
	if (!model) return;
	return {
		api: model.api,
		contextWindow: model.contextWindow,
		id: model.id,
		maxTokens: model.maxTokens,
		provider: model.provider,
	};
}

function snapshotContext(ctx: ExtensionContext): MagicWorkerContextSnapshot {
	const manager = ctx.sessionManager;
	return {
		contextUsage: requiredCall("context usage", () => ctx.getContextUsage()),
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		idle: requiredCall("idle state", () => ctx.isIdle()),
		mode: ctx.mode,
		model: workerModel(ctx),
		pendingMessages: requiredCall("pending-message state", () => ctx.hasPendingMessages()),
		projectTrusted: requiredCall("project trust", () => ctx.isProjectTrusted()),
		session: {
			file: requiredCall("Session file", () => manager.getSessionFile()),
			id: requiredCall("Session id", () => manager.getSessionId()),
			leafId: requiredCall("Session leaf id", () => manager.getLeafId()) ?? undefined,
		},
		systemPrompt: requiredCall("system prompt", () => ctx.getSystemPrompt()),
		thinkingLevel: ctx.thinkingLevel,
	};
}

function entryParentId(entry: SessionEntry): string | undefined {
	return entry.parentId ?? undefined;
}

function snapshotEvent(event: ExtensionEvent): { readonly event: MagicWorkerEvent; readonly signal?: AbortSignal } {
	const signal = "signal" in event && event.signal instanceof AbortSignal ? event.signal : undefined;
	let snapshot: MagicWorkerEvent;
	switch (event.type) {
		case "agent_end": {
			const { messages } = event;
			snapshot = { messages, type: "agent_end" };
			break;
		}
		case "before_agent_start": {
			const { systemPrompt } = event;
			snapshot = { systemPrompt, type: "before_agent_start" };
			break;
		}
		case "context": {
			const { messages } = event;
			snapshot = { messages, type: "context" };
			break;
		}
		case "message_end": {
			const { message } = event;
			snapshot = { message, type: "message_end" };
			break;
		}
		case "session_before_compact":
			snapshot = { type: "session_before_compact" };
			break;
		case "session_before_switch":
			snapshot = { type: "session_before_switch" };
			break;
		case "session_compact":
			snapshot = { type: "session_compact" };
			break;
		case "session_shutdown":
			snapshot = { type: "session_shutdown" };
			break;
		case "session_start": {
			const { previousSessionFile, reason } = event;
			snapshot = previousSessionFile
				? { previousSessionFile, reason, type: "session_start" }
				: { reason, type: "session_start" };
			break;
		}
		case "tool_execution_end": {
			const { toolName } = event;
			snapshot = { toolName, type: "tool_execution_end" };
			break;
		}
		case "tool_execution_start": {
			const { args, toolCallId, toolName } = event;
			snapshot = { args, toolCallId, toolName, type: "tool_execution_start" };
			break;
		}
		case "tool_result": {
			const { content, toolName } = event;
			snapshot = { content, toolName, type: "tool_result" };
			break;
		}
		default:
			throw new Error(`Magic Context registered unsupported Pi event '${event.type}'.`);
	}
	return signal ? { event: snapshot, signal } : { event: snapshot };
}

export async function finishMagicWorkerShutdown<Result>(
	operation: Promise<Result>,
	close: () => Promise<void>,
): Promise<Result | undefined> {
	if (!(await settleWithin(operation, HOST_SHUTDOWN_GRACE_MS))) {
		await close();
		return;
	}
	try {
		return await operation;
	} finally {
		await close();
	}
}

function wireTools(pi: ExtensionAPI): MagicWorkerHostTool[] {
	return pi.getAllTools().map((tool) => ({
		description: tool.description,
		name: tool.name,
		parameters: parseJsonObject(JSON.stringify(tool.parameters)),
		promptGuidelines: tool.promptGuidelines ? [...tool.promptGuidelines] : undefined,
		sourceInfo: { ...tool.sourceInfo },
	}));
}

function workerError(message: MagicWorkerMessage): Error {
	if (message.type !== "error") return new Error("Magic Context worker failed.");
	const error = new Error(message.error);
	if (message.stack) error.stack = message.stack;
	return error;
}

function canAppendCompaction(
	manager: ExtensionContext["sessionManager"],
): manager is ExtensionContext["sessionManager"] & Pick<SessionManager, "appendCompaction"> {
	return isRuntimeFunction(readHostProxyProperty(manager, "appendCompaction"));
}

const SYNC_RESPONSE_TOO_LARGE = "Magic Context Host effect response exceeded its buffer.";

export function writeMagicWorkerSyncResponse(buffer: SharedArrayBuffer, status: 1 | 2, text: string): void {
	const control = new Int32Array(buffer, 0, 2);
	const bytes = new Uint8Array(buffer, Int32Array.BYTES_PER_ELEMENT * 2);
	try {
		let encoded = new TextEncoder().encode(text);
		let finalStatus = status;
		if (encoded.length > bytes.length) {
			encoded = new TextEncoder().encode(SYNC_RESPONSE_TOO_LARGE);
			finalStatus = 2;
		}
		const length = Math.min(encoded.length, bytes.length);
		bytes.set(encoded.subarray(0, length));
		Atomics.store(control, 1, length);
		Atomics.store(control, 0, finalStatus);
	} finally {
		Atomics.notify(control, 0);
	}
}

class MagicWorkerClient {
	private readonly contexts = new Map<string, ExtensionContext>();
	private nextId = 1;
	private readonly onFatal: MagicWorkerFatalHandler | undefined;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly pi: ExtensionAPI;
	private readonly sessionLeaves = new Map<string, string | undefined>();
	private worker: Worker | undefined;
	private workerUrl: string | undefined;
	private closed = false;
	private termination: Promise<void> | undefined;

	constructor(pi: ExtensionAPI, onFatal?: MagicWorkerFatalHandler) {
		this.pi = pi;
		this.onFatal = onFatal;
	}

	async initialize(): Promise<MagicWorkerReadyMessage> {
		const magicContextUrl = import.meta.resolve("@cortexkit/pi-magic-context");
		const build = await Bun.build({
			define: { "import.meta.url": JSON.stringify(magicContextUrl) },
			entrypoints: [fileURLToPath(new URL("./magic-worker-entry.ts", import.meta.url))],
			format: "esm",
			target: "bun",
		});
		const output = build.outputs[0];
		if (!build.success || build.outputs.length !== 1 || !output) {
			throw new Error(
				`Magic Context worker build failed: ${build.logs.map((log) => log.message).join("; ") || "no executable output"}`,
			);
		}
		this.workerUrl = URL.createObjectURL(output);
		this.worker = new Worker(this.workerUrl, { name: "pi-stuff-magic-context", type: "module" });
		this.worker.onmessage = (event: MessageEvent<MagicWorkerMessage>) => this.receive(event.data);
		this.worker.onerror = (event): void => {
			event.preventDefault();
			if (this.closed) return;
			const error = new Error(event.message || "Magic Context worker crashed.");
			void this.terminate(error);
			this.onFatal?.(error);
		};
		const id = this.nextRequestId();
		const ready = this.waitFor(id);
		this.post({
			activeTools: this.pi.getActiveTools(),
			hostTools: wireTools(this.pi),
			id,
			protocolVersion: MAGIC_WORKER_PROTOCOL_VERSION,
			type: "initialize",
		});
		const message = await ready;
		if (message.type !== "ready") {
			throw new Error("Magic Context worker returned an invalid initialization response.");
		}
		if (message.protocolVersion !== MAGIC_WORKER_PROTOCOL_VERSION) {
			throw new Error(
				`Magic Context worker protocol ${String(message.protocolVersion)} does not match ${String(MAGIC_WORKER_PROTOCOL_VERSION)}.`,
			);
		}
		return message;
	}

	register(ready: MagicWorkerReadyMessage): void {
		for (const name of ready.events) this.registerEvent(name);
		for (const descriptor of ready.tools) this.registerTool(descriptor);
		for (const command of ready.commands) {
			const handler = async (args: string, ctx: ExtensionContext): Promise<void> => {
				await this.invokeCommand(command.name, args, ctx);
			};
			this.pi.registerCommand(
				command.name,
				command.description ? { description: command.description, handler } : { handler },
			);
		}
	}

	private registerEvent(name: MagicWorkerEventName): void {
		switch (name) {
			case "agent_end":
				this.pi.on("agent_end", (event, ctx) => this.invokeVoidEvent(event, ctx));
				break;
			case "before_agent_start":
				this.pi.on("before_agent_start", (event, ctx) =>
					this.invokeResultEvent<BeforeAgentStartEventResult>(event, ctx),
				);
				break;
			case "context":
				this.pi.on("context", (event, ctx) => this.invokeResultEvent<ContextProjectionResult>(event, ctx));
				break;
			case "message_end":
				this.pi.on("message_end", (event, ctx) => this.invokeResultEvent<MessageReplacementResult>(event, ctx));
				break;
			case "session_before_compact":
				this.pi.on("session_before_compact", (event, ctx) =>
					this.invokeResultEvent<SessionCancellationResult>(event, ctx),
				);
				break;
			case "session_before_switch":
				this.pi.on("session_before_switch", (event, ctx) =>
					this.invokeResultEvent<SessionCancellationResult>(event, ctx),
				);
				break;
			case "session_compact":
				this.pi.on("session_compact", (event, ctx) => this.invokeVoidEvent(event, ctx));
				break;
			case "session_shutdown":
				this.pi.on("session_shutdown", (event, ctx) => {
					if (this.closed) return;
					return finishMagicWorkerShutdown(this.invokeVoidEvent(event, ctx), () => this.close());
				});
				break;
			case "session_start":
				this.pi.on("session_start", (event, ctx) => this.invokeVoidEvent(event, ctx));
				break;
			case "tool_execution_end":
				this.pi.on("tool_execution_end", (event, ctx) => this.invokeVoidEvent(event, ctx));
				break;
			case "tool_execution_start":
				this.pi.on("tool_execution_start", (event, ctx) => this.invokeVoidEvent(event, ctx));
				break;
			case "tool_result":
				this.pi.on("tool_result", (event, ctx) => this.invokeResultEvent<ToolContentResult>(event, ctx));
		}
	}

	private registerTool(descriptor: MagicWorkerToolDescriptor): void {
		const parameters = Type.Unsafe<JsonObject>(descriptor.parameters);
		const tool: ToolDefinition<typeof parameters> = {
			description: descriptor.description,
			label: descriptor.label,
			name: descriptor.name,
			parameters,
			execute: async (toolCallId, args, signal, onUpdate, ctx) =>
				this.invokeTool(descriptor.name, toolCallId, args, ctx, signal, onUpdate),
		};
		if (descriptor.constrainedSampling !== undefined) tool.constrainedSampling = descriptor.constrainedSampling;
		if (descriptor.executionMode !== undefined) tool.executionMode = descriptor.executionMode;
		if (descriptor.promptGuidelines !== undefined) tool.promptGuidelines = [...descriptor.promptGuidelines];
		if (descriptor.promptSnippet !== undefined) tool.promptSnippet = descriptor.promptSnippet;
		if (descriptor.renderShell !== undefined) tool.renderShell = descriptor.renderShell;
		this.pi.registerTool(tool);
	}

	private async invokeEvent(event: ExtensionEvent, ctx: ExtensionContext): Promise<MagicWorkerInvocationResult> {
		const snapshot = snapshotEvent(event);
		const context = this.synchronizeSession(ctx, event.type === "session_start");
		try {
			const result = await this.invoke(
				{ context, event: snapshot.event, type: "event" },
				ctx,
				snapshot.signal ?? ctx.signal,
			);
			if (event.type === "message_end") this.refreshPersistedEntry(ctx, context.session.id);
			return result;
		} finally {
			if (event.type === "session_before_switch" && context.session.id) {
				this.sessionLeaves.delete(context.session.id);
				if (this.contexts.get(context.session.id) === ctx) this.contexts.delete(context.session.id);
			}
		}
	}

	private async invokeResultEvent<Result>(event: ExtensionEvent, ctx: ExtensionContext): Promise<Result | undefined> {
		const result = await this.invokeEvent(event, ctx);
		if (result === undefined) return;
		// SAFETY: The Worker invokes the handler registered by Magic Context for this same Pi event.
		return result as Result;
	}

	private async invokeVoidEvent(event: ExtensionEvent, ctx: ExtensionContext): Promise<void> {
		await this.invokeEvent(event, ctx);
	}

	private invokeCommand(name: string, args: string, ctx: ExtensionContext): Promise<MagicWorkerInvocationResult> {
		return this.invoke(
			{ args, context: this.synchronizeSession(ctx, BRANCH_COMMANDS.has(name)), name, type: "command" },
			ctx,
			ctx.signal,
		);
	}

	private refreshPersistedEntry(ctx: ExtensionContext, expectedSessionId: string | undefined): void {
		if (!expectedSessionId) return;
		setImmediate(() => {
			if (this.closed) return;
			try {
				if (ctx.sessionManager.getSessionId() !== expectedSessionId) return;
				this.synchronizeSession(ctx);
			} catch {
				// Pi may switch or close the Session before this post-persistence refresh runs.
			}
		});
	}

	private synchronizeSession(ctx: ExtensionContext, forceSnapshot = false): MagicWorkerContextSnapshot {
		const snapshot = snapshotContext(ctx);
		const sessionId = snapshot.session.id;
		if (!sessionId) return snapshot;
		const leafId = snapshot.session.leafId;
		const previousLeafId = this.sessionLeaves.get(sessionId);
		if (!forceSnapshot && this.sessionLeaves.has(sessionId) && leafId === previousLeafId) return snapshot;
		if (!forceSnapshot && this.sessionLeaves.has(sessionId) && leafId) {
			const entry = requiredCall("Session leaf entry", () => ctx.sessionManager.getEntry(leafId));
			if (entry && entryParentId(entry) === previousLeafId) {
				this.post({ entry, leafId, sessionId, type: "session-entry" });
				this.sessionLeaves.set(sessionId, leafId);
				return snapshot;
			}
		}
		const branch = requiredCall("Session branch", () => ctx.sessionManager.getBranch());
		this.post({ branch: [...branch], leafId, sessionId, type: "session-snapshot" });
		this.sessionLeaves.set(sessionId, leafId);
		return snapshot;
	}

	private invokeTool(
		name: string,
		toolCallId: string,
		args: JsonInputValue,
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
	): Promise<AgentToolResult<unknown>> {
		return this.invoke<AgentToolResult<unknown>>(
			{ args, context: this.synchronizeSession(ctx), name, toolCallId, type: "tool" },
			ctx,
			signal,
			onUpdate,
		);
	}

	private async invoke<Result extends MagicWorkerInvocationResult = MagicWorkerInvocationResult>(
		request: MagicWorkerInvocationRequest,
		ctx: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<unknown>,
	): Promise<Result> {
		if (this.closed) throw new Error("Magic Context worker is closed.");
		const id = this.nextRequestId();
		const session = request.context.session.id;
		const previousContext = session ? this.contexts.get(session) : undefined;
		if (session) this.contexts.set(session, ctx);
		const result = this.waitFor(id, onUpdate);
		let posted = false;
		const cancel = (): void => {
			if (!this.closed) this.post({ id, type: "cancel" });
		};
		if (!signal?.aborted) signal?.addEventListener("abort", cancel, { once: true });
		try {
			this.post({ ...request, id });
			posted = true;
			if (signal?.aborted) cancel();
			const reply = await result;
			if (reply.type !== "result") throw new Error("Magic Context worker returned an unexpected reply.");
			// SAFETY: Each request id resolves only from the matching Worker invocation.
			return reply.result as Result;
		} catch (cause) {
			this.pending.delete(id);
			if (!posted && session) {
				if (this.closed || previousContext === undefined) this.contexts.delete(session);
				else this.contexts.set(session, previousContext);
			}
			throw cause;
		} finally {
			signal?.removeEventListener("abort", cancel);
		}
	}

	private nextRequestId(): number {
		return this.nextId++;
	}

	private waitFor(
		id: number,
		onUpdate?: AgentToolUpdateCallback<unknown>,
	): Promise<MagicWorkerReadyMessage | MagicWorkerResultMessage> {
		return new Promise((resolve, reject) => this.pending.set(id, { onUpdate, reject, resolve }));
	}

	private post(message: MagicWorkerRequest): void {
		if (this.closed) throw new Error("Magic Context worker is closed.");
		if (!this.worker) throw new Error("Magic Context worker is not initialized.");
		this.worker.postMessage(message);
	}

	private receive(message: MagicWorkerMessage): void {
		if (message.type === "effect") {
			this.applyEffect(message);
			return;
		}
		if (message.type === "sync-effect") {
			this.applySyncEffect(message);
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) return;
		if (message.type === "tool-update") {
			pending.onUpdate?.(message.update);
			return;
		}
		this.pending.delete(message.id);
		if (message.type === "error") pending.reject(workerError(message));
		else pending.resolve(message);
	}

	private applyEffect(message: MagicWorkerEffectMessage): void {
		try {
			if (message.sessionId && !this.contexts.has(message.sessionId)) return;
			switch (message.name) {
				case "appendEntry": {
					this.pi.appendEntry(...message.args);
					const ctx = message.sessionId ? this.contexts.get(message.sessionId) : undefined;
					if (ctx) this.synchronizeSession(ctx);
					break;
				}
				case "sendMessage":
					this.pi.sendMessage(...message.args);
					break;
				case "sendUserMessage":
					this.pi.sendUserMessage(...message.args);
					break;
				case "setActiveTools":
					this.pi.setActiveTools(...message.args);
					break;
			}
		} catch {
			// Fire-and-forget upstream presentation effects never control Context projection.
		}
	}

	private applySyncEffect(message: MagicWorkerSyncEffectMessage): void {
		let status: 1 | 2 = 2;
		let text: string;
		try {
			const ctx = message.sessionId ? this.contexts.get(message.sessionId) : undefined;
			if (!ctx) throw new Error("Pi Host context is no longer available for this Session.");
			const manager = ctx.sessionManager;
			if (!canAppendCompaction(manager)) {
				throw new Error("Pi SessionManager does not expose appendCompaction.");
			}
			text = manager.appendCompaction(...message.args);
			status = 1;
			try {
				this.synchronizeSession(ctx);
			} catch {
				// The Host mutation already succeeded. A later invocation will repair the mirror from its leaf or branch.
			}
		} catch (cause) {
			text = errorMessage(cause);
		}
		writeMagicWorkerSyncResponse(message.buffer, status, text);
	}

	private fail(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private terminate(error: Error): Promise<void> {
		if (this.termination) return this.termination;
		this.closed = true;
		this.fail(error);
		const worker = this.worker;
		this.worker = undefined;
		this.termination = worker ? Promise.resolve(worker.terminate()).then(() => undefined) : Promise.resolve();
		if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
		this.workerUrl = undefined;
		this.contexts.clear();
		this.sessionLeaves.clear();
		return this.termination;
	}

	async close(): Promise<void> {
		await this.terminate(new Error("Magic Context worker closed."));
	}
}

export async function magicContextWorkerFactory(pi: ExtensionAPI, onFatal?: MagicWorkerFatalHandler): Promise<void> {
	const client = new MagicWorkerClient(pi, onFatal);
	try {
		const ready = await client.initialize();
		client.register(ready);
	} catch (error) {
		await client.close();
		throw error;
	}
}

export async function loadMagicContextWorker(): Promise<MagicModule> {
	return { default: magicContextWorkerFactory };
}
