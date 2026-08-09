import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SubagentParamsLike } from "../runs/foreground/subagent-executor.ts";
import { scanAgentReport } from "../runtime/final-report-scanner.ts";
import { resolveDisplayDescription } from "../shared/display-description.ts";
import type { Details, SingleResult } from "../shared/types.ts";
import { getSingleResultOutput } from "../shared/utils.ts";

const MAX_CHILD_SUMMARY_CHARS = 4_000;
const MAX_PARENT_RESULT_CHARS = 12_000;

export interface PublicAgentTask {
	readonly agent: string;
	readonly description?: string;
	readonly task: string;
	readonly cwd?: string;
	readonly model?: string;
	readonly skill?: string | readonly string[] | boolean;
	readonly turnBudget?: { readonly maxTurns: number; readonly graceTurns?: number };
	readonly toolBudget?: { readonly soft?: number; readonly hard: number; readonly block?: readonly string[] | "*" };
}

export interface PublicAgentParams {
	readonly action?: "resume" | "status" | "steer" | "stop";
	readonly agent?: string;
	readonly context?: "fork" | "fresh";
	readonly cwd?: string;
	readonly description?: string;
	readonly foreground?: boolean;
	readonly id?: string;
	readonly index?: number;
	readonly isolation?: "shared" | "worktree";
	readonly message?: string;
	readonly model?: string;
	readonly skill?: string | readonly string[] | boolean;
	readonly task?: string;
	readonly tasks?: readonly PublicAgentTask[];
	readonly thinking?: string;
	readonly timeoutMs?: number;
	readonly turnBudget?: { readonly maxTurns: number; readonly graceTurns?: number };
	readonly toolBudget?: { readonly soft?: number; readonly hard: number; readonly block?: readonly string[] | "*" };
}

function mutableSkill(value: PublicAgentParams["skill"]): SubagentParamsLike["skill"] {
	if (Array.isArray(value)) return [...value] as string[];
	return value as string | boolean | undefined;
}

function mutableToolBudget(value: PublicAgentParams["toolBudget"]): SubagentParamsLike["toolBudget"] {
	if (!value) return undefined;
	return {
		soft: value.soft,
		hard: value.hard,
		block: Array.isArray(value.block) ? ([...value.block] as string[]) : (value.block as "*" | undefined),
	};
}

function mapTask(task: PublicAgentTask) {
	return {
		agent: task.agent,
		description: resolveDisplayDescription(task.description, task.task),
		task: task.task,
		...(task.cwd ? { cwd: task.cwd } : {}),
		...(task.model ? { model: task.model } : {}),
		...(task.skill !== undefined ? { skill: mutableSkill(task.skill) } : {}),
		...(task.turnBudget ? { turnBudget: { ...task.turnBudget } } : {}),
		...(task.toolBudget ? { toolBudget: mutableToolBudget(task.toolBudget) } : {}),
	};
}

/**
 * Keep the public Claude-style contract small while retaining the mature fork's
 * execution engine behind this boundary.
 */
export function toEngineParams(params: PublicAgentParams): SubagentParamsLike {
	if (params.action) {
		return {
			action: params.action,
			...(params.id ? { id: params.id } : {}),
			...(params.index !== undefined ? { index: params.index } : {}),
			...(params.message ? { message: params.message } : {}),
		};
	}

	const worktree = params.isolation === "worktree";
	const common: SubagentParamsLike = {
		async: params.foreground !== true,
		context: params.context ?? "fresh",
		...(worktree ? { worktree: true } : {}),
		...(params.cwd ? { cwd: params.cwd } : {}),
		...(params.model ? { model: params.model } : {}),
		...(params.thinking ? { thinking: params.thinking } : {}),
		...(params.skill !== undefined ? { skill: mutableSkill(params.skill) } : {}),
		...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
		...(params.turnBudget ? { turnBudget: { ...params.turnBudget } } : {}),
		...(params.toolBudget ? { toolBudget: mutableToolBudget(params.toolBudget) } : {}),
	};

	if (params.tasks?.length) {
		return { ...common, tasks: params.tasks.map(mapTask) };
	}
	if (worktree && params.agent && params.task) {
		return {
			...common,
			tasks: [
				mapTask({
					agent: params.agent,
					...(params.description ? { description: params.description } : {}),
					task: params.task,
					...(params.model ? { model: params.model } : {}),
					...(params.skill !== undefined ? { skill: params.skill } : {}),
					...(params.turnBudget ? { turnBudget: params.turnBudget } : {}),
					...(params.toolBudget ? { toolBudget: params.toolBudget } : {}),
				}),
			],
		};
	}
	return {
		...common,
		...(params.agent ? { agent: params.agent } : {}),
		...(params.task ? { description: resolveDisplayDescription(params.description, params.task) } : {}),
		...(params.task ? { task: params.task } : {}),
	};
}

function bounded(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function resultStatus(result: SingleResult): "completed" | "failed" | "stopped" {
	if (result.interrupted || result.stopped || result.detached) return "stopped";
	return result.exitCode === 0 ? "completed" : "failed";
}

function childSummary(result: SingleResult): string {
	const raw = getSingleResultOutput(result).trim() || result.error?.trim() || "(no report)";
	return bounded(scanAgentReport(raw).text, MAX_CHILD_SUMMARY_CHARS);
}

function foregroundContent(results: readonly SingleResult[]): string {
	const blocks = results.map((result, index) => {
		const heading =
			results.length === 1
				? `Agent ${result.agent} ${resultStatus(result)}.`
				: `${index + 1}. ${result.agent} — ${resultStatus(result)}`;
		return `${heading}\n${childSummary(result)}`;
	});
	return bounded(blocks.join("\n\n"), MAX_PARENT_RESULT_CHARS);
}

function firstText(result: AgentToolResult<Details>): string {
	return result.content
		.filter((entry): entry is Extract<(typeof result.content)[number], { type: "text" }> => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n")
		.trim();
}

export type AgentEngineResult = AgentToolResult<Details> & { readonly isError?: boolean };

/** Parent-facing projection: direct summaries only, never engine bookkeeping paths. */
export function projectEngineResult(params: PublicAgentParams, result: AgentEngineResult): AgentEngineResult {
	const { lifecycleBinding: _lifecycleBinding, ...publicDetails } = result.details;
	const publicResult: AgentEngineResult = { ...result, details: publicDetails };
	if (params.action) {
		const text = bounded(
			scanAgentReport(firstText(publicResult) || "Agent action finished.").text,
			MAX_PARENT_RESULT_CHARS,
		);
		return { ...publicResult, content: [{ type: "text", text }] };
	}

	if (params.foreground !== true && publicResult.isError !== true) {
		const id = publicResult.details.asyncId ?? publicResult.details.runId;
		const names = params.tasks?.map(({ agent }) => agent) ?? (params.agent ? [params.agent] : []);
		const subject = names.length > 1 ? `${names.length} Agents` : `Agent ${names[0] ?? "task"}`;
		return {
			...publicResult,
			content: [
				{
					type: "text",
					text: `${subject} started in the background${id ? ` (${id})` : ""}. Continue independent work; completion will not start another main turn. Inspect it with /agents.`,
				},
			],
		};
	}

	if (publicResult.details.results.length > 0) {
		return {
			...publicResult,
			content: [{ type: "text", text: foregroundContent(publicResult.details.results) }],
		};
	}
	const text = bounded(
		scanAgentReport(firstText(publicResult) || "Agent execution failed.").text,
		MAX_PARENT_RESULT_CHARS,
	);
	return { ...publicResult, content: [{ type: "text", text }] };
}
