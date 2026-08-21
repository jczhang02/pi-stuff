/** Foreground adapter for the same resolved child engine used by background Agents. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
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
		const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
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

function record(value: unknown): Record<string, unknown> {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validateCompletion(value: unknown, source: string): ForegroundCompletion {
	const candidate = record(value);
	if (
		!isRuntimeString(candidate.id) ||
		!isRuntimeString(candidate.runId) ||
		(candidate.mode !== "single" && candidate.mode !== "parallel") ||
		!Array.isArray(candidate.results) ||
		!isRuntimeBoolean(candidate.success)
	) {
		throw new Error(`Foreground Agent result is malformed: ${source}`);
	}
	const state = candidate.state;
	if (state !== "complete" && state !== "failed" && state !== "stopped" && state !== "paused") {
		throw new Error(`Foreground Agent result has an invalid state: ${source}`);
	}
	return candidate as unknown as ForegroundCompletion;
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
	return {
		agent: result.agent,
		task: task.task,
		...(task.cwd ? { cwd: task.cwd } : {}),
		...(result.context ? { context: result.context } : {}),
		exitCode: result.exitCode ?? 1,
		...(result.interrupted ? { interrupted: true } : {}),
		...(result.timedOut ? { timedOut: true } : {}),
		...(result.stopped ? { stopped: true } : {}),
		...(crashed ? { crashed: true } : {}),
		...(result.turnBudget ? { turnBudget: result.turnBudget } : {}),
		...(result.turnBudgetExceeded ? { turnBudgetExceeded: true } : {}),
		...(result.wrapUpRequested ? { wrapUpRequested: true } : {}),
		...(result.contextNudgeObserved ? { contextNudgeObserved: true } : {}),
		...(result.toolBudget ? { toolBudget: result.toolBudget } : {}),
		...(result.toolBudgetBlocked ? { toolBudgetBlocked: true } : {}),
		usage: resultUsage(result),
		...(result.model ? { model: result.model } : {}),
		...(result.thinking ? { thinking: result.thinking } : {}),
		...(result.attemptedModels ? { attemptedModels: [...result.attemptedModels] } : {}),
		...(result.modelAttempts ? { modelAttempts: result.modelAttempts.map((attempt) => ({ ...attempt })) } : {}),
		...(result.error ? { error: result.error } : {}),
		...(result.sessionFile ? { sessionFile: result.sessionFile } : {}),
		...(result.artifactPaths ? { artifactPaths: { ...result.artifactPaths } } : {}),
		...(result.transcriptPath ? { transcriptPath: result.transcriptPath } : {}),
		...(result.transcriptError ? { transcriptError: result.transcriptError } : {}),
		...(result.launchContractDigest ? { launchContractDigest: result.launchContractDigest } : {}),
		...(result.capabilityCeiling ? { capabilityCeiling: result.capabilityCeiling } : {}),
		...(result.capabilityAudit ? { capabilityAudit: result.capabilityAudit } : {}),
		...(childResults ? { children: childResults } : {}),
		finalOutput: result.output,
	};
}

function contextSummary(results: readonly SingleResult[]): Details["context"] {
	const contexts = new Set(results.map((result) => result.context).filter(Boolean));
	if (contexts.size === 0) return undefined;
	if (contexts.size > 1) return "mixed";
	return [...contexts][0] as "fresh" | "fork";
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
		return {
			agent: step.agent,
			task: step.task ?? task.task,
			cwd: task.cwd,
			...(step.context ? { context: step.context } : {}),
			exitCode: isRuntimeNumber(step.exitCode) ? step.exitCode : completed ? 0 : 1,
			...(detached
				? { detached: true, detachedReason: detachedReason ?? "Foreground owner recovery pending." }
				: {}),
			...(paused ? { interrupted: true } : {}),
			...(stopped ? { stopped: true } : {}),
			...(step.timedOut ? { timedOut: true } : {}),
			...(stepWasExternalCrash(step) ? { crashed: true } : {}),
			...(step.turnBudget ? { turnBudget: step.turnBudget } : {}),
			...(step.turnBudgetExceeded ? { turnBudgetExceeded: true } : {}),
			...(step.wrapUpRequested ? { wrapUpRequested: true } : {}),
			...(step.toolBudget ? { toolBudget: step.toolBudget } : {}),
			...(step.toolBudgetBlocked ? { toolBudgetBlocked: true } : {}),
			usage: {
				input: step.tokens?.input ?? 0,
				output: step.tokens?.output ?? 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				turns: step.turnCount ?? 0,
			},
			...(step.model ? { model: step.model } : {}),
			...(step.thinking ? { thinking: step.thinking } : {}),
			...(step.attemptedModels ? { attemptedModels: [...step.attemptedModels] } : {}),
			...(step.modelAttempts ? { modelAttempts: step.modelAttempts.map((attempt) => ({ ...attempt })) } : {}),
			...(step.error || (!detached && status.error) ? { error: step.error ?? status.error } : {}),
			...(step.sessionFile ? { sessionFile: step.sessionFile } : {}),
			...(step.transcriptPath ? { transcriptPath: step.transcriptPath } : {}),
			...(step.transcriptError ? { transcriptError: step.transcriptError } : {}),
			...(step.launchContractDigest ? { launchContractDigest: step.launchContractDigest } : {}),
			...(step.capabilityCeiling ? { capabilityCeiling: step.capabilityCeiling } : {}),
			...(step.capabilityAudit ? { capabilityAudit: step.capabilityAudit } : {}),
			...(step.children?.length ? { children: step.children } : {}),
			finalOutput: output,
		};
	});
	const artifacts = artifactDetails(results);
	const context = contextSummary(results);
	return {
		content: [{ type: "text", text: formatResult(results) }],
		...(status.state === "complete" ? {} : { isError: true }),
		details: {
			mode: config.work.mode,
			runId: config.id,
			cwd: config.cwd,
			results,
			...(context ? { context } : {}),
			...(artifacts ? { artifacts } : {}),
			...(status.timedOut ? { timedOut: true } : {}),
			...(status.stopped ? { stopped: true } : {}),
			...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
			...(config.deadlineAt !== undefined ? { deadlineAt: config.deadlineAt } : {}),
			...(config.capabilityCeiling ? { capabilityCeiling: config.capabilityCeiling } : {}),
		},
	};
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
	return {
		content: [{ type: "text", text: formatResult(results) }],
		...(!completion.success ? { isError: true } : {}),
		details: {
			mode: completion.mode,
			runId: completion.runId,
			cwd: config.cwd,
			results,
			...(context ? { context } : {}),
			...(artifacts ? { artifacts } : {}),
			...(completion.timedOut ? { timedOut: true } : {}),
			...(completion.stopped ? { stopped: true } : {}),
			...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
			...(config.deadlineAt !== undefined ? { deadlineAt: config.deadlineAt } : {}),
			...(config.capabilityCeiling ? { capabilityCeiling: config.capabilityCeiling } : {}),
		},
	};
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
			details: {
				mode: config.work.mode,
				runId: config.id,
				cwd: config.cwd,
				results: [],
				...(signal?.aborted ? { stopped: true } : {}),
			},
		};
	} finally {
		signal?.removeEventListener("abort", stop);
	}
}
