import { type ChildProcess, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { accessSync, constants, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	BashToolDetails,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getShellConfig,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import { BoundedOutputFile, DEFAULT_MODEL_OUTPUT_LIMIT, readBoundedTail } from "./output.js";
import {
	captureProcessIdentity,
	identityMatches,
	type ProcessIdentity,
	reapOwnedProcessGroup,
	signalProcessGroup,
	terminateVerifiedProcessGroup,
} from "./process.js";
import { type StoredProcessTask, WorkRunStorage } from "./storage.js";

const DEFAULT_BACKGROUND_AFTER_MS = 120_000;
const QUICK_COMPLETION_MS = 2_000;
const MAX_CONCURRENT_ACTIVITIES = 16;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const SUPERVISOR_PATH = fileURLToPath(new URL("./process-supervisor.mjs", import.meta.url));

export type BackgroundWorkKind = "monitor" | "shell";
export type BackgroundWorkStatus = "running" | "stopping";
export type BackgroundWorkTerminalStatus = "completed" | "failed" | "stopped" | "timed_out";

export interface BackgroundWorkSnapshot {
	readonly command?: string;
	readonly description?: string;
	readonly id: string;
	readonly kind: BackgroundWorkKind;
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
	readonly recentOutput?: string;
	readonly startedAt: number;
	readonly status: BackgroundWorkTerminalStatus;
	readonly summary: string;
	readonly title: string;
}

export interface BashExecutionInput {
	readonly command: string;
	readonly description?: string;
	readonly onUpdate?: AgentToolUpdateCallback<BashToolDetails | undefined>;
	readonly runInBackground?: boolean;
	readonly signal?: AbortSignal;
	readonly timeoutSeconds?: number;
	readonly toolCallId: string;
}

interface SpawnedActivity {
	backgrounded: boolean;
	commandIdentity?: ProcessIdentity;
	completion: Promise<BackgroundWorkOutcome>;
	completionResolve: (outcome: BackgroundWorkOutcome) => void;
	controlBuffer: string;
	description?: string;
	detachReason?: "manual" | "timeout";
	detachResolve?: (reason: "manual" | "timeout") => void;
	detachResult: Promise<"manual" | "timeout">;
	finalized: boolean;
	id: string;
	kind: BackgroundWorkKind;
	monitorFailureText?: string;
	monitorSuccessText?: string;
	output: BoundedOutputFile;
	outputLimitStopRequested: boolean;
	startedAt: number;
	status: BackgroundWorkStatus;
	stopPromise?: Promise<BackgroundWorkOutcome>;
	stopReason?: "abort" | "output_limit" | "shutdown" | "timeout" | "user";
	supervisor: ChildProcess;
	supervisorIdentity: ProcessIdentity;
	timeoutTimer?: ReturnType<typeof setTimeout>;
	title: string;
	toolCallId: string;
	command: string;
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

interface RuntimeOptions {
	readonly backgroundAfterMs?: number;
	readonly commandPrefix?: string;
	readonly cwd: string;
	readonly pi: ExtensionAPI;
	readonly sessionId: string;
	readonly shellPath?: string;
	readonly supervisorExecutable?: string;
}

function textResult(text: string, details?: BashToolDetails): AgentToolResult<BashToolDetails | undefined> {
	return { content: [{ type: "text", text }], details };
}

function titleFromCommand(command: string): string {
	const first =
		command
			.trim()
			.split(/\r?\n|&&|\|\||;/u)[0]
			?.trim() ?? "";
	return first.slice(0, 80) || "background command";
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
	const executable = Bun.which("bun");
	if (!executable) throw new Error("Background Work requires Bun on PATH to run its process supervisor");
	return executable;
}

export class BackgroundWorkRuntime {
	private readonly activities = new Map<string, SpawnedActivity>();
	private readonly backgroundAfterMs: number;
	private readonly commandPrefix: string | undefined;
	private readonly cwd: string;
	private disposed = false;
	private readonly listeners = new Set<() => void>();
	private readonly monitors = new Map<string, BackgroundMonitorActivity>();
	private readonly notifications: PendingNotification[] = [];
	private notificationTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly pi: ExtensionAPI;
	private readonly shellPath: string | undefined;
	private readonly storage: WorkRunStorage;
	private readonly supervisorExecutable: string;

	constructor(options: RuntimeOptions) {
		this.backgroundAfterMs = options.backgroundAfterMs ?? DEFAULT_BACKGROUND_AFTER_MS;
		if (!Number.isFinite(this.backgroundAfterMs) || this.backgroundAfterMs <= 0) {
			throw new Error("Background Work foreground handoff delay must be positive");
		}
		this.commandPrefix = options.commandPrefix;
		this.cwd = options.cwd;
		this.pi = options.pi;
		this.shellPath = options.shellPath;
		this.storage = new WorkRunStorage(options.cwd, options.sessionId);
		this.supervisorExecutable = resolveSupervisorExecutable(options.supervisorExecutable);
	}

	snapshot(): readonly BackgroundWorkSnapshot[] {
		return [
			...Array.from(this.activities.values(), (activity) => this.activitySnapshot(activity)),
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
		if (this.activities.size + this.monitors.size >= MAX_CONCURRENT_ACTIVITIES) {
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
			this.emit();
			if (!this.disposed) this.enqueueNotification(outcome, true);
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
	): Promise<AgentToolResult<BashToolDetails | undefined>> {
		if (!input.command.trim()) throw new Error("Command is empty");
		accessSync(ctx.cwd, constants.F_OK);
		const resolvedCommand = this.commandPrefix ? `${this.commandPrefix}\n${input.command}` : input.command;
		const activity = this.spawnProcess({
			backgrounded: input.runInBackground === true,
			command: resolvedCommand,
			...(input.description ? { description: input.description } : {}),
			env: sessionEnvironment(ctx),
			toolCallId: input.toolCallId,
		});
		if (input.timeoutSeconds !== undefined) {
			activity.timeoutTimer = setTimeout(() => {
				void this.stopShell(activity, "timeout");
			}, timeoutMilliseconds(input.timeoutSeconds));
			activity.timeoutTimer.unref?.();
		}

		if (input.runInBackground) return this.backgroundLaunchResult(activity);

		let updateTimer: ReturnType<typeof setInterval> | undefined;
		let lastUpdate = "";
		const onAbort = () => {
			if (!activity.backgrounded) void this.stopShell(activity, "abort");
		};
		if (input.signal) {
			if (input.signal.aborted) onAbort();
			else input.signal.addEventListener("abort", onAbort, { once: true });
		}
		const sendUpdate = () => {
			const output = activity.output.recentText(12_000);
			if (!output || output === lastUpdate) return;
			lastUpdate = output;
			input.onUpdate?.({ content: [{ type: "text", text: output }], details: undefined });
		};
		input.onUpdate?.({ content: [], details: undefined });
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
			.filter((activity) => activity.kind === "shell" && !activity.backgrounded && activity.status === "running")
			.sort((left, right) => right.startedAt - left.startedAt)[0];
		return active ? this.detach(active, "manual") : false;
	}

	startCommandMonitor(
		input: CommandMonitorInput,
		ctx: ExtensionContext,
	): {
		readonly id: string;
		readonly outcome: Promise<BackgroundWorkOutcome>;
		readonly outputPath: string;
	} {
		if (!input.command.trim()) throw new Error("Monitor command is empty");
		const command = this.commandPrefix ? `${this.commandPrefix}\n${input.command}` : input.command;
		const activity = this.spawnProcess({
			backgrounded: true,
			command,
			...(input.description ? { description: input.description } : {}),
			env: sessionEnvironment(ctx),
			kind: "monitor",
			...(input.failureText ? { monitorFailureText: input.failureText } : {}),
			...(input.successText ? { monitorSuccessText: input.successText } : {}),
			toolCallId: input.toolCallId,
		});
		activity.timeoutTimer = setTimeout(() => {
			void this.stopShell(activity, "timeout");
		}, timeoutMilliseconds(input.timeoutSeconds));
		activity.timeoutTimer.unref?.();
		return { id: activity.id, outcome: activity.completion, outputPath: activity.output.path };
	}

	readOutput(id: string, maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
		const activity = this.activities.get(id);
		if (activity) return readBoundedTail(activity.output.path, maxBytes);
		const monitor = this.monitors.get(id);
		if (monitor) return monitor.readOutput(maxBytes);
		throw new Error(`No running Background Work activity matches '${id}'`);
	}

	async stop(id: string): Promise<BackgroundWorkOutcome> {
		const shell = this.activities.get(id);
		if (shell) return this.stopShell(shell, "user");
		const monitor = this.monitors.get(id);
		if (monitor) return monitor.cancel("user");
		throw new Error(`No running Background Work activity matches '${id}'`);
	}

	async shutdown(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.notificationTimer) clearTimeout(this.notificationTimer);
		this.notifications.length = 0;
		await Promise.allSettled([
			...Array.from(this.activities.values(), (activity) => this.stopShell(activity, "shutdown")),
			...Array.from(this.monitors.values(), (monitor) => monitor.cancel("shutdown")),
		]);
		for (const activity of this.activities.values()) activity.output.close();
		this.activities.clear();
		this.monitors.clear();
		this.persistRunningProcesses();
		this.storage.cleanup();
		this.emit();
	}

	private spawnProcess(input: {
		readonly backgrounded: boolean;
		readonly command: string;
		readonly description?: string;
		readonly env: NodeJS.ProcessEnv;
		readonly kind?: BackgroundWorkKind;
		readonly monitorFailureText?: string;
		readonly monitorSuccessText?: string;
		readonly toolCallId: string;
	}): SpawnedActivity {
		if (this.disposed) throw new Error("Background Work session is shutting down");
		if (this.activities.size + this.monitors.size >= MAX_CONCURRENT_ACTIVITIES) {
			throw new Error(`At most ${String(MAX_CONCURRENT_ACTIVITIES)} Background Work activities may run at once`);
		}
		const kind = input.kind ?? "shell";
		const id = this.randomId(kind);
		const output = new BoundedOutputFile(this.storage.outputPath(id));
		const shell = getShellConfig(this.shellPath);
		const owner = captureProcessIdentity(process.pid);
		if (!owner) {
			output.close();
			throw new Error("Cannot establish Pi process identity for Background Work");
		}
		const envelope = Buffer.from(
			JSON.stringify({
				commandTransport: shell.commandTransport ?? "argv",
				cwd: this.cwd,
				parentPid: owner.pid,
				parentStarted: owner.started,
				shell: shell.shell,
				shellArgs: shell.args,
			}),
			"utf-8",
		).toString("base64url");
		const supervisor = spawn(this.supervisorExecutable, [SUPERVISOR_PATH, envelope], {
			cwd: this.cwd,
			detached: process.platform !== "win32",
			env: input.env,
			stdio: ["pipe", "pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		if (!supervisor.pid) {
			output.close();
			rmSync(output.path, { force: true });
			throw new Error("Failed to launch Background Work supervisor");
		}
		const supervisorIdentity = captureProcessIdentity(supervisor.pid);
		if (!supervisorIdentity) {
			signalProcessGroup(supervisor.pid, "SIGKILL");
			output.close();
			rmSync(output.path, { force: true });
			throw new Error("Cannot establish Background Work supervisor identity");
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
			completion,
			completionResolve,
			controlBuffer: "",
			...(input.description ? { description: input.description } : {}),
			detachResolve,
			detachResult,
			finalized: false,
			id,
			kind,
			...(input.monitorFailureText ? { monitorFailureText: input.monitorFailureText } : {}),
			...(input.monitorSuccessText ? { monitorSuccessText: input.monitorSuccessText } : {}),
			output,
			outputLimitStopRequested: false,
			startedAt: Date.now(),
			status: "running",
			supervisor,
			supervisorIdentity,
			title: input.description?.trim() || titleFromCommand(input.command),
			toolCallId: input.toolCallId,
		};
		this.activities.set(id, activity);
		this.persistRunningProcesses();
		this.bindSupervisor(activity);
		supervisor.stdin?.on("error", () => {});
		supervisor.stdin?.end(input.command);
		supervisor.unref();
		this.emit();
		return activity;
	}

	private bindSupervisor(activity: SpawnedActivity): void {
		const append = (chunk: Buffer) => {
			const accepted = activity.output.append(chunk);
			if (!accepted && activity.output.overflowed && !activity.outputLimitStopRequested) {
				activity.outputLimitStopRequested = true;
				void this.stopShell(activity, "output_limit");
			}
		};
		activity.supervisor.stdout?.on("data", append);
		activity.supervisor.stderr?.on("data", append);
		const control = activity.supervisor.stdio[3];
		if (control && "on" in control) {
			control.on("data", (chunk: Buffer) => this.consumeControl(activity, chunk));
		}
		activity.supervisor.once("error", (error) => {
			append(Buffer.from(`Background supervisor failed: ${error.message}\n`, "utf-8"));
		});
		activity.supervisor.once("exit", (code, signal) => {
			void this.finalizeShell(activity, code, signal);
		});
	}

	private consumeControl(activity: SpawnedActivity, chunk: Buffer): void {
		activity.controlBuffer += chunk.toString("utf-8");
		for (;;) {
			const newline = activity.controlBuffer.indexOf("\n");
			if (newline === -1) return;
			const line = activity.controlBuffer.slice(0, newline);
			activity.controlBuffer = activity.controlBuffer.slice(newline + 1);
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				if (
					event["type"] === "started" &&
					typeof event["pid"] === "number" &&
					typeof event["started"] === "string"
				) {
					activity.commandIdentity = { pid: event["pid"], started: event["started"] };
					this.persistRunningProcesses();
				} else if (event["type"] === "spawn-error" && typeof event["message"] === "string") {
					activity.output.append(Buffer.from(`Command spawn failed: ${event["message"]}\n`, "utf-8"));
				}
			} catch {
				activity.output.append(Buffer.from("Invalid supervisor control record.\n", "utf-8"));
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
		activity.stopPromise = (async () => {
			const identities = [activity.commandIdentity, activity.supervisorIdentity].filter(
				(identity): identity is ProcessIdentity => identity !== undefined,
			);
			await Promise.allSettled(identities.map((identity) => terminateVerifiedProcessGroup(identity, 2_000)));
			const terminal = await Promise.race([
				activity.completion,
				new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
			]);
			if (terminal) return terminal;
			for (const identity of identities) {
				if (identityMatches(identity)) signalProcessGroup(identity.pid, "SIGKILL");
			}
			return activity.completion;
		})();
		return activity.stopPromise;
	}

	private async finalizeShell(
		activity: SpawnedActivity,
		code: number | null,
		signal: NodeJS.Signals | null,
	): Promise<void> {
		if (activity.finalized) return;
		activity.finalized = true;
		if (activity.timeoutTimer) clearTimeout(activity.timeoutTimer);
		if (activity.commandIdentity) await reapOwnedProcessGroup(activity.commandIdentity.pid);
		activity.supervisor.stdout?.destroy();
		activity.supervisor.stderr?.destroy();
		activity.output.close();
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
			...(typeof code === "number" ? { exitCode: code } : {}),
			id: activity.id,
			kind: activity.kind,
			outputPath: activity.output.path,
			...(recentOutput ? { recentOutput } : {}),
			startedAt: activity.startedAt,
			status,
			summary: this.shellSummary(activity, status, code),
			title: activity.title,
		};
		this.activities.delete(activity.id);
		this.persistRunningProcesses();
		activity.completionResolve(outcome);
		this.emit();
		if (
			activity.backgrounded &&
			!this.disposed &&
			activity.stopReason !== "shutdown" &&
			activity.stopReason !== "abort"
		) {
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
					: `${subject} "${activity.title}" failed${typeof code === "number" ? ` (exit ${String(code)})` : ""}`;
			case "stopped":
				return `${subject} "${activity.title}" stopped`;
			case "timed_out":
				return `${subject} "${activity.title}" timed out`;
		}
	}

	private foregroundResult(outcome: BackgroundWorkOutcome): AgentToolResult<BashToolDetails | undefined> {
		const snapshot = this.foregroundSnapshot(outcome);
		if (outcome.status !== "completed") {
			let status = outcome.summary;
			if (typeof outcome.exitCode === "number" && outcome.exitCode !== 0) {
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

	private foregroundSnapshot(outcome: BackgroundWorkOutcome): {
		readonly details?: BashToolDetails;
		readonly text: string;
	} {
		if (!outcome.outputPath) return { text: outcome.recentOutput ?? "" };
		const raw = readFileSync(outcome.outputPath, "utf8");
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
	): AgentToolResult<BashToolDetails | undefined> {
		const action = reason === "manual" ? "manually moved" : reason === "timeout" ? "moved" : "started";
		return textResult(
			`Command ${action} to background task ${activity.id}.\nOutput: ${activity.output.path}\nThe terminal result will be delivered automatically; continue useful work instead of polling.`,
			{ fullOutputPath: activity.output.path },
		);
	}

	private activitySnapshot(activity: SpawnedActivity): BackgroundWorkSnapshot {
		const recentOutput = activity.output.recentText(4_000);
		return {
			command: activity.command,
			...(activity.description ? { description: activity.description } : {}),
			id: activity.id,
			kind: activity.kind,
			outputPath: activity.output.path,
			...(recentOutput ? { recentOutput } : {}),
			startedAt: activity.startedAt,
			status: activity.status,
			title: activity.title,
		};
	}

	private persistRunningProcesses(): void {
		if (!this.storage.directory && this.activities.size === 0) return;
		const tasks: StoredProcessTask[] = [];
		for (const activity of this.activities.values()) {
			tasks.push({
				...(activity.commandIdentity ? { command: activity.commandIdentity } : {}),
				id: activity.id,
				supervisor: activity.supervisorIdentity,
			});
		}
		this.storage.persist(tasks);
	}

	private enqueueNotification(outcome: BackgroundWorkOutcome, wake: boolean): void {
		this.notifications.push({ outcome, wake });
		if (this.notificationTimer) return;
		this.notificationTimer = setTimeout(() => this.flushNotifications(), 200);
		this.notificationTimer.unref?.();
	}

	private flushNotifications(): void {
		this.notificationTimer = undefined;
		if (this.disposed || this.notifications.length === 0) return;
		const pending = this.notifications.splice(0);
		const wake = pending.some((item) => item.wake);
		const lines = pending.map(({ outcome }) => {
			const output = outcome.outputPath ? `\n<output_file>${escapeXml(outcome.outputPath)}</output_file>` : "";
			return `<task id="${escapeXml(outcome.id)}" kind="${outcome.kind}" status="${outcome.status}">\n<summary>${escapeXml(outcome.summary)}</summary>${output}\n</task>`;
		});
		const content = `<background-work-notification>\n${lines.join("\n")}\n</background-work-notification>`;
		try {
			this.pi.sendMessage(
				{
					customType: "pi-stuff-background-work-result",
					content,
					details: { outcomes: pending.map((item) => item.outcome) },
					display: true,
				},
				wake ? { deliverAs: "steer", triggerTurn: true } : { deliverAs: "followUp", triggerTurn: false },
			);
		} catch (error) {
			console.error("[pi-stuff-work] terminal notification failed:", error);
		}
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	private randomId(kind: BackgroundWorkKind): string {
		const ids = new Map<string, true>();
		for (const id of this.activities.keys()) ids.set(id, true);
		for (const id of this.monitors.keys()) ids.set(id, true);
		return randomActivityId(kind, ids);
	}
}

function escapeXml(value: string): string {
	return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}
