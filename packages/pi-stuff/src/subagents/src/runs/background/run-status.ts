import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type AgentRow, CurrentAgents } from "../../session/current-agents.ts";
import type { Details, SubagentState } from "../../shared/types.ts";

const MAX_LIST_TASK_CHARS = 160;
const MAX_DETAIL_TASK_CHARS = 300;
const MAX_FAILURE_CHARS = 800;
const MAX_PROGRESS_CHARS = 800;
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\/)(?:[^\s:;,]+[\\/])*[^\s:;,]*/gu;

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
	const result: RunStatusResult = {
		content: [{ type: "text", text }],
		details: { mode: "management", results: [] },
	};
	if (isError) Object.assign(result, { isError: true });
	return result;
}

function compactText(value: string, limit: number): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

type FailureCategory = "context" | "protocol" | "timeout" | "provider" | "process" | "budget" | "unknown";

function failureCategory(error: string): FailureCategory {
	if (/payload input bound|context(?:[_\s-]*(?:length|window|overflow))|too many tokens/i.test(error))
		return "context";
	if (/protocol[_\s-]|message(?:\.|_).*invalid|malformed event/i.test(error)) return "protocol";
	if (/timed?\s*out|deadline/i.test(error)) return "timeout";
	if (/\b(?:401|403|429|5\d\d)\b|auth(?:entication|orization)?|quota|rate limit|provider/i.test(error)) {
		return "provider";
	}
	if (/turn budget|tool budget|budget/i.test(error)) return "budget";
	if (/signal|exit(?:ed| code)|process|crash|disappear/i.test(error)) return "process";
	return "unknown";
}

function compactChildText(value: string, limit: number): string {
	const withoutPaths = value.replace(ABSOLUTE_PATH, (path) => path.split(/[\\/]/u).filter(Boolean).at(-1) ?? "path");
	return compactText(withoutPaths, limit);
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
	const task = compactChildText(row.task, MAX_LIST_TASK_CHARS);
	return task ? `- ${heading}\n  ${task}` : `- ${heading}`;
}

function rowsSummary(rows: readonly AgentRow[], heading: string): string {
	return [heading, ...rows.map(rowSummary)].join("\n");
}

function rowDetail(row: AgentRow): string {
	const elapsed = formatElapsed(row.elapsedMs);
	const lines = [[row.key, row.name, row.status, elapsed].filter(Boolean).join(" · ")];
	const task = compactChildText(row.task, MAX_DETAIL_TASK_CHARS);
	if (task) lines.push(`Task: ${task}`);
	if (row.error)
		lines.push(`Failure [${failureCategory(row.error)}]: ${compactChildText(row.error, MAX_FAILURE_CHARS)}`);
	if (row.partialResult) lines.push(`Progress: ${compactChildText(row.partialResult, MAX_PROGRESS_CHARS)}`);
	return lines.join("\n");
}

function currentRows(deps: RunStatusDeps): readonly AgentRow[] {
	if (!deps.state?.currentSessionId) return [];
	const rejectControl = () => false;
	const options: ConstructorParameters<typeof CurrentAgents>[1] = {
		inspect: rejectControl,
		steer: rejectControl,
		stop: rejectControl,
		resume: rejectControl,
	};
	if (deps.now) Object.assign(options, { now: deps.now });
	const current = new CurrentAgents(deps.state, options);
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
