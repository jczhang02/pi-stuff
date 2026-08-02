/** Build and launch detached single-Agent or parallel-Agent runs. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../agents/agents.ts";
import { buildSkillInjection, normalizeSkillInput, resolveSkillsWithFallback } from "../../agents/skills.ts";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { agentDefinitionDigest, launchBindingDigest } from "../../shared/launch-contract.ts";
import { resolveEffectiveThinking } from "../../shared/model-info.ts";
import {
	type ArtifactConfig,
	ASYNC_DIR,
	type Details,
	getAsyncConfigPath,
	type NestedRouteInfo,
	RESULTS_DIR,
	type ResolvedControlConfig,
	type ResolvedToolBudget,
	type ResolvedTurnBudget,
	resolveChildMaxSubagentDepth,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
	SUBAGENT_PROCESS_TERMINAL_EVENT,
	TEMP_ROOT_DIR,
	type ToolBudgetConfig,
	type TurnBudgetConfig,
} from "../../shared/types.ts";
import { PI_CODING_AGENT_PACKAGE_ROOT_ENV, resolveChildCwd } from "../../shared/utils.ts";
import {
	decodeSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
	resolveCurrentSubagentCapabilityCeiling,
	SUBAGENT_CAPABILITY_CEILING_ENV,
} from "../shared/capability-ceiling.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import {
	type AvailableModelInfo,
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
	MAX_PARALLEL_CONCURRENCY,
	type RunnerAgentTask,
} from "../shared/parallel-utils.ts";
import { resolvePiLaunchToolPlan } from "../shared/pi-args.ts";
import { resolvePiPackageRoot } from "../shared/pi-spawn.ts";
import type { SessionLeaseRequest } from "../shared/session-lease.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { initialTurnBudgetState, resolveTurnBudgetConfig } from "../shared/turn-budget.ts";
import { finalizeProcessTerminal, readProcessTerminal } from "./process-terminal.ts";

const require = createRequire(import.meta.url);
const piPackageRoot = resolvePiPackageRoot();

export interface AsyncExecutionContext {
	pi: ExtensionAPI;
	cwd: string;
	currentSessionId: string;
	/** Direct parent session used for permission requests from the child. */
	parentSessionId?: string;
	currentModelProvider?: string;
	currentModel?: ParentModel;
	modelScope?: ModelScopeConfig;
	interactive?: boolean;
}

export interface AsyncParallelTaskInput {
	agent: string;
	task: string;
	cwd?: string;
	model?: string;
	skill?: string | string[] | false;
	turnBudget?: TurnBudgetConfig;
	toolBudget?: ToolBudgetConfig;
}

interface CommonBuildParams {
	ctx: AsyncExecutionContext;
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
}

export interface AsyncParallelRunnerWorkBuildParams extends CommonBuildParams {
	agents: AgentConfig[];
	tasks: AsyncParallelTaskInput[];
	contextForAgent?: (agentName: string) => ContextMode;
	thinking?: AgentConfig["thinking"];
	thinkingOverridesByIndex?: Array<AgentConfig["thinking"] | undefined>;
	sessionFilesByIndex?: Array<string | undefined>;
	concurrency?: number;
	globalConcurrencyLimit?: number;
	worktree?: boolean;
}

export interface AsyncSingleRunnerWorkBuildParams extends CommonBuildParams {
	agent: string;
	task: string;
	agentConfig: AgentConfig;
	context?: ContextMode;
	skills?: string[];
	sessionFile?: string;
	modelOverride?: string;
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
	revivalLease?: SessionLeaseRequest;
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

interface BuiltTask {
	task: RunnerAgentTask;
	recovery: BackgroundRecoveryDescriptor;
}

function resolveJitiCliFromPackageJson(packageJsonPath: string): string | undefined {
	if (!fs.existsSync(packageJsonPath)) return undefined;
	const packageRoot = path.dirname(packageJsonPath);
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
		bin?: string | Record<string, string>;
	};
	const bin = pkg.bin;
	const configured = typeof bin === "string" ? bin : (bin?.jiti ?? Object.values(bin ?? {})[0]);
	for (const candidate of [configured, "lib/jiti-cli.mjs"]) {
		if (!candidate) continue;
		const cliPath = path.resolve(packageRoot, candidate);
		if (fs.existsSync(cliPath)) return cliPath;
	}
	return undefined;
}

function resolveJitiCliPath(): string | undefined {
	const candidates: Array<() => string | undefined> = [
		() => require.resolve("jiti/package.json"),
		() =>
			piPackageRoot
				? createRequire(path.join(piPackageRoot, "package.json")).resolve("jiti/package.json")
				: undefined,
		() => {
			if (!process.argv[1]) return undefined;
			return createRequire(fs.realpathSync(process.argv[1])).resolve("jiti/package.json");
		},
		() => (piPackageRoot ? path.join(piPackageRoot, "node_modules", "jiti", "package.json") : undefined),
	];
	for (const candidate of candidates) {
		try {
			const packageJsonPath = candidate();
			if (!packageJsonPath) continue;
			const cliPath = resolveJitiCliFromPackageJson(packageJsonPath);
			if (cliPath) return cliPath;
		} catch {
			// Probe the next installation root.
		}
	}
	return undefined;
}

const jitiCliPath = resolveJitiCliPath();

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
	return jitiCliPath !== undefined;
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

function buildResolvedTask(input: {
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

	const primaryModel = resolveEffectiveSubagentModel(
		input.modelOverride ?? taskInput.model,
		agent.model,
		params.ctx.currentModel,
		params.availableModels,
		params.ctx.currentModelProvider,
		{ scope: params.ctx.modelScope },
	);
	const thinkingConfig = input.thinkingOverride ?? agent.thinking;
	const thinking = resolveEffectiveThinking(primaryModel, thinkingConfig);
	const modelCandidates = buildModelCandidates(
		primaryModel,
		agent.fallbackModels,
		params.availableModels,
		params.ctx.currentModelProvider,
		{ scope: params.ctx.modelScope },
	);
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
		requireReadTool: resolvedSkills.length > 0,
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
		parentSessionId: params.ctx.parentSessionId ?? params.ctx.currentSessionId,
		agent: agent.name,
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
		sourceRunId: input.runId,
		childIndex: input.index,
		launchContractDigest,
		agent: agent.name,
		...(input.context ? { context: input.context } : {}),
		...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
		cwd: taskCwd,
		...(primaryModel ? { model: primaryModel } : {}),
		...(agent.fallbackModels ? { fallbackModels: [...agent.fallbackModels] } : {}),
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
		taskInput: { agent: params.agent, task: params.task },
		agent: params.agentConfig,
		params,
		runnerCwd,
		context: params.context,
		skills: params.skills,
		sessionFile: params.sessionFile,
		modelOverride: params.modelOverride,
		thinkingOverride: params.thinkingOverride,
	});
	if ("error" in built) return built;
	return {
		runnerCwd,
		work: { mode: "single", task: built.task },
		recovery: built.recovery,
	};
}

function isNodeExecutableName(execPath: string): boolean {
	const basename = path.basename(execPath).toLowerCase();
	return basename === "node" || basename === "node.exe" || basename === "nodejs" || basename === "nodejs.exe";
}

function canUseCurrentNodeExecutable(execPath: string): boolean {
	try {
		fs.accessSync(execPath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function resolveAsyncRunnerNodeCommand(): string {
	if (isNodeExecutableName(process.execPath) && canUseCurrentNodeExecutable(process.execPath)) {
		return process.execPath;
	}
	return process.platform === "win32" ? "node.exe" : "node";
}

export function resolveAsyncRunnerLogPaths(cfg: object): { stdoutPath: string; stderrPath: string } | undefined {
	const asyncDir = (cfg as { asyncDir?: unknown }).asyncDir;
	if (typeof asyncDir !== "string") return undefined;
	return {
		stdoutPath: path.join(asyncDir, "runner.stdout.log"),
		stderrPath: path.join(asyncDir, "runner.stderr.log"),
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
const RUNNER_STARTUP_WAIT_BUFFER = typeof SharedArrayBuffer === "undefined" ? undefined : new SharedArrayBuffer(4);
const RUNNER_STARTUP_WAIT_VIEW = RUNNER_STARTUP_WAIT_BUFFER ? new Int32Array(RUNNER_STARTUP_WAIT_BUFFER) : undefined;

type RunnerStartupState = "ready" | "acknowledged";
type RunnerStartupWaitResult = { ok: true; token: string } | { ok: false; error: string };

function waitForStartupInterval(delayMs = 20): void {
	if (RUNNER_STARTUP_WAIT_VIEW) {
		Atomics.wait(RUNNER_STARTUP_WAIT_VIEW, 0, 0, delayMs);
		return;
	}
	const waitUntil = Date.now() + delayMs;
	while (Date.now() < waitUntil) {
		// Revival startup is intentionally synchronous so launch failure is atomic.
	}
}

function readRunnerStartup(
	startupPath: string,
	expectedState: RunnerStartupState,
	expectedToken?: string,
): RunnerStartupWaitResult | undefined {
	if (!fs.existsSync(startupPath)) return undefined;
	try {
		const payload = JSON.parse(fs.readFileSync(startupPath, "utf-8")) as {
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

function waitForRunnerStartup(
	startupPath: string,
	expectedState: RunnerStartupState,
	timeoutMs: number,
	expectedToken?: string,
): RunnerStartupWaitResult {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = readRunnerStartup(startupPath, expectedState, expectedToken);
		if (result) return result;
		if (Date.now() >= deadline) break;
		waitForStartupInterval(Math.min(20, Math.max(1, deadline - Date.now())));
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
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function terminateRunnerBeforeProceed(pid: number): void {
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		if (!runnerIsAlive(pid)) return;
		try {
			process.kill(pid, signal);
		} catch {
			if (!runnerIsAlive(pid)) return;
		}
		const deadline = Date.now() + 1_000;
		while (runnerIsAlive(pid) && Date.now() < deadline) waitForStartupInterval();
	}
}

function spawnRunner(
	cfg: BackgroundRunnerConfig,
	suffix: string,
	cwd: string,
	onProcessTerminal?: (proof: unknown) => void,
): { pid?: number; error?: string } {
	if (!jitiCliPath) {
		return {
			error: "upstream jiti for TypeScript execution could not be found; ensure package dependencies are installed",
		};
	}
	try {
		if (!fs.statSync(cwd).isDirectory()) return { error: `cwd is not a directory: ${cwd}` };
	} catch {
		return { error: `cwd does not exist: ${cwd}` };
	}

	fs.mkdirSync(TEMP_ROOT_DIR, { recursive: true });
	const configPath = getAsyncConfigPath(suffix);
	const runnerProcessInstanceId = randomUUID();
	const launchConfig: BackgroundRunnerConfig = { ...cfg, runnerProcessInstanceId };
	fs.writeFileSync(configPath, JSON.stringify(launchConfig));
	const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "subagent-runner.ts");
	const startupPath = launchConfig.revivalLease ? path.join(launchConfig.asyncDir, "runner-startup.json") : undefined;
	const startupAckPath = startupPath ? path.join(path.dirname(startupPath), "runner-startup-ack.json") : undefined;
	const startupProceedPath = startupPath
		? path.join(path.dirname(startupPath), "runner-startup-proceed.json")
		: undefined;
	for (const filePath of [startupPath, startupAckPath, startupProceedPath]) {
		if (filePath) fs.rmSync(filePath, { force: true });
	}

	let stdoutFd: number | undefined;
	let stderrFd: number | undefined;
	try {
		const logPaths = resolveAsyncRunnerLogPaths(launchConfig);
		if (logPaths) {
			fs.mkdirSync(path.dirname(logPaths.stdoutPath), { recursive: true });
			stdoutFd = fs.openSync(logPaths.stdoutPath, "a");
			stderrFd = fs.openSync(logPaths.stderrPath, "a");
		}
		const proc = spawn(resolveAsyncRunnerNodeCommand(), [jitiCliPath, runner, configPath], {
			cwd,
			detached: true,
			stdio: ["ignore", stdoutFd ?? "ignore", stderrFd ?? "ignore"],
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
			console.error(`[pi-stuff-agents] background runner spawn failed: ${error.message}`);
		});
		proc.once("close", (exitCode, signal) => {
			finalizeProcessTerminal(launchConfig.asyncDir, launchConfig.id, {
				processInstanceId: runnerProcessInstanceId,
				closeObservedAt: Date.now(),
				exitCode,
				signal,
			});
			const persisted = readProcessTerminal(launchConfig.asyncDir, {
				runId: launchConfig.id,
				runnerProcessInstanceId,
			});
			if (!persisted) return;
			if (launchConfig.nestedRoute && launchConfig.nestedSelf) {
				try {
					let status: import("../../shared/types.ts").AsyncStatus;
					try {
						status = JSON.parse(
							fs.readFileSync(path.join(launchConfig.asyncDir, "status.json"), "utf-8"),
						) as import("../../shared/types.ts").AsyncStatus;
						status.processTerminal = persisted;
					} catch {
						status = {
							runId: launchConfig.id,
							mode: launchConfig.work.mode,
							state: persisted.state === "observed" ? "complete" : "failed",
							startedAt: persisted.state === "observed" ? persisted.observedAt : Date.now(),
							lastUpdate: Date.now(),
							processTerminal: persisted,
						};
					}
					writeNestedEvent(launchConfig.nestedRoute, {
						type: "subagent.nested.completed",
						ts: Date.now(),
						parentRunId: launchConfig.nestedSelf.parentRunId,
						parentStepIndex: launchConfig.nestedSelf.parentStepIndex,
						child: nestedSummaryFromAsyncStatus(status, launchConfig.asyncDir, {
							id: launchConfig.id,
							parentRunId: launchConfig.nestedSelf.parentRunId,
							parentStepIndex: launchConfig.nestedSelf.parentStepIndex,
							depth: launchConfig.nestedSelf.depth,
							path: launchConfig.nestedSelf.path,
							mode: status.mode,
							ts: Date.now(),
						}),
					});
				} catch (error) {
					console.error("Failed to emit final nested Agent state:", error);
				}
			}
			onProcessTerminal?.(persisted);
		});
		if (typeof proc.pid !== "number") return { error: `background runner has no pid for cwd: ${cwd}` };
		proc.unref();

		if (startupPath && startupAckPath && startupProceedPath) {
			const ready = waitForRunnerStartup(startupPath, "ready", RUNNER_STARTUP_TIMEOUT_MS);
			if (!ready.ok) {
				terminateRunnerBeforeProceed(proc.pid);
				return { error: ready.error };
			}
			try {
				writeRunnerStartupControl(startupAckPath, { action: "ack", token: ready.token });
			} catch (error) {
				terminateRunnerBeforeProceed(proc.pid);
				return {
					error: `Failed to acknowledge background runner startup: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
			const acknowledged = waitForRunnerStartup(startupPath, "acknowledged", RUNNER_STARTUP_TIMEOUT_MS, ready.token);
			if (!acknowledged.ok) {
				terminateRunnerBeforeProceed(proc.pid);
				return { error: acknowledged.error };
			}
			try {
				writeRunnerStartupControl(startupProceedPath, {
					action: "proceed",
					token: ready.token,
				});
			} catch (error) {
				terminateRunnerBeforeProceed(proc.pid);
				return {
					error: `Failed to authorize background runner startup: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
			fs.rmSync(startupPath, { force: true });
		}
		return { pid: proc.pid };
	} catch (error) {
		closeFd(stdoutFd);
		closeFd(stderrFd);
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function formatAsyncStartError(mode: "single" | "parallel", message: string): AsyncExecutionResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode, results: [] },
	};
}

function prepareRunLocation(id: string):
	| {
			asyncDir: string;
			inheritedNestedRoute?: NestedRouteInfo;
			nestedAddress?: ReturnType<typeof resolveNestedParentAddressFromEnv>;
	  }
	| { error: string } {
	const inheritedNestedRoute = resolveInheritedNestedRouteFromEnv();
	const nestedAddress = inheritedNestedRoute ? resolveNestedParentAddressFromEnv() : undefined;
	const asyncDir = inheritedNestedRoute
		? path.join(TEMP_ROOT_DIR, "nested-subagent-runs", inheritedNestedRoute.rootRunId, id)
		: path.join(ASYNC_DIR, id);
	try {
		fs.mkdirSync(asyncDir, { recursive: true });
		return { asyncDir, inheritedNestedRoute, nestedAddress };
	} catch (error) {
		return {
			error: `Failed to create background run directory '${asyncDir}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

function nestedSelfFromLocation(
	location: Exclude<ReturnType<typeof prepareRunLocation>, { error: string }>,
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
			console.error("Failed to emit nested Agent start:", error);
		}
	}
	input.ctx.pi.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
		lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
		id: input.id,
		pid: input.pid,
		sessionId: input.ctx.currentSessionId,
		mode: input.work.mode,
		agent: first.agent,
		agents: tasks.map((task) => task.agent),
		task: first.task.slice(0, 50),
		goal: (input.goal ?? first.task).slice(0, 120),
		cwd: input.runnerCwd,
		asyncDir: input.asyncDir,
		...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs, deadlineAt: input.deadlineAt } : {}),
		...(input.work.mode === "single" && first.turnBudget
			? { turnBudget: initialTurnBudgetState(first.turnBudget) }
			: {}),
		...(input.capabilityCeiling ? { capabilityCeiling: input.capabilityCeiling } : {}),
		nestedRoute: input.nestedRoute,
	});
}

function persistRecoveries(asyncDir: string, recoveries: BackgroundRecoveryDescriptor[]): void {
	if (recoveries.length === 1) {
		writePrivateAtomicJson(path.join(asyncDir, "recovery-descriptor.json"), recoveries[0]);
		return;
	}
	writePrivateAtomicJson(path.join(asyncDir, "recovery-descriptors.json"), {
		version: 2,
		children: recoveries,
	});
}

export function executeAsyncParallel(id: string, params: AsyncParallelParams): AsyncExecutionResult {
	const location = prepareRunLocation(id);
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
		fs.rmSync(location.asyncDir, { recursive: true, force: true });
		return formatAsyncStartError("parallel", built.error);
	}
	if (built.work.mode !== "parallel") {
		throw new Error("Parallel background builder returned single work.");
	}
	const parallelWork = built.work;
	try {
		persistRecoveries(location.asyncDir, built.recoveries);
	} catch (error) {
		fs.rmSync(location.asyncDir, { recursive: true, force: true });
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
		worktreeSetupHook: params.worktreeSetupHook,
		worktreeSetupHookTimeoutMs: params.worktreeSetupHookTimeoutMs,
		worktreeBaseDir: params.worktreeBaseDir,
		controlConfig: params.controlConfig,
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
	const spawned = spawnRunner(config, id, built.runnerCwd, (proof) =>
		params.ctx.pi.events.emit(SUBAGENT_PROCESS_TERMINAL_EVENT, proof),
	);
	if (spawned.error)
		return formatAsyncStartError("parallel", `Failed to start background Agents '${id}': ${spawned.error}`);
	if (spawned.pid) {
		emitStarted({
			id,
			pid: spawned.pid,
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
		});
	}
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
		},
	};
}

export function executeAsyncSingle(id: string, params: AsyncSingleParams): AsyncExecutionResult {
	const location = prepareRunLocation(id);
	if ("error" in location) return formatAsyncStartError("single", location.error);
	const capabilityCeiling =
		params.capabilityCeiling ?? resolveCurrentSubagentCapabilityCeiling(params.ctx.currentSessionId);
	const deadlineAt =
		params.absoluteDeadlineAt ?? (params.timeoutMs !== undefined ? Date.now() + params.timeoutMs : undefined);
	const timeoutMs =
		params.absoluteDeadlineAt !== undefined && deadlineAt !== undefined ? deadlineAt - Date.now() : params.timeoutMs;
	if (timeoutMs !== undefined && timeoutMs <= 0) {
		fs.rmSync(location.asyncDir, { recursive: true, force: true });
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
		fs.rmSync(location.asyncDir, { recursive: true, force: true });
		return formatAsyncStartError("single", built.error);
	}
	try {
		persistRecoveries(location.asyncDir, [built.recovery]);
	} catch (error) {
		fs.rmSync(location.asyncDir, { recursive: true, force: true });
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
		worktreeSetupHook: params.worktreeSetupHook,
		worktreeSetupHookTimeoutMs: params.worktreeSetupHookTimeoutMs,
		worktreeBaseDir: params.worktreeBaseDir,
		controlConfig: params.controlConfig,
		controlIntercomTarget: params.controlIntercomTarget,
		childIntercomTargets: params.childIntercomTarget
			? [params.childIntercomTarget(built.work.task.agent, 0)]
			: undefined,
		nestedRoute,
		nestedSelf,
		timeoutMs,
		deadlineAt,
		revivalLease: params.revivalLease,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		launchContractDigest: built.work.task.launchContractDigest,
	};
	const spawned = spawnRunner(config, id, built.runnerCwd, (proof) =>
		params.ctx.pi.events.emit(SUBAGENT_PROCESS_TERMINAL_EVENT, proof),
	);
	if (spawned.error)
		return formatAsyncStartError("single", `Failed to start background Agent '${id}': ${spawned.error}`);
	if (spawned.pid) {
		emitStarted({
			id,
			pid: spawned.pid,
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
		});
	}
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
		},
	};
}
