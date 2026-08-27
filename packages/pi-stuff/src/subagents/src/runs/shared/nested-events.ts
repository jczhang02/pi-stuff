import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertPrivateDirectory } from "../../shared/private-directory.ts";
import {
	type AsyncStatus,
	type NestedRunSummary,
	type NestedStepSummary,
	RESULTS_DIR,
	type SubagentRunMode,
	type SubagentState,
} from "../../shared/types.ts";
import { sanitizeProcessTerminal } from "../background/process-terminal.ts";
import * as nestedEventModel from "./nested-events-model.ts";
import type { NestedPathEntry } from "./nested-path.ts";
import * as nestedRegistry from "./nested-registry.ts";
import * as nestedRoute from "./nested-route.ts";
import { MAX_STEPS, sanitizeSummary } from "./nested-summary.ts";

export type { NestedEventRecord, NestedRegistry, NestedRoute } from "./nested-events-model.ts";
export {
	applyNestedEvent,
	attachRootChildrenToSteps,
	findNestedRun,
	hasLiveNestedDescendants,
	nestedWorkIncludesUser,
	parseNestedEventRecords,
} from "./nested-events-model.ts";
export type {
	AuthoritativeNestedProjectionOptions,
	NestedRunMatch,
	NestedRunResolutionScope,
} from "./nested-registry.ts";
export {
	buildNestedRouteIndex,
	finalizeNestedRouteRoot,
	findNestedRouteForRootId,
	findNestedRunById,
	findNestedRunMatchesById,
	findNestedRunMatchesByIdAuthoritatively,
	projectNestedEvents,
	projectNestedEventsAuthoritatively,
	projectNestedRegistryForRoot,
	projectNestedRegistryForRootAuthoritatively,
	readNestedRegistry,
	retireCompletedNestedRoute,
	retireUnusedNestedRoute,
} from "./nested-registry.ts";
export type { NestedRouteEnvironment } from "./nested-route.ts";
export {
	assertSafeNestedId,
	createNestedRoute,
	isSafeNestedId,
	NESTED_EVENTS_DIR,
	nestedRouteEnv,
	recoverRetiredNestedRouteStatus,
	resolveInheritedNestedRouteFromEnv,
	resolveNestedAsyncDir,
	resolveNestedParentAddressFromEnv,
	resolveNestedRouteFromEnv,
	resolvePersistedNestedRoute,
} from "./nested-route.ts";

type NestedEventRecord = nestedEventModel.NestedEventRecord;
type NestedRoute = nestedEventModel.NestedRoute;

function writeRouteRecord(dir: string, ts: number, payload: NestedEventRecord): void {
	const content = `${JSON.stringify(payload)}\n`;
	if (Buffer.byteLength(content, "utf-8") > nestedEventModel.MAX_EVENT_BYTES)
		throw new Error("Nested route record exceeds the maximum size.");
	assertPrivateDirectory(dir);
	const name = `${String(ts).padStart(13, "0")}-${randomUUID()}.json`;
	const tmp = path.join(dir, `.${name}.tmp`);
	fs.writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
	fs.renameSync(tmp, path.join(dir, name));
}

export function writeNestedEvent(
	route: NestedRoute,
	event: Omit<NestedEventRecord, "rootRunId" | "capabilityToken">,
): void {
	nestedRoute.validateRouteStorage(route);
	const child = sanitizeSummary(event.child);
	if (!child || child.id === route.rootRunId) throw new Error("Nested event child failed validation.");
	const record: NestedEventRecord = {
		...event,
		rootRunId: route.rootRunId,
		capabilityToken: route.capabilityToken,
		child: nestedEventModel.compactSummaryForTransport(child, false),
	};
	const sanitized = nestedEventModel.parseRecord(JSON.stringify(record), route);
	if (!sanitized) throw new Error("Nested event record failed validation.");
	writeRouteRecord(route.eventSink, sanitized.ts, sanitized);
}

export function updateForegroundNestedProjection(
	control: SubagentState["foregroundControls"] extends Map<string, infer T> ? T : never,
): void {
	if (!control.nestedRoute) return;
	control.nestedChildren = nestedRegistry.projectNestedEvents(control.nestedRoute).children;
}

export function nestedSummaryFromAsyncStatus(
	status: AsyncStatus,
	asyncDir: string,
	fallback: {
		id: string;
		parentRunId: string;
		parentStepIndex?: number;
		depth: number;
		path?: Array<{ runId: string; stepIndex?: number; agent?: string }>;
		mode?: SubagentRunMode;
		ts: number;
	},
): NestedRunSummary {
	const runId = status.runId || fallback.id;
	const fallbackPath: NestedPathEntry = { runId: fallback.parentRunId };
	if (fallback.parentStepIndex !== undefined) fallbackPath.stepIndex = fallback.parentStepIndex;
	const summary: Partial<NestedRunSummary> = { id: runId };
	if (status.parentRunOrigin) summary.parentRunOrigin = status.parentRunOrigin;
	summary.parentRunId = fallback.parentRunId;
	if (fallback.parentStepIndex !== undefined) summary.parentStepIndex = fallback.parentStepIndex;
	summary.depth = fallback.depth;
	summary.path = fallback.path ?? [fallbackPath];
	summary.asyncDir = asyncDir;
	if (status.pid) summary.pid = status.pid;
	if (status.sessionId) summary.sessionId = status.sessionId;
	summary.mode = status.mode ?? fallback.mode;
	summary.ownerState =
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
			? "gone"
			: status.pid
				? "live"
				: "unknown";
	if (status.processTerminal) {
		const processTerminal = sanitizeProcessTerminal(
			status.processTerminal,
			{ runId, runnerProcessInstanceId: status.processTerminal.runnerProcessInstanceId },
			`${asyncDir}/status.json`,
		);
		if (processTerminal) summary.processTerminal = processTerminal;
	}
	if (status.capabilityCeiling) summary.capabilityCeiling = status.capabilityCeiling;
	if (status.capabilityAudit) summary.capabilityAudit = status.capabilityAudit;
	summary.state = status.state;
	if (status.currentStep !== undefined) summary.currentStep = status.currentStep;
	if (status.activityState) summary.activityState = status.activityState;
	if (status.lastActivityAt !== undefined) summary.lastActivityAt = status.lastActivityAt;
	if (status.currentTool) summary.currentTool = status.currentTool;
	if (status.currentToolStartedAt !== undefined) summary.currentToolStartedAt = status.currentToolStartedAt;
	if (status.currentPath) summary.currentPath = status.currentPath;
	if (status.turnCount !== undefined) summary.turnCount = status.turnCount;
	if (status.toolCount !== undefined) summary.toolCount = status.toolCount;
	if (status.totalTokens) summary.totalTokens = status.totalTokens;
	if (status.timeoutMs !== undefined) summary.timeoutMs = status.timeoutMs;
	if (status.deadlineAt !== undefined) summary.deadlineAt = status.deadlineAt;
	if (status.timedOut !== undefined) summary.timedOut = status.timedOut;
	if (status.stopped !== undefined) summary.stopped = status.stopped;
	if (status.turnBudget) summary.turnBudget = status.turnBudget;
	if (status.turnBudgetExceeded !== undefined) summary.turnBudgetExceeded = status.turnBudgetExceeded;
	if (status.wrapUpRequested !== undefined) summary.wrapUpRequested = status.wrapUpRequested;
	if (status.error) summary.error = status.error;
	summary.startedAt = status.startedAt ?? fallback.ts;
	if (status.endedAt !== undefined) summary.endedAt = status.endedAt;
	summary.lastUpdate = status.lastUpdate ?? fallback.ts;
	if (status.sessionFile) summary.sessionFile = status.sessionFile;
	if (status.steps?.length) {
		summary.steps = status.steps
			.map((step, index) => {
				const projected: Partial<NestedStepSummary> = { agent: step.agent };
				if (step.delegatedTask) projected.delegatedTask = step.delegatedTask;
				if (step.task) projected.task = step.task;
				if (step.label) projected.description = step.label;
				projected.status = step.status;
				if (step.sessionFile) projected.sessionFile = step.sessionFile;
				if (step.transcriptPath) projected.transcriptPath = step.transcriptPath;
				if (step.transcriptError) projected.transcriptError = step.transcriptError;
				if (step.activityState) projected.activityState = step.activityState;
				if (step.lastActivityAt !== undefined) projected.lastActivityAt = step.lastActivityAt;
				if (step.currentTool) projected.currentTool = step.currentTool;
				if (step.currentToolStartedAt !== undefined) projected.currentToolStartedAt = step.currentToolStartedAt;
				if (step.currentPath) projected.currentPath = step.currentPath;
				if (step.turnCount !== undefined) projected.turnCount = step.turnCount;
				if (step.toolCount !== undefined) projected.toolCount = step.toolCount;
				if (step.startedAt !== undefined) projected.startedAt = step.startedAt;
				if (step.endedAt !== undefined) projected.endedAt = step.endedAt;
				if (step.error) projected.error = step.error;
				if (step.timedOut !== undefined) projected.timedOut = step.timedOut;
				if (step.stopped !== undefined) projected.stopped = step.stopped;
				if (step.turnBudget) projected.turnBudget = step.turnBudget;
				if (step.turnBudgetExceeded !== undefined) projected.turnBudgetExceeded = step.turnBudgetExceeded;
				if (step.wrapUpRequested !== undefined) projected.wrapUpRequested = step.wrapUpRequested;
				if (step.processTerminal) {
					const processTerminal = sanitizeProcessTerminal(
						step.processTerminal,
						{ runId, runnerProcessInstanceId: step.processTerminal.runnerProcessInstanceId },
						`${asyncDir}/status.json step ${index}`,
					);
					if (processTerminal) projected.processTerminal = processTerminal;
				}
				if (step.capabilityCeiling) projected.capabilityCeiling = step.capabilityCeiling;
				if (step.capabilityAudit) projected.capabilityAudit = step.capabilityAudit;
				// SAFETY: agent and status are copied from the canonical AsyncStatus step before returning the projection.
				return projected as NestedStepSummary;
			})
			.slice(0, MAX_STEPS);
	}
	// SAFETY: the required nested address and state fields are assigned from canonical status and fallback inputs.
	return summary as NestedRunSummary;
}

export function nestedResultsPath(rootRunId: string, id: string): string {
	nestedRoute.assertSafeNestedId("rootRunId", rootRunId);
	nestedRoute.assertSafeNestedId("id", id);
	return path.join(RESULTS_DIR, "nested", rootRunId, `${id}.json`);
}
