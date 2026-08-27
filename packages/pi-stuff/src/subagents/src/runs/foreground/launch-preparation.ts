import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	type ContextEvent,
	type ExtensionAPI,
	type ExtensionContext,
	estimateTokens,
	formatSkillsForPrompt,
	getAgentDir,
	loadProjectContextFiles,
	loadSkills,
	type SessionEntry,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import type { projectCurrentContext } from "../../../../context-management/index.js";
import { isRuntimeFunction, isRuntimeNumber } from "../../../../shared/runtime-type.js";
import type { AgentConfig } from "../../agents/agents.ts";
import { normalizeSkillInput } from "../../agents/skills.ts";
import { getArtifactsDir } from "../../shared/artifacts.ts";
import { createForkContextResolver, forkedChildRequiresThinkingOff } from "../../shared/fork-context.ts";
import { findModelInfo, type ModelInfo, toModelInfo } from "../../shared/model-info.ts";
import { resolveCurrentSessionId } from "../../shared/session-identity.ts";
import {
	type ArtifactConfig,
	checkSubagentDepth,
	DEFAULT_ARTIFACT_CONFIG,
	type Details,
	type ResolvedToolBudget,
	type ResolvedTurnBudget,
	resolveCurrentMaxSubagentDepth,
	wrapForkTask,
} from "../../shared/types.ts";
import { type AsyncParallelTaskInput, buildResolvedTask } from "../background/async-execution.ts";
import { resolveCurrentSubagentCapabilityCeiling } from "../shared/capability-ceiling.ts";
import type { ContextMode } from "../shared/context-mode.ts";
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
} from "../shared/nested-events.ts";
import type { RunnerAgentTask } from "../shared/parallel-utils.ts";
import {
	resolvePiLaunchToolPlan,
	SUBAGENT_PARENT_PHYSICAL_SESSION_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../shared/pi-args.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { resolveTurnBudgetConfig } from "../shared/turn-budget.ts";
import {
	type AgentToolResult,
	type ExecutorDeps,
	errorResult,
	type LaunchIdentityScope,
	type PreparedLaunch,
	type SubagentParamsLike,
	type TaskParam,
} from "./executor-contract.ts";

/** Stable launch identity shared by the public tool, storage, and session-wide governor. */
export function deriveLaunchRunId(toolCallId: string, scope?: LaunchIdentityScope): string {
	const hash = createHash("sha256");
	if (scope) hash.update(JSON.stringify([scope.sessionId, scope.ownerAgentPath]));
	hash.update("\0").update(toolCallId);
	return hash.digest("hex").slice(0, 12);
}

const CHILD_RUNTIME_RESERVE_RATIO = 0.25;
export const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1_000;
const CHILD_TOOL_REQUEST_FRAMING_TOKENS = 512;
const CHILD_UNKNOWN_TOOL_SURFACE_TOKENS = 32 * 1024;
const CHILD_EXPLICIT_EXTENSION_SURFACE_TOKENS = 16 * 1024;
const CHILD_RUNTIME_EXTENSION_SURFACE_TOKENS = 4 * 1024;

function requestedMode(params: SubagentParamsLike): "single" | "parallel" {
	return params.tasks?.length ? "parallel" : "single";
}

export function availableModels(ctx: ExtensionContext): ModelInfo[] {
	try {
		return ctx.modelRegistry.getAvailable().map(toModelInfo);
	} catch {
		return [];
	}
}

function estimateTextTokens(text: string): number {
	// Byte-level BPE and SentencePiece-family tokenizers cannot emit more tokens
	// than the UTF-8 bytes they consume. Use that strict cross-provider upper bound
	// instead of Pi's intentionally rough chars/4 estimate; the latter undercounts
	// astral CJK, emoji, Base64, hashes, and other high-entropy input.
	return Buffer.byteLength(text, "utf8");
}

function estimateContextMessageTokens(message: ContextEvent["messages"][number]): number {
	let piEstimate = 0;
	try {
		piEstimate = estimateTokens(message);
	} catch {
		// The serialized conservative estimate below remains available.
	}
	let serializedEstimate = Number.POSITIVE_INFINITY;
	try {
		const serialized = JSON.stringify(message);
		if (serialized !== undefined) serializedEstimate = estimateTextTokens(serialized);
	} catch {
		// A message that cannot be serialized must never be admitted as a raw fork.
	}
	return Math.max(piEstimate, serializedEstimate);
}

function inheritedContextSnapshot(ctx: ExtensionContext) {
	let effective: number | undefined;
	try {
		const value = ctx.getContextUsage()?.tokens;
		if (isRuntimeNumber(value) && Number.isFinite(value) && value >= 0) effective = value;
	} catch {
		// Continue with the persisted branch estimator.
	}
	try {
		const entries: SessionEntry[] = [...ctx.sessionManager.buildContextEntries()];
		const persistedMessages = entries.flatMap((entry) => sessionEntryToContextMessages(entry));
		const messages = entries
			.filter(
				(entry) =>
					entry.type !== "message" || entry.message.role !== "assistant" || entry.message.stopReason !== "pending",
			)
			.flatMap((entry) => sessionEntryToContextMessages(entry));
		const persisted = persistedMessages.reduce((total, message) => total + estimateContextMessageTokens(message), 0);
		// A native fork clones persisted branch entries, not the post-transform
		// prompt reported by getContextUsage(). Magic Context can make the latter
		// much smaller, so use the conservative larger estimate.
		return { messages: [...messages], tokens: Math.max(effective ?? 0, persisted) };
	} catch {
		// If the persisted branch cannot be measured, the live usage may be a
		// much smaller Magic-transformed prompt. Force the bounded projection path
		// instead of risking an oversized native clone.
		return { tokens: Number.POSITIVE_INFINITY };
	}
}

function inheritedLaunchPromptTokens(ctx: ExtensionContext): number {
	let promptTokens = 0;
	try {
		promptTokens = estimateTextTokens(ctx.getSystemPrompt());
	} catch {
		// Older compatible Hosts or focused tests may not expose this optional seam.
	}
	try {
		const getOptions =
			"getSystemPromptOptions" in ctx && isRuntimeFunction(ctx.getSystemPromptOptions)
				? ctx.getSystemPromptOptions
				: undefined;
		const options = getOptions?.call(ctx);
		const serialized = JSON.stringify(options);
		if (serialized !== undefined) promptTokens = Math.max(promptTokens, estimateTextTokens(serialized));
	} catch {
		// The proportional runtime reserve still covers the unknown Host surface.
	}
	return promptTokens;
}

function inheritedReplacementPromptTokens(
	task: Pick<RunnerAgentTask, "cwd" | "inheritProjectContext" | "inheritSkills">,
) {
	try {
		let retained = "";
		if (task.inheritProjectContext) {
			const contextFiles = loadProjectContextFiles({ cwd: task.cwd, agentDir: getAgentDir() });
			if (contextFiles.length > 0) {
				retained += "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
				for (const contextFile of contextFiles) {
					retained += `<project_instructions path="${contextFile.path}">\n${contextFile.content}\n</project_instructions>\n\n`;
				}
				retained += "</project_context>\n";
			}
		}
		if (task.inheritSkills) {
			const skills = loadSkills({
				cwd: task.cwd,
				agentDir: getAgentDir(),
				skillPaths: [],
				includeDefaults: true,
			}).skills;
			if (skills.length > 0) retained += formatSkillsForPrompt(skills);
		}
		retained += `\nCurrent working directory: ${task.cwd.replace(/\\/gu, "/")}`;
		return {
			tokens: estimateTextTokens(retained),
			// ExtensionContext deliberately does not expose the command-only Host
			// construction options. When replacement mode retains any ambient
			// resources, use a bounded projection and let the final payload gate cover
			// package-provided resources that cannot be inspected at this seam.
			rawForkSafe: !task.inheritProjectContext && !task.inheritSkills,
		};
	} catch {
		// Resource discovery failure must not admit an unmeasured child payload.
	}
	if (!task.inheritProjectContext && !task.inheritSkills) {
		return { tokens: estimateTextTokens(task.cwd), rawForkSafe: true };
	}
	return { tokens: Number.POSITIVE_INFINITY, rawForkSafe: false };
}

function childLaunchSurfaceTokens(pi: ExtensionAPI, task: RunnerAgentTask): number {
	if (!isRuntimeFunction(pi.getAllTools) || !isRuntimeFunction(pi.getActiveTools)) return 0;
	try {
		const plan = resolvePiLaunchToolPlan({
			tools: task.tools,
			extensions: task.extensions,
			subagentOnlyExtensions: task.subagentOnlyExtensions,
			mcpDirectTools: task.mcpDirectTools,
			cwd: task.cwd,
			childBaseExtensionPath: task.childBaseExtensionPath,
			requireReadTool: task.inheritSkills || Boolean(task.skills?.length),
			capabilityCeiling: task.capabilityCeiling,
		});
		const requestedNames = [
			...new Set(
				plan.explicitToolAllowlist ? plan.effectiveToolAllowlist : [...pi.getActiveTools(), ...plan.internalTools],
			),
		];
		const configured = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
		let tokens = CHILD_RUNTIME_EXTENSION_SURFACE_TOKENS;
		for (const name of requestedNames) {
			const tool = configured.get(name);
			if (!tool) {
				tokens += CHILD_UNKNOWN_TOOL_SURFACE_TOKENS;
				continue;
			}
			try {
				// JSON omits executable callbacks while retaining every current and
				// future serializable prompt/schema field (including prompt guidelines).
				tokens += estimateTextTokens(JSON.stringify(tool));
			} catch {
				tokens += CHILD_UNKNOWN_TOOL_SURFACE_TOKENS;
			}
			tokens += CHILD_TOOL_REQUEST_FRAMING_TOKENS;
		}
		tokens += plan.configuredExtensions.length * CHILD_EXPLICIT_EXTENSION_SURFACE_TOKENS;
		tokens += estimateTextTokens(
			JSON.stringify({
				extensions: plan.extensionArgs,
				mcpTools: plan.effectiveMcpTools,
				inheritProjectContext: task.inheritProjectContext,
				inheritSkills: task.inheritSkills,
			}),
		);
		return tokens;
	} catch {
		// If the real Host surface exists but cannot be inspected or resolved, do
		// not pretend the missing child-only tools are free.
		return CHILD_UNKNOWN_TOOL_SURFACE_TOKENS;
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
			const reserve = Math.floor(model.contextWindow * CHILD_RUNTIME_RESERVE_RATIO);
			launchBudget = Math.min(launchBudget, model.contextWindow - model.maxTokens - reserve - knownTokens);
		}
	}
	return Number.isFinite(launchBudget) ? Math.max(0, Math.floor(launchBudget)) : 0;
}

function forkInputCapacity(model: ModelInfo): number | undefined {
	if (
		!isRuntimeNumber(model.contextWindow) ||
		!Number.isFinite(model.contextWindow) ||
		model.contextWindow <= 0 ||
		!isRuntimeNumber(model.maxTokens) ||
		!Number.isFinite(model.maxTokens) ||
		model.maxTokens <= 0
	)
		return undefined;
	const runtimeReserve = Math.floor(model.contextWindow * CHILD_RUNTIME_RESERVE_RATIO);
	return Math.max(0, Math.floor(model.contextWindow - model.maxTokens - runtimeReserve));
}

function approximateTokens(tokens: number): string {
	if (!Number.isFinite(tokens)) return "an unmeasurable number of";
	return tokens >= 1_000 ? `about ${Math.ceil(tokens / 1_000).toLocaleString("en-US")}k` : String(Math.ceil(tokens));
}

interface LaunchModelPlanInput {
	runId: string;
	params: SubagentParamsLike;
	agents: readonly AgentConfig[];
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	context: ContextMode;
	effectiveCwd: string;
	currentSessionId: string;
	governorSessionId: string;
	directParentSessionId?: string | undefined;
	parentModel?: ParentModel | undefined;
	availableModels: ModelInfo[];
	modelScope?: import("../shared/model-scope.ts").ModelScopeConfig | undefined;
	turnBudget?: ResolvedTurnBudget | undefined;
	toolBudget?: ResolvedToolBudget | undefined;
	configToolBudget?: ResolvedToolBudget | undefined;
	capabilityCeiling?: ReturnType<typeof resolveCurrentSubagentCapabilityCeiling> | undefined;
	maxSubagentDepth: number;
	childBaseExtensionPath?: string | undefined;
}

interface TaskModelPlanState {
	readonly input: LaunchModelPlanInput;
	readonly taskCount: number;
	readonly forkTokens: number;
	readonly launchPromptTokens: number;
	readonly fixedInputTokensByIndex: number[];
	readonly rawForkByIndex: boolean[];
}

function planTaskModels(state: TaskModelPlanState, task: TaskParam, index: number): string[] | undefined {
	const { input } = state;
	const agent = input.agents.find((candidate) => candidate.name === task.agent);
	if (!agent) throw new Error(`Unknown Agent: ${task.agent}`);
	const normalizedSkill = normalizeSkillInput(task.skill);
	const taskInput: AsyncParallelTaskInput = {
		agent: task.agent,
		task: input.context === "fork" ? wrapForkTask(task.task) : task.task,
	};
	if (task.description) taskInput.description = task.description;
	if (task.cwd) taskInput.cwd = task.cwd;
	if (task.model) taskInput.model = task.model;
	if (normalizedSkill !== undefined) taskInput.skill = normalizedSkill;
	if (task.turnBudget) taskInput.turnBudget = task.turnBudget;
	if (task.toolBudget) taskInput.toolBudget = task.toolBudget;
	const buildInput: Parameters<typeof buildResolvedTask>[0] = {
		runId: input.runId,
		index,
		taskInput,
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
			childBaseExtensionPath: input.childBaseExtensionPath,
		},
		runnerCwd: input.effectiveCwd,
		context: input.context,
		thinkingOverride: input.params.thinking,
	};
	if (normalizedSkill === false) buildInput.skills = [];
	const built = buildResolvedTask(buildInput);
	if ("error" in built) throw new Error(built.error);
	const candidates = built.task.modelCandidates ?? [];
	const replacementPromptEstimate =
		built.task.systemPromptMode === "replace"
			? inheritedReplacementPromptTokens(built.task)
			: { tokens: state.launchPromptTokens, rawForkSafe: true };
	const taskTokens =
		estimateTextTokens(built.task.task) +
		estimateTextTokens(built.task.systemPrompt?.trim() ?? "") +
		replacementPromptEstimate.tokens +
		childLaunchSurfaceTokens(input.pi, built.task);
	state.fixedInputTokensByIndex[index] = taskTokens;
	if (input.context !== "fork") {
		state.rawForkByIndex[index] = false;
		return candidates.length > 0 ? candidates : undefined;
	}
	const projectedCandidates = candidates.filter((candidate) => {
		const model = findModelInfo(candidate, input.availableModels, input.parentModel?.provider);
		const capacity = model ? forkInputCapacity(model) : undefined;
		return capacity !== undefined && taskTokens <= capacity;
	});
	const allCandidatesFitRaw =
		replacementPromptEstimate.rawForkSafe &&
		candidates.length > 0 &&
		projectedCandidates.length === candidates.length &&
		candidates.every((candidate) => {
			const model = findModelInfo(candidate, input.availableModels, input.parentModel?.provider);
			const capacity = model ? forkInputCapacity(model) : undefined;
			return capacity !== undefined && state.forkTokens + taskTokens <= capacity;
		});
	if (allCandidatesFitRaw) {
		state.rawForkByIndex[index] = true;
		return candidates;
	}
	if (projectedCandidates.length > 0) {
		state.rawForkByIndex[index] = false;
		return projectedCandidates;
	}
	const capacities = candidates
		.map((candidate) => {
			const model = findModelInfo(candidate, input.availableModels, input.parentModel?.provider);
			const capacity = model ? forkInputCapacity(model) : undefined;
			return `${candidate}: ${capacity === undefined ? "limits unavailable" : `${approximateTokens(capacity)} input tokens`}`;
		})
		.join(", ");
	const taskLabel = state.taskCount > 1 ? ` task ${index + 1} (${task.agent})` : ` Agent '${task.agent}'`;
	throw new Error(
		`Cannot start forked${taskLabel}: the fixed child instruction requires ${approximateTokens(
			taskTokens,
		)} input tokens before any bounded parent projection, but no candidate model has safe capacity${capacities ? ` (${capacities})` : ""}. ` +
			"Shorten the task or choose a model with a larger context window.",
	);
}

function prepareLaunchModelPlan(input: LaunchModelPlanInput) {
	const tasks = taskInputs(input.params);
	const forkSnapshot: { readonly messages?: ContextEvent["messages"]; readonly tokens: number } =
		input.context === "fork" ? inheritedContextSnapshot(input.ctx) : { tokens: 0 };
	const fixedInputTokensByIndex: number[] = [];
	const rawForkByIndex: boolean[] = [];
	const state: TaskModelPlanState = {
		input,
		taskCount: tasks.length,
		forkTokens: forkSnapshot.tokens,
		launchPromptTokens: inheritedLaunchPromptTokens(input.ctx),
		fixedInputTokensByIndex,
		rawForkByIndex,
	};
	const modelCandidatesByIndex = tasks.map((task, index) => planTaskModels(state, task, index));
	const plan: Pick<PreparedLaunch, "rawForkByIndex" | "fixedInputTokensByIndex" | "modelCandidatesByIndex"> &
		Partial<Pick<PreparedLaunch, "forkContextTokens" | "forkSourceMessages">> = {
		rawForkByIndex,
		fixedInputTokensByIndex,
		modelCandidatesByIndex,
	};
	if (input.context === "fork") plan.forkContextTokens = forkSnapshot.tokens;
	if (input.context === "fork" && forkSnapshot.messages) plan.forkSourceMessages = forkSnapshot.messages;
	return plan;
}

export async function attachContextProjection(
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
		const options =
			data.context === "fork" && data.forkSourceMessages
				? { maxTokens, sourceMessages: data.forkSourceMessages }
				: { maxTokens };
		const projection = await projectContext(audience, ctx, options);
		if (projection.text) data.params.contextProjection = projection.text;
	} catch {
		// Context continuity is optional; Agent launch remains fail-open.
	}
}

export function rememberParentModel(
	state: { currentSessionId?: string | null; lastParentModel?: ParentModel },
	sessionId: string,
	model: ExtensionContext["model"],
): ParentModel | undefined {
	if (state.currentSessionId !== sessionId) delete state.lastParentModel;
	state.currentSessionId = sessionId;
	const current = normalizeParentModel(model);
	if (current) state.lastParentModel = current;
	return current ?? state.lastParentModel;
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

export function resolveTimeout(value: SubagentParamsLike["timeoutMs"]) {
	if (value === undefined) return { timeoutMs: DEFAULT_AGENT_TIMEOUT_MS };
	if (!isRuntimeNumber(value) || !Number.isInteger(value) || value <= 0) {
		return { error: "timeoutMs must be a positive integer." };
	}
	return { timeoutMs: value };
}

function contextFor(params: SubagentParamsLike): ContextMode {
	return params.context === "fork" ? "fork" : "fresh";
}

export function taskInputs(params: SubagentParamsLike): TaskParam[] {
	if (params.tasks?.length) return params.tasks;
	if (!params.agent || !params.task) return [];
	const task: TaskParam = { agent: params.agent, task: params.task };
	if (params.description) task.description = params.description;
	if (params.model) task.model = params.model;
	if (params.skill !== undefined) task.skill = params.skill;
	if (params.turnBudget) task.turnBudget = params.turnBudget;
	if (params.toolBudget) task.toolBudget = params.toolBudget;
	return [task];
}

function prepareForkSessions(input: {
	params: SubagentParamsLike;
	ctx: ExtensionContext;
	context: ContextMode;
	parentModel?: ParentModel | undefined;
	availableModels: ModelInfo[];
	modelCandidatesByIndex: Array<string[] | undefined>;
	rawForkByIndex: boolean[];
}) {
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

async function resolveLaunchPreflight(
	params: SubagentParamsLike,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
	mode: "single" | "parallel",
) {
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
	const effectiveCwd = path.resolve(ctx.cwd, params.cwd ?? ".");
	const discovered = await deps.discoverAgents(ctx.cwd, "both");
	const validationError = validateLaunchInput(params, discovered.agents);
	if (validationError) return errorResult(mode, validationError);
	return {
		currentSessionId,
		effectiveCwd,
		agents: discovered.agents,
		modelScope: discovered.modelScope,
		parentModel: rememberParentModel(deps.state, currentSessionId, ctx.model),
	};
}

function resolveLaunchBudgets(params: SubagentParamsLike, deps: ExecutorDeps) {
	const timeout = resolveTimeout(params.timeoutMs);
	if (timeout.error) return { error: timeout.error };
	const turn = resolveTurnBudgetConfig(params.turnBudget ?? deps.config.turnBudget, "turnBudget");
	if (turn.error) return { error: turn.error };
	const tool = validateToolBudgetConfig(params.toolBudget, "toolBudget");
	if (tool.error) return { error: tool.error };
	const configTool = validateToolBudgetConfig(deps.config.toolBudget, "config.toolBudget");
	if (configTool.error) return { error: configTool.error };
	return {
		timeoutMs: timeout.timeoutMs,
		turnBudget: turn.turnBudget,
		toolBudget: tool.budget,
		configToolBudget: configTool.budget,
	};
}

export async function prepareLaunch(
	id: string,
	params: SubagentParamsLike,
	ctx: ExtensionContext,
	deps: ExecutorDeps,
): Promise<PreparedLaunch | AgentToolResult<Details>> {
	const mode = requestedMode(params);
	const preflight = await resolveLaunchPreflight(params, ctx, deps, mode);
	if ("content" in preflight) return preflight;
	const { agents, currentSessionId, effectiveCwd, modelScope, parentModel } = preflight;
	const budgets = resolveLaunchBudgets(params, deps);
	if (budgets.error) return errorResult(mode, budgets.error);

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
			agents,
			ctx,
			pi: deps.pi,
			context,
			effectiveCwd,
			currentSessionId,
			governorSessionId,
			directParentSessionId,
			parentModel,
			availableModels: models,
			modelScope,
			turnBudget: budgets.turnBudget,
			toolBudget: budgets.toolBudget,
			configToolBudget: budgets.configToolBudget,
			capabilityCeiling,
			maxSubagentDepth,
			childBaseExtensionPath: deps.childBaseExtensionPath,
		});
	} catch (error) {
		return errorResult(mode, error instanceof Error ? error.message : String(error));
	}
	let fork: ReturnType<typeof prepareForkSessions>;
	try {
		fork = prepareForkSessions({
			params,
			ctx,
			context,
			parentModel,
			availableModels: models,
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
	const prepared: PreparedLaunch = {
		params,
		mode,
		effectiveCwd,
		agents,
		currentSessionId,
		governorSessionId,
		parentSessionFile,
		parentModel,
		availableModels: models,
		modelScope,
		runId,
		sessionRoot,
		artifactConfig,
		artifactsDir,
		turnBudget: budgets.turnBudget,
		toolBudget: budgets.toolBudget,
		configToolBudget: budgets.configToolBudget,
		timeoutMs: budgets.timeoutMs,
		context,
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
	if (directParentSessionId) prepared.directParentSessionId = directParentSessionId;
	if (modelPlan.forkContextTokens !== undefined) prepared.forkContextTokens = modelPlan.forkContextTokens;
	if (modelPlan.forkSourceMessages) prepared.forkSourceMessages = modelPlan.forkSourceMessages;
	return prepared;
}
