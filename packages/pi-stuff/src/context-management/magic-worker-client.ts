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
import {
	MAGIC_WORKER_PROTOCOL_VERSION,
	type MagicWorkerContextSnapshot,
	type MagicWorkerEffectMessage,
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
	readonly default: (pi: ExtensionAPI) => Promise<void> | void;
}

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

function snapshotContext(ctx: ExtensionContext, includeBranch = false): MagicWorkerContextSnapshot {
	const manager = ctx.sessionManager;
	const branch = includeBranch ? requiredCall("Session branch", () => manager.getBranch()) : [];
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
			branch: includeBranch ? [...branch] : undefined,
			file: optionalCall(() => manager.getSessionFile()) ?? undefined,
			id: optionalCall(() => manager.getSessionId()),
			leafId: optionalCall(() => manager.getLeafId()) ?? undefined,
		},
		systemPrompt: optionalCall(() => ctx.getSystemPrompt()) ?? "",
		thinkingLevel: ctx.thinkingLevel,
	};
}

function snapshotEvent(event: ExtensionEvent): { readonly event: ExtensionEvent; readonly signal?: AbortSignal } {
	if (!("signal" in event)) return { event };
	const { signal, ...snapshot } = event;
	return {
		event: snapshot as ExtensionEvent,
		...(signal instanceof AbortSignal ? { signal } : {}),
	};
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
	private readonly pending = new Map<number, PendingRequest>();
	private readonly pi: ExtensionAPI;
	private worker: Worker | undefined;
	private workerUrl: string | undefined;
	private closed = false;
	private termination: Promise<void> | undefined;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
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
			void this.terminate(new Error(event.message || "Magic Context worker crashed."));
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
			const handler: LooseEventHandler = async (event, ctx) => {
				try {
					return await this.invokeEvent(name, event, ctx);
				} finally {
					if (name === "session_shutdown") await this.close();
				}
			};
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
		const snapshot = snapshotEvent(event);
		const includeBranch =
			name === "context" || (name === "session_start" && "reason" in event && event.reason === "fork");
		const result = await this.invoke(
			{ context: snapshotContext(ctx, includeBranch), event: snapshot.event, name, type: "event" },
			ctx,
			snapshot.signal ?? ctx.signal,
		);
		if (name === "message_end") this.refreshPersistedEntry(ctx);
		return result;
	}

	private invokeCommand(name: string, args: string, ctx: ExtensionContext): Promise<unknown> {
		return this.invoke(
			{ args, context: snapshotContext(ctx, BRANCH_COMMANDS.has(name)), name, type: "command" },
			ctx,
			ctx.signal,
		);
	}

	private refreshPersistedEntry(ctx: ExtensionContext): void {
		setImmediate(() => {
			if (this.closed) return;
			try {
				const manager = ctx.sessionManager;
				const sessionId = manager.getSessionId();
				const leafId = manager.getLeafId();
				if (!sessionId || !leafId) return;
				const entry = manager.getEntry(leafId);
				if (!entry) return;
				this.post({ entry, leafId, sessionId, type: "session-entry" });
			} catch {
				// Pi may switch or close the Session before this post-persistence refresh runs.
			}
		});
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
			{ args, context: snapshotContext(ctx), name, toolCallId, type: "tool" },
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
			switch (message.name) {
				case "appendEntry":
					this.pi.appendEntry(message.args[0] as string, message.args[1]);
					break;
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
		return this.termination;
	}

	async close(): Promise<void> {
		await this.terminate(new Error("Magic Context worker closed."));
	}
}

export async function magicContextWorkerFactory(pi: ExtensionAPI): Promise<void> {
	const client = new MagicWorkerClient(pi);
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
