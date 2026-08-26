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
import type { RunnerAgentTask } from "../shared/parallel-utils.ts";
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

export interface BuiltTask {
	task: RunnerAgentTask;
	recovery: BackgroundRecoveryDescriptor;
}

export interface ResolvedTaskBuildInput {
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
}

interface ResolvedTaskProjection {
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	definitionDigest: string;
	launchContractDigest: string;
	maxSubagentDepth: number;
	modelCandidates: string[];
	modelContextWindows: Array<{ model: string; contextWindow: number }>;
	primaryModel?: string;
	skillNames: string[];
	systemPrompt: string;
	taskCwd: string;
	thinking?: string;
	toolBudget?: ResolvedToolBudget;
	turnBudget?: ResolvedTurnBudget;
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

function projectBuiltTask(input: ResolvedTaskBuildInput, resolved: ResolvedTaskProjection): BuiltTask {
	const { agent, params, taskInput } = input;
	const task: RunnerAgentTask = {
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
		cwd: resolved.taskCwd,
		modelCandidates: [...resolved.modelCandidates],
		systemPrompt: resolved.systemPrompt,
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		skills: [...resolved.skillNames],
		maxSubagentDepth: resolved.maxSubagentDepth,
		definitionDigest: resolved.definitionDigest,
		launchBindingTask: taskInput.task,
		launchContractDigest: resolved.launchContractDigest,
	};
	if (input.context) task.context = input.context;
	if (resolved.primaryModel) task.model = resolved.primaryModel;
	if (resolved.thinking) task.thinking = resolved.thinking;
	if (resolved.modelContextWindows.length > 0) {
		task.modelContextWindows = resolved.modelContextWindows.map((entry) => ({ ...entry }));
	}
	if (agent.tools) task.tools = [...agent.tools];
	if (agent.extensions) task.extensions = [...agent.extensions];
	if (agent.subagentOnlyExtensions) task.subagentOnlyExtensions = [...agent.subagentOnlyExtensions];
	if (agent.mcpDirectTools) task.mcpDirectTools = [...agent.mcpDirectTools];
	if (params.childBaseExtensionPath) task.childBaseExtensionPath = params.childBaseExtensionPath;
	if (input.sessionFile) task.sessionFile = input.sessionFile;
	if (resolved.turnBudget) task.turnBudget = resolved.turnBudget;
	if (resolved.toolBudget) task.toolBudget = resolved.toolBudget;
	if (resolved.capabilityCeiling) task.capabilityCeiling = resolved.capabilityCeiling;
	const recovery: BackgroundRecoveryDescriptor = {
		version: 2,
		sourceRunId: params.logicalSourceRunId ?? input.runId,
		childIndex: params.logicalChildIndex ?? input.index,
		launchContractDigest: resolved.launchContractDigest,
		agent: agent.name,
		cwd: resolved.taskCwd,
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		maxSubagentDepth: resolved.maxSubagentDepth,
	};
	if (input.context) recovery.context = input.context;
	if (input.sessionFile) recovery.sessionFile = input.sessionFile;
	if (resolved.primaryModel) recovery.model = resolved.primaryModel;
	if (resolved.modelCandidates.length > 1) recovery.fallbackModels = resolved.modelCandidates.slice(1);
	if (resolved.thinking) recovery.thinking = resolved.thinking;
	if (agent.tools) recovery.tools = [...agent.tools];
	if (agent.extensions) recovery.extensions = [...agent.extensions];
	if (agent.subagentOnlyExtensions) recovery.subagentOnlyExtensions = [...agent.subagentOnlyExtensions];
	if (agent.mcpDirectTools) recovery.mcpDirectTools = [...agent.mcpDirectTools];
	if (resolved.systemPrompt) recovery.systemPrompt = resolved.systemPrompt;
	if (resolved.skillNames.length > 0) recovery.skills = [...resolved.skillNames];
	if (agent.skillPath) recovery.skillPath = [...agent.skillPath];
	if (agent.filePath) recovery.agentFilePath = agent.filePath;
	if (params.controlConfig) recovery.controlConfig = params.controlConfig;
	if (params.absoluteDeadlineAt) recovery.absoluteDeadlineAt = params.absoluteDeadlineAt;
	if (resolved.turnBudget) recovery.initialTurnBudget = resolved.turnBudget;
	if (resolved.toolBudget) recovery.initialToolBudget = resolved.toolBudget;
	if (resolved.capabilityCeiling) recovery.capabilityCeiling = resolved.capabilityCeiling;
	if (params.sessionDir) recovery.sessionDir = params.sessionDir;
	if (params.artifactsDir) recovery.artifactsDir = params.artifactsDir;
	if (params.artifactConfig) recovery.artifactConfig = params.artifactConfig;
	return { task, recovery };
}

export function buildResolvedTask(input: ResolvedTaskBuildInput): BuiltTask | { error: string } {
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
	const skillNames = resolvedSkills.map((skill) => skill.name);
	const launchBinding: LaunchBindingInput = {
		definitionDigest,
		task: taskInput.task,
		modelCandidates: [...modelCandidates],
		systemPrompt,
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		skills: [...skillNames],
		maxSubagentDepth,
	};
	if (thinking) launchBinding.thinking = thinking;
	if (toolPlan.effectiveToolAllowlist) launchBinding.tools = [...toolPlan.effectiveToolAllowlist];
	if (toolPlan.extensionArgs) launchBinding.extensions = [...toolPlan.extensionArgs];
	if (toolPlan.effectiveMcpTools) launchBinding.mcpDirectTools = [...toolPlan.effectiveMcpTools];
	if (turnBudget.turnBudget) launchBinding.turnBudget = turnBudget.turnBudget;
	if (toolBudget.toolBudget) launchBinding.toolBudget = toolBudget.toolBudget;
	if (capabilityCeiling) launchBinding.capabilityCeiling = capabilityCeiling;
	const modelContextWindows = modelCandidates.flatMap((model) => {
		const contextWindow = findModelInfo(
			model,
			params.availableModels,
			params.ctx.currentModelProvider,
		)?.contextWindow;
		if (contextWindow === undefined || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) return [];
		return [{ model, contextWindow }];
	});
	const projection: ResolvedTaskProjection = {
		definitionDigest,
		launchContractDigest: launchBindingDigest(launchBinding),
		maxSubagentDepth,
		modelCandidates,
		modelContextWindows,
		skillNames,
		systemPrompt,
		taskCwd,
	};
	if (primaryModel) projection.primaryModel = primaryModel;
	if (thinking) projection.thinking = thinking;
	if (turnBudget.turnBudget) projection.turnBudget = turnBudget.turnBudget;
	if (toolBudget.toolBudget) projection.toolBudget = toolBudget.toolBudget;
	if (capabilityCeiling) projection.capabilityCeiling = capabilityCeiling;
	return projectBuiltTask(input, projection);
}
