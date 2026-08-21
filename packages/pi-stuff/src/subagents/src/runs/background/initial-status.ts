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
	const session: Pick<BackgroundRunnerStatus, "parentRunOrigin" | "sessionId"> = {};
	if (config.sessionId) session.sessionId = config.sessionId;
	if (config.parentRunOrigin) session.parentRunOrigin = config.parentRunOrigin;
	const nesting: Pick<BackgroundRunnerStatus, "nestedRoute"> = {};
	if (config.nestedRoute) nesting.nestedRoute = config.nestedRoute;
	const process: Pick<BackgroundRunnerStatus, "processStartIdentity" | "processTerminal"> = {};
	if (processStartIdentity) process.processStartIdentity = processStartIdentity;
	if (config.runnerProcessInstanceId) {
		process.processTerminal = {
			version: 1,
			state: "pending",
			runId: config.id,
			runnerProcessInstanceId: config.runnerProcessInstanceId,
		};
	}
	const limits: Pick<BackgroundRunnerStatus, "artifactsDir" | "capabilityCeiling" | "deadlineAt" | "timeoutMs"> = {};
	if (config.timeoutMs !== undefined) limits.timeoutMs = config.timeoutMs;
	if (config.deadlineAt !== undefined) limits.deadlineAt = config.deadlineAt;
	if (config.capabilityCeiling) limits.capabilityCeiling = config.capabilityCeiling;
	if (config.artifactsDir) limits.artifactsDir = config.artifactsDir;
	return {
		lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
		runId: config.id,
		...session,
		mode: config.work.mode,
		isNested: Boolean(config.nestedSelf),
		...nesting,
		state: "running",
		startedAt,
		lastUpdate: startedAt,
		pid: runnerPid,
		...process,
		cwd: config.cwd,
		...limits,
		steering: createSteeringStatus(),
		steps: tasks(config.work).map((task) => {
			const description: Pick<BackgroundRunnerStatusStep, "context" | "delegatedTask" | "label"> = {};
			if (task.context) description.context = task.context;
			if (task.description) description.label = task.description;
			if (task.delegatedTask && task.delegatedTask !== task.task) {
				description.delegatedTask = task.delegatedTask;
			}
			const launch: Pick<
				BackgroundRunnerStatusStep,
				| "capabilityCeiling"
				| "launchContractDigest"
				| "model"
				| "sessionFile"
				| "skills"
				| "thinking"
				| "toolBudget"
				| "turnBudget"
			> = {};
			if (task.sessionFile) launch.sessionFile = task.sessionFile;
			if (task.model) launch.model = task.model;
			if (task.thinking) launch.thinking = task.thinking;
			if (task.skills?.length) launch.skills = task.skills;
			if (task.turnBudget) launch.turnBudget = initialTurnBudgetState(task.turnBudget);
			if (task.toolBudget) launch.toolBudget = initialToolBudgetState(task.toolBudget);
			if (task.launchContractDigest) launch.launchContractDigest = task.launchContractDigest;
			if (task.capabilityCeiling) launch.capabilityCeiling = task.capabilityCeiling;
			return {
				agent: task.agent,
				cwd: task.cwd,
				...description,
				task: task.task,
				status: "pending",
				...launch,
			};
		}),
	};
}
