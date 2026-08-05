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
} from "../../packages/pi-stuff-context/index.js";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Handlers = Map<string, Handler[]>;

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
	test("keeps startup pure and activates Magic Context only when work begins", async () => {
		const handlers: Handlers = new Map();
		const tools: ToolDefinition[] = [];
		const api = apiFor(handlers, tools);
		let loads = 0;
		piStuffContext(api, {
			loadMagicContext: async () => {
				loads++;
				return magicModule();
			},
		});
		const ctx = context();

		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(loads).toBe(0);
		expect(getContextCapability(ctx).status()).toEqual({ state: "dormant", engine: "native" });
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"ctx_expand",
			"ctx_memory",
			"ctx_note",
			"ctx_reduce",
			"ctx_search",
		]);
		expect(api.getActiveTools()).toEqual(["ctx_expand", "ctx_memory", "ctx_note", "ctx_reduce", "ctx_search"]);

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(loads).toBe(1);
		expect(getContextCapability(ctx).status()).toEqual({
			state: "active",
			engine: "magic-context",
			trigger: "automatic-turn",
		});
		expect(api.getActiveTools()).toEqual([]);
	});

	test("fails open to native context and retries on the next activation", async () => {
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

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(getContextCapability(ctx).status().state).toBe("degraded");
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

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		expect(handlers.get("context")).toBeUndefined();
		expect(handlers.get("message_end")).toBeUndefined();
		expect(registrations).toEqual({ commands: [], entryRenderers: [] });
		expect(tools.find((tool) => tool.name === "ctx_search")?.description).toContain("activates lazily");

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		await emit(handlers, "message_end", { type: "message_end" }, ctx);
		expect(handlers.get("context")).toHaveLength(1);
		expect(handlers.get("message_end")).toHaveLength(1);
		expect(registrations).toEqual({ commands: [], entryRenderers: [] });
		expect(tools.find((tool) => tool.name === "ctx_search")?.description).toBe("Committed Magic search");
		expect(staleMessageEnds).toBe(1);
	});

	test("replays the observed session start exactly once after lazy activation", async () => {
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

		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

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

		await emit(handlers, "session_start", { type: "session_start", resumed: false });
		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
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
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

		expect(api.getActiveTools()).not.toContain("todowrite");
		expect(tools.some((tool) => tool.name === "todowrite")).toBeFalse();
	});

	test("awaits first-input activation before compaction can run", async () => {
		const handlers: Handlers = new Map();
		const sequence: string[] = [];
		let releaseLoad: (() => void) | undefined;
		const loadGate = new Promise<void>((resolve) => {
			releaseLoad = resolve;
		});
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => {
				sequence.push("loading");
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
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const input = emit(handlers, "input", { type: "input" }, ctx);
		await Promise.resolve();
		expect(getContextCapability(ctx).status().state).toBe("loading");
		expect(sequence).toEqual(["loading"]);
		releaseLoad?.();
		await input;
		await emit(handlers, "session_before_compact", { type: "session_before_compact" }, ctx);
		expect(sequence).toEqual(["loading", "magic-compaction"]);
	});

	test("late activation after shutdown stays native and runs staged cleanup", async () => {
		const handlers: Handlers = new Map();
		let releaseFactory: (() => void) | undefined;
		const factoryGate = new Promise<void>((resolve) => {
			releaseFactory = resolve;
		});
		let cleanupRuns = 0;
		piStuffContext(apiFor(handlers), {
			loadMagicContext: async () => ({
				default: async (magicApi: ExtensionAPI) => {
					await factoryGate;
					magicApi.on("context", (event) => event);
					magicApi.on("session_shutdown", () => {
						cleanupRuns++;
					});
				},
			}),
		});
		const ctx = context();
		await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

		const activating = emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
		await Promise.resolve();
		await emit(handlers, "session_shutdown", { type: "session_shutdown", reason: "reload" }, ctx);
		releaseFactory?.();
		await activating;

		expect(getContextCapability(ctx).status()).toEqual({ state: "native", engine: "native" });
		expect(handlers.get("context")).toBeUndefined();
		expect(cleanupRuns).toBe(1);
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
		expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([{ cancel: true }]);
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
		expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([{ cancel: true }]);
		expect(bypasses).toHaveLength(2);
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
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

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
		await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);

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
		).toEqual([{ cancel: true }]);
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

		const projection = await projectCurrentContext("agent-fork", ctx, { maxTokens: 100 });

		expect(projection.source).toBe("magic-context");
		expect(projection.truncated).toBe(true);
		expect(projection.text.length).toBeLessThanOrEqual(700);
		expect(projection.text).toContain("Pi Stuff omitted the middle");
		expect(projection.text).toEndWith("</pi-stuff-context>");
	});
});

describe("Pi 0.83 extension ordering contract", () => {
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

		await runner.emitBeforeAgentStart("prompt", undefined, "system", { cwd: "/workspace/project-a" });
		expect(appendedHandlerRan).toBe(true);
	});
});
