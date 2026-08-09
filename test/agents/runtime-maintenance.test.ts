import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initializeWriterProcessRegistry } from "../../packages/pi-stuff-agents/src/runs/background/writer-process-registry.js";
import { maintainAgentRuntime } from "../../packages/pi-stuff-agents/src/runtime/runtime-maintenance.js";
import { readProcessStartIdentity } from "../../packages/pi-stuff-agents/src/shared/process-identity.js";

const roots = new Set<string>();

afterEach(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
	roots.clear();
});

function fixture(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-runtime-maintenance-"));
	roots.add(root);
	return root;
}

function terminalRun(
	root: string,
	kind: "foreground" | "async" | "nested",
	runId: string,
	options: { endedAt?: number; processObserved?: boolean; eventBytes?: number; rootRunId?: string } = {},
): string {
	const parent =
		kind === "foreground"
			? path.join(root, "foreground-runs")
			: kind === "async"
				? path.join(root, "async-subagent-runs")
				: path.join(root, "nested-subagent-runs", options.rootRunId ?? "root-run");
	const directory = path.join(parent, runId);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const endedAt = options.endedAt ?? Date.now();
	fs.writeFileSync(
		path.join(directory, "status.json"),
		JSON.stringify({
			lifecycleArtifactVersion: 3,
			runId,
			mode: "single",
			state: "complete",
			startedAt: endedAt - 1_000,
			endedAt,
			lastUpdate: endedAt,
			...(options.processObserved
				? {
						processTerminal: {
							version: 1,
							state: "observed",
							runId,
							runnerProcessInstanceId: `${runId}-runner`,
							observedAt: endedAt,
							instances: [],
						},
					}
				: {}),
		}),
		{ mode: 0o600 },
	);
	initializeWriterProcessRegistry(directory, runId, process.pid, 1);
	if (options.eventBytes) fs.writeFileSync(path.join(directory, "events.jsonl"), "x".repeat(options.eventBytes));
	const timestamp = new Date(endedAt);
	fs.utimesSync(directory, timestamp, timestamp);
	return directory;
}

describe("Agent runtime maintenance", () => {
	test("reclaims only identity-proven abandoned preparation directories", async () => {
		const root = fixture();
		const foregroundRoot = path.join(root, "foreground-runs");
		fs.mkdirSync(foregroundRoot, { recursive: true, mode: 0o700 });
		const abandoned = path.join(foregroundRoot, "abandoned-prepare");
		const live = path.join(foregroundRoot, "live-prepare");
		for (const [directory, identity] of [
			[abandoned, "linux:proven-replaced"],
			[live, readProcessStartIdentity(process.pid)],
		] as const) {
			if (!identity) throw new Error("Test platform requires process-start identity support.");
			fs.mkdirSync(directory, { mode: 0o700 });
			const stat = fs.lstatSync(directory);
			fs.writeFileSync(
				path.join(directory, ".foreground-preparation-owner.json"),
				JSON.stringify({
					version: 2,
					token: "12345678-1234-1234-1234-123456789abc",
					pid: process.pid,
					processStartIdentity: identity,
					createdAt: Date.now(),
					device: stat.dev,
					inode: stat.ino,
				}),
				{ mode: 0o600 },
			);
		}

		const report = await maintainAgentRuntime(root);

		expect(report.abandonedPreparationsReclaimed).toBe(1);
		expect(fs.existsSync(abandoned)).toBeFalse();
		expect(fs.existsSync(live)).toBeTrue();
	});

	test("does not let more than one pass of foreground entries starve async and nested diagnostics", async () => {
		const root = fixture();
		const foreground = path.join(root, "foreground-runs");
		fs.mkdirSync(foreground, { recursive: true, mode: 0o700 });
		for (let index = 0; index < 5_001; index += 1) {
			fs.mkdirSync(path.join(foreground, `f-${String(index).padStart(4, "0")}`), { mode: 0o700 });
		}
		const asyncRun = terminalRun(root, "async", "async-fair", {
			endedAt: Date.now() - 2 * 60 * 60 * 1_000,
			processObserved: true,
			eventBytes: 300 * 1_024,
		});
		const nestedRun = terminalRun(root, "nested", "nested-fair", {
			endedAt: Date.now() - 2 * 60 * 60 * 1_000,
			processObserved: true,
			eventBytes: 300 * 1_024,
		});

		const report = await maintainAgentRuntime(root);

		expect(report.trimmed).toBe(2);
		expect(fs.statSync(path.join(asyncRun, "events.jsonl")).size).toBeLessThanOrEqual(256 * 1_024);
		expect(fs.statSync(path.join(nestedRun, "events.jsonl")).size).toBeLessThanOrEqual(256 * 1_024);
	}, 20_000);

	test("requires observed v3 process proof before trimming terminal diagnostics", async () => {
		const root = fixture();
		const run = terminalRun(root, "async", "missing-proof", { eventBytes: 300 * 1_024 });

		const report = await maintainAgentRuntime(root);

		expect(report.trimmed).toBe(0);
		expect(fs.statSync(path.join(run, "events.jsonl")).size).toBe(300 * 1_024);
	});

	test("trims terminal foreground v3 diagnostics without detached-runner proof", async () => {
		const root = fixture();
		const run = terminalRun(root, "foreground", "foreground-host-run", {
			endedAt: Date.now() - 2 * 60 * 60 * 1_000,
			eventBytes: 300 * 1_024,
		});

		const report = await maintainAgentRuntime(root);

		expect(report.trimmed).toBe(1);
		expect(fs.statSync(path.join(run, "events.jsonl")).size).toBeLessThanOrEqual(256 * 1_024);
	});

	test("never garbage-collects lifecycle evidence without a durable consumed marker protocol", async () => {
		const root = fixture();
		const run = terminalRun(root, "async", "retained-proof", {
			endedAt: Date.now() - 40 * 24 * 60 * 60 * 1_000,
			processObserved: true,
		});

		await maintainAgentRuntime(root);

		expect(fs.existsSync(run)).toBeTrue();
	});

	test("does not rewrite a recently terminal event stream while tracker cursors may still reference it", async () => {
		const root = fixture();
		const run = terminalRun(root, "async", "cursor-grace", {
			processObserved: true,
			eventBytes: 300 * 1_024,
		});
		const before = fs.statSync(path.join(run, "events.jsonl"));

		const report = await maintainAgentRuntime(root);
		const after = fs.statSync(path.join(run, "events.jsonl"));

		expect(report.trimmed).toBe(0);
		expect(after.ino).toBe(before.ino);
		expect(after.size).toBe(before.size);
	});
});
