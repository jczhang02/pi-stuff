import { randomUUID } from "node:crypto";
import { scanAgentReport } from "../runtime/final-report-scanner.ts";
import {
	type IntercomEventBus,
	type NestedRunSummary,
	type PublicNestedRunSummary,
	SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT,
	SUBAGENT_RESULT_INTERCOM_EVENT,
	type SubagentResultIntercomChild,
	type SubagentResultIntercomPayload,
	type SubagentResultStatus,
	type SubagentRunMode,
} from "../shared/types.ts";

export function resolveSubagentResultStatus(input: {
	exitCode?: number;
	success?: boolean;
	state?: string;
	interrupted?: boolean;
	detached?: boolean;
}): SubagentResultStatus {
	if (input.detached) return "detached";
	if (input.state === "stopped") return "stopped";
	if (input.interrupted || input.state === "paused") return "paused";
	if (typeof input.success === "boolean") return input.success ? "completed" : "failed";
	if (input.state === "complete") return "completed";
	if (input.state === "failed") return "failed";
	if (typeof input.exitCode === "number") return input.exitCode === 0 ? "completed" : "failed";
	return "failed";
}

function countStatuses(children: SubagentResultIntercomChild[]): Record<SubagentResultStatus, number> {
	const counts: Record<SubagentResultStatus, number> = {
		completed: 0,
		failed: 0,
		paused: 0,
		stopped: 0,
		detached: 0,
	};
	for (const child of children) {
		counts[child.status] += 1;
	}
	return counts;
}

function formatStatusCounts(counts: Record<SubagentResultStatus, number>): string {
	const parts = [
		counts.completed ? `${counts.completed} completed` : undefined,
		counts.failed ? `${counts.failed} failed` : undefined,
		counts.stopped ? `${counts.stopped} stopped` : undefined,
		counts.paused ? `${counts.paused} paused` : undefined,
		counts.detached ? `${counts.detached} detached` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.length ? parts.join(", ") : "0 results";
}

function resolveGroupedStatus(children: SubagentResultIntercomChild[]): SubagentResultStatus {
	const counts = countStatuses(children);
	if (counts.failed > 0) return "failed";
	if (counts.stopped > 0) return "stopped";
	if (counts.paused > 0) return "paused";
	if (counts.completed > 0) return "completed";
	if (counts.detached > 0) return "detached";
	return "failed";
}

function compactNestedRun(run: NestedRunSummary | PublicNestedRunSummary, depth = 0): PublicNestedRunSummary {
	return {
		id: run.id,
		parentRunId: run.parentRunId,
		...(run.parentStepIndex !== undefined ? { parentStepIndex: run.parentStepIndex } : {}),
		...(run.parentAgent ? { parentAgent: run.parentAgent } : {}),
		depth: run.depth,
		path: run.path.slice(0, 4).map((part) => ({
			runId: part.runId,
			...(part.stepIndex !== undefined ? { stepIndex: part.stepIndex } : {}),
			...(part.agent ? { agent: part.agent } : {}),
		})),
		...(run.asyncDir ? { asyncDir: run.asyncDir } : {}),
		...(run.sessionId ? { sessionId: run.sessionId } : {}),
		...(run.sessionFile ? { sessionFile: run.sessionFile } : {}),
		...(run.intercomTarget ? { intercomTarget: run.intercomTarget } : {}),
		...(run.ownerIntercomTarget ? { ownerIntercomTarget: run.ownerIntercomTarget } : {}),
		...(run.leafIntercomTarget ? { leafIntercomTarget: run.leafIntercomTarget } : {}),
		...(run.ownerState ? { ownerState: run.ownerState } : {}),
		...(run.mode ? { mode: run.mode } : {}),
		state: run.state,
		...(run.agent ? { agent: run.agent } : {}),
		...(run.agents?.length ? { agents: run.agents.slice(0, 12) } : {}),
		...(run.currentStep !== undefined ? { currentStep: run.currentStep } : {}),
		...(run.parallelGroups?.length ? { parallelGroups: run.parallelGroups.slice(0, 8) } : {}),
		...(run.activityState ? { activityState: run.activityState } : {}),
		...(run.lastActivityAt !== undefined ? { lastActivityAt: run.lastActivityAt } : {}),
		...(run.currentTool ? { currentTool: run.currentTool } : {}),
		...(run.currentToolStartedAt !== undefined ? { currentToolStartedAt: run.currentToolStartedAt } : {}),
		...(run.currentPath ? { currentPath: run.currentPath } : {}),
		...(run.turnCount !== undefined ? { turnCount: run.turnCount } : {}),
		...(run.toolCount !== undefined ? { toolCount: run.toolCount } : {}),
		...(run.totalTokens ? { totalTokens: run.totalTokens } : {}),
		...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
		...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
		...(run.lastUpdate !== undefined ? { lastUpdate: run.lastUpdate } : {}),
		...(run.error ? { error: run.error } : {}),
		...(run.steps?.length
			? {
					steps: run.steps.slice(0, 12).map((step) => ({
						agent: step.agent,
						status: step.status,
						...(step.sessionFile ? { sessionFile: step.sessionFile } : {}),
						...(step.activityState ? { activityState: step.activityState } : {}),
						...(step.lastActivityAt !== undefined ? { lastActivityAt: step.lastActivityAt } : {}),
						...(step.currentTool ? { currentTool: step.currentTool } : {}),
						...(step.currentToolStartedAt !== undefined
							? { currentToolStartedAt: step.currentToolStartedAt }
							: {}),
						...(step.currentPath ? { currentPath: step.currentPath } : {}),
						...(step.turnCount !== undefined ? { turnCount: step.turnCount } : {}),
						...(step.toolCount !== undefined ? { toolCount: step.toolCount } : {}),
						...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
						...(step.endedAt !== undefined ? { endedAt: step.endedAt } : {}),
						...(step.error ? { error: step.error } : {}),
						...(depth < 2 && step.children?.length
							? { children: step.children.slice(0, 8).map((child) => compactNestedRun(child, depth + 1)) }
							: {}),
					})),
				}
			: {}),
		...(depth < 2 && run.children?.length
			? { children: run.children.slice(0, 8).map((child) => compactNestedRun(child, depth + 1)) }
			: {}),
	};
}

export function compactNestedResultChildren(
	children: Array<NestedRunSummary | PublicNestedRunSummary> | undefined,
): PublicNestedRunSummary[] | undefined {
	if (!children?.length) return undefined;
	return children.slice(0, 16).map((child) => compactNestedRun(child));
}

export function attachNestedChildrenToResultChildren(
	runId: string,
	children: SubagentResultIntercomChild[],
	nestedChildren: NestedRunSummary[] | undefined,
): SubagentResultIntercomChild[] {
	const compact = compactNestedResultChildren(nestedChildren);
	if (!compact?.length)
		return children.map((child) => ({ ...child, children: compactNestedResultChildren(child.children) }));
	return children.map((child, index) => {
		const childIndex = child.index ?? index;
		const alreadyAttachedIds = new Set(child.children?.map((nested) => nested.id) ?? []);
		const attached = compact.filter(
			(nested) =>
				nested.parentRunId === runId && nested.parentStepIndex === childIndex && !alreadyAttachedIds.has(nested.id),
		);
		const fallbackAttached =
			children.length === 1
				? compact.filter(
						(nested) =>
							nested.parentRunId === runId &&
							nested.parentStepIndex === undefined &&
							!alreadyAttachedIds.has(nested.id),
					)
				: [];
		const merged = compactNestedResultChildren([...(child.children ?? []), ...attached, ...fallbackAttached]);
		return merged?.length ? { ...child, children: merged } : { ...child, children: undefined };
	});
}

interface GroupedResultIntercomMessageInput {
	to: string;
	runId: string;
	mode: SubagentRunMode;
	source: "foreground" | "async";
	children: SubagentResultIntercomChild[];
	asyncId?: string;
	asyncDir?: string;
}

function formatSubagentResultIntercomMessage(input: {
	runId: string;
	mode: SubagentRunMode;
	status: SubagentResultStatus;
	source: "foreground" | "async";
	children: SubagentResultIntercomChild[];
	asyncId?: string;
	asyncDir?: string;
}): string {
	const counts = countStatuses(input.children);
	const lines: string[] = [`Agent results · ${formatStatusCounts(counts)}`];

	for (const [index, child] of input.children.entries()) {
		lines.push("");
		lines.push(`${index + 1}. ${child.agent} — ${child.status}`);
		lines.push(child.summary);
	}

	return lines.join("\n");
}

export function buildSubagentResultIntercomPayload(
	input: GroupedResultIntercomMessageInput,
): SubagentResultIntercomPayload {
	const children = input.children.map((child) => ({
		...child,
		summary: scanAgentReport(child.summary.trim() || "(no output)").text.slice(0, 4_000),
		children: compactNestedResultChildren(child.children),
	}));
	const status = resolveGroupedStatus(children);
	const summary = formatStatusCounts(countStatuses(children));
	const firstChild = children[0];
	const payload: SubagentResultIntercomPayload = {
		to: input.to,
		runId: input.runId,
		mode: input.mode,
		status,
		summary,
		source: input.source,
		children,
		...(input.asyncId ? { asyncId: input.asyncId } : {}),
		...(input.asyncDir ? { asyncDir: input.asyncDir } : {}),
		...(firstChild?.agent ? { agent: firstChild.agent } : {}),
		...(firstChild?.index !== undefined ? { index: firstChild.index } : {}),
		...(firstChild?.artifactPath ? { artifactPath: firstChild.artifactPath } : {}),
		...(firstChild?.sessionPath ? { sessionPath: firstChild.sessionPath } : {}),
		message: "",
	};
	payload.message = formatSubagentResultIntercomMessage(payload);
	return payload;
}

export async function deliverSubagentResultIntercomEvent(
	events: IntercomEventBus,
	payload: SubagentResultIntercomPayload,
	timeoutMs = 500,
): Promise<boolean> {
	return deliverSubagentIntercomMessageEvent(events, payload.to, payload.message, timeoutMs, payload);
}

export async function deliverSubagentIntercomMessageEvent(
	events: IntercomEventBus,
	to: string,
	message: string,
	timeoutMs = 500,
	extra: object = {},
): Promise<boolean> {
	if (typeof events.on !== "function" || typeof events.emit !== "function") return false;
	const requestId = "requestId" in extra && typeof extra.requestId === "string" ? extra.requestId : randomUUID();
	return new Promise((resolve) => {
		let settled = false;
		let unsubscribe: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (delivered: boolean) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			unsubscribe?.();
			resolve(delivered);
		};
		unsubscribe = events.on(SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			const delivery = data as { requestId?: unknown; delivered?: unknown };
			if (delivery.requestId !== requestId) return;
			finish(delivery.delivered === true);
		});
		timer = setTimeout(() => finish(false), timeoutMs);
		try {
			events.emit(SUBAGENT_RESULT_INTERCOM_EVENT, { ...extra, to, message, requestId });
		} catch {
			finish(false);
		}
	});
}
