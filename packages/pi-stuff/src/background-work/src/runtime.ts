import { randomBytes, randomInt } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	BashToolDetails,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getShellConfig,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import {
	type AgentWorkOrigin,
	readCurrentAgentWorkOrigin,
	withAgentWorkOrigin,
} from "../../conversation-ui/agent-run-origin.js";
import { requestStatuslineGitRefreshAfterUserWork, sendSuiteAgentMessage } from "../../conversation-ui/index.js";
import type { SuiteAgentMessageHost } from "../../conversation-ui/suite-agent-message.js";
import { settleWithin } from "../../lifecycle-deadline.js";
import { type JsonValue, parseJsonValue } from "../../shared/json-value.js";
import { isRuntimeFunction, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { boundTerminalLine } from "../../tool-display/index.js";
import { reportWorkDiagnostic } from "./diagnostics.js";
import { projectNotificationBatch } from "./notification-projection.js";
import {
	BoundedOutputFile,
	boundedTextTail,
	DEFAULT_MODEL_OUTPUT_LIMIT,
	readBoundedTail,
	tryReadBoundedTail,
} from "./output.js";
import {
	captureProcessIdentity,
	captureProcessIdentityWithRetry,
	identityMatches,
	type ProcessIdentity,
	reapOwnedProcessGroup,
} from "./process.js";
import { reconcileStaleRuns, type StoredProcessTask, WorkRunStorage } from "./storage.js";

const DEFAULT_BACKGROUND_AFTER_MS = 120_000;

const QUICK_COMPLETION_MS = 2_000;
const MAX_CONCURRENT_ACTIVITIES = 16;
const MAX_TERMINAL_RECEIPTS = 64;
const MAX_NOTIFICATION_OUTCOMES = 16;
const NOTIFICATION_BATCH_DELAY_MS = 200;
const NOTIFICATION_RETRY_INITIAL_MS = 250;
const NOTIFICATION_RETRY_MAX_MS = 5_000;
const SUPERVISOR_POST_EXIT_DRAIN_MS = 500;
const STOP_COMPLETION_GRACE_MS = 3_000;
const SHUTDOWN_GRACE_MS = 1_000;
const DEFAULT_METADATA_HEARTBEAT_MS = 5_000;
const MAX_COMMAND_AUTHORIZATION_BYTES = 4 * 1024 * 1024;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const SUPERVISOR_PATH = fileURLToPath(new URL("./process-supervisor.mjs", import.meta.url));

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
	readonly toolCallId: string;
}

interface SpawnedActivity {
	backgrounded: boolean;
	commandIdentity?: ProcessIdentity;
	commandGroupReaped: boolean;
	completion: Promise<BackgroundWorkOutcome>;
	completionResolve: (outcome: BackgroundWorkOutcome) => void;
	controlBuffer: string;
	description?: string;
	detachReason?: "manual" | "timeout";
	detachResolve?: (reason: "manual" | "timeout") => void;
	detachResult: Promise<"manual" | "timeout">;
	finalized: boolean;
	finalizing: boolean;
	id: string;
	kind: BackgroundWorkKind;
	launchAuthorized: boolean;
	monitorFailureText?: string;
	monitorSource?: "command";
	monitorSuccessText?: string;
	monitorTarget?: string;
	monitorTimeoutSeconds?: number;
	output: BoundedOutputFile;
	outputLimitStopRequested: boolean;
	parentRunOrigin: AgentWorkOrigin;
	startedAt: number;
	status: BackgroundWorkStatus;
	stopPromise?: Promise<BackgroundWorkOutcome>;
	stopReason?: "abort" | "output_limit" | "shutdown" | "timeout" | "user";
	supervisor: SupervisorProcess;
	supervisorIdentity: ProcessIdentity;
	timeoutTimer?: ReturnType<typeof setTimeout>;
	title: string;
	toolCallId: string;
	command: string;
	commandAcknowledgementPath: string;
	commandAuthorizationPath: string;
}

interface SupervisorProcess {
	closeControl(): void;
	readonly completion: Promise<{
		readonly code: number | null;
		readonly error?: Error;
		readonly signal: NodeJS.Signals | null;
	}>;
	readonly control: Readable;
	readonly output: Readable;
	readonly pid: number;
	kill(signal: NodeJS.Signals): void;
	unref(): void;
}

interface SpawnProcessInput {
	readonly backgrounded: boolean;
	readonly command: string;
	readonly description?: string;
	readonly env: NodeJS.ProcessEnv;
	readonly kind?: BackgroundWorkKind;
	readonly monitorFailureText?: string;
	readonly monitorSource?: "command";
	readonly monitorSuccessText?: string;
	readonly monitorTarget?: string;
	readonly monitorTimeoutSeconds?: number;
	readonly parentRunOrigin?: AgentWorkOrigin;
	readonly toolCallId: string;
}

type SignalVerifiedSupervisor = (
	supervisor: SupervisorProcess,
	identity: ProcessIdentity,
	signal: NodeJS.Signals,
) => "gone" | "requested" | "unresolved";

function signalVerifiedSupervisor(
	supervisor: SupervisorProcess,
	identity: ProcessIdentity,
	signal: NodeJS.Signals,
): "gone" | "requested" | "unresolved" {
	if (!identityMatches(identity)) return "gone";
	try {
		// Signal only the still-authenticated supervisor. It remains the process
		// group leader while it escalates and reaps descendants; a group-wide
		// SIGKILL here would destroy that sole durable authority first.
		supervisor.kill(signal);
		return "requested";
	} catch {
		return identityMatches(identity) ? "unresolved" : "gone";
	}
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
	readonly toolCallId: string;
}

interface PendingNotification {
	readonly outcome: BackgroundWorkOutcome;
	readonly wake: boolean;
}

interface PendingForegroundLaunch {
	manualDetachRequested: boolean;
}

interface RuntimeOptions {
	readonly backgroundAfterMs?: number;
	/** Test seam for an in-flight supervisor identity observation. */
	readonly captureSupervisorIdentity?: typeof captureProcessIdentityWithRetry;
	readonly commandPrefix?: string;
	readonly cwd: string;
	readonly pi: SuiteAgentMessageHost;
	readonly outputFactory?: (path: string) => BoundedOutputFile;
	/** Test seam for transient stale-runtime recovery failure. */
	readonly reconcileStale?: typeof reconcileStaleRuns;
	readonly sessionId: string;
	/** Test seam; shutdown retains durable recovery ownership after this deadline. */
	readonly shutdownGraceMs?: number;
	/** Test seam; production refreshes authenticated recovery ownership every five seconds. */
	readonly metadataHeartbeatMs?: number;
	readonly shellPath?: string;
	readonly storage?: WorkRunStorage;
	readonly supervisorExecutable?: string;
	/** Test seam for a supervisor whose process and completion lifecycles can fail independently. */
	readonly supervisorFactory?: typeof spawnSupervisor;
	readonly stopCompletionGraceMs?: number;
	/** Test seam for exact supervisor-signal failures. */
	readonly signalSupervisor?: SignalVerifiedSupervisor;
}

function textResult(
	text: string,
	details?: BackgroundWorkBashDetails,
): AgentToolResult<BackgroundWorkBashDetails | undefined> {
	return { content: [{ type: "text", text }], details };
}

function emitToolUpdate(
	onUpdate: AgentToolUpdateCallback<BackgroundWorkBashDetails | undefined> | undefined,
	result: AgentToolResult<BackgroundWorkBashDetails | undefined>,
): void {
	try {
		onUpdate?.(result);
	} catch (error) {
		reportWorkDiagnostic("Bash progress observer failed", error, { key: "bash-progress-observer" });
	}
}

function titleFromCommand(command: string): string {
	const first =
		command
			.trim()
			.split(/\r?\n|&&|\|\||;/u)[0]
			?.trim() ?? "";
	return boundTerminalLine(first, 80) || "background command";
}

function timeoutMilliseconds(seconds: number): number {
	if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Bash timeout must be a positive finite number");
	return Math.min(2_147_483_647, Math.round(seconds * 1_000));
}

function randomActivityId(kind: BackgroundWorkKind, existing: ReadonlyMap<string, unknown>): string {
	const prefix = kind === "shell" ? "b" : "m";
	let id = "";
	do {
		id = prefix;
		for (let index = 0; index < 8; index += 1) id += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
	} while (existing.has(id));
	return id;
}

function sessionEnvironment(ctx: ExtensionContext): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env["PI_SESSION_ID"];
	delete env["PI_SESSION_FILE"];
	delete env["PI_PROVIDER"];
	delete env["PI_MODEL"];
	delete env["PI_REASONING_LEVEL"];
	env["PI_SESSION_ID"] = ctx.sessionManager.getSessionId();
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile) env["PI_SESSION_FILE"] = sessionFile;
	if (ctx.model) {
		env["PI_PROVIDER"] = ctx.model.provider;
		env["PI_MODEL"] = ctx.model.id;
	}
	if (ctx.thinkingLevel) env["PI_REASONING_LEVEL"] = ctx.thinkingLevel;
	return env;
}

function resolveSupervisorExecutable(override: string | undefined): string {
	if (override) return override;
	// The supervisor is plain ESM. Prefer Node's mature concurrent child-process
	// pipe implementation; Bun remains a portable fallback for Bun-only hosts.
	const executable = Bun.which("node") ?? Bun.which("bun");
	if (!executable) throw new Error("Background Work requires Node.js or Bun on PATH to run its process supervisor");
	return executable;
}

function readableCompletion(stream: Readable): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		stream.once("end", finish);
		stream.once("close", finish);
		stream.once("error", finish);
	});
}

function spawnSupervisor(
	executable: string,
	envelope: string,
	options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): SupervisorProcess {
	const subprocess = Bun.spawn({
		cmd: [executable, SUPERVISOR_PATH, envelope],
		cwd: options.cwd,
		detached: process.platform !== "win32",
		env: options.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!subprocess.pid) {
		subprocess.kill("SIGKILL");
		subprocess.unref();
		throw new Error("Background Work supervisor pipes were not created");
	}
	const control = Readable.fromWeb(subprocess.stdout);
	// The supervisor reserves stdout for control and merges command output onto stderr.
	const output = Readable.fromWeb(subprocess.stderr);
	const closeControl = () => {
		if (!control.destroyed) control.destroy();
	};
	const streamCompletion = Promise.all([readableCompletion(output), readableCompletion(control)]);
	const completion = subprocess.exited.then(async () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const drained = await Promise.race([
			streamCompletion.then(() => true),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), SUPERVISOR_POST_EXIT_DRAIN_MS);
			}),
		]);
		if (timer) clearTimeout(timer);
		if (!drained) {
			// A detached grandchild may inherit the supervisor's output descriptor
			// after both the command shell and supervisor have exited.
			// Process exit is authoritative; never let foreign pipe ownership keep a
			// completed Work task alive forever.
			output.destroy();
			closeControl();
		}
		return { code: subprocess.exitCode, signal: subprocess.signalCode };
	});
	return {
		closeControl,
		completion,
		control,
		output,
		pid: subprocess.pid,
		kill: (signal) => {
			subprocess.kill(signal);
		},
		unref: () => subprocess.unref(),
	};
}

function abandonSupervisor(supervisor: SupervisorProcess): void {
	try {
		supervisor.kill("SIGKILL");
	} catch {
		// The exact subprocess may already have exited.
	}
	supervisor.output.destroy();
	supervisor.closeControl();
	supervisor.unref();
}

async function abandonSupervisorAndWait(supervisor: SupervisorProcess): Promise<void> {
	abandonSupervisor(supervisor);
	await supervisor.completion;
}

function publishCommandAuthorization(filePath: string, token: string, command: string): void {
	const content = `${JSON.stringify({ version: 1, token, command })}\n`;
	if (Buffer.byteLength(content, "utf-8") > MAX_COMMAND_AUTHORIZATION_BYTES) {
		throw new Error(
			`Background Work command exceeds the ${formatSize(MAX_COMMAND_AUTHORIZATION_BYTES)} transport limit`,
		);
	}
	const temporary = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		writeFileSync(temporary, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
		renameSync(temporary, filePath);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function consumeCommandAcknowledgement(filePath: string, token: string, supervisorIdentity: ProcessIdentity): boolean {
	try {
		const stat = lstatSync(filePath);
		const currentUid = isRuntimeFunction(process.getuid) ? process.getuid() : undefined;
		if (
			stat.isSymbolicLink() ||
			!stat.isFile() ||
			stat.size <= 0 ||
			stat.size > 8 * 1024 ||
			(stat.mode & 0o077) !== 0 ||
			(currentUid !== undefined && stat.uid !== currentUid)
		) {
			throw new Error("Background Work command acknowledgement is not a private bounded regular file.");
		}
		const payload = parseJsonValue(readFileSync(filePath, "utf-8"));
		if (
			!isRuntimeObject(payload) ||
			payload === null ||
			Array.isArray(payload) ||
			payload["version"] !== 1 ||
			payload["token"] !== token ||
			payload["supervisorPid"] !== supervisorIdentity.pid ||
			payload["supervisorStarted"] !== supervisorIdentity.started
		) {
			throw new Error("Background Work command acknowledgement does not match its supervisor authority.");
		}
		rmSync(filePath, { force: true });
		return true;
	} catch (cause) {
		if (cause && isRuntimeObject(cause) && "code" in cause && cause.code === "ENOENT") return false;
		throw cause;
	}
}

function discardOutput(output: BoundedOutputFile): void {
	output.close();
	rmSync(output.path, { force: true });
}

export class BackgroundWorkRuntime {
	private readonly activities = new Map<string, SpawnedActivity>();
	private readonly backgroundAfterMs: number;
	private readonly captureSupervisorIdentity: typeof captureProcessIdentityWithRetry;
	private readonly commandPrefix: string | undefined;
	private readonly cwd: string;
	private disposed = false;
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
	private readonly outputFactory: (path: string) => BoundedOutputFile;
	private readonly pi: SuiteAgentMessageHost;
	private readonly reconcileStale: typeof reconcileStaleRuns;
	private readonly rollbackSettlements = new Set<Promise<void>>();
	private readonly shellPath: string | undefined;
	private readonly shutdownGraceMs: number;
	private readonly storage: WorkRunStorage;
	private readonly supervisorExecutable: string;
	private readonly supervisorFactory: typeof spawnSupervisor;
	private readonly stopCompletionGraceMs: number;
	private readonly signalSupervisor: SignalVerifiedSupervisor;
	private readonly terminalOutcomes = new Map<string, BackgroundWorkOutcome>();

	constructor(options: RuntimeOptions) {
		this.backgroundAfterMs = options.backgroundAfterMs ?? DEFAULT_BACKGROUND_AFTER_MS;
		if (!Number.isFinite(this.backgroundAfterMs) || this.backgroundAfterMs <= 0) {
			throw new Error("Background Work foreground handoff delay must be positive");
		}
		this.commandPrefix = options.commandPrefix;
		this.captureSupervisorIdentity = options.captureSupervisorIdentity ?? captureProcessIdentityWithRetry;
		this.cwd = options.cwd;
		this.pi = options.pi;
		this.outputFactory = options.outputFactory ?? ((filePath) => new BoundedOutputFile(filePath));
		this.reconcileStale = options.reconcileStale ?? reconcileStaleRuns;
		this.metadataHeartbeatMs = options.metadataHeartbeatMs ?? DEFAULT_METADATA_HEARTBEAT_MS;
		if (!Number.isFinite(this.metadataHeartbeatMs) || this.metadataHeartbeatMs <= 0) {
			throw new Error("Background Work metadata heartbeat interval must be positive");
		}
		this.shellPath = options.shellPath;
		this.shutdownGraceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
		this.storage = options.storage ?? new WorkRunStorage(options.cwd, options.sessionId);
		this.supervisorExecutable = resolveSupervisorExecutable(options.supervisorExecutable);
		this.supervisorFactory = options.supervisorFactory ?? spawnSupervisor;
		this.stopCompletionGraceMs = options.stopCompletionGraceMs ?? STOP_COMPLETION_GRACE_MS;
		this.signalSupervisor = options.signalSupervisor ?? signalVerifiedSupervisor;
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
				.filter((activity) => activity.launchAuthorized)
				.map((activity) => this.activitySnapshot(activity)),
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
		if (this.activities.size + this.monitors.size + this.launchReservations >= MAX_CONCURRENT_ACTIVITIES) {
			throw new Error(`At most ${String(MAX_CONCURRENT_ACTIVITIES)} Background Work activities may run at once`);
		}
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
		let activity: SpawnedActivity;
		try {
			await this.prepare();
			if (!input.command.trim()) throw new Error("Command is empty");
			accessSync(ctx.cwd, constants.F_OK);
			const resolvedCommand = this.commandPrefix ? `${this.commandPrefix}\n${input.command}` : input.command;
			const spawnInput: SpawnProcessInput = {
				backgrounded: input.runInBackground === true,
				command: resolvedCommand,
				env: sessionEnvironment(ctx),
				parentRunOrigin,
				toolCallId: input.toolCallId,
			};
			if (input.description) Object.assign(spawnInput, { description: input.description });
			activity = await this.spawnProcess(spawnInput);
			if (pendingForegroundLaunch?.manualDetachRequested) this.detach(activity, "manual");
		} finally {
			if (pendingForegroundLaunch) this.pendingForegroundLaunches.delete(pendingForegroundLaunch);
		}
		if (input.timeoutSeconds !== undefined) {
			activity.timeoutTimer = setTimeout(() => {
				this.requestStopInBackground(activity, "timeout", "timeout");
			}, timeoutMilliseconds(input.timeoutSeconds));
			activity.timeoutTimer.unref?.();
		}

		if (input.runInBackground) return this.backgroundLaunchResult(activity);

		let updateTimer: ReturnType<typeof setInterval> | undefined;
		let lastUpdate = "";
		const onAbort = () => {
			if (!activity.backgrounded) this.requestStopInBackground(activity, "abort", "abort signal");
		};
		if (input.signal) {
			if (input.signal.aborted) onAbort();
			else input.signal.addEventListener("abort", onAbort, { once: true });
		}
		const sendUpdate = () => {
			const output = activity.output.recentText(12_000);
			if (!output || output === lastUpdate) return;
			lastUpdate = output;
			emitToolUpdate(input.onUpdate, { content: [{ type: "text", text: output }], details: undefined });
		};
		emitToolUpdate(input.onUpdate, { content: [], details: undefined });
		const detachTimer = setTimeout(() => this.detach(activity, "timeout"), this.backgroundAfterMs);
		detachTimer.unref?.();
		let quickTimer: ReturnType<typeof setTimeout> | undefined;
		const quick = await Promise.race([
			activity.completion.then((outcome) => ({ kind: "completed" as const, outcome })),
			activity.detachResult.then((reason) => ({ kind: "detached" as const, reason })),
			new Promise<{ readonly kind: "still-running" }>((resolve) => {
				quickTimer = setTimeout(() => resolve({ kind: "still-running" }), QUICK_COMPLETION_MS);
				quickTimer.unref?.();
			}),
		]);
		if (quickTimer) clearTimeout(quickTimer);
		if (quick.kind === "completed") {
			clearTimeout(detachTimer);
			input.signal?.removeEventListener("abort", onAbort);
			return this.foregroundResult(quick.outcome);
		}
		if (quick.kind === "detached") {
			clearTimeout(detachTimer);
			input.signal?.removeEventListener("abort", onAbort);
			return this.backgroundLaunchResult(activity, quick.reason);
		}

		updateTimer = setInterval(sendUpdate, 250);
		updateTimer.unref?.();

		try {
			const result = await Promise.race([
				activity.completion.then((outcome) => ({ kind: "completed" as const, outcome })),
				activity.detachResult.then((reason) => ({ kind: "detached" as const, reason })),
			]);
			sendUpdate();
			if (result.kind === "detached") return this.backgroundLaunchResult(activity, result.reason);
			return this.foregroundResult(result.outcome);
		} finally {
			if (updateTimer) clearInterval(updateTimer);
			clearTimeout(detachTimer);
			input.signal?.removeEventListener("abort", onAbort);
		}
	}

	detachActiveForeground(): boolean {
		const active = [...this.activities.values()]
			.filter(
				(activity) =>
					activity.launchAuthorized &&
					activity.kind === "shell" &&
					!activity.backgrounded &&
					activity.status === "running",
			)
			.sort((left, right) => right.startedAt - left.startedAt)[0];
		if (active) return this.detach(active, "manual");
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
		const command = this.commandPrefix ? `${this.commandPrefix}\n${input.command}` : input.command;
		const spawnInput: SpawnProcessInput = {
			backgrounded: true,
			command,
			env: sessionEnvironment(ctx),
			kind: "monitor",
			monitorSource: "command",
			monitorTarget: input.command,
			monitorTimeoutSeconds: input.timeoutSeconds,
			toolCallId: input.toolCallId,
		};
		if (input.description) Object.assign(spawnInput, { description: input.description });
		if (input.failureText) Object.assign(spawnInput, { monitorFailureText: input.failureText });
		if (input.successText) Object.assign(spawnInput, { monitorSuccessText: input.successText });
		const activity = await this.spawnProcess(spawnInput);
		activity.timeoutTimer = setTimeout(() => {
			this.requestStopInBackground(activity, "timeout", "monitor timeout");
		}, timeoutMilliseconds(input.timeoutSeconds));
		activity.timeoutTimer.unref?.();
		const started = {
			id: activity.id,
			outcome: activity.completion,
		};
		if (activity.output.durable && existsSync(activity.output.path)) {
			Object.assign(started, { outputPath: activity.output.path });
		}
		return started;
	}

	readOutput(id: string, maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
		const activity = this.activities.get(id);
		if (activity) {
			return activity.output.durable && existsSync(activity.output.path)
				? readBoundedTail(activity.output.path, maxBytes)
				: activity.output.recentText(maxBytes) || "(no output yet)";
		}
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
		if (shell) return this.stopShell(shell, "user");
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
			...Array.from(this.activities.values(), (activity) => this.stopShell(activity, "shutdown")),
			...Array.from(this.monitors.values(), (monitor) => monitor.cancel("shutdown")),
			...this.launchSettlements,
			...this.rollbackSettlements,
		]);
		await settleWithin(cleanup, this.shutdownGraceMs);
		// A stop can fail only while a verified process group is still alive.
		// Keep those activities in durable recovery metadata instead of erasing
		// the only proof a later Pi host can use to reap them.
		for (const activity of this.activities.values()) activity.output.close();
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

	private async spawnProcess(input: SpawnProcessInput): Promise<SpawnedActivity> {
		if (this.disposed) throw new Error("Background Work session is shutting down");
		if (this.activities.size + this.monitors.size + this.launchReservations >= MAX_CONCURRENT_ACTIVITIES) {
			throw new Error(`At most ${String(MAX_CONCURRENT_ACTIVITIES)} Background Work activities may run at once`);
		}
		this.launchReservations += 1;
		const reservation = { active: true };
		let settleLaunch!: () => void;
		const launchSettlement = new Promise<void>((resolve) => {
			settleLaunch = resolve;
		});
		this.launchSettlements.add(launchSettlement);
		try {
			return await this.spawnProcessTransaction(input, reservation);
		} finally {
			if (reservation.active) {
				reservation.active = false;
				this.launchReservations -= 1;
			}
			settleLaunch();
			this.launchSettlements.delete(launchSettlement);
		}
	}

	private async spawnProcessTransaction(
		input: SpawnProcessInput,
		reservation: { active: boolean },
	): Promise<SpawnedActivity> {
		if (this.disposed) throw new Error("Background Work session is shutting down");
		const kind = input.kind ?? "shell";
		const id = this.randomId(kind);
		const outputPath = this.storage.outputPath(id);
		const commandAuthorizationPath = this.storage.commandAuthorizationPath(id);
		const commandAcknowledgementPath = `${commandAuthorizationPath}.ack`;
		const commandAuthorizationToken = randomBytes(24).toString("base64url");
		// Resolve and validate every launch path before opening the output file.
		// If the runtime directory disappears between storage operations, no file
		// descriptor or orphan output artifact has been created yet.
		const output = this.outputFactory(outputPath);
		let shell: ReturnType<typeof getShellConfig>;
		try {
			shell = getShellConfig(this.shellPath);
		} catch (error) {
			discardOutput(output);
			throw error;
		}
		const owner = captureProcessIdentity(process.pid);
		if (!owner) {
			discardOutput(output);
			throw new Error("Cannot establish Pi process identity for Background Work");
		}
		const envelope = Buffer.from(
			JSON.stringify({
				commandTransport: shell.commandTransport ?? "argv",
				commandAcknowledgementPath,
				commandAuthorizationPath,
				commandAuthorizationToken,
				cwd: this.cwd,
				parentPid: owner.pid,
				parentStarted: owner.started,
				shell: shell.shell,
				shellArgs: shell.args,
			}),
			"utf-8",
		).toString("base64url");
		let supervisor: SupervisorProcess;
		try {
			supervisor = this.supervisorFactory(this.supervisorExecutable, envelope, {
				cwd: this.cwd,
				env: input.env,
			});
		} catch (error) {
			discardOutput(output);
			throw error;
		}
		const supervisorIdentity = await this.captureSupervisorIdentity(supervisor.pid);
		if (!supervisorIdentity) {
			await abandonSupervisorAndWait(supervisor);
			discardOutput(output);
			throw new Error("Cannot establish Background Work supervisor identity");
		}
		if (this.disposed) {
			await abandonSupervisorAndWait(supervisor);
			discardOutput(output);
			throw new Error("Background Work session is shutting down");
		}
		let completionResolve!: (outcome: BackgroundWorkOutcome) => void;
		const completion = new Promise<BackgroundWorkOutcome>((resolve) => {
			completionResolve = resolve;
		});
		let detachResolve!: (reason: "manual" | "timeout") => void;
		const detachResult = new Promise<"manual" | "timeout">((resolve) => {
			detachResolve = resolve;
		});
		const activity: SpawnedActivity = {
			backgrounded: input.backgrounded,
			command: input.command,
			commandAcknowledgementPath,
			commandAuthorizationPath,
			completion,
			completionResolve,
			commandGroupReaped: false,
			controlBuffer: "",
			detachResolve,
			detachResult,
			finalized: false,
			finalizing: false,
			id,
			kind,
			launchAuthorized: false,
			output,
			outputLimitStopRequested: false,
			parentRunOrigin: input.parentRunOrigin ?? "automatic",
			startedAt: Date.now(),
			status: "running",
			supervisor,
			supervisorIdentity,
			title: input.description?.trim() || titleFromCommand(input.command),
			toolCallId: input.toolCallId,
		};
		if (input.description) activity.description = input.description;
		if (input.monitorFailureText) activity.monitorFailureText = input.monitorFailureText;
		if (input.monitorSource) activity.monitorSource = input.monitorSource;
		if (input.monitorSuccessText) activity.monitorSuccessText = input.monitorSuccessText;
		if (input.monitorTarget) activity.monitorTarget = input.monitorTarget;
		if (input.monitorTimeoutSeconds !== undefined) activity.monitorTimeoutSeconds = input.monitorTimeoutSeconds;
		this.activities.set(id, activity);
		reservation.active = false;
		this.launchReservations -= 1;
		this.bindSupervisor(activity);
		try {
			this.persistRunningProcesses();
		} catch (error) {
			this.rollbackSpawnedActivity(activity);
			throw error;
		}
		let inputFailed = false;
		const failInput = (cause: unknown) => {
			if (inputFailed) return;
			inputFailed = true;
			activity.output.append(
				Buffer.from(
					`Background supervisor input failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
					"utf-8",
				),
			);
			// The supervisor may already have spawned the command in its own group.
			// Preserve durable ownership and let its graceful TERM handler reap that
			// group instead of SIGKILLing the supervisor alone.
			void this.stopShell(activity, "abort").catch((stopError) => {
				reportWorkDiagnostic("A task could not stop after its supervisor input failed", stopError, {
					action: "/tasks",
					key: "supervisor-input-stop",
					notice: true,
				});
			});
		};
		try {
			publishCommandAuthorization(commandAuthorizationPath, commandAuthorizationToken, input.command);
		} catch (error) {
			failInput(error);
			throw error;
		}
		supervisor.unref();
		await this.waitForCommandAcknowledgement(activity, commandAuthorizationToken);
		this.emit();
		return activity;
	}

	private rollbackSpawnedActivity(activity: SpawnedActivity): void {
		activity.finalizing = true;
		// A launch rollback is owned solely by rollbackSettlements from this point.
		// Keeping it in the ordinary activity map makes shutdown start a competing
		// stop transaction against the same exact subprocess.
		this.activities.delete(activity.id);
		try {
			// Persist failed before command input was released. Kill the exact Bun
			// subprocess handle first; ending stdin while it is alive would authorize
			// the supervisor to launch the command we are trying to roll back.
			activity.supervisor.kill("SIGKILL");
		} catch {
			// Completion below remains the authoritative exact-handle observation.
		}
		const settlement = activity.supervisor.completion.then(() => {
			activity.finalized = true;
			activity.finalizing = false;
			this.activities.delete(activity.id);
			activity.output.close();
			rmSync(activity.output.path, { force: true });
			try {
				this.persistRunningProcesses();
			} catch (cleanupError) {
				reportWorkDiagnostic("Launch rollback state could not be saved", cleanupError, {
					key: "launch-rollback-persist",
				});
			}
		});
		this.rollbackSettlements.add(settlement);
		void settlement.then(
			() => this.rollbackSettlements.delete(settlement),
			(error) => {
				this.rollbackSettlements.delete(settlement);
				reportWorkDiagnostic("Launch rollback did not settle", error, { key: "launch-rollback-settle" });
			},
		);
		this.removeLaunchArtifact(activity.commandAuthorizationPath);
		this.removeLaunchArtifact(activity.commandAcknowledgementPath);
		activity.supervisor.output.destroy();
		activity.supervisor.closeControl();
		activity.supervisor.unref();
	}

	private removeLaunchArtifact(filePath: string): void {
		try {
			rmSync(filePath, { force: true });
		} catch (error) {
			reportWorkDiagnostic("A launch artifact could not be removed", error, {
				key: "launch-artifact-remove",
			});
		}
	}

	private bindSupervisor(activity: SpawnedActivity): void {
		const append = (chunk: Buffer) => {
			const accepted = activity.output.append(chunk);
			if (!accepted && activity.output.overflowed && !activity.outputLimitStopRequested) {
				activity.outputLimitStopRequested = true;
				this.requestStopInBackground(activity, "output_limit", "output limit");
			}
		};
		activity.supervisor.output.on("data", append);
		activity.supervisor.control.on("data", (chunk: Buffer) => this.consumeControl(activity, chunk));
		void activity.supervisor.completion
			.then(async ({ code, error, signal }) => {
				if (error) append(Buffer.from(`Background supervisor failed: ${error.message}\n`, "utf-8"));
				await this.finalizeShell(activity, code, signal);
			})
			.catch((error) => {
				reportWorkDiagnostic("Task finalization failed; retrying", error, { key: "finalization-retry" });
				if (!activity.finalized) {
					append(Buffer.from(`Background finalization failed: ${String(error)}\n`, "utf-8"));
					void this.finalizeShell(activity, 1, null).catch((retryError) => {
						reportWorkDiagnostic("A task could not be finalized", retryError, {
							action: "/tasks",
							key: "finalization-failed",
							notice: true,
						});
					});
				}
			});
	}

	private requestStopInBackground(
		activity: SpawnedActivity,
		reason: "abort" | "output_limit" | "shutdown" | "timeout" | "user",
		source: string,
	): void {
		void this.stopShell(activity, reason).catch((error) => {
			// Timer/signal/output callbacks have no caller to await a rejection. Keep
			// durable recovery ownership and report the failure without turning it into
			// an unhandled rejection that can crash the Host.
			reportWorkDiagnostic(`A task could not stop after ${source}`, error, {
				action: "/tasks",
				key: `stop-${source}`,
				notice: true,
			});
		});
	}

	private async waitForCommandAcknowledgement(activity: SpawnedActivity, token: string): Promise<void> {
		let supervisorExit:
			| { readonly code: number | null; readonly error?: Error; readonly signal: NodeJS.Signals | null }
			| undefined;
		void activity.supervisor.completion.then(
			(result) => {
				supervisorExit = result;
			},
			(error) => {
				supervisorExit = {
					code: 1,
					error: error instanceof Error ? error : new Error(String(error)),
					signal: null,
				};
			},
		);
		try {
			const deadline = Date.now() + 3_000;
			for (;;) {
				if (
					consumeCommandAcknowledgement(activity.commandAcknowledgementPath, token, activity.supervisorIdentity)
				) {
					activity.launchAuthorized = true;
					return;
				}
				if (supervisorExit) {
					throw (
						supervisorExit.error ?? new Error("Background Work supervisor exited before accepting its command.")
					);
				}
				if (Date.now() >= deadline) {
					throw new Error("Background Work supervisor did not acknowledge its command within 3 seconds.");
				}
				await Bun.sleep(20);
			}
		} catch (error) {
			// Once authorization is published, every acknowledgement failure is a
			// cancellation path. The asynchronous stop retains this activity and its
			// authenticated process identity until termination is actually proven.
			activity.launchAuthorized = true;
			this.requestStopInBackground(activity, "abort", "command acknowledgement failure");
			throw error;
		}
	}

	private consumeControl(activity: SpawnedActivity, chunk: Buffer): void {
		activity.controlBuffer += chunk.toString("utf-8");
		for (;;) {
			const newline = activity.controlBuffer.indexOf("\n");
			if (newline === -1) return;
			const line = activity.controlBuffer.slice(0, newline);
			activity.controlBuffer = activity.controlBuffer.slice(newline + 1);
			let event: JsonValue;
			try {
				event = parseJsonValue(line);
			} catch {
				activity.output.append(Buffer.from("Invalid supervisor control record.\n", "utf-8"));
				continue;
			}
			if (!isRuntimeObject(event) || event === null || Array.isArray(event)) {
				activity.output.append(Buffer.from("Invalid supervisor control record.\n", "utf-8"));
				continue;
			}
			if (
				event["type"] === "started" &&
				event["groupPid"] === activity.supervisorIdentity.pid &&
				event["groupStarted"] === activity.supervisorIdentity.started
			) {
				// The long-lived supervisor is also the command process-group leader.
				// Persist that anchored identity, never the short-lived user shell PID.
				activity.commandIdentity = activity.supervisorIdentity;
				try {
					this.persistRunningProcesses();
				} catch (error) {
					reportWorkDiagnostic("Task recovery metadata could not be saved", error, {
						action: "/tasks",
						key: "running-command-identity",
						notice: true,
					});
				}
			} else if (event["type"] === "spawn-error" && isRuntimeString(event["message"])) {
				activity.output.append(Buffer.from(`Command spawn failed: ${event["message"]}\n`, "utf-8"));
			} else if (event["type"] === "exit") {
				activity.commandGroupReaped = event["groupReaped"] === true;
			}
		}
	}

	private detach(activity: SpawnedActivity, reason: "manual" | "timeout"): boolean {
		if (activity.finalized || activity.backgrounded || activity.status !== "running") return false;
		activity.backgrounded = true;
		activity.detachReason = reason;
		activity.detachResolve?.(reason);
		delete activity.detachResolve;
		this.emit();
		return true;
	}

	private async stopShell(
		activity: SpawnedActivity,
		reason: "abort" | "output_limit" | "shutdown" | "timeout" | "user",
	): Promise<BackgroundWorkOutcome> {
		if (activity.finalized) return activity.completion;
		if (activity.stopPromise) return activity.stopPromise;
		activity.stopReason = reason;
		activity.status = "stopping";
		this.emit();
		const stopAttempt = (async () => {
			// Ask only the authenticated supervisor to stop. It must remain alive as
			// the PGID anchor until every descendant has actually disappeared.
			let signalState: ReturnType<SignalVerifiedSupervisor>;
			try {
				signalState = this.signalSupervisor(activity.supervisor, activity.supervisorIdentity, "SIGTERM");
			} catch (error) {
				this.persistRunningProcesses();
				throw error;
			}
			if (signalState === "unresolved") {
				this.persistRunningProcesses();
				throw new Error(
					`Background Work '${activity.id}' supervisor could not be proven stopped; recovery ownership was retained.`,
				);
			}
			const terminal = await Promise.race([
				activity.completion,
				new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), this.stopCompletionGraceMs)),
			]);
			if (terminal) return terminal;
			if (identityMatches(activity.supervisorIdentity)) {
				this.persistRunningProcesses();
				throw new Error(
					`Background Work '${activity.id}' supervisor is still reaping its process group; recovery ownership was retained.`,
				);
			}
			// The supervisor is proven gone but its completion observer may have
			// failed. Finalization performs one last conservative group check and
			// retains recovery state if the old PGID is now unverifiable.
			await this.finalizeShell(activity, null, "SIGTERM");
			return activity.completion;
		})();
		activity.stopPromise = stopAttempt;
		try {
			return await stopAttempt;
		} finally {
			// A failed proof of termination intentionally preserves the durable activity,
			// but it must not permanently cache that rejected attempt. A later explicit
			// stop or shutdown gets a fresh chance to verify and reap the same identity.
			if (!activity.finalized && activity.stopPromise === stopAttempt) delete activity.stopPromise;
		}
	}

	private async finalizeShell(
		activity: SpawnedActivity,
		code: number | null,
		signal: NodeJS.Signals | null,
	): Promise<void> {
		if (activity.finalized || activity.finalizing) return;
		activity.finalizing = true;
		try {
			if (activity.commandIdentity && !activity.commandGroupReaped) {
				await reapOwnedProcessGroup(activity.commandIdentity);
			}
		} catch (error) {
			activity.finalizing = false;
			try {
				this.persistRunningProcesses();
			} catch (persistError) {
				reportWorkDiagnostic("Unresolved process recovery state could not be saved", persistError, {
					action: "/tasks",
					key: "unresolved-process-recovery",
					notice: true,
				});
			}
			throw error;
		}
		activity.finalized = true;
		activity.finalizing = false;
		if (activity.timeoutTimer) clearTimeout(activity.timeoutTimer);
		try {
			activity.supervisor.output.destroy();
		} catch {
			// Stream teardown cannot change the process result.
		}
		try {
			activity.supervisor.closeControl();
		} catch {
			// The control descriptor is already terminal from the supervisor's perspective.
		}
		activity.output.close();
		this.removeLaunchArtifact(activity.commandAuthorizationPath);
		this.removeLaunchArtifact(activity.commandAcknowledgementPath);
		const endedAt = Date.now();
		let status: BackgroundWorkTerminalStatus;
		if (activity.stopReason === "timeout") status = "timed_out";
		else if (activity.stopReason === "output_limit") status = "failed";
		else if (activity.stopReason) status = "stopped";
		else status = code === 0 && signal === null ? "completed" : "failed";
		const recentOutput = activity.output.recentText(DEFAULT_MODEL_OUTPUT_LIMIT);
		if (activity.kind === "monitor" && !activity.stopReason) {
			if (activity.monitorFailureText && recentOutput.includes(activity.monitorFailureText)) status = "failed";
			else if (activity.monitorSuccessText && !recentOutput.includes(activity.monitorSuccessText)) status = "failed";
		}
		const outcome: BackgroundWorkOutcome = {
			endedAt,
			id: activity.id,
			kind: activity.kind,
			parentRunOrigin: activity.parentRunOrigin,
			startedAt: activity.startedAt,
			status,
			summary: this.shellSummary(activity, status, code),
			title: activity.title,
		};
		if (isRuntimeNumber(code)) Object.assign(outcome, { exitCode: code });
		if (activity.output.durable && existsSync(activity.output.path)) {
			Object.assign(outcome, { outputPath: activity.output.path });
		}
		if (recentOutput) Object.assign(outcome, { recentOutput });
		this.activities.delete(activity.id);
		if (activity.backgrounded) this.rememberTerminalOutcome(outcome);
		try {
			this.persistRunningProcesses();
		} catch (error) {
			reportWorkDiagnostic("Completed task state could not be saved", error, {
				key: "terminal-state-persist",
			});
		}
		activity.completionResolve(outcome);
		this.emit();
		const shouldDeliverTerminalCompletion =
			activity.backgrounded &&
			!this.disposed &&
			activity.stopReason !== "shutdown" &&
			activity.stopReason !== "abort" &&
			activity.stopReason !== "user";
		if (shouldDeliverTerminalCompletion) {
			if (activity.parentRunOrigin === "user") requestStatuslineGitRefreshAfterUserWork(this.pi);
			this.enqueueNotification(outcome, activity.kind === "monitor");
		}
	}

	private shellSummary(activity: SpawnedActivity, status: BackgroundWorkTerminalStatus, code: number | null): string {
		const subject = activity.kind === "monitor" ? "Monitor" : "Background command";
		switch (status) {
			case "completed":
				return `${subject} "${activity.title}" completed`;
			case "failed":
				return activity.stopReason === "output_limit"
					? `${subject} "${activity.title}" exceeded the output limit and was stopped`
					: `${subject} "${activity.title}" failed${isRuntimeNumber(code) ? ` (exit ${String(code)})` : ""}`;
			case "stopped":
				return `${subject} "${activity.title}" stopped`;
			case "timed_out":
				return `${subject} "${activity.title}" timed out`;
		}
	}

	private foregroundResult(outcome: BackgroundWorkOutcome): AgentToolResult<BackgroundWorkBashDetails | undefined> {
		const snapshot = this.foregroundSnapshot(outcome);
		if (outcome.status !== "completed") {
			let status = outcome.summary;
			if (isRuntimeNumber(outcome.exitCode) && outcome.exitCode !== 0) {
				status = `Command exited with code ${String(outcome.exitCode)}`;
			} else if (outcome.status === "timed_out") {
				status = "Command timed out";
			} else if (outcome.status === "stopped") {
				status = "Command aborted";
			}
			throw new Error(`${snapshot.text ? `${snapshot.text}\n\n` : ""}${status}`);
		}
		return textResult(snapshot.text || "(no output)", snapshot.details);
	}

	private foregroundSnapshot(outcome: BackgroundWorkOutcome) {
		if (!outcome.outputPath) return { text: outcome.recentOutput ?? "" };
		let raw: string;
		try {
			raw = readFileSync(outcome.outputPath, "utf8");
		} catch {
			return { text: outcome.recentOutput ?? "" };
		}
		const truncation = truncateTail(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
		if (!truncation.truncated) return { text: truncation.content };
		const startLine = truncation.totalLines - truncation.outputLines + 1;
		const endLine = truncation.totalLines;
		let footer: string;
		if (truncation.lastLinePartial) {
			footer = `Showing last ${formatSize(truncation.outputBytes)} of line ${String(endLine)}. Full output: ${outcome.outputPath}`;
		} else if (truncation.truncatedBy === "lines") {
			footer = `Showing lines ${String(startLine)}-${String(endLine)} of ${String(truncation.totalLines)}. Full output: ${outcome.outputPath}`;
		} else {
			footer = `Showing lines ${String(startLine)}-${String(endLine)} of ${String(truncation.totalLines)} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${outcome.outputPath}`;
		}
		return {
			details: { fullOutputPath: outcome.outputPath, truncation },
			text: `${truncation.content}\n\n[${footer}]`,
		};
	}

	private backgroundLaunchResult(
		activity: SpawnedActivity,
		reason?: "manual" | "timeout",
	): AgentToolResult<BackgroundWorkBashDetails | undefined> {
		const action = reason === "manual" ? "manually moved" : reason === "timeout" ? "moved" : "started";
		const outputPath = activity.output.durable && existsSync(activity.output.path) ? activity.output.path : undefined;
		const details: BackgroundWorkBashDetails = { backgroundTaskId: activity.id };
		if (outputPath) Object.assign(details, { fullOutputPath: outputPath });
		return textResult(
			`Command ${action} to background task ${activity.id}.${outputPath ? `\nOutput: ${outputPath}` : ""}\nThe terminal result will be delivered automatically; continue useful work instead of polling.`,
			details,
		);
	}

	private activitySnapshot(activity: SpawnedActivity): BackgroundWorkSnapshot {
		const recentOutput = activity.output.recentText(4_000);
		const snapshot: BackgroundWorkSnapshot = {
			command: activity.command,
			id: activity.id,
			kind: activity.kind,
			startedAt: activity.startedAt,
			status: activity.status,
			title: activity.title,
		};
		if (activity.description) Object.assign(snapshot, { description: activity.description });
		if (activity.monitorFailureText) Object.assign(snapshot, { monitorFailureText: activity.monitorFailureText });
		if (activity.monitorSource) Object.assign(snapshot, { monitorSource: activity.monitorSource });
		if (activity.monitorSuccessText) Object.assign(snapshot, { monitorSuccessText: activity.monitorSuccessText });
		if (activity.monitorTarget) Object.assign(snapshot, { monitorTarget: activity.monitorTarget });
		if (activity.monitorTimeoutSeconds !== undefined) {
			Object.assign(snapshot, { monitorTimeoutSeconds: activity.monitorTimeoutSeconds });
		}
		if (activity.output.durable && existsSync(activity.output.path)) {
			Object.assign(snapshot, { outputPath: activity.output.path });
		}
		if (recentOutput) Object.assign(snapshot, { recentOutput });
		return snapshot;
	}

	private persistRunningProcesses(): void {
		if (!this.storage.directory && this.activities.size === 0) {
			this.stopMetadataHeartbeat();
			return;
		}
		const tasks: StoredProcessTask[] = [];
		for (const activity of this.activities.values()) {
			const task: StoredProcessTask = { id: activity.id, supervisor: activity.supervisorIdentity };
			if (activity.commandIdentity) Object.assign(task, { command: activity.commandIdentity });
			tasks.push(task);
		}
		this.storage.persist(tasks);
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
		const ids = new Map<string, true>();
		for (const id of this.activities.keys()) ids.set(id, true);
		for (const id of this.monitors.keys()) ids.set(id, true);
		for (const id of this.terminalOutcomes.keys()) ids.set(id, true);
		return randomActivityId(kind, ids);
	}
}
