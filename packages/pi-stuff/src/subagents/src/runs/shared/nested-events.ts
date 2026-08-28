import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertPrivateDirectory } from "../../shared/private-directory.ts";
import {
	type AsyncStatus,
	type NestedRunSummary,
	RESULTS_DIR,
	type SubagentRunMode,
	type SubagentState,
} from "../../shared/types.ts";
import { sanitizeProcessTerminal } from "../background/process-terminal.ts";
import * as nestedEventModel from "./nested-events-model.ts";
import type { NestedPathEntry } from "./nested-path.ts";
import * as nestedRegistry from "./nested-registry.ts";
import * as nestedRoute from "./nested-route.ts";
import { sanitizeSummary } from "./nested-summary.ts";

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
	findNestedRunMatchesByIdAuthoritatively,
	projectNestedEvents,
	projectNestedEventsAuthoritatively,
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
	const source = `${asyncDir}/status.json`;
	const ownerState =
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
			? "gone"
			: status.pid
				? "live"
				: "unknown";
	const processTerminal = status.processTerminal
		? sanitizeProcessTerminal(
				status.processTerminal,
				{ runId, runnerProcessInstanceId: status.processTerminal.runnerProcessInstanceId },
				source,
			)
		: undefined;
	const steps = status.steps?.map((step, index) => ({
		...step,
		description: step.label,
		processTerminal: step.processTerminal
			? sanitizeProcessTerminal(
					step.processTerminal,
					{ runId, runnerProcessInstanceId: step.processTerminal.runnerProcessInstanceId },
					`${source} step ${index}`,
				)
			: undefined,
	}));
	const summary = sanitizeSummary({
		...status,
		id: runId,
		parentRunId: fallback.parentRunId,
		parentStepIndex: fallback.parentStepIndex,
		depth: fallback.depth,
		path: fallback.path ?? [fallbackPath],
		asyncDir,
		mode: status.mode ?? fallback.mode,
		ownerState,
		processTerminal,
		startedAt: status.startedAt ?? fallback.ts,
		lastUpdate: status.lastUpdate ?? fallback.ts,
		steps,
	});
	if (!summary) throw new Error(`Invalid nested status projection for '${runId}'.`);
	return summary;
}

export function nestedResultsPath(rootRunId: string, id: string): string {
	nestedRoute.assertSafeNestedId("rootRunId", rootRunId);
	nestedRoute.assertSafeNestedId("id", id);
	return path.join(RESULTS_DIR, "nested", rootRunId, `${id}.json`);
}
