import { existsSync } from "node:fs";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { boundTerminalLine } from "../../tool-display/index.js";
import { reportWorkDiagnostic } from "./diagnostics.js";
import { type BoundedOutputFile, foregroundOutputSnapshot } from "./output.js";
import type {
	BackgroundWorkBashDetails,
	BackgroundWorkKind,
	BackgroundWorkOutcome,
	BackgroundWorkSnapshot,
	BackgroundWorkTerminalStatus,
	BashExecutionInput,
} from "./runtime.js";
import type { ShellLaunchInput } from "./shell-activity-launch.js";

const QUICK_COMPLETION_MS = 2_000;

export type ShellStopReason = "abort" | "output_limit" | "shutdown" | "timeout" | "user";

export function shellActivityTitle(input: ShellLaunchInput): string {
	const first =
		input.command
			.trim()
			.split(/\r?\n|&&|\|\||;/u)[0]
			?.trim() ?? "";
	return input.description?.trim() || boundTerminalLine(first, 80) || "background command";
}

export function emitShellToolUpdate(
	onUpdate: AgentToolUpdateCallback<BackgroundWorkBashDetails | undefined> | undefined,
	result: AgentToolResult<BackgroundWorkBashDetails | undefined>,
): void {
	try {
		onUpdate?.(result);
	} catch (error) {
		reportWorkDiagnostic("Bash progress observer failed", error, { key: "bash-progress-observer" });
	}
}

interface ShellExecutionProjection {
	readonly completion: Promise<BackgroundWorkOutcome>;
	readonly detach: (reason: "timeout") => void;
	readonly detached: Promise<"manual" | "timeout">;
	readonly id: string;
	readonly onAbort: () => void;
	readonly output: BoundedOutputFile;
	readonly outputPath: () => string | undefined;
}

export async function executeShellTool(
	input: BashExecutionInput,
	backgroundAfterMs: number,
	source: ShellExecutionProjection,
): Promise<AgentToolResult<BackgroundWorkBashDetails | undefined>> {
	if (input.runInBackground) return backgroundShellLaunchResult(source.id, source.outputPath());
	let updateTimer: ReturnType<typeof setInterval> | undefined;
	let lastUpdate = "";
	const sendUpdate = () => {
		const output = source.output.recentText(12_000);
		if (!output || output === lastUpdate) return;
		lastUpdate = output;
		emitShellToolUpdate(input.onUpdate, { content: [{ type: "text", text: output }], details: undefined });
	};
	if (input.signal) {
		if (input.signal.aborted) source.onAbort();
		else input.signal.addEventListener("abort", source.onAbort, { once: true });
	}
	emitShellToolUpdate(input.onUpdate, { content: [], details: undefined });
	const detachTimer = setTimeout(() => source.detach("timeout"), backgroundAfterMs);
	detachTimer.unref?.();
	let quickTimer: ReturnType<typeof setTimeout> | undefined;
	const quick = await Promise.race([
		source.completion.then((outcome) => ({ kind: "completed" as const, outcome })),
		source.detached.then((reason) => ({ kind: "detached" as const, reason })),
		new Promise<{ readonly kind: "still-running" }>((resolve) => {
			quickTimer = setTimeout(() => resolve({ kind: "still-running" }), QUICK_COMPLETION_MS);
			quickTimer.unref?.();
		}),
	]);
	if (quickTimer) clearTimeout(quickTimer);
	if (quick.kind === "completed") {
		clearTimeout(detachTimer);
		input.signal?.removeEventListener("abort", source.onAbort);
		return foregroundShellResult(quick.outcome);
	}
	if (quick.kind === "detached") {
		clearTimeout(detachTimer);
		input.signal?.removeEventListener("abort", source.onAbort);
		return backgroundShellLaunchResult(source.id, source.outputPath(), quick.reason);
	}
	updateTimer = setInterval(sendUpdate, 250);
	updateTimer.unref?.();
	try {
		const result = await Promise.race([
			source.completion.then((outcome) => ({ kind: "completed" as const, outcome })),
			source.detached.then((reason) => ({ kind: "detached" as const, reason })),
		]);
		sendUpdate();
		return result.kind === "detached"
			? backgroundShellLaunchResult(source.id, source.outputPath(), result.reason)
			: foregroundShellResult(result.outcome);
	} finally {
		if (updateTimer) clearInterval(updateTimer);
		clearTimeout(detachTimer);
		input.signal?.removeEventListener("abort", source.onAbort);
	}
}

export function durableShellOutputPath(output: BoundedOutputFile): string | undefined {
	return output.durable && existsSync(output.path) ? output.path : undefined;
}

interface ShellSnapshotProjection {
	readonly id: string;
	readonly input: ShellLaunchInput;
	readonly kind: BackgroundWorkKind;
	readonly outputPath: string | undefined;
	readonly recentOutput: string;
	readonly startedAt: number;
	readonly stopReason: ShellStopReason | undefined;
	readonly title: string;
}

export function projectShellSnapshot(source: ShellSnapshotProjection): BackgroundWorkSnapshot {
	const { input } = source;
	const snapshot: BackgroundWorkSnapshot = {
		command: input.command,
		id: source.id,
		kind: source.kind,
		startedAt: source.startedAt,
		status: source.stopReason ? "stopping" : "running",
		title: source.title,
	};
	if (input.description) Object.assign(snapshot, { description: input.description });
	if (input.monitorFailureText) Object.assign(snapshot, { monitorFailureText: input.monitorFailureText });
	if (input.monitorSource) Object.assign(snapshot, { monitorSource: input.monitorSource });
	if (input.monitorSuccessText) Object.assign(snapshot, { monitorSuccessText: input.monitorSuccessText });
	if (input.monitorTarget) Object.assign(snapshot, { monitorTarget: input.monitorTarget });
	if (input.monitorTimeoutSeconds !== undefined) {
		Object.assign(snapshot, { monitorTimeoutSeconds: input.monitorTimeoutSeconds });
	}
	if (source.outputPath) Object.assign(snapshot, { outputPath: source.outputPath });
	if (source.recentOutput) Object.assign(snapshot, { recentOutput: source.recentOutput });
	return snapshot;
}

export function shellTerminalStatus(
	kind: BackgroundWorkKind,
	input: ShellLaunchInput,
	stopReason: ShellStopReason | undefined,
	code: number | null,
	signal: NodeJS.Signals | null,
	recentOutput: string,
): BackgroundWorkTerminalStatus {
	let status: BackgroundWorkTerminalStatus;
	if (stopReason === "timeout") status = "timed_out";
	else if (stopReason === "output_limit") status = "failed";
	else if (stopReason) status = "stopped";
	else status = code === 0 && signal === null ? "completed" : "failed";
	if (kind === "monitor" && !stopReason) {
		if (input.monitorFailureText && recentOutput.includes(input.monitorFailureText)) status = "failed";
		else if (input.monitorSuccessText && !recentOutput.includes(input.monitorSuccessText)) status = "failed";
	}
	return status;
}

export function shellOutcomeSummary(
	kind: BackgroundWorkKind,
	title: string,
	stopReason: ShellStopReason | undefined,
	status: BackgroundWorkTerminalStatus,
	code: number | null,
): string {
	const subject = kind === "monitor" ? "Monitor" : "Background command";
	switch (status) {
		case "completed":
			return `${subject} "${title}" completed`;
		case "failed":
			return stopReason === "output_limit"
				? `${subject} "${title}" exceeded the output limit and was stopped`
				: `${subject} "${title}" failed${isRuntimeNumber(code) ? ` (exit ${String(code)})` : ""}`;
		case "stopped":
			return `${subject} "${title}" stopped`;
		case "timed_out":
			return `${subject} "${title}" timed out`;
	}
}

export function foregroundShellResult(
	outcome: BackgroundWorkOutcome,
): AgentToolResult<BackgroundWorkBashDetails | undefined> {
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

export function backgroundShellLaunchResult(
	id: string,
	outputPath: string | undefined,
	reason?: "manual" | "timeout",
): AgentToolResult<BackgroundWorkBashDetails | undefined> {
	const action = reason === "manual" ? "manually moved" : reason === "timeout" ? "moved" : "started";
	const details: BackgroundWorkBashDetails = { backgroundTaskId: id };
	if (outputPath) Object.assign(details, { fullOutputPath: outputPath });
	return textResult(
		`Command ${action} to background task ${id}.${outputPath ? `\nOutput: ${outputPath}` : ""}\nThe terminal result will be delivered automatically; continue useful work instead of polling.`,
		details,
	);
}

function textResult(
	text: string,
	details?: BackgroundWorkBashDetails,
): AgentToolResult<BackgroundWorkBashDetails | undefined> {
	return { content: [{ type: "text", text }], details };
}
