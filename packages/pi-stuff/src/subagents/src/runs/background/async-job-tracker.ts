import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { refreshForegroundRuntimeRun } from "../../session/foreground-replay.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { sessionArtifactMatches } from "../../shared/session-identity.ts";
import {
	type AsyncJobState,
	type AsyncStartedEvent,
	type ControlEvent,
	POLL_INTERVAL_MS,
	RESULTS_DIR,
	type SteeringNotice,
	SUBAGENT_CONTROL_EVENT,
	SUBAGENT_CONTROL_INTERCOM_EVENT,
	SUBAGENT_STEERING_NOTICE_EVENT,
	type SubagentState,
} from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import {
	finalizeNestedRouteRoot,
	hasLiveNestedDescendants,
	projectNestedEvents,
	recoverRetiredNestedRouteStatus,
	retireCompletedNestedRoute,
	updateAsyncJobNestedProjection,
} from "../shared/nested-events.ts";
import { formatControlNoticeMessage } from "../shared/subagent-control.ts";
import { type AsyncRunSummary, listAsyncRuns } from "./async-status.ts";
import { normalizeParallelGroups } from "./parallel-groups.ts";
import { reconcileAsyncRun, reconcileNestedAsyncDescendants } from "./stale-run-reconciler.ts";

interface AsyncJobTrackerOptions {
	completionRetentionMs?: number;
	pollIntervalMs?: number;
	onRefresh?: () => void;
	resultsDir?: string;
	kill?: (pid: number, signal?: NodeJS.Signals | 0) => boolean;
	now?: () => number;
	reconcileRun?: typeof reconcileAsyncRun;
	readRunStatus?: typeof readStatus;
	listRuns?: typeof listAsyncRuns;
	statControlEvents?: (filePath: string) => { size: number };
	refreshForegroundRun?: typeof refreshForegroundRuntimeRun;
}

const CONTROL_EVENT_READ_CHUNK_BYTES = 64 * 1024;
const MAX_CONTROL_EVENT_LINE_BYTES = 1024 * 1024;
const CONTROL_EVENT_SCAN_WINDOW_BYTES = 2 * 1024 * 1024;
// A session may launch up to 200 Agents. The roster can hide quiet terminal
// rows, but `/agents` remains the complete current-session inspection surface.
const MAX_RECENT_AGENT_JOBS = 200;
type ForegroundRun = NonNullable<SubagentState["foregroundRuns"]> extends Map<string, infer Run> ? Run : never;

function isTerminalJobStatus(status: AsyncJobState["status"]): boolean {
	return status === "complete" || status === "failed" || status === "paused" || status === "stopped";
}

function physicalTerminalPending(job: AsyncJobState): boolean {
	return job.processTerminal !== undefined && job.processTerminal.state !== "observed";
}

function rememberRecentAgentJob(state: SubagentState, job: AsyncJobState): void {
	state.recentAgentJobs ??= new Map();
	state.recentAgentJobs.set(job.asyncId, job);
	const terminal = [...state.recentAgentJobs.values()]
		.filter(
			(candidate) =>
				candidate.status === "complete" ||
				candidate.status === "failed" ||
				candidate.status === "paused" ||
				candidate.status === "stopped",
		)
		.sort((left, right) => (right.updatedAt ?? right.startedAt ?? 0) - (left.updatedAt ?? left.startedAt ?? 0));
	for (const stale of terminal.slice(MAX_RECENT_AGENT_JOBS)) state.recentAgentJobs.delete(stale.asyncId);
}

export function createAsyncJobTracker(
	pi: Pick<ExtensionAPI, "events">,
	state: SubagentState,
	asyncDirRoot: string,
	options: AsyncJobTrackerOptions = {},
): {
	ensurePoller: () => void;
	handleStarted: (data: unknown) => void;
	handleComplete: (data: unknown) => void;
	resetJobs: () => void;
	restoreActiveJobs: () => void;
} {
	const completionRetentionMs = options.completionRetentionMs ?? 10000;
	const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
	const resultsDir = options.resultsDir ?? RESULTS_DIR;
	const reconcileRun = options.reconcileRun ?? reconcileAsyncRun;
	const readRunStatus = options.readRunStatus ?? readStatus;
	const listRuns = options.listRuns ?? listAsyncRuns;
	const statControlEvents = options.statControlEvents ?? fs.statSync;
	const refreshForegroundRun = options.refreshForegroundRun ?? refreshForegroundRuntimeRun;
	const steeringNoticeSeen = new Map<string, number>();
	const routeSettlements = new Map<string, Promise<boolean>>();
	const foregroundSettlementAttempts = new Map<string, number>();
	let trackerGeneration = 0;
	let settlementAbortController = new AbortController();
	const normalizeAcceptedSessionId = (sessionId: unknown, runId: unknown): string | undefined => {
		if (!state.currentSessionId || typeof sessionId !== "string") return undefined;
		if (sessionId === state.currentSessionId) return state.currentSessionId;
		return state.currentSessionScope && sessionArtifactMatches(state.currentSessionScope, sessionId, runId)
			? state.currentSessionId
			: undefined;
	};
	const emitLifecycleEvent = (event: string, payload: unknown): void => {
		try {
			pi.events.emit(event, payload);
		} catch (error) {
			reportAgentDiagnostic(`Agent lifecycle observer '${event}' failed:`, error);
		}
	};
	const restoredControlEventCursor = (asyncDir: string): number | undefined => {
		try {
			return statControlEvents(path.join(asyncDir, "events.jsonl")).size;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
			// Do not replay old side effects after a transient metadata failure. The
			// first successful observation will initialize this cursor at EOF.
			reportAgentDiagnostic(
				`Failed to inspect restored Agent control events for '${asyncDir}'; deferring cursor initialization:`,
				error,
			);
			return undefined;
		}
	};
	const summaryToJob = (run: AsyncRunSummary): AsyncJobState => {
		const restoredCursor = restoredControlEventCursor(run.asyncDir);
		const groups = normalizeParallelGroups(run.parallelGroups, run.steps.length);
		const currentStep = run.currentStep;
		const activeGroup =
			currentStep !== undefined
				? groups.find((group) => currentStep >= group.start && currentStep < group.start + group.count)
				: undefined;
		const visibleSteps = activeGroup
			? run.steps
					.slice(activeGroup.start, activeGroup.start + activeGroup.count)
					.map((step, index) => ({ ...step, index: activeGroup.start + index }))
			: run.steps.map((step, index) => ({ ...step, index }));
		return {
			asyncId: run.id,
			asyncDir: run.asyncDir,
			status: run.state,
			error: run.error,
			sessionId: run.sessionId,
			activityState: run.activityState,
			lastActivityAt: run.lastActivityAt,
			currentTool: run.currentTool,
			currentToolStartedAt: run.currentToolStartedAt,
			currentPath: run.currentPath,
			turnCount: run.turnCount,
			toolCount: run.toolCount,
			steering: run.steering,
			mode: run.mode,
			context: run.context,
			cwd: run.cwd,
			agents: visibleSteps.map((step) => step.agent),
			currentStep: run.currentStep,
			parallelGroups: groups,
			steps: visibleSteps,
			stepsTotal: visibleSteps.length,
			runningSteps: visibleSteps.filter((step) => step.status === "running").length,
			completedSteps: visibleSteps.filter((step) => step.status === "complete" || step.status === "completed")
				.length,
			hasParallelGroups: groups.length > 0,
			activeParallelGroup: Boolean(activeGroup),
			startedAt: run.startedAt,
			updatedAt: run.lastUpdate ?? run.startedAt,
			timeoutMs: run.timeoutMs,
			deadlineAt: run.deadlineAt,
			timedOut: run.timedOut,
			stopped: run.stopped,
			processTerminal: run.processTerminal,
			turnBudget: run.turnBudget,
			turnBudgetExceeded: run.turnBudgetExceeded,
			wrapUpRequested: run.wrapUpRequested,
			sessionDir: run.sessionDir,
			outputFile: run.outputFile,
			totalTokens: run.totalTokens,
			sessionFile: run.sessionFile,
			...(restoredCursor === undefined
				? { controlEventCursorPending: true }
				: { controlEventCursor: restoredCursor }),
			nestedRoute: run.nestedRoute,
			nestedChildren: run.nestedChildren,
		};
	};
	const cancelCleanup = (asyncId: string) => {
		const existingTimer = state.cleanupTimers.get(asyncId);
		if (!existingTimer) return;
		clearTimeout(existingTimer);
		state.cleanupTimers.delete(asyncId);
	};
	const scheduleCleanup = (asyncId: string, expectedJob?: AsyncJobState) => {
		cancelCleanup(asyncId);
		const expectedGeneration = trackerGeneration;
		const timer = setTimeout(() => {
			if (state.cleanupTimers.get(asyncId) !== timer) return;
			state.cleanupTimers.delete(asyncId);
			if (trackerGeneration !== expectedGeneration) return;
			if (expectedJob && state.asyncJobs.get(asyncId) !== expectedJob) return;
			state.asyncJobs.delete(asyncId);
		}, completionRetentionMs);
		state.cleanupTimers.set(asyncId, timer);
	};
	const settleTerminalRoute = (job: AsyncJobState): void => {
		if (!job.nestedRoute || job.nestedRoute.rootRunId !== job.asyncId || routeSettlements.has(job.asyncId)) return;
		const expectedGeneration = trackerGeneration;
		let settlement: Promise<boolean>;
		settlement = finalizeNestedRouteRoot(job.nestedRoute, job.asyncDir, {
			signal: settlementAbortController.signal,
		})
			.then((retired) => {
				if (trackerGeneration !== expectedGeneration || state.asyncJobs.get(job.asyncId) !== job) return retired;
				if (retired) {
					job.nestedRoute = undefined;
					if (!physicalTerminalPending(job) && !hasLiveNestedDescendants(job.nestedChildren)) {
						scheduleCleanup(job.asyncId, job);
					}
				}
				return retired;
			})
			.catch((error) => {
				if (trackerGeneration !== expectedGeneration || state.asyncJobs.get(job.asyncId) !== job) return false;
				if (recoverRetiredRoute(job, error)) {
					if (!physicalTerminalPending(job) && !hasLiveNestedDescendants(job.nestedChildren)) {
						scheduleCleanup(job.asyncId, job);
					}
					return true;
				}
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					reportAgentDiagnostic(`Failed to settle nested route for '${job.asyncId}':`, error);
				}
				return false;
			})
			.finally(() => {
				if (routeSettlements.get(job.asyncId) === settlement) routeSettlements.delete(job.asyncId);
			});
		routeSettlements.set(job.asyncId, settlement);
	};
	const recoverRetiredRoute = (job: AsyncJobState, error: unknown): boolean => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !job.nestedRoute) return false;
		try {
			const status = recoverRetiredNestedRouteStatus(job.nestedRoute, job.asyncDir);
			if (!status) return false;
			job.nestedRoute = undefined;
			job.nestedChildren = status.steps?.flatMap((step) => step.children ?? []);
			return true;
		} catch {
			return false;
		}
	};
	const synchronizePersistedRoute = (job: AsyncJobState, status: ReturnType<typeof readStatus>): boolean => {
		if (!status) return false;
		if (status.nestedRoute) {
			job.nestedRoute = status.nestedRoute;
			return false;
		}
		if (
			!job.nestedRoute ||
			(status.state !== "complete" &&
				status.state !== "failed" &&
				status.state !== "paused" &&
				status.state !== "stopped")
		)
			return false;
		try {
			fs.lstatSync(path.dirname(job.nestedRoute.eventSink));
			return false;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
			job.nestedRoute = undefined;
			job.nestedChildren = status.steps?.flatMap((step) => step.children ?? []);
			return true;
		}
	};
	const attachForegroundChildren = (
		run: ForegroundRun,
		children: ReturnType<typeof projectNestedEvents>["children"],
	): void => {
		const direct = children.filter((child) => child.parentRunId === run.runId);
		for (const child of run.children) {
			const exact = direct.filter((nested) => nested.parentStepIndex === child.index);
			child.children = exact.length > 0 ? exact : run.children.length === 1 ? direct : [];
		}
	};
	const recoverRetiredForegroundRoute = (run: ForegroundRun, routeToken: string, error: unknown): boolean => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !run.asyncDir || !run.nestedRoute) return false;
		try {
			if (run.nestedRoute?.capabilityToken !== routeToken) return false;
			const status = recoverRetiredNestedRouteStatus(run.nestedRoute, run.asyncDir);
			if (!status) return false;
			for (const child of run.children) {
				const step = status.steps?.[child.index];
				child.children = step?.children ?? [];
			}
			run.nestedRoute = undefined;
			run.updatedAt = Math.max(run.updatedAt, status.lastUpdate ?? status.endedAt ?? 0);
			return true;
		} catch {
			return false;
		}
	};
	const settleForegroundRoute = (run: ForegroundRun, force = false): void => {
		const route = run.nestedRoute;
		if (!route || route.rootRunId !== run.runId) return;
		const key = `foreground:${run.runId}:${route.capabilityToken}`;
		if (routeSettlements.has(key)) return;
		const now = options.now?.() ?? Date.now();
		if (!force && now - (foregroundSettlementAttempts.get(key) ?? 0) < 1_000) return;
		foregroundSettlementAttempts.set(key, now);
		const expectedGeneration = trackerGeneration;
		let settlement: Promise<boolean>;
		settlement = (
			run.asyncDir
				? finalizeNestedRouteRoot(route, run.asyncDir, { signal: settlementAbortController.signal })
				: retireCompletedNestedRoute(route, { signal: settlementAbortController.signal })
		)
			.then((retired) => {
				if (trackerGeneration !== expectedGeneration || state.foregroundRuns?.get(run.runId) !== run)
					return retired;
				if (retired && run.nestedRoute?.capabilityToken === route.capabilityToken) {
					run.nestedRoute = undefined;
				}
				return retired;
			})
			.catch((error) => {
				if (trackerGeneration !== expectedGeneration || state.foregroundRuns?.get(run.runId) !== run) return false;
				if (!recoverRetiredForegroundRoute(run, route.capabilityToken, error)) {
					reportAgentDiagnostic(`Failed to settle foreground nested route for '${run.runId}':`, error);
				}
				return false;
			})
			.finally(() => {
				if (routeSettlements.get(key) === settlement) routeSettlements.delete(key);
			});
		routeSettlements.set(key, settlement);
	};
	const refreshForegroundNestedRoutes = (): void => {
		for (const run of state.foregroundRuns?.values() ?? []) {
			if (run.asyncDir && run.children.some((child) => child.status === "detached")) {
				try {
					refreshForegroundRun(run);
				} catch (error) {
					reportAgentDiagnostic(`Failed to advance foreground crash recovery for '${run.runId}':`, error);
				}
			}
			const route = run.nestedRoute;
			if (!route) continue;
			try {
				reconcileNestedAsyncDescendants(route, {
					resultsDir,
					kill: options.kill,
					now: options.now,
				});
				const registry = projectNestedEvents(route);
				attachForegroundChildren(run, registry.children);
				run.updatedAt = Math.max(run.updatedAt, registry.updatedAt);
				const live = hasLiveNestedDescendants([...registry.children, ...registry.pendingChildren]);
				settleForegroundRoute(run, !live);
			} catch (error) {
				if (!recoverRetiredForegroundRoute(run, route.capabilityToken, error)) {
					reportAgentDiagnostic(`Failed to refresh foreground nested descendants for '${run.runId}':`, error);
				}
			}
		}
	};
	const emitNewControlEvents = (job: AsyncJobState) => {
		const eventsPath = path.join(job.asyncDir, "events.jsonl");
		let fd: number;
		try {
			fd = fs.openSync(eventsPath, "r");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			reportAgentDiagnostic(`Failed to open async control events for '${job.asyncDir}':`, error);
			return;
		}
		try {
			const stat = fs.fstatSync(fd);
			if (job.controlEventCursorPending) {
				job.controlEventCursor = stat.size;
				job.controlEventCursorPending = false;
				return;
			}
			const savedCursor = job.controlEventCursor;
			let cursor = stat.size < (savedCursor ?? 0) ? 0 : (savedCursor ?? 0);
			const startedFromTail = savedCursor === undefined && stat.size > CONTROL_EVENT_SCAN_WINDOW_BYTES;
			if (startedFromTail) cursor = stat.size - CONTROL_EVENT_SCAN_WINDOW_BYTES;
			if (stat.size <= cursor) return;
			const scanEnd = Math.min(stat.size, cursor + CONTROL_EVENT_SCAN_WINDOW_BYTES);
			const handleLine = (line: string) => {
				if (!line.trim()) return;
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch (error) {
					reportAgentDiagnostic(`Ignoring malformed async control event in '${eventsPath}':`, error);
					return;
				}
				if (!parsed || typeof parsed !== "object") return;
				if ((parsed as { type?: unknown }).type === "subagent.steering.notice") {
					const notice = parsed as Partial<SteeringNotice>;
					if (
						typeof notice.requestId !== "string" ||
						typeof notice.runId !== "string" ||
						(notice.state !== "failed" && notice.state !== "partial" && notice.state !== "recovered") ||
						typeof notice.message !== "string"
					)
						return;
					const normalizedSessionId = normalizeAcceptedSessionId(notice.currentSessionId, notice.runId);
					if (state.currentSessionId && !normalizedSessionId) return;
					const key = `${notice.runId}:${notice.requestId}:${notice.state}`;
					if (steeringNoticeSeen.has(key)) return;
					const now = Date.now();
					steeringNoticeSeen.set(key, now);
					if (steeringNoticeSeen.size > 200) {
						for (const [seenKey, seenAt] of steeringNoticeSeen) {
							if (now - seenAt > 10 * 60 * 1000 || steeringNoticeSeen.size > 200)
								steeringNoticeSeen.delete(seenKey);
						}
					}
					emitLifecycleEvent(SUBAGENT_STEERING_NOTICE_EVENT, {
						...notice,
						...(normalizedSessionId ? { currentSessionId: normalizedSessionId } : {}),
						source: "async",
						asyncDir: job.asyncDir,
						noticeText: notice.message,
					});
					return;
				}
				if ((parsed as { type?: unknown }).type !== "subagent.control") return;
				const record = parsed as {
					event?: ControlEvent;
					channels?: string[];
					childIntercomTarget?: string;
					noticeText?: string;
					intercom?: { to?: string; message?: string };
				};
				if (!record.event || !Array.isArray(record.channels)) return;
				const payload = {
					event: record.event,
					source: "async" as const,
					asyncDir: job.asyncDir,
					childIntercomTarget: record.childIntercomTarget,
					noticeText: record.noticeText ?? formatControlNoticeMessage(record.event, record.childIntercomTarget),
				};
				if (record.channels.includes("event")) {
					emitLifecycleEvent(SUBAGENT_CONTROL_EVENT, payload);
				}
				if (
					record.event.type !== "active_long_running" &&
					record.channels.includes("intercom") &&
					record.intercom?.to &&
					record.intercom.message
				) {
					emitLifecycleEvent(SUBAGENT_CONTROL_INTERCOM_EVENT, {
						...payload,
						to: record.intercom.to,
						message: record.intercom.message,
					});
				}
			};
			let readCursor = cursor;
			let lastCompleteCursor = cursor;
			let lineParts: Buffer[] = [];
			let lineBytes = 0;
			let skippingOversizedLine = startedFromTail;
			const appendLineSegment = (segment: Buffer) => {
				if (segment.length === 0 || skippingOversizedLine) return;
				if (lineBytes + segment.length > MAX_CONTROL_EVENT_LINE_BYTES) {
					lineParts = [];
					lineBytes = 0;
					skippingOversizedLine = true;
					return;
				}
				lineParts.push(segment);
				lineBytes += segment.length;
			};
			while (readCursor < scanEnd) {
				const toRead = Math.min(CONTROL_EVENT_READ_CHUNK_BYTES, scanEnd - readCursor);
				const buffer = Buffer.alloc(toRead);
				const bytesRead = fs.readSync(fd, buffer, 0, toRead, readCursor);
				if (bytesRead <= 0) break;
				const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
				let lineStart = 0;
				for (let index = 0; index < chunk.length; index++) {
					if (chunk[index] !== 0x0a) continue;
					appendLineSegment(chunk.subarray(lineStart, index));
					const completeCursor = readCursor + index + 1;
					if (!skippingOversizedLine && lineBytes > 0) {
						handleLine(Buffer.concat(lineParts, lineBytes).toString("utf-8"));
					}
					// Commit each complete record as soon as its callbacks return. If a
					// later read in this same scan fails, the next poll must not replay
					// records that were already delivered.
					job.controlEventCursor = completeCursor;
					lineParts = [];
					lineBytes = 0;
					skippingOversizedLine = false;
					lastCompleteCursor = completeCursor;
					lineStart = index + 1;
				}
				appendLineSegment(chunk.subarray(lineStart));
				readCursor += bytesRead;
				if (skippingOversizedLine) job.controlEventCursor = readCursor;
			}
			if (lastCompleteCursor > cursor) job.controlEventCursor = lastCompleteCursor;
			else if (skippingOversizedLine) job.controlEventCursor = scanEnd;
		} catch (error) {
			reportAgentDiagnostic(`Failed to read async control events for '${job.asyncDir}':`, error);
		} finally {
			fs.closeSync(fd);
		}
	};

	const ensurePoller = () => {
		if (state.poller) return;
		state.poller = setInterval(() => {
			const foregroundRuns = [...(state.foregroundRuns?.values() ?? [])];
			const hasForegroundWork = foregroundRuns.some(
				(run) =>
					Boolean(run.nestedRoute) ||
					(Boolean(run.asyncDir) && run.children.some((child) => child.status === "detached")),
			);
			if (state.asyncJobs.size === 0 && !hasForegroundWork) {
				if (state.poller) {
					clearInterval(state.poller);
					state.poller = null;
				}
				return;
			}
			refreshForegroundNestedRoutes();

			for (const job of state.asyncJobs.values()) {
				let nestedRefreshFailed = false;
				const refreshNestedProjection = () => {
					try {
						updateAsyncJobNestedProjection(job);
					} catch (error) {
						if (recoverRetiredRoute(job, error)) return;
						nestedRefreshFailed = true;
						reportAgentDiagnostic(`Failed to refresh nested async descendants for '${job.asyncDir}':`, error);
					}
				};
				const reconcileNestedDescendants = () => {
					try {
						if (job.nestedRoute)
							reconcileNestedAsyncDescendants(job.nestedRoute, {
								resultsDir,
								kill: options.kill,
								now: options.now,
							});
					} catch (error) {
						if (!recoverRetiredRoute(job, error)) {
							nestedRefreshFailed = true;
							reportAgentDiagnostic(`Failed to refresh nested async descendants for '${job.asyncDir}':`, error);
						}
					}
					refreshNestedProjection();
				};
				try {
					emitNewControlEvents(job);
					reconcileNestedDescendants();
					const reconciliation = reconcileRun(job.asyncDir, {
						resultsDir,
						kill: options.kill,
						now: options.now,
						startedRun: {
							runId: job.asyncId,
							pid: job.pid,
							sessionId: job.sessionId,
							mode: job.mode,
							agents: job.agents,
							parallelGroups: job.parallelGroups,
							startedAt: job.startedAt,
							sessionFile: job.sessionFile,
						},
					});
					const status = reconciliation.status ?? readRunStatus(job.asyncDir);
					if (status) {
						synchronizePersistedRoute(job, status);
						const previousStatus = job.status;
						const preserveTerminalState =
							isTerminalJobStatus(previousStatus) && !isTerminalJobStatus(status.state);
						job.processTerminal = status.processTerminal ?? job.processTerminal;
						if (!preserveTerminalState) job.status = status.state;
						job.error = status.error;
						if (!isTerminalJobStatus(job.status)) cancelCleanup(job.asyncId);
						if (preserveTerminalState) {
							rememberRecentAgentJob(state, job);
							if (!nestedRefreshFailed && job.nestedRoute) settleTerminalRoute(job);
							if (
								!physicalTerminalPending(job) &&
								!nestedRefreshFailed &&
								!hasLiveNestedDescendants(job.nestedChildren) &&
								!job.nestedRoute &&
								!state.cleanupTimers.has(job.asyncId)
							) {
								scheduleCleanup(job.asyncId, job);
							}
							continue;
						}
						// `listAsyncRuns` and lifecycle boundaries normalize accepted v1
						// artifacts to the active ps2 identity. Never regress the in-memory
						// projection to a raw legacy session id on a later status poll.
						job.activityState = status.activityState;
						job.lastActivityAt = status.lastActivityAt ?? job.lastActivityAt;
						job.currentTool = status.currentTool;
						job.currentToolStartedAt = status.currentToolStartedAt;
						job.currentPath = status.currentPath;
						job.turnCount = status.turnCount ?? job.turnCount;
						job.toolCount = status.toolCount ?? job.toolCount;
						job.steering = status.steering ?? job.steering;
						job.mode = status.mode;
						job.currentStep = status.currentStep ?? job.currentStep;
						job.startedAt = status.startedAt ?? job.startedAt;
						if (status.lastUpdate !== undefined) job.updatedAt = status.lastUpdate;
						if (status.steps?.length) {
							const groups = normalizeParallelGroups(status.parallelGroups, status.steps.length);
							job.parallelGroups = groups.length ? groups : job.parallelGroups;
							job.hasParallelGroups = groups.length > 0 || job.hasParallelGroups;
							const currentStep = status.currentStep;
							const activeGroup =
								currentStep !== undefined
									? groups.find(
											(group) => currentStep >= group.start && currentStep < group.start + group.count,
										)
									: undefined;
							const visibleSteps = activeGroup
								? status.steps
										.slice(activeGroup.start, activeGroup.start + activeGroup.count)
										.map((step, index) => ({ ...step, index: activeGroup.start + index }))
								: status.steps.map((step, index) => ({ ...step, index }));
							job.activeParallelGroup = Boolean(activeGroup);
							job.agents = visibleSteps.map((step) => step.agent);
							job.steps = visibleSteps;
							refreshNestedProjection();
							job.stepsTotal = visibleSteps.length;
							job.runningSteps = visibleSteps.filter((step) => step.status === "running").length;
							job.completedSteps = visibleSteps.filter(
								(step) => step.status === "complete" || step.status === "completed",
							).length;
							if (status.state === "complete") job.completedSteps = visibleSteps.length;
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
						job.sessionFile = status.sessionFile ?? job.sessionFile;
						if (
							job.status === "complete" ||
							job.status === "failed" ||
							job.status === "paused" ||
							job.status === "stopped"
						) {
							rememberRecentAgentJob(state, job);
							if (!nestedRefreshFailed && job.nestedRoute) settleTerminalRoute(job);
							if (
								!physicalTerminalPending(job) &&
								!nestedRefreshFailed &&
								!hasLiveNestedDescendants(job.nestedChildren) &&
								!job.nestedRoute &&
								(previousStatus !== job.status || !state.cleanupTimers.has(job.asyncId))
							) {
								scheduleCleanup(job.asyncId, job);
							}
						}
						continue;
					}
					if (job.status === "queued") {
						job.status = "running";
						job.updatedAt = Date.now();
					}
				} catch (error) {
					// Reading and reconciliation are observers. A transient EIO or malformed
					// snapshot is not process/result proof and must never terminalize a live
					// Agent. Retain the last known state and let the next poll recover.
					reportAgentDiagnostic(
						`Failed to observe async status for '${job.asyncDir}'; retaining prior state:`,
						error,
					);
				}
			}
			options.onRefresh?.();
		}, pollIntervalMs);
		state.poller.unref?.();
	};

	const handleStarted = (data: unknown) => {
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
		state.asyncJobs.set(info.id, {
			asyncId: info.id,
			asyncDir,
			...(typeof info.cwd === "string" ? { cwd: path.resolve(info.cwd) } : {}),
			status: "queued",
			pid: typeof info.pid === "number" ? info.pid : undefined,
			...(normalizedSessionId ? { sessionId: normalizedSessionId } : {}),
			mode:
				info.mode === "parallel" || (info.mode !== "single" && (rawAgents?.length ?? 0) > 1)
					? "parallel"
					: "single",
			description: info.description ?? info.goal ?? info.task,
			descriptions: info.descriptions,
			tasks: info.tasks,
			agents,
			parallelGroups: validParallelGroups,
			nestedRoute: info.nestedRoute,
			stepsTotal: firstGroupCount ?? agents?.length,
			hasParallelGroups: validParallelGroups.length > 0,
			activeParallelGroup: Boolean(firstGroupCount && firstGroupCount > 0),
			startedAt: now,
			updatedAt: now,
			timeoutMs: info.timeoutMs,
			deadlineAt: info.deadlineAt,
			turnBudget: info.turnBudget,
			controlEventCursor: 0,
		});
		const startedJob = state.asyncJobs.get(info.id);
		if (startedJob) rememberRecentAgentJob(state, startedJob);
		ensurePoller();
	};

	const handleComplete = (data: unknown) => {
		const result = data as {
			id?: string;
			success?: boolean;
			state?: AsyncJobState["status"];
			asyncDir?: string;
			sessionId?: string;
			stopped?: boolean;
		};
		const asyncId = result.id;
		if (!asyncId) return;
		if (state.currentSessionId && !normalizeAcceptedSessionId(result.sessionId, asyncId)) return;
		const job = state.asyncJobs.get(asyncId);
		let nestedRefreshFailed = false;
		if (job) {
			job.status = result.state ?? (result.success ? "complete" : "failed");
			job.stopped = result.stopped ?? job.stopped;
			job.updatedAt = Date.now();
			if (result.asyncDir) job.asyncDir = result.asyncDir;
			try {
				updateAsyncJobNestedProjection(job);
			} catch (error) {
				if (recoverRetiredRoute(job, error)) {
					nestedRefreshFailed = false;
				} else {
					nestedRefreshFailed = true;
					reportAgentDiagnostic(`Failed to refresh nested async descendants for '${job.asyncDir}':`, error);
				}
			}
		}
		if (job) rememberRecentAgentJob(state, job);
		if (!nestedRefreshFailed && job?.nestedRoute) settleTerminalRoute(job);
		// A result is semantic completion, not physical runner/writer proof. Keep
		// polling until status reconciliation observes the terminal process tuple.
		if (job) ensurePoller();
	};

	const resetJobs = () => {
		trackerGeneration += 1;
		settlementAbortController.abort(new Error("Agent tracker session changed."));
		settlementAbortController = new AbortController();
		for (const timer of state.cleanupTimers.values()) {
			clearTimeout(timer);
		}
		state.cleanupTimers.clear();
		state.asyncJobs.clear();
		state.recentAgentJobs?.clear();
		state.foregroundControls?.clear();
		foregroundSettlementAttempts.clear();
		routeSettlements.clear();
		state.lastForegroundControlId = null;
		state.resultFileCoalescer.clear();
	};

	const restoreActiveJobs = () => {
		if (!state.currentSessionId) return;
		const observedRuns = listRuns(asyncDirRoot, {
			sessionScope: state.currentSessionScope ?? undefined,
			...(state.currentSessionScope ? {} : { sessionId: state.currentSessionId }),
			resultsDir,
			kill: options.kill,
			now: options.now,
			preselectRecent: true,
			reconcile: false,
		});
		const activeRuns = observedRuns.filter((run) => run.state === "queued" || run.state === "running");
		const recentTerminalRuns = observedRuns
			.filter((run) => run.state !== "queued" && run.state !== "running")
			.slice(0, MAX_RECENT_AGENT_JOBS);
		const runs: AsyncRunSummary[] = [...activeRuns, ...recentTerminalRuns];
		for (const run of runs) {
			const job = summaryToJob(run);
			rememberRecentAgentJob(state, job);
			if (
				run.state === "queued" ||
				run.state === "running" ||
				run.nestedRoute ||
				(run.processTerminal !== undefined && run.processTerminal.state !== "observed")
			) {
				state.asyncJobs.set(run.id, job);
			}
		}
	};

	return { ensurePoller, handleStarted, handleComplete, resetJobs, restoreActiveJobs };
}
