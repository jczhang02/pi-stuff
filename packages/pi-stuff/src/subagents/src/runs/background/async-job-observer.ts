import * as fs from "node:fs";
import { isRuntimeString } from "../../../../shared/runtime-type.js";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import {
	type AsyncJobState,
	type AsyncStatus,
	type ControlEvent,
	type SteeringNotice,
	SUBAGENT_CONTROL_EVENT,
	SUBAGENT_CONTROL_INTERCOM_EVENT,
	SUBAGENT_STEERING_NOTICE_EVENT,
} from "../../shared/types.ts";
import { formatControlNoticeMessage } from "../shared/subagent-control.ts";
import { readNewAsyncControlEvents } from "./async-control-events.ts";
import {
	type AsyncStatusReader,
	parseTrackerEventRecord,
	recoverLegacyFinalReports,
	type TrackerEventRecord,
} from "./async-job-recovery.ts";

const STATUS_WATCH_FALLBACK_DELAY_MS = 150;

interface JobObservation {
	control: boolean;
	fallbackTimer?: ReturnType<typeof setInterval>;
	lastIpcStatusAt?: number;
	retryTimer?: ReturnType<typeof setTimeout>;
	running: boolean;
	status: boolean;
	statusFallbackTimer?: ReturnType<typeof setTimeout>;
	watcher?: fs.FSWatcher;
}

export type ObservationKind = { status?: boolean; control?: boolean };

type AsyncLifecycleEmitter = <Payload extends object>(event: string, payload: Payload) => void;

interface AsyncJobObserverOptions {
	readonly acceptSessionId: (sessionId: string | undefined, runId: string) => false | string | undefined;
	readonly emitLifecycleEvent: AsyncLifecycleEmitter;
	readonly generation: () => number;
	readonly isCurrentJob: (job: AsyncJobState) => boolean;
	readonly onRefresh: () => void;
	readonly onStatus: (job: AsyncJobState, status: AsyncStatus) => void;
	readonly pollIntervalMs: number;
	readonly readRunStatus: AsyncStatusReader;
}

/** Owns native observation, polling fallback, and durable control-event delivery for async jobs. */
export class AsyncJobObserver {
	private readonly observations = new Map<string, JobObservation>();
	private readonly options: AsyncJobObserverOptions;
	private readonly steeringNoticeSeen = new Map<string, number>();

	constructor(options: AsyncJobObserverOptions) {
		this.options = options;
	}

	ensure(job: AsyncJobState): void {
		const observation = this.observationFor(job.asyncId);
		if (observation.watcher || observation.fallbackTimer) return;
		try {
			const watcher = fs.watch(job.asyncDir, (_event, filename) => {
				if (!this.options.isCurrentJob(job)) return;
				const name = filename?.toString();
				if (!name || name === "events.jsonl") void this.observe(job, { control: true });
				if (!name || name === "status.json" || name === "process-terminal.json") {
					this.scheduleStatusWatchFallback(job);
				}
			});
			watcher.on("error", (error) => this.startFallbackObserver(job, error));
			watcher.unref?.();
			observation.watcher = watcher;
		} catch (error) {
			this.startFallbackObserver(job, error);
		}
	}

	async observe(job: AsyncJobState, kind: ObservationKind): Promise<void> {
		const observation = this.observationFor(job.asyncId);
		observation.status ||= kind.status === true;
		observation.control ||= kind.control === true;
		if (observation.running) return;
		observation.running = true;
		const expectedGeneration = this.options.generation();
		let changed = false;
		try {
			do {
				const readStatus = observation.status;
				const readControl = observation.control;
				observation.status = false;
				observation.control = false;
				if (readControl) {
					const control = await readNewAsyncControlEvents(job, (line) => this.handleControlLine(job, line));
					changed ||= control.changed;
					observation.control ||= control.more;
				}
				if (readStatus) {
					const observedStatus = await this.options.readRunStatus(job.asyncDir);
					const status = observedStatus ? await recoverLegacyFinalReports(observedStatus) : null;
					if (status && status.runId === job.asyncId && this.current(job, expectedGeneration)) {
						this.options.onStatus(job, status);
						changed = true;
					}
				}
			} while (this.current(job, expectedGeneration) && (observation.status || observation.control));
		} catch (error) {
			if (this.current(job, expectedGeneration)) {
				reportAgentDiagnostic(
					`Failed to observe async status for '${job.asyncDir}'; retaining prior state:`,
					error,
				);
				if (!observation.retryTimer) {
					observation.retryTimer = setTimeout(() => {
						delete observation.retryTimer;
						void this.observe(job, { status: true, control: true });
					}, this.options.pollIntervalMs);
					observation.retryTimer.unref?.();
				}
			}
		} finally {
			observation.running = false;
			if (changed && this.current(job, expectedGeneration)) this.options.onRefresh();
		}
	}

	noteIpcStatus(asyncId: string): void {
		this.observationFor(asyncId).lastIpcStatusAt = Date.now();
	}

	stop(asyncId: string): void {
		const observation = this.observations.get(asyncId);
		observation?.watcher?.close();
		if (observation?.fallbackTimer) clearInterval(observation.fallbackTimer);
		if (observation?.statusFallbackTimer) clearTimeout(observation.statusFallbackTimer);
		if (observation?.retryTimer) clearTimeout(observation.retryTimer);
		this.observations.delete(asyncId);
	}

	clear(): void {
		for (const asyncId of this.observations.keys()) this.stop(asyncId);
		this.steeringNoticeSeen.clear();
	}

	private observationFor(asyncId: string): JobObservation {
		const observation = this.observations.get(asyncId) ?? { running: false, status: false, control: false };
		this.observations.set(asyncId, observation);
		return observation;
	}

	private current(job: AsyncJobState, generation: number): boolean {
		return this.options.generation() === generation && this.options.isCurrentJob(job);
	}

	private handleControlLine(job: AsyncJobState, line: string): boolean {
		if (!line.trim()) return false;
		let parsed: TrackerEventRecord;
		try {
			parsed = parseTrackerEventRecord(line);
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
			const sessionId = this.options.acceptSessionId(notice.currentSessionId, notice.runId);
			if (sessionId === false) return false;
			const key = `${notice.runId}:${notice.requestId}:${notice.state}`;
			if (this.steeringNoticeSeen.has(key)) return false;
			const now = Date.now();
			this.steeringNoticeSeen.set(key, now);
			if (this.steeringNoticeSeen.size > 200) {
				for (const [seenKey, seenAt] of this.steeringNoticeSeen) {
					if (now - seenAt > 10 * 60 * 1_000 || this.steeringNoticeSeen.size > 200) {
						this.steeringNoticeSeen.delete(seenKey);
					}
				}
			}
			const payload = { ...notice, source: "async", asyncDir: job.asyncDir, noticeText: notice.message };
			if (sessionId) Object.assign(payload, { currentSessionId: sessionId });
			this.options.emitLifecycleEvent(SUBAGENT_STEERING_NOTICE_EVENT, payload);
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
		if (controlRecord.channels.includes("event")) {
			this.options.emitLifecycleEvent(SUBAGENT_CONTROL_EVENT, payload);
		}
		if (
			controlRecord.event.type !== "active_long_running" &&
			controlRecord.channels.includes("intercom") &&
			controlRecord.intercom?.to &&
			controlRecord.intercom.message
		) {
			this.options.emitLifecycleEvent(SUBAGENT_CONTROL_INTERCOM_EVENT, {
				...payload,
				to: controlRecord.intercom.to,
				message: controlRecord.intercom.message,
			});
		}
		return true;
	}

	private startFallbackObserver(job: AsyncJobState, cause: unknown): void {
		const observation = this.observationFor(job.asyncId);
		observation.watcher?.close();
		delete observation.watcher;
		if (observation.fallbackTimer) return;
		reportAgentDiagnostic(
			`Agent status observation for '${job.asyncId}' fell back to asynchronous reconciliation:`,
			cause,
		);
		const timer = setInterval(
			() => void this.observe(job, { status: true, control: true }),
			this.options.pollIntervalMs,
		);
		timer.unref?.();
		observation.fallbackTimer = timer;
	}

	private scheduleStatusWatchFallback(job: AsyncJobState): void {
		const observation = this.observationFor(job.asyncId);
		if (observation.statusFallbackTimer) return;
		const timer = setTimeout(() => {
			delete observation.statusFallbackTimer;
			if (Date.now() - (observation.lastIpcStatusAt ?? 0) < STATUS_WATCH_FALLBACK_DELAY_MS * 2) return;
			void this.observe(job, { status: true });
		}, STATUS_WATCH_FALLBACK_DELAY_MS);
		timer.unref?.();
		observation.statusFallbackTimer = timer;
	}
}
