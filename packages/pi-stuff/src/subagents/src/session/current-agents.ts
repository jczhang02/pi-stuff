import { readNestedRegistry, resolveNestedAsyncDir, sanitizeSummary } from "../runs/shared/nested-events.ts";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import { boundedTerminalLine, isTaskOnlyAgentText, resolveDisplayDescription } from "../shared/display-description.ts";
import { readOwnedFileTail } from "../shared/private-directory.ts";
import type { SubagentState } from "../shared/types.ts";

export type AgentStatus =
	| "queued"
	| "running"
	| "waiting_supervisor"
	| "stopping"
	| "completed"
	| "failed"
	| "agent_stopped"
	| "user_cancelled"
	| "crashed"
	| "resuming";

export interface AgentTranscriptTarget {
	readonly key: string;
	readonly error: string | null;
	readonly task: string;
	/** Trusted deterministic nested run directory used only as a locator fallback. */
	readonly asyncDir?: string | null;
	readonly childIndex?: number;
	readonly sessionFile: string | null;
	readonly transcriptPath: string | null;
	readonly savedOutputPath: string | null;
	readonly partialResult: string | null;
}

export interface AgentNestedDetail extends AgentTranscriptTarget {
	readonly runId: string;
	readonly childIndex: number;
	readonly parentRunId: string | null;
	readonly depth: number;
	readonly name: string;
	readonly description: string;
	readonly task: string;
	readonly status: AgentStatus;
	readonly nestedCount: number;
}

export interface AgentRow extends AgentTranscriptTarget {
	readonly runId: string;
	readonly childIndex: number;
	readonly sessionId: string;
	readonly name: string;
	readonly description: string;
	readonly task: string;
	readonly status: AgentStatus;
	readonly startedAt: number | null;
	readonly endedAt: number | null;
	readonly elapsedMs: number | null;
	readonly partialResult: string | null;
	readonly nestedCount: number;
	readonly nestedAgents: readonly AgentNestedDetail[];
	readonly sessionFile: string | null;
	readonly transcriptPath: string | null;
	readonly savedOutputPath: string | null;
}

export interface AgentSessionSnapshot {
	readonly sessionId: string | null;
	readonly revision: number;
	readonly rows: readonly AgentRow[];
}

export type AgentControlAction =
	| { readonly type: "inspect"; readonly key: string }
	| { readonly type: "stop"; readonly key: string }
	| { readonly type: "steer"; readonly key: string; readonly message: string }
	| { readonly type: "resume"; readonly key: string; readonly message?: string };

export interface AgentControlResult {
	readonly type: AgentControlAction["type"];
	readonly key: string;
	readonly acknowledged: boolean;
	readonly message: string;
	readonly status: AgentStatus | null;
}

export type AgentControlAcknowledgement =
	| boolean
	| {
			readonly acknowledged: boolean;
			readonly message?: string;
			readonly status?: AgentStatus;
	  };

export interface CurrentAgentsOptions {
	readonly inspect: (row: AgentRow) => AgentControlAcknowledgement | Promise<AgentControlAcknowledgement>;
	readonly steer: (
		row: AgentRow,
		message: string,
	) => AgentControlAcknowledgement | Promise<AgentControlAcknowledgement>;
	readonly stop: (row: AgentRow) => AgentControlAcknowledgement | Promise<AgentControlAcknowledgement>;
	readonly resume: (
		row: AgentRow,
		message?: string,
	) => AgentControlAcknowledgement | Promise<AgentControlAcknowledgement>;
	readonly subscribeState?: (listener: () => void) => () => void;
	readonly now?: () => number;
}

type CurrentAgentsState = Pick<
	SubagentState,
	"currentSessionId" | "asyncJobs" | "recentAgentJobs" | "foregroundControls" | "foregroundRuns"
>;

type AsyncJob = SubagentState["asyncJobs"] extends Map<string, infer Job> ? Job : never;
type ForegroundControl = SubagentState["foregroundControls"] extends Map<string, infer Control> ? Control : never;
type ForegroundRun = NonNullable<SubagentState["foregroundRuns"]> extends Map<string, infer Run> ? Run : never;

interface RowDraft {
	key: string;
	runId: string;
	childIndex: number;
	sessionId: string;
	name: string;
	description: string;
	task: string;
	status: AgentStatus;
	error: string | null;
	startedAt: number | null;
	endedAt: number | null;
	partialResult: string | null;
	nestedCount: number;
	nestedAgents: AgentNestedDetail[];
	sessionFile: string | null;
	transcriptPath: string | null;
	savedOutputPath: string | null;
}

interface StatusOverride {
	readonly sourceStatus: AgentStatus;
	readonly status: AgentStatus;
}

const ACTIVE_SOURCE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_SOURCE_STATUSES = new Set(["complete", "completed", "failed", "paused", "stopped"]);
const TERMINAL_STATUSES = new Set<AgentStatus>(["completed", "failed", "agent_stopped", "user_cancelled", "crashed"]);
const RESUMABLE_STATUSES = new Set<AgentStatus>(["completed", "failed", "agent_stopped", "crashed"]);
const STATUS_ORDER: Record<AgentStatus, number> = {
	waiting_supervisor: 0,
	stopping: 1,
	resuming: 2,
	running: 3,
	queued: 4,
	crashed: 5,
	failed: 6,
	user_cancelled: 7,
	agent_stopped: 8,
	completed: 9,
};
const MAX_PARTIAL_RESULT_CHARS = 4_000;
const MAX_TERMINAL_ERROR_CHARS = 1_000;
const MAX_TASK_CHARS = 500;
const MAX_DYNAMIC_SOURCE_CODE_UNITS = 4_096;
const MAX_LEGACY_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const MAX_LEGACY_TRANSCRIPT_CACHE_ENTRIES = 128;
const legacyTranscriptCache = new Map<
	string,
	{
		readonly dev: number;
		readonly ino: number;
		readonly mtimeMs: number;
		readonly size: number;
		readonly complete: boolean;
	}
>();

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const bounded = value.slice(0, MAX_DYNAMIC_SOURCE_CODE_UNITS);
	return bounded.trim() ? bounded : null;
}

function locatorString(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	return value.length <= MAX_DYNAMIC_SOURCE_CODE_UNITS ? value : null;
}

function firstLocator(...values: unknown[]): string | null {
	for (const value of values) {
		const locator = locatorString(value);
		if (locator) return locator;
	}
	return null;
}

function boundedText(value: unknown, limit: number): string | null {
	const text = optionalString(value)?.trim();
	if (!text) return null;
	return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function terminalError(status: AgentStatus, ...values: unknown[]): string | null {
	if (status !== "failed" && status !== "crashed") return null;
	for (const value of values) {
		const record = asRecord(value);
		for (const candidate of [record["error"], asRecord(record["execution"])["error"]]) {
			const safe = boundedTerminalLine(candidate);
			if (safe) return boundedText(safe, MAX_TERMINAL_ERROR_CHARS);
		}
	}
	return null;
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		const text = optionalString(value);
		if (text) return text;
	}
	return null;
}

function rowKey(runId: string, childIndex: number): string {
	return `${runId}:${childIndex}`;
}

function sourceStatus(value: unknown): string {
	return typeof value === "string" ? value : "running";
}

function isSupervisorWait(record: Record<string, unknown>): boolean {
	const waitingFor = firstString(record["waitingFor"], record["attentionKind"], record["waitReason"])?.toLowerCase();
	const currentTool = optionalString(record["currentTool"])?.toLowerCase();
	return (
		waitingFor === "supervisor" ||
		currentTool === "contact_supervisor" ||
		currentTool === "intercom" ||
		record["activityState"] === "needs_attention"
	);
}

function processHasExternalSignal(record: Record<string, unknown>): boolean {
	const terminal = asRecord(record["processTerminal"]);
	const writers = (Array.isArray(terminal["instances"]) ? terminal["instances"] : [])
		.map(asRecord)
		.filter((instance) => instance["kind"] === "pi-writer" && Number.isInteger(instance["attempt"]));
	const finalAttempt = writers.reduce(
		(latest, instance) => Math.max(latest, instance["attempt"] as number),
		Number.NEGATIVE_INFINITY,
	);
	return writers.some(
		(instance) => instance["attempt"] === finalAttempt && instance["terminationOrigin"] === "external",
	);
}

function processHasAmbiguousLegacyFinalDrain(record: Record<string, unknown>): boolean {
	const terminal = asRecord(record["processTerminal"]);
	if (terminal["state"] !== "observed") return false;
	const instances = Array.isArray(terminal["instances"])
		? terminal["instances"]
				.map(asRecord)
				.filter((instance) => instance["kind"] === "pi-writer" && Number.isInteger(instance["attempt"]))
		: [];
	const finalAttempt = instances.reduce(
		(latest, instance) => Math.max(latest, instance["attempt"] as number),
		Number.NEGATIVE_INFINITY,
	);
	return (
		instances.length > 0 &&
		instances.some(
			(instance) =>
				instance["attempt"] === finalAttempt &&
				instance["terminationOrigin"] === undefined &&
				(instance["signal"] === "SIGTERM" || (instance["signal"] === null && instance["exitCode"] === 143)),
		)
	);
}

function transcriptEndsWithCompleteAssistantReport(filePath: string): boolean {
	try {
		const tail = readOwnedFileTail(filePath, MAX_LEGACY_TRANSCRIPT_TAIL_BYTES);
		if (tail.size <= 0) return false;
		const cached = legacyTranscriptCache.get(filePath);
		if (
			cached?.size === tail.size &&
			cached.mtimeMs === tail.mtimeMs &&
			cached.dev === tail.dev &&
			cached.ino === tail.ino
		)
			return cached.complete;

		const lastLine = tail.text.trimEnd().split("\n").at(-1);
		let complete = false;
		if (lastLine) {
			const record = asRecord(JSON.parse(lastLine));
			const message = asRecord(record["message"]);
			complete =
				record["recordType"] === "message" &&
				record["sourceEventType"] === "message_end" &&
				record["role"] === "assistant" &&
				record["stopReason"] === "stop" &&
				record["isError"] !== true &&
				!optionalString(record["error"]) &&
				!optionalString(record["errorMessage"]) &&
				!optionalString(message["errorMessage"]) &&
				Boolean(optionalString(record["text"]));
		}
		legacyTranscriptCache.set(filePath, {
			dev: tail.dev,
			ino: tail.ino,
			size: tail.size,
			mtimeMs: tail.mtimeMs,
			complete,
		});
		if (legacyTranscriptCache.size > MAX_LEGACY_TRANSCRIPT_CACHE_ENTRIES) {
			const oldest = legacyTranscriptCache.keys().next().value;
			if (oldest !== undefined) legacyTranscriptCache.delete(oldest);
		}
		return complete;
	} catch {
		return false;
	}
}

function legacyFinalDrainHasCompleteReport(record: Record<string, unknown>): boolean {
	if (optionalString(record["error"]) || !processHasAmbiguousLegacyFinalDrain(record)) return false;
	const transcriptPath = firstString(record["transcriptPath"], asRecord(record["artifactPaths"])["transcriptPath"]);
	return transcriptPath ? transcriptEndsWithCompleteAssistantReport(transcriptPath) : false;
}

function processTerminalIsStaleRepair(record: Record<string, unknown>): boolean {
	const terminal = asRecord(record["processTerminal"]);
	return terminal["state"] === "unknown" && terminal["reason"] === "stale-repair";
}

function isLegacyRunnerDisappearance(error: string): boolean {
	return /async runner process .* exited or disappeared before writing a result/i.test(error);
}

function deriveStatus(value: unknown, fallback: string): AgentStatus {
	const record = asRecord(value);
	const explicit = firstString(record["agentStatus"], record["uiStatus"]);
	if (explicit && explicit in STATUS_ORDER) return explicit as AgentStatus;
	if (record["stopping"] === true || fallback === "stopping") return "stopping";
	if (record["resuming"] === true || fallback === "resuming") return "resuming";

	const status = sourceStatus(record["status"] ?? fallback);
	switch (status) {
		case "pending":
		case "queued":
			return "queued";
		case "running":
		case "detached":
			if (isSupervisorWait(record)) return "waiting_supervisor";
			return "running";
		case "complete":
		case "completed":
			return "completed";
		case "paused":
			return "agent_stopped";
		case "stopped":
			return record["cancelledBy"] === "agent" || record["stoppedBy"] === "agent"
				? "agent_stopped"
				: "user_cancelled";
		case "failed": {
			const error = optionalString(record["error"]) ?? "";
			const expectedTermination =
				record["interrupted"] === true ||
				record["timedOut"] === true ||
				record["stopped"] === true ||
				record["turnBudgetExceeded"] === true ||
				record["toolBudgetBlocked"] === true;
			const crashEvidence =
				record["crashed"] === true ||
				processTerminalIsStaleRepair(record) ||
				isLegacyRunnerDisappearance(error) ||
				processHasExternalSignal(record);
			if (!expectedTermination && !crashEvidence && legacyFinalDrainHasCompleteReport(record)) return "completed";
			return !expectedTermination && crashEvidence ? "crashed" : "failed";
		}
		default:
			return "running";
	}
}

function countNestedRuns(value: unknown): number {
	if (!Array.isArray(value)) return 0;
	let count = 0;
	for (const nested of value) {
		const record = asRecord(nested);
		count += 1;
		count += countNestedRuns(record["children"]);
		if (Array.isArray(record["steps"])) {
			for (const step of record["steps"]) count += countNestedRuns(asRecord(step)["children"]);
		}
	}
	return count;
}

function nestedForChild(value: unknown, childIndex: number, directCount: number): unknown[] {
	if (!Array.isArray(value)) return [];
	const exact = value.filter((nested) => asRecord(nested)["parentStepIndex"] === childIndex);
	if (exact.length > 0) return exact;
	return directCount === 1 ? value : [];
}

function projectNestedAgents(value: unknown): AgentNestedDetail[] {
	if (!Array.isArray(value)) return [];
	const details: AgentNestedDetail[] = [];
	const seenRuns = new Set<string>();
	const walk = (runs: unknown[], inheritedDepth: number): void => {
		for (const candidate of runs) {
			if (details.length >= 200) return;
			const run = asRecord(candidate);
			const sanitizedRun = sanitizeSummary(candidate);
			const runId = optionalString(run["id"]);
			if (!runId || seenRuns.has(runId)) continue;
			seenRuns.add(runId);
			const depthValue = finiteNumber(run["depth"]);
			const depth = Math.max(1, Math.min(3, depthValue === null ? inheritedDepth : Math.floor(depthValue)));
			const runStatus = sourceStatus(run["state"] ?? run["status"]);
			const steps = Array.isArray(run["steps"]) ? run["steps"] : [];
			const runChildren = Array.isArray(run["children"]) ? run["children"] : [];
			const parentRunId = optionalString(run["parentRunId"]);
			const rootRunId =
				sanitizedRun?.path[0]?.runId ?? (sanitizedRun?.depth === 1 ? sanitizedRun.parentRunId : undefined);
			const asyncDir = rootRunId && sanitizedRun ? (resolveNestedAsyncDir(rootRunId, sanitizedRun) ?? null) : null;
			if (steps.length === 0) {
				const status = deriveStatus(run, runStatus);
				details.push(
					Object.freeze({
						key: `nested:${runId}:0`,
						asyncDir,
						runId,
						childIndex: 0,
						parentRunId,
						depth,
						name: firstString(run["agent"], runId) ?? "agent",
						description: resolveDisplayDescription(undefined, firstString(run["task"]) ?? ""),
						task: boundedText(run["task"], MAX_TASK_CHARS) ?? "",
						status,
						error: terminalError(status, run),
						nestedCount: countNestedRuns(runChildren),
						sessionFile: firstLocator(run["sessionFile"]),
						transcriptPath: firstLocator(run["transcriptPath"]),
						savedOutputPath: firstLocator(run["savedOutputPath"]),
						partialResult: partialResult(run),
					}),
				);
			}
			const assignedRunChildren = new Set<string>();
			for (const [index, rawStep] of steps.slice(0, 20).entries()) {
				if (details.length >= 200) return;
				const step = asRecord(rawStep);
				const explicitStepChildren = Array.isArray(step["children"]) ? step["children"] : [];
				const attributedRunChildren = nestedForChild(runChildren, index, steps.length);
				for (const child of attributedRunChildren) {
					const childId = optionalString(asRecord(child)["id"]);
					if (childId) assignedRunChildren.add(childId);
				}
				const stepChildren = [...explicitStepChildren, ...attributedRunChildren].filter((child, position, all) => {
					const childId = optionalString(asRecord(child)["id"]);
					return (
						!childId ||
						all.findIndex((candidate) => optionalString(asRecord(candidate)["id"]) === childId) === position
					);
				});
				const task = boundedText(step["task"], MAX_TASK_CHARS) ?? "";
				const description = resolveDisplayDescription(firstString(step["description"]), task);
				const status = deriveStatus(step, sourceStatus(step["status"] ?? runStatus));
				details.push(
					Object.freeze({
						key: `nested:${runId}:${index}`,
						asyncDir,
						runId,
						childIndex: index,
						parentRunId,
						depth,
						name: firstString(step["agent"], run["agent"], runId) ?? "agent",
						description,
						task,
						status,
						error: terminalError(status, step, run),
						nestedCount: countNestedRuns(stepChildren),
						sessionFile: firstLocator(step["sessionFile"], run["sessionFile"]),
						transcriptPath: firstLocator(step["transcriptPath"]),
						savedOutputPath: firstLocator(step["savedOutputPath"]),
						partialResult: partialResult(step, run),
					}),
				);
				walk(stepChildren, depth + 1);
			}
			walk(
				runChildren.filter((child) => {
					const childId = optionalString(asRecord(child)["id"]);
					return !childId || !assignedRunChildren.has(childId);
				}),
				depth + 1,
			);
		}
	};
	walk(value, 1);
	return details;
}

function boundedRecentOutput(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	let combined = "";
	for (const line of value) {
		if (typeof line !== "string") continue;
		const separator = combined ? "\n" : "";
		const remaining = MAX_PARTIAL_RESULT_CHARS + 1 - combined.length;
		if (remaining <= 0) break;
		combined += `${separator}${line.slice(0, Math.max(0, remaining - separator.length))}`;
		if (combined.length > MAX_PARTIAL_RESULT_CHARS) break;
	}
	return boundedText(combined, MAX_PARTIAL_RESULT_CHARS);
}

function partialResult(...values: unknown[]): string | null {
	for (const value of values) {
		const record = asRecord(value);
		const direct = boundedText(
			record["finalOutput"] ?? record["summary"] ?? record["output"],
			MAX_PARTIAL_RESULT_CHARS,
		);
		if (direct) return direct;
		const recent = boundedRecentOutput(record["recentOutput"]);
		if (recent) return recent;
	}
	return null;
}

function projectAsyncJob(job: AsyncJob, sessionId: string, terminalOnly: boolean): RowDraft[] {
	if (job.sessionId !== sessionId) return [];
	const jobStatus = sourceStatus(job.status);
	if (terminalOnly ? !TERMINAL_SOURCE_STATUSES.has(jobStatus) : !ACTIVE_SOURCE_STATUSES.has(jobStatus)) return [];

	const persistedSteps = job.steps?.length ? job.steps : undefined;
	const hasPersistedSteps = persistedSteps !== undefined;
	const steps = persistedSteps
		? persistedSteps.map((step, position) => ({ step, childIndex: step.index ?? position }))
		: (job.agents?.length ? job.agents : ["agent"]).map((name, childIndex) => ({
				step: { agent: name },
				childIndex,
			}));
	const directCount = steps.length;

	return steps.map(({ step, childIndex }) => {
		const stepRecord = asRecord(step);
		const persistedTask = firstString(stepRecord["task"], job.tasks?.[childIndex]);
		const taskSource = persistedTask ?? firstString(stepRecord["label"], stepRecord["phase"], job.description) ?? "";
		const explicitDescription = firstString(
			job.descriptions?.[childIndex],
			...(persistedTask ? [stepRecord["label"], stepRecord["phase"], job.description] : []),
		);
		const rawStepStatus = sourceStatus(stepRecord["status"] ?? jobStatus);
		const effectiveStatus =
			TERMINAL_SOURCE_STATUSES.has(jobStatus) && !TERMINAL_SOURCE_STATUSES.has(rawStepStatus)
				? jobStatus
				: rawStepStatus;
		const statusRecord = {
			...(hasPersistedSteps && directCount > 1 ? {} : asRecord(job)),
			...stepRecord,
			status: effectiveStatus,
		};
		const status = deriveStatus(statusRecord, effectiveStatus);
		const nested =
			Array.isArray(stepRecord["children"]) && stepRecord["children"].length > 0
				? stepRecord["children"]
				: nestedForChild(job.nestedChildren, childIndex, directCount);
		return {
			key: rowKey(job.asyncId, childIndex),
			runId: job.asyncId,
			childIndex,
			sessionId,
			name: firstString(stepRecord["agent"], job.agents?.[childIndex]) ?? "agent",
			description: resolveDisplayDescription(explicitDescription, taskSource),
			task: boundedText(taskSource, MAX_TASK_CHARS) ?? "",
			status,
			error: terminalError(status, stepRecord, job),
			startedAt: finiteNumber(stepRecord["startedAt"] ?? job.startedAt),
			endedAt: finiteNumber(
				stepRecord["endedAt"] ?? (TERMINAL_SOURCE_STATUSES.has(jobStatus) ? job.updatedAt : null),
			),
			partialResult: partialResult(stepRecord, job),
			nestedCount: countNestedRuns(nested),
			nestedAgents: projectNestedAgents(nested),
			sessionFile: firstLocator(stepRecord["sessionFile"], job.sessionFile),
			transcriptPath: firstLocator(stepRecord["transcriptPath"]),
			savedOutputPath: firstLocator(stepRecord["savedOutputPath"], stepRecord["structuredOutputPath"]),
		};
	});
}

function rememberedForegroundChildren(
	state: CurrentAgentsState,
	sessionId: string,
): Map<string, Record<string, unknown>> {
	const remembered = new Map<string, Record<string, unknown>>();
	for (const run of state.foregroundRuns?.values() ?? []) {
		if (run.sessionId !== sessionId) continue;
		for (const child of run.children) {
			if (!child) continue;
			remembered.set(rowKey(run.runId, child.index), asRecord(child));
		}
	}
	return remembered;
}

function projectForegroundControl(
	control: ForegroundControl,
	sessionId: string,
	remembered: ReadonlyMap<string, Record<string, unknown>>,
): RowDraft[] {
	if (control.sessionId !== sessionId) return [];
	const children = control.activeChildren?.size
		? [...control.activeChildren.entries()].sort(([left], [right]) => left - right)
		: control.currentAgent
			? [
					[
						control.currentIndex ?? 0,
						{
							agent: control.currentAgent,
							description: control.description,
							task: control.task,
							startedAt: control.startedAt,
							updatedAt: control.updatedAt,
							currentActivityState: control.currentActivityState,
							currentTool: control.currentTool,
						},
					] as const,
				]
			: [];
	const directCount = children.length;

	return children.map(([childIndex, child]) => {
		const childRecord = asRecord(child);
		const persistedTask = firstString(childRecord["task"], control.task);
		const taskSource = persistedTask ?? firstString(childRecord["description"], control.description) ?? "";
		const rememberedChild = remembered.get(rowKey(control.runId, childIndex)) ?? {};
		const statusRecord = {
			...asRecord(control),
			...childRecord,
			status: childRecord["status"] ?? "running",
			activityState: childRecord["currentActivityState"] ?? control.currentActivityState,
			currentTool: childRecord["currentTool"] ?? control.currentTool,
		};
		const status = deriveStatus(statusRecord, "running");
		const nested = nestedForChild(control.nestedChildren, childIndex, directCount);
		return {
			key: rowKey(control.runId, childIndex),
			runId: control.runId,
			childIndex,
			sessionId,
			name: firstString(childRecord["agent"], control.currentAgent) ?? "agent",
			description: resolveDisplayDescription(
				persistedTask ? firstString(childRecord["description"], control.description) : undefined,
				taskSource,
			),
			task: boundedText(taskSource, MAX_TASK_CHARS) ?? "",
			status,
			error: terminalError(status, rememberedChild, childRecord, control),
			startedAt: finiteNumber(childRecord["startedAt"] ?? control.startedAt),
			endedAt: null,
			partialResult: partialResult(rememberedChild, childRecord),
			nestedCount: countNestedRuns(nested),
			nestedAgents: projectNestedAgents(nested),
			sessionFile: firstLocator(rememberedChild["sessionFile"]),
			transcriptPath: firstLocator(
				rememberedChild["transcriptPath"],
				asRecord(rememberedChild["artifactPaths"])["transcriptPath"],
			),
			savedOutputPath: firstLocator(rememberedChild["savedOutputPath"]),
		};
	});
}

function projectForegroundRun(run: ForegroundRun, sessionId: string): RowDraft[] {
	if (run.sessionId !== sessionId) return [];
	return run.children.flatMap((child) => {
		if (!child) return [];
		const childRecord = asRecord(child);
		const nested = Array.isArray(childRecord["children"]) ? childRecord["children"] : [];
		const persistedTask = firstString(childRecord["task"]);
		const taskSource = persistedTask ?? firstString(childRecord["description"]) ?? "";
		const status = deriveStatus(childRecord, child.status);
		return [
			{
				key: rowKey(run.runId, child.index),
				runId: run.runId,
				childIndex: child.index,
				sessionId,
				name: child.agent || "agent",
				description: resolveDisplayDescription(persistedTask ? childRecord["description"] : undefined, taskSource),
				task: boundedText(taskSource, MAX_TASK_CHARS) ?? "",
				status,
				error: terminalError(status, childRecord),
				startedAt: finiteNumber(childRecord["startedAt"]),
				endedAt: finiteNumber(child.updatedAt ?? run.updatedAt),
				partialResult: partialResult(childRecord),
				nestedCount: countNestedRuns(nested),
				nestedAgents: projectNestedAgents(nested),
				sessionFile: firstLocator(child.sessionFile),
				transcriptPath: firstLocator(child.transcriptPath, asRecord(child.artifactPaths)["transcriptPath"]),
				savedOutputPath: firstLocator(child.savedOutputPath),
			} satisfies RowDraft,
		];
	});
}

function freezeRow(draft: RowDraft, now: number): AgentRow {
	const terminal = TERMINAL_STATUSES.has(draft.status);
	const end = terminal ? draft.endedAt : now;
	const elapsedMs = draft.startedAt === null || end === null ? null : Math.max(0, end - draft.startedAt);
	const partialResult =
		draft.partialResult &&
		!isTaskOnlyAgentText(draft.partialResult, draft.task) &&
		boundedTerminalLine(draft.partialResult) !== draft.error
			? draft.partialResult
			: null;
	return Object.freeze({
		key: draft.key,
		runId: draft.runId,
		childIndex: draft.childIndex,
		sessionId: draft.sessionId,
		name: draft.name,
		description: draft.description,
		task: draft.task,
		status: draft.status,
		error: draft.error,
		startedAt: draft.startedAt,
		endedAt: draft.endedAt,
		elapsedMs,
		partialResult,
		nestedCount: draft.nestedCount,
		nestedAgents: Object.freeze([...draft.nestedAgents]),
		sessionFile: draft.sessionFile,
		transcriptPath: draft.transcriptPath,
		savedOutputPath: draft.savedOutputPath,
	});
}

function semanticSnapshotKey(sessionId: string | null, rows: readonly AgentRow[]): string {
	return JSON.stringify({
		sessionId,
		rows: rows.map(({ elapsedMs: _elapsedMs, ...row }) => row),
	});
}

function normalizeAcknowledgement(value: AgentControlAcknowledgement): Exclude<AgentControlAcknowledgement, boolean> {
	return typeof value === "boolean" ? { acknowledged: value } : value;
}

function controlResult(
	action: AgentControlAction,
	acknowledged: boolean,
	message: string,
	status: AgentStatus | null,
): AgentControlResult {
	return Object.freeze({ type: action.type, key: action.key, acknowledged, message, status });
}

export class CurrentAgents {
	private disposed = false;
	private readonly listeners = new Set<(snapshot: AgentSessionSnapshot) => void>();
	private readonly now: () => number;
	private readonly options: CurrentAgentsOptions;
	private readonly overrides = new Map<string, StatusOverride>();
	private revision = 0;
	private semanticKey = "";
	private sessionId: string | null = null;
	private snapshotValue: AgentSessionSnapshot = Object.freeze({
		sessionId: null,
		revision: 0,
		rows: Object.freeze([]),
	});
	private readonly state: CurrentAgentsState;
	private readonly unsubscribe: Array<() => void> = [];

	constructor(state: CurrentAgentsState, options: CurrentAgentsOptions) {
		this.state = state;
		this.options = options;
		this.now = options.now ?? Date.now;
		this.rebuild(false);
		if (options.subscribeState) this.unsubscribe.push(options.subscribeState(() => this.rebuild(true)));
	}

	snapshot(): AgentSessionSnapshot {
		if (!this.disposed) this.rebuild(false);
		return this.snapshotValue;
	}

	subscribe(listener: (snapshot: AgentSessionSnapshot) => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		this.callListener(listener, this.snapshot());
		return () => this.listeners.delete(listener);
	}

	refresh(): void {
		this.rebuild(true);
	}

	async control(action: AgentControlAction): Promise<AgentControlResult> {
		if (this.disposed) return controlResult(action, false, "Current Agents is disposed.", null);
		const row = this.snapshot().rows.find((candidate) => candidate.key === action.key);
		if (!row)
			return controlResult(action, false, `Agent '${action.key}' is not available in the current session.`, null);

		const rejection = this.validateAction(action, row);
		if (rejection) return controlResult(action, false, rejection, row.status);

		let acknowledgement: Exclude<AgentControlAcknowledgement, boolean>;
		try {
			const raw = await this.invokeControl(action, row);
			acknowledgement = normalizeAcknowledgement(raw);
		} catch (error) {
			return controlResult(
				action,
				false,
				error instanceof Error ? error.message : String(error),
				this.snapshot().rows.find((candidate) => candidate.key === action.key)?.status ?? null,
			);
		}

		if (!acknowledgement.acknowledged) {
			return controlResult(
				action,
				false,
				acknowledgement.message ?? "The Agent did not acknowledge the request.",
				row.status,
			);
		}

		this.rebuild(false);
		const current = this.snapshotValue.rows.find((candidate) => candidate.key === action.key);
		if (current && action.type === "stop" && !TERMINAL_STATUSES.has(current.status)) {
			this.overrides.set(action.key, {
				sourceStatus: current.status,
				status: acknowledgement.status ?? "stopping",
			});
		} else if (current && action.type === "resume" && TERMINAL_STATUSES.has(current.status)) {
			this.overrides.set(action.key, {
				sourceStatus: current.status,
				status: acknowledgement.status ?? "resuming",
			});
		}
		this.rebuild(true);
		const status = this.snapshotValue.rows.find((candidate) => candidate.key === action.key)?.status ?? null;
		return controlResult(action, true, acknowledgement.message ?? "Acknowledged.", status);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of this.unsubscribe.splice(0)) {
			try {
				unsubscribe();
			} catch {
				// A stale upstream observer must not keep this projection alive.
			}
		}
		this.listeners.clear();
		this.overrides.clear();
	}

	private invokeControl(
		action: AgentControlAction,
		row: AgentRow,
	): AgentControlAcknowledgement | Promise<AgentControlAcknowledgement> {
		switch (action.type) {
			case "inspect":
				return this.options.inspect(row);
			case "steer":
				return this.options.steer(row, action.message.trim());
			case "stop":
				return this.options.stop(row);
			case "resume":
				return this.options.resume(row, action.message?.trim() || undefined);
		}
	}

	private validateAction(action: AgentControlAction, row: AgentRow): string | null {
		const terminal = TERMINAL_STATUSES.has(row.status);
		switch (action.type) {
			case "inspect":
				return null;
			case "stop":
				return terminal || row.status === "stopping" ? `Agent '${row.key}' is not running.` : null;
			case "steer":
				if (!action.message.trim()) return "Steering requires a non-empty message.";
				return terminal || row.status === "stopping"
					? `Agent '${row.key}' cannot be steered in state '${row.status}'.`
					: null;
			case "resume":
				return RESUMABLE_STATUSES.has(row.status)
					? null
					: `Agent '${row.key}' cannot be resumed from state '${row.status}'.`;
		}
	}

	private rebuild(notify: boolean): void {
		if (this.disposed) return;
		const currentSessionId = this.state.currentSessionId;
		if (currentSessionId !== this.sessionId) {
			this.sessionId = currentSessionId;
			this.overrides.clear();
		}

		const drafts = currentSessionId ? this.projectRows(currentSessionId) : [];
		const liveKeys = new Set(drafts.map(({ key }) => key));
		for (const key of this.overrides.keys()) {
			if (!liveKeys.has(key)) this.overrides.delete(key);
		}
		for (const draft of drafts) {
			const override = this.overrides.get(draft.key);
			if (override && draft.status !== override.sourceStatus) {
				this.overrides.delete(draft.key);
			} else if (override) {
				draft.status = override.status;
			}
		}

		const now = this.now();
		const rows = Object.freeze(
			drafts
				.map((draft) => freezeRow(draft, now))
				.sort(
					(left, right) =>
						STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
						(left.startedAt ?? Number.MAX_SAFE_INTEGER) - (right.startedAt ?? Number.MAX_SAFE_INTEGER) ||
						left.key.localeCompare(right.key),
				),
		);
		const nextSemanticKey = semanticSnapshotKey(currentSessionId, rows);
		const changed = nextSemanticKey !== this.semanticKey;
		if (changed) this.revision += 1;
		this.semanticKey = nextSemanticKey;
		this.snapshotValue = Object.freeze({ sessionId: currentSessionId, revision: this.revision, rows });
		if (changed && notify) {
			for (const listener of [...this.listeners]) this.callListener(listener, this.snapshotValue);
		}
	}

	private projectRows(sessionId: string): RowDraft[] {
		const rows = new Map<string, RowDraft>();
		const remembered = rememberedForegroundChildren(this.state, sessionId);
		for (const control of this.state.foregroundControls.values()) {
			for (const row of projectForegroundControl(control, sessionId, remembered)) rows.set(row.key, row);
		}
		for (const job of this.state.asyncJobs.values()) {
			for (const row of projectAsyncJob(job, sessionId, false)) if (!rows.has(row.key)) rows.set(row.key, row);
		}
		for (const run of this.state.foregroundRuns?.values() ?? []) {
			this.refreshForegroundNestedProjection(run);
			for (const row of projectForegroundRun(run, sessionId)) if (!rows.has(row.key)) rows.set(row.key, row);
		}
		for (const job of this.state.recentAgentJobs?.values() ?? []) {
			for (const row of projectAsyncJob(job, sessionId, true)) if (!rows.has(row.key)) rows.set(row.key, row);
		}
		return [...rows.values()];
	}

	private refreshForegroundNestedProjection(run: ForegroundRun): void {
		const route = run.nestedRoute;
		if (!route) return;
		try {
			// UI projection is observation-only. The active runtime poller owns event
			// projection and cleanup; merely opening or refreshing `/agents` must never
			// claim, write, or unlink nested runtime records.
			const registry = readNestedRegistry(route);
			const directChildren = registry.children.filter((child) => child.parentRunId === run.runId);
			for (const child of run.children) {
				const projected = nestedForChild(directChildren, child.index, run.children.length)
					.map((nested) => sanitizeSummary(nested))
					.filter((nested): nested is NonNullable<typeof nested> => Boolean(nested));
				child.children = projected;
			}
			run.updatedAt = Math.max(run.updatedAt, registry.updatedAt);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			reportAgentDiagnostic(`Failed to refresh foreground nested route for '${run.runId}':`, error);
		}
	}

	private callListener(listener: (snapshot: AgentSessionSnapshot) => void, snapshot: AgentSessionSnapshot): void {
		try {
			listener(snapshot);
		} catch {
			// One renderer cannot prevent the other projections from updating.
		}
	}
}
