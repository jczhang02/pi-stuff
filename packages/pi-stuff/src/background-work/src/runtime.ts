import { randomInt } from "node:crypto";
import { accessSync, constants } from "node:fs";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	BashToolDetails,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type AgentWorkOrigin,
	readCurrentAgentWorkOrigin,
	withAgentWorkOrigin,
} from "../../conversation-ui/agent-run-origin.js";
import { requestStatuslineGitRefreshAfterUserWork, sendSuiteAgentMessage } from "../../conversation-ui/index.js";
import type { SuiteAgentMessageHost } from "../../conversation-ui/suite-agent-message.js";
import { settleWithin } from "../../lifecycle-deadline.js";
import { reportWorkDiagnostic } from "./diagnostics.js";
import { projectNotificationBatch } from "./notification-projection.js";
import { BoundedOutputFile, boundedTextTail, DEFAULT_MODEL_OUTPUT_LIMIT, tryReadBoundedTail } from "./output.js";
import {
	captureProcessIdentityWithRetry,
	resolveSupervisorExecutable,
	signalVerifiedSupervisor,
	spawnSupervisor,
} from "./process.js";
import {
	ShellActivity,
	type ShellActivityDependencies,
	type ShellActivityOwner,
	type ShellLaunchInput,
} from "./shell-activity.js";
import { reconcileStaleRuns, WorkRunStorage } from "./storage.js";

const DEFAULT_BACKGROUND_AFTER_MS = 120_000;
const MAX_CONCURRENT_ACTIVITIES = 16;
const MAX_TERMINAL_RECEIPTS = 64;
const MAX_NOTIFICATION_OUTCOMES = 16;
const NOTIFICATION_BATCH_DELAY_MS = 200;
const NOTIFICATION_RETRY_INITIAL_MS = 250;
const NOTIFICATION_RETRY_MAX_MS = 5_000;
const STOP_COMPLETION_GRACE_MS = 3_000;
const SHUTDOWN_GRACE_MS = 1_000;
const DEFAULT_METADATA_HEARTBEAT_MS = 5_000;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export type BackgroundWorkKind = "monitor" | "shell";
export type BackgroundWorkStatus = "running" | "stopping";
export type BackgroundWorkTerminalStatus = "completed" | "failed" | "stopped" | "timed_out";
export { projectNotificationBatch } from "./notification-projection.js";

export interface BackgroundWorkBashDetails extends BashToolDetails {
	readonly backgroundTaskId?: string;
}

export interface BackgroundWorkSnapshot {
	readonly command?: string;
	readonly description?: string;
	readonly id: string;
	readonly kind: BackgroundWorkKind;
	readonly monitorFailureText?: string;
	readonly monitorSource?: "command" | "file" | "http" | "log";
	readonly monitorSuccessText?: string;
	readonly monitorTarget?: string;
	readonly monitorTimeoutSeconds?: number;
	readonly outputPath?: string;
	readonly recentOutput?: string;
	readonly startedAt: number;
	readonly status: BackgroundWorkStatus;
	readonly title: string;
}

export interface BackgroundWorkOutcome {
	readonly endedAt: number;
	readonly exitCode?: number;
	readonly id: string;
	readonly kind: BackgroundWorkKind;
	readonly outputPath?: string;
	/** Parent Agent attribution captured before asynchronous shell launch. */
	readonly parentRunOrigin?: AgentWorkOrigin;
	readonly recentOutput?: string;
	readonly startedAt: number;
	readonly status: BackgroundWorkTerminalStatus;
	readonly summary: string;
	readonly title: string;
}

export interface BashExecutionInput {
	readonly command: string;
	readonly description?: string;
	readonly onUpdate?: AgentToolUpdateCallback<BackgroundWorkBashDetails | undefined>;
	readonly runInBackground?: boolean;
	readonly signal?: AbortSignal;
	readonly timeoutSeconds?: number;
}

export interface BackgroundMonitorActivity {
	cancel(reason: "shutdown" | "user"): Promise<BackgroundWorkOutcome>;
	readonly id: string;
	readonly outcome: Promise<BackgroundWorkOutcome>;
	readOutput(maxBytes?: number): string;
	snapshot(): BackgroundWorkSnapshot;
}

export interface CommandMonitorInput {
	readonly command: string;
	readonly description?: string;
	readonly failureText?: string;
	readonly successText?: string;
	readonly timeoutSeconds: number;
}

interface PendingNotification {
	readonly outcome: BackgroundWorkOutcome;
	readonly wake: boolean;
}

interface PendingForegroundLaunch {
	manualDetachRequested: boolean;
}

interface RuntimeOptions extends Partial<ShellActivityDependencies> {
	readonly backgroundAfterMs?: number;
	readonly commandPrefix?: string;
	readonly cwd: string;
	readonly pi: SuiteAgentMessageHost;
	/** Test seam for transient stale-runtime recovery failure. */
	readonly reconcileStale?: typeof reconcileStaleRuns;
	readonly sessionId: string;
	/** Test seam; shutdown retains durable recovery ownership after this deadline. */
	readonly shutdownGraceMs?: number;
	/** Test seam; production refreshes authenticated recovery ownership every five seconds. */
	readonly metadataHeartbeatMs?: number;
}

export class BackgroundWorkRuntime {
	private readonly activities = new Map<string, ShellActivity>();
	private readonly backgroundAfterMs: number;
	private readonly commandPrefix: string | undefined;
	private readonly cwd: string;
	private disposed = false;
	private readonly launchActivityIds = new Set<string>();
	private launchReservations = 0;
	private readonly launchSettlements = new Set<Promise<void>>();
	private readonly listeners = new Set<() => void>();
	private readonly metadataHeartbeatMs: number;
	private metadataHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
	private readonly monitors = new Map<string, BackgroundMonitorActivity>();
	private readonly notifications: PendingNotification[] = [];
	private readonly pendingForegroundLaunches = new Set<PendingForegroundLaunch>();
	private notificationDeferredDelayMs: number | undefined;
	private notificationRetryDelayMs = NOTIFICATION_RETRY_INITIAL_MS;
	private notificationFlush: Promise<void> | undefined;
	private notificationTimer: ReturnType<typeof setTimeout> | undefined;
	private preparation: Promise<void> | undefined;
	private readonly pi: SuiteAgentMessageHost;
	private readonly reconcileStale: typeof reconcileStaleRuns;
	private readonly rollbackSettlements = new Set<Promise<void>>();
	private readonly shellDependencies: ShellActivityDependencies;
	private readonly shellOwner: ShellActivityOwner;
	private readonly shutdownGraceMs: number;
	private readonly storage: WorkRunStorage;
	private readonly terminalOutcomes = new Map<string, BackgroundWorkOutcome>();

	constructor(options: RuntimeOptions) {
		this.backgroundAfterMs = options.backgroundAfterMs ?? DEFAULT_BACKGROUND_AFTER_MS;
		if (!Number.isFinite(this.backgroundAfterMs) || this.backgroundAfterMs <= 0) {
			throw new Error("Background Work foreground handoff delay must be positive");
		}
		this.commandPrefix = options.commandPrefix;
		this.cwd = options.cwd;
		this.pi = options.pi;
		this.reconcileStale = options.reconcileStale ?? reconcileStaleRuns;
		this.metadataHeartbeatMs = options.metadataHeartbeatMs ?? DEFAULT_METADATA_HEARTBEAT_MS;
		if (!Number.isFinite(this.metadataHeartbeatMs) || this.metadataHeartbeatMs <= 0) {
			throw new Error("Background Work metadata heartbeat interval must be positive");
		}
		this.shutdownGraceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
		this.storage = options.storage ?? new WorkRunStorage(options.cwd, options.sessionId);
		this.shellDependencies = {
			captureSupervisorIdentity: options.captureSupervisorIdentity ?? captureProcessIdentityWithRetry,
			cwd: options.cwd,
			outputFactory: options.outputFactory ?? ((filePath) => new BoundedOutputFile(filePath)),
			shellPath: options.shellPath,
			signalSupervisor: options.signalSupervisor ?? signalVerifiedSupervisor,
			stopCompletionGraceMs: options.stopCompletionGraceMs ?? STOP_COMPLETION_GRACE_MS,
			storage: this.storage,
			supervisorExecutable: resolveSupervisorExecutable(options.supervisorExecutable),
			supervisorFactory: options.supervisorFactory ?? spawnSupervisor,
		};
		this.shellOwner = {
			changed: () => this.emit(),
			disposed: () => this.disposed,
			persist: () => this.persistRunningProcesses(),
			settled: (outcome, wake) => {
				this.emit();
				if (wake === undefined) return;
				if (outcome.parentRunOrigin === "user") requestStatuslineGitRefreshAfterUserWork(this.pi);
				this.enqueueNotification(outcome, wake);
			},
			unregister: (activity, receipt) => {
				this.activities.delete(activity.id);
				if (receipt) this.rememberTerminalOutcome(receipt);
			},
		};
	}

	hasCommandPrefix(): boolean {
		return Boolean(this.commandPrefix?.trim());
	}

	/** Perform process-mutating stale recovery only after an explicit Work action. */
	async prepare(): Promise<void> {
		if (!this.preparation) {
			const attempt = this.reconcileStale(this.cwd).then((reconciliation) => {
				if (reconciliation.unresolvedDirectories > 0) {
					reportWorkDiagnostic(
						`${String(reconciliation.unresolvedDirectories)} unverified stale runtime director${reconciliation.unresolvedDirectories === 1 ? "y was" : "ies were"} left untouched`,
						undefined,
						{ key: "unverified-stale-runtime", severity: "warning" },
					);
				}
			});
			this.preparation = attempt;
			void attempt.catch(() => {
				if (this.preparation === attempt) this.preparation = undefined;
			});
		}
		return this.preparation;
	}

	snapshot(): readonly BackgroundWorkSnapshot[] {
		return [
			...Array.from(this.activities.values())
				.filter((activity) => activity.visible)
				.map((activity) => activity.snapshot()),
			...Array.from(this.monitors.values(), (monitor) => monitor.snapshot()),
		].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	newMonitorId(): string {
		return this.randomId("monitor");
	}

	registerMonitor(activity: BackgroundMonitorActivity): () => void {
		if (this.disposed) throw new Error("Background Work session is shutting down");
		this.assertCapacity();
		if (this.monitors.has(activity.id) || this.activities.has(activity.id)) {
			throw new Error(`Background Work activity '${activity.id}' already exists`);
		}
		this.monitors.set(activity.id, activity);
		this.emit();
		void activity.outcome.then((outcome) => {
			if (this.monitors.get(activity.id) !== activity) return;
			this.monitors.delete(activity.id);
			this.rememberTerminalOutcome(outcome);
			this.emit();
			if (!this.disposed && outcome.status !== "stopped") this.enqueueNotification(outcome, true);
		});
		return () => {
			if (this.monitors.get(activity.id) !== activity) return;
			this.monitors.delete(activity.id);
			this.emit();
		};
	}

	async executeBash(
		input: BashExecutionInput,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<BackgroundWorkBashDetails | undefined>> {
		const parentRunOrigin = readCurrentAgentWorkOrigin(this.pi);
		const pendingForegroundLaunch = input.runInBackground ? undefined : { manualDetachRequested: false };
		if (pendingForegroundLaunch) this.pendingForegroundLaunches.add(pendingForegroundLaunch);
		let activity: ShellActivity;
		try {
			await this.prepare();
			if (!input.command.trim()) throw new Error("Command is empty");
			accessSync(ctx.cwd, constants.F_OK);
			const launch: ShellLaunchInput = {
				backgrounded: input.runInBackground === true,
				command: this.commandPrefix ? `${this.commandPrefix}\n${input.command}` : input.command,
				context: ctx,
				parentRunOrigin,
			};
			if (input.description) Object.assign(launch, { description: input.description });
			activity = await this.spawnProcess(launch);
			if (pendingForegroundLaunch?.manualDetachRequested) activity.detach("manual");
		} finally {
			if (pendingForegroundLaunch) this.pendingForegroundLaunches.delete(pendingForegroundLaunch);
		}
		return activity.execute(input, this.backgroundAfterMs);
	}

	detachActiveForeground(): boolean {
		const active = [...this.activities.values()]
			.filter((activity) => activity.isActiveForeground())
			.sort((left, right) => right.startedAt - left.startedAt)[0];
		if (active) return active.detach("manual");
		const pending = [...this.pendingForegroundLaunches].at(-1);
		if (!pending || pending.manualDetachRequested) return false;
		pending.manualDetachRequested = true;
		return true;
	}

	async startCommandMonitor(
		input: CommandMonitorInput,
		ctx: ExtensionContext,
	): Promise<{
		readonly id: string;
		readonly outcome: Promise<BackgroundWorkOutcome>;
		readonly outputPath?: string;
	}> {
		if (!input.command.trim()) throw new Error("Monitor command is empty");
		const launch: ShellLaunchInput = {
			backgrounded: true,
			command: this.commandPrefix ? `${this.commandPrefix}\n${input.command}` : input.command,
			context: ctx,
			kind: "monitor",
			monitorSource: "command",
			monitorTarget: input.command,
			monitorTimeoutSeconds: input.timeoutSeconds,
		};
		if (input.description) Object.assign(launch, { description: input.description });
		if (input.failureText) Object.assign(launch, { monitorFailureText: input.failureText });
		if (input.successText) Object.assign(launch, { monitorSuccessText: input.successText });
		return (await this.spawnProcess(launch)).startMonitor(input.timeoutSeconds);
	}

	readOutput(id: string, maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
		const activity = this.activities.get(id);
		if (activity) return activity.readOutput(maxBytes);
		const monitor = this.monitors.get(id);
		if (monitor) return monitor.readOutput(maxBytes);
		const terminal = this.terminalOutcomes.get(id);
		if (terminal) {
			const durable = terminal.outputPath ? tryReadBoundedTail(terminal.outputPath, maxBytes) : undefined;
			const output = durable ?? boundedTextTail(terminal.recentOutput ?? "", maxBytes);
			return output ? `${terminal.summary}\n\n${output}` : terminal.summary;
		}
		throw new Error(`No current or recently finished Background Work activity matches '${id}'`);
	}

	async stop(id: string): Promise<BackgroundWorkOutcome> {
		const shell = this.activities.get(id);
		if (shell) return shell.stop("user");
		const monitor = this.monitors.get(id);
		if (monitor) return monitor.cancel("user");
		const terminal = this.terminalOutcomes.get(id);
		if (terminal) return terminal;
		throw new Error(`No current or recently finished Background Work activity matches '${id}'`);
	}

	async shutdown(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.listeners.clear();
		this.stopMetadataHeartbeat();
		if (this.notificationTimer) clearTimeout(this.notificationTimer);
		this.notificationTimer = undefined;
		this.notificationDeferredDelayMs = undefined;
		this.notifications.length = 0;
		const cleanup = Promise.allSettled([
			...Array.from(this.activities.values(), (activity) => activity.stop("shutdown")),
			...Array.from(this.monitors.values(), (monitor) => monitor.cancel("shutdown")),
			...this.launchSettlements,
			...this.rollbackSettlements,
		]);
		await settleWithin(cleanup, this.shutdownGraceMs);
		// A stop can fail only while a verified process group is still alive. Keep
		// its recovery identity, but release this Host's output descriptors.
		for (const activity of this.activities.values()) activity.closeOutput();
		this.monitors.clear();
		try {
			this.persistRunningProcesses();
		} catch (error) {
			reportWorkDiagnostic("Shutdown state could not be saved", error, { key: "shutdown-persist" });
		}
		if (this.activities.size === 0) {
			try {
				this.storage.cleanup();
			} catch (error) {
				reportWorkDiagnostic("Shutdown state could not be cleaned up", error, { key: "shutdown-cleanup" });
			}
		}
		this.terminalOutcomes.clear();
		this.emit();
	}

	private assertCapacity(): void {
		if (this.activities.size + this.monitors.size + this.launchReservations >= MAX_CONCURRENT_ACTIVITIES) {
			throw new Error(`At most ${String(MAX_CONCURRENT_ACTIVITIES)} Background Work activities may run at once`);
		}
	}

	private async spawnProcess(input: ShellLaunchInput): Promise<ShellActivity> {
		if (this.disposed) throw new Error("Background Work session is shutting down");
		this.assertCapacity();
		const id = this.randomId(input.kind ?? "shell");
		this.launchActivityIds.add(id);
		this.launchReservations += 1;
		const reservation = { active: true };
		let settleLaunch!: () => void;
		const launchSettlement = new Promise<void>((resolve) => {
			settleLaunch = resolve;
		});
		this.launchSettlements.add(launchSettlement);
		try {
			return await this.spawnProcessTransaction(input, reservation, id);
		} finally {
			this.launchActivityIds.delete(id);
			if (reservation.active) {
				reservation.active = false;
				this.launchReservations -= 1;
			}
			settleLaunch();
			this.launchSettlements.delete(launchSettlement);
		}
	}

	private async spawnProcessTransaction(
		input: ShellLaunchInput,
		reservation: { active: boolean },
		id: string,
	): Promise<ShellActivity> {
		const activity = await ShellActivity.spawn(input, id, this.shellDependencies, this.shellOwner);
		this.activities.set(id, activity);
		reservation.active = false;
		this.launchReservations -= 1;
		activity.bind();
		try {
			this.persistRunningProcesses();
		} catch (error) {
			this.trackRollback(activity.rollback());
			throw error;
		}
		await activity.authorize();
		return activity;
	}

	private trackRollback(settlement: Promise<void>): void {
		this.rollbackSettlements.add(settlement);
		void settlement.then(
			() => this.rollbackSettlements.delete(settlement),
			(error) => {
				this.rollbackSettlements.delete(settlement);
				reportWorkDiagnostic("Launch rollback did not settle", error, { key: "launch-rollback-settle" });
			},
		);
	}

	private persistRunningProcesses(): void {
		if (!this.storage.directory && this.activities.size === 0) {
			this.stopMetadataHeartbeat();
			return;
		}
		this.storage.persist(Array.from(this.activities.values(), (activity) => activity.storedTask()));
		this.refreshMetadataHeartbeat();
	}

	private refreshMetadataHeartbeat(): void {
		if (this.disposed || this.activities.size === 0) {
			this.stopMetadataHeartbeat();
			return;
		}
		if (this.metadataHeartbeatTimer) return;
		this.metadataHeartbeatTimer = setInterval(() => {
			if (this.disposed || this.activities.size === 0) {
				this.stopMetadataHeartbeat();
				return;
			}
			try {
				this.persistRunningProcesses();
			} catch (error) {
				reportWorkDiagnostic("Task recovery metadata refresh failed", error, {
					action: "/tasks",
					key: "recovery-metadata-refresh",
					notice: true,
				});
			}
		}, this.metadataHeartbeatMs);
		this.metadataHeartbeatTimer.unref?.();
	}

	private stopMetadataHeartbeat(): void {
		if (!this.metadataHeartbeatTimer) return;
		clearInterval(this.metadataHeartbeatTimer);
		this.metadataHeartbeatTimer = undefined;
	}

	private enqueueNotification(outcome: BackgroundWorkOutcome, wake: boolean): void {
		this.notifications.push({ outcome, wake });
		this.scheduleNotificationFlush(NOTIFICATION_BATCH_DELAY_MS);
	}

	private scheduleNotificationFlush(delayMs: number, replace = false): void {
		if (this.disposed || this.notifications.length === 0) return;
		if (this.notificationFlush) {
			if (replace || this.notificationDeferredDelayMs === undefined) this.notificationDeferredDelayMs = delayMs;
			return;
		}
		if (this.notificationTimer) {
			if (!replace) return;
			clearTimeout(this.notificationTimer);
		}
		this.notificationTimer = setTimeout(() => {
			this.notificationTimer = undefined;
			let tracked: Promise<void>;
			tracked = this.flushNotifications().finally(() => {
				if (this.notificationFlush === tracked) this.notificationFlush = undefined;
				if (this.notifications.length > 0 && !this.notificationTimer) {
					const deferredDelay = this.notificationDeferredDelayMs ?? NOTIFICATION_BATCH_DELAY_MS;
					this.notificationDeferredDelayMs = undefined;
					this.scheduleNotificationFlush(deferredDelay, true);
				}
			});
			this.notificationFlush = tracked;
		}, delayMs);
		this.notificationTimer.unref?.();
	}

	private async flushNotifications(): Promise<void> {
		if (this.disposed || this.notifications.length === 0) return;
		const pending = this.notifications.splice(0);
		for (let offset = 0; offset < pending.length; offset += MAX_NOTIFICATION_OUTCOMES) {
			const batch = pending.slice(offset, offset + MAX_NOTIFICATION_OUTCOMES);
			const wake = batch.some((item) => item.wake);
			const parentRunOrigin = batch.some((item) => item.outcome.parentRunOrigin === "user") ? "user" : "automatic";
			const projected = projectNotificationBatch(batch.map((item) => item.outcome));
			try {
				const accepted = await sendSuiteAgentMessage(
					this.pi,
					withAgentWorkOrigin(
						{
							customType: "pi-stuff-background-work-result",
							content: projected.content,
							details: { outcomes: projected.outcomes },
							display: true,
						},
						parentRunOrigin,
					),
					wake ? { deliverAs: "steer", triggerTurn: true } : { deliverAs: "followUp", triggerTurn: false },
					() => !this.disposed,
				);
				if (!accepted && !this.disposed) throw new Error("Background Work session changed before delivery.");
			} catch (error) {
				if (this.disposed) return;
				reportWorkDiagnostic("Task completion delivery failed; retrying", error, {
					key: "terminal-notification",
				});
				this.notifications.unshift(...pending.slice(offset));
				const retryDelay = this.notificationRetryDelayMs;
				this.notificationRetryDelayMs = Math.min(
					NOTIFICATION_RETRY_MAX_MS,
					Math.max(NOTIFICATION_RETRY_INITIAL_MS, retryDelay * 2),
				);
				this.scheduleNotificationFlush(retryDelay, true);
				return;
			}
		}
		this.notificationRetryDelayMs = NOTIFICATION_RETRY_INITIAL_MS;
	}

	private emit(): void {
		for (const listener of Array.from(this.listeners)) {
			try {
				listener();
			} catch {
				// A renderer must not change Background Work process ownership or outcomes.
			}
		}
	}

	private rememberTerminalOutcome(outcome: BackgroundWorkOutcome): void {
		this.terminalOutcomes.delete(outcome.id);
		this.terminalOutcomes.set(outcome.id, outcome);
		while (this.terminalOutcomes.size > MAX_TERMINAL_RECEIPTS) {
			const oldest = this.terminalOutcomes.keys().next().value;
			if (oldest === undefined) break;
			this.terminalOutcomes.delete(oldest);
		}
	}

	private randomId(kind: BackgroundWorkKind): string {
		const prefix = kind === "shell" ? "b" : "m";
		let id = "";
		do {
			id = prefix;
			for (let index = 0; index < 8; index += 1) id += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
		} while (
			this.activities.has(id) ||
			this.launchActivityIds.has(id) ||
			this.monitors.has(id) ||
			this.terminalOutcomes.has(id)
		);
		return id;
	}
}
