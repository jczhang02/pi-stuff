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
	getContextCapability,
	type Handler,
	type Handlers,
	piStuffContext,
	taggedMessage,
} from "./core-fixtures.js";

afterEach(cleanupContextCoreFixtures);

test("restores native compaction while a live Magic transform is unhealthy", async () => {
	const handlers: Handlers = new Map();
	const api = apiFor(handlers);
	let shouldFail = false;
	piStuffContext(api, {
		loadMagicContext: async () => ({
			default: async (pi: ExtensionAPI) => {
				// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
				const register = pi.on.bind(pi) as (event: string, handler: Handler) => void;
				register("context", (event) => {
					if (shouldFail) return;
					// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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

	shouldFail = true;
	const original = { type: "context", messages: [taggedMessage("native")] };
	expect(await emitResults(handlers, "context", original, ctx)).toEqual([{ messages: original.messages }]);
	expect(getContextCapability(ctx).status().state).toBe("degraded");
	expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([undefined]);

	shouldFail = false;
	const recovered = await emitResults(handlers, "context", original, ctx);
	expect(JSON.stringify(recovered)).toContain("healthy");
	expect(getContextCapability(ctx).status().state).toBe("active");
	expect(await emitResults(handlers, "session_before_compact", {}, ctx)).toEqual([undefined, { cancel: true }]);
});

test("yields extreme overflow to native compaction before Magic scans the Session", async () => {
	const handlers: Handlers = new Map();
	let compactionResults: unknown[] = [];
	let compactions = 0;
	let projections = 0;
	piStuffContext(apiFor(handlers), {
		loadMagicContext: async () => ({
			default: async (magicApi: ExtensionAPI) => {
				// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
				const register = magicApi.on.bind(magicApi) as (event: string, handler: Handler) => void;
				register("context", (event) => {
					projections++;
					// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
					const contextEvent = event as { messages: unknown[] };
					return {
						messages: [taggedMessage("<session-history>managed</session-history>"), ...contextEvent.messages],
					};
				});
				register("session_before_compact", () => ({ cancel: true }));
			},
		}),
		prepareMagicContext: async () => "ready",
		readNativeCompactionSettings: () => ({ enabled: true, reserveTokens: 20_000 }),
	});
	let tokens = 400_001;
	const ctx = Object.assign(context(), {
		compact: (options: CompactOptions) => {
			compactions++;
			void emitResults(handlers, "session_before_compact", {}, ctx).then((results) => {
				compactionResults = results;
				tokens = 1_000;
				options.onComplete?.(COMPACTION_RESULT);
			});
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: (tokens / 200_000) * 100, tokens }),
	});
	await emit(handlers, "session_start", { type: "session_start", reason: "startup" }, ctx);

	await emit(handlers, "before_agent_start", { type: "before_agent_start" }, ctx);
	expect(compactions).toBe(1);
	expect(compactionResults).toEqual([undefined, undefined]);
	expect(getContextCapability(ctx).status().state).toBe("degraded");
	expect(projections).toBe(0);

	await emitResults(handlers, "context", { type: "context", messages: [taggedMessage("native")] }, ctx);
	expect(getContextCapability(ctx).status().state).toBe("active");
	expect(projections).toBe(1);
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
	const { promise: compactionGate, resolve: releaseCompaction } = Promise.withResolvers<void>();
	const { promise: compactionEntered, resolve: markCompactionEntered } = Promise.withResolvers<void>();
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
});

test("does not stack native compaction after the Magic compaction hook throws", async () => {
	const handlers: Handlers = new Map();
	const api = apiFor(handlers);
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
	const ctx = createExtensionCommandContext({
		...context(),
		ui: { notify: (message: string) => notifications.push(message) },
	});
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
});
