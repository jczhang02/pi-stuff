import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import type { AgentToolResult, AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { type JsonValue, parseJsonValue } from "../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { boundTerminalLine } from "../../tool-display/index.js";
import { reportWorkDiagnostic } from "./diagnostics.js";
import {
	type BoundedOutputFile,
	DEFAULT_MODEL_OUTPUT_LIMIT,
	foregroundOutputSnapshot,
	tryReadBoundedTail,
} from "./output.js";
import {
	abandonSupervisorAndWait,
	captureProcessIdentity,
	type captureProcessIdentityWithRetry,
	consumeCommandAcknowledgement,
	identityMatches,
	type ProcessIdentity,
	publishCommandAuthorization,
	reapOwnedProcessGroup,
	type SignalVerifiedSupervisor,
	type SupervisorProcess,
	type spawnSupervisor,
} from "./process.js";
import type {
	BackgroundWorkBashDetails,
	BackgroundWorkKind,
	BackgroundWorkOutcome,
	BackgroundWorkSnapshot,
	BackgroundWorkTerminalStatus,
	BashExecutionInput,
} from "./runtime.js";
import type { StoredProcessTask, WorkRunStorage } from "./storage.js";

const QUICK_COMPLETION_MS = 2_000;

export interface ShellActivityDependencies {
	readonly captureSupervisorIdentity: typeof captureProcessIdentityWithRetry;
	readonly cwd: string;
	readonly outputFactory: (path: string) => BoundedOutputFile;
	readonly shellPath: string | undefined;
	readonly signalSupervisor: SignalVerifiedSupervisor;
	readonly stopCompletionGraceMs: number;
	readonly storage: WorkRunStorage;
	readonly supervisorExecutable: string;
	readonly supervisorFactory: typeof spawnSupervisor;
}

export interface ShellActivityOwner {
	changed(): void;
	disposed(): boolean;
	persist(): void;
	settled(outcome: BackgroundWorkOutcome, wake: boolean | undefined): void;
	unregister(activity: ShellActivity, receipt: BackgroundWorkOutcome | undefined): void;
}

export interface ShellLaunchInput {
	readonly backgrounded: boolean;
	readonly command: string;
	readonly context: ExtensionContext;
	readonly description?: string;
	readonly kind?: BackgroundWorkKind;
	readonly monitorFailureText?: string;
	readonly monitorSource?: "command";
	readonly monitorSuccessText?: string;
	readonly monitorTarget?: string;
	readonly monitorTimeoutSeconds?: number;
	readonly parentRunOrigin?: NonNullable<BackgroundWorkOutcome["parentRunOrigin"]>;
}

interface ShellLaunchState {
	readonly acknowledgementPath: string;
	readonly authorizationPath: string;
	readonly authorizationToken: string;
	readonly id: string;
	readonly input: ShellLaunchInput;
	readonly output: BoundedOutputFile;
	readonly supervisor: SupervisorProcess;
	readonly supervisorIdentity: ProcessIdentity;
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

function discardOutput(output: BoundedOutputFile): void {
	output.close();
	rmSync(output.path, { force: true });
}

export class ShellActivity {
	private backgrounded: boolean;
	private commandGroupReaped = false;
	private commandIdentity: ProcessIdentity | undefined;
	private readonly completionState = Promise.withResolvers<BackgroundWorkOutcome>();
	readonly completion = this.completionState.promise;
	private controlBuffer = "";
	private readonly dependencies: ShellActivityDependencies;
	private readonly detachState = Promise.withResolvers<"manual" | "timeout">();
	private finalization: "done" | "open" | "running" = "open";
	readonly id: string;
	readonly kind: BackgroundWorkKind;
	private readonly launch: ShellLaunchState;
	private launchAuthorized = false;
	private readonly owner: ShellActivityOwner;
	readonly startedAt = Date.now();
	private stopPromise: Promise<BackgroundWorkOutcome> | undefined;
	private stopReason: "abort" | "output_limit" | "shutdown" | "timeout" | "user" | undefined;
	private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly title: string;

	private constructor(state: ShellLaunchState, dependencies: ShellActivityDependencies, owner: ShellActivityOwner) {
		this.backgrounded = state.input.backgrounded;
		this.dependencies = dependencies;
		this.id = state.id;
		this.kind = state.input.kind ?? "shell";
		this.launch = state;
		this.owner = owner;
		this.title = state.input.description?.trim() || titleFromCommand(state.input.command);
	}

	static async spawn(
		input: ShellLaunchInput,
		id: string,
		dependencies: ShellActivityDependencies,
		owner: ShellActivityOwner,
	): Promise<ShellActivity> {
		if (owner.disposed()) throw new Error("Background Work session is shutting down");
		const outputPath = dependencies.storage.outputPath(id);
		const authorizationPath = dependencies.storage.commandAuthorizationPath(id);
		const acknowledgementPath = `${authorizationPath}.ack`;
		const authorizationToken = randomBytes(24).toString("base64url");
		const output = dependencies.outputFactory(outputPath);
		let shell: ReturnType<typeof getShellConfig>;
		try {
			shell = getShellConfig(dependencies.shellPath);
		} catch (error) {
			discardOutput(output);
			throw error;
		}
		const processOwner = captureProcessIdentity(process.pid);
		if (!processOwner) {
			discardOutput(output);
			throw new Error("Cannot establish Pi process identity for Background Work");
		}
		const envelope = Buffer.from(
			JSON.stringify({
				commandTransport: shell.commandTransport ?? "argv",
				commandAcknowledgementPath: acknowledgementPath,
				commandAuthorizationPath: authorizationPath,
				commandAuthorizationToken: authorizationToken,
				cwd: dependencies.cwd,
				parentPid: processOwner.pid,
				parentStarted: processOwner.started,
				shell: shell.shell,
				shellArgs: shell.args,
			}),
			"utf-8",
		).toString("base64url");
		let supervisor: SupervisorProcess;
		try {
			supervisor = dependencies.supervisorFactory(dependencies.supervisorExecutable, envelope, {
				cwd: dependencies.cwd,
				env: sessionEnvironment(input.context),
			});
		} catch (error) {
			discardOutput(output);
			throw error;
		}
		let supervisorIdentity: ProcessIdentity | undefined;
		try {
			supervisorIdentity = await dependencies.captureSupervisorIdentity(supervisor.pid);
		} catch (error) {
			await abandonSupervisorAndWait(supervisor);
			discardOutput(output);
			throw error;
		}
		if (!supervisorIdentity || owner.disposed()) {
			await abandonSupervisorAndWait(supervisor);
			discardOutput(output);
			if (owner.disposed()) throw new Error("Background Work session is shutting down");
			throw new Error("Cannot establish Background Work supervisor identity");
		}
		return new ShellActivity(
			{
				acknowledgementPath,
				authorizationPath,
				authorizationToken,
				id,
				input,
				output,
				supervisor,
				supervisorIdentity,
			},
			dependencies,
			owner,
		);
	}

	get visible(): boolean {
		return this.launchAuthorized;
	}

	isActiveForeground(): boolean {
		return this.launchAuthorized && this.kind === "shell" && !this.backgrounded && !this.stopReason;
	}

	bind(): void {
		const append = (chunk: Buffer) => {
			const accepted = this.launch.output.append(chunk);
			if (!accepted && this.launch.output.overflowed && !this.stopReason) {
				this.requestStop("output_limit", "output limit");
			}
		};
		this.launch.supervisor.output.on("data", append);
		this.launch.supervisor.control.on("data", (chunk: Buffer) => this.consumeControl(chunk));
		void this.launch.supervisor.completion
			.then(async ({ code, error, signal }) => {
				if (error) append(Buffer.from(`Background supervisor failed: ${error.message}\n`, "utf-8"));
				await this.finalize(code, signal);
			})
			.catch((error) => {
				reportWorkDiagnostic("Task finalization failed; retrying", error, { key: "finalization-retry" });
				if (this.finalization !== "done") {
					append(Buffer.from(`Background finalization failed: ${String(error)}\n`, "utf-8"));
					void this.finalize(1, null).catch((retryError) => {
						reportWorkDiagnostic("A task could not be finalized", retryError, {
							action: "/tasks",
							key: "finalization-failed",
							notice: true,
						});
					});
				}
			});
	}

	async authorize(): Promise<void> {
		let inputFailed = false;
		const failInput = (cause: unknown) => {
			if (inputFailed) return;
			inputFailed = true;
			this.launch.output.append(
				Buffer.from(
					`Background supervisor input failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
					"utf-8",
				),
			);
			// The supervisor may already have spawned the command in its own group.
			// Preserve durable ownership and let its graceful TERM handler reap that
			// group instead of SIGKILLing the supervisor alone.
			void this.stop("abort").catch((stopError) => {
				reportWorkDiagnostic("A task could not stop after its supervisor input failed", stopError, {
					action: "/tasks",
					key: "supervisor-input-stop",
					notice: true,
				});
			});
		};
		try {
			publishCommandAuthorization(
				this.launch.authorizationPath,
				this.launch.authorizationToken,
				this.launch.input.command,
			);
		} catch (error) {
			failInput(error);
			throw error;
		}
		this.launch.supervisor.unref();
		await this.waitForCommandAcknowledgement();
		this.owner.changed();
	}

	async rollback(): Promise<void> {
		this.finalization = "running";
		this.owner.unregister(this, undefined);
		try {
			// Persist failed before command input was released. Kill the exact Bun
			// subprocess handle first; ending stdin while it is alive would authorize
			// the supervisor to launch the command we are trying to roll back.
			this.launch.supervisor.kill("SIGKILL");
		} catch {
			// Completion below remains the authoritative exact-handle observation.
		}
		this.removeLaunchArtifact(this.launch.authorizationPath);
		this.removeLaunchArtifact(this.launch.acknowledgementPath);
		this.launch.supervisor.output.destroy();
		this.launch.supervisor.closeControl();
		this.launch.supervisor.unref();
		await this.launch.supervisor.completion;
		this.finalization = "done";
		this.launch.output.close();
		rmSync(this.launch.output.path, { force: true });
		try {
			this.owner.persist();
		} catch (error) {
			reportWorkDiagnostic("Launch rollback state could not be saved", error, {
				key: "launch-rollback-persist",
			});
		}
	}

	async execute(
		input: BashExecutionInput,
		backgroundAfterMs: number,
	): Promise<AgentToolResult<BackgroundWorkBashDetails | undefined>> {
		if (input.timeoutSeconds !== undefined) this.armTimeout(input.timeoutSeconds, "timeout");
		if (input.runInBackground) return this.backgroundLaunchResult();

		let updateTimer: ReturnType<typeof setInterval> | undefined;
		let lastUpdate = "";
		const onAbort = () => {
			if (!this.backgrounded) this.requestStop("abort", "abort signal");
		};
		if (input.signal) {
			if (input.signal.aborted) onAbort();
			else input.signal.addEventListener("abort", onAbort, { once: true });
		}
		const sendUpdate = () => {
			const output = this.launch.output.recentText(12_000);
			if (!output || output === lastUpdate) return;
			lastUpdate = output;
			emitToolUpdate(input.onUpdate, { content: [{ type: "text", text: output }], details: undefined });
		};
		emitToolUpdate(input.onUpdate, { content: [], details: undefined });
		const detachTimer = setTimeout(() => this.detach("timeout"), backgroundAfterMs);
		detachTimer.unref?.();
		let quickTimer: ReturnType<typeof setTimeout> | undefined;
		const quick = await Promise.race([
			this.completion.then((outcome) => ({ kind: "completed" as const, outcome })),
			this.detachState.promise.then((reason) => ({ kind: "detached" as const, reason })),
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
			return this.backgroundLaunchResult(quick.reason);
		}

		updateTimer = setInterval(sendUpdate, 250);
		updateTimer.unref?.();
		try {
			const result = await Promise.race([
				this.completion.then((outcome) => ({ kind: "completed" as const, outcome })),
				this.detachState.promise.then((reason) => ({ kind: "detached" as const, reason })),
			]);
			sendUpdate();
			return result.kind === "detached"
				? this.backgroundLaunchResult(result.reason)
				: this.foregroundResult(result.outcome);
		} finally {
			if (updateTimer) clearInterval(updateTimer);
			clearTimeout(detachTimer);
			input.signal?.removeEventListener("abort", onAbort);
		}
	}

	startMonitor(timeoutSeconds: number): {
		readonly id: string;
		readonly outcome: Promise<BackgroundWorkOutcome>;
		readonly outputPath?: string;
	} {
		this.armTimeout(timeoutSeconds, "monitor timeout");
		const started = { id: this.id, outcome: this.completion };
		const outputPath = this.durableOutputPath();
		return outputPath ? { ...started, outputPath } : started;
	}

	detach(reason: "manual" | "timeout"): boolean {
		if (this.finalization === "done" || this.backgrounded || this.stopReason) return false;
		this.backgrounded = true;
		this.detachState.resolve(reason);
		this.owner.changed();
		return true;
	}

	readOutput(maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
		const outputPath = this.durableOutputPath();
		return outputPath
			? (tryReadBoundedTail(outputPath, maxBytes) ?? "(no output yet)")
			: this.launch.output.recentText(maxBytes) || "(no output yet)";
	}

	snapshot(): BackgroundWorkSnapshot {
		const { input, output } = this.launch;
		const recentOutput = output.recentText(4_000);
		const snapshot: BackgroundWorkSnapshot = {
			command: input.command,
			id: this.id,
			kind: this.kind,
			startedAt: this.startedAt,
			status: this.stopReason ? "stopping" : "running",
			title: this.title,
		};
		if (input.description) Object.assign(snapshot, { description: input.description });
		if (input.monitorFailureText) Object.assign(snapshot, { monitorFailureText: input.monitorFailureText });
		if (input.monitorSource) Object.assign(snapshot, { monitorSource: input.monitorSource });
		if (input.monitorSuccessText) Object.assign(snapshot, { monitorSuccessText: input.monitorSuccessText });
		if (input.monitorTarget) Object.assign(snapshot, { monitorTarget: input.monitorTarget });
		if (input.monitorTimeoutSeconds !== undefined) {
			Object.assign(snapshot, { monitorTimeoutSeconds: input.monitorTimeoutSeconds });
		}
		const outputPath = this.durableOutputPath();
		if (outputPath) Object.assign(snapshot, { outputPath });
		if (recentOutput) Object.assign(snapshot, { recentOutput });
		return snapshot;
	}

	storedTask(): StoredProcessTask {
		const task: StoredProcessTask = { id: this.id, supervisor: this.launch.supervisorIdentity };
		if (this.commandIdentity) Object.assign(task, { command: this.commandIdentity });
		return task;
	}

	closeOutput(): void {
		this.launch.output.close();
	}

	async stop(reason: "abort" | "output_limit" | "shutdown" | "timeout" | "user"): Promise<BackgroundWorkOutcome> {
		if (this.finalization === "done") return this.completion;
		if (this.stopPromise) return this.stopPromise;
		this.stopReason = reason;
		this.owner.changed();
		const stopAttempt = this.stopNow();
		this.stopPromise = stopAttempt;
		try {
			return await stopAttempt;
		} finally {
			// A failed proof of termination intentionally preserves the durable activity,
			// but it must not permanently cache that rejected attempt. A later explicit
			// stop or shutdown gets a fresh chance to verify and reap the same identity.
			if (this.stopPromise === stopAttempt) this.stopPromise = undefined;
		}
	}

	private async stopNow(): Promise<BackgroundWorkOutcome> {
		const { supervisor, supervisorIdentity } = this.launch;
		let signalState: ReturnType<SignalVerifiedSupervisor>;
		try {
			signalState = this.dependencies.signalSupervisor(supervisor, supervisorIdentity, "SIGTERM");
		} catch (error) {
			this.owner.persist();
			throw error;
		}
		if (signalState === "unresolved") {
			this.owner.persist();
			throw new Error(
				`Background Work '${this.id}' supervisor could not be proven stopped; recovery ownership was retained.`,
			);
		}
		const terminal = await Promise.race([
			this.completion,
			new Promise<undefined>((resolve) =>
				setTimeout(() => resolve(undefined), this.dependencies.stopCompletionGraceMs),
			),
		]);
		if (terminal) return terminal;
		if (identityMatches(supervisorIdentity)) {
			this.owner.persist();
			throw new Error(
				`Background Work '${this.id}' supervisor is still reaping its process group; recovery ownership was retained.`,
			);
		}
		await this.finalize(null, "SIGTERM");
		return this.completion;
	}

	private armTimeout(seconds: number, source: string): void {
		if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Bash timeout must be a positive finite number");
		const milliseconds = Math.min(2_147_483_647, Math.round(seconds * 1_000));
		this.timeoutTimer = setTimeout(() => this.requestStop("timeout", source), milliseconds);
		this.timeoutTimer.unref?.();
	}

	private requestStop(reason: "abort" | "output_limit" | "shutdown" | "timeout" | "user", source: string): void {
		void this.stop(reason).catch((error) => {
			reportWorkDiagnostic(`A task could not stop after ${source}`, error, {
				action: "/tasks",
				key: `stop-${source}`,
				notice: true,
			});
		});
	}

	private async waitForCommandAcknowledgement(): Promise<void> {
		let supervisorExit:
			| { readonly code: number | null; readonly error?: Error; readonly signal: NodeJS.Signals | null }
			| undefined;
		void this.launch.supervisor.completion.then(
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
					consumeCommandAcknowledgement(
						this.launch.acknowledgementPath,
						this.launch.authorizationToken,
						this.launch.supervisorIdentity,
					)
				) {
					this.launchAuthorized = true;
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
			this.launchAuthorized = true;
			this.requestStop("abort", "command acknowledgement failure");
			throw error;
		} finally {
			this.removeLaunchArtifact(this.launch.authorizationPath);
			this.removeLaunchArtifact(this.launch.acknowledgementPath);
		}
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

	private consumeControl(chunk: Buffer): void {
		this.controlBuffer += chunk.toString("utf-8");
		for (;;) {
			const newline = this.controlBuffer.indexOf("\n");
			if (newline === -1) return;
			const line = this.controlBuffer.slice(0, newline);
			this.controlBuffer = this.controlBuffer.slice(newline + 1);
			let event: JsonValue;
			try {
				event = parseJsonValue(line);
			} catch {
				this.launch.output.append(Buffer.from("Invalid supervisor control record.\n", "utf-8"));
				continue;
			}
			if (!isRuntimeObject(event) || event === null || Array.isArray(event)) {
				this.launch.output.append(Buffer.from("Invalid supervisor control record.\n", "utf-8"));
				continue;
			}
			if (
				event["type"] === "started" &&
				event["groupPid"] === this.launch.supervisorIdentity.pid &&
				event["groupStarted"] === this.launch.supervisorIdentity.started
			) {
				this.commandIdentity = this.launch.supervisorIdentity;
				try {
					this.owner.persist();
				} catch (error) {
					reportWorkDiagnostic("Task recovery metadata could not be saved", error, {
						action: "/tasks",
						key: "running-command-identity",
						notice: true,
					});
				}
			} else if (event["type"] === "spawn-error" && isRuntimeString(event["message"])) {
				this.launch.output.append(Buffer.from(`Command spawn failed: ${event["message"]}\n`, "utf-8"));
			} else if (event["type"] === "exit") {
				this.commandGroupReaped = event["groupReaped"] === true;
			}
		}
	}

	private async finalize(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
		if (this.finalization !== "open") return;
		this.finalization = "running";
		try {
			if (this.commandIdentity && !this.commandGroupReaped) await reapOwnedProcessGroup(this.commandIdentity);
		} catch (error) {
			this.finalization = "open";
			try {
				this.owner.persist();
			} catch (persistError) {
				reportWorkDiagnostic("Unresolved process recovery state could not be saved", persistError, {
					action: "/tasks",
					key: "unresolved-process-recovery",
					notice: true,
				});
			}
			throw error;
		}
		this.finalization = "done";
		if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
		try {
			this.launch.supervisor.output.destroy();
		} catch {
			// Stream teardown cannot change the process result.
		}
		try {
			this.launch.supervisor.closeControl();
		} catch {
			// The control descriptor is already terminal from the supervisor's perspective.
		}
		this.launch.output.close();
		const status = this.terminalStatus(code, signal);
		const recentOutput = this.launch.output.recentText(DEFAULT_MODEL_OUTPUT_LIMIT);
		const outcome: BackgroundWorkOutcome = {
			endedAt: Date.now(),
			id: this.id,
			kind: this.kind,
			parentRunOrigin: this.launch.input.parentRunOrigin ?? "automatic",
			startedAt: this.startedAt,
			status,
			summary: this.summary(status, code),
			title: this.title,
		};
		if (isRuntimeNumber(code)) Object.assign(outcome, { exitCode: code });
		const outputPath = this.durableOutputPath();
		if (outputPath) Object.assign(outcome, { outputPath });
		if (recentOutput) Object.assign(outcome, { recentOutput });
		this.owner.unregister(this, this.backgrounded ? outcome : undefined);
		try {
			this.owner.persist();
		} catch (error) {
			reportWorkDiagnostic("Completed task state could not be saved", error, { key: "terminal-state-persist" });
		}
		this.completionState.resolve(outcome);
		const shouldNotify =
			this.backgrounded &&
			!this.owner.disposed() &&
			this.stopReason !== "shutdown" &&
			this.stopReason !== "abort" &&
			this.stopReason !== "user";
		this.owner.settled(outcome, shouldNotify ? this.kind === "monitor" : undefined);
	}

	private terminalStatus(code: number | null, signal: NodeJS.Signals | null): BackgroundWorkTerminalStatus {
		let status: BackgroundWorkTerminalStatus;
		if (this.stopReason === "timeout") status = "timed_out";
		else if (this.stopReason === "output_limit") status = "failed";
		else if (this.stopReason) status = "stopped";
		else status = code === 0 && signal === null ? "completed" : "failed";
		const { input, output } = this.launch;
		const recentOutput = output.recentText(DEFAULT_MODEL_OUTPUT_LIMIT);
		if (this.kind === "monitor" && !this.stopReason) {
			if (input.monitorFailureText && recentOutput.includes(input.monitorFailureText)) status = "failed";
			else if (input.monitorSuccessText && !recentOutput.includes(input.monitorSuccessText)) status = "failed";
		}
		return status;
	}

	private summary(status: BackgroundWorkTerminalStatus, code: number | null): string {
		const subject = this.kind === "monitor" ? "Monitor" : "Background command";
		switch (status) {
			case "completed":
				return `${subject} "${this.title}" completed`;
			case "failed":
				return this.stopReason === "output_limit"
					? `${subject} "${this.title}" exceeded the output limit and was stopped`
					: `${subject} "${this.title}" failed${isRuntimeNumber(code) ? ` (exit ${String(code)})` : ""}`;
			case "stopped":
				return `${subject} "${this.title}" stopped`;
			case "timed_out":
				return `${subject} "${this.title}" timed out`;
		}
	}

	private foregroundResult(outcome: BackgroundWorkOutcome): AgentToolResult<BackgroundWorkBashDetails | undefined> {
		const snapshot = foregroundOutputSnapshot(outcome.outputPath, outcome.recentOutput);
		if (outcome.status !== "completed") {
			let status = outcome.summary;
			if (isRuntimeNumber(outcome.exitCode) && outcome.exitCode !== 0) {
				status = `Command exited with code ${String(outcome.exitCode)}`;
			} else if (outcome.status === "timed_out") status = "Command timed out";
			else if (outcome.status === "stopped") status = "Command aborted";
			throw new Error(`${snapshot.text ? `${snapshot.text}\n\n` : ""}${status}`);
		}
		return textResult(snapshot.text || "(no output)", "details" in snapshot ? snapshot.details : undefined);
	}

	private backgroundLaunchResult(
		reason?: "manual" | "timeout",
	): AgentToolResult<BackgroundWorkBashDetails | undefined> {
		const action = reason === "manual" ? "manually moved" : reason === "timeout" ? "moved" : "started";
		const outputPath = this.durableOutputPath();
		const details: BackgroundWorkBashDetails = { backgroundTaskId: this.id };
		if (outputPath) Object.assign(details, { fullOutputPath: outputPath });
		return textResult(
			`Command ${action} to background task ${this.id}.${outputPath ? `\nOutput: ${outputPath}` : ""}\nThe terminal result will be delivered automatically; continue useful work instead of polling.`,
			details,
		);
	}

	private durableOutputPath(): string | undefined {
		return this.launch.output.durable && existsSync(this.launch.output.path) ? this.launch.output.path : undefined;
	}
}
