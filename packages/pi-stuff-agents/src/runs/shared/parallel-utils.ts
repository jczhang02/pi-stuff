import type {
	ArtifactConfig,
	CostSummary,
	ModelAttempt,
	NestedRouteInfo,
	ResolvedControlConfig,
	ResolvedToolBudget,
	ResolvedTurnBudget,
	ToolBudgetState,
	TurnBudgetState,
} from "../../shared/types.ts";
import type { ResolvedSubagentCapabilityCeiling, SubagentCapabilityAudit } from "./capability-ceiling.ts";

/**
 * Fully-resolved input for one background child.
 *
 * The launcher owns policy resolution. The detached runner consumes this shape
 * without rediscovering agents or inheriting settings.
 */
export interface RunnerAgentTask {
	/** Session id of the direct parent session for permission-system ask forwarding. */
	parentSessionId?: string;
	agent: string;
	task: string;
	/** Resolved launch context for this child. */
	context?: "fresh" | "fork";
	label?: string;
	cwd: string;
	model?: string;
	thinking?: string;
	modelCandidates?: string[];
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mcpDirectTools?: string[];
	systemPrompt?: string | null;
	systemPromptMode?: "append" | "replace";
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	skills?: string[];
	sessionFile?: string;
	maxSubagentDepth?: number;
	definitionDigest?: string;
	launchBindingTask?: string;
	launchContractDigest?: string;
	turnBudget?: ResolvedTurnBudget;
	toolBudget?: ResolvedToolBudget;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
}

export interface RunnerParallelGroup {
	tasks: RunnerAgentTask[];
	concurrency: number;
	worktree: boolean;
}

export type BackgroundRunnerWork =
	| { mode: "single"; task: RunnerAgentTask }
	| { mode: "parallel"; group: RunnerParallelGroup };

export interface BackgroundRunnerConfig {
	version: 2;
	id: string;
	work: BackgroundRunnerWork;
	resultPath: string;
	cwd: string;
	asyncDir: string;
	sessionId?: string | null;
	artifactsDir?: string;
	artifactConfig?: Partial<ArtifactConfig>;
	sessionDir?: string;
	piPackageRoot?: string;
	piArgv1?: string;
	piExecutable?: string;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	worktreeBaseDir?: string;
	controlConfig?: ResolvedControlConfig;
	controlIntercomTarget?: string;
	childIntercomTargets?: Array<string | undefined>;
	nestedRoute?: NestedRouteInfo;
	nestedSelf?: {
		parentRunId: string;
		parentStepIndex?: number;
		depth: number;
		path?: Array<{ runId: string; stepIndex?: number; agent?: string }>;
	};
	timeoutMs?: number;
	deadlineAt?: number;
	revivalLease?: import("./session-lease.ts").SessionLeaseRequest;
	revivalLeaseToken?: string;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	launchContractDigest?: string;
	runnerProcessInstanceId?: string;
}

export interface BackgroundTaskResult {
	agent: string;
	context?: "fresh" | "fork";
	output: string;
	success: boolean;
	exitCode: number | null;
	error?: string;
	interrupted?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	turnBudget?: TurnBudgetState;
	turnBudgetExceeded?: boolean;
	wrapUpRequested?: boolean;
	toolBudget?: ToolBudgetState;
	toolBudgetBlocked?: boolean;
	sessionFile?: string;
	intercomTarget?: string;
	model?: string;
	thinking?: string;
	attemptedModels?: string[];
	modelAttempts?: ModelAttempt[];
	totalCost?: CostSummary;
	artifactPaths?: import("../../shared/types.ts").ArtifactPaths;
	transcriptPath?: string;
	transcriptError?: string;
	launchContractDigest?: string;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
	writerProcesses?: Array<{
		processInstanceId: string;
		kind: "pi-writer";
		attempt: number;
		closeObservedAt: number;
		exitCode: number | null;
		signal: string | null;
	}>;
	writerAttemptCount?: number;
}

export async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
	const safeLimit = Math.max(1, Math.floor(limit) || 1);
	const results: R[] = new Array(items.length);
	let next = 0;

	async function worker(_workerIndex: number): Promise<void> {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	}

	await Promise.all(Array.from({ length: Math.min(safeLimit, items.length) }, (_, wi) => worker(wi)));
	return results;
}

export const MAX_PARALLEL_CONCURRENCY = 4;
