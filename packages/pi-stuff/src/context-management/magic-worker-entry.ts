/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion -- This private structured-clone adapter must preserve Pi and Magic Context's open Extension payloads; the matching Host client is its only sender. */
import { AsyncLocalStorage } from "node:async_hooks";
// @ts-expect-error -- the pinned Magic Context package ships JavaScript without declarations.
import magicContextFactory from "@cortexkit/pi-magic-context";
import type { ExtensionAPI, ExtensionContext, ExtensionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	MAGIC_WORKER_PROTOCOL_VERSION,
	MAGIC_WORKER_SYNC_BUFFER_BYTES,
	type MagicWorkerCommandRequest,
	type MagicWorkerContextSnapshot,
	type MagicWorkerEffectMessage,
	type MagicWorkerEventRequest,
	type MagicWorkerHostTool,
	type MagicWorkerInitializeRequest,
	type MagicWorkerMessage,
	type MagicWorkerRequest,
	type MagicWorkerSessionEntryRequest,
	type MagicWorkerSessionSnapshotRequest,
	type MagicWorkerSyncEffectMessage,
	type MagicWorkerSyncEffectName,
	type MagicWorkerToolRequest,
} from "./magic-worker-protocol.js";

type LooseHandler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown | Promise<unknown>;
type LooseCommand = {
	readonly description?: string;
	readonly handler: (args: string, ctx: ExtensionContext) => unknown | Promise<unknown>;
};

const handlers = new Map<string, LooseHandler[]>();
const tools = new Map<string, ToolDefinition>();
const commands = new Map<string, LooseCommand>();
const flags = new Map<string, boolean | string>();
const controllers = new Map<number, AbortController>();
const cancelled = new Set<number>();
const effectSession = new AsyncLocalStorage<string | null>();
const sessions = new Map<
	string,
	{
		readonly entries: unknown[];
		readonly entriesById: Map<string, unknown>;
		readonly indexesById: Map<string, number>;
		leafId: string | undefined;
	}
>();
let activeTools: string[] = [];
let hostTools: MagicWorkerHostTool[] = [];
let initialized = false;
const workerScope = globalThis as unknown as {
	onmessage: ((message: MessageEvent<MagicWorkerRequest>) => void) | null;
	postMessage(message: MagicWorkerMessage): void;
};

function send(message: MagicWorkerMessage): void {
	workerScope.postMessage(message);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sendError(id: number, error: unknown): void {
	send({
		error: errorText(error),
		id,
		stack: error instanceof Error ? error.stack : undefined,
		type: "error",
	});
}

function jsonClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function sessionId(snapshot: MagicWorkerContextSnapshot | undefined): string | undefined {
	return snapshot?.session.id;
}

function entryId(entry: unknown): string | undefined {
	if (entry === null || typeof entry !== "object" || !("id" in entry)) return;
	const id = (entry as { readonly id?: unknown }).id;
	return typeof id === "string" ? id : undefined;
}

function replaceSession(snapshot: MagicWorkerSessionSnapshotRequest): void {
	const entries = [...snapshot.branch];
	const entriesById = new Map<string, unknown>();
	const indexesById = new Map<string, number>();
	for (const [index, entry] of entries.entries()) {
		const id = entryId(entry);
		if (!id) continue;
		entriesById.set(id, entry);
		indexesById.set(id, index);
	}
	sessions.set(snapshot.sessionId, { entries, entriesById, indexesById, leafId: snapshot.leafId });
}

function updateSession(request: MagicWorkerSessionEntryRequest): void {
	const state = sessions.get(request.sessionId) ?? {
		entries: [],
		entriesById: new Map<string, unknown>(),
		indexesById: new Map<string, number>(),
		leafId: undefined,
	};
	const id = entryId(request.entry);
	if (id) {
		const index = state.indexesById.get(id);
		if (index === undefined) {
			state.indexesById.set(id, state.entries.length);
			state.entries.push(request.entry);
		} else {
			state.entries[index] = request.entry;
		}
		state.entriesById.set(id, request.entry);
	}
	state.leafId = request.leafId;
	sessions.set(request.sessionId, state);
}

function sendEffect(name: MagicWorkerEffectMessage["name"], args: readonly unknown[]): void {
	const sessionId = effectSession.getStore();
	if (initialized && sessionId === undefined) return;
	send({ args, name, sessionId: sessionId ?? undefined, type: "effect" });
}

function syncHostCall(
	name: MagicWorkerSyncEffectName,
	args: readonly unknown[],
	snapshot: MagicWorkerContextSnapshot,
): unknown {
	const buffer = new SharedArrayBuffer(MAGIC_WORKER_SYNC_BUFFER_BYTES);
	const control = new Int32Array(buffer, 0, 2);
	const message: MagicWorkerSyncEffectMessage = {
		args,
		buffer,
		name,
		sessionId: sessionId(snapshot),
		type: "sync-effect",
	};
	send(message);
	const wait = Atomics.wait(control, 0, 0, 30_000);
	if (wait === "timed-out") throw new Error(`Pi Host did not complete Magic Context ${name} within 30 seconds.`);
	const length = Atomics.load(control, 1);
	const bytes = new Uint8Array(buffer, Int32Array.BYTES_PER_ELEMENT * 2, length);
	const payload = JSON.parse(new TextDecoder().decode(bytes)) as { readonly error?: string; readonly value?: unknown };
	if (Atomics.load(control, 0) !== 1) throw new Error(payload.error ?? `Pi Host rejected Magic Context ${name}.`);
	return payload.value;
}

function contextFor(snapshot: MagicWorkerContextSnapshot, controller: AbortController): ExtensionContext {
	const currentSession = () => (snapshot.session.id ? sessions.get(snapshot.session.id) : undefined);
	const sessionManager = {
		appendCompaction: (...args: readonly unknown[]) => syncHostCall("appendCompaction", args, snapshot),
		getBranch: () => currentSession()?.entries ?? [],
		getEntry: (id: string) => currentSession()?.entriesById.get(id),
		getLeafId: () => currentSession()?.leafId ?? snapshot.session.leafId,
		getSessionFile: () => snapshot.session.file,
		getSessionId: () => snapshot.session.id,
	};
	const ui = new Proxy(
		{},
		{
			get: () => () => undefined,
		},
	);
	return {
		abort: () => controller.abort(),
		compact: () => undefined,
		cwd: snapshot.cwd,
		getContextUsage: () => snapshot.contextUsage,
		getSystemPrompt: () => snapshot.systemPrompt,
		hasPendingMessages: () => snapshot.pendingMessages,
		hasUI: snapshot.hasUI,
		isIdle: () => snapshot.idle,
		isProjectTrusted: () => snapshot.projectTrusted,
		mode: snapshot.mode,
		model: snapshot.model as ExtensionContext["model"],
		modelRegistry: {} as ExtensionContext["modelRegistry"],
		scopedModels: [],
		sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"],
		shutdown: () => undefined,
		signal: controller.signal,
		...(snapshot.thinkingLevel
			? { thinkingLevel: snapshot.thinkingLevel as NonNullable<ExtensionContext["thinkingLevel"]> }
			: {}),
		ui: ui as ExtensionContext["ui"],
	};
}

function workerPi(): ExtensionAPI {
	const pi = {
		appendEntry: (customType: string, data?: unknown) => sendEffect("appendEntry", [customType, data]),
		events: {
			emit: () => undefined,
			on: () => () => undefined,
		},
		exec: async () => {
			throw new Error("Magic Context cannot execute Host shell commands from its isolated engine.");
		},
		getActiveTools: () => [...activeTools],
		getAllTools: () => [
			...hostTools,
			...[...tools.values()].map((tool) => ({
				description: tool.description,
				name: tool.name,
				parameters: tool.parameters,
				promptGuidelines: tool.promptGuidelines,
				sourceInfo: { path: "@cortexkit/pi-magic-context" },
			})),
		],
		getCommands: () => [...commands.entries()].map(([name, command]) => ({ name, description: command.description })),
		getFlag: (name: string) => flags.get(name),
		getSessionName: () => undefined,
		getThinkingLevel: () => "off",
		on: (name: string, handler: LooseHandler) => {
			const current = handlers.get(name);
			if (current) current.push(handler);
			else handlers.set(name, [handler]);
		},
		registerCommand: (name: string, command: LooseCommand) => commands.set(name, command),
		registerEntryRenderer: () => undefined,
		registerFlag: (name: string, options: { readonly default?: boolean | string }) => {
			if (options.default !== undefined) flags.set(name, options.default);
		},
		registerMarkdownTransformer: () => undefined,
		registerMessageRenderer: () => undefined,
		registerProvider: () => undefined,
		registerShortcut: () => undefined,
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		sendMessage: (message: unknown, options?: unknown) => sendEffect("sendMessage", [message, options]),
		sendUserMessage: (content: unknown, options?: unknown) => sendEffect("sendUserMessage", [content, options]),
		setActiveTools: (names: string[]) => {
			activeTools = [...names];
			sendEffect("setActiveTools", [names]);
		},
		setLabel: () => undefined,
		setModel: async () => false,
		setSessionName: () => undefined,
		setThinkingLevel: () => undefined,
		unregisterProvider: () => undefined,
	};
	return pi as unknown as ExtensionAPI;
}

async function initialize(request: MagicWorkerInitializeRequest): Promise<void> {
	if (initialized) throw new Error("Magic Context worker was initialized more than once.");
	if (request.protocolVersion !== MAGIC_WORKER_PROTOCOL_VERSION) {
		throw new Error(
			`Magic Context worker protocol ${String(request.protocolVersion)} does not match ${String(MAGIC_WORKER_PROTOCOL_VERSION)}.`,
		);
	}
	activeTools = [...request.activeTools];
	hostTools = [...request.hostTools];
	await magicContextFactory(workerPi());
	initialized = true;
	send({
		commands: [...commands.entries()].map(([name, command]) => ({ name, description: command.description })),
		events: [...handlers.keys()],
		id: request.id,
		protocolVersion: MAGIC_WORKER_PROTOCOL_VERSION,
		tools: [...tools.values()].map((tool) =>
			jsonClone({
				constrainedSampling: tool.constrainedSampling,
				description: tool.description,
				executionMode: tool.executionMode,
				label: tool.label,
				name: tool.name,
				parameters: tool.parameters,
				promptGuidelines: tool.promptGuidelines,
				promptSnippet: tool.promptSnippet,
				renderShell: tool.renderShell,
			}),
		),
		type: "ready",
	});
}

async function invokeEvent(request: MagicWorkerEventRequest, ctx: ExtensionContext): Promise<unknown> {
	let result: unknown;
	for (const handler of handlers.get(request.name) ?? []) {
		const next = await handler(request.event as ExtensionEvent, ctx);
		if (next !== undefined) result = next;
	}
	if (result === undefined && request.name === "message_end" && "message" in request.event) {
		return { message: request.event.message };
	}
	return result;
}

async function invokeCommand(request: MagicWorkerCommandRequest, ctx: ExtensionContext): Promise<unknown> {
	const command = commands.get(request.name);
	if (!command) throw new Error(`Magic Context command '${request.name}' is not registered.`);
	return command.handler(request.args, ctx);
}

async function invokeTool(request: MagicWorkerToolRequest, ctx: ExtensionContext, controller: AbortController) {
	const tool = tools.get(request.name);
	if (!tool) throw new Error(`Magic Context tool '${request.name}' is not registered.`);
	return tool.execute(
		request.toolCallId,
		request.args as never,
		controller.signal,
		(update) => send({ id: request.id, type: "tool-update", update }),
		ctx,
	);
}

async function invoke(
	request: MagicWorkerCommandRequest | MagicWorkerEventRequest | MagicWorkerToolRequest,
): Promise<void> {
	if (!initialized) throw new Error("Magic Context worker received work before initialization.");
	const controller = new AbortController();
	controllers.set(request.id, controller);
	if (cancelled.delete(request.id)) controller.abort();
	try {
		const result = await effectSession.run(request.context.session.id ?? null, async () => {
			const ctx = contextFor(request.context, controller);
			return request.type === "event"
				? invokeEvent(request, ctx)
				: request.type === "command"
					? invokeCommand(request, ctx)
					: invokeTool(request, ctx, controller);
		});
		send({ id: request.id, result, type: "result" });
	} finally {
		controllers.delete(request.id);
		if (
			request.type === "event" &&
			(request.name === "session_before_switch" || request.name === "session_shutdown") &&
			request.context.session.id
		) {
			sessions.delete(request.context.session.id);
		}
	}
}

let queue = Promise.resolve();

workerScope.onmessage = (message: MessageEvent<MagicWorkerRequest>): void => {
	const request = message.data;
	if (request.type === "cancel") {
		const controller = controllers.get(request.id);
		if (controller) controller.abort();
		else cancelled.add(request.id);
		return;
	}
	if (request.type === "session-entry" || request.type === "session-snapshot") {
		queue = queue.then(() => {
			if (request.type === "session-entry") updateSession(request);
			else replaceSession(request);
		});
		return;
	}
	queue = queue
		.then(async () => {
			if (request.type === "initialize") await initialize(request);
			else await invoke(request);
		})
		.catch((error: unknown) => sendError(request.id, error));
};
