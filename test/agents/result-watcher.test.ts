import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CompletionNotification } from "../../packages/pi-stuff-agents/src/runs/background/notify.js";
import { createResultWatcher } from "../../packages/pi-stuff-agents/src/runs/background/result-watcher.js";
import type { SubagentState } from "../../packages/pi-stuff-agents/src/shared/types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true });
});

describe("background result watcher", () => {
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
		} as unknown as SubagentState;
		const watcher = createResultWatcher({ events: { emit: () => {} } as never }, state, resultsDir, 60_000, {
			fs: {
				existsSync: fs.existsSync,
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
		for (let attempt = 0; attempt < 50 && delivered.length === 0; attempt++) await Bun.sleep(10);

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
		} as unknown as SubagentState;
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
		const projected = delivered[0] as unknown as Record<string, unknown>;
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
});
