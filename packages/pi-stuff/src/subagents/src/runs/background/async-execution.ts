/** Build and launch detached single-Agent or parallel-Agent runs. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import type { AgentConfig } from "../../agents/agents.ts";
import { buildSkillInjection, normalizeSkillInput, resolveSkillsWithFallback } from "../../agents/skills.ts";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { resolveDisplayDescription } from "../../shared/display-description.ts";
import { agentDefinitionDigest, launchBindingDigest } from "../../shared/launch-contract.ts";
import { resolveEffectiveThinking } from "../../shared/model-info.ts";
import { ensurePrivateDirectory, readBoundedOwnedFile } from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import {
	type ArtifactConfig,
	ASYNC_DIR,
	type AsyncStatus,
	type Details,
	getAsyncConfigPath,
	type NestedRouteInfo,
	type ProcessTerminalV1,
	RESULTS_DIR,
	type ResolvedControlConfig,
	type ResolvedToolBudget,
	type ResolvedTurnBudget,
	resolveChildMaxSubagentDepth,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_ASYNC_STATUS_EVENT,
	SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
	SUBAGENT_PROCESS_TERMINAL_EVENT,
	TEMP_ROOT_DIR,
	type ToolBudgetConfig,
	type TurnBudgetConfig,
} from "../../shared/types.ts";
import { MAX_ASYNC_STATUS_FILE_BYTES, PI_CODING_AGENT_PACKAGE_ROOT_ENV, resolveChildCwd } from "../../shared/utils.ts";
import { resolveBunRuntimeCommand } from "../shared/bun-runtime.ts";
import {
	decodeSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
	resolveCurrentSubagentCapabilityCeiling,
	SUBAGENT_CAPABILITY_CEILING_ENV,
} from "../shared/capability-ceiling.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import {
	type AvailableModelInfo,
	assertModelCandidateLimit,
	buildModelCandidates,
	type ParentModel,
	resolveEffectiveSubagentModel,
} from "../shared/model-fallback.ts";
import type { ModelScopeConfig } from "../shared/model-scope.ts";
import {
	nestedResultsPath,
	nestedSummaryFromAsyncStatus,
	resolveInheritedNestedRouteFromEnv,
	resolveNestedParentAddressFromEnv,
	writeNestedEvent,
} from "../shared/nested-events.ts";
import {
	type BackgroundRunnerConfig,
	type BackgroundRunnerWork,
	MAX_BACKGROUND_TASKS,
	MAX_PARALLEL_CONCURRENCY,
	type RunnerAgentTask,
} from "../shared/parallel-utils.ts";
import { resolvePiLaunchToolPlan } from "../shared/pi-args.ts";
import { resolvePiPackageRoot, resolveStandalonePiHostExecutable } from "../shared/pi-spawn.ts";
import type { SessionLeaseIntent } from "../shared/session-lease.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { initialTurnBudgetState, resolveTurnBudgetConfig } from "../shared/turn-budget.ts";
import { createInitialStatus } from "./initial-status.ts";
import { finalizeProcessTerminal, readProcessTerminal } from "./process-terminal.ts";
import {
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
	terminateOrphanWriterProcesses,
} from "./writer-process-registry.ts";

const START_EVENT_TASK_PREVIEW_CODE_UNITS = 500;
const MAX_NESTED_RESULT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RUNNER_STARTUP_FILE_BYTES = 64 * 1024;

const piPackageRoot = resolvePiPackageRoot();
const piExecutable = resolveStandalonePiHostExecutable();

function taskPreview(task: string): string {
	return task.length <= START_EVENT_TASK_PREVIEW_CODE_UNITS
		? task
		: `${task.slice(0, START_EVENT_TASK_PREVIEW_CODE_UNITS - 1)}…`;
}

function finiteTimestamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function semanticResultState(value: Record<string, unknown>): AsyncStatus["state"] | undefined {
	if ((value["state"] === "complete" || value["state"] === "completed") && value["success"] !== false) {
		return "complete";
	}
	if (value["state"] === "failed" || value["state"] === "paused" || value["state"] === "stopped") {
		return value["state"];
	}
	return value["success"] === true ? "complete" : value["success"] === false ? "failed" : undefined;
}

/**
 * Reconstruct only semantic state when status.json cannot be read. A process
 * close proof establishes lifecycle completion, never task success by itself.
 */
export function buildNestedTerminalFallbackStatus(
	config: Pick<BackgroundRunnerConfig, "id" | "resultPath" | "work">,
	processTerminal: ProcessTerminalV1,
	now = Date.now(),
): AsyncStatus {
	let result: Record<string, unknown> | undefined;
	try {
		const parsed = JSON.parse(readBoundedOwnedFile(config.resultPath, MAX_NESTED_RESULT_FILE_BYTES)) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
	} catch {
		// The conservative fallback below is authoritative when no semantic result exists.
	}
	const semanticState = result ? semanticResultState(result) : undefined;
	const state = semanticState ?? "failed";
	const observedAt = processTerminal.state === "observed" ? processTerminal.observedAt : now;
	const startedAt = finiteTimestamp(result?.["startedAt"]) ?? observedAt;
	const endedAt = finiteTimestamp(result?.["endedAt"]) ?? observedAt;
	const error =
		typeof result?.["error"] === "string" && result["error"].trim()
			? result["error"]
			: semanticState
				? undefined
				: "Agent runner exited without a readable semantic result or status.";
	return {
		runId: config.id,
		mode: result?.["mode"] === "single" || result?.["mode"] === "parallel" ? result["mode"] : config.work.mode,
		state,
		startedAt,
		endedAt,
		lastUpdate: endedAt,
		processTerminal,
		...(error ? { error } : {}),
		...(result?.["timedOut"] === true ? { timedOut: true } : {}),
		...(state === "stopped" || result?.["stopped"] === true ? { stopped: true } : {}),
	};
}

function isTerminalAsyncStatus(value: unknown, runId: string): value is AsyncStatus {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const status = value as Record<string, unknown>;
	return (
		status["runId"] === runId &&
		(status["mode"] === "single" || status["mode"] === "parallel") &&
		(status["state"] === "complete" ||
			status["state"] === "failed" ||
			status["state"] === "paused" ||
			status["state"] === "stopped") &&
		finiteTimestamp(status["startedAt"]) !== undefined
	);
}

export function resolveNestedTerminalStatus(
	config: Pick<BackgroundRunnerConfig, "asyncDir" | "id" | "resultPath" | "work">,
	processTerminal: ProcessTerminalV1,
): AsyncStatus {
	try {
		const parsed = JSON.parse(
			readBoundedOwnedFile(path.join(config.asyncDir, "status.json"), MAX_ASYNC_STATUS_FILE_BYTES),
		) as unknown;
		if (!isTerminalAsyncStatus(parsed, config.id)) throw new Error("invalid terminal Agent status");
		return { ...parsed, processTerminal };
	} catch {
		return buildNestedTerminalFallbackStatus(config, processTerminal);
	}
}

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

interface AsyncParallelParams extends AsyncParallelRunnerWorkBuildParams {
	goal?: string;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	sessionRoot?: string;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	worktreeBaseDir?: string;
	controlIntercomTarget?: string;
	childIntercomTarget?: (agent: string, index: number) => string | undefined;
	nestedRoute?: NestedRouteInfo;
	timeoutMs?: number;
}

interface AsyncSingleParams extends AsyncSingleRunnerWorkBuildParams {
	goal?: string;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	sessionRoot?: string;
	revivalLease?: SessionLeaseIntent;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	worktreeBaseDir?: string;
	controlIntercomTarget?: string;
	childIntercomTarget?: (agent: string, index: number) => string | undefined;
	nestedRoute?: NestedRouteInfo;
	timeoutMs?: number;
}

interface AsyncExecutionResult {
	content: Array<{ type: "text"; text: string }>;
	details: Details;
	isError?: boolean;
}

export interface BuiltTask {
	task: RunnerAgentTask;
	recovery: BackgroundRecoveryDescriptor;
}

/** Resolve the certified Bun runtime without starting a subprocess at import. */
export function resolveAsyncRunnerBunCommand(): string | undefined {
	return resolveBunRuntimeCommand();
}

export function formatAsyncStartedMessage(headline: string, interactive: boolean): string {
	const guidance = interactive
		? [
				"The Agent is running in the background and will report completion automatically.",
				"Continue independent work or return control to the user. Use Agent status for a one-shot inspection; start foreground work when its result is required before continuing.",
			]
		: [
				"The Agent is running in the background and will report completion automatically.",
				"Do not poll or sleep just to wait. Use Agent status only for a one-shot inspection.",
			];
	return [headline, "", ...guidance].join("\n");
}

export function isAsyncAvailable(): boolean {
	return resolveAsyncRunnerBunCommand() !== undefined;
}

function resolveTaskTurnBudget(
	explicit: TurnBudgetConfig | undefined,
	runBudget: ResolvedTurnBudget | undefined,
	agentBudget: TurnBudgetConfig | undefined,
): { turnBudget?: ResolvedTurnBudget; error?: string } {
	if (explicit !== undefined) return resolveTurnBudgetConfig(explicit, "turnBudget");
	if (runBudget !== undefined) return { turnBudget: runBudget };
	return resolveTurnBudgetConfig(agentBudget, "agent.turnBudget");
}

function resolveTaskToolBudget(
	explicit: ToolBudgetConfig | undefined,
	runBudget: ResolvedToolBudget | undefined,
	agentBudget: ToolBudgetConfig | undefined,
	configBudget: ResolvedToolBudget | undefined,
): { toolBudget?: ResolvedToolBudget; error?: string } {
	if (explicit !== undefined) {
		const resolved = validateToolBudgetConfig(explicit, "toolBudget");
		return { toolBudget: resolved.budget, error: resolved.error };
	}
	if (runBudget !== undefined) return { toolBudget: runBudget };
	if (agentBudget !== undefined) {
		const resolved = validateToolBudgetConfig(agentBudget, "agent.toolBudget");
		return { toolBudget: resolved.budget, error: resolved.error };
	}
	return { toolBudget: configBudget };
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
	const launchContractDigest = launchBindingDigest({
		definitionDigest,
		task: taskInput.task,
		modelCandidates,
		...(thinking ? { thinking } : {}),
		systemPrompt,
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		skills: resolvedSkills.map((skill) => skill.name),
		tools: toolPlan.effectiveToolAllowlist,
		extensions: toolPlan.extensionArgs,
		mcpDirectTools: toolPlan.effectiveMcpTools,
		turnBudget: turnBudget.turnBudget,
		toolBudget: toolBudget.toolBudget,
		maxSubagentDepth,
		capabilityCeiling,
	});

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
		...(input.context ? { context: input.context } : {}),
		cwd: taskCwd,
		...(primaryModel ? { model: primaryModel } : {}),
		...(thinking ? { thinking } : {}),
		modelCandidates,
		tools: agent.tools,
		extensions: agent.extensions,
		subagentOnlyExtensions: agent.subagentOnlyExtensions,
		mcpDirectTools: agent.mcpDirectTools,
		systemPrompt,
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		...(params.childBaseExtensionPath ? { childBaseExtensionPath: params.childBaseExtensionPath } : {}),
		skills: resolvedSkills.map((skill) => skill.name),
		...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
		maxSubagentDepth,
		definitionDigest,
		launchBindingTask: taskInput.task,
		launchContractDigest,
		...(turnBudget.turnBudget ? { turnBudget: turnBudget.turnBudget } : {}),
		...(toolBudget.toolBudget ? { toolBudget: toolBudget.toolBudget } : {}),
		...(capabilityCeiling ? { capabilityCeiling } : {}),
	};
	const recovery: BackgroundRecoveryDescriptor = {
		version: 2,
		sourceRunId: params.logicalSourceRunId ?? input.runId,
		childIndex: params.logicalChildIndex ?? input.index,
		launchContractDigest,
		agent: agent.name,
		...(input.context ? { context: input.context } : {}),
		...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
		cwd: taskCwd,
		...(primaryModel ? { model: primaryModel } : {}),
		...(modelCandidates.length > 1 ? { fallbackModels: modelCandidates.slice(1) } : {}),
		...(thinking ? { thinking } : {}),
		...(agent.tools ? { tools: [...agent.tools] } : {}),
		...(agent.extensions ? { extensions: [...agent.extensions] } : {}),
		...(agent.subagentOnlyExtensions ? { subagentOnlyExtensions: [...agent.subagentOnlyExtensions] } : {}),
		...(agent.mcpDirectTools ? { mcpDirectTools: [...agent.mcpDirectTools] } : {}),
		...(systemPrompt ? { systemPrompt } : {}),
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		...(resolvedSkills.length ? { skills: resolvedSkills.map((skill) => skill.name) } : {}),
		...(agent.skillPath ? { skillPath: [...agent.skillPath] } : {}),
		...(agent.filePath ? { agentFilePath: agent.filePath } : {}),
		...(params.controlConfig ? { controlConfig: params.controlConfig } : {}),
		...(params.absoluteDeadlineAt ? { absoluteDeadlineAt: params.absoluteDeadlineAt } : {}),
		...(turnBudget.turnBudget ? { initialTurnBudget: turnBudget.turnBudget } : {}),
		...(toolBudget.toolBudget ? { initialToolBudget: toolBudget.toolBudget } : {}),
		maxSubagentDepth,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		...(params.sessionDir ? { sessionDir: params.sessionDir } : {}),
		...(params.artifactsDir ? { artifactsDir: params.artifactsDir } : {}),
		...(params.artifactConfig ? { artifactConfig: params.artifactConfig } : {}),
	};
	return { task, recovery };
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

export function resolveAsyncRunnerLogPaths(cfg: Pick<BackgroundRunnerConfig, "asyncDir">): {
	stdoutPath: string;
	stderrPath: string;
} {
	return {
		stdoutPath: path.join(cfg.asyncDir, "runner.stdout.log"),
		stderrPath: path.join(cfg.asyncDir, "runner.stderr.log"),
	};
}

function closeFd(fd: number | undefined): void {
	if (fd === undefined) return;
	try {
		fs.closeSync(fd);
	} catch {
		// The child already owns its duplicated descriptor.
	}
}

const RUNNER_STARTUP_TIMEOUT_MS = 10_000;

type RunnerStartupState = "ready" | "acknowledged";
type RunnerStartupWaitResult = { ok: true; token: string } | { ok: false; error: string };

function readRunnerStartup(
	startupPath: string,
	expectedState: RunnerStartupState,
	expectedToken?: string,
): RunnerStartupWaitResult | undefined {
	if (!fs.existsSync(startupPath)) return undefined;
	try {
		const payload = JSON.parse(readBoundedOwnedFile(startupPath, MAX_RUNNER_STARTUP_FILE_BYTES)) as {
			state?: unknown;
			token?: unknown;
			error?: unknown;
		};
		if (payload.state === "error" && typeof payload.error === "string") {
			return { ok: false, error: payload.error };
		}
		if (payload.state !== expectedState) return undefined;
		if (typeof payload.token !== "string" || (expectedToken !== undefined && payload.token !== expectedToken)) {
			return {
				ok: false,
				error: `Async runner wrote an invalid ${expectedState} startup handshake: ${startupPath}`,
			};
		}
		return { ok: true, token: payload.token };
	} catch (error) {
		return {
			ok: false,
			error: `Failed to read async runner startup handshake '${startupPath}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

async function waitForRunnerStartup(
	startupPath: string,
	expectedState: RunnerStartupState,
	timeoutMs: number,
	expectedToken?: string,
	runnerPid?: number,
	runnerProcessStartIdentity?: string,
): Promise<RunnerStartupWaitResult> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = readRunnerStartup(startupPath, expectedState, expectedToken);
		if (result) return result;
		if (
			runnerPid !== undefined &&
			runnerProcessStartIdentity !== undefined &&
			runnerIdentityState(runnerPid, runnerProcessStartIdentity) === false
		) {
			return {
				ok: false,
				error: `Background runner ${runnerPid} exited before startup reached '${expectedState}'.`,
			};
		}
		if (Date.now() >= deadline) break;
		await new Promise<void>((resolve) => setTimeout(resolve, Math.min(20, Math.max(1, deadline - Date.now()))));
	}
	return (
		readRunnerStartup(startupPath, expectedState, expectedToken) ?? {
			ok: false,
			error: `Timed out after ${timeoutMs}ms waiting for async runner state '${expectedState}'.`,
		}
	);
}

function writeRunnerStartupControl(filePath: string, payload: { action: "ack" | "proceed"; token: string }): void {
	const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		fs.writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: "utf-8", mode: 0o600 });
		fs.renameSync(temporaryPath, filePath);
	} catch (error) {
		fs.rmSync(temporaryPath, { force: true });
		throw error;
	}
}

function runnerIsAlive(pid: number): boolean {
	if (process.platform === "linux") {
		try {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
			const commandEnd = stat.lastIndexOf(")");
			const state = commandEnd >= 0 ? stat.slice(commandEnd + 1).trimStart()[0] : undefined;
			if (state === "Z" || state === "X") return false;
		} catch {
			// Fall through to kill(0), which also handles non-/proc environments.
		}
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function runnerIdentityState(pid: number, expectedProcessStartIdentity: string): boolean | undefined {
	const currentIdentity = readProcessStartIdentity(pid);
	if (currentIdentity) return currentIdentity === expectedProcessStartIdentity;
	return runnerIsAlive(pid) ? undefined : false;
}

export async function acquireRunnerProcessStartIdentity(
	pid: number,
	options: {
		readonly read?: (pid: number) => string | undefined;
		readonly timeoutMs?: number;
		readonly intervalMs?: number;
	} = {},
): Promise<string | undefined> {
	const read = options.read ?? readProcessStartIdentity;
	const deadline = Date.now() + (options.timeoutMs ?? 250);
	do {
		const identity = read(pid);
		if (identity) return identity;
		if (!runnerIsAlive(pid) || Date.now() >= deadline) return undefined;
		await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs ?? 20));
	} while (Date.now() <= deadline);
	return undefined;
}

async function terminateExactSpawnedRunner(proc: ReturnType<typeof spawn>): Promise<boolean> {
	if (proc.exitCode !== null || proc.signalCode !== null) return true;
	const waitForClose = (timeoutMs: number): Promise<boolean> =>
		new Promise((resolve) => {
			if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const onClose = () => {
				if (timer) clearTimeout(timer);
				resolve(true);
			};
			proc.once("close", onClose);
			timer = setTimeout(() => {
				proc.removeListener("close", onClose);
				resolve(false);
			}, timeoutMs);
			timer.unref?.();
		});
	try {
		proc.kill("SIGTERM");
	} catch {}
	if (await waitForClose(250)) return true;
	try {
		proc.kill("SIGKILL");
	} catch {}
	return waitForClose(1_000);
}

export function terminateRunnerBeforeProceed(pid: number, expectedProcessStartIdentity?: string): boolean {
	if (!expectedProcessStartIdentity) return false;
	// This callback can run on Pi's UI/session event path. Signal the exact,
	// still-gated process group immediately, but never synchronously wait for OS
	// reaping. A caller may release authority only if absence is already proven;
	// otherwise the close observer/reconciler retains and settles the lease.
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		const before = runnerIdentityState(pid, expectedProcessStartIdentity);
		if (before === false) return true;
		if (before === undefined) return false;
		try {
			// Detached runners lead their process group. Signalling the group also
			// reaps any writer that crossed its own exec gate before cancellation.
			process.kill(process.platform === "win32" ? pid : -pid, signal);
		} catch {
			if (runnerIdentityState(pid, expectedProcessStartIdentity) === false) return true;
			return false;
		}
	}
	return runnerIdentityState(pid, expectedProcessStartIdentity) === false;
}

export function removeRunnerStartupMarkerBestEffort(
	startupPath: string,
	rm: (filePath: string, options: { force: boolean }) => void = fs.rmSync,
): void {
	try {
		rm(startupPath, { force: true });
	} catch (error) {
		reportAgentDiagnostic(`Failed to remove acknowledged Agent runner startup marker '${startupPath}':`, error);
	}
}

export function finalizeSpawnedRunnerClose(input: {
	readonly launchConfig: BackgroundRunnerConfig;
	readonly runnerProcessInstanceId: string;
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly onProcessTerminal?: (proof: unknown) => void;
}): void {
	try {
		finalizeProcessTerminal(input.launchConfig.asyncDir, input.launchConfig.id, {
			processInstanceId: input.runnerProcessInstanceId,
			closeObservedAt: Date.now(),
			exitCode: input.exitCode,
			signal: input.signal,
		});
		const persisted = readProcessTerminal(input.launchConfig.asyncDir, {
			runId: input.launchConfig.id,
			runnerProcessInstanceId: input.runnerProcessInstanceId,
		});
		if (!persisted) return;
		if (input.launchConfig.nestedRoute && input.launchConfig.nestedSelf) {
			try {
				const status = resolveNestedTerminalStatus(input.launchConfig, persisted);
				writeNestedEvent(input.launchConfig.nestedRoute, {
					type: "subagent.nested.completed",
					ts: Date.now(),
					parentRunId: input.launchConfig.nestedSelf.parentRunId,
					parentStepIndex: input.launchConfig.nestedSelf.parentStepIndex,
					child: nestedSummaryFromAsyncStatus(status, input.launchConfig.asyncDir, {
						id: input.launchConfig.id,
						parentRunId: input.launchConfig.nestedSelf.parentRunId,
						parentStepIndex: input.launchConfig.nestedSelf.parentStepIndex,
						depth: input.launchConfig.nestedSelf.depth,
						path: input.launchConfig.nestedSelf.path,
						mode: status.mode,
						ts: Date.now(),
					}),
				});
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					reportAgentDiagnostic("Failed to emit final nested Agent state:", error);
				}
			}
		}
		try {
			input.onProcessTerminal?.({
				...persisted,
				asyncDir: input.launchConfig.asyncDir,
				sessionId: input.launchConfig.sessionId,
			});
		} catch (error) {
			reportAgentDiagnostic(`Process-terminal observer failed for '${input.launchConfig.id}':`, error);
		}
	} catch (error) {
		// Close listeners execute outside the launch promise. Filesystem failure
		// must leave evidence for stale reconciliation, never crash the parent Pi.
		reportAgentDiagnostic(
			`Failed to finalize background runner '${input.launchConfig.id}' after process close:`,
			error,
		);
	}
}

/** Persist writer absence while a parent-owned startup gate still blocks every writer. */
export function initializePreIdentityWriterAbsenceProof(config: BackgroundRunnerConfig, runnerPid: number): boolean {
	if (!config.startupGateToken && !config.revivalLease) return false;
	initializeWriterProcessRegistry(
		config.asyncDir,
		config.id,
		runnerPid,
		config.work.mode === "single" ? 1 : config.work.group.tasks.length,
	);
	return true;
}

async function spawnRunner(
	cfg: BackgroundRunnerConfig,
	suffix: string,
	cwd: string,
	onProcessTerminal?: (proof: unknown) => void,
	onStatus?: (status: unknown) => void,
): Promise<{
	pid?: number;
	processStartIdentity?: string;
	error?: string;
	safeToCleanup?: boolean;
	acknowledgeStart?: () => void;
	abortStart?: () => boolean;
}> {
	const bunCommand = resolveAsyncRunnerBunCommand();
	if (!bunCommand) {
		return {
			error: "Bun is required to launch background Agents but no executable was found on PATH or BUN_INSTALL",
		};
	}
	try {
		if (!fs.statSync(cwd).isDirectory()) return { error: `cwd is not a directory: ${cwd}` };
	} catch {
		return { error: `cwd does not exist: ${cwd}` };
	}
	const runnerProcessInstanceId = randomUUID();
	const startedAt = Date.now();
	const startupGateToken = cfg.revivalLease ? undefined : randomUUID();
	const launchConfig: BackgroundRunnerConfig = {
		...cfg,
		runnerProcessInstanceId,
		startedAt,
		...(startupGateToken ? { startupGateToken } : {}),
	};

	let stdoutFd: number | undefined;
	let stderrFd: number | undefined;
	let configPath: string | undefined;
	let launchAborted = false;
	let proc: ReturnType<typeof spawn> | undefined;
	let runnerProcessStartIdentity: string | undefined;
	try {
		ensurePrivateDirectory(TEMP_ROOT_DIR);
		ensurePrivateDirectory(cfg.asyncDir);
		configPath = getAsyncConfigPath(suffix);
		fs.writeFileSync(configPath, JSON.stringify(launchConfig), { encoding: "utf-8", mode: 0o600 });
		const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "subagent-runner.ts");
		const startupPath = launchConfig.revivalLease
			? path.join(launchConfig.asyncDir, "runner-startup.json")
			: undefined;
		const startupAckPath = startupPath ? path.join(path.dirname(startupPath), "runner-startup-ack.json") : undefined;
		const startupProceedPath = startupPath
			? path.join(path.dirname(startupPath), "runner-startup-proceed.json")
			: undefined;
		const startupGatePath = startupGateToken
			? path.join(launchConfig.asyncDir, "runner-startup-gate.json")
			: undefined;
		for (const filePath of [startupPath, startupAckPath, startupProceedPath, startupGatePath]) {
			if (filePath) fs.rmSync(filePath, { force: true });
		}
		const logPaths = resolveAsyncRunnerLogPaths(launchConfig);
		if (logPaths) {
			ensurePrivateDirectory(path.dirname(logPaths.stdoutPath));
			stdoutFd = fs.openSync(logPaths.stdoutPath, "a", 0o600);
			stderrFd = fs.openSync(logPaths.stderrPath, "a", 0o600);
		}
		proc = spawn(bunCommand, [runner, configPath], {
			cwd,
			detached: true,
			stdio: ["ignore", stdoutFd ?? "ignore", stderrFd ?? "ignore", "ipc"],
			windowsHide: true,
			env: {
				...process.env,
				PI_STUFF_BACKGROUND_RUNNER: "1",
				PI_STUFF_BACKGROUND_RUNNER_CONFIG: configPath,
				...(piPackageRoot ? { [PI_CODING_AGENT_PACKAGE_ROOT_ENV]: piPackageRoot } : {}),
			},
		});
		closeFd(stdoutFd);
		closeFd(stderrFd);
		proc.on("error", (error) => {
			reportAgentDiagnostic(`[pi-stuff-agents] background runner spawn failed: ${error.message}`);
		});
		proc.once("close", (exitCode, signal) => {
			if (launchAborted) return;
			finalizeSpawnedRunnerClose({
				launchConfig,
				runnerProcessInstanceId,
				exitCode,
				signal,
				onProcessTerminal,
			});
		});
		proc.on("message", (message: unknown) => {
			if (!message || typeof message !== "object") return;
			const update = message as { type?: unknown; asyncDir?: unknown; status?: unknown };
			if (
				update.type !== SUBAGENT_ASYNC_STATUS_EVENT ||
				update.asyncDir !== launchConfig.asyncDir ||
				!update.status ||
				typeof update.status !== "object" ||
				(update.status as { runId?: unknown }).runId !== launchConfig.id
			)
				return;
			try {
				onStatus?.({
					id: launchConfig.id,
					asyncDir: launchConfig.asyncDir,
					sessionId: launchConfig.sessionId,
					status: update.status,
				});
			} catch (error) {
				reportAgentDiagnostic(`Agent status observer failed for '${launchConfig.id}':`, error);
			}
		});
		if (typeof proc.pid !== "number") {
			launchAborted = true;
			throw new Error(`background runner has no pid for cwd: ${cwd}`);
		}
		initializePreIdentityWriterAbsenceProof(launchConfig, proc.pid);
		runnerProcessStartIdentity = await acquireRunnerProcessStartIdentity(proc.pid);
		if (!runnerProcessStartIdentity) {
			launchAborted = true;
			throw new Error(`background runner ${proc.pid} has no stable process-start identity`);
		}
		proc.unref();
		proc.channel?.unref?.();

		if (startupGateToken && startupGatePath) {
			try {
				writePrivateAtomicJson(
					path.join(launchConfig.asyncDir, "status.json"),
					createInitialStatus(launchConfig, startedAt, proc.pid, runnerProcessStartIdentity),
				);
				initializeWriterProcessRegistry(
					launchConfig.asyncDir,
					launchConfig.id,
					proc.pid,
					launchConfig.work.mode === "single" ? 1 : launchConfig.work.group.tasks.length,
				);
			} catch (error) {
				launchAborted = true;
				terminateRunnerBeforeProceed(proc.pid, runnerProcessStartIdentity);
				try {
					const endedAt = Date.now();
					const failedStatus = createInitialStatus(launchConfig, startedAt, proc.pid);
					failedStatus.state = "failed";
					failedStatus.endedAt = endedAt;
					failedStatus.lastUpdate = endedAt;
					failedStatus.error = "Background runner startup could not be committed.";
					for (const step of failedStatus.steps) {
						step.status = "failed";
						step.endedAt = endedAt;
						step.exitCode = 1;
						step.error = failedStatus.error;
					}
					writePrivateAtomicJson(path.join(launchConfig.asyncDir, "status.json"), failedStatus);
				} catch {
					// The caller owns exact directory cleanup after the runner is reaped.
				}
				throw new Error(
					`Failed to commit background runner startup: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		let startupAuthorizationPath = startupGatePath;
		let startupAuthorizationToken: string | undefined = startupGateToken;
		let startupMarkerToRemove: string | undefined;
		if (startupPath && startupAckPath && startupProceedPath) {
			const ready = await waitForRunnerStartup(
				startupPath,
				"ready",
				RUNNER_STARTUP_TIMEOUT_MS,
				undefined,
				proc.pid,
				runnerProcessStartIdentity,
			);
			if (!ready.ok) {
				launchAborted = true;
				terminateRunnerBeforeProceed(proc.pid, runnerProcessStartIdentity);
				throw new Error(ready.error);
			}
			try {
				writeRunnerStartupControl(startupAckPath, { action: "ack", token: ready.token });
			} catch (error) {
				launchAborted = true;
				terminateRunnerBeforeProceed(proc.pid, runnerProcessStartIdentity);
				throw new Error(
					`Failed to acknowledge background runner startup: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			const acknowledged = await waitForRunnerStartup(
				startupPath,
				"acknowledged",
				RUNNER_STARTUP_TIMEOUT_MS,
				ready.token,
				proc.pid,
				runnerProcessStartIdentity,
			);
			if (!acknowledged.ok) {
				launchAborted = true;
				terminateRunnerBeforeProceed(proc.pid, runnerProcessStartIdentity);
				throw new Error(acknowledged.error);
			}
			startupAuthorizationPath = startupProceedPath;
			startupAuthorizationToken = ready.token;
			startupMarkerToRemove = startupPath;
		}
		const committedRunnerPid = proc.pid;
		const committedRunnerProcessStartIdentity = runnerProcessStartIdentity;
		let acknowledged = false;
		let aborted = false;
		const acknowledgeStart =
			startupAuthorizationToken && startupAuthorizationPath
				? () => {
						if (aborted) throw new Error("Background runner startup was already aborted.");
						if (acknowledged) return;
						writeRunnerStartupControl(startupAuthorizationPath, {
							action: "proceed",
							token: startupAuthorizationToken,
						});
						if (startupMarkerToRemove) removeRunnerStartupMarkerBestEffort(startupMarkerToRemove);
						acknowledged = true;
					}
				: undefined;
		const abortStart =
			startupAuthorizationToken && startupAuthorizationPath
				? () => {
						if (aborted) {
							return (
								runnerIdentityState(committedRunnerPid, committedRunnerProcessStartIdentity) === false &&
								inspectWriterProcessLiveness(launchConfig.asyncDir) === false
							);
						}
						const terminated = terminateRunnerBeforeProceed(
							committedRunnerPid,
							committedRunnerProcessStartIdentity,
						);
						if (!terminated) return false;
						terminateOrphanWriterProcesses(launchConfig.asyncDir);
						if (inspectWriterProcessLiveness(launchConfig.asyncDir) !== false) return false;
						aborted = true;
						launchAborted = true;
						fs.rmSync(startupAuthorizationPath, { force: true });
						if (startupMarkerToRemove) fs.rmSync(startupMarkerToRemove, { force: true });
						if (configPath) fs.rmSync(configPath, { force: true });
						const endedAt = Date.now();
						const failedStatus = createInitialStatus(launchConfig, startedAt, committedRunnerPid);
						failedStatus.state = "failed";
						failedStatus.endedAt = endedAt;
						failedStatus.lastUpdate = endedAt;
						failedStatus.error = "Background runner startup was cancelled before ownership committed.";
						for (const step of failedStatus.steps) {
							step.status = "failed";
							step.endedAt = endedAt;
							step.exitCode = 1;
							step.error = failedStatus.error;
						}
						writePrivateAtomicJson(path.join(launchConfig.asyncDir, "status.json"), failedStatus);
						return true;
					}
				: undefined;
		return {
			pid: proc.pid,
			processStartIdentity: runnerProcessStartIdentity,
			...(acknowledgeStart ? { acknowledgeStart } : {}),
			...(abortStart ? { abortStart } : {}),
		};
	} catch (error) {
		const safeToCleanup = proc ? await terminateExactSpawnedRunner(proc) : true;
		launchAborted = safeToCleanup;
		closeFd(stdoutFd);
		closeFd(stderrFd);
		if (configPath) {
			try {
				fs.rmSync(configPath, { force: true });
			} catch {
				// A failed launch already returns the primary setup error.
			}
		}
		const message = error instanceof Error ? error.message : String(error);
		if (!safeToCleanup && proc?.pid && runnerProcessStartIdentity) {
			const retainedRunnerPid = proc.pid;
			const retainedRunnerProcessStartIdentity = runnerProcessStartIdentity;
			try {
				const failedStatus = createInitialStatus(
					launchConfig,
					launchConfig.startedAt ?? Date.now(),
					retainedRunnerPid,
					retainedRunnerProcessStartIdentity,
				);
				const endedAt = Date.now();
				failedStatus.state = "failed";
				failedStatus.error = `Background runner startup failed while process recovery remained pending: ${message}`;
				failedStatus.endedAt = endedAt;
				failedStatus.lastUpdate = endedAt;
				for (const step of failedStatus.steps) {
					step.status = "failed";
					step.exitCode = 1;
					step.error = failedStatus.error;
					step.endedAt = endedAt;
				}
				writePrivateAtomicJson(path.join(launchConfig.asyncDir, "status.json"), failedStatus);
			} catch {
				// The retained lifecycle binding and preparation marker remain the
				// authority when status persistence itself caused the launch error.
			}
			let aborted = false;
			const abortStart = () => {
				if (aborted) return true;
				if (!terminateRunnerBeforeProceed(retainedRunnerPid, retainedRunnerProcessStartIdentity)) {
					return false;
				}
				terminateOrphanWriterProcesses(launchConfig.asyncDir);
				if (inspectWriterProcessLiveness(launchConfig.asyncDir) !== false) return false;
				aborted = true;
				launchAborted = true;
				return true;
			};
			return {
				error: message,
				safeToCleanup: false,
				pid: retainedRunnerPid,
				processStartIdentity: retainedRunnerProcessStartIdentity,
				abortStart,
			};
		}
		return {
			error: message,
			safeToCleanup,
			...(typeof proc?.pid === "number" ? { pid: proc.pid } : {}),
		};
	}
}

function formatAsyncStartError(
	mode: "single" | "parallel",
	message: string,
	details: Partial<Details> = {},
): AsyncExecutionResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode, results: [], ...details },
	};
}

interface BackgroundRunDirectoryClaim {
	readonly asyncDir: string;
	readonly inheritedNestedRoute?: NestedRouteInfo;
	readonly nestedAddress?: ReturnType<typeof resolveNestedParentAddressFromEnv>;
	cleanup(): void;
	commit(): boolean;
}

export function cleanupBackgroundRunAfterAbort(
	location: Pick<BackgroundRunDirectoryClaim, "cleanup">,
	abortStart?: () => boolean,
): boolean {
	let safeToCleanup = false;
	try {
		safeToCleanup = abortStart?.() === true;
	} catch {
		// A failed abort transport is not proof that the runner and every writer
		// exited. Preserve lifecycle evidence and governor authority fail-closed.
		safeToCleanup = false;
	}
	if (safeToCleanup) location.cleanup();
	return safeToCleanup;
}

interface SpawnedRunnerLifecycle {
	readonly pid?: number;
	readonly processStartIdentity?: string;
	readonly acknowledgeStart?: () => void;
	readonly abortStart?: () => boolean;
}

function retainedRunnerLifecycleBinding(
	asyncDir: string,
	spawned: SpawnedRunnerLifecycle,
): NonNullable<Details["lifecycleBinding"]> | undefined {
	if (!spawned.pid) return undefined;
	return {
		pid: spawned.pid,
		...(spawned.processStartIdentity ? { processStartIdentity: spawned.processStartIdentity } : {}),
		asyncDir,
		...(spawned.acknowledgeStart ? { acknowledgeStart: spawned.acknowledgeStart } : {}),
		...(spawned.abortStart ? { abortStart: spawned.abortStart } : {}),
	};
}

export type BackgroundOwnershipFailureResolution =
	| { readonly safeToRelease: true }
	| {
			readonly safeToRelease: false;
			readonly lifecycleBinding?: NonNullable<Details["lifecycleBinding"]>;
	  };

/**
 * Resolve a post-spawn ownership failure without mistaking control failure for
 * process death. A retained runner is committed again best-effort so a
 * transient marker unlink failure does not leave preparation debris.
 */
export function resolveBackgroundOwnershipFailure(
	location: Pick<BackgroundRunDirectoryClaim, "asyncDir" | "cleanup" | "commit">,
	spawned: SpawnedRunnerLifecycle,
): BackgroundOwnershipFailureResolution {
	if (cleanupBackgroundRunAfterAbort(location, spawned.abortStart)) return { safeToRelease: true };
	location.commit();
	const lifecycleBinding = retainedRunnerLifecycleBinding(location.asyncDir, spawned);
	if (!lifecycleBinding) return { safeToRelease: false };
	return {
		safeToRelease: false,
		lifecycleBinding,
	};
}

export function claimBackgroundRunDirectory(id: string): BackgroundRunDirectoryClaim | { error: string } {
	if (!id || id.length > 128 || /[\\/]/u.test(id) || id.includes("..")) {
		return { error: "Invalid internal background Agent launch identity." };
	}
	const inheritedNestedRoute = resolveInheritedNestedRouteFromEnv();
	const nestedAddress = inheritedNestedRoute ? resolveNestedParentAddressFromEnv() : undefined;
	const asyncDir = inheritedNestedRoute
		? path.join(TEMP_ROOT_DIR, "nested-subagent-runs", inheritedNestedRoute.rootRunId, id)
		: path.join(ASYNC_DIR, id);
	try {
		ensurePrivateDirectory(TEMP_ROOT_DIR);
		if (inheritedNestedRoute) {
			ensurePrivateDirectory(path.join(TEMP_ROOT_DIR, "nested-subagent-runs"));
			ensurePrivateDirectory(path.join(TEMP_ROOT_DIR, "nested-subagent-runs", inheritedNestedRoute.rootRunId));
		} else {
			ensurePrivateDirectory(ASYNC_DIR);
		}
		try {
			fs.mkdirSync(asyncDir, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				throw new Error(
					`Background Agent runtime '${asyncDir}' already exists; refusing to overwrite retained lifecycle evidence.`,
				);
			}
			throw error;
		}
		const created = fs.lstatSync(asyncDir);
		const token = randomUUID();
		const markerPath = path.join(asyncDir, ".background-preparation-owner.json");
		try {
			ensurePrivateDirectory(asyncDir);
			fs.writeFileSync(
				markerPath,
				`${JSON.stringify({
					version: 2,
					token,
					pid: process.pid,
					processStartIdentity: readProcessStartIdentity(process.pid),
					createdAt: Date.now(),
					device: created.dev,
					inode: created.ino,
				})}\n`,
				{
					encoding: "utf8",
					flag: "wx",
					mode: 0o600,
				},
			);
		} catch (error) {
			try {
				const current = fs.lstatSync(asyncDir);
				if (current.dev === created.dev && current.ino === created.ino) fs.rmSync(asyncDir, { recursive: true });
			} catch {
				// Preserve the original ownership/preparation failure.
			}
			throw error;
		}

		let committed = false;
		const stillOwned = (): boolean => {
			if (committed) return false;
			try {
				const current = fs.lstatSync(asyncDir);
				if (!current.isDirectory() || current.dev !== created.dev || current.ino !== created.ino) return false;
				const marker = JSON.parse(readBoundedOwnedFile(markerPath, 4 * 1024)) as { token?: unknown };
				return marker.token === token;
			} catch {
				return false;
			}
		};
		return {
			asyncDir,
			inheritedNestedRoute,
			nestedAddress,
			cleanup: () => {
				if (!stillOwned()) return;
				const failedPath = `${asyncDir}.failed-${token}`;
				try {
					fs.renameSync(asyncDir, failedPath);
					const moved = fs.lstatSync(failedPath);
					if (moved.dev === created.dev && moved.ino === created.ino) {
						fs.rmSync(failedPath, { recursive: true });
					}
				} catch {
					// An ownership race leaves evidence in place instead of deleting an unproven directory.
				}
			},
			commit: () => {
				if (!stillOwned()) return false;
				try {
					fs.unlinkSync(markerPath);
					committed = true;
					return true;
				} catch {
					return false;
				}
			},
		};
	} catch (error) {
		return {
			error: `Failed to create background run directory '${asyncDir}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

function nestedSelfFromLocation(
	location: Exclude<ReturnType<typeof claimBackgroundRunDirectory>, { error: string }>,
): BackgroundRunnerConfig["nestedSelf"] {
	if (!location.inheritedNestedRoute || !location.nestedAddress) return undefined;
	return {
		parentRunId: location.nestedAddress.parentRunId,
		parentStepIndex: location.nestedAddress.parentStepIndex,
		depth: location.nestedAddress.depth,
		path: location.nestedAddress.path,
	};
}

function emitStarted(input: {
	id: string;
	pid: number;
	processStartIdentity: string;
	work: BackgroundRunnerWork;
	runnerCwd: string;
	asyncDir: string;
	ctx: AsyncExecutionContext;
	goal?: string;
	timeoutMs?: number;
	deadlineAt?: number;
	nestedRoute?: NestedRouteInfo;
	nestedSelf?: BackgroundRunnerConfig["nestedSelf"];
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	acknowledgeStart?: () => void;
	abortStart?: () => boolean;
}): void {
	const tasks = input.work.mode === "single" ? [input.work.task] : input.work.group.tasks;
	const first = tasks[0];
	if (!first) return;
	if (input.nestedRoute && input.nestedSelf) {
		const now = Date.now();
		try {
			writeNestedEvent(input.nestedRoute, {
				type: "subagent.nested.started",
				ts: now,
				parentRunId: input.nestedSelf.parentRunId,
				parentStepIndex: input.nestedSelf.parentStepIndex,
				child: {
					id: input.id,
					parentRunId: input.nestedSelf.parentRunId,
					parentStepIndex: input.nestedSelf.parentStepIndex,
					depth: input.nestedSelf.depth,
					path: input.nestedSelf.path ?? [],
					asyncDir: input.asyncDir,
					pid: input.pid,
					ownerIntercomTarget: process.env.PI_SUBAGENT_INTERCOM_SESSION_NAME,
					ownerState: "live",
					mode: input.work.mode,
					state: "running",
					agent: first.agent,
					agents: tasks.map((task) => task.agent),
					...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs, deadlineAt: input.deadlineAt } : {}),
					...(input.work.mode === "single" && first.turnBudget
						? { turnBudget: initialTurnBudgetState(first.turnBudget) }
						: {}),
					startedAt: now,
					lastUpdate: now,
					...(input.capabilityCeiling ? { capabilityCeiling: input.capabilityCeiling } : {}),
				},
			});
		} catch (error) {
			reportAgentDiagnostic("Failed to emit nested Agent start:", error);
		}
	}
	try {
		input.ctx.pi.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			id: input.id,
			pid: input.pid,
			processStartIdentity: input.processStartIdentity,
			sessionId: input.ctx.currentSessionId,
			mode: input.work.mode,
			agent: first.agent,
			agents: tasks.map((task) => task.agent),
			description: first.description,
			descriptions: tasks.map((task) => resolveDisplayDescription(task.description, task.task)),
			task: (first.delegatedTask ?? first.task).slice(0, 50),
			tasks: tasks.map((task) => taskPreview(task.delegatedTask ?? task.task)),
			goal: (input.goal ?? first.task).slice(0, 120),
			cwd: input.runnerCwd,
			asyncDir: input.asyncDir,
			...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs, deadlineAt: input.deadlineAt } : {}),
			...(input.work.mode === "single" && first.turnBudget
				? { turnBudget: initialTurnBudgetState(first.turnBudget) }
				: {}),
			...(input.capabilityCeiling ? { capabilityCeiling: input.capabilityCeiling } : {}),
			nestedRoute: input.nestedRoute,
			...(input.acknowledgeStart ? { acknowledgeStart: input.acknowledgeStart } : {}),
			...(input.abortStart ? { abortStart: input.abortStart } : {}),
		});
	} catch (error) {
		reportAgentDiagnostic(`Async Agent start observer failed for '${input.id}':`, error);
	}
}

export function persistRecoveries(asyncDir: string, recoveries: BackgroundRecoveryDescriptor[]): void {
	if (recoveries.length === 1) {
		writePrivateAtomicJson(path.join(asyncDir, "recovery-descriptor.json"), recoveries[0]);
		return;
	}
	writePrivateAtomicJson(path.join(asyncDir, "recovery-descriptors.json"), {
		version: 2,
		children: recoveries,
	});
}

export async function executeAsyncParallel(id: string, params: AsyncParallelParams): Promise<AsyncExecutionResult> {
	const location = claimBackgroundRunDirectory(id);
	if ("error" in location) return formatAsyncStartError("parallel", location.error);
	const capabilityCeiling =
		params.capabilityCeiling ?? resolveCurrentSubagentCapabilityCeiling(params.ctx.currentSessionId);
	const deadlineAt = params.timeoutMs !== undefined ? Date.now() + params.timeoutMs : undefined;
	const sessionDir = params.sessionRoot ? path.join(params.sessionRoot, `async-${id}`) : undefined;
	const built = buildAsyncParallelRunnerWork(id, {
		...params,
		capabilityCeiling,
		absoluteDeadlineAt: deadlineAt,
		sessionDir,
	});
	if ("error" in built) {
		location.cleanup();
		return formatAsyncStartError("parallel", built.error);
	}
	if (built.work.mode !== "parallel") {
		location.cleanup();
		throw new Error("Parallel background builder returned single work.");
	}
	const parallelWork = built.work;
	try {
		persistRecoveries(location.asyncDir, built.recoveries);
	} catch (error) {
		location.cleanup();
		return formatAsyncStartError(
			"parallel",
			`Failed to persist background recovery data for '${id}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	const nestedRoute = params.nestedRoute ?? location.inheritedNestedRoute;
	const nestedSelf = nestedSelfFromLocation(location);
	const config: BackgroundRunnerConfig = {
		version: 2,
		id,
		parentRunOrigin: params.parentRunOrigin === "user" ? "user" : "automatic",
		...(params.codeModeEnabled !== undefined ? { codeModeEnabled: params.codeModeEnabled } : {}),
		...(params.codeModeProviderTools?.length ? { codeModeProviderTools: [...params.codeModeProviderTools] } : {}),
		work: parallelWork,
		resultPath: location.inheritedNestedRoute
			? nestedResultsPath(location.inheritedNestedRoute.rootRunId, id)
			: path.join(RESULTS_DIR, `${id}.json`),
		cwd: built.runnerCwd,
		asyncDir: location.asyncDir,
		sessionId: params.ctx.currentSessionId,
		...(params.artifactConfig.enabled && params.artifactsDir ? { artifactsDir: params.artifactsDir } : {}),
		artifactConfig: params.artifactConfig,
		...(sessionDir ? { sessionDir } : {}),
		piPackageRoot,
		piArgv1: process.argv[1],
		...(piExecutable ? { piExecutable } : {}),
		worktreeSetupHook: params.worktreeSetupHook,
		worktreeSetupHookTimeoutMs: params.worktreeSetupHookTimeoutMs,
		worktreeBaseDir: params.worktreeBaseDir,
		controlConfig: params.controlConfig,
		nativeSupervisor: location.inheritedNestedRoute === undefined,
		controlIntercomTarget: params.controlIntercomTarget,
		childIntercomTargets: params.childIntercomTarget
			? parallelWork.group.tasks.map((task, index) => params.childIntercomTarget?.(task.agent, index))
			: undefined,
		nestedRoute,
		nestedSelf,
		timeoutMs: params.timeoutMs,
		deadlineAt,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
	};
	const spawned = await spawnRunner(
		config,
		id,
		built.runnerCwd,
		(proof) => params.ctx.pi.events.emit(SUBAGENT_PROCESS_TERMINAL_EVENT, proof),
		(status) => params.ctx.pi.events.emit(SUBAGENT_ASYNC_STATUS_EVENT, status),
	);
	if (spawned.error) {
		if (spawned.safeToCleanup !== false) {
			location.cleanup();
			return formatAsyncStartError("parallel", `Failed to start background Agents '${id}': ${spawned.error}`);
		}
		location.commit();
		const lifecycleBinding = retainedRunnerLifecycleBinding(location.asyncDir, spawned);
		if (spawned.pid && spawned.processStartIdentity) {
			emitStarted({
				id,
				pid: spawned.pid,
				processStartIdentity: spawned.processStartIdentity,
				work: parallelWork,
				runnerCwd: built.runnerCwd,
				asyncDir: location.asyncDir,
				ctx: params.ctx,
				goal: params.goal,
				timeoutMs: params.timeoutMs,
				deadlineAt,
				nestedRoute,
				nestedSelf,
				capabilityCeiling,
				abortStart: spawned.abortStart,
			});
		}
		return formatAsyncStartError(
			"parallel",
			`Failed to start background Agents '${id}'; lifecycle recovery is still pending: ${spawned.error}`,
			{
				runId: id,
				asyncId: id,
				asyncDir: location.asyncDir,
				...(lifecycleBinding ? { lifecycleBinding } : {}),
			},
		);
	}
	if (!spawned.pid || !spawned.processStartIdentity || !spawned.acknowledgeStart || !spawned.abortStart) {
		const resolution = resolveBackgroundOwnershipFailure(location, spawned);
		if (!resolution.safeToRelease && resolution.lifecycleBinding?.processStartIdentity) {
			emitStarted({
				id,
				pid: resolution.lifecycleBinding.pid,
				processStartIdentity: resolution.lifecycleBinding.processStartIdentity,
				work: parallelWork,
				runnerCwd: built.runnerCwd,
				asyncDir: location.asyncDir,
				ctx: params.ctx,
				goal: params.goal,
				timeoutMs: params.timeoutMs,
				deadlineAt,
				nestedRoute,
				nestedSelf,
				capabilityCeiling,
				acknowledgeStart: resolution.lifecycleBinding.acknowledgeStart,
				abortStart: resolution.lifecycleBinding.abortStart,
			});
		}
		return formatAsyncStartError(
			"parallel",
			resolution.safeToRelease
				? `Background Agents '${id}' started without a complete lifecycle binding.`
				: `Background Agents '${id}' started without a complete lifecycle binding; lifecycle recovery is still pending.`,
			resolution.safeToRelease
				? {}
				: {
						runId: id,
						asyncId: id,
						asyncDir: location.asyncDir,
						...(resolution.lifecycleBinding ? { lifecycleBinding: resolution.lifecycleBinding } : {}),
					},
		);
	}
	if (!location.commit()) {
		const resolution = resolveBackgroundOwnershipFailure(location, spawned);
		if (!resolution.safeToRelease && resolution.lifecycleBinding?.processStartIdentity) {
			emitStarted({
				id,
				pid: resolution.lifecycleBinding.pid,
				processStartIdentity: resolution.lifecycleBinding.processStartIdentity,
				work: parallelWork,
				runnerCwd: built.runnerCwd,
				asyncDir: location.asyncDir,
				ctx: params.ctx,
				goal: params.goal,
				timeoutMs: params.timeoutMs,
				deadlineAt,
				nestedRoute,
				nestedSelf,
				capabilityCeiling,
				acknowledgeStart: resolution.lifecycleBinding.acknowledgeStart,
				abortStart: resolution.lifecycleBinding.abortStart,
			});
		}
		return formatAsyncStartError(
			"parallel",
			resolution.safeToRelease
				? `Background Agents '${id}' could not commit ownership of their lifecycle directory.`
				: `Background Agents '${id}' could not commit ownership of their lifecycle directory; lifecycle recovery is still pending.`,
			resolution.safeToRelease
				? {}
				: {
						runId: id,
						asyncId: id,
						asyncDir: location.asyncDir,
						...(resolution.lifecycleBinding ? { lifecycleBinding: resolution.lifecycleBinding } : {}),
					},
		);
	}
	emitStarted({
		id,
		pid: spawned.pid,
		processStartIdentity: spawned.processStartIdentity,
		work: parallelWork,
		runnerCwd: built.runnerCwd,
		asyncDir: location.asyncDir,
		ctx: params.ctx,
		goal: params.goal,
		timeoutMs: params.timeoutMs,
		deadlineAt,
		nestedRoute,
		nestedSelf,
		capabilityCeiling,
		acknowledgeStart: spawned.acknowledgeStart,
		abortStart: spawned.abortStart,
	});
	return {
		content: [
			{
				type: "text",
				text: formatAsyncStartedMessage(
					`Background Agents: ${parallelWork.group.tasks.map((task) => task.agent).join(", ")} [${id}]`,
					params.ctx.interactive === true,
				),
			},
		],
		details: {
			mode: "parallel",
			runId: id,
			results: [],
			asyncId: id,
			asyncDir: location.asyncDir,
			...(capabilityCeiling ? { capabilityCeiling } : {}),
			...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs, deadlineAt } : {}),
			lifecycleBinding: {
				pid: spawned.pid,
				processStartIdentity: spawned.processStartIdentity,
				asyncDir: location.asyncDir,
				acknowledgeStart: spawned.acknowledgeStart,
				abortStart: spawned.abortStart,
			},
		},
	};
}

export async function executeAsyncSingle(id: string, params: AsyncSingleParams): Promise<AsyncExecutionResult> {
	const location = claimBackgroundRunDirectory(id);
	if ("error" in location) return formatAsyncStartError("single", location.error);
	const capabilityCeiling =
		params.capabilityCeiling ?? resolveCurrentSubagentCapabilityCeiling(params.ctx.currentSessionId);
	const deadlineAt =
		params.absoluteDeadlineAt ?? (params.timeoutMs !== undefined ? Date.now() + params.timeoutMs : undefined);
	const timeoutMs =
		params.absoluteDeadlineAt !== undefined && deadlineAt !== undefined ? deadlineAt - Date.now() : params.timeoutMs;
	if (timeoutMs !== undefined && timeoutMs <= 0) {
		location.cleanup();
		return formatAsyncStartError(
			"single",
			"The source run's absolute deadline expired before recovery could launch.",
		);
	}
	const sessionDir =
		params.sessionDir ?? (params.sessionRoot ? path.join(params.sessionRoot, `async-${id}`) : undefined);
	const built = buildAsyncSingleRunnerWork(id, {
		...params,
		capabilityCeiling,
		absoluteDeadlineAt: deadlineAt,
		sessionDir,
	});
	if ("error" in built) {
		location.cleanup();
		return formatAsyncStartError("single", built.error);
	}
	try {
		persistRecoveries(location.asyncDir, [built.recovery]);
	} catch (error) {
		location.cleanup();
		return formatAsyncStartError(
			"single",
			`Failed to persist background recovery data for '${id}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	const nestedRoute = params.nestedRoute ?? location.inheritedNestedRoute;
	const nestedSelf = nestedSelfFromLocation(location);
	const config: BackgroundRunnerConfig = {
		version: 2,
		id,
		parentRunOrigin: params.parentRunOrigin === "user" ? "user" : "automatic",
		...(params.codeModeEnabled !== undefined ? { codeModeEnabled: params.codeModeEnabled } : {}),
		...(params.codeModeProviderTools?.length ? { codeModeProviderTools: [...params.codeModeProviderTools] } : {}),
		work: built.work,
		resultPath: location.inheritedNestedRoute
			? nestedResultsPath(location.inheritedNestedRoute.rootRunId, id)
			: path.join(RESULTS_DIR, `${id}.json`),
		cwd: built.runnerCwd,
		asyncDir: location.asyncDir,
		sessionId: params.ctx.currentSessionId,
		...(params.artifactConfig.enabled && params.artifactsDir ? { artifactsDir: params.artifactsDir } : {}),
		artifactConfig: params.artifactConfig,
		...(sessionDir ? { sessionDir } : {}),
		piPackageRoot,
		piArgv1: process.argv[1],
		...(piExecutable ? { piExecutable } : {}),
		worktreeSetupHook: params.worktreeSetupHook,
		worktreeSetupHookTimeoutMs: params.worktreeSetupHookTimeoutMs,
		worktreeBaseDir: params.worktreeBaseDir,
		controlConfig: params.controlConfig,
		nativeSupervisor: location.inheritedNestedRoute === undefined,
		controlIntercomTarget: params.controlIntercomTarget,
		childIntercomTargets: params.childIntercomTarget
			? [params.childIntercomTarget(built.work.task.agent, 0)]
			: undefined,
		nestedRoute,
		nestedSelf,
		timeoutMs,
		deadlineAt,
		revivalLease: params.revivalLease ? { ...params.revivalLease, asyncDir: location.asyncDir } : undefined,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		launchContractDigest: built.work.task.launchContractDigest,
	};
	const spawned = await spawnRunner(
		config,
		id,
		built.runnerCwd,
		(proof) => params.ctx.pi.events.emit(SUBAGENT_PROCESS_TERMINAL_EVENT, proof),
		(status) => params.ctx.pi.events.emit(SUBAGENT_ASYNC_STATUS_EVENT, status),
	);
	if (spawned.error) {
		if (spawned.safeToCleanup !== false) {
			location.cleanup();
			return formatAsyncStartError("single", `Failed to start background Agent '${id}': ${spawned.error}`);
		}
		location.commit();
		const lifecycleBinding = retainedRunnerLifecycleBinding(location.asyncDir, spawned);
		if (spawned.pid && spawned.processStartIdentity) {
			emitStarted({
				id,
				pid: spawned.pid,
				processStartIdentity: spawned.processStartIdentity,
				work: built.work,
				runnerCwd: built.runnerCwd,
				asyncDir: location.asyncDir,
				ctx: params.ctx,
				goal: params.goal,
				timeoutMs,
				deadlineAt,
				nestedRoute,
				nestedSelf,
				capabilityCeiling,
				abortStart: spawned.abortStart,
			});
		}
		return formatAsyncStartError(
			"single",
			`Failed to start background Agent '${id}'; lifecycle recovery is still pending: ${spawned.error}`,
			{
				runId: id,
				asyncId: id,
				asyncDir: location.asyncDir,
				...(lifecycleBinding ? { lifecycleBinding } : {}),
			},
		);
	}
	if (!spawned.pid || !spawned.processStartIdentity || !spawned.acknowledgeStart || !spawned.abortStart) {
		const resolution = resolveBackgroundOwnershipFailure(location, spawned);
		if (!resolution.safeToRelease && resolution.lifecycleBinding?.processStartIdentity) {
			emitStarted({
				id,
				pid: resolution.lifecycleBinding.pid,
				processStartIdentity: resolution.lifecycleBinding.processStartIdentity,
				work: built.work,
				runnerCwd: built.runnerCwd,
				asyncDir: location.asyncDir,
				ctx: params.ctx,
				goal: params.goal,
				timeoutMs,
				deadlineAt,
				nestedRoute,
				nestedSelf,
				capabilityCeiling,
				acknowledgeStart: resolution.lifecycleBinding.acknowledgeStart,
				abortStart: resolution.lifecycleBinding.abortStart,
			});
		}
		return formatAsyncStartError(
			"single",
			resolution.safeToRelease
				? `Background Agent '${id}' started without a complete lifecycle binding.`
				: `Background Agent '${id}' started without a complete lifecycle binding; lifecycle recovery is still pending.`,
			resolution.safeToRelease
				? {}
				: {
						runId: id,
						asyncId: id,
						asyncDir: location.asyncDir,
						...(resolution.lifecycleBinding ? { lifecycleBinding: resolution.lifecycleBinding } : {}),
					},
		);
	}
	if (!location.commit()) {
		const resolution = resolveBackgroundOwnershipFailure(location, spawned);
		if (!resolution.safeToRelease && resolution.lifecycleBinding?.processStartIdentity) {
			emitStarted({
				id,
				pid: resolution.lifecycleBinding.pid,
				processStartIdentity: resolution.lifecycleBinding.processStartIdentity,
				work: built.work,
				runnerCwd: built.runnerCwd,
				asyncDir: location.asyncDir,
				ctx: params.ctx,
				goal: params.goal,
				timeoutMs,
				deadlineAt,
				nestedRoute,
				nestedSelf,
				capabilityCeiling,
				acknowledgeStart: resolution.lifecycleBinding.acknowledgeStart,
				abortStart: resolution.lifecycleBinding.abortStart,
			});
		}
		return formatAsyncStartError(
			"single",
			resolution.safeToRelease
				? `Background Agent '${id}' could not commit ownership of its lifecycle directory.`
				: `Background Agent '${id}' could not commit ownership of its lifecycle directory; lifecycle recovery is still pending.`,
			resolution.safeToRelease
				? {}
				: {
						runId: id,
						asyncId: id,
						asyncDir: location.asyncDir,
						...(resolution.lifecycleBinding ? { lifecycleBinding: resolution.lifecycleBinding } : {}),
					},
		);
	}
	emitStarted({
		id,
		pid: spawned.pid,
		processStartIdentity: spawned.processStartIdentity,
		work: built.work,
		runnerCwd: built.runnerCwd,
		asyncDir: location.asyncDir,
		ctx: params.ctx,
		goal: params.goal,
		timeoutMs,
		deadlineAt,
		nestedRoute,
		nestedSelf,
		capabilityCeiling,
		acknowledgeStart: spawned.acknowledgeStart,
		abortStart: spawned.abortStart,
	});
	return {
		content: [
			{
				type: "text",
				text: formatAsyncStartedMessage(
					`Background Agent: ${built.work.task.agent} [${id}]`,
					params.ctx.interactive === true,
				),
			},
		],
		details: {
			mode: "single",
			runId: id,
			results: [],
			asyncId: id,
			asyncDir: location.asyncDir,
			launchContractDigest: built.work.task.launchContractDigest,
			...(capabilityCeiling ? { capabilityCeiling } : {}),
			...(params.context ? { context: params.context } : {}),
			...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}),
			...(built.work.task.turnBudget ? { turnBudget: built.work.task.turnBudget } : {}),
			...(built.work.task.toolBudget ? { toolBudget: built.work.task.toolBudget } : {}),
			lifecycleBinding: {
				pid: spawned.pid,
				processStartIdentity: spawned.processStartIdentity,
				asyncDir: location.asyncDir,
				acknowledgeStart: spawned.acknowledgeStart,
				abortStart: spawned.abortStart,
			},
		},
	};
}
