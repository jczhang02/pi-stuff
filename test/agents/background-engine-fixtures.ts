import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";
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
	waitForStartupControl,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/subagent-runner.js";
import {
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/writer-process-registry.js";
import { projectForegroundCompletion } from "../../packages/pi-stuff/src/subagents/src/runs/foreground/execution.js";
import { resolveBunRuntimeCommand } from "../../packages/pi-stuff/src/subagents/src/runs/shared/bun-runtime.js";
import { CHILD_MODEL_CONTEXT_ENTRY_TYPE } from "../../packages/pi-stuff/src/subagents/src/runs/shared/child-protocol.js";
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
const originalPiBinary = process.env["PI_SUBAGENT_PI_BINARY"];
const originalChildProtocolMaxBytes = process.env["PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES"];
const originalTaskResultMaxBytes = process.env["PI_SUBAGENT_TASK_RESULT_MAX_BYTES"];
const originalRunResultMaxBytes = process.env["PI_SUBAGENT_RUN_RESULT_MAX_BYTES"];
const originalTmpDir = process.env["TMPDIR"];
const originalTmp = process.env["TMP"];
const originalTemp = process.env["TEMP"];
const WRITER_REGISTRY_SCHEMA = Type.Object(
	{
		writers: Type.Optional(
			Type.Record(
				Type.String(),
				Type.Object({ state: Type.Optional(Type.String()) }, { additionalProperties: true }),
			),
		),
	},
	{ additionalProperties: true },
);
const PROCESS_TERMINAL_CANDIDATE_SCHEMA = Type.Object(
	{
		expectedWriters: Type.Optional(Type.Record(Type.String(), Type.Number())),
		writers: Type.Optional(Type.Record(Type.String(), Type.Array(Type.Unknown()))),
	},
	{ additionalProperties: true },
);
const TRANSCRIPT_RECORD_SCHEMA = Type.Object(
	{
		customType: Type.Optional(Type.String()),
		recordType: Type.Optional(Type.String()),
		role: Type.Optional(Type.String()),
		text: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

function readFixtureJson<Schema extends TSchema>(filePath: string, schema: Schema): Static<Schema> {
	const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
	if (!Check(schema, value)) throw new Error(`Expected a valid fixture document at ${filePath}`);
	return value;
}

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
	process.env["TMPDIR"] = root;
	process.env["TMP"] = root;
	process.env["TEMP"] = root;
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
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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

export function task(index: number): RunnerAgentTask {
	return {
		agent: `agent-${index}`,
		task: `task-${index}`,
		cwd: "/tmp",
		inheritProjectContext: true,
		inheritSkills: false,
	};
}

export type { BackgroundRunnerConfig, RunnerAgentTask };
export {
	ASYNC_DIR,
	acquireRunnerProcessStartIdentity,
	agent,
	buildAsyncParallelRunnerWork,
	buildAsyncSingleRunnerWork,
	buildContext,
	buildNestedTerminalFallbackStatus,
	buildWriterProcessEnv,
	buildWriterSpawnCommand,
	CHILD_MODEL_CONTEXT_ENTRY_TYPE,
	Check,
	captureWriterProcessStartIdentity,
	claimBackgroundRunDirectory,
	cleanupBackgroundRunAfterAbort,
	createBackgroundCompletion,
	createHash,
	createInitialStatus,
	createNestedRoute,
	fallbackSessionKeyForTest,
	fallbackShardForTest,
	finalizeProcessTerminal,
	finalizeSpawnedRunnerClose,
	fixtureRoot,
	fs,
	initializePreIdentityWriterAbsenceProof,
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
	isolatedSystemTempRoot,
	listAsyncRuns,
	nestedFallbackConfig,
	PROCESS_TERMINAL_CANDIDATE_SCHEMA,
	path,
	pathToFileURL,
	projectAgentDefinition,
	projectForegroundCompletion,
	projectLaunchBinding,
	randomUUID,
	readAsyncRecoveryDescriptor,
	readFixtureJson,
	reconcileAsyncRun,
	removeRunnerStartupMarkerBestEffort,
	requestAsyncSteer,
	requestAsyncStop,
	resolveAsyncRunnerBunCommand,
	resolveBackgroundOwnershipFailure,
	resolveBunRuntimeCommand,
	resolveNestedTerminalStatus,
	runBackgroundWork,
	runConfiguredBackground,
	shardedDurableClaimName,
	spawn,
	steerAcksDir,
	steerInboxClosedPath,
	steerRequestsDir,
	stepSteerInboxDir,
	TRANSCRIPT_RECORD_SCHEMA,
	temporaryDirectories,
	terminateRunnerBeforeProceed,
	tryAcquireKernelClaim,
	WRITER_REGISTRY_SCHEMA,
	waitForCondition,
	waitForDirectoryEntry,
	waitForFile,
	waitForFileText,
	waitForStartupControl,
	writeNestedEvent,
	writeProcessTerminalCandidate,
	writeSteerAck,
};

export function cleanupBackgroundEngineFixtures(): void {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
	if (originalPiBinary === undefined) delete process.env["PI_SUBAGENT_PI_BINARY"];
	else process.env["PI_SUBAGENT_PI_BINARY"] = originalPiBinary;
	if (originalChildProtocolMaxBytes === undefined) delete process.env["PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES"];
	else process.env["PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES"] = originalChildProtocolMaxBytes;
	if (originalTaskResultMaxBytes === undefined) delete process.env["PI_SUBAGENT_TASK_RESULT_MAX_BYTES"];
	else process.env["PI_SUBAGENT_TASK_RESULT_MAX_BYTES"] = originalTaskResultMaxBytes;
	if (originalRunResultMaxBytes === undefined) delete process.env["PI_SUBAGENT_RUN_RESULT_MAX_BYTES"];
	else process.env["PI_SUBAGENT_RUN_RESULT_MAX_BYTES"] = originalRunResultMaxBytes;
	if (originalTmpDir === undefined) delete process.env["TMPDIR"];
	else process.env["TMPDIR"] = originalTmpDir;
	if (originalTmp === undefined) delete process.env["TMP"];
	else process.env["TMP"] = originalTmp;
	if (originalTemp === undefined) delete process.env["TEMP"];
	else process.env["TEMP"] = originalTemp;
}
