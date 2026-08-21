import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeString } from "../../../shared/runtime-type.js";
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
	readonly context?: "fork" | "fresh";
	readonly isolation?: "shared" | "worktree";
	readonly foreground?: boolean;
}

const CONTROL_ONLY_FIELDS = new Set(["action", "id", "index", "message"]);
const LAUNCH_ONLY_FIELDS = [
	"agent",
	"context",
	"cwd",
	"description",
	"foreground",
	"isolation",
	"model",
	"skill",
	"task",
	"tasks",
	"thinking",
	"timeoutMs",
	"turnBudget",
	"toolBudget",
] as const;

function hasOwn(params: PublicAgentParams, field: keyof PublicAgentParams): boolean {
	return Object.hasOwn(params, field);
}

function sharedTaskValue<K extends "context" | "isolation" | "foreground">(
	params: PublicAgentParams,
	field: K,
): PublicAgentParams[K] {
	const taskValues = (params.tasks ?? []).filter((task) => Object.hasOwn(task, field)).map((task) => task[field]);
	if (taskValues.length === 0) return params[field];
	const first = taskValues[0];
	if (taskValues.some((value) => value !== first)) {
		throw new Error(`Parallel Agent tasks must use one shared ${field} value.`);
	}
	if (hasOwn(params, field) && params[field] !== first) {
		throw new Error(`Top-level ${field} conflicts with the shared task ${field} value.`);
	}
	// SAFETY: field is the same generic key for every task value and the selected top-level value.
	return (hasOwn(params, field) ? params[field] : first) as PublicAgentParams[K];
}

/**
 * Enforce the product contract without provider-hostile JSON Schema branches.
 * Some OpenAI-compatible providers reject boolean schemas inside oneOf before
 * the model can call the tool, so shape exclusivity belongs at this boundary.
 */
export function normalizePublicAgentParams(params: PublicAgentParams): PublicAgentParams {
	if (params.action) {
		const mixed = LAUNCH_ONLY_FIELDS.find((field) => hasOwn(params, field));
		if (mixed) throw new Error(`Agent control action '${params.action}' cannot include launch field '${mixed}'.`);
		return { ...params };
	}
	const control = [...CONTROL_ONLY_FIELDS].find((field) => field !== "action" && Object.hasOwn(params, field));
	if (control) throw new Error(`Agent launch cannot include control field '${control}'.`);
	const hasSingleField = hasOwn(params, "agent") || hasOwn(params, "task") || hasOwn(params, "description");
	const hasParallel = Array.isArray(params.tasks) && params.tasks.length > 0;
	if (hasSingleField && hasParallel) throw new Error("Provide either agent plus task or tasks, not both.");
	if (hasParallel) {
		const context = sharedTaskValue(params, "context");
		const isolation = sharedTaskValue(params, "isolation");
		const foreground = sharedTaskValue(params, "foreground");
		const normalized = {
			...params,
			tasks: params.tasks?.map(
				({ context: _context, isolation: _isolation, foreground: _foreground, ...task }) => task,
			),
		};
		if (context !== undefined) normalized.context = context;
		if (isolation !== undefined) normalized.isolation = isolation;
		if (foreground !== undefined) normalized.foreground = foreground;
		return normalized;
	}
	if (!params.agent?.trim() || !params.task?.trim()) {
		throw new Error("Provide agent plus task for one launch, or a non-empty tasks list for parallel work.");
	}
	return { ...params };
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
	if (isRuntimeString(value) || isRuntimeBoolean(value) || value === undefined) return value;
	return [...value];
}

function mutableToolBudget(value: PublicAgentParams["toolBudget"]): SubagentParamsLike["toolBudget"] {
	if (!value) return undefined;
	const budget: NonNullable<SubagentParamsLike["toolBudget"]> = {
		soft: value.soft,
		hard: value.hard,
	};
	if (Array.isArray(value.block)) budget.block = [...value.block];
	else if (value.block === "*") budget.block = "*";
	return budget;
}

function mapTask(task: PublicAgentTask): NonNullable<SubagentParamsLike["tasks"]>[number] {
	const mapped: NonNullable<SubagentParamsLike["tasks"]>[number] = {
		agent: task.agent,
		description: resolveDisplayDescription(task.description, task.task),
		task: task.task,
	};
	if (task.cwd) mapped.cwd = task.cwd;
	if (task.model) mapped.model = task.model;
	if (task.skill !== undefined) mapped.skill = mutableSkill(task.skill);
	if (task.turnBudget) mapped.turnBudget = { ...task.turnBudget };
	if (task.toolBudget) mapped.toolBudget = mutableToolBudget(task.toolBudget);
	return mapped;
}

/**
 * Keep the public Claude-style contract small while retaining the mature fork's
 * execution engine behind this boundary.
 */
export function toEngineParams(input: PublicAgentParams): SubagentParamsLike {
	const params = normalizePublicAgentParams(input);
	if (params.action) {
		const control: SubagentParamsLike = { action: params.action };
		if (params.id) control.id = params.id;
		if (params.index !== undefined) control.index = params.index;
		if (params.message) control.message = params.message;
		return control;
	}

	const worktree = params.isolation === "worktree";
	const common: SubagentParamsLike = {
		async: params.foreground !== true,
		context: params.context ?? "fresh",
	};
	if (worktree) common.worktree = true;
	if (params.cwd) common.cwd = params.cwd;
	if (params.model) common.model = params.model;
	if (params.thinking) common.thinking = params.thinking;
	if (params.skill !== undefined) common.skill = mutableSkill(params.skill);
	if (params.timeoutMs !== undefined) common.timeoutMs = params.timeoutMs;
	if (params.turnBudget) common.turnBudget = { ...params.turnBudget };
	if (params.toolBudget) common.toolBudget = mutableToolBudget(params.toolBudget);

	if (params.tasks?.length) {
		return { ...common, tasks: params.tasks.map(mapTask) };
	}
	if (worktree && params.agent && params.task) {
		const task: PublicAgentTask = { agent: params.agent, task: params.task };
		if (params.description) Object.assign(task, { description: params.description });
		if (params.model) Object.assign(task, { model: params.model });
		if (params.skill !== undefined) Object.assign(task, { skill: params.skill });
		if (params.turnBudget) Object.assign(task, { turnBudget: params.turnBudget });
		if (params.toolBudget) Object.assign(task, { toolBudget: params.toolBudget });
		return {
			...common,
			tasks: [mapTask(task)],
		};
	}
	if (params.agent) common.agent = params.agent;
	if (params.task) {
		common.description = resolveDisplayDescription(params.description, params.task);
		common.task = params.task;
	}
	return common;
}

function bounded(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function resultStatus(result: SingleResult): "completed" | "failed" | "stopped" | "status unknown" {
	if (result.interrupted || result.stopped || result.detached) return "stopped";
	if (result.crashed || result.error || (isRuntimeNumber(result.exitCode) && result.exitCode !== 0)) return "failed";
	if (result.exitCode === 0) return "completed";
	return "status unknown";
}

function childSummary(result: SingleResult): string {
	const output = getSingleResultOutput(result).trim();
	const error = result.error?.trim();
	const raw = error
		? `Runtime error: ${error}${output ? `\nPartial child report:\n${output}` : ""}`
		: output || "(no report)";
	return bounded(scanAgentReport(raw).text, MAX_CHILD_SUMMARY_CHARS);
}

function foregroundContent(results: readonly SingleResult[]): string {
	const blocks = results.map((result, index) => {
		const heading =
			results.length === 1
				? `Agent ${result.agent} ${resultStatus(result)}.`
				: `${index + 1}. ${result.agent} — ${resultStatus(result)}`;
		const contextNudge = result.contextNudgeObserved
			? "\nContext housekeeping observed: magic-context:ceiling-nudge."
			: "";
		return `${heading}${contextNudge}\n${childSummary(result)}`;
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
	const childFailed =
		!params.action &&
		params.foreground === true &&
		publicDetails.results.some(
			(child) =>
				(isRuntimeNumber(child.exitCode) && child.exitCode !== 0) || Boolean(child.error) || child.crashed === true,
		);
	const publicResult: AgentEngineResult = {
		...result,
		details: publicDetails,
	};
	if (childFailed) Object.assign(publicResult, { isError: true });
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
