import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, Model, UserMessage } from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionContext,
	ExtensionEvent,
	MessageEndEvent,
	SessionBeforeCompactEvent,
	SessionBeforeSwitchEvent,
	SessionEntry,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import type {
	MagicContextEventMap,
	MagicContextEventName,
} from "../../packages/pi-stuff/src/context-management/magic-context-types.js";
import { magicContextWorkerFactory } from "../../packages/pi-stuff/src/context-management/magic-worker-client.js";
import { MagicWorkerContextStore } from "../../packages/pi-stuff/src/context-management/magic-worker-context.js";
import {
	applyMagicWorkerHostCompaction,
	applyMagicWorkerHostEffect,
	writeMagicWorkerSyncResponse,
} from "../../packages/pi-stuff/src/context-management/magic-worker-host.js";
import {
	MAGIC_WORKER_SYNC_BUFFER_BYTES,
	type MagicWorkerEffectMessage,
	type MagicWorkerInvocationRequest,
	type MagicWorkerSyncEffectMessage,
} from "../../packages/pi-stuff/src/context-management/magic-worker-protocol.js";
import { installEffectFoundation } from "../../packages/pi-stuff/src/shared/effect-foundation.js";
import { captureExtensionHandlers, createExtensionApi } from "../fixtures/extension-api.js";
import { createExtensionContext } from "../fixtures/extension-context.js";

const MODEL: Model<Api> = {
	api: "openai-completions",
	baseUrl: "http://127.0.0.1.invalid",
	contextWindow: 128_000,
	cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
	id: "fixture-model",
	input: ["text"],
	maxTokens: 4_096,
	name: "Fixture",
	provider: "fixture",
	reasoning: false,
};

const ZERO_USAGE = {
	cacheRead: 0,
	cacheWrite: 0,
	cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
	input: 0,
	output: 0,
	totalTokens: 0,
};

type WorkerHandler = (
	event: ExtensionEvent,
	ctx: ExtensionContext,
) =>
	| MagicContextEventMap[MagicContextEventName]["result"]
	| Promise<MagicContextEventMap[MagicContextEventName]["result"]>;

interface WorkerHarnessState {
	branchReads: number;
	entryReads: number;
	currentBranch: SessionEntry[];
	currentLeafId: string | null;
}

function requireHandler(handlers: Map<string, WorkerHandler[]>, name: string): WorkerHandler {
	const handler = handlers.get(name)?.at(-1);
	if (!handler) throw new Error(`Magic Context did not register '${name}'.`);
	return handler;
}

function assistantMessage(text: string): AssistantMessage {
	return {
		api: MODEL.api,
		content: [{ text, type: "text" }],
		model: MODEL.id,
		provider: MODEL.provider,
		role: "assistant",
		stopReason: "stop",
		timestamp: Date.now(),
		usage: ZERO_USAGE,
	};
}

function userMessage(text: string): UserMessage {
	return { content: [{ text, type: "text" }], role: "user", timestamp: Date.now() };
}

function messageEntry(id: string, message: AssistantMessage | UserMessage, parentId: string | null): SessionEntry {
	return { id, message, parentId, timestamp: new Date().toISOString(), type: "message" };
}

async function createMagicWorkerHarness() {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-magic-worker-"));
	const configDirectory = join(temporaryDirectory, "config", "cortexkit");
	const dataDirectory = join(temporaryDirectory, "data");
	const magicLog = join(temporaryDirectory, "magic-context.log");
	await mkdir(configDirectory, { recursive: true });
	await mkdir(dataDirectory, { recursive: true });
	await writeFile(
		join(configDirectory, "magic-context.jsonc"),
		`${JSON.stringify({
			dreamer: { disable: true },
			embedding: { provider: "off" },
			fail_closed_blocking: false,
			sidekick: { disable: true },
			todowrite: { enabled: false, overlay: false },
		})}\n`,
	);
	const originalEnvironment = {
		HF_HUB_OFFLINE: process.env["HF_HUB_OFFLINE"],
		HOME: process.env["HOME"],
		MAGIC_CONTEXT_TEST_DATA_DIR: process.env["MAGIC_CONTEXT_TEST_DATA_DIR"],
		MAGIC_CONTEXT_LOG_PATH: process.env["MAGIC_CONTEXT_LOG_PATH"],
		PI_OFFLINE: process.env["PI_OFFLINE"],
		XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"],
		XDG_DATA_HOME: process.env["XDG_DATA_HOME"],
	};
	Object.assign(process.env, {
		HF_HUB_OFFLINE: "1",
		HOME: temporaryDirectory,
		MAGIC_CONTEXT_TEST_DATA_DIR: dataDirectory,
		MAGIC_CONTEXT_LOG_PATH: magicLog,
		PI_OFFLINE: "1",
		XDG_CONFIG_HOME: join(temporaryDirectory, "config"),
	});
	delete process.env["XDG_DATA_HOME"];
	const handlers = new Map<string, WorkerHandler[]>();
	const registeredTools = new Set<string>();
	const commands = new Set<string>();
	const state: WorkerHarnessState = {
		branchReads: 0,
		entryReads: 0,
		currentBranch: [],
		currentLeafId: null,
	};
	const pi = createExtensionApi({
		on: captureExtensionHandlers(handlers),
		registerCommand: (name) => commands.add(name),
		registerTool: (tool) => registeredTools.add(tool.name),
	});
	const contextForSession = (id: string): ExtensionContext =>
		createExtensionContext({
			cwd: temporaryDirectory,
			getContextUsage: () => ({ contextWindow: 128_000, percent: 0, tokens: 0 }),
			hasUI: false,
			model: MODEL,
			sessionManager: {
				getBranch: () => {
					state.branchReads += 1;
					return state.currentBranch;
				},
				getEntry: (entryId: string) => {
					state.entryReads += 1;
					return state.currentBranch.find((entry) => entry.id === entryId);
				},
				getLeafId: () => state.currentLeafId,
				getSessionFile: () => undefined,
				getSessionId: () => id,
			},
			thinkingLevel: "off",
		});
	return {
		commands,
		contextForSession,
		handlers,
		magicLog,
		pi,
		registeredTools,
		state,
		cleanup: async () => {
			for (const [name, value] of Object.entries(originalEnvironment)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
			await rm(temporaryDirectory, { force: true, recursive: true });
		},
	};
}

test("the isolated engine keeps ordinary turns incremental and event payloads clone-safe", async () => {
	const harness = await createMagicWorkerHarness();
	const { commands, contextForSession, handlers, magicLog, pi, registeredTools, state } = harness;
	const context = contextForSession("worker-test-session");
	const foundation = installEffectFoundation(pi);
	await foundation.startSession(context.sessionManager);
	try {
		await magicContextWorkerFactory(pi);
		if (!handlers.has("context")) {
			await Bun.sleep(600);
			throw new Error(await readFile(magicLog, "utf8"));
		}
		expect(handlers.has("context")).toBeTrue();
		expect(handlers.has("session_start")).toBeTrue();
		expect(handlers.has("session_shutdown")).toBeTrue();
		expect([...registeredTools].sort()).toEqual(["ctx_expand", "ctx_memory", "ctx_note", "ctx_reduce", "ctx_search"]);
		expect(commands.has("ctx-status")).toBeTrue();

		const sessionStart: SessionStartEvent = { reason: "resume", type: "session_start" };
		await requireHandler(handlers, "session_start")(sessionStart, context);
		expect(state.branchReads).toBe(1);

		const beforeCompact: SessionBeforeCompactEvent = {
			branchEntries: [],
			preparation: {
				fileOps: { edited: new Set(), read: new Set(), written: new Set() },
				firstKeptEntryId: "worker-entry",
				isSplitTurn: false,
				messagesToSummarize: [],
				settings: { enabled: true, keepRecentTokens: 8_192, reserveTokens: 16_384 },
				tokensBefore: 0,
				turnPrefixMessages: [],
			},
			reason: "manual",
			signal: new AbortController().signal,
			type: "session_before_compact",
			willRetry: false,
		};
		expect(await requireHandler(handlers, "session_before_compact")(beforeCompact, context)).toEqual({
			cancel: true,
		});
		expect(state.branchReads).toBe(1);
		const cancelled = new AbortController();
		cancelled.abort(new Error("already cancelled"));
		await expect(
			requireHandler(handlers, "session_before_compact")({ ...beforeCompact, signal: cancelled.signal }, context),
		).rejects.toThrow("already cancelled");

		const taggedMessage = assistantMessage("§1§ WORKER_INCREMENTAL_INDEX_EVIDENCE");
		const projectedMessage = assistantMessage("WORKER_INCREMENTAL_INDEX_EVIDENCE");
		projectedMessage.timestamp = taggedMessage.timestamp;
		const messageEnd: MessageEndEvent = { message: taggedMessage, type: "message_end" };
		const messageResult = await requireHandler(handlers, "message_end")(messageEnd, context);
		expect(messageResult).toEqual({ message: projectedMessage });
		state.currentLeafId = "worker-entry";
		state.currentBranch = [messageEntry(state.currentLeafId, projectedMessage, null)];
		await Bun.sleep(20);
		expect(state.branchReads).toBe(1);
		expect(state.entryReads).toBe(1);

		const user = userMessage("WORKER_INCREMENTAL_USER_EVIDENCE");
		state.currentLeafId = "worker-user-entry";
		state.currentBranch = [...state.currentBranch, messageEntry(state.currentLeafId, user, "worker-entry")];
		const contextEvent: ContextEvent = { messages: [projectedMessage, user], type: "context" };
		for (let turn = 0; turn < 2; turn += 1) {
			await requireHandler(handlers, "context")(contextEvent, context);
		}
		expect(state.branchReads).toBe(1);
		expect(state.entryReads).toBe(2);

		const branchMessage = userMessage("WORKER_BRANCH_SWITCH_EVIDENCE");
		state.currentLeafId = "worker-branch-entry";
		state.currentBranch = [messageEntry(state.currentLeafId, branchMessage, null)];
		const branchContextEvent: ContextEvent = { messages: [branchMessage], type: "context" };
		for (let turn = 0; turn < 2; turn += 1) {
			await requireHandler(handlers, "context")(branchContextEvent, context);
		}
		expect(state.branchReads).toBe(2);
		expect(state.entryReads).toBe(3);

		interface CyclicDetails {
			self?: CyclicDetails;
		}
		const cyclicDetails: CyclicDetails = {};
		cyclicDetails.self = cyclicDetails;
		for (const details of [() => undefined, cyclicDetails]) {
			const toolResult: ToolResultEvent = {
				content: [{ text: "clone-safe result", type: "text" }],
				details,
				input: {},
				isError: false,
				toolCallId: "clone-safe-tool",
				toolName: "custom_tool",
				type: "tool_result",
			};
			await requireHandler(handlers, "tool_result")(toolResult, context);
		}

		const beforeSwitch: SessionBeforeSwitchEvent = { reason: "resume", type: "session_before_switch" };
		await requireHandler(handlers, "session_before_switch")(beforeSwitch, context);

		const shutdown: SessionShutdownEvent = { reason: "quit", type: "session_shutdown" };
		const shutdownHandler = requireHandler(handlers, "session_shutdown");
		await shutdownHandler(shutdown, context);
		expect(await shutdownHandler(shutdown, context)).toBeUndefined();
	} finally {
		await foundation.shutdown();
		await harness.cleanup();
	}
});

test("an oversized synchronous Host response still wakes the Worker with a bounded error", () => {
	const buffer = new SharedArrayBuffer(MAGIC_WORKER_SYNC_BUFFER_BYTES);
	const control = new Int32Array(buffer, 0, 2);
	writeMagicWorkerSyncResponse(buffer, 2, "x".repeat(MAGIC_WORKER_SYNC_BUFFER_BYTES * 2));

	expect(Atomics.wait(control, 0, 0, 1)).toBe("not-equal");
	expect(Atomics.load(control, 0)).toBe(2);
	const length = Atomics.load(control, 1);
	const response = new TextDecoder().decode(new Uint8Array(buffer, Int32Array.BYTES_PER_ELEMENT * 2, length));
	expect(response).toBe("Magic Context Host effect response exceeded its buffer.");
});

test("the Host interpreter preserves append, send, notification, status, and compaction effects", () => {
	const observed: string[] = [];
	const pi = createExtensionApi({
		appendEntry: (customType) => observed.push(`append:${customType}`),
		sendMessage: (message) => observed.push(`send:${message.customType}`),
		sendUserMessage: (content) => observed.push(`user:${content}`),
	});
	const ctx = createExtensionContext({
		ui: {
			notify: (message) => observed.push(`notify:${message}`),
			setStatus: (key, value) => observed.push(`status:${key}:${value ?? ""}`),
		},
	});
	Reflect.set(ctx.sessionManager, "appendCompaction", (summary: string) => {
		observed.push(`compact:${summary}`);
		return "compaction-entry";
	});
	const effects = [
		{ args: ["worker-entry", { value: 1 }], name: "appendEntry", sessionId: "session", type: "effect" },
		{
			args: [{ content: "continue", customType: "worker-message", display: false }],
			name: "sendMessage",
			sessionId: "session",
			type: "effect",
		},
		{ args: ["next"], name: "sendUserMessage", sessionId: "session", type: "effect" },
		{ args: ["notice", "info"], name: "notify", sessionId: "session", type: "effect" },
		{ args: ["magic", "working"], name: "setStatus", sessionId: "session", type: "effect" },
	] satisfies MagicWorkerEffectMessage[];
	let synchronizations = 0;
	for (const effect of effects) {
		Effect.runSync(
			applyMagicWorkerHostEffect(pi, ctx, effect, () => {
				synchronizations++;
			}),
		);
	}
	const compaction = {
		args: ["managed summary", "first-kept", 42_000],
		buffer: new SharedArrayBuffer(MAGIC_WORKER_SYNC_BUFFER_BYTES),
		name: "appendCompaction",
		sessionId: "session",
		type: "sync-effect",
	} satisfies MagicWorkerSyncEffectMessage;
	expect(
		Effect.runSync(
			applyMagicWorkerHostCompaction(ctx, compaction, () => {
				synchronizations++;
			}),
		),
	).toBe("compaction-entry");
	expect(observed).toEqual([
		"append:worker-entry",
		"send:worker-message",
		"user:next",
		"notify:notice",
		"status:magic:working",
		"compact:managed summary",
	]);
	expect(synchronizations).toBe(2);
});

test("the Host interpreter fails closed for inactive Sessions, Host exceptions, and unsupported compaction", () => {
	const inactive = {
		args: ["notice", "info"],
		name: "notify",
		sessionId: "inactive",
		type: "effect",
	} satisfies MagicWorkerEffectMessage;
	expect(() =>
		Effect.runSync(applyMagicWorkerHostEffect(createExtensionApi(), undefined, inactive, () => undefined)),
	).toThrow("Magic Context emitted 'notify' for an inactive Session.");

	const appendFailure = {
		args: ["worker-entry"],
		name: "appendEntry",
		sessionId: undefined,
		type: "effect",
	} satisfies MagicWorkerEffectMessage;
	expect(() =>
		Effect.runSync(
			applyMagicWorkerHostEffect(
				createExtensionApi({
					appendEntry: () => {
						throw new Error("append failed");
					},
				}),
				undefined,
				appendFailure,
				() => undefined,
			),
		),
	).toThrow("append failed");

	const ctx = createExtensionContext();
	Reflect.set(ctx.sessionManager, "appendCompaction", undefined);
	const unsupported = {
		args: ["managed summary", "first-kept", 42_000],
		buffer: new SharedArrayBuffer(MAGIC_WORKER_SYNC_BUFFER_BYTES),
		name: "appendCompaction",
		sessionId: "session",
		type: "sync-effect",
	} satisfies MagicWorkerSyncEffectMessage;
	expect(() => Effect.runSync(applyMagicWorkerHostCompaction(ctx, unsupported, () => undefined))).toThrow(
		"Pi SessionManager does not expose appendCompaction.",
	);
});

test("an invocation cancelled while queued never reaches Magic Context", () => {
	const contexts = new MagicWorkerContextStore(() => undefined);
	const controller = new AbortController();
	const request = {
		args: "",
		context: {
			contextUsage: undefined,
			cwd: "/project",
			hasUI: false,
			mode: "rpc",
			model: undefined,
			session: { id: "cancelled-session", leafId: undefined },
			systemPrompt: "",
		},
		id: 1,
		name: "ctx-status",
		type: "command",
	} satisfies MagicWorkerInvocationRequest;
	let invoked = false;
	controller.abort(new Error("queued invocation cancelled"));

	expect(() =>
		contexts.run(request, controller, async () => {
			invoked = true;
		}),
	).toThrow("queued invocation cancelled");
	expect(invoked).toBeFalse();
});
