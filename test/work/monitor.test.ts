import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type MonitorInput, startMonitor } from "../../packages/pi-stuff-work/src/monitor.js";
import { BackgroundWorkRuntime } from "../../packages/pi-stuff-work/src/runtime.js";

const roots: string[] = [];
const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function setup(): {
	readonly context: ExtensionContext;
	readonly messages: Array<{
		message: { details: { outcomes: Array<{ status: string }> } };
		options: { triggerTurn: boolean };
	}>;
	readonly root: string;
	readonly runtime: BackgroundWorkRuntime;
} {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-monitor-test-"));
	roots.push(root);
	const messages: Array<{
		message: { details: { outcomes: Array<{ status: string }> } };
		options: { triggerTurn: boolean };
	}> = [];
	const pi = {
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options } as never),
	} as unknown as ExtensionAPI;
	const runtime = new BackgroundWorkRuntime({ cwd: root, pi, sessionId: "monitor-test" });
	const context = {
		cwd: root,
		model: undefined,
		sessionManager: {
			getSessionFile: () => join(root, "session.jsonl"),
			getSessionId: () => "monitor-test",
		},
	} as unknown as ExtensionContext;
	return { context, messages, root, runtime };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(25);
	}
	throw new Error("timed out waiting for Monitor result");
}

async function run(input: Omit<MonitorInput, "toolCallId">): Promise<string> {
	const state = setup();
	await startMonitor(state.runtime, { ...input, toolCallId: "monitor-call" }, state.context);
	await waitUntil(() => state.messages.length === 1);
	const status = state.messages[0]?.message.details.outcomes[0]?.status;
	await state.runtime.shutdown();
	return status ?? "missing";
}

describe("command Monitor", () => {
	test("completes on successful command evidence", async () => {
		expect(await run({ source: "command", successText: "READY", target: "printf READY", timeoutSeconds: 3 })).toBe(
			"completed",
		);
	});

	test("fails on explicit failure evidence", async () => {
		expect(await run({ failureText: "ERROR", source: "command", target: "printf ERROR", timeoutSeconds: 3 })).toBe(
			"failed",
		);
	});

	test("times out and terminates its owned command", async () => {
		expect(await run({ source: "command", target: "sleep 30", timeoutSeconds: 0.2 })).toBe("timed_out");
	});
});

describe("file and log Monitor", () => {
	test("ignores pre-existing log text by default", async () => {
		const state = setup();
		const path = join(state.root, "service.log");
		writeFileSync(path, "READY from an old run\n");
		const started = await startMonitor(
			state.runtime,
			{
				intervalSeconds: 0.1,
				source: "log",
				successText: "READY",
				target: path,
				timeoutSeconds: 3,
				toolCallId: "monitor-log",
			},
			state.context,
		);
		await Bun.sleep(250);
		expect(state.runtime.snapshot().map((item) => item.id)).toContain(started.id);
		expect(state.messages).toHaveLength(0);
		appendFileSync(path, "READY from this run\n");
		await waitUntil(() => state.messages.length === 1);
		expect(state.messages[0]?.message.details.outcomes[0]?.status).toBe("completed");
		await state.runtime.shutdown();
	});

	test("reports a permanent source error instead of polling forever", async () => {
		const state = setup();
		const directory = join(state.root, "not-a-file");
		mkdirSync(directory);
		await startMonitor(
			state.runtime,
			{
				intervalSeconds: 0.1,
				source: "file",
				successText: "READY",
				target: directory,
				timeoutSeconds: 3,
				toolCallId: "monitor-error",
			},
			state.context,
		);
		await waitUntil(() => state.messages.length === 1);
		expect(state.messages[0]?.message.details.outcomes[0]?.status).toBe("failed");
		await state.runtime.shutdown();
	});

	test("can be cancelled through the shared runtime", async () => {
		const state = setup();
		const started = await startMonitor(
			state.runtime,
			{
				intervalSeconds: 0.1,
				source: "file",
				target: join(state.root, "never"),
				timeoutSeconds: 3,
				toolCallId: "monitor-cancel",
			},
			state.context,
		);
		const outcome = await state.runtime.stop(started.id);
		expect(outcome.status).toBe("stopped");
		await Bun.sleep(250);
		expect(state.messages).toHaveLength(0);
		await state.runtime.shutdown();
	});
});

describe("HTTP Monitor", () => {
	test("waits through a non-ready response and completes on body evidence", async () => {
		let ready = false;
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response(ready ? "READY" : "booting", { status: ready ? 200 : 503 }),
		});
		servers.push(server);
		const state = setup();
		await startMonitor(
			state.runtime,
			{
				intervalSeconds: 0.1,
				source: "http",
				successText: "READY",
				target: `http://127.0.0.1:${String(server.port)}/health`,
				timeoutSeconds: 3,
				toolCallId: "monitor-http",
			},
			state.context,
		);
		await Bun.sleep(250);
		expect(state.messages).toHaveLength(0);
		ready = true;
		await waitUntil(() => state.messages.length === 1);
		expect(state.messages[0]?.message.details.outcomes[0]?.status).toBe("completed");
		await state.runtime.shutdown();
	});
});
