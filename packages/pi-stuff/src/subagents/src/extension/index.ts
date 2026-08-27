import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { projectCurrentContext } from "../../../context-management/index.js";
import {
	type CommandDialogCoordinator,
	getCommandDialogCoordinator,
	readCurrentAgentWorkOrigin,
} from "../../../conversation-ui/index.js";
import { isRuntimeFunction } from "../../../shared/runtime-type.js";
import { registerSuiteOwnedTool } from "../../../tool-display/index.js";
import { type AgentConfig, type AgentDiscoveryResult, type AgentScope, discoverAgents } from "../agents/agents.ts";
import { createNativeSupervisorChannel } from "../intercom/native-supervisor-channel.ts";
import { createAsyncJobTracker } from "../runs/background/async-job-tracker.ts";
import { createResultWatcher } from "../runs/background/result-watcher.ts";
import { createSubagentExecutor } from "../runs/foreground/subagent-executor.ts";
import { hasLiveNestedDescendants } from "../runs/shared/nested-events.ts";
import {
	PI_STUFF_AGENT_PATH_ENV,
	resolvePiLaunchToolPlan,
	SUBAGENT_CHILD_ENV,
	SUBAGENT_PARENT_PHYSICAL_SESSION_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../runs/shared/pi-args.ts";
import {
	type AgentExecutionCoordinatorPort,
	createDurableAgentExecutionCoordinator,
	parseAgentOwnerPath,
} from "../runtime/agent-execution-coordinator.ts";
import { maintainAgentRuntime } from "../runtime/runtime-maintenance.ts";
import {
	type PrepareSessionGovernorCompatibilityInput,
	prepareSessionGovernorCompatibility,
	type SessionGovernorCompatibilityResult,
} from "../runtime/session-governor-compatibility.ts";
import {
	type AgentControlAcknowledgement,
	type AgentRow,
	CurrentAgents,
	type CurrentAgentsOptions,
} from "../session/current-agents.ts";
import {
	mergeForegroundRuns,
	recoverForegroundRuntimeRunsAsync,
	replayForegroundRuns,
} from "../session/foreground-replay.ts";
import { ensureAccessibleDir } from "../shared/accessible-dir.ts";
import { maintainAgentArtifacts } from "../shared/artifacts.ts";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import {
	buildSessionCompatibilityScope,
	buildSessionGovernorCompatibilityScope,
	resolveCurrentSessionIdentity,
} from "../shared/session-identity.ts";
import {
	ASYNC_DIR,
	DEFAULT_ARTIFACT_CONFIG,
	type Details,
	RESULTS_DIR,
	SESSION_GOVERNOR_ROOT,
	type SubagentState,
	TEMP_ROOT_DIR,
} from "../shared/types.ts";
import { type AgentDialogOptions, openAgentDialog } from "../ui/agent-dialog.ts";
import { AgentRoster, type AgentRosterOptions } from "../ui/agent-roster.ts";
import { readAgentTranscript } from "../ui/agent-transcript.ts";
import { createAgentToolPresentation } from "./agent-tool-presentation.ts";
import { type CompactCompletionNotifier, installCompletionHandling } from "./completion-handling.ts";
import { loadConfig, type PiStuffAgentsConfig } from "./config.ts";
import { agentResultText, normalizePublicAgentParams, type PublicAgentParams } from "./product-executor.ts";
import {
	type ExecutePublicAgent,
	type PublicAgentEngine,
	type PublicAgentExecutionRuntime,
	projectPublicAgentFailure,
	runPublicAgent,
} from "./public-agent-execution.ts";
import { registerAgentRuntimeEvents } from "./runtime-events.ts";
import { SubagentParams } from "./schemas.ts";
import { type AgentToolRosterEntry, buildSubagentToolDescription } from "./tool-description.ts";

export { loadConfig } from "./config.ts";

const RUNTIME_MAINTENANCE_SUCCESS_INTERVAL_MS = 60 * 60 * 1_000;
const RUNTIME_MAINTENANCE_FAILURE_RETRY_MS = 60 * 1_000;
const RUNTIME_CLEANUP_KEY = "__piStuffAgentsRootCleanup";

interface RootTracker {
	ensureObserver(): void;
	handleComplete<Data>(data: Data): void;
	handleProcessTerminal<Data>(data: Data): void;
	handleStarted<Data>(data: Data): void;
	handleStatus<Data>(data: Data): void;
	resetJobs(): void;
	restoreActiveJobs(asyncDirectories?: readonly string[]): Promise<void>;
}

interface RootWatcher {
	primeExistingResults(options?: { triggerTurn?: boolean }): void;
	startResultWatcher(): boolean;
	stopResultWatcher(): void;
}

interface RootSupervisor {
	dispose(): void;
	pause?(): void;
	start(): void | Promise<void>;
}

interface RootExecutorInput {
	readonly config: PiStuffAgentsConfig;
	readonly codeModeProviderTools?: readonly string[] | undefined;
	readonly discoverAgents: (cwd: string, scope: AgentScope) => Promise<AgentDiscoveryResult>;
	readonly pi: ExtensionAPI;
	readonly projectContext: typeof projectCurrentContext;
	readonly resolveCodeModeEnabled?: (() => boolean) | undefined;
	readonly onForegroundStatus?: (() => void) | undefined;
	readonly state: SubagentState;
	readonly childBaseExtensionPath?: string | undefined;
}

interface RootWatcherInput {
	readonly notifier: CompactCompletionNotifier;
	readonly pi: ExtensionAPI;
	readonly state: SubagentState;
}

interface AgentsRuntimeGlobal {
	[RUNTIME_CLEANUP_KEY]?: () => void | Promise<void>;
}

export type ExtensionRootRoster = Pick<
	AgentRoster,
	"createFooterTail" | "dispose" | "setContext" | "setFooterHosted" | "setSuppressed"
>;

/** Narrow seams keep the production root auditable and the host contract testable. */
export interface ExtensionRootDependencies {
	readonly childBaseExtensionPath?: string;
	readonly codeModeProviderTools?: readonly string[];
	readonly resolveCodeModeEnabled?: () => boolean;
	readonly createCurrentAgents: (state: SubagentState, options: CurrentAgentsOptions) => CurrentAgents;
	readonly createExecutor: (input: RootExecutorInput) => PublicAgentEngine;
	readonly createGovernorCoordinator: (config: PiStuffAgentsConfig) => AgentExecutionCoordinatorPort;
	readonly prepareGovernorCompatibility: (
		input: PrepareSessionGovernorCompatibilityInput,
	) => Promise<SessionGovernorCompatibilityResult>;
	readonly createRoster: (current: CurrentAgents, options: AgentRosterOptions) => ExtensionRootRoster;
	readonly createSupervisor: (pi: ExtensionAPI, state: SubagentState) => RootSupervisor;
	readonly createTracker: (pi: ExtensionAPI, state: SubagentState, onRefresh: () => void) => RootTracker;
	readonly createWatcher: (input: RootWatcherInput) => RootWatcher;
	readonly discoverAgents: (cwd: string, scope: AgentScope) => Promise<AgentDiscoveryResult>;
	readonly ensureDirectory: (directory: string) => void;
	readonly getCoordinator: (pi: ExtensionAPI) => CommandDialogCoordinator;
	readonly isChildProcess: () => boolean;
	readonly loadConfiguration: () => PiStuffAgentsConfig;
	readonly maintainRuntime: () => Promise<void> | void;
	readonly monotonicNow: () => number;
	readonly openDialog: (
		ctx: ExtensionContext,
		coordinator: CommandDialogCoordinator,
		current: CurrentAgents,
		options: AgentDialogOptions,
	) => Promise<void>;
	readonly projectContext: typeof projectCurrentContext;
	readonly randomId: () => string;
}

function getSubagentSessionRoot(parentSessionFile: string | null): string {
	if (parentSessionFile) {
		return path.join(path.dirname(parentSessionFile), path.basename(parentSessionFile, ".jsonl"));
	}
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-session-"));
}

function expandTilde(value: string): string {
	return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

const PRODUCTION_DEPENDENCIES: ExtensionRootDependencies = {
	createCurrentAgents: (state, options) => new CurrentAgents(state, options),
	createExecutor: ({
		childBaseExtensionPath,
		codeModeProviderTools,
		config,
		discoverAgents: discoverAgentDefinitions,
		onForegroundStatus,
		pi,
		projectContext,
		resolveCodeModeEnabled,
		state,
	}) =>
		createSubagentExecutor({
			pi,
			state,
			config,
			asyncByDefault: true,
			getSubagentSessionRoot,
			expandTilde,
			discoverAgents: discoverAgentDefinitions,
			projectContext,
			childBaseExtensionPath,
			codeModeProviderTools,
			resolveCodeModeEnabled,
			onForegroundStatus,
		}),
	createGovernorCoordinator: (config) =>
		createDurableAgentExecutionCoordinator({
			rootDir: SESSION_GOVERNOR_ROOT,
			limits: {
				maxDepth: config.maxSubagentDepth,
				maxRunning: config.maxRunningAgents,
				maxTotal: config.maxAgentsPerSession,
			},
		}),
	prepareGovernorCompatibility: prepareSessionGovernorCompatibility,
	createRoster: (current, options) => new AgentRoster(current, options),
	createSupervisor: (pi, state) => createNativeSupervisorChannel(pi, state),
	createTracker: (pi, state, onRefresh) => createAsyncJobTracker(pi, state, ASYNC_DIR, { onRefresh }),
	createWatcher: ({ notifier, pi, state }) =>
		createResultWatcher(pi, state, RESULTS_DIR, 10 * 60 * 1_000, {
			notifier,
		}),
	discoverAgents,
	ensureDirectory: ensureAccessibleDir,
	getCoordinator: getCommandDialogCoordinator,
	isChildProcess: () => process.env[SUBAGENT_CHILD_ENV] === "1",
	loadConfiguration: loadConfig,
	maintainRuntime: async () => {
		await maintainAgentRuntime();
		await maintainAgentArtifacts(DEFAULT_ARTIFACT_CONFIG.cleanupDays);
	},
	monotonicNow: () => performance.now(),
	openDialog: openAgentDialog,
	projectContext: projectCurrentContext,
	randomId: randomUUID,
};

function createState(config: PiStuffAgentsConfig): SubagentState {
	const state: SubagentState = {
		baseCwd: "",
		currentSessionId: null,
		currentSessionScope: null,
		parentSessionFile: null,
		subagentSpawns: {
			sessionId: null,
			count: 0,
			configuredLimit: config.maxAgentsPerSession,
			granted: 0,
			grantHistory: [],
		},
		asyncJobs: new Map(),
		recentAgentJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		pendingForegroundControlNotices: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
	if (config.artifactDir) state.artifactDirPreference = config.artifactDir;
	return state;
}

function projectAgentRoster(agents: readonly AgentConfig[], cwd: string): AgentToolRosterEntry[] {
	return agents
		.map((agent) => {
			const plan = resolvePiLaunchToolPlan({
				tools: agent.tools,
				extensions: agent.extensions,
				subagentOnlyExtensions: agent.subagentOnlyExtensions,
				mcpDirectTools: agent.mcpDirectTools,
				cwd,
			});
			const entry = { name: agent.name, description: agent.description };
			return plan.explicitToolAllowlist ? { ...entry, tools: plan.effectiveToolAllowlist } : entry;
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

function hasLiveWork(state: SubagentState): boolean {
	if (state.foregroundControls.size > 0) return true;
	if (
		[...state.asyncJobs.values()].some(
			(job) =>
				job.status === "queued" ||
				job.status === "running" ||
				(job.processTerminal !== undefined && job.processTerminal.state !== "observed") ||
				hasLiveNestedDescendants(job.nestedChildren),
		)
	)
		return true;
	return [...(state.foregroundRuns?.values() ?? [])].some(
		(run) =>
			Boolean(run.nestedRoute) ||
			(Boolean(run.asyncDir) && run.children.some((child) => child.status === "detached")) ||
			run.children.some((child) => hasLiveNestedDescendants(child.children)),
	);
}

function clearTimerMap(state: SubagentState): void {
	for (const timer of state.cleanupTimers.values()) clearTimeout(timer);
	state.cleanupTimers.clear();
}

/** Product composition root: one public tool, one command, and current-session UI only. */
export default function registerSubagentExtension(
	pi: ExtensionAPI,
	overrides: Partial<ExtensionRootDependencies> = {},
): void {
	const deps: ExtensionRootDependencies = { ...PRODUCTION_DEPENDENCIES, ...overrides };
	if (deps.isChildProcess()) return;

	// SAFETY: this Extension owns one literal global slot whose only value is its cleanup callback.
	const globalStore = globalThis as typeof globalThis & AgentsRuntimeGlobal;
	const previousCleanup = globalStore[RUNTIME_CLEANUP_KEY];
	let previousCleanupPromise = Promise.resolve();
	if (isRuntimeFunction(previousCleanup)) {
		try {
			previousCleanupPromise = Promise.resolve(previousCleanup()).catch(() => undefined);
		} catch {
			// A stale reload must not prevent the replacement root from registering.
		}
	}

	const config = deps.loadConfiguration();
	const state = createState(config);
	const coordinator = deps.getCoordinator(pi);
	let current!: CurrentAgents;
	const executor = deps.createExecutor({
		config,
		onForegroundStatus: () => current.refresh(),
		pi,
		projectContext: deps.projectContext,
		resolveCodeModeEnabled: deps.resolveCodeModeEnabled,
		state,
		childBaseExtensionPath: deps.childBaseExtensionPath,
		codeModeProviderTools: deps.codeModeProviderTools,
		discoverAgents: deps.discoverAgents,
	});
	const executionGovernor = deps.createGovernorCoordinator(config);
	const tracker = deps.createTracker(pi, state, () => current.refresh());
	const supervisor = deps.createSupervisor(pi, state);
	const notifier = installCompletionHandling(pi, state, coordinator);
	const watcher = deps.createWatcher({ notifier, pi, state });
	let active = true;
	let watcherStarted = false;
	let sessionEpoch = 0;
	let runtimeActivatedEpoch = -1;
	let runtimeActivation: { epoch: number; promise: Promise<void> } | undefined;
	let historyRecoveredEpoch = -1;
	let historyRecovery: { epoch: number; promise: Promise<void> } | undefined;
	let governorCompatibilityReady = false;
	let governorCompatibilityError: string | undefined;
	let governorCompatibilityCheck: { epoch: number; promise: Promise<void> } | undefined;
	let governorCompatibilityScope: ReturnType<typeof buildSessionGovernorCompatibilityScope> | undefined;
	let maintenanceTimer: ReturnType<typeof setTimeout> | undefined;
	let maintenanceInFlight = false;
	let nextMaintenanceAt = 0;
	let ephemeralSessionNonce = randomUUID();
	let executePublicAgent!: ExecutePublicAgent;
	let activateCurrentSessionRuntime!: (ctx: ExtensionContext) => Promise<void>;
	let recoverCurrentSessionHistory!: (ctx: ExtensionContext) => Promise<void>;
	let agentRoster: AgentToolRosterEntry[] = [];

	const showAgents = async (ctx: ExtensionContext, initialKey?: string): Promise<void> => {
		if (!ctx.hasUI) return Promise.resolve();
		await activateCurrentSessionRuntime(ctx);
		await recoverCurrentSessionHistory(ctx);
		let options: AgentDialogOptions = { readTranscript: readAgentTranscript };
		if (initialKey) options = { ...options, initialKey };
		return deps.openDialog(ctx, coordinator, current, options);
	};

	const contextForControl = (): ExtensionContext | null => state.lastUiContext;
	const runEngineControl = async (
		row: AgentRow,
		action: "resume" | "steer" | "stop",
		message?: string,
	): Promise<AgentControlAcknowledgement> => {
		const ctx = contextForControl();
		if (!ctx) return { acknowledged: false, message: "No active parent session is available." };
		let params: PublicAgentParams = {
			action,
			id: row.runId,
			index: row.childIndex,
		};
		if (message) params = { ...params, message };
		const result = await executePublicAgent(
			deps.randomId(),
			params,
			new AbortController().signal,
			undefined,
			ctx,
			"user",
		);
		current.refresh();
		const isError = result.isError === true;
		return {
			acknowledged: !isError,
			message: agentResultText(result) || (isError ? "Agent request failed." : "Agent request acknowledged."),
		};
	};

	current = deps.createCurrentAgents(state, {
		inspect: async (row) => {
			const ctx = contextForControl();
			if (!ctx?.hasUI) return { acknowledged: false, message: "Agent details require the interactive parent." };
			await showAgents(ctx, row.key);
			return { acknowledged: true, message: "Agent details opened." };
		},
		steer: (row, message) => {
			if (state.foregroundControls.has(row.runId)) {
				return { acknowledged: false, message: "Live foreground Agents cannot be steered through this surface." };
			}
			return runEngineControl(row, "steer", message);
		},
		stop: (row) => {
			const foreground = state.foregroundControls.get(row.runId);
			if (!foreground) return runEngineControl(row, "stop");
			const child = foreground.activeChildren?.get(row.childIndex);
			const accepted =
				child?.interrupt?.() === true ||
				(foreground.currentIndex === row.childIndex && foreground.interrupt?.() === true);
			current.refresh();
			return {
				acknowledged: accepted,
				message: accepted
					? "Foreground Agent interrupt requested."
					: "Foreground Agent is no longer interruptible.",
			};
		},
		resume: (row, message) => runEngineControl(row, "resume", message),
	});
	const roster = deps.createRoster(current, {
		onOpen: (key) => {
			const ctx = state.lastUiContext;
			return ctx ? showAgents(ctx, key) : undefined;
		},
	});
	const unregisterRosterChrome = coordinator.registerChrome("agents-roster", roster);
	const unregisterRosterFooterTail =
		coordinator.registerFooterTail?.("agents-roster", (tui, theme) => roster.createFooterTail(tui, theme)) ??
		(() => {});

	const bindContext = (ctx: ExtensionContext): void => {
		state.lastUiContext = ctx;
		roster.setFooterHosted(coordinator.hasInstalledFooter?.(ctx) === true);
		roster.setContext(ctx);
	};

	const scheduleRuntimeMaintenance = (): void => {
		if (maintenanceTimer || maintenanceInFlight || !active) return;
		if (deps.monotonicNow() < nextMaintenanceAt) return;
		maintenanceTimer = setTimeout(() => {
			maintenanceTimer = undefined;
			if (!active) return;
			maintenanceInFlight = true;
			void Promise.resolve()
				.then(() => deps.maintainRuntime())
				.then(
					() => {
						nextMaintenanceAt = deps.monotonicNow() + RUNTIME_MAINTENANCE_SUCCESS_INTERVAL_MS;
					},
					(error) => {
						nextMaintenanceAt = deps.monotonicNow() + RUNTIME_MAINTENANCE_FAILURE_RETRY_MS;
						reportAgentDiagnostic("Failed to maintain completed Agent runtime data:", error);
					},
				)
				.finally(() => {
					maintenanceInFlight = false;
				});
		}, 0);
		maintenanceTimer.unref?.();
	};

	const startRunRuntime = (options: { createDirectories: boolean; primeExisting: boolean }): void => {
		if (options.createDirectories) {
			deps.ensureDirectory(RESULTS_DIR);
			deps.ensureDirectory(ASYNC_DIR);
		}
		if (!watcherStarted) watcherStarted = watcher.startResultWatcher();
		if (options.primeExisting) watcher.primeExistingResults({ triggerTurn: false });
	};

	const bindExecutionGovernor = (ctx: ExtensionContext): void => {
		const identity =
			state.currentSessionScope ?? resolveCurrentSessionIdentity(ctx.sessionManager, ctx.cwd, ephemeralSessionNonce);
		const ownerAgentPath = parseAgentOwnerPath(process.env[PI_STUFF_AGENT_PATH_ENV]);
		const ledgerSessionId = state.currentGovernorSessionId?.trim() || identity.governorSessionId;
		process.env[SUBAGENT_PARENT_SESSION_ENV] = ledgerSessionId;
		process.env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV] = identity.sessionId;
		executionGovernor.bindSession({ sessionId: ledgerSessionId, ownerAgentPath });
	};

	const refreshGovernorCompatibility = async (_ctx: ExtensionContext): Promise<void> => {
		const epoch = sessionEpoch;
		if (governorCompatibilityCheck?.epoch === epoch) return governorCompatibilityCheck.promise;
		const check = { epoch, promise: Promise.resolve() };
		check.promise = (async () => {
			try {
				const scope = governorCompatibilityScope;
				if (!scope) throw new Error("Agent governor compatibility has no current Session snapshot.");
				const result = await deps.prepareGovernorCompatibility({
					scope,
					limits: {
						maxDepth: config.maxSubagentDepth,
						maxRunning: config.maxRunningAgents,
						maxTotal: config.maxAgentsPerSession,
					},
				});
				if (active && epoch === sessionEpoch) {
					governorCompatibilityReady = result.ok;
					governorCompatibilityError = result.ok ? undefined : result.message;
				}
			} catch (error) {
				if (active && epoch === sessionEpoch) {
					governorCompatibilityReady = false;
					governorCompatibilityError = `Agent launches are paused because governor compatibility could not be verified: ${
						error instanceof Error ? error.message : String(error)
					}`;
				}
			} finally {
				if (governorCompatibilityCheck === check) governorCompatibilityCheck = undefined;
			}
		})();
		governorCompatibilityCheck = check;
		return check.promise;
	};

	activateCurrentSessionRuntime = async (ctx: ExtensionContext): Promise<void> => {
		bindContext(ctx);
		if (!state.currentSessionId || !state.currentSessionScope) return;
		const epoch = sessionEpoch;
		if (runtimeActivatedEpoch === epoch) return;
		if (runtimeActivation?.epoch === epoch) return runtimeActivation.promise;
		const activation = { epoch, promise: Promise.resolve() };
		activation.promise = (async () => {
			try {
				bindExecutionGovernor(ctx);
				await executionGovernor.reconcileExisting();
				if (!active || epoch !== sessionEpoch) return;
				startRunRuntime({ createDirectories: false, primeExisting: true });
				if (hasLiveWork(state)) {
					tracker.ensureObserver();
				}
				current.refresh();
				await supervisor.start();
				runtimeActivatedEpoch = epoch;
			} finally {
				if (runtimeActivation === activation) runtimeActivation = undefined;
			}
		})();
		runtimeActivation = activation;
		return activation.promise;
	};

	// Full artifact discovery belongs to the explicit /agents inspection surface,
	// never to an Agent Tool call on the model-submission path.
	recoverCurrentSessionHistory = async (ctx: ExtensionContext): Promise<void> => {
		bindContext(ctx);
		if (!state.currentSessionId || !state.currentSessionScope) return;
		const epoch = sessionEpoch;
		const sessionScope = state.currentSessionScope;
		if (historyRecoveredEpoch === epoch) return;
		if (historyRecovery?.epoch === epoch) return historyRecovery.promise;
		const recovery = { epoch, promise: Promise.resolve() };
		recovery.promise = (async () => {
			try {
				const recoveredForeground = await recoverForegroundRuntimeRunsAsync(
					path.join(TEMP_ROOT_DIR, "foreground-runs"),
					sessionScope,
				);
				await tracker.restoreActiveJobs();
				if (!active || epoch !== sessionEpoch) return;
				state.foregroundRuns = mergeForegroundRuns(state.foregroundRuns ?? new Map(), recoveredForeground);
				current.refresh();
				historyRecoveredEpoch = epoch;
			} finally {
				if (historyRecovery === recovery) historyRecovery = undefined;
			}
		})();
		historyRecovery = recovery;
		return recovery.promise;
	};

	const publicAgentRuntime: PublicAgentExecutionRuntime = {
		state,
		governor: executionGovernor,
		engine: executor,
		rootState: () => {
			const rootState = {
				active,
				sessionEpoch,
				ephemeralSessionNonce,
				compatibilityReady: governorCompatibilityReady,
			};
			return governorCompatibilityError === undefined
				? rootState
				: { ...rootState, compatibilityError: governorCompatibilityError };
		},
		activate: activateCurrentSessionRuntime,
		refreshCompatibility: refreshGovernorCompatibility,
		startRunRuntime,
		scheduleMaintenance: scheduleRuntimeMaintenance,
		refresh: () => current.refresh(),
	};
	executePublicAgent = (id, params, signal, onUpdate, ctx, parentRunOrigin) =>
		runPublicAgent(publicAgentRuntime, { id, params, signal, onUpdate, ctx, parentRunOrigin });
	const tool: ToolDefinition<typeof SubagentParams, Details> = {
		name: "subagent",
		label: "Agent",
		get description() {
			return buildSubagentToolDescription(agentRoster);
		},
		parameters: SubagentParams,
		async execute(id, rawParams, signal, onUpdate, ctx) {
			// SAFETY: ToolDefinition validates rawParams against SubagentParams before invoking execute.
			const supplied = rawParams as PublicAgentParams;
			let params: PublicAgentParams;
			try {
				params = normalizePublicAgentParams(supplied);
			} catch (error) {
				return projectPublicAgentFailure(supplied, error instanceof Error ? error.message : String(error));
			}
			return executePublicAgent(
				id,
				params,
				signal ?? new AbortController().signal,
				onUpdate,
				ctx,
				readCurrentAgentWorkOrigin(pi),
			);
		},
	};

	const registeredTool = registerSuiteOwnedTool(pi, tool, createAgentToolPresentation());
	pi.on("before_agent_start", async (_event, ctx) => {
		if (!active) return;
		const epoch = sessionEpoch;
		const discovered = await deps.discoverAgents(ctx.cwd, "both");
		if (!active || epoch !== sessionEpoch) return;
		agentRoster = projectAgentRoster(discovered.agents, ctx.cwd);
		// Pi snapshots Tool fields into its provider registry, so refresh after discovery.
		pi.registerTool(registeredTool);
	});
	pi.registerCommand("agents", {
		description: "Inspect and control Agents in the current session",
		handler: async (_args, ctx) => showAgents(ctx),
	});
	const disposeRuntimeEvents = registerAgentRuntimeEvents({
		pi,
		state,
		governor: executionGovernor,
		tracker,
		isActive: () => active,
		bindContext,
		refresh: () => current.refresh(),
	});
	pi.on("session_start", async (_event, ctx) => {
		if (!active) return;
		await previousCleanupPromise;
		sessionEpoch += 1;
		agentRoster = [];
		runtimeActivatedEpoch = -1;
		runtimeActivation = undefined;
		historyRecoveredEpoch = -1;
		historyRecovery = undefined;
		watcher.stopResultWatcher();
		watcherStarted = false;
		supervisor.pause?.();
		tracker.resetJobs();
		state.baseCwd = ctx.cwd;
		ephemeralSessionNonce = randomUUID();
		const identity = resolveCurrentSessionIdentity(ctx.sessionManager, ctx.cwd, ephemeralSessionNonce);
		state.currentSessionId = identity.sessionId;
		state.currentGovernorSessionId = identity.governorSessionId;
		governorCompatibilityReady = false;
		governorCompatibilityError = undefined;
		const sessionEntries = isRuntimeFunction(ctx.sessionManager.getBranch)
			? ctx.sessionManager.getBranch()
			: ctx.sessionManager.getEntries();
		notifier.reset(sessionEntries);
		state.currentSessionScope = buildSessionCompatibilityScope(identity, sessionEntries);
		governorCompatibilityScope = buildSessionGovernorCompatibilityScope(identity, sessionEntries);
		state.foregroundRuns = state.currentSessionId
			? replayForegroundRuns(sessionEntries, state.currentSessionId)
			: new Map();
		state.parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
		state.subagentSpawns = {
			sessionId: state.currentSessionId,
			count: 0,
			configuredLimit: config.maxAgentsPerSession,
			granted: 0,
			grantHistory: [],
		};
		bindContext(ctx);
		bindExecutionGovernor(ctx);
		const leases = (await executionGovernor.inspectExistingRuntimeLeases?.()) ?? [];
		const foregroundRoot = path.resolve(path.join(TEMP_ROOT_DIR, "foreground-runs"));
		const backgroundRoot = path.resolve(ASYNC_DIR);
		const foregroundDirectories: string[] = [];
		const backgroundDirectories: string[] = [];
		for (const lease of leases) {
			if (!lease.asyncDir) continue;
			const directory = path.resolve(lease.asyncDir);
			if (path.dirname(directory) === foregroundRoot) foregroundDirectories.push(directory);
			else if (path.dirname(directory) === backgroundRoot) backgroundDirectories.push(directory);
		}
		if (state.currentSessionScope) {
			state.foregroundRuns = mergeForegroundRuns(
				state.foregroundRuns ?? new Map(),
				await recoverForegroundRuntimeRunsAsync(
					path.join(TEMP_ROOT_DIR, "foreground-runs"),
					state.currentSessionScope,
					foregroundDirectories,
				),
			);
		}
		await tracker.restoreActiveJobs(backgroundDirectories);
		current.refresh();
	});

	const cleanup = async (): Promise<void> => {
		if (!active) return;
		active = false;
		sessionEpoch += 1;
		if (maintenanceTimer) clearTimeout(maintenanceTimer);
		maintenanceTimer = undefined;
		watcher.stopResultWatcher();
		watcherStarted = false;
		disposeRuntimeEvents();
		tracker.resetJobs();
		clearTimerMap(state);
		state.resultFileCoalescer.clear();
		state.asyncJobs.clear();
		state.recentAgentJobs?.clear();
		state.foregroundRuns?.clear();
		state.foregroundControls.clear();
		state.currentSessionId = null;
		state.currentSessionScope = null;
		state.currentGovernorSessionId = null;
		governorCompatibilityReady = false;
		governorCompatibilityError = undefined;
		governorCompatibilityScope = undefined;
		state.parentSessionFile = null;
		state.lastUiContext = null;
		notifier.dispose();
		executionGovernor.dispose();
		supervisor.dispose();
		unregisterRosterFooterTail();
		unregisterRosterChrome();
		roster.dispose();
		current.dispose();
		delete process.env[SUBAGENT_PARENT_SESSION_ENV];
		delete process.env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV];
		if (globalStore[RUNTIME_CLEANUP_KEY] === cleanup) delete globalStore[RUNTIME_CLEANUP_KEY];
	};

	globalStore[RUNTIME_CLEANUP_KEY] = cleanup;
	pi.on("session_shutdown", cleanup);
}
