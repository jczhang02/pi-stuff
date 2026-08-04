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
	getContextCapability,
	projectCurrentContext,
} from "../../packages/pi-stuff-context/index.js";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type Handlers = Map<string, Handler[]>;

function apiFor(handlers: Handlers, tools: ToolDefinition[] = []): ExtensionAPI {
	let activeTools: string[] = [];
	return {
		events: {},
		on(event: string, handler: Handler): void {
			const current = handlers.get(event) ?? [];
			current.push(handler);
			handlers.set(event, current);
		},
		registerTool(tool: ToolDefinition): void {
			const existing = tools.findIndex((candidate) => candidate.name === tool.name);
			if (existing < 0) tools.push(tool);
			else tools[existing] = tool;
			if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
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

		await emit(handlers, "session_start", { type: "session_start", resumed: false });
		expect(loads).toBe(0);
		expect(getContextCapability().status()).toEqual({ state: "dormant", engine: "native" });
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"ctx_expand",
			"ctx_memory",
			"ctx_note",
			"ctx_reduce",
			"ctx_search",
		]);
		expect(api.getActiveTools()).toEqual([]);

		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
		expect(loads).toBe(1);
		expect(getContextCapability().status()).toEqual({
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

		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
		expect(getContextCapability().status().state).toBe("degraded");
		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
		expect(loads).toBe(2);
		expect(getContextCapability().status().state).toBe("active");
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

		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
		expect(loads).toBe(0);
		expect(getContextCapability().status().state).toBe("native");
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

		const input = emit(handlers, "input", { type: "input" });
		await Promise.resolve();
		expect(getContextCapability().status().state).toBe("loading");
		expect(sequence).toEqual(["loading"]);
		releaseLoad?.();
		await input;
		await emit(handlers, "session_before_compact", { type: "session_before_compact" });
		expect(sequence).toEqual(["loading", "magic-compaction"]);
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
		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
		piStuffContext(api, {
			loadMagicContext: async () => {
				secondLoads++;
				return magicModule();
			},
		});

		expect(firstLoads).toBe(1);
		expect(secondLoads).toBe(0);
		expect(handlers.get("context")).toHaveLength(1);
		expect(getContextCapability().status().state).toBe("active");
	});

	test("restores native compaction while a live Magic transform is unhealthy", async () => {
		const handlers: Handlers = new Map();
		let shouldFail = false;
		piStuffContext(apiFor(handlers), {
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
		await emit(handlers, "before_agent_start", { type: "before_agent_start" });
		expect(await emitResults(handlers, "session_before_compact", {})).toEqual([{ cancel: true }]);

		shouldFail = true;
		const original = { type: "context", messages: [taggedMessage("native")] };
		expect(await emitResults(handlers, "context", original)).toEqual([{ messages: original.messages }]);
		expect(getContextCapability().status().state).toBe("degraded");
		expect(await emitResults(handlers, "session_before_compact", {})).toEqual([undefined]);

		shouldFail = false;
		const recovered = await emitResults(handlers, "context", original);
		expect(JSON.stringify(recovered)).toContain("healthy");
		expect(getContextCapability().status().state).toBe("active");
		expect(await emitResults(handlers, "session_before_compact", {})).toEqual([{ cancel: true }]);
	});
});

describe("Context projections", () => {
	test("projects bounded reference data and gives fresh agents project memory only", async () => {
		const handlers: Handlers = new Map();
		piStuffContext(apiFor(handlers), { loadMagicContext: async () => magicModule() });
		const ctx = context();

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

		const projectA = await projectCurrentContext("agent-fresh", context([], "/workspace/project-a"));
		const projectB = await projectCurrentContext("agent-fresh", context([], "/workspace/project-b"));
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
