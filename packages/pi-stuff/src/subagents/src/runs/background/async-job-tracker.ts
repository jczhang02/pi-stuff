import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseJsonValue } from "../../../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { errnoCode, readOwnedFileTailAsync } from "../../shared/private-directory.ts";
import { sessionArtifactMatches } from "../../shared/session-identity.ts";
import {
	type AsyncJobState,
	type AsyncStartedEvent,
	type AsyncStatus,
	type ControlEvent,
	POLL_INTERVAL_MS,
	type ProcessTerminalV1,
	type SteeringNotice,
	SUBAGENT_CONTROL_EVENT,
	SUBAGENT_CONTROL_INTERCOM_EVENT,
	SUBAGENT_STEERING_NOTICE_EVENT,
	type SubagentState,
} from "../../shared/types.ts";
import { isTerminalAsyncState as isTerminalJobStatus, readStatusAsync } from "../../shared/utils.ts";
import { hasLiveNestedDescendants } from "../shared/nested-events.ts";
import { mapConcurrent } from "../shared/parallel-utils.ts";
import { formatControlNoticeMessage } from "../shared/subagent-control.ts";
import { readNewAsyncControlEvents } from "./async-control-events.ts";
import { normalizeParallelGroups } from "./parallel-groups.ts";

interface AsyncJobTrackerOptions {
	completionRetentionMs?: number;
	/** Used only when native file observation is unavailable. */
	pollIntervalMs?: number;
	onRefresh?: () => void;
	readRunStatus?: (asyncDir: string) => Promise<AsyncStatus | null> | AsyncStatus | null;
	watchRun?: typeof fs.watch;
}

const STATUS_WATCH_FALLBACK_DELAY_MS = 150;
const MAX_RECENT_AGENT_JOBS = 200;
const RESTORE_READ_CONCURRENCY = 8;
const MAX_LEGACY_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

interface TrackerEventRecord {
	readonly channels?: unknown;
	readonly childIntercomTarget?: unknown;
	readonly error?: unknown;
	readonly errorMessage?: unknown;
	readonly event?: unknown;
	readonly intercom?: unknown;
	readonly isError?: unknown;
	readonly message?: unknown;
	readonly noticeText?: unknown;
	readonly recordType?: unknown;
	readonly role?: unknown;
	readonly sourceEventType?: unknown;
	readonly stopReason?: unknown;
	readonly text?: unknown;
	readonly type?: unknown;
}

function record<Value>(value: Value): TrackerEventRecord {
	if (!isRuntimeObject(value) || value === null || Array.isArray(value)) return {};
	// SAFETY: consumers read only the declared raw fields and validate them before dispatch.
	return value as Value & TrackerEventRecord;
}

function ambiguousLegacyFinalDrain(step: NonNullable<AsyncStatus["steps"]>[number]): boolean {
	const terminal = step.processTerminal;
	if (step.error || step.status !== "failed" || terminal?.state !== "observed") return false;
	const writers = terminal.instances.filter(
		(instance): instance is Extract<(typeof terminal.instances)[number], { kind: "pi-writer" }> =>
			instance.kind === "pi-writer" && Number.isInteger(instance.attempt),
	);
	const finalAttempt = writers.reduce(
		(latest, instance) => Math.max(latest, instance.attempt),
		Number.NEGATIVE_INFINITY,
	);
	return writers.some(
		(instance) =>
			instance.attempt === finalAttempt &&
			instance.terminationOrigin === undefined &&
			(instance.signal === "SIGTERM" || (instance.signal === null && instance.exitCode === 143)),
	);
}

async function recoverLegacyFinalReports(status: AsyncStatus): Promise<AsyncStatus> {
	if (status.state !== "failed" || !status.steps?.some(ambiguousLegacyFinalDrain)) return status;
	let changed = false;
	const steps = await mapConcurrent(status.steps, 4, async (step) => {
		if (!ambiguousLegacyFinalDrain(step) || !step.transcriptPath || !path.isAbsolute(step.transcriptPath))
			return step;
		try {
			const tail = await readOwnedFileTailAsync(step.transcriptPath, MAX_LEGACY_TRANSCRIPT_TAIL_BYTES);
			const lastLine = tail.text.trimEnd().split("\n").at(-1);
			if (!lastLine) return step;
			const entry = record(parseJsonValue(lastLine));
			const message = record(entry.message);
			if (
				entry.recordType !== "message" ||
				entry.sourceEventType !== "message_end" ||
				entry.role !== "assistant" ||
				entry.stopReason !== "stop" ||
				entry.isError === true ||
				!isRuntimeString(entry.text) ||
				!entry.text.trim() ||
				isRuntimeString(entry.error) ||
				isRuntimeString(entry.errorMessage) ||
				isRuntimeString(message.errorMessage)
			)
				return step;
			changed = true;
			return { ...step, legacyFinalReportComplete: true as const };
		} catch {
			return step;
		}
	});
	return changed ? { ...status, steps } : status;
}

function physicalTerminalPending(job: AsyncJobState): boolean {
	return job.processTerminal !== undefined && job.processTerminal.state !== "observed";
}

function rememberRecentAgentJob(state: SubagentState, job: AsyncJobState): void {
	state.recentAgentJobs ??= new Map();
	state.recentAgentJobs.set(job.asyncId, job);
	const terminal = [...state.recentAgentJobs.values()]
		.filter((candidate) => isTerminalJobStatus(candidate.status))
		.sort((left, right) => (right.updatedAt ?? right.startedAt ?? 0) - (left.updatedAt ?? left.startedAt ?? 0));
	for (const stale of terminal.slice(MAX_RECENT_AGENT_JOBS)) state.recentAgentJobs.delete(stale.asyncId);
}

function contextSummary(steps: NonNullable<AsyncStatus["steps"]>): AsyncJobState["context"] {
	const contexts = new Set(steps.map((step) => step.context).filter((value) => value !== undefined));
	if (contexts.size > 1) return "mixed";
	return contexts.values().next().value;
}

export function createAsyncJobTracker(
	pi: Pick<ExtensionAPI, "events">,
	state: SubagentState,
	asyncDirRoot: string,
	options: AsyncJobTrackerOptions = {},
) {
	const completionRetentionMs = options.completionRetentionMs ?? 10_000;
	const fallbackIntervalMs = options.pollIntervalMs ?? Math.max(3_000, POLL_INTERVAL_MS);
	const readRunStatus = options.readRunStatus ?? readStatusAsync;
	const watchRun = options.watchRun ?? fs.watch;
	const steeringNoticeSeen = new Map<string, number>();
	const watchers = new Map<string, fs.FSWatcher>();
	const fallbackTimers = new Map<string, ReturnType<typeof setInterval>>();
	const statusFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const observations = new Map<
		string,
		{ running: boolean; status: boolean; control: boolean; retryTimer?: ReturnType<typeof setTimeout> }
	>();
	const lastIpcStatusAt = new Map<string, number>();
	let trackerGeneration = 0;
	let refreshScheduled = false;
	let restoreInFlight:
		| { readonly controller: AbortController; readonly generation: number; promise: Promise<void> }
		| undefined;
	let restoredGeneration = -1;

	const normalizeAcceptedSessionId = <SessionId, RunId>(sessionId: SessionId, runId: RunId): string | undefined => {
		if (!state.currentSessionId || !isRuntimeString(sessionId)) return undefined;
		if (sessionId === state.currentSessionId) return state.currentSessionId;
		const artifactRunId = isRuntimeString(runId) ? runId : undefined;
		return state.currentSessionScope && sessionArtifactMatches(state.currentSessionScope, sessionId, artifactRunId)
			? state.currentSessionId
			: undefined;
	};
	const emitLifecycleEvent = <Payload extends object>(event: string, payload: Payload): void => {
		try {
			pi.events.emit(event, payload);
		} catch (error) {
			reportAgentDiagnostic(`Agent lifecycle observer '${event}' failed:`, error);
		}
	};
	const scheduleRefresh = (): void => {
		if (refreshScheduled) return;
		refreshScheduled = true;
		queueMicrotask(() => {
			refreshScheduled = false;
			options.onRefresh?.();
		});
	};
	const cancelCleanup = (asyncId: string): void => {
		const timer = state.cleanupTimers.get(asyncId);
		if (!timer) return;
		clearTimeout(timer);
		state.cleanupTimers.delete(asyncId);
	};
	const stopObservation = (asyncId: string): void => {
		watchers.get(asyncId)?.close();
		watchers.delete(asyncId);
		const fallback = fallbackTimers.get(asyncId);
		if (fallback) clearInterval(fallback);
		fallbackTimers.delete(asyncId);
		const statusFallback = statusFallbackTimers.get(asyncId);
		if (statusFallback) clearTimeout(statusFallback);
		statusFallbackTimers.delete(asyncId);
		const observation = observations.get(asyncId);
		if (observation?.retryTimer) clearTimeout(observation.retryTimer);
		observations.delete(asyncId);
		lastIpcStatusAt.delete(asyncId);
	};
	const scheduleCleanup = (job: AsyncJobState): void => {
		cancelCleanup(job.asyncId);
		const expectedGeneration = trackerGeneration;
		const timer = setTimeout(() => {
			if (state.cleanupTimers.get(job.asyncId) !== timer) return;
			state.cleanupTimers.delete(job.asyncId);
			if (trackerGeneration !== expectedGeneration || state.asyncJobs.get(job.asyncId) !== job) return;
			stopObservation(job.asyncId);
			state.asyncJobs.delete(job.asyncId);
			scheduleRefresh();
		}, completionRetentionMs);
		timer.unref?.();
		state.cleanupTimers.set(job.asyncId, timer);
	};
	const maybeScheduleCleanup = (job: AsyncJobState): void => {
		if (
			!isTerminalJobStatus(job.status) ||
			physicalTerminalPending(job) ||
			hasLiveNestedDescendants(job.nestedChildren)
		)
			return;
		if (!state.cleanupTimers.has(job.asyncId)) scheduleCleanup(job);
	};

	const applyStatus = (job: AsyncJobState, status: AsyncStatus): void => {
		const previousStatus = job.status;
		const preserveTerminalState = isTerminalJobStatus(previousStatus) && !isTerminalJobStatus(status.state);
		if (!preserveTerminalState) job.status = status.state;
		job.error = status.error;
		job.pid = status.pid ?? job.pid;
		if (job.processTerminal?.state !== "observed" || status.processTerminal?.state === "observed") {
			job.processTerminal = status.processTerminal ?? job.processTerminal;
		}
		job.activityState = status.activityState;
		job.lastActivityAt = status.lastActivityAt ?? job.lastActivityAt;
		job.currentTool = status.currentTool;
		job.currentToolStartedAt = status.currentToolStartedAt;
		job.currentPath = status.currentPath;
		job.turnCount = status.turnCount ?? job.turnCount;
		job.toolCount = status.toolCount ?? job.toolCount;
		job.steering = status.steering ?? job.steering;
		job.mode = status.mode;
		job.cwd = status.cwd ?? job.cwd;
		job.currentStep = status.currentStep ?? job.currentStep;
		job.startedAt = status.startedAt ?? job.startedAt;
		job.updatedAt = status.lastUpdate ?? job.updatedAt;
		if (status.nestedRoute) job.nestedRoute = status.nestedRoute;
		else if (isTerminalJobStatus(status.state)) job.nestedRoute = undefined;
		if (status.steps?.length) {
			const groups = normalizeParallelGroups(status.parallelGroups, status.steps.length);
			const currentStep = status.currentStep;
			const activeGroup =
				currentStep !== undefined
					? groups.find((group) => currentStep >= group.start && currentStep < group.start + group.count)
					: undefined;
			const visibleSteps = activeGroup
				? status.steps
						.slice(activeGroup.start, activeGroup.start + activeGroup.count)
						.map((step, index) => ({ ...step, index: activeGroup.start + index }))
				: status.steps.map((step, index) => ({ ...step, index }));
			job.parallelGroups = groups;
			job.hasParallelGroups = groups.length > 0;
			job.activeParallelGroup = Boolean(activeGroup);
			job.agents = visibleSteps.map((step) => step.agent);
			job.steps = visibleSteps;
			job.stepsTotal = visibleSteps.length;
			job.runningSteps = visibleSteps.filter((step) => step.status === "running").length;
			job.completedSteps = visibleSteps.filter(
				(step) => step.status === "complete" || step.status === "completed",
			).length;
			if (status.state === "complete") job.completedSteps = visibleSteps.length;
			job.context = contextSummary(status.steps);
			job.nestedChildren = status.steps.flatMap((step) => step.children ?? []);
		}
		job.sessionDir = status.sessionDir ?? job.sessionDir;
		job.outputFile = status.outputFile ?? job.outputFile;
		job.totalTokens = status.totalTokens ?? job.totalTokens;
		job.timeoutMs = status.timeoutMs ?? job.timeoutMs;
		job.deadlineAt = status.deadlineAt ?? job.deadlineAt;
		job.timedOut = status.timedOut ?? job.timedOut;
		job.stopped = status.stopped ?? job.stopped;
		job.turnBudget = status.turnBudget ?? job.turnBudget;
		job.turnBudgetExceeded = status.turnBudgetExceeded ?? job.turnBudgetExceeded;
		job.wrapUpRequested = status.wrapUpRequested ?? job.wrapUpRequested;
		job.toolBudget = status.toolBudget ?? job.toolBudget;
		job.toolBudgetBlocked = status.toolBudgetBlocked ?? job.toolBudgetBlocked;
		job.sessionFile = status.sessionFile ?? job.sessionFile;
		if (isTerminalJobStatus(job.status)) {
			rememberRecentAgentJob(state, job);
			maybeScheduleCleanup(job);
		} else {
			cancelCleanup(job.asyncId);
		}
	};

	const jobFromStatus = (
		asyncDir: string,
		status: AsyncStatus,
		sessionId: string | undefined,
		restored: boolean,
	): AsyncJobState => {
		const job: AsyncJobState = {
			asyncId: status.runId,
			asyncDir,
			status: status.state,
			mode: status.mode,
			startedAt: status.startedAt,
			updatedAt: status.lastUpdate ?? status.startedAt,
			...(restored ? { controlEventCursorPending: true } : { controlEventCursor: 0 }),
		};
		if (sessionId) job.sessionId = sessionId;
		applyStatus(job, status);
		return job;
	};

	const handleControlLine = (job: AsyncJobState, line: string): boolean => {
		if (!line.trim()) return false;
		let parsed: TrackerEventRecord;
		try {
			parsed = record(parseJsonValue(line));
		} catch (error) {
			reportAgentDiagnostic(`Ignoring malformed async control event in '${job.asyncDir}':`, error);
			return false;
		}
		if (parsed.type === "subagent.steering.notice") {
			// SAFETY: the discriminator selects the Suite-owned steering notice protocol; required fields are checked below.
			const notice = parsed as Partial<SteeringNotice>;
			if (
				!isRuntimeString(notice.requestId) ||
				!isRuntimeString(notice.runId) ||
				(notice.state !== "failed" && notice.state !== "partial" && notice.state !== "recovered") ||
				!isRuntimeString(notice.message)
			)
				return false;
			const normalizedSessionId = normalizeAcceptedSessionId(notice.currentSessionId, notice.runId);
			if (state.currentSessionId && !normalizedSessionId) return false;
			const key = `${notice.runId}:${notice.requestId}:${notice.state}`;
			if (steeringNoticeSeen.has(key)) return false;
			const now = Date.now();
			steeringNoticeSeen.set(key, now);
			if (steeringNoticeSeen.size > 200) {
				for (const [seenKey, seenAt] of steeringNoticeSeen) {
					if (now - seenAt > 10 * 60 * 1_000 || steeringNoticeSeen.size > 200) steeringNoticeSeen.delete(seenKey);
				}
			}
			const payload = {
				...notice,
				source: "async",
				asyncDir: job.asyncDir,
				noticeText: notice.message,
			};
			if (normalizedSessionId) Object.assign(payload, { currentSessionId: normalizedSessionId });
			emitLifecycleEvent(SUBAGENT_STEERING_NOTICE_EVENT, payload);
			return true;
		}
		if (parsed.type !== "subagent.control") return false;
		// SAFETY: the discriminator selects the Suite-owned control record; channel and event presence are checked next.
		const controlRecord = parsed as {
			event?: ControlEvent;
			channels?: string[];
			childIntercomTarget?: string;
			noticeText?: string;
			intercom?: { to?: string; message?: string };
		};
		if (!controlRecord.event || !Array.isArray(controlRecord.channels)) return false;
		const payload = {
			event: controlRecord.event,
			source: "async" as const,
			asyncDir: job.asyncDir,
			childIntercomTarget: controlRecord.childIntercomTarget,
			noticeText:
				controlRecord.noticeText ??
				formatControlNoticeMessage(controlRecord.event, controlRecord.childIntercomTarget),
		};
		if (controlRecord.channels.includes("event")) emitLifecycleEvent(SUBAGENT_CONTROL_EVENT, payload);
		if (
			controlRecord.event.type !== "active_long_running" &&
			controlRecord.channels.includes("intercom") &&
			controlRecord.intercom?.to &&
			controlRecord.intercom.message
		) {
			emitLifecycleEvent(SUBAGENT_CONTROL_INTERCOM_EVENT, {
				...payload,
				to: controlRecord.intercom.to,
				message: controlRecord.intercom.message,
			});
		}
		return true;
	};

	type ObservationKind = { status?: boolean; control?: boolean };
	const observeJob = async (job: AsyncJobState, kind: ObservationKind): Promise<void> => {
		const observation = observations.get(job.asyncId) ?? { running: false, status: false, control: false };
		observation.status ||= kind.status === true;
		observation.control ||= kind.control === true;
		observations.set(job.asyncId, observation);
		if (observation.running) return;
		observation.running = true;
		const expectedGeneration = trackerGeneration;
		let changed = false;
		try {
			do {
				const readStatus = observation.status;
				const readControl = observation.control;
				observation.status = false;
				observation.control = false;
				if (readControl) {
					const control = await readNewAsyncControlEvents(job, (line) => handleControlLine(job, line));
					changed ||= control.changed;
					observation.control ||= control.more;
				}
				if (readStatus) {
					const observedStatus = await readRunStatus(job.asyncDir);
					const status = observedStatus ? await recoverLegacyFinalReports(observedStatus) : null;
					if (
						status &&
						status.runId === job.asyncId &&
						trackerGeneration === expectedGeneration &&
						state.asyncJobs.get(job.asyncId) === job
					) {
						applyStatus(job, status);
						changed = true;
					}
				}
			} while (
				trackerGeneration === expectedGeneration &&
				state.asyncJobs.get(job.asyncId) === job &&
				(observation.status || observation.control)
			);
		} catch (error) {
			if (trackerGeneration === expectedGeneration && state.asyncJobs.get(job.asyncId) === job) {
				reportAgentDiagnostic(
					`Failed to observe async status for '${job.asyncDir}'; retaining prior state:`,
					error,
				);
				if (!observation.retryTimer) {
					observation.retryTimer = setTimeout(() => {
						delete observation.retryTimer;
						void observeJob(job, { status: true, control: true });
					}, fallbackIntervalMs);
					observation.retryTimer.unref?.();
				}
			}
		} finally {
			observation.running = false;
			if (changed && trackerGeneration === expectedGeneration && state.asyncJobs.get(job.asyncId) === job) {
				scheduleRefresh();
			}
		}
	};

	const startFallbackObserver = (job: AsyncJobState, cause: unknown): void => {
		watchers.get(job.asyncId)?.close();
		watchers.delete(job.asyncId);
		if (fallbackTimers.has(job.asyncId)) return;
		reportAgentDiagnostic(
			`Agent status observation for '${job.asyncId}' fell back to asynchronous reconciliation:`,
			cause,
		);
		const timer = setInterval(() => void observeJob(job, { status: true, control: true }), fallbackIntervalMs);
		timer.unref?.();
		fallbackTimers.set(job.asyncId, timer);
	};
	const scheduleStatusWatchFallback = (job: AsyncJobState): void => {
		if (statusFallbackTimers.has(job.asyncId)) return;
		const timer = setTimeout(() => {
			statusFallbackTimers.delete(job.asyncId);
			if (Date.now() - (lastIpcStatusAt.get(job.asyncId) ?? 0) < STATUS_WATCH_FALLBACK_DELAY_MS * 2) return;
			void observeJob(job, { status: true });
		}, STATUS_WATCH_FALLBACK_DELAY_MS);
		timer.unref?.();
		statusFallbackTimers.set(job.asyncId, timer);
	};
	const ensureJobObserver = (job: AsyncJobState): void => {
		if (watchers.has(job.asyncId) || fallbackTimers.has(job.asyncId)) return;
		try {
			const watcher = watchRun(job.asyncDir, (_event, filename) => {
				if (state.asyncJobs.get(job.asyncId) !== job) return;
				const name = filename?.toString();
				if (!name || name === "events.jsonl") void observeJob(job, { control: true });
				if (!name || name === "status.json" || name === "process-terminal.json") {
					scheduleStatusWatchFallback(job);
				}
			});
			watcher.on("error", (error) => startFallbackObserver(job, error));
			watcher.unref?.();
			watchers.set(job.asyncId, watcher);
		} catch (error) {
			startFallbackObserver(job, error);
		}
	};
	const ensureObserver = (): void => {
		for (const job of state.asyncJobs.values()) ensureJobObserver(job);
	};

	const handleStarted = <Data>(data: Data): void => {
		if (!isRuntimeObject(data) || data === null || Array.isArray(data)) return;
		// SAFETY: this callback is bound to the Suite-owned async-started event; id is checked before state mutation.
		const info = data as AsyncStartedEvent;
		if (!info.id) return;
		const normalizedSessionId = normalizeAcceptedSessionId(info.sessionId, info.id);
		if (state.currentSessionId && !normalizedSessionId) return;
		cancelCleanup(info.id);
		const now = Date.now();
		const asyncDir = info.asyncDir ?? path.join(asyncDirRoot, info.id);
		const rawAgents = info.agents?.length ? info.agents : info.agent ? [info.agent] : undefined;
		const validParallelGroups = normalizeParallelGroups(info.parallelGroups, rawAgents?.length ?? 0);
		const firstGroup = validParallelGroups.find((group) => group.start === 0);
		const firstGroupCount = firstGroup?.count;
		const agents = firstGroupCount && firstGroupCount > 0 ? rawAgents?.slice(0, firstGroupCount) : rawAgents;
		const existing = state.asyncJobs.get(info.id);
		const job: AsyncJobState = existing ?? {
			asyncId: info.id,
			asyncDir,
			status: "queued",
			mode:
				info.mode === "parallel" || (info.mode !== "single" && (rawAgents?.length ?? 0) > 1)
					? "parallel"
					: "single",
			startedAt: now,
			updatedAt: now,
			controlEventCursor: 0,
		};
		job.asyncDir = asyncDir;
		job.cwd = isRuntimeString(info.cwd) ? path.resolve(info.cwd) : job.cwd;
		job.pid = isRuntimeNumber(info.pid) ? info.pid : job.pid;
		job.sessionId = normalizedSessionId ?? job.sessionId;
		job.description = info.description ?? info.goal ?? info.task ?? job.description;
		job.descriptions = info.descriptions ?? job.descriptions;
		job.tasks = info.tasks ?? job.tasks;
		job.agents = agents ?? job.agents;
		job.parallelGroups = validParallelGroups.length > 0 ? validParallelGroups : job.parallelGroups;
		job.nestedRoute = info.nestedRoute ?? job.nestedRoute;
		job.stepsTotal = firstGroupCount ?? agents?.length ?? job.stepsTotal;
		job.hasParallelGroups = validParallelGroups.length > 0 || job.hasParallelGroups;
		job.activeParallelGroup = Boolean(firstGroupCount && firstGroupCount > 0) || job.activeParallelGroup;
		job.timeoutMs = info.timeoutMs ?? job.timeoutMs;
		job.deadlineAt = info.deadlineAt ?? job.deadlineAt;
		job.turnBudget = info.turnBudget ?? job.turnBudget;
		state.asyncJobs.set(info.id, job);
		rememberRecentAgentJob(state, job);
		ensureJobObserver(job);
		void observeJob(job, { status: true, control: true });
		scheduleRefresh();
	};

	const handleStatus = <Data>(data: Data): void => {
		if (!data || !isRuntimeObject(data) || Array.isArray(data)) return;
		// SAFETY: this callback is bound to the Suite-owned status event; envelope fields are checked below.
		const update = data as { id?: unknown; asyncDir?: unknown; sessionId?: unknown; status?: unknown };
		if (
			!isRuntimeString(update.id) ||
			!isRuntimeString(update.asyncDir) ||
			!update.status ||
			!isRuntimeObject(update.status)
		)
			return;
		// SAFETY: the status event producer emits AsyncStatus and the run/directory identities are checked immediately after.
		const status = update.status as AsyncStatus;
		if (status.runId !== update.id || path.basename(update.asyncDir) !== update.id) return;
		const normalizedSessionId = normalizeAcceptedSessionId(update.sessionId ?? status.sessionId, update.id);
		if (state.currentSessionId && !normalizedSessionId) return;
		let job = state.asyncJobs.get(update.id);
		if (!job) {
			job = jobFromStatus(update.asyncDir, status, normalizedSessionId, false);
			state.asyncJobs.set(update.id, job);
		} else {
			if (path.resolve(update.asyncDir) !== path.resolve(job.asyncDir)) return;
			applyStatus(job, status);
		}
		lastIpcStatusAt.set(update.id, Date.now());
		rememberRecentAgentJob(state, job);
		ensureJobObserver(job);
		scheduleRefresh();
	};

	const handleComplete = <Data>(data: Data): void => {
		if (!isRuntimeObject(data) || data === null || Array.isArray(data)) return;
		// SAFETY: this callback is bound to the Suite-owned completion event; id gates all state mutation.
		const result = data as {
			id?: string;
			success?: boolean;
			state?: AsyncJobState["status"];
			asyncDir?: string;
			sessionId?: string;
			stopped?: boolean;
		};
		if (!result.id) return;
		if (state.currentSessionId && !normalizeAcceptedSessionId(result.sessionId, result.id)) return;
		const job = state.asyncJobs.get(result.id);
		if (!job) return;
		job.status = result.state ?? (result.success ? "complete" : "failed");
		job.stopped = result.stopped ?? job.stopped;
		job.updatedAt = Date.now();
		if (result.asyncDir && result.asyncDir !== job.asyncDir) {
			stopObservation(job.asyncId);
			job.asyncDir = result.asyncDir;
			ensureJobObserver(job);
		}
		rememberRecentAgentJob(state, job);
		maybeScheduleCleanup(job);
		void observeJob(job, { status: true, control: true });
		scheduleRefresh();
	};

	const handleProcessTerminal = <Data>(data: Data): void => {
		if (!data || !isRuntimeObject(data) || Array.isArray(data)) return;
		// SAFETY: this callback is bound to the Suite-owned process-terminal event; proof identity fields are checked below.
		const proof = data as Partial<ProcessTerminalV1> & { asyncDir?: unknown };
		if (
			!isRuntimeString(proof.runId) ||
			proof.state !== "observed" ||
			!isRuntimeNumber(proof.observedAt) ||
			!Number.isFinite(proof.observedAt) ||
			!isRuntimeString(proof.runnerProcessInstanceId) ||
			!proof.runnerProcessInstanceId
		)
			return;
		const job = state.asyncJobs.get(proof.runId);
		if (!job) return;
		if (isRuntimeString(proof.asyncDir) && path.resolve(proof.asyncDir) !== path.resolve(job.asyncDir)) return;
		if (
			job.processTerminal?.runnerProcessInstanceId &&
			job.processTerminal.runnerProcessInstanceId !== proof.runnerProcessInstanceId
		)
			return;
		// SAFETY: the process-terminal producer emits the full discriminated proof and the observed variant's identity was checked above.
		job.processTerminal = proof as ProcessTerminalV1;
		job.updatedAt = Math.max(job.updatedAt ?? 0, proof.observedAt);
		maybeScheduleCleanup(job);
		void observeJob(job, { status: true, control: true });
		scheduleRefresh();
	};

	const resetJobs = (): void => {
		trackerGeneration += 1;
		for (const asyncId of new Set([...watchers.keys(), ...fallbackTimers.keys(), ...observations.keys()])) {
			stopObservation(asyncId);
		}
		for (const timer of state.cleanupTimers.values()) clearTimeout(timer);
		state.cleanupTimers.clear();
		state.asyncJobs.clear();
		state.recentAgentJobs?.clear();
		state.foregroundControls?.clear();
		state.lastForegroundControlId = null;
		state.resultFileCoalescer.clear();
		restoreInFlight?.controller.abort();
		restoreInFlight = undefined;
		restoredGeneration = -1;
	};

	const restoreActiveJobs = (asyncDirectories?: readonly string[]): Promise<void> => {
		const targeted = asyncDirectories !== undefined;
		if (!targeted && restoredGeneration === trackerGeneration) return Promise.resolve();
		if (restoreInFlight?.generation === trackerGeneration) return restoreInFlight.promise;
		const generation = trackerGeneration;
		const sessionId = state.currentSessionId;
		if (!sessionId) return Promise.resolve();
		const controller = new AbortController();
		const restore = { controller, generation, promise: Promise.resolve() };
		restore.promise = (async () => {
			let directories: string[];
			if (targeted) {
				const root = path.resolve(asyncDirRoot);
				directories = [...new Set(asyncDirectories.map((directory) => path.resolve(directory)))].filter(
					(directory) => path.dirname(directory) === root,
				);
			} else {
				let entries: fs.Dirent[];
				try {
					entries = await fs.promises.readdir(asyncDirRoot, { withFileTypes: true });
				} catch (error) {
					if (errnoCode(error) === "ENOENT") {
						if (trackerGeneration === generation && state.currentSessionId === sessionId) {
							restoredGeneration = generation;
						}
						return;
					}
					throw error;
				}
				directories = entries
					.filter((entry) => entry.isDirectory() && entry.name !== "." && entry.name !== "..")
					.map((entry) => path.join(asyncDirRoot, entry.name));
			}
			const statuses = await mapConcurrent(directories, RESTORE_READ_CONCURRENCY, async (asyncDir) => {
				if (controller.signal.aborted) return undefined;
				try {
					const observedStatus = await readRunStatus(asyncDir);
					if (!observedStatus || controller.signal.aborted) return undefined;
					const status = await recoverLegacyFinalReports(observedStatus);
					const normalized = normalizeAcceptedSessionId(status.sessionId, status.runId);
					return normalized ? { asyncDir, status, sessionId: normalized } : undefined;
				} catch (error) {
					reportAgentDiagnostic(
						`Failed to inspect async run '${asyncDir}'; leaving it untouched for retry:`,
						error,
					);
					return undefined;
				}
			});
			if (controller.signal.aborted || trackerGeneration !== generation || state.currentSessionId !== sessionId)
				return;
			const observed = statuses.filter((value) => value !== undefined);
			const active = observed.filter(({ status }) => status.state === "queued" || status.state === "running");
			const terminal = observed
				.filter(({ status }) => status.state !== "queued" && status.state !== "running")
				.sort(
					(left, right) =>
						(right.status.lastUpdate ?? right.status.endedAt ?? right.status.startedAt) -
						(left.status.lastUpdate ?? left.status.endedAt ?? left.status.startedAt),
				)
				.slice(0, MAX_RECENT_AGENT_JOBS);
			for (const { asyncDir, status, sessionId: normalized } of [...active, ...terminal]) {
				const existing = state.asyncJobs.get(status.runId);
				const job = existing ?? jobFromStatus(asyncDir, status, normalized, true);
				if (existing) applyStatus(existing, status);
				rememberRecentAgentJob(state, job);
				if (
					status.state === "queued" ||
					status.state === "running" ||
					(status.processTerminal !== undefined && status.processTerminal.state !== "observed")
				) {
					state.asyncJobs.set(status.runId, job);
					ensureJobObserver(job);
					void observeJob(job, { control: true });
				}
			}
			scheduleRefresh();
			if (!targeted) restoredGeneration = generation;
		})().finally(() => {
			if (restoreInFlight === restore) restoreInFlight = undefined;
		});
		restoreInFlight = restore;
		return restore.promise;
	};

	return {
		ensureObserver,
		handleComplete,
		handleProcessTerminal,
		handleStarted,
		handleStatus,
		resetJobs,
		restoreActiveJobs,
	};
}
