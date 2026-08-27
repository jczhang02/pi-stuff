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
	NestedRunSummary,
	NestedStepSummary,
	SubagentState,
} from "../../shared/types.ts";
import { deliverStopRequest } from "../background/control-channel.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import {
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
	readonly currentSessionId: string;
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
		sessionId: data.currentSessionId,
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

function nestedState(result?: AgentToolResult<Details>): "running" | "complete" | "failed" | "paused" | "stopped" {
	if (!result) return "running";
	if (result.details.results.some((child) => child.detached)) return "running";
	if (result.details.stopped || result.details.results.some((child) => child.stopped)) return "stopped";
	if (result.details.results.some((child) => child.interrupted)) return "paused";
	return result.isError === true || result.details.results.some((child) => child.exitCode !== 0)
		? "failed"
		: "complete";
}

export function emitNestedLifecycle(
	data: ForegroundProjectionData,
	config: BackgroundRunnerConfig,
	control: ForegroundRunControl,
	tasks: readonly ForegroundTask[],
	startedAt: number,
	result?: AgentToolResult<Details>,
	updated = false,
	liveStatus?: AsyncStatus,
): void {
	if (!data.inheritedNestedRoute || !data.nestedParentAddress) return;
	const now = Date.now();
	const state = nestedState(result);
	const terminalResult = result && state !== "running" ? result : undefined;
	const liveSteps = liveStatus?.steps?.map((step): NestedStepSummary => {
		const projected: NestedStepSummary = { agent: step.agent, status: step.status };
		if (step.delegatedTask) projected.delegatedTask = step.delegatedTask;
		if (step.task) projected.task = step.task;
		if (step.label) projected.description = step.label;
		if (
			step.processTerminal?.state === "observed" &&
			step.processTerminal.instances.some(
				(instance) => instance.kind === "pi-writer" && instance.terminationOrigin === "external",
			)
		) {
			projected.agentStatus = "crashed";
		}
		if (step.sessionFile) projected.sessionFile = step.sessionFile;
		if (step.transcriptPath) projected.transcriptPath = step.transcriptPath;
		if (step.transcriptError) projected.transcriptError = step.transcriptError;
		if (step.activityState) projected.activityState = step.activityState;
		if (step.lastActivityAt) projected.lastActivityAt = step.lastActivityAt;
		if (step.currentTool) projected.currentTool = step.currentTool;
		if (step.currentToolStartedAt) projected.currentToolStartedAt = step.currentToolStartedAt;
		if (step.currentPath) projected.currentPath = step.currentPath;
		if (step.turnCount !== undefined) projected.turnCount = step.turnCount;
		if (step.toolCount !== undefined) projected.toolCount = step.toolCount;
		if (step.error) projected.error = step.error;
		return projected;
	});
	const projectedLiveSteps = liveSteps?.length
		? liveSteps
		: [...(control.activeChildren?.values() ?? [])].map((child): NestedStepSummary => {
				const projected: NestedStepSummary = { agent: child.agent, status: child.status ?? "running" };
				if (child.task) projected.task = child.task;
				if (child.description) projected.description = child.description;
				if (child.currentActivityState) projected.activityState = child.currentActivityState;
				if (child.lastActivityAt) projected.lastActivityAt = child.lastActivityAt;
				if (child.currentTool) projected.currentTool = child.currentTool;
				if (child.currentToolStartedAt) projected.currentToolStartedAt = child.currentToolStartedAt;
				if (child.currentPath) projected.currentPath = child.currentPath;
				if (child.turnCount !== undefined) projected.turnCount = child.turnCount;
				if (child.toolCount !== undefined) projected.toolCount = child.toolCount;
				return projected;
			});
	const nestedChild: NestedRunSummary = {
		id: data.runId,
		parentRunId: data.nestedParentAddress.parentRunId,
		depth: data.nestedParentAddress.depth,
		path: data.nestedParentAddress.path,
		asyncDir: config.asyncDir,
		ownerState: state === "running" ? "live" : "gone",
		mode: data.mode,
		state,
		agents: tasks.map((task) => task.agent),
		startedAt,
		lastUpdate: now,
	};
	if (data.nestedParentAddress.parentStepIndex !== undefined)
		nestedChild.parentStepIndex = data.nestedParentAddress.parentStepIndex;
	if (tasks[0]) nestedChild.agent = tasks[0].agent;
	if (terminalResult) nestedChild.endedAt = now;
	if (result?.details.results.length) {
		nestedChild.steps = result.details.results.map((child, index): NestedStepSummary => {
			const projected: NestedStepSummary = {
				agent: child.agent,
				status: child.detached
					? "running"
					: child.stopped
						? "stopped"
						: child.interrupted
							? "paused"
							: child.exitCode === 0
								? "complete"
								: "failed",
			};
			if (tasks[index]?.task) projected.task = tasks[index].task;
			if (tasks[index]?.description) projected.description = tasks[index].description;
			if (child.crashed) projected.agentStatus = "crashed";
			if (child.sessionFile) projected.sessionFile = child.sessionFile;
			if (child.transcriptPath) projected.transcriptPath = child.transcriptPath;
			if (child.transcriptError) projected.transcriptError = child.transcriptError;
			if (child.error) projected.error = child.error;
			if (child.children?.length) projected.children = child.children;
			return projected;
		});
	} else if (projectedLiveSteps.length) {
		nestedChild.steps = projectedLiveSteps;
	}
	try {
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
		sessionId: data.currentSessionId,
		updatedAt,
		children: result.details.results.map((child, index): ForegroundResumeChild => {
			const rememberedChild: ForegroundResumeChild = {
				agent: child.agent,
				index,
				description: tasks[index]?.description,
				task: tasks[index]?.task,
				startedAt,
				status: child.detached
					? "detached"
					: child.stopped
						? "stopped"
						: child.interrupted
							? "paused"
							: child.exitCode === 0
								? "completed"
								: "failed",
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
