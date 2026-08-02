import type { SubagentState } from "../shared/types.ts";

export type AgentStatus =
	| "queued"
	| "running"
	| "waiting_permission"
	| "waiting_supervisor"
	| "stopping"
	| "completed"
	| "failed"
	| "agent_stopped"
	| "user_cancelled"
	| "crashed"
	| "resuming";

export interface AgentRow {
	readonly key: string;
	readonly runId: string;
	readonly childIndex: number;
	readonly sessionId: string;
	readonly name: string;
	readonly task: string;
	readonly status: AgentStatus;
	readonly startedAt: number | null;
	readonly elapsedMs: number | null;
	readonly partialResult: string | null;
	readonly nestedCount: number;
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
	| { readonly type: "dismiss-terminal"; readonly key: string }
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
	readonly dismiss: (row: AgentRow) => AgentControlAcknowledgement | Promise<AgentControlAcknowledgement>;
	readonly subscribeState?: (listener: () => void) => () => void;
	readonly subscribeMainUserSubmission?: (listener: () => void) => () => void;
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
	task: string;
	status: AgentStatus;
	startedAt: number | null;
	endedAt: number | null;
	partialResult: string | null;
	nestedCount: number;
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
	waiting_permission: 0,
	waiting_supervisor: 1,
	stopping: 2,
	resuming: 3,
	running: 4,
	queued: 5,
	crashed: 6,
	failed: 7,
	user_cancelled: 8,
	agent_stopped: 9,
	completed: 10,
};
const MAX_PARTIAL_RESULT_CHARS = 4_000;
const MAX_TASK_CHARS = 500;

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function boundedText(value: unknown, limit: number): string | null {
	const text = optionalString(value)?.trim();
	if (!text) return null;
	return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
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

function isPermissionWait(record: Record<string, unknown>): boolean {
	const waitingFor = firstString(record["waitingFor"], record["attentionKind"], record["waitReason"])?.toLowerCase();
	const currentTool = optionalString(record["currentTool"])?.toLowerCase();
	return (
		waitingFor === "permission" ||
		Boolean(record["permissionRequestId"]) ||
		currentTool === "permission" ||
		currentTool === "permission_request" ||
		currentTool?.includes("permission") === true
	);
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

function processHasSignal(record: Record<string, unknown>): boolean {
	if (optionalString(record["processSignal"])) return true;
	const terminal = asRecord(record["processTerminal"]);
	const instances = Array.isArray(terminal["instances"]) ? terminal["instances"] : [];
	return instances.some((instance) => Boolean(optionalString(asRecord(instance)["signal"])));
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
			if (isPermissionWait(record)) return "waiting_permission";
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
			return record["crashed"] === true ||
				processHasSignal(record) ||
				/\b(?:crash|sig(?:kill|term|segv|abrt)|exited|disappeared)\b/i.test(error)
				? "crashed"
				: "failed";
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

function partialResult(...values: unknown[]): string | null {
	for (const value of values) {
		const record = asRecord(value);
		const direct = boundedText(
			record["finalOutput"] ?? record["summary"] ?? record["output"],
			MAX_PARTIAL_RESULT_CHARS,
		);
		if (direct) return direct;
		if (Array.isArray(record["recentOutput"])) {
			const recent = boundedText(
				record["recentOutput"].filter((line) => typeof line === "string").join("\n"),
				MAX_PARTIAL_RESULT_CHARS,
			);
			if (recent) return recent;
		}
	}
	return null;
}

function projectAsyncJob(job: AsyncJob, sessionId: string, terminalOnly: boolean): RowDraft[] {
	if (job.sessionId !== sessionId) return [];
	const jobStatus = sourceStatus(job.status);
	if (terminalOnly ? !TERMINAL_SOURCE_STATUSES.has(jobStatus) : !ACTIVE_SOURCE_STATUSES.has(jobStatus)) return [];

	const steps = job.steps?.length
		? job.steps.map((step, position) => ({ step, childIndex: step.index ?? position }))
		: (job.agents?.length ? job.agents : ["agent"]).map((name, childIndex) => ({
				step: { agent: name },
				childIndex,
			}));
	const directCount = steps.length;

	return steps.map(({ step, childIndex }) => {
		const stepRecord = asRecord(step);
		const rawStepStatus = sourceStatus(stepRecord["status"] ?? jobStatus);
		const effectiveStatus =
			TERMINAL_SOURCE_STATUSES.has(jobStatus) && !TERMINAL_SOURCE_STATUSES.has(rawStepStatus)
				? jobStatus
				: rawStepStatus;
		const statusRecord = { ...asRecord(job), ...stepRecord, status: effectiveStatus };
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
			task: boundedText(stepRecord["label"] ?? stepRecord["phase"] ?? job.description, MAX_TASK_CHARS) ?? "",
			status: deriveStatus(statusRecord, effectiveStatus),
			startedAt: finiteNumber(stepRecord["startedAt"] ?? job.startedAt),
			endedAt: finiteNumber(
				stepRecord["endedAt"] ?? (TERMINAL_SOURCE_STATUSES.has(jobStatus) ? job.updatedAt : null),
			),
			partialResult: partialResult(stepRecord, job),
			nestedCount: countNestedRuns(nested),
			sessionFile: firstString(stepRecord["sessionFile"], job.sessionFile),
			transcriptPath: firstString(stepRecord["transcriptPath"]),
			savedOutputPath: firstString(stepRecord["savedOutputPath"], stepRecord["structuredOutputPath"]),
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
		const rememberedChild = remembered.get(rowKey(control.runId, childIndex)) ?? {};
		const statusRecord = {
			...asRecord(control),
			...childRecord,
			status: "running",
			activityState: childRecord["currentActivityState"] ?? control.currentActivityState,
			currentTool: childRecord["currentTool"] ?? control.currentTool,
		};
		return {
			key: rowKey(control.runId, childIndex),
			runId: control.runId,
			childIndex,
			sessionId,
			name: firstString(childRecord["agent"], control.currentAgent) ?? "agent",
			task: boundedText(childRecord["description"] ?? control.description, MAX_TASK_CHARS) ?? "",
			status: deriveStatus(statusRecord, "running"),
			startedAt: finiteNumber(childRecord["startedAt"] ?? control.startedAt),
			endedAt: null,
			partialResult: partialResult(rememberedChild, childRecord),
			nestedCount: countNestedRuns(nestedForChild(control.nestedChildren, childIndex, directCount)),
			sessionFile: firstString(rememberedChild["sessionFile"]),
			transcriptPath: firstString(
				rememberedChild["transcriptPath"],
				asRecord(rememberedChild["artifactPaths"])["transcriptPath"],
			),
			savedOutputPath: firstString(rememberedChild["savedOutputPath"]),
		};
	});
}

function projectForegroundRun(run: ForegroundRun, sessionId: string): RowDraft[] {
	if (run.sessionId !== sessionId) return [];
	return run.children.flatMap((child) => {
		if (!child) return [];
		const childRecord = asRecord(child);
		return [
			{
				key: rowKey(run.runId, child.index),
				runId: run.runId,
				childIndex: child.index,
				sessionId,
				name: child.agent || "agent",
				task: boundedText(childRecord["description"], MAX_TASK_CHARS) ?? "",
				status: deriveStatus(childRecord, child.status),
				startedAt: finiteNumber(childRecord["startedAt"]),
				endedAt: finiteNumber(child.updatedAt ?? run.updatedAt),
				partialResult: partialResult(childRecord),
				nestedCount: countNestedRuns(childRecord["children"]),
				sessionFile: firstString(child.sessionFile),
				transcriptPath: firstString(child.transcriptPath, asRecord(child.artifactPaths)["transcriptPath"]),
				savedOutputPath: firstString(child.savedOutputPath),
			} satisfies RowDraft,
		];
	});
}

function freezeRow(draft: RowDraft, now: number): AgentRow {
	const terminal = TERMINAL_STATUSES.has(draft.status);
	const end = terminal ? draft.endedAt : now;
	const elapsedMs = draft.startedAt === null || end === null ? null : Math.max(0, end - draft.startedAt);
	return Object.freeze({
		key: draft.key,
		runId: draft.runId,
		childIndex: draft.childIndex,
		sessionId: draft.sessionId,
		name: draft.name,
		task: draft.task,
		status: draft.status,
		startedAt: draft.startedAt,
		elapsedMs,
		partialResult: draft.partialResult,
		nestedCount: draft.nestedCount,
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
	private readonly dismissedTerminalKeys = new Set<string>();
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
		if (options.subscribeMainUserSubmission) {
			this.unsubscribe.push(options.subscribeMainUserSubmission(() => this.hideTerminalRowsForSubmission()));
		}
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
		if (action.type === "dismiss-terminal") {
			this.dismissedTerminalKeys.add(action.key);
		} else if (current && action.type === "stop" && !TERMINAL_STATUSES.has(current.status)) {
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
			case "dismiss-terminal":
				return this.options.dismiss(row);
		}
	}

	private validateAction(action: AgentControlAction, row: AgentRow): string | null {
		const terminal = TERMINAL_STATUSES.has(row.status);
		switch (action.type) {
			case "inspect":
				return null;
			case "stop":
				return terminal || row.status === "stopping" ? `Agent '${row.key}' is not running.` : null;
			case "dismiss-terminal":
				return terminal ? null : `Agent '${row.key}' is still active.`;
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

	private hideTerminalRowsForSubmission(): void {
		if (this.disposed) return;
		for (const row of this.snapshot().rows) {
			if (TERMINAL_STATUSES.has(row.status)) this.dismissedTerminalKeys.add(row.key);
		}
		this.rebuild(true);
	}

	private rebuild(notify: boolean): void {
		if (this.disposed) return;
		const currentSessionId = this.state.currentSessionId;
		if (currentSessionId !== this.sessionId) {
			this.sessionId = currentSessionId;
			this.dismissedTerminalKeys.clear();
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
			if (!TERMINAL_STATUSES.has(draft.status)) this.dismissedTerminalKeys.delete(draft.key);
		}

		const now = this.now();
		const rows = Object.freeze(
			drafts
				.filter((draft) => !(TERMINAL_STATUSES.has(draft.status) && this.dismissedTerminalKeys.has(draft.key)))
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
			for (const row of projectForegroundRun(run, sessionId)) if (!rows.has(row.key)) rows.set(row.key, row);
		}
		for (const job of this.state.recentAgentJobs?.values() ?? []) {
			for (const row of projectAsyncJob(job, sessionId, true)) if (!rows.has(row.key)) rows.set(row.key, row);
		}
		return [...rows.values()];
	}

	private callListener(listener: (snapshot: AgentSessionSnapshot) => void, snapshot: AgentSessionSnapshot): void {
		try {
			listener(snapshot);
		} catch {
			// One renderer cannot prevent the other projections from updating.
		}
	}
}
