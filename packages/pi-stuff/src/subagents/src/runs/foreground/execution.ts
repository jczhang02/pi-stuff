/** Foreground adapter for the same resolved child engine used by background Agents. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type JsonObject, type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { tryAcquireStatusMutationClaim } from "../../shared/status-mutation.ts";
import type { ArtifactPaths, AsyncStatus, Details, NestedRunSummary, SingleResult, Usage } from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import { deliverStopRequest } from "../background/control-channel.ts";
import { runConfiguredBackground } from "../background/subagent-runner.ts";
import { reapOrphanWriterProcesses } from "../background/writer-process-registry.ts";
import type { BackgroundRunnerConfig, BackgroundTaskResult, RunnerAgentTask } from "../shared/parallel-utils.ts";
import { recordForegroundOwnerExit } from "./owner-exit.ts";

export interface ForegroundCompletion {
	id: string;
	runId: string;
	mode: "single" | "parallel";
	state: "complete" | "failed" | "stopped" | "paused";
	success: boolean;
	stopped?: boolean;
	timedOut?: boolean;
	interrupted?: boolean;
	results: BackgroundTaskResult[];
	nestedChildren?: NestedRunSummary[];
}

export interface ForegroundExecutionDependencies {
	acquireStatusClaim(asyncDir: string): { release(): void } | undefined;
	onStatus(status: AsyncStatus): void;
	runConfigured(config: BackgroundRunnerConfig, onStatus: (status: AsyncStatus) => void): Promise<void>;
	readCompletion(filePath: string): ForegroundCompletion;
	readNestedChildren(asyncDir: string, runId: string): NestedRunSummary[] | undefined;
	requestStop(asyncDir: string): void;
	reapWriters(asyncDir: string): Promise<{ remaining: number; terminated: number }>;
	writeStatus(filePath: string, status: AsyncStatus): void;
}

const DEFAULT_DEPENDENCIES: ForegroundExecutionDependencies = {
	acquireStatusClaim: tryAcquireStatusMutationClaim,
	onStatus() {},
	runConfigured(config, onStatus) {
		return runConfiguredBackground(config, { afterStatusUpdate: onStatus });
	},
	readCompletion(filePath) {
		const value = parseJsonValue(fs.readFileSync(filePath, "utf8"));
		return validateCompletion(value, filePath);
	},
	readNestedChildren(asyncDir, runId) {
		const status = readStatus(asyncDir);
		if (!status || status.runId !== runId) return undefined;
		const children = status.steps?.flatMap((step) => step.children ?? []) ?? [];
		if (children.length > 0) return children;
		return !status.nestedRoute &&
			(status.state === "complete" ||
				status.state === "failed" ||
				status.state === "paused" ||
				status.state === "stopped")
			? []
			: undefined;
	},
	requestStop(asyncDir) {
		deliverStopRequest({ asyncDir, source: "foreground-cancel" });
	},
	reapWriters: reapOrphanWriterProcesses,
	writeStatus: writePrivateAtomicJson,
};

function jsonObject(value: JsonValue): JsonObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value) ? value : {};
}

function validateTaskResult(value: JsonValue, source: string): BackgroundTaskResult {
	const candidate = jsonObject(value);
	if (
		!isRuntimeString(candidate["agent"]) ||
		!isRuntimeString(candidate["output"]) ||
		!isRuntimeBoolean(candidate["success"]) ||
		!(candidate["exitCode"] === null || isRuntimeNumber(candidate["exitCode"]))
	) {
		throw new Error(`Foreground Agent task result is malformed: ${source}`);
	}
	// SAFETY: the foreground result is runner-owned JSON whose required task fields were validated above.
	return {
		...candidate,
		agent: candidate["agent"],
		exitCode: candidate["exitCode"],
		output: candidate["output"],
		success: candidate["success"],
	} as BackgroundTaskResult;
}

function validateCompletion(value: JsonValue, source: string): ForegroundCompletion {
	const candidate = jsonObject(value);
	if (
		!isRuntimeString(candidate["id"]) ||
		!isRuntimeString(candidate["runId"]) ||
		(candidate["mode"] !== "single" && candidate["mode"] !== "parallel") ||
		!Array.isArray(candidate["results"]) ||
		!isRuntimeBoolean(candidate["success"])
	) {
		throw new Error(`Foreground Agent result is malformed: ${source}`);
	}
	const state = candidate["state"];
	if (state !== "complete" && state !== "failed" && state !== "stopped" && state !== "paused") {
		throw new Error(`Foreground Agent result has an invalid state: ${source}`);
	}
	// SAFETY: the runner-owned completion fields and every child result were validated above.
	return {
		...candidate,
		id: candidate["id"],
		mode: candidate["mode"],
		results: candidate["results"].map((result) => validateTaskResult(result, source)),
		runId: candidate["runId"],
		state,
		success: candidate["success"],
	} as ForegroundCompletion;
}

function tasks(config: BackgroundRunnerConfig): RunnerAgentTask[] {
	return config.work.mode === "single" ? [config.work.task] : config.work.group.tasks;
}

function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

function resultUsage(result: BackgroundTaskResult): Usage {
	const usage = emptyUsage();
	for (const attempt of result.modelAttempts ?? []) {
		if (!attempt.usage) continue;
		usage.input += attempt.usage.input;
		usage.output += attempt.usage.output;
		usage.cacheRead += attempt.usage.cacheRead;
		usage.cacheWrite += attempt.usage.cacheWrite;
		usage.cost += attempt.usage.cost;
		usage.turns += attempt.usage.turns;
	}
	return usage;
}

function childrenForResult(
	nestedChildren: NestedRunSummary[] | undefined,
	index: number,
	directCount: number,
): NestedRunSummary[] | undefined {
	if (!nestedChildren?.length) return undefined;
	const exact = nestedChildren.filter((child) => child.parentStepIndex === index);
	if (exact.length > 0) return exact;
	return directCount === 1 ? nestedChildren : undefined;
}

function resultWasExternalCrash(result: BackgroundTaskResult): boolean {
	if (
		result.success ||
		result.interrupted ||
		result.timedOut ||
		result.stopped ||
		result.turnBudgetExceeded ||
		result.toolBudgetBlocked
	) {
		return false;
	}
	const writers = result.writerProcesses ?? [];
	const finalAttempt = writers.reduce(
		(latest, process) => Math.max(latest, process.attempt),
		Number.NEGATIVE_INFINITY,
	);
	return writers.some((process) => process.attempt === finalAttempt && process.terminationOrigin === "external");
}

function toSingleResult(
	result: BackgroundTaskResult,
	task: RunnerAgentTask,
	index: number,
	directCount: number,
	nestedChildren: NestedRunSummary[] | undefined,
): SingleResult {
	const childResults = childrenForResult(nestedChildren, index, directCount);
	const crashed = resultWasExternalCrash(result);
	const projected: SingleResult = {
		agent: result.agent,
		task: task.task,
		exitCode: result.exitCode ?? 1,
		usage: resultUsage(result),
		finalOutput: result.output,
	};
	if (task.cwd) projected.cwd = task.cwd;
	if (result.context) projected.context = result.context;
	if (result.contextUsage) projected.contextUsage = result.contextUsage;
	if (result.interrupted) projected.interrupted = true;
	if (result.timedOut) projected.timedOut = true;
	if (result.stopped) projected.stopped = true;
	if (crashed) projected.crashed = true;
	if (result.turnBudget) projected.turnBudget = result.turnBudget;
	if (result.turnBudgetExceeded) projected.turnBudgetExceeded = true;
	if (result.wrapUpRequested) projected.wrapUpRequested = true;
	if (result.contextNudgeObserved) projected.contextNudgeObserved = true;
	if (result.toolBudget) projected.toolBudget = result.toolBudget;
	if (result.toolBudgetBlocked) projected.toolBudgetBlocked = true;
	if (result.model) projected.model = result.model;
	if (result.thinking) projected.thinking = result.thinking;
	if (result.attemptedModels) projected.attemptedModels = [...result.attemptedModels];
	if (result.modelAttempts) projected.modelAttempts = result.modelAttempts.map((attempt) => ({ ...attempt }));
	if (result.error) projected.error = result.error;
	if (result.sessionFile) projected.sessionFile = result.sessionFile;
	if (result.artifactPaths) projected.artifactPaths = { ...result.artifactPaths };
	if (result.transcriptPath) projected.transcriptPath = result.transcriptPath;
	if (result.transcriptError) projected.transcriptError = result.transcriptError;
	if (result.launchContractDigest) projected.launchContractDigest = result.launchContractDigest;
	if (result.capabilityCeiling) projected.capabilityCeiling = result.capabilityCeiling;
	if (result.capabilityAudit) projected.capabilityAudit = result.capabilityAudit;
	if (childResults) projected.children = childResults;
	return projected;
}

function contextSummary(results: readonly SingleResult[]): Details["context"] {
	const contexts = new Set(results.map((result) => result.context).filter(Boolean));
	if (contexts.size === 0) return undefined;
	if (contexts.size > 1) return "mixed";
	return contexts.values().next().value;
}

function artifactDetails(results: readonly SingleResult[]): Details["artifacts"] {
	const files = results
		.map((result) => result.artifactPaths)
		.filter((value): value is ArtifactPaths => value !== undefined);
	if (files.length === 0) return undefined;
	return { dir: configArtifactDir(files), files };
}

function configArtifactDir(files: readonly ArtifactPaths[]): string {
	const first = files[0];
	if (!first) return "";
	return path.dirname(first.outputPath);
}

function formatResult(results: readonly SingleResult[]): string {
	return results
		.map((result, index) => {
			const state = result.detached
				? "detached"
				: result.stopped
					? "stopped"
					: result.interrupted
						? "paused"
						: result.crashed
							? "crashed"
							: result.exitCode === 0
								? "completed"
								: "failed";
			const heading =
				results.length === 1 ? `Agent ${result.agent} ${state}.` : `${index + 1}. ${result.agent} — ${state}`;
			const contextNudge = result.contextNudgeObserved
				? "\nContext housekeeping observed: magic-context:ceiling-nudge."
				: "";
			return `${heading}${contextNudge}\n${result.finalOutput || result.error || "(no report)"}`;
		})
		.join("\n\n");
}

function statusMatchesConfig(status: AsyncStatus | null, config: BackgroundRunnerConfig): status is AsyncStatus {
	if (!status || status.runId !== config.id || status.mode !== config.work.mode) return false;
	const configuredTasks = tasks(config);
	if (!status.steps || status.steps.length !== configuredTasks.length) return false;
	return status.steps.every((step, index) => step.agent === configuredTasks[index]?.agent);
}

function terminalStatus(status: AsyncStatus): boolean {
	return (
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
	);
}

function stepWasExternalCrash(step: NonNullable<AsyncStatus["steps"]>[number]): boolean {
	if (step.agentStatus === "crashed") return true;
	return Boolean(
		step.processTerminal?.state === "observed" &&
			step.processTerminal.instances.some(
				(instance) => instance.kind === "pi-writer" && instance.terminationOrigin === "external",
			),
	);
}

function projectForegroundStatus(
	config: BackgroundRunnerConfig,
	status: AsyncStatus,
	detachedReason?: string,
): AgentToolResult<Details> & { isError?: boolean } {
	const configuredTasks = tasks(config);
	const runIsTerminal = terminalStatus(status);
	const results = (status.steps ?? []).map((step, index): SingleResult => {
		const task = configuredTasks[index];
		if (!task) throw new Error("Foreground Agent status has no configured task.");
		const detached = !runIsTerminal && (step.status === "pending" || step.status === "running");
		const paused = step.status === "paused";
		const stopped = step.status === "stopped" || step.stopped === true;
		const completed = step.status === "complete" || step.status === "completed";
		const output = step.recentOutput?.join("\n") ?? "";
		const projected: SingleResult = {
			agent: step.agent,
			task: step.task ?? task.task,
			cwd: task.cwd,
			exitCode: isRuntimeNumber(step.exitCode) ? step.exitCode : completed ? 0 : 1,
			usage: {
				input: step.tokens?.input ?? 0,
				output: step.tokens?.output ?? 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				turns: step.turnCount ?? 0,
			},
			finalOutput: output,
		};
		if (step.context) projected.context = step.context;
		if (step.contextUsage) projected.contextUsage = step.contextUsage;
		if (detached) {
			projected.detached = true;
			projected.detachedReason = detachedReason ?? "Foreground owner recovery pending.";
		}
		if (paused) projected.interrupted = true;
		if (stopped) projected.stopped = true;
		if (step.timedOut) projected.timedOut = true;
		if (stepWasExternalCrash(step)) projected.crashed = true;
		if (step.turnBudget) projected.turnBudget = step.turnBudget;
		if (step.turnBudgetExceeded) projected.turnBudgetExceeded = true;
		if (step.wrapUpRequested) projected.wrapUpRequested = true;
		if (step.toolBudget) projected.toolBudget = step.toolBudget;
		if (step.toolBudgetBlocked) projected.toolBudgetBlocked = true;
		if (step.model) projected.model = step.model;
		if (step.thinking) projected.thinking = step.thinking;
		if (step.attemptedModels) projected.attemptedModels = [...step.attemptedModels];
		if (step.modelAttempts) projected.modelAttempts = step.modelAttempts.map((attempt) => ({ ...attempt }));
		if (step.error) projected.error = step.error;
		else if (!detached && status.error) projected.error = status.error;
		if (step.sessionFile) projected.sessionFile = step.sessionFile;
		if (step.transcriptPath) projected.transcriptPath = step.transcriptPath;
		if (step.transcriptError) projected.transcriptError = step.transcriptError;
		if (step.launchContractDigest) projected.launchContractDigest = step.launchContractDigest;
		if (step.capabilityCeiling) projected.capabilityCeiling = step.capabilityCeiling;
		if (step.capabilityAudit) projected.capabilityAudit = step.capabilityAudit;
		if (step.children?.length) projected.children = step.children;
		return projected;
	});
	const artifacts = artifactDetails(results);
	const context = contextSummary(results);
	const details: Details = {
		mode: config.work.mode,
		runId: config.id,
		cwd: config.cwd,
		results,
	};
	if (context) details.context = context;
	if (artifacts) details.artifacts = artifacts;
	if (status.timedOut) details.timedOut = true;
	if (status.stopped) details.stopped = true;
	if (config.timeoutMs !== undefined) details.timeoutMs = config.timeoutMs;
	if (config.deadlineAt !== undefined) details.deadlineAt = config.deadlineAt;
	if (config.capabilityCeiling) details.capabilityCeiling = config.capabilityCeiling;
	const projected: AgentToolResult<Details> & { isError?: boolean } = {
		content: [{ type: "text", text: formatResult(results) }],
		details,
	};
	if (status.state !== "complete") projected.isError = true;
	return projected;
}

function terminalizeForegroundOwnerFailure(status: AsyncStatus, message: string): AsyncStatus {
	if (terminalStatus(status)) return status;
	const endedAt = Date.now();
	return {
		...status,
		state: "failed",
		error: message,
		endedAt,
		lastUpdate: endedAt,
		activityState: undefined,
		currentTool: undefined,
		currentToolStartedAt: undefined,
		currentPath: undefined,
		steps: status.steps?.map((step) =>
			step.status === "pending" || step.status === "running"
				? {
						...step,
						status: "failed" as const,
						exitCode: 1,
						error: message,
						endedAt,
						activityState: undefined,
						currentTool: undefined,
						currentToolStartedAt: undefined,
						currentPath: undefined,
					}
				: step,
		),
	};
}

function readMatchingStatus(config: BackgroundRunnerConfig): AsyncStatus | undefined {
	try {
		const status = readStatus(config.asyncDir);
		return statusMatchesConfig(status, config) ? status : undefined;
	} catch {
		return undefined;
	}
}

export function projectForegroundCompletion(
	config: BackgroundRunnerConfig,
	completion: ForegroundCompletion,
): AgentToolResult<Details> & { isError?: boolean } {
	const configuredTasks = tasks(config);
	const results = completion.results.map((result, index) => {
		const configuredTask = configuredTasks[index] ?? configuredTasks[0];
		if (!configuredTask) throw new Error("Foreground Agent result has no configured task.");
		return toSingleResult(result, configuredTask, index, completion.results.length, completion.nestedChildren);
	});
	const artifacts = artifactDetails(results);
	const context = contextSummary(results);
	const details: Details = {
		mode: completion.mode,
		runId: completion.runId,
		cwd: config.cwd,
		results,
	};
	if (context) details.context = context;
	if (artifacts) details.artifacts = artifacts;
	if (completion.timedOut) details.timedOut = true;
	if (completion.stopped) details.stopped = true;
	if (config.timeoutMs !== undefined) details.timeoutMs = config.timeoutMs;
	if (config.deadlineAt !== undefined) details.deadlineAt = config.deadlineAt;
	if (config.capabilityCeiling) details.capabilityCeiling = config.capabilityCeiling;
	const projected: AgentToolResult<Details> & { isError?: boolean } = {
		content: [{ type: "text", text: formatResult(results) }],
		details,
	};
	if (!completion.success) projected.isError = true;
	return projected;
}

export async function executeForegroundConfig(
	config: BackgroundRunnerConfig,
	signal?: AbortSignal,
	dependencies: Partial<ForegroundExecutionDependencies> = {},
): Promise<AgentToolResult<Details> & { isError?: boolean }> {
	const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
	const notifyStatus = (status: AsyncStatus) => {
		try {
			deps.onStatus(status);
		} catch (error) {
			reportAgentDiagnostic(`Foreground Agent status observer failed for '${config.id}':`, error);
		}
	};
	if (signal?.aborted) {
		return {
			content: [{ type: "text", text: "Foreground Agent cancelled before launch." }],
			isError: true,
			details: { mode: config.work.mode, runId: config.id, cwd: config.cwd, results: [], stopped: true },
		};
	}

	let stopRequestError: unknown;
	const stop = () => {
		try {
			deps.requestStop(config.asyncDir);
		} catch (error) {
			stopRequestError = error;
			reportAgentDiagnostic(`Failed to request foreground Agent cancellation for '${config.id}':`, error);
		}
	};
	signal?.addEventListener("abort", stop, { once: true });
	try {
		await deps.runConfigured(config, notifyStatus);
		const completion = deps.readCompletion(config.resultPath);
		const nestedChildren = deps.readNestedChildren(config.asyncDir, config.id);
		const projected = projectForegroundCompletion(
			config,
			nestedChildren === undefined ? completion : { ...completion, nestedChildren },
		);
		if (stopRequestError === undefined) return projected;
		const message = stopRequestError instanceof Error ? stopRequestError.message : String(stopRequestError);
		return {
			...projected,
			content: [...projected.content, { type: "text", text: `Cancellation request warning: ${message}` } as const],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const ownerFailure = `Foreground Agent execution owner ended unexpectedly: ${message}`;
		const stopMessage =
			stopRequestError === undefined
				? undefined
				: stopRequestError instanceof Error
					? stopRequestError.message
					: String(stopRequestError);
		let status = readMatchingStatus(config);
		// The execution frame has ended whether status.json is readable or not.
		// Persist that semantic boundary first so the long-lived Pi PID cannot be
		// mistaken for proof that this foreground frame is still active.
		try {
			recordForegroundOwnerExit(config.asyncDir, config.id, ownerFailure);
		} catch (markerError) {
			reportAgentDiagnostic(`Failed to persist foreground owner exit for '${config.id}':`, markerError);
		}
		let remainingWriters = 1;
		try {
			remainingWriters = (await deps.reapWriters(config.asyncDir)).remaining;
		} catch (reapError) {
			reportAgentDiagnostic(`Failed to reap foreground writers for '${config.id}':`, reapError);
		}
		let terminalOverlay: AsyncStatus | undefined;
		if (status && !terminalStatus(status) && remainingWriters === 0) {
			let claim: ReturnType<ForegroundExecutionDependencies["acquireStatusClaim"]>;
			try {
				claim = deps.acquireStatusClaim(config.asyncDir);
			} catch (claimError) {
				reportAgentDiagnostic(`Failed to acquire foreground status claim for '${config.id}':`, claimError);
			}
			if (claim) {
				try {
					const current = readMatchingStatus(config);
					if (current) {
						status = terminalizeForegroundOwnerFailure(current, ownerFailure);
						terminalOverlay = status;
						if (!terminalStatus(current)) {
							deps.writeStatus(path.join(config.asyncDir, "status.json"), status);
							notifyStatus(status);
						}
					}
				} catch (statusError) {
					reportAgentDiagnostic(`Failed to persist foreground owner failure for '${config.id}':`, statusError);
				} finally {
					try {
						claim.release();
					} catch (releaseError) {
						reportAgentDiagnostic(`Failed to release foreground status claim for '${config.id}':`, releaseError);
					}
				}
			}
		}
		if (status) {
			const latest = terminalOverlay ?? readMatchingStatus(config) ?? status;
			const projected = projectForegroundStatus(config, latest, terminalStatus(latest) ? undefined : ownerFailure);
			if (!stopMessage) return projected;
			return {
				...projected,
				content: [
					...projected.content,
					{ type: "text", text: `Cancellation transport also failed: ${stopMessage}` } as const,
				],
			};
		}
		const details: Details = {
			mode: config.work.mode,
			runId: config.id,
			cwd: config.cwd,
			results: [],
		};
		if (signal?.aborted) details.stopped = true;
		return {
			content: [
				{
					type: "text",
					text: stopMessage
						? `Foreground Agent failed: ${message}\nCancellation transport also failed: ${stopMessage}`
						: message,
				},
			],
			isError: true,
			details,
		};
	} finally {
		signal?.removeEventListener("abort", stop);
	}
}
