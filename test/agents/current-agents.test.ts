import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAsyncJobTracker } from "../../packages/pi-stuff-agents/src/runs/background/async-job-tracker.js";
import {
	type AgentControlAcknowledgement,
	type AgentRow,
	CurrentAgents,
	type CurrentAgentsOptions,
} from "../../packages/pi-stuff-agents/src/session/current-agents.js";
import type {
	AsyncJobState,
	ForegroundResumeRun,
	ForegroundRunControl,
	SubagentState,
} from "../../packages/pi-stuff-agents/src/shared/types.js";

type StateInput = Pick<
	SubagentState,
	"currentSessionId" | "asyncJobs" | "recentAgentJobs" | "foregroundControls" | "foregroundRuns"
>;

interface SignalChannel {
	emit(): void;
	readonly size: number;
	subscribe(listener: () => void): () => void;
}

function signalChannel(): SignalChannel {
	const listeners = new Set<() => void>();
	return {
		emit() {
			for (const listener of [...listeners]) listener();
		},
		get size() {
			return listeners.size;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function createState(sessionId = "root-session"): StateInput {
	return {
		currentSessionId: sessionId,
		asyncJobs: new Map(),
		recentAgentJobs: new Map(),
		foregroundControls: new Map(),
		foregroundRuns: new Map(),
	};
}

function createFullState(sessionId: string): SubagentState {
	return {
		baseCwd: "",
		cleanupTimers: new Map(),
		completionSeen: new Map(),
		currentSessionId: sessionId,
		asyncJobs: new Map(),
		foregroundControls: new Map(),
		foregroundRuns: new Map(),
		lastForegroundControlId: null,
		lastUiContext: null,
		poller: null,
		recentAgentJobs: new Map(),
		resultFileCoalescer: { clear: () => {}, schedule: () => false },
		watcher: null,
		watcherRestartTimer: null,
	};
}

function asyncJob(id: string, status: AsyncJobState["status"], overrides: Partial<AsyncJobState> = {}): AsyncJobState {
	return {
		asyncId: id,
		asyncDir: `/tmp/${id}`,
		status,
		sessionId: "root-session",
		agents: [id],
		startedAt: 1_000,
		updatedAt: 2_000,
		...overrides,
	};
}

function foregroundControl(overrides: Partial<ForegroundRunControl> = {}): ForegroundRunControl {
	return {
		runId: "foreground",
		sessionId: "root-session",
		mode: "parallel",
		startedAt: 1_000,
		updatedAt: 2_000,
		currentAgent: "worker",
		currentIndex: 0,
		activeChildren: new Map(),
		...overrides,
	};
}

function foregroundRun(overrides: Partial<ForegroundResumeRun> = {}): ForegroundResumeRun {
	return {
		runId: "foreground",
		sessionId: "root-session",
		mode: "single",
		cwd: "/repo",
		updatedAt: 3_000,
		children: [],
		...overrides,
	};
}

function acknowledgedOptions(overrides: Partial<CurrentAgentsOptions> = {}): CurrentAgentsOptions {
	const acknowledged = (): AgentControlAcknowledgement => true;
	return {
		inspect: acknowledged,
		steer: acknowledged,
		stop: acknowledged,
		resume: acknowledged,
		now: () => 5_000,
		...overrides,
	};
}

function row(snapshot: ReturnType<CurrentAgents["snapshot"]>, key: string): AgentRow {
	const result = snapshot.rows.find((candidate) => candidate.key === key);
	if (!result) throw new Error(`Expected row ${key}`);
	return result;
}

describe("CurrentAgents snapshot", () => {
	test("projects only direct children from the current root session", () => {
		const state = createState();
		state.foregroundControls.set(
			"foreground",
			foregroundControl({
				description: "Implement the state module",
				activeChildren: new Map([
					[
						0,
						{
							index: 0,
							agent: "worker",
							description: "Implement",
							startedAt: 1_000,
							updatedAt: 4_000,
						},
					],
					[
						1,
						{
							index: 1,
							agent: "reviewer",
							description: "Review",
							startedAt: 1_500,
							updatedAt: 4_000,
							currentActivityState: "needs_attention",
							currentTool: "contact_supervisor",
						},
					],
				]),
				nestedChildren: [
					{
						id: "nested-one",
						parentRunId: "foreground",
						parentStepIndex: 0,
						depth: 1,
						path: [],
						state: "running",
						children: [
							{
								id: "nested-two",
								parentRunId: "nested-one",
								depth: 2,
								path: [],
								state: "queued",
							},
						],
					},
				],
			}),
		);
		state.foregroundRuns?.set(
			"foreground",
			foregroundRun({
				mode: "parallel",
				children: [
					{
						agent: "worker",
						index: 0,
						status: "detached",
						finalOutput: "partial implementation",
						sessionFile: "/sessions/worker.jsonl",
						transcriptPath: "/transcripts/worker.md",
						updatedAt: 4_000,
					},
				],
			}),
		);
		state.foregroundRuns?.set(
			"finished-foreground",
			foregroundRun({
				runId: "finished-foreground",
				children: [
					{
						agent: "planner",
						index: 0,
						status: "completed",
						finalOutput: "plan complete",
						sessionFile: "/sessions/planner.jsonl",
						transcriptPath: "/transcripts/planner.md",
						updatedAt: 3_000,
					},
				],
			}),
		);
		state.asyncJobs.set("queued", asyncJob("queued", "queued", { description: "Explore APIs" }));
		state.asyncJobs.set("other-session", asyncJob("other-session", "running", { sessionId: "stale-session" }));
		state.recentAgentJobs?.set(
			"done",
			asyncJob("done", "complete", {
				steps: [
					{
						agent: "scout",
						status: "completed",
						startedAt: 1_000,
						endedAt: 3_000,
						transcriptPath: "/transcripts/scout.md",
					},
				],
			}),
		);
		state.recentAgentJobs?.set("fleet-active", asyncJob("fleet-active", "running"));

		const current = new CurrentAgents(state, acknowledgedOptions());
		const snapshot = current.snapshot();

		expect(snapshot.sessionId).toBe("root-session");
		expect(new Set(snapshot.rows.map(({ key }) => key))).toEqual(
			new Set(["foreground:0", "foreground:1", "finished-foreground:0", "queued:0", "done:0"]),
		);
		expect(snapshot.rows.some(({ runId }) => runId === "nested-one")).toBe(false);
		expect(snapshot.rows.some(({ runId }) => runId === "other-session")).toBe(false);
		expect(snapshot.rows.some(({ runId }) => runId === "fleet-active")).toBe(false);

		expect(row(snapshot, "foreground:0")).toMatchObject({
			name: "worker",
			task: "Implement",
			status: "running",
			startedAt: 1_000,
			elapsedMs: 4_000,
			partialResult: "partial implementation",
			nestedCount: 2,
			sessionFile: "/sessions/worker.jsonl",
			transcriptPath: "/transcripts/worker.md",
		});
		expect(row(snapshot, "foreground:1").status).toBe("waiting_supervisor");
		expect(row(snapshot, "done:0")).toMatchObject({ status: "completed", elapsedMs: 2_000 });
		expect(row(snapshot, "finished-foreground:0")).toMatchObject({
			status: "completed",
			partialResult: "plan complete",
			startedAt: null,
			elapsedMs: null,
		});
	});

	test("restores task-only legacy rows through the bounded description fallback", () => {
		const state = createState();
		const legacyTask = "独立只读复核 /tmp/pi-max-tools-019fc372-d606-77ef-b3d5-59ba054c8d1a/sample.txt 并检查状态";
		state.recentAgentJobs?.set(
			"legacy-background",
			asyncJob("legacy-background", "complete", {
				description: legacyTask,
				steps: [
					{
						agent: "background-reviewer",
						endedAt: 3_000,
						label: legacyTask,
						startedAt: 1_000,
						status: "completed",
					},
				],
			}),
		);
		state.foregroundRuns?.set(
			"legacy-foreground",
			foregroundRun({
				children: [
					{
						agent: "foreground-reviewer",
						description: legacyTask,
						index: 0,
						status: "completed",
						updatedAt: 3_000,
					},
				],
				runId: "legacy-foreground",
			}),
		);

		const snapshot = new CurrentAgents(state, acknowledgedOptions()).snapshot();
		for (const key of ["legacy-background:0", "legacy-foreground:0"]) {
			const restored = row(snapshot, key);
			expect(restored.description).toBe("独立只读复核 sample.txt 并检查状态");
			expect(restored.task).toBe(legacyTask);
		}
	});

	test("reconstructs a task-only legacy background label from persisted status", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-legacy-agent-restore-"));
		const runDir = path.join(root, "legacy-run");
		const sessionId = "legacy-session";
		const legacyTask = "独立只读复核 /tmp/pi-max-tools-019fc372-d606-77ef-b3d5-59ba054c8d1a/sample.txt 并检查状态";
		fs.mkdirSync(runDir);
		fs.writeFileSync(
			path.join(runDir, "status.json"),
			JSON.stringify({
				cwd: "/repo",
				endedAt: 3_000,
				lastUpdate: 3_000,
				mode: "single",
				runId: "legacy-run",
				sessionId,
				startedAt: 1_000,
				state: "complete",
				steps: [
					{
						agent: "reviewer",
						endedAt: 3_000,
						label: legacyTask,
						startedAt: 1_000,
						status: "completed",
					},
				],
			}),
		);
		const state = createFullState(sessionId);
		const tracker = createAsyncJobTracker(
			{ events: { emit: () => {} } } as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{ now: () => 4_000, resultsDir: path.join(root, "results") },
		);

		try {
			tracker.restoreActiveJobs();
			const restored = row(new CurrentAgents(state, acknowledgedOptions()).snapshot(), "legacy-run:0");
			expect(restored.description).toBe("独立只读复核 sample.txt 并检查状态");
			expect(restored.task).toBe(legacyTask);
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("bounds legacy source scanning before trimming restored task text", () => {
		const state = createState();
		const leadingWhitespaceTask = `${" ".repeat(4 * 1024 * 1024)}LATE_TASK_TEXT_MUST_NOT_BE_SCANNED`;
		let lateOutputReads = 0;
		const recentOutput = ["x".repeat(4 * 1024 * 1024)];
		Object.defineProperty(recentOutput, 1, {
			configurable: true,
			enumerable: true,
			get: () => {
				lateOutputReads += 1;
				return "LATE_OUTPUT_MUST_NOT_BE_READ";
			},
		});
		state.recentAgentJobs?.set(
			"bounded-legacy",
			asyncJob("bounded-legacy", "complete", {
				steps: [{ agent: "reviewer", label: leadingWhitespaceTask, status: "completed" }],
			}),
		);
		state.recentAgentJobs?.set(
			"bounded-output",
			asyncJob("bounded-output", "complete", {
				steps: [{ agent: "reviewer", recentOutput, status: "completed" }],
			}),
		);

		const snapshot = new CurrentAgents(state, acknowledgedOptions()).snapshot();
		const restored = row(snapshot, "bounded-legacy:0");
		expect(restored.description).toBe("Agent task");
		expect(restored.task).toBe("");
		const output = row(snapshot, "bounded-output:0").partialResult;
		expect(output).toHaveLength(4_000);
		expect(output).toEndWith("…");
		expect(lateOutputReads).toBe(0);
	});

	test("represents every explicit lifecycle state without inventing nested rows", () => {
		const state = createState();
		const active = [
			asyncJob("queued", "queued"),
			asyncJob("running", "running"),
			asyncJob("supervisor", "running", { currentTool: "contact_supervisor", activityState: "needs_attention" }),
			asyncJob("stopping", "running", { stopping: true } as Partial<AsyncJobState>),
		];
		for (const job of active) state.asyncJobs.set(job.asyncId, job);

		const terminal = [
			asyncJob("completed", "complete"),
			asyncJob("failed", "failed"),
			asyncJob("agent-stopped", "paused"),
			asyncJob("user-cancelled", "stopped"),
			asyncJob("crashed", "failed", {
				steps: [{ agent: "crashed", status: "failed", processSignal: "SIGTERM" } as never],
			}),
			asyncJob("resuming", "complete", { resuming: true } as Partial<AsyncJobState>),
		];
		for (const job of terminal) state.recentAgentJobs?.set(job.asyncId, job);

		const statuses = new Set(
			new CurrentAgents(state, acknowledgedOptions()).snapshot().rows.map(({ status }) => status),
		);
		expect(statuses).toEqual(
			new Set([
				"queued",
				"running",
				"waiting_supervisor",
				"stopping",
				"completed",
				"failed",
				"agent_stopped",
				"user_cancelled",
				"crashed",
				"resuming",
			]),
		);
	});

	test("returns deeply frozen copies rather than mutable Map values", () => {
		const state = createState();
		const job = asyncJob("copy", "running", { description: "original" });
		state.asyncJobs.set(job.asyncId, job);
		const current = new CurrentAgents(state, acknowledgedOptions());
		const before = current.snapshot();

		expect(Object.isFrozen(before)).toBe(true);
		expect(Object.isFrozen(before.rows)).toBe(true);
		expect(Object.isFrozen(before.rows[0])).toBe(true);

		job.description = "mutated upstream";
		job.agents = ["changed"];
		expect(before.rows[0]).toMatchObject({ name: "copy", task: "original" });
		expect(current.snapshot().rows[0]).toMatchObject({ name: "changed", task: "mutated upstream" });
	});
});

describe("CurrentAgents controls", () => {
	test("publishes stopping/resuming only after an honest acknowledgement", async () => {
		const state = createState();
		state.asyncJobs.set("live", asyncJob("live", "running"));
		state.recentAgentJobs?.set("done", asyncJob("done", "complete"));
		state.recentAgentJobs?.set("cancelled", asyncJob("cancelled", "stopped"));
		const calls: string[] = [];
		const current = new CurrentAgents(
			state,
			acknowledgedOptions({
				inspect: (agent) => {
					calls.push(`inspect:${agent.key}`);
					return true;
				},
				steer: (agent, message) => {
					calls.push(`steer:${agent.key}:${message}`);
					return { acknowledged: message === "continue" };
				},
				stop: (agent) => {
					calls.push(`stop:${agent.key}`);
					return { acknowledged: true, message: "stop accepted" };
				},
				resume: (agent, message) => {
					calls.push(`resume:${agent.key}:${message ?? ""}`);
					return true;
				},
			}),
		);

		const stop = await current.control({ type: "stop", key: "live:0" });
		expect(stop).toMatchObject({ acknowledged: true, message: "stop accepted", status: "stopping" });
		expect((await current.control({ type: "stop", key: "live:0" })).acknowledged).toBe(false);

		expect((await current.control({ type: "steer", key: "live:0", message: "  " })).acknowledged).toBe(false);
		expect((await current.control({ type: "inspect", key: "done:0" })).acknowledged).toBe(true);

		const resume = await current.control({ type: "resume", key: "cancelled:0", message: "retry" });
		expect(resume).toMatchObject({ acknowledged: false, status: "user_cancelled" });

		state.recentAgentJobs?.set("resumable", asyncJob("resumable", "paused"));
		const resumed = await current.control({ type: "resume", key: "resumable:0", message: " retry " });
		expect(resumed).toMatchObject({ acknowledged: true, status: "resuming" });
		expect(calls).toContain("resume:resumable:0:retry");
		expect(calls.filter((call) => call === "stop:live:0")).toHaveLength(1);
	});

	test("does not mask an authoritative terminal transition with a local stopping state", async () => {
		const state = createState();
		const live = asyncJob("live", "running");
		state.asyncJobs.set(live.asyncId, live);
		const current = new CurrentAgents(
			state,
			acknowledgedOptions({
				stop: () => {
					live.status = "stopped";
					state.recentAgentJobs?.set(live.asyncId, live);
					return true;
				},
			}),
		);

		const result = await current.control({ type: "stop", key: "live:0" });
		expect(result).toMatchObject({ acknowledged: true, status: "user_cancelled" });
	});
});

describe("CurrentAgents lifecycle", () => {
	test("refreshes poll-driven consumers and notifies only on semantic changes", () => {
		const state = createState();
		const live = asyncJob("live", "running", { description: "first" });
		state.asyncJobs.set(live.asyncId, live);
		const current = new CurrentAgents(state, acknowledgedOptions());
		const tasks: string[] = [];
		current.subscribe((snapshot) => tasks.push(row(snapshot, "live:0").task));

		live.description = "changed";
		current.refresh();
		current.refresh();

		expect(tasks).toEqual(["first", "changed"]);
	});

	test("keeps terminal rows in the detail authority across elapsed time", () => {
		const state = createState();
		const stateSignal = signalChannel();
		let now = 5_000;
		state.asyncJobs.set("live", asyncJob("live", "running"));
		state.recentAgentJobs?.set("old-terminal", asyncJob("old-terminal", "complete"));
		const snapshots: string[][] = [];
		const current = new CurrentAgents(
			state,
			acknowledgedOptions({
				now: () => now,
				subscribeState: stateSignal.subscribe,
			}),
		);
		current.subscribe((snapshot) => snapshots.push(snapshot.rows.map(({ key }) => key)));

		now = 500_000;
		stateSignal.emit();
		expect(snapshots).toHaveLength(1);
		expect(current.snapshot().rows.some(({ key }) => key === "old-terminal:0")).toBe(true);

		expect(current.snapshot().rows.map(({ key }) => key)).toEqual(["live:0", "old-terminal:0"]);
		state.recentAgentJobs?.set("new-terminal", asyncJob("new-terminal", "failed"));
		stateSignal.emit();
		expect(current.snapshot().rows.some(({ key }) => key === "new-terminal:0")).toBe(true);
		expect(current.snapshot().rows.some(({ key }) => key === "old-terminal:0")).toBe(true);

		state.currentSessionId = "second-session";
		state.asyncJobs.clear();
		state.recentAgentJobs?.set("old-terminal", asyncJob("old-terminal", "complete", { sessionId: "second-session" }));
		stateSignal.emit();
		expect(current.snapshot().rows.map(({ key }) => key)).toEqual(["old-terminal:0"]);
	});

	test("deduplicates notifications and becomes quiet after unsubscribe or dispose", async () => {
		const state = createState();
		const stateSignal = signalChannel();
		const live = asyncJob("live", "running", { description: "first" });
		state.asyncJobs.set(live.asyncId, live);
		let stopCalls = 0;
		const current = new CurrentAgents(
			state,
			acknowledgedOptions({
				subscribeState: stateSignal.subscribe,
				stop: () => {
					stopCalls += 1;
					return true;
				},
			}),
		);
		const revisions: number[] = [];
		const unsubscribe = current.subscribe(({ revision }) => revisions.push(revision));

		stateSignal.emit();
		stateSignal.emit();
		expect(revisions).toHaveLength(1);
		live.description = "changed";
		stateSignal.emit();
		expect(revisions).toHaveLength(2);

		unsubscribe();
		live.description = "changed again";
		stateSignal.emit();
		expect(revisions).toHaveLength(2);
		expect(stateSignal.size).toBe(1);

		current.dispose();
		expect(stateSignal.size).toBe(0);
		stateSignal.emit();
		const result = await current.control({ type: "stop", key: "live:0" });
		expect(result).toMatchObject({ acknowledged: false, status: null });
		expect(stopCalls).toBe(0);
	});
});
