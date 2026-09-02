import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult as CoreAgentToolResult } from "@earendil-works/pi-agent-core";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import type {
	AsyncStatus,
	Details,
	ForegroundResumeChild,
	ForegroundResumeRun,
	ForegroundRunControl,
	NestedRouteInfo,
	SubagentState,
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
import type { BackgroundRunnerConfig } from "../shared/parallel-utils.ts";

type AgentToolResult<T> = CoreAgentToolResult<T> & { isError?: boolean };

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
			if (child.cumulativeUsage) rememberedChild.cumulativeUsage = { ...child.cumulativeUsage };
			if (child.terminalOutcome) rememberedChild.terminalOutcome = structuredClone(child.terminalOutcome);
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
