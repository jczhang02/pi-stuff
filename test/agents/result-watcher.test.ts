import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRuntimeObject } from "../../packages/pi-stuff/src/shared/runtime-type.js";
import type { CompletionNotification } from "../../packages/pi-stuff/src/subagents/src/runs/background/notify.js";
import {
	createResultWatcher,
	type ResultWatcherState,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/result-watcher.js";
import { reconcileAsyncRun } from "../../packages/pi-stuff/src/subagents/src/runs/background/stale-run-reconciler.js";
import { readBoundedOwnedFileSnapshot } from "../../packages/pi-stuff/src/subagents/src/shared/private-directory.js";
import {
	type IntercomEventBus,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT,
	SUBAGENT_RESULT_INTERCOM_EVENT,
} from "../../packages/pi-stuff/src/subagents/src/shared/types.js";

const temporaryDirectories: string[] = [];

function createIntercomBus(deliveries: boolean[]) {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	const received: Array<Record<string, unknown>> = [];
	const bus: IntercomEventBus = {
		on(channel, handler) {
			const listeners = handlers.get(channel) ?? new Set();
			listeners.add(handler);
			handlers.set(channel, listeners);
			return () => listeners.delete(handler);
		},
		emit(channel, data) {
			if (channel === SUBAGENT_RESULT_INTERCOM_EVENT && data && isRuntimeObject(data)) {
				const payload = data as Record<string, unknown>;
				received.push(payload);
				const delivered = deliveries.shift() ?? false;
				for (const handler of handlers.get(SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT) ?? []) {
					handler({ requestId: payload.requestId, delivered });
				}
			}
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
	};
	return { bus, received };
}

function writeTargetedResult(resultsDir: string, id: string): string {
	const resultPath = path.join(resultsDir, `${id}.json`);
	fs.writeFileSync(
		resultPath,
		JSON.stringify({
			id,
			runId: id,
			sessionId: "root-session",
			intercomTarget: "parent-agent",
			success: true,
			state: "complete",
			summary: "cold completion",
			results: [{ agent: "worker", output: "done", success: true }],
		}),
	);
	return resultPath;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true });
});

describe("background result watcher", () => {
	test("awaits result snapshots without blocking the host event loop", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-async-read-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = path.join(resultsDir, "async-read.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({ id: "async-read", sessionId: "root-session", success: true, summary: "done" }),
		);
		const readStarted = Promise.withResolvers<void>();
		const releaseRead = Promise.withResolvers<void>();
		const delivered: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			readResultSnapshot: async (target, maxBytes) => {
				readStarted.resolve();
				await releaseRead.promise;
				return readBoundedOwnedFileSnapshot(target, maxBytes);
			},
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults();
		await readStarted.promise;
		let hostTimerFired = false;
		setTimeout(() => {
			hostTimerFired = true;
		}, 0);
		await Bun.sleep(10);
		expect(hostTimerFired).toBeTrue();
		releaseRead.resolve();
		for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) await Bun.sleep(10);

		expect(delivered).toHaveLength(1);
		expect(fs.existsSync(resultPath)).toBeFalse();
		watcher.stopResultWatcher();
	});

	test("reads an unchanged foreign-session result once and revisits an atomic replacement", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-foreign-cache-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = path.join(resultsDir, "shared-name.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({ id: "shared-name", sessionId: "other-session", success: true, summary: "foreign" }),
		);
		let reads = 0;
		const delivered: CompletionNotification[] = [];
		const inertWatcher = {
			close: () => {},
			on: () => inertWatcher,
			unref: () => inertWatcher,
		};
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			fs: {
				existsSync: fs.existsSync,
				lstatSync: fs.lstatSync,
				readFileSync: fs.readFileSync,
				unlinkSync: fs.unlinkSync,
				readdirSync: fs.readdirSync,
				realpathSync: fs.realpathSync,
				watch: (() => inertWatcher) as never,
			},
			readResultSnapshot: (target, maxBytes) => {
				reads += 1;
				return readBoundedOwnedFileSnapshot(target, maxBytes);
			},
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
			safetyScanIntervalMs: 60_000,
		});

		watcher.startResultWatcher();
		for (let scan = 0; scan < 3; scan += 1) {
			watcher.primeExistingResults();
			await Bun.sleep(100);
		}
		expect(reads).toBe(1);
		expect(fs.existsSync(resultPath)).toBe(true);

		const replacement = path.join(resultsDir, ".shared-name.replacement");
		fs.writeFileSync(
			replacement,
			JSON.stringify({
				id: "shared-name",
				parentRunOrigin: "user",
				sessionId: "root-session",
				success: true,
				summary: "now local",
			}),
		);
		fs.renameSync(replacement, resultPath);
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) await Bun.sleep(10);

		expect(reads).toBe(2);
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.parentRunOrigin).toBe("user");
		expect(fs.existsSync(resultPath)).toBe(false);
		watcher.stopResultWatcher();
	});

	test("caches an unchanged invalid async binding and revisits an atomic replacement", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-invalid-cache-"));
		temporaryDirectories.push(root);
		const resultsDir = path.join(root, "results");
		const asyncDirRoot = path.join(root, "async");
		fs.mkdirSync(resultsDir, { mode: 0o700 });
		fs.mkdirSync(asyncDirRoot, { mode: 0o700 });
		const resultPath = path.join(resultsDir, "unsafe-binding.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({
				id: "unsafe-binding",
				runId: "unsafe-binding",
				sessionId: "root-session",
				asyncDir: path.join(root, "outside-runtime"),
				success: true,
				summary: "unsafe",
			}),
		);
		let reads = 0;
		const delivered: CompletionNotification[] = [];
		const inertWatcher = { close: () => {}, on: () => inertWatcher, unref: () => inertWatcher };
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			asyncDirRoot,
			fs: {
				existsSync: fs.existsSync,
				lstatSync: fs.lstatSync,
				readFileSync: fs.readFileSync,
				unlinkSync: fs.unlinkSync,
				readdirSync: fs.readdirSync,
				realpathSync: fs.realpathSync,
				watch: (() => inertWatcher) as never,
			},
			readResultSnapshot: (target, maxBytes) => {
				reads += 1;
				return readBoundedOwnedFileSnapshot(target, maxBytes);
			},
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
			safetyScanIntervalMs: 60_000,
		});

		watcher.startResultWatcher();
		for (let scan = 0; scan < 3; scan += 1) {
			watcher.primeExistingResults();
			await Bun.sleep(100);
		}
		expect(reads).toBe(1);
		expect(fs.existsSync(resultPath)).toBeTrue();

		const replacement = path.join(resultsDir, ".unsafe-binding.replacement");
		fs.writeFileSync(
			replacement,
			JSON.stringify({ id: "unsafe-binding", sessionId: "root-session", success: true, summary: "safe now" }),
		);
		fs.renameSync(replacement, resultPath);
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) await Bun.sleep(10);

		expect(reads).toBe(2);
		expect(delivered).toHaveLength(1);
		expect(fs.existsSync(resultPath)).toBeFalse();
		watcher.stopResultWatcher();
	});

	test("contains a durable result-claim release failure", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-release-failure-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = path.join(resultsDir, "release-failure.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({ id: "release-failure", sessionId: "root-session", success: true, summary: "done" }),
		);
		const unhandled: unknown[] = [];
		const onUnhandled = (cause: unknown) => unhandled.push(cause);
		process.on("unhandledRejection", onUnhandled);
		let releases = 0;
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			acquireClaim: () => ({
				directory: path.join(resultsDir, "fake.lock"),
				token: "fake",
				release: () => {
					releases += 1;
					throw Object.assign(new Error("injected claim close EIO"), { code: "EIO" });
				},
			}),
		});

		try {
			watcher.startResultWatcher();
			watcher.primeExistingResults();
			for (let attempt = 0; attempt < 100 && fs.existsSync(resultPath); attempt += 1) await Bun.sleep(10);
			await Bun.sleep(25);
			expect(fs.existsSync(resultPath)).toBeFalse();
			expect(releases).toBe(1);
			expect(unhandled).toEqual([]);
		} finally {
			watcher.stopResultWatcher();
			process.off("unhandledRejection", onUnhandled);
		}
	});

	test("delivers a cold targeted result without waking the main model, then deletes it after acknowledgement", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-cold-target-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = writeTargetedResult(resultsDir, "cold-target");
		const { bus, received } = createIntercomBus([true]);
		const notifications: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: bus } as never, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					notifications.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults({ triggerTurn: false });
		for (let attempt = 0; attempt < 100 && fs.existsSync(resultPath); attempt += 1) await Bun.sleep(10);

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ to: "parent-agent", runId: "cold-target" });
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.triggerTurn).toBe(false);
		expect(fs.existsSync(resultPath)).toBe(false);
		watcher.stopResultWatcher();
	});

	test("retains and retries a cold targeted result until target delivery is acknowledged", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-cold-retry-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = writeTargetedResult(resultsDir, "cold-retry");
		const { bus, received } = createIntercomBus([false, true]);
		const notifications: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: bus } as never, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					notifications.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults({ triggerTurn: false });
		for (let attempt = 0; attempt < 100 && received.length < 1; attempt += 1) await Bun.sleep(10);
		expect(received).toHaveLength(1);
		expect(fs.existsSync(resultPath)).toBe(true);
		for (let attempt = 0; attempt < 100 && received.length < 2; attempt += 1) await Bun.sleep(10);
		for (let attempt = 0; attempt < 100 && fs.existsSync(resultPath); attempt += 1) await Bun.sleep(10);

		expect(received).toHaveLength(2);
		expect(received[0]?.requestId).toBe(received[1]?.requestId);
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.triggerTurn).toBe(false);
		expect(fs.existsSync(resultPath)).toBe(false);
		watcher.stopResultWatcher();
	});

	test("repairs terminal status before deleting an accepted result so reload cannot invent a crash", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-reload-"));
		temporaryDirectories.push(root);
		const resultsDir = path.join(root, "results");
		const asyncDir = path.join(root, "reload-safe-result");
		fs.mkdirSync(resultsDir);
		fs.mkdirSync(asyncDir);
		const resultPath = path.join(resultsDir, "reload-safe-result.json");
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId: "reload-safe-result",
				sessionId: "root-session",
				mode: "single",
				state: "running",
				pid: 2_147_000_000,
				startedAt: 1_000,
				lastUpdate: 1_500,
				steps: [{ agent: "writer", status: "complete", startedAt: 1_000, endedAt: 2_000, exitCode: 0 }],
			}),
		);
		fs.writeFileSync(
			resultPath,
			JSON.stringify({
				id: "reload-safe-result",
				runId: "reload-safe-result",
				sessionId: "root-session",
				parentRunOrigin: "user",
				asyncDir,
				mode: "single",
				state: "complete",
				success: true,
				summary: "completed before final status write",
				startedAt: 1_000,
				endedAt: 2_000,
				results: [{ agent: "writer", output: "done", success: true, exitCode: 0 }],
			}),
		);

		const delivered: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 100 && fs.existsSync(resultPath); attempt++) await Bun.sleep(10);
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.parentRunOrigin).toBe("user");
		expect(fs.existsSync(resultPath)).toBe(false);
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			parentRunOrigin: "user",
			state: "complete",
			steps: [{ status: "complete" }],
		});

		const reloaded = reconcileAsyncRun(asyncDir, {
			resultsDir,
			kill: () => {
				throw Object.assign(new Error("gone"), { code: "ESRCH" });
			},
		});
		expect(reloaded).toMatchObject({ repaired: false, status: { state: "complete" } });
		expect(fs.existsSync(resultPath)).toBe(false);
		watcher.stopResultWatcher();
	});

	test("delivers a durable result once while missing status is repaired with bounded retry", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-missing-status-"));
		temporaryDirectories.push(root);
		const resultsDir = path.join(root, "results");
		const asyncDir = path.join(root, "late-status");
		fs.mkdirSync(resultsDir);
		const resultPath = path.join(resultsDir, "late-status.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({
				id: "late-status",
				runId: "late-status",
				sessionId: "root-session",
				asyncDir,
				mode: "single",
				state: "complete",
				success: true,
				summary: "durable completion",
				startedAt: 1_000,
				endedAt: 2_000,
				results: [{ agent: "writer", output: "done", success: true, exitCode: 0 }],
			}),
		);
		const delivered: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults({ triggerTurn: false });
		for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt++) await Bun.sleep(10);
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.triggerTurn).toBe(false);
		expect(fs.existsSync(resultPath)).toBe(true);
		await Bun.sleep(650);
		expect(delivered).toHaveLength(1);

		fs.mkdirSync(asyncDir);
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId: "late-status",
				sessionId: "root-session",
				mode: "single",
				state: "running",
				pid: process.pid,
				startedAt: 1_000,
				lastUpdate: 1_500,
				steps: [{ agent: "writer", status: "complete", exitCode: 0 }],
			}),
		);
		for (let attempt = 0; attempt < 300 && fs.existsSync(resultPath); attempt++) await Bun.sleep(10);
		expect(delivered).toHaveLength(1);
		expect(fs.existsSync(resultPath)).toBe(false);
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			state: "complete",
		});
		watcher.stopResultWatcher();
	});

	test("recovers the final result name when fs.watch reports only its atomic temp rename", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-watcher-"));
		temporaryDirectories.push(resultsDir);
		const resultFile = "atomic-result.json";
		const resultPath = path.join(resultsDir, resultFile);
		fs.writeFileSync(
			resultPath,
			JSON.stringify({ id: "atomic-result", sessionId: "root-session", success: true, summary: "complete" }),
		);

		let watchListener:
			| ((event: "change" | "rename", filename: Buffer<ArrayBufferLike> | string | null) => void)
			| undefined;
		const fakeWatcher = {
			close: () => {},
			on: () => fakeWatcher,
			unref: () => fakeWatcher,
		};
		const delivered: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			fs: {
				existsSync: fs.existsSync,
				lstatSync: fs.lstatSync,
				mkdirSync: fs.mkdirSync,
				readFileSync: fs.readFileSync,
				readdirSync: fs.readdirSync,
				realpathSync: fs.realpathSync,
				unlinkSync: fs.unlinkSync,
				watch: (_directory: unknown, listener: typeof watchListener) => {
					watchListener = listener;
					return fakeWatcher;
				},
			} as never,
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		if (!watchListener) throw new Error("Expected fs.watch listener");
		watchListener("rename", `.${resultFile}.321.123456.abc123.tmp`);
		for (let attempt = 0; attempt < 50 && (delivered.length === 0 || fs.existsSync(resultPath)); attempt += 1) {
			await Bun.sleep(10);
		}

		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toMatchObject({ id: "atomic-result", sessionId: "root-session", triggerTurn: true });
		expect(fs.existsSync(resultPath)).toBe(false);
		watcher.stopResultWatcher();
	});

	test("projects legacy result files onto the single/parallel completion contract", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-contract-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = path.join(resultsDir, "legacy-result.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({
				id: "legacy-result",
				runId: "legacy-result",
				sessionId: "root-session",
				mode: "chain",
				success: true,
				summary: "complete",
				sessionFile: "/tmp/root-session.jsonl",
				chainStepCount: 2,
				workflowGraph: { nodes: [] },
				shareUrl: "https://example.invalid/shared",
				shareError: "legacy failure",
				memory: { scope: "project" },
				parallelHandoff: { path: "/tmp/retired-parallel-handoff.json" },
				results: [
					{
						agent: "writer",
						output: "implemented",
						success: true,
						sessionFile: "/tmp/writer.jsonl",
						transcriptPath: "/tmp/writer.md",
						shareUrl: "https://example.invalid/child",
					},
					{ agent: "reviewer", output: "reviewed", success: true },
				],
			}),
		);

		const delivered: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 50 && delivered.length === 0; attempt++) await Bun.sleep(10);

		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toMatchObject({
			id: "legacy-result",
			runId: "legacy-result",
			mode: "parallel",
			sessionFile: "/tmp/root-session.jsonl",
		});
		const projected = delivered[0] as Record<string, unknown>;
		for (const retired of [
			"chainStepCount",
			"workflowGraph",
			"shareUrl",
			"shareError",
			"memory",
			"parallelHandoff",
		]) {
			expect(projected).not.toHaveProperty(retired);
		}
		const children = projected.results as Array<Record<string, unknown>>;
		expect(children[0]).toMatchObject({
			sessionFile: "/tmp/writer.jsonl",
			transcriptPath: "/tmp/writer.md",
		});
		expect(children[0]).not.toHaveProperty("shareUrl");
		watcher.stopResultWatcher();
	});

	test("preserves completed and paused child truth in one grouped result", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-mixed-state-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = path.join(resultsDir, "mixed-state.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({
				id: "mixed-state",
				runId: "mixed-state",
				sessionId: "root-session",
				mode: "parallel",
				state: "paused",
				success: false,
				summary: "one completed, one paused",
				results: [
					{ agent: "writer", output: "finished", success: true },
					{ agent: "reviewer", output: "paused", success: false, interrupted: true },
				],
			}),
		);

		const delivered: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					delivered.push(notification);
					return true;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 50 && delivered.length === 0; attempt++) await Bun.sleep(10);

		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.results).toMatchObject([
			{ agent: "writer", status: "completed" },
			{ agent: "reviewer", status: "paused" },
		]);
		watcher.stopResultWatcher();
	});

	test("does not let an old epoch release a restarted delivery attempt", async () => {
		const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-epoch-race-"));
		temporaryDirectories.push(resultsDir);
		const resultPath = path.join(resultsDir, "epoch-race.json");
		fs.writeFileSync(
			resultPath,
			JSON.stringify({ id: "epoch-race", sessionId: "root-session", success: true, summary: "complete" }),
		);
		const deliveries: Array<{
			promise: Promise<boolean>;
			resolve: (value: boolean | PromiseLike<boolean>) => void;
			reject: (cause?: unknown) => void;
		}> = [];
		let calls = 0;
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			notifier: {
				deliver: async () => {
					calls += 1;
					const pending = Promise.withResolvers<boolean>();
					deliveries.push(pending);
					return pending.promise;
				},
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 100 && calls < 1; attempt += 1) await Bun.sleep(5);
		watcher.stopResultWatcher();
		watcher.startResultWatcher();
		watcher.primeExistingResults();
		for (let attempt = 0; attempt < 100 && calls < 2; attempt += 1) await Bun.sleep(5);
		expect(calls).toBe(2);

		deliveries[0]?.resolve(true);
		await Bun.sleep(20);
		watcher.primeExistingResults();
		await Bun.sleep(100);
		expect(calls).toBe(2);

		deliveries[1]?.resolve(true);
		for (let attempt = 0; attempt < 100 && fs.existsSync(resultPath); attempt += 1) await Bun.sleep(5);
		expect(fs.existsSync(resultPath)).toBe(false);
		watcher.stopResultWatcher();
	});

	test("restores nested user takeover attribution before emitting a cold completion", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-nested-origin-"));
		temporaryDirectories.push(root);
		const resultsDir = path.join(root, "results");
		const asyncDirRoot = path.join(root, "async");
		const runId = "nested-origin";
		const asyncDir = path.join(asyncDirRoot, runId);
		fs.mkdirSync(resultsDir, { recursive: true });
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId: "root-session",
				parentRunOrigin: "automatic",
				mode: "single",
				state: "complete",
				startedAt: 1,
				endedAt: 2,
				lastUpdate: 2,
				steps: [{ agent: "worker", status: "complete" }],
				nestedRoute: {
					rootRunId: runId,
					eventSink: path.join(root, "nested", "events"),
					controlInbox: path.join(root, "nested", "control"),
					capabilityToken: "b".repeat(32),
				},
			}),
		);
		const resultPath = path.join(resultsDir, `${runId}.json`);
		fs.writeFileSync(
			resultPath,
			JSON.stringify({
				id: runId,
				runId,
				sessionId: "root-session",
				parentRunOrigin: "automatic",
				asyncDir,
				mode: "single",
				state: "complete",
				success: true,
				summary: "done",
				results: [{ agent: "worker", output: "done", success: true }],
			}),
		);

		const emitted: CompletionNotification[] = [];
		const notifications: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher(
			{
				events: {
					emit: (channel: string, data: unknown) => {
						if (channel === SUBAGENT_ASYNC_COMPLETE_EVENT) emitted.push(data as CompletionNotification);
					},
				},
			} as never,
			state,
			resultsDir,
			60_000,
			{
				asyncDirRoot,
				notifier: {
					deliver: async (notification) => {
						notifications.push(notification);
						return true;
					},
				},
				projectNestedEvents: async () =>
					({
						version: 3,
						rootRunId: runId,
						updatedAt: 3,
						children: [
							{
								id: "nested-child",
								parentRunId: runId,
								parentRunOrigin: "user",
								depth: 1,
								path: [{ runId }],
								state: "complete",
							},
						],
					}) as never,
			},
		);

		watcher.startResultWatcher();
		watcher.primeExistingResults({ triggerTurn: false });
		for (let attempt = 0; attempt < 100 && emitted.length === 0; attempt += 1) await Bun.sleep(10);

		expect(notifications[0]?.parentRunOrigin).toBe("user");
		expect(emitted[0]?.parentRunOrigin).toBe("user");
		expect(notifications[0]).toMatchObject({ nestedChildren: [{ parentRunOrigin: "user" }] });
		watcher.stopResultWatcher();
	});

	test("does not deliver an old-session result after an awaited nested projection", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-result-projection-epoch-"));
		temporaryDirectories.push(root);
		const resultsDir = path.join(root, "results");
		const runId = "projection-epoch";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(resultsDir);
		fs.mkdirSync(asyncDir);
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId: "root-session",
				mode: "single",
				state: "running",
				pid: process.pid,
				startedAt: 1,
				lastUpdate: 1,
				steps: [{ agent: "worker", status: "running" }],
				nestedRoute: {
					rootRunId: runId,
					eventSink: path.join(root, "nested", "events"),
					controlInbox: path.join(root, "nested", "control"),
					capabilityToken: "a".repeat(32),
				},
			}),
		);
		writeTargetedResult(resultsDir, runId);
		const resultPath = path.join(resultsDir, `${runId}.json`);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
		fs.writeFileSync(resultPath, JSON.stringify({ ...result, asyncDir }));

		const projectionStarted = Promise.withResolvers<void>();
		const projectionRelease = Promise.withResolvers<void>();
		const { bus, received } = createIntercomBus([true]);
		const notifications: CompletionNotification[] = [];
		const state = {
			completionSeen: new Map<string, number>(),
			currentSessionId: "root-session",
			resultFileCoalescer: { clear: () => {}, schedule: () => false },
			watcher: null,
			watcherRestartTimer: null,
		} satisfies ResultWatcherState;
		const watcher = createResultWatcher({ events: bus } as never, state, resultsDir, 60_000, {
			notifier: {
				deliver: async (notification) => {
					notifications.push(notification);
					return true;
				},
			},
			projectNestedEvents: async () => {
				projectionStarted.resolve();
				await projectionRelease.promise;
				return { version: 3, rootRunId: runId, updatedAt: Date.now(), children: [] } as never;
			},
		});

		watcher.startResultWatcher();
		watcher.primeExistingResults({ triggerTurn: false });
		await projectionStarted.promise;
		watcher.stopResultWatcher();
		state.currentSessionId = "replacement-session";
		projectionRelease.resolve();
		await Bun.sleep(50);

		expect(received).toEqual([]);
		expect(notifications).toEqual([]);
		expect(fs.existsSync(resultPath)).toBeTrue();
	});
});
