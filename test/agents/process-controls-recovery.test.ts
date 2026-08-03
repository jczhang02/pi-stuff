import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../packages/pi-stuff-agents/src/agents/agents.ts";
import {
	executeAsyncParallel,
	executeAsyncSingle,
} from "../../packages/pi-stuff-agents/src/runs/background/async-execution.ts";
import { createAsyncJobTracker } from "../../packages/pi-stuff-agents/src/runs/background/async-job-tracker.ts";
import {
	deliverStopRequest,
	requestAsyncSteer,
} from "../../packages/pi-stuff-agents/src/runs/background/control-channel.ts";
import { reconcileAsyncRun } from "../../packages/pi-stuff-agents/src/runs/background/stale-run-reconciler.ts";
import { waitForSteeringAction } from "../../packages/pi-stuff-agents/src/runs/background/steering.ts";
import { writerProcessRegistryPath } from "../../packages/pi-stuff-agents/src/runs/background/writer-process-registry.ts";
import { createDurableAgentExecutionCoordinator } from "../../packages/pi-stuff-agents/src/runtime/agent-execution-coordinator.ts";
import { SessionAgentGovernor } from "../../packages/pi-stuff-agents/src/runtime/session-governor.ts";
import { CurrentAgents } from "../../packages/pi-stuff-agents/src/session/current-agents.ts";
import {
	ASYNC_DIR,
	DEFAULT_ARTIFACT_CONFIG,
	getAsyncConfigPath,
	RESULTS_DIR,
	SUBAGENT_ASYNC_STARTED_EVENT,
	type SubagentState,
} from "../../packages/pi-stuff-agents/src/shared/types.ts";
import { PROCESS_CONTROLS_PROVIDER_EXTENSION_PATH } from "./fixtures/process-controls-provider.ts";

const providerExtension = PROCESS_CONTROLS_PROVIDER_EXTENSION_PATH;
const PI_BIN_ENV = "PI_BIN";
const piBinary = process.env[PI_BIN_ENV] ?? "/opt/pi-coding-agent/pi";
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const PROCESS_CONTROLS_LOG_ENV = "PI_STUFF_PROCESS_CONTROLS_LOG";
const SUBAGENT_PI_BINARY_ENV = "PI_SUBAGENT_PI_BINARY";
const temporaryPaths: string[] = [];
const processGroups = new Set<number>();
const originalEnvironment = {
	agentDir: process.env[AGENT_DIR_ENV],
	log: process.env[PROCESS_CONTROLS_LOG_ENV],
	piBinary: process.env[SUBAGENT_PI_BINARY_ENV],
};
let piBinaryCertified = false;

afterEach(() => {
	for (const pid of processGroups) killProcessGroup(pid);
	processGroups.clear();
	for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
	setOrDelete("PI_CODING_AGENT_DIR", originalEnvironment.agentDir);
	setOrDelete("PI_STUFF_PROCESS_CONTROLS_LOG", originalEnvironment.log);
	setOrDelete("PI_SUBAGENT_PI_BINARY", originalEnvironment.piBinary);
});

function setOrDelete(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function fixtureRoot(prefix: string): string {
	if (!piBinaryCertified) {
		const version = Bun.spawnSync([piBinary, "--version"], { stdout: "pipe", stderr: "pipe" });
		const reportedVersion = version.stdout.toString().trim();
		if (version.exitCode !== 0 || reportedVersion !== "0.83.0") {
			throw new Error(
				`Set PI_BIN to the certified Pi 0.83.0 standalone binary; '${piBinary}' reported '${reportedVersion || version.stderr.toString().trim()}'.`,
			);
		}
		piBinaryCertified = true;
	}
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryPaths.push(root);
	const agentDir = path.join(root, "agent-config");
	fs.mkdirSync(agentDir, { recursive: true });
	setOrDelete(AGENT_DIR_ENV, agentDir);
	setOrDelete(SUBAGENT_PI_BINARY_ENV, piBinary);
	setOrDelete(PROCESS_CONTROLS_LOG_ENV, path.join(root, "provider.jsonl"));
	return root;
}

function agent(root: string): AgentConfig {
	return {
		name: "general-purpose",
		description: "Process-level controls fixture",
		model: "pi-stuff-process-controls/fixture-model",
		extensions: [providerExtension],
		systemPrompt: "Follow the deterministic process-controls fixture.",
		systemPromptMode: "append",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: path.join(root, "general-purpose.md"),
	};
}

class EventLog {
	readonly records: Array<{ name: string; data: unknown }> = [];

	emit(name: string, data: unknown): void {
		this.records.push({ name, data });
	}

	on(): () => void {
		return () => {};
	}

	started(runId: string): Record<string, unknown> {
		const match = this.records.find(
			(record) =>
				record.name === SUBAGENT_ASYNC_STARTED_EVENT &&
				typeof record.data === "object" &&
				record.data !== null &&
				(record.data as { id?: unknown }).id === runId,
		);
		if (!match) throw new Error(`No start event recorded for ${runId}.`);
		return match.data as Record<string, unknown>;
	}
}

function extensionApi(events: EventLog): ExtensionAPI {
	return { events } as unknown as ExtensionAPI;
}

function artifactConfig() {
	return { ...DEFAULT_ARTIFACT_CONFIG, enabled: false };
}

function readJson(filePath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

interface ProviderRecord {
	kind?: unknown;
	childIndex?: unknown;
	userText?: unknown;
}

function readProviderRecords(root: string): ProviderRecord[] {
	const logPath = path.join(root, "provider.jsonl");
	if (!fs.existsSync(logPath)) return [];
	return fs
		.readFileSync(logPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ProviderRecord);
}

async function waitFor<T>(description: string, read: () => T | undefined, timeoutMs = 12_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const value = read();
		if (value !== undefined) return value;
		await Bun.sleep(50);
	}
	throw new Error(`Timed out waiting for ${description}.`);
}

function runnerPid(events: EventLog, runId: string): number {
	const pid = events.started(runId).pid;
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
		throw new Error(`Run ${runId} did not publish a runner PID.`);
	}
	processGroups.add(pid);
	return pid;
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function killProcessGroup(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
}

function cleanupRun(runId: string): void {
	for (const target of [
		path.join(ASYNC_DIR, runId),
		path.join(RESULTS_DIR, `${runId}.json`),
		getAsyncConfigPath(runId),
	]) {
		fs.rmSync(target, { recursive: true, force: true });
	}
}

function stateForSession(sessionId: string): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: sessionId,
		subagentInProgress: false,
		subagentSpawns: { sessionId, count: 0 },
		asyncJobs: new Map(),
		recentAgentJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		pendingForegroundControlNotices: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function seedSession(root: string): string {
	const sessionDir = path.join(root, "seed-session");
	fs.mkdirSync(sessionDir, { recursive: true });
	const result = Bun.spawnSync(
		[
			piBinary,
			"--offline",
			"--approve",
			"--no-extensions",
			"--no-skills",
			"--no-context-files",
			"--extension",
			providerExtension,
			"--provider",
			"pi-stuff-process-controls",
			"--model",
			"fixture-model",
			"--session-dir",
			sessionDir,
			"--session-id",
			"process-controls-seed",
			"PROCESS_SEED",
		],
		{ cwd: root, env: { ...process.env }, stdout: "pipe", stderr: "pipe" },
	);
	if (result.exitCode !== 0) {
		throw new Error(`Failed to seed Pi session: ${result.stderr.toString()}`);
	}
	const session = fs.readdirSync(sessionDir).find((entry) => entry.endsWith(".jsonl"));
	if (!session) throw new Error("Seed Pi process did not create a session file.");
	return path.join(sessionDir, session);
}

describe("process-level Agent controls and crash recovery", () => {
	// biome-ignore format: Keep real-process body and its independent timeout visibly grouped.
	test(
		"targets steer and stop to one real parallel writer without disturbing its sibling",
		async () => {
			const root = fixtureRoot("pi-stuff-process-controls-");
			const runId = `controls-${process.pid}-${Date.now()}`;
			cleanupRun(runId);
			const events = new EventLog();
			const sessionId = `session-${runId}`;
			const config = agent(root);
			try {
				const launched = executeAsyncParallel(runId, {
					agents: [config],
					tasks: [
						{ agent: config.name, task: "PROCESS_CONTROL_HOLD_0" },
						{ agent: config.name, task: "PROCESS_CONTROL_HOLD_1" },
					],
					ctx: {
						pi: extensionApi(events),
						cwd: root,
						currentSessionId: sessionId,
						parentSessionId: sessionId,
					},
					artifactConfig: artifactConfig(),
					maxSubagentDepth: 3,
					concurrency: 2,
					globalConcurrencyLimit: 2,
				});
				expect(launched.isError).not.toBeTrue();
				const asyncDir = launched.details.asyncDir;
				if (!asyncDir) throw new Error("Parallel launch did not return asyncDir.");
				runnerPid(events, runId);

				await waitFor("both child writers to run", () => {
					const statusPath = path.join(asyncDir, "status.json");
					if (!fs.existsSync(statusPath)) return undefined;
					const status = readJson(statusPath);
					const steps = status.steps as Array<{ status?: string }> | undefined;
					return steps?.length === 2 && steps.every((step) => step.status === "running") ? status : undefined;
				});

				const requestId = `steer-${Date.now()}`;
				requestAsyncSteer(asyncDir, {
					id: requestId,
					message: "TARGET_ONLY_CHILD_ZERO",
					targetIndex: 0,
					source: "process-acceptance",
				});
				const steering = await waitForSteeringAction({
					asyncDir,
					sourceRunId: runId,
					requestId,
					timeoutMs: 5_000,
				});
				expect(steering).toMatchObject({
					state: "delivered",
					targets: [{ index: 0, state: "delivered" }],
				});
				await waitFor("child zero to consume the directed steer", () => {
					const request = readProviderRecords(root).find(
						(record) =>
							record.kind === "request" &&
							record.childIndex === "0" &&
							typeof record.userText === "string" &&
							record.userText.includes("TARGET_ONLY_CHILD_ZERO"),
					);
					return request ? true : undefined;
				});
				expect(
					readProviderRecords(root).some(
						(record) =>
							record.childIndex === "1" &&
							typeof record.userText === "string" &&
							record.userText.includes("TARGET_ONLY_CHILD_ZERO"),
					),
				).toBeFalse();

				deliverStopRequest({ asyncDir, source: "process-acceptance", targetIndex: 0 });
				await waitFor("only child zero to stop", () => {
					const statusPath = path.join(asyncDir, "status.json");
					if (!fs.existsSync(statusPath)) return undefined;
					const status = readJson(statusPath);
					const steps = status.steps as Array<{ status?: string }> | undefined;
					return steps?.[0]?.status === "stopped" && steps[1]?.status === "running" ? status : undefined;
				});

				const result = await waitFor("parallel completion", () => {
					const resultPath = path.join(RESULTS_DIR, `${runId}.json`);
					return fs.existsSync(resultPath) ? readJson(resultPath) : undefined;
				}, 12_000);
				const children = result.results as Array<Record<string, unknown>>;
				expect(children[0]).toMatchObject({ stopped: true, success: false });
				expect(children[1]).toMatchObject({ success: true, output: "PROCESS_CONTROL_RUNNING_1" });
				const eventsText = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf8");
				expect(eventsText).toContain('"type":"subagent.child.stop_requested"');
				expect(eventsText).toContain('"index":0');
				expect(eventsText).not.toContain(`"requestId":"${requestId}","index":1`);
			} finally {
				cleanupRun(runId);
			}
		},
		25_000,
	);

	// biome-ignore format: Keep crash-recovery body and its independent timeout visibly grouped.
	test(
		"kills an orphan writer after a runner-only crash, then resumes the same logical Agent once",
		async () => {
			const root = fixtureRoot("pi-stuff-process-recovery-");
			const sessionFile = seedSession(root);
			const sessionId = `recovery-session-${process.pid}-${Date.now()}`;
			const sourceRunId = `crash-${process.pid}-${Date.now()}`;
			const resumedRunId = `resume-${process.pid}-${Date.now()}`;
			const governorRoot = path.join(root, "governor");
			const config = agent(root);
			const events = new EventLog();
			cleanupRun(sourceRunId);
			cleanupRun(resumedRunId);
			try {
				const firstCoordinator = createDurableAgentExecutionCoordinator({ rootDir: governorRoot });
				firstCoordinator.bindSession({ sessionId, ownerAgentPath: [] });
				const prepared = await firstCoordinator.prepare({
					launchRunId: sourceRunId,
					params: { agent: config.name, task: "PROCESS_CRASH_HOLD" },
				});
				if (!prepared.ok || !prepared.invocation) throw new Error("Initial Agent reservation failed.");
				const launched = executeAsyncSingle(sourceRunId, {
					agent: config.name,
					task: "PROCESS_CRASH_HOLD",
					agentConfig: config,
					sessionFile,
					ctx: {
						pi: extensionApi(events),
						cwd: root,
						currentSessionId: sessionId,
						parentSessionId: sessionId,
					},
					artifactConfig: artifactConfig(),
					maxSubagentDepth: 3,
				});
				expect(launched.isError).not.toBeTrue();
				const asyncDir = launched.details.asyncDir;
				if (!asyncDir) throw new Error("Crash launch did not return asyncDir.");
				const pid = runnerPid(events, sourceRunId);
				await firstCoordinator.observeAsyncStarted(events.started(sourceRunId));
				await firstCoordinator.settle(prepared.invocation, launched);
				await waitFor("crash writer to run", () => {
					const statusPath = path.join(asyncDir, "status.json");
					if (!fs.existsSync(statusPath)) return undefined;
					const status = readJson(statusPath);
					const steps = status.steps as Array<{ status?: string }> | undefined;
					return steps?.[0]?.status === "running" ? status : undefined;
				});

					const beforeCrash = await new SessionAgentGovernor({ rootDir: governorRoot, sessionId }).snapshot();
					expect(beforeCrash).toMatchObject({ total: 1, running: 1 });
					const writerPid = await waitFor("writer process identity", () => {
						const registryPath = writerProcessRegistryPath(asyncDir);
						if (!fs.existsSync(registryPath)) return undefined;
						const registry = readJson(registryPath);
						const writer = (registry.writers as Record<string, { state?: string; pid?: number }> | undefined)?.["0"];
						return writer?.state === "running" && typeof writer.pid === "number" ? writer.pid : undefined;
					});
					expect(processAlive(writerPid)).toBeTrue();
					process.kill(pid, "SIGKILL");
					await waitFor("runner process death", () => (!processAlive(pid) ? true : undefined));

					const repaired = reconcileAsyncRun(asyncDir, { resultsDir: RESULTS_DIR });
					expect(repaired.repaired).toBeTrue();
					expect(repaired.status).toMatchObject({ state: "failed" });
					expect(repaired.message).toContain("exited or disappeared");
					await waitFor("orphan writer process death", () => (!processAlive(writerPid) ? true : undefined));
					processGroups.delete(pid);

				const restoredState = stateForSession(sessionId);
				const tracker = createAsyncJobTracker(extensionApi(new EventLog()), restoredState, ASYNC_DIR, {
					resultsDir: RESULTS_DIR,
				});
				tracker.restoreActiveJobs();
				const rows = new CurrentAgents(restoredState, {
					inspect: () => true,
					steer: () => true,
					stop: () => true,
					resume: () => true,
				}).snapshot().rows;
				expect(rows.find((row) => row.runId === sourceRunId)?.status).toBe("crashed");
				expect(restoredState.asyncJobs.has(sourceRunId)).toBeFalse();

				const reloadedCoordinator = createDurableAgentExecutionCoordinator({ rootDir: governorRoot });
				reloadedCoordinator.bindSession({ sessionId, ownerAgentPath: [] });
				await reloadedCoordinator.reconcileExisting();
				const afterReconcile = await new SessionAgentGovernor({ rootDir: governorRoot, sessionId }).snapshot();
				expect(afterReconcile).toMatchObject({ total: 1, running: 0 });

				const resumeReservation = await reloadedCoordinator.prepare({
					launchRunId: resumedRunId,
					params: { action: "resume", id: sourceRunId, index: 0 },
					resumeTargetRunId: sourceRunId,
				});
				if (!resumeReservation.ok || !resumeReservation.invocation) throw new Error("Resume reservation failed.");
				const resumed = executeAsyncSingle(resumedRunId, {
					agent: config.name,
					task: "PROCESS_RESUME_FINISH",
					agentConfig: config,
					sessionFile,
					revivalLease: {
						sessionFile,
						runId: resumedRunId,
						sourceRunId,
						parentSessionId: sessionId,
					},
					ctx: {
						pi: extensionApi(events),
						cwd: root,
						currentSessionId: sessionId,
						parentSessionId: sessionId,
					},
					artifactConfig: artifactConfig(),
					maxSubagentDepth: 3,
				});
				expect(resumed.isError).not.toBeTrue();
				runnerPid(events, resumedRunId);
				await reloadedCoordinator.observeAsyncStarted(events.started(resumedRunId));
				await reloadedCoordinator.settle(resumeReservation.invocation, resumed);
				const resumedResult = await waitFor("resumed Agent completion", () => {
					const resultPath = path.join(RESULTS_DIR, `${resumedRunId}.json`);
					return fs.existsSync(resultPath) ? readJson(resultPath) : undefined;
				});
				expect(resumedResult).toMatchObject({ success: true, summary: "PROCESS_RESUME_COMPLETED" });
				await waitFor("resumed runner process exit", () => {
					const resumedPid = events.started(resumedRunId).pid;
					return typeof resumedPid === "number" && !processAlive(resumedPid) ? true : undefined;
				});

				const completion = { runId: resumedRunId, results: [{ taskIndex: 0 }] };
				await reloadedCoordinator.complete(completion);
				await reloadedCoordinator.complete(completion);
				const afterCompletion = await new SessionAgentGovernor({ rootDir: governorRoot, sessionId }).snapshot();
				expect(afterCompletion).toMatchObject({ total: 1, running: 0 });
				expect(afterCompletion.agents.map((entry) => entry.logicalAgentId)).toEqual([`${sourceRunId}:0`]);
				const completedEvents = fs
					.readFileSync(path.join(ASYNC_DIR, resumedRunId, "events.jsonl"), "utf8")
					.split("\n")
					.filter((line) => line.includes('"type":"subagent.run.completed"'));
				expect(completedEvents).toHaveLength(1);
				tracker.resetJobs();
				firstCoordinator.dispose();
				reloadedCoordinator.dispose();
			} finally {
				cleanupRun(sourceRunId);
				cleanupRun(resumedRunId);
			}
		},
		30_000,
	);
});
