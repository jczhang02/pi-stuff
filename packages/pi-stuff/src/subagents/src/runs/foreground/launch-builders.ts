import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getPonytailMode } from "../../../../ponytail/state.js";
import type { AgentConfig } from "../../agents/agents.ts";
import { normalizeSkillInput } from "../../agents/skills.ts";
import { type Details, resolveChildMaxSubagentDepth, wrapForkTask } from "../../shared/types.ts";
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
import { resolvedTaskInput, taskInputs } from "./launch-model-planning.ts";

function childTask(data: PreparedLaunch, task: TaskParam, index: number): string {
	const taskText = data.context === "fork" ? wrapForkTask(task.task) : task.task;
	const needsProjection = data.context !== "fork" || !data.rawForkByIndex[index];
	return needsProjection && data.params.contextProjection
		? `${data.params.contextProjection}\n\n${taskText}`
		: taskText;
}

function parallelInputs(data: PreparedLaunch): AsyncParallelTaskInput[] {
	return (data.params.tasks ?? []).map((task, index) =>
		resolvedTaskInput(task, childTask(data, task, index), task.task),
	);
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

function commonBuild(data: PreparedLaunch, deps: ExecutorDeps) {
	return {
		ctx: data.executionContext,
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
		capabilityCeiling: data.capabilityCeiling,
		childBaseExtensionPath: deps.childBaseExtensionPath,
	};
}

function parallelBuild(data: PreparedLaunch, deps: ExecutorDeps, common = commonBuild(data, deps)) {
	const tasks = parallelInputs(data);
	return {
		...common,
		agents: data.agents,
		tasks,
		contextForAgent: () => data.context,
		thinking: data.params.thinking,
		thinkingOverridesByIndex: data.thinkingOverrides,
		sessionFilesByIndex: data.sessionFiles,
		modelCandidatesByIndex: data.modelCandidatesByIndex,
		concurrency: tasks.length,
		globalConcurrencyLimit: 20,
		worktree: data.params.worktree === true,
		maxSubagentDepth: data.maxSubagentDepth,
	};
}

function singleBuild(data: PreparedLaunch, deps: ExecutorDeps, common = commonBuild(data, deps)) {
	const name = data.params.agent;
	const task = data.params.task;
	if (!name || !task) return undefined;
	const agent = singleAgent(data);
	const skills = normalizeSkillInput(data.params.skill);
	return {
		...common,
		agent: name,
		description: data.params.description,
		task: childTask(data, { agent: name, task }, 0),
		agentConfig: agent,
		context: data.context,
		skills: skills === false ? [] : skills,
		sessionFile: data.sessionFiles[0],
		modelOverride: data.params.model,
		modelCandidates: data.modelCandidatesByIndex[0],
		thinkingOverride: data.thinkingOverrides[0] ?? data.params.thinking,
		maxSubagentDepth: maxDepthFor(data, agent),
	};
}

function buildRunnerWork(data: PreparedLaunch, deps: ExecutorDeps, common: ReturnType<typeof commonBuild>) {
	if (data.mode === "parallel") return buildAsyncParallelRunnerWork(data.runId, parallelBuild(data, deps, common));
	const input = singleBuild(data, deps, common);
	return input
		? buildAsyncSingleRunnerWork(data.runId, { ...input, delegatedTask: data.params.task })
		: { error: "A single Agent launch requires agent and task." };
}

export async function launchBackground(
	data: PreparedLaunch,
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
	if (data.mode === "parallel") {
		const built = parallelBuild(data, deps);
		return await engines.backgroundParallel(data.runId, {
			...built,
			parentRunOrigin: hooks?.parentRunOrigin,
			goal: data.params.tasks?.[0]?.description ?? data.params.tasks?.[0]?.task ?? "",
			sessionRoot: data.sessionRoot,
			nestedRoute: data.nestedRoute,
			timeoutMs: data.timeoutMs,
		});
	}

	const built = singleBuild(data, deps);
	if (!built) return errorResult("single", "A single Agent launch requires agent and task.");
	return await engines.backgroundSingle(data.runId, {
		...built,
		parentRunOrigin: hooks?.parentRunOrigin,
		goal: data.params.description ?? data.params.task ?? "",
		sessionRoot: data.sessionRoot,
		nestedRoute: data.nestedRoute,
		timeoutMs: data.timeoutMs,
	});
}

function buildForegroundConfig(
	data: PreparedLaunch,
	deps: ExecutorDeps,
): PreparedForegroundConfig | AgentToolResult<Details> {
	const common = commonBuild(data, deps);
	const built = buildRunnerWork(data, deps, common);
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
		sessionId: data.executionContext.currentSessionId,
		startedAt: Date.now(),
		artifactConfig: data.artifactConfig,
		nativeSupervisor: false,
		sessionDir: data.sessionRoot,
	};
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
	const preparedConfig = buildForegroundConfig(data, deps);
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
