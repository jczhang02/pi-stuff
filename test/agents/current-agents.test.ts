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
	ProcessTerminalV1,
	SubagentState,
} from "../../packages/pi-stuff-agents/src/shared/types.js";
import {
	SUBAGENT_CONTROL_EVENT,
	SUBAGENT_STEERING_NOTICE_EVENT,
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

function signalledProcessTerminal(
	runId: string,
	signal: string | null,
	terminationOrigin?: "external" | "manager-final-drain" | "manager-request",
	exitCode: number | null = null,
): ProcessTerminalV1 {
	return {
		version: 1,
		state: "observed",
		runId,
		childIndex: 0,
		runnerProcessInstanceId: `${runId}-runner`,
		observedAt: 2_000,
		instances: [
			{
				kind: "pi-writer",
				processInstanceId: `${runId}-writer`,
				attempt: 0,
				closeObservedAt: 2_000,
				exitCode,
				signal,
				...(terminationOrigin ? { terminationOrigin } : {}),
			},
		],
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

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(20);
	}
	throw new Error("Timed out waiting for Agent lifecycle condition");
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

	test("retains the last live state across a transient status observer failure", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-observer-retry-"));
		const asyncDir = path.join(root, "observer-retry");
		fs.mkdirSync(asyncDir);
		const state = createFullState("root-session");
		let attempts = 0;
		const tracker = createAsyncJobTracker(
			{ events: { emit: () => {} } } as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{
				pollIntervalMs: 10,
				resultsDir: path.join(root, "results"),
				reconcileRun: () => {
					attempts += 1;
					if (attempts === 1) throw Object.assign(new Error("transient observer EIO"), { code: "EIO" });
					return {
						repaired: false,
						status: {
							runId: "observer-retry",
							sessionId: "root-session",
							mode: "single",
							state: "running",
							pid: process.pid,
							startedAt: 1_000,
							lastUpdate: 2_000,
							steps: [{ agent: "reviewer", status: "running" }],
						},
					};
				},
			},
		);

		try {
			tracker.handleStarted({
				id: "observer-retry",
				asyncDir,
				sessionId: "root-session",
				mode: "single",
				agents: ["reviewer"],
			});
			while (attempts < 1) await Bun.sleep(5);
			expect(state.asyncJobs.get("observer-retry")?.status).not.toBe("failed");
			expect(state.cleanupTimers.has("observer-retry")).toBe(false);
			while (attempts < 2 || state.asyncJobs.get("observer-retry")?.status !== "running") await Bun.sleep(5);
			expect(state.asyncJobs.get("observer-retry")?.status).toBe("running");
		} finally {
			tracker.resetJobs();
			if (state.poller) clearInterval(state.poller);
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("never revives semantic completion from an older running status snapshot", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-terminal-monotonic-"));
		const asyncDir = path.join(root, "terminal-monotonic");
		fs.mkdirSync(asyncDir);
		const state = createFullState("root-session");
		let processTerminal: ProcessTerminalV1 = {
			version: 1,
			state: "pending",
			runId: "terminal-monotonic",
			runnerProcessInstanceId: "terminal-monotonic-runner",
		};
		let polls = 0;
		const tracker = createAsyncJobTracker(
			{ events: { emit: () => {} } } as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{
				completionRetentionMs: 25,
				pollIntervalMs: 5,
				resultsDir: path.join(root, "results"),
				reconcileRun: () => {
					polls += 1;
					return {
						repaired: false,
						status: {
							runId: "terminal-monotonic",
							sessionId: "root-session",
							mode: "single",
							state: "running",
							startedAt: 1_000,
							lastUpdate: 2_000,
							processTerminal,
							steps: [{ agent: "reviewer", status: "running" }],
						},
					};
				},
			},
		);

		try {
			tracker.handleStarted({
				id: "terminal-monotonic",
				asyncDir,
				sessionId: "root-session",
				mode: "single",
				agents: ["reviewer"],
			});
			await waitUntil(() => state.asyncJobs.get("terminal-monotonic")?.processTerminal?.state === "pending");
			tracker.handleComplete({ id: "terminal-monotonic", sessionId: "root-session", state: "complete" });
			await waitUntil(() => polls >= 3);
			expect(state.asyncJobs.get("terminal-monotonic")?.status).toBe("complete");
			expect(state.cleanupTimers.has("terminal-monotonic")).toBeFalse();

			processTerminal = {
				version: 1,
				state: "observed",
				runId: "terminal-monotonic",
				runnerProcessInstanceId: "terminal-monotonic-runner",
				observedAt: 3_000,
				instances: [],
			};
			await waitUntil(() => !state.asyncJobs.has("terminal-monotonic"));
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("keeps cold terminal runs polled until physical process proof is observed", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-terminal-physical-recovery-"));
		const asyncDir = path.join(root, "cold-terminal");
		fs.mkdirSync(asyncDir);
		const state = createFullState("root-session");
		const pending: ProcessTerminalV1 = {
			version: 1,
			state: "pending",
			runId: "cold-terminal",
			runnerProcessInstanceId: "cold-terminal-runner",
		};
		const observed: ProcessTerminalV1 = {
			version: 1,
			state: "observed",
			runId: "cold-terminal",
			runnerProcessInstanceId: "cold-terminal-runner",
			observedAt: 4_000,
			instances: [],
		};
		let listCalls = 0;
		let recoveryPasses = 0;
		const summary = {
			id: "cold-terminal",
			asyncDir,
			sessionId: "root-session",
			state: "failed" as const,
			mode: "single" as const,
			startedAt: 1_000,
			processTerminal: pending,
			steps: [{ index: 0, agent: "reviewer", status: "failed" as const }],
		};
		const tracker = createAsyncJobTracker(
			{ events: { emit: () => {} } } as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{
				completionRetentionMs: 20,
				pollIntervalMs: 5,
				listRuns: () => {
					listCalls += 1;
					return [summary];
				},
				reconcileRun: () => {
					recoveryPasses += 1;
					return {
						repaired: recoveryPasses >= 3,
						status: {
							runId: "cold-terminal",
							sessionId: "root-session",
							mode: "single",
							state: "failed",
							startedAt: 1_000,
							endedAt: 2_000,
							lastUpdate: 2_000,
							processTerminal: recoveryPasses >= 3 ? observed : pending,
							steps: [{ agent: "reviewer", status: "failed" }],
						},
					};
				},
			},
		);

		try {
			tracker.restoreActiveJobs();
			tracker.ensurePoller();
			expect(listCalls).toBe(1);
			expect(state.asyncJobs.has("cold-terminal")).toBeTrue();
			await waitUntil(() => recoveryPasses >= 3 && !state.asyncJobs.has("cold-terminal"));
			expect(recoveryPasses).toBeGreaterThanOrEqual(3);
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("keeps polling a cold detached foreground run until orphan recovery reaches terminal proof", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-recovery-poll-"));
		const state = createFullState("root-session");
		const run = foregroundRun({
			runId: "cold-foreground",
			asyncDir: path.join(root, "cold-foreground"),
			children: [
				{
					agent: "reviewer",
					index: 0,
					task: "Recover the orphan",
					status: "detached",
					updatedAt: 1_000,
				},
			],
		});
		state.foregroundRuns?.set(run.runId, run);
		let attempts = 0;
		const tracker = createAsyncJobTracker(
			{ events: { emit: () => {} } } as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{
				pollIntervalMs: 10,
				refreshForegroundRun: (candidate) => {
					attempts += 1;
					if (attempts >= 3 && candidate.children[0]) candidate.children[0].status = "failed";
					return attempts >= 3;
				},
			},
		);

		try {
			tracker.ensurePoller();
			const deadline = Date.now() + 1_000;
			while ((attempts < 3 || state.poller) && Date.now() < deadline) await Bun.sleep(5);

			expect(attempts).toBeGreaterThanOrEqual(3);
			expect(run.children[0]?.status).toBe("failed");
			expect(state.poller).toBeNull();
		} finally {
			tracker.resetJobs();
			if (state.poller) clearInterval(state.poller);
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("restores sibling runs when optional control-event metadata cannot be inspected", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-restore-cursor-"));
		const firstDir = path.join(root, "first");
		const secondDir = path.join(root, "second");
		fs.mkdirSync(firstDir);
		fs.mkdirSync(secondDir);
		const summary = (id: string, asyncDir: string) => ({
			id,
			asyncDir,
			sessionId: "root-session",
			state: "running" as const,
			mode: "single" as const,
			startedAt: 1_000,
			steps: [{ index: 0, agent: "reviewer", status: "running" as const }],
		});
		const state = createFullState("root-session");
		const tracker = createAsyncJobTracker(
			{ events: { emit: () => {} } } as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{
				listRuns: () => [summary("first", firstDir), summary("second", secondDir)],
				pollIntervalMs: 60_000,
				statControlEvents: (filePath) => {
					if (String(filePath).includes("first"))
						throw Object.assign(new Error("injected cursor EIO"), { code: "EIO" });
					return { size: 12 } as fs.Stats;
				},
			},
		);
		try {
			tracker.restoreActiveJobs();
			expect([...state.asyncJobs.keys()].sort()).toEqual(["first", "second"]);
			expect(state.asyncJobs.get("first")?.controlEventCursor).toBeUndefined();
			expect(state.asyncJobs.get("first")?.controlEventCursorPending).toBe(true);
			expect(state.asyncJobs.get("second")?.controlEventCursor).toBe(12);
		} finally {
			tracker.resetJobs();
			if (state.poller) clearInterval(state.poller);
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
				steps: [
					{
						agent: "crashed",
						status: "failed",
						processTerminal: signalledProcessTerminal("crashed", "SIGSEGV", "external"),
					},
				],
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

	test("distinguishes expected signalled failures from unexpected process crashes", () => {
		const state = createState();
		state.recentAgentJobs?.set(
			"turn-budget",
			asyncJob("turn-budget", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						error: "Agent exceeded its turn budget (10 + 2).",
						turnBudgetExceeded: true,
						processTerminal: signalledProcessTerminal("turn-budget", "SIGKILL"),
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"reported-error",
			asyncJob("reported-error", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						error: "Provider mentioned SIGTERM while rejecting the request.",
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"timed-out",
			asyncJob("timed-out", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						error: "Agent timed out after SIGTERM.",
						timedOut: true,
						crashed: true,
						processTerminal: signalledProcessTerminal("timed-out", "SIGTERM"),
					} as never,
				],
			}),
		);
		state.recentAgentJobs?.set(
			"unexpected-signal",
			asyncJob("unexpected-signal", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						processTerminal: signalledProcessTerminal("unexpected-signal", "SIGSEGV", "external"),
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"manager-signalled-error",
			asyncJob("manager-signalled-error", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						error: "Provider rate limited the request.",
						processTerminal: signalledProcessTerminal(
							"manager-signalled-error",
							"SIGTERM",
							"manager-final-drain",
						),
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"historical-ambiguous-signal",
			asyncJob("historical-ambiguous-signal", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						recentOutput: ["Completed the requested review with a valid final report."],
						processTerminal: signalledProcessTerminal("historical-ambiguous-signal", "SIGTERM"),
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"external-signal-with-error",
			asyncJob("external-signal-with-error", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						error: "Native child terminated after a segmentation fault.",
						processTerminal: signalledProcessTerminal("external-signal-with-error", "SIGSEGV", "external"),
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"external-wrapper-exit",
			asyncJob("external-wrapper-exit", "failed", {
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						processTerminal: signalledProcessTerminal("external-wrapper-exit", null, "external", 143),
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"ordinary-exit",
			asyncJob("ordinary-exit", "failed", {
				steps: [{ agent: "reviewer", status: "failed", error: "Build command exited with code 1." }],
			}),
		);
		state.recentAgentJobs?.set(
			"completed-signal",
			asyncJob("completed-signal", "complete", {
				steps: [
					{
						agent: "reviewer",
						status: "complete",
						processTerminal: signalledProcessTerminal("completed-signal", "SIGTERM"),
					},
				],
			}),
		);

		const snapshot = new CurrentAgents(state, acknowledgedOptions()).snapshot();
		expect(row(snapshot, "turn-budget:0").status).toBe("failed");
		expect(row(snapshot, "reported-error:0").status).toBe("failed");
		expect(row(snapshot, "timed-out:0").status).toBe("failed");
		expect(row(snapshot, "unexpected-signal:0").status).toBe("crashed");
		expect(row(snapshot, "manager-signalled-error:0").status).toBe("failed");
		expect(row(snapshot, "historical-ambiguous-signal:0").status).toBe("failed");
		expect(row(snapshot, "external-signal-with-error:0").status).toBe("crashed");
		expect(row(snapshot, "external-wrapper-exit:0").status).toBe("crashed");
		expect(row(snapshot, "ordinary-exit:0").status).toBe("failed");
		expect(row(snapshot, "completed-signal:0").status).toBe("completed");
	});

	test("repairs only strongly evidenced legacy final-drain failures to completed", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-legacy-final-drain-"));
		const transcript = (name: string, records: unknown[]): string => {
			const filePath = path.join(root, `${name}.jsonl`);
			fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
			return filePath;
		};
		const finalReport = {
			recordType: "message",
			sourceEventType: "message_end",
			role: "assistant",
			stopReason: "stop",
			text: "Complete, non-empty final report.",
			message: { role: "assistant", stopReason: "stop" },
		};
		const state = createState();
		const addLegacy = (
			id: string,
			transcriptPath: string,
			overrides: Record<string, unknown> = {},
			exitCode: number | null = null,
		) => {
			state.recentAgentJobs?.set(
				id,
				asyncJob(id, "failed", {
					steps: [
						{
							agent: "reviewer",
							status: "failed",
							transcriptPath,
							processTerminal: signalledProcessTerminal(
								id,
								exitCode === 143 ? null : "SIGTERM",
								undefined,
								exitCode,
							),
							...overrides,
						},
					],
				}),
			);
		};
		try {
			addLegacy("legacy-complete", transcript("complete", [finalReport]));
			addLegacy("legacy-wrapper-complete", transcript("wrapper", [finalReport]), {}, 143);
			addLegacy("legacy-tool-use", transcript("tool-use", [{ ...finalReport, stopReason: "toolUse" }]));
			addLegacy("legacy-explicit-error", transcript("explicit-error", [finalReport]), {
				error: "Provider failed after output.",
			});
			addLegacy(
				"legacy-later-event",
				transcript("later-event", [finalReport, { recordType: "tool_end", sourceEventType: "tool_execution_end" }]),
			);
			state.recentAgentJobs?.set(
				"legacy-external",
				asyncJob("legacy-external", "failed", {
					steps: [
						{
							agent: "reviewer",
							status: "failed",
							transcriptPath: transcript("external", [finalReport]),
							processTerminal: signalledProcessTerminal("legacy-external", "SIGTERM", "external"),
						},
					],
				}),
			);

			const snapshot = new CurrentAgents(state, acknowledgedOptions()).snapshot();
			expect(row(snapshot, "legacy-complete:0").status).toBe("completed");
			expect(row(snapshot, "legacy-wrapper-complete:0").status).toBe("completed");
			expect(row(snapshot, "legacy-tool-use:0").status).toBe("failed");
			expect(row(snapshot, "legacy-explicit-error:0").status).toBe("failed");
			expect(row(snapshot, "legacy-later-event:0").status).toBe("failed");
			expect(row(snapshot, "legacy-external:0").status).toBe("crashed");
		} finally {
			fs.rmSync(root, { force: true, recursive: true });
		}
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
	test("keeps branch-proven v1 status and steering projections normalized to the primary session", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-v1-tracker-normalization-"));
		const runId = "legacy-normalized-run";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "events.jsonl"),
			`${JSON.stringify({
				type: "subagent.steering.notice",
				ts: 2_000,
				runId,
				requestId: "legacy-steer",
				state: "recovered",
				message: "legacy steering recovered",
				currentSessionId: "/sessions/legacy.jsonl",
			})}\n`,
		);
		const state = createFullState("ps2-current");
		state.currentSessionScope = {
			sessionId: "ps2-current",
			governorSessionId: "ps2-current",
			legacyArtifactSessionId: "/sessions/legacy.jsonl",
			legacyRunIds: new Set([runId]),
		};
		const notices: unknown[] = [];
		const tracker = createAsyncJobTracker(
			{
				events: {
					emit: (event: string, payload: unknown) => {
						if (event === SUBAGENT_STEERING_NOTICE_EVENT) notices.push(payload);
					},
				},
			} as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{
				pollIntervalMs: 10,
				resultsDir: path.join(root, "results"),
				reconcileRun: () => ({
					repaired: false,
					status: {
						runId,
						sessionId: "/sessions/legacy.jsonl",
						mode: "single",
						state: "running",
						pid: process.pid,
						startedAt: 1_000,
						lastUpdate: 2_000,
						steps: [{ agent: "reviewer", status: "running" }],
					},
				}),
			},
		);

		try {
			tracker.handleStarted({
				id: runId,
				asyncDir,
				sessionId: "ps2-current",
				mode: "single",
				agents: ["reviewer"],
			});
			await waitUntil(() => notices.length === 1);
			expect(state.asyncJobs.get(runId)?.sessionId).toBe("ps2-current");
			expect(notices[0]).toMatchObject({ currentSessionId: "ps2-current", runId });
		} finally {
			tracker.resetJobs();
			await Bun.sleep(20);
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("isolates async control observers from the underlying Agent lifecycle", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-async-observer-"));
		const asyncDir = path.join(root, "observer-run");
		fs.mkdirSync(asyncDir, { recursive: true });
		const statusPath = path.join(asyncDir, "status.json");
		fs.writeFileSync(
			statusPath,
			JSON.stringify({
				runId: "observer-run",
				sessionId: "root-session",
				mode: "single",
				state: "running",
				pid: process.pid,
				startedAt: 1_000,
				lastUpdate: 2_000,
				steps: [{ agent: "reviewer", status: "running", startedAt: 1_000 }],
			}),
		);
		fs.writeFileSync(
			path.join(asyncDir, "events.jsonl"),
			`${JSON.stringify({
				type: "subagent.control",
				event: { type: "active_long_running", ts: 2_000, runId: "observer-run", index: 0 },
				channels: ["event"],
			})}\n`,
		);
		const state = createFullState("root-session");
		let observerCalls = 0;
		const tracker = createAsyncJobTracker(
			{
				events: {
					emit: () => {
						observerCalls += 1;
						throw new Error("injected lifecycle observer failure");
					},
				},
			} as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{ pollIntervalMs: 10, resultsDir: path.join(root, "results") },
		);

		try {
			tracker.handleStarted({
				id: "observer-run",
				asyncDir,
				sessionId: "root-session",
				mode: "single",
				agents: ["reviewer"],
			});
			await waitUntil(
				() => observerCalls === 1 && (state.asyncJobs.get("observer-run")?.controlEventCursor ?? 0) > 0,
			);
			expect(state.asyncJobs.get("observer-run")?.status).toBe("running");

			fs.writeFileSync(
				statusPath,
				JSON.stringify({
					runId: "observer-run",
					sessionId: "root-session",
					mode: "single",
					state: "complete",
					pid: process.pid,
					startedAt: 1_000,
					endedAt: 3_000,
					lastUpdate: 3_000,
					steps: [{ agent: "reviewer", status: "complete", startedAt: 1_000, endedAt: 3_000 }],
				}),
			);
			await waitUntil(() => state.recentAgentJobs?.get("observer-run")?.status === "complete");
			expect(state.recentAgentJobs?.get("observer-run")?.status).toBe("complete");
		} finally {
			tracker.resetJobs();
			await Bun.sleep(20);
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("keeps the next valid control event after an oversized line crosses a scan window", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-control-window-"));
		const runId = "control-window";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId: "root-session",
				mode: "single",
				state: "running",
				pid: process.pid,
				startedAt: 1_000,
				lastUpdate: 2_000,
				steps: [{ agent: "reviewer", status: "running", startedAt: 1_000 }],
			}),
		);
		const validEvent = JSON.stringify({
			type: "subagent.control",
			event: { type: "needs_attention", ts: 2_000, runId, index: 0, reason: "fixture" },
			channels: ["event"],
		});
		fs.writeFileSync(path.join(asyncDir, "events.jsonl"), `${"x".repeat(2 * 1024 * 1024 + 257)}\n${validEvent}\n`);
		const state = createFullState("root-session");
		const delivered: unknown[] = [];
		const tracker = createAsyncJobTracker(
			{
				events: {
					emit: (event: string, payload: unknown) => {
						if (event === SUBAGENT_CONTROL_EVENT) delivered.push(payload);
					},
				},
			} as unknown as Pick<ExtensionAPI, "events">,
			state,
			root,
			{ pollIntervalMs: 10, resultsDir: path.join(root, "results") },
		);
		try {
			tracker.handleStarted({
				id: runId,
				asyncDir,
				sessionId: "root-session",
				mode: "single",
				agents: ["reviewer"],
			});
			await waitUntil(() => delivered.length === 1, 3_000);
			expect(delivered).toHaveLength(1);
			expect(state.asyncJobs.get(runId)?.controlEventCursor).toBe(
				fs.statSync(path.join(asyncDir, "events.jsonl")).size,
			);
		} finally {
			tracker.resetJobs();
			await Bun.sleep(20);
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

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
