import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionEntry, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { projectCurrentContext } from "../../../context-management/index.js";
import {
	type AgentWorkOrigin,
	type CommandDialogCoordinator,
	getCommandDialogCoordinator,
	readCurrentAgentWorkOrigin,
	requestStatuslineGitRefreshAfterUserWork,
} from "../../../conversation-ui/index.js";
import {
	isRuntimeBoolean,
	isRuntimeFunction,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../shared/runtime-type.js";
import { CachedToolRow, registerSuiteOwnedTool } from "../../../tool-display/index.js";
import { discoverAgents } from "../agents/agents.ts";
import { createNativeSupervisorChannel } from "../intercom/native-supervisor-channel.ts";
import { createAsyncJobTracker } from "../runs/background/async-job-tracker.ts";
import type { CompletionNotification } from "../runs/background/notify.ts";
import { createResultWatcher } from "../runs/background/result-watcher.ts";
import {
	createSubagentExecutor,
	deriveLaunchRunId,
	resolveResumeTargetRunId,
	type SubagentExecutionHooks,
	type SubagentParamsLike,
} from "../runs/foreground/subagent-executor.ts";
import { hasLiveNestedDescendants } from "../runs/shared/nested-events.ts";
import {
	PI_STUFF_AGENT_PATH_ENV,
	SUBAGENT_CHILD_ENV,
	SUBAGENT_PARENT_PHYSICAL_SESSION_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../runs/shared/pi-args.ts";
import {
	type AgentExecutionCoordinatorPort,
	type AgentExecutionInvocation,
	AgentRuntimeBindingRejectedError,
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
import { getArtifactsDir, maintainAgentArtifacts } from "../shared/artifacts.ts";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import {
	buildSessionCompatibilityScope,
	buildSessionGovernorCompatibilityScope,
	resolveCurrentSessionIdentity,
	sessionArtifactMatches,
} from "../shared/session-identity.ts";
import {
	ASYNC_DIR,
	DEFAULT_ARTIFACT_CONFIG,
	type Details,
	RESULTS_DIR,
	SESSION_GOVERNOR_ROOT,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_ASYNC_STATUS_EVENT,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	SUBAGENT_PROCESS_TERMINAL_EVENT,
	type SubagentState,
	TEMP_ROOT_DIR,
} from "../shared/types.ts";
import { type AgentDialogOptions, openAgentDialog } from "../ui/agent-dialog.ts";
import { AgentRoster, type AgentRosterOptions } from "../ui/agent-roster.ts";
import { readAgentTranscript } from "../ui/agent-transcript.ts";
import { createAgentToolPresentation } from "./agent-tool-presentation.ts";
import { loadConfig, type PiStuffAgentsConfig } from "./config.ts";
import { routeLiveNestedAgentControl } from "./nested-control-router.ts";
import {
	normalizePublicAgentParams,
	type PublicAgentParams,
	projectEngineResult,
	toEngineParams,
} from "./product-executor.ts";
import { SubagentParams } from "./schemas.ts";
import { buildSubagentToolDescription } from "./tool-description.ts";

export { loadConfig } from "./config.ts";

// Retained only so sessions written by older Pi Stuff releases still render.
const COMPLETION_MESSAGE_TYPE = "pi-stuff-agent-complete";
const COMPLETION_ENTRY_TYPE = "pi-stuff-agent-outcome";
const RUNTIME_MAINTENANCE_SUCCESS_INTERVAL_MS = 60 * 60 * 1_000;
const RUNTIME_MAINTENANCE_FAILURE_RETRY_MS = 60 * 1_000;
const RUNTIME_CLEANUP_KEY = "__piStuffAgentsRootCleanup";

type CompletionOutcomeStatus = "completed" | "failed" | "stopped";

interface CompletionOutcomeEntry {
	readonly version: 1;
	readonly key: string;
	readonly count: number;
	readonly status: CompletionOutcomeStatus;
	readonly durationMs?: number;
}

interface RootExecutor {
	execute(
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
		hooks?: SubagentExecutionHooks,
	): Promise<AgentToolResult<Details>>;
}

interface RootTracker {
	ensureObserver(): void;
	handleComplete(data: unknown): void;
	handleProcessTerminal(data: unknown): void;
	handleStarted(data: unknown): void;
	handleStatus(data: unknown): void;
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

interface CompactCompletionNotifier {
	deliver(result: CompletionNotification, signal?: AbortSignal): Promise<boolean>;
	reset(entries: readonly SessionEntry[]): void;
	dispose(): void;
}

interface RootExecutorInput {
	readonly config: PiStuffAgentsConfig;
	readonly codeModeProviderTools?: readonly string[];
	readonly pi: ExtensionAPI;
	readonly projectContext: typeof projectCurrentContext;
	readonly resolveCodeModeEnabled?: () => boolean;
	readonly onForegroundStatus?: () => void;
	readonly state: SubagentState;
	readonly childBaseExtensionPath?: string;
}

interface RootWatcherInput {
	readonly notifier: CompactCompletionNotifier;
	readonly pi: ExtensionAPI;
	readonly state: SubagentState;
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
	readonly createExecutor: (input: RootExecutorInput) => RootExecutor;
	readonly createGovernorCoordinator: (config: PiStuffAgentsConfig) => AgentExecutionCoordinatorPort;
	readonly prepareGovernorCompatibility: (
		input: PrepareSessionGovernorCompatibilityInput,
	) => Promise<SessionGovernorCompatibilityResult>;
	readonly createRoster: (current: CurrentAgents, options: AgentRosterOptions) => ExtensionRootRoster;
	readonly createSupervisor: (pi: ExtensionAPI, state: SubagentState) => RootSupervisor;
	readonly createTracker: (pi: ExtensionAPI, state: SubagentState, onRefresh: () => void) => RootTracker;
	readonly createWatcher: (input: RootWatcherInput) => RootWatcher;
	readonly ensureDirectory: (directory: string) => void;
	readonly getCoordinator: (pi: ExtensionAPI) => CommandDialogCoordinator;
	readonly isChildProcess: () => boolean;
	readonly loadConfiguration: () => PiStuffAgentsConfig;
	readonly maintainRuntime: () => unknown | Promise<unknown>;
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
			tempArtifactsDir: getArtifactsDir(null),
			getSubagentSessionRoot,
			expandTilde,
			discoverAgents,
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
	createTracker: (pi, state, onRefresh) => {
		const tracker = createAsyncJobTracker(pi, state, ASYNC_DIR, { onRefresh });
		return {
			ensureObserver: tracker.ensureObserver,
			handleComplete: tracker.handleComplete,
			handleProcessTerminal: tracker.handleProcessTerminal,
			handleStarted: tracker.handleStarted,
			handleStatus: tracker.handleStatus,
			resetJobs: () => tracker.resetJobs(),
			restoreActiveJobs: () => tracker.restoreActiveJobs(),
		};
	},
	createWatcher: ({ notifier, pi, state }) =>
		createResultWatcher(pi, state, RESULTS_DIR, 10 * 60 * 1_000, {
			notifier,
			deliverIntercomResults: true,
		}),
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
	return {
		baseCwd: "",
		currentSessionId: null,
		currentSessionScope: null,
		...(config.artifactDir ? { artifactDirPreference: config.artifactDir } : {}),
		parentSessionFile: null,
		subagentInProgress: false,
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
}

function record(value: unknown): Record<string, unknown> {
	return isRuntimeObject(value) && value !== null ? (value as Record<string, unknown>) : {};
}

function completionState(value: Record<string, unknown>, fallback: CompletionNotification): CompletionOutcomeStatus {
	const explicitState = isRuntimeString(value.status)
		? value.status
		: isRuntimeString(value.state)
			? value.state
			: undefined;
	if (
		["cancelled", "detached", "paused", "stopped"].includes(explicitState ?? "") ||
		value.stopped === true ||
		value.interrupted === true
	) {
		return "stopped";
	}
	if (explicitState === "crashed" || explicitState === "failed") return "failed";
	if (isRuntimeBoolean(value.success)) return value.success ? "completed" : "failed";
	if (explicitState !== undefined) return "completed";
	if (
		["cancelled", "detached", "paused", "stopped"].includes(fallback.state ?? "") ||
		fallback.stopped === true ||
		fallback.interrupted === true
	)
		return "stopped";
	if (fallback.state === "crashed" || fallback.state === "failed") return "failed";
	const success = fallback.success;
	return success === false ? "failed" : "completed";
}

function completionKey(result: CompletionNotification): string {
	const identity = JSON.stringify([result.sessionId, result.id, result.runId, result.taskIndex, result.timestamp]);
	return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function completionDuration(result: CompletionNotification): number | undefined {
	const duration = isRuntimeNumber(result.durationMs)
		? result.durationMs
		: isRuntimeNumber(result.startedAt) && isRuntimeNumber(result.endedAt)
			? result.endedAt - result.startedAt
			: undefined;
	return duration !== undefined && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
}

function completionOutcome(result: CompletionNotification, key: string): CompletionOutcomeEntry {
	const raw = record(result);
	const children = Array.isArray(raw.results) && raw.results.length > 0 ? raw.results.map(record) : [raw];
	const states = children.map((child) => completionState(child, result));
	const status = states.includes("failed") ? "failed" : states.includes("stopped") ? "stopped" : "completed";
	const durationMs = completionDuration(result);
	return {
		version: 1,
		key,
		count: children.length,
		status,
		...(durationMs !== undefined ? { durationMs } : {}),
	};
}

function formatDuration(durationMs: number | undefined): string | undefined {
	if (durationMs === undefined) return undefined;
	const seconds = Math.max(1, Math.round(durationMs / 1_000));
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(remainder)}s`;
}

function completionOutcomeText(data: CompletionOutcomeEntry): string {
	const subject = data.count === 1 ? "Agent" : `${String(data.count)} Agents`;
	const verb = data.status === "completed" ? "finished" : data.status;
	return [`${subject} ${verb}`, formatDuration(data.durationMs), "inspect with /agents"].filter(Boolean).join(" · ");
}

function createCompactCompletionNotifier(
	pi: Pick<ExtensionAPI, "appendEntry">,
	state: Pick<SubagentState, "currentSessionId" | "currentSessionScope">,
	coordinator: Pick<CommandDialogCoordinator, "whenIdle">,
): CompactCompletionNotifier {
	const delivered = new Set<string>();
	let disposed = false;
	return {
		async deliver(result, signal) {
			if (
				disposed ||
				result.intercomDelivered === true ||
				!isRuntimeString(result.sessionId) ||
				!sessionArtifactMatches(state.currentSessionScope, result.sessionId, result.runId ?? result.id)
			) {
				return result.intercomDelivered === true;
			}
			const key = completionKey(result);
			if (delivered.has(key)) return true;
			try {
				await Promise.race([
					coordinator.whenIdle(),
					new Promise<void>((_, reject) => {
						if (signal?.aborted) return reject(signal.reason ?? new Error("Completion delivery cancelled."));
						signal?.addEventListener(
							"abort",
							() => reject(signal.reason ?? new Error("Completion delivery cancelled.")),
							{ once: true },
						);
					}),
				]);
				const alreadyDelivered = delivered.has(key);
				if (
					signal?.aborted ||
					disposed ||
					!sessionArtifactMatches(state.currentSessionScope, result.sessionId, result.runId ?? result.id) ||
					alreadyDelivered
				)
					return alreadyDelivered;
				// Custom entries persist and render with the session but are excluded from
				// model context, so completion cannot create an unsolicited main turn.
				pi.appendEntry<CompletionOutcomeEntry>(COMPLETION_ENTRY_TYPE, completionOutcome(result, key));
				delivered.add(key);
				return true;
			} catch {
				return false;
			}
		},
		reset(entries) {
			delivered.clear();
			for (const entry of entries) {
				if (entry.type !== "custom" || entry.customType !== COMPLETION_ENTRY_TYPE) continue;
				const data = record(entry.data);
				if (data.version === 1 && isRuntimeString(data.key)) delivered.add(data.key);
			}
		},
		dispose() {
			disposed = true;
			delivered.clear();
		},
	};
}

function firstText(result: AgentToolResult<Details>): string {
	return result.content
		.filter(
			(
				entry: AgentToolResult<Details>["content"][number],
			): entry is Extract<AgentToolResult<Details>["content"][number], { type: "text" }> => entry.type === "text",
		)
		.map((entry: Extract<AgentToolResult<Details>["content"][number], { type: "text" }>) => entry.text)
		.join("\n")
		.trim();
}

function resultIsError(result: unknown): boolean {
	return record(result).isError === true;
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

	const globalStore = globalThis as Record<string, unknown>;
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
	});
	const executionGovernor = deps.createGovernorCoordinator(config);
	const tracker = deps.createTracker(pi, state, () => current.refresh());
	const supervisor = deps.createSupervisor(pi, state);
	const notifier = createCompactCompletionNotifier(pi, state, coordinator);
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
	let releaseLegacyGovernorBarrier: (() => Promise<void>) | undefined;
	let maintenanceTimer: ReturnType<typeof setTimeout> | undefined;
	let maintenanceInFlight = false;
	let nextMaintenanceAt = 0;
	let ephemeralSessionNonce = randomUUID();
	let executePublicAgent!: (
		id: string,
		params: PublicAgentParams,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
		parentRunOrigin: AgentWorkOrigin,
	) => Promise<AgentToolResult<Details>>;
	let activateCurrentSessionRuntime!: (ctx: ExtensionContext) => Promise<void>;
	let recoverCurrentSessionHistory!: (ctx: ExtensionContext) => Promise<void>;

	const showAgents = async (ctx: ExtensionContext, initialKey?: string): Promise<void> => {
		if (!ctx.hasUI) return Promise.resolve();
		await activateCurrentSessionRuntime(ctx);
		await recoverCurrentSessionHistory(ctx);
		return deps.openDialog(ctx, coordinator, current, {
			...(initialKey ? { initialKey } : {}),
			readTranscript: readAgentTranscript,
		});
	};

	const contextForControl = (): ExtensionContext | null => state.lastUiContext;
	const runEngineControl = async (
		row: AgentRow,
		action: "resume" | "steer" | "stop",
		message?: string,
	): Promise<AgentControlAcknowledgement> => {
		const ctx = contextForControl();
		if (!ctx) return { acknowledged: false, message: "No active parent session is available." };
		const params: PublicAgentParams = {
			action,
			id: row.runId,
			index: row.childIndex,
			...(message ? { message } : {}),
		};
		const result = await executePublicAgent(
			deps.randomId(),
			params,
			new AbortController().signal,
			undefined,
			ctx,
			"user",
		);
		current.refresh();
		return {
			acknowledged: !resultIsError(result),
			message:
				firstText(result) || (resultIsError(result) ? "Agent request failed." : "Agent request acknowledged."),
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
					if (result.ok && result.releaseLegacyBarrier) {
						await releaseLegacyGovernorBarrier?.();
						releaseLegacyGovernorBarrier = result.releaseLegacyBarrier;
					}
					governorCompatibilityReady = result.ok;
					governorCompatibilityError = result.ok ? undefined : result.message;
				} else if (result.ok) await result.releaseLegacyBarrier?.();
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

	const governorFailureResult = (params: PublicAgentParams, message: string): AgentToolResult<Details> =>
		({
			content: [{ type: "text", text: message }],
			isError: true,
			details: {
				mode: params.action ? "management" : params.tasks?.length ? "parallel" : "single",
				results: [],
			},
		}) as AgentToolResult<Details>;

	executePublicAgent = async (id, params, signal, onUpdate, ctx, parentRunOrigin) => {
		const requestedEpoch = sessionEpoch;
		const requestedSessionId = state.currentSessionId;
		await activateCurrentSessionRuntime(ctx);
		if (!active || requestedEpoch !== sessionEpoch || state.currentSessionId !== requestedSessionId) {
			return projectEngineResult(
				params,
				governorFailureResult(params, "Agent request cancelled because the parent session ended or changed."),
			);
		}
		if ((!params.action || params.action === "resume") && !governorCompatibilityReady) {
			await refreshGovernorCompatibility(ctx);
			if (!active || requestedEpoch !== sessionEpoch || state.currentSessionId !== requestedSessionId) {
				return projectEngineResult(
					params,
					governorFailureResult(params, "Agent request cancelled because the parent session ended or changed."),
				);
			}
			if (!governorCompatibilityReady) {
				return projectEngineResult(
					params,
					governorFailureResult(
						params,
						governorCompatibilityError ??
							"Agent launches are paused because governor compatibility was not verified for this session.",
					),
				);
			}
		}
		const launchIdentity = {
			// The header id differentiates a newly-created session that intentionally
			// reuses an old --session path without changing the persisted compatibility
			// namespace used to cold-resume existing Agent artifacts.
			sessionId: `${
				state.currentSessionId ??
				resolveCurrentSessionIdentity(ctx.sessionManager, ctx.cwd, ephemeralSessionNonce).sessionId
			}\0header:${ctx.sessionManager.getSessionId() ?? "unknown"}`,
			ownerAgentPath: parseAgentOwnerPath(process.env[PI_STUFF_AGENT_PATH_ENV]),
		};
		const launchRunId = deriveLaunchRunId(id, launchIdentity);
		const invocationEpoch = sessionEpoch;
		const invocationSessionId = state.currentSessionId;
		const nestedControl = await routeLiveNestedAgentControl(params, state, signal, { parentRunOrigin });
		if (nestedControl) return projectEngineResult(params, nestedControl);
		let resumeTargetRunId: string | undefined;
		try {
			resumeTargetRunId = resolveResumeTargetRunId(params, state);
		} catch (error) {
			return projectEngineResult(
				params,
				governorFailureResult(params, error instanceof Error ? error.message : String(error)),
			);
		}
		const prepared = await executionGovernor.prepare({
			launchRunId,
			params,
			...(resumeTargetRunId ? { resumeTargetRunId } : {}),
		});
		if (!prepared.ok) return projectEngineResult(params, governorFailureResult(params, prepared.message));
		const invocation: AgentExecutionInvocation | undefined = prepared.invocation;
		if (!active || invocationEpoch !== sessionEpoch || state.currentSessionId !== invocationSessionId) {
			if (invocation) {
				try {
					await executionGovernor.fail(invocation);
				} catch (error) {
					reportAgentDiagnostic("Failed to release a cancelled Agent launch reservation:", error);
				}
			}
			return projectEngineResult(
				params,
				governorFailureResult(params, "Agent launch cancelled because the parent session ended or changed."),
			);
		}
		let foregroundStarted = false;
		try {
			if (invocation) {
				startRunRuntime({ createDirectories: true, primeExisting: true });
			}
			const engineParams = { ...toEngineParams(params), launchRunId };
			const result = await executor.execute(
				id,
				engineParams,
				signal,
				onUpdate
					? (update) => {
							current.refresh();
							onUpdate(projectEngineResult(params, update));
						}
					: undefined,
				ctx,
				{
					parentRunOrigin,
					...(invocation && params.foreground === true
						? {
								beforeForegroundStart: async ({ runId, asyncDir, abortStart }) => {
									await executionGovernor.observeAsyncStarted({
										id: runId,
										pid: process.pid,
										asyncDir,
										abortStart,
									});
									foregroundStarted = true;
								},
							}
						: {}),
				},
			);
			if (
				invocation &&
				(!active || invocationEpoch !== sessionEpoch || state.currentSessionId !== invocationSessionId)
			) {
				if (params.foreground === true && foregroundStarted) {
					try {
						// The foreground engine already ran under the original session's
						// durable authority. Settle its real terminal/detached children even
						// though the obsolete UI call now returns a session-ended message.
						await executionGovernor.settle(invocation, result);
					} catch (error) {
						reportAgentDiagnostic("Failed to settle a session-changed foreground Agent result:", error);
					}
				} else {
					const binding = result.details.lifecycleBinding;
					let safeToRelease = !binding && !result.details.asyncId;
					if (binding?.abortStart) {
						try {
							safeToRelease = binding.abortStart();
						} catch (error) {
							// A failed abort is not proof that the runner stopped. Keep the
							// original session's durable governor authority fail-closed.
							reportAgentDiagnostic("Failed to abort a session-changed Agent runtime:", error);
							safeToRelease = false;
						}
					}
					if (safeToRelease) {
						try {
							await executionGovernor.fail(invocation);
						} catch (error) {
							reportAgentDiagnostic("Failed to release a session-changed Agent reservation:", error);
						}
					} else {
						try {
							// The exact runner could not be proven stopped. Bind it to the
							// original session ledger so later physical recovery retains authority.
							await executionGovernor.settle(invocation, result);
						} catch (error) {
							reportAgentDiagnostic("Failed to retain a session-changed Agent runtime binding:", error);
						}
					}
				}
				return projectEngineResult(
					params,
					governorFailureResult(params, "Agent launch cancelled because the parent session ended or changed."),
				);
			}
			if (invocation) {
				try {
					await executionGovernor.settle(invocation, result);
				} catch (error) {
					if (error instanceof AgentRuntimeBindingRejectedError) {
						return projectEngineResult(params, governorFailureResult(params, error.message));
					}
					// The engine result may represent an already-running detached Agent.
					// Never convert post-launch ledger failure into a start failure or
					// release its lease; completion/reconciliation remains authoritative.
					reportAgentDiagnostic(
						"Failed to persist the launched Agent lease binding; retaining it for reconciliation:",
						error,
					);
				}
			}
			return projectEngineResult(params, result);
		} catch (error) {
			if (invocation) {
				try {
					await executionGovernor.fail(invocation);
				} catch (releaseError) {
					reportAgentDiagnostic(
						"Failed to release an Agent reservation after engine launch failure:",
						releaseError,
					);
				}
			}
			throw error;
		} finally {
			scheduleRuntimeMaintenance();
			current.refresh();
		}
	};

	const tool: ToolDefinition<typeof SubagentParams, Details> = {
		name: "subagent",
		label: "Agent",
		description: buildSubagentToolDescription(),
		parameters: SubagentParams,
		async execute(id, rawParams, signal, onUpdate, ctx) {
			let params: PublicAgentParams;
			try {
				params = normalizePublicAgentParams(rawParams as PublicAgentParams);
			} catch (error) {
				const supplied = rawParams as PublicAgentParams;
				return projectEngineResult(
					supplied,
					governorFailureResult(supplied, error instanceof Error ? error.message : String(error)),
				);
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

	registerSuiteOwnedTool(pi, tool, createAgentToolPresentation());
	pi.registerCommand("agents", {
		description: "Inspect and control Agents in the current session",
		handler: async (_args, ctx) => showAgents(ctx),
	});
	pi.registerMessageRenderer(COMPLETION_MESSAGE_TYPE, (message, _options, theme) => {
		const content = isRuntimeString(message.content) ? message.content : "";
		return new Text(theme.fg("text", content), 0, 0);
	});
	pi.registerEntryRenderer<CompletionOutcomeEntry>(COMPLETION_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (data?.version !== 1) return undefined;
		return new CachedToolRow(theme, {
			active: false,
			expandable: false,
			hint: "",
			kind: "activity",
			outcome: data.status === "completed" ? "success" : data.status === "failed" ? "error" : "stopped",
			summary: completionOutcomeText(data),
		});
	});

	const eventUnsubscribes: Array<() => void> = [];
	const onBus = (event: string, handler: (data: unknown) => void): void => {
		const unsubscribe = pi.events.on(event, handler);
		if (isRuntimeFunction(unsubscribe)) eventUnsubscribes.push(unsubscribe);
	};
	const belongsToCurrentSession = (data: unknown): boolean => {
		if (!data || !isRuntimeObject(data)) return false;
		const event = data as { sessionId?: unknown; runId?: unknown; id?: unknown };
		return sessionArtifactMatches(state.currentSessionScope, event.sessionId, event.runId ?? event.id);
	};
	const normalizeCurrentSessionEvent = (data: unknown): unknown =>
		data && isRuntimeObject(data) && state.currentSessionId
			? { ...(data as Record<string, unknown>), sessionId: state.currentSessionId }
			: data;
	onBus(SUBAGENT_ASYNC_STARTED_EVENT, (data) => {
		if (!active || !belongsToCurrentSession(data)) return;
		const normalized = normalizeCurrentSessionEvent(data);
		void executionGovernor.observeAsyncStarted(normalized).catch((error) => {
			reportAgentDiagnostic("Failed to bind Agent governor runtime identity:", error);
		});
		tracker.handleStarted(normalized);
		current.refresh();
	});
	onBus(SUBAGENT_ASYNC_STATUS_EVENT, (data) => {
		if (!active || !belongsToCurrentSession(data)) return;
		tracker.handleStatus(normalizeCurrentSessionEvent(data));
	});
	onBus(SUBAGENT_ASYNC_COMPLETE_EVENT, (data) => {
		if (!active || !belongsToCurrentSession(data)) return;
		const normalized = normalizeCurrentSessionEvent(data);
		void executionGovernor.complete(normalized).catch((error) => {
			reportAgentDiagnostic("Failed to release completed background Agent lease:", error);
		});
		tracker.handleComplete(normalized);
		current.refresh();
		if ((normalized as CompletionNotification).parentRunOrigin === "user") {
			requestStatuslineGitRefreshAfterUserWork(pi);
		}
	});
	onBus(SUBAGENT_FOREGROUND_COMPLETE_EVENT, (data) => {
		if (!active || !belongsToCurrentSession(data)) return;
		void executionGovernor.complete(normalizeCurrentSessionEvent(data)).catch((error) => {
			reportAgentDiagnostic("Failed to release completed foreground Agent lease:", error);
		});
		// Foreground summaries already return through the active tool call. A
		// completion message here would trigger a duplicate main-model turn.
		current.refresh();
	});
	onBus(SUBAGENT_PROCESS_TERMINAL_EVENT, (data) => {
		if (!active || !belongsToCurrentSession(data)) return;
		tracker.handleProcessTerminal(normalizeCurrentSessionEvent(data));
		void executionGovernor.reconcileDead().catch((error) => {
			reportAgentDiagnostic("Failed to reconcile Agent leases after a runner terminal event:", error);
		});
	});

	const refreshFromTool = (event: { toolName?: string }, ctx: ExtensionContext): void => {
		if (!active || event.toolName !== "subagent") return;
		bindContext(ctx);
		current.refresh();
	};
	pi.on("tool_execution_start", refreshFromTool);
	pi.on("tool_execution_update", refreshFromTool);
	pi.on("tool_execution_end", refreshFromTool);
	pi.on("tool_result", refreshFromTool);

	pi.on("session_start", async (_event, ctx) => {
		if (!active) return;
		await previousCleanupPromise;
		sessionEpoch += 1;
		// A legacy compatibility barrier belongs to exactly one parent session.
		// Release it before rebinding state so A→B→A cannot deadlock against this
		// extension instance's own stale A lock.
		await releaseLegacyGovernorBarrier?.();
		releaseLegacyGovernorBarrier = undefined;
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
		for (const unsubscribe of eventUnsubscribes.splice(0)) {
			try {
				unsubscribe();
			} catch {
				// Event-bus teardown is best effort after the host has begun shutdown.
			}
		}
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
		const releaseBarrier = releaseLegacyGovernorBarrier;
		releaseLegacyGovernorBarrier = undefined;
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
		await releaseBarrier?.();
	};

	globalStore[RUNTIME_CLEANUP_KEY] = cleanup;
	pi.on("session_shutdown", cleanup);
}
