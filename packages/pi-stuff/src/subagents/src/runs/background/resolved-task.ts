/** Resolve Agent launch contracts without owning process or lifecycle state. */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import type { PonytailMode } from "../../../../ponytail/types.js";
import type { AgentConfig } from "../../agents/agents.ts";
import { buildSkillInjection, normalizeSkillInput, resolveSkillsWithFallback } from "../../agents/skills.ts";
import { resolveDisplayDescription } from "../../shared/display-description.ts";
import { agentDefinitionDigest, type LaunchBindingInput, launchBindingDigest } from "../../shared/launch-contract.ts";
import { findModelInfo, resolveEffectiveThinking } from "../../shared/model-info.ts";
import {
	type ArtifactConfig,
	type ResolvedControlConfig,
	type ResolvedToolBudget,
	type ResolvedTurnBudget,
	resolveChildMaxSubagentDepth,
	type ToolBudgetConfig,
	type TurnBudgetConfig,
} from "../../shared/types.ts";
import { resolveChildCwd } from "../../shared/utils.ts";
import {
	decodeSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
	SUBAGENT_CAPABILITY_CEILING_ENV,
} from "../shared/capability-ceiling.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import {
	resolveMcpDirectToolSelections,
	unresolvedMcpDirectToolSelectors,
} from "../shared/mcp-direct-tool-allowlist.ts";
import {
	type AvailableModelInfo,
	assertModelCandidateLimit,
	buildModelCandidates,
	type ParentModel,
	resolveEffectiveSubagentModel,
} from "../shared/model-fallback.ts";
import type { ModelScopeConfig } from "../shared/model-scope.ts";
import {
	type BackgroundRunnerWork,
	MAX_BACKGROUND_TASKS,
	MAX_PARALLEL_CONCURRENCY,
	type RunnerAgentTask,
} from "../shared/parallel-utils.ts";
import { resolvePiLaunchToolPlan } from "../shared/pi-args.ts";
import { DEFAULT_AGENT_TOOL_BUDGET, validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { DEFAULT_AGENT_TURN_BUDGET, resolveTurnBudgetConfig } from "../shared/turn-budget.ts";

export interface AsyncExecutionContext {
	pi: ExtensionAPI;
	cwd: string;
	currentSessionId: string;
	/** Ledger namespace used by the cross-process Agent governor. */
	governorSessionId?: string;
	/** Physical v2 identity written by every new child. */
	physicalSessionId?: string;
	/** Direct parent session used for supervisor routing from the child. */
	parentSessionId?: string;
	currentModelProvider?: string;
	currentModel?: ParentModel;
	modelScope?: ModelScopeConfig;
	interactive?: boolean;
}

export interface AsyncParallelTaskInput {
	agent: string;
	description?: string;
	delegatedTask?: string;
	task: string;
	cwd?: string;
	model?: string;
	skill?: string | string[] | false;
	turnBudget?: TurnBudgetConfig;
	toolBudget?: ToolBudgetConfig;
}

export interface CommonBuildParams {
	ctx: AsyncExecutionContext;
	/** Parent Agent attribution captured before asynchronous launch begins. */
	parentRunOrigin?: AgentWorkOrigin;
	/** Effective parent Code Mode state captured before child process launch. */
	codeModeEnabled?: boolean;
	/** Effective parent Ponytail mode captured before child process launch. */
	ponytailMode?: PonytailMode;
	codeModeProviderTools?: readonly string[];
	availableModels?: AvailableModelInfo[];
	cwd?: string;
	maxSubagentDepth: number;
	turnBudget?: ResolvedTurnBudget;
	toolBudget?: ResolvedToolBudget;
	configToolBudget?: ResolvedToolBudget;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	controlConfig?: ResolvedControlConfig;
	absoluteDeadlineAt?: number;
	artifactsDir?: string;
	artifactConfig?: ArtifactConfig;
	sessionDir?: string;
	/** Preserve the original governor identity when reviving under a new runtime id. */
	logicalSourceRunId?: string;
	logicalChildIndex?: number;
	childBaseExtensionPath?: string;
}

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

export interface BackgroundRecoveryDescriptor {
	version: 2;
	sourceRunId: string;
	childIndex: number;
	launchContractDigest?: string;
	agent: string;
	context?: ContextMode;
	sessionFile?: string;
	cwd: string;
	model?: string;
	fallbackModels?: string[];
	thinking?: string;
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mcpDirectTools?: string[];
	systemPrompt?: string;
	systemPromptMode: "append" | "replace";
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	skills?: string[];
	skillPath?: string[];
	agentFilePath?: string;
	controlConfig?: ResolvedControlConfig;
	absoluteDeadlineAt?: number;
	initialTurnBudget?: ResolvedTurnBudget;
	initialToolBudget?: ResolvedToolBudget;
	maxSubagentDepth: number;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	sessionDir?: string;
	artifactsDir?: string;
	artifactConfig?: ArtifactConfig;
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

export interface BuiltTask {
	task: RunnerAgentTask;
	recovery: BackgroundRecoveryDescriptor;
}

function resolveTaskTurnBudget(
	explicit: TurnBudgetConfig | undefined,
	runBudget: ResolvedTurnBudget | undefined,
	agentBudget: TurnBudgetConfig | undefined,
) {
	if (explicit !== undefined) return resolveTurnBudgetConfig(explicit, "turnBudget");
	if (runBudget !== undefined) return { turnBudget: runBudget };
	if (agentBudget !== undefined) return resolveTurnBudgetConfig(agentBudget, "agent.turnBudget");
	return { turnBudget: DEFAULT_AGENT_TURN_BUDGET };
}

function resolveTaskToolBudget(
	explicit: ToolBudgetConfig | undefined,
	runBudget: ResolvedToolBudget | undefined,
	agentBudget: ToolBudgetConfig | undefined,
	configBudget: ResolvedToolBudget | undefined,
) {
	if (explicit !== undefined) {
		const resolved = validateToolBudgetConfig(explicit, "toolBudget");
		return { toolBudget: resolved.budget, error: resolved.error };
	}
	if (runBudget !== undefined) return { toolBudget: runBudget };
	if (agentBudget !== undefined) {
		const resolved = validateToolBudgetConfig(agentBudget, "agent.toolBudget");
		return { toolBudget: resolved.budget, error: resolved.error };
	}
	return { toolBudget: configBudget ?? DEFAULT_AGENT_TOOL_BUDGET };
}

export function buildResolvedTask(input: {
	runId: string;
	index: number;
	taskInput: AsyncParallelTaskInput;
	agent: AgentConfig;
	params: CommonBuildParams;
	runnerCwd: string;
	context?: ContextMode;
	skills?: string[];
	sessionFile?: string;
	modelOverride?: string;
	modelCandidatesOverride?: string[];
	thinkingOverride?: AgentConfig["thinking"];
}): BuiltTask | { error: string } {
	const { taskInput, agent, params } = input;
	const taskCwd = resolveChildCwd(input.runnerCwd, taskInput.cwd);
	const normalizedTaskSkills = normalizeSkillInput(taskInput.skill);
	const requestedSkills =
		input.skills ?? (normalizedTaskSkills === false ? [] : normalizedTaskSkills) ?? agent.skills ?? [];
	const { resolved: resolvedSkills, missing } = resolveSkillsWithFallback(
		requestedSkills,
		taskCwd,
		params.ctx.cwd,
		agent.skillPath,
		agent.filePath ? path.dirname(agent.filePath) : taskCwd,
	);
	if (missing.length > 0) return { error: `Skills not found: ${missing.join(", ")}` };

	let systemPrompt = agent.systemPrompt?.trim() ?? "";
	if (resolvedSkills.length > 0) {
		const injection = buildSkillInjection(resolvedSkills);
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
	}

	const resolvedPrimaryModel = resolveEffectiveSubagentModel(
		input.modelOverride ?? taskInput.model,
		agent.model,
		params.ctx.currentModel,
		params.availableModels,
		params.ctx.currentModelProvider,
		{ scope: params.ctx.modelScope },
	);
	const modelCandidates = input.modelCandidatesOverride?.length
		? [...input.modelCandidatesOverride]
		: buildModelCandidates(
				resolvedPrimaryModel,
				agent.fallbackModels,
				params.availableModels,
				params.ctx.currentModelProvider,
				{ scope: params.ctx.modelScope },
			);
	assertModelCandidateLimit(modelCandidates);
	const primaryModel = modelCandidates[0] ?? resolvedPrimaryModel;
	const thinkingConfig = input.thinkingOverride ?? agent.thinking;
	const thinking = resolveEffectiveThinking(primaryModel, thinkingConfig);
	const turnBudget = resolveTaskTurnBudget(taskInput.turnBudget, params.turnBudget, agent.defaultTurnBudget);
	if (turnBudget.error) return { error: turnBudget.error };
	const toolBudget = resolveTaskToolBudget(
		taskInput.toolBudget,
		params.toolBudget,
		agent.toolBudget,
		params.configToolBudget,
	);
	if (toolBudget.error) return { error: toolBudget.error };

	const maxSubagentDepth = resolveChildMaxSubagentDepth(params.maxSubagentDepth, agent.maxSubagentDepth);
	const capabilityCeiling = params.capabilityCeiling;
	const definitionDigest = agentDefinitionDigest(agent);
	const toolPlan = resolvePiLaunchToolPlan({
		tools: agent.tools,
		extensions: agent.extensions,
		subagentOnlyExtensions: agent.subagentOnlyExtensions,
		mcpDirectTools: agent.mcpDirectTools,
		cwd: taskCwd,
		childBaseExtensionPath: params.childBaseExtensionPath,
		requireReadTool: agent.inheritSkills || resolvedSkills.length > 0,
		capabilityCeiling,
		inheritedCapabilityCeiling: decodeSubagentCapabilityCeiling(process.env[SUBAGENT_CAPABILITY_CEILING_ENV]),
	});
	if (agent.mcpDirectTools?.length && !toolPlan.capabilityCeiling?.denyExtensions) {
		const advertisedSelections = resolveMcpDirectToolSelections(agent.mcpDirectTools, params.ctx.cwd);
		const advertisedMissing = unresolvedMcpDirectToolSelectors(agent.mcpDirectTools, advertisedSelections);
		if (advertisedMissing.length) {
			return {
				error: `Agent '${agent.name}' direct MCP Tool selectors do not resolve in the parent project: ${advertisedMissing.join(", ")}.`,
			};
		}
		const executionMissing = unresolvedMcpDirectToolSelectors(agent.mcpDirectTools, toolPlan.resolvedMcpSelections);
		if (executionMissing.length) {
			return {
				error: `Agent '${agent.name}' direct MCP Tool selectors do not resolve in the execution cwd: ${executionMissing.join(", ")}.`,
			};
		}
		const signature = (selections: typeof advertisedSelections) =>
			selections
				.map((selection) => `${selection.selector}:${selection.name}`)
				.sort()
				.join(",");
		if (signature(advertisedSelections) !== signature(toolPlan.resolvedMcpSelections)) {
			const names = (selections: typeof advertisedSelections) =>
				selections
					.map((selection) => selection.name)
					.sort()
					.join(", ");
			return {
				error: `Agent '${agent.name}' direct MCP Tool contract changes with cwd (parent: ${names(advertisedSelections)}; execution: ${names(toolPlan.resolvedMcpSelections)}).`,
			};
		}
	}
	const launchBinding: Partial<LaunchBindingInput> = {
		definitionDigest,
		task: taskInput.task,
		modelCandidates,
	};
	if (thinking) launchBinding.thinking = thinking;
	launchBinding.systemPrompt = systemPrompt;
	launchBinding.systemPromptMode = agent.systemPromptMode;
	launchBinding.inheritProjectContext = agent.inheritProjectContext;
	launchBinding.inheritSkills = agent.inheritSkills;
	launchBinding.skills = resolvedSkills.map((skill) => skill.name);
	launchBinding.tools = toolPlan.effectiveToolAllowlist;
	launchBinding.extensions = toolPlan.extensionArgs;
	launchBinding.mcpDirectTools = toolPlan.effectiveMcpTools;
	launchBinding.turnBudget = turnBudget.turnBudget;
	launchBinding.toolBudget = toolBudget.toolBudget;
	launchBinding.maxSubagentDepth = maxSubagentDepth;
	launchBinding.capabilityCeiling = capabilityCeiling;
	// SAFETY: both required launch-binding flags and the definition digest are assigned before hashing.
	const launchContractDigest = launchBindingDigest(launchBinding as LaunchBindingInput);

	const task: Partial<RunnerAgentTask> = {
		governorSessionId: params.ctx.governorSessionId ?? params.ctx.currentSessionId,
		physicalSessionId: params.ctx.physicalSessionId ?? params.ctx.currentSessionId,
		parentSessionId: params.ctx.parentSessionId ?? params.ctx.currentSessionId,
		logicalAgentPathComponent: `${params.logicalSourceRunId ?? input.runId}:${
			params.logicalChildIndex ?? input.index
		}`,
		agent: agent.name,
		description: resolveDisplayDescription(taskInput.description, taskInput.task),
		delegatedTask: taskInput.delegatedTask ?? taskInput.task,
		task: taskInput.task,
	};
	if (input.context) task.context = input.context;
	task.cwd = taskCwd;
	if (primaryModel) task.model = primaryModel;
	if (thinking) task.thinking = thinking;
	task.modelCandidates = modelCandidates;
	const modelContextWindows = modelCandidates.flatMap((model) => {
		const contextWindow = findModelInfo(
			model,
			params.availableModels,
			params.ctx.currentModelProvider,
		)?.contextWindow;
		if (contextWindow === undefined || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) return [];
		return [{ model, contextWindow }];
	});
	if (modelContextWindows.length > 0) task.modelContextWindows = modelContextWindows;
	task.tools = agent.tools;
	task.extensions = agent.extensions;
	task.subagentOnlyExtensions = agent.subagentOnlyExtensions;
	task.mcpDirectTools = agent.mcpDirectTools;
	task.systemPrompt = systemPrompt;
	task.systemPromptMode = agent.systemPromptMode;
	task.inheritProjectContext = agent.inheritProjectContext;
	task.inheritSkills = agent.inheritSkills;
	if (params.childBaseExtensionPath) task.childBaseExtensionPath = params.childBaseExtensionPath;
	task.skills = resolvedSkills.map((skill) => skill.name);
	if (input.sessionFile) task.sessionFile = input.sessionFile;
	task.maxSubagentDepth = maxSubagentDepth;
	task.definitionDigest = definitionDigest;
	task.launchBindingTask = taskInput.task;
	task.launchContractDigest = launchContractDigest;
	if (turnBudget.turnBudget) task.turnBudget = turnBudget.turnBudget;
	if (toolBudget.toolBudget) task.toolBudget = toolBudget.toolBudget;
	if (capabilityCeiling) task.capabilityCeiling = capabilityCeiling;

	const recovery: Partial<BackgroundRecoveryDescriptor> = {
		version: 2,
		sourceRunId: params.logicalSourceRunId ?? input.runId,
		childIndex: params.logicalChildIndex ?? input.index,
		launchContractDigest,
		agent: agent.name,
	};
	if (input.context) recovery.context = input.context;
	if (input.sessionFile) recovery.sessionFile = input.sessionFile;
	recovery.cwd = taskCwd;
	if (primaryModel) recovery.model = primaryModel;
	if (modelCandidates.length > 1) recovery.fallbackModels = modelCandidates.slice(1);
	if (thinking) recovery.thinking = thinking;
	if (agent.tools) recovery.tools = [...agent.tools];
	if (agent.extensions) recovery.extensions = [...agent.extensions];
	if (agent.subagentOnlyExtensions) recovery.subagentOnlyExtensions = [...agent.subagentOnlyExtensions];
	if (agent.mcpDirectTools) recovery.mcpDirectTools = [...agent.mcpDirectTools];
	if (systemPrompt) recovery.systemPrompt = systemPrompt;
	recovery.systemPromptMode = agent.systemPromptMode;
	recovery.inheritProjectContext = agent.inheritProjectContext;
	recovery.inheritSkills = agent.inheritSkills;
	if (resolvedSkills.length) recovery.skills = resolvedSkills.map((skill) => skill.name);
	if (agent.skillPath) recovery.skillPath = [...agent.skillPath];
	if (agent.filePath) recovery.agentFilePath = agent.filePath;
	if (params.controlConfig) recovery.controlConfig = params.controlConfig;
	if (params.absoluteDeadlineAt) recovery.absoluteDeadlineAt = params.absoluteDeadlineAt;
	if (turnBudget.turnBudget) recovery.initialTurnBudget = turnBudget.turnBudget;
	if (toolBudget.toolBudget) recovery.initialToolBudget = toolBudget.toolBudget;
	recovery.maxSubagentDepth = maxSubagentDepth;
	if (capabilityCeiling) recovery.capabilityCeiling = capabilityCeiling;
	if (params.sessionDir) recovery.sessionDir = params.sessionDir;
	if (params.artifactsDir) recovery.artifactsDir = params.artifactsDir;
	if (params.artifactConfig) recovery.artifactConfig = params.artifactConfig;
	// SAFETY: every required RunnerAgentTask field is assigned from resolved launch inputs above.
	const resolvedTask = task as RunnerAgentTask;
	// SAFETY: every required recovery descriptor field is assigned alongside its paired RunnerAgentTask.
	const recoveryDescriptor = recovery as BackgroundRecoveryDescriptor;
	return { task: resolvedTask, recovery: recoveryDescriptor };
}

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
