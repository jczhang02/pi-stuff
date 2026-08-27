/** Own one Agent writer process from spawn through verified group teardown. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { isRuntimeNumber } from "../../../../shared/runtime-type.js";
import type { ChildTranscriptWriter } from "../../shared/child-transcript.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { attachPostExitStdioGuard, trySignalChild } from "../../shared/post-exit-stdio-guard.ts";
import type { AgentContextUsage, ProtocolOutputLimit, TurnBudgetState, Usage } from "../../shared/types.ts";
import type { ChildProtocolMessage } from "../shared/child-protocol.ts";
import type { BackgroundRunnerConfig, BackgroundTaskResult, RunnerAgentTask } from "../shared/parallel-utils.ts";
import { buildPiArgs, cleanupTempDir } from "../shared/pi-args.ts";
import { getPiSpawnCommand, type PiSpawnDeps } from "../shared/pi-spawn.ts";
import { readChildToolDiagnosticError } from "../shared/tool-availability.ts";
import { appendTurnBudgetSystemPrompt } from "../shared/turn-budget.ts";
import { ChildProtocolRuntime, type ChildProtocolSnapshot } from "./child-protocol-runtime.ts";
import { steerAcksDir, steerCapabilityPath, stepSteerInboxDir } from "./control-channel.ts";
import type {
	BackgroundRunnerStatus as RunnerStatus,
	BackgroundRunnerStatusStep as RunnerStatusStep,
} from "./initial-status.ts";
import {
	buildWriterProcessEnv,
	buildWriterSpawnCommand,
	captureWriterProcessStartIdentity,
	closeWriterProcessGroup,
	ponytailWriterEnvironmentOverrides,
	readWriterSupervisorDisposition,
} from "./writer-process-lifecycle.ts";
import { reapOrphanWriterProcesses, type WriterRuntimeState } from "./writer-process-registry.ts";

export interface ChildProcessResult {
	exitCode: number | null;
	signal: string | null;
	stderr: string;
	messages: ChildProtocolMessage[];
	output: string;
	error?: string | undefined;
	protocolError?: ProtocolOutputLimit | undefined;
	usage: Usage;
	toolCount: number;
	durationMs: number;
	model?: string | undefined;
	contextUsage?: AgentContextUsage | undefined;
	interrupted?: boolean | undefined;
	timedOut?: boolean | undefined;
	stopped?: boolean | undefined;
	turnBudget?: TurnBudgetState | undefined;
	turnBudgetExceeded?: boolean | undefined;
	contextNudgeObserved?: boolean | undefined;
	process?: WriterProcess | undefined;
}

export type WriterProcess = NonNullable<BackgroundTaskResult["writerProcesses"]>[number];

export interface ChildRuntimeControl {
	state: "running" | "paused" | "timed-out" | "stopped" | "failed";
	interrupt(kind: "pause" | "timeout" | "stop"): void;
	revokeFinalization(): void;
}

type ChildTerminalCause = "pause" | "timeout" | "stop" | "turn-budget" | "protocol" | "setup";
type WriterControlCommand = "cancel-finalize" | "finalize" | "proceed" | "terminate-sigint" | "terminate-sigterm";

export interface ChildProcessEngineInput {
	config: BackgroundRunnerConfig;
	task: RunnerAgentTask;
	index: number;
	model?: string | undefined;
	taskCwd: string;
	sessionDir?: string | undefined;
	outputFile: string;
	transcript: ChildTranscriptWriter;
	artifactJsonlPath?: string | undefined;
	statusStep: RunnerStatusStep;
	statusPath: string;
	status: RunnerStatus;
	activeControls: Map<number, ChildRuntimeControl>;
	consumeScheduledStop: () => boolean;
	onWriterProcess?: ((writer: WriterRuntimeState) => void) | undefined;
	afterWriterSpawnBeforeBinding?: ((index: number, pid: number) => void) | undefined;
	beforeWriterCloseRecovery?: ((index: number) => void | Promise<void>) | undefined;
	beforeWriterSupervisorDispositionRead?: ((filePath: string, index: number) => void) | undefined;
	writerSupervisorRuntime?: string | undefined;
}

function buildChildLaunch(input: ChildProcessEngineInput) {
	const built = buildPiArgs({
		governorSessionId: input.task.governorSessionId,
		physicalSessionId: input.task.physicalSessionId,
		parentSessionId: input.task.parentSessionId,
		baseArgs: ["--mode", "json", "-p"],
		task: input.task.task,
		sessionEnabled: Boolean(input.task.sessionFile || input.sessionDir),
		sessionDir: input.task.sessionFile ? undefined : input.sessionDir,
		sessionFile: input.task.sessionFile,
		model: input.model,
		thinking: input.task.thinking,
		inheritProjectContext: input.task.inheritProjectContext,
		inheritSkills: input.task.inheritSkills,
		codeModeEnabled: input.config.codeModeEnabled,
		codeModeProviderTools: input.config.codeModeProviderTools,
		childBaseExtensionPath: input.task.childBaseExtensionPath,
		requireReadTool: input.task.inheritSkills || Boolean(input.task.skills?.length),
		tools: input.task.tools,
		extensions: input.task.extensions,
		subagentOnlyExtensions: input.task.subagentOnlyExtensions,
		systemPrompt: appendTurnBudgetSystemPrompt(input.task.systemPrompt ?? "", input.task.turnBudget),
		systemPromptMode: input.task.systemPromptMode,
		mcpDirectTools: input.task.mcpDirectTools,
		capabilityCeiling: input.task.capabilityCeiling ?? input.config.capabilityCeiling,
		cwd: input.taskCwd,
		promptFileStem: input.task.agent,
		intercomSessionName: input.config.childIntercomTargets?.[input.index],
		orchestratorIntercomTarget: input.config.controlIntercomTarget,
		enableNativeSupervisor: input.config.nativeSupervisor === true,
		runId: input.config.id,
		logicalAgentPathComponent: input.task.logicalAgentPathComponent,
		childAgentName: input.task.agent,
		childIndex: input.index,
		parentEventSink: input.config.nestedRoute?.eventSink,
		parentControlInbox: input.config.nestedRoute?.controlInbox,
		parentRootRunId: input.config.nestedRoute?.rootRunId,
		parentCapabilityToken: input.config.nestedRoute?.capabilityToken,
		steerInboxDir: stepSteerInboxDir(input.config.asyncDir, input.index),
		steerCapabilityPath: steerCapabilityPath(input.config.asyncDir, input.index),
		steerAckDir: steerAcksDir(input.config.asyncDir, input.index),
		toolBudget: input.task.toolBudget,
	});
	const deps: PiSpawnDeps = {};
	if (input.config.piPackageRoot) deps.piPackageRoot = input.config.piPackageRoot;
	if (input.config.piArgv1) deps.argv1 = input.config.piArgv1;
	if (input.config.piExecutable) deps.execPath = input.config.piExecutable;
	return { built, spawnSpec: getPiSpawnCommand(built.args, deps) };
}

export class ChildProcessEngine {
	private readonly input: ChildProcessEngineInput;
	private readonly startedAt = Date.now();
	private readonly processInstanceId = randomUUID();
	private readonly built: ReturnType<typeof buildPiArgs>;
	private readonly spawnSpec: ReturnType<typeof getPiSpawnCommand>;
	private readonly supervisorDispositionPath: string;
	private readonly groupMemberProofFile: string;
	private readonly groupMemberProofPath: string;
	private readonly writerControl: { readonly path: string; readonly token: string } | undefined;
	private writerControlSequence = 0;
	private writerControlError: Error | undefined;
	private child!: ReturnType<typeof spawn>;
	private childStdin!: NonNullable<ReturnType<typeof spawn>["stdin"]>;
	private childStdout!: NonNullable<ReturnType<typeof spawn>["stdout"]>;
	private childStderr!: NonNullable<ReturnType<typeof spawn>["stderr"]>;
	private writerSpawn!: ReturnType<typeof buildWriterSpawnCommand>;
	private writerPid!: number;
	private writerProcessStartIdentity!: string;
	private protocol!: ChildProtocolRuntime;
	private clearGuard: (() => void) | undefined;
	private runtimeControl: ChildRuntimeControl | undefined;
	private writerProcessBindingError: unknown;
	private terminalCause: ChildTerminalCause | undefined;
	private forcedError: string | undefined;
	private interrupted = false;
	private timedOut = false;
	private stopped = false;
	private settled = false;
	private childExited = false;
	private finalDrainEvidence = false;
	private finalDrainSignalSent = false;
	private finalDrainHardKillSignalSent = false;
	private finalDrainTimer: NodeJS.Timeout | undefined;
	private finalDrainHardKillTimer: NodeJS.Timeout | undefined;
	private terminationHardKillTimer: NodeJS.Timeout | undefined;

	constructor(input: ChildProcessEngineInput) {
		this.input = input;
		({ built: this.built, spawnSpec: this.spawnSpec } = buildChildLaunch(input));
		this.supervisorDispositionPath = path.join(
			this.built.tempDir ?? input.config.asyncDir,
			`writer-supervisor-terminal-${input.index}-${this.processInstanceId}.json`,
		);
		this.groupMemberProofFile = `writer-group-member-${input.index}-${this.processInstanceId}.json`;
		this.groupMemberProofPath = path.join(input.config.asyncDir, this.groupMemberProofFile);
		this.writerControl =
			process.platform === "win32"
				? undefined
				: {
						path: path.join(
							input.config.asyncDir,
							`writer-supervisor-control-${input.index}-${this.processInstanceId}.jsonl`,
						),
						token: randomUUID(),
					};
	}

	async run(): Promise<ChildProcessResult> {
		await this.spawnWriter();
		this.bindWriter();
		this.installRuntime();
		return await new Promise((resolve, reject) => {
			this.child.on("close", (exitCode, signal) => {
				void this.handleClose(exitCode, signal).then(resolve, reject);
			});
			this.releaseStartupGate();
		});
	}

	private removeWriterControl(): void {
		if (!this.writerControl) return;
		try {
			fs.rmSync(this.writerControl.path, { force: true });
		} catch {
			// The private run directory is retained for bounded maintenance.
		}
	}

	private rollBackLaunch(): void {
		this.removeWriterControl();
		try {
			this.input.onWriterProcess?.({ state: "none" });
		} catch (error) {
			reportAgentDiagnostic(
				`Failed to roll back Agent writer process identity for child ${this.input.index}:`,
				error,
			);
		}
		cleanupTempDir(this.built.tempDir);
	}

	private async spawnWriter(): Promise<void> {
		try {
			this.input.onWriterProcess?.({ state: "spawning" });
		} catch (error) {
			this.rollBackLaunch();
			throw error;
		}
		try {
			if (this.writerControl) {
				fs.writeFileSync(this.writerControl.path, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
			}
			this.writerSpawn = buildWriterSpawnCommand(
				this.spawnSpec.command,
				this.spawnSpec.args,
				process.platform,
				this.supervisorDispositionPath,
				this.groupMemberProofPath,
				this.input.writerSupervisorRuntime,
				this.writerControl,
			);
			this.child = spawn(this.writerSpawn.command, this.writerSpawn.args, {
				cwd: this.input.taskCwd,
				detached: process.platform !== "win32",
				stdio: ["pipe", "pipe", "pipe"],
				env: buildWriterProcessEnv(
					process.env,
					{ ...this.built.env, ...ponytailWriterEnvironmentOverrides(this.input.config.ponytailMode) },
					this.input.task.maxSubagentDepth,
				),
				windowsHide: true,
			});
			this.child.on("error", (error) => {
				this.forcedError ??= `Agent writer supervisor failed to start: ${error.message}`;
			});
		} catch (error) {
			this.rollBackLaunch();
			throw error;
		}
		await this.captureWriterIdentity();
	}

	private async captureWriterIdentity(): Promise<void> {
		const pid = this.child.pid;
		const identity = isRuntimeNumber(pid) ? await captureWriterProcessStartIdentity(pid) : undefined;
		if (!isRuntimeNumber(pid) || !identity) {
			try {
				this.child.kill("SIGKILL");
			} catch {}
			this.rollBackLaunch();
			throw new Error("Agent writer process has no stable process-start identity.");
		}
		this.writerPid = pid;
		this.writerProcessStartIdentity = identity;
		const { stdin, stdout, stderr } = this.child;
		if (!stdin || !stdout || !stderr) {
			trySignalChild(this.child, "SIGTERM", identity);
			this.rollBackLaunch();
			throw new Error("Agent writer process did not expose stdout and stderr pipes.");
		}
		this.childStdin = stdin;
		this.childStdout = stdout;
		this.childStderr = stderr;
		this.childStdin.on("error", (error: Error) => {
			this.writerControlError ??= error;
		});
	}

	private bindWriter(): void {
		try {
			this.input.afterWriterSpawnBeforeBinding?.(this.input.index, this.writerPid);
		} catch (error) {
			trySignalChild(this.child, "SIGKILL", this.writerProcessStartIdentity);
			this.rollBackLaunch();
			throw error;
		}
		try {
			const writerState: WriterRuntimeState = {
				state: "running",
				pid: this.writerPid,
				processStartIdentity: this.writerProcessStartIdentity,
			};
			if (this.writerSpawn.gated) writerState.groupMemberProofFile = this.groupMemberProofFile;
			this.input.onWriterProcess?.(writerState);
		} catch (error) {
			this.writerProcessBindingError = error;
		}
	}

	private sendSupervisorControl(
		command: WriterControlCommand,
		settleDelivery?: (delivered: boolean) => void,
	): boolean {
		if (!this.writerSpawn.gated) return false;
		try {
			if (this.writerControl) {
				this.writerControlSequence += 1;
				fs.appendFileSync(
					this.writerControl.path,
					`${JSON.stringify({
						version: 1,
						token: this.writerControl.token,
						sequence: this.writerControlSequence,
						command,
					})}\n`,
					{ encoding: "utf8" },
				);
				settleDelivery?.(true);
				return true;
			}
			if (this.childStdin.destroyed || this.childStdin.writableEnded) return false;
			this.childStdin.write(`${command}\n`, (error?: Error | null) => {
				if (error) this.writerControlError ??= error;
				settleDelivery?.(!error);
			});
			return true;
		} catch (error) {
			if (error instanceof Error) this.writerControlError ??= error;
			settleDelivery?.(false);
			return false;
		}
	}

	private requestTermination(signal: "SIGINT" | "SIGTERM"): boolean {
		if (!this.writerSpawn.gated) {
			return trySignalChild(this.child, signal, this.writerProcessStartIdentity);
		}
		const queued = this.sendSupervisorControl(
			signal === "SIGINT" ? "terminate-sigint" : "terminate-sigterm",
			(delivered) => {
				if (!delivered && !this.settled) {
					trySignalChild(this.child, signal, this.writerProcessStartIdentity);
				}
			},
		);
		return queued || trySignalChild(this.child, signal, this.writerProcessStartIdentity);
	}

	private cancelFinalDrain(preserveSemanticEvidence = false): void {
		if (this.finalDrainTimer) clearTimeout(this.finalDrainTimer);
		this.finalDrainTimer = undefined;
		const signalWasSent = this.finalDrainSignalSent || this.finalDrainHardKillSignalSent;
		if (signalWasSent && this.writerSpawn.gated) {
			const queued = this.sendSupervisorControl("cancel-finalize", (delivered) => {
				if (!delivered || this.settled) return;
				if (this.finalDrainHardKillTimer) clearTimeout(this.finalDrainHardKillTimer);
				this.finalDrainHardKillTimer = undefined;
				if (!preserveSemanticEvidence) this.clearFinalDrainEvidence();
			});
			if (queued) return;
		}
		if (preserveSemanticEvidence && signalWasSent) return;
		if (this.finalDrainHardKillTimer) clearTimeout(this.finalDrainHardKillTimer);
		this.finalDrainHardKillTimer = undefined;
		this.clearFinalDrainEvidence();
	}

	private clearFinalDrainEvidence(): void {
		this.finalDrainEvidence = false;
		this.finalDrainSignalSent = false;
		this.finalDrainHardKillSignalSent = false;
	}

	private armTerminationHardKill(): void {
		if (this.terminationHardKillTimer) clearTimeout(this.terminationHardKillTimer);
		this.terminationHardKillTimer = setTimeout(() => {
			this.terminationHardKillTimer = undefined;
			if (!this.settled) {
				const signal = this.writerSpawn.gated ? "SIGTERM" : "SIGKILL";
				trySignalChild(this.child, signal, this.writerProcessStartIdentity);
			}
		}, 8_000);
		this.terminationHardKillTimer.unref?.();
	}

	private claimTerminalCause(cause: ChildTerminalCause): boolean {
		if (this.settled || this.terminalCause) return false;
		this.terminalCause = cause;
		if (this.runtimeControl) {
			this.runtimeControl.state =
				cause === "pause" ? "paused" : cause === "timeout" ? "timed-out" : cause === "stop" ? "stopped" : "failed";
		}
		return true;
	}

	private terminate(kind: "pause" | "timeout" | "stop"): void {
		if (!this.claimTerminalCause(kind)) return;
		this.cancelFinalDrain();
		this.interrupted = kind === "pause";
		this.timedOut = kind === "timeout";
		this.stopped = kind === "stop";
		this.forcedError =
			kind === "pause" ? "Agent paused." : kind === "timeout" ? "Agent timed out." : "Agent stopped by user.";
		this.requestTermination(kind === "pause" ? "SIGINT" : "SIGTERM");
		this.armTerminationHardKill();
	}

	private startFinalDrain(evidence: boolean): void {
		this.finalDrainEvidence = evidence;
		if (this.childExited || this.finalDrainTimer || this.finalDrainSignalSent || this.settled || this.terminalCause)
			return;
		this.finalDrainTimer = setTimeout(() => this.requestFinalDrain(), 1_000);
		this.finalDrainTimer.unref?.();
	}

	private requestFinalDrain(): void {
		this.finalDrainTimer = undefined;
		if (this.settled) return;
		const requested = this.writerSpawn.gated
			? this.sendSupervisorControl("finalize", (delivered) => {
					if (this.settled) return;
					if (!delivered) {
						this.finalDrainEvidence = false;
						return;
					}
					this.finalDrainSignalSent = true;
					this.armFinalDrainWatchdog();
				})
			: trySignalChild(this.child, "SIGTERM", this.writerProcessStartIdentity);
		if (!requested) {
			this.finalDrainEvidence = false;
			return;
		}
		if (!this.writerSpawn.gated) {
			this.finalDrainSignalSent = true;
			this.armFinalDrainWatchdog();
		}
	}

	private armFinalDrainWatchdog(): void {
		this.finalDrainHardKillTimer = setTimeout(
			() => {
				this.finalDrainHardKillTimer = undefined;
				const signal = this.writerSpawn.gated ? "SIGTERM" : "SIGKILL";
				if (!this.settled && trySignalChild(this.child, signal, this.writerProcessStartIdentity)) {
					this.finalDrainHardKillSignalSent = signal === "SIGKILL";
				}
			},
			this.writerSpawn.gated ? 8_000 : 3_000,
		);
		this.finalDrainHardKillTimer.unref?.();
	}

	private terminateProtocol(cause: "protocol" | "turn-budget", error: string, signal: "SIGINT" | "SIGTERM"): boolean {
		if (!this.claimTerminalCause(cause)) return false;
		this.forcedError = error;
		this.cancelFinalDrain();
		const requested = this.requestTermination(signal);
		if (requested || cause === "turn-budget") this.armTerminationHardKill();
		return true;
	}

	private installRuntime(): void {
		this.clearGuard = attachPostExitStdioGuard(this.child, { idleMs: 2_000, hardMs: 8_000 });
		this.runtimeControl = {
			state: "running",
			interrupt: (kind) => this.terminate(kind),
			revokeFinalization: () => this.cancelFinalDrain(true),
		};
		this.input.activeControls.set(this.input.index, this.runtimeControl);
		if (this.input.consumeScheduledStop()) this.terminate("stop");
		this.protocol = new ChildProtocolRuntime({
			config: this.input.config,
			task: this.input.task,
			index: this.input.index,
			model: this.input.model,
			transcript: this.input.transcript,
			artifactJsonlPath: this.input.artifactJsonlPath,
			statusStep: this.input.statusStep,
			statusPath: this.input.statusPath,
			status: this.input.status,
			startFinalDrain: (evidence) => this.startFinalDrain(evidence),
			cancelFinalDrain: () => this.cancelFinalDrain(),
			terminate: (cause, error, signal) => this.terminateProtocol(cause, error, signal),
		});
		this.childStdout.on("data", (chunk: Buffer) => this.protocol.pushStdout(chunk));
		this.childStderr.on("data", (chunk: Buffer) => this.protocol.pushStderr(chunk));
		this.child.on("exit", () => {
			this.childExited = true;
		});
	}

	private releaseStartupGate(): void {
		if (this.writerProcessBindingError && this.claimTerminalCause("setup")) {
			this.forcedError = `Failed to bind Agent writer process identity: ${
				this.writerProcessBindingError instanceof Error
					? this.writerProcessBindingError.message
					: String(this.writerProcessBindingError)
			}`;
			trySignalChild(this.child, "SIGTERM", this.writerProcessStartIdentity);
			this.childStdin.destroy();
			return;
		}
		if (!this.writerSpawn.gated) {
			this.childStdin.end();
			return;
		}
		const queued = this.sendSupervisorControl("proceed", (delivered) => {
			if (!delivered && !this.settled && !this.childExited) this.failStartupGate();
		});
		if (!queued) this.failStartupGate();
	}

	private failStartupGate(): void {
		if (!this.claimTerminalCause("setup")) return;
		this.forcedError = `Failed to release Agent writer supervisor startup gate: ${this.writerControlError?.message ?? "control pipe closed"}.`;
		trySignalChild(this.child, "SIGTERM", this.writerProcessStartIdentity);
	}

	private async recoverWriterGroup(): Promise<void> {
		await this.input.beforeWriterCloseRecovery?.(this.input.index);
		let groupClosed = await closeWriterProcessGroup(this.writerPid, this.writerProcessStartIdentity);
		if (!groupClosed && this.writerSpawn.gated) {
			groupClosed = (await reapOrphanWriterProcesses(this.input.config.asyncDir)).remaining === 0;
		}
		if (!groupClosed) {
			this.forcedError ??= "Agent writer process group did not terminate; recovery ownership was retained.";
			return;
		}
		try {
			this.input.onWriterProcess?.({ state: "none" });
		} catch (error) {
			reportAgentDiagnostic(`Failed to clear writer process identity for Agent child ${this.input.index}:`, error);
		}
		try {
			fs.rmSync(this.groupMemberProofPath, { force: true });
		} catch {
			// The registry is already clear; proof cleanup is best effort.
		}
	}

	private readSupervisorDisposition() {
		try {
			this.input.beforeWriterSupervisorDispositionRead?.(this.supervisorDispositionPath, this.input.index);
		} catch (error) {
			reportAgentDiagnostic(
				`Agent writer supervisor disposition test hook failed for child ${this.input.index}:`,
				error,
			);
		}
		const disposition = this.writerSpawn.gated
			? readWriterSupervisorDisposition(
					this.supervisorDispositionPath,
					this.writerPid,
					this.writerProcessStartIdentity,
				)
			: undefined;
		try {
			fs.rmSync(this.supervisorDispositionPath, { force: true });
		} catch {
			// The containing temporary directory is cleaned below when available.
		}
		return disposition;
	}

	private observeTerminal(exitCode: number | null, signal: NodeJS.Signals | null, snapshot: ChildProtocolSnapshot) {
		const disposition = this.readSupervisorDisposition();
		const observedExitCode = disposition ? disposition.exitCode : exitCode;
		const observedSignal = disposition ? disposition.signal : signal;
		const semanticError =
			this.forcedError ??
			readChildToolDiagnosticError(this.built.toolDiagnosticPath) ??
			snapshot.assistantError ??
			disposition?.outputForwardingError ??
			(this.writerSpawn.gated && !disposition
				? "Agent writer supervisor terminal disposition was unavailable; termination provenance could not be verified."
				: undefined) ??
			(disposition?.reaped === false
				? "Agent writer supervisor could not reap the complete process group."
				: undefined);
		const finalDrainTerminationObserved = this.writerSpawn.gated
			? disposition?.origin === "manager-final-drain"
			: (this.finalDrainSignalSent &&
					(observedSignal === "SIGTERM" || (observedSignal === null && observedExitCode === 143))) ||
				(this.finalDrainHardKillSignalSent &&
					(observedSignal === "SIGKILL" || (observedSignal === null && observedExitCode === 137)));
		const completedByInternalFinalDrain = this.finalDrainEvidence && !semanticError && finalDrainTerminationObserved;
		const error =
			semanticError ??
			(!completedByInternalFinalDrain && observedExitCode && snapshot.stderr.trim()
				? snapshot.stderr.trim()
				: undefined);
		const signalledExit =
			observedSignal !== null ||
			(observedSignal === null &&
				isRuntimeNumber(observedExitCode) &&
				observedExitCode > 128 &&
				observedExitCode <= 255);
		const terminationOrigin = this.writerSpawn.gated
			? (disposition?.origin ?? undefined)
			: !signalledExit
				? undefined
				: finalDrainTerminationObserved
					? ("manager-final-drain" as const)
					: this.terminalCause
						? ("manager-request" as const)
						: ("external" as const);
		return { observedExitCode, observedSignal, completedByInternalFinalDrain, error, terminationOrigin };
	}

	private buildResult(
		snapshot: ChildProtocolSnapshot,
		observed: ReturnType<ChildProcessEngine["observeTerminal"]>,
	): ChildProcessResult {
		try {
			fs.writeFileSync(this.input.outputFile, snapshot.output || observed.error || "", "utf-8");
		} catch {
			// The transcript and result remain authoritative if this convenience file fails.
		}
		const writerProcess: WriterProcess = {
			processInstanceId: this.processInstanceId,
			kind: "pi-writer",
			attempt: 0,
			closeObservedAt: Date.now(),
			exitCode: observed.observedExitCode,
			signal: observed.observedSignal,
		};
		if (observed.terminationOrigin) writerProcess.terminationOrigin = observed.terminationOrigin;
		return {
			exitCode:
				this.interrupted || this.timedOut || this.stopped || snapshot.turnBudgetExceeded
					? 1
					: observed.completedByInternalFinalDrain
						? 0
						: observed.observedSignal !== null
							? 1
							: observed.observedExitCode,
			signal: observed.observedSignal,
			stderr: snapshot.stderr,
			messages: snapshot.messages,
			output: snapshot.output,
			error: observed.error,
			protocolError: snapshot.protocolError,
			usage: snapshot.usage,
			toolCount: snapshot.toolCount,
			durationMs: Date.now() - this.startedAt,
			model: snapshot.model,
			contextUsage: this.input.statusStep.contextUsage,
			interrupted: this.interrupted || undefined,
			timedOut: this.timedOut || undefined,
			stopped: this.stopped || undefined,
			turnBudget: snapshot.turnBudget,
			turnBudgetExceeded: snapshot.turnBudgetExceeded || undefined,
			contextNudgeObserved: snapshot.contextNudgeObserved || undefined,
			process: writerProcess,
		};
	}

	private async handleClose(exitCode: number | null, signal: NodeJS.Signals | null): Promise<ChildProcessResult> {
		this.input.activeControls.delete(this.input.index);
		try {
			await this.recoverWriterGroup();
			this.protocol.end();
			this.settled = true;
			const snapshot = this.protocol.snapshot();
			return this.buildResult(snapshot, this.observeTerminal(exitCode, signal, snapshot));
		} finally {
			this.teardown();
		}
	}

	private teardown(): void {
		this.input.activeControls.delete(this.input.index);
		if (this.finalDrainTimer) clearTimeout(this.finalDrainTimer);
		if (this.finalDrainHardKillTimer) clearTimeout(this.finalDrainHardKillTimer);
		if (this.terminationHardKillTimer) clearTimeout(this.terminationHardKillTimer);
		this.finalDrainTimer = undefined;
		this.finalDrainHardKillTimer = undefined;
		this.terminationHardKillTimer = undefined;
		try {
			this.clearGuard?.();
		} catch {}
		try {
			this.protocol.end();
		} catch {}
		try {
			cleanupTempDir(this.built.tempDir);
		} catch {}
		this.removeWriterControl();
		this.settled = true;
	}
}
