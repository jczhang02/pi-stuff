import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import type { AsyncStatus } from "../../shared/types.ts";
import { SUBAGENT_LIFECYCLE_ARTIFACT_VERSION } from "../../shared/types.ts";
import type { BackgroundRunnerConfig, RunnerAgentTask } from "../shared/parallel-utils.ts";
import { initialToolBudgetState } from "../shared/tool-budget.ts";
import { initialTurnBudgetState } from "../shared/turn-budget.ts";
import { createSteeringStatus } from "./steering.ts";

export type BackgroundRunnerStatusStep = NonNullable<AsyncStatus["steps"]>[number] & {
	exitCode?: number | null;
};

export type BackgroundRunnerStatus = AsyncStatus & {
	pid: number;
	cwd: string;
	steps: BackgroundRunnerStatusStep[];
	lastUpdate: number;
	artifactsDir?: string;
};

function tasks(work: BackgroundRunnerConfig["work"]): RunnerAgentTask[] {
	return work.mode === "single" ? [work.task] : work.group.tasks;
}

/**
 * Build the first durable status for a detached runner. The launcher can call
 * this with the actual child PID before it allows the child to start work.
 */
export function createInitialStatus(
	config: BackgroundRunnerConfig,
	startedAt: number,
	runnerPid = process.pid,
	processStartIdentity = readProcessStartIdentity(runnerPid),
): BackgroundRunnerStatus {
	return {
		lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
		runId: config.id,
		...(config.sessionId ? { sessionId: config.sessionId } : {}),
		mode: config.work.mode,
		isNested: Boolean(config.nestedSelf),
		...(config.nestedRoute ? { nestedRoute: config.nestedRoute } : {}),
		state: "running",
		startedAt,
		lastUpdate: startedAt,
		pid: runnerPid,
		...(processStartIdentity ? { processStartIdentity } : {}),
		...(config.runnerProcessInstanceId
			? {
					processTerminal: {
						version: 1 as const,
						state: "pending" as const,
						runId: config.id,
						runnerProcessInstanceId: config.runnerProcessInstanceId,
					},
				}
			: {}),
		cwd: config.cwd,
		...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
		...(config.deadlineAt !== undefined ? { deadlineAt: config.deadlineAt } : {}),
		...(config.capabilityCeiling ? { capabilityCeiling: config.capabilityCeiling } : {}),
		...(config.artifactsDir ? { artifactsDir: config.artifactsDir } : {}),
		steering: createSteeringStatus(),
		steps: tasks(config.work).map((task) => ({
			agent: task.agent,
			cwd: task.cwd,
			...(task.context ? { context: task.context } : {}),
			...(task.description ? { label: task.description } : {}),
			task: task.task,
			status: "pending" as const,
			...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
			...(task.model ? { model: task.model } : {}),
			...(task.thinking ? { thinking: task.thinking } : {}),
			...(task.skills?.length ? { skills: task.skills } : {}),
			...(task.turnBudget ? { turnBudget: initialTurnBudgetState(task.turnBudget) } : {}),
			...(task.toolBudget ? { toolBudget: initialToolBudgetState(task.toolBudget) } : {}),
			...(task.launchContractDigest ? { launchContractDigest: task.launchContractDigest } : {}),
			...(task.capabilityCeiling ? { capabilityCeiling: task.capabilityCeiling } : {}),
		})),
	};
}
