/** Foreground adapter for the same resolved child engine used by background Agents. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ArtifactPaths, Details, NestedRunSummary, SingleResult, Usage } from "../../shared/types.ts";
import { deliverStopRequest } from "../background/control-channel.ts";
import { runConfiguredBackground } from "../background/subagent-runner.ts";
import type { BackgroundRunnerConfig, BackgroundTaskResult, RunnerAgentTask } from "../shared/parallel-utils.ts";

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
	runConfigured(config: BackgroundRunnerConfig): Promise<void>;
	readCompletion(filePath: string): ForegroundCompletion;
	requestStop(asyncDir: string): void;
}

const DEFAULT_DEPENDENCIES: ForegroundExecutionDependencies = {
	runConfigured: runConfiguredBackground,
	readCompletion(filePath) {
		const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
		return validateCompletion(value, filePath);
	},
	requestStop(asyncDir) {
		deliverStopRequest({ asyncDir, source: "foreground-cancel" });
	},
};

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function validateCompletion(value: unknown, source: string): ForegroundCompletion {
	const candidate = record(value);
	if (
		typeof candidate.id !== "string" ||
		typeof candidate.runId !== "string" ||
		(candidate.mode !== "single" && candidate.mode !== "parallel") ||
		!Array.isArray(candidate.results) ||
		typeof candidate.success !== "boolean"
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

function toSingleResult(
	result: BackgroundTaskResult,
	task: RunnerAgentTask,
	index: number,
	directCount: number,
	nestedChildren: NestedRunSummary[] | undefined,
): SingleResult {
	const childResults = childrenForResult(nestedChildren, index, directCount);
	return {
		agent: result.agent,
		task: task.task,
		...(result.context ? { context: result.context } : {}),
		exitCode: result.exitCode ?? 1,
		...(result.interrupted ? { interrupted: true } : {}),
		...(result.timedOut ? { timedOut: true } : {}),
		...(result.stopped ? { stopped: true } : {}),
		...(result.turnBudget ? { turnBudget: result.turnBudget } : {}),
		...(result.turnBudgetExceeded ? { turnBudgetExceeded: true } : {}),
		...(result.wrapUpRequested ? { wrapUpRequested: true } : {}),
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
			const state = result.stopped
				? "stopped"
				: result.interrupted
					? "paused"
					: result.exitCode === 0
						? "completed"
						: "failed";
			const heading =
				results.length === 1 ? `Agent ${result.agent} ${state}.` : `${index + 1}. ${result.agent} — ${state}`;
			return `${heading}\n${result.finalOutput || result.error || "(no report)"}`;
		})
		.join("\n\n");
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
	if (signal?.aborted) {
		return {
			content: [{ type: "text", text: "Foreground Agent cancelled before launch." }],
			isError: true,
			details: { mode: config.work.mode, runId: config.id, results: [], stopped: true },
		};
	}

	const stop = () => deps.requestStop(config.asyncDir);
	signal?.addEventListener("abort", stop, { once: true });
	try {
		await deps.runConfigured(config);
		return projectForegroundCompletion(config, deps.readCompletion(config.resultPath));
	} catch (error) {
		return {
			content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
			isError: true,
			details: { mode: config.work.mode, runId: config.id, results: [] },
		};
	} finally {
		signal?.removeEventListener("abort", stop);
	}
}
