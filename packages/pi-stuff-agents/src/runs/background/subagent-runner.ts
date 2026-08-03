/** Detached runner for one Agent or one parallel Agent batch. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { appendJsonl, formatOutputArtifactContent, getArtifactPaths } from "../../shared/artifacts.ts";
import { writeAtomicJson } from "../../shared/atomic-json.ts";
import { type ChildTranscriptWriter, createChildTranscriptWriter } from "../../shared/child-transcript.ts";
import { attachPostExitStdioGuard, trySignalChild } from "../../shared/post-exit-stdio-guard.ts";
import type {
	ArtifactPaths,
	AsyncStatus,
	CostSummary,
	ModelAttempt,
	ProtocolOutputLimit,
	SteeringTargetState,
	TokenUsage,
	ToolBudgetState,
	TurnBudgetState,
	Usage,
} from "../../shared/types.ts";
import { getSubagentDepthEnv, SUBAGENT_LIFECYCLE_ARTIFACT_VERSION } from "../../shared/types.ts";
import {
	detectSubagentError,
	extractTextFromContent,
	extractToolArgsPreview,
	getFinalOutput,
} from "../../shared/utils.ts";
import {
	createBoundedByteTail,
	createBoundedLineReader,
	formatProtocolOutputLimit,
	MAX_CHILD_STDERR_BYTES,
	projectChildLifecycle,
} from "../shared/child-protocol.ts";
import { formatModelAttemptNote, isRetryableModelFailure } from "../shared/model-fallback.ts";
import { attachRootChildrenToSteps, projectNestedEvents, resolveNestedAsyncDir } from "../shared/nested-events.ts";
import {
	type BackgroundRunnerConfig,
	type BackgroundRunnerWork,
	type BackgroundTaskResult,
	mapConcurrent,
	type RunnerAgentTask,
} from "../shared/parallel-utils.ts";
import { buildPiArgs, cleanupTempDir } from "../shared/pi-args.ts";
import { getPiSpawnCommand } from "../shared/pi-spawn.ts";
import { acquireSessionLease } from "../shared/session-lease.ts";
import { readChildToolDiagnosticError } from "../shared/tool-availability.ts";
import { initialToolBudgetState, toolBudgetState } from "../shared/tool-budget.ts";
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
	type SteerAck,
	type SteerRequest,
	steerAcksDir,
	steerCapabilityPath,
	stepSteerInboxDir,
	watchAsyncControlInbox,
} from "./control-channel.ts";
import {
	markProcessTerminalCandidateLeaseRelease,
	type ProcessTerminalCandidate,
	writeProcessTerminalCandidate,
} from "./process-terminal.ts";
import { createSteeringStatus, recordSteeringRequest, steeringStatus, updateSteeringTarget } from "./steering.ts";
import {
	initializeWriterProcessRegistry,
	updateWriterProcessRegistry,
	type WriterRuntimeState,
} from "./writer-process-registry.ts";

type RunnerStatusStep = NonNullable<AsyncStatus["steps"]>[number] & {
	exitCode?: number | null;
};

type RunnerStatus = AsyncStatus & {
	pid: number;
	cwd: string;
	steps: RunnerStatusStep[];
	lastUpdate: number;
	artifactsDir?: string;
};

type ChildMessage = Message & {
	model?: string;
	errorMessage?: string;
	stopReason?: string;
	usage?: {
		input?: number;
		inputTokens?: number;
		output?: number;
		outputTokens?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: { total?: number };
	};
};

interface ChildEvent {
	type?: string;
	message?: ChildMessage;
	toolName?: string;
	args?: Record<string, unknown>;
	willRetry?: unknown;
}

interface ChildProcessResult {
	exitCode: number | null;
	signal: string | null;
	stderr: string;
	messages: Message[];
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
	process: WriterProcess;
}

type WriterProcess = NonNullable<BackgroundTaskResult["writerProcesses"]>[number];

interface ChildRuntimeControl {
	state: "running" | "paused" | "timed-out" | "stopped";
	interrupt(kind: "pause" | "timeout" | "stop"): void;
}

interface RunBackgroundWorkOptions {
	signal?: AbortSignal;
	stoppedMessage?: string;
}

interface BackgroundCompletion {
	id: string;
	runId: string;
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
	};
}

const ASYNC_INTERRUPT_SIGNAL: NodeJS.Signals = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";
const DEFAULT_MAX_ASYNC_EVENTS_BYTES = 50 * 1024 * 1024;
const ASYNC_EVENTS_MAX_BYTES_ENV = "PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES";
const BACKGROUND_RUNNER_SENTINEL_ENV = "PI_STUFF_BACKGROUND_RUNNER";
const BACKGROUND_RUNNER_CONFIG_ENV = "PI_STUFF_BACKGROUND_RUNNER_CONFIG";

/** Runner identity must never leak into a Pi writer process. */
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
	delete env[BACKGROUND_RUNNER_SENTINEL_ENV];
	delete env[BACKGROUND_RUNNER_CONFIG_ENV];
	return env;
}

function maxAsyncEventsBytes(): number {
	const parsed = Number(process.env[ASYNC_EVENTS_MAX_BYTES_ENV]);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_MAX_ASYNC_EVENTS_BYTES;
}

function appendDiagnosticEvent(eventsPath: string, event: object): void {
	try {
		const size = fs.existsSync(eventsPath) ? fs.statSync(eventsPath).size : 0;
		const line = JSON.stringify(event);
		if (size + Buffer.byteLength(`${line}\n`, "utf-8") > maxAsyncEventsBytes()) return;
		appendJsonl(eventsPath, line);
	} catch {
		// Diagnostics never determine run success.
	}
}

function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

function addUsage(target: Usage, message: ChildMessage): void {
	const usage = message.usage;
	if (!usage) return;
	target.turns += 1;
	target.input += usage.input ?? usage.inputTokens ?? 0;
	target.output += usage.output ?? usage.outputTokens ?? 0;
	target.cacheRead += usage.cacheRead ?? 0;
	target.cacheWrite += usage.cacheWrite ?? 0;
	target.cost += usage.cost?.total ?? 0;
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

function assistantStartsToolCall(message: Message): boolean {
	return (
		Array.isArray(message.content) && message.content.some((part) => (part as { type?: string }).type === "toolCall")
	);
}

function terminalAssistantStop(message: Message): boolean {
	return (message as { stopReason?: string }).stopReason === "stop" && !assistantStartsToolCall(message);
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

function stoppedResult(task: RunnerAgentTask, message: string): BackgroundTaskResult {
	return {
		agent: task.agent,
		...(task.context ? { context: task.context } : {}),
		output: message,
		success: false,
		exitCode: 1,
		stopped: true,
		error: message,
		...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
		...(task.model ? { model: task.model } : {}),
		...(task.thinking ? { thinking: task.thinking } : {}),
		...(task.launchContractDigest ? { launchContractDigest: task.launchContractDigest } : {}),
	};
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
	const results: Array<BackgroundTaskResult | undefined> = new Array(tasks.length);
	const stopMessage = options.stoppedMessage ?? "Agent stopped before it started.";
	if (work.mode === "single") {
		results[0] = options.signal?.aborted
			? stoppedResult(work.task, stopMessage)
			: await runTask(work.task, 0, options.signal);
		return results as BackgroundTaskResult[];
	}

	await mapConcurrent(tasks, work.group.concurrency, async (task, index) => {
		if (options.signal?.aborted) {
			results[index] = stoppedResult(task, stopMessage);
			return;
		}
		results[index] = await runTask(task, index, options.signal);
	});
	for (let index = 0; index < tasks.length; index++) {
		const task = tasks[index];
		if (task) results[index] ??= stoppedResult(task, stopMessage);
	}
	return results as BackgroundTaskResult[];
}

function parallelSummary(results: BackgroundTaskResult[]): string {
	return results
		.map((result, index) => {
			const state = result.success
				? "complete"
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
	const stopped = results.some((result) => result.stopped);
	const interrupted = !stopped && results.some((result) => result.interrupted);
	const timedOut = !stopped && results.some((result) => result.timedOut);
	const success = results.length > 0 && results.every((result) => result.success);
	const state = stopped ? "stopped" : interrupted ? "paused" : success ? "complete" : "failed";
	const summary =
		config.work.mode === "single"
			? results[0]?.output || results[0]?.error || "(no output)"
			: parallelSummary(results);
	return {
		id: config.id,
		runId: config.id,
		...(config.sessionId !== undefined ? { sessionId: config.sessionId } : {}),
		mode: config.work.mode,
		state,
		success,
		...(stopped ? { stopped: true } : {}),
		...(timedOut ? { timedOut: true } : {}),
		...(interrupted ? { interrupted: true } : {}),
		summary,
		results,
		cwd: config.cwd,
		asyncDir: config.asyncDir,
		startedAt,
		endedAt,
		...(results.length === 1 && results[0]?.sessionFile ? { sessionFile: results[0].sessionFile } : {}),
		...extras,
	};
}

export function createInitialStatus(config: BackgroundRunnerConfig, startedAt: number): RunnerStatus {
	const tasks = taskList(config.work);
	return {
		lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
		runId: config.id,
		...(config.sessionId ? { sessionId: config.sessionId } : {}),
		mode: config.work.mode,
		isNested: Boolean(config.nestedSelf),
		state: "running",
		startedAt,
		lastUpdate: startedAt,
		pid: process.pid,
		cwd: config.cwd,
		...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
		...(config.deadlineAt !== undefined ? { deadlineAt: config.deadlineAt } : {}),
		...(config.capabilityCeiling ? { capabilityCeiling: config.capabilityCeiling } : {}),
		...(config.artifactsDir ? { artifactsDir: config.artifactsDir } : {}),
		steering: createSteeringStatus(),
		steps: tasks.map((task) => ({
			agent: task.agent,
			...(task.context ? { context: task.context } : {}),
			...(task.description ? { label: task.description } : {}),
			task: task.task,
			status: "pending" as const,
			...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
			...(task.model ? { model: task.model } : {}),
			...(task.thinking ? { thinking: task.thinking } : {}),
			...(task.skills?.length ? { skills: task.skills } : {}),
			...(task.turnBudget ? { turnBudget: initialTurnBudgetState(task.turnBudget) } : {}),
			...(task.toolBudget ? { toolBudget: initialToolBudgetState(task.toolBudget) } : {}),
			...(task.launchContractDigest ? { launchContractDigest: task.launchContractDigest } : {}),
			...(task.capabilityCeiling ? { capabilityCeiling: task.capabilityCeiling } : {}),
		})),
	};
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

function writeStatus(statusPath: string, status: RunnerStatus): void {
	updateRunProjection(status);
	writeAtomicJson(statusPath, status);
}

function appendRecentOutput(step: RunnerStatusStep, text: string): void {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	if (lines.length === 0) return;
	step.recentOutput ??= [];
	step.recentOutput.push(...lines);
	if (step.recentOutput.length > 50) step.recentOutput.splice(0, step.recentOutput.length - 50);
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

function createTranscript(
	config: BackgroundRunnerConfig,
	task: RunnerAgentTask,
	index: number,
	count: number,
): { writer: ChildTranscriptWriter; path: string; artifactPaths?: ArtifactPaths } {
	let artifactPaths: ArtifactPaths | undefined;
	let transcriptPath = path.join(
		config.asyncDir,
		"transcripts",
		`${index}-${task.agent.replace(/[^\w.-]/g, "_")}.jsonl`,
	);
	if (config.artifactsDir && config.artifactConfig?.enabled !== false) {
		artifactPaths = getArtifactPaths(config.artifactsDir, config.id, task.agent, count > 1 ? index : undefined);
		fs.mkdirSync(config.artifactsDir, { recursive: true });
		if (config.artifactConfig?.includeTranscript !== false) transcriptPath = artifactPaths.transcriptPath;
	}
	return {
		writer: createChildTranscriptWriter({
			transcriptPath,
			source: "async",
			runId: config.id,
			agent: task.agent,
			childIndex: index,
			cwd: task.cwd,
		}),
		path: transcriptPath,
		artifactPaths,
	};
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
	onWriterProcess?: (writer: { state: "none" | "spawning" } | { state: "running"; pid: number }) => void;
}): Promise<ChildProcessResult> {
	return new Promise((resolve) => {
		const startedAt = Date.now();
		const processInstanceId = randomUUID();
		const built = buildPiArgs({
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
			requireReadTool: Boolean(input.task.skills?.length),
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
			runId: input.config.id,
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
		const spawnSpec = getPiSpawnCommand(built.args, {
			...(input.config.piPackageRoot ? { piPackageRoot: input.config.piPackageRoot } : {}),
			...(input.config.piArgv1 ? { argv1: input.config.piArgv1 } : {}),
			...(input.config.piExecutable ? { execPath: input.config.piExecutable } : {}),
		});
		const usage = emptyUsage();
		const messages: Message[] = [];
		const stderrTail = createBoundedByteTail();
		const rawOutputTail = createBoundedByteTail();
		let toolCount = 0;
		let observedModel = input.model;
		let assistantError: string | undefined;
		let protocolError: ProtocolOutputLimit | undefined;
		let interrupted = false;
		let timedOut = false;
		let stopped = false;
		let turnBudgetExceeded = false;
		let turnBudget = input.task.turnBudget ? initialTurnBudgetState(input.task.turnBudget) : undefined;
		let settled = false;
		let childExited = false;
		let finalDrainTimer: NodeJS.Timeout | undefined;
		let hardKillTimer: NodeJS.Timeout | undefined;
		let forcedError: string | undefined;
		input.onWriterProcess?.({ state: "spawning" });
		const child = spawn(spawnSpec.command, spawnSpec.args, {
			cwd: input.taskCwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: buildWriterProcessEnv(process.env, built.env, input.task.maxSubagentDepth),
			windowsHide: true,
		});
		if (typeof child.pid === "number") {
			try {
				input.onWriterProcess?.({ state: "running", pid: child.pid });
			} catch (error) {
				trySignalChild(child, "SIGKILL");
				throw error;
			}
		}
		const clearGuard = attachPostExitStdioGuard(child, { idleMs: 2_000, hardMs: 8_000 });
		const terminate = (kind: "pause" | "timeout" | "stop") => {
			if (settled) return;
			interrupted = kind === "pause";
			timedOut = kind === "timeout";
			stopped = kind === "stop";
			forcedError =
				kind === "pause" ? "Agent paused." : kind === "timeout" ? "Agent timed out." : "Agent stopped by user.";
			trySignalChild(child, kind === "pause" ? "SIGINT" : "SIGTERM");
			hardKillTimer = setTimeout(() => {
				if (!settled) trySignalChild(child, "SIGKILL");
			}, 3_000);
			hardKillTimer.unref?.();
		};
		input.activeControls.set(input.index, { state: "running", interrupt: terminate });
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
					appendJsonl(input.artifactJsonlPath, line);
				} catch {
					// Artifact JSONL is optional.
				}
			}
		};

		const startFinalDrain = () => {
			if (childExited || finalDrainTimer || settled) return;
			finalDrainTimer = setTimeout(() => {
				if (settled) return;
				trySignalChild(child, "SIGTERM");
				hardKillTimer = setTimeout(() => {
					if (!settled) trySignalChild(child, "SIGKILL");
				}, 3_000);
				hardKillTimer.unref?.();
			}, 1_000);
			finalDrainTimer.unref?.();
		};

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: ChildEvent;
			try {
				event = JSON.parse(line) as ChildEvent;
			} catch {
				rawOutputTail.push(`${line}\n`);
				input.transcript.writeStdoutLine(line);
				appendRawEvent(line);
				appendRecentOutput(input.statusStep, line);
				writeStatus(input.statusPath, input.status);
				return;
			}
			appendRawEvent(line, event);
			input.transcript.writeChildEvent(event);
			const terminalStop =
				event.type === "message_end" && event.message?.role === "assistant" && terminalAssistantStop(event.message);
			const lifecycle = projectChildLifecycle(event, terminalStop);
			if (lifecycle === "start-drain") startFinalDrain();
			else if (lifecycle === "cancel-drain" && finalDrainTimer) {
				clearTimeout(finalDrainTimer);
				finalDrainTimer = undefined;
			}
			if (event.type === "tool_execution_start" && event.toolName) {
				toolCount += 1;
				input.statusStep.toolCount = toolCount;
				input.statusStep.currentTool = event.toolName;
				input.statusStep.currentToolArgs = extractToolArgsPreview(event.args ?? {});
				input.statusStep.currentToolStartedAt = Date.now();
				input.statusStep.lastActivityAt = Date.now();
				writeStatus(input.statusPath, input.status);
				return;
			}
			if (event.type === "tool_execution_end") {
				input.statusStep.currentTool = undefined;
				input.statusStep.currentToolArgs = undefined;
				input.statusStep.currentToolStartedAt = undefined;
				input.statusStep.lastActivityAt = Date.now();
				writeStatus(input.statusPath, input.status);
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
					turnBudget = turnBudgetState(input.task.turnBudget, usage.turns, decision === "abort");
					input.statusStep.turnBudget = turnBudget;
					if (decision === "abort") {
						turnBudgetExceeded = true;
						forcedError = `Agent exceeded its turn budget (${input.task.turnBudget.maxTurns} + ${input.task.turnBudget.graceTurns}).`;
						trySignalChild(child, "SIGINT");
						hardKillTimer = setTimeout(() => {
							if (!settled) trySignalChild(child, "SIGKILL");
						}, 3_000);
						hardKillTimer.unref?.();
					}
				}
			}
			writeStatus(input.statusPath, input.status);
		};

		const stdoutReader = createBoundedLineReader({
			onLine: processLine,
			onLimit(limit) {
				protocolError = limit;
				forcedError = formatProtocolOutputLimit(limit);
				trySignalChild(child, "SIGTERM");
			},
		});
		const stderrReader = createBoundedLineReader({
			stream: "stderr",
			maxPendingLineBytes: MAX_CHILD_STDERR_BYTES,
			onLine(line) {
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
				input.transcript.writeStderrLine(formatProtocolOutputLimit(limit));
			},
		});
		child.stdout.on("data", (chunk: Buffer) => stdoutReader.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			stderrTail.push(chunk);
			stderrReader.push(chunk);
		});
		child.on("exit", () => {
			childExited = true;
		});
		child.on("error", (error) => {
			forcedError ??= error.message;
		});
		child.on("close", (exitCode, signal) => {
			settled = true;
			input.activeControls.delete(input.index);
			try {
				input.onWriterProcess?.({ state: "none" });
			} catch (error) {
				console.error(`Failed to clear writer process identity for Agent child ${input.index}:`, error);
			}
			if (finalDrainTimer) clearTimeout(finalDrainTimer);
			if (hardKillTimer) clearTimeout(hardKillTimer);
			clearGuard();
			stdoutReader.end();
			stderrReader.end();
			const stderr = stderrTail.text();
			const output = getFinalOutput(messages) || rawOutputTail.text().trim();
			const diagnosticError = readChildToolDiagnosticError(built.toolDiagnosticPath);
			const error =
				forcedError ?? assistantError ?? diagnosticError ?? (exitCode && stderr.trim() ? stderr.trim() : undefined);
			try {
				fs.writeFileSync(input.outputFile, output || error || "", "utf-8");
			} catch {
				// The transcript and result remain authoritative if this convenience file fails.
			}
			cleanupTempDir(built.tempDir);
			resolve({
				exitCode: interrupted || timedOut || stopped || turnBudgetExceeded ? 1 : exitCode,
				signal,
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
				process: {
					processInstanceId,
					kind: "pi-writer",
					attempt: 0,
					closeObservedAt: Date.now(),
					exitCode,
					signal,
				},
			});
		});
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
	deliverScheduledSteering: (index: number) => void;
	consumeScheduledStop: (index: number) => boolean;
	onWriterProcess?: (writer: { state: "none" | "spawning" } | { state: "running"; pid: number }) => void;
}): Promise<BackgroundTaskResult> {
	const { config, task, index, status, statusPath } = input;
	const statusStep = status.steps[index];
	if (!statusStep) throw new Error(`Missing status step for Agent index ${index}.`);
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
	input.deliverScheduledSteering(index);

	const count = taskList(config.work).length;
	const transcript = createTranscript(config, task, index, count);
	transcript.writer.writeInitialUserMessage(task.task);
	if (transcript.artifactPaths && config.artifactConfig?.includeInput !== false) {
		fs.writeFileSync(transcript.artifactPaths.inputPath, `# Task for ${task.agent}\n\n${task.task}`, "utf-8");
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
	for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
		const candidate = candidates[candidateIndex];
		const run = await runChildProcess({
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
		});
		writerProcesses.push({ ...run.process, attempt: candidateIndex });
		const detected = !run.error ? detectSubagentError(run.messages) : undefined;
		const emptyOutput =
			!run.error && run.exitCode === 0 && !run.output.trim() ? "Agent produced no output." : undefined;
		const error =
			run.error ?? (detected?.hasError ? (detected.details ?? detected.errorType) : undefined) ?? emptyOutput;
		const exitCode = error && run.exitCode === 0 ? 1 : run.exitCode;
		const attempt: ModelAttempt = {
			model: candidate ?? run.model ?? "default",
			success: exitCode === 0 && !error,
			exitCode,
			error,
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
			!isRetryableModelFailure(error) ||
			candidateIndex === candidates.length - 1
		)
			break;
		appendRecentOutput(statusStep, formatModelAttemptNote(attempt, candidates[candidateIndex + 1]));
		writeStatus(statusPath, status);
	}

	const endedAt = Date.now();
	const sessionFile = task.sessionFile ?? findLatestSessionFile(childSessionDir);
	const toolBudget: ToolBudgetState | undefined = task.toolBudget
		? toolBudgetState(task.toolBudget, final?.toolCount ?? 0)
		: undefined;
	const success = final?.exitCode === 0 && !final.error;
	const output = final?.output || final?.error || "(no output)";
	const result: BackgroundTaskResult = {
		agent: task.agent,
		...(task.context ? { context: task.context } : {}),
		output,
		success,
		exitCode: final?.exitCode ?? 1,
		...(final?.error ? { error: final.error } : {}),
		...(final?.interrupted ? { interrupted: true } : {}),
		...(final?.timedOut ? { timedOut: true } : {}),
		...(final?.stopped ? { stopped: true } : {}),
		...(final?.turnBudget ? { turnBudget: final.turnBudget } : {}),
		...(final?.turnBudgetExceeded ? { turnBudgetExceeded: true, wrapUpRequested: true } : {}),
		...(toolBudget ? { toolBudget } : {}),
		...(sessionFile ? { sessionFile } : {}),
		...(config.childIntercomTargets?.[index] ? { intercomTarget: config.childIntercomTargets[index] } : {}),
		...((final?.model ?? task.model) ? { model: final?.model ?? task.model } : {}),
		...(task.thinking ? { thinking: task.thinking } : {}),
		...(attemptedModels.length > 0 ? { attemptedModels } : {}),
		modelAttempts: attempts,
		...(costSummary(attempts) ? { totalCost: costSummary(attempts) } : {}),
		...(transcript.artifactPaths ? { artifactPaths: transcript.artifactPaths } : {}),
		transcriptPath: transcript.path,
		...(transcript.writer.getError() ? { transcriptError: transcript.writer.getError() } : {}),
		...(task.launchContractDigest ? { launchContractDigest: task.launchContractDigest } : {}),
		...(task.capabilityCeiling ? { capabilityCeiling: task.capabilityCeiling } : {}),
		writerProcesses,
		writerAttemptCount: attempts.length,
	};

	if (transcript.artifactPaths && config.artifactConfig?.includeOutput !== false) {
		fs.writeFileSync(
			transcript.artifactPaths.outputPath,
			formatOutputArtifactContent({
				output,
				error: result.error,
				transcriptPath: transcript.path,
				metadataPath:
					config.artifactConfig?.includeMetadata === false ? undefined : transcript.artifactPaths.metadataPath,
			}),
			"utf-8",
		);
	}
	if (transcript.artifactPaths && config.artifactConfig?.includeMetadata !== false) {
		fs.writeFileSync(
			transcript.artifactPaths.metadataPath,
			JSON.stringify(
				{
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
			"utf-8",
		);
	}

	statusStep.status = final?.interrupted ? "paused" : final?.stopped ? "stopped" : success ? "complete" : "failed";
	statusStep.endedAt = endedAt;
	statusStep.durationMs = endedAt - startedAt;
	statusStep.exitCode = result.exitCode;
	statusStep.error = result.error;
	statusStep.sessionFile = sessionFile;
	statusStep.model = result.model;
	statusStep.thinking = result.thinking;
	statusStep.attemptedModels = result.attemptedModels;
	statusStep.modelAttempts = attempts;
	statusStep.totalCost = result.totalCost;
	statusStep.timedOut = result.timedOut;
	statusStep.stopped = result.stopped;
	statusStep.turnBudget = result.turnBudget;
	statusStep.turnBudgetExceeded = result.turnBudgetExceeded;
	statusStep.toolBudget = result.toolBudget;
	statusStep.toolBudgetBlocked = result.toolBudgetBlocked;
	statusStep.transcriptPath = transcript.path;
	statusStep.transcriptError = result.transcriptError;
	statusStep.currentTool = undefined;
	statusStep.currentToolArgs = undefined;
	statusStep.currentToolStartedAt = undefined;
	statusStep.activityState = undefined;
	writeStatus(statusPath, status);
	appendDiagnosticEvent(input.eventsPath, {
		type: "subagent.child.completed",
		ts: endedAt,
		runId: config.id,
		index,
		agent: task.agent,
		success,
	});
	return result;
}

async function runConfiguredWork(
	config: BackgroundRunnerConfig,
	onWriterProcess?: (index: number, writer: WriterRuntimeState) => void,
): Promise<void> {
	const startedAt = Date.now();
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
	const scheduledSteering = new Map<number, SteerRequest[]>();
	const scheduledStops = new Set<number>();
	let terminalKind: "pause" | "timeout" | "stop" | undefined;
	const requestTerminal = (kind: "pause" | "timeout" | "stop") => {
		if (terminalKind) return;
		terminalKind = kind;
		schedulingAbort.abort(kind);
		for (const control of activeControls.values()) control.interrupt(kind);
		interruptDescendants(config, kind);
	};

	const persistSteering = () => writeStatus(statusPath, status);
	const routeSteering = (request: SteerRequest, index: number) => {
		try {
			enqueueStepSteer(config.asyncDir, index, request);
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
		persistSteering();
	};
	const deliverScheduledSteering = (index: number) => {
		for (const request of scheduledSteering.get(index) ?? []) routeSteering(request, index);
		scheduledSteering.delete(index);
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
		const requested =
			request.targetIndex !== undefined
				? [request.targetIndex]
				: request.targetIndexes?.length
					? request.targetIndexes
					: [...activeControls.keys()];
		const targets = requested.map((index) => {
			const step = status.steps[index];
			let state: SteeringTargetState;
			let reason: string | undefined;
			if (!step) {
				state = "failed";
				reason = "Agent index is out of range.";
			} else if (activeControls.has(index)) state = "routed";
			else if (step.status === "pending") state = "scheduled";
			else {
				state = "failed";
				reason = `Agent is ${step.status}.`;
			}
			return { index, state, ...(reason ? { reason } : {}) };
		});
		recordSteeringRequest(steeringStatus(status), {
			id: request.id,
			requestedAt: request.ts,
			source: request.source,
			message: request.message,
			targets,
		});
		for (const target of targets) {
			if (target.state === "routed") routeSteering(request, target.index);
			else if (target.state === "scheduled") {
				const pending = scheduledSteering.get(target.index) ?? [];
				pending.push(request);
				scheduledSteering.set(target.index, pending);
			}
		}
		persistSteering();
	};
	const onSteerAck = (ack: SteerAck) => {
		const state = ack.state === "delivered" ? "delivered" : "failed";
		updateSteeringTarget(steeringStatus(status), ack.requestId, ack.index, state, ack.ts, {
			reason: ack.message,
		});
		appendDiagnosticEvent(eventsPath, {
			type: ack.state === "delivered" ? "subagent.steer.delivered" : "subagent.steer.failed",
			ts: ack.ts,
			runId: config.id,
			requestId: ack.requestId,
			index: ack.index,
			message: ack.message,
		});
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
			(task, index) =>
				runResolvedTask({
					config,
					task,
					index,
					taskCwd: worktreeSetup?.worktrees[index]?.agentCwd ?? task.cwd,
					status,
					statusPath,
					eventsPath,
					activeControls,
					deliverScheduledSteering,
					consumeScheduledStop: (index) => scheduledStops.delete(index),
					onWriterProcess: onWriterProcess ? (writer) => onWriterProcess(index, writer) : undefined,
				}),
			{
				signal: schedulingAbort.signal,
				stoppedMessage:
					terminalKind === "timeout"
						? "Agent timed out before it started."
						: terminalKind === "pause"
							? "Agent paused before it started."
							: "Agent stopped before it started.",
			},
		);
		if (terminalKind === "pause") {
			results = results.map((result) =>
				result.stopped && result.error?.includes("before it started")
					? {
							...result,
							stopped: undefined,
							interrupted: true,
							error: "Agent paused before it started.",
							output: "Agent paused before it started.",
						}
					: result,
			);
		} else if (terminalKind === "timeout") {
			results = results.map((result) =>
				result.stopped && result.error?.includes("before it started")
					? {
							...result,
							stopped: undefined,
							timedOut: true,
							error: "Agent timed out before it started.",
							output: "Agent timed out before it started.",
						}
					: result,
			);
		}
		if (worktreeSetup) {
			const diffs = diffWorktrees(
				worktreeSetup,
				config.work.mode === "parallel" ? config.work.group.tasks.map((task) => task.agent) : [],
				path.join(config.asyncDir, "worktree-diffs"),
			);
			const summary = formatWorktreeDiffSummary(diffs);
			const cleanup = cleanupWorktrees(worktreeSetup);
			worktreeEvidence = { diffs, summary, cleanup };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (worktreeSetup && !worktreeEvidence) {
			const diffs = diffWorktrees(
				worktreeSetup,
				config.work.mode === "parallel" ? config.work.group.tasks.map((task) => task.agent) : [],
				path.join(config.asyncDir, "worktree-diffs"),
			);
			worktreeEvidence = {
				diffs,
				summary: formatWorktreeDiffSummary(diffs),
				cleanup: cleanupWorktrees(worktreeSetup),
			};
		}
		results = taskList(config.work).map((task) => ({
			agent: task.agent,
			...(task.context ? { context: task.context } : {}),
			output: message,
			error: message,
			success: false,
			exitCode: 1,
			...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
		}));
	}

	if (timeout) clearTimeout(timeout);
	disposeControl();
	process.off(ASYNC_INTERRUPT_SIGNAL, signalInterrupt);
	const endedAt = Date.now();
	let nestedChildren: import("../../shared/types.ts").NestedRunSummary[] | undefined;
	if (config.nestedRoute) {
		try {
			const registry = projectNestedEvents(config.nestedRoute);
			nestedChildren = registry.children.filter((child) => child.parentRunId === config.id);
			attachRootChildrenToSteps(config.id, status.steps, nestedChildren);
		} catch {
			// The event stream remains available for later projection.
		}
	}
	const completion = createBackgroundCompletion(config, results, startedAt, endedAt, {
		...(nestedChildren?.length ? { nestedChildren } : {}),
		...(worktreeEvidence ? { worktree: worktreeEvidence } : {}),
	});
	status.state = completion.state;
	status.endedAt = endedAt;
	status.lastUpdate = endedAt;
	status.timedOut = completion.timedOut;
	status.stopped = completion.stopped;
	status.error = completion.success ? undefined : results.find((result) => result.error)?.error;
	status.sessionFile = completion.sessionFile;
	status.outputFile = taskList(config.work).length === 1 ? path.join(config.asyncDir, "output-0.log") : undefined;
	closeSteerInbox(config.asyncDir, completion.state);
	writeStatus(statusPath, status);
	writeAtomicJson(config.resultPath, completion);
	appendDiagnosticEvent(eventsPath, {
		type: "subagent.run.completed",
		ts: endedAt,
		runId: config.id,
		state: completion.state,
		success: completion.success,
	});

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
			...(config.revivalLease?.sessionFile ? { sessionFile: config.revivalLease.sessionFile } : {}),
			...(config.revivalLeaseToken ? { revivalLeaseToken: config.revivalLeaseToken } : {}),
		};
		try {
			writeProcessTerminalCandidate(config.asyncDir, candidate);
		} catch (error) {
			console.error(`Failed to write process-terminal candidate for '${config.id}':`, error);
		}
	}
}

async function waitForStartupControl(
	controlPath: string,
	token: string,
	action: "ack" | "proceed",
	timeoutMs = 30_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (fs.existsSync(controlPath)) {
			const payload = JSON.parse(fs.readFileSync(controlPath, "utf-8")) as {
				action?: unknown;
				token?: unknown;
			};
			if (payload.token !== token) throw new Error("Runner startup token does not match the session lease.");
			if (payload.action === action) return;
			if (payload.action !== "ack" && payload.action !== "proceed") {
				throw new Error("Runner startup control action is invalid.");
			}
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for runner startup '${action}'.`);
}

export async function runConfiguredBackground(config: BackgroundRunnerConfig): Promise<void> {
	if (config.version !== 2) throw new Error("Background runner config version must be 2.");
	initializeWriterProcessRegistry(config.asyncDir, config.id, process.pid, taskList(config.work).length);
	let lease: ReturnType<typeof acquireSessionLease> | undefined;
	let startupCommitted = config.revivalLease === undefined;
	const startupPath = path.join(config.asyncDir, "runner-startup.json");
	const ackPath = path.join(config.asyncDir, "runner-startup-ack.json");
	const proceedPath = path.join(config.asyncDir, "runner-startup-proceed.json");
	const releaseOnExit = () => {
		try {
			lease?.release();
		} catch {
			// A dead-owner lease is reclaimed by the next recovery attempt.
		}
	};
	process.once("exit", releaseOnExit);
	try {
		if (config.revivalLease) {
			lease = acquireSessionLease(config.revivalLease);
			config.revivalLeaseToken = lease.owner.token;
			writeAtomicJson(startupPath, {
				state: "ready",
				token: lease.owner.token,
				pid: process.pid,
				owner: lease.owner,
			});
			await waitForStartupControl(ackPath, lease.owner.token, "ack");
			writeAtomicJson(startupPath, {
				state: "acknowledged",
				token: lease.owner.token,
				pid: process.pid,
			});
			await waitForStartupControl(proceedPath, lease.owner.token, "proceed");
			startupCommitted = true;
			fs.rmSync(ackPath, { force: true });
			fs.rmSync(proceedPath, { force: true });
		}
		await runConfiguredWork(config, (index, writer) => {
			updateWriterProcessRegistry(config.asyncDir, index, writer);
			if (lease && index === 0) lease.updateWriter(writer);
		});
	} catch (error) {
		if (config.revivalLease && !startupCommitted) {
			try {
				writeAtomicJson(startupPath, {
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
		process.off("exit", releaseOnExit);
		if (lease) {
			let acknowledged = false;
			try {
				acknowledged = lease.release();
			} catch (error) {
				console.error("Failed to release Agent session lease:", error);
			}
			try {
				markProcessTerminalCandidateLeaseRelease(config.asyncDir, lease.owner.token, acknowledged);
			} catch (error) {
				console.error("Failed to record Agent session lease release:", error);
			}
		}
	}
}

function startConfiguredBackground(config: BackgroundRunnerConfig): void {
	runConfiguredBackground(config).catch((error) => {
		console.error("Background Agent runner error:", error);
		process.exitCode = 1;
	});
}

function startFromConfigPath(configPath: string): void {
	const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as BackgroundRunnerConfig;
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
		console.error("Background Agent runner error:", error);
		process.exitCode = 1;
	}
}
