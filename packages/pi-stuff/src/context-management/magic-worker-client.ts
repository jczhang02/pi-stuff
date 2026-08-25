/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion -- This private structured-clone adapter preserves Pi and Magic Context's open Extension payloads; all traffic stays inside the Package-owned Worker pair. */
import { fileURLToPath } from "node:url";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import {
	MAGIC_WORKER_PROTOCOL_VERSION,
	type MagicWorkerContextSnapshot,
	type MagicWorkerEffectMessage,
	type MagicWorkerEvent,
	type MagicWorkerHostTool,
	type MagicWorkerMessage,
	type MagicWorkerReadyMessage,
	type MagicWorkerRequest,
	type MagicWorkerSyncEffectMessage,
	type MagicWorkerToolDescriptor,
} from "./magic-worker-protocol.js";

type LooseEventHandler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown | Promise<unknown>;

interface PendingRequest {
	readonly onUpdate: AgentToolUpdateCallback<unknown> | undefined;
	readonly reject: (error: Error) => void;
	readonly resolve: (value: unknown) => void;
}

interface MagicModule {
	readonly default: (pi: ExtensionAPI, onFatal?: MagicWorkerFatalHandler) => Promise<void> | void;
}

type MagicWorkerFatalHandler = (cause: unknown) => void;
type EventByType<Type extends ExtensionEvent["type"]> = Extract<ExtensionEvent, { readonly type: Type }>;

type MagicWorkerInvocationRequest =
	| Omit<Extract<MagicWorkerRequest, { readonly type: "command" }>, "id">
	| Omit<Extract<MagicWorkerRequest, { readonly type: "event" }>, "id">
	| Omit<Extract<MagicWorkerRequest, { readonly type: "tool" }>, "id">;

const BRANCH_COMMANDS = new Set(["ctx-recomp", "ctx-session-upgrade", "ctx-wrapup"]);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function requiredCall<T>(label: string, call: () => T): T {
	try {
		return call();
	} catch (error) {
		throw new Error(`Magic Context could not snapshot Pi ${label}: ${errorMessage(error)}`, { cause: error });
	}
}

function optionalCall<T>(call: () => T): T | undefined {
	try {
		return call();
	} catch {
		return undefined;
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
		contextUsage: optionalCall(() => ctx.getContextUsage()),
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		idle: optionalCall(() => ctx.isIdle()) ?? false,
		mode: ctx.mode,
		model: workerModel(ctx),
		pendingMessages: optionalCall(() => ctx.hasPendingMessages()) ?? false,
		projectTrusted: optionalCall(() => ctx.isProjectTrusted()) ?? false,
		session: {
			file: optionalCall(() => manager.getSessionFile()) ?? undefined,
			id: optionalCall(() => manager.getSessionId()),
			leafId: optionalCall(() => manager.getLeafId()) ?? undefined,
		},
		systemPrompt: optionalCall(() => ctx.getSystemPrompt()) ?? "",
		thinkingLevel: ctx.thinkingLevel,
	};
}

function entryParentId(entry: unknown): string | undefined {
	if (entry === null || typeof entry !== "object" || !("parentId" in entry)) return;
	const parentId = (entry as { readonly parentId?: unknown }).parentId;
	return typeof parentId === "string" ? parentId : undefined;
}

function snapshotEvent(
	name: string,
	event: ExtensionEvent,
): { readonly event: MagicWorkerEvent; readonly signal?: AbortSignal } {
	const signal = "signal" in event && event.signal instanceof AbortSignal ? event.signal : undefined;
	let snapshot: MagicWorkerEvent;
	switch (name) {
		case "agent_end": {
			const { messages } = event as EventByType<"agent_end">;
			snapshot = { messages, type: "agent_end" };
			break;
		}
		case "before_agent_start": {
			const { systemPrompt } = event as EventByType<"before_agent_start">;
			snapshot = { systemPrompt, type: "before_agent_start" };
			break;
		}
		case "context": {
			const { messages } = event as EventByType<"context">;
			snapshot = { messages, type: "context" };
			break;
		}
		case "message_end": {
			const { message } = event as EventByType<"message_end">;
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
			const { previousSessionFile, reason } = event as EventByType<"session_start">;
			snapshot = {
				...(typeof previousSessionFile === "string" ? { previousSessionFile } : {}),
				reason,
				type: "session_start",
			};
			break;
		}
		case "tool_execution_end": {
			const { toolName } = event as EventByType<"tool_execution_end">;
			snapshot = { toolName, type: "tool_execution_end" };
			break;
		}
		case "tool_execution_start": {
			const { args, toolCallId, toolName } = event as EventByType<"tool_execution_start">;
			snapshot = { args, toolCallId, toolName, type: "tool_execution_start" };
			break;
		}
		case "tool_result": {
			const { content, toolName } = event as EventByType<"tool_result">;
			snapshot = { content, toolName, type: "tool_result" };
			break;
		}
		default:
			throw new Error(`Magic Context registered unsupported Pi event '${name}'.`);
	}
	return { event: snapshot, ...(signal ? { signal } : {}) };
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
		parameters: JSON.parse(JSON.stringify(tool.parameters)) as unknown,
		promptGuidelines: tool.promptGuidelines,
		sourceInfo: JSON.parse(JSON.stringify(tool.sourceInfo)) as unknown,
	}));
}

function workerError(message: MagicWorkerMessage): Error {
	if (message.type !== "error") return new Error("Magic Context worker failed.");
	const error = new Error(message.error);
	if (message.stack) error.stack = message.stack;
	return error;
}

function isReadyMessage(value: unknown): value is MagicWorkerReadyMessage {
	return (
		value !== null &&
		typeof value === "object" &&
		"type" in value &&
		value.type === "ready" &&
		"protocolVersion" in value &&
		typeof value.protocolVersion === "number" &&
		"commands" in value &&
		Array.isArray(value.commands) &&
		"events" in value &&
		Array.isArray(value.events) &&
		"tools" in value &&
		Array.isArray(value.tools)
	);
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
		if (!isReadyMessage(message)) {
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
		for (const name of ready.events) {
			const handler: LooseEventHandler =
				name === "session_shutdown"
					? (event, ctx) => finishMagicWorkerShutdown(this.invokeEvent(name, event, ctx), () => this.close())
					: (event, ctx) => this.invokeEvent(name, event, ctx);
			const on = this.pi.on.bind(this.pi) as (event: string, value: LooseEventHandler) => void;
			on(name, handler);
		}
		for (const descriptor of ready.tools) this.registerTool(descriptor);
		for (const command of ready.commands) {
			this.pi.registerCommand(command.name, {
				...(command.description ? { description: command.description } : {}),
				handler: async (args, ctx) => {
					await this.invokeCommand(command.name, args, ctx);
				},
			});
		}
	}

	private registerTool(descriptor: MagicWorkerToolDescriptor): void {
		const tool: ToolDefinition = {
			description: descriptor.description,
			label: descriptor.label,
			name: descriptor.name,
			parameters: descriptor.parameters,
			...(descriptor.constrainedSampling !== undefined
				? { constrainedSampling: descriptor.constrainedSampling }
				: {}),
			...(descriptor.executionMode !== undefined ? { executionMode: descriptor.executionMode } : {}),
			...(descriptor.promptGuidelines !== undefined ? { promptGuidelines: [...descriptor.promptGuidelines] } : {}),
			...(descriptor.promptSnippet !== undefined ? { promptSnippet: descriptor.promptSnippet } : {}),
			...(descriptor.renderShell !== undefined ? { renderShell: descriptor.renderShell } : {}),
			execute: async (toolCallId, args, signal, onUpdate, ctx) =>
				(await this.invokeTool(
					descriptor.name,
					toolCallId,
					args,
					ctx,
					signal,
					onUpdate,
				)) as AgentToolResult<unknown>,
		};
		this.pi.registerTool(tool);
	}

	private async invokeEvent(name: string, event: ExtensionEvent, ctx: ExtensionContext): Promise<unknown> {
		const snapshot = snapshotEvent(name, event);
		const context = this.synchronizeSession(ctx, name === "session_start");
		try {
			const result = await this.invoke(
				{ context, event: snapshot.event, name, type: "event" },
				ctx,
				snapshot.signal ?? ctx.signal,
			);
			if (name === "message_end") this.refreshPersistedEntry(ctx, context.session.id);
			return result;
		} finally {
			if (name === "session_before_switch" && context.session.id) {
				this.sessionLeaves.delete(context.session.id);
				if (this.contexts.get(context.session.id) === ctx) this.contexts.delete(context.session.id);
			}
		}
	}

	private invokeCommand(name: string, args: string, ctx: ExtensionContext): Promise<unknown> {
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
		args: unknown,
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
	): Promise<unknown> {
		return this.invoke(
			{ args, context: this.synchronizeSession(ctx), name, toolCallId, type: "tool" },
			ctx,
			signal,
			onUpdate,
		);
	}

	private invoke(
		request: MagicWorkerInvocationRequest,
		ctx: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<unknown>,
	): Promise<unknown> {
		const id = this.nextRequestId();
		const session = request.context.session.id;
		if (session) this.contexts.set(session, ctx);
		const result = this.waitFor(id, onUpdate);
		const cancel = (): void => {
			if (!this.closed) this.post({ id, type: "cancel" });
		};
		if (!signal?.aborted) signal?.addEventListener("abort", cancel, { once: true });
		try {
			this.post({ ...request, id } as MagicWorkerRequest);
			if (signal?.aborted) cancel();
		} catch (error) {
			this.pending.delete(id);
			return Promise.reject(error);
		}
		return result.finally(() => signal?.removeEventListener("abort", cancel));
	}

	private nextRequestId(): number {
		return this.nextId++;
	}

	private waitFor(id: number, onUpdate?: AgentToolUpdateCallback<unknown>): Promise<unknown> {
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
			pending.onUpdate?.(message.update as never);
			return;
		}
		this.pending.delete(message.id);
		if (message.type === "error") pending.reject(workerError(message));
		else if (message.type === "ready") pending.resolve(message);
		else pending.resolve(message.result);
	}

	private applyEffect(message: MagicWorkerEffectMessage): void {
		try {
			if (message.sessionId && !this.contexts.has(message.sessionId)) return;
			switch (message.name) {
				case "appendEntry": {
					this.pi.appendEntry(message.args[0] as string, message.args[1]);
					const ctx = message.sessionId ? this.contexts.get(message.sessionId) : undefined;
					if (ctx) this.synchronizeSession(ctx);
					break;
				}
				case "sendMessage":
					this.pi.sendMessage(message.args[0] as never, message.args[1] as never);
					break;
				case "sendUserMessage":
					this.pi.sendUserMessage(message.args[0] as never, message.args[1] as never);
					break;
				case "setActiveTools":
					this.pi.setActiveTools(message.args[0] as string[]);
					break;
			}
		} catch {
			// Fire-and-forget upstream presentation effects never control Context projection.
		}
	}

	private applySyncEffect(message: MagicWorkerSyncEffectMessage): void {
		let response: { readonly error?: string; readonly value?: unknown };
		let success = false;
		try {
			const ctx = message.sessionId ? this.contexts.get(message.sessionId) : undefined;
			if (!ctx) throw new Error("Pi Host context is no longer available for this Session.");
			const manager = ctx.sessionManager as unknown as {
				appendCompaction?: (...args: readonly unknown[]) => unknown;
			};
			const method = manager[message.name];
			if (typeof method !== "function") throw new Error(`Pi SessionManager does not expose ${message.name}.`);
			response = { value: method.apply(manager, [...message.args]) };
			success = true;
			try {
				this.synchronizeSession(ctx);
			} catch {
				// The Host mutation already succeeded. A later invocation will repair the mirror from its leaf or branch.
			}
		} catch (error) {
			response = { error: errorMessage(error) };
		}
		const control = new Int32Array(message.buffer, 0, 2);
		try {
			const encoded = new TextEncoder().encode(JSON.stringify(response));
			const bytes = new Uint8Array(message.buffer, Int32Array.BYTES_PER_ELEMENT * 2);
			if (encoded.length > bytes.length) throw new Error("Magic Context Host effect response exceeded its buffer.");
			bytes.set(encoded);
			Atomics.store(control, 1, encoded.length);
			Atomics.store(control, 0, success ? 1 : 2);
		} catch (error) {
			const encoded = new TextEncoder().encode(JSON.stringify({ error: errorMessage(error) }));
			new Uint8Array(message.buffer, Int32Array.BYTES_PER_ELEMENT * 2).set(encoded);
			Atomics.store(control, 1, encoded.length);
			Atomics.store(control, 0, 2);
		}
		Atomics.notify(control, 0);
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
