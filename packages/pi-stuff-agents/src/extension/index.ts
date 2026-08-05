import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { projectCurrentContext } from "@jczhang02/pi-stuff-context";
import { registerSuiteOwnedTool } from "@jczhang02/pi-stuff-tools";
import {
	type CommandDialogCoordinator,
	getCommandDialogCoordinator,
	requestStatuslineGitRefresh,
} from "@jczhang02/pi-stuff-ui";
import { discoverAgents } from "../agents/agents.ts";
import { createNativeSupervisorChannel } from "../intercom/native-supervisor-channel.ts";
import { createAsyncJobTracker } from "../runs/background/async-job-tracker.ts";
import type { CompletionNotification } from "../runs/background/notify.ts";
import { createResultWatcher } from "../runs/background/result-watcher.ts";
import {
	createSubagentExecutor,
	deriveLaunchRunId,
	type SubagentParamsLike,
} from "../runs/foreground/subagent-executor.ts";
import { PI_STUFF_AGENT_PATH_ENV, SUBAGENT_CHILD_ENV, SUBAGENT_PARENT_SESSION_ENV } from "../runs/shared/pi-args.ts";
import {
	type AgentExecutionCoordinatorPort,
	type AgentExecutionInvocation,
	createDurableAgentExecutionCoordinator,
	parseAgentOwnerPath,
} from "../runtime/agent-execution-coordinator.ts";
import {
	type AgentControlAcknowledgement,
	type AgentRow,
	CurrentAgents,
	type CurrentAgentsOptions,
} from "../session/current-agents.ts";
import { ensureAccessibleDir } from "../shared/accessible-dir.ts";
import { getArtifactsDir } from "../shared/artifacts.ts";
import { resolveCurrentSessionId } from "../shared/session-identity.ts";
import {
	ASYNC_DIR,
	type Details,
	RESULTS_DIR,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	type SubagentState,
	TEMP_ROOT_DIR,
} from "../shared/types.ts";
import { type AgentDialogOptions, openAgentDialog } from "../ui/agent-dialog.ts";
import { AgentRoster, type AgentRosterOptions } from "../ui/agent-roster.ts";
import { readAgentTranscript } from "../ui/agent-transcript.ts";
import { createAgentToolPresentation } from "./agent-tool-presentation.ts";
import { loadConfig, type PiStuffAgentsConfig } from "./config.ts";
import { type PublicAgentParams, projectEngineResult, toEngineParams } from "./product-executor.ts";
import { SubagentParams } from "./schemas.ts";
import { buildSubagentToolDescription } from "./tool-description.ts";

export { loadConfig } from "./config.ts";

// Retained only so sessions written by older Pi Stuff releases still render.
const COMPLETION_MESSAGE_TYPE = "pi-stuff-agent-complete";
const COMPLETION_ENTRY_TYPE = "pi-stuff-agent-outcome";
const ROSTER_REFRESH_MS = 250;
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
	): Promise<AgentToolResult<Details>>;
}

interface RootTracker {
	ensurePoller(): void;
	handleComplete(data: unknown): void;
	handleStarted(data: unknown): void;
	resetJobs(): void;
	restoreActiveJobs(): void;
}

interface RootWatcher {
	primeExistingResults(options?: { triggerTurn?: boolean }): void;
	startResultWatcher(): void;
	stopResultWatcher(): void;
}

interface RootSupervisor {
	dispose(): void;
	start(): void;
}

interface CompactCompletionNotifier {
	deliver(result: CompletionNotification): Promise<boolean>;
	dispose(): void;
}

interface RootExecutorInput {
	readonly config: PiStuffAgentsConfig;
	readonly pi: ExtensionAPI;
	readonly projectContext: typeof projectCurrentContext;
	readonly state: SubagentState;
}

interface RootWatcherInput {
	readonly notifier: CompactCompletionNotifier;
	readonly pi: ExtensionAPI;
	readonly state: SubagentState;
}

/** Narrow seams keep the production root auditable and the host contract testable. */
export interface ExtensionRootDependencies {
	readonly createCurrentAgents: (state: SubagentState, options: CurrentAgentsOptions) => CurrentAgents;
	readonly createExecutor: (input: RootExecutorInput) => RootExecutor;
	readonly createGovernorCoordinator: (config: PiStuffAgentsConfig) => AgentExecutionCoordinatorPort;
	readonly createRoster: (current: CurrentAgents, options: AgentRosterOptions) => AgentRoster;
	readonly createSupervisor: (pi: ExtensionAPI, state: SubagentState) => RootSupervisor;
	readonly createTracker: (pi: ExtensionAPI, state: SubagentState) => RootTracker;
	readonly createWatcher: (input: RootWatcherInput) => RootWatcher;
	readonly ensureDirectory: (directory: string) => void;
	readonly getCoordinator: (pi: ExtensionAPI) => CommandDialogCoordinator;
	readonly isChildProcess: () => boolean;
	readonly loadConfiguration: () => PiStuffAgentsConfig;
	readonly openDialog: (
		ctx: ExtensionContext,
		coordinator: CommandDialogCoordinator,
		current: CurrentAgents,
		options: AgentDialogOptions,
	) => Promise<void>;
	readonly projectContext: typeof projectCurrentContext;
	readonly randomId: () => string;
	readonly timers: {
		clearInterval(handle: ReturnType<typeof setInterval>): void;
		setInterval(handler: () => void, delayMs: number): ReturnType<typeof setInterval>;
	};
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
	createExecutor: ({ config, pi, projectContext, state }) =>
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
		}),
	createGovernorCoordinator: (config) =>
		createDurableAgentExecutionCoordinator({
			rootDir: path.join(TEMP_ROOT_DIR, "session-governor"),
			limits: {
				maxDepth: config.maxSubagentDepth,
				maxRunning: config.maxRunningAgents,
				maxTotal: config.maxAgentsPerSession,
			},
		}),
	createRoster: (current, options) => new AgentRoster(current, options),
	createSupervisor: (pi, state) => createNativeSupervisorChannel(pi, state),
	createTracker: (pi, state) => {
		const tracker = createAsyncJobTracker(pi, state, ASYNC_DIR);
		return {
			ensurePoller: tracker.ensurePoller,
			handleComplete: tracker.handleComplete,
			handleStarted: tracker.handleStarted,
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
	openDialog: openAgentDialog,
	projectContext: projectCurrentContext,
	randomId: randomUUID,
	timers: {
		clearInterval,
		setInterval,
	},
};

function createState(config: PiStuffAgentsConfig): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: null,
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
		poller: null,
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
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function completionState(value: Record<string, unknown>, fallback: CompletionNotification): CompletionOutcomeStatus {
	const state =
		typeof value.status === "string" ? value.status : typeof value.state === "string" ? value.state : fallback.state;
	if (
		["cancelled", "detached", "paused", "stopped"].includes(state ?? "") ||
		value.stopped === true ||
		value.interrupted === true ||
		fallback.stopped === true ||
		fallback.interrupted === true
	) {
		return "stopped";
	}
	if (state === "crashed" || state === "failed") return "failed";
	const success = typeof value.success === "boolean" ? value.success : fallback.success;
	return success === false ? "failed" : "completed";
}

function completionKey(result: CompletionNotification): string {
	const identity = JSON.stringify([result.sessionId, result.id, result.runId, result.taskIndex, result.timestamp]);
	return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function completionDuration(result: CompletionNotification): number | undefined {
	const duration =
		typeof result.durationMs === "number"
			? result.durationMs
			: typeof result.startedAt === "number" && typeof result.endedAt === "number"
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

function isPersistedCompletion(state: Pick<SubagentState, "lastUiContext">, key: string): boolean {
	const entries = state.lastUiContext?.sessionManager.getEntries() ?? [];
	return entries.some((entry) => {
		if (entry.type !== "custom" || entry.customType !== COMPLETION_ENTRY_TYPE) return false;
		const data = record(entry.data);
		return data.version === 1 && data.key === key;
	});
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
	state: Pick<SubagentState, "currentSessionId" | "lastUiContext">,
	coordinator: Pick<CommandDialogCoordinator, "whenIdle">,
): CompactCompletionNotifier {
	const delivered = new Set<string>();
	let disposed = false;
	return {
		async deliver(result) {
			if (
				disposed ||
				result.intercomDelivered === true ||
				typeof result.sessionId !== "string" ||
				result.sessionId !== state.currentSessionId
			) {
				return result.intercomDelivered === true;
			}
			const key = completionKey(result);
			if (delivered.has(key) || isPersistedCompletion(state, key)) return true;
			try {
				await coordinator.whenIdle();
				const alreadyDelivered = delivered.has(key) || isPersistedCompletion(state, key);
				if (disposed || result.sessionId !== state.currentSessionId || alreadyDelivered) return alreadyDelivered;
				// Custom entries persist and render with the session but are excluded from
				// model context, so completion cannot create an unsolicited main turn.
				pi.appendEntry<CompletionOutcomeEntry>(COMPLETION_ENTRY_TYPE, completionOutcome(result, key));
				delivered.add(key);
				return true;
			} catch {
				return false;
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
	return [...state.asyncJobs.values()].some((job) => job.status === "queued" || job.status === "running");
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
	if (typeof previousCleanup === "function") {
		try {
			previousCleanup();
		} catch {
			// A stale reload must not prevent the replacement root from registering.
		}
	}

	const config = deps.loadConfiguration();
	const state = createState(config);
	const coordinator = deps.getCoordinator(pi);
	const executor = deps.createExecutor({ config, pi, projectContext: deps.projectContext, state });
	const executionGovernor = deps.createGovernorCoordinator(config);
	const tracker = deps.createTracker(pi, state);
	const supervisor = deps.createSupervisor(pi, state);
	const notifier = createCompactCompletionNotifier(pi, state, coordinator);
	const watcher = deps.createWatcher({ notifier, pi, state });
	let active = true;
	let launchCallsInFlight = 0;
	let rosterRefreshTimer: ReturnType<typeof setInterval> | undefined;
	let watcherStarted = false;
	let executePublicAgent!: (
		id: string,
		params: PublicAgentParams,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
	) => Promise<AgentToolResult<Details>>;

	let current!: CurrentAgents;
	const showAgents = (ctx: ExtensionContext, initialKey?: string): Promise<void> => {
		if (!ctx.hasUI) return Promise.resolve();
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
		const result = await executePublicAgent(deps.randomId(), params, new AbortController().signal, undefined, ctx);
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

	const stopRosterRefresh = (): void => {
		if (!rosterRefreshTimer) return;
		deps.timers.clearInterval(rosterRefreshTimer);
		rosterRefreshTimer = undefined;
	};

	const ensureRosterRefresh = (): void => {
		if (rosterRefreshTimer || (!hasLiveWork(state) && launchCallsInFlight === 0)) return;
		rosterRefreshTimer = deps.timers.setInterval(() => {
			if (!active) return stopRosterRefresh();
			current.refresh();
			if (!hasLiveWork(state) && launchCallsInFlight === 0) stopRosterRefresh();
		}, ROSTER_REFRESH_MS);
		rosterRefreshTimer.unref?.();
	};

	const startRunRuntime = (primeExisting: boolean): void => {
		if (watcherStarted) return;
		deps.ensureDirectory(RESULTS_DIR);
		deps.ensureDirectory(ASYNC_DIR);
		watcher.startResultWatcher();
		watcherStarted = true;
		if (primeExisting) watcher.primeExistingResults({ triggerTurn: false });
	};

	const bindExecutionGovernor = (ctx: ExtensionContext): void => {
		const parentSessionId = ctx.sessionManager.getSessionId()?.trim();
		if (!parentSessionId) return;
		process.env[SUBAGENT_PARENT_SESSION_ENV] = parentSessionId;
		executionGovernor.bindSession({
			sessionId: parentSessionId,
			ownerAgentPath: parseAgentOwnerPath(process.env[PI_STUFF_AGENT_PATH_ENV]),
		});
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

	executePublicAgent = async (id, params, signal, onUpdate, ctx) => {
		bindContext(ctx);
		bindExecutionGovernor(ctx);
		const prepared = await executionGovernor.prepare({
			launchRunId: deriveLaunchRunId(id),
			params,
		});
		if (!prepared.ok) return projectEngineResult(params, governorFailureResult(params, prepared.message));
		const invocation: AgentExecutionInvocation | undefined = prepared.invocation;
		if (invocation) {
			startRunRuntime(false);
			launchCallsInFlight += 1;
			ensureRosterRefresh();
		}
		try {
			const engineParams = toEngineParams(params);
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
			);
			if (invocation) await executionGovernor.settle(invocation, result);
			return projectEngineResult(params, result);
		} catch (error) {
			if (invocation) await executionGovernor.fail(invocation);
			throw error;
		} finally {
			if (invocation) launchCallsInFlight = Math.max(0, launchCallsInFlight - 1);
			current.refresh();
			ensureRosterRefresh();
		}
	};

	const tool: ToolDefinition<typeof SubagentParams, Details> = {
		name: "subagent",
		label: "Agent",
		description: buildSubagentToolDescription(),
		parameters: SubagentParams,
		async execute(id, rawParams, signal, onUpdate, ctx) {
			const params = rawParams as PublicAgentParams;
			return executePublicAgent(id, params, signal ?? new AbortController().signal, onUpdate, ctx);
		},
	};

	registerSuiteOwnedTool(pi, tool, createAgentToolPresentation());
	pi.registerCommand("agents", {
		description: "Inspect and control Agents in the current session",
		handler: async (_args, ctx) => showAgents(ctx),
	});
	pi.registerMessageRenderer(COMPLETION_MESSAGE_TYPE, (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		return new Text(theme.fg("text", content), 0, 0);
	});
	pi.registerEntryRenderer<CompletionOutcomeEntry>(COMPLETION_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (data?.version !== 1) return undefined;
		const color = data.status === "completed" ? "success" : data.status === "failed" ? "error" : "muted";
		return new Text(`${theme.fg(color, "●")} ${theme.fg("muted", completionOutcomeText(data))}`, 0, 0);
	});

	const eventUnsubscribes: Array<() => void> = [];
	const onBus = (event: string, handler: (data: unknown) => void): void => {
		const unsubscribe = pi.events.on(event, handler);
		if (typeof unsubscribe === "function") eventUnsubscribes.push(unsubscribe);
	};
	onBus(SUBAGENT_ASYNC_STARTED_EVENT, (data) => {
		if (!active) return;
		void executionGovernor.observeAsyncStarted(data).catch((error) => {
			console.error("Failed to bind Agent governor runtime identity:", error);
		});
		tracker.handleStarted(data);
		current.refresh();
		ensureRosterRefresh();
	});
	onBus(SUBAGENT_ASYNC_COMPLETE_EVENT, (data) => {
		if (!active) return;
		void executionGovernor.complete(data).catch((error) => {
			console.error("Failed to release completed background Agent lease:", error);
		});
		tracker.handleComplete(data);
		current.refresh();
		ensureRosterRefresh();
		requestStatuslineGitRefresh(pi);
	});
	onBus(SUBAGENT_FOREGROUND_COMPLETE_EVENT, (data) => {
		if (!active) return;
		void executionGovernor.complete(data).catch((error) => {
			console.error("Failed to release completed foreground Agent lease:", error);
		});
		// Foreground summaries already return through the active tool call. A
		// completion message here would trigger a duplicate main-model turn.
		current.refresh();
	});

	const refreshFromTool = (event: { toolName?: string }, ctx: ExtensionContext): void => {
		if (!active || event.toolName !== "subagent") return;
		bindContext(ctx);
		current.refresh();
		ensureRosterRefresh();
	};
	pi.on("tool_execution_start", refreshFromTool);
	pi.on("tool_execution_update", refreshFromTool);
	pi.on("tool_execution_end", refreshFromTool);
	pi.on("tool_result", refreshFromTool);

	pi.on("session_start", async (_event, ctx) => {
		if (!active) return;
		stopRosterRefresh();
		watcher.stopResultWatcher();
		watcherStarted = false;
		tracker.resetJobs();
		state.foregroundRuns?.clear();
		state.baseCwd = ctx.cwd;
		state.currentSessionId = resolveCurrentSessionId(ctx.sessionManager);
		state.parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
		state.subagentSpawns = {
			sessionId: state.currentSessionId,
			count: 0,
			configuredLimit: config.maxAgentsPerSession,
			granted: 0,
			grantHistory: [],
		};
		bindExecutionGovernor(ctx);
		bindContext(ctx);
		tracker.restoreActiveJobs();
		try {
			await executionGovernor.reconcileExisting();
		} catch (error) {
			console.error("Failed to reconcile existing Agent leases:", error);
		}
		if (hasLiveWork(state)) {
			startRunRuntime(true);
			tracker.ensurePoller();
			ensureRosterRefresh();
		}
		current.refresh();
		supervisor.start();
	});

	const cleanup = (): void => {
		if (!active) return;
		active = false;
		stopRosterRefresh();
		watcher.stopResultWatcher();
		watcherStarted = false;
		for (const unsubscribe of eventUnsubscribes.splice(0)) {
			try {
				unsubscribe();
			} catch {
				// Event-bus teardown is best effort after the host has begun shutdown.
			}
		}
		if (state.poller) clearInterval(state.poller);
		state.poller = null;
		clearTimerMap(state);
		state.resultFileCoalescer.clear();
		state.asyncJobs.clear();
		state.recentAgentJobs?.clear();
		state.foregroundRuns?.clear();
		state.foregroundControls.clear();
		state.currentSessionId = null;
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
		if (globalStore[RUNTIME_CLEANUP_KEY] === cleanup) delete globalStore[RUNTIME_CLEANUP_KEY];
	};

	globalStore[RUNTIME_CLEANUP_KEY] = cleanup;
	pi.on("session_shutdown", cleanup);
}
