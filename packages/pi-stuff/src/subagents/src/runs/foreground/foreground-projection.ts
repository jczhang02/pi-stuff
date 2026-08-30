import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult as CoreAgentToolResult } from "@earendil-works/pi-agent-core";
import { isRuntimeNumber } from "../../../../shared/runtime-type.js";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import type {
	ArtifactPaths,
	AsyncStatus,
	Details,
	ForegroundResumeChild,
	ForegroundResumeRun,
	ForegroundRunControl,
	NestedRouteInfo,
	NestedRunSummary,
	SingleResult,
	SubagentState,
	Usage,
} from "../../shared/types.ts";
import { deliverStopRequest } from "../background/control-channel.ts";
import type { AsyncExecutionContext } from "../background/resolved-task.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import {
	nestedSummaryFromAsyncStatus,
	type resolveNestedParentAddressFromEnv,
	updateForegroundNestedProjection,
	writeNestedEvent,
} from "../shared/nested-events.ts";
import { sanitizeSummary } from "../shared/nested-summary.ts";
import type { BackgroundRunnerConfig, BackgroundTaskResult, RunnerAgentTask } from "../shared/parallel-utils.ts";

type AgentToolResult<T> = CoreAgentToolResult<T> & { isError?: boolean };

export interface ForegroundCompletion {
	id: string;
	runId: string;
	mode: "single" | "parallel";
	state: "complete" | "failed" | "stopped" | "paused";
	success: boolean;
	stopped?: boolean;
	timedOut?: boolean;
	interrupted?: boolean;
	results: BackgroundTaskResult[];
	nestedChildren?: NestedRunSummary[];
}

function runnerTasks(config: BackgroundRunnerConfig): RunnerAgentTask[] {
	return config.work.mode === "single" ? [config.work.task] : config.work.group.tasks;
}

function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

function resultUsage(result: BackgroundTaskResult): Usage {
	const usage = emptyUsage();
	for (const attempt of result.modelAttempts ?? []) {
		if (!attempt.usage) continue;
		usage.input += attempt.usage.input;
		usage.output += attempt.usage.output;
		usage.cacheRead += attempt.usage.cacheRead;
		usage.cacheWrite += attempt.usage.cacheWrite;
		usage.cost += attempt.usage.cost;
		usage.turns += attempt.usage.turns;
	}
	return usage;
}

function childrenForResult(
	nestedChildren: NestedRunSummary[] | undefined,
	index: number,
	directCount: number,
): NestedRunSummary[] | undefined {
	if (!nestedChildren?.length) return undefined;
	const exact = nestedChildren.filter((child) => child.parentStepIndex === index);
	if (exact.length > 0) return exact;
	return directCount === 1 ? nestedChildren : undefined;
}

function resultWasExternalCrash(result: BackgroundTaskResult): boolean {
	if (
		result.success ||
		result.interrupted ||
		result.timedOut ||
		result.stopped ||
		result.turnBudgetExceeded ||
		result.toolBudgetBlocked
	) {
		return false;
	}
	const writers = result.writerProcesses ?? [];
	const finalAttempt = writers.reduce(
		(latest, process) => Math.max(latest, process.attempt),
		Number.NEGATIVE_INFINITY,
	);
	return writers.some((process) => process.attempt === finalAttempt && process.terminationOrigin === "external");
}

function toSingleResult(
	result: BackgroundTaskResult,
	task: RunnerAgentTask,
	index: number,
	directCount: number,
	nestedChildren: NestedRunSummary[] | undefined,
): SingleResult {
	const childResults = childrenForResult(nestedChildren, index, directCount);
	const crashed = resultWasExternalCrash(result);
	const projected: SingleResult = {
		agent: result.agent,
		task: task.task,
		exitCode: result.exitCode ?? 1,
		usage: resultUsage(result),
		finalOutput: result.output,
	};
	if (task.cwd) projected.cwd = task.cwd;
	if (result.context) projected.context = result.context;
	if (result.contextUsage) projected.contextUsage = result.contextUsage;
	if (result.interrupted) projected.interrupted = true;
	if (result.timedOut) projected.timedOut = true;
	if (result.stopped) projected.stopped = true;
	if (crashed) projected.crashed = true;
	if (result.turnBudget) projected.turnBudget = result.turnBudget;
	if (result.turnBudgetExceeded) projected.turnBudgetExceeded = true;
	if (result.wrapUpRequested) projected.wrapUpRequested = true;
	if (result.contextNudgeObserved) projected.contextNudgeObserved = true;
	if (result.toolBudget) projected.toolBudget = result.toolBudget;
	if (result.toolBudgetBlocked) projected.toolBudgetBlocked = true;
	if (result.model) projected.model = result.model;
	if (result.thinking) projected.thinking = result.thinking;
	if (result.attemptedModels) projected.attemptedModels = [...result.attemptedModels];
	if (result.modelAttempts) projected.modelAttempts = result.modelAttempts.map((attempt) => ({ ...attempt }));
	if (result.error) projected.error = result.error;
	if (result.sessionFile) projected.sessionFile = result.sessionFile;
	if (result.artifactPaths) projected.artifactPaths = { ...result.artifactPaths };
	if (result.transcriptPath) projected.transcriptPath = result.transcriptPath;
	if (result.transcriptError) projected.transcriptError = result.transcriptError;
	if (result.launchContractDigest) projected.launchContractDigest = result.launchContractDigest;
	if (result.capabilityCeiling) projected.capabilityCeiling = result.capabilityCeiling;
	if (result.capabilityAudit) projected.capabilityAudit = result.capabilityAudit;
	if (childResults) projected.children = childResults;
	return projected;
}

function contextSummary(results: readonly SingleResult[]): Details["context"] {
	const contexts = new Set(results.map((result) => result.context).filter(Boolean));
	if (contexts.size === 0) return undefined;
	if (contexts.size > 1) return "mixed";
	return contexts.values().next().value;
}

function artifactDetails(results: readonly SingleResult[]): Details["artifacts"] {
	const files = results
		.map((result) => result.artifactPaths)
		.filter((value): value is ArtifactPaths => value !== undefined);
	if (files.length === 0) return undefined;
	return { dir: configArtifactDir(files), files };
}

function configArtifactDir(files: readonly ArtifactPaths[]): string {
	const first = files[0];
	if (!first) return "";
	return path.dirname(first.outputPath);
}

function formatResult(results: readonly SingleResult[]): string {
	return results
		.map((result, index) => {
			const state = result.detached
				? "detached"
				: result.stopped
					? "stopped"
					: result.interrupted
						? "paused"
						: result.crashed
							? "crashed"
							: result.exitCode === 0
								? "completed"
								: "failed";
			const heading =
				results.length === 1 ? `Agent ${result.agent} ${state}.` : `${index + 1}. ${result.agent} — ${state}`;
			const contextNudge = result.contextNudgeObserved
				? "\nContext housekeeping observed: magic-context:ceiling-nudge."
				: "";
			return `${heading}${contextNudge}\n${result.finalOutput || result.error || "(no report)"}`;
		})
		.join("\n\n");
}

export function foregroundStatusIsTerminal(status: AsyncStatus): boolean {
	return (
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
	);
}

function stepWasExternalCrash(step: NonNullable<AsyncStatus["steps"]>[number]): boolean {
	if (step.agentStatus === "crashed") return true;
	return Boolean(
		step.processTerminal?.state === "observed" &&
			step.processTerminal.instances.some(
				(instance) => instance.kind === "pi-writer" && instance.terminationOrigin === "external",
			),
	);
}

export function projectForegroundStatus(
	config: BackgroundRunnerConfig,
	status: AsyncStatus,
	detachedReason?: string,
): AgentToolResult<Details> {
	const configuredTasks = runnerTasks(config);
	const runIsTerminal = foregroundStatusIsTerminal(status);
	const results = (status.steps ?? []).map((step, index): SingleResult => {
		const task = configuredTasks[index];
		if (!task) throw new Error("Foreground Agent status has no configured task.");
		const detached = !runIsTerminal && (step.status === "pending" || step.status === "running");
		const paused = step.status === "paused";
		const stopped = step.status === "stopped" || step.stopped === true;
		const completed = step.status === "complete" || step.status === "completed";
		const output = step.recentOutput?.join("\n") ?? "";
		const projected: SingleResult = {
			agent: step.agent,
			task: step.task ?? task.task,
			cwd: task.cwd,
			exitCode: isRuntimeNumber(step.exitCode) ? step.exitCode : completed ? 0 : 1,
			usage: {
				input: step.tokens?.input ?? 0,
				output: step.tokens?.output ?? 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				turns: step.turnCount ?? 0,
			},
			finalOutput: output,
		};
		if (step.context) projected.context = step.context;
		if (step.contextUsage) projected.contextUsage = step.contextUsage;
		if (detached) {
			projected.detached = true;
			projected.detachedReason = detachedReason ?? "Foreground owner recovery pending.";
		}
		if (paused) projected.interrupted = true;
		if (stopped) projected.stopped = true;
		if (step.timedOut) projected.timedOut = true;
		if (stepWasExternalCrash(step)) projected.crashed = true;
		if (step.turnBudget) projected.turnBudget = step.turnBudget;
		if (step.turnBudgetExceeded) projected.turnBudgetExceeded = true;
		if (step.wrapUpRequested) projected.wrapUpRequested = true;
		if (step.toolBudget) projected.toolBudget = step.toolBudget;
		if (step.toolBudgetBlocked) projected.toolBudgetBlocked = true;
		if (step.model) projected.model = step.model;
		if (step.thinking) projected.thinking = step.thinking;
		if (step.attemptedModels) projected.attemptedModels = [...step.attemptedModels];
		if (step.modelAttempts) projected.modelAttempts = step.modelAttempts.map((attempt) => ({ ...attempt }));
		if (step.error) projected.error = step.error;
		else if (!detached && status.error) projected.error = status.error;
		if (step.sessionFile) projected.sessionFile = step.sessionFile;
		if (step.transcriptPath) projected.transcriptPath = step.transcriptPath;
		if (step.transcriptError) projected.transcriptError = step.transcriptError;
		if (step.launchContractDigest) projected.launchContractDigest = step.launchContractDigest;
		if (step.capabilityCeiling) projected.capabilityCeiling = step.capabilityCeiling;
		if (step.capabilityAudit) projected.capabilityAudit = step.capabilityAudit;
		if (step.children?.length) projected.children = step.children;
		return projected;
	});
	const artifacts = artifactDetails(results);
	const context = contextSummary(results);
	const details: Details = {
		mode: config.work.mode,
		runId: config.id,
		cwd: config.cwd,
		results,
	};
	if (context) details.context = context;
	if (artifacts) details.artifacts = artifacts;
	if (status.timedOut) details.timedOut = true;
	if (status.stopped) details.stopped = true;
	if (config.timeoutMs !== undefined) details.timeoutMs = config.timeoutMs;
	if (config.deadlineAt !== undefined) details.deadlineAt = config.deadlineAt;
	if (config.capabilityCeiling) details.capabilityCeiling = config.capabilityCeiling;
	const projected: AgentToolResult<Details> = {
		content: [{ type: "text", text: formatResult(results) }],
		details,
	};
	if (status.state !== "complete") projected.isError = true;
	return projected;
}

export function projectForegroundCompletion(
	config: BackgroundRunnerConfig,
	completion: ForegroundCompletion,
): AgentToolResult<Details> {
	const configuredTasks = runnerTasks(config);
	const results = completion.results.map((result, index) => {
		const configuredTask = configuredTasks[index] ?? configuredTasks[0];
		if (!configuredTask) throw new Error("Foreground Agent result has no configured task.");
		return toSingleResult(result, configuredTask, index, completion.results.length, completion.nestedChildren);
	});
	const artifacts = artifactDetails(results);
	const context = contextSummary(results);
	const details: Details = {
		mode: completion.mode,
		runId: completion.runId,
		cwd: config.cwd,
		results,
	};
	if (context) details.context = context;
	if (artifacts) details.artifacts = artifacts;
	if (completion.timedOut) details.timedOut = true;
	if (completion.stopped) details.stopped = true;
	if (config.timeoutMs !== undefined) details.timeoutMs = config.timeoutMs;
	if (config.deadlineAt !== undefined) details.deadlineAt = config.deadlineAt;
	if (config.capabilityCeiling) details.capabilityCeiling = config.capabilityCeiling;
	const projected: AgentToolResult<Details> = {
		content: [{ type: "text", text: formatResult(results) }],
		details,
	};
	if (!completion.success) projected.isError = true;
	return projected;
}

export interface ForegroundTask {
	readonly agent: string;
	readonly description?: string | undefined;
	readonly task: string;
}

export interface ForegroundProjectionData {
	readonly mode: "single" | "parallel";
	readonly effectiveCwd: string;
	readonly executionContext: Pick<AsyncExecutionContext, "currentSessionId">;
	readonly runId: string;
	readonly context: ContextMode;
	readonly nestedRoute: NestedRouteInfo;
	readonly inheritedNestedRoute?: NestedRouteInfo | undefined;
	readonly nestedParentAddress?: ReturnType<typeof resolveNestedParentAddressFromEnv>;
}

export function createForegroundControl(
	data: ForegroundProjectionData,
	config: BackgroundRunnerConfig,
	tasks: readonly ForegroundTask[],
): ForegroundRunControl {
	const now = Date.now();
	const activeChildren = new Map(
		tasks.map((task, index) => [
			index,
			{
				index,
				agent: task.agent,
				description: task.description,
				task: task.task,
				startedAt: now,
				updatedAt: now,
				status: "running" as const,
				interrupt: () => {
					try {
						deliverStopRequest({
							asyncDir: config.asyncDir,
							source: "foreground-ui",
							targetIndex: index,
						});
						return true;
					} catch {
						return false;
					}
				},
			},
		]),
	);
	const control: ForegroundRunControl = {
		runId: data.runId,
		sessionId: data.executionContext.currentSessionId,
		mode: data.mode,
		startedAt: now,
		updatedAt: now,
		cwd: data.effectiveCwd,
		activeChildren,
		nestedRoute: data.nestedRoute,
		interrupt: () => {
			try {
				deliverStopRequest({ asyncDir: config.asyncDir, source: "foreground-ui" });
				return true;
			} catch {
				return false;
			}
		},
	};
	if (tasks[0]?.description) control.description = tasks[0].description;
	if (tasks[0]?.task) control.task = tasks[0].task;
	return control;
}

export function updateForegroundControl(control: ForegroundRunControl, status: AsyncStatus): void {
	control.updatedAt = status.lastUpdate ?? Date.now();
	for (const [index, step] of (status.steps ?? []).entries()) {
		const child = control.activeChildren?.get(index);
		if (!child) continue;
		child.status = step.status;
		child.updatedAt = step.endedAt ?? status.lastUpdate ?? Date.now();
		child.currentActivityState = step.activityState;
		child.lastActivityAt = step.lastActivityAt;
		child.currentTool = step.currentTool;
		child.currentToolStartedAt = step.currentToolStartedAt;
		child.currentPath = step.currentPath;
		child.turnCount = step.turnCount;
		child.contextUsage = step.contextUsage;
		child.toolCount = step.toolCount;
	}
}

export function refreshForegroundNestedProjection(control: ForegroundRunControl): void {
	try {
		updateForegroundNestedProjection(control);
	} catch {
		// A nested route can retire while its final event is being projected.
	}
}

function nestedState(result?: AgentToolResult<Details>): AsyncStatus["state"] {
	if (!result) return "running";
	if (result.details.results.some((child) => child.detached)) return "running";
	if (result.details.stopped || result.details.results.some((child) => child.stopped)) return "stopped";
	if (result.details.results.some((child) => child.interrupted)) return "paused";
	return result.isError === true || result.details.results.some((child) => child.exitCode !== 0)
		? "failed"
		: "complete";
}

function foregroundResultStatus(child: Details["results"][number]): ForegroundResumeChild["status"] {
	return child.detached
		? "detached"
		: child.stopped
			? "stopped"
			: child.interrupted
				? "paused"
				: child.exitCode === 0
					? "completed"
					: "failed";
}

function nestedResultSteps(status: AsyncStatus, result?: AgentToolResult<Details>): AsyncStatus["steps"] {
	if (!result?.details.results.length) return status.steps;
	return result.details.results.map((child, index) => {
		const resultStatus = foregroundResultStatus(child);
		const nestedStatus =
			resultStatus === "detached" ? "running" : resultStatus === "completed" ? "complete" : resultStatus;
		const projected: NonNullable<AsyncStatus["steps"]>[number] = {
			...status.steps?.[index],
			...child,
			agent: child.agent,
			status: nestedStatus,
		};
		if (child.crashed) projected.agentStatus = "crashed";
		return projected;
	});
}

export function emitNestedLifecycle(
	data: ForegroundProjectionData,
	config: BackgroundRunnerConfig,
	startedAt: number,
	status: AsyncStatus,
	result?: AgentToolResult<Details>,
	updated = false,
): void {
	if (!data.inheritedNestedRoute || !data.nestedParentAddress) return;
	const now = Date.now();
	const state = nestedState(result);
	const terminalResult = result && state !== "running" ? result : undefined;
	try {
		const projectedStatus: AsyncStatus = {
			...status,
			runId: data.runId,
			mode: data.mode,
			state,
			startedAt,
			endedAt: terminalResult ? now : undefined,
			lastUpdate: now,
			steps: nestedResultSteps(status, result),
		};
		const fallback: Parameters<typeof nestedSummaryFromAsyncStatus>[2] = {
			id: data.runId,
			parentRunId: data.nestedParentAddress.parentRunId,
			depth: data.nestedParentAddress.depth,
			path: data.nestedParentAddress.path,
			mode: data.mode,
			ts: now,
		};
		if (data.nestedParentAddress.parentStepIndex !== undefined)
			fallback.parentStepIndex = data.nestedParentAddress.parentStepIndex;
		const nestedChild = nestedSummaryFromAsyncStatus(projectedStatus, config.asyncDir, fallback);
		const agents = projectedStatus.steps?.map((step) => step.agent) ?? [];
		const agent = agents[0];
		if (agent) {
			nestedChild.agent = agent;
			nestedChild.agents = agents;
		}
		const event: Parameters<typeof writeNestedEvent>[1] = {
			type: terminalResult
				? "subagent.nested.completed"
				: result || updated
					? "subagent.nested.updated"
					: "subagent.nested.started",
			ts: now,
			parentRunId: data.nestedParentAddress.parentRunId,
			child: nestedChild,
		};
		if (data.nestedParentAddress.parentStepIndex !== undefined)
			event.parentStepIndex = data.nestedParentAddress.parentStepIndex;
		writeNestedEvent(data.inheritedNestedRoute, event);
	} catch (error) {
		reportAgentDiagnostic("Failed to record nested foreground Agent lifecycle:", error);
	}
}

export function rememberForegroundResult(
	state: SubagentState,
	data: ForegroundProjectionData,
	result: AgentToolResult<Details>,
	tasks: readonly ForegroundTask[],
	startedAt: number,
	asyncDir: string,
): void {
	const updatedAt = Date.now();
	state.foregroundRuns ??= new Map();
	const remembered: ForegroundResumeRun = {
		runId: data.runId,
		mode: data.mode,
		cwd: data.effectiveCwd,
		asyncDir,
		sessionId: data.executionContext.currentSessionId,
		updatedAt,
		children: result.details.results.map((child, index): ForegroundResumeChild => {
			const rememberedChild: ForegroundResumeChild = {
				agent: child.agent,
				index,
				description: tasks[index]?.description,
				task: tasks[index]?.task,
				startedAt,
				status: foregroundResultStatus(child),
				exitCode: child.exitCode,
				updatedAt,
			};
			if (child.cwd) rememberedChild.cwd = child.cwd;
			if (child.context) rememberedChild.context = child.context;
			if (child.contextUsage) rememberedChild.contextUsage = child.contextUsage;
			if (child.crashed) rememberedChild.crashed = true;
			if (child.sessionFile) rememberedChild.sessionFile = child.sessionFile;
			if (child.model) rememberedChild.model = child.model;
			if (child.thinking) rememberedChild.thinking = child.thinking;
			if (child.error) rememberedChild.error = child.error;
			if (child.detachedReason) rememberedChild.detachedReason = child.detachedReason;
			if (child.finalOutput) rememberedChild.finalOutput = child.finalOutput;
			if (child.artifactPaths) rememberedChild.artifactPaths = child.artifactPaths;
			if (child.transcriptPath) rememberedChild.transcriptPath = child.transcriptPath;
			if (child.transcriptError) rememberedChild.transcriptError = child.transcriptError;
			if (child.launchContractDigest) rememberedChild.launchContractDigest = child.launchContractDigest;
			if (child.capabilityCeiling) rememberedChild.capabilityCeiling = child.capabilityCeiling;
			if (child.capabilityAudit) rememberedChild.capabilityAudit = child.capabilityAudit;
			if (child.children?.length) {
				rememberedChild.children = child.children
					.map((nested) => sanitizeSummary(nested))
					.filter((nested): nested is NonNullable<typeof nested> => Boolean(nested));
			}
			return rememberedChild;
		}),
	};
	if (fs.existsSync(path.dirname(data.nestedRoute.eventSink))) remembered.nestedRoute = data.nestedRoute;
	state.foregroundRuns.set(data.runId, remembered);
	while (state.foregroundRuns.size > 200) {
		const oldest = [...state.foregroundRuns.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
		if (!oldest) break;
		state.foregroundRuns.delete(oldest.runId);
	}
}
