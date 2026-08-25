/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/no-runtime-typeof, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion -- This boundary test supplies deliberately loose Pi Extension fixtures to the private Worker adapter. */
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	finishMagicWorkerShutdown,
	magicContextWorkerFactory,
} from "../../packages/pi-stuff/src/context-management/magic-worker-client.js";

test("the isolated engine keeps ordinary turns incremental and event payloads clone-safe", async () => {
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
	const handlers = new Map<string, (event: ExtensionEvent, ctx: ExtensionContext) => Promise<unknown> | unknown>();
	const tools = new Map<string, ToolDefinition>();
	const commands = new Set<string>();
	let branchReads = 0;
	let entryReads = 0;
	let currentBranch: unknown[] = [];
	let currentLeafId: string | null = null;
	const pi = {
		appendEntry: () => undefined,
		getActiveTools: () => [],
		getAllTools: () => [],
		on: (name: string, handler: (event: ExtensionEvent, ctx: ExtensionContext) => Promise<unknown> | unknown) =>
			handlers.set(name, handler),
		registerCommand: (name: string) => commands.add(name),
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		sendMessage: () => undefined,
		sendUserMessage: () => undefined,
		setActiveTools: () => undefined,
	} as unknown as ExtensionAPI;
	const context = {
		cwd: temporaryDirectory,
		getContextUsage: () => ({ contextWindow: 128_000, percent: 0, tokens: 0 }),
		getSystemPrompt: () => "",
		hasPendingMessages: () => false,
		hasUI: false,
		isIdle: () => true,
		isProjectTrusted: () => true,
		mode: "tui",
		model: {
			api: "openai-completions",
			contextWindow: 128_000,
			cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
			id: "fixture-model",
			input: ["text"],
			maxTokens: 4_096,
			name: "Fixture",
			provider: "fixture",
			reasoning: false,
		},
		sessionManager: {
			getBranch: () => {
				branchReads += 1;
				return currentBranch;
			},
			getEntry: (id: string) => {
				entryReads += 1;
				return currentBranch.find(
					(entry) => entry !== null && typeof entry === "object" && "id" in entry && entry.id === id,
				);
			},
			getLeafId: () => currentLeafId,
			getSessionFile: () => undefined,
			getSessionId: () => "worker-test-session",
		} as unknown as ExtensionContext["sessionManager"],
		thinkingLevel: "off",
	} as ExtensionContext;
	try {
		await magicContextWorkerFactory(pi);
		if (!handlers.has("context")) {
			await Bun.sleep(600);
			throw new Error(await readFile(magicLog, "utf8"));
		}
		expect(handlers.has("context")).toBeTrue();
		expect(handlers.has("session_start")).toBeTrue();
		expect(handlers.has("session_shutdown")).toBeTrue();
		expect([...tools.keys()].sort()).toEqual(["ctx_expand", "ctx_memory", "ctx_note", "ctx_reduce", "ctx_search"]);
		expect(commands.has("ctx-status")).toBeTrue();
		await handlers.get("session_start")?.({ type: "session_start", reason: "resume" } as ExtensionEvent, context);
		expect(branchReads).toBe(1);
		const beforeCompact = handlers.get("session_before_compact");
		expect(beforeCompact).toBeDefined();
		expect(
			await beforeCompact?.(
				{
					branchEntries: [],
					preparation: { irrelevant: () => undefined },
					reason: "manual",
					signal: new AbortController().signal,
					type: "session_before_compact",
					willRetry: false,
				} as unknown as ExtensionEvent,
				context,
			),
		).toEqual({ cancel: true });
		expect(branchReads).toBe(1);

		const messageEnd = handlers.get("message_end");
		expect(messageEnd).toBeDefined();
		const message = {
			api: "openai-completions",
			content: [{ type: "text", text: "§1§ WORKER_INCREMENTAL_INDEX_EVIDENCE" }],
			id: "worker-message",
			model: "fixture-model",
			provider: "fixture",
			role: "assistant",
			stopReason: "stop",
			timestamp: Date.now(),
			usage: { cacheRead: 0, cacheWrite: 0, cost: { total: 0 }, input: 0, output: 0, totalTokens: 0 },
		};
		const messageResult = await messageEnd?.({ message, type: "message_end" } as unknown as ExtensionEvent, context);
		expect(messageResult).toEqual({
			message: { ...message, content: [{ type: "text", text: "WORKER_INCREMENTAL_INDEX_EVIDENCE" }] },
		});
		currentLeafId = "worker-entry";
		currentBranch = [
			{
				id: currentLeafId,
				message: (messageResult as { readonly message: unknown }).message,
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
			},
		];
		await Bun.sleep(20);
		expect(branchReads).toBe(1);
		expect(entryReads).toBe(1);

		const contextHandler = handlers.get("context");
		expect(contextHandler).toBeDefined();
		const userMessage = {
			content: [{ type: "text", text: "WORKER_INCREMENTAL_USER_EVIDENCE" }],
			role: "user",
			timestamp: Date.now(),
		};
		currentLeafId = "worker-user-entry";
		currentBranch = [
			...currentBranch,
			{
				id: currentLeafId,
				message: userMessage,
				parentId: "worker-entry",
				timestamp: new Date().toISOString(),
				type: "message",
			},
		];
		for (let turn = 0; turn < 2; turn += 1) {
			await contextHandler?.(
				{
					messages: [(messageResult as { readonly message: unknown }).message, userMessage],
					type: "context",
				} as ExtensionEvent,
				context,
			);
		}
		expect(branchReads).toBe(1);
		expect(entryReads).toBe(2);

		const branchMessage = {
			content: [{ type: "text", text: "WORKER_BRANCH_SWITCH_EVIDENCE" }],
			role: "user",
			timestamp: Date.now(),
		};
		currentLeafId = "worker-branch-entry";
		currentBranch = [
			{
				id: currentLeafId,
				message: branchMessage,
				parentId: null,
				timestamp: new Date().toISOString(),
				type: "message",
			},
		];
		for (let turn = 0; turn < 2; turn += 1) {
			await contextHandler?.({ messages: [branchMessage], type: "context" } as ExtensionEvent, context);
		}
		expect(branchReads).toBe(2);
		expect(entryReads).toBe(3);

		const toolResult = handlers.get("tool_result");
		expect(toolResult).toBeDefined();
		const cyclicDetails = {};
		Reflect.set(cyclicDetails, "self", cyclicDetails);
		for (const details of [() => undefined, cyclicDetails]) {
			await toolResult?.(
				{
					content: [{ type: "text", text: "clone-safe result" }],
					details,
					input: {},
					isError: false,
					toolCallId: "clone-safe-tool",
					toolName: "custom_tool",
					type: "tool_result",
				} as ExtensionEvent,
				context,
			);
		}

		const beforeSwitch = handlers.get("session_before_switch");
		expect(beforeSwitch).toBeDefined();
		await beforeSwitch?.({ type: "session_before_switch", reason: "resume" } as ExtensionEvent, context);
		currentLeafId = null;
		currentBranch = [];
		const secondContext = {
			...context,
			sessionManager: {
				...context.sessionManager,
				getSessionId: () => "worker-second-session",
			},
		} as ExtensionContext;
		await handlers.get("session_start")?.(
			{ type: "session_start", reason: "resume" } as ExtensionEvent,
			secondContext,
		);
		expect(branchReads).toBe(3);

		const shutdown = handlers.get("session_shutdown");
		expect(shutdown).toBeDefined();
		await shutdown?.({ type: "session_shutdown", reason: "quit" } as ExtensionEvent, secondContext);
	} finally {
		for (const [name, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});

test("a hung upstream shutdown cannot keep the Worker alive", async () => {
	let closed = false;
	const startedAt = performance.now();
	await finishMagicWorkerShutdown(new Promise(() => undefined), async () => {
		closed = true;
	});

	expect(closed).toBeTrue();
	expect(performance.now() - startedAt).toBeLessThan(1_000);
});
