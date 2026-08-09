import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult as CoreAgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type ExtensionAPI,
	type ExtensionContext,
	estimateTokens,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import type { projectCurrentContext } from "@jczhang02/pi-stuff-context";
import type { AgentConfig, AgentScope } from "../../agents/agents.ts";
import { normalizeSkillInput } from "../../agents/skills.ts";
import { getArtifactsDir } from "../../shared/artifacts.ts";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { resolveDisplayDescription } from "../../shared/display-description.ts";
import { createForkContextResolver, forkedChildRequiresThinkingOff } from "../../shared/fork-context.ts";
import { findModelInfo, type ModelInfo, toModelInfo } from "../../shared/model-info.ts";
import {
	ensurePrivateDirectory,
	readBoundedOwnedFile,
	validateOwnedRegularFile,
} from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import { resolveCurrentSessionId, sessionArtifactMatches } from "../../shared/session-identity.ts";
import {
	type ArtifactConfig,
	ASYNC_DIR,
	type AsyncStatus,
	checkSubagentDepth,
	DEFAULT_ARTIFACT_CONFIG,
	type Details,
	type ExtensionConfig,
	type ForegroundRunControl,
	RESULTS_DIR,
	type ResolvedToolBudget,
	type ResolvedTurnBudget,
	resolveChildMaxSubagentDepth,
	resolveCurrentMaxSubagentDepth,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	type SubagentState,
	TEMP_ROOT_DIR,
	type ToolBudgetConfig,
	type TurnBudgetConfig,
	wrapForkTask,
} from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import {
	buildAsyncParallelRunnerWork,
	buildAsyncSingleRunnerWork,
	buildResolvedTask,
	executeAsyncParallel,
	executeAsyncSingle,
	isAsyncAvailable,
	persistRecoveries,
} from "../background/async-execution.ts";
import {
	applySteeringRecoveryAgentConfig,
	buildRevivedAsyncTask,
	findAsyncRunPrefixMatches,
	readAsyncRecoveryDescriptor,
	resolveAsyncResumeTarget,
} from "../background/async-resume.ts";
import { deliverStopRequest, requestAsyncSteer } from "../background/control-channel.ts";
import { createInitialStatus } from "../background/initial-status.ts";
import { inspectSubagentStatus } from "../background/run-status.ts";
import { reconcileAsyncRun } from "../background/stale-run-reconciler.ts";
import { waitForSteeringAction } from "../background/steering.ts";
import {
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
} from "../background/writer-process-registry.ts";
import {
	intersectSubagentCapabilityCeilings,
	resolveCurrentSubagentCapabilityCeiling,
} from "../shared/capability-ceiling.ts";
import type { ContextMode, ContextSummary } from "../shared/context-mode.ts";
import {
	buildModelCandidates,
	normalizeParentModel,
	type ParentModel,
	resolveEffectiveSubagentModel,
} from "../shared/model-fallback.ts";
import {
	createNestedRoute,
	resolveInheritedNestedRouteFromEnv,
	resolveNestedParentAddressFromEnv,
	retireUnusedNestedRoute,
	sanitizeSummary,
	updateForegroundNestedProjection,
	writeNestedEvent,
} from "../shared/nested-events.ts";
import type { BackgroundRunnerConfig } from "../shared/parallel-utils.ts";
import { SUBAGENT_PARENT_PHYSICAL_SESSION_ENV, SUBAGENT_PARENT_SESSION_ENV } from "../shared/pi-args.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { resolveTurnBudgetConfig } from "../shared/turn-budget.ts";
import { executeForegroundConfig } from "./execution.ts";

type AgentToolResult<T> = CoreAgentToolResult<T> & { isError?: boolean };

export interface LaunchIdentityScope {
	readonly sessionId: string;
	readonly ownerAgentPath: readonly string[];
}

/** Stable launch identity shared by the public tool, storage, and session-wide governor. */
export function deriveLaunchRunId(toolCallId: string, scope?: LaunchIdentityScope): string {
	const hash = createHash("sha256");
	if (scope) hash.update(JSON.stringify([scope.sessionId, scope.ownerAgentPath]));
	hash.update("\0").update(toolCallId);
	return hash.digest("hex").slice(0, 12);
}

interface TaskParam {
	agent: string;
	description?: string;
	task: string;
	cwd?: string;
	model?: string;
	skill?: string | string[] | boolean;
	turnBudget?: TurnBudgetConfig;
	toolBudget?: ToolBudgetConfig;
}

/** Private engine shape. The public Claude-style contract maps into this subset. */
export interface SubagentParamsLike {
	action?: "resume" | "status" | "steer" | "stop";
	id?: string;
	index?: number;
	agent?: string;
	description?: string;
	task?: string;
	message?: string;
	tasks?: TaskParam[];
	worktree?: boolean;
	context?: "fresh" | "fork";
	async?: boolean;
	timeoutMs?: number;
	turnBudget?: TurnBudgetConfig;
	toolBudget?: ToolBudgetConfig;
	cwd?: string;
	model?: string;
	thinking?: string | false;
	skill?: string | string[] | boolean;
	/** Suite-owned, bounded reference context. Never part of the public tool schema. */
	contextProjection?: string;
	/** Suite-owned launch identity already bound to the physical parent session. */
	launchRunId?: string;
}

interface ExecutorEngines {
	backgroundSingle: typeof executeAsyncSingle;
	backgroundParallel: typeof executeAsyncParallel;
	foreground: typeof executeForegroundConfig;
}

interface ExecutorDeps {
	pi: ExtensionAPI;
	state: SubagentState;
	config: ExtensionConfig;
	asyncByDefault: boolean;
	tempArtifactsDir: string;
	getSubagentSessionRoot: (parentSessionFile: string | null) => string;
	expandTilde: (value: string) => string;
	discoverAgents: (
		cwd: string,
		scope: AgentScope,
	) => { agents: AgentConfig[]; modelScope?: import("../shared/model-scope.ts").ModelScopeConfig };
	projectContext?: typeof projectCurrentContext;
	allowMutatingManagementActions?: boolean;
	kill?: (pid: number, signal?: NodeJS.Signals | 0) => boolean;
	engines?: Partial<ExecutorEngines>;
}

export interface ForegroundStartBinding {
	readonly runId: string;
	readonly asyncDir: string;
	readonly writerCount: number;
	/** Release a committed start only after proving that no status or writer exists. */
	readonly abortStart: () => boolean;
}

export interface SubagentExecutionHooks {
	/** Called after every fallible launch preflight but before any child writer starts. */
	readonly beforeForegroundStart?: (binding: ForegroundStartBinding) => void | Promise<void>;
}

interface PreparedLaunch {
	params: SubagentParamsLike;
	mode: "single" | "parallel";
	effectiveCwd: string;
	agents: AgentConfig[];
	currentSessionId: string;
	governorSessionId: string;
	directParentSessionId?: string;
	parentSessionFile: string | null;
	parentModel?: ParentModel;
	availableModels: ModelInfo[];
	modelScope?: import("../shared/model-scope.ts").ModelScopeConfig;
	runId: string;
	sessionRoot: string;
	artifactConfig: ArtifactConfig;
	artifactsDir: string;
	turnBudget?: ResolvedTurnBudget;
	toolBudget?: ResolvedToolBudget;
	configToolBudget?: ResolvedToolBudget;
	timeoutMs?: number;
	context: ContextMode;
	contextSummary: ContextSummary;
	forkContextTokens?: number;
	/** true uses Pi's native raw branch; false uses a bounded projected fork. */
	rawForkByIndex: boolean[];
	fixedInputTokensByIndex: number[];
	modelCandidatesByIndex: Array<string[] | undefined>;
	nestedRoute: ReturnType<typeof createNestedRoute>;
	inheritedNestedRoute?: ReturnType<typeof resolveInheritedNestedRouteFromEnv>;
	nestedParentAddress?: ReturnType<typeof resolveNestedParentAddressFromEnv>;
	sessionFiles: Array<string | undefined>;
	thinkingOverrides: Array<AgentConfig["thinking"] | undefined>;
	capabilityCeiling?: ReturnType<typeof resolveCurrentSubagentCapabilityCeiling>;
	maxSubagentDepth: number;
}

const DEFAULT_ENGINES: ExecutorEngines = {
	backgroundSingle: executeAsyncSingle,
	backgroundParallel: executeAsyncParallel,
	foreground: executeForegroundConfig,
};

const CHILD_CONTEXT_RESERVE_MAX_TOKENS = 16_384;

function errorResult(mode: Details["mode"], message: string, extras: Partial<Details> = {}): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode, results: [], ...extras },
	};
}

function resultIsError(value: unknown): boolean {
	return typeof value === "object" && value !== null && (value as { isError?: unknown }).isError === true;
}

function requestedMode(params: SubagentParamsLike): "single" | "parallel" {
	return params.tasks?.length ? "parallel" : "single";
}

function availableModels(ctx: ExtensionContext): ModelInfo[] {
	try {
		return ctx.modelRegistry.getAvailable().map(toModelInfo);
	} catch {
		return [];
	}
}

function estimateTextTokens(text: string): number {
	let asciiCodePoints = 0;
	let nonAsciiTokens = 0;
	for (const codePoint of text) {
		if (codePoint.codePointAt(0)! <= 0x7f) {
			asciiCodePoints += 1;
			continue;
		}
		// CJK and other non-ASCII scripts commonly consume at least one token per
		// code point. Emoji are often split further, so reserve two. This remains
		// an estimate, but avoids the severe UTF-16 length/4 undercount that let a
		// multilingual fork start only to overflow inside the child.
		nonAsciiTokens += /\p{Extended_Pictographic}/u.test(codePoint) ? 2 : 1;
	}
	return Math.ceil(asciiCodePoints / 4) + nonAsciiTokens;
}

function inheritedContextTokens(ctx: ExtensionContext): number {
	let effective: number | undefined;
	try {
		const value = ctx.getContextUsage()?.tokens;
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) effective = value;
	} catch {
		// Continue with the persisted branch estimator.
	}
	try {
		const persisted = ctx.sessionManager
			.buildContextEntries()
			.flatMap((entry) => sessionEntryToContextMessages(entry))
			.reduce((total, message) => total + estimateTokens(message), 0);
		// A native fork clones persisted branch entries, not the post-transform
		// prompt reported by getContextUsage(). Magic Context can make the latter
		// much smaller, so use the conservative larger estimate.
		return Math.max(effective ?? 0, persisted);
	} catch {
		// If the persisted branch cannot be measured, the live usage may be a
		// much smaller Magic-transformed prompt. Force the bounded projection path
		// instead of risking an oversized native clone.
		return Number.POSITIVE_INFINITY;
	}
}

function taskModelCandidates(data: PreparedLaunch, task: TaskParam, agent: AgentConfig): string[] {
	const primary = resolveEffectiveSubagentModel(
		task.model,
		agent.model,
		data.parentModel,
		data.availableModels,
		data.parentModel?.provider,
		{ scope: data.modelScope },
	);
	return buildModelCandidates(primary, agent.fallbackModels, data.availableModels, data.parentModel?.provider, {
		scope: data.modelScope,
	});
}

function projectionTokenBudget(data: PreparedLaunch): number {
	let launchBudget = Number.POSITIVE_INFINITY;
	for (const [index, task] of taskInputs(data.params).entries()) {
		if (data.context === "fork" && data.rawForkByIndex[index]) continue;
		const agent = data.agents.find((candidate) => candidate.name === task.agent);
		if (!agent) return 0;
		const candidates = data.modelCandidatesByIndex[index] ?? taskModelCandidates(data, task, agent);
		if (candidates.length === 0) return 0;
		const knownTokens =
			data.fixedInputTokensByIndex[index] ??
			estimateTextTokens(task.task) + estimateTextTokens(agent.systemPrompt ?? "");
		for (const candidate of candidates) {
			const model = findModelInfo(candidate, data.availableModels, data.parentModel?.provider);
			if (!model?.contextWindow || !model.maxTokens) return 0;
			const reserve = Math.min(CHILD_CONTEXT_RESERVE_MAX_TOKENS, Math.floor(model.contextWindow * 0.25));
			launchBudget = Math.min(launchBudget, model.contextWindow - model.maxTokens - reserve - knownTokens);
		}
	}
	return Number.isFinite(launchBudget) ? Math.max(0, Math.floor(launchBudget)) : 0;
}

function forkInputCapacity(model: ModelInfo): number | undefined {
	if (
		typeof model.contextWindow !== "number" ||
		!Number.isFinite(model.contextWindow) ||
		model.contextWindow <= 0 ||
		typeof model.maxTokens !== "number" ||
		!Number.isFinite(model.maxTokens) ||
		model.maxTokens <= 0
	)
		return undefined;
	const runtimeReserve = Math.min(CHILD_CONTEXT_RESERVE_MAX_TOKENS, Math.floor(model.contextWindow * 0.25));
	return Math.max(0, Math.floor(model.contextWindow - model.maxTokens - runtimeReserve));
}

function approximateTokens(tokens: number): string {
	if (!Number.isFinite(tokens)) return "an unmeasurable number of";
	return tokens >= 1_000 ? `about ${Math.ceil(tokens / 1_000).toLocaleString("en-US")}k` : String(Math.ceil(tokens));
}

function prepareLaunchModelPlan(input: {
	runId: string;
	params: SubagentParamsLike;
	agents: readonly AgentConfig[];
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	context: ContextMode;
	effectiveCwd: string;
	currentSessionId: string;
	governorSessionId: string;
	directParentSessionId?: string;
	parentModel?: ParentModel;
	availableModels: ModelInfo[];
	modelScope?: import("../shared/model-scope.ts").ModelScopeConfig;
	turnBudget?: ResolvedTurnBudget;
	toolBudget?: ResolvedToolBudget;
	configToolBudget?: ResolvedToolBudget;
	capabilityCeiling?: ReturnType<typeof resolveCurrentSubagentCapabilityCeiling>;
	maxSubagentDepth: number;
}): {
	forkContextTokens?: number;
	rawForkByIndex: boolean[];
	fixedInputTokensByIndex: number[];
	modelCandidatesByIndex: Array<string[] | undefined>;
} {
	const tasks = taskInputs(input.params);
	const forkTokens = input.context === "fork" ? inheritedContextTokens(input.ctx) : 0;
	const fixedInputTokensByIndex: number[] = [];
	const rawForkByIndex: boolean[] = [];
	const modelCandidatesByIndex = tasks.map((task, index) => {
		const agent = input.agents.find((candidate) => candidate.name === task.agent);
		if (!agent) throw new Error(`Unknown Agent: ${task.agent}`);
		const normalizedSkill = normalizeSkillInput(task.skill);
		const built = buildResolvedTask({
			runId: input.runId,
			index,
			taskInput: {
				agent: task.agent,
				...(task.description ? { description: task.description } : {}),
				task: input.context === "fork" ? wrapForkTask(task.task) : task.task,
				...(task.cwd ? { cwd: task.cwd } : {}),
				...(task.model ? { model: task.model } : {}),
				...(normalizedSkill !== undefined ? { skill: normalizedSkill } : {}),
				...(task.turnBudget ? { turnBudget: task.turnBudget } : {}),
				...(task.toolBudget ? { toolBudget: task.toolBudget } : {}),
			},
			agent,
			params: {
				ctx: {
					pi: input.pi,
					cwd: input.ctx.cwd,
					currentSessionId: input.currentSessionId,
					governorSessionId: input.governorSessionId,
					physicalSessionId: input.currentSessionId,
					parentSessionId: input.directParentSessionId,
					currentModelProvider: input.parentModel?.provider,
					currentModel: input.parentModel,
					modelScope: input.modelScope,
					interactive: input.ctx.hasUI,
				},
				availableModels: input.availableModels,
				cwd: input.effectiveCwd,
				maxSubagentDepth: input.maxSubagentDepth,
				turnBudget: input.turnBudget,
				toolBudget: input.toolBudget,
				configToolBudget: input.configToolBudget,
				capabilityCeiling: input.capabilityCeiling,
			},
			runnerCwd: input.effectiveCwd,
			context: input.context,
			...(normalizedSkill === false ? { skills: [] } : {}),
			thinkingOverride: input.params.thinking,
		});
		if ("error" in built) throw new Error(built.error);
		const candidates = built.task.modelCandidates ?? [];
		const taskTokens =
			estimateTextTokens(built.task.task) + estimateTextTokens(built.task.systemPrompt?.trim() ?? "");
		fixedInputTokensByIndex[index] = taskTokens;
		if (input.context !== "fork") {
			rawForkByIndex[index] = false;
			return candidates.length > 0 ? candidates : undefined;
		}

		const requiredInputTokens = forkTokens + taskTokens;
		const safeCandidates = candidates.filter((candidate) => {
			const model = findModelInfo(candidate, input.availableModels, input.parentModel?.provider);
			const capacity = model ? forkInputCapacity(model) : undefined;
			return capacity !== undefined && requiredInputTokens <= capacity;
		});
		if (safeCandidates.length > 0) {
			rawForkByIndex[index] = true;
			return safeCandidates;
		}

		const projectedCandidates = candidates.filter((candidate) => {
			const model = findModelInfo(candidate, input.availableModels, input.parentModel?.provider);
			const capacity = model ? forkInputCapacity(model) : undefined;
			return capacity !== undefined && taskTokens <= capacity;
		});
		if (projectedCandidates.length > 0) {
			rawForkByIndex[index] = false;
			return projectedCandidates;
		}

		const capacities = candidates
			.map((candidate) => {
				const model = findModelInfo(candidate, input.availableModels, input.parentModel?.provider);
				const capacity = model ? forkInputCapacity(model) : undefined;
				return `${candidate}: ${capacity === undefined ? "limits unavailable" : `${approximateTokens(capacity)} input tokens`}`;
			})
			.join(", ");
		const taskLabel = tasks.length > 1 ? ` task ${index + 1} (${task.agent})` : ` Agent '${task.agent}'`;
		throw new Error(
			`Cannot start forked${taskLabel}: the fixed child instruction requires ${approximateTokens(
				taskTokens,
			)} input tokens before any bounded parent projection, but no candidate model has safe capacity${capacities ? ` (${capacities})` : ""}. ` +
				`Shorten the task or choose a model with a larger context window.`,
		);
	});
	return {
		...(input.context === "fork" ? { forkContextTokens: forkTokens } : {}),
		rawForkByIndex,
		fixedInputTokensByIndex,
		modelCandidatesByIndex,
	};
}

async function attachContextProjection(
	data: PreparedLaunch,
	ctx: ExtensionContext,
	projectContext: typeof projectCurrentContext | undefined,
): Promise<void> {
	data.params.contextProjection = undefined;
	if (!projectContext) return;
	if (data.context === "fork" && data.rawForkByIndex.every(Boolean)) return;
	const maxTokens = projectionTokenBudget(data);
	if (maxTokens <= 0) return;
	try {
		const audience = data.context === "fork" ? "agent-fork" : "agent-fresh";
		const projection = await projectContext(audience, ctx, { maxTokens });
		if (projection.text) data.params.contextProjection = projection.text;
	} catch {
		// Context continuity is optional; Agent launch remains fail-open.
	}
}

function rememberParentModel(
	state: { currentSessionId?: string | null; lastParentModel?: ParentModel },
	sessionId: string,
	model: unknown,
): ParentModel | undefined {
	if (state.currentSessionId !== sessionId) state.lastParentModel = undefined;
	state.currentSessionId = sessionId;
	const current = normalizeParentModel(model);
	if (current) state.lastParentModel = current;
	return current ?? state.lastParentModel;
}

function validateControlInput(params: SubagentParamsLike): string | undefined {
	if (params.index !== undefined && (!Number.isInteger(params.index) || params.index < 0)) {
		return "Agent index must be a non-negative integer.";
	}
	if (params.action !== "status" && !params.id?.trim()) return `action='${params.action}' requires id.`;
	if (params.action === "steer" && !params.message?.trim()) return "action='steer' requires message.";
	return undefined;
}

function validateLaunchInput(params: SubagentParamsLike, agents: readonly AgentConfig[]): string | undefined {
	const hasSingle = Boolean(params.agent);
	const hasParallel = Boolean(params.tasks?.length);
	if (Number(hasSingle) + Number(hasParallel) !== 1) return "Provide exactly one Agent or one non-empty tasks list.";
	if (hasSingle && !params.task?.trim()) return "A single Agent launch requires task.";
	if (hasSingle && !agents.some((agent) => agent.name === params.agent)) return `Unknown Agent: ${params.agent}`;
	for (const [index, task] of (params.tasks ?? []).entries()) {
		if (!task.task.trim()) return `Agent task ${index + 1} requires task text.`;
		if (!agents.some((agent) => agent.name === task.agent)) return `Unknown Agent: ${task.agent} (task ${index + 1})`;
	}
	return undefined;
}

function resolveTimeout(value: unknown): { timeoutMs?: number; error?: string } {
	if (value === undefined) return {};
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return { error: "timeoutMs must be a positive integer." };
	}
	return { timeoutMs: value };
}

function contextFor(params: SubagentParamsLike): ContextMode {
	return params.context === "fork" ? "fork" : "fresh";
}

function taskInputs(params: SubagentParamsLike): TaskParam[] {
	if (params.tasks?.length) return params.tasks;
	if (!params.agent || !params.task) return [];
	return [
		{
			agent: params.agent,
			...(params.description ? { description: params.description } : {}),
			task: params.task,
			...(params.model ? { model: params.model } : {}),
			...(params.skill !== undefined ? { skill: params.skill } : {}),
			...(params.turnBudget ? { turnBudget: params.turnBudget } : {}),
			...(params.toolBudget ? { toolBudget: params.toolBudget } : {}),
		},
	];
}

function prepareForkSessions(input: {
	params: SubagentParamsLike;
	agents: readonly AgentConfig[];
	ctx: ExtensionContext;
	context: ContextMode;
	parentModel?: ParentModel;
	availableModels: ModelInfo[];
	modelScope?: import("../shared/model-scope.ts").ModelScopeConfig;
	modelCandidatesByIndex: Array<string[] | undefined>;
	rawForkByIndex: boolean[];
}): { sessionFiles: Array<string | undefined>; thinkingOverrides: Array<AgentConfig["thinking"] | undefined> } {
	const tasks = taskInputs(input.params);
	if (input.context !== "fork") {
		return {
			sessionFiles: tasks.map(() => undefined),
			thinkingOverrides: tasks.map(() => input.params.thinking),
		};
	}
	if (!input.rawForkByIndex.some(Boolean)) {
		return {
			sessionFiles: tasks.map(() => undefined),
			thinkingOverrides: tasks.map(() => input.params.thinking),
		};
	}

	const forceThinkingOff = new Map<number, boolean>();
	for (const index of tasks.keys()) {
		if (!input.rawForkByIndex[index]) {
			forceThinkingOff.set(index, false);
			continue;
		}
		const candidates = input.modelCandidatesByIndex[index] ?? [];
		forceThinkingOff.set(
			index,
			candidates.length === 0 ||
				candidates.some((candidate) =>
					forkedChildRequiresThinkingOff(candidate, input.availableModels, input.parentModel?.provider),
				),
		);
	}

	const resolver = createForkContextResolver(input.ctx.sessionManager, "fork", {
		forceThinkingOffForIndex: (index) => forceThinkingOff.get(index) ?? true,
	});
	const sessionFiles = tasks.map((_, index) =>
		input.rawForkByIndex[index] ? resolver.sessionFileForIndex(index) : undefined,
	);
	const thinkingOverrides = tasks.map((_, index) =>
		input.rawForkByIndex[index]
			? (resolver.thinkingOverrideForIndex(index) ?? input.params.thinking)
			: input.params.thinking,
	);
	return { sessionFiles, thinkingOverrides };
}

function prepareLaunch(
	id: string,
	params: SubagentParamsLike,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
): PreparedLaunch | AgentToolResult<Details> {
	const mode = requestedMode(params);
	const depth = checkSubagentDepth(deps.config.maxSubagentDepth);
	if (depth.blocked) {
		return errorResult(
			mode,
			`Nested Agent launch blocked at depth ${depth.depth} (maximum ${depth.maxDepth}). Complete this task directly.`,
		);
	}

	let currentSessionId: string;
	try {
		currentSessionId =
			deps.state.currentSessionId ??
			process.env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV]?.trim() ??
			resolveCurrentSessionId(ctx.sessionManager, ctx.cwd);
	} catch (error) {
		return errorResult(mode, error instanceof Error ? error.message : String(error));
	}
	const parentModel = rememberParentModel(deps.state, currentSessionId, ctx.model);
	const effectiveCwd = path.resolve(ctx.cwd, params.cwd ?? ".");
	const discovered = deps.discoverAgents(effectiveCwd, "both");
	const validationError = validateLaunchInput(params, discovered.agents);
	if (validationError) return errorResult(mode, validationError);

	const timeout = resolveTimeout(params.timeoutMs);
	if (timeout.error) return errorResult(mode, timeout.error);
	const turn = resolveTurnBudgetConfig(params.turnBudget ?? deps.config.turnBudget, "turnBudget");
	if (turn.error) return errorResult(mode, turn.error);
	const tool = validateToolBudgetConfig(params.toolBudget, "toolBudget");
	if (tool.error) return errorResult(mode, tool.error);
	const configTool = validateToolBudgetConfig(deps.config.toolBudget, "config.toolBudget");
	if (configTool.error) return errorResult(mode, configTool.error);

	const parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
	const directParentSessionId = ctx.sessionManager.getSessionId()?.trim() || undefined;
	const runId = params.launchRunId ?? deriveLaunchRunId(id);
	if (!/^[a-f0-9]{12}$/u.test(runId)) return errorResult(mode, "Invalid internal Agent launch identity.");
	const governorSessionId = process.env[SUBAGENT_PARENT_SESSION_ENV]?.trim() || currentSessionId;
	const artifactConfig: ArtifactConfig = {
		...DEFAULT_ARTIFACT_CONFIG,
		dir: deps.config.artifactDir ?? DEFAULT_ARTIFACT_CONFIG.dir,
	};
	const artifactsDir = getArtifactsDir(parentSessionFile, effectiveCwd, artifactConfig.dir);
	const models = availableModels(ctx);
	const context = contextFor(params);
	const capabilityCeiling = resolveCurrentSubagentCapabilityCeiling(currentSessionId);
	const maxSubagentDepth = resolveCurrentMaxSubagentDepth(deps.config.maxSubagentDepth);
	let modelPlan: ReturnType<typeof prepareLaunchModelPlan>;
	try {
		modelPlan = prepareLaunchModelPlan({
			runId,
			params,
			agents: discovered.agents,
			ctx,
			pi: deps.pi,
			context,
			effectiveCwd,
			currentSessionId,
			governorSessionId,
			directParentSessionId,
			parentModel,
			availableModels: models,
			modelScope: discovered.modelScope,
			turnBudget: turn.turnBudget,
			toolBudget: tool.budget,
			configToolBudget: configTool.budget,
			capabilityCeiling,
			maxSubagentDepth,
		});
	} catch (error) {
		return errorResult(mode, error instanceof Error ? error.message : String(error));
	}
	let fork: ReturnType<typeof prepareForkSessions>;
	try {
		fork = prepareForkSessions({
			params,
			agents: discovered.agents,
			ctx,
			context,
			parentModel,
			availableModels: models,
			modelScope: discovered.modelScope,
			modelCandidatesByIndex: modelPlan.modelCandidatesByIndex,
			rawForkByIndex: modelPlan.rawForkByIndex,
		});
	} catch (error) {
		return errorResult(mode, error instanceof Error ? error.message : String(error));
	}
	const sessionBase = deps.config.defaultSessionDir
		? path.resolve(deps.expandTilde(deps.config.defaultSessionDir))
		: deps.getSubagentSessionRoot(parentSessionFile);
	const sessionRoot = path.join(sessionBase, runId);
	try {
		fs.mkdirSync(sessionRoot, { recursive: true });
	} catch (error) {
		return errorResult(
			mode,
			`Failed to create Agent session directory: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const inheritedNestedRoute = resolveInheritedNestedRouteFromEnv();
	const nestedParentAddress = inheritedNestedRoute ? resolveNestedParentAddressFromEnv() : undefined;
	return {
		params,
		mode,
		effectiveCwd,
		agents: discovered.agents,
		currentSessionId,
		governorSessionId,
		...(directParentSessionId ? { directParentSessionId } : {}),
		parentSessionFile,
		parentModel,
		availableModels: models,
		modelScope: discovered.modelScope,
		runId,
		sessionRoot,
		artifactConfig,
		artifactsDir,
		turnBudget: turn.turnBudget,
		toolBudget: tool.budget,
		configToolBudget: configTool.budget,
		timeoutMs: timeout.timeoutMs,
		context,
		contextSummary: context,
		...(modelPlan.forkContextTokens !== undefined ? { forkContextTokens: modelPlan.forkContextTokens } : {}),
		rawForkByIndex: modelPlan.rawForkByIndex,
		fixedInputTokensByIndex: modelPlan.fixedInputTokensByIndex,
		modelCandidatesByIndex: modelPlan.modelCandidatesByIndex,
		nestedRoute: inheritedNestedRoute ?? createNestedRoute(runId),
		inheritedNestedRoute,
		nestedParentAddress,
		sessionFiles: fork.sessionFiles,
		thinkingOverrides: fork.thinkingOverrides,
		capabilityCeiling,
		maxSubagentDepth,
	};
}

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

function parallelInputs(data: PreparedLaunch) {
	return (data.params.tasks ?? []).map((task, index) => {
		const skill = normalizeSkillInput(task.skill);
		return {
			agent: task.agent,
			...(task.description ? { description: task.description } : {}),
			task: childTask(data, task, index),
			...(task.cwd ? { cwd: task.cwd } : {}),
			...(task.model ? { model: task.model } : {}),
			...(skill !== undefined ? { skill } : {}),
			...(task.turnBudget ? { turnBudget: task.turnBudget } : {}),
			...(task.toolBudget ? { toolBudget: task.toolBudget } : {}),
		};
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

function commonBuild(data: PreparedLaunch, ctx: ExtensionContext, deps: ExecutorDeps) {
	return {
		ctx: asyncContext(data, ctx, deps.pi),
		availableModels: data.availableModels,
		cwd: data.effectiveCwd,
		artifactsDir: data.artifactConfig.enabled ? data.artifactsDir : undefined,
		artifactConfig: data.artifactConfig,
		sessionDir: data.sessionRoot,
		turnBudget: data.turnBudget,
		toolBudget: data.toolBudget,
		configToolBudget: data.configToolBudget,
		capabilityCeiling: data.capabilityCeiling,
	};
}

async function launchBackground(
	data: PreparedLaunch,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
	engines: ExecutorEngines,
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

interface ForegroundRunDirectoryClaim {
	readonly asyncDir: string;
	/** Remove only the directory inode and token created by this invocation. */
	cleanup(): void;
	/** Relinquish the preparation token after binding succeeds. */
	commit(): boolean;
	/** Reclaim a committed directory only when the runner never durably started. */
	abortIfUnstarted(): boolean;
}

interface PreparedForegroundConfig {
	readonly config: BackgroundRunnerConfig;
	readonly directoryClaim: ForegroundRunDirectoryClaim;
	readonly recoveries: import("../background/async-execution.ts").BackgroundRecoveryDescriptor[];
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
	const nestedSelf =
		data.inheritedNestedRoute && data.nestedParentAddress
			? {
					parentRunId: data.nestedParentAddress.parentRunId,
					...(data.nestedParentAddress.parentStepIndex !== undefined
						? { parentStepIndex: data.nestedParentAddress.parentStepIndex }
						: {}),
					depth: data.nestedParentAddress.depth,
					path: data.nestedParentAddress.path,
				}
			: undefined;
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: data.runId,
		work: built.work,
		resultPath,
		cwd: built.runnerCwd,
		asyncDir,
		sessionId: data.currentSessionId,
		startedAt: Date.now(),
		...(data.artifactConfig.enabled ? { artifactsDir: data.artifactsDir } : {}),
		artifactConfig: data.artifactConfig,
		nativeSupervisor: false,
		sessionDir: data.sessionRoot,
		worktreeSetupHook: deps.config.worktreeSetupHook,
		worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
		worktreeBaseDir: deps.config.worktreeBaseDir,
		nestedRoute: data.nestedRoute,
		nestedSelf,
		...(data.timeoutMs !== undefined ? { timeoutMs: data.timeoutMs, deadlineAt } : {}),
		...(data.capabilityCeiling ? { capabilityCeiling: data.capabilityCeiling } : {}),
	};
	const recoveries = "recoveries" in built ? built.recoveries : [built.recovery];
	return { config, directoryClaim, recoveries };
}

/**
 * Resolve and create the exact foreground lifecycle directory used by both the
 * executor and the fanout-child governor pre-binding. Keeping this in one seam
 * prevents nested foreground runs from being bound to a top-level placeholder
 * directory that cannot reap their real writer processes after an owner crash.
 */
function claimForegroundRunDirectory(
	runId: string,
	inheritedNestedRoute?: ReturnType<typeof resolveInheritedNestedRouteFromEnv>,
): ForegroundRunDirectoryClaim {
	if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error("Invalid internal Agent launch identity.");
	ensurePrivateDirectory(TEMP_ROOT_DIR);
	let asyncDir: string;
	if (inheritedNestedRoute) {
		const nestedRunsRoot = path.join(TEMP_ROOT_DIR, "nested-subagent-runs");
		const rootRunDir = path.join(nestedRunsRoot, inheritedNestedRoute.rootRunId);
		asyncDir = path.join(rootRunDir, runId);
		ensurePrivateDirectory(nestedRunsRoot);
		ensurePrivateDirectory(rootRunDir);
	} else {
		const foregroundRoot = path.join(TEMP_ROOT_DIR, "foreground-runs");
		asyncDir = path.join(foregroundRoot, runId);
		ensurePrivateDirectory(foregroundRoot);
	}

	try {
		fs.mkdirSync(asyncDir, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(
				`Foreground Agent runtime '${asyncDir}' already exists; refusing to overwrite retained lifecycle evidence.`,
			);
		}
		throw error;
	}
	const created = fs.lstatSync(asyncDir);
	const token = randomUUID();
	const markerPath = path.join(asyncDir, ".foreground-preparation-owner.json");
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
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
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
	let removed = false;
	const stillCreatedInode = (): boolean => {
		if (removed) return false;
		try {
			const current = fs.lstatSync(asyncDir);
			return current.isDirectory() && current.dev === created.dev && current.ino === created.ino;
		} catch {
			return false;
		}
	};
	const stillOwned = (): boolean => {
		if (committed) return false;
		try {
			if (!stillCreatedInode()) return false;
			const marker = JSON.parse(readBoundedOwnedFile(markerPath, 4 * 1024)) as { token?: unknown };
			return marker.token === token;
		} catch {
			return false;
		}
	};
	const removeCreatedInode = (): boolean => {
		if (!stillCreatedInode()) return false;
		const failedPath = `${asyncDir}.failed-${token}`;
		try {
			fs.renameSync(asyncDir, failedPath);
			const moved = fs.lstatSync(failedPath);
			if (!moved.isDirectory() || moved.dev !== created.dev || moved.ino !== created.ino) return false;
			fs.rmSync(failedPath, { recursive: true });
			removed = true;
			return true;
		} catch {
			// An ownership race leaves evidence in place instead of deleting an
			// unproven directory.
			return false;
		}
	};
	return {
		asyncDir,
		cleanup: () => {
			if (!stillOwned()) return;
			removeCreatedInode();
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
		abortIfUnstarted: () => {
			if (removed) return true;
			if (!committed || !stillCreatedInode()) return false;
			if (inspectWriterProcessLiveness(asyncDir) !== false) return false;
			if (fs.existsSync(path.join(asyncDir, "completion.json"))) return false;
			const status = readStatus(asyncDir);
			if (
				status &&
				(status.runId !== runId ||
					(status.state !== "running" && status.state !== "queued") ||
					!status.steps?.every((step) => step.status === "pending"))
			) {
				return false;
			}
			return removeCreatedInode();
		},
	};
}

function foregroundControl(data: PreparedLaunch, config: BackgroundRunnerConfig): ForegroundRunControl {
	const now = Date.now();
	const activeChildren = new Map(
		taskInputs(data.params).map((task, index) => [
			index,
			{
				index,
				agent: task.agent,
				description: task.description,
				task: task.task,
				startedAt: now,
				updatedAt: now,
				status: "running" as const,
				interrupt: () => {
					try {
						deliverStopRequest({
							asyncDir: config.asyncDir,
							source: "foreground-ui",
							targetIndex: index,
						});
						return true;
					} catch {
						return false;
					}
				},
			},
		]),
	);
	return {
		runId: data.runId,
		sessionId: data.currentSessionId,
		mode: data.mode,
		startedAt: now,
		updatedAt: now,
		cwd: data.effectiveCwd,
		description: taskInputs(data.params)[0]?.description,
		task: taskInputs(data.params)[0]?.task,
		activeChildren,
		nestedRoute: data.nestedRoute,
		interrupt: () => {
			try {
				deliverStopRequest({ asyncDir: config.asyncDir, source: "foreground-ui" });
				return true;
			} catch {
				return false;
			}
		},
	};
}

function refreshForegroundControl(control: ForegroundRunControl, config: BackgroundRunnerConfig): void {
	try {
		const status = readStatus(config.asyncDir);
		if (!status) return;
		control.updatedAt = status.lastUpdate ?? Date.now();
		for (const [index, step] of (status.steps ?? []).entries()) {
			const child = control.activeChildren?.get(index);
			if (!child) continue;
			child.status = step.status;
			child.updatedAt = step.endedAt ?? status.lastUpdate ?? Date.now();
			child.currentActivityState = step.activityState;
			child.lastActivityAt = step.lastActivityAt;
			child.currentTool = step.currentTool;
			child.currentToolStartedAt = step.currentToolStartedAt;
			child.currentPath = step.currentPath;
			child.turnCount = step.turnCount;
			child.toolCount = step.toolCount;
		}
		updateForegroundNestedProjection(control);
	} catch {
		// A live status write can race this projection. The next refresh retries.
	}
}

function nestedState(result?: AgentToolResult<Details>): "running" | "complete" | "failed" | "paused" | "stopped" {
	if (!result) return "running";
	if (result.details.results.some((child) => child.detached)) return "running";
	if (result.details.stopped || result.details.results.some((child) => child.stopped)) return "stopped";
	if (result.details.results.some((child) => child.interrupted)) return "paused";
	return resultIsError(result) || result.details.results.some((child) => child.exitCode !== 0) ? "failed" : "complete";
}

function emitNestedLifecycle(
	data: PreparedLaunch,
	config: BackgroundRunnerConfig,
	control: ForegroundRunControl,
	startedAt: number,
	result?: AgentToolResult<Details>,
	updated = false,
): void {
	if (!data.inheritedNestedRoute || !data.nestedParentAddress) return;
	const now = Date.now();
	const state = nestedState(result);
	const terminalResult = result && state !== "running" ? result : undefined;
	const directTasks = taskInputs(data.params);
	let liveStatus: AsyncStatus | null = null;
	if (!result) {
		try {
			liveStatus = readStatus(config.asyncDir);
		} catch {
			// The activeChildren projection below is the bounded fallback.
		}
	}
	const liveSteps = liveStatus?.steps?.map((step) => ({
		agent: step.agent,
		...(step.task ? { task: step.task } : {}),
		...(step.label ? { description: step.label } : {}),
		status: step.status,
		...(step.processTerminal?.state === "observed" &&
		step.processTerminal.instances.some(
			(instance) => instance.kind === "pi-writer" && instance.terminationOrigin === "external",
		)
			? { agentStatus: "crashed" as const }
			: {}),
		...(step.sessionFile ? { sessionFile: step.sessionFile } : {}),
		...(step.transcriptPath ? { transcriptPath: step.transcriptPath } : {}),
		...(step.transcriptError ? { transcriptError: step.transcriptError } : {}),
		...(step.activityState ? { activityState: step.activityState } : {}),
		...(step.lastActivityAt ? { lastActivityAt: step.lastActivityAt } : {}),
		...(step.currentTool ? { currentTool: step.currentTool } : {}),
		...(step.currentToolStartedAt ? { currentToolStartedAt: step.currentToolStartedAt } : {}),
		...(step.currentPath ? { currentPath: step.currentPath } : {}),
		...(step.turnCount !== undefined ? { turnCount: step.turnCount } : {}),
		...(step.toolCount !== undefined ? { toolCount: step.toolCount } : {}),
		...(step.error ? { error: step.error } : {}),
	}));
	const projectedLiveSteps = liveSteps?.length
		? liveSteps
		: [...(control.activeChildren?.values() ?? [])].map((child) => ({
				agent: child.agent,
				...(child.task ? { task: child.task } : {}),
				...(child.description ? { description: child.description } : {}),
				status: child.status ?? "running",
				...(child.currentActivityState ? { activityState: child.currentActivityState } : {}),
				...(child.lastActivityAt ? { lastActivityAt: child.lastActivityAt } : {}),
				...(child.currentTool ? { currentTool: child.currentTool } : {}),
				...(child.currentToolStartedAt ? { currentToolStartedAt: child.currentToolStartedAt } : {}),
				...(child.currentPath ? { currentPath: child.currentPath } : {}),
				...(child.turnCount !== undefined ? { turnCount: child.turnCount } : {}),
				...(child.toolCount !== undefined ? { toolCount: child.toolCount } : {}),
			}));
	try {
		writeNestedEvent(data.inheritedNestedRoute, {
			type: terminalResult
				? "subagent.nested.completed"
				: result || updated
					? "subagent.nested.updated"
					: "subagent.nested.started",
			ts: now,
			parentRunId: data.nestedParentAddress.parentRunId,
			parentStepIndex: data.nestedParentAddress.parentStepIndex,
			child: {
				id: data.runId,
				parentRunId: data.nestedParentAddress.parentRunId,
				parentStepIndex: data.nestedParentAddress.parentStepIndex,
				depth: data.nestedParentAddress.depth,
				path: data.nestedParentAddress.path,
				asyncDir: config.asyncDir,
				ownerState: state === "running" ? "live" : "gone",
				mode: data.mode,
				state,
				agent: directTasks[0]?.agent,
				agents: directTasks.map((task) => task.agent),
				startedAt,
				...(terminalResult ? { endedAt: now } : {}),
				lastUpdate: now,
				...(result?.details.results.length
					? {
							steps: result.details.results.map((child, index) => ({
								agent: child.agent,
								...(directTasks[index]?.task ? { task: directTasks[index].task } : {}),
								...(directTasks[index]?.description ? { description: directTasks[index].description } : {}),
								status: child.detached
									? ("running" as const)
									: child.stopped
										? ("stopped" as const)
										: child.interrupted
											? ("paused" as const)
											: child.exitCode === 0
												? ("complete" as const)
												: ("failed" as const),
								...(child.crashed ? { agentStatus: "crashed" as const } : {}),
								...(child.sessionFile ? { sessionFile: child.sessionFile } : {}),
								...(child.transcriptPath ? { transcriptPath: child.transcriptPath } : {}),
								...(child.transcriptError ? { transcriptError: child.transcriptError } : {}),
								...(child.error ? { error: child.error } : {}),
								...(child.children?.length ? { children: child.children } : {}),
							})),
						}
					: projectedLiveSteps.length
						? { steps: projectedLiveSteps }
						: {}),
			},
		});
	} catch (error) {
		console.error("Failed to record nested foreground Agent lifecycle:", error);
	}
}

function rememberForegroundResult(
	state: SubagentState,
	data: PreparedLaunch,
	result: AgentToolResult<Details>,
	startedAt: number,
	asyncDir: string,
): void {
	const updatedAt = Date.now();
	const rememberedTasks = taskInputs(data.params);
	state.foregroundRuns ??= new Map();
	state.foregroundRuns.set(data.runId, {
		runId: data.runId,
		mode: data.mode,
		cwd: data.effectiveCwd,
		asyncDir,
		sessionId: data.currentSessionId,
		updatedAt,
		...(fs.existsSync(path.dirname(data.nestedRoute.eventSink)) ? { nestedRoute: data.nestedRoute } : {}),
		children: result.details.results.map((child, index) => ({
			agent: child.agent,
			index,
			...(child.cwd ? { cwd: child.cwd } : {}),
			...({
				description: rememberedTasks[index]?.description,
				task: rememberedTasks[index]?.task,
				startedAt,
			} as Record<string, unknown>),
			...(child.context ? { context: child.context } : {}),
			...(child.crashed ? { crashed: true } : {}),
			status: child.detached
				? "detached"
				: child.stopped
					? "stopped"
					: child.interrupted
						? "paused"
						: child.exitCode === 0
							? "completed"
							: "failed",
			...(child.sessionFile ? { sessionFile: child.sessionFile } : {}),
			...(child.model ? { model: child.model } : {}),
			...(child.thinking ? { thinking: child.thinking } : {}),
			exitCode: child.exitCode,
			...(child.error ? { error: child.error } : {}),
			...(child.detachedReason ? { detachedReason: child.detachedReason } : {}),
			...(child.finalOutput ? { finalOutput: child.finalOutput } : {}),
			...(child.artifactPaths ? { artifactPaths: child.artifactPaths } : {}),
			...(child.transcriptPath ? { transcriptPath: child.transcriptPath } : {}),
			...(child.transcriptError ? { transcriptError: child.transcriptError } : {}),
			...(child.launchContractDigest ? { launchContractDigest: child.launchContractDigest } : {}),
			...(child.capabilityCeiling ? { capabilityCeiling: child.capabilityCeiling } : {}),
			...(child.capabilityAudit ? { capabilityAudit: child.capabilityAudit } : {}),
			...(child.children?.length
				? {
						children: child.children
							.map((nested) => sanitizeSummary(nested))
							.filter((nested): nested is NonNullable<typeof nested> => Boolean(nested)),
					}
				: {}),
			updatedAt,
		})),
	});
	while (state.foregroundRuns.size > 200) {
		const oldest = [...state.foregroundRuns.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
		if (!oldest) break;
		state.foregroundRuns.delete(oldest.runId);
	}
}

async function launchForeground(
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
	const { config, directoryClaim, recoveries } = preparedConfig;
	try {
		persistRecoveries(config.asyncDir, recoveries);
		initializeWriterProcessRegistry(config.asyncDir, config.id, process.pid, taskInputs(data.params).length);
		writePrivateAtomicJson(
			path.join(config.asyncDir, "status.json"),
			createInitialStatus(config, config.startedAt ?? Date.now()),
		);
		await hooks?.beforeForegroundStart?.({
			runId: data.runId,
			asyncDir: config.asyncDir,
			writerCount: taskInputs(data.params).length,
			abortStart: directoryClaim.abortIfUnstarted,
		});
		if (!directoryClaim.commit()) {
			throw new Error(`Foreground Agent runtime ownership changed before '${data.runId}' could start.`);
		}
		onLifecycleCommitted?.();
	} catch (error) {
		// No engine has been invoked yet. The claim removes only the exact fresh
		// inode/token created for this invocation and preserves any collision or
		// replacement as recovery evidence.
		directoryClaim.cleanup();
		try {
			fs.rmdirSync(data.sessionRoot);
		} catch {
			// A non-empty session root may contain a prepared fork and remains recovery evidence.
		}
		throw error;
	}
	const emitUpdate = (update: AgentToolResult<Details>) => {
		try {
			onUpdate?.(update);
		} catch (error) {
			console.error(`Foreground Agent progress observer failed for '${data.runId}':`, error);
		}
	};
	const control = foregroundControl(data, config);
	deps.state.foregroundControls.set(data.runId, control);
	deps.state.lastForegroundControlId = data.runId;
	const controlRefreshTimer = setInterval(() => refreshForegroundControl(control, config), 100);
	controlRefreshTimer.unref?.();
	const nestedProjectionTimer = data.inheritedNestedRoute
		? setInterval(() => {
				refreshForegroundControl(control, config);
				emitNestedLifecycle(data, config, control, control.startedAt, undefined, true);
			}, 500)
		: undefined;
	nestedProjectionTimer?.unref?.();
	emitNestedLifecycle(data, config, control, control.startedAt);
	emitUpdate({
		content: [{ type: "text", text: `${data.mode === "parallel" ? "Agents" : "Agent"} running in foreground.` }],
		details: { mode: data.mode, runId: data.runId, results: [], context: data.contextSummary },
	});
	let result: AgentToolResult<Details>;
	let abortedBeforeStart = false;
	try {
		result = await engines.foreground(config, signal);
		if (result.details.results.length === 0 && directoryClaim.abortIfUnstarted()) {
			abortedBeforeStart = true;
		}
	} catch (error) {
		if (!directoryClaim.abortIfUnstarted()) throw error;
		abortedBeforeStart = true;
		result = errorResult(data.mode, error instanceof Error ? error.message : String(error), {
			runId: data.runId,
			cwd: data.effectiveCwd,
		});
	} finally {
		clearInterval(controlRefreshTimer);
		if (nestedProjectionTimer) clearInterval(nestedProjectionTimer);
		refreshForegroundControl(control, config);
		deps.state.foregroundControls.delete(data.runId);
		if (deps.state.lastForegroundControlId === data.runId) deps.state.lastForegroundControlId = null;
	}
	if (abortedBeforeStart) {
		emitNestedLifecycle(data, config, control, control.startedAt, result);
		emitUpdate(result);
		return result;
	}
	rememberForegroundResult(deps.state, data, result, control.startedAt, config.asyncDir);
	emitNestedLifecycle(data, config, control, control.startedAt, result);
	for (const [index, child] of result.details.results.entries()) {
		if (child.detached) continue;
		try {
			deps.pi.events.emit(SUBAGENT_FOREGROUND_COMPLETE_EVENT, {
				id: `${data.runId}:${index}`,
				runId: data.runId,
				source: "foreground",
				mode: data.mode,
				agent: child.agent,
				success: child.exitCode === 0,
				summary: child.finalOutput || child.error || "(no report)",
				exitCode: child.exitCode,
				state: child.stopped
					? "stopped"
					: child.interrupted
						? "paused"
						: child.exitCode === 0
							? "complete"
							: "failed",
				timestamp: Date.now(),
				cwd: data.effectiveCwd,
				sessionFile: child.sessionFile,
				sessionId: data.currentSessionId,
				taskIndex: index,
			});
		} catch (error) {
			console.error(`Foreground Agent completion observer failed for '${data.runId}:${index}':`, error);
		}
	}
	emitUpdate(result);
	return result;
}

function resolveCurrentAsyncJob(state: SubagentState, requested: string) {
	const candidates = [...state.asyncJobs.values()].filter(
		(job) =>
			(!state.currentSessionId || job.sessionId === state.currentSessionId) && job.asyncId.startsWith(requested),
	);
	const exact = candidates.find((job) => job.asyncId === requested);
	if (exact) return exact;
	if (candidates.length > 1)
		throw new Error(`Agent id '${requested}' is ambiguous: ${candidates.map((job) => job.asyncId).join(", ")}.`);
	return candidates[0];
}

function stopRun(params: SubagentParamsLike, deps: ExecutorDeps): AgentToolResult<Details> {
	if (!params.id) return errorResult("management", "action='stop' requires id.");
	let job: ReturnType<typeof resolveCurrentAsyncJob>;
	try {
		job = resolveCurrentAsyncJob(deps.state, params.id);
	} catch (error) {
		return errorResult("management", error instanceof Error ? error.message : String(error));
	}
	if (!job) return errorResult("management", `Agent '${params.id}' is not running in the current session.`);
	const status = reconcileAsyncRun(job.asyncDir, { kill: deps.kill }).status;
	if (!status || (status.state !== "running" && status.state !== "queued")) {
		return errorResult("management", `Agent '${job.asyncId}' is no longer running.`);
	}
	const steps = status.steps ?? [];
	if (params.index !== undefined && !steps[params.index]) {
		return errorResult(
			"management",
			`Agent '${job.asyncId}' has ${steps.length} children. Index ${params.index} is out of range.`,
		);
	}
	if (
		params.index !== undefined &&
		steps[params.index]?.status !== "running" &&
		steps[params.index]?.status !== "pending"
	) {
		return errorResult("management", `Agent '${job.asyncId}' child ${params.index} is no longer running.`);
	}
	try {
		deliverStopRequest({
			asyncDir: job.asyncDir,
			pid: typeof status.pid === "number" ? status.pid : undefined,
			kill: deps.kill,
			source: "agent-stop",
			...(params.index !== undefined ? { targetIndex: params.index } : {}),
		});
		return {
			content: [
				{
					type: "text",
					text:
						params.index === undefined
							? `Stop requested for Agent ${job.asyncId}.`
							: `Stop requested for Agent ${job.asyncId} child ${params.index}.`,
				},
			],
			details: { mode: "management", results: [] },
		};
	} catch (error) {
		return errorResult(
			"management",
			`Failed to stop Agent ${job.asyncId}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function foregroundResumeTarget(params: SubagentParamsLike, state: SubagentState, resolvedRunId: string) {
	const run = [...(state.foregroundRuns?.values() ?? [])].find(
		(candidate) => candidate.sessionId === state.currentSessionId && candidate.runId === resolvedRunId,
	);
	if (!run) return undefined;
	if (run.children.length > 1 && params.index === undefined) {
		throw new Error(`Agent '${run.runId}' has ${run.children.length} children. Provide index.`);
	}
	const index = params.index ?? 0;
	const child = run.children[index];
	if (!child) throw new Error(`Agent '${run.runId}' child ${index} does not exist.`);
	if (child.status === "stopped") {
		throw new Error(`Agent '${run.runId}' child ${index} was stopped by the user and cannot be resumed.`);
	}
	if (!child.sessionFile) {
		throw new Error(`Agent '${run.runId}' child ${index} has no persisted session to resume.`);
	}
	if (path.extname(child.sessionFile) !== ".jsonl") {
		throw new Error(`Agent '${run.runId}' child ${index} session must be a .jsonl file.`);
	}
	let sessionFile: string;
	try {
		sessionFile = validateOwnedRegularFile(child.sessionFile);
	} catch (error) {
		throw new Error(`Agent '${run.runId}' child ${index} has no safe persisted session to resume.`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
	const recoveryDescriptor = run.asyncDir ? readAsyncRecoveryDescriptor(run.asyncDir, index) : undefined;
	return {
		kind: "revive" as const,
		runId: run.runId,
		agent: child.agent,
		index,
		cwd: child.cwd ?? run.cwd,
		sessionFile,
		model: child.model,
		thinking: child.thinking,
		context: child.context,
		launchContractDigest: child.launchContractDigest,
		capabilityCeiling: child.capabilityCeiling,
		...(recoveryDescriptor ? { recoveryDescriptor } : {}),
	};
}

/** Resolve a public resume prefix before the governor reserves its logical Agent. */
export function resolveResumeTargetRunId(
	params: { readonly action?: string; readonly id?: string },
	state: SubagentState,
): string | undefined {
	if (params.action !== "resume" || !params.id) return undefined;
	const requested = params.id;
	const foreground = [...(state.foregroundRuns?.values() ?? [])].filter(
		(run) => run.sessionId === state.currentSessionId && run.runId.startsWith(requested),
	);
	const async = findAsyncRunPrefixMatches(
		requested,
		ASYNC_DIR,
		RESULTS_DIR,
		state.currentSessionScope ?? state.currentSessionId ?? undefined,
	);
	const candidates = [
		...foreground.map((run) => ({ id: run.runId, source: "foreground" as const })),
		...async.map((match) => ({ id: match.id, source: "background" as const })),
	];
	const exact = candidates.filter((candidate) => candidate.id === requested);
	if (exact.length === 1) return requested;
	if (exact.length > 1) {
		throw new Error(
			`Agent id '${requested}' exists in both foreground and background history; provide it through /agents.`,
		);
	}
	const uniqueIds = [...new Set(candidates.map((candidate) => candidate.id))];
	if (uniqueIds.length > 1) {
		throw new Error(`Agent id '${requested}' is ambiguous: ${uniqueIds.join(", ")}.`);
	}
	return uniqueIds[0] ?? requested;
}

async function resumeRun(input: {
	params: SubagentParamsLike;
	ctx: ExtensionContext;
	deps: ExecutorDeps;
	engines: ExecutorEngines;
	parentModel?: ParentModel;
	absoluteDeadlineAt?: number;
}): Promise<AgentToolResult<Details>> {
	if (!input.params.id) return errorResult("management", "action='resume' requires id.");
	const followUp = input.params.message?.trim() || "Continue the previous task and report the current result.";
	let target: ReturnType<typeof foregroundResumeTarget> | ReturnType<typeof resolveAsyncResumeTarget>;
	try {
		const resolvedRunId = resolveResumeTargetRunId({ action: "resume", id: input.params.id }, input.deps.state);
		if (!resolvedRunId) throw new Error("Agent resume target could not be resolved.");
		target =
			foregroundResumeTarget(input.params, input.deps.state, resolvedRunId) ??
			resolveAsyncResumeTarget(
				{ id: resolvedRunId, index: input.params.index },
				{ kill: input.deps.kill },
				{
					requireSessionFile: true,
					...(input.deps.state.currentSessionScope
						? { sessionScope: input.deps.state.currentSessionScope }
						: { sessionId: input.deps.state.currentSessionId ?? undefined }),
				},
			);
	} catch (error) {
		return errorResult("management", error instanceof Error ? error.message : String(error));
	}
	if (target.kind === "live") {
		return errorResult("management", `Agent '${target.runId}' is still running; use action='steer'.`);
	}
	if (!target.sessionFile)
		return errorResult("management", `Agent '${target.runId}' has no persisted session to resume.`);

	const depth = checkSubagentDepth(input.deps.config.maxSubagentDepth);
	if (depth.blocked)
		return errorResult("management", `Agent resume blocked at maximum nesting depth ${depth.maxDepth}.`);
	const effectiveCwd = target.cwd ?? input.ctx.cwd;
	const discovered = input.deps.discoverAgents(effectiveCwd, "both");
	const descriptor = "recoveryDescriptor" in target ? target.recoveryDescriptor : undefined;
	const discoveredAgent = discovered.agents.find((agent) => agent.name === target.agent);
	const baseAgent =
		discoveredAgent ??
		(descriptor
			? {
					name: descriptor.agent,
					description: "Persisted Agent",
					systemPrompt: "",
					systemPromptMode: descriptor.systemPromptMode,
					inheritProjectContext: descriptor.inheritProjectContext,
					inheritSkills: descriptor.inheritSkills,
					source: "project" as const,
					filePath: descriptor.agentFilePath ?? path.join(effectiveCwd, ".pi-stuff-agent-recovery"),
				}
			: undefined);
	if (!baseAgent) return errorResult("management", `Unknown Agent for resume: ${target.agent}`);
	const agent = descriptor ? applySteeringRecoveryAgentConfig(baseAgent, descriptor) : baseAgent;
	const turn = resolveTurnBudgetConfig(input.params.turnBudget ?? descriptor?.initialTurnBudget, "turnBudget");
	if (turn.error) return errorResult("management", turn.error);
	const tool = validateToolBudgetConfig(input.params.toolBudget ?? descriptor?.initialToolBudget, "toolBudget");
	if (tool.error) return errorResult("management", tool.error);
	const timeout = resolveTimeout(input.params.timeoutMs);
	if (timeout.error) return errorResult("management", timeout.error);

	const runId = randomUUID().replace(/-/g, "").slice(0, 12);
	const parentSessionFile = input.ctx.sessionManager.getSessionFile() ?? null;
	const artifactConfig: ArtifactConfig = {
		...DEFAULT_ARTIFACT_CONFIG,
		dir: input.deps.config.artifactDir ?? DEFAULT_ARTIFACT_CONFIG.dir,
	};
	const currentSessionId = input.deps.state.currentSessionId;
	if (!currentSessionId) return errorResult("management", "Current session identity is unavailable.");
	// A revived top-level Agent is a new lifecycle owner and needs a route for
	// any descendants it launches. A nested revival keeps its inherited route;
	// executeAsyncSingle derives nestedSelf from that same environment.
	const inheritedNestedRoute = resolveInheritedNestedRouteFromEnv();
	const nestedRoute = inheritedNestedRoute ?? createNestedRoute(runId);
	let backgroundOwnsRoute = false;
	try {
		const result = await input.engines.backgroundSingle(runId, {
			agent: target.agent,
			description: resolveDisplayDescription(undefined, followUp),
			task: buildRevivedAsyncTask(target as Parameters<typeof buildRevivedAsyncTask>[0], followUp),
			goal: followUp,
			agentConfig: agent,
			ctx: {
				pi: input.deps.pi,
				cwd: input.ctx.cwd,
				currentSessionId,
				governorSessionId: process.env[SUBAGENT_PARENT_SESSION_ENV]?.trim() || currentSessionId,
				physicalSessionId: currentSessionId,
				parentSessionId: input.ctx.sessionManager.getSessionId() ?? undefined,
				currentModelProvider: input.parentModel?.provider,
				currentModel: input.parentModel,
				modelScope: discovered.modelScope,
				interactive: input.ctx.hasUI,
			},
			cwd: effectiveCwd,
			artifactsDir: getArtifactsDir(parentSessionFile, effectiveCwd, artifactConfig.dir),
			artifactConfig,
			nestedRoute,
			sessionRoot: input.deps.getSubagentSessionRoot(parentSessionFile),
			sessionFile: target.sessionFile,
			revivalLease: {
				sessionFile: target.sessionFile,
				runId,
				sourceRunId: target.runId,
				parentSessionId: input.deps.state.currentSessionId ?? undefined,
			},
			modelOverride: descriptor?.model ?? target.model,
			thinkingOverride: descriptor?.thinking ?? target.thinking,
			logicalSourceRunId: descriptor?.sourceRunId ?? target.runId,
			logicalChildIndex: descriptor?.version === 2 ? descriptor.childIndex : target.index,
			maxSubagentDepth:
				descriptor?.maxSubagentDepth ?? resolveCurrentMaxSubagentDepth(input.deps.config.maxSubagentDepth),
			availableModels: availableModels(input.ctx),
			...(timeout.timeoutMs !== undefined ? { timeoutMs: timeout.timeoutMs } : {}),
			...(input.absoluteDeadlineAt !== undefined ? { absoluteDeadlineAt: input.absoluteDeadlineAt } : {}),
			...(turn.turnBudget ? { turnBudget: turn.turnBudget } : {}),
			...(tool.budget ? { toolBudget: tool.budget } : {}),
			capabilityCeiling: intersectSubagentCapabilityCeilings(
				target.capabilityCeiling,
				descriptor?.capabilityCeiling,
				resolveCurrentSubagentCapabilityCeiling(input.deps.state.currentSessionId ?? undefined),
			),
		});
		backgroundOwnsRoute = Boolean(result.details.asyncId);
		if (resultIsError(result)) return result;
		const revivedId = result.details.asyncId ?? runId;
		return {
			content: [{ type: "text", text: `Agent ${target.agent} resumed from ${target.runId} as ${revivedId}.` }],
			details: {
				...result.details,
				...(target.launchContractDigest ? { sourceLaunchContractDigest: target.launchContractDigest } : {}),
			},
		};
	} finally {
		if (!inheritedNestedRoute && !backgroundOwnsRoute) {
			try {
				await retireUnusedNestedRoute(nestedRoute);
			} catch {
				// Preserve any route that acquired real nested lifecycle evidence.
			}
		}
	}
}

async function controlAction(
	params: SubagentParamsLike,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
	engines: ExecutorEngines,
	signal: AbortSignal,
): Promise<AgentToolResult<Details>> {
	const validationError = validateControlInput(params);
	if (validationError) return errorResult("management", validationError);
	let currentSessionId: string;
	try {
		currentSessionId =
			deps.state.currentSessionId ??
			process.env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV]?.trim() ??
			resolveCurrentSessionId(ctx.sessionManager, ctx.cwd);
	} catch (error) {
		return errorResult("management", error instanceof Error ? error.message : String(error));
	}
	const parentModel = rememberParentModel(deps.state, currentSessionId, ctx.model);
	if (params.action === "status") {
		return inspectSubagentStatus({ action: "status", id: params.id, index: params.index }, { state: deps.state });
	}
	if (params.action === "stop") return stopRun(params, deps);
	if (params.action === "resume") return resumeRun({ params, ctx, deps, engines, parentModel });
	if (params.action === "steer") {
		if (!params.id || !params.message) return errorResult("management", "action='steer' requires id and message.");
		let job: ReturnType<typeof resolveCurrentAsyncJob>;
		try {
			job = resolveCurrentAsyncJob(deps.state, params.id);
		} catch (error) {
			return errorResult("management", error instanceof Error ? error.message : String(error));
		}
		if (!job) return errorResult("management", `Agent '${params.id}' is not running in the current session.`);
		return steerRun(job, params.message.trim(), params.index, deps, signal);
	}
	return errorResult("management", "Unknown Agent action. Valid actions: status, steer, stop, resume.");
}

async function steerRun(
	job: NonNullable<ReturnType<typeof resolveCurrentAsyncJob>>,
	message: string,
	index: number | undefined,
	deps: ExecutorDeps,
	signal: AbortSignal,
): Promise<AgentToolResult<Details>> {
	const status = reconcileAsyncRun(job.asyncDir, { kill: deps.kill }).status;
	if (!status || (status.state !== "running" && status.state !== "queued")) {
		return errorResult("management", `Agent '${job.asyncId}' is no longer running.`);
	}
	if (
		deps.state.currentSessionId &&
		!sessionArtifactMatches(deps.state.currentSessionScope, status.sessionId, status.runId) &&
		status.sessionId !== deps.state.currentSessionId
	) {
		return errorResult("management", `Agent '${job.asyncId}' is not in the current session.`);
	}
	const steps = status.steps ?? [];
	if (index !== undefined && (index >= steps.length || !steps[index])) {
		return errorResult(
			"management",
			`Agent '${job.asyncId}' has ${steps.length} children. Index ${index} is out of range.`,
		);
	}
	const targetIndexes =
		index !== undefined
			? [index]
			: steps
					.map((step, childIndex) =>
						step.status === "running" || step.status === "pending" ? childIndex : undefined,
					)
					.filter((childIndex): childIndex is number => childIndex !== undefined);
	if (targetIndexes.length === 0) {
		return errorResult("management", `Agent '${job.asyncId}' has no running child to steer.`);
	}
	const requestId = randomUUID();
	try {
		requestAsyncSteer(job.asyncDir, {
			id: requestId,
			message,
			...(index !== undefined ? { targetIndex: index } : { targetIndexes }),
			source: "agent-steer",
		});
	} catch (error) {
		return errorResult(
			"management",
			`Failed to steer Agent ${job.asyncId}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const waited = await waitForSteeringAction({
		asyncDir: job.asyncDir,
		sourceRunId: job.asyncId,
		requestId,
		timeoutMs: 3_000,
		signal,
	});
	const fallbackTargets = targetIndexes.map((childIndex) => ({
		index: childIndex,
		state: steps[childIndex]?.status === "pending" ? ("scheduled" as const) : ("routed" as const),
	}));
	const steering = waited ?? {
		requestId,
		state: fallbackTargets.every((target) => target.state === "scheduled")
			? ("scheduled" as const)
			: ("pending" as const),
		sourceRunId: job.asyncId,
		targets: fallbackTargets,
	};
	const failed = steering.state === "failed" || steering.state === "partial";
	const label =
		steering.state === "delivered"
			? "delivered"
			: steering.state === "scheduled"
				? "scheduled"
				: steering.state === "pending"
					? "pending acknowledgment"
					: steering.state;
	return {
		content: [{ type: "text", text: `Steering ${label} for Agent ${job.asyncId} (request ${requestId}).` }],
		...(failed ? { isError: true } : {}),
		details: { mode: "management", results: [], steering },
	};
}

function duplicateForegroundResult(params: SubagentParamsLike): AgentToolResult<Details> {
	return errorResult(
		requestedMode(params),
		"A foreground Agent call is already active. Start another only after it finishes.",
	);
}

export function createSubagentExecutor(deps: ExecutorDeps): {
	execute(
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
		hooks?: SubagentExecutionHooks,
	): Promise<AgentToolResult<Details>>;
} {
	const engines: ExecutorEngines = { ...DEFAULT_ENGINES, ...deps.engines };
	const execute = async (
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
		hooks?: SubagentExecutionHooks,
	): Promise<AgentToolResult<Details>> => {
		deps.state.baseCwd = ctx.cwd;
		deps.state.foregroundRuns ??= new Map();
		deps.state.foregroundControls ??= new Map();
		deps.state.lastForegroundControlId ??= null;
		if (params.action && deps.allowMutatingManagementActions === false) {
			return errorResult("management", "Agent management actions are unavailable inside a nested Agent owner.");
		}
		if (params.action) return controlAction(params, ctx, deps, engines, signal);

		const foreground = (params.async ?? deps.asyncByDefault) !== true;
		if (foreground && deps.state.subagentInProgress) return duplicateForegroundResult(params);
		if (foreground) deps.state.subagentInProgress = true;
		let ownedNestedRoute: PreparedLaunch["nestedRoute"] | undefined;
		let backgroundOwnsRoute = false;
		let foregroundLifecycleOwnsRoute = false;
		try {
			const prepared = prepareLaunch(id, params, ctx, deps);
			if ("content" in prepared) return prepared;
			if (!prepared.inheritedNestedRoute) ownedNestedRoute = prepared.nestedRoute;
			await attachContextProjection(prepared, ctx, deps.projectContext);
			let result: AgentToolResult<Details>;
			if (foreground) {
				result = await launchForeground(prepared, ctx, deps, engines, signal, onUpdate, hooks, () => {
					foregroundLifecycleOwnsRoute = true;
				});
				// A foreground adapter may return detached children after losing its
				// owner while their writer liveness is still unknown. Their durable
				// runtime remains authoritative until the tracker terminalizes it.
				foregroundLifecycleOwnsRoute = result.details.results.some((child) => child.detached === true);
			} else {
				result = await launchBackground(prepared, ctx, deps, engines);
			}
			backgroundOwnsRoute = !foreground && Boolean(result.details.asyncId);
			return result;
		} catch (error) {
			return errorResult(requestedMode(params), error instanceof Error ? error.message : String(error));
		} finally {
			if (ownedNestedRoute && !backgroundOwnsRoute && !foregroundLifecycleOwnsRoute) {
				try {
					await retireUnusedNestedRoute(ownedNestedRoute);
				} catch {
					// A committed runner retires its route after durable terminalization.
				}
			}
			if (foreground) deps.state.subagentInProgress = false;
		}
	};
	return { execute };
}
