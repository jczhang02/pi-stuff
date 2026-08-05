import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startMonitor } from "../../packages/pi-stuff-work/src/monitor.js";
import { BoundedOutputFile } from "../../packages/pi-stuff-work/src/output.js";
import { captureProcessIdentity, processExists, signalProcessGroup } from "../../packages/pi-stuff-work/src/process.js";
import { BackgroundWorkRuntime } from "../../packages/pi-stuff-work/src/runtime.js";
import { reconcileStaleRuns } from "../../packages/pi-stuff-work/src/storage.js";
import { isForegroundBashResult } from "../../packages/pi-stuff-work/src/tools.js";

const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
	for (const child of children.splice(0)) {
		if (child.pid && processExists(child.pid)) signalProcessGroup(child.pid, "SIGKILL");
	}
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-work-test-"));
	roots.push(root);
	return root;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(25);
	}
	throw new Error("timed out waiting for condition");
}

function context(cwd: string): ExtensionContext {
	return {
		cwd,
		model: undefined,
		sessionManager: {
			getSessionFile: () => join(cwd, "session.jsonl"),
			getSessionId: () => "work-test-session",
		},
		thinkingLevel: "off",
	} as unknown as ExtensionContext;
}

function runtime(cwd: string, messages: unknown[] = [], backgroundAfterMs?: number): BackgroundWorkRuntime {
	const pi = {
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI;
	return new BackgroundWorkRuntime({
		...(backgroundAfterMs !== undefined ? { backgroundAfterMs } : {}),
		cwd,
		pi,
		sessionId: "work-test-session",
	});
}

describe("bounded background output", () => {
	test("never exceeds its byte cap and strips terminal control sequences", () => {
		const root = temporaryRoot();
		const path = join(root, "output");
		const output = new BoundedOutputFile(path, 256);
		expect(output.append(Buffer.from(`\u001b[31m${"x".repeat(500)}\u001b[0m`))).toBe(false);
		output.close();
		expect(statSync(path).size).toBe(256);
		expect(output.recentText()).not.toContain("\u001b[");
		expect(output.recentText()).toContain("output limit reached");
	});
});

describe("BackgroundWorkRuntime", () => {
	test("preserves native raw Bash output in the persisted foreground result", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		const result = await active.executeBash(
			{ command: "printf '\\033[31mRAW_FOREGROUND\\033[0m\\n'", toolCallId: "tool-raw" },
			context(root),
		);
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toBe("\u001b[31mRAW_FOREGROUND\u001b[0m\n");
		expect(result.details).toBeUndefined();
		expect(isForegroundBashResult(result)).toBe(true);
		await active.shutdown();
	});

	test("preserves the native foreground failure wording", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		await expect(
			active.executeBash({ command: "printf FAILURE >&2; exit 7", toolCallId: "tool-failure" }, context(root)),
		).rejects.toThrow("FAILURE\n\nCommand exited with code 7");
		await active.shutdown();
	});

	test("moves only the active foreground Bash command and then cleans its process tree", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		const execution = active.executeBash({ command: "sleep 30", toolCallId: "tool-foreground" }, context(root));
		await Bun.sleep(100);
		expect(active.detachActiveForeground()).toBe(true);
		expect(active.detachActiveForeground()).toBe(false);
		const result = await execution;
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("manually moved to background task");
		expect(active.snapshot()).toHaveLength(1);
		await active.shutdown();
		expect(active.snapshot()).toHaveLength(0);
	});

	test("automatically hands off a foreground command after the configured production seam", async () => {
		const root = temporaryRoot();
		const active = runtime(root, [], 100);
		const result = await active.executeBash({ command: "sleep 30", toolCallId: "tool-automatic" }, context(root));
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("moved to background task");
		expect(isForegroundBashResult(result)).toBe(false);
		expect(active.snapshot()).toHaveLength(1);
		await active.shutdown();
	});

	test("kills TERM-ignoring descendants during session shutdown", async () => {
		const root = temporaryRoot();
		const childPath = join(root, "child.pid");
		const active = runtime(root);
		await active.executeBash(
			{
				command: `trap '' TERM HUP INT; sh -c 'trap "" TERM HUP INT; while :; do sleep 1; done' & echo $! > ${JSON.stringify(childPath)}; wait`,
				runInBackground: true,
				toolCallId: "tool-tree",
			},
			context(root),
		);
		await waitUntil(() => existsSync(childPath));
		const childPid = Number(readFileSync(childPath, "utf-8").trim());
		expect(processExists(childPid)).toBe(true);
		await active.shutdown();
		await waitUntil(() => !processExists(childPid));
		expect(existsSync(join(root, ".pi", "tasks"))).toBe(true);
		expect(readFileSync(childPath, "utf-8").trim()).toBe(String(childPid));
	});

	test("delivers a one-shot file Monitor result without conversational polling", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		const target = join(root, "ready.log");
		const started = startMonitor(
			active,
			{
				intervalSeconds: 0.1,
				source: "file",
				successText: "READY",
				target,
				timeoutSeconds: 3,
				toolCallId: "tool-monitor",
			},
			context(root),
		);
		expect(active.snapshot().map((item) => item.id)).toContain(started.id);
		writeFileSync(target, "booting\nREADY\n");
		await waitUntil(() => active.snapshot().length === 0);
		await waitUntil(() => messages.length === 1);
		const delivered = messages[0] as {
			message: { details: { outcomes: Array<{ status: string }> } };
			options: { triggerTurn: boolean };
		};
		expect(delivered.message.details.outcomes[0]?.status).toBe("completed");
		expect(delivered.options.triggerTurn).toBe(true);
		await active.shutdown();
	});

	test("enforces a Background Shell runtime timeout after returning control", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		await active.executeBash(
			{ command: "sleep 30", runInBackground: true, timeoutSeconds: 0.2, toolCallId: "tool-timeout" },
			context(root),
		);
		await waitUntil(() => active.snapshot().length === 0);
		await waitUntil(() => messages.length === 1);
		const delivered = messages[0] as { message: { details: { outcomes: Array<{ status: string }> } } };
		expect(delivered.message.details.outcomes[0]?.status).toBe("timed_out");
		await active.shutdown();
	});
});

describe("stale run reconciliation", () => {
	test("treats a reused PID identity as gone without signaling the new process", async () => {
		const root = temporaryRoot();
		const directory = join(root, ".pi", "tasks", "pi-stuff-stale-reused");
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(directory, "runtime.json"),
			JSON.stringify({
				owner: { pid: process.pid, started: "linux:stale-owner" },
				schemaVersion: 1,
				tasks: [{ id: "b-reused", supervisor: { pid: process.pid, started: "linux:reused" } }],
			}),
		);
		const result = await reconcileStaleRuns(root);
		expect(result).toEqual({ cleanedDirectories: 1, killedProcesses: 0, unresolvedDirectories: 0 });
		expect(processExists(process.pid)).toBe(true);
		expect(existsSync(directory)).toBe(false);
	});

	test("kills a verified process group left by a dead owner", async () => {
		if (process.platform !== "linux") return;
		const root = temporaryRoot();
		const directory = join(root, ".pi", "tasks", "pi-stuff-stale-live");
		mkdirSync(directory, { recursive: true });
		const child = spawn("/bin/sh", ["-c", "trap '' TERM HUP INT; while :; do sleep 1; done"], {
			detached: true,
			stdio: "ignore",
		});
		children.push(child);
		if (!child.pid) throw new Error("stale process fixture did not start");
		const childPid = child.pid;
		await waitUntil(() => captureProcessIdentity(childPid) !== undefined);
		const identity = captureProcessIdentity(childPid);
		if (!identity) throw new Error("stale process fixture has no identity");
		writeFileSync(
			join(directory, "runtime.json"),
			JSON.stringify({
				owner: { pid: process.pid, started: "linux:dead-owner" },
				schemaVersion: 1,
				tasks: [{ id: "b-stale", supervisor: identity }],
			}),
		);
		const result = await reconcileStaleRuns(root);
		expect(result.cleanedDirectories).toBe(1);
		expect(result.killedProcesses).toBe(1);
		await waitUntil(() => !processExists(identity.pid));
	});
});

describe("crash supervisor", () => {
	test("reaps a TERM-ignoring command tree after its Pi-like parent is killed", async () => {
		if (process.platform !== "linux") return;
		const root = temporaryRoot();
		const readyPath = join(root, "ready.json");
		const treePath = join(root, "tree.txt");
		const fixture = resolve(import.meta.dir, "../fixtures/work-supervisor-parent.mjs");
		const supervisor = resolve(import.meta.dir, "../../packages/pi-stuff-work/src/process-supervisor.mjs");
		const parent = spawn(process.execPath, [fixture, supervisor, readyPath, treePath], {
			cwd: root,
			stdio: "ignore",
		});
		children.push(parent);
		await waitUntil(() => existsSync(readyPath) && existsSync(treePath));
		const ready = JSON.parse(readFileSync(readyPath, "utf-8")) as {
			commandPid: number;
			parentPid: number;
			supervisorPid: number;
		};
		const treePids = readFileSync(treePath, "utf-8").trim().split(/\s+/u).map(Number);
		expect(treePids).toContain(ready.commandPid);
		for (const pid of [ready.supervisorPid, ...treePids]) expect(processExists(pid)).toBe(true);
		process.kill(ready.parentPid, "SIGKILL");
		await waitUntil(() => [ready.supervisorPid, ...treePids].every((pid) => !processExists(pid)), 10_000);
	});
});
