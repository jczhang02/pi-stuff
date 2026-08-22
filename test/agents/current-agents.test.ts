import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAsyncJobTracker } from "../../packages/pi-stuff/src/subagents/src/runs/background/async-job-tracker.js";
import {
	type AgentControlAcknowledgement,
	type AgentRow,
	CurrentAgents,
	type CurrentAgentsOptions,
} from "../../packages/pi-stuff/src/subagents/src/session/current-agents.js";
import type {
	AsyncJobState,
	ForegroundResumeRun,
	ForegroundRunControl,
	ProcessTerminalV1,
	SubagentState,
} from "../../packages/pi-stuff/src/subagents/src/shared/types.js";
import {
	SUBAGENT_CONTROL_EVENT,
	SUBAGENT_STEERING_NOTICE_EVENT,
} from "../../packages/pi-stuff/src/subagents/src/shared/types.js";

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
			for (const listener of Array.from(listeners)) listener();
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

function eventHost(emit: (event: string, payload: unknown) => void = () => {}): Pick<ExtensionAPI, "events"> {
	const events = createEventBus();
	return {
		events: {
			emit(event, payload) {
				emit(event, payload);
				events.emit(event, payload);
			},
			on: events.on,
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
	const instance: ProcessTerminalV1["instances"][number] = {
		kind: "pi-writer",
		processInstanceId: `${runId}-writer`,
		attempt: 0,
		closeObservedAt: 2_000,
		exitCode,
		signal,
	};
	if (terminationOrigin) Object.assign(instance, { terminationOrigin });
	return {
		version: 1,
		state: "observed",
		runId,
		childIndex: 0,
		runnerProcessInstanceId: `${runId}-runner`,
		observedAt: 2_000,
		instances: [instance],
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

	test("uses the delegated task instead of the execution prompt", () => {
		const state = createState();
		const delegatedTask = `Review the Agent dialog.\n${"Keep this detail readable. ".repeat(30)}\nLAST_TASK_LINE`;
		state.recentAgentJobs?.set(
			"derived-prompt",
			asyncJob("derived-prompt", "complete", {
				steps: [
					{
						agent: "reviewer",
						delegatedTask,
						label: "Review Agent dialog",
						status: "completed",
						task: `<pi-stuff-context trust="reference-only">${"memory".repeat(1_000)}</pi-stuff-context>\n\nReview the Agent dialog.`,
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"legacy-derived-prompt",
			asyncJob("legacy-derived-prompt", "complete", {
				steps: [
					{
						agent: "reviewer",
						label: "Review Agent dialog",
						status: "completed",
						task: `<pi-stuff-context trust="reference-only">${"memory".repeat(1_000)}</pi-stuff-context>\n\nReview the Agent dialog.`,
					},
				],
			}),
		);

		const projected = row(new CurrentAgents(state, acknowledgedOptions()).snapshot(), "derived-prompt:0");
		expect(projected.task).toBe(delegatedTask);
		expect(projected.task).toEndWith("LAST_TASK_LINE");
		expect(projected.task).not.toContain("pi-stuff-context");
		const legacy = row(new CurrentAgents(state, acknowledgedOptions()).snapshot(), "legacy-derived-prompt:0");
		expect(legacy.task).toBe("Review Agent dialog");
		expect(legacy.task).not.toContain("pi-stuff-context");
	});

	test("does not present terminal activity as the Agent result", () => {
		const state = createState();
		state.recentAgentJobs?.set(
			"completed-agent",
			asyncJob("completed-agent", "complete", {
				steps: [
					{
						agent: "reviewer",
						recentOutput: ["Read package.json", "Final answer"],
						status: "completed",
					},
				],
			}),
		);
		state.recentAgentJobs?.set(
			"completed-with-result",
			asyncJob("completed-with-result", "complete", {
				steps: [
					{
						agent: "reviewer",
						finalOutput: "First line\nSecond line",
						recentOutput: ["Read package.json", "First line", "Second line"],
						status: "completed",
					},
				],
			}),
		);

		const snapshot = new CurrentAgents(state, acknowledgedOptions()).snapshot();
		const completed = row(snapshot, "completed-agent:0");
		expect(completed.partialResult).toBeNull();
		expect(row(snapshot, "completed-with-result:0").partialResult).toBe("First line\nSecond line");
	});

	test("reconstructs a task-only legacy background label from persisted status", async () => {
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
		const tracker = createAsyncJobTracker(eventHost(), state, root);

		try {
			await tracker.restoreActiveJobs();
			const restored = row(new CurrentAgents(state, acknowledgedOptions()).snapshot(), "legacy-run:0");
			expect(restored.description).toBe("独立只读复核 sample.txt 并检查状态");
			expect(restored.task).toBe(legacyTask);
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("cold startup restores only governor-indexed active runtime directories", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-targeted-agent-restore-"));
		const target = path.join(root, "target-run");
		const unrelated = path.join(root, "unrelated-run");
		fs.mkdirSync(target);
		fs.mkdirSync(unrelated);
		const reads: string[] = [];
		const state = createFullState("root-session");
		const tracker = createAsyncJobTracker(eventHost(), state, root, {
			readRunStatus: async (asyncDir) => {
				reads.push(asyncDir);
				return {
					runId: path.basename(asyncDir),
					sessionId: "root-session",
					state: "running",
					mode: "single",
					startedAt: 1_000,
					lastUpdate: 2_000,
					steps: [{ agent: "reviewer", status: "running" }],
				};
			},
		});

		try {
			await tracker.restoreActiveJobs([target]);
			expect(reads).toEqual([target]);
			expect([...state.asyncJobs.keys()]).toEqual(["target-run"]);
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("treats a missing runtime root as one completed restore generation", async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-missing-agent-root-"));
		const root = path.join(base, "async-runs");
		const runDir = path.join(root, "late-run");
		const state = createFullState("root-session");
		const tracker = createAsyncJobTracker(eventHost(), state, root);

		try {
			await tracker.restoreActiveJobs();
			fs.mkdirSync(runDir, { recursive: true });
			fs.writeFileSync(
				path.join(runDir, "status.json"),
				JSON.stringify({
					runId: "late-run",
					sessionId: "root-session",
					state: "running",
					mode: "single",
					startedAt: 1_000,
					lastUpdate: 2_000,
					steps: [{ agent: "reviewer", status: "running" }],
				}),
			);
			await tracker.restoreActiveJobs();
			expect(state.asyncJobs.has("late-run")).toBeFalse();

			tracker.resetJobs();
			state.currentSessionId = "root-session";
			await tracker.restoreActiveJobs();
			expect(state.asyncJobs.has("late-run")).toBeTrue();
		} finally {
			tracker.resetJobs();
			fs.rmSync(base, { force: true, recursive: true });
		}
	});

	test("retains the last live state across a transient status observer failure", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-observer-retry-"));
		const asyncDir = path.join(root, "observer-retry");
		fs.mkdirSync(asyncDir);
		const state = createFullState("root-session");
		let attempts = 0;
		const tracker = createAsyncJobTracker(eventHost(), state, root, {
			pollIntervalMs: 10,
			readRunStatus: async () => {
				attempts += 1;
				if (attempts === 1) throw Object.assign(new Error("transient observer EIO"), { code: "EIO" });
				return {
					runId: "observer-retry",
					sessionId: "root-session",
					mode: "single",
					state: "running",
					pid: process.pid,
					startedAt: 1_000,
					lastUpdate: 2_000,
					steps: [{ agent: "reviewer", status: "running" }],
				};
			},
		});

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
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("never revives semantic completion from an older running status snapshot", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-terminal-monotonic-"));
		const asyncDir = path.join(root, "terminal-monotonic");
		fs.mkdirSync(asyncDir);
		const state = createFullState("root-session");
		const pending: ProcessTerminalV1 = {
			version: 1,
			state: "pending",
			runId: "terminal-monotonic",
			runnerProcessInstanceId: "terminal-monotonic-runner",
		};
		const tracker = createAsyncJobTracker(eventHost(), state, root, {
			completionRetentionMs: 25,
			readRunStatus: async () => null,
		});

		try {
			tracker.handleStarted({
				id: "terminal-monotonic",
				asyncDir,
				sessionId: "root-session",
				mode: "single",
				agents: ["reviewer"],
			});
			tracker.handleStatus({
				id: "terminal-monotonic",
				asyncDir,
				sessionId: "root-session",
				status: {
					runId: "terminal-monotonic",
					sessionId: "root-session",
					mode: "single",
					state: "running",
					startedAt: 1_000,
					lastUpdate: 2_000,
					processTerminal: pending,
					steps: [{ agent: "reviewer", status: "running" }],
				},
			});
			await waitUntil(() => state.asyncJobs.get("terminal-monotonic")?.processTerminal?.state === "pending");
			tracker.handleComplete({ id: "terminal-monotonic", sessionId: "root-session", state: "complete" });
			tracker.handleStatus({
				id: "terminal-monotonic",
				asyncDir,
				sessionId: "root-session",
				status: {
					runId: "terminal-monotonic",
					sessionId: "root-session",
					mode: "single",
					state: "running",
					startedAt: 1_000,
					lastUpdate: 2_000,
					processTerminal: pending,
					steps: [{ agent: "reviewer", status: "running" }],
				},
			});
			expect(state.asyncJobs.get("terminal-monotonic")?.status).toBe("complete");
			expect(state.cleanupTimers.has("terminal-monotonic")).toBeFalse();
			tracker.handleProcessTerminal({
				version: 1,
				state: "observed",
				runId: "terminal-monotonic",
				runnerProcessInstanceId: "foreign-runner",
				observedAt: 2_500,
				instances: [],
			});
			expect(state.asyncJobs.get("terminal-monotonic")?.processTerminal).toEqual(pending);

			tracker.handleProcessTerminal({
				version: 1,
				state: "observed",
				runId: "terminal-monotonic",
				runnerProcessInstanceId: "terminal-monotonic-runner",
				observedAt: 3_000,
				instances: [],
			});
			await waitUntil(() => !state.asyncJobs.has("terminal-monotonic"));
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("keeps a restored terminal run until an explicit physical process event is observed", async () => {
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
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId: "cold-terminal",
				sessionId: "root-session",
				state: "failed",
				mode: "single",
				startedAt: 1_000,
				lastUpdate: 2_000,
				processTerminal: pending,
				steps: [{ agent: "reviewer", status: "failed" }],
			}),
		);
		const tracker = createAsyncJobTracker(eventHost(), state, root, { completionRetentionMs: 20 });

		try {
			await tracker.restoreActiveJobs();
			expect(state.asyncJobs.has("cold-terminal")).toBeTrue();
			await Bun.sleep(40);
			expect(state.asyncJobs.has("cold-terminal")).toBeTrue();
			tracker.handleProcessTerminal({
				version: 1,
				state: "observed",
				runId: "cold-terminal",
				runnerProcessInstanceId: "cold-terminal-runner",
				observedAt: 4_000,
				instances: [],
			});
			await waitUntil(() => !state.asyncJobs.has("cold-terminal"));
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("does not poll foreground recovery state from the Agent status observer", async () => {
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
		let watchCalls = 0;
		const tracker = createAsyncJobTracker(eventHost(), state, root, {
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			watchRun: ((...args: unknown[]) => {
				watchCalls += 1;
				// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
				return (fs.watch as (...watchArgs: unknown[]) => fs.FSWatcher)(...args);
			}) as typeof fs.watch,
		});

		try {
			tracker.ensureObserver();
			await Bun.sleep(40);
			expect(watchCalls).toBe(0);
			expect(run.children[0]?.status).toBe("detached");
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("restores sibling runs when optional control-event files are absent", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-restore-cursor-"));
		const firstDir = path.join(root, "first");
		const secondDir = path.join(root, "second");
		fs.mkdirSync(firstDir);
		fs.mkdirSync(secondDir);
		for (const id of ["first", "second"]) {
			fs.writeFileSync(
				path.join(root, id, "status.json"),
				JSON.stringify({
					runId: id,
					sessionId: "root-session",
					state: "running",
					mode: "single",
					startedAt: 1_000,
					steps: [{ agent: "reviewer", status: "running" }],
				}),
			);
		}
		const state = createFullState("root-session");
		const tracker = createAsyncJobTracker(eventHost(), state, root);
		try {
			await tracker.restoreActiveJobs();
			expect([...state.asyncJobs.keys()].sort()).toEqual(["first", "second"]);
			await waitUntil(() => state.asyncJobs.get("first")?.controlEventCursorPending !== true);
			expect(state.asyncJobs.get("first")?.controlEventCursor).toBe(0);
			expect(state.asyncJobs.get("second")?.controlEventCursor).toBe(0);
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
		state.asyncJobs.set(
			"bounded-output",
			asyncJob("bounded-output", "running", {
				steps: [{ agent: "reviewer", recentOutput, status: "running" }],
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

	test("projects bounded terminal failures and drops task-only partial results across cold restore", async () => {
		const task = "Inspect the Agent detail without changing files.";
		const error = "Provider rejected the child payload\u001b]0;hidden\u0007 after validation.\u202e";
		const state = createState();
		state.recentAgentJobs?.set(
			"failed-detail",
			asyncJob("failed-detail", "failed", {
				tasks: [task],
				steps: [
					{
						agent: "reviewer",
						error,
						recentOutput: [`Task: ${task}`],
						status: "failed",
						task,
					},
				],
			}),
		);

		const projected = row(new CurrentAgents(state, acknowledgedOptions()).snapshot(), "failed-detail:0");
		expect(projected.error).toBe("Provider rejected the child payload after validation.");
		expect(projected.partialResult).toBeNull();
		expect(projected.task).toBe(task);

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-failed-agent-restore-"));
		const runDir = path.join(root, "failed-detail");
		fs.mkdirSync(runDir);
		fs.writeFileSync(
			path.join(runDir, "status.json"),
			JSON.stringify({
				error,
				lastUpdate: 2_000,
				mode: "single",
				runId: "failed-detail",
				sessionId: "root-session",
				startedAt: 1_000,
				state: "failed",
				steps: [{ agent: "reviewer", recentOutput: [`Task: ${task}`], status: "failed", task }],
			}),
		);
		const restoredState = createFullState("root-session");
		const tracker = createAsyncJobTracker(eventHost(), restoredState, root);
		try {
			await tracker.restoreActiveJobs();
			const restored = row(new CurrentAgents(restoredState, acknowledgedOptions()).snapshot(), "failed-detail:0");
			expect(restored.error).toBe("Provider rejected the child payload after validation.");
			expect(restored.partialResult).toBeNull();
		} finally {
			tracker.resetJobs();
			fs.rmSync(root, { force: true, recursive: true });
		}
	});

	test("represents every explicit lifecycle state without inventing nested rows", () => {
		const state = createState();
		const active = [
			asyncJob("queued", "queued"),
			asyncJob("running", "running"),
			asyncJob("supervisor", "running", { currentTool: "contact_supervisor", activityState: "needs_attention" }),
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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
					// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
			addLegacy("legacy-complete", transcript("complete", [finalReport]), { legacyFinalReportComplete: true });
			addLegacy(
				"legacy-wrapper-complete",
				transcript("wrapper", [finalReport]),
				{ legacyFinalReportComplete: true },
				143,
			);
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

	test("recovers legacy final-drain proof asynchronously before UI projection", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-legacy-final-drain-recovery-"));
		const runId = "legacy-recovered";
		const asyncDir = path.join(root, runId);
		const transcriptPath = path.join(asyncDir, "transcript.jsonl");
		fs.mkdirSync(asyncDir);
		fs.writeFileSync(transcriptPath, Buffer.alloc(1024 * 1024, 0x20));
		fs.appendFileSync(
			transcriptPath,
			`\n${JSON.stringify({
				recordType: "message",
				sourceEventType: "message_end",
				role: "assistant",
				stopReason: "stop",
				text: "Recovered final report.",
			})}\n`,
		);
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId: "root-session",
				mode: "single",
				state: "failed",
				startedAt: 1_000,
				lastUpdate: 2_000,
				steps: [
					{
						agent: "reviewer",
						status: "failed",
						transcriptPath,
						processTerminal: signalledProcessTerminal(runId, "SIGTERM"),
					},
				],
			}),
		);
		const state = createFullState("root-session");
		const tracker = createAsyncJobTracker(eventHost(), state, root);
		let hostTicked = false;
		const hostTick = new Promise<void>((resolve) =>
			setTimeout(() => {
				hostTicked = true;
				resolve();
			}, 0),
		);
		try {
			await Promise.all([tracker.restoreActiveJobs(), hostTick]);
			expect(hostTicked).toBeTrue();
			expect(row(new CurrentAgents(state, acknowledgedOptions()).snapshot(), `${runId}:0`).status).toBe("completed");
		} finally {
			tracker.resetJobs();
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
		expect(current.snapshot()).toBe(before);
		current.refresh();
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
		current.refresh();
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
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId: "/sessions/legacy.jsonl",
				mode: "single",
				state: "running",
				pid: process.pid,
				startedAt: 1_000,
				lastUpdate: 2_000,
				steps: [{ agent: "reviewer", status: "running" }],
			}),
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
			eventHost((event, payload) => {
				if (event === SUBAGENT_STEERING_NOTICE_EVENT) notices.push(payload);
			}),
			state,
			root,
			{ pollIntervalMs: 10 },
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
			eventHost(() => {
				observerCalls += 1;
				throw new Error("injected lifecycle observer failure");
			}),
			state,
			root,
			{ pollIntervalMs: 10 },
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
			eventHost((event, payload) => {
				if (event === SUBAGENT_CONTROL_EVENT) delivered.push(payload);
			}),
			state,
			root,
			{ pollIntervalMs: 10 },
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

	test("refreshes state-driven consumers and notifies only on semantic changes", () => {
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

	test("refreshes consumers from status events without a foreground poll loop", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-agent-refresh-"));
		const asyncDir = path.join(root, "live");
		fs.mkdirSync(asyncDir);
		const state = createFullState("root-session");
		let refreshes = 0;
		const tracker = createAsyncJobTracker(eventHost(), state, root, {
			onRefresh: () => {
				refreshes += 1;
			},
			readRunStatus: async () => null,
		});

		try {
			tracker.handleStarted({ id: "live", asyncDir, sessionId: "root-session" });
			await waitUntil(() => refreshes === 1);
			tracker.handleStatus({
				id: "live",
				asyncDir,
				sessionId: "root-session",
				status: {
					runId: "live",
					sessionId: "root-session",
					mode: "single",
					state: "running",
					startedAt: 1_000,
					lastUpdate: 2_000,
					currentTool: "read",
					steps: [{ agent: "reviewer", status: "running", currentTool: "read" }],
				},
			});
			await waitUntil(() => refreshes >= 2);
			const settledRefreshes = refreshes;
			await Bun.sleep(40);
			expect(state.asyncJobs.get("live")?.currentTool).toBe("read");
			expect(refreshes).toBe(settledRefreshes);
		} finally {
			tracker.resetJobs();
			await Bun.sleep(20);
			fs.rmSync(root, { force: true, recursive: true });
		}
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
