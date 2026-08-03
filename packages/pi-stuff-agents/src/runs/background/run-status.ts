import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type AgentRow, CurrentAgents } from "../../session/current-agents.ts";
import type { Details, SubagentState } from "../../shared/types.ts";

const MAX_LIST_TASK_CHARS = 160;
const MAX_DETAIL_TASK_CHARS = 300;
const MAX_PROGRESS_CHARS = 800;

export interface RunStatusParams {
	readonly action?: "status";
	readonly id?: string;
	readonly index?: number;
}

export type RunStatusState = Pick<
	SubagentState,
	"currentSessionId" | "asyncJobs" | "recentAgentJobs" | "foregroundControls" | "foregroundRuns"
>;

export interface RunStatusDeps {
	readonly state?: RunStatusState;
	readonly now?: () => number;
}

export type RunStatusResult = AgentToolResult<Details> & { readonly isError?: boolean };

function statusResult(text: string, isError = false): RunStatusResult {
	return {
		content: [{ type: "text", text }],
		...(isError ? { isError: true } : {}),
		details: { mode: "management", results: [] },
	};
}

function compactText(value: string, limit: number): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function formatElapsed(elapsedMs: number | null): string | undefined {
	if (elapsedMs === null) return undefined;
	const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function rowSummary(row: AgentRow): string {
	const elapsed = formatElapsed(row.elapsedMs);
	const heading = [row.key, row.name, row.status, elapsed].filter(Boolean).join(" · ");
	const task = compactText(row.task, MAX_LIST_TASK_CHARS);
	return task ? `- ${heading}\n  ${task}` : `- ${heading}`;
}

function rowsSummary(rows: readonly AgentRow[], heading: string): string {
	return [heading, ...rows.map(rowSummary)].join("\n");
}

function rowDetail(row: AgentRow): string {
	const elapsed = formatElapsed(row.elapsedMs);
	const lines = [[row.key, row.name, row.status, elapsed].filter(Boolean).join(" · ")];
	const task = compactText(row.task, MAX_DETAIL_TASK_CHARS);
	if (task) lines.push(`Task: ${task}`);
	if (row.partialResult) lines.push(`Progress: ${compactText(row.partialResult, MAX_PROGRESS_CHARS)}`);
	return lines.join("\n");
}

function currentRows(deps: RunStatusDeps): readonly AgentRow[] {
	if (!deps.state?.currentSessionId) return [];
	const rejectControl = () => false;
	const current = new CurrentAgents(deps.state, {
		inspect: rejectControl,
		steer: rejectControl,
		stop: rejectControl,
		resume: rejectControl,
		...(deps.now ? { now: deps.now } : {}),
	});
	try {
		return current.snapshot().rows;
	} finally {
		current.dispose();
	}
}

function selectRows(rows: readonly AgentRow[], id: string, index: number | undefined): readonly AgentRow[] {
	const exact = rows.find((row) => row.key === id);
	if (exact) {
		return index === undefined || exact.childIndex === index ? [exact] : [];
	}
	const runRows = rows.filter((row) => row.runId === id);
	if (index === undefined) return runRows;
	const child = runRows.find((row) => row.childIndex === index);
	return child ? [child] : [];
}

export function inspectSubagentStatus(params: RunStatusParams, deps: RunStatusDeps = {}): RunStatusResult {
	if (params.index !== undefined && (!Number.isInteger(params.index) || params.index < 0)) {
		return statusResult("Agent status index must be a non-negative integer.", true);
	}
	if (params.index !== undefined && !params.id) {
		return statusResult("Agent status index requires an id.", true);
	}

	const rows = currentRows(deps);
	if (!params.id) {
		if (rows.length === 0) return statusResult("No Agents are available in the current session.");
		return statusResult(rowsSummary(rows, `Current Agents (${rows.length})`));
	}

	const selected = selectRows(rows, params.id, params.index);
	if (selected.length === 0) {
		const suffix = params.index === undefined ? "" : ` at index ${params.index}`;
		return statusResult(`Agent '${params.id}'${suffix} is not available in the current session.`, true);
	}
	const [selectedRow] = selected;
	if (selected.length === 1 && selectedRow) return statusResult(rowDetail(selectedRow));
	return statusResult(rowsSummary(selected, `Agents in ${params.id} (${selected.length})`));
}
