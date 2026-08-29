import { fileURLToPath } from "node:url";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { type JsonInputValue, type JsonObject, parseJsonObject } from "../shared/json-value.js";
import {
	canAppendMagicWorkerCompaction,
	magicWorkerError,
	magicWorkerErrorMessage,
	magicWorkerHostTools,
	requiredHostCall,
	snapshotMagicWorkerContext,
	snapshotMagicWorkerEvent,
	writeMagicWorkerSyncResponse,
} from "./magic-worker-host.js";
import {
	MAGIC_WORKER_PROTOCOL_VERSION,
	type MagicWorkerCommandName,
	type MagicWorkerContextSnapshot,
	type MagicWorkerEffectMessage,
	type MagicWorkerEventName,
	type MagicWorkerEventRequest,
	type MagicWorkerEventResult,
	type MagicWorkerInvocationRequest,
	type MagicWorkerMessage,
	type MagicWorkerReadyMessage,
	type MagicWorkerRequest,
	type MagicWorkerResultMessage,
	type MagicWorkerSyncEffectMessage,
	type MagicWorkerToolDescriptor,
	type MagicWorkerToolName,
} from "./magic-worker-protocol.js";

interface PendingRequest {
	readonly onUpdate: AgentToolUpdateCallback<JsonInputValue | undefined> | undefined;
	readonly reject: (error: Error) => void;
	readonly resolve: (message: MagicWorkerReadyMessage | MagicWorkerResultMessage) => void;
}

interface MagicModule {
	readonly default: (pi: ExtensionAPI, onFatal?: MagicWorkerFatalHandler) => Promise<void> | void;
}

type MagicWorkerFatalHandler = (cause: unknown) => void;

const BRANCH_COMMANDS: ReadonlySet<MagicWorkerCommandName> = new Set([
	"ctx-recomp",
	"ctx-session-upgrade",
	"ctx-wrapup",
]);

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
			if (!this.closed) this.reportFatal(new Error(event.message || "Magic Context worker crashed."));
		};
		const id = this.nextRequestId();
		const ready = this.waitFor(id);
		this.post({
			hostTools: magicWorkerHostTools(this.pi),
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
				this.pi.on("before_agent_start", async (event, ctx) => {
					const reply = await this.invokeEvent(event, ctx);
					if (reply.event !== "before_agent_start") throw this.unexpectedEventReply(event.type, reply.event);
					return reply.result;
				});
				break;
			case "context":
				this.pi.on("context", async (event, ctx) => {
					const reply = await this.invokeEvent(event, ctx);
					if (reply.event !== "context") throw this.unexpectedEventReply(event.type, reply.event);
					return reply.result;
				});
				break;
			case "message_end":
				this.pi.on("message_end", async (event, ctx) => {
					const reply = await this.invokeEvent(event, ctx);
					if (reply.event !== "message_end") throw this.unexpectedEventReply(event.type, reply.event);
					return reply.result;
				});
				break;
			case "session_before_compact":
				this.pi.on("session_before_compact", async (event, ctx) => {
					const reply = await this.invokeEvent(event, ctx);
					if (reply.event !== "session_before_compact") throw this.unexpectedEventReply(event.type, reply.event);
					return reply.result;
				});
				break;
			case "session_before_switch":
				this.pi.on("session_before_switch", async (event, ctx) => {
					const reply = await this.invokeEvent(event, ctx);
					if (reply.event !== "session_before_switch") throw this.unexpectedEventReply(event.type, reply.event);
					return reply.result;
				});
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
				this.pi.on("tool_result", async (event, ctx) => {
					const reply = await this.invokeEvent(event, ctx);
					if (reply.event !== "tool_result") throw this.unexpectedEventReply(event.type, reply.event);
					return reply.result;
				});
		}
	}

	private registerTool(descriptor: MagicWorkerToolDescriptor): void {
		const parameters = Type.Object({}, { ...descriptor.parameters });
		const tool: ToolDefinition<typeof parameters, JsonInputValue | undefined> = {
			description: descriptor.description,
			label: descriptor.label,
			name: descriptor.name,
			parameters,
			execute: (toolCallId, args, signal, onUpdate, ctx) =>
				this.invokeTool(descriptor.name, toolCallId, parseJsonObject(JSON.stringify(args)), ctx, signal, onUpdate),
		};
		if (descriptor.constrainedSampling !== undefined) tool.constrainedSampling = descriptor.constrainedSampling;
		if (descriptor.executionMode !== undefined) tool.executionMode = descriptor.executionMode;
		if (descriptor.promptGuidelines !== undefined) tool.promptGuidelines = [...descriptor.promptGuidelines];
		if (descriptor.promptSnippet !== undefined) tool.promptSnippet = descriptor.promptSnippet;
		if (descriptor.renderShell !== undefined) tool.renderShell = descriptor.renderShell;
		this.pi.registerTool(tool);
	}

	private async invokeEvent(event: ExtensionEvent, ctx: ExtensionContext): Promise<MagicWorkerEventResult> {
		const snapshot = snapshotMagicWorkerEvent(event);
		const context = this.synchronizeSession(ctx, event.type === "session_start");
		const request: MagicWorkerEventRequest = {
			...snapshot.input,
			context,
			id: this.nextRequestId(),
		};
		try {
			const reply = await this.invoke(request, ctx, snapshot.signal ?? ctx.signal);
			if (reply.type !== "event-result") {
				throw new Error(`Magic Context worker returned '${reply.type}' for event '${event.type}'.`);
			}
			if (event.type === "message_end") this.refreshPersistedEntry(ctx, context.session.id);
			return reply.result;
		} finally {
			if (event.type === "session_before_switch" && context.session.id) {
				this.sessionLeaves.delete(context.session.id);
				if (this.contexts.get(context.session.id) === ctx) this.contexts.delete(context.session.id);
			}
		}
	}

	private async invokeVoidEvent(event: ExtensionEvent, ctx: ExtensionContext): Promise<void> {
		const reply = await this.invokeEvent(event, ctx);
		if (reply.event !== event.type) throw this.unexpectedEventReply(event.type, reply.event);
	}

	private unexpectedEventReply(expected: ExtensionEvent["type"], actual: MagicWorkerEventName): Error {
		return new Error(`Magic Context worker returned event '${actual}' for '${expected}'.`);
	}

	private async invokeCommand(name: MagicWorkerCommandName, args: string, ctx: ExtensionContext): Promise<void> {
		const reply = await this.invoke(
			{
				args,
				context: this.synchronizeSession(ctx, BRANCH_COMMANDS.has(name)),
				id: this.nextRequestId(),
				name,
				type: "command",
			},
			ctx,
			ctx.signal,
		);
		if (reply.type !== "command-result") {
			throw new Error(`Magic Context worker returned '${reply.type}' for command '${name}'.`);
		}
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
		const snapshot = snapshotMagicWorkerContext(ctx);
		const sessionId = snapshot.session.id;
		if (!sessionId) return snapshot;
		const leafId = snapshot.session.leafId;
		const previousLeafId = this.sessionLeaves.get(sessionId);
		if (!forceSnapshot && this.sessionLeaves.has(sessionId) && leafId === previousLeafId) return snapshot;
		if (!forceSnapshot && this.sessionLeaves.has(sessionId) && leafId) {
			const entry = requiredHostCall("Session leaf entry", () => ctx.sessionManager.getEntry(leafId));
			if (entry && (entry.parentId ?? undefined) === previousLeafId) {
				this.post({ entry, leafId, sessionId, type: "session-entry" });
				this.sessionLeaves.set(sessionId, leafId);
				return snapshot;
			}
		}
		const branch = requiredHostCall("Session branch", () => ctx.sessionManager.getBranch());
		this.post({ branch: [...branch], leafId, sessionId, type: "session-snapshot" });
		this.sessionLeaves.set(sessionId, leafId);
		return snapshot;
	}

	private async invokeTool(
		name: MagicWorkerToolName,
		toolCallId: string,
		args: JsonObject,
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<JsonInputValue | undefined> | undefined,
	): Promise<AgentToolResult<JsonInputValue | undefined>> {
		const reply = await this.invoke(
			{
				args,
				context: this.synchronizeSession(ctx),
				id: this.nextRequestId(),
				name,
				toolCallId,
				type: "tool",
			},
			ctx,
			signal,
			onUpdate,
		);
		if (reply.type !== "tool-result") {
			throw new Error(`Magic Context worker returned '${reply.type}' for Tool '${name}'.`);
		}
		return reply.result;
	}

	private async invoke(
		request: MagicWorkerInvocationRequest,
		ctx: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<JsonInputValue | undefined>,
	): Promise<MagicWorkerResultMessage> {
		if (this.closed) throw new Error("Magic Context worker is closed.");
		signal?.throwIfAborted();
		const session = request.context.session.id;
		const previousContext = session ? this.contexts.get(session) : undefined;
		if (session) this.contexts.set(session, ctx);
		const result = this.waitFor(request.id, onUpdate);
		let posted = false;
		const cancel = (): void => {
			if (!this.closed) this.post({ id: request.id, type: "cancel" });
		};
		if (!signal?.aborted) signal?.addEventListener("abort", cancel, { once: true });
		try {
			this.post(request);
			posted = true;
			if (signal?.aborted) cancel();
			const reply = await result;
			if (reply.type === "ready") {
				throw new Error("Magic Context worker returned an initialization reply for an invocation.");
			}
			return reply;
		} catch (cause) {
			this.takePending(request.id);
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
		onUpdate?: AgentToolUpdateCallback<JsonInputValue | undefined>,
	): Promise<MagicWorkerReadyMessage | MagicWorkerResultMessage> {
		this.worker?.ref();
		return new Promise((resolve, reject) => this.pending.set(id, { onUpdate, reject, resolve }));
	}

	private takePending(id: number): PendingRequest | undefined {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if (this.pending.size === 0) this.worker?.unref();
		return pending;
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
		this.takePending(message.id);
		if (message.type === "error") pending.reject(magicWorkerError(message));
		else pending.resolve(message);
	}

	private applyEffect(message: MagicWorkerEffectMessage): void {
		try {
			const ctx = message.sessionId ? this.contexts.get(message.sessionId) : undefined;
			if (message.sessionId && !ctx) {
				throw new Error(`Magic Context emitted '${message.name}' for an inactive Session.`);
			}
			switch (message.name) {
				case "appendEntry":
					this.pi.appendEntry(...message.args);
					if (ctx) this.synchronizeSession(ctx);
					break;
				case "notify":
					if (!ctx) throw new Error("Magic Context emitted a notification without a Host context.");
					ctx.ui.notify(...message.args);
					break;
				case "sendMessage":
					this.pi.sendMessage(...message.args);
					break;
				case "sendUserMessage":
					this.pi.sendUserMessage(...message.args);
					break;
				case "setStatus":
					if (!ctx) throw new Error("Magic Context emitted a status update without a Host context.");
					ctx.ui.setStatus(...message.args);
					break;
			}
		} catch (cause) {
			this.reportFatal(cause);
		}
	}

	private applySyncEffect(message: MagicWorkerSyncEffectMessage): void {
		let status: 1 | 2 = 2;
		let text: string;
		try {
			const ctx = message.sessionId ? this.contexts.get(message.sessionId) : undefined;
			if (!ctx) throw new Error("Pi Host context is no longer available for this Session.");
			const manager = ctx.sessionManager;
			if (!canAppendMagicWorkerCompaction(manager)) {
				throw new Error("Pi SessionManager does not expose appendCompaction.");
			}
			const entryId = manager.appendCompaction(...message.args);
			this.synchronizeSession(ctx);
			text = entryId;
			status = 1;
		} catch (cause) {
			text = magicWorkerErrorMessage(cause);
		}
		writeMagicWorkerSyncResponse(message.buffer, status, text);
	}

	private reportFatal(cause: unknown): void {
		const error = cause instanceof Error ? cause : new Error(magicWorkerErrorMessage(cause));
		void this.terminate(error);
		this.onFatal?.(error);
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
