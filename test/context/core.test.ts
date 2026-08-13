import { afterEach, describe, expect, test } from "bun:test";
import {
	createExtensionRuntime,
	createSyntheticSourceInfo,
	type Extension,
	type ExtensionAPI,
	type ExtensionContext,
	ExtensionRunner,
	type SessionEntry,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import piStuffContext, {
	__test,
	CONTEXT_COMPACTION_BYPASSED_EVENT,
	getContextCapability,
	projectCurrentContext,
} from "../../packages/pi-stuff/src/context-management/index.js";
import {
	hasDirectUserActivation,
	isSuiteNativeCompactionPreflight,
	sendSuiteAgentMessage,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "../../packages/pi-stuff/src/conversation-ui/index.js";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Handlers = Map<string, Handler[]>;
const UI_RENDER_REQUEST_EVENT = "@jczhang02/pi-stuff-ui/render-request/v1";

interface HostRegistrations {
	commands: string[];
	commandDefinitions?: Map<string, { readonly handler?: (args: string, ctx: ExtensionContext) => unknown }>;
	entryRenderers: string[];
}

function apiFor(
	handlers: Handlers,
	tools: ToolDefinition[] = [],
	registrations: HostRegistrations = { commands: [], entryRenderers: [] },
): ExtensionAPI {
	let activeTools: string[] = [];
	const eventBus = new Map<string, Array<(value: unknown) => void>>();
	return {
		events: {
			emit(name: string, value: unknown): void {
				for (const listener of eventBus.get(name) ?? []) listener(value);
			},
			on(name: string, listener: (value: unknown) => void): () => void {
				const listeners = eventBus.get(name) ?? [];
				listeners.push(listener);
				eventBus.set(name, listeners);
				return () => {
					const current = eventBus.get(name);
					const index = current?.indexOf(listener) ?? -1;
					if (index >= 0) current?.splice(index, 1);
				};
			},
		},
		on(event: string, handler: Handler): void {
			const current = handlers.get(event) ?? [];
			current.push(handler);
			handlers.set(event, current);
		},
		registerTool(tool: ToolDefinition): void {
			const existing = tools.findIndex((candidate) => candidate.name === tool.name);
			if (existing < 0) {
				tools.push(tool);
				if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
			} else tools[existing] = tool;
		},
		registerCommand(
			name: string,
			definition: { readonly handler?: (args: string, ctx: ExtensionContext) => unknown },
		): void {
			if (!registrations.commands.includes(name)) registrations.commands.push(name);
			registrations.commandDefinitions?.set(name, definition);
		},
		registerEntryRenderer(name: string): void {
			if (!registrations.entryRenderers.includes(name)) registrations.entryRenderers.push(name);
		},
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]): void {
			activeTools = [...names];
		},
	} as unknown as ExtensionAPI;
}

function context(
	entries: readonly SessionEntry[] = [],
	cwd = "/workspace/project-a",
	sessionId = "session-a",
): ExtensionContext {
	return {
		cwd,
		sessionManager: {
			buildContextEntries: () => [...entries],
			getSessionId: () => sessionId,
			getSessionFile: () => `/sessions/${sessionId}.jsonl`,
		},
	} as unknown as ExtensionContext;
}

async function emit(handlers: Handlers, name: string, event: unknown, ctx = context()): Promise<void> {
	for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
}

async function emitUntilHandled(handlers: Handlers, name: string, event: unknown, ctx = context()): Promise<void> {
	for (const handler of handlers.get(name) ?? []) {
		const result = await handler(event, ctx);
		if (result && typeof result === "object" && Reflect.get(result, "action") === "handled") return;
	}
}

async function emitResults(handlers: Handlers, name: string, event: unknown, ctx = context()): Promise<unknown[]> {
	const results: unknown[] = [];
	for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx));
	return results;
}

function taggedMessage(text: string) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp: 1,
	};
}

function magicModule(options: { registerBeforeStart?: () => void; registerTool?: boolean } = {}) {
	return {
		default: async (pi: ExtensionAPI) => {
			const register = pi.on.bind(pi) as unknown as (event: string, handler: Handler) => void;
			register("context", (event) => {
				const contextEvent = event as { messages: unknown[] };
				return {
					messages: [
						taggedMessage(
							"<session-history><project-memory><PROJECT_RULES>#1: remember me</PROJECT_RULES></project-memory>older turn</session-history>",
						),
						taggedMessage(
							'<session-history-since><memory-updates><updated id="1">remember me, updated</updated></memory-updates><new-memories><PROJECT_RULES>#2: new memory</PROJECT_RULES></new-memories>newer turn</session-history-since>',
						),
						...contextEvent.messages,
					],
				};
			});
			if (options.registerBeforeStart) {
				register("before_agent_start", () => options.registerBeforeStart?.());
			}
			if (options.registerTool) {
				pi.registerTool({
					name: "ctx_search",
					label: "ctx_search",
					description: "Search Context",
					parameters: Type.Object({ query: Type.String() }),
					execute: async () => ({ content: [{ type: "text", text: "result" }], details: undefined }),
				});
			}
		},
	};
}

afterEach(() => __test.clear());

describe("Context capability lifecycle", () => {
	test("precompacts a near-limit native fallback before an idle Suite custom turn", async () => {
		const handlers: Handlers = new Map();
		const api = apiFor(handlers);
		const order: string[] = [];
		Reflect.set(api, "sendMessage", () => order.push("send"));
		const ctx = context();
		Object.assign(ctx, {
			compact: (options: { onComplete?: (result: unknown) => void }) => {
				expect(isSuiteNativeCompactionPreflight(ctx)).toBe(true);
				order.push("compact");
				options.onComplete?.({});
			},
			getContextUsage: () => ({ contextWindow: 100, percent: 90, tokens: 90 }),
			isIdle: () => true,
		});
		await piStuffContext(api, {
			loadMagicContext: async () => magicModule(),
			prepareMagicContext: async () => "deferred",
			readNativeCompactionSettings: () => ({ enabled: true, reserveTokens: 20 }),
		});
		await emit(handlers, "session_start", { reason: "startup", type: "session_start" }, ctx);

		await sendSuiteAgentMessage(
			api,
			{ content: "continue", customType: "suite-test", display: false },
			{ triggerTurn: true },
		);

		expect(order).toEqual(["compact", "send"]);
		expect(isSuiteNativeCompactionPreflight(ctx)).toBe(false);
	});

	test("respects disabled native compaction for an idle Suite custom turn", async () => {
		const handlers: Handlers = new Map();
		const api = apiFor(handlers);
		const order: string[] = [];
		Reflect.set(api, "sendMessage", () => order.push("send"));
		const ctx = context();
		Object.assign(ctx, {
			compact: () => order.push("compact"),
			getContextUsage: () => ({ contextWindow: 100, percent: 90, tokens: 90 }),
			isIdle: () => true,
		});
		await piStuffContext(api, {
			loadMagicContext: async () => magicModule(),
			prepareMagicContext: async () => "deferred",
			readNativeCompactionSettings: () => ({ enabled: false, reserveTokens: 20 }),
		});
		await emit(handlers, "session_start", { reason: "startup", type: "session_start" }, ctx);

		await sendSuiteAgentMessage(
			api,
			{ content: "continue", customType: "suite-test", display: false },
			{ triggerTurn: true },
		);

		expect(order).toEqual(["send"]);
	});

	test("finishes Magic Context activation during session startup", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const api = apiFor(handlers, tools);
		let loads = 0;
		let factories = 0;
		await piStuffContext(api, {
			loadMagicContext: async () => {
				loads++;
				return {
					default: async (magicApi: ExtensionAPI) => {
						factories++;
						magicApi.on("context", (event) => event);
					},
				};
			},
			prepareMagicContext: async () => "ready",
		});
		const ctx = context();

		expect(loads).toBe(0);
		expect(factories).toBe(0);
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(loads).toBe(1);
		expect(factories).toBe(1);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "active",
			engine: "magic-context",
			trigger: "startup",
		});
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"ctx_expand",
			"ctx_memory",
			"ctx_note",
			"ctx_reduce",
			"ctx_search",
		]);
		expect(api.getActiveTools()).toEqual([]);

		await emit(handlers, "input", { type: "input", text: "first", source: "interactive" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(loads).toBe(1);
		expect(factories).toBe(1);
	});

	test("does not bootstrap Magic Context from an Extension-authored automatic turn", async () => {
		const handlers: Handlers = new Map();
		let factories = 0;
		const preparations: boolean[] = [];
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					factories++;
					magicApi.on("context", (event) => event);
				},
			}),
			prepareMagicContext: async (_ctx, options) => {
				preparations.push(options.allowConfigurationMutation);
				return options.allowConfigurationMutation ? "ready" : "deferred";
			},
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		await emit(
			handlers,
			"input",
			{ type: "input", text: "automatic continuation", source: "extension", streamingBehavior: "followUp" },
			ctx,
		);
		expect(preparations).toEqual([false]);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(preparations).toEqual([false, false]);
		expect(factories).toBe(0);
		expect(getContextCapability(ctx).status()).toEqual({ state: "dormant", engine: "native" });

		await emit(handlers, "input", { type: "input", text: "direct request", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(preparations).toEqual([false, false, true]);
		expect(factories).toBe(1);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "active",
			engine: "magic-context",
			trigger: "input",
		});
	});

	test("historical user attribution cannot authorize first-use Context mutation", async () => {
		const handlers: Handlers = new Map();
		const preparations: boolean[] = [];
		let factories = 0;
		let delivered: object | undefined;
		const api = apiFor(handlers);
		Reflect.set(api, "sendMessage", (message: object) => {
			delivered = message;
		});
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					factories++;
					magicApi.on("context", (event) => event);
				},
			}),
			prepareMagicContext: async (_ctx, options) => {
				preparations.push(options.allowConfigurationMutation);
				return options.allowConfigurationMutation ? "ready" : "deferred";
			},
		});
		let idle = true;
		const ctx = context();
		Object.assign(ctx, { isIdle: () => idle });
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const backgroundCompletion = withAgentWorkOrigin(
			{ content: "background complete", customType: "background-result", display: true },
			"user",
		);
		expect(hasDirectUserActivation(backgroundCompletion)).toBe(false);
		await sendSuiteAgentMessage(api, backgroundCompletion, { triggerTurn: true });
		idle = false;
		await emit(handlers, "message_start", { message: { role: "custom", ...delivered } }, ctx);

		expect(preparations).toEqual([false, false, false]);
		expect(factories).toBe(0);
		expect(getContextCapability(ctx).status()).toEqual({ state: "dormant", engine: "native" });

		idle = true;
		await sendSuiteAgentMessage(
			api,
			withDirectUserActivation(
				withAgentWorkOrigin({ content: "explicit command", customType: "command-result", display: true }, "user"),
			),
			{ triggerTurn: true },
		);
		expect(preparations).toEqual([false, false, false, true]);
		expect(factories).toBe(1);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "active",
			engine: "magic-context",
			trigger: "input",
		});
	});

	test("does not bootstrap Magic Context when a later Extension handles automatic input", async () => {
		const handlers: Handlers = new Map();
		let factories = 0;
		let preparations = 0;
		const api = apiFor(handlers);
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async () => {
					factories++;
				},
			}),
			prepareMagicContext: async (_ctx, options) => {
				preparations++;
				return options.allowConfigurationMutation ? "ready" : "deferred";
			},
		});
		(api.on as unknown as (event: string, handler: Handler) => void)("input", () => ({ action: "handled" }));
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		await emitUntilHandled(
			handlers,
			"input",
			{ type: "input", text: "display-only automatic message", source: "extension" },
			ctx,
		);

		expect(preparations).toBe(1);
		expect(factories).toBe(0);
		expect(getContextCapability(ctx).status()).toEqual({ state: "dormant", engine: "native" });
	});

	test("retries a deferred automatic activation when direct input arrives concurrently", async () => {
		const handlers: Handlers = new Map();
		const preparations: boolean[] = [];
		let factories = 0;
		let releaseAutomatic: (() => void) | undefined;
		let markAutomaticEntered: (() => void) | undefined;
		const automaticGate = new Promise<void>((resolve) => {
			releaseAutomatic = resolve;
		});
		const automaticEntered = new Promise<void>((resolve) => {
			markAutomaticEntered = resolve;
		});
		let mutationFreeAttempts = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					factories++;
					magicApi.on("context", (event) => event);
				},
			}),
			prepareMagicContext: async (_ctx, options) => {
				preparations.push(options.allowConfigurationMutation);
				if (!options.allowConfigurationMutation) {
					mutationFreeAttempts++;
					if (mutationFreeAttempts > 1) {
						markAutomaticEntered?.();
						await automaticGate;
					}
					return "deferred";
				}
				return "ready";
			},
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const automatic = emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		await automaticEntered;
		const direct = emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		releaseAutomatic?.();
		await Promise.all([automatic, direct]);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

		expect(preparations).toEqual([false, false, true]);
		expect(factories).toBe(1);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "active",
			engine: "magic-context",
			trigger: "input",
		});
	});

	test("never delays interactive input or Context transforms for synthetic UI frames", async () => {
		const handlers: Handlers = new Map();
		const sequence: string[] = [];
		const api = apiFor(handlers);
		api.events.on(UI_RENDER_REQUEST_EVENT, (value) => {
			(value as { handled: boolean }).handled = true;
			sequence.push("paint");
		});
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					sequence.push("activate");
					magicApi.on("context", (event) => {
						sequence.push("transform");
						return event;
					});
				},
			}),
			prepareMagicContext: async () => {
				sequence.push("prepare");
				return "ready";
			},
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		await emit(handlers, "input", { type: "input", text: "first", source: "interactive" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		await emit(handlers, "context", { type: "context", messages: [taggedMessage("first")] }, ctx);
		await emit(handlers, "context", { type: "context", messages: [taggedMessage("tool result")] }, ctx);
		expect(sequence).toEqual(["prepare", "activate", "transform", "transform"]);

		sequence.length = 0;
		await emit(handlers, "input", { type: "input", text: "rpc", source: "rpc" }, ctx);
		await emit(handlers, "context", { type: "context", messages: [taggedMessage("rpc")] }, ctx);
		expect(sequence).toEqual(["transform"]);
	});

	test("fails open and retries when Magic session startup throws", async () => {
		const handlers: Handlers = new Map();
		let loads = 0;
		let starts = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					loads++;
					magicApi.on("context", (event) => event);
					magicApi.on("session_start", () => {
						starts++;
						if (starts === 1) throw new Error("startup failed");
					});
				},
			}),
		});
		const ctx = context();

		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(loads).toBe(1);
		expect(starts).toBe(1);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "degraded",
			engine: "native",
			trigger: "startup",
			error: "startup failed",
		});

		await emit(handlers, "input", { type: "input", text: "retry", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(loads).toBe(2);
		expect(starts).toBe(2);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "active",
			engine: "magic-context",
			trigger: "input",
		});
	});

	test("fails open during startup and retries on the next activation", async () => {
		const handlers: Handlers = new Map();
		let loads = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => {
				loads++;
				return loads === 1 ? { default: async () => undefined } : magicModule();
			},
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(getContextCapability(ctx).status().state).toBe("degraded");

		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(loads).toBe(2);
		expect(getContextCapability(ctx).status().state).toBe("active");
	});

	test("discards partial Magic registrations before a retry", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const registrations: HostRegistrations = { commands: [], entryRenderers: [] };
		const api = apiFor(handlers, tools, registrations);
		let loads = 0;
		let staleMessageEnds = 0;
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					loads++;
					magicApi.on("context", (event) => event);
					magicApi.on("message_end", () => {
						staleMessageEnds++;
					});
					magicApi.registerCommand("ctx-partial", { handler: async () => undefined });
					magicApi.registerEntryRenderer("ctx-partial", () => undefined);
					magicApi.registerTool({
						name: "ctx_search",
						label: "Magic search",
						description: "Committed Magic search",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
					});
					if (loads === 1) throw new Error("partial factory failure");
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(handlers.get("context")).toBeUndefined();
		expect(handlers.get("message_end")).toBeUndefined();
		expect(registrations).toEqual({ commands: [], entryRenderers: [] });
		expect(tools.find((tool) => tool.name === "ctx_search")?.description).toContain("provider boundary");

		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		await emit(handlers, "message_end", { type: "message_end" }, ctx);
		expect(handlers.get("context")).toHaveLength(1);
		expect(handlers.get("message_end")).toHaveLength(1);
		expect(registrations).toEqual({ commands: [], entryRenderers: [] });
		expect(tools.find((tool) => tool.name === "ctx_search")?.description).toBe("Committed Magic search");
		expect(staleMessageEnds).toBe(1);
	});

	test("delivers the observed session start exactly once during startup activation", async () => {
		const handlers: Handlers = new Map();
		let starts = 0;
		let reason: unknown;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => event);
					magicApi.on("session_start", (event) => {
						starts++;
						reason = (event as { readonly reason?: unknown }).reason;
					});
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "resume" }, ctx);

		expect(starts).toBe(1);
		expect(reason).toBe("resume");
	});

	test("keeps only focused diagnostics and suppresses Magic's duplicate UI surfaces", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const commandDefinitions = new Map<
			string,
			{ readonly handler?: (args: string, ctx: ExtensionContext) => unknown }
		>();
		const registrations: HostRegistrations = { commands: [], commandDefinitions, entryRenderers: [] };
		const uiCalls: string[] = [];
		let statusHasUi: unknown;
		piStuffContext(apiFor(handlers, tools, registrations), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => event);
					magicApi.on("session_start", (_event, ctx) => {
						ctx.ui.setStatus("magic", "duplicate");
						ctx.ui.setWidget("magic", ["duplicate"]);
						ctx.ui.notify("announcement");
					});
					magicApi.on("before_agent_start", (_event, ctx) => {
						ctx.ui.setFooter(() => ({ render: () => [] }) as never);
						ctx.ui.setHeader(() => ({ render: () => [] }) as never);
					});
					for (const name of [
						"ctx-status",
						"ctx-flush",
						"ctx-recomp",
						"ctx-wrapup",
						"ctx-session-upgrade",
						"ctx-aug",
						"ctx-dream",
					]) {
						magicApi.registerCommand(name, {
							handler: async (_args, ctx) => {
								if (name === "ctx-status") {
									statusHasUi = ctx.hasUI;
									ctx.ui.setStatus("magic", "duplicate");
									ctx.ui.notify("diagnostic");
								}
							},
						});
					}
					magicApi.registerEntryRenderer("ctx-status", () => undefined);
					magicApi.registerEntryRenderer("ctx-aug", () => undefined);
					magicApi.registerTool({
						name: "todowrite",
						label: "TodoWrite",
						description: "duplicate todo",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "duplicate" }], details: undefined }),
					});
				},
			}),
		});
		const ctx = {
			...context(),
			hasUI: true,
			ui: {
				notify: (message: string) => uiCalls.push(`notify:${message}`),
				setFooter: () => uiCalls.push("footer"),
				setHeader: () => uiCalls.push("header"),
				setStatus: () => uiCalls.push("status"),
				setWidget: () => uiCalls.push("widget"),
			},
		} as unknown as ExtensionContext;

		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

		expect(uiCalls).toEqual([]);
		expect(registrations.commands).toEqual([
			"ctx-status",
			"ctx-flush",
			"ctx-recomp",
			"ctx-wrapup",
			"ctx-session-upgrade",
		]);
		expect(registrations.entryRenderers).toEqual(["ctx-status"]);
		expect(tools.some((tool) => tool.name === "todowrite")).toBeFalse();

		await commandDefinitions.get("ctx-status")?.handler?.("", ctx);
		expect(statusHasUi).toBeFalse();
		expect(uiCalls).toEqual(["notify:diagnostic"]);
	});

	test("keeps Magic's internal Historian agent native and recursion-free", async () => {
		const handlers: Handlers = new Map();
		let loads = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => {
				loads++;
				return magicModule();
			},
			magicSubagent: () => true,
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(loads).toBe(0);
		expect(getContextCapability(ctx).status().state).toBe("native");
	});

	test("routes Magic Context tools through the shared Tool row renderer", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const api = apiFor(handlers, tools);
		piStuffContext(api, {
			loadMagicContext: async () => magicModule({ registerTool: true }),
		});
		const ctx = context();

		await emit(handlers, "session_start", { type: "session_start", resumed: false }, ctx);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(tools).toHaveLength(5);
		const search = tools.find((tool) => tool.name === "ctx_search");
		expect(search?.renderShell).toBe("self");
		expect(search?.renderCall).toBeFunction();
		expect(search?.renderResult).toBeFunction();
		expect(api.getActiveTools()).toContain("ctx_search");
	});

	test("does not widen a tool policy changed after session start", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const api = apiFor(handlers, tools);
		piStuffContext(api, {
			loadMagicContext: async () => magicModule({ registerTool: true }),
		});
		const ctx = context();

		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		api.setActiveTools(["read"]);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

		expect(api.getActiveTools()).toEqual(["read"]);
	});

	test("does not auto-activate a Magic tool that had no startup handoff", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const api = apiFor(handlers, tools);
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => event);
					magicApi.registerTool({
						name: "todowrite",
						label: "TodoWrite",
						description: "Write todos",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
					});
				},
			}),
		});
		const ctx = context();

		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

		expect(api.getActiveTools()).not.toContain("todowrite");
		expect(tools.some((tool) => tool.name === "todowrite")).toBeFalse();
	});

	test("awaits startup activation before compaction can run", async () => {
		const handlers: Handlers = new Map();
		const sequence: string[] = [];
		let releaseLoad: (() => void) | undefined;
		let markLoadEntered: (() => void) | undefined;
		const loadGate = new Promise<void>((resolve) => {
			releaseLoad = resolve;
		});
		const loadEntered = new Promise<void>((resolve) => {
			markLoadEntered = resolve;
		});
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => {
				sequence.push("loading");
				markLoadEntered?.();
				await loadGate;
				return {
					default: async (pi: ExtensionAPI) => {
						const register = pi.on.bind(pi) as unknown as (event: string, handler: Handler) => void;
						register("context", (event) => event);
						register("session_before_compact", () => {
							sequence.push("magic-compaction");
							return { cancel: true };
						});
					},
				};
			},
		});
		const ctx = context();
		const startup = emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await loadEntered;
		expect(getContextCapability(ctx).status().state).toBe("loading");
		expect(sequence).toEqual(["loading"]);
		const compaction = emit(handlers, "session_before_compact", { type: "session_before_compact" }, ctx);
		await Promise.resolve();
		releaseLoad?.();
		await Promise.all([startup, compaction]);
		expect(sequence).toEqual(["loading", "magic-compaction"]);
	});

	test("late startup activation after shutdown stays native and runs staged cleanup", async () => {
		const handlers: Handlers = new Map();
		let releaseFactory: (() => void) | undefined;
		let markFactoryEntered: (() => void) | undefined;
		const factoryGate = new Promise<void>((resolve) => {
			releaseFactory = resolve;
		});
		const factoryEntered = new Promise<void>((resolve) => {
			markFactoryEntered = resolve;
		});
		let cleanupRuns = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					markFactoryEntered?.();
					await factoryGate;
					magicApi.on("context", (event) => event);
					magicApi.on("session_start", () => {
						startupRuns++;
					});
					magicApi.on("session_shutdown", () => {
						cleanupRuns++;
					});
				},
			}),
		});
		const ctx = context();
		let startupRuns = 0;
		const activating = emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await factoryEntered;
		let shutdownSettled = false;
		const shutdown = emit(handlers, "session_shutdown", { type: "session_shutdown", reason: "reload" }, ctx).then(
			() => {
				shutdownSettled = true;
			},
		);
		await Promise.resolve();
		expect(shutdownSettled).toBe(false);
		releaseFactory?.();
		await Promise.all([activating, shutdown]);

		expect(shutdownSettled).toBe(true);
		expect(getContextCapability(ctx).status()).toEqual({ state: "native", engine: "native" });
		expect(handlers.get("context")).toBeUndefined();
		expect(startupRuns).toBe(0);
		expect(cleanupRuns).toBe(1);
	});

	test("late deferred preparation cannot revive a disposed runtime", async () => {
		const handlers: Handlers = new Map();
		let releasePreparation: (() => void) | undefined;
		let markPreparationEntered: (() => void) | undefined;
		const preparationGate = new Promise<void>((resolve) => {
			releasePreparation = resolve;
		});
		const preparationEntered = new Promise<void>((resolve) => {
			markPreparationEntered = resolve;
		});
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => magicModule(),
			prepareMagicContext: async () => {
				markPreparationEntered?.();
				await preparationGate;
				return "deferred";
			},
		});
		const ctx = context();
		const activating = emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await preparationEntered;
		const capability = getContextCapability(ctx);
		const shutdown = emit(handlers, "session_shutdown", { type: "session_shutdown", reason: "reload" }, ctx);
		releasePreparation?.();
		await Promise.all([activating, shutdown]);

		expect(capability.status()).toEqual({ state: "native", engine: "native", trigger: "startup" });
	});

	test("does not mix concurrent session starts across activation contexts", async () => {
		const handlers: Handlers = new Map();
		let releaseLoad: (() => void) | undefined;
		const loadGate = new Promise<void>((resolve) => {
			releaseLoad = resolve;
		});
		const observed: Array<{ reason: unknown; sessionId: string | undefined }> = [];
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => {
				await loadGate;
				return {
					default: async (magicApi: ExtensionAPI) => {
						magicApi.on("context", (event) => event);
						magicApi.on("session_start", (event, ctx) => {
							observed.push({
								reason: (event as { readonly reason?: unknown }).reason,
								sessionId: ctx.sessionManager.getSessionId(),
							});
						});
					},
				};
			},
		});
		const firstCtx = context([], "/workspace/first", "session-first");
		const secondCtx = context([], "/workspace/second", "session-second");
		const first = emit(handlers, "session_start", { type: "session_start", reason: "startup" }, firstCtx);
		await Promise.resolve();
		const second = emit(handlers, "session_start", { type: "session_start", reason: "switch" }, secondCtx);
		releaseLoad?.();
		await Promise.all([first, second]);

		expect(observed).toEqual([
			{ reason: "startup", sessionId: "session-first" },
			{ reason: "switch", sessionId: "session-second" },
		]);
		expect(getContextCapability(secondCtx).status().state).toBe("active");
	});

	test("serializes concurrent session starts after Magic is active", async () => {
		const handlers: Handlers = new Map();
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const order: string[] = [];
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => event);
					magicApi.on("session_start", async (event) => {
						const reason = String((event as { readonly reason?: unknown }).reason);
						order.push(`${reason}:start`);
						if (reason === "first") await firstGate;
						order.push(`${reason}:end`);
					});
				},
			}),
		});
		const initialCtx = context([], "/workspace/initial", "session-initial");
		await emit(handlers, "session_start", { type: "session_start", reason: "initial" }, initialCtx);
		order.length = 0;

		const firstCtx = context([], "/workspace/first", "session-first");
		const secondCtx = context([], "/workspace/second", "session-second");
		const first = emit(handlers, "session_start", { type: "session_start", reason: "first" }, firstCtx);
		await Promise.resolve();
		const second = emit(handlers, "session_start", { type: "session_start", reason: "second" }, secondCtx);
		await Promise.resolve();
		expect(order).toEqual(["first:start"]);
		releaseFirst?.();
		await Promise.all([first, second]);

		expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
	});

	test("waits for failed-session cleanup before starting a replacement", async () => {
		const handlers: Handlers = new Map();
		let factories = 0;
		let releaseCleanup: (() => void) | undefined;
		let markCleanupEntered: (() => void) | undefined;
		const cleanupGate = new Promise<void>((resolve) => {
			releaseCleanup = resolve;
		});
		const cleanupEntered = new Promise<void>((resolve) => {
			markCleanupEntered = resolve;
		});
		const order: string[] = [];
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					factories++;
					const factory = factories;
					magicApi.on("context", (event) => event);
					magicApi.on("session_start", (event) => {
						if (factory === 1 && (event as { readonly reason?: unknown }).reason === "fail") {
							throw new Error("startup failed");
						}
						order.push(`factory-${String(factory)}:start`);
					});
					magicApi.on("session_shutdown", async () => {
						if (factory !== 1) return;
						order.push("cleanup:start");
						markCleanupEntered?.();
						await cleanupGate;
						order.push("cleanup:end");
					});
				},
			}),
		});
		const initialCtx = context([], "/workspace/initial", "session-initial");
		await emit(handlers, "session_start", { type: "session_start", reason: "initial" }, initialCtx);
		order.length = 0;

		const failedCtx = context([], "/workspace/failed", "session-failed");
		const replacementCtx = context([], "/workspace/replacement", "session-replacement");
		const failed = emit(handlers, "session_start", { type: "session_start", reason: "fail" }, failedCtx);
		await cleanupEntered;
		expect(order).toEqual(["cleanup:start"]);
		const replacement = emit(
			handlers,
			"session_start",
			{ type: "session_start", reason: "replacement" },
			replacementCtx,
		);
		await Promise.resolve();
		expect(factories).toBe(1);
		releaseCleanup?.();
		await Promise.all([failed, replacement]);

		expect(order).toEqual(["cleanup:start", "cleanup:end", "factory-2:start"]);
		expect(getContextCapability(replacementCtx).status().state).toBe("active");
	});

	test("reuses one runtime when the same Host loads Context twice", async () => {
		const handlers: Handlers = new Map();
		const api = apiFor(handlers);
		let firstLoads = 0;
		let secondLoads = 0;
		piStuffContext(api, {
			loadMagicContext: async () => {
				firstLoads++;
				return magicModule();
			},
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		piStuffContext(api, {
			loadMagicContext: async () => {
				secondLoads++;
				return magicModule();
			},
		});

		expect(firstLoads).toBe(1);
		expect(secondLoads).toBe(0);
		expect(handlers.get("context")).toHaveLength(1);
		expect(getContextCapability(ctx).status().state).toBe("active");
	});

	test("restores native compaction while a live Magic transform is unhealthy", async () => {
		const handlers: Handlers = new Map();
		const api = apiFor(handlers);
		const bypasses: unknown[] = [];
		api.events.on(CONTEXT_COMPACTION_BYPASSED_EVENT, (value) => bypasses.push(value));
		let shouldFail = false;
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (pi: ExtensionAPI) => {
					const register = pi.on.bind(pi) as unknown as (event: string, handler: Handler) => void;
					register("context", (event) => {
						if (shouldFail) return;
						const contextEvent = event as { messages: unknown[] };
						return {
							messages: [taggedMessage("<session-history>healthy</session-history>"), ...contextEvent.messages],
						};
					});
					register("session_before_compact", () => ({ cancel: true }));
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([undefined, { cancel: true }]);
		expect(bypasses).toEqual([{ schemaVersion: 1, sessionManager: ctx.sessionManager, source: "magic-context" }]);

		shouldFail = true;
		const original = { type: "context", messages: [taggedMessage("native")] };
		expect(await emitResults(handlers, "context", original, ctx)).toEqual([{ messages: original.messages }]);
		expect(getContextCapability(ctx).status().state).toBe("degraded");
		expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([undefined]);
		expect(bypasses).toHaveLength(1);

		shouldFail = false;
		const recovered = await emitResults(handlers, "context", original, ctx);
		expect(JSON.stringify(recovered)).toContain("healthy");
		expect(getContextCapability(ctx).status().state).toBe("active");
		expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([undefined, { cancel: true }]);
		expect(bypasses).toHaveLength(2);
	});

	test("fails open when a live Magic turn handler throws", async () => {
		const handlers: Handlers = new Map();
		let attempts = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					attempts++;
					const attempt = attempts;
					magicApi.on("context", (event) => event);
					magicApi.on("before_agent_start", () => {
						if (attempt === 1) throw new Error("turn startup failed");
					});
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(getContextCapability(ctx).status()).toMatchObject({
			engine: "native",
			error: "turn startup failed",
			state: "degraded",
		});

		await emit(handlers, "input", { type: "input", text: "retry", source: "rpc" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(attempts).toBe(2);
		expect(getContextCapability(ctx).status().state).toBe("active");
	});

	test("ignores a stale Magic compaction result after shutdown", async () => {
		const handlers: Handlers = new Map();
		let releaseCompaction: (() => void) | undefined;
		let markCompactionEntered: (() => void) | undefined;
		const compactionGate = new Promise<void>((resolve) => {
			releaseCompaction = resolve;
		});
		const compactionEntered = new Promise<void>((resolve) => {
			markCompactionEntered = resolve;
		});
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => event);
					magicApi.on("session_before_compact", async () => {
						markCompactionEntered?.();
						await compactionGate;
						return { cancel: true };
					});
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		const compaction = emitResults(handlers, "session_before_compact", {}, ctx);
		await compactionEntered;
		const shutdown = emit(handlers, "session_shutdown", { type: "session_shutdown", reason: "reload" }, ctx);
		releaseCompaction?.();

		expect(await compaction).toEqual([undefined, undefined]);
		await shutdown;
	});

	test("presents manual Magic compaction as one extension-owned managed-history boundary", async () => {
		const handlers: Handlers = new Map();
		const api = apiFor(handlers);
		const bypasses: unknown[] = [];
		api.events.on(CONTEXT_COMPACTION_BYPASSED_EVENT, (value) => bypasses.push(value));
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => ({
						messages: [taggedMessage("<session-history>healthy</session-history>"), ...event.messages],
					}));
					magicApi.on("session_before_compact", () => ({ cancel: true }));
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);

		const result = await emitResults(
			handlers,
			"session_before_compact",
			{
				preparation: { firstKeptEntryId: "keep-this", tokensBefore: 42_000 },
				reason: "manual",
				type: "session_before_compact",
			},
			ctx,
		);

		expect(result).toEqual([
			undefined,
			{
				compaction: {
					details: { engine: "magic-context", mode: "managed-history", source: "magic-context" },
					firstKeptEntryId: "keep-this",
					summary: "Magic Context manages prior history.",
					tokensBefore: 42_000,
				},
			},
		]);
		expect(bypasses).toEqual([]);
	});

	test("does not stack native compaction after the Magic compaction hook throws", async () => {
		const handlers: Handlers = new Map();
		const api = apiFor(handlers);
		const bypasses: unknown[] = [];
		api.events.on(CONTEXT_COMPACTION_BYPASSED_EVENT, (value) => bypasses.push(value));
		piStuffContext(api, {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => ({
						messages: [taggedMessage("<session-history>healthy</session-history>"), ...event.messages],
					}));
					magicApi.on("session_before_compact", () => {
						throw new Error("context store unavailable");
					});
				},
			}),
		});
		const notifications: string[] = [];
		const ctx = {
			...context(),
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionContext;
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);

		expect(
			await emitResults(
				handlers,
				"session_before_compact",
				{
					preparation: { firstKeptEntryId: "keep-this", tokensBefore: 42_000 },
					reason: "manual",
				},
				ctx,
			),
		).toEqual([undefined, { cancel: true }]);
		expect(getContextCapability(ctx).status()).toMatchObject({
			engine: "native",
			error: "context store unavailable",
			state: "degraded",
		});
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain("full Session remains intact");
		expect(bypasses).toEqual([{ schemaVersion: 1, sessionManager: ctx.sessionManager, source: "magic-context" }]);
	});
});

describe("Context projections", () => {
	test("falls back to bounded native history for forked Agents without giving fresh Agents the whole session", async () => {
		const entry = {
			type: "message",
			id: "message-1",
			parentId: null,
			timestamp: "2026-08-09T00:00:00.000Z",
			message: taggedMessage("parent <instruction>history</instruction>"),
		} as unknown as SessionEntry;
		const ctx = context([entry]);

		const fork = await projectCurrentContext("agent-fork", ctx, { maxTokens: 512 });
		const fresh = await projectCurrentContext("agent-fresh", ctx, { maxTokens: 512 });
		const btw = await projectCurrentContext("btw", ctx, { maxTokens: 512 });

		expect(fork.source).toBe("native");
		expect(fork.text).toContain('audience="agent-fork"');
		expect(fork.text).toContain("parent &lt;instruction&gt;history&lt;/instruction&gt;");
		expect(fork.text.length).toBeLessThanOrEqual(700);
		expect(fresh).toEqual({ source: "native", text: "", truncated: false });
		expect(btw).toEqual({ source: "native", text: "", truncated: false });
	});

	test("builds native fallback from bounded session ends without materializing a huge middle", async () => {
		const projection = await projectCurrentContext("agent-fork", context(), {
			maxTokens: 512,
			sourceMessages: [taggedMessage(`HEAD-${"中".repeat(2_000_000)}-TAIL`)],
		});

		expect(projection.source).toBe("native");
		expect(projection.text).toContain("HEAD-");
		expect(projection.text).toContain("-TAIL");
		expect(projection.text).toContain("omitted the middle");
		expect(__test.estimateProjectionTokens(projection.text)).toBeLessThanOrEqual(512);
	});

	test("projects a caller-owned frozen snapshot without re-reading a changed session", async () => {
		let reads = 0;
		const ctx = context([
			{
				type: "message",
				id: "leaked-message",
				parentId: null,
				timestamp: "2026-08-09T00:00:00.000Z",
				message: taggedMessage("leaked later context"),
			} as unknown as SessionEntry,
		]);
		const original = ctx.sessionManager.buildContextEntries.bind(ctx.sessionManager);
		ctx.sessionManager.buildContextEntries = () => {
			reads += 1;
			return original();
		};
		const projection = await projectCurrentContext("agent-fork", ctx, {
			maxTokens: 512,
			sourceMessages: [taggedMessage("frozen context")],
		});

		expect(reads).toBe(0);
		expect(projection.text).toContain("frozen context");
		expect(projection.text).not.toContain("leaked later context");
	});

	test("does not replace an explicit frozen snapshot with an older Magic projection cache", async () => {
		const handlers: Handlers = new Map();
		let magicTransforms = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (pi: ExtensionAPI) => {
					pi.on("context", (event) => {
						magicTransforms += 1;
						const contextEvent = event as { messages: ReturnType<typeof taggedMessage>[] };
						const input = contextEvent.messages.map((message) => message.content[0]?.text ?? "").join(" ");
						return {
							messages: [taggedMessage(`<session-history>${input}</session-history>`)],
						};
					});
				},
			}),
		});
		const ctx = context(
			[
				{
					type: "message",
					id: "old-message",
					parentId: null,
					timestamp: "2026-08-09T00:00:00.000Z",
					message: taggedMessage("old snapshot"),
				} as unknown as SessionEntry,
			],
			"/workspace/frozen",
			"frozen-session",
		);
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const cached = await projectCurrentContext("agent-fork", ctx);
		const frozen = await projectCurrentContext("agent-fork", ctx, {
			sourceMessages: [taggedMessage("new frozen snapshot")],
		});

		expect(cached.text).toContain("old snapshot");
		expect(magicTransforms).toBe(1);
		expect(frozen.source).toBe("native");
		expect(frozen.text).toContain("new frozen snapshot");
		expect(frozen.text).not.toContain("old snapshot");
		expect(magicTransforms).toBe(1);
	});

	test("invalidates a cached Magic projection when the next prompt is submitted", async () => {
		const handlers: Handlers = new Map();
		let current = "first turn";
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (pi: ExtensionAPI) => {
					pi.on("context", () => ({
						messages: [taggedMessage(`<session-history>${current}</session-history>`)],
					}));
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const first = await projectCurrentContext("agent-fork", ctx);
		current = "second turn";
		await emit(handlers, "input", { type: "input", text: "next", source: "rpc" }, ctx);
		const second = await projectCurrentContext("agent-fork", ctx);

		expect(first.text).toContain("first turn");
		expect(second.text).toContain("second turn");
		expect(second.text).not.toContain("first turn");
	});

	test("does not route an unbound Host through another Host with the same session id", async () => {
		const handlers: Handlers = new Map();
		const hostA = context([], "/workspace/shared", "same-session");
		const hostB = context([], "/workspace/shared", "same-session");
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => magicModule(),
		});
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, hostA);

		const projectionA = await projectCurrentContext("agent-fresh", hostA);
		const projectionB = await projectCurrentContext("agent-fresh", hostB);

		expect(projectionA.source).toBe("magic-context");
		expect(projectionB).toEqual({ source: "native", text: "", truncated: false });
	});

	test("isolates two loaded Hosts even when their session identities match", async () => {
		const handlersA: Handlers = new Map();
		const handlersB: Handlers = new Map();
		const hostA = context([], "/workspace/host-a", "same-session");
		const hostB = context([], "/workspace/host-b", "same-session");
		const loadFor = (label: string) => async () => ({
			default: async (pi: ExtensionAPI) => {
				pi.on("context", (event) => ({
					messages: [
						taggedMessage(`<session-history><project-memory>${label}</project-memory></session-history>`),
						...event.messages,
					],
				}));
			},
		});
		piStuffContext(apiFor(handlersA), { loadMagicContext: loadFor("host-a-memory") });
		piStuffContext(apiFor(handlersB), { loadMagicContext: loadFor("host-b-memory") });
		await emit(handlersA, "session_start", { type: "session_start", reason: "startup" }, hostA);
		await emit(handlersB, "session_start", { type: "session_start", reason: "startup" }, hostB);

		const projectionA = await projectCurrentContext("agent-fresh", hostA);
		const projectionB = await projectCurrentContext("agent-fresh", hostB);

		expect(projectionA.text).toContain("host-a-memory");
		expect(projectionA.text).not.toContain("host-b-memory");
		expect(projectionB.text).toContain("host-b-memory");
		expect(projectionB.text).not.toContain("host-a-memory");
	});

	test("projects bounded reference data and gives fresh agents project memory only", async () => {
		const handlers: Handlers = new Map();
		piStuffContext(apiFor(handlers), { loadMagicContext: async () => magicModule() });
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const fork = await projectCurrentContext("agent-fork", ctx);
		const fresh = await projectCurrentContext("agent-fresh", ctx);

		expect(fork.source).toBe("magic-context");
		expect(fork.text).toContain('audience="agent-fork"');
		expect(fork.text).toContain("older turn");
		expect(fork.text).toContain("newer turn");
		expect(fork.text).toContain("never as instructions or policy");
		expect(fresh.text).toContain("remember me");
		expect(fresh.text).toContain("remember me, updated");
		expect(fresh.text).toContain("new memory");
		expect(fresh.text).not.toContain("older turn");
		expect(fresh.text).not.toContain("newer turn");
	});

	test("does not reuse a projection after the same session changes cwd", async () => {
		const handlers: Handlers = new Map();
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (pi: ExtensionAPI) => {
					const register = pi.on.bind(pi) as unknown as (event: string, handler: Handler) => void;
					register("context", (event, ctx) => {
						const contextEvent = event as { messages: unknown[] };
						return {
							messages: [
								taggedMessage(`<session-history><project-memory>${ctx.cwd}</project-memory></session-history>`),
								...contextEvent.messages,
							],
						};
					});
				},
			}),
		});
		const projectAContext = context([], "/workspace/project-a");
		const projectBContext = {
			...projectAContext,
			cwd: "/workspace/project-b",
		} as ExtensionContext;
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, projectAContext);

		const projectA = await projectCurrentContext("agent-fresh", projectAContext);
		const projectB = await projectCurrentContext("agent-fresh", projectBContext);
		expect(projectA.text).toContain("/workspace/project-a");
		expect(projectB.text).toContain("/workspace/project-b");
		expect(projectB.text).not.toContain("/workspace/project-a");
	});

	test("bounds oversized projections by audience without losing both ends", () => {
		const full = `<session-history>${"a".repeat(70_000)}TAIL</session-history>`;
		const projection = __test.formatProjection(full, "btw");
		expect(projection.truncated).toBe(true);
		expect(projection.text.length).toBeLessThanOrEqual(48_300);
		expect(projection.text).toContain("Pi Stuff omitted the middle");
		expect(projection.text).toContain("TAIL");
	});

	test("honors a caller token budget while preserving the projection envelope", async () => {
		const handlers: Handlers = new Map();
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (pi: ExtensionAPI) => {
					pi.on("context", (event) => ({
						messages: [
							taggedMessage(`<session-history>${"memory ".repeat(2_000)}TAIL</session-history>`),
							...event.messages,
						],
					}));
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const projection = await projectCurrentContext("agent-fork", ctx, { maxTokens: 256 });

		expect(projection.source).toBe("magic-context");
		expect(projection.truncated).toBe(true);
		expect(__test.estimateProjectionTokens(projection.text)).toBeLessThanOrEqual(256);
		expect(projection.text).toContain("Pi Stuff omitted the middle");
		expect(projection.text).toEndWith("</pi-stuff-context>");
	});

	test("keeps rare CJK, emoji, and high-entropy projections inside a strict byte upper bound", () => {
		for (const full of [
			`<session-history>${"上下文🧭𠮷".repeat(2_000)}TAIL</session-history>`,
			`<session-history>${"AP6Zz9+/0f3cD7aQ".repeat(2_000)}TAIL</session-history>`,
		]) {
			const projection = __test.formatProjection(full, "agent-fork", { maxTokens: 512 });

			expect(projection.truncated).toBeTrue();
			expect(__test.estimateProjectionTokens(projection.text)).toBeLessThanOrEqual(512);
			expect(projection.text).toContain("Pi Stuff omitted the middle");
			expect(projection.text).toContain("L</session-history>");
			expect(projection.text).toEndWith("</pi-stuff-context>");
		}
	});
});

describe("certified Pi extension ordering contract", () => {
	test("keeps the provider-facing Magic Context contract compact before upstream injection", async () => {
		const handlers: Handlers = new Map();
		let upstreamSawMarker = false;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					magicApi.on("context", (event) => event);
					magicApi.on("before_agent_start", (event) => {
						const systemPrompt = Reflect.get(event, "systemPrompt");
						if (typeof systemPrompt !== "string") return;
						upstreamSawMarker = systemPrompt.includes("## Magic Context");
						return {
							systemPrompt: upstreamSawMarker
								? systemPrompt
								: `${systemPrompt}\n\n## Magic Context\n\nVERBOSE_UPSTREAM_GUIDANCE`,
						};
					});
				},
			}),
		});
		const extension: Extension = {
			path: "<inline:context-compact-prompt>",
			resolvedPath: "<inline:context-compact-prompt>",
			sourceInfo: createSyntheticSourceInfo("<inline:context-compact-prompt>", {
				source: "context-compact-prompt",
			}),
			handlers: handlers as Extension["handlers"],
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};
		const runner = new ExtensionRunner(
			[extension],
			createExtensionRuntime(),
			"/workspace/project-a",
			context().sessionManager as never,
			{} as never,
		);

		await runner.emitInput("prompt", undefined, "rpc");
		const result = await runner.emitBeforeAgentStart("prompt", undefined, "base", {
			cwd: "/workspace/project-a",
		});
		if (!result?.systemPrompt) throw new Error("Magic Context did not return a provider-facing system prompt");
		const systemPrompt = result.systemPrompt;

		expect(upstreamSawMarker).toBe(true);
		expect(systemPrompt).toStartWith("base\n\n## Magic Context\n");
		expect(systemPrompt).not.toContain("VERBOSE_UPSTREAM_GUIDANCE");
		for (const tool of ["ctx_search", "ctx_expand", "ctx_reduce", "ctx_memory", "ctx_note"]) {
			expect(systemPrompt).toContain(tool);
		}
		expect(systemPrompt.length).toBeLessThan(2_000);
	});

	test("runs a Magic handler appended during before_agent_start in the same host event", async () => {
		const handlers: Handlers = new Map();
		let appendedHandlerRan = false;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => magicModule({ registerBeforeStart: () => (appendedHandlerRan = true) }),
		});
		const extension: Extension = {
			path: "<inline:context-contract>",
			resolvedPath: "<inline:context-contract>",
			sourceInfo: createSyntheticSourceInfo("<inline:context-contract>", { source: "context-contract" }),
			handlers: handlers as Extension["handlers"],
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};
		const runner = new ExtensionRunner(
			[extension],
			createExtensionRuntime(),
			"/workspace/project-a",
			context().sessionManager as never,
			{} as never,
		);

		await runner.emitInput("prompt", undefined, "rpc");
		await runner.emitBeforeAgentStart("prompt", undefined, "system", { cwd: "/workspace/project-a" });
		expect(appendedHandlerRan).toBe(true);
	});
});
