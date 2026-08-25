/** Detached runner for one Agent or one parallel Agent batch. */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import { normalizePonytailMode, PONYTAIL_CHILD_MODE_ENV } from "../../../../ponytail/types.js";
import { type JsonObject, type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import {
	isRuntimeBoolean,
	isRuntimeFunction,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import {
	appendArtifactJsonl,
	appendJsonl,
	formatOutputArtifactContent,
	getArtifactPaths,
	withArtifactGroupWriteClaim,
} from "../../shared/artifacts.ts";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { type ChildTranscriptWriter, createChildTranscriptWriter } from "../../shared/child-transcript.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { type DurableClaim, shardedDurableClaimName, tryAcquireKernelClaim } from "../../shared/durable-claim.ts";
import { attachPostExitStdioGuard, trySignalChild } from "../../shared/post-exit-stdio-guard.ts";
import { ensurePrivateDirectory, readBoundedOwnedFile } from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import {
	type ArtifactPaths,
	type CostSummary,
	getSubagentDepthEnv,
	type ModelAttempt,
	type ProtocolOutputLimit,
	type SteeringTargetState,
	type SteeringTargetStatus,
	SUBAGENT_ASYNC_STATUS_EVENT,
	type TokenUsage,
	type ToolBudgetState,
	type TurnBudgetState,
	type Usage,
} from "../../shared/types.ts";
import {
	detectSubagentError,
	extractTextFromContent,
	extractToolArgsPreview,
	getFinalOutput,
} from "../../shared/utils.ts";
import { resolveBunRuntimeCommand } from "../shared/bun-runtime.ts";
import {
	type ChildProtocolEvent,
	type ChildProtocolMessage,
	createBoundedByteTail,
	createBoundedLineReader,
	formatProtocolOutputLimit,
	MAX_CHILD_STDERR_BYTES,
	parseChildProtocolEvent,
	projectChildLifecycle,
} from "../shared/child-protocol.ts";
import {
	assertModelCandidateLimit,
	formatModelAttemptNote,
	isRetryableModelFailure,
} from "../shared/model-fallback.ts";
import {
	attachRootChildrenToSteps,
	finalizeNestedRouteRoot,
	nestedSummaryFromAsyncStatus,
	nestedWorkIncludesUser,
	projectNestedEvents,
	projectNestedEventsAuthoritatively,
	resolveNestedAsyncDir,
	writeNestedEvent,
} from "../shared/nested-events.ts";
import {
	type BackgroundRunnerConfig,
	type BackgroundRunnerWork,
	type BackgroundTaskResult,
	MAX_BACKGROUND_TASKS,
	mapConcurrent,
	type RunnerAgentTask,
} from "../shared/parallel-utils.ts";
import { buildPiArgs, cleanupTempDir } from "../shared/pi-args.ts";
import { getPiSpawnCommand, type PiSpawnDeps } from "../shared/pi-spawn.ts";
import { acquireSessionLease } from "../shared/session-lease.ts";
import { readChildToolDiagnosticError } from "../shared/tool-availability.ts";
import { toolBudgetState } from "../shared/tool-budget.ts";
import {
	appendTurnBudgetSystemPrompt,
	initialTurnBudgetState,
	turnBudgetDecision,
	turnBudgetState,
} from "../shared/turn-budget.ts";
import {
	cleanupWorktrees,
	createWorktrees,
	diffWorktrees,
	formatWorktreeDiffSummary,
	type WorktreeSetup,
} from "../shared/worktree.ts";
import {
	closeSteerInbox,
	deliverInterruptRequest,
	deliverStopRequest,
	deliverTimeoutRequest,
	enqueueStepSteer,
	processSteerAcks,
	processSteerRequestsFromDir,
	type SteerAck,
	type SteerRequest,
	steerAcksDir,
	steerCapabilityPath,
	steerRequestsDir,
	stepSteerInboxDir,
	watchAsyncControlInbox,
} from "./control-channel.ts";
import {
	createInitialStatus,
	type BackgroundRunnerStatus as RunnerStatus,
	type BackgroundRunnerStatusStep as RunnerStatusStep,
} from "./initial-status.ts";
import {
	markProcessTerminalCandidateLeaseRelease,
	type ProcessTerminalCandidate,
	writeProcessTerminalCandidate,
} from "./process-terminal.ts";
import {
	findSteeringRequest,
	MAX_PENDING_STEERING_REQUESTS,
	pendingSteeringRequestCount,
	recordSteeringRequest,
	steeringStatus,
	updateSteeringTarget,
} from "./steering.ts";
import {
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
	reapOrphanWriterProcesses,
	updateWriterProcessRegistry,
	type WriterRuntimeState,
} from "./writer-process-registry.ts";

export { createInitialStatus } from "./initial-status.ts";

type ChildMessage = ChildProtocolMessage;

type ChildEvent = ChildProtocolEvent;

interface WriterSupervisorEnvelope {
	command: string;
	args: string[];
	parentPid: number;
	parentStarted: string;
	dispositionPath?: string;
	groupMemberProofPath?: string;
	controlPath?: string;
	controlToken?: string;
}

interface ChildCompletedDiagnosticEvent {
	type: "subagent.child.completed";
	ts: number;
	runId: string;
	index: number;
	agent: string;
	success: boolean;
	error?: string;
}

interface ChildProcessResult {
	exitCode: number | null;
	signal: string | null;
	stderr: string;
	messages: ChildMessage[];
	output: string;
	error?: string;
	protocolError?: ProtocolOutputLimit;
	usage: Usage;
	toolCount: number;
	durationMs: number;
	model?: string;
	interrupted?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	turnBudget?: TurnBudgetState;
	turnBudgetExceeded?: boolean;
	contextNudgeObserved?: boolean;
	process?: WriterProcess;
}

type WriterProcess = NonNullable<BackgroundTaskResult["writerProcesses"]>[number];

export function buildWriterSpawnCommand(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
	dispositionPath?: string,
	groupMemberProofPath?: string,
	writerSupervisorRuntime = resolveBunRuntimeCommand(),
	control?: { readonly path: string; readonly token: string },
) {
	if (platform === "win32") return { command, args: [...args], gated: false };
	const parentStarted = readProcessStartIdentity(process.pid);
	if (!parentStarted) throw new Error("Agent writer supervisor requires a stable runner process identity.");
	if (!writerSupervisorRuntime) {
		throw new Error("Bun is required to launch the Agent writer supervisor, but no executable was found.");
	}
	const supervisor = path.join(path.dirname(fileURLToPath(import.meta.url)), "writer-process-supervisor.mjs");
	const supervisorEnvelope: WriterSupervisorEnvelope = {
		command,
		args: [...args],
		parentPid: process.pid,
		parentStarted,
		dispositionPath,
		groupMemberProofPath,
	};
	if (control) {
		supervisorEnvelope.controlPath = control.path;
		supervisorEnvelope.controlToken = control.token;
	}
	const envelope = Buffer.from(JSON.stringify(supervisorEnvelope), "utf-8").toString("base64url");
	return {
		command: writerSupervisorRuntime,
		args: [supervisor, envelope],
		gated: true,
	};
}

interface WriterSupervisorDisposition {
	version: 1;
	supervisorPid: number;
	supervisorProcessStartIdentity: string;
	childPid: number;
	childProcessStartIdentity: string;
	exitCode: number | null;
	signal: string | null;
	origin: "external" | "manager-final-drain" | "manager-request" | null;
	reaped: boolean;
	outputForwardingError?: string;
}

function readWriterSupervisorDisposition(
	filePath: string,
	supervisorPid: number | undefined,
	supervisorProcessStartIdentity: string | undefined,
): WriterSupervisorDisposition | undefined {
	if (supervisorPid === undefined || !supervisorProcessStartIdentity) return undefined;
	try {
		const value = parseJsonValue(readBoundedOwnedFile(filePath, 8 * 1024));
		if (
			!isRuntimeObject(value) ||
			value === null ||
			Array.isArray(value) ||
			value.version !== 1 ||
			value.supervisorPid !== supervisorPid ||
			value.supervisorProcessStartIdentity !== supervisorProcessStartIdentity ||
			!isRuntimeNumber(value.childPid) ||
			!Number.isSafeInteger(value.childPid) ||
			!isRuntimeString(value.childProcessStartIdentity) ||
			!value.childProcessStartIdentity ||
			(!isRuntimeNumber(value.exitCode) && value.exitCode !== null) ||
			(!isRuntimeString(value.signal) && value.signal !== null) ||
			(value.origin !== null &&
				value.origin !== "external" &&
				value.origin !== "manager-final-drain" &&
				value.origin !== "manager-request") ||
			!isRuntimeBoolean(value.reaped) ||
			(value.outputForwardingError !== undefined &&
				(!isRuntimeString(value.outputForwardingError) || value.outputForwardingError.length > 1_000))
		)
			return undefined;
		const disposition: WriterSupervisorDisposition = {
			version: 1,
			supervisorPid,
			supervisorProcessStartIdentity,
			childPid: value.childPid,
			childProcessStartIdentity: value.childProcessStartIdentity,
			exitCode: value.exitCode,
			signal: value.signal,
			origin: value.origin,
			reaped: value.reaped,
		};
		if (value.outputForwardingError !== undefined) {
			disposition.outputForwardingError = value.outputForwardingError;
		}
		return disposition;
	} catch {
		return undefined;
	}
}

function writerProcessGroupAlive(pid: number): boolean | undefined {
	if (process.platform === "win32") return false;
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		const code = errorCode(error);
		if (code === "ESRCH") return false;
		return undefined;
	}
}

function ownedWriterProcessGroupAlive(pid: number, expectedProcessStartIdentity?: string): boolean | undefined {
	const groupState = writerProcessGroupAlive(pid);
	if (groupState !== true) return groupState;
	if (!expectedProcessStartIdentity) return undefined;
	const currentIdentity = readProcessStartIdentity(pid);
	if (currentIdentity) return currentIdentity === expectedProcessStartIdentity;
	return undefined;
}

export async function captureWriterProcessStartIdentity(
	pid: number,
	options: {
		readonly read?: (pid: number) => string | undefined;
		readonly timeoutMs?: number;
		readonly intervalMs?: number;
	} = {},
): Promise<string | undefined> {
	const read = options.read ?? readProcessStartIdentity;
	const deadline = Date.now() + (options.timeoutMs ?? 250);
	do {
		const identity = read(pid);
		if (identity) return identity;
		try {
			process.kill(pid, 0);
		} catch (error) {
			if (errorCode(error) !== "EPERM") return undefined;
		}
		if (Date.now() >= deadline) return undefined;
		await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs ?? 20));
	} while (Date.now() <= deadline);
	return undefined;
}

async function closeWriterProcessGroup(pid: number, expectedProcessStartIdentity?: string): Promise<boolean> {
	if (process.platform === "win32") return true;
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		const state = ownedWriterProcessGroupAlive(pid, expectedProcessStartIdentity);
		if (state === false) return true;
		if (state === undefined) return false;
		try {
			process.kill(-pid, signal);
		} catch (error) {
			if (errorCode(error) === "ESRCH") return true;
			return false;
		}
		const deadline = Date.now() + 500;
		while (Date.now() < deadline) {
			if (ownedWriterProcessGroupAlive(pid, expectedProcessStartIdentity) === false) return true;
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
		}
	}
	return ownedWriterProcessGroupAlive(pid, expectedProcessStartIdentity) === false;
}

interface ChildRuntimeControl {
	state: "running" | "paused" | "timed-out" | "stopped" | "failed";
	interrupt(kind: "pause" | "timeout" | "stop"): void;
	revokeFinalization(): void;
}

interface RunBackgroundWorkOptions {
	signal?: AbortSignal;
}

interface BackgroundCompletion {
	id: string;
	runId: string;
	parentRunOrigin?: AgentWorkOrigin;
	sessionId?: string | null;
	mode: "single" | "parallel";
	state: "complete" | "failed" | "stopped" | "paused";
	success: boolean;
	stopped?: boolean;
	timedOut?: boolean;
	interrupted?: boolean;
	summary: string;
	results: BackgroundTaskResult[];
	cwd: string;
	asyncDir: string;
	startedAt: number;
	endedAt: number;
	sessionFile?: string;
	nestedChildren?: import("../../shared/types.ts").NestedRunSummary[];
	worktree?: {
		diffs: ReturnType<typeof diffWorktrees>;
		summary: string;
		cleanup: ReturnType<typeof cleanupWorktrees>;
		error?: string;
	};
}

const ASYNC_INTERRUPT_SIGNAL: NodeJS.Signals = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";
const DEFAULT_MAX_ASYNC_EVENTS_BYTES = 4 * 1024 * 1024;
const ASYNC_EVENTS_MAX_BYTES_ENV = "PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES";
const DEFAULT_MAX_CHILD_PROTOCOL_BYTES = 32 * 1024 * 1024;
const CHILD_PROTOCOL_MAX_BYTES_ENV = "PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES";
const MAX_RECENT_OUTPUT_BYTES = 64 * 1024;
const MAX_RECENT_OUTPUT_LINES = 50;
const DEFAULT_MAX_TASK_RESULT_BYTES = 256 * 1024;
const TASK_RESULT_MAX_BYTES_ENV = "PI_SUBAGENT_TASK_RESULT_MAX_BYTES";
const DEFAULT_MAX_RUN_RESULT_BYTES = 1024 * 1024;
const RUN_RESULT_MAX_BYTES_ENV = "PI_SUBAGENT_RUN_RESULT_MAX_BYTES";
const MAX_RESULT_ERROR_BYTES = 32 * 1024;
const MAX_MODEL_ATTEMPT_ERROR_BYTES = 8 * 1024;
const FALLBACK_SNAPSHOT_DIRECTORY = ".pi-stuff-fallback-snapshots";
const FALLBACK_RESTORE_DIRECTORY = ".pi-stuff-fallback-restores";
const FALLBACK_LIFECYCLE_DIRECTORY = ".pi-stuff-fallback-lifecycle";
const FALLBACK_SWEEP_CURSOR_FILE = ".fallback-orphan-cursor";
const FALLBACK_SWEEP_TEMPORARY_FILE = ".fallback-orphan-cursor.tmp";
const FALLBACK_CLAIM_ATTEMPTS = 200;
const FALLBACK_CLAIM_WAIT_MS = 5;
const FALLBACK_ORPHAN_GRACE_MS = 60 * 60 * 1_000;
const FALLBACK_ORPHANS_PER_SWEEP = 64;
const LINUX_O_TMPFILE = 0o20000000;
const O_NOFOLLOW =
	"O_NOFOLLOW" in fs.constants && isRuntimeNumber(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
const RESULT_TRUNCATION_MARKER = "\n[output truncated; full text remains in the Agent transcript/output artifact]\n";
const BACKGROUND_RUNNER_SENTINEL_ENV = "PI_STUFF_BACKGROUND_RUNNER";
const BACKGROUND_RUNNER_CONFIG_ENV = "PI_STUFF_BACKGROUND_RUNNER_CONFIG";

function errorCode<Value>(cause: Value): string | undefined {
	return isRuntimeObject(cause) && cause !== null && "code" in cause ? String(cause.code) : undefined;
}

/** Runner identity must never leak into a Pi writer process. */
export function ponytailWriterEnvironmentOverrides(mode: BackgroundRunnerConfig["ponytailMode"]) {
	return { [PONYTAIL_CHILD_MODE_ENV]: mode };
}

export function buildWriterProcessEnv(
	parentEnv: NodeJS.ProcessEnv,
	overrides: Record<string, string | undefined>,
	maxSubagentDepth?: number,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...parentEnv,
		...overrides,
		...getSubagentDepthEnv(maxSubagentDepth, parentEnv),
	};
	for (const [name, value] of Object.entries(overrides)) {
		if (value === undefined) delete env[name];
	}
	delete env[BACKGROUND_RUNNER_SENTINEL_ENV];
	delete env[BACKGROUND_RUNNER_CONFIG_ENV];
	return env;
}

function maxAsyncEventsBytes(): number {
	const parsed = Number(process.env[ASYNC_EVENTS_MAX_BYTES_ENV]);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_MAX_ASYNC_EVENTS_BYTES;
}

function maxChildProtocolBytes(): number {
	const parsed = Number(process.env[CHILD_PROTOCOL_MAX_BYTES_ENV]);
	return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MAX_CHILD_PROTOCOL_BYTES;
}

function positiveByteLimit(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function utf8Tail(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value, "utf-8");
	if (bytes.length <= maxBytes) return value;
	let start = bytes.length - maxBytes;
	while (start < bytes.length && (bytes[start] ?? 0) >> 6 === 2) start++;
	return bytes.subarray(start).toString("utf-8");
}

function utf8Head(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value, "utf-8");
	if (bytes.length <= maxBytes) return value;
	let end = maxBytes;
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
	return bytes.subarray(0, end).toString("utf-8");
}

function boundResultText(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf-8") <= maxBytes) return value;
	const markerBytes = Buffer.byteLength(RESULT_TRUNCATION_MARKER, "utf-8");
	if (maxBytes <= markerBytes) return utf8Tail(value, maxBytes);
	const payloadBytes = maxBytes - markerBytes;
	const headBytes = Math.floor(payloadBytes / 2);
	const tailBytes = payloadBytes - headBytes;
	return `${utf8Head(value, headBytes)}${RESULT_TRUNCATION_MARKER}${utf8Tail(value, tailBytes)}`;
}

function fairResultBudgets(values: readonly string[], maxBytes: number): number[] {
	const budgets = Array.from({ length: values.length }, () => 0);
	let remaining = maxBytes;
	let unresolved = values.map((_, index) => index);
	while (unresolved.length > 0 && remaining > 0) {
		const share = Math.floor(remaining / unresolved.length);
		if (share <= 0) {
			for (const index of unresolved.slice(0, remaining)) budgets[index] = 1;
			break;
		}
		const fitting = unresolved.filter((index) => Buffer.byteLength(values[index] ?? "", "utf-8") <= share);
		if (fitting.length === 0) {
			for (const [position, index] of unresolved.entries()) {
				budgets[index] = share + (position < remaining % unresolved.length ? 1 : 0);
			}
			break;
		}
		const fittingSet = new Set(fitting);
		for (const index of fitting) {
			const bytes = Buffer.byteLength(values[index] ?? "", "utf-8");
			budgets[index] = bytes;
			remaining -= bytes;
		}
		unresolved = unresolved.filter((index) => !fittingSet.has(index));
	}
	return budgets;
}

function boundRunResultOutputs(results: BackgroundTaskResult[]): BackgroundTaskResult[] {
	const budgets = fairResultBudgets(
		results.map((result) => result.output),
		positiveByteLimit(RUN_RESULT_MAX_BYTES_ENV, DEFAULT_MAX_RUN_RESULT_BYTES),
	);
	return results.map((result, index) => ({
		...result,
		output: boundResultText(result.output, budgets[index] ?? 0),
	}));
}

function appendDiagnosticEvent<Event extends object>(eventsPath: string, event: Event): void {
	try {
		const limit = maxAsyncEventsBytes();
		const line = `${JSON.stringify(event)}\n`;
		const lineBytes = Buffer.byteLength(line, "utf-8");
		if (lineBytes > limit || limit === 0) return;
		let size = 0;
		try {
			const stat = fs.lstatSync(eventsPath);
			if (stat.isSymbolicLink() || !stat.isFile()) return;
			size = stat.size;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") return;
		}
		if (size + lineBytes <= limit) {
			appendJsonl(eventsPath, line.trimEnd());
			return;
		}
		const retainedBudget = Math.max(0, Math.floor(limit / 2) - lineBytes);
		let retained = "";
		if (retainedBudget > 0 && size > 0) {
			const descriptor = fs.openSync(eventsPath, fs.constants.O_RDONLY);
			try {
				const buffer = Buffer.allocUnsafe(Math.min(size, retainedBudget));
				const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
				retained = buffer.subarray(0, bytesRead).toString("utf-8");
				const firstNewline = retained.indexOf("\n");
				if (size > bytesRead) retained = firstNewline >= 0 ? retained.slice(firstNewline + 1) : "";
			} finally {
				fs.closeSync(descriptor);
			}
		}
		const temporary = `${eventsPath}.${process.pid}.${randomUUID()}.tmp`;
		fs.writeFileSync(temporary, `${retained}${line}`, { mode: 0o600, flag: "wx" });
		fs.renameSync(temporary, eventsPath);
	} catch {
		// Diagnostics never determine run success.
	}
}

function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

function finiteUsageNumber<Value>(value: Value): number {
	return isRuntimeNumber(value) && Number.isFinite(value) ? value : 0;
}

function addUsage(target: Usage, message: ChildMessage): void {
	const usage = message.usage;
	target.turns += 1;
	if (!usage || !isRuntimeObject(usage)) return;
	target.input += finiteUsageNumber(usage.input ?? usage.inputTokens);
	target.output += finiteUsageNumber(usage.output ?? usage.outputTokens);
	target.cacheRead += finiteUsageNumber(usage.cacheRead);
	target.cacheWrite += finiteUsageNumber(usage.cacheWrite);
	target.cost += finiteUsageNumber(usage.cost?.total);
}

function tokenUsage(usage: Usage): TokenUsage | undefined {
	const total = usage.input + usage.output;
	return total > 0 ? { input: usage.input, output: usage.output, total } : undefined;
}

function costSummary(attempts: ModelAttempt[]): CostSummary | undefined {
	const inputTokens = attempts.reduce((sum, attempt) => sum + (attempt.usage?.input ?? 0), 0);
	const outputTokens = attempts.reduce((sum, attempt) => sum + (attempt.usage?.output ?? 0), 0);
	const costUsd = attempts.reduce((sum, attempt) => sum + (attempt.usage?.cost ?? 0), 0);
	return inputTokens || outputTokens || costUsd ? { inputTokens, outputTokens, costUsd } : undefined;
}

function assistantStartsToolCall(message: AssistantMessage): boolean {
	return message.content.some((part) => part.type === "toolCall");
}

function terminalAssistantStop(message: AssistantMessage): boolean {
	return message.stopReason === "stop" && !assistantStartsToolCall(message);
}

function findLatestSessionFile(sessionDir: string | undefined): string | undefined {
	if (!sessionDir) return undefined;
	try {
		const files = fs
			.readdirSync(sessionDir)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => path.join(sessionDir, file))
			.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
		return files[0];
	} catch {
		return undefined;
	}
}

function taskList(work: BackgroundRunnerWork): RunnerAgentTask[] {
	return work.mode === "single" ? [work.task] : work.group.tasks;
}

function stoppedResult(
	task: RunnerAgentTask,
	cause: NonNullable<BackgroundTaskResult["preStartTerminalCause"]>,
): BackgroundTaskResult {
	const message = `Agent ${cause === "timeout" ? "timed out" : cause === "pause" ? "paused" : "stopped"} before it started.`;
	const result: BackgroundTaskResult = {
		agent: task.agent,
		output: message,
		success: false,
		exitCode: 1,
		error: message,
		preStartTerminalCause: cause,
	};
	if (cause === "pause") result.interrupted = true;
	else if (cause === "timeout") result.timedOut = true;
	else result.stopped = true;
	if (task.context) result.context = task.context;
	if (task.sessionFile) result.sessionFile = task.sessionFile;
	if (task.model) result.model = task.model;
	if (task.thinking) result.thinking = task.thinking;
	if (task.launchContractDigest) result.launchContractDigest = task.launchContractDigest;
	return result;
}

function failedResult(task: RunnerAgentTask, cause: unknown): BackgroundTaskResult {
	const message = boundResultText(cause instanceof Error ? cause.message : String(cause), MAX_RESULT_ERROR_BYTES);
	const result: BackgroundTaskResult = {
		agent: task.agent,
		output: message,
		success: false,
		exitCode: 1,
		error: message,
	};
	if (task.context) result.context = task.context;
	if (task.sessionFile) result.sessionFile = task.sessionFile;
	if (task.model) result.model = task.model;
	if (task.thinking) result.thinking = task.thinking;
	if (task.launchContractDigest) result.launchContractDigest = task.launchContractDigest;
	return result;
}

function terminalizeRejectedStep(
	status: RunnerStatus,
	statusPath: string,
	eventsPath: string,
	index: number,
	cause: unknown,
): void {
	const step = status.steps[index];
	if (!step) return;
	const endedAt = Date.now();
	const message = boundResultText(cause instanceof Error ? cause.message : String(cause), MAX_RESULT_ERROR_BYTES);
	step.status = "failed";
	step.endedAt = endedAt;
	step.durationMs = Math.max(0, endedAt - (step.startedAt ?? endedAt));
	step.exitCode = 1;
	step.error = message;
	step.currentTool = undefined;
	step.currentToolArgs = undefined;
	step.currentToolStartedAt = undefined;
	step.currentPath = undefined;
	step.activityState = undefined;
	try {
		writeStatus(statusPath, status);
		appendDiagnosticEvent(eventsPath, {
			type: "subagent.child.completed",
			ts: endedAt,
			runId: status.runId,
			index,
			agent: step.agent,
			success: false,
			error: message,
		});
	} catch (persistError) {
		reportAgentDiagnostic(`Failed to persist rejected Agent step ${String(index)}:`, persistError);
	}
}

function applyTerminalResultToStep(step: RunnerStatusStep, result: BackgroundTaskResult, endedAt: number): void {
	step.status = result.interrupted ? "paused" : result.stopped ? "stopped" : result.success ? "complete" : "failed";
	step.endedAt = endedAt;
	step.durationMs = Math.max(0, endedAt - (step.startedAt ?? endedAt));
	step.exitCode = result.exitCode;
	step.error = result.error;
	step.sessionFile = result.sessionFile;
	step.model = result.model;
	step.thinking = result.thinking;
	step.attemptedModels = result.attemptedModels;
	step.modelAttempts = result.modelAttempts;
	step.totalCost = result.totalCost;
	step.timedOut = result.timedOut;
	step.stopped = result.stopped;
	step.turnBudget = result.turnBudget;
	step.turnBudgetExceeded = result.turnBudgetExceeded;
	step.wrapUpRequested = result.wrapUpRequested;
	step.toolBudget = result.toolBudget;
	step.toolBudgetBlocked = result.toolBudgetBlocked;
	step.transcriptPath = result.transcriptPath;
	step.transcriptError = result.transcriptError;
	step.finalOutput = boundResultText(result.output, MAX_RESULT_ERROR_BYTES);
	step.savedOutputPath = result.artifactPaths?.outputPath;
	step.currentTool = undefined;
	step.currentToolArgs = undefined;
	step.currentToolStartedAt = undefined;
	step.currentPath = undefined;
	step.activityState = undefined;
}

function reconcileUnfinishedSteps(
	status: RunnerStatus,
	results: readonly BackgroundTaskResult[],
	eventsPath: string,
	endedAt: number,
): void {
	for (const [index, result] of results.entries()) {
		const step = status.steps[index];
		if (!step || (step.status !== "pending" && step.status !== "running")) continue;
		applyTerminalResultToStep(step, result, endedAt);
		const event: ChildCompletedDiagnosticEvent = {
			type: "subagent.child.completed",
			ts: endedAt,
			runId: status.runId,
			index,
			agent: step.agent,
			success: result.success,
		};
		if (result.error) event.error = result.error;
		appendDiagnosticEvent(eventsPath, event);
	}
}

function failUndeliveredSteering(
	status: RunnerStatus,
	eventsPath: string,
	terminalState: BackgroundCompletion["state"],
	endedAt: number,
): void {
	const projection = steeringStatus(status);
	for (const request of projection.recent) {
		for (const target of request.targets) {
			if (target.state !== "scheduled" && target.state !== "routed") continue;
			const previousState = target.state;
			const reason = `Agent run ended as ${terminalState} before steering was delivered.`;
			updateSteeringTarget(projection, request.id, target.index, "failed", endedAt, { reason });
			appendDiagnosticEvent(eventsPath, {
				type: "subagent.steer.failed",
				ts: endedAt,
				runId: status.runId,
				requestId: request.id,
				index: target.index,
				message: reason,
				previousState,
			});
		}
	}
}

/**
 * Execute the resolved runner shape. This is deliberately small: single runs
 * invoke once; parallel runs are one bounded group and never form a sequence.
 */
export async function runBackgroundWork(
	work: BackgroundRunnerWork,
	runTask: (task: RunnerAgentTask, index: number, signal?: AbortSignal) => Promise<BackgroundTaskResult>,
	options: RunBackgroundWorkOptions = {},
): Promise<BackgroundTaskResult[]> {
	const tasks = taskList(work);
	if (tasks.length > MAX_BACKGROUND_TASKS) {
		throw new RangeError(`Background runner supports at most ${MAX_BACKGROUND_TASKS} tasks per launch.`);
	}
	const executeTask = async (task: RunnerAgentTask, index: number): Promise<BackgroundTaskResult> => {
		if (options.signal?.aborted) {
			const reason = options.signal.reason;
			return stoppedResult(task, reason === "pause" || reason === "timeout" ? reason : "stop");
		}
		try {
			return await runTask(task, index, options.signal);
		} catch (error) {
			return failedResult(task, error);
		}
	};
	if (work.mode === "single") {
		return [await executeTask(work.task, 0)];
	}
	return mapConcurrent(tasks, work.group.concurrency, executeTask);
}

function parallelSummary(results: BackgroundTaskResult[]): string {
	return results
		.map((result, index) => {
			const state = result.success
				? "complete"
				: result.interrupted
					? "paused"
					: result.stopped
						? "stopped"
						: result.timedOut
							? "timed out"
							: "failed";
			return `=== Agent ${index + 1} (${result.agent}) · ${state} ===\n${result.output || result.error || "(no output)"}`;
		})
		.join("\n\n");
}

export function createBackgroundCompletion(
	config: BackgroundRunnerConfig,
	results: BackgroundTaskResult[],
	startedAt: number,
	endedAt: number,
	extras: Pick<BackgroundCompletion, "nestedChildren" | "worktree"> = {},
): BackgroundCompletion {
	const success = results.length > 0 && results.every((result) => result.success);
	const failed = results.some((result) => !result.success && !result.stopped && !result.interrupted);
	const stopped = !failed && results.some((result) => result.stopped);
	const interrupted = !failed && !stopped && results.some((result) => result.interrupted);
	const timedOut = results.some((result) => result.timedOut);
	const state = failed ? "failed" : stopped ? "stopped" : interrupted ? "paused" : success ? "complete" : "failed";
	const summary =
		config.work.mode === "single"
			? results[0]?.output || results[0]?.error || "(no output)"
			: parallelSummary(results);
	const completion: BackgroundCompletion = {
		id: config.id,
		runId: config.id,
		mode: config.work.mode,
		state,
		success,
		summary,
		results,
		cwd: config.cwd,
		asyncDir: config.asyncDir,
		startedAt,
		endedAt,
	};
	if (config.parentRunOrigin) completion.parentRunOrigin = config.parentRunOrigin;
	if (config.sessionId !== undefined) completion.sessionId = config.sessionId;
	if (stopped) completion.stopped = true;
	if (timedOut) completion.timedOut = true;
	if (interrupted) completion.interrupted = true;
	if (results.length === 1 && results[0]?.sessionFile) completion.sessionFile = results[0].sessionFile;
	if (extras.nestedChildren) completion.nestedChildren = extras.nestedChildren;
	if (extras.worktree) completion.worktree = extras.worktree;
	return completion;
}

function updateRunProjection(status: RunnerStatus): void {
	const active = status.steps.filter((step) => step.status === "running");
	status.activityState = active.some((step) => step.activityState === "needs_attention")
		? "needs_attention"
		: active.some((step) => step.activityState === "active_long_running")
			? "active_long_running"
			: undefined;
	status.lastActivityAt = active.reduce((latest, step) => Math.max(latest, step.lastActivityAt ?? 0), 0) || undefined;
	status.currentTool = active.length === 1 ? active[0]?.currentTool : undefined;
	status.currentToolStartedAt = active.length === 1 ? active[0]?.currentToolStartedAt : undefined;
	status.currentPath = active.length === 1 ? active[0]?.currentPath : undefined;
	status.turnCount = status.steps.reduce((sum, step) => sum + (step.turnCount ?? 0), 0);
	status.toolCount = status.steps.reduce((sum, step) => sum + (step.toolCount ?? 0), 0);
	const totals = status.steps.reduce(
		(acc, step) => {
			acc.input += step.tokens?.input ?? 0;
			acc.output += step.tokens?.output ?? 0;
			acc.total += step.tokens?.total ?? 0;
			return acc;
		},
		{ input: 0, output: 0, total: 0 },
	);
	status.totalTokens = totals.total > 0 ? totals : undefined;
	status.lastUpdate = Date.now();
}

const STATUS_PUBLISH_INTERVAL_MS = 100;
let pendingPublishedStatus: { statusPath: string; status: RunnerStatus } | undefined;
let statusPublishTimer: ReturnType<typeof setTimeout> | undefined;
const statusUpdateObservers = new Map<string, (status: RunnerStatus) => void>();

function sendPublishedStatus(): void {
	const pending = pendingPublishedStatus;
	pendingPublishedStatus = undefined;
	statusPublishTimer = undefined;
	if (!pending || !isRuntimeFunction(process.send) || process.connected === false) return;
	try {
		process.send(
			{
				type: SUBAGENT_ASYNC_STATUS_EVENT,
				asyncDir: path.dirname(pending.statusPath),
				status: pending.status,
			},
			() => {},
		);
	} catch {
		// The detached run remains authoritative on disk after its parent disconnects.
	}
}

function publishStatus(statusPath: string, status: RunnerStatus): void {
	pendingPublishedStatus = { statusPath, status };
	if (
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
	) {
		if (statusPublishTimer) clearTimeout(statusPublishTimer);
		sendPublishedStatus();
		return;
	}
	if (statusPublishTimer) return;
	statusPublishTimer = setTimeout(sendPublishedStatus, STATUS_PUBLISH_INTERVAL_MS);
	statusPublishTimer.unref?.();
}

function writeStatus(statusPath: string, status: RunnerStatus): void {
	updateRunProjection(status);
	writePrivateAtomicJson(statusPath, status);
	publishStatus(statusPath, status);
	try {
		statusUpdateObservers.get(statusPath)?.(status);
	} catch (error) {
		reportAgentDiagnostic(`Foreground Agent status observer failed for '${status.runId}':`, error);
	}
}

function appendRecentOutput(step: RunnerStatusStep, text: string): void {
	const lines = utf8Tail(text, MAX_RECENT_OUTPUT_BYTES)
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.slice(-MAX_RECENT_OUTPUT_LINES);
	if (lines.length === 0) return;
	const candidates = [...(step.recentOutput ?? []), ...lines].slice(-MAX_RECENT_OUTPUT_LINES);
	const retained: string[] = [];
	let remaining = MAX_RECENT_OUTPUT_BYTES;
	for (let index = candidates.length - 1; index >= 0 && remaining > 0; index--) {
		const separatorBytes = retained.length > 0 ? 1 : 0;
		if (remaining <= separatorBytes) break;
		const candidate = candidates[index] ?? "";
		const bounded = utf8Tail(candidate, remaining - separatorBytes);
		if (!bounded) break;
		retained.unshift(bounded);
		remaining -= Buffer.byteLength(bounded, "utf-8") + separatorBytes;
	}
	step.recentOutput = retained;
}

function interruptDescendants(config: BackgroundRunnerConfig, kind: "pause" | "timeout" | "stop"): void {
	if (!config.nestedRoute) return;
	try {
		const registry = projectNestedEvents(config.nestedRoute);
		const queue = [...registry.children];
		while (queue.length > 0) {
			const child = queue.shift();
			if (!child) continue;
			queue.push(...(child.children ?? []));
			queue.push(...(child.steps?.flatMap((step) => step.children ?? []) ?? []));
			if (child.state !== "running" && child.state !== "queued") continue;
			const asyncDir = resolveNestedAsyncDir(config.nestedRoute.rootRunId, child);
			if (!asyncDir) continue;
			if (kind === "stop") deliverStopRequest({ asyncDir, pid: child.pid, source: "ancestor-stop" });
			else if (kind === "timeout") deliverTimeoutRequest({ asyncDir, pid: child.pid, source: "ancestor-timeout" });
			else deliverInterruptRequest({ asyncDir, pid: child.pid, source: "ancestor-pause" });
		}
	} catch {
		// Descendant propagation is best effort; the direct children are still stopped.
	}
}

function createTranscript(config: BackgroundRunnerConfig, task: RunnerAgentTask, index: number, count: number) {
	let artifactPaths: ArtifactPaths | undefined;
	let transcriptPath = path.join(
		config.asyncDir,
		"transcripts",
		`${index}-${task.agent.replace(/[^\w.-]/g, "_")}.jsonl`,
	);
	if (config.artifactsDir && config.artifactConfig?.enabled !== false) {
		try {
			fs.mkdirSync(config.artifactsDir, { recursive: true });
			artifactPaths = getArtifactPaths(config.artifactsDir, config.id, task.agent, count > 1 ? index : undefined);
			if (config.artifactConfig?.includeTranscript !== false) transcriptPath = artifactPaths.transcriptPath;
		} catch (error) {
			reportAgentDiagnostic(`Failed to initialize optional Agent artifacts for '${config.id}:${index}':`, error);
		}
	}
	return {
		writer: createChildTranscriptWriter({
			transcriptPath,
			source: "async",
			runId: config.id,
			agent: task.agent,
			childIndex: index,
			cwd: task.cwd,
			artifactManaged: transcriptPath === artifactPaths?.transcriptPath,
		}),
		path: transcriptPath,
		artifactPaths,
	};
}

function writeOptionalArtifact(filePath: string, content: string, artifactManaged = false): string | undefined {
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		if (artifactManaged) withArtifactGroupWriteClaim(filePath, () => fs.writeFileSync(filePath, content, "utf-8"));
		else fs.writeFileSync(filePath, content, "utf-8");
		return undefined;
	} catch (error) {
		return `Failed to write optional Agent artifact '${filePath}': ${
			error instanceof Error ? error.message : String(error)
		}`;
	}
}

interface SessionFallbackSnapshot {
	restore(): void;
	dispose(): void;
}

interface FallbackSessionStorage {
	readonly descriptor: number;
	readonly namedPath?: string;
	readonly claim?: DurableClaim;
}

const fallbackClaimWaitArray = new Int32Array(new SharedArrayBuffer(4));

function syncDirectoryBestEffort(directory: string): void {
	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
		fs.fsyncSync(descriptor);
	} catch {
		// Some supported filesystems do not permit fsync on directory handles.
	} finally {
		if (descriptor !== undefined) {
			try {
				fs.closeSync(descriptor);
			} catch {
				// Directory synchronization is diagnostic durability only and must not
				// turn an already-committed session restore into a false failure.
			}
		}
	}
}

function assertOwnedFallbackSession(filePath: string, stat: fs.Stats): void {
	const currentUid = process.getuid?.();
	if (
		stat.isSymbolicLink() ||
		!stat.isFile() ||
		stat.nlink !== 1 ||
		(currentUid !== undefined && stat.uid !== currentUid)
	) {
		throw new Error(`Fallback session '${filePath}' must be a singly linked owned regular file.`);
	}
}

function openOwnedFallbackSession(filePath: string): number {
	const pathStat = fs.lstatSync(filePath);
	assertOwnedFallbackSession(filePath, pathStat);
	const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW);
	try {
		const descriptorStat = fs.fstatSync(descriptor);
		assertOwnedFallbackSession(filePath, descriptorStat);
		if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
			throw new Error(`Fallback session '${filePath}' changed while it was opened.`);
		}
		return descriptor;
	} catch (error) {
		try {
			fs.closeSync(descriptor);
		} catch (cleanupError) {
			reportAgentDiagnostic("Failed to close a rejected Agent fallback session descriptor:", cleanupError);
		}
		throw error;
	}
}

function copyFallbackSessionDescriptor(source: number, destination: number): void {
	const before = fs.fstatSync(source);
	const buffer = Buffer.allocUnsafe(64 * 1024);
	let position = 0;
	fs.ftruncateSync(destination, 0);
	while (position < before.size) {
		const bytesRead = fs.readSync(source, buffer, 0, Math.min(buffer.length, before.size - position), position);
		if (bytesRead <= 0) throw new Error("Fallback session ended while it was being copied.");
		let written = 0;
		while (written < bytesRead) {
			const bytesWritten = fs.writeSync(destination, buffer, written, bytesRead - written, position + written);
			if (bytesWritten <= 0) throw new Error("Fallback session destination stopped accepting data.");
			written += bytesWritten;
		}
		position += bytesRead;
	}
	const after = fs.fstatSync(source);
	if (
		after.dev !== before.dev ||
		after.ino !== before.ino ||
		after.size !== before.size ||
		after.mtimeMs !== before.mtimeMs ||
		after.ctimeMs !== before.ctimeMs
	) {
		throw new Error("Fallback session changed while it was being copied.");
	}
	fs.fsyncSync(destination);
}

function ensureFallbackPrivateDirectory(parent: string, name: string): string {
	const directory = path.join(parent, name);
	try {
		fs.mkdirSync(directory, { mode: 0o700 });
	} catch (error) {
		if (errorCode(error) !== "EEXIST") throw error;
	}
	ensurePrivateDirectory(directory);
	return directory;
}

function fallbackSessionKey(sessionFile: string): string {
	const resolved = path.resolve(sessionFile);
	const canonicalParent = fs.realpathSync.native(path.dirname(resolved));
	let canonicalSlot = path.join(canonicalParent, path.basename(resolved));
	if (process.platform === "win32") canonicalSlot = canonicalSlot.toLowerCase();
	return createHash("sha256").update(canonicalSlot).digest("hex");
}

function acquireFallbackClaim(directory: string, namespace: string, sessionKey: string): DurableClaim {
	const name = shardedDurableClaimName(namespace, sessionKey, 4_096);
	for (let attempt = 0; attempt < FALLBACK_CLAIM_ATTEMPTS; attempt += 1) {
		const claim = tryAcquireKernelClaim(directory, name);
		if (claim) return claim;
		Atomics.wait(fallbackClaimWaitArray, 0, 0, FALLBACK_CLAIM_WAIT_MS);
	}
	throw new Error("Timed out waiting for isolated Agent fallback storage.");
}

function acquireFallbackLifecycleClaim(directory: string, sessionKey: string): DurableClaim {
	const name = `fallback-session-${sessionKey}`;
	for (let attempt = 0; attempt < FALLBACK_CLAIM_ATTEMPTS; attempt += 1) {
		const claim = tryAcquireKernelClaim(directory, name);
		if (claim) return claim;
		Atomics.wait(fallbackClaimWaitArray, 0, 0, FALLBACK_CLAIM_WAIT_MS);
	}
	throw new Error("This Agent fallback session is already owned by another active attempt.");
}

function removeOwnedFallbackTemporary(filePath: string): void {
	try {
		const stat = fs.lstatSync(filePath);
		assertOwnedFallbackSession(filePath, stat);
		fs.unlinkSync(filePath);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

function fallbackTemporaryIdentity(name: string, kind: "restore" | "snapshot"): string | undefined {
	const match = name.match(new RegExp(`^${kind}-([0-9a-f]{64})\\.tmp$`, "u"));
	return match?.[1];
}

function readFallbackSweepCursor(directory: string, kind: "restore" | "snapshot"): string {
	try {
		const value = readBoundedOwnedFile(path.join(directory, FALLBACK_SWEEP_CURSOR_FILE), 128).trim();
		return fallbackTemporaryIdentity(value, kind) ? value : "";
	} catch (error) {
		if (errorCode(error) !== "ENOENT") {
			reportAgentDiagnostic(`Failed to read ${kind} fallback orphan cursor:`, error);
		}
		return "";
	}
}

function writeFallbackSweepCursor(directory: string, value: string): void {
	const target = path.join(directory, FALLBACK_SWEEP_CURSOR_FILE);
	const temporary = path.join(directory, FALLBACK_SWEEP_TEMPORARY_FILE);
	removeOwnedFallbackTemporary(temporary);
	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(
			temporary,
			fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | O_NOFOLLOW,
			0o600,
		);
		fs.writeFileSync(descriptor, `${value}\n`, "utf8");
		fs.fsyncSync(descriptor);
		fs.closeSync(descriptor);
		descriptor = undefined;
		removeOwnedFallbackTemporary(target);
		fs.renameSync(temporary, target);
		syncDirectoryBestEffort(directory);
	} finally {
		try {
			if (descriptor !== undefined) fs.closeSync(descriptor);
		} finally {
			try {
				fs.unlinkSync(temporary);
			} catch {
				// Atomic rename consumed the temporary, or the next sweep reclaims it.
			}
		}
	}
}

/**
 * Advance through crash debris without repeatedly restarting at a busy prefix.
 * Active writers retain the same kernel claim and therefore cannot be swept,
 * even if a very large copy outlives the conservative age threshold.
 */
function sweepFallbackOrphans(directory: string, kind: "restore" | "snapshot", now = Date.now()): void {
	const maintenance = tryAcquireKernelClaim(directory, "fallback-maintenance");
	if (!maintenance) return;
	try {
		// This private protocol directory contains a fixed set of sharded claim files
		// plus temporary debris. Enumeration is small in normal operation; the cursor
		// bounds destructive work and guarantees progress across repeated maintenance.
		const candidates = fs
			.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => fallbackTemporaryIdentity(entry.name, kind) !== undefined)
			.map((entry) => entry.name)
			.sort();
		const cursor = readFallbackSweepCursor(directory, kind);
		const nextIndex = cursor ? candidates.findIndex((name) => name > cursor) : 0;
		const start = nextIndex < 0 ? 0 : nextIndex;
		const page = candidates.slice(start, start + FALLBACK_ORPHANS_PER_SWEEP);
		for (const name of page) {
			const sessionKey = fallbackTemporaryIdentity(name, kind);
			if (!sessionKey) continue;
			const candidate = path.join(directory, name);
			let stat: fs.Stats;
			try {
				stat = fs.lstatSync(candidate);
				assertOwnedFallbackSession(candidate, stat);
			} catch (error) {
				if (errorCode(error) === "ENOENT") continue;
				throw error;
			}
			if (now - stat.mtimeMs < FALLBACK_ORPHAN_GRACE_MS) continue;
			const owner = tryAcquireKernelClaim(directory, shardedDurableClaimName(`fallback-${kind}`, sessionKey, 4_096));
			if (!owner) continue;
			try {
				const current = fs.lstatSync(candidate);
				assertOwnedFallbackSession(candidate, current);
				if (now - current.mtimeMs >= FALLBACK_ORPHAN_GRACE_MS) fs.unlinkSync(candidate);
			} catch (error) {
				if (errorCode(error) !== "ENOENT") throw error;
			} finally {
				owner.release();
			}
		}

		if (page.length === 0 || start + page.length >= candidates.length) {
			removeOwnedFallbackTemporary(path.join(directory, FALLBACK_SWEEP_CURSOR_FILE));
		} else {
			writeFallbackSweepCursor(directory, page.at(-1) ?? "");
		}
	} catch (error) {
		reportAgentDiagnostic(`Failed to sweep ${kind} fallback crash debris:`, error);
	} finally {
		try {
			maintenance.release();
		} catch (error) {
			reportAgentDiagnostic(`Failed to release ${kind} fallback maintenance claim:`, error);
		}
	}
}

function openFallbackSessionStorage(sessionKey: string): FallbackSessionStorage {
	const root = ensureFallbackPrivateDirectory(os.tmpdir(), FALLBACK_SNAPSHOT_DIRECTORY);
	sweepFallbackOrphans(root, "snapshot");
	if (process.platform === "linux") {
		try {
			const descriptor = fs.openSync(
				os.tmpdir(),
				LINUX_O_TMPFILE | (fs.constants.O_DIRECTORY ?? 0) | fs.constants.O_RDWR,
				0o600,
			);
			try {
				fs.fchmodSync(descriptor, 0o600);
				return { descriptor };
			} catch (error) {
				try {
					fs.closeSync(descriptor);
				} catch (cleanupError) {
					reportAgentDiagnostic("Failed to close an incomplete anonymous Agent fallback snapshot:", cleanupError);
				}
				throw error;
			}
		} catch (error) {
			if (!new Set(["EISDIR", "EINVAL", "ENOTSUP", "EOPNOTSUPP", "EPERM"]).has(errorCode(error) ?? "")) {
				throw error;
			}
			// Some Linux filesystems do not implement O_TMPFILE. The private named
			// fallback below is swept after crashes and unlinked immediately when the
			// filesystem permits POSIX open-file deletion.
		}
	}

	const temporary = path.join(root, `snapshot-${sessionKey}.tmp`);
	const claim = acquireFallbackClaim(root, "fallback-snapshot", sessionKey);
	let descriptor: number | undefined;
	try {
		// The sharded kernel claim makes exact crash-debris cleanup race-free without
		// growing one permanent lock inode for every session ever observed.
		removeOwnedFallbackTemporary(temporary);
		descriptor = fs.openSync(
			temporary,
			fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | O_NOFOLLOW,
			0o600,
		);
		fs.fchmodSync(descriptor, 0o600);
		try {
			fs.unlinkSync(temporary);
			claim.release();
			return { descriptor };
		} catch {
			// Windows and a few non-POSIX filesystems retain the private name while
			// open. Keep the claim until disposal so no later owner can remove it.
			return { descriptor, namedPath: temporary, claim };
		}
	} catch (error) {
		try {
			if (descriptor !== undefined) fs.closeSync(descriptor);
		} catch {
			// Preserve the original snapshot-creation failure.
		}
		try {
			removeOwnedFallbackTemporary(temporary);
		} catch {
			// The next owner retries exact cleanup.
		}
		try {
			claim.release();
		} catch {
			// Preserve the original snapshot-creation failure.
		}
		throw error;
	}
}

function disposeFallbackSessionStorage(storage: FallbackSessionStorage): void {
	let firstError: unknown;
	try {
		fs.closeSync(storage.descriptor);
	} catch (error) {
		firstError = error;
	}
	if (storage.namedPath) {
		try {
			fs.unlinkSync(storage.namedPath);
		} catch (error) {
			if (errorCode(error) !== "ENOENT" && firstError === undefined) firstError = error;
		}
	}
	try {
		storage.claim?.release();
	} catch (error) {
		if (firstError === undefined) firstError = error;
	}
	if (firstError !== undefined) throw firstError;
}

function createAnonymousFallbackSession(sessionFile: string, sessionKey: string): FallbackSessionStorage {
	const source = openOwnedFallbackSession(sessionFile);
	let snapshot: FallbackSessionStorage | undefined;
	try {
		snapshot = openFallbackSessionStorage(sessionKey);
		copyFallbackSessionDescriptor(source, snapshot.descriptor);
	} catch (error) {
		try {
			if (snapshot !== undefined) disposeFallbackSessionStorage(snapshot);
		} catch (cleanupError) {
			reportAgentDiagnostic("Failed to discard an incomplete Agent fallback snapshot:", cleanupError);
		}
		try {
			fs.closeSync(source);
		} catch (cleanupError) {
			reportAgentDiagnostic("Failed to close the source of an incomplete Agent fallback snapshot:", cleanupError);
		}
		throw error;
	}
	try {
		fs.closeSync(source);
	} catch (error) {
		try {
			disposeFallbackSessionStorage(snapshot);
		} catch (cleanupError) {
			reportAgentDiagnostic(
				"Failed to discard an Agent fallback snapshot after source close failure:",
				cleanupError,
			);
		}
		throw error;
	}
	return snapshot;
}

/** Freeze a fork before model attempts so every retry starts from the same branch. */
function createSessionFallbackSnapshot(
	sessionFile: string | undefined,
	candidateCount: number,
): SessionFallbackSnapshot | undefined {
	if (!sessionFile || candidateCount < 2) return undefined;
	const parent = path.dirname(sessionFile);
	const sessionKey = fallbackSessionKey(sessionFile);
	const restoreDirectory = ensureFallbackPrivateDirectory(parent, FALLBACK_RESTORE_DIRECTORY);
	sweepFallbackOrphans(restoreDirectory, "restore");
	// Lifecycle ownership must be exact: a bounded shard held across a model call
	// would randomly reject unrelated concurrent sessions. One stable inode per
	// persisted session mirrors the session store's own lifetime and guarantees
	// that retries for the same fork can never overwrite one another.
	const lifecycleDirectory = ensureFallbackPrivateDirectory(parent, FALLBACK_LIFECYCLE_DIRECTORY);
	const lifecycleClaim = acquireFallbackLifecycleClaim(lifecycleDirectory, sessionKey);
	let existed = false;
	let snapshot: FallbackSessionStorage | undefined;
	try {
		try {
			const stat = fs.lstatSync(sessionFile);
			assertOwnedFallbackSession(sessionFile, stat);
			existed = true;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
		if (existed) snapshot = createAnonymousFallbackSession(sessionFile, sessionKey);
	} catch (error) {
		try {
			if (snapshot !== undefined) disposeFallbackSessionStorage(snapshot);
		} catch (cleanupError) {
			reportAgentDiagnostic("Failed to clean up an incomplete Agent fallback snapshot:", cleanupError);
		}
		try {
			lifecycleClaim.release();
		} catch (cleanupError) {
			reportAgentDiagnostic("Failed to release an incomplete Agent fallback lifecycle claim:", cleanupError);
		}
		throw error;
	}
	let disposed = false;

	return {
		restore() {
			if (disposed) throw new Error("Fallback session snapshot is already closed.");
			const restoreClaim = acquireFallbackClaim(restoreDirectory, "fallback-restore", sessionKey);
			const temporary = path.join(restoreDirectory, `restore-${sessionKey}.tmp`);
			let destination: number | undefined;
			let operationFailed = false;
			let operationError: unknown;
			try {
				if (!existed) {
					try {
						const stat = fs.lstatSync(sessionFile);
						assertOwnedFallbackSession(sessionFile, stat);
						fs.unlinkSync(sessionFile);
						syncDirectoryBestEffort(parent);
					} catch (error) {
						if (errorCode(error) !== "ENOENT") throw error;
					}
				} else {
					if (snapshot === undefined) throw new Error("Fallback session snapshot is unavailable.");
					removeOwnedFallbackTemporary(temporary);
					destination = fs.openSync(
						temporary,
						fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | O_NOFOLLOW,
						0o600,
					);
					fs.fchmodSync(destination, 0o600);
					copyFallbackSessionDescriptor(snapshot.descriptor, destination);
					fs.closeSync(destination);
					destination = undefined;
					fs.renameSync(temporary, sessionFile);
					syncDirectoryBestEffort(restoreDirectory);
					syncDirectoryBestEffort(parent);
				}
			} catch (error) {
				operationFailed = true;
				operationError = error;
			}
			const cleanupErrors: unknown[] = [];
			try {
				if (destination !== undefined) fs.closeSync(destination);
			} catch (error) {
				cleanupErrors.push(error);
			}
			try {
				fs.unlinkSync(temporary);
			} catch (error) {
				if (errorCode(error) !== "ENOENT") cleanupErrors.push(error);
			}
			try {
				restoreClaim.release();
			} catch (error) {
				cleanupErrors.push(error);
			}
			if (operationFailed) {
				for (const cleanupError of cleanupErrors) {
					reportAgentDiagnostic("Failed to clean up an unsuccessful Agent fallback restore:", cleanupError);
				}
				throw operationError;
			}
			if (cleanupErrors.length > 0) throw cleanupErrors[0];
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			try {
				if (snapshot !== undefined) disposeFallbackSessionStorage(snapshot);
			} catch (error) {
				reportAgentDiagnostic("Failed to close frozen Agent fallback session:", error);
			}
			try {
				lifecycleClaim.release();
			} catch (error) {
				reportAgentDiagnostic("Failed to release frozen Agent fallback lifecycle ownership:", error);
			}
		},
	};
}

function rollBackWriterSpawning(
	index: number,
	tempDir: string | undefined,
	onWriterProcess?: (writer: { state: "none" }) => void,
): void {
	try {
		onWriterProcess?.({ state: "none" });
	} catch (error) {
		reportAgentDiagnostic(`Failed to roll back Agent writer process identity for child ${index}:`, error);
	}
	cleanupTempDir(tempDir);
}

function runChildProcess(input: {
	config: BackgroundRunnerConfig;
	task: RunnerAgentTask;
	index: number;
	model?: string;
	taskCwd: string;
	sessionDir?: string;
	outputFile: string;
	transcript: ChildTranscriptWriter;
	artifactJsonlPath?: string;
	statusStep: RunnerStatusStep;
	statusPath: string;
	status: RunnerStatus;
	activeControls: Map<number, ChildRuntimeControl>;
	consumeScheduledStop: () => boolean;
	onWriterProcess?: (writer: WriterRuntimeState) => void;
	afterWriterSpawnBeforeBinding?: (index: number, pid: number) => void;
	beforeWriterCloseRecovery?: (index: number) => void | Promise<void>;
	beforeWriterSupervisorDispositionRead?: (filePath: string, index: number) => void;
	writerSupervisorRuntime?: string;
}): Promise<ChildProcessResult> {
	return new Promise((resolve, reject) => {
		void (async () => {
			try {
				const startedAt = Date.now();
				const processInstanceId = randomUUID();
				const built = buildPiArgs({
					governorSessionId: input.task.governorSessionId,
					physicalSessionId: input.task.physicalSessionId,
					parentSessionId: input.task.parentSessionId,
					baseArgs: ["--mode", "json", "-p"],
					task: input.task.task,
					sessionEnabled: Boolean(input.task.sessionFile || input.sessionDir),
					sessionDir: input.task.sessionFile ? undefined : input.sessionDir,
					sessionFile: input.task.sessionFile,
					model: input.model,
					thinking: input.task.thinking,
					inheritProjectContext: input.task.inheritProjectContext,
					inheritSkills: input.task.inheritSkills,
					codeModeEnabled: input.config.codeModeEnabled,
					codeModeProviderTools: input.config.codeModeProviderTools,
					childBaseExtensionPath: input.task.childBaseExtensionPath,
					requireReadTool: input.task.inheritSkills || Boolean(input.task.skills?.length),
					tools: input.task.tools,
					extensions: input.task.extensions,
					subagentOnlyExtensions: input.task.subagentOnlyExtensions,
					systemPrompt: appendTurnBudgetSystemPrompt(input.task.systemPrompt ?? "", input.task.turnBudget),
					systemPromptMode: input.task.systemPromptMode,
					mcpDirectTools: input.task.mcpDirectTools,
					capabilityCeiling: input.task.capabilityCeiling ?? input.config.capabilityCeiling,
					cwd: input.taskCwd,
					promptFileStem: input.task.agent,
					intercomSessionName: input.config.childIntercomTargets?.[input.index],
					orchestratorIntercomTarget: input.config.controlIntercomTarget,
					enableNativeSupervisor: input.config.nativeSupervisor === true,
					runId: input.config.id,
					logicalAgentPathComponent: input.task.logicalAgentPathComponent,
					childAgentName: input.task.agent,
					childIndex: input.index,
					parentEventSink: input.config.nestedRoute?.eventSink,
					parentControlInbox: input.config.nestedRoute?.controlInbox,
					parentRootRunId: input.config.nestedRoute?.rootRunId,
					parentCapabilityToken: input.config.nestedRoute?.capabilityToken,
					steerInboxDir: stepSteerInboxDir(input.config.asyncDir, input.index),
					steerCapabilityPath: steerCapabilityPath(input.config.asyncDir, input.index),
					steerAckDir: steerAcksDir(input.config.asyncDir, input.index),
					toolBudget: input.task.toolBudget,
				});
				const spawnDeps: PiSpawnDeps = {};
				if (input.config.piPackageRoot) spawnDeps.piPackageRoot = input.config.piPackageRoot;
				if (input.config.piArgv1) spawnDeps.argv1 = input.config.piArgv1;
				if (input.config.piExecutable) spawnDeps.execPath = input.config.piExecutable;
				const spawnSpec = getPiSpawnCommand(built.args, spawnDeps);
				const usage = emptyUsage();
				const messages: ChildMessage[] = [];
				const stderrTail = createBoundedByteTail();
				const rawOutputTail = createBoundedByteTail();
				let toolCount = 0;
				let observedModel = input.model;
				let assistantError: string | undefined;
				let protocolError: ProtocolOutputLimit | undefined;
				let invalidProtocolEvent = false;
				let stdoutProtocolBytes = 0;
				const stdoutProtocolLimit = maxChildProtocolBytes();
				let stderrProtocolBytes = 0;
				const stderrProtocolLimit = maxChildProtocolBytes();
				let interrupted = false;
				let timedOut = false;
				let stopped = false;
				let turnBudgetExceeded = false;
				let contextNudgeObserved = false;
				let turnBudget = input.task.turnBudget ? initialTurnBudgetState(input.task.turnBudget) : undefined;
				let terminalCause: "pause" | "timeout" | "stop" | "turn-budget" | "protocol" | "setup" | undefined;
				let settled = false;
				let childExited = false;
				let finalDrainEvidence = false;
				let finalDrainSignalSent = false;
				let finalDrainHardKillSignalSent = false;
				let finalDrainTimer: NodeJS.Timeout | undefined;
				let finalDrainHardKillTimer: NodeJS.Timeout | undefined;
				let terminationHardKillTimer: NodeJS.Timeout | undefined;
				let forcedError: string | undefined;
				let runtimeControl: ChildRuntimeControl | undefined;
				let writerProcessBindingError: unknown;
				try {
					input.onWriterProcess?.({ state: "spawning" });
				} catch (error) {
					rollBackWriterSpawning(input.index, built.tempDir, input.onWriterProcess);
					throw error;
				}
				let child: ReturnType<typeof spawn>;
				let writerSpawn: ReturnType<typeof buildWriterSpawnCommand>;
				const supervisorDispositionPath = path.join(
					built.tempDir ?? input.config.asyncDir,
					`writer-supervisor-terminal-${input.index}-${processInstanceId}.json`,
				);
				const groupMemberProofFile = `writer-group-member-${input.index}-${processInstanceId}.json`;
				const groupMemberProofPath = path.join(input.config.asyncDir, groupMemberProofFile);
				const writerControl =
					process.platform === "win32"
						? undefined
						: {
								path: path.join(
									input.config.asyncDir,
									`writer-supervisor-control-${input.index}-${processInstanceId}.jsonl`,
								),
								token: randomUUID(),
							};
				let writerControlSequence = 0;
				const removeWriterControl = () => {
					if (!writerControl) return;
					try {
						fs.rmSync(writerControl.path, { force: true });
					} catch {
						// The private run directory is retained for bounded maintenance.
					}
				};
				try {
					if (writerControl) {
						fs.writeFileSync(writerControl.path, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
					}
					writerSpawn = buildWriterSpawnCommand(
						spawnSpec.command,
						spawnSpec.args,
						process.platform,
						supervisorDispositionPath,
						groupMemberProofPath,
						input.writerSupervisorRuntime,
						writerControl,
					);
					// The supervisor is a one-shot gate, not an extra untracked Pi writer.
					// Its authenticated private control file cannot authorize `proceed` until
					// the runner has durably bound the supervisor process identity.
					child = spawn(writerSpawn.command, writerSpawn.args, {
						cwd: input.taskCwd,
						detached: process.platform !== "win32",
						stdio: ["pipe", "pipe", "pipe"],
						env: buildWriterProcessEnv(
							process.env,
							{ ...built.env, ...ponytailWriterEnvironmentOverrides(input.config.ponytailMode) },
							input.task.maxSubagentDepth,
						),
						windowsHide: true,
					});
					child.on("error", (error) => {
						forcedError ??= `Agent writer supervisor failed to start: ${error.message}`;
					});
				} catch (error) {
					removeWriterControl();
					rollBackWriterSpawning(input.index, built.tempDir, input.onWriterProcess);
					throw error;
				}
				const writerProcessStartIdentity = isRuntimeNumber(child.pid)
					? await captureWriterProcessStartIdentity(child.pid)
					: undefined;
				if (!isRuntimeNumber(child.pid) || !writerProcessStartIdentity) {
					// The gate has not been released, so this exact ChildProcess handle is
					// still the only authority needed to terminate the unbound shell safely.
					try {
						child.kill("SIGKILL");
					} catch {}
					removeWriterControl();
					rollBackWriterSpawning(input.index, built.tempDir, input.onWriterProcess);
					throw new Error("Agent writer process has no stable process-start identity.");
				}
				const childStdin = child.stdin;
				const childStdout = child.stdout;
				const childStderr = child.stderr;
				if (!childStdin || !childStdout || !childStderr) {
					trySignalChild(child, "SIGTERM", writerProcessStartIdentity);
					removeWriterControl();
					rollBackWriterSpawning(input.index, built.tempDir, input.onWriterProcess);
					throw new Error("Agent writer process did not expose stdout and stderr pipes.");
				}
				let writerControlError: Error | undefined;
				childStdin.on("error", (error: Error) => {
					writerControlError ??= error;
				});
				const sendWriterSupervisorControl = (
					command: "cancel-finalize" | "finalize" | "proceed" | "terminate-sigint" | "terminate-sigterm",
					settleDelivery?: (delivered: boolean) => void,
				): boolean => {
					if (!writerSpawn.gated) return false;
					try {
						if (writerControl) {
							writerControlSequence += 1;
							fs.appendFileSync(
								writerControl.path,
								`${JSON.stringify({
									version: 1,
									token: writerControl.token,
									sequence: writerControlSequence,
									command,
								})}\n`,
								{ encoding: "utf8" },
							);
							settleDelivery?.(true);
							return true;
						}
						if (childStdin.destroyed || childStdin.writableEnded) return false;
						childStdin.write(`${command}\n`, (error?: Error | null) => {
							if (error) writerControlError ??= error;
							settleDelivery?.(!error);
						});
						return true;
					} catch (error) {
						if (error instanceof Error) writerControlError ??= error;
						settleDelivery?.(false);
						return false;
					}
				};
				const requestWriterSupervisorTermination = (signal: "SIGINT" | "SIGTERM"): boolean => {
					if (!writerSpawn.gated) return trySignalChild(child, signal, writerProcessStartIdentity);
					const queued = sendWriterSupervisorControl(
						signal === "SIGINT" ? "terminate-sigint" : "terminate-sigterm",
						(delivered) => {
							if (!delivered && !settled) trySignalChild(child, signal, writerProcessStartIdentity);
						},
					);
					if (!queued) return trySignalChild(child, signal, writerProcessStartIdentity);
					return true;
				};
				if (isRuntimeNumber(child.pid)) {
					try {
						input.afterWriterSpawnBeforeBinding?.(input.index, child.pid);
					} catch (error) {
						trySignalChild(child, "SIGKILL", writerProcessStartIdentity);
						removeWriterControl();
						rollBackWriterSpawning(input.index, built.tempDir, input.onWriterProcess);
						throw error;
					}
				}
				if (isRuntimeNumber(child.pid)) {
					try {
						const writerState: WriterRuntimeState = {
							state: "running",
							pid: child.pid,
							processStartIdentity: writerProcessStartIdentity,
						};
						if (writerSpawn.gated) writerState.groupMemberProofFile = groupMemberProofFile;
						input.onWriterProcess?.(writerState);
					} catch (error) {
						writerProcessBindingError = error;
					}
				}
				const clearGuard = attachPostExitStdioGuard(child, { idleMs: 2_000, hardMs: 8_000 });
				const cancelFinalDrain = (preserveSemanticEvidence = false) => {
					if (finalDrainTimer) clearTimeout(finalDrainTimer);
					finalDrainTimer = undefined;
					const signalWasSent = finalDrainSignalSent || finalDrainHardKillSignalSent;
					if (signalWasSent && writerSpawn.gated) {
						const queued = sendWriterSupervisorControl("cancel-finalize", (delivered) => {
							if (!delivered || settled) return;
							if (finalDrainHardKillTimer) clearTimeout(finalDrainHardKillTimer);
							finalDrainHardKillTimer = undefined;
							if (!preserveSemanticEvidence) {
								// A real continuation event supersedes the prior terminal report.
								// The supervisor still retains the already-sent signal provenance.
								finalDrainEvidence = false;
								finalDrainSignalSent = false;
								finalDrainHardKillSignalSent = false;
							}
						});
						if (queued) return;
					}
					if (preserveSemanticEvidence && signalWasSent) return;
					if (finalDrainHardKillTimer) clearTimeout(finalDrainHardKillTimer);
					finalDrainHardKillTimer = undefined;
					finalDrainEvidence = false;
					finalDrainSignalSent = false;
					finalDrainHardKillSignalSent = false;
				};
				const armTerminationHardKill = () => {
					if (terminationHardKillTimer) clearTimeout(terminationHardKillTimer);
					terminationHardKillTimer = setTimeout(() => {
						terminationHardKillTimer = undefined;
						if (!settled) {
							// A gated child is the durable PGID supervisor. Never SIGKILL that
							// sole anchor while descendants may remain; a direct TERM nudges its
							// own indefinite reap loop without destroying group authority.
							trySignalChild(child, writerSpawn.gated ? "SIGTERM" : "SIGKILL", writerProcessStartIdentity);
						}
					}, 8_000);
					terminationHardKillTimer.unref?.();
				};
				const claimTerminalCause = (
					cause: "pause" | "timeout" | "stop" | "turn-budget" | "protocol" | "setup",
				): boolean => {
					if (settled || terminalCause) return false;
					terminalCause = cause;
					if (runtimeControl) {
						runtimeControl.state =
							cause === "pause"
								? "paused"
								: cause === "timeout"
									? "timed-out"
									: cause === "stop"
										? "stopped"
										: "failed";
					}
					return true;
				};
				const terminate = (kind: "pause" | "timeout" | "stop") => {
					if (!claimTerminalCause(kind)) return;
					cancelFinalDrain();
					interrupted = kind === "pause";
					timedOut = kind === "timeout";
					stopped = kind === "stop";
					forcedError =
						kind === "pause"
							? "Agent paused."
							: kind === "timeout"
								? "Agent timed out."
								: "Agent stopped by user.";
					requestWriterSupervisorTermination(kind === "pause" ? "SIGINT" : "SIGTERM");
					armTerminationHardKill();
				};
				runtimeControl = {
					state: "running",
					interrupt: terminate,
					revokeFinalization: () => cancelFinalDrain(true),
				};
				input.activeControls.set(input.index, runtimeControl);
				if (input.consumeScheduledStop()) terminate("stop");

				const appendRawEvent = (line: string, event?: ChildEvent) => {
					appendDiagnosticEvent(`${input.config.asyncDir}/events.jsonl`, {
						...(event ?? { type: "subagent.child.stdout", line }),
						subagentSource: "child",
						subagentRunId: input.config.id,
						subagentStepIndex: input.index,
						subagentAgent: input.task.agent,
						observedAt: Date.now(),
					});
					if (input.artifactJsonlPath) {
						try {
							appendArtifactJsonl(input.artifactJsonlPath, line);
						} catch {
							// Artifact JSONL is optional.
						}
					}
				};

				const startFinalDrain = () => {
					if (childExited || finalDrainTimer || finalDrainSignalSent || settled || terminalCause) return;
					finalDrainTimer = setTimeout(() => {
						finalDrainTimer = undefined;
						if (settled) return;
						const armFinalDrainWatchdog = () => {
							finalDrainHardKillTimer = setTimeout(
								() => {
									finalDrainHardKillTimer = undefined;
									const watchdogSignal = writerSpawn.gated ? "SIGTERM" : "SIGKILL";
									if (!settled && trySignalChild(child, watchdogSignal, writerProcessStartIdentity)) {
										finalDrainHardKillSignalSent = watchdogSignal === "SIGKILL";
									}
								},
								writerSpawn.gated ? 8_000 : 3_000,
							);
							finalDrainHardKillTimer.unref?.();
						};
						const requested = writerSpawn.gated
							? sendWriterSupervisorControl("finalize", (delivered) => {
									if (settled) return;
									if (!delivered) {
										finalDrainEvidence = false;
										return;
									}
									finalDrainSignalSent = true;
									armFinalDrainWatchdog();
								})
							: trySignalChild(child, "SIGTERM", writerProcessStartIdentity);
						if (!requested) {
							finalDrainEvidence = false;
							return;
						}
						if (!writerSpawn.gated) {
							finalDrainSignalSent = true;
							armFinalDrainWatchdog();
						}
					}, 1_000);
					finalDrainTimer.unref?.();
				};
				let streamingStatusPersistenceFailed = false;
				const persistStreamingStatus = (): void => {
					try {
						writeStatus(input.statusPath, input.status);
					} catch (error) {
						if (streamingStatusPersistenceFailed) return;
						streamingStatusPersistenceFailed = true;
						reportAgentDiagnostic(
							`Failed to persist live Agent progress for child ${String(input.index)}; execution will continue in memory:`,
							error,
						);
					}
				};

				const rejectProtocolEvent = (line: string, reason: string): void => {
					invalidProtocolEvent = true;
					rawOutputTail.push(`${line}\n`);
					input.transcript.writeStdoutLine(line);
					appendRawEvent(line);
					if (!claimTerminalCause("protocol")) return;
					forcedError = `protocol_invalid_event: ${reason}.`;
					cancelFinalDrain();
					if (requestWriterSupervisorTermination("SIGTERM")) armTerminationHardKill();
				};

				const processLineUnchecked = (line: string) => {
					if (protocolError || invalidProtocolEvent || !line.trim()) return;
					const lineBytes = Buffer.byteLength(line, "utf-8") + 1;
					const observedBytes = stdoutProtocolBytes + lineBytes;
					if (observedBytes > stdoutProtocolLimit) {
						const diagnostic = Buffer.from(line, "utf-8");
						protocolError = {
							code: "protocol_output_limit",
							stream: "stdout",
							scope: "aggregate",
							limitBytes: stdoutProtocolLimit,
							observedBytes,
							diagnosticPrefix: diagnostic.subarray(0, 4_096).toString("utf-8"),
							diagnosticTail: diagnostic.subarray(Math.max(0, diagnostic.length - 4_096)).toString("utf-8"),
						};
						if (claimTerminalCause("protocol")) {
							forcedError = formatProtocolOutputLimit(protocolError);
							cancelFinalDrain();
							if (requestWriterSupervisorTermination("SIGTERM")) armTerminationHardKill();
						}
						return;
					}
					stdoutProtocolBytes = observedBytes;
					let parsed: JsonValue;
					try {
						parsed = parseJsonValue(line);
					} catch {
						rawOutputTail.push(`${line}\n`);
						input.transcript.writeStdoutLine(line);
						appendRawEvent(line);
						appendRecentOutput(input.statusStep, line);
						persistStreamingStatus();
						return;
					}
					const parsedEvent = parseChildProtocolEvent(parsed);
					if (!parsedEvent.event) {
						rejectProtocolEvent(line, parsedEvent.error ?? "event is malformed");
						return;
					}
					const event = parsedEvent.event;
					if (
						event.type === "message_end" &&
						event.message?.role === "custom" &&
						event.message.customType === "magic-context:ceiling-nudge"
					) {
						contextNudgeObserved = true;
					}
					appendRawEvent(line, event);
					input.transcript.writeChildEvent(event);
					const terminalStop =
						event.type === "message_end" &&
						event.message?.role === "assistant" &&
						terminalAssistantStop(event.message);
					const lifecycle = projectChildLifecycle(event, terminalStop);
					if (lifecycle === "start-drain") {
						finalDrainEvidence = terminalStop || event.type === "agent_settled";
						startFinalDrain();
					} else if (lifecycle === "cancel-drain") cancelFinalDrain(false);
					if (event.type === "tool_execution_start" && event.toolName) {
						toolCount += 1;
						input.statusStep.toolCount = toolCount;
						input.statusStep.currentTool = event.toolName;
						input.statusStep.currentToolArgs = extractToolArgsPreview(event.args ?? {});
						input.statusStep.currentToolStartedAt = Date.now();
						input.statusStep.lastActivityAt = Date.now();
						persistStreamingStatus();
						return;
					}
					if (event.type === "tool_execution_end") {
						input.statusStep.currentTool = undefined;
						input.statusStep.currentToolArgs = undefined;
						input.statusStep.currentToolStartedAt = undefined;
						input.statusStep.lastActivityAt = Date.now();
						persistStreamingStatus();
						return;
					}
					if ((event.type !== "message_end" && event.type !== "tool_result_end") || !event.message) return;
					messages.push(event.message);
					const text = extractTextFromContent(event.message.content);
					if (text) {
						appendRecentOutput(input.statusStep, text);
						input.statusStep.lastActivityAt = Date.now();
					}
					if (event.type === "message_end" && event.message.role === "assistant") {
						observedModel = event.message.model ?? observedModel;
						assistantError = event.message.errorMessage;
						addUsage(usage, event.message);
						input.statusStep.turnCount = usage.turns;
						input.statusStep.tokens = tokenUsage(usage);
						if (input.task.turnBudget) {
							const decision = turnBudgetDecision(
								input.task.turnBudget,
								usage.turns,
								terminalAssistantStop(event.message),
								assistantStartsToolCall(event.message),
								true,
							);
							const abortBudget = decision === "abort" && !terminalCause && !turnBudgetExceeded;
							turnBudget = turnBudgetState(input.task.turnBudget, usage.turns, abortBudget);
							input.statusStep.turnBudget = turnBudget;
							if (abortBudget && claimTerminalCause("turn-budget")) {
								cancelFinalDrain();
								turnBudgetExceeded = true;
								forcedError = `Agent exceeded its turn budget (${input.task.turnBudget.maxTurns} + ${input.task.turnBudget.graceTurns}).`;
								requestWriterSupervisorTermination("SIGINT");
								armTerminationHardKill();
							}
						}
					}
					persistStreamingStatus();
				};
				const processLine = (line: string): void => {
					try {
						processLineUnchecked(line);
					} catch (error) {
						rejectProtocolEvent(
							line,
							`event processing failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				};

				const stdoutReader = createBoundedLineReader({
					onLine: processLine,
					onLimit(limit) {
						protocolError = limit;
						if (!claimTerminalCause("protocol")) return;
						forcedError = formatProtocolOutputLimit(limit);
						cancelFinalDrain();
						if (requestWriterSupervisorTermination("SIGTERM")) armTerminationHardKill();
					},
				});
				const rejectStderrLimit = (limit: ProtocolOutputLimit): void => {
					if (protocolError || invalidProtocolEvent) return;
					protocolError = limit;
					const diagnostic = formatProtocolOutputLimit(limit);
					input.transcript.writeStderrLine(diagnostic);
					appendDiagnosticEvent(`${input.config.asyncDir}/events.jsonl`, {
						type: "subagent.child.stderr",
						line: diagnostic,
						subagentRunId: input.config.id,
						subagentStepIndex: input.index,
						observedAt: Date.now(),
					});
					if (!claimTerminalCause("protocol")) return;
					forcedError = diagnostic;
					cancelFinalDrain();
					if (requestWriterSupervisorTermination("SIGTERM")) armTerminationHardKill();
				};
				const stderrReader = createBoundedLineReader({
					stream: "stderr",
					maxPendingLineBytes: MAX_CHILD_STDERR_BYTES,
					onLine(line) {
						if (protocolError || invalidProtocolEvent) return;
						const lineBytes = Buffer.byteLength(line, "utf-8") + 1;
						const observedBytes = stderrProtocolBytes + lineBytes;
						if (observedBytes > stderrProtocolLimit) {
							const diagnostic = Buffer.from(line, "utf-8");
							rejectStderrLimit({
								code: "protocol_output_limit",
								stream: "stderr",
								scope: "aggregate",
								limitBytes: stderrProtocolLimit,
								observedBytes,
								diagnosticPrefix: diagnostic.subarray(0, 4_096).toString("utf-8"),
								diagnosticTail: diagnostic.subarray(Math.max(0, diagnostic.length - 4_096)).toString("utf-8"),
							});
							return;
						}
						stderrProtocolBytes = observedBytes;
						input.transcript.writeStderrLine(line);
						appendDiagnosticEvent(`${input.config.asyncDir}/events.jsonl`, {
							type: "subagent.child.stderr",
							line,
							subagentRunId: input.config.id,
							subagentStepIndex: input.index,
							observedAt: Date.now(),
						});
					},
					onLimit(limit) {
						rejectStderrLimit(limit);
					},
				});
				childStdout.on("data", (chunk: Buffer) => stdoutReader.push(chunk));
				childStderr.on("data", (chunk: Buffer) => {
					stderrTail.push(chunk);
					stderrReader.push(chunk);
				});
				child.on("exit", () => {
					childExited = true;
				});
				const teardownClosedChild = (): void => {
					input.activeControls.delete(input.index);
					if (finalDrainTimer) clearTimeout(finalDrainTimer);
					if (finalDrainHardKillTimer) clearTimeout(finalDrainHardKillTimer);
					if (terminationHardKillTimer) clearTimeout(terminationHardKillTimer);
					finalDrainTimer = undefined;
					finalDrainHardKillTimer = undefined;
					terminationHardKillTimer = undefined;
					try {
						clearGuard();
					} catch {}
					try {
						stdoutReader.end();
					} catch {}
					try {
						stderrReader.end();
					} catch {}
					try {
						cleanupTempDir(built.tempDir);
					} catch {}
					removeWriterControl();
					settled = true;
				};
				const handleChildClose = async (
					exitCode: number | null,
					signal: NodeJS.Signals | null,
				): Promise<ChildProcessResult> => {
					input.activeControls.delete(input.index);
					try {
						await input.beforeWriterCloseRecovery?.(input.index);
						let groupClosed =
							!isRuntimeNumber(child.pid) ||
							(await closeWriterProcessGroup(child.pid, writerProcessStartIdentity));
						if (!groupClosed && writerSpawn.gated) {
							groupClosed = (await reapOrphanWriterProcesses(input.config.asyncDir)).remaining === 0;
						}
						if (groupClosed) {
							try {
								input.onWriterProcess?.({ state: "none" });
							} catch (error) {
								reportAgentDiagnostic(
									`Failed to clear writer process identity for Agent child ${input.index}:`,
									error,
								);
							}
							try {
								fs.rmSync(groupMemberProofPath, { force: true });
							} catch {
								// The registry is already clear; proof cleanup is best effort.
							}
						} else {
							forcedError ??= "Agent writer process group did not terminate; recovery ownership was retained.";
						}
						stdoutReader.end();
						stderrReader.end();
						// Final unterminated protocol records are processed by end(). Only
						// after that semantic flush may later control callbacks be suppressed.
						settled = true;
						const stderr = stderrTail.text();
						const output = getFinalOutput(messages) || rawOutputTail.text().trim();
						const diagnosticError = readChildToolDiagnosticError(built.toolDiagnosticPath);
						try {
							input.beforeWriterSupervisorDispositionRead?.(supervisorDispositionPath, input.index);
						} catch (error) {
							reportAgentDiagnostic(
								`Agent writer supervisor disposition test hook failed for child ${input.index}:`,
								error,
							);
						}
						const supervisorDisposition = writerSpawn.gated
							? readWriterSupervisorDisposition(supervisorDispositionPath, child.pid, writerProcessStartIdentity)
							: undefined;
						try {
							fs.rmSync(supervisorDispositionPath, { force: true });
						} catch {
							// The containing temporary directory is cleaned below when available.
						}
						const observedExitCode = supervisorDisposition ? supervisorDisposition.exitCode : exitCode;
						const observedSignal = supervisorDisposition ? supervisorDisposition.signal : signal;
						const semanticError =
							forcedError ??
							diagnosticError ??
							assistantError ??
							supervisorDisposition?.outputForwardingError ??
							(writerSpawn.gated && !supervisorDisposition
								? "Agent writer supervisor terminal disposition was unavailable; termination provenance could not be verified."
								: undefined) ??
							(supervisorDisposition?.reaped === false
								? "Agent writer supervisor could not reap the complete process group."
								: undefined);
						const finalDrainTerminationObserved = writerSpawn.gated
							? supervisorDisposition?.origin === "manager-final-drain"
							: (finalDrainSignalSent &&
									(observedSignal === "SIGTERM" || (observedSignal === null && observedExitCode === 143))) ||
								(finalDrainHardKillSignalSent &&
									(observedSignal === "SIGKILL" || (observedSignal === null && observedExitCode === 137)));
						const completedByInternalFinalDrain =
							finalDrainEvidence && !semanticError && finalDrainTerminationObserved;
						const error =
							semanticError ??
							(!completedByInternalFinalDrain && observedExitCode && stderr.trim() ? stderr.trim() : undefined);
						const signalledExit =
							observedSignal !== null ||
							(observedSignal === null &&
								isRuntimeNumber(observedExitCode) &&
								observedExitCode > 128 &&
								observedExitCode <= 255);
						const terminationOrigin = writerSpawn.gated
							? (supervisorDisposition?.origin ?? undefined)
							: !signalledExit
								? undefined
								: finalDrainTerminationObserved
									? ("manager-final-drain" as const)
									: terminalCause
										? ("manager-request" as const)
										: ("external" as const);
						try {
							fs.writeFileSync(input.outputFile, output || error || "", "utf-8");
						} catch {
							// The transcript and result remain authoritative if this convenience file fails.
						}
						const writerProcess: WriterProcess = {
							processInstanceId,
							kind: "pi-writer",
							attempt: 0,
							closeObservedAt: Date.now(),
							exitCode: observedExitCode,
							signal: observedSignal,
						};
						if (terminationOrigin) writerProcess.terminationOrigin = terminationOrigin;
						return {
							exitCode:
								interrupted || timedOut || stopped || turnBudgetExceeded
									? 1
									: completedByInternalFinalDrain
										? 0
										: observedSignal !== null
											? 1
											: observedExitCode,
							signal: observedSignal,
							stderr,
							messages,
							output,
							error,
							protocolError,
							usage,
							toolCount,
							durationMs: Date.now() - startedAt,
							model: observedModel,
							interrupted: interrupted || undefined,
							timedOut: timedOut || undefined,
							stopped: stopped || undefined,
							turnBudget,
							turnBudgetExceeded: turnBudgetExceeded || undefined,
							contextNudgeObserved: contextNudgeObserved || undefined,
							process: writerProcess,
						};
					} finally {
						teardownClosedChild();
					}
				};
				child.on("close", (exitCode, signal) => {
					void handleChildClose(exitCode, signal).then(resolve, reject);
				});
				if (writerProcessBindingError && claimTerminalCause("setup")) {
					forcedError = `Failed to bind Agent writer process identity: ${
						writerProcessBindingError instanceof Error
							? writerProcessBindingError.message
							: String(writerProcessBindingError)
					}`;
					trySignalChild(child, "SIGTERM", writerProcessStartIdentity);
					childStdin.destroy();
				} else {
					if (writerSpawn.gated) {
						const queued = sendWriterSupervisorControl("proceed", (delivered) => {
							if (delivered || settled || childExited) return;
							if (claimTerminalCause("setup")) {
								forcedError = `Failed to release Agent writer supervisor startup gate: ${writerControlError?.message ?? "control pipe closed"}.`;
								trySignalChild(child, "SIGTERM", writerProcessStartIdentity);
							}
						});
						if (!queued && claimTerminalCause("setup")) {
							forcedError = `Failed to release Agent writer supervisor startup gate: ${writerControlError?.message ?? "control pipe closed"}.`;
							trySignalChild(child, "SIGTERM", writerProcessStartIdentity);
						}
					} else childStdin.end();
				}
			} catch (error) {
				reject(error);
			}
		})();
	});
}

async function runResolvedTask(input: {
	config: BackgroundRunnerConfig;
	task: RunnerAgentTask;
	index: number;
	taskCwd: string;
	status: RunnerStatus;
	statusPath: string;
	eventsPath: string;
	activeControls: Map<number, ChildRuntimeControl>;
	consumeScheduledStop: (index: number) => boolean;
	onWriterProcess?: (writer: WriterRuntimeState) => void;
	afterWriterSpawnBeforeBinding?: (index: number, pid: number) => void;
	beforeWriterCloseRecovery?: (index: number) => void | Promise<void>;
	beforeWriterSupervisorDispositionRead?: (filePath: string, index: number) => void;
	writerSupervisorRuntime?: string;
}): Promise<BackgroundTaskResult> {
	const { config, task, index, status, statusPath } = input;
	const statusStep = status.steps[index];
	if (!statusStep) throw new Error(`Missing status step for Agent index ${index}.`);
	if (input.consumeScheduledStop(index)) return stoppedResult(task, "stop");
	const startedAt = Date.now();
	statusStep.status = "running";
	statusStep.startedAt = startedAt;
	statusStep.lastActivityAt = startedAt;
	writeStatus(statusPath, status);
	appendDiagnosticEvent(input.eventsPath, {
		type: "subagent.child.started",
		ts: startedAt,
		runId: config.id,
		index,
		agent: task.agent,
	});
	const count = taskList(config.work).length;
	const transcript = createTranscript(config, task, index, count);
	transcript.writer.writeInitialUserMessage(task.task);
	if (transcript.artifactPaths && config.artifactConfig?.includeInput !== false) {
		const error = writeOptionalArtifact(
			transcript.artifactPaths.inputPath,
			`# Task for ${task.agent}\n\n${task.task}`,
			true,
		);
		if (error) reportAgentDiagnostic(error);
	}
	if (transcript.artifactPaths && config.artifactConfig?.includeMetadata !== false) {
		const error = writeOptionalArtifact(
			transcript.artifactPaths.metadataPath,
			JSON.stringify(
				{
					state: "running",
					runId: config.id,
					index,
					agent: task.agent,
					cwd: input.taskCwd,
					startedAt,
					transcriptPath: transcript.path,
				},
				null,
				2,
			),
			true,
		);
		if (error) reportAgentDiagnostic(error);
	}
	statusStep.transcriptPath = transcript.path;
	const childSessionDir = task.sessionFile
		? undefined
		: config.sessionDir
			? path.join(config.sessionDir, String(index))
			: undefined;
	const outputFile = path.join(config.asyncDir, `output-${index}.log`);
	const candidates = task.modelCandidates?.length ? task.modelCandidates : [task.model];
	const attempts: ModelAttempt[] = [];
	const attemptedModels: string[] = [];
	const writerProcesses: WriterProcess[] = [];
	let final: ChildProcessResult | undefined;
	const fallbackSnapshot = createSessionFallbackSnapshot(task.sessionFile, candidates.length);
	try {
		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
			const candidate = candidates[candidateIndex];
			let run: ChildProcessResult;
			try {
				run = await runChildProcess({
					config,
					task,
					index,
					model: candidate,
					taskCwd: input.taskCwd,
					sessionDir: childSessionDir,
					outputFile,
					transcript: transcript.writer,
					artifactJsonlPath:
						transcript.artifactPaths && config.artifactConfig?.includeJsonl !== false
							? transcript.artifactPaths.jsonlPath
							: undefined,
					statusStep,
					statusPath,
					status,
					activeControls: input.activeControls,
					consumeScheduledStop: () => input.consumeScheduledStop(index),
					onWriterProcess: input.onWriterProcess,
					afterWriterSpawnBeforeBinding: input.afterWriterSpawnBeforeBinding,
					beforeWriterCloseRecovery: input.beforeWriterCloseRecovery,
					beforeWriterSupervisorDispositionRead: input.beforeWriterSupervisorDispositionRead,
					writerSupervisorRuntime: input.writerSupervisorRuntime,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const attemptError = boundResultText(message, MAX_MODEL_ATTEMPT_ERROR_BYTES);
				attempts.push({
					model: candidate ?? "default",
					success: false,
					exitCode: 1,
					error: attemptError,
					usage: emptyUsage(),
				});
				if (candidate) attemptedModels.push(candidate);
				final = {
					exitCode: 1,
					signal: null,
					stderr: "",
					messages: [],
					output: "",
					error: message,
					usage: emptyUsage(),
					toolCount: 0,
					durationMs: 0,
					model: candidate,
				};
				break;
			}
			if (run.process) writerProcesses.push({ ...run.process, attempt: candidateIndex });
			const detected = !run.error
				? detectSubagentError(run.messages.filter((message): message is Message => message.role !== "custom"))
				: undefined;
			const emptyOutput =
				!run.error && run.exitCode === 0 && !run.output.trim() ? "Agent produced no output." : undefined;
			const expectedManagerSignal =
				run.process?.terminationOrigin === "manager-final-drain" ||
				run.process?.terminationOrigin === "manager-request" ||
				run.interrupted ||
				run.timedOut ||
				run.stopped;
			const unexplainedExit = !run.error
				? run.signal && !expectedManagerSignal
					? `Agent process terminated by ${run.signal} without a diagnostic.`
					: run.exitCode === null
						? "Agent process ended without an exit code or diagnostic."
						: run.exitCode !== 0
							? `Agent process exited with code ${String(run.exitCode)} without a diagnostic.`
							: undefined
				: undefined;
			const error =
				run.error ??
				(detected?.hasError ? (detected.details ?? detected.errorType) : undefined) ??
				emptyOutput ??
				unexplainedExit;
			const exitCode = error && run.exitCode === 0 ? 1 : run.exitCode;
			const attempt: ModelAttempt = {
				model: candidate ?? run.model ?? "default",
				success: exitCode === 0 && !error,
				exitCode,
				error: error ? boundResultText(error, MAX_MODEL_ATTEMPT_ERROR_BYTES) : undefined,
				usage: run.usage,
			};
			attempts.push(attempt);
			if (candidate) attemptedModels.push(candidate);
			final = { ...run, exitCode, error };
			if (
				attempt.success ||
				run.interrupted ||
				run.timedOut ||
				run.stopped ||
				run.turnBudgetExceeded ||
				// A provider failure after Tool execution is not a clean model attempt:
				// retrying the whole task could repeat external mutations.
				run.toolCount > 0 ||
				!isRetryableModelFailure(error) ||
				candidateIndex === candidates.length - 1
			)
				break;
			try {
				fallbackSnapshot?.restore();
			} catch (restoreError) {
				const message = `Agent model fallback stopped because the frozen fork session could not be restored: ${
					restoreError instanceof Error ? restoreError.message : String(restoreError)
				}`;
				final = { ...run, exitCode: 1, error: message };
				break;
			}
			appendRecentOutput(statusStep, formatModelAttemptNote(attempt, candidates[candidateIndex + 1]));
			try {
				writeStatus(statusPath, status);
			} catch (error) {
				reportAgentDiagnostic(`Failed to persist Agent fallback status for child ${String(index)}:`, error);
			}
		}
	} finally {
		fallbackSnapshot?.dispose();
	}

	const endedAt = Date.now();
	const sessionFile = task.sessionFile ?? findLatestSessionFile(childSessionDir);
	const toolBudget: ToolBudgetState | undefined = task.toolBudget
		? toolBudgetState(task.toolBudget, final?.toolCount ?? 0)
		: undefined;
	const success = final?.exitCode === 0 && !final.error;
	const resultError = final?.error ? boundResultText(final.error, MAX_RESULT_ERROR_BYTES) : undefined;
	const fullOutput = final?.output || resultError || "(no output)";
	const output = boundResultText(
		fullOutput,
		positiveByteLimit(TASK_RESULT_MAX_BYTES_ENV, DEFAULT_MAX_TASK_RESULT_BYTES),
	);
	const result: BackgroundTaskResult = {
		agent: task.agent,
		output,
		success,
		exitCode: final?.exitCode ?? 1,
		modelAttempts: attempts,
		transcriptPath: transcript.path,
		writerProcesses,
		writerAttemptCount: writerProcesses.length,
	};
	if (task.context) result.context = task.context;
	if (resultError) result.error = resultError;
	if (final?.protocolError) result.protocolError = final.protocolError;
	if (final?.interrupted) result.interrupted = true;
	if (final?.timedOut) result.timedOut = true;
	if (final?.stopped) result.stopped = true;
	if (final?.turnBudget) result.turnBudget = final.turnBudget;
	if (final?.turnBudgetExceeded) {
		result.turnBudgetExceeded = true;
		result.wrapUpRequested = true;
	}
	if (final?.contextNudgeObserved) result.contextNudgeObserved = true;
	if (toolBudget) result.toolBudget = toolBudget;
	if (sessionFile) result.sessionFile = sessionFile;
	const intercomTarget = config.childIntercomTargets?.[index];
	if (intercomTarget) result.intercomTarget = intercomTarget;
	const model = final?.model ?? task.model;
	if (model) result.model = model;
	if (task.thinking) result.thinking = task.thinking;
	if (attemptedModels.length > 0) result.attemptedModels = attemptedModels;
	const totalCost = costSummary(attempts);
	if (totalCost) result.totalCost = totalCost;
	if (transcript.artifactPaths) result.artifactPaths = transcript.artifactPaths;
	const transcriptError = transcript.writer.getError();
	if (transcriptError) result.transcriptError = transcriptError;
	if (task.launchContractDigest) result.launchContractDigest = task.launchContractDigest;
	if (task.capabilityCeiling) result.capabilityCeiling = task.capabilityCeiling;

	if (transcript.artifactPaths && config.artifactConfig?.includeOutput !== false) {
		const error = writeOptionalArtifact(
			transcript.artifactPaths.outputPath,
			formatOutputArtifactContent({
				output: fullOutput,
				error: result.error,
				transcriptPath: transcript.path,
				metadataPath:
					config.artifactConfig?.includeMetadata === false ? undefined : transcript.artifactPaths.metadataPath,
			}),
			true,
		);
		if (error) {
			reportAgentDiagnostic(error);
			delete result.artifactPaths;
		}
	}
	if (transcript.artifactPaths && config.artifactConfig?.includeMetadata !== false) {
		const error = writeOptionalArtifact(
			transcript.artifactPaths.metadataPath,
			JSON.stringify(
				{
					state:
						result.interrupted || result.timedOut || result.stopped ? "stopped" : success ? "complete" : "failed",
					runId: config.id,
					index,
					agent: task.agent,
					cwd: input.taskCwd,
					model: result.model,
					thinking: result.thinking,
					skills: task.skills,
					turnBudget: result.turnBudget,
					toolBudget: result.toolBudget,
					exitCode: result.exitCode,
					error: result.error,
					transcriptPath: transcript.path,
					timestamp: endedAt,
				},
				null,
				2,
			),
			true,
		);
		if (error) {
			reportAgentDiagnostic(error);
			delete result.artifactPaths;
		}
	}

	applyTerminalResultToStep(statusStep, result, endedAt);
	try {
		writeStatus(statusPath, status);
		appendDiagnosticEvent(input.eventsPath, {
			type: "subagent.child.completed",
			ts: endedAt,
			runId: config.id,
			index,
			agent: task.agent,
			success,
		});
	} catch (error) {
		reportAgentDiagnostic(`Failed to persist terminal Agent step ${String(index)}:`, error);
	}
	return result;
}

async function runConfiguredWork(
	config: BackgroundRunnerConfig,
	onWriterProcess?: (index: number, writer: WriterRuntimeState) => void,
	beforeFinalPersistence?: () => void | Promise<void>,
	beforeWorktreeEvidence?: () => void,
	beforeResultPersistence?: () => void,
	afterWriterSpawnBeforeBinding?: (index: number, pid: number) => void,
	beforeWriterCloseRecovery?: (index: number) => void | Promise<void>,
	beforeWriterSupervisorDispositionRead?: (filePath: string, index: number) => void,
	writerSupervisorRuntime?: string,
): Promise<{ nestedProjectionCommitted: boolean }> {
	const startedAt = config.startedAt ?? Date.now();
	const statusPath = path.join(config.asyncDir, "status.json");
	const eventsPath = path.join(config.asyncDir, "events.jsonl");
	fs.mkdirSync(config.asyncDir, { recursive: true });
	const status = createInitialStatus(config, startedAt);
	writeStatus(statusPath, status);
	appendDiagnosticEvent(eventsPath, {
		type: "subagent.run.started",
		ts: startedAt,
		runId: config.id,
		mode: config.work.mode,
		agents: taskList(config.work).map((task) => task.agent),
	});

	const schedulingAbort = new AbortController();
	const activeControls = new Map<number, ChildRuntimeControl>();
	const scheduledStops = new Set<number>();
	let terminalKind: "pause" | "timeout" | "stop" | undefined;
	const requestTerminal = (kind: "pause" | "timeout" | "stop") => {
		if (terminalKind) return;
		terminalKind = kind;
		schedulingAbort.abort(kind);
		for (const control of activeControls.values()) control.interrupt(kind);
		interruptDescendants(config, kind);
	};

	let steeringStatusPersistenceFailed = false;
	const persistSteering = (): void => {
		try {
			writeStatus(statusPath, status);
			steeringStatusPersistenceFailed = false;
		} catch (error) {
			if (!steeringStatusPersistenceFailed) {
				steeringStatusPersistenceFailed = true;
				reportAgentDiagnostic(
					`Failed to persist live steering status for '${config.id}'; retaining the durable control record for retry:`,
					error,
				);
			}
			throw error;
		}
	};
	const routeSteering = (request: SteerRequest, index: number) => {
		try {
			enqueueStepSteer(config.asyncDir, index, request);
			activeControls.get(index)?.revokeFinalization();
			updateSteeringTarget(steeringStatus(status), request.id, index, "routed", Date.now());
			appendDiagnosticEvent(eventsPath, {
				type: "subagent.steer.routed",
				ts: Date.now(),
				runId: config.id,
				requestId: request.id,
				index,
			});
		} catch (error) {
			updateSteeringTarget(steeringStatus(status), request.id, index, "failed", Date.now(), {
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	};
	const stopChild = (index: number) => {
		const step = status.steps[index];
		if (!step || (step.status !== "pending" && step.status !== "running")) return;
		const control = activeControls.get(index);
		if (control) control.interrupt("stop");
		else scheduledStops.add(index);
		appendDiagnosticEvent(eventsPath, {
			type: "subagent.child.stop_requested",
			ts: Date.now(),
			runId: config.id,
			index,
		});
	};
	const onSteer = (request: SteerRequest) => {
		const projection = steeringStatus(status);
		const existing = findSteeringRequest(projection, request.id);
		if (existing) {
			if (
				request.parentRunOrigin === "user" &&
				existing.targets.some((target) => target.state !== "failed" && target.state !== "late")
			) {
				config.parentRunOrigin = "user";
				status.parentRunOrigin = "user";
			}
			// A prior pass may have queued the child request durably but failed the
			// authoritative status write. Do not retire the source claim until that
			// write itself succeeds.
			persistSteering();
			return;
		}
		const requested =
			request.targetIndex !== undefined
				? [request.targetIndex]
				: request.targetIndexes?.length
					? request.targetIndexes
					: status.steps
							.map((step, index) => ({ step, index }))
							.filter(({ step }) => step.status === "pending" || step.status === "running")
							.map(({ index }) => index);
		const capacityReached = pendingSteeringRequestCount(projection) >= MAX_PENDING_STEERING_REQUESTS;
		const targets = requested.map((index) => {
			const step = status.steps[index];
			let state: SteeringTargetState;
			let reason: string | undefined;
			if (capacityReached) {
				state = "failed";
				reason = `Agent has ${MAX_PENDING_STEERING_REQUESTS} steering requests awaiting delivery; wait for an acknowledgement before sending another.`;
			} else if (!step) {
				state = "failed";
				reason = "Agent index is out of range.";
			} else if (activeControls.get(index)?.state === "running") state = "routed";
			else if (activeControls.has(index)) {
				state = "failed";
				reason = `Agent is ${activeControls.get(index)?.state ?? "terminating"}.`;
			} else if (step.status === "pending" || step.status === "running") state = "routed";
			else {
				state = "failed";
				reason = `Agent is ${step.status}.`;
			}
			const target: SteeringTargetStatus = { index, state };
			if (reason) target.reason = reason;
			return target;
		});
		recordSteeringRequest(projection, {
			id: request.id,
			requestedAt: request.ts,
			source: request.source,
			message: request.message,
			targets,
		});
		for (const target of targets) {
			if (target.state === "routed") routeSteering(request, target.index);
		}
		const recorded = findSteeringRequest(projection, request.id);
		if (
			request.parentRunOrigin === "user" &&
			recorded?.targets.some((target) => target.state !== "failed" && target.state !== "late")
		) {
			// User takeover is monotonic. Persist it with live status and copy it into
			// the terminal result so a reloaded parent keeps the same attribution.
			config.parentRunOrigin = "user";
			status.parentRunOrigin = "user";
		}
		persistSteering();
	};
	const onSteerAck = (ack: SteerAck) => {
		const state = ack.state === "delivered" ? "delivered" : "failed";
		const projection = steeringStatus(status);
		const request = findSteeringRequest(projection, ack.requestId);
		const prior = request?.targets.find((target) => target.index === ack.index);
		if (!prior) {
			// An acknowledgement can become visible before the source request is
			// restored after a crash or transient status-read failure. Keep its durable
			// claim until the correlated target exists; consuming it here would let the
			// child redeliver a steer that Pi already accepted.
			return "retain" as const;
		}
		const alreadyApplied = prior.state === state;
		updateSteeringTarget(projection, ack.requestId, ack.index, state, ack.ts, {
			reason: ack.message,
		});
		if (!alreadyApplied) {
			appendDiagnosticEvent(eventsPath, {
				type: ack.state === "delivered" ? "subagent.steer.delivered" : "subagent.steer.failed",
				ts: ack.ts,
				runId: config.id,
				requestId: ack.requestId,
				index: ack.index,
				message: ack.message,
			});
		}
		persistSteering();
	};
	const disposeControl = watchAsyncControlInbox(config.asyncDir, {
		onInterrupt: () => requestTerminal("pause"),
		onTimeout: () => requestTerminal("timeout"),
		onStop: (request) => {
			if (request.targetIndex === undefined) requestTerminal("stop");
			else stopChild(request.targetIndex);
		},
		onSteer,
		onSteerAck,
	});
	const signalInterrupt = () => requestTerminal("pause");
	process.on(ASYNC_INTERRUPT_SIGNAL, signalInterrupt);
	let timeout: NodeJS.Timeout | undefined;
	if (config.deadlineAt !== undefined) {
		timeout = setTimeout(() => requestTerminal("timeout"), Math.max(0, config.deadlineAt - Date.now()));
		timeout.unref?.();
	}

	try {
		let worktreeSetup: WorktreeSetup | undefined;
		let worktreeEvidence: BackgroundCompletion["worktree"];
		let results: BackgroundTaskResult[];
		try {
			if (config.work.mode === "parallel" && config.work.group.worktree) {
				worktreeSetup = createWorktrees(config.cwd, config.id, config.work.group.tasks.length, {
					agents: config.work.group.tasks.map((task) => task.agent),
					setupHook: config.worktreeSetupHook
						? {
								hookPath: config.worktreeSetupHook,
								timeoutMs: config.worktreeSetupHookTimeoutMs,
							}
						: undefined,
					baseDir: config.worktreeBaseDir,
				});
			}
			results = await runBackgroundWork(
				config.work,
				async (task, index) => {
					try {
						return await runResolvedTask({
							config,
							task,
							index,
							taskCwd: worktreeSetup?.worktrees[index]?.agentCwd ?? task.cwd,
							status,
							statusPath,
							eventsPath,
							activeControls,
							consumeScheduledStop: (index) => scheduledStops.delete(index),
							onWriterProcess: onWriterProcess ? (writer) => onWriterProcess(index, writer) : undefined,
							afterWriterSpawnBeforeBinding,
							beforeWriterCloseRecovery,
							beforeWriterSupervisorDispositionRead,
							writerSupervisorRuntime,
						});
					} catch (error) {
						terminalizeRejectedStep(status, statusPath, eventsPath, index, error);
						throw error;
					}
				},
				{
					signal: schedulingAbort.signal,
				},
			);
			results = boundRunResultOutputs(results);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			results = taskList(config.work).map((task) => failedResult(task, message));
		}
		if (worktreeSetup) {
			const evidenceErrors: string[] = [];
			let diffs: ReturnType<typeof diffWorktrees> = [];
			try {
				beforeWorktreeEvidence?.();
				diffs = diffWorktrees(
					worktreeSetup,
					config.work.mode === "parallel" ? config.work.group.tasks.map((task) => task.agent) : [],
					path.join(config.asyncDir, "worktree-diffs"),
				);
			} catch (error) {
				evidenceErrors.push(
					`Worktree evidence capture failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			let cleanup: ReturnType<typeof cleanupWorktrees> = {
				state: "partial",
				tasks: [],
				pruned: false,
			};
			try {
				cleanup = cleanupWorktrees(worktreeSetup);
			} catch (error) {
				evidenceErrors.push(`Worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			const evidence: NonNullable<BackgroundCompletion["worktree"]> = {
				diffs,
				summary: formatWorktreeDiffSummary(diffs),
				cleanup,
			};
			if (evidenceErrors.length) evidence.error = evidenceErrors.join("\n");
			worktreeEvidence = evidence;
		}

		const endedAt = Date.now();
		reconcileUnfinishedSteps(status, results, eventsPath, endedAt);
		let nestedChildren: import("../../shared/types.ts").NestedRunSummary[] | undefined;
		let nestedProjectionCommitted = false;
		if (config.nestedRoute) {
			try {
				const registry = await projectNestedEventsAuthoritatively(config.nestedRoute);
				nestedChildren = registry.children.filter((child) => child.parentRunId === config.id);
				if (nestedWorkIncludesUser(nestedChildren)) {
					config.parentRunOrigin = "user";
					status.parentRunOrigin = "user";
				}
				attachRootChildrenToSteps(config.id, status.steps, nestedChildren);
				nestedProjectionCommitted = true;
			} catch {
				// The event stream remains available for later projection.
			}
		}
		const completionExtras: Pick<BackgroundCompletion, "nestedChildren" | "worktree"> = {};
		if (nestedProjectionCommitted) completionExtras.nestedChildren = nestedChildren ?? [];
		if (worktreeEvidence) completionExtras.worktree = worktreeEvidence;
		const completion = createBackgroundCompletion(config, results, startedAt, endedAt, completionExtras);
		status.state = completion.state;
		status.endedAt = endedAt;
		status.lastUpdate = endedAt;
		status.timedOut = completion.timedOut;
		status.stopped = completion.stopped;
		const stateDrivingFailure =
			results.find((result) => !result.success && !result.stopped && !result.interrupted) ??
			results.find((result) => result.stopped && completion.stopped) ??
			results.find((result) => result.interrupted && completion.interrupted) ??
			results.find((result) => result.error);
		status.error = completion.success ? undefined : stateDrivingFailure?.error;
		status.sessionFile = completion.sessionFile;
		status.outputFile = taskList(config.work).length === 1 ? path.join(config.asyncDir, "output-0.log") : undefined;
		await beforeFinalPersistence?.();
		try {
			closeSteerInbox(config.asyncDir, completion.state);
		} catch (error) {
			reportAgentDiagnostic(`Failed to close steering inbox for '${config.id}' during finalization:`, error);
		}
		try {
			processSteerRequestsFromDir(steerRequestsDir(config.asyncDir), (request) => {
				onSteer(request);
				return undefined;
			});
		} catch (error) {
			reportAgentDiagnostic(`Failed to scan final steering requests for '${config.id}':`, error);
		}
		if (status.parentRunOrigin === "user") completion.parentRunOrigin = "user";
		try {
			processSteerAcks(config.asyncDir, onSteerAck);
		} catch (error) {
			reportAgentDiagnostic(`Failed to scan final steering acknowledgments for '${config.id}':`, error);
		}
		failUndeliveredSteering(status, eventsPath, completion.state, endedAt);
		beforeResultPersistence?.();
		writePrivateAtomicJson(config.resultPath, completion);

		if (config.runnerProcessInstanceId) {
			const writers: Record<string, WriterProcess[]> = {};
			const expectedWriters: Record<string, number> = {};
			for (const [index, result] of results.entries()) {
				writers[String(index)] = result.writerProcesses ?? [];
				expectedWriters[String(index)] = result.writerAttemptCount ?? 0;
			}
			const candidate: ProcessTerminalCandidate = {
				version: 1,
				runId: config.id,
				runnerProcessInstanceId: config.runnerProcessInstanceId,
				writers,
				expectedWriters,
			};
			if (config.revivalLease?.sessionFile) candidate.sessionFile = config.revivalLease.sessionFile;
			if (config.revivalLeaseToken) candidate.revivalLeaseToken = config.revivalLeaseToken;
			try {
				writeProcessTerminalCandidate(config.asyncDir, candidate);
			} catch (error) {
				reportAgentDiagnostic(`Failed to write process-terminal candidate for '${config.id}':`, error);
			}
		}
		try {
			writeStatus(statusPath, status);
			appendDiagnosticEvent(eventsPath, {
				type: "subagent.run.completed",
				ts: endedAt,
				runId: config.id,
				state: completion.state,
				success: completion.success,
			});
		} catch (error) {
			reportAgentDiagnostic(
				`Failed to persist terminal Agent status for '${config.id}' after result commit:`,
				error,
			);
		}
		if (config.nestedRoute && config.nestedSelf) {
			try {
				writeNestedEvent(config.nestedRoute, {
					type: "subagent.nested.completed",
					ts: endedAt,
					parentRunId: config.nestedSelf.parentRunId,
					parentStepIndex: config.nestedSelf.parentStepIndex,
					child: nestedSummaryFromAsyncStatus(status, config.asyncDir, {
						id: config.id,
						parentRunId: config.nestedSelf.parentRunId,
						parentStepIndex: config.nestedSelf.parentStepIndex,
						depth: config.nestedSelf.depth,
						path: config.nestedSelf.path,
						mode: status.mode,
						ts: endedAt,
					}),
				});
			} catch (error) {
				if (errorCode(error) !== "ENOENT") {
					reportAgentDiagnostic(`Failed to settle nested route after '${config.id}' completed:`, error);
				}
			}
		}
		return { nestedProjectionCommitted };
	} finally {
		if (timeout) clearTimeout(timeout);
		disposeControl();
		process.off(ASYNC_INTERRUPT_SIGNAL, signalInterrupt);
	}
}

export async function waitForStartupControl(
	controlPath: string,
	token: string,
	action: "ack" | "proceed",
	timeoutMs = 30_000,
	readControl: (path: string) => string = (path) => fs.readFileSync(path, "utf-8"),
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		try {
			const payload = parseJsonValue(readControl(controlPath));
			if (!isRuntimeObject(payload) || payload === null || Array.isArray(payload)) {
				throw new Error("Runner startup control payload is invalid.");
			}
			if (payload.token !== token) throw new Error("Runner startup token does not match the session lease.");
			if (payload.action === action) return;
			if (payload.action !== "ack" && payload.action !== "proceed") {
				throw new Error("Runner startup control action is invalid.");
			}
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for runner startup '${action}'.`);
}

export async function runConfiguredBackground(
	config: BackgroundRunnerConfig,
	hooks: {
		afterStatusUpdate?: (status: RunnerStatus) => void;
		afterWriterProcessUpdate?: (index: number, writer: WriterRuntimeState) => void;
		afterWriterSpawnBeforeBinding?: (index: number, pid: number) => void;
		beforeWriterCloseRecovery?: (index: number) => void | Promise<void>;
		beforeWriterSupervisorDispositionRead?: (filePath: string, index: number) => void;
		beforeFinalPersistence?: () => void | Promise<void>;
		beforeWorktreeEvidence?: () => void;
		beforeResultPersistence?: () => void;
		writerSupervisorRuntime?: string;
	} = {},
): Promise<void> {
	if (config.version !== 2) throw new Error("Background runner config version must be 2.");
	if (taskList(config.work).length > MAX_BACKGROUND_TASKS) {
		throw new Error(`Background runner supports at most ${MAX_BACKGROUND_TASKS} tasks per launch.`);
	}
	for (const task of taskList(config.work)) assertModelCandidateLimit(task.modelCandidates ?? []);
	let lease: ReturnType<typeof acquireSessionLease> | undefined;
	let terminalCommitted = false;
	let startupCommitted = !config.revivalLease && !config.startupGateToken;
	const startupPath = path.join(config.asyncDir, "runner-startup.json");
	const ackPath = path.join(config.asyncDir, "runner-startup-ack.json");
	const proceedPath = path.join(config.asyncDir, "runner-startup-proceed.json");
	const gatePath = path.join(config.asyncDir, "runner-startup-gate.json");
	const statusPath = path.join(config.asyncDir, "status.json");
	if (hooks.afterStatusUpdate) statusUpdateObservers.set(statusPath, hooks.afterStatusUpdate);
	const releaseOnExit = () => {
		try {
			if (lease && inspectWriterProcessLiveness(config.asyncDir) === false) lease.release();
		} catch {
			// A dead-owner lease is reclaimed by the next recovery attempt.
		}
	};
	process.once("exit", releaseOnExit);
	try {
		if (config.startupGateToken) {
			await waitForStartupControl(gatePath, config.startupGateToken, "proceed");
			startupCommitted = true;
			fs.rmSync(gatePath, { force: true });
		}
		initializeWriterProcessRegistry(config.asyncDir, config.id, process.pid, taskList(config.work).length);
		let startupToken: string = randomUUID();
		if (config.revivalLease) {
			lease = acquireSessionLease(config.revivalLease, { inspectWriterLiveness: inspectWriterProcessLiveness });
			config.revivalLeaseToken = lease.owner.token;
			startupToken = lease.owner.token;
			writePrivateAtomicJson(startupPath, {
				state: "ready",
				token: startupToken,
				pid: process.pid,
				owner: lease.owner,
			});
			await waitForStartupControl(ackPath, startupToken, "ack");
			writePrivateAtomicJson(startupPath, {
				state: "acknowledged",
				token: startupToken,
				pid: process.pid,
			});
			await waitForStartupControl(proceedPath, startupToken, "proceed");
			startupCommitted = true;
			fs.rmSync(ackPath, { force: true });
			fs.rmSync(proceedPath, { force: true });
		}
		await runConfiguredWork(
			config,
			(index, writer) => {
				updateWriterProcessRegistry(config.asyncDir, index, writer);
				if (lease && index === 0) lease.updateWriter(writer);
				hooks.afterWriterProcessUpdate?.(index, writer);
			},
			hooks.beforeFinalPersistence,
			hooks.beforeWorktreeEvidence,
			hooks.beforeResultPersistence,
			hooks.afterWriterSpawnBeforeBinding,
			hooks.beforeWriterCloseRecovery,
			hooks.beforeWriterSupervisorDispositionRead,
			hooks.writerSupervisorRuntime,
		);
		// `runConfiguredWork` has committed the terminal result/status at this
		// point. A transient first projection failure must not suppress the
		// authoritative route settlement retry below.
		terminalCommitted = true;
	} catch (error) {
		if (config.revivalLease && !startupCommitted) {
			try {
				writePrivateAtomicJson(startupPath, {
					state: "error",
					pid: process.pid,
					error: error instanceof Error ? error.message : String(error),
				});
			} catch {
				// The launcher will time out and terminate an unacknowledged runner.
			}
		}
		throw error;
	} finally {
		statusUpdateObservers.delete(statusPath);
		process.off("exit", releaseOnExit);
		if (lease) {
			let acknowledged = false;
			try {
				// A writer supervisor can close while an authenticated Pi member of
				// its process group survives. Never free the canonical session until
				// the registry positively proves that every writer group is absent.
				if (inspectWriterProcessLiveness(config.asyncDir) === false) acknowledged = lease.release();
			} catch (error) {
				reportAgentDiagnostic("Failed to release Agent session lease:", error);
			}
			try {
				markProcessTerminalCandidateLeaseRelease(config.asyncDir, lease.owner.token, acknowledged);
			} catch (error) {
				reportAgentDiagnostic("Failed to record Agent session lease release:", error);
			}
		}
		if (terminalCommitted && config.nestedRoute?.rootRunId === config.id) {
			try {
				await finalizeNestedRouteRoot(config.nestedRoute, config.asyncDir);
			} catch (error) {
				if (errorCode(error) !== "ENOENT") {
					reportAgentDiagnostic(`Failed to settle terminal nested route for '${config.id}':`, error);
				}
			}
		}
	}
}

function startConfiguredBackground(config: BackgroundRunnerConfig): void {
	runConfiguredBackground(config).catch((error) => {
		reportAgentDiagnostic("Background Agent runner error:", error);
		process.exitCode = 1;
	});
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function isRunnerAgentTask(value: JsonValue): value is JsonObject & RunnerAgentTask {
	return (
		isJsonObject(value) &&
		isRuntimeString(value.agent) &&
		isRuntimeString(value.task) &&
		isRuntimeString(value.cwd) &&
		isRuntimeBoolean(value.inheritProjectContext) &&
		isRuntimeBoolean(value.inheritSkills)
	);
}

function isBackgroundRunnerWork(value: JsonValue): value is JsonObject & BackgroundRunnerWork {
	if (!isJsonObject(value)) return false;
	if (value.mode === "single") return isRunnerAgentTask(value.task);
	return (
		value.mode === "parallel" &&
		isJsonObject(value.group) &&
		Array.isArray(value.group.tasks) &&
		value.group.tasks.every(isRunnerAgentTask) &&
		isRuntimeNumber(value.group.concurrency) &&
		Number.isSafeInteger(value.group.concurrency) &&
		value.group.concurrency > 0 &&
		isRuntimeBoolean(value.group.worktree)
	);
}

function parseBackgroundRunnerConfig(text: string): BackgroundRunnerConfig {
	const value = parseJsonValue(text);
	if (
		!isRuntimeObject(value) ||
		value === null ||
		Array.isArray(value) ||
		value.version !== 2 ||
		!isRuntimeString(value.id) ||
		!value.id ||
		!isRuntimeString(value.resultPath) ||
		!value.resultPath ||
		!isRuntimeString(value.cwd) ||
		!value.cwd ||
		!isRuntimeString(value.asyncDir) ||
		!value.asyncDir ||
		(value.ponytailMode !== undefined && normalizePonytailMode(value.ponytailMode) === undefined) ||
		!isBackgroundRunnerWork(value.work)
	) {
		throw new Error("Background runner config is invalid.");
	}
	return Object.assign({}, value, {
		version: 2 as const,
		id: value.id,
		resultPath: value.resultPath,
		cwd: value.cwd,
		asyncDir: value.asyncDir,
		work: value.work,
	});
}

function startFromConfigPath(configPath: string): void {
	const config = parseBackgroundRunnerConfig(readBoundedOwnedFile(configPath, 8 * 1024 * 1024));
	try {
		fs.unlinkSync(configPath);
	} catch {
		// Temporary config cleanup is best effort.
	}
	startConfiguredBackground(config);
}

const runnerConfigPath = process.env[BACKGROUND_RUNNER_CONFIG_ENV];
if (
	process.env[BACKGROUND_RUNNER_SENTINEL_ENV] === "1" &&
	runnerConfigPath !== undefined &&
	process.argv[2] === runnerConfigPath
) {
	try {
		startFromConfigPath(runnerConfigPath);
	} catch (error) {
		reportAgentDiagnostic("Background Agent runner error:", error);
		process.exitCode = 1;
	}
}
