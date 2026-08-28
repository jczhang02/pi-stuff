import { afterEach, expect, test } from "bun:test";
import {
	apiFor,
	COMPACTION_RESULT,
	type CompactOptions,
	cleanupContextCoreFixtures,
	context,
	createExtensionCommandContext,
	type ExtensionAPI,
	emit,
	emitResults,
	emitUntilHandled,
	getContextCapability,
	type Handler,
	type Handlers,
	type HostRegistrations,
	hasDirectUserActivation,
	isSuiteNativeCompactionPreflight,
	magicModule,
	piStuffContext,
	projectCurrentContext,
	sendSuiteAgentMessage,
	type TestCommandDefinition,
	type ToolDefinition,
	Type,
	taggedMessage,
	UI_RENDER_REQUEST_EVENT,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "./core-fixtures.js";

afterEach(cleanupContextCoreFixtures);

test("keeps automatic messages and Tools outside Context lifecycle policy", async () => {
	const handlers: Handlers = new Map();
	const api = apiFor(handlers);
	const deliveries: Array<{ triggerTurn?: boolean }> = [];
	const sendMessage: ExtensionAPI["sendMessage"] = (_message, options) => {
		deliveries.push(options ?? {});
	};
	Reflect.set(api, "sendMessage", sendMessage);
	const { promise: activationGate, resolve: releaseActivation } = Promise.withResolvers<void>();
	const { promise: activationStarted, resolve: markActivationStarted } = Promise.withResolvers<void>();
	let preparations = 0;
	await piStuffContext(api, {
		loadMagicContext: async () => magicModule(),
		prepareMagicContext: async () => {
			preparations++;
			if (preparations === 1) return "deferred";
			markActivationStarted();
			await activationGate;
			return "ready";
		},
	});
	const ctx = context();
	Object.assign(ctx, { isIdle: () => true });
	await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

	const pending = sendSuiteAgentMessage(
		api,
		{ customType: "test:auto", content: "continue", display: false },
		{ triggerTurn: true },
	);
	await activationStarted;
	expect(deliveries).toEqual([]);
	releaseActivation();
	await expect(pending).resolves.toBe(true);
	expect(deliveries).toEqual([{ triggerTurn: true }]);
	expect(handlers.has("turn_end")).toBe(false);
	expect(handlers.has("tool_call")).toBe(false);
	expect(handlers.has("tool_result")).toBe(false);

	const projected = await emitResults(
		handlers,
		"context",
		{ type: "context", messages: [taggedMessage("current request")] },
		ctx,
	);
	const serialized = JSON.stringify(projected);
	expect(serialized).toContain("session-history");
	expect(serialized).not.toContain("pi-stuff:task-anchor");
});

test("precompacts a near-limit native fallback before an idle Suite custom turn", async () => {
	const handlers: Handlers = new Map();
	const api = apiFor(handlers);
	const order: string[] = [];
	Reflect.set(api, "sendMessage", () => order.push("send"));
	const ctx = context();
	Object.assign(ctx, {
		compact: (options: CompactOptions) => {
			expect(isSuiteNativeCompactionPreflight(ctx)).toBe(true);
			order.push("compact");
			options.onComplete?.(COMPACTION_RESULT);
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
	let delivered: Parameters<ExtensionAPI["sendMessage"]>[0] | undefined;
	const api = apiFor(handlers);
	Reflect.set(api, "sendMessage", (message: Parameters<ExtensionAPI["sendMessage"]>[0]) => {
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
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	(api.on as (event: string, handler: Handler) => void)("input", () => ({ action: "handled" }));
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
	const { promise: automaticGate, resolve: releaseAutomatic } = Promise.withResolvers<void>();
	const { promise: automaticEntered, resolve: markAutomaticEntered } = Promise.withResolvers<void>();
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

test("gives only interactive input one Host paint turn before Context without requesting another render", async () => {
	const handlers: Handlers = new Map();
	const sequence: string[] = [];
	let renderRequests = 0;
	const api = apiFor(handlers);
	api.events.on(UI_RENDER_REQUEST_EVENT, (value) => {
		renderRequests++;
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		(value as { handled: boolean }).handled = true;
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
	sequence.length = 0;

	await emit(handlers, "input", { type: "input", text: "first", source: "interactive" }, ctx);
	await emit(handlers, "input", { type: "input", text: "latest", source: "interactive" }, ctx);
	await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
	const hostTurn = new Promise<void>((resolveTurn) => {
		setImmediate(() => {
			sequence.push("host-turn");
			resolveTurn();
		});
	});
	const firstContext = emit(handlers, "context", { type: "context", messages: [taggedMessage("first")] }, ctx);
	expect(sequence).toEqual([]);
	expect(renderRequests).toBe(0);
	await Promise.all([hostTurn, firstContext]);
	await emit(handlers, "context", { type: "context", messages: [taggedMessage("tool result")] }, ctx);
	expect(sequence).toEqual(["host-turn", "transform", "transform"]);

	for (const source of ["rpc", "extension"] as const) {
		sequence.length = 0;
		await emit(handlers, "input", { type: "input", text: "handled", source: "interactive" }, ctx);
		await emit(handlers, "input", { type: "input", text: source, source }, ctx);
		let hostTurnReached = false;
		const hostTurn = new Promise<void>((resolveTurn) => {
			setImmediate(() => {
				hostTurnReached = true;
				resolveTurn();
			});
		});
		const contextTransform = emit(handlers, "context", { type: "context", messages: [taggedMessage(source)] }, ctx);
		expect(sequence).toEqual(["transform"]);
		expect(hostTurnReached).toBe(false);
		await Promise.all([hostTurn, contextTransform]);
	}
	expect(renderRequests).toBe(0);
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

test("degrades immediately when the active Context engine reports a fatal failure", async () => {
	const handlers: Handlers = new Map();
	const tools: ToolDefinition[] = [];
	const api = apiFor(handlers, tools);
	let reportFatal: ((cause: unknown) => void) | undefined;
	let loads = 0;
	await piStuffContext(api, {
		loadMagicContext: async () => {
			loads += 1;
			if (loads > 1) throw new Error("replacement engine unavailable");
			return {
				default: async (magicApi: ExtensionAPI, onFatal?: (cause: unknown) => void) => {
					reportFatal = onFatal;
					magicApi.on("context", () => ({
						messages: [taggedMessage("<session-history>cached before failure</session-history>")],
					}));
					magicApi.registerTool({
						description: "Search Context",
						execute: async () => ({ content: [{ type: "text", text: "result" }], details: undefined }),
						label: "ctx_search",
						name: "ctx_search",
						parameters: Type.Object({ query: Type.String() }),
					});
				},
			};
		},
	});
	const ctx = context();
	await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
	expect(getContextCapability(ctx).status().state).toBe("active");
	expect((await projectCurrentContext("agent-fork", ctx)).source).toBe("magic-context");
	expect(api.getActiveTools()).toContain("ctx_search");
	expect(reportFatal).toBeDefined();

	reportFatal?.(new Error("Context engine worker crashed"));
	await Bun.sleep(10);

	expect(getContextCapability(ctx).status()).toEqual({
		state: "degraded",
		engine: "native",
		trigger: "startup",
		error: "Context engine worker crashed",
	});
	expect(api.getActiveTools()).not.toContain("ctx_search");
	const fallback = await projectCurrentContext("agent-fork", ctx);
	expect(loads).toBe(2);
	expect(fallback.source).toBe("native");
	expect(fallback.text).not.toContain("cached before failure");
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
	expect(handlers.get("context")).toHaveLength(1);
	expect(handlers.get("message_end")).toBeUndefined();
	expect(registrations).toEqual({ commands: ["ctx"], entryRenderers: ["pi-stuff-context-activity"] });
	expect(tools.find((tool) => tool.name === "ctx_search")?.description).toContain("provider boundary");

	await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
	await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
	await emit(handlers, "message_end", { type: "message_end" }, ctx);
	expect(handlers.get("context")).toHaveLength(1);
	expect(handlers.get("message_end")).toHaveLength(1);
	expect(registrations).toEqual({ commands: ["ctx"], entryRenderers: ["pi-stuff-context-activity"] });
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
					// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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

test("exposes one Context command, completes its subcommands, and suppresses upstream UI", async () => {
	const handlers: Handlers = new Map();
	const tools: ToolDefinition[] = [];
	const commandDefinitions = new Map<string, TestCommandDefinition>();
	const registrations: HostRegistrations = { commands: [], commandDefinitions, entryRenderers: [] };
	const uiCalls: string[] = [];
	const commandCalls: string[] = [];
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
					// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
					ctx.ui.setFooter(() => ({ render: () => [] }) as never);
					// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
						handler: async (args, ctx) => {
							commandCalls.push(`${name}:${args}`);
							ctx.ui.setStatus("magic", "duplicate");
							ctx.ui.notify("diagnostic");
							await ctx.ui.custom(async () => ({ invalidate: () => {}, render: () => [] }));
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
	const ctx = createExtensionCommandContext({
		...context(),
		hasUI: true,
		mode: "tui",
		ui: {
			custom: async <Result>(): Promise<Result> => {
				uiCalls.push("custom");
				// SAFETY: the captured Magic command ignores the dialog result; undefined represents its dismissed test UI.
				return undefined as Result;
			},
			notify: (message: string) => uiCalls.push(`notify:${message}`),
			setFooter: () => uiCalls.push("footer"),
			setHeader: () => uiCalls.push("header"),
			setStatus: () => uiCalls.push("status"),
			setWidget: () => uiCalls.push("widget"),
		},
	});

	expect(registrations.commands).toEqual(["ctx"]);
	const command = commandDefinitions.get("ctx");
	expect(command?.description).toBe(
		"Inspect and maintain Context · status | flush | wrapup [N] | recomp [start-end] | upgrade",
	);
	expect(command?.getArgumentCompletions?.("")).toEqual([
		{ description: "Open Context status and actions", label: "status", value: "status" },
		{ description: "Apply queued drops on the next message", label: "flush", value: "flush" },
		{ description: "Compact older history; keep 20 messages by default", label: "wrapup", value: "wrapup" },
		{ description: "Rebuild compartments from raw history", label: "recomp", value: "recomp" },
		{ description: "Upgrade legacy session history and memories", label: "upgrade", value: "upgrade" },
	]);
	expect(command?.getArgumentCompletions?.("wr")).toEqual([
		{ description: "Compact older history; keep 20 messages by default", label: "wrapup", value: "wrapup" },
	]);
	expect(command?.getArgumentCompletions?.("wrapup ")).toBeNull();
	expect(command?.getArgumentCompletions?.("recomp ")).toBeNull();
	expect(command?.getArgumentCompletions?.("wrapup\t")).toBeNull();
	await command?.handler?.("constructor", ctx);
	expect(uiCalls).toEqual(["notify:Usage: /ctx [status|flush|wrapup [N]|recomp [start-end]|upgrade]"]);
	uiCalls.length = 0;

	await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);
	await emit(handlers, "input", { type: "input", text: "direct", source: "rpc" }, ctx);
	await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
	await command?.handler?.("wrapup 30", ctx);

	expect(commandCalls).toEqual(["ctx-wrapup:30"]);
	expect(uiCalls).toEqual([]);
	expect(registrations.commands).toEqual(["ctx"]);
	expect(registrations.entryRenderers).toEqual(["pi-stuff-context-activity"]);
	expect(tools.some((tool) => tool.name === "todowrite")).toBeFalse();
});
