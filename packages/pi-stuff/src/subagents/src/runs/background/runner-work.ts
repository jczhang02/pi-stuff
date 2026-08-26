/** Project resolved Agent launch contracts into single or parallel runner work. */

import type { AgentConfig } from "../../agents/agents.ts";
import { resolveChildCwd } from "../../shared/utils.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import { type BackgroundRunnerWork, MAX_BACKGROUND_TASKS, MAX_PARALLEL_CONCURRENCY } from "../shared/parallel-utils.ts";
import {
	type AsyncParallelTaskInput,
	type BackgroundRecoveryDescriptor,
	type BuiltTask,
	buildResolvedTask,
	type CommonBuildParams,
} from "./resolved-task.ts";

export interface AsyncParallelRunnerWorkBuildParams extends CommonBuildParams {
	agents: AgentConfig[];
	tasks: AsyncParallelTaskInput[];
	contextForAgent?: (agentName: string) => ContextMode;
	thinking?: AgentConfig["thinking"];
	thinkingOverridesByIndex?: Array<AgentConfig["thinking"] | undefined>;
	sessionFilesByIndex?: Array<string | undefined>;
	modelCandidatesByIndex?: Array<string[] | undefined>;
	concurrency?: number;
	globalConcurrencyLimit?: number;
	worktree?: boolean;
}

export interface AsyncSingleRunnerWorkBuildParams extends CommonBuildParams {
	agent: string;
	description?: string;
	delegatedTask?: string;
	task: string;
	agentConfig: AgentConfig;
	context?: ContextMode;
	skills?: string[];
	sessionFile?: string;
	modelOverride?: string;
	modelCandidates?: string[];
	thinkingOverride?: AgentConfig["thinking"];
}

export type AsyncRunnerWorkBuildResult =
	| {
			runnerCwd: string;
			work: BackgroundRunnerWork;
			recoveries: BackgroundRecoveryDescriptor[];
	  }
	| { error: string };

export type AsyncSingleRunnerWorkBuildResult =
	| {
			runnerCwd: string;
			work: Extract<BackgroundRunnerWork, { mode: "single" }>;
			recovery: BackgroundRecoveryDescriptor;
	  }
	| { error: string };

export function buildAsyncParallelRunnerWork(
	id: string,
	params: AsyncParallelRunnerWorkBuildParams,
): AsyncRunnerWorkBuildResult {
	if (params.tasks.length === 0) return { error: "Parallel background work requires at least one task." };
	if (params.tasks.length > MAX_BACKGROUND_TASKS) {
		return { error: `Parallel background work supports at most ${MAX_BACKGROUND_TASKS} tasks per launch.` };
	}
	const runnerCwd = resolveChildCwd(params.ctx.cwd, params.cwd);
	const resolved: BuiltTask[] = [];
	for (let index = 0; index < params.tasks.length; index++) {
		const taskInput = params.tasks[index];
		if (!taskInput) return { error: `Parallel task ${index} is missing.` };
		const agent = params.agents.find((candidate) => candidate.name === taskInput.agent);
		if (!agent) return { error: `Unknown agent: ${taskInput.agent}` };
		const built = buildResolvedTask({
			runId: id,
			index,
			taskInput,
			agent,
			params,
			runnerCwd,
			context: params.contextForAgent?.(taskInput.agent),
			sessionFile: params.sessionFilesByIndex?.[index],
			thinkingOverride: params.thinkingOverridesByIndex?.[index] ?? params.thinking,
			modelCandidatesOverride: params.modelCandidatesByIndex?.[index],
		});
		if ("error" in built) return built;
		resolved.push(built);
	}
	const configuredConcurrency = Math.max(1, Math.floor(params.concurrency ?? MAX_PARALLEL_CONCURRENCY) || 1);
	const concurrency = Math.min(
		params.tasks.length,
		configuredConcurrency,
		Math.max(1, Math.floor(params.globalConcurrencyLimit ?? configuredConcurrency) || 1),
	);
	return {
		runnerCwd,
		work: {
			mode: "parallel",
			group: {
				tasks: resolved.map((entry) => entry.task),
				concurrency,
				worktree: params.worktree === true,
			},
		},
		recoveries: resolved.map((entry) => entry.recovery),
	};
}

export function buildAsyncSingleRunnerWork(
	id: string,
	params: AsyncSingleRunnerWorkBuildParams,
): AsyncSingleRunnerWorkBuildResult {
	const runnerCwd = resolveChildCwd(params.ctx.cwd, params.cwd);
	const built = buildResolvedTask({
		runId: id,
		index: 0,
		taskInput: {
			agent: params.agent,
			description: params.description,
			delegatedTask: params.delegatedTask,
			task: params.task,
		},
		agent: params.agentConfig,
		params,
		runnerCwd,
		context: params.context,
		skills: params.skills,
		sessionFile: params.sessionFile,
		modelOverride: params.modelOverride,
		modelCandidatesOverride: params.modelCandidates,
		thinkingOverride: params.thinkingOverride,
	});
	if ("error" in built) return built;
	return {
		runnerCwd,
		work: { mode: "single", task: built.task },
		recovery: built.recovery,
	};
}
