import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentConfig } from "../../packages/pi-stuff/src/subagents/src/agents/agents.js";
import {
	acquireRunnerProcessStartIdentity,
	buildAsyncParallelRunnerWork,
	buildAsyncSingleRunnerWork,
	buildNestedTerminalFallbackStatus,
	claimBackgroundRunDirectory,
	cleanupBackgroundRunAfterAbort,
	finalizeSpawnedRunnerClose,
	initializePreIdentityWriterAbsenceProof,
	removeRunnerStartupMarkerBestEffort,
	resolveAsyncRunnerBunCommand,
	resolveBackgroundOwnershipFailure,
	resolveNestedTerminalStatus,
	terminateRunnerBeforeProceed,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/async-execution.js";
import { readAsyncRecoveryDescriptor } from "../../packages/pi-stuff/src/subagents/src/runs/background/async-resume.js";
import { listAsyncRuns } from "../../packages/pi-stuff/src/subagents/src/runs/background/async-status.js";
import {
	requestAsyncSteer,
	requestAsyncStop,
	steerAcksDir,
	steerInboxClosedPath,
	steerRequestsDir,
	stepSteerInboxDir,
	writeSteerAck,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/control-channel.js";
import {
	finalizeProcessTerminal,
	writeProcessTerminalCandidate,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/process-terminal.js";
import { reconcileAsyncRun } from "../../packages/pi-stuff/src/subagents/src/runs/background/stale-run-reconciler.js";
import {
	buildWriterProcessEnv,
	buildWriterSpawnCommand,
	captureWriterProcessStartIdentity,
	createBackgroundCompletion,
	createInitialStatus,
	runBackgroundWork,
	runConfiguredBackground,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/subagent-runner.js";
import {
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/writer-process-registry.js";
import { projectForegroundCompletion } from "../../packages/pi-stuff/src/subagents/src/runs/foreground/execution.js";
import { resolveBunRuntimeCommand } from "../../packages/pi-stuff/src/subagents/src/runs/shared/bun-runtime.js";
import {
	createNestedRoute,
	writeNestedEvent,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/nested-events.js";
import type {
	BackgroundRunnerConfig,
	RunnerAgentTask,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/parallel-utils.js";
import {
	shardedDurableClaimName,
	tryAcquireKernelClaim,
} from "../../packages/pi-stuff/src/subagents/src/shared/durable-claim.js";
import {
	projectAgentDefinition,
	projectLaunchBinding,
} from "../../packages/pi-stuff/src/subagents/src/shared/launch-contract.js";
import { ASYNC_DIR } from "../../packages/pi-stuff/src/subagents/src/shared/types.js";

const temporaryDirectories: string[] = [];
const originalPiBinary = process.env.PI_SUBAGENT_PI_BINARY;
const originalChildProtocolMaxBytes = process.env.PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES;
const originalTaskResultMaxBytes = process.env.PI_SUBAGENT_TASK_RESULT_MAX_BYTES;
const originalRunResultMaxBytes = process.env.PI_SUBAGENT_RUN_RESULT_MAX_BYTES;
const originalTmpDir = process.env.TMPDIR;
const originalTmp = process.env.TMP;
const originalTemp = process.env.TEMP;

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
	if (originalPiBinary === undefined) delete process.env.PI_SUBAGENT_PI_BINARY;
	else process.env.PI_SUBAGENT_PI_BINARY = originalPiBinary;
	if (originalChildProtocolMaxBytes === undefined) delete process.env.PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES;
	else process.env.PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES = originalChildProtocolMaxBytes;
	if (originalTaskResultMaxBytes === undefined) delete process.env.PI_SUBAGENT_TASK_RESULT_MAX_BYTES;
	else process.env.PI_SUBAGENT_TASK_RESULT_MAX_BYTES = originalTaskResultMaxBytes;
	if (originalRunResultMaxBytes === undefined) delete process.env.PI_SUBAGENT_RUN_RESULT_MAX_BYTES;
	else process.env.PI_SUBAGENT_RUN_RESULT_MAX_BYTES = originalRunResultMaxBytes;
	if (originalTmpDir === undefined) delete process.env.TMPDIR;
	else process.env.TMPDIR = originalTmpDir;
	if (originalTmp === undefined) delete process.env.TMP;
	else process.env.TMP = originalTmp;
	if (originalTemp === undefined) delete process.env.TEMP;
	else process.env.TEMP = originalTemp;
});

function fixtureRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-background-contract-"));
	temporaryDirectories.push(root);
	fs.mkdirSync(path.join(root, "skills", "review"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "skills", "review", "SKILL.md"),
		"---\nname: review\ndescription: Review a change\n---\nReview the implementation carefully.\n",
	);
	fs.mkdirSync(path.join(root, "packages", "core"), { recursive: true });
	return root;
}

function isolatedSystemTempRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-owned-tmp-"));
	temporaryDirectories.push(root);
	process.env.TMPDIR = root;
	process.env.TMP = root;
	process.env.TEMP = root;
	return root;
}

function fallbackSessionKeyForTest(sessionFile: string): string {
	const resolved = path.resolve(sessionFile);
	let canonicalSlot = path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved));
	if (process.platform === "win32") canonicalSlot = canonicalSlot.toLowerCase();
	return createHash("sha256").update(canonicalSlot).digest("hex");
}

function fallbackShardForTest(sessionFile: string): number {
	return createHash("sha256").update(fallbackSessionKeyForTest(sessionFile)).digest().readUInt32BE(0) % 4_096;
}

async function waitForFile(filePath: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath)) return;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForFileText(filePath: string, text: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").includes(text)) return;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for ${text} in ${filePath}`);
}

async function waitForDirectoryEntry(directory: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) return;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for an entry in ${directory}`);
}

async function waitForCondition(check: () => boolean, description: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for ${description}`);
}

function agent(root: string, name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `${name} fixture`,
		systemPrompt: `You are ${name}.`,
		systemPromptMode: "append",
		inheritProjectContext: true,
		inheritSkills: false,
		source: "project",
		filePath: path.join(root, `${name}.md`),
		skillPath: [path.join(root, "skills")],
		...overrides,
	};
}

function buildContext(root: string) {
	return {
		pi: { events: { emit() {} } } as never,
		cwd: root,
		currentSessionId: "parent-session",
		parentSessionId: "parent-session",
		currentModelProvider: "provider",
		currentModel: { provider: "provider", id: "parent" },
	};
}

function nestedFallbackConfig(root: string, resultPath: string): BackgroundRunnerConfig {
	return {
		version: 2,
		id: "nested-fallback",
		cwd: root,
		asyncDir: path.join(root, "async"),
		resultPath,
		work: {
			mode: "single",
			task: {
				agent: "writer",
				task: "Inspect",
				cwd: root,
				context: "fresh",
				systemPrompt: "Inspect carefully.",
				systemPromptMode: "append",
				inheritProjectContext: true,
				inheritSkills: false,
				maxSubagentDepth: 1,
			},
		},
	};
}

describe("background runner configuration", () => {
	test("does not block Pi's event loop while aborting an exact gated runner", async () => {
		if (process.platform === "win32") return;
		const child = spawn(
			process.execPath,
			["-e", 'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);'],
			{ detached: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("Gated runner probe did not start.")), 3_000);
				child.once("error", reject);
				child.stdout?.once("data", () => {
					clearTimeout(timeout);
					resolve();
				});
			});
			if (!child.pid) throw new Error("Gated runner probe has no PID.");
			const identity = await acquireRunnerProcessStartIdentity(child.pid);
			if (!identity) throw new Error("Gated runner probe has no process identity.");
			const startedAt = performance.now();
			terminateRunnerBeforeProceed(child.pid, identity);
			expect(performance.now() - startedAt).toBeLessThan(250);
			await new Promise<void>((resolve) => child.once("close", () => resolve()));
		} finally {
			if (child.pid && child.exitCode === null && child.signalCode === null) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			}
		}
	}, 5_000);

	test("refuses to overwrite an existing background lifecycle directory", () => {
		const id = randomUUID().replaceAll("-", "").slice(0, 12);
		const asyncDir = path.join(ASYNC_DIR, id);
		temporaryDirectories.push(asyncDir);
		fs.mkdirSync(asyncDir, { recursive: true, mode: 0o700 });
		fs.writeFileSync(path.join(asyncDir, "sentinel"), "retained evidence");

		const claimed = claimBackgroundRunDirectory(id);

		expect(claimed).toMatchObject({ error: expect.stringContaining("refusing to overwrite") });
		expect(fs.readFileSync(path.join(asyncDir, "sentinel"), "utf8")).toBe("retained evidence");
	});

	test("failed background preparation never deletes a replacement directory", () => {
		const id = randomUUID().replaceAll("-", "").slice(0, 12);
		const claimed = claimBackgroundRunDirectory(id);
		if ("error" in claimed) throw new Error(claimed.error);
		const originalDir = `${claimed.asyncDir}.original`;
		temporaryDirectories.push(claimed.asyncDir, originalDir);
		fs.renameSync(claimed.asyncDir, originalDir);
		fs.mkdirSync(claimed.asyncDir, { mode: 0o700 });
		fs.writeFileSync(path.join(claimed.asyncDir, "sentinel"), "replacement");

		claimed.cleanup();

		expect(fs.readFileSync(path.join(claimed.asyncDir, "sentinel"), "utf8")).toBe("replacement");
		expect(fs.existsSync(originalDir)).toBe(true);
	});

	test("committing background preparation removes only its ownership marker", () => {
		const id = randomUUID().replaceAll("-", "").slice(0, 12);
		const claimed = claimBackgroundRunDirectory(id);
		if ("error" in claimed) throw new Error(claimed.error);
		temporaryDirectories.push(claimed.asyncDir);
		const marker = path.join(claimed.asyncDir, ".background-preparation-owner.json");
		expect(fs.existsSync(marker)).toBe(true);

		expect(claimed.commit()).toBe(true);

		expect(fs.existsSync(claimed.asyncDir)).toBe(true);
		expect(fs.existsSync(marker)).toBe(false);
	});

	test("retains lifecycle evidence unless abort proves the runner and writers exited", () => {
		const unsafeId = randomUUID().replaceAll("-", "").slice(0, 12);
		const unsafeClaim = claimBackgroundRunDirectory(unsafeId);
		if ("error" in unsafeClaim) throw new Error(unsafeClaim.error);
		temporaryDirectories.push(unsafeClaim.asyncDir);

		expect(cleanupBackgroundRunAfterAbort(unsafeClaim, () => false)).toBe(false);
		expect(fs.existsSync(unsafeClaim.asyncDir)).toBe(true);
		expect(fs.existsSync(path.join(unsafeClaim.asyncDir, ".background-preparation-owner.json"))).toBe(true);

		const safeId = randomUUID().replaceAll("-", "").slice(0, 12);
		const safeClaim = claimBackgroundRunDirectory(safeId);
		if ("error" in safeClaim) throw new Error(safeClaim.error);
		temporaryDirectories.push(safeClaim.asyncDir);
		expect(cleanupBackgroundRunAfterAbort(safeClaim, () => true)).toBe(true);
		expect(fs.existsSync(safeClaim.asyncDir)).toBe(false);
	});

	for (const abortFailure of ["false", "throw"] as const) {
		test(`retains a complete lifecycle binding when post-spawn ownership abort returns ${abortFailure}`, () => {
			const id = randomUUID().replaceAll("-", "").slice(0, 12);
			const claimed = claimBackgroundRunDirectory(id);
			if ("error" in claimed) throw new Error(claimed.error);
			temporaryDirectories.push(claimed.asyncDir);
			const acknowledgeStart = () => {};
			const abortStart = () => {
				if (abortFailure === "throw") throw Object.assign(new Error("injected abort EIO"), { code: "EIO" });
				return false;
			};

			const resolution = resolveBackgroundOwnershipFailure(claimed, {
				pid: 41_001,
				processStartIdentity: "boot:41001",
				acknowledgeStart,
				abortStart,
			});

			expect(resolution).toEqual({
				safeToRelease: false,
				lifecycleBinding: {
					pid: 41_001,
					processStartIdentity: "boot:41001",
					asyncDir: claimed.asyncDir,
					acknowledgeStart,
					abortStart,
				},
			});
			expect(fs.existsSync(claimed.asyncDir)).toBe(true);
			expect(fs.existsSync(path.join(claimed.asyncDir, ".background-preparation-owner.json"))).toBe(false);
		});
	}

	test("retains the actual runner pid and runtime directory when startup identity is unavailable", () => {
		const id = randomUUID().replaceAll("-", "").slice(0, 12);
		const claimed = claimBackgroundRunDirectory(id);
		if ("error" in claimed) throw new Error(claimed.error);
		temporaryDirectories.push(claimed.asyncDir);

		const resolution = resolveBackgroundOwnershipFailure(claimed, { pid: 41_002 });

		expect(resolution).toEqual({
			safeToRelease: false,
			lifecycleBinding: {
				pid: 41_002,
				asyncDir: claimed.asyncDir,
			},
		});
		expect(fs.existsSync(claimed.asyncDir)).toBeTrue();
		expect(fs.existsSync(path.join(claimed.asyncDir, ".background-preparation-owner.json"))).toBeFalse();
	});

	test("pre-initializes revival writer absence before identity capture and an unsafe delayed close", () => {
		const root = fixtureRoot();
		const id = randomUUID().replaceAll("-", "").slice(0, 12);
		const claimed = claimBackgroundRunDirectory(id);
		if ("error" in claimed) throw new Error(claimed.error);
		temporaryDirectories.push(claimed.asyncDir);
		const runnerPid = 41_003;
		const config: BackgroundRunnerConfig = {
			version: 2,
			id,
			cwd: root,
			asyncDir: claimed.asyncDir,
			resultPath: path.join(claimed.asyncDir, "result.json"),
			revivalLease: {
				sessionFile: path.join(root, "child-session.jsonl"),
				runId: id,
				sourceRunId: "source-run",
				asyncDir: claimed.asyncDir,
			},
			work: nestedFallbackConfig(root, path.join(claimed.asyncDir, "result.json")).work,
		};

		expect(initializePreIdentityWriterAbsenceProof(config, runnerPid)).toBeTrue();
		const resolution = resolveBackgroundOwnershipFailure(claimed, { pid: runnerPid });

		expect(resolution).toMatchObject({
			safeToRelease: false,
			lifecycleBinding: { pid: runnerPid, asyncDir: claimed.asyncDir },
		});
		expect(inspectWriterProcessLiveness(claimed.asyncDir)).toBeFalse();
	});

	test("does not turn post-authorization startup marker cleanup into a false launch failure", () => {
		expect(() =>
			removeRunnerStartupMarkerBestEffort("/tmp/runner-startup.json", () => {
				throw Object.assign(new Error("injected cleanup EIO"), { code: "EIO" });
			}),
		).not.toThrow();
	});

	test("contains close-time terminal proof failure when the runtime directory disappears", () => {
		const root = fixtureRoot();
		const missingDir = path.join(root, "removed-before-close");
		const config: BackgroundRunnerConfig = {
			...nestedFallbackConfig(root, path.join(missingDir, "result.json")),
			id: "removed-before-close",
			asyncDir: missingDir,
		};

		expect(() =>
			finalizeSpawnedRunnerClose({
				launchConfig: config,
				runnerProcessInstanceId: "runner-close-proof",
				exitCode: 1,
				signal: null,
			}),
		).not.toThrow();
	});

	test("repairs paused, stopped, and timed-out child state from durable results", () => {
		const root = fixtureRoot();
		const resultsDir = path.join(root, "results");
		fs.mkdirSync(resultsDir, { recursive: true });
		const fixtures = [
			{
				runId: "repair-paused",
				state: "paused",
				startedAt: 1_000,
				endedAt: 1_500,
				now: 100_000,
				child: { success: false, exitCode: 1, interrupted: true, error: "Agent paused." },
				expected: { status: "paused", error: "Agent paused." },
				missingStatus: true,
			},
			{
				runId: "repair-stopped",
				state: "stopped",
				now: 2_000,
				child: { success: false, exitCode: 1, stopped: true, error: "Agent stopped by user." },
				expected: { status: "stopped", stopped: true, error: "Agent stopped by user." },
				missingStatus: false,
			},
			{
				runId: "repair-timeout",
				state: "failed",
				now: 2_000,
				timedOut: true,
				child: {
					success: false,
					exitCode: 1,
					timedOut: true,
					error: "Agent timed out.",
					turnBudgetExceeded: true,
					wrapUpRequested: true,
				},
				expected: {
					status: "failed",
					timedOut: true,
					turnBudgetExceeded: true,
					wrapUpRequested: true,
					error: "Agent timed out.",
				},
				missingStatus: false,
			},
		] as const;

		for (const fixture of fixtures) {
			const asyncDir = path.join(root, fixture.runId);
			fs.mkdirSync(asyncDir, { recursive: true });
			if (!fixture.missingStatus) {
				fs.writeFileSync(
					path.join(asyncDir, "status.json"),
					JSON.stringify({
						runId: fixture.runId,
						mode: "single",
						state: "running",
						startedAt: 1_000,
						currentTool: "read",
						currentToolStartedAt: 1_100,
						currentPath: "/repo/stale.ts",
						steps: [
							{
								agent: "writer",
								status: "running",
								startedAt: 1_000,
								currentTool: "read",
								currentToolArgs: "stale.ts",
								currentToolStartedAt: 1_100,
								currentPath: "/repo/stale.ts",
							},
						],
					}),
				);
			}
			fs.writeFileSync(
				path.join(resultsDir, `${fixture.runId}.json`),
				JSON.stringify({
					runId: fixture.runId,
					state: fixture.state,
					success: false,
					...("startedAt" in fixture ? { startedAt: fixture.startedAt, endedAt: fixture.endedAt } : {}),
					...("timedOut" in fixture && fixture.timedOut ? { timedOut: true } : {}),
					results: [{ agent: "writer", output: fixture.child.error, ...fixture.child }],
				}),
			);

			const repaired = reconcileAsyncRun(asyncDir, {
				resultsDir,
				now: () => fixture.now,
				...(fixture.missingStatus
					? {
							startedRun: {
								runId: fixture.runId,
								mode: "single" as const,
								agents: ["writer"],
								startedAt: 1_000,
							},
						}
					: {}),
			});

			expect(repaired.repaired).toBe(true);
			expect(repaired.status?.state).toBe(fixture.state);
			expect(repaired.status?.steps?.[0]).toMatchObject(fixture.expected);
			expect(repaired.status?.currentTool).toBeUndefined();
			expect(repaired.status?.currentPath).toBeUndefined();
			expect(repaired.status?.steps?.[0]?.currentTool).toBeUndefined();
			expect(repaired.status?.steps?.[0]?.currentToolArgs).toBeUndefined();
			expect(repaired.status?.steps?.[0]?.currentPath).toBeUndefined();
			if ("timedOut" in fixture && fixture.timedOut) expect(repaired.status?.timedOut).toBe(true);
			if ("endedAt" in fixture) {
				expect(repaired.status?.endedAt).toBe(fixture.endedAt);
				expect(repaired.status?.lastUpdate).toBe(fixture.endedAt);
				expect(repaired.status?.steps?.[0]?.endedAt).toBe(fixture.endedAt);
				expect(repaired.status?.steps?.[0]?.durationMs).toBe(500);
			}
		}
	});

	test("prefers a result committed while stale-run liveness is being checked", () => {
		const root = fixtureRoot();
		const runId = "result-during-liveness";
		const asyncDir = path.join(root, runId);
		const resultsDir = path.join(root, "results-during-liveness");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.mkdirSync(resultsDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				mode: "single",
				state: "running",
				pid: 2_147_483_647,
				processStartIdentity: "dead-runner",
				startedAt: 1_000,
				steps: [{ agent: "writer", status: "running", startedAt: 1_000 }],
			}),
		);
		initializeWriterProcessRegistry(asyncDir, runId, process.pid, 1);
		const resultPath = path.join(resultsDir, `${runId}.json`);
		let committed = false;

		const repaired = reconcileAsyncRun(asyncDir, {
			resultsDir,
			now: () => 2_000,
			kill: (_pid, signal) => {
				if (signal === 0 && !committed) {
					committed = true;
					fs.writeFileSync(
						resultPath,
						JSON.stringify({
							runId,
							state: "complete",
							success: true,
							results: [{ agent: "writer", output: "REAL_SUCCESS", success: true, exitCode: 0 }],
						}),
					);
				}
				throw Object.assign(new Error("dead"), { code: "ESRCH" });
			},
		});

		expect(repaired.status).toMatchObject({
			state: "complete",
			steps: [{ status: "complete", exitCode: 0 }],
		});
		expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
			state: "complete",
			success: true,
			results: [{ output: "REAL_SUCCESS" }],
		});
	});

	test("atomically projects recovered process proof into failed status and repairs an old split projection", () => {
		const root = fixtureRoot();
		const runId = "recovered-terminal-projection";
		const asyncDir = path.join(root, runId);
		const resultsDir = path.join(root, "recovered-results");
		const sessionFile = path.join(root, "recoverable-child.jsonl");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.mkdirSync(resultsDir);
		fs.writeFileSync(sessionFile, "");
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 3,
				runId,
				parentRunOrigin: "user",
				mode: "single",
				state: "running",
				pid: 2_147_483_647,
				processStartIdentity: "dead-runner",
				processTerminal: {
					version: 1,
					state: "pending",
					runId,
					runnerProcessInstanceId: "runner-instance-1",
				},
				startedAt: 1_000,
				lastUpdate: 1_500,
				sessionFile,
				steps: [{ agent: "writer", status: "running", startedAt: 1_000, sessionFile }],
			}),
		);
		initializeWriterProcessRegistry(asyncDir, runId, process.pid, 1);

		const repaired = reconcileAsyncRun(asyncDir, {
			resultsDir,
			now: () => 2_000,
			kill: () => {
				throw Object.assign(new Error("gone"), { code: "ESRCH" });
			},
		});
		expect(repaired).toMatchObject({
			repaired: true,
			status: {
				state: "failed",
				processTerminal: { state: "observed", resumeDisposition: "resumable" },
			},
		});
		if (!repaired.resultPath) throw new Error("Expected repaired result path");
		expect(JSON.parse(fs.readFileSync(repaired.resultPath, "utf8"))).toMatchObject({ parentRunOrigin: "user" });
		const proofPath = path.join(asyncDir, "process-terminal.json");
		expect(JSON.parse(fs.readFileSync(proofPath, "utf8"))).toMatchObject({
			state: "observed",
			resumeDisposition: "resumable",
		});

		const terminalStatus = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"));
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				...terminalStatus,
				processTerminal: {
					version: 1,
					state: "unknown",
					runId,
					runnerProcessInstanceId: "runner-instance-1",
					reason: "runner-candidate-missing",
				},
			}),
		);
		fs.writeFileSync(
			proofPath,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(proofPath, "utf8")),
				resumeDisposition: "unavailable",
			}),
		);

		const splitProjection = reconcileAsyncRun(asyncDir, { resultsDir });
		expect(splitProjection).toMatchObject({
			repaired: true,
			status: {
				state: "failed",
				processTerminal: { state: "observed", resumeDisposition: "resumable" },
			},
		});
		expect(JSON.parse(fs.readFileSync(proofPath, "utf8"))).toMatchObject({
			state: "observed",
			resumeDisposition: "resumable",
		});
	});

	test("repairs the run error from the child that drives mixed parallel failure", () => {
		const root = fixtureRoot();
		const resultsDir = path.join(root, "results");
		fs.mkdirSync(resultsDir, { recursive: true });
		for (const [runId, results] of [
			[
				"mixed-error-first",
				[
					{ success: false, stopped: true, error: "user stopped sibling" },
					{ success: false, error: "real execution failure" },
				],
			],
			[
				"mixed-error-last",
				[
					{ success: false, error: "real execution failure" },
					{ success: false, stopped: true, error: "user stopped sibling" },
				],
			],
		] as const) {
			const asyncDir = path.join(root, runId);
			fs.mkdirSync(asyncDir);
			fs.writeFileSync(
				path.join(asyncDir, "status.json"),
				JSON.stringify({
					runId,
					mode: "parallel",
					state: "running",
					startedAt: 1_000,
					steps: results.map((_, index) => ({ agent: `worker-${index}`, status: "running" })),
				}),
			);
			fs.writeFileSync(
				path.join(resultsDir, `${runId}.json`),
				JSON.stringify({ runId, state: "failed", success: false, results }),
			);
			const repaired = reconcileAsyncRun(asyncDir, { resultsDir, now: () => 2_000 });
			expect(repaired.status).toMatchObject({ state: "failed", error: "real execution failure" });
		}
	});

	test("never treats process-close proof alone as nested Agent success", () => {
		const root = fixtureRoot();
		const resultPath = path.join(root, "missing-result.json");
		const status = buildNestedTerminalFallbackStatus(
			nestedFallbackConfig(root, resultPath),
			{
				version: 1,
				state: "observed",
				runId: "nested-fallback",
				runnerProcessInstanceId: "runner-1",
				observedAt: 2_000,
				instances: [],
			},
			3_000,
		);

		expect(status.state).toBe("failed");
		expect(status.error).toContain("without a readable semantic result");
	});

	test("recovers nested semantic failure and success from the result artifact", () => {
		const root = fixtureRoot();
		const resultPath = path.join(root, "result.json");
		const config = nestedFallbackConfig(root, resultPath);
		const processTerminal = {
			version: 1 as const,
			state: "observed" as const,
			runId: "nested-fallback",
			runnerProcessInstanceId: "runner-1",
			observedAt: 2_000,
			instances: [],
		};
		fs.writeFileSync(
			resultPath,
			JSON.stringify({ state: "failed", success: false, error: "child failed", startedAt: 1_000, endedAt: 1_900 }),
		);
		expect(buildNestedTerminalFallbackStatus(config, processTerminal, 3_000)).toMatchObject({
			state: "failed",
			error: "child failed",
			startedAt: 1_000,
			endedAt: 1_900,
		});

		fs.writeFileSync(
			resultPath,
			JSON.stringify({ state: "complete", success: true, startedAt: 1_000, endedAt: 1_900 }),
		);
		expect(buildNestedTerminalFallbackStatus(config, processTerminal, 3_000)).toMatchObject({
			state: "complete",
			startedAt: 1_000,
			endedAt: 1_900,
		});

		fs.mkdirSync(config.asyncDir, { recursive: true });
		fs.writeFileSync(path.join(config.asyncDir, "status.json"), JSON.stringify({ state: "running" }));
		expect(resolveNestedTerminalStatus(config, processTerminal)).toMatchObject({ state: "complete" });
	});

	test("fails conservatively instead of loading oversized nested lifecycle artifacts", () => {
		const root = fixtureRoot();
		const resultPath = path.join(root, "oversized-result.json");
		const config = nestedFallbackConfig(root, resultPath);
		const processTerminal = {
			version: 1 as const,
			state: "observed" as const,
			runId: "nested-fallback",
			runnerProcessInstanceId: "runner-1",
			observedAt: 2_000,
			instances: [],
		};
		fs.writeFileSync(resultPath, "x");
		fs.truncateSync(resultPath, 32 * 1024 * 1024 + 1);

		expect(buildNestedTerminalFallbackStatus(config, processTerminal, 3_000)).toMatchObject({
			state: "failed",
			error: expect.stringContaining("without a readable semantic result"),
		});

		fs.mkdirSync(config.asyncDir, { recursive: true });
		const statusPath = path.join(config.asyncDir, "status.json");
		fs.writeFileSync(statusPath, "x");
		fs.truncateSync(statusPath, 8 * 1024 * 1024 + 1);
		expect(resolveNestedTerminalStatus(config, processTerminal)).toMatchObject({
			state: "failed",
			error: expect.stringContaining("without a readable semantic result"),
		});
	});

	test("never invents a not-started child from missing, foreign, or contradictory process proof", () => {
		const root = fixtureRoot();
		for (const kind of ["missing", "foreign", "contradictory", "legacy-empty"] as const) {
			const runId = `proof-${kind}`;
			const asyncDir = path.join(root, runId);
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(
				path.join(asyncDir, "status.json"),
				JSON.stringify({
					runId,
					mode: "single",
					state: "failed",
					startedAt: 1_000,
					lastUpdate: 2_000,
					steps: [{ agent: "reviewer", status: "failed" }],
				}),
			);
			if (kind !== "missing") {
				writeProcessTerminalCandidate(asyncDir, {
					version: 1,
					runId: kind === "foreign" ? "another-run" : runId,
					runnerProcessInstanceId: kind === "foreign" ? "another-runner" : "runner-1",
					writers: {
						"0":
							kind === "contradictory"
								? [
										{
											kind: "pi-writer",
											processInstanceId: "writer-1",
											attempt: 0,
											closeObservedAt: 1_900,
											exitCode: 1,
											signal: null,
										},
									]
								: [],
					},
					...(kind === "legacy-empty" ? {} : { expectedWriters: { "0": 0 } }),
				});
			}

			finalizeProcessTerminal(asyncDir, runId, {
				processInstanceId: "runner-1",
				closeObservedAt: 2_100,
				exitCode: 1,
				signal: null,
			});
			const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
				steps: Array<{ processTerminal?: { state?: string } }>;
			};
			expect(status.steps[0]?.processTerminal?.state).toBe("unknown");
		}
	});

	test("preserves observed per-child writer proof across async status reload", () => {
		const root = fixtureRoot();
		const runId = "proof-round-trip";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				mode: "single",
				state: "failed",
				startedAt: 1_000,
				lastUpdate: 2_000,
				steps: [{ agent: "reviewer", status: "failed" }],
			}),
		);
		initializeWriterProcessRegistry(asyncDir, runId, process.pid, 1);
		writeProcessTerminalCandidate(asyncDir, {
			version: 1,
			runId,
			runnerProcessInstanceId: "runner-1",
			writers: {
				"0": [
					{
						kind: "pi-writer",
						processInstanceId: "writer-1",
						attempt: 0,
						closeObservedAt: 1_900,
						exitCode: null,
						signal: "SIGSEGV",
					},
				],
			},
			expectedWriters: { "0": 1 },
		});
		const proof = finalizeProcessTerminal(asyncDir, runId, {
			processInstanceId: "runner-1",
			closeObservedAt: 2_100,
			exitCode: 1,
			signal: null,
		});
		expect(proof.state).toBe("observed");

		const [restored] = listAsyncRuns(root, { states: ["failed"] });
		expect(restored?.steps[0]?.processTerminal).toMatchObject({
			state: "observed",
			childIndex: 0,
			instances: [{ kind: "pi-writer", signal: "SIGSEGV" }],
		});
	});

	test("restores a healthy async sibling when another status snapshot is corrupt", () => {
		const root = fixtureRoot();
		const corruptDir = path.join(root, "corrupt-sibling");
		const healthyDir = path.join(root, "healthy-sibling");
		fs.mkdirSync(corruptDir);
		fs.mkdirSync(healthyDir);
		fs.writeFileSync(path.join(corruptDir, "status.json"), "{not-json", "utf8");
		fs.writeFileSync(
			path.join(healthyDir, "status.json"),
			JSON.stringify({
				runId: "healthy-sibling",
				sessionId: "root-session",
				mode: "single",
				state: "running",
				pid: process.pid,
				startedAt: Date.now(),
				lastUpdate: Date.now(),
				steps: [{ agent: "reviewer", status: "running" }],
			}),
		);

		const runs = listAsyncRuns(root, { sessionId: "root-session", states: ["running"] });
		expect(runs.map((run) => run.id)).toEqual(["healthy-sibling"]);
	});

	test("launch evidence contains current limits but ignores retired Agent features", () => {
		const root = fixtureRoot();
		const configured = {
			...agent(root, "writer"),
			memory: { scope: "project", path: "/retired" },
			completionGuard: true,
			output: "/retired/output",
		} as AgentConfig & Record<string, unknown>;

		const definition = projectAgentDefinition(configured);
		const binding = projectLaunchBinding({
			definitionDigest: "definition",
			inheritProjectContext: true,
			inheritSkills: false,
			turnBudget: { maxTurns: 8, graceTurns: 2 },
			toolBudget: { hard: 12, soft: 9, block: ["read"] },
			maxSubagentDepth: 2,
			capabilityCeiling: { version: 1, allowedTools: ["read"] },
		});

		expect(definition.version).toBe(2);
		expect(definition).not.toHaveProperty("memory");
		expect(definition).not.toHaveProperty("completionGuard");
		expect(definition).not.toHaveProperty("output");
		expect(binding).toMatchObject({
			version: 2,
			turnBudget: { maxTurns: 8, graceTurns: 2 },
			toolBudget: { hard: 12, soft: 9, block: ["read"] },
			maxSubagentDepth: 2,
			capabilityCeiling: { version: 1, allowedTools: ["read"] },
		});
	});

	test("increments nested depth without leaking detached-runner identity", () => {
		const writerEnv = buildWriterProcessEnv(
			{
				PATH: "/bin",
				PI_SUBAGENT_DEPTH: "1",
				PI_SUBAGENT_MAX_DEPTH: "9",
				PI_STUFF_BACKGROUND_RUNNER: "1",
				PI_STUFF_BACKGROUND_RUNNER_CONFIG: "/tmp/runner.json",
			},
			{
				CHILD_SETTING: "enabled",
				PI_SUBAGENT_DEPTH: "99",
				PI_SUBAGENT_MAX_DEPTH: "99",
				PI_STUFF_BACKGROUND_RUNNER: "1",
				PI_STUFF_BACKGROUND_RUNNER_CONFIG: "/tmp/override.json",
			},
			3,
		);

		expect(writerEnv.PATH).toBe("/bin");
		expect(writerEnv.CHILD_SETTING).toBe("enabled");
		expect(writerEnv.PI_SUBAGENT_DEPTH).toBe("2");
		expect(writerEnv.PI_SUBAGENT_MAX_DEPTH).toBe("3");
		expect(writerEnv.PI_STUFF_BACKGROUND_RUNNER).toBeUndefined();
		expect(writerEnv.PI_STUFF_BACKGROUND_RUNNER_CONFIG).toBeUndefined();
	});

	test("creates a runnable lifecycle status before child launch", () => {
		const root = fixtureRoot();
		const startedAt = 123_456;
		const task: RunnerAgentTask = {
			agent: "writer",
			description: "Implement parser change",
			task: "Implement",
			cwd: root,
			context: "fresh",
			systemPrompt: "You are writer.",
			systemPromptMode: "append",
			inheritProjectContext: true,
			inheritSkills: false,
			maxSubagentDepth: 1,
		};
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "runtime-status",
			parentRunOrigin: "user",
			cwd: root,
			asyncDir: path.join(root, "async"),
			resultPath: path.join(root, "result.json"),
			work: { mode: "single", task },
		};

		const status = createInitialStatus(config, startedAt);

		expect(status.lifecycleArtifactVersion).toBe(3);
		expect(status.runId).toBe("runtime-status");
		expect(status.parentRunOrigin).toBe("user");
		expect(status.state).toBe("running");
		expect(status.steps).toHaveLength(1);
		expect(status.steps[0]).toMatchObject({
			agent: "writer",
			label: "Implement parser change",
			status: "pending",
			task: "Implement",
		});
	});

	test("keeps the detached runner independent from Host UI description fallback", () => {
		const root = fixtureRoot();
		const task: RunnerAgentTask = {
			agent: "legacy-writer",
			task: "Inspect /tmp/deep/sample.txt without changing it",
			cwd: root,
			inheritProjectContext: true,
			inheritSkills: false,
		};
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "legacy-runtime-status",
			cwd: root,
			asyncDir: path.join(root, "async"),
			resultPath: path.join(root, "result.json"),
			work: { mode: "single", task },
		};

		const [step] = createInitialStatus(config, 123_456).steps;

		expect(step).toMatchObject({ agent: "legacy-writer", task: task.task, status: "pending" });
		expect(step).not.toHaveProperty("label");
	});

	test("builds one parallel group and resolves every task override before persistence", () => {
		const root = fixtureRoot();
		const agents = [
			agent(root, "writer", {
				model: "provider/writer-default",
				defaultTurnBudget: { maxTurns: 20, graceTurns: 3 },
				toolBudget: { hard: 30, soft: 20 },
			}),
			agent(root, "reviewer", {
				model: "provider/reviewer-default",
				defaultTurnBudget: { maxTurns: 18, graceTurns: 2 },
				toolBudget: { hard: 15 },
			}),
		];

		const built = buildAsyncParallelRunnerWork("run-parallel", {
			tasks: [
				{
					agent: "writer",
					description: "Implement core change",
					task: "Implement",
					cwd: "packages/core",
					model: "provider/fast",
					skill: "review",
					turnBudget: { maxTurns: 7, graceTurns: 1 },
					toolBudget: { hard: 9, soft: 6, block: ["browser"] },
				},
				{ agent: "reviewer", description: "Review core change", task: "Review", skill: ["review"] },
			],
			agents,
			ctx: buildContext(root),
			cwd: root,
			contextForAgent: () => "fork",
			thinking: "high",
			turnBudget: { maxTurns: 12, graceTurns: 2 },
			toolBudget: { hard: 14, soft: 10, block: ["read"] },
			configToolBudget: { hard: 40, block: ["read"] },
			concurrency: 2,
			worktree: false,
			maxSubagentDepth: 3,
		});

		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		expect(built.work.mode).toBe("parallel");
		if (built.work.mode !== "parallel") throw new Error("Expected parallel work");
		expect(built.work.group.concurrency).toBe(2);
		expect(built.work.group.tasks).toHaveLength(2);
		expect(built.work.group.tasks[0]).toMatchObject({
			agent: "writer",
			description: "Implement core change",
			task: "Implement",
			cwd: path.join(root, "packages", "core"),
			context: "fork",
			model: "provider/fast",
			thinking: "high",
			skills: ["review"],
			turnBudget: { maxTurns: 7, graceTurns: 1 },
			toolBudget: { hard: 9, soft: 6, block: ["browser"] },
		});
		expect(built.work.group.tasks[1]).toMatchObject({
			agent: "reviewer",
			description: "Review core change",
			task: "Review",
			cwd: root,
			context: "fork",
			model: "provider/reviewer-default",
			thinking: "high",
			skills: ["review"],
			turnBudget: { maxTurns: 12, graceTurns: 2 },
			toolBudget: { hard: 14, soft: 10, block: ["read"] },
		});
	});

	test("single recovery data retains the child session and limits without retired features", () => {
		const root = fixtureRoot();
		const built = buildAsyncSingleRunnerWork("run-single", {
			agent: "writer",
			task: "Continue the implementation",
			agentConfig: agent(root, "writer"),
			ctx: buildContext(root),
			cwd: root,
			context: "fork",
			sessionFile: path.join(root, "child.jsonl"),
			turnBudget: { maxTurns: 8, graceTurns: 2 },
			toolBudget: { hard: 11, block: ["read"] },
			maxSubagentDepth: 2,
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "edit"],
				denyExtensions: false,
				sources: ["test"],
			},
		});

		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		expect(built.work.mode).toBe("single");
		expect(built.recovery).toMatchObject({
			version: 2,
			sourceRunId: "run-single",
			agent: "writer",
			sessionFile: path.join(root, "child.jsonl"),
			context: "fork",
			initialTurnBudget: { maxTurns: 8, graceTurns: 2 },
			initialToolBudget: { hard: 11, block: ["read"] },
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "edit"],
				denyExtensions: false,
				sources: ["test"],
			},
		});
		for (const retired of [
			"acceptance",
			"agentContract",
			"completionGuard",
			"memory",
			"outputMode",
			"outputPath",
			"share",
			"structuredOutputSchema",
		]) {
			expect(retired in built.recovery).toBe(false);
		}
	});

	test("keeps read available when a child inherits ambient Skills without an explicit skill list", () => {
		const root = fixtureRoot();
		const built = buildAsyncSingleRunnerWork("run-inherited-skills", {
			agent: "writer",
			task: "Inspect the implementation",
			agentConfig: agent(root, "writer", {
				inheritSkills: true,
				tools: ["edit"],
			}),
			ctx: buildContext(root),
			cwd: root,
			context: "fresh",
			maxSubagentDepth: 2,
			capabilityCeiling: {
				version: 1,
				allowedTools: ["edit", "read"],
				denyExtensions: false,
				sources: ["test"],
			},
		});

		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		expect(built.work.mode).toBe("single");
		if (built.work.mode !== "single") throw new Error("Expected single work");
		expect(built.work.task.skills).toEqual([]);
		expect(built.work.task.inheritSkills).toBeTrue();
		expect(built.work.task.tools).toEqual(["edit"]);
	});

	test("reads the selected child from a version 2 parallel recovery collection", () => {
		const root = fixtureRoot();
		const built = buildAsyncParallelRunnerWork("recover-parallel", {
			tasks: [
				{ agent: "writer", task: "Write" },
				{ agent: "reviewer", task: "Review" },
			],
			agents: [agent(root, "writer"), agent(root, "reviewer")],
			ctx: buildContext(root),
			maxSubagentDepth: 2,
		});
		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		const asyncDir = path.join(root, "async", "recover-parallel");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "recovery-descriptors.json"),
			JSON.stringify({ version: 2, children: built.recoveries }),
		);

		const descriptor = readAsyncRecoveryDescriptor(asyncDir, 1);

		expect(descriptor).toMatchObject({
			version: 2,
			sourceRunId: "recover-parallel",
			childIndex: 1,
			agent: "reviewer",
			cwd: root,
			maxSubagentDepth: 2,
		});
		expect(readAsyncRecoveryDescriptor(asyncDir)).toBeUndefined();
	});
});

describe("background runner execution", () => {
	test("keeps the Host event loop responsive while concurrent writer identities become readable", async () => {
		let heartbeat = 0;
		const timer = setInterval(() => {
			heartbeat += 1;
		}, 1);
		try {
			const identities = await Promise.all(
				Array.from({ length: 20 }, (_, index) => {
					let attempts = 0;
					return captureWriterProcessStartIdentity(process.pid, {
						intervalMs: 5,
						read: () => {
							attempts += 1;
							return attempts >= 3 ? `writer-${String(index)}` : undefined;
						},
						timeoutMs: 100,
					});
				}),
			);
			expect(identities).toEqual(Array.from({ length: 20 }, (_, index) => `writer-${String(index)}`));
			expect(heartbeat).toBeGreaterThan(0);
		} finally {
			clearInterval(timer);
		}
	});

	test("retires its top-level nested route after terminal state is durable", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "route-retirement-writer.sh");
		fs.writeFileSync(
			writer,
			`#!/bin/sh
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ROUTE_RETIRED"}],"stopReason":"stop"}}'
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const id = `route-retire-${randomUUID()}`;
		const nestedRoute = createNestedRoute(id);
		const routeRoot = path.dirname(nestedRoute.eventSink);
		const asyncDir = path.join(ASYNC_DIR, id);
		temporaryDirectories.push(asyncDir);
		const resultPath = path.join(asyncDir, "result.json");
		writeNestedEvent(nestedRoute, {
			type: "subagent.nested.completed",
			ts: 2,
			parentRunId: id,
			parentStepIndex: 0,
			child: {
				id: `${id}-child`,
				parentRunId: id,
				parentStepIndex: 0,
				parentRunOrigin: "user",
				depth: 1,
				path: [{ runId: id, stepIndex: 0 }],
				state: "complete",
				startedAt: 1,
				endedAt: 2,
				lastUpdate: 2,
			},
		});

		await runConfiguredBackground({
			version: 2,
			id,
			cwd: root,
			asyncDir,
			resultPath,
			nestedRoute,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});

		expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
			parentRunOrigin: "user",
			state: "complete",
			results: [{ output: "ROUTE_RETIRED" }],
			nestedChildren: [{ id: `${id}-child`, parentRunOrigin: "user" }],
		});
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			parentRunOrigin: "user",
			steps: [{ children: [{ id: `${id}-child`, parentRunOrigin: "user" }] }],
		});
		expect(fs.existsSync(routeRoot)).toBe(false);
	});

	test("resolves the writer supervisor through Bun without requiring node on PATH", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "node-less-writer.sh");
		fs.writeFileSync(
			writer,
			`#!/bin/sh
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"NODELESS_OK"}],"stopReason":"stop"}}'
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const originalPath = process.env.PATH;
		process.env.PATH = root;
		try {
			const runtime = resolveBunRuntimeCommand({
				execPath: process.execPath,
				env: { PATH: root },
			});
			expect(runtime).toBe(process.execPath);
			expect(buildWriterSpawnCommand("pi", [], process.platform, undefined, undefined, runtime).command).toBe(
				process.execPath,
			);
			const asyncDir = path.join(root, "async-node-less");
			const resultPath = path.join(asyncDir, "result.json");
			await runConfiguredBackground({
				version: 2,
				id: "node-less-writer-supervisor",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			});
			expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
				state: "complete",
				success: true,
				results: [{ output: "NODELESS_OK", success: true }],
			});
		} finally {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
		}
	}, 10_000);

	test("drains a fast writer's backpressured asynchronous stdout before the supervisor exits", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "backpressured-writer.ts");
		const tail = "BACKPRESSURE_TAIL_PRESERVED";
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import { once } from "node:events";
const text = "x".repeat(192 * 1024) + ${JSON.stringify(tail)};
const line = JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
}) + "\\n";
for (let offset = 0; offset < line.length; offset += 4096) {
  if (!process.stdout.write(line.slice(offset, offset + 4096))) await once(process.stdout, "drain");
  await Bun.sleep(0);
}
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-backpressured-output");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "backpressured-output",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});

		const result = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ output?: string; success: boolean }>;
		};
		expect(result.state).toBe("complete");
		expect(result.results[0]?.success).toBeTrue();
		expect(result.results[0]?.output?.endsWith(tail)).toBeTrue();
	}, 10_000);

	test("bounds writer transport without creating an unbounded regular-file spool", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const writer = path.join(root, "unbounded-spool-probe.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import { once } from "node:events";
process.on("SIGTERM", () => {});
const chunk = Buffer.alloc(1024 * 1024, 120);
for (let index = 0; index < 48; index++) {
  if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
}
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		const dispositionPath = path.join(root, "supervisor-disposition.json");
		const groupMemberProofPath = path.join(root, "supervisor-group-member.json");
		const controlPath = path.join(root, "supervisor-control.jsonl");
		const controlToken = randomUUID();
		fs.writeFileSync(
			controlPath,
			`${JSON.stringify({ version: 1, token: controlToken, sequence: 1, command: "proceed" })}\n`,
			{ mode: 0o600 },
		);
		const command = buildWriterSpawnCommand(
			writer,
			[],
			process.platform,
			dispositionPath,
			groupMemberProofPath,
			undefined,
			{ path: controlPath, token: controlToken },
		);
		const supervisor = spawn(command.command, command.args, {
			cwd: root,
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES: "65536" },
		});
		let stdoutBytes = 0;
		let stderr = "";
		let maxSpoolBytes = 0;
		supervisor.stdout?.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.length;
		});
		supervisor.stderr?.on("data", (chunk: Buffer) => {
			stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
		});
		const sampleSpools = () => {
			for (const entry of fs.readdirSync(root)) {
				if (!entry.endsWith(".spool")) continue;
				maxSpoolBytes = Math.max(maxSpoolBytes, fs.statSync(path.join(root, entry)).size);
			}
		};
		const monitor = setInterval(sampleSpools, 2);
		try {
			supervisor.stdin?.end();
			const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
				supervisor.once("error", reject);
				supervisor.once("close", (code, signal) => resolve({ code, signal }));
			});
			sampleSpools();
			expect(closed.signal).toBeNull();
			expect(closed.code).toBe(143);
			expect(stdoutBytes).toBeLessThanOrEqual(65_537);
			expect(maxSpoolBytes).toBe(0);
			expect(fs.readdirSync(root).some((entry) => entry.endsWith(".spool"))).toBe(false);
		} catch (error) {
			throw new Error(`Writer transport probe failed (${stderr || "no supervisor stderr"}).`, { cause: error });
		} finally {
			clearInterval(monitor);
			if (supervisor.pid) {
				try {
					process.kill(-supervisor.pid, "SIGKILL");
				} catch {}
			}
		}
	}, 8_000);

	test("turns a writer-supervisor spawn error into a durable child failure", async () => {
		const root = fixtureRoot();
		const asyncDir = path.join(root, "async-missing-supervisor");
		const resultPath = path.join(asyncDir, "result.json");
		await runConfiguredBackground(
			{
				version: 2,
				id: "missing-writer-supervisor",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{ writerSupervisorRuntime: path.join(root, "missing-bun") },
		);
		await Bun.sleep(25);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{ error?: string; success: boolean }>;
		};
		expect(completion.state).toBe("failed");
		expect(completion.success).toBeFalse();
		expect(completion.results[0]).toMatchObject({ success: false });
		expect(completion.results[0]?.error).toContain("stable process-start identity");
	});

	test("loads the detached runner import graph with the certified Bun command", () => {
		const bunCommand = resolveAsyncRunnerBunCommand();
		expect(bunCommand).toBeString();
		if (!bunCommand) throw new Error("Expected a certified Bun command");
		const runnerUrl = pathToFileURL(
			path.resolve(import.meta.dir, "../../packages/pi-stuff/src/subagents/src/runs/background/subagent-runner.ts"),
		).href;
		const result = Bun.spawnSync([bunCommand, "--eval", `await import(${JSON.stringify(runnerUrl)})`], {
			cwd: path.resolve(import.meta.dir, "../.."),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode, result.stderr.toString()).toBe(0);
	});

	function task(index: number): RunnerAgentTask {
		return {
			agent: `agent-${index}`,
			task: `task-${index}`,
			cwd: "/tmp",
			inheritProjectContext: true,
			inheritSkills: false,
		};
	}

	test("honors group concurrency and produces direct parallel children", async () => {
		let active = 0;
		let peak = 0;
		const work = {
			mode: "parallel" as const,
			group: { tasks: [task(0), task(1), task(2)], concurrency: 2, worktree: false },
		};
		const results = await runBackgroundWork(work, async (child, index) => {
			active++;
			peak = Math.max(peak, active);
			await Bun.sleep(5);
			active--;
			return { agent: child.agent, output: `done-${index}`, success: true, exitCode: 0 };
		});
		expect(peak).toBe(2);
		expect(results.map((result) => result.output)).toEqual(["done-0", "done-1", "done-2"]);

		const config = {
			version: 2,
			id: "run-parallel",
			parentRunOrigin: "user",
			work,
			resultPath: "/tmp/result.json",
			cwd: "/tmp",
			asyncDir: "/tmp/run-parallel",
			sessionId: "parent-session",
		} satisfies BackgroundRunnerConfig;
		const completion = createBackgroundCompletion(config, results, 100, 200);
		expect(completion).toMatchObject({
			id: "run-parallel",
			runId: "run-parallel",
			parentRunOrigin: "user",
			mode: "parallel",
			state: "complete",
			success: true,
			results: [
				{ agent: "agent-0", output: "done-0", success: true },
				{ agent: "agent-1", output: "done-1", success: true },
				{ agent: "agent-2", output: "done-2", success: true },
			],
		});
		expect(completion).not.toHaveProperty("chain");
		expect(completion).not.toHaveProperty("workflowGraph");
	});

	test("rejects oversized parallel work before allocating child executions", async () => {
		let launches = 0;
		await expect(
			runBackgroundWork(
				{
					mode: "parallel",
					group: { tasks: Array.from({ length: 21 }, (_, index) => task(index)), concurrency: 4, worktree: false },
				},
				async (child) => {
					launches += 1;
					return { agent: child.agent, output: "unexpected", success: true, exitCode: 0 };
				},
			),
		).rejects.toThrow("at most 20 tasks");
		expect(launches).toBe(0);
	});

	test("waits for every parallel child when one child execution rejects", async () => {
		const completed: number[] = [];
		const work = {
			mode: "parallel" as const,
			group: { tasks: [task(0), task(1), task(2)], concurrency: 2, worktree: false },
		};
		const results = await runBackgroundWork(work, async (child, index) => {
			if (index === 0) throw new Error("child setup failed");
			await Bun.sleep(index === 1 ? 30 : 5);
			completed.push(index);
			return { agent: child.agent, output: `done-${index}`, success: true, exitCode: 0 };
		});

		expect(completed.sort()).toEqual([1, 2]);
		expect(results).toMatchObject([
			{ agent: "agent-0", success: false, exitCode: 1, error: "child setup failed" },
			{ agent: "agent-1", success: true, exitCode: 0, output: "done-1" },
			{ agent: "agent-2", success: true, exitCode: 0, output: "done-2" },
		]);
	});

	test("does not start queued children after a stop and records a stopped completion", async () => {
		const controller = new AbortController();
		const started: number[] = [];
		const work = {
			mode: "parallel" as const,
			group: { tasks: [task(0), task(1), task(2)], concurrency: 1, worktree: false },
		};
		const results = await runBackgroundWork(
			work,
			async (child, index) => {
				started.push(index);
				controller.abort("stopped");
				return { agent: child.agent, output: "stopped", success: false, exitCode: 1, stopped: true };
			},
			{ signal: controller.signal },
		);
		expect(started).toEqual([0]);
		expect(results).toHaveLength(3);
		expect(results.every((result) => result.stopped)).toBe(true);

		const config = {
			version: 2,
			id: "run-stopped",
			work,
			resultPath: "/tmp/result.json",
			cwd: "/tmp",
			asyncDir: "/tmp/run-stopped",
		} satisfies BackgroundRunnerConfig;
		expect(createBackgroundCompletion(config, results, 100, 200)).toMatchObject({
			state: "stopped",
			success: false,
			stopped: true,
		});
	});

	test("terminalizes queued status steps when a bounded group is stopped", async () => {
		const root = fixtureRoot();
		const readyMarker = path.join(root, "group-stop-ready");
		const writer = path.join(root, "group-stop-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "queued-group-stop",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "parallel",
				group: {
					tasks: [
						{ ...task(0), cwd: root },
						{ ...task(1), cwd: root },
					],
					concurrency: 1,
					worktree: false,
				},
			},
		};

		const running = runConfiguredBackground(config);
		await waitForFile(readyMarker);
		requestAsyncSteer(asyncDir, {
			id: "queued-stop-steer",
			message: "Inspect the queued child before finishing.",
			source: "test",
			targetIndex: 1,
		});
		await waitForFileText(path.join(asyncDir, "status.json"), "queued-stop-steer");
		const routed = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steering?: { recent?: Array<{ targets?: Array<{ state?: string }> }> };
		};
		expect(routed.steering?.recent?.[0]?.targets?.[0]?.state).toBe("routed");
		requestAsyncStop(asyncDir, { source: "test" });
		await running;
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			state: string;
			steps: Array<{ status: string; startedAt?: number; endedAt?: number; stopped?: boolean }>;
			steering?: {
				scheduled?: number;
				pending?: number;
				failed?: number;
				recent?: Array<{ targets?: Array<{ state?: string; reason?: string }> }>;
			};
		};

		expect(status.state).toBe("stopped");
		expect(status.steps).toMatchObject([
			{ status: "stopped", stopped: true },
			{ status: "stopped", stopped: true },
		]);
		expect(status.steps[0]?.startedAt).toBeNumber();
		expect(status.steps[1]?.startedAt).toBeUndefined();
		expect(status.steps[1]?.endedAt).toBeNumber();
		expect(status.steering).toMatchObject({
			scheduled: 0,
			pending: 0,
			failed: 1,
			recent: [
				{
					targets: [
						{
							state: "failed",
							reason: "Agent run ended as stopped before steering was delivered.",
						},
					],
				},
			],
		});
	}, 5_000);

	test("terminalizes queued status steps when a bounded group times out", async () => {
		const root = fixtureRoot();
		const readyMarker = path.join(root, "group-timeout-ready");
		const writer = path.join(root, "group-timeout-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "queued-group-timeout",
			cwd: root,
			asyncDir,
			resultPath,
			deadlineAt: Date.now() + 250,
			work: {
				mode: "parallel",
				group: {
					tasks: [
						{ ...task(0), cwd: root },
						{ ...task(1), cwd: root },
					],
					concurrency: 1,
					worktree: false,
				},
			},
		};

		await runConfiguredBackground(config);
		expect(fs.existsSync(readyMarker)).toBe(true);
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			state: string;
			timedOut?: boolean;
			steps: Array<{ status: string; startedAt?: number; endedAt?: number; timedOut?: boolean }>;
		};

		expect(status).toMatchObject({
			state: "failed",
			timedOut: true,
			steps: [
				{ status: "failed", timedOut: true },
				{ status: "failed", timedOut: true },
			],
		});
		expect(status.steps[0]?.startedAt).toBeNumber();
		expect(status.steps[1]?.startedAt).toBeUndefined();
		expect(status.steps[1]?.endedAt).toBeNumber();
	}, 5_000);

	test("stops one queued child without ever spawning its writer", async () => {
		const root = fixtureRoot();
		const readyMarker = path.join(root, "target-stop-ready");
		const releaseMarker = path.join(root, "target-stop-release");
		const queuedSpawnMarker = path.join(root, "queued-writer-spawned");
		const writer = path.join(root, "queued-target-stop-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
const index = process.env.PI_SUBAGENT_CHILD_INDEX;
const assistant = (text) => JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() },
}) + "\\n";
if (index === "1") {
  fs.writeFileSync(${JSON.stringify(queuedSpawnMarker)}, "spawned");
  process.stdout.write(assistant("QUEUED_CHILD_SHOULD_NOT_RUN"));
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(releaseMarker)})) return;
  clearInterval(timer);
  process.stdout.write(assistant("FIRST_CHILD_COMPLETED"), () => process.exit(0));
}, 20);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const running = runConfiguredBackground({
			version: 2,
			id: "queued-target-stop",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "parallel",
				group: {
					tasks: [
						{ ...task(0), cwd: root },
						{ ...task(1), cwd: root },
					],
					concurrency: 1,
					worktree: false,
				},
			},
		});

		await waitForFile(readyMarker);
		requestAsyncStop(asyncDir, { source: "test", targetIndex: 1 });
		await waitForFileText(path.join(asyncDir, "events.jsonl"), '"subagent.child.stop_requested"');
		fs.writeFileSync(releaseMarker, "release");
		await running;
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ stopped?: boolean; writerProcesses?: unknown[] }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ status: string; startedAt?: number }>;
		};

		expect(completion).toMatchObject({
			state: "stopped",
			results: [{ success: true }, { success: false, stopped: true }],
		});
		expect(completion.results[1]?.writerProcesses).toBeUndefined();
		expect(status.steps[1]).toMatchObject({ status: "stopped" });
		expect(status.steps[1]?.startedAt).toBeUndefined();
		expect(fs.existsSync(queuedSpawnMarker)).toBe(false);
	}, 5_000);

	test("terminalizes a child step when resolved child setup rejects", async () => {
		const root = fixtureRoot();
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "child-setup-rejection",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "single",
				task: {
					...task(0),
					cwd: root,
					inheritSkills: true,
					tools: ["edit"],
					capabilityCeiling: {
						version: 1,
						allowedTools: ["edit"],
						denyExtensions: false,
						sources: ["test"],
					},
				},
			},
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			state: string;
			steps: Array<{ status: string; endedAt?: number; exitCode?: number; error?: string }>;
		};

		expect(completion).toMatchObject({ state: "failed", success: false });
		expect(status).toMatchObject({
			state: "failed",
			steps: [
				{
					status: "failed",
					exitCode: 1,
					error: expect.stringContaining("excludes required tool 'read'"),
				},
			],
		});
		expect(status.steps[0]?.endedAt).toBeNumber();
	});

	test("reports a provider-payload diagnostic ahead of the generic aborted assistant error", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "payload-diagnostic-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const diagnosticPath = process.env.PI_SUBAGENT_TOOL_DIAGNOSTIC_PATH;
if (!diagnosticPath) throw new Error("missing child diagnostic path");
writeFileSync(diagnosticPath, JSON.stringify({ required: [], available: [], missing: [], launchError: "FINAL_PAYLOAD_BOUND" }));
process.stdout.write(JSON.stringify({
  type: "message_end",
  message: {
    role: "assistant",
    content: [],
    errorMessage: "Request aborted",
    stopReason: "error",
    timestamp: Date.now(),
  },
}) + "\\n");
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-payload-diagnostic");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "payload-diagnostic",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string }>;
		};

		expect(completion.state).toBe("failed");
		expect(completion.results[0]?.error).toBe("FINAL_PAYLOAD_BOUND");
	});

	test("records a diagnostic when the Agent process exits nonzero without reporting an error", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "silent-nonzero-writer.ts");
		fs.writeFileSync(writer, "#!/usr/bin/env bun\nprocess.exit(7);\n", { mode: 0o700 });
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "silent-nonzero-exit",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{ error?: string; exitCode: number | null }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ error?: string; exitCode?: number }>;
		};

		expect(completion.results[0]).toMatchObject({
			exitCode: 7,
			error: "Agent process exited with code 7 without a diagnostic.",
		});
		expect(status.steps[0]?.error).toBe("Agent process exited with code 7 without a diagnostic.");
	});

	test("records a diagnostic when the Agent process dies from a signal without reporting an error", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "silent-signal-writer.ts");
		fs.writeFileSync(writer, '#!/usr/bin/env bun\nprocess.kill(process.pid, "SIGTERM");\n', { mode: 0o700 });
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "silent-signal-exit",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{ error?: string; exitCode: number | null }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ error?: string; exitCode?: number }>;
		};

		expect(completion.results[0]).toMatchObject({
			exitCode: 1,
			error: "Agent process terminated by SIGTERM without a diagnostic.",
		});
		expect(status.steps[0]?.error).toBe("Agent process terminated by SIGTERM without a diagnostic.");
	});

	test("reaps a writer and clears its registry when post-spawn identity binding fails", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "writer-binding-failure.ts");
		const writerMarker = path.join(root, "writer-executed");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(writerMarker)}, "executed");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "writer-binding-failure",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config, {
			afterWriterProcessUpdate: (_index, writerState) => {
				if (writerState.state === "running") throw new Error("injected writer binding failure");
			},
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{
				error?: string;
				writerProcesses?: Array<{ signal?: string | null }>;
			}>;
		};
		const registry = JSON.parse(fs.readFileSync(path.join(asyncDir, "writer-processes-live.json"), "utf8")) as {
			writers?: Record<string, { state?: string }>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			results: [
				{
					error: expect.stringContaining("injected writer binding failure"),
					writerProcesses: [{ signal: "SIGTERM" }],
				},
			],
		});
		expect(registry.writers?.["0"]?.state).toBe("none");
		expect(fs.existsSync(writerMarker)).toBe(false);
	});

	test("rolls a pre-spawn writer identity back to none without launching a child", async () => {
		const root = fixtureRoot();
		const spawnMarker = path.join(root, "writer-spawned");
		const writer = path.join(root, "pre-spawn-binding-failure.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(spawnMarker)}, "spawned");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const observedStates: string[] = [];

		await runConfiguredBackground(
			{
				version: 2,
				id: "pre-spawn-writer-binding-failure",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					observedStates.push(writerState.state);
					if (writerState.state === "spawning") throw new Error("injected pre-spawn binding failure");
				},
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; writerProcesses?: unknown[] }>;
		};
		const registry = JSON.parse(fs.readFileSync(path.join(asyncDir, "writer-processes-live.json"), "utf8")) as {
			writers?: Record<string, { state?: string }>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			results: [{ error: expect.stringContaining("injected pre-spawn binding failure") }],
		});
		expect(completion.results[0]?.writerProcesses).toEqual([]);
		expect(observedStates).toEqual(["spawning", "none"]);
		expect(registry.writers?.["0"]?.state).toBe("none");
		expect(fs.existsSync(spawnMarker)).toBe(false);
	});

	test("bounds rejected child errors before persisting result, status, and diagnostics", async () => {
		const root = fixtureRoot();
		const asyncDir = path.join(root, "async-bounded-rejection");
		const resultPath = path.join(asyncDir, "result.json");
		const hugeError = `REJECTION-${"界".repeat(500_000)}`;
		await runConfiguredBackground(
			{
				version: 2,
				id: "bounded-rejection",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					if (writerState.state === "spawning") throw new Error(hugeError);
				},
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{ error?: string; output: string }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ error?: string }>;
		};
		for (const value of [completion.results[0]?.error, completion.results[0]?.output, status.steps[0]?.error]) {
			expect(Buffer.byteLength(value ?? "", "utf8")).toBeLessThanOrEqual(32 * 1024);
			expect(value).not.toContain("�");
		}
		expect(fs.statSync(path.join(asyncDir, "events.jsonl")).size).toBeLessThan(64 * 1024);
	});

	test("rolls writer identity back when child_process.spawn throws synchronously", async () => {
		const root = fixtureRoot();
		process.env.PI_SUBAGENT_PI_BINARY = "\0";
		const asyncDir = path.join(root, "async-sync-spawn-error");
		const resultPath = path.join(asyncDir, "result.json");
		const observedStates: string[] = [];

		await runConfiguredBackground(
			{
				version: 2,
				id: "sync-spawn-error",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => observedStates.push(writerState.state),
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; writerProcesses?: unknown[]; writerAttemptCount?: number }>;
		};
		const registry = JSON.parse(fs.readFileSync(path.join(asyncDir, "writer-processes-live.json"), "utf8")) as {
			writers?: Record<string, { state?: string }>;
		};

		expect(completion.state).toBe("failed");
		expect(completion.results[0]?.error).toContain("null bytes");
		expect(completion.results[0]?.writerProcesses).toEqual([]);
		expect(completion.results[0]?.writerAttemptCount).toBe(0);
		expect(observedStates).toEqual(["spawning", "none"]);
		expect(registry.writers?.["0"]?.state).toBe("none");
	});

	test("rolls writer identity and prompt artifacts back when supervisor construction fails", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const asyncDir = path.join(root, "async-supervisor-build-error");
		const resultPath = path.join(asyncDir, "result.json");
		const observedStates: string[] = [];
		const tempRoot = isolatedSystemTempRoot();

		await runConfiguredBackground(
			{
				version: 2,
				id: "supervisor-build-error",
				cwd: root,
				asyncDir,
				resultPath,
				work: {
					mode: "single",
					task: { ...task(0), cwd: root, systemPrompt: "temporary prompt artifact" },
				},
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => observedStates.push(writerState.state),
				writerSupervisorRuntime: "",
			},
		);

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; writerProcesses?: unknown[] }>;
		};
		const registry = JSON.parse(fs.readFileSync(path.join(asyncDir, "writer-processes-live.json"), "utf8")) as {
			writers?: Record<string, { state?: string }>;
		};
		const leaked = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith("pi-subagent-"));

		expect(completion).toMatchObject({
			state: "failed",
			results: [{ error: expect.stringContaining("Bun is required") }],
		});
		expect(completion.results[0]?.writerProcesses).toEqual([]);
		expect(observedStates).toEqual(["spawning", "none"]);
		expect(registry.writers?.["0"]?.state).toBe("none");
		expect(leaked).toEqual([]);
	});

	test("restores a frozen fork before retrying a larger model", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "clean-fallback-session.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
const args = Bun.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const session = valueAfter("--session");
const model = valueAfter("--model") ?? "";
if (!session) throw new Error("missing session");
const before = fs.readFileSync(session, "utf8");
if (model.endsWith("model-a")) {
  fs.appendFileSync(session, "PRIMARY_ATTEMPT_POLLUTION\\n");
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      errorMessage: "final child payload is above the safe input bound",
      stopReason: "error",
      timestamp: Date.now(),
    },
  }) + "\\n", () => process.exit(0));
} else if (before.includes("PRIMARY_ATTEMPT_POLLUTION")) {
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      errorMessage: "fallback inherited a polluted fork session",
      stopReason: "error",
      timestamp: Date.now(),
    },
  }) + "\\n", () => process.exit(0));
} else {
  fs.appendFileSync(session, "FALLBACK_SUCCESS\\n");
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "CLEAN_FALLBACK" }],
      stopReason: "stop",
      timestamp: Date.now(),
    },
  }) + "\\n", () => process.exit(0));
}
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const sessionFile = path.join(root, "fork.jsonl");
		fs.writeFileSync(sessionFile, "BASE_SESSION\n", { mode: 0o600 });
		const asyncDir = path.join(root, "async-clean-fallback");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "clean-fallback",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "single",
				task: {
					...task(0),
					cwd: root,
					sessionFile,
					modelCandidates: ["test/model-a", "test/model-b"],
				},
			},
		});

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ output?: string; modelAttempts?: Array<{ model?: string; success?: boolean }> }>;
		};
		expect(completion).toMatchObject({
			state: "complete",
			results: [
				{
					output: "CLEAN_FALLBACK",
					modelAttempts: [
						{ model: "test/model-a", success: false },
						{ model: "test/model-b", success: true },
					],
				},
			],
		});
		const finalSession = fs.readFileSync(sessionFile, "utf8");
		expect(finalSession).toContain("BASE_SESSION");
		expect(finalSession).toContain("FALLBACK_SUCCESS");
		expect(finalSession).not.toContain("PRIMARY_ATTEMPT_POLLUTION");
	}, 5_000);

	test("restores different fallback sessions concurrently without a shared lock", async () => {
		const root = fixtureRoot();
		const readyDirectory = path.join(root, "parallel-fallback-ready");
		fs.mkdirSync(readyDirectory, { mode: 0o700 });
		const writer = path.join(root, "parallel-fallback-session.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
const args = Bun.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const session = valueAfter("--session");
const model = valueAfter("--model") ?? "";
if (!session) throw new Error("missing session");
const sessionName = path.basename(session);
const emit = (message) => process.stdout.write(JSON.stringify({
  type: "message_end",
  message: { role: "assistant", timestamp: Date.now(), ...message },
}) + "\\n", () => process.exit(0));
if (model.endsWith("model-a")) {
  fs.appendFileSync(session, "PRIMARY_ATTEMPT_POLLUTION\\n");
  fs.writeFileSync(path.join(${JSON.stringify(readyDirectory)}, sessionName + ".ready"), "ready");
  const deadline = Date.now() + 2_000;
  while (fs.readdirSync(${JSON.stringify(readyDirectory)}).filter((name) => name.endsWith(".ready")).length < 2) {
    if (Date.now() >= deadline) {
      emit({ content: [], errorMessage: "parallel fallback rendezvous timed out", stopReason: "error" });
      await new Promise(() => {});
    }
    await Bun.sleep(10);
  }
  emit({ content: [], errorMessage: "503 Service Unavailable", stopReason: "error" });
} else {
  const before = fs.readFileSync(session, "utf8");
  if (before.includes("PRIMARY_ATTEMPT_POLLUTION")) {
    emit({ content: [], errorMessage: "fallback inherited a polluted fork session", stopReason: "error" });
  } else {
    fs.appendFileSync(session, "FALLBACK_SUCCESS\\n");
    emit({ content: [{ type: "text", text: "CLEAN_" + sessionName }], stopReason: "stop" });
  }
}
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const sessionByOldLifecycleShard = new Map<number, string>();
		const sessionFiles: string[] = [];
		for (let index = 0; index < 10_000 && sessionFiles.length === 0; index += 1) {
			const candidate = path.join(root, `fork-${index}.jsonl`);
			const shard = fallbackShardForTest(candidate);
			const collision = sessionByOldLifecycleShard.get(shard);
			if (collision) sessionFiles.push(collision, candidate);
			else sessionByOldLifecycleShard.set(shard, candidate);
		}
		expect(sessionFiles).toHaveLength(2);
		expect(fallbackShardForTest(sessionFiles[0] ?? "")).toBe(fallbackShardForTest(sessionFiles[1] ?? ""));
		for (const sessionFile of sessionFiles) fs.writeFileSync(sessionFile, "BASE_SESSION\n", { mode: 0o600 });
		const restoreDirectory = path.join(root, ".pi-stuff-fallback-restores");
		fs.mkdirSync(restoreDirectory, { mode: 0o700 });
		for (let index = 0; index < 300; index += 1) {
			fs.writeFileSync(path.join(restoreDirectory, `unrelated-${String(index).padStart(3, "0")}`), "retained");
		}
		const priorRestorePaths = sessionFiles.map((sessionFile) => {
			const key = fallbackSessionKeyForTest(sessionFile);
			const prior = path.join(restoreDirectory, `restore-${key}.tmp`);
			fs.writeFileSync(prior, "CRASH_LEFT_PARTIAL_RESTORE", { mode: 0o600 });
			return prior;
		});
		const asyncDir = path.join(root, "async-parallel-fallback");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "parallel-fallback",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "parallel",
				group: {
					tasks: sessionFiles.map((sessionFile, index) => ({
						...task(index),
						cwd: root,
						sessionFile,
						modelCandidates: ["test/model-a", "test/model-b"],
					})),
					concurrency: 2,
					worktree: false,
				},
			},
		});

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ success?: boolean; modelAttempts?: Array<{ model?: string; success?: boolean }> }>;
		};
		expect(completion.state).toBe("complete");
		expect(completion.results).toHaveLength(2);
		for (const result of completion.results) {
			expect(result).toMatchObject({
				success: true,
				modelAttempts: [
					{ model: "test/model-a", success: false },
					{ model: "test/model-b", success: true },
				],
			});
		}
		expect(fs.readdirSync(readyDirectory).filter((name) => name.endsWith(".ready"))).toHaveLength(2);
		for (const sessionFile of sessionFiles) {
			const session = fs.readFileSync(sessionFile, "utf8");
			expect(session).toContain("BASE_SESSION");
			expect(session).toContain("FALLBACK_SUCCESS");
			expect(session).not.toContain("PRIMARY_ATTEMPT_POLLUTION");
		}
		expect(fs.existsSync(path.join(restoreDirectory, "restore.lock"))).toBeFalse();
		expect(priorRestorePaths.every((prior) => !fs.existsSync(prior))).toBeTrue();
		expect(fs.readdirSync(restoreDirectory).filter((name) => name.startsWith("unrelated-"))).toHaveLength(300);
	}, 8_000);

	test("rejects a concurrent fallback owner through a parent-directory alias", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const alias = path.join(root, "root-alias");
		fs.symlinkSync(root, alias, "dir");
		const sessionFile = path.join(root, "shared-fork.jsonl");
		fs.writeFileSync(sessionFile, "BASE_SESSION\n", { mode: 0o600 });
		const writer = path.join(root, "holding-success.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
setTimeout(() => process.stdout.write(JSON.stringify({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "HELD_SESSION_SUCCESS" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
}) + "\\n", () => process.exit(0)), 1_200);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-same-session");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "same-session",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "parallel",
				group: {
					tasks: [sessionFile, path.join(alias, path.basename(sessionFile))].map((aliasedSession, index) => ({
						...task(index),
						cwd: root,
						sessionFile: aliasedSession,
						modelCandidates: ["test/model-a", "test/model-b"],
					})),
					concurrency: 2,
					worktree: false,
				},
			},
		});

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; output?: string; success?: boolean }>;
		};
		expect(completion.state).toBe("failed");
		expect(completion.results.filter((result) => result.success)).toHaveLength(1);
		expect(completion.results.filter((result) => result.output === "HELD_SESSION_SUCCESS")).toHaveLength(1);
		expect(completion.results.filter((result) => result.error?.includes("already owned"))).toHaveLength(1);
	}, 6_000);

	test("advances fallback orphan cleanup across pages without deleting an active copy", async () => {
		const root = fixtureRoot();
		const restoreDirectory = path.join(root, ".pi-stuff-fallback-restores");
		fs.mkdirSync(restoreDirectory, { mode: 0o700 });
		const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1_000);
		const oldPaths: string[] = [];
		for (let index = 0; index < 130; index += 1) {
			const key = createHash("sha256").update(`orphan-${index}`).digest("hex");
			const candidate = path.join(restoreDirectory, `restore-${key}.tmp`);
			fs.writeFileSync(candidate, `PRIVATE_ORPHAN_${index}`, { mode: 0o600 });
			fs.utimesSync(candidate, oldDate, oldDate);
			oldPaths.push(candidate);
		}
		const activeKey = createHash("sha256").update("active-orphan").digest("hex");
		const activePath = path.join(restoreDirectory, `restore-${activeKey}.tmp`);
		fs.writeFileSync(activePath, "PRIVATE_ACTIVE_COPY", { mode: 0o600 });
		fs.utimesSync(activePath, oldDate, oldDate);
		const recentKey = createHash("sha256").update("recent-orphan").digest("hex");
		const recentPath = path.join(restoreDirectory, `restore-${recentKey}.tmp`);
		fs.writeFileSync(recentPath, "PRIVATE_RECENT_COPY", { mode: 0o600 });
		const activeClaim = tryAcquireKernelClaim(
			restoreDirectory,
			shardedDurableClaimName("fallback-restore", activeKey, 4_096),
		);
		if (!activeClaim) throw new Error("Failed to establish active fallback-copy fixture claim.");

		const writer = path.join(root, "immediate-success.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.stdout.write(JSON.stringify({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "SWEEP_TRIGGERED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
}) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const runSweep = async (index: number): Promise<void> => {
			const sessionFile = path.join(root, `sweep-${index}.jsonl`);
			fs.writeFileSync(sessionFile, "BASE_SESSION\n", { mode: 0o600 });
			const asyncDir = path.join(root, `async-sweep-${index}`);
			await runConfiguredBackground({
				version: 2,
				id: `sweep-${index}`,
				cwd: root,
				asyncDir,
				resultPath: path.join(asyncDir, "result.json"),
				work: {
					mode: "single",
					task: {
						...task(index),
						cwd: root,
						sessionFile,
						modelCandidates: ["test/model-a", "test/model-b"],
					},
				},
			});
		};

		try {
			await runSweep(0);
			await runSweep(1);
			await runSweep(2);
			expect(fs.existsSync(activePath)).toBeTrue();
			expect(fs.existsSync(recentPath)).toBeTrue();
			expect(oldPaths.some((candidate) => fs.existsSync(candidate))).toBeFalse();
		} finally {
			activeClaim.release();
		}
		await runSweep(3);
		expect(fs.existsSync(activePath)).toBeFalse();
		expect(fs.existsSync(recentPath)).toBeTrue();
	}, 8_000);

	test("keeps a real runner fallback session anonymous across SIGKILL", async () => {
		if (process.platform !== "linux") return;
		const root = fixtureRoot();
		const isolatedTemp = path.join(root, "isolated-tmp");
		fs.mkdirSync(isolatedTemp, { mode: 0o700 });
		const sessionFile = path.join(root, "fork-for-crash.jsonl");
		fs.writeFileSync(sessionFile, "PRIVATE_SESSION_COPY\n", { mode: 0o600 });
		const writerReady = path.join(root, "writer-ready.txt");
		const writer = path.join(root, "holding-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(writerReady)}, String(process.pid));
setTimeout(() => process.exit(0), 2_000);
`,
			{ mode: 0o700 },
		);
		const moduleUrl = pathToFileURL(
			path.resolve("packages/pi-stuff/src/subagents/src/runs/background/subagent-runner.ts"),
		).href;
		const asyncDir = path.join(root, "async-fallback-crash");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "fallback-crash",
			cwd: root,
			asyncDir,
			resultPath: path.join(asyncDir, "result.json"),
			work: {
				mode: "single",
				task: {
					...task(0),
					cwd: root,
					sessionFile,
					modelCandidates: ["test/model-a", "test/model-b"],
				},
			},
		};
		const script = `
const { runConfiguredBackground } = await import(${JSON.stringify(moduleUrl)});
await runConfiguredBackground(${JSON.stringify(config)});
`;
		const child = spawn(process.execPath, ["-e", script], {
			env: {
				...process.env,
				PI_SUBAGENT_PI_BINARY: writer,
				TMPDIR: isolatedTemp,
				TMP: isolatedTemp,
				TEMP: isolatedTemp,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		const childClosed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
		});
		try {
			await waitForFile(writerReady);
			const fallbackEntries = (): string[] => {
				const found: string[] = [];
				const pending = [isolatedTemp];
				while (pending.length > 0) {
					const directory = pending.pop();
					if (!directory) break;
					for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
						const candidate = path.join(directory, entry.name);
						if (entry.isDirectory()) pending.push(candidate);
						if (entry.name.startsWith("pi-subagent-fallback-") || entry.name.startsWith("snapshot-")) {
							found.push(path.relative(isolatedTemp, candidate));
						}
					}
				}
				return found;
			};
			expect(fallbackEntries()).toEqual([]);
			child.kill("SIGKILL");
			await childClosed;
			expect(fallbackEntries()).toEqual([]);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await childClosed;
			if (fs.existsSync(writerReady)) {
				const writerPid = Number(fs.readFileSync(writerReady, "utf8"));
				if (Number.isSafeInteger(writerPid) && writerPid > 0) {
					try {
						process.kill(writerPid, "SIGKILL");
					} catch {}
				}
			}
		}
	}, 5_000);

	test("does not retry the whole task after a child has begun Tool execution", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "no-fallback-after-tool.ts");
		const attemptsPath = path.join(root, "model-attempts.txt");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
const args = Bun.argv.slice(2);
const modelIndex = args.indexOf("--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] ?? "default" : "default";
fs.appendFileSync(${JSON.stringify(attemptsPath)}, model + "\\n");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
if (model.endsWith("model-a")) {
  emit({ type: "tool_execution_start", toolName: "write", args: { path: "changed.txt" } });
  emit({ type: "tool_execution_end", toolName: "write" });
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      errorMessage: "network error after a mutating Tool",
      stopReason: "error",
      timestamp: Date.now(),
    },
  }) + "\\n", () => process.exit(0));
} else {
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "UNSAFE_SECOND_ATTEMPT" }],
      stopReason: "stop",
      timestamp: Date.now(),
    },
  }) + "\\n", () => process.exit(0));
}
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-no-fallback-after-tool");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "no-fallback-after-tool",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "single",
				task: {
					...task(0),
					cwd: root,
					modelCandidates: ["test/model-a", "test/model-b"],
				},
			},
		});

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ modelAttempts?: Array<{ model?: string; success?: boolean }> }>;
		};
		expect(completion).toMatchObject({
			state: "failed",
			results: [
				{
					modelAttempts: [{ model: "test/model-a", success: false }],
				},
			],
		});
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			steps: [{ toolCount: 1 }],
		});
		expect(fs.readFileSync(attemptsPath, "utf8").trim().split("\n")).toEqual(["test/model-a"]);
	}, 5_000);

	test("preserves prior writer proof when fallback persistence and the next launch fail", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "retryable-provider-error.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "FIRST_ATTEMPT_REACHED_PROVIDER" }],
    errorMessage: "503 Service Unavailable",
    stopReason: "error",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-retry-proof");
		const resultPath = path.join(asyncDir, "result.json");
		const statusPath = path.join(asyncDir, "status.json");
		const statusBackup = path.join(asyncDir, "status.backup.json");
		let spawning = 0;

		await runConfiguredBackground(
			{
				version: 2,
				id: "retry-proof",
				cwd: root,
				asyncDir,
				resultPath,
				runnerProcessInstanceId: "runner-proof",
				work: {
					mode: "single",
					task: {
						...task(0),
						cwd: root,
						modelCandidates: ["test/model-a", "test/model-b"],
					},
				},
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					if (writerState.state === "spawning") {
						spawning += 1;
						if (spawning === 2) {
							fs.rmSync(statusPath, { recursive: true, force: true });
							fs.renameSync(statusBackup, statusPath);
							throw new Error("injected second launch failure");
						}
					} else if (writerState.state === "none" && spawning === 1 && fs.existsSync(statusPath)) {
						fs.renameSync(statusPath, statusBackup);
						fs.mkdirSync(statusPath);
					}
				},
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{
				writerProcesses?: Array<{ processInstanceId?: string }>;
				writerAttemptCount?: number;
				modelAttempts?: Array<{ model?: string; error?: string }>;
			}>;
		};
		const candidate = JSON.parse(fs.readFileSync(path.join(asyncDir, "process-terminal-candidate.json"), "utf8")) as {
			expectedWriters?: Record<string, number>;
			writers?: Record<string, unknown[]>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			results: [
				{
					writerAttemptCount: 1,
					modelAttempts: [
						{ model: "test/model-a", error: "503 Service Unavailable" },
						{ model: "test/model-b", error: "injected second launch failure" },
					],
				},
			],
		});
		expect(completion.results[0]?.writerProcesses).toHaveLength(1);
		expect(candidate.expectedWriters?.["0"]).toBe(1);
		expect(candidate.writers?.["0"]).toHaveLength(1);
	}, 5_000);

	test("keeps the async interrupt handler installed through terminal persistence", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "finalization-signal-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "FINALIZATION_SURVIVED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-finalization-signal");
		const resultPath = path.join(asyncDir, "result.json");
		const interruptSignal = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";
		const baselineListeners = process.listenerCount(interruptSignal);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const atSeam = new Promise<void>((resolve) => {
			entered = resolve;
		});

		const running = runConfiguredBackground(
			{
				version: 2,
				id: "finalization-signal",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				beforeFinalPersistence: async () => {
					entered();
					await blocked;
				},
			},
		);
		await atSeam;
		expect(process.listenerCount(interruptSignal)).toBeGreaterThan(baselineListeners);
		process.emit(interruptSignal);
		release();
		await running;

		expect(process.listenerCount(interruptSignal)).toBe(baselineListeners);
		expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
			state: "complete",
			results: [{ output: "FINALIZATION_SURVIVED", success: true }],
		});
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			state: "complete",
			steps: [{ status: "complete" }],
		});
	});

	test("continues and reaps the writer when live status persistence degrades", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "status-degradation-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => {
  emit({ type: "tool_execution_start", toolName: "read", args: { path: "sample.ts" } });
  emit({ type: "tool_execution_end", toolName: "read" });
  emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "STATUS_DEGRADED_BUT_COMPLETE" }], stopReason: "stop", timestamp: Date.now() } });
  process.exit(0);
}, 50);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-status-degradation");
		const resultPath = path.join(asyncDir, "result.json");
		const statusPath = path.join(asyncDir, "status.json");
		let writerPid: number | undefined;
		await expect(
			runConfiguredBackground(
				{
					version: 2,
					id: "status-degradation",
					cwd: root,
					asyncDir,
					resultPath,
					work: { mode: "single", task: { ...task(0), cwd: root } },
				},
				{
					afterWriterProcessUpdate: (_index, writerState) => {
						if (writerState.state !== "running") return;
						writerPid = writerState.pid;
						fs.rmSync(statusPath, { force: true });
						fs.mkdirSync(statusPath);
					},
				},
			),
		).resolves.toBeUndefined();
		expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
			state: "complete",
			results: [{ output: "STATUS_DEGRADED_BUT_COMPLETE", success: true }],
		});
		expect(fs.statSync(statusPath).isDirectory()).toBe(true);
		expect(writerPid).toBeNumber();
		const settledWriterPid = writerPid;
		if (settledWriterPid !== undefined) expect(() => process.kill(settledWriterPid, 0)).toThrow();
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "writer-processes-live.json"), "utf8"))).toMatchObject({
			writers: { "0": { state: "none" } },
		});
	});

	test("fails, persists proof, and reaps a writer that emits structurally invalid JSON protocol", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "malformed-protocol-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.stdout.write(JSON.stringify({
  type: "message_end",
  message: { role: "assistant", content: "oops", stopReason: "stop" },
}) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-malformed-protocol");
		const resultPath = path.join(asyncDir, "result.json");
		let writerPid: number | undefined;

		await runConfiguredBackground(
			{
				version: 2,
				id: "malformed-protocol",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					if (writerState.state === "running") writerPid = writerState.pid;
				},
			},
		);

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{
				error?: string;
				success: boolean;
				writerProcesses?: Array<{ signal?: string; terminationOrigin?: string }>;
			}>;
		};
		expect(completion.state).toBe("failed");
		expect(completion.results[0]?.success).toBe(false);
		expect(completion.results[0]?.error).toContain(
			"protocol_invalid_event: message_end message.content for role 'assistant' must be an array",
		);
		expect(completion.results[0]?.writerProcesses).toEqual([
			expect.objectContaining({ signal: "SIGTERM", terminationOrigin: "manager-request" }),
		]);
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			state: "failed",
			steps: [{ status: "failed" }],
		});
		expect(writerPid).toBeNumber();
		const settledWriterPid = writerPid;
		if (settledWriterPid !== undefined) expect(() => process.kill(settledWriterPid, 0)).toThrow();
	});

	test("accepts Pi CustomMessage lifecycle events without selecting them as the child report", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "custom-message-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
emit({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "WORK_IN_PROGRESS" }],
    stopReason: "toolUse",
    timestamp: Date.now(),
  },
});
emit({
  type: "message_end",
  message: {
    role: "custom",
    customType: "magic-context:ceiling-nudge",
    content: "HOUSEKEEPING_NOT_A_REPORT",
    display: false,
    details: { source: "fixture" },
    timestamp: Date.now(),
  },
});
emit({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "CUSTOM_MESSAGE_SURVIVED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
});
process.exit(0);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-custom-message");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "custom-message",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config);

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8"));
		expect(completion).toMatchObject({
			state: "complete",
			results: [{ output: "CUSTOM_MESSAGE_SURVIVED", success: true, contextNudgeObserved: true }],
		});
		const projected = projectForegroundCompletion(config, completion);
		expect(projected.content[0]).toMatchObject({ text: expect.stringContaining("Context housekeeping observed") });
		const transcriptPath = path.join(asyncDir, "transcripts", "0-agent-0.jsonl");
		const transcript = fs
			.readFileSync(transcriptPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(transcript).toContainEqual(
			expect.objectContaining({
				recordType: "message",
				role: "custom",
				customType: "magic-context:ceiling-nudge",
				text: "HOUSEKEEPING_NOT_A_REPORT",
			}),
		);
	});

	test("retains writer proof when a malformed tool-result record is rejected", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "malformed-tool-result-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.stdout.write(JSON.stringify({
  type: "tool_result_end",
  message: {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    isError: true,
    content: [{ type: "text", text: 42 }],
  },
}) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-malformed-tool-result");
		const resultPath = path.join(asyncDir, "result.json");
		let writerPid: number | undefined;

		await runConfiguredBackground(
			{
				version: 2,
				id: "malformed-tool-result",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					if (writerState.state === "running") writerPid = writerState.pid;
				},
			},
		);

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{
				error?: string;
				success: boolean;
				writerAttemptCount?: number;
				writerProcesses?: Array<{ signal?: string; terminationOrigin?: string }>;
			}>;
		};
		expect(completion.results[0]).toMatchObject({
			success: false,
			writerAttemptCount: 1,
		});
		expect(completion.results[0]?.error).toContain("message.content text must be a string");
		expect(completion.results[0]?.writerProcesses).toEqual([
			expect.objectContaining({ signal: "SIGTERM", terminationOrigin: "manager-request" }),
		]);
		const settledWriterPid = writerPid;
		expect(settledWriterPid).toBeNumber();
		if (settledWriterPid !== undefined) expect(() => process.kill(settledWriterPid, 0)).toThrow();
	});

	test("leaves a nonterminal status that stale reconciliation can repair when result persistence fails", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "result-persistence-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "RESULT_WAS_READY" }], stopReason: "stop", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "result-persistence");
		const resultPath = path.join(asyncDir, "result.json");

		await expect(
			runConfiguredBackground(
				{
					version: 2,
					id: "result-persistence",
					cwd: root,
					asyncDir,
					resultPath,
					work: { mode: "single", task: { ...task(0), cwd: root } },
				},
				{
					beforeResultPersistence: () => {
						throw Object.assign(new Error("injected result EIO"), { code: "EIO" });
					},
				},
			),
		).rejects.toThrow("injected result EIO");
		expect(fs.existsSync(resultPath)).toBe(false);
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			state: "running",
			steps: [{ recentOutput: ["RESULT_WAS_READY"], status: "complete" }],
		});

		const resultsDir = path.join(root, "reconciled-results");
		fs.mkdirSync(resultsDir);
		const repaired = reconcileAsyncRun(asyncDir, {
			resultsDir,
			kill: () => {
				throw Object.assign(new Error("gone"), { code: "ESRCH" });
			},
		});
		expect(repaired).toMatchObject({ repaired: true, status: { state: "failed" } });
		expect(fs.existsSync(path.join(resultsDir, "result-persistence.json"))).toBe(true);
	});

	test("keeps successful child proof when optional worktree evidence capture fails", async () => {
		const root = fixtureRoot();
		for (const args of [
			["init", "-b", "main"],
			["config", "user.name", "Pi Stuff Test"],
			["config", "user.email", "pi-stuff@example.invalid"],
			["config", "commit.gpgsign", "false"],
			["add", "."],
			["commit", "-m", "fixture"],
		] as const) {
			const command = Bun.spawnSync(["git", ...args], { cwd: root, stderr: "pipe", stdout: "pipe" });
			if (command.exitCode !== 0) throw new Error(command.stderr.toString("utf-8"));
		}
		const writer = path.join(root, "worktree-evidence-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "WORKTREE_TASK_SUCCEEDED" }], stopReason: "stop", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		for (const args of [
			["add", path.basename(writer)],
			["commit", "-m", "add writer fixture"],
		] as const) {
			const command = Bun.spawnSync(["git", ...args], { cwd: root, stderr: "pipe", stdout: "pipe" });
			if (command.exitCode !== 0) throw new Error(command.stderr.toString("utf-8"));
		}
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const resultRoot = fixtureRoot();
		const asyncDir = path.join(resultRoot, "async-worktree-evidence");
		const resultPath = path.join(asyncDir, "result.json");
		await runConfiguredBackground(
			{
				version: 2,
				id: "worktree-evidence",
				cwd: root,
				asyncDir,
				resultPath,
				work: {
					mode: "parallel",
					group: {
						tasks: [{ ...task(0), cwd: root }],
						concurrency: 1,
						worktree: true,
					},
				},
			},
			{
				beforeWorktreeEvidence: () => {
					throw new Error("injected evidence failure");
				},
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{ output: string; success: boolean; writerProcesses?: unknown[] }>;
			worktree?: { error?: string; cleanup?: { state?: string } };
		};
		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [{ output: "WORKTREE_TASK_SUCCEEDED", success: true }],
			worktree: { error: expect.stringContaining("injected evidence failure") },
		});
		expect(completion.results[0]?.writerProcesses).toHaveLength(1);
		const listed = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
			cwd: root,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(listed.exitCode).toBe(0);
		expect(listed.stdout.toString("utf-8").match(/^worktree /gmu)).toHaveLength(1);
	}, 10_000);

	test("treats an internal final drain after a clean terminal report as completion", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "lingering-success-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_COMPLETED_REVIEW" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "internal-final-drain",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				output: string;
				success: boolean;
				writerProcesses: Array<{
					exitCode: number | null;
					signal: string | null;
					terminationOrigin?: string;
				}>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					output: "VALID_COMPLETED_REVIEW",
					success: true,
					writerProcesses: [{ exitCode: null, signal: "SIGTERM", terminationOrigin: "manager-final-drain" }],
				},
			],
		});
	}, 5_000);

	test("fails without inventing a crash when final-drain disposition proof is unavailable", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "missing-disposition-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BUT_PROOF_REMOVED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-missing-disposition");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground(
			{
				version: 2,
				id: "missing-final-drain-disposition",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				beforeWriterSupervisorDispositionRead: (filePath) => fs.rmSync(filePath, { force: true }),
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				crashed?: boolean;
				error?: string;
				success: boolean;
				writerProcesses?: Array<{ terminationOrigin?: string }>;
			}>;
		};

		expect(completion.state).toBe("failed");
		expect(completion.success).toBeFalse();
		expect(completion.results[0]).toMatchObject({
			success: false,
			error: expect.stringContaining("termination provenance could not be verified"),
		});
		expect(completion.results[0]?.crashed).not.toBeTrue();
		expect(completion.results[0]?.writerProcesses?.[0]?.terminationOrigin).toBeUndefined();
	}, 5_000);

	test("settles durably when asynchronous writer close recovery rejects", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "close-recovery-rejection-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "CLOSE_RECOVERY_REACHED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-close-recovery-rejection");
		const resultPath = path.join(asyncDir, "result.json");
		const tempRoot = isolatedSystemTempRoot();

		await runConfiguredBackground(
			{
				version: 2,
				id: "close-recovery-rejection",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				beforeWriterCloseRecovery: async () => {
					throw Object.assign(new Error("injected writer registry EIO"), { code: "EIO" });
				},
			},
		);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; success: boolean }>;
		};
		const leaked = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith("pi-subagent-"));

		expect(completion).toMatchObject({
			state: "failed",
			results: [{ success: false, error: expect.stringContaining("injected writer registry EIO") }],
		});
		expect(leaked).toEqual([]);
	}, 5_000);

	test("classifies a bare SIGTERM to the writer supervisor as an external crash", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const writer = path.join(root, "external-supervisor-signal-writer.ts");
		fs.writeFileSync(writer, "#!/usr/bin/env bun\nsetInterval(() => {}, 1_000);\n", { mode: 0o700 });
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-external-supervisor-signal");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "external-supervisor-signal",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config, {
			afterWriterProcessUpdate: (_index, writerState) => {
				if (writerState.state !== "running") return;
				setTimeout(() => process.kill(writerState.pid, "SIGTERM"), 100);
			},
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8"));
		const projected = projectForegroundCompletion(config, completion);

		expect(completion).toMatchObject({
			state: "failed",
			results: [
				{
					success: false,
					writerProcesses: [{ signal: "SIGTERM", terminationOrigin: "external" }],
				},
			],
		});
		expect(projected.details.results[0]?.crashed).toBeTrue();
	}, 5_000);

	test("preserves external provenance when a manager stop follows the same signal", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const readyMarker = path.join(root, "external-then-manager-ready");
		const signalMarker = path.join(root, "external-then-manager-signalled");
		const writer = path.join(root, "external-then-manager-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(signalMarker)}, "signalled");
  setTimeout(() => process.exit(143), 250);
});
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-external-then-manager");
		const resultPath = path.join(asyncDir, "result.json");
		let supervisorPid: number | undefined;
		const running = runConfiguredBackground(
			{
				version: 2,
				id: "external-then-manager",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					if (writerState.state === "running") supervisorPid = writerState.pid;
				},
			},
		);
		await waitForFile(readyMarker);
		if (!supervisorPid) throw new Error("Writer supervisor did not publish its pid.");
		process.kill(supervisorPid, "SIGTERM");
		await waitForFile(signalMarker);
		requestAsyncStop(asyncDir, { source: "test" });
		await running;

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{ writerProcesses?: Array<{ terminationOrigin?: string }> }>;
		};
		expect(completion.results[0]?.writerProcesses?.[0]?.terminationOrigin).toBe("external");
	}, 5_000);

	test("persists manager provenance and reaps a writer that ignores graceful termination", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const readyMarker = path.join(root, "stubborn-writer-ready");
		const writer = path.join(root, "stubborn-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
process.on("SIGTERM", () => {});
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-stubborn-writer");
		const resultPath = path.join(asyncDir, "result.json");
		let supervisorPid: number | undefined;
		const running = runConfiguredBackground(
			{
				version: 2,
				id: "stubborn-writer",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			},
			{
				afterWriterProcessUpdate: (_index, writerState) => {
					if (writerState.state === "running") supervisorPid = writerState.pid;
				},
			},
		);
		await waitForFile(readyMarker);
		requestAsyncStop(asyncDir, { source: "test" });
		await running;

		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ writerProcesses?: Array<{ childPid?: number; terminationOrigin?: string }> }>;
		};
		expect(completion).toMatchObject({
			state: "stopped",
			results: [{ writerProcesses: [{ terminationOrigin: "manager-request" }] }],
		});
		for (const pid of [supervisorPid, completion.results[0]?.writerProcesses?.[0]?.childPid]) {
			if (pid !== undefined) expect(() => process.kill(pid, 0)).toThrow();
		}
	}, 12_000);

	test("bounds writer output drain when an escaped descendant inherits its pipes", async () => {
		if (process.platform === "win32") return;
		const root = fixtureRoot();
		const escapedPidPath = path.join(root, "escaped-writer-descendant.pid");
		const writer = path.join(root, "escaped-writer-descendant.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import { spawn } from "node:child_process";
import * as fs from "node:fs";
const escaped = spawn("/bin/sh", ["-c", "sleep 30"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
escaped.unref();
fs.writeFileSync(${JSON.stringify(escapedPidPath)}, String(escaped.pid));
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "ESCAPED_PIPE_RESULT" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-escaped-writer-descendant");
		const resultPath = path.join(asyncDir, "result.json");
		let escapedPid: number | undefined;

		try {
			const startedAt = Date.now();
			await runConfiguredBackground({
				version: 2,
				id: "escaped-writer-descendant",
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: { ...task(0), cwd: root } },
			});
			expect(Date.now() - startedAt).toBeLessThan(6_000);
			escapedPid = Number(fs.readFileSync(escapedPidPath, "utf8"));
			const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
				state: string;
				results: Array<{ output?: string; success: boolean }>;
			};
			expect(completion).toMatchObject({
				state: "complete",
				results: [{ output: "ESCAPED_PIPE_RESULT", success: true }],
			});
		} finally {
			if (escapedPid === undefined && fs.existsSync(escapedPidPath)) {
				escapedPid = Number(fs.readFileSync(escapedPidPath, "utf8"));
			}
			if (escapedPid !== undefined && Number.isSafeInteger(escapedPid) && escapedPid > 0) {
				try {
					process.kill(-escapedPid, "SIGKILL");
				} catch {
					// The detached fixture may already have exited.
				}
			}
		}
	}, 8_000);

	test("treats a manager-owned final-drain exit 143 from the Host as completion", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "host-exit-143-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.on("SIGTERM", () => process.exit(143));
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_HOST_EXIT_143" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-143-manager");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "manager-owned-host-exit-143",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				success: boolean;
				writerProcesses?: Array<{
					exitCode: number | null;
					signal: string | null;
					terminationOrigin?: string;
				}>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					success: true,
					writerProcesses: [{ exitCode: 143, signal: null, terminationOrigin: "manager-final-drain" }],
				},
			],
		});
	}, 5_000);

	test("keeps manager final-drain provenance when steering races a wrapper exit 143", async () => {
		const root = fixtureRoot();
		const signalMarker = path.join(root, "manager-term-observed");
		const writer = path.join(root, "steer-after-manager-term.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(signalMarker)}, "term");
  setTimeout(() => process.exit(143), 400);
});
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_STEER_RACE" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-steer-drain-race");
		const resultPath = path.join(asyncDir, "result.json");
		const running = runConfiguredBackground({
			version: 2,
			id: "steer-drain-race",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});

		await waitForFile(signalMarker, 3_000);
		requestAsyncSteer(asyncDir, {
			id: "late-steer",
			message: "Add one more check before finishing.",
			source: "test",
			targetIndex: 0,
		});
		await running;
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ writerProcesses?: Array<{ terminationOrigin?: string }> }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steering?: { failed?: number; pending?: number };
		};

		expect(completion).toMatchObject({
			state: "complete",
			results: [{ writerProcesses: [{ terminationOrigin: "manager-final-drain" }] }],
		});
		expect(status.steering).toMatchObject({ failed: 1, pending: 0 });
	}, 5_000);

	test("does not forgive an external exit 143 before the manager final drain", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "external-exit-143-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BUT_EXTERNAL_EXIT_143" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.exit(143), 25);
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-143-external");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "external-host-exit-143",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				success: boolean;
				writerProcesses?: Array<{ terminationOrigin?: string }>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			success: false,
			results: [
				{
					exitCode: 143,
					success: false,
					writerProcesses: [{ terminationOrigin: "external" }],
				},
			],
		});
	}, 5_000);

	test("does not forgive an external signal after a clean terminal report", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "externally-terminated-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BUT_EXTERNALLY_TERMINATED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.kill(process.pid, "SIGTERM"), 25);
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "external-signal-after-report",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				success: boolean;
				writerProcesses: Array<{
					exitCode: number | null;
					signal: string | null;
					terminationOrigin?: string;
				}>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			success: false,
			results: [
				{
					exitCode: 1,
					success: false,
					writerProcesses: [{ exitCode: null, signal: "SIGTERM", terminationOrigin: "external" }],
				},
			],
		});
	}, 5_000);

	test("does not forgive an external SIGKILL after the manager sent its final-drain SIGTERM", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "externally-killed-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.on("SIGTERM", () => {});
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_EXTERNAL_SIGKILL" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.kill(process.pid, "SIGKILL"), 1_500);
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "external-sigkill-after-final-drain-term",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				success: boolean;
				writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			success: false,
			results: [
				{
					exitCode: 1,
					success: false,
					writerProcesses: [{ exitCode: null, signal: "SIGKILL" }],
				},
			],
		});
	}, 5_000);

	test("records a manager-owned final-drain SIGKILL as semantic completion", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "manager-killed-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.on("SIGTERM", () => {});
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_MANAGER_SIGKILL" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "manager-owned-final-drain-sigkill",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				success: boolean;
				writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					success: true,
					writerProcesses: [{ exitCode: null, signal: "SIGKILL" }],
				},
			],
		});
	}, 6_000);

	test("keeps a valid Agent result when its optional artifact directory disappears", async () => {
		const root = fixtureRoot();
		const artifactsDir = path.join(root, "artifacts");
		const writer = path.join(root, "artifact-loss-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.rmSync(${JSON.stringify(artifactsDir)}, { recursive: true, force: true });
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_AFTER_ARTIFACT_LOSS" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "artifact-directory-loss",
			cwd: root,
			asyncDir,
			resultPath,
			artifactsDir,
			artifactConfig: { enabled: true },
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				artifactPaths?: { outputPath: string; metadataPath: string };
				output: string;
				success: boolean;
				transcriptError?: string;
			}>;
		};
		const child = completion.results[0];
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ finalOutput?: string; savedOutputPath?: string }>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [{ output: "VALID_AFTER_ARTIFACT_LOSS", success: true }],
		});
		expect(child?.transcriptError).toContain("Failed to write child transcript");
		expect(status.steps[0]).toMatchObject({
			finalOutput: "VALID_AFTER_ARTIFACT_LOSS",
			savedOutputPath: child?.artifactPaths?.outputPath,
		});
		expect(child?.artifactPaths && fs.existsSync(child.artifactPaths.outputPath)).toBe(true);
		expect(child?.artifactPaths && fs.existsSync(child.artifactPaths.metadataPath)).toBe(true);
		const metadata = JSON.parse(fs.readFileSync(child?.artifactPaths?.metadataPath ?? "", "utf8")) as {
			state?: string;
		};
		expect(metadata.state).toBe("complete");
	}, 5_000);

	test("bounds aggregate newline-delimited child protocol output and reaps the writer", async () => {
		const root = fixtureRoot();
		process.env.PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES = "4096";
		const writer = path.join(root, "aggregate-protocol-limit.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const lines = [];
for (let index = 0; index < 100; index++) {
  lines.push(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ROW-" + index + "-" + "x".repeat(240) }],
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
  }));
}
process.stdout.write(lines.join("\\n") + "\\n");
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-aggregate-protocol");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "aggregate-protocol",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{
				error?: string;
				protocolError?: { scope?: string; limitBytes?: number };
				writerProcesses?: Array<{ terminationOrigin?: string }>;
			}>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ recentOutput?: string[] }>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			results: [
				{
					error: expect.stringContaining("aggregate protocol limit"),
					protocolError: { scope: "aggregate", limitBytes: 4096 },
					writerProcesses: [{ terminationOrigin: "manager-request" }],
				},
			],
		});
		expect(Buffer.byteLength((status.steps[0]?.recentOutput ?? []).join("\n"), "utf8")).toBeLessThanOrEqual(
			64 * 1024,
		);
	}, 5_000);

	test("compacts redundant Pi lifecycle payloads before applying the aggregate protocol limit", async () => {
		const root = fixtureRoot();
		process.env.PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES = "4096";
		const writer = path.join(root, "redundant-protocol-payloads.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const toolResult = {
  role: "toolResult",
  toolCallId: "call-1",
  toolName: "read",
  content: [{ type: "text", text: "x".repeat(1700) }],
  isError: false,
  timestamp: Date.now(),
};
const assistant = {
  role: "assistant",
  content: [{ type: "text", text: "PROTOCOL_COMPACTED" }],
  stopReason: "stop",
  timestamp: Date.now(),
};
const events = [
  { type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "fixture" } },
  { type: "message_start", message: toolResult },
  { type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: toolResult.content }, isError: false },
  { type: "message_end", message: toolResult },
  { type: "turn_end", message: assistant, toolResults: [toolResult] },
  { type: "message_end", message: assistant },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join("\\n") + "\\n");
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-redundant-protocol");
		const resultPath = path.join(asyncDir, "result.json");

		await runConfiguredBackground({
			version: 2,
			id: "redundant-protocol",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{ output?: string; protocolError?: unknown; success: boolean }>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [{ output: "PROTOCOL_COMPACTED", success: true }],
		});
		expect(completion.results[0]?.protocolError).toBeUndefined();
	}, 5_000);

	test("enforces aggregate protocol and turn budgets on a final record without a newline", async () => {
		const root = fixtureRoot();
		const cases = [
			{
				id: "aggregate-final-line",
				protocolLimit: "512",
				script: `
const event = (text) => JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "toolUse", timestamp: Date.now() } });
process.stdout.write(event("a".repeat(240)) + "\\n" + event("b".repeat(240)), () => process.exit(0));
`,
				task: { ...task(0), cwd: root },
				expected: "aggregate protocol limit",
			},
			{
				id: "turn-budget-final-line",
				protocolLimit: "4096",
				script: `
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "OVER_BUDGET_WITHOUT_NEWLINE" }], stopReason: "toolUse", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event), () => process.exit(0));
`,
				task: { ...task(0), cwd: root, turnBudget: { maxTurns: 1, graceTurns: 0 } },
				expected: "turn budget",
			},
		] as const;

		for (const fixture of cases) {
			process.env.PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES = fixture.protocolLimit;
			const writer = path.join(root, `${fixture.id}.ts`);
			fs.writeFileSync(writer, `#!/usr/bin/env bun\n${fixture.script}`, { mode: 0o700 });
			process.env.PI_SUBAGENT_PI_BINARY = writer;
			const asyncDir = path.join(root, fixture.id);
			const resultPath = path.join(asyncDir, "result.json");
			await runConfiguredBackground({
				version: 2,
				id: fixture.id,
				cwd: root,
				asyncDir,
				resultPath,
				work: { mode: "single", task: fixture.task },
			});
			const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
				state: string;
				results: Array<{ error?: string; turnBudgetExceeded?: boolean }>;
			};
			expect(completion.state).toBe("failed");
			expect(completion.results[0]?.error?.toLowerCase()).toContain(fixture.expected);
			if (fixture.id === "turn-budget-final-line") {
				expect(completion.results[0]?.turnBudgetExceeded).toBe(true);
			}
		}
	});

	test("bounds recent status output by UTF-8 bytes without changing the full result", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "large-recent-output.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const text = "BEGIN-" + "界".repeat(40_000) + "-END";
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-large-recent");
		const resultPath = path.join(asyncDir, "result.json");
		await runConfiguredBackground({
			version: 2,
			id: "large-recent",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{ output: string }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steps: Array<{ recentOutput?: string[] }>;
		};
		const recent = (status.steps[0]?.recentOutput ?? []).join("\n");
		expect(Buffer.byteLength(recent, "utf8")).toBeLessThanOrEqual(64 * 1024);
		expect(recent).not.toContain("�");
		expect(completion.results[0]?.output).toStartWith("BEGIN-");
		expect(completion.results[0]?.output).toEndWith("-END");
	});

	test("fairly bounds multi-Agent result projections while preserving full output artifacts", async () => {
		const root = fixtureRoot();
		process.env.PI_SUBAGENT_TASK_RESULT_MAX_BYTES = "1024";
		process.env.PI_SUBAGENT_RUN_RESULT_MAX_BYTES = "2048";
		const writer = path.join(root, "bounded-run-results.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const index = process.env.PI_SUBAGENT_CHILD_INDEX ?? "unknown";
const text = "BEGIN-" + index + "-" + "界".repeat(2_000) + "-END-" + index;
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-bounded-run-results");
		const resultPath = path.join(asyncDir, "result.json");
		await runConfiguredBackground({
			version: 2,
			id: "bounded-run-results",
			cwd: root,
			asyncDir,
			resultPath,
			work: {
				mode: "parallel",
				group: {
					tasks: Array.from({ length: 4 }, (_, index) => ({ ...task(index), cwd: root })),
					concurrency: 4,
					worktree: false,
				},
			},
		});
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			results: Array<{ output: string }>;
		};
		const totalBytes = completion.results.reduce((sum, result) => sum + Buffer.byteLength(result.output, "utf8"), 0);
		expect(totalBytes).toBeLessThanOrEqual(2048);
		for (const [index, result] of completion.results.entries()) {
			expect(Buffer.byteLength(result.output, "utf8")).toBeGreaterThan(0);
			expect(result.output).toContain("output truncated");
			expect(result.output).not.toContain("�");
			const fullOutput = fs.readFileSync(path.join(asyncDir, `output-${String(index)}.log`), "utf8");
			expect(fullOutput).toStartWith(`BEGIN-${String(index)}-`);
			expect(fullOutput).toEndWith(`-END-${String(index)}`);
			expect(Buffer.byteLength(fullOutput, "utf8")).toBeGreaterThan(Buffer.byteLength(result.output, "utf8"));
		}
	}, 5_000);

	test("hard-kills a writer that ignores protocol-limit termination", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "protocol-limit-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
process.on("SIGTERM", () => {});
process.stdout.write("x".repeat(17 * 1024 * 1024));
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "protocol-limit-hard-kill",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: task(0) },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{
				error?: string;
				success: boolean;
				writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
			}>;
		};

		expect(completion).toMatchObject({
			state: "failed",
			success: false,
			results: [
				{
					error: expect.stringContaining("protocol_output_limit"),
					success: false,
					writerProcesses: [{ exitCode: null, signal: "SIGKILL" }],
				},
			],
		});
	}, 7_000);

	test("keeps a steered writer alive when new input follows a valid terminal report", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "steered-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const assistant = (text) => ({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
});
const user = (text) => ({
  type: "message_end",
  message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
});
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
process.on("SIGTERM", () => process.exit(143));
emit(assistant("VALID_COMPLETED_REVIEW"));
setTimeout(() => emit(user("Late correlated steering input")), 25);
setTimeout(() => emit(assistant("VALID_COMPLETED_REVIEW_AFTER_STEERING")), 1_200);
setTimeout(() => process.exit(0), 1_225);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "steered-terminal-report",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: task(0) },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{ exitCode: number | null; output: string; success: boolean }>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					output: "VALID_COMPLETED_REVIEW_AFTER_STEERING",
					success: true,
				},
			],
		});
	}, 5_000);

	test("cancels an armed hard drain when steering arrives after the internal signal", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "late-steered-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const assistant = (text) => ({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
});
const user = (text) => ({
  type: "message_end",
  message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
});
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
let resumed = false;
process.on("SIGTERM", () => {
  if (resumed) return;
  resumed = true;
  emit(user("Steering delivered after the internal final-drain signal"));
  setTimeout(() => {
    emit(assistant("VALID_COMPLETED_REVIEW_AFTER_LATE_STEERING"));
    process.exit(0);
  }, 3_500);
});
emit(assistant("EARLY_TERMINAL_REPORT"));
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "late-steering-cancels-hard-drain",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: task(0) },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{ exitCode: number | null; output: string; success: boolean }>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					output: "VALID_COMPLETED_REVIEW_AFTER_LATE_STEERING",
					success: true,
				},
			],
		});
	}, 6_000);

	test("real steering routing revokes an armed final drain before the child emits another event", async () => {
		const root = fixtureRoot();
		const termMarker = path.join(root, "manager-term-observed");
		const writer = path.join(root, "routed-steering-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(termMarker)}, "term"));
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_ROUTED_STEERING" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.exit(0), 4_500);
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "real-steering-revokes-final-drain",
			parentRunOrigin: "automatic",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		const running = runConfiguredBackground(config);
		await waitForFile(termMarker);
		requestAsyncSteer(asyncDir, {
			id: "late-real-steer",
			message: "Continue with the routed follow-up.",
			parentRunOrigin: "user",
			source: "test",
			targetIndex: 0,
		});
		await running;
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			parentRunOrigin?: string;
			state: string;
			success: boolean;
			results: Array<{
				exitCode: number | null;
				success: boolean;
				writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
			}>;
		};

		expect(completion).toMatchObject({
			parentRunOrigin: "user",
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					success: true,
					writerProcesses: [{ exitCode: 0, signal: null }],
				},
			],
		});
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			parentRunOrigin: "user",
		});
	}, 7_000);

	test("retains an acknowledgement that becomes visible before its source steering request", async () => {
		const root = fixtureRoot();
		const readyMarker = path.join(root, "ack-before-source-ready");
		const releaseMarker = path.join(root, "ack-before-source-release");
		const writer = path.join(root, "ack-before-source-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(releaseMarker)})) return;
  clearInterval(timer);
  const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ACK_ORDER_OK" }], stopReason: "stop", timestamp: Date.now() } };
  process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
}, 20);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-ack-before-source");
		const resultPath = path.join(asyncDir, "result.json");
		const requestId = "ack-visible-first";
		const running = runConfiguredBackground({
			version: 2,
			id: "ack-before-source",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		await waitForFile(readyMarker);
		writeSteerAck(asyncDir, {
			index: 0,
			message: "accepted before source recovery",
			requestId,
			state: "delivered",
			ts: Date.now(),
		});
		await waitForCondition(
			() => fs.readdirSync(steerAcksDir(asyncDir, 0)).some((entry) => entry.includes(".pi-stuff-inflight.")),
			"the unmatched steering acknowledgement to retain its durable claim",
		);
		expect(fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf8")).not.toContain("subagent.steer.delivered");

		requestAsyncSteer(asyncDir, {
			id: requestId,
			message: "Restore and correlate this steering request.",
			source: "test",
			targetIndex: 0,
		});
		await waitForCondition(() => {
			try {
				const persisted = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
					steering?: { recent?: Array<{ id?: string; targets?: Array<{ state?: string }> }> };
				};
				return persisted.steering?.recent?.find(({ id }) => id === requestId)?.targets?.[0]?.state === "delivered";
			} catch {
				return false;
			}
		}, "the retained acknowledgement to correlate with its restored source");
		fs.writeFileSync(releaseMarker, "release");
		await running;

		expect(fs.readdirSync(steerAcksDir(asyncDir, 0))).toHaveLength(0);
		const events = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf8");
		expect(events.match(/subagent\.steer\.delivered/g)).toHaveLength(1);
	}, 7_000);

	test("replays a steering source after one status-write failure without routing twice", async () => {
		const root = fixtureRoot();
		const readyMarker = path.join(root, "steer-retry-ready");
		const releaseMarker = path.join(root, "steer-retry-release");
		const writer = path.join(root, "steer-retry-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(releaseMarker)})) return;
  clearInterval(timer);
  const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "STEER_RETRY_OK" }], stopReason: "stop", timestamp: Date.now() } };
  process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
}, 20);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-steer-retry");
		const resultPath = path.join(asyncDir, "result.json");
		const statusPath = path.join(asyncDir, "status.json");
		const requestId = "source-status-retry";
		const running = runConfiguredBackground({
			version: 2,
			id: "steer-source-retry",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		await waitForFile(readyMarker);
		fs.rmSync(statusPath, { force: true });
		fs.mkdirSync(statusPath);
		requestAsyncSteer(asyncDir, {
			id: requestId,
			message: "Route exactly once across a transient status failure.",
			source: "test",
			targetIndex: 0,
		});
		await waitForDirectoryEntry(stepSteerInboxDir(asyncDir, 0));
		await waitForCondition(
			() => fs.readdirSync(steerRequestsDir(asyncDir)).some((entry) => entry.includes(".pi-stuff-inflight.")),
			"the steering source claim to remain in flight",
		);

		fs.rmSync(statusPath, { recursive: true, force: true });
		await waitForCondition(() => {
			try {
				const persisted = JSON.parse(fs.readFileSync(statusPath, "utf8")) as {
					steering?: { recent?: Array<{ id?: string }> };
				};
				return persisted.steering?.recent?.some(({ id }) => id === requestId) === true;
			} catch {
				return false;
			}
		}, "the replayed steering status write");
		expect(fs.readdirSync(stepSteerInboxDir(asyncDir, 0)).filter((entry) => entry.endsWith(".json"))).toHaveLength(1);
		expect(fs.readdirSync(steerRequestsDir(asyncDir))).toHaveLength(0);

		writeSteerAck(asyncDir, {
			index: 0,
			message: "accepted after source retry",
			requestId,
			state: "delivered",
			ts: Date.now(),
		});
		await waitForCondition(() => fs.readdirSync(steerAcksDir(asyncDir, 0)).length === 0, "steering ack completion");
		fs.writeFileSync(releaseMarker, "release");
		await running;

		const events = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf8");
		expect(events.match(/subagent\.steer\.routed/g)).toHaveLength(1);
		expect(events.match(/subagent\.steer\.delivered/g)).toHaveLength(1);
	}, 8_000);

	test("keeps multi-target steering and final result authoritative when control status persistence fails", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "steering-persistence-writer.ts");
		const releaseMarker = path.join(root, "release-steering-writers");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
const index = process.env.PI_SUBAGENT_CHILD_INDEX;
fs.writeFileSync(${JSON.stringify(path.join(root, "ready-"))} + index, "ready");
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(releaseMarker)})) return;
  clearInterval(timer);
  const event = {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "STEERING_STATUS_DEGRADED_" + index }],
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
  process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
}, 20);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async-steering-persistence");
		const resultPath = path.join(asyncDir, "result.json");
		const statusPath = path.join(asyncDir, "status.json");
		const requestId = "multi-target-persistence";
		const running = runConfiguredBackground(
			{
				version: 2,
				id: "steering-persistence",
				cwd: root,
				asyncDir,
				resultPath,
				work: {
					mode: "parallel",
					group: {
						tasks: [
							{ ...task(0), cwd: root },
							{ ...task(1), cwd: root },
						],
						concurrency: 2,
						worktree: false,
					},
				},
			},
			{
				beforeFinalPersistence: () => {
					writeSteerAck(asyncDir, {
						index: 0,
						message: "first delivered",
						requestId,
						state: "delivered",
						ts: Date.now(),
					});
					writeSteerAck(asyncDir, {
						index: 1,
						message: "second delivered",
						requestId,
						state: "delivered",
						ts: Date.now() + 1,
					});
					fs.mkdirSync(steerInboxClosedPath(asyncDir));
				},
			},
		);

		await Promise.all([waitForFile(path.join(root, "ready-0")), waitForFile(path.join(root, "ready-1"))]);
		fs.rmSync(statusPath, { force: true });
		fs.mkdirSync(statusPath);
		requestAsyncSteer(asyncDir, {
			id: requestId,
			message: "Apply this to both running Agents.",
			source: "test",
			targetIndexes: [0, 1],
		});
		await Promise.all([
			waitForDirectoryEntry(stepSteerInboxDir(asyncDir, 0)),
			waitForDirectoryEntry(stepSteerInboxDir(asyncDir, 1)),
		]);
		fs.writeFileSync(releaseMarker, "release");
		await running;

		expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toMatchObject({
			state: "complete",
			success: true,
			results: [{ success: true }, { success: true }],
		});
		const events = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf8");
		expect(events.match(/subagent\.steer\.routed/g)).toHaveLength(2);
		expect(events.match(/subagent\.steer\.delivered/g)).toHaveLength(2);
		expect(fs.statSync(statusPath).isDirectory()).toBe(true);
	}, 7_000);

	test("preserves the first stop cause and rejects steering while a child is terminating", async () => {
		const root = fixtureRoot();
		const readyMarker = path.join(root, "stop-race-ready");
		const writer = path.join(root, "stop-race-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
let stopping = false;
process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  process.stdout.write("x".repeat(17 * 1024 * 1024), () => process.exit(0));
});
setInterval(() => {}, 1_000);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "stop-cause-wins-race",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		};

		const running = runConfiguredBackground(config);
		await waitForFile(readyMarker);
		requestAsyncStop(asyncDir, { source: "test", targetIndex: 0 });
		requestAsyncSteer(asyncDir, {
			id: "steer-after-stop",
			message: "This must not revive a terminating child.",
			source: "test",
			targetIndex: 0,
		});
		await running;
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; stopped?: boolean }>;
		};
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			steering?: { recent?: Array<{ targets?: Array<{ state?: string; reason?: string }> }> };
		};

		expect(completion).toMatchObject({
			state: "stopped",
			results: [{ error: "Agent stopped by user.", stopped: true }],
		});
		expect(status.steering?.recent?.[0]?.targets?.[0]).toMatchObject({
			state: "failed",
			reason: "Agent is stopped.",
		});
	}, 7_000);
});
