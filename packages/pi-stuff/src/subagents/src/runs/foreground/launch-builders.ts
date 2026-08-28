import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPonytailMode } from "../../../../ponytail/state.js";
import type { AgentConfig } from "../../agents/agents.ts";
import { normalizeSkillInput } from "../../agents/skills.ts";
import {
	type Details,
	resolveChildMaxSubagentDepth,
	resolveCurrentMaxSubagentDepth,
	wrapForkTask,
} from "../../shared/types.ts";
import {
	type AsyncParallelTaskInput,
	buildAsyncParallelRunnerWork,
	buildAsyncSingleRunnerWork,
	isAsyncAvailable,
} from "../background/async-execution.ts";
import type { BackgroundRunnerConfig } from "../shared/parallel-utils.ts";
import {
	type AgentToolResult,
	type ExecutorDeps,
	type ExecutorEngines,
	errorResult,
	type PreparedLaunch,
	type SubagentExecutionHooks,
	type TaskParam,
} from "./executor-contract.ts";
import { executeForegroundLifecycle, type PreparedForegroundConfig } from "./foreground-lifecycle.ts";
import { claimForegroundRunDirectory } from "./foreground-run-claim.ts";
import { taskInputs } from "./launch-model-planning.ts";

function childTask(data: PreparedLaunch, task: TaskParam, index: number): string {
	const taskText = data.context === "fork" ? wrapForkTask(task.task) : task.task;
	const needsProjection = data.context !== "fork" || !data.rawForkByIndex[index];
	return needsProjection && data.params.contextProjection
		? `${data.params.contextProjection}\n\n${taskText}`
		: taskText;
}

function asyncContext(data: PreparedLaunch, ctx: ExtensionContext, pi: ExtensionAPI) {
	return {
		pi,
		cwd: ctx.cwd,
		currentSessionId: data.currentSessionId,
		governorSessionId: data.governorSessionId,
		physicalSessionId: data.currentSessionId,
		parentSessionId: data.directParentSessionId,
		currentModelProvider: data.parentModel?.provider,
		currentModel: data.parentModel,
		modelScope: data.modelScope,
		interactive: ctx.hasUI,
	};
}

function parallelInputs(data: PreparedLaunch): AsyncParallelTaskInput[] {
	return (data.params.tasks ?? []).map((task, index) => {
		const skill = normalizeSkillInput(task.skill);
		const input: AsyncParallelTaskInput = {
			agent: task.agent,
			delegatedTask: task.task,
			task: childTask(data, task, index),
		};
		if (task.description) input.description = task.description;
		if (task.cwd) input.cwd = task.cwd;
		if (task.model) input.model = task.model;
		if (skill !== undefined) input.skill = skill;
		if (task.turnBudget) input.turnBudget = task.turnBudget;
		if (task.toolBudget) input.toolBudget = task.toolBudget;
		return input;
	});
}

function singleAgent(data: PreparedLaunch): AgentConfig {
	const agent = data.agents.find((candidate) => candidate.name === data.params.agent);
	if (!agent) throw new Error(`Unknown Agent: ${data.params.agent ?? "(missing)"}`);
	return agent;
}

function maxDepthFor(data: PreparedLaunch, agent?: AgentConfig): number {
	return resolveChildMaxSubagentDepth(data.maxSubagentDepth, agent?.maxSubagentDepth);
}

export function effectiveCodeModeEnabled(deps: ExecutorDeps): boolean {
	return deps.resolveCodeModeEnabled?.() ?? process.env["PI_STUFF_CODE_MODE_DEFAULT"]?.trim().toLowerCase() === "on";
}

export function ponytailLaunchSnapshot(pi: Pick<ExtensionAPI, "events">) {
	const ponytailMode = getPonytailMode(pi);
	return ponytailMode === undefined ? {} : { ponytailMode };
}

function commonBuild(data: PreparedLaunch, ctx: ExtensionContext, deps: ExecutorDeps) {
	return {
		ctx: asyncContext(data, ctx, deps.pi),
		...ponytailLaunchSnapshot(deps.pi),
		codeModeEnabled: effectiveCodeModeEnabled(deps),
		codeModeProviderTools: deps.codeModeProviderTools,
		availableModels: data.availableModels,
		cwd: data.effectiveCwd,
		artifactsDir: data.artifactConfig.enabled ? data.artifactsDir : undefined,
		artifactConfig: data.artifactConfig,
		sessionDir: data.sessionRoot,
		turnBudget: data.turnBudget,
		toolBudget: data.toolBudget,
		configToolBudget: data.configToolBudget,
		capabilityCeiling: data.capabilityCeiling,
		childBaseExtensionPath: deps.childBaseExtensionPath,
	};
}

export async function launchBackground(
	data: PreparedLaunch,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
	engines: ExecutorEngines,
	hooks?: SubagentExecutionHooks,
): Promise<AgentToolResult<Details>> {
	if (!isAsyncAvailable()) {
		return errorResult(
			data.mode,
			"Background Agents are unavailable because the bundled TypeScript runner was not found.",
		);
	}
	const common = commonBuild(data, ctx, deps);
	if (data.mode === "parallel") {
		const tasks = parallelInputs(data);
		return await engines.backgroundParallel(data.runId, {
			...common,
			parentRunOrigin: hooks?.parentRunOrigin,
			agents: data.agents,
			tasks,
			goal: data.params.tasks?.[0]?.description ?? data.params.tasks?.[0]?.task ?? "",
			contextForAgent: () => data.context,
			thinking: data.params.thinking,
			thinkingOverridesByIndex: data.thinkingOverrides,
			sessionFilesByIndex: data.sessionFiles,
			modelCandidatesByIndex: data.modelCandidatesByIndex,
			concurrency: tasks.length,
			globalConcurrencyLimit: 20,
			worktree: data.params.worktree === true,
			sessionRoot: data.sessionRoot,
			maxSubagentDepth: resolveCurrentMaxSubagentDepth(deps.config.maxSubagentDepth),
			worktreeSetupHook: deps.config.worktreeSetupHook,
			worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
			worktreeBaseDir: deps.config.worktreeBaseDir,
			nestedRoute: data.nestedRoute,
			timeoutMs: data.timeoutMs,
		});
	}

	const agent = singleAgent(data);
	const task = data.params.task;
	if (!task) return errorResult("single", "A single Agent launch requires task.");
	const skills = normalizeSkillInput(data.params.skill);
	return await engines.backgroundSingle(data.runId, {
		...common,
		parentRunOrigin: hooks?.parentRunOrigin,
		agent: agent.name,
		description: data.params.description,
		task: childTask(data, { agent: agent.name, task }, 0),
		goal: data.params.description ?? data.params.task ?? "",
		agentConfig: agent,
		context: data.context,
		skills: skills === false ? [] : skills,
		sessionRoot: data.sessionRoot,
		sessionFile: data.sessionFiles[0],
		modelOverride: data.params.model,
		modelCandidates: data.modelCandidatesByIndex[0],
		thinkingOverride: data.thinkingOverrides[0] ?? data.params.thinking,
		maxSubagentDepth: maxDepthFor(data, agent),
		worktreeSetupHook: deps.config.worktreeSetupHook,
		worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
		worktreeBaseDir: deps.config.worktreeBaseDir,
		nestedRoute: data.nestedRoute,
		timeoutMs: data.timeoutMs,
	});
}

function buildForegroundConfig(
	data: PreparedLaunch,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
): PreparedForegroundConfig | AgentToolResult<Details> {
	const common = commonBuild(data, ctx, deps);
	const singleName = data.params.agent;
	const singleTask = data.params.task;
	const built =
		data.mode === "parallel"
			? buildAsyncParallelRunnerWork(data.runId, {
					...common,
					agents: data.agents,
					tasks: parallelInputs(data),
					contextForAgent: () => data.context,
					thinking: data.params.thinking,
					thinkingOverridesByIndex: data.thinkingOverrides,
					sessionFilesByIndex: data.sessionFiles,
					modelCandidatesByIndex: data.modelCandidatesByIndex,
					concurrency: data.params.tasks?.length ?? 1,
					globalConcurrencyLimit: 20,
					worktree: data.params.worktree === true,
					maxSubagentDepth: resolveCurrentMaxSubagentDepth(deps.config.maxSubagentDepth),
				})
			: !singleName || !singleTask
				? { error: "A single Agent launch requires agent and task." }
				: buildAsyncSingleRunnerWork(data.runId, {
						...common,
						agent: singleName,
						description: data.params.description,
						delegatedTask: singleTask,
						task: childTask(data, { agent: singleName, task: singleTask }, 0),
						agentConfig: singleAgent(data),
						context: data.context,
						skills: (() => {
							const skills = normalizeSkillInput(data.params.skill);
							return skills === false ? [] : skills;
						})(),
						sessionFile: data.sessionFiles[0],
						modelOverride: data.params.model,
						modelCandidates: data.modelCandidatesByIndex[0],
						thinkingOverride: data.thinkingOverrides[0] ?? data.params.thinking,
						maxSubagentDepth: maxDepthFor(data, singleAgent(data)),
					});
	if ("error" in built) return errorResult(data.mode, built.error);

	const directoryClaim = claimForegroundRunDirectory(data.runId, data.inheritedNestedRoute);
	const asyncDir = directoryClaim.asyncDir;
	const resultPath = path.join(asyncDir, "completion.json");
	const deadlineAt = data.timeoutMs === undefined ? undefined : Date.now() + data.timeoutMs;
	let nestedSelf: BackgroundRunnerConfig["nestedSelf"];
	if (data.inheritedNestedRoute && data.nestedParentAddress) {
		nestedSelf = {
			parentRunId: data.nestedParentAddress.parentRunId,
			depth: data.nestedParentAddress.depth,
			path: data.nestedParentAddress.path,
		};
		if (data.nestedParentAddress.parentStepIndex !== undefined) {
			nestedSelf.parentStepIndex = data.nestedParentAddress.parentStepIndex;
		}
	}
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: data.runId,
		codeModeEnabled: common.codeModeEnabled,
		...ponytailLaunchSnapshot(deps.pi),
		work: built.work,
		resultPath,
		cwd: built.runnerCwd,
		asyncDir,
		sessionId: data.currentSessionId,
		startedAt: Date.now(),
		artifactConfig: data.artifactConfig,
		nativeSupervisor: false,
		sessionDir: data.sessionRoot,
	};
	if (deps.config.worktreeSetupHook) config.worktreeSetupHook = deps.config.worktreeSetupHook;
	if (deps.config.worktreeSetupHookTimeoutMs !== undefined)
		config.worktreeSetupHookTimeoutMs = deps.config.worktreeSetupHookTimeoutMs;
	if (deps.config.worktreeBaseDir) config.worktreeBaseDir = deps.config.worktreeBaseDir;
	if (data.nestedRoute) config.nestedRoute = data.nestedRoute;
	if (nestedSelf) config.nestedSelf = nestedSelf;
	if (common.codeModeProviderTools?.length) config.codeModeProviderTools = [...common.codeModeProviderTools];
	if (data.artifactConfig.enabled) config.artifactsDir = data.artifactsDir;
	if (data.timeoutMs !== undefined) {
		config.timeoutMs = data.timeoutMs;
		if (deadlineAt !== undefined) config.deadlineAt = deadlineAt;
	}
	if (data.capabilityCeiling) config.capabilityCeiling = data.capabilityCeiling;
	const recoveries = built.recoveries;
	return { config, directoryClaim, recoveries };
}

export async function launchForeground(
	data: PreparedLaunch,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
	engines: ExecutorEngines,
	signal: AbortSignal,
	onUpdate?: (result: AgentToolResult<Details>) => void,
	hooks?: SubagentExecutionHooks,
	onLifecycleCommitted?: () => void,
): Promise<AgentToolResult<Details>> {
	if (signal.aborted) {
		return errorResult(data.mode, "Foreground Agent cancelled before launch.", {
			runId: data.runId,
			cwd: data.effectiveCwd,
			stopped: true,
		});
	}
	const preparedConfig = buildForegroundConfig(data, ctx, deps);
	if ("content" in preparedConfig) return preparedConfig;
	return await executeForegroundLifecycle(
		data,
		taskInputs(data.params),
		preparedConfig,
		deps,
		engines.foreground,
		signal,
		onUpdate,
		hooks,
		onLifecycleCommitted,
	);
}
