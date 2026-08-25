import { AsyncLocalStorage } from "node:async_hooks";
import magicContextFactory from "@cortexkit/pi-magic-context";
import {
	type AgentToolResult,
	createEventBus,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type SessionEntry,
	type SessionManager,
	type SourceInfo,
	type ToolDefinition,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { parseJsonObject } from "../shared/json-value.js";
import { isRuntimeFunction, isRuntimeString } from "../shared/runtime-type.js";
import {
	MAGIC_WORKER_PROTOCOL_VERSION,
	MAGIC_WORKER_SYNC_BUFFER_BYTES,
	type MagicWorkerCommandRequest,
	type MagicWorkerContextSnapshot,
	type MagicWorkerEffectMessage,
	type MagicWorkerEvent,
	type MagicWorkerEventName,
	type MagicWorkerEventRequest,
	type MagicWorkerInitializeRequest,
	type MagicWorkerInvocationResult,
	type MagicWorkerMessage,
	type MagicWorkerRequest,
	type MagicWorkerSessionEntryRequest,
	type MagicWorkerSessionSnapshotRequest,
	type MagicWorkerSyncEffectMessage,
	type MagicWorkerToolRequest,
} from "./magic-worker-protocol.js";

type LooseHandler = (
	event: MagicWorkerEvent,
	ctx: ExtensionContext,
) => MagicWorkerInvocationResult | Promise<MagicWorkerInvocationResult>;
type LooseCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

type WorkerTool = Pick<
	ToolDefinition,
	| "constrainedSampling"
	| "description"
	| "executionMode"
	| "label"
	| "name"
	| "parameters"
	| "promptGuidelines"
	| "promptSnippet"
	| "renderShell"
> & {
	readonly execute: (
		request: MagicWorkerToolRequest,
		ctx: ExtensionContext,
		controller: AbortController,
	) => Promise<AgentToolResult<unknown>>;
};

const handlers = new Map<MagicWorkerEventName, LooseHandler[]>();
const tools = new Map<string, WorkerTool>();
const commands = new Map<string, LooseCommand>();
const flags = new Map<string, boolean | string>();
const controllers = new Map<number, AbortController>();
const cancelled = new Set<number>();
const effectSession = new AsyncLocalStorage<string | null>();
const sessions = new Map<
	string,
	{
		readonly entries: SessionEntry[];
		readonly entriesById: Map<string, SessionEntry>;
		readonly indexesById: Map<string, number>;
		leafId: string | undefined;
	}
>();
let activeTools: string[] = [];
let hostTools: ToolInfo[] = [];
let initialized = false;
const MAGIC_CONTEXT_SOURCE: SourceInfo = {
	origin: "package",
	path: "@cortexkit/pi-magic-context",
	scope: "temporary",
	source: "@cortexkit/pi-magic-context",
};
// SAFETY: Bun runs this entry as a dedicated Web Worker with the standard message globals.
const workerScope = globalThis as {
	onmessage: ((message: MessageEvent<MagicWorkerRequest>) => void) | null;
	postMessage(message: MagicWorkerMessage): void;
};

function send(message: MagicWorkerMessage): void {
	workerScope.postMessage(message);
}

function errorText<Cause>(cause: Cause): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function sendError(id: number, cause: unknown): void {
	send({
		error: errorText(cause),
		id,
		stack: cause instanceof Error ? cause.stack : undefined,
		type: "error",
	});
}

function sessionId(snapshot: MagicWorkerContextSnapshot | undefined): string | undefined {
	return snapshot?.session.id;
}

function entryId(entry: SessionEntry): string {
	return entry.id;
}

function workerEventName(name: string): MagicWorkerEventName {
	switch (name) {
		case "agent_end":
		case "before_agent_start":
		case "context":
		case "message_end":
		case "session_before_compact":
		case "session_before_switch":
		case "session_compact":
		case "session_shutdown":
		case "session_start":
		case "tool_execution_end":
		case "tool_execution_start":
		case "tool_result":
			return name;
		default:
			throw new Error(`Magic Context registered unsupported Pi event '${name}'.`);
	}
}

function replaceSession(snapshot: MagicWorkerSessionSnapshotRequest): void {
	const entries = [...snapshot.branch];
	const entriesById = new Map<string, SessionEntry>();
	const indexesById = new Map<string, number>();
	for (const [index, entry] of entries.entries()) {
		const id = entryId(entry);
		entriesById.set(id, entry);
		indexesById.set(id, index);
	}
	sessions.set(snapshot.sessionId, { entries, entriesById, indexesById, leafId: snapshot.leafId });
}

function updateSession(request: MagicWorkerSessionEntryRequest): void {
	const state = sessions.get(request.sessionId) ?? {
		entries: [],
		entriesById: new Map<string, SessionEntry>(),
		indexesById: new Map<string, number>(),
		leafId: undefined,
	};
	const id = entryId(request.entry);
	const index = state.indexesById.get(id);
	if (index === undefined) {
		state.indexesById.set(id, state.entries.length);
		state.entries.push(request.entry);
	} else {
		state.entries[index] = request.entry;
	}
	state.entriesById.set(id, request.entry);
	state.leafId = request.leafId;
	sessions.set(request.sessionId, state);
}

function sendEffect(message: MagicWorkerEffectMessage): void {
	const sessionId = effectSession.getStore();
	if (initialized && sessionId === undefined) return;
	if (sessionId) send({ ...message, sessionId });
	else send(message);
}

function syncHostCall(
	args: Parameters<SessionManager["appendCompaction"]>,
	snapshot: MagicWorkerContextSnapshot,
): string {
	const buffer = new SharedArrayBuffer(MAGIC_WORKER_SYNC_BUFFER_BYTES);
	const control = new Int32Array(buffer, 0, 2);
	const message: MagicWorkerSyncEffectMessage = {
		args,
		buffer,
		name: "appendCompaction",
		sessionId: sessionId(snapshot),
		type: "sync-effect",
	};
	send(message);
	const wait = Atomics.wait(control, 0, 0, 30_000);
	if (wait === "timed-out") {
		throw new Error("Pi Host did not complete Magic Context appendCompaction within 30 seconds.");
	}
	const capacity = buffer.byteLength - Int32Array.BYTES_PER_ELEMENT * 2;
	const length = Math.max(0, Math.min(Atomics.load(control, 1), capacity));
	const bytes = new Uint8Array(buffer, Int32Array.BYTES_PER_ELEMENT * 2, length);
	const response = new TextDecoder().decode(bytes);
	if (Atomics.load(control, 0) !== 1) {
		throw new Error(response || "Pi Host rejected Magic Context appendCompaction.");
	}
	return response;
}

function contextFor(snapshot: MagicWorkerContextSnapshot, controller: AbortController): ExtensionCommandContext {
	const currentSession = () => (snapshot.session.id ? sessions.get(snapshot.session.id) : undefined);
	const sessionManager: ExtensionContext["sessionManager"] & Pick<SessionManager, "appendCompaction"> = {
		appendCompaction: (...args: Parameters<SessionManager["appendCompaction"]>) => syncHostCall(args, snapshot),
		buildContextEntries: () => [...(currentSession()?.entries ?? [])],
		getBranch: () => currentSession()?.entries ?? [],
		getCwd: () => snapshot.cwd,
		getEntry: (id: string) => currentSession()?.entriesById.get(id),
		getEntries: () => [...(currentSession()?.entries ?? [])],
		getHeader: () => null,
		getLabel: () => undefined,
		getLeafEntry: () => {
			const current = currentSession();
			return current?.leafId ? current.entriesById.get(current.leafId) : undefined;
		},
		getLeafId: () => currentSession()?.leafId ?? snapshot.session.leafId ?? null,
		getSessionDir: () => "",
		getSessionFile: () => snapshot.session.file,
		getSessionId: () => snapshot.session.id ?? "",
		getSessionName: () => undefined,
		getTree: () => [],
	};
	const ui = new Proxy(
		{},
		{
			get: () => () => undefined,
		},
	);
	// SAFETY: Magic Context reads only the cloned model fields represented by MagicWorkerModel.
	const model = snapshot.model as ExtensionContext["model"];
	// SAFETY: Magic Context does not consult the registry inside the isolated Worker.
	const modelRegistry = {} as ExtensionContext["modelRegistry"];
	// SAFETY: UI calls are deliberately swallowed at the isolated engine boundary.
	const quietUi = ui as ExtensionContext["ui"];
	const context: ExtensionCommandContext = {
		abort: () => controller.abort(),
		compact: () => undefined,
		cwd: snapshot.cwd,
		fork: async () => {
			throw new Error("Magic Context cannot fork a Session from its isolated engine.");
		},
		getContextUsage: () => snapshot.contextUsage,
		getSystemPromptOptions: () => ({ cwd: snapshot.cwd }),
		getSystemPrompt: () => snapshot.systemPrompt,
		hasPendingMessages: () => snapshot.pendingMessages,
		hasUI: snapshot.hasUI,
		isIdle: () => snapshot.idle,
		isProjectTrusted: () => snapshot.projectTrusted,
		mode: snapshot.mode,
		model,
		modelRegistry,
		navigateTree: async () => {
			throw new Error("Magic Context cannot navigate the Session tree from its isolated engine.");
		},
		newSession: async () => {
			throw new Error("Magic Context cannot create a Session from its isolated engine.");
		},
		reload: async () => {
			throw new Error("Magic Context cannot reload Pi from its isolated engine.");
		},
		scopedModels: [],
		sessionManager,
		shutdown: () => undefined,
		signal: controller.signal,
		switchSession: async () => {
			throw new Error("Magic Context cannot switch Sessions from its isolated engine.");
		},
		ui: quietUi,
		waitForIdle: async () => undefined,
	};
	if (snapshot.thinkingLevel !== undefined) context.thinkingLevel = snapshot.thinkingLevel;
	return context;
}

function registerWorkerTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): void {
	const workerTool: WorkerTool = {
		description: tool.description,
		execute: async (request, ctx, controller) => {
			if (!Value.Check(Type.Unsafe(tool.parameters), request.args)) {
				throw new TypeError(`Magic Context tool '${tool.name}' received invalid arguments.`);
			}
			// SAFETY: TypeBox validated the request against this tool's own parameter schema immediately above.
			const params = request.args as Parameters<typeof tool.execute>[1];
			return tool.execute(
				request.toolCallId,
				params,
				controller.signal,
				(update) => send({ id: request.id, type: "tool-update", update }),
				ctx,
			);
		},
		label: tool.label,
		name: tool.name,
		parameters: tool.parameters,
	};
	if (tool.constrainedSampling !== undefined) workerTool.constrainedSampling = tool.constrainedSampling;
	if (tool.executionMode !== undefined) workerTool.executionMode = tool.executionMode;
	if (tool.promptGuidelines !== undefined) workerTool.promptGuidelines = [...tool.promptGuidelines];
	if (tool.promptSnippet !== undefined) workerTool.promptSnippet = tool.promptSnippet;
	if (tool.renderShell !== undefined) workerTool.renderShell = tool.renderShell;
	tools.set(tool.name, workerTool);
}

function workerToolInfo(tool: WorkerTool): ToolInfo {
	const info: ToolInfo = {
		description: tool.description,
		name: tool.name,
		parameters: tool.parameters,
		sourceInfo: MAGIC_CONTEXT_SOURCE,
	};
	if (tool.promptGuidelines !== undefined) info.promptGuidelines = [...tool.promptGuidelines];
	return info;
}

function workerPi(): ExtensionAPI {
	const noopOn: ExtensionAPI["on"] = () => undefined;
	const on = new Proxy(noopOn, {
		apply(_target, _thisArgument, args) {
			const name = args[0];
			const handler = args[1];
			if (!isRuntimeString(name) || !isRuntimeFunction(handler)) {
				throw new TypeError("Magic Context registered an invalid Pi event handler.");
			}
			const eventName = workerEventName(name);
			// SAFETY: ExtensionAPI.on supplied the handler for the validated event name immediately above.
			const workerHandler = handler as LooseHandler;
			const current = handlers.get(eventName);
			if (current) current.push(workerHandler);
			else handlers.set(eventName, [workerHandler]);
		},
	});
	const pi: ExtensionAPI = {
		appendEntry: <Data>(customType: string, data?: Data) =>
			sendEffect({ args: [customType, data], name: "appendEntry", type: "effect" }),
		events: createEventBus(),
		exec: async () => {
			throw new Error("Magic Context cannot execute Host shell commands from its isolated engine.");
		},
		getActiveTools: () => [...activeTools],
		getAllTools: () => [...hostTools, ...[...tools.values()].map(workerToolInfo)],
		getCommands: () =>
			[...commands.entries()].map(([name, command]) =>
				command.description
					? {
							description: command.description,
							name,
							source: "extension",
							sourceInfo: MAGIC_CONTEXT_SOURCE,
						}
					: { name, source: "extension", sourceInfo: MAGIC_CONTEXT_SOURCE },
			),
		getFlag: (name: string) => flags.get(name),
		getSessionName: () => undefined,
		getThinkingLevel: () => "off",
		on,
		registerCommand: (name: string, command: LooseCommand) => commands.set(name, command),
		registerEntryRenderer: () => undefined,
		registerFlag: (name: string, options: { readonly default?: boolean | string }) => {
			if (options.default !== undefined) flags.set(name, options.default);
		},
		registerMarkdownTransformer: () => undefined,
		registerMessageRenderer: () => undefined,
		registerProvider: () => undefined,
		registerShortcut: () => undefined,
		registerTool: registerWorkerTool,
		sendMessage: (message, options) => sendEffect({ args: [message, options], name: "sendMessage", type: "effect" }),
		sendUserMessage: (content, options) =>
			sendEffect({ args: [content, options], name: "sendUserMessage", type: "effect" }),
		setActiveTools: (names: string[]) => {
			activeTools = [...names];
			sendEffect({ args: [names], name: "setActiveTools", type: "effect" });
		},
		setLabel: () => undefined,
		setModel: async () => false,
		setSessionName: () => undefined,
		setThinkingLevel: () => undefined,
		unregisterProvider: () => undefined,
	};
	return pi;
}

async function initialize(request: MagicWorkerInitializeRequest): Promise<void> {
	if (initialized) throw new Error("Magic Context worker was initialized more than once.");
	if (request.protocolVersion !== MAGIC_WORKER_PROTOCOL_VERSION) {
		throw new Error(
			`Magic Context worker protocol ${String(request.protocolVersion)} does not match ${String(MAGIC_WORKER_PROTOCOL_VERSION)}.`,
		);
	}
	activeTools = [...request.activeTools];
	hostTools = request.hostTools.map((tool) => {
		const info: ToolInfo = {
			description: tool.description,
			name: tool.name,
			parameters: Type.Unsafe(tool.parameters),
			sourceInfo: tool.sourceInfo,
		};
		if (tool.promptGuidelines !== undefined) info.promptGuidelines = [...tool.promptGuidelines];
		return info;
	});
	await magicContextFactory(workerPi());
	initialized = true;
	send({
		commands: [...commands.entries()].map(([name, command]) => ({ name, description: command.description })),
		events: [...handlers.keys()],
		id: request.id,
		protocolVersion: MAGIC_WORKER_PROTOCOL_VERSION,
		tools: [...tools.values()].map((tool) => ({
			constrainedSampling: tool.constrainedSampling,
			description: tool.description,
			executionMode: tool.executionMode,
			label: tool.label,
			name: tool.name,
			parameters: parseJsonObject(JSON.stringify(tool.parameters)),
			promptGuidelines: tool.promptGuidelines,
			promptSnippet: tool.promptSnippet,
			renderShell: tool.renderShell,
		})),
		type: "ready",
	});
}

async function invokeEvent(
	request: MagicWorkerEventRequest,
	ctx: ExtensionContext,
): Promise<MagicWorkerInvocationResult> {
	let result: MagicWorkerInvocationResult;
	for (const handler of handlers.get(request.event.type) ?? []) {
		const next = await handler(request.event, ctx);
		if (next !== undefined) result = next;
	}
	if (result === undefined && request.event.type === "message_end") {
		return { message: request.event.message };
	}
	return result;
}

async function invokeCommand(
	request: MagicWorkerCommandRequest,
	ctx: ExtensionCommandContext,
): Promise<MagicWorkerInvocationResult> {
	const command = commands.get(request.name);
	if (!command) throw new Error(`Magic Context command '${request.name}' is not registered.`);
	await command.handler(request.args, ctx);
	return undefined;
}

async function invokeTool(request: MagicWorkerToolRequest, ctx: ExtensionContext, controller: AbortController) {
	const tool = tools.get(request.name);
	if (!tool) throw new Error(`Magic Context tool '${request.name}' is not registered.`);
	return tool.execute(request, ctx, controller);
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
			(request.event.type === "session_before_switch" || request.event.type === "session_shutdown") &&
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
		.catch((cause: unknown) => sendError(request.id, cause));
};
