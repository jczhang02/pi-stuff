import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import type { PonytailMode } from "../../../../ponytail/types.js";
import type {
	AgentContextUsage,
	ArtifactConfig,
	CostSummary,
	ModelAttempt,
	NestedRouteInfo,
	ProtocolOutputLimit,
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
	/** Durable ledger namespace; may be v1 only while finishing an in-flight upgrade. */
	governorSessionId?: string;
	/** Immutable physical root-session identity used by lifecycle artifacts. */
	physicalSessionId?: string;
	/** Session id of the direct parent session for supervisor routing. */
	parentSessionId?: string;
	/** Durable governor path component; resume keeps the original logical child identity. */
	logicalAgentPathComponent?: string;
	agent: string;
	/** Short launcher-normalized label for terminal surfaces. */
	description?: string;
	/** Original delegated task before Suite-owned execution context is prepended. */
	delegatedTask?: string;
	task: string;
	/** Resolved launch context for this child. */
	context?: "fresh" | "fork";
	label?: string;
	cwd: string;
	model?: string;
	thinking?: string;
	modelCandidates?: string[];
	/** Context windows frozen from the launcher's model registry for the selected candidates. */
	modelContextWindows?: Array<{ model: string; contextWindow: number }>;
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mcpDirectTools?: string[];
	systemPrompt?: string | null;
	systemPromptMode?: "append" | "replace";
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	childBaseExtensionPath?: string;
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
	/** Persisted parent attribution used by observation-only completion UI. */
	parentRunOrigin?: AgentWorkOrigin;
	/** Effective parent Code Mode state frozen when this Agent run launches. */
	codeModeEnabled?: boolean;
	/** Effective parent Ponytail mode frozen when this Agent run launches. */
	ponytailMode?: PonytailMode;
	/** Provider carrier Tools required to preserve Code Mode under a strict child allowlist. */
	codeModeProviderTools?: string[];
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
	/** Native child→root supervisor requests; safe only for detached root runs. */
	nativeSupervisor?: boolean;
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
	/** One-way launcher gate used after durable status/registry precommit. */
	startupGateToken?: string;
	/** Timestamp shared by the launcher-precommitted and runner-loaded status. */
	startedAt?: number;
}

export interface BackgroundTaskResult {
	agent: string;
	context?: "fresh" | "fork";
	output: string;
	success: boolean;
	exitCode: number | null;
	error?: string;
	protocolError?: ProtocolOutputLimit;
	interrupted?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	preStartTerminalCause?: "pause" | "timeout" | "stop";
	turnBudget?: TurnBudgetState;
	turnBudgetExceeded?: boolean;
	wrapUpRequested?: boolean;
	contextNudgeObserved?: boolean;
	toolBudget?: ToolBudgetState;
	toolBudgetBlocked?: boolean;
	sessionFile?: string;
	intercomTarget?: string;
	model?: string;
	contextUsage?: AgentContextUsage;
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
		terminationOrigin?: "external" | "manager-final-drain" | "manager-request";
	}>;
	writerAttemptCount?: number;
}

export async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
	const safeLimit = Math.max(1, Math.floor(limit) || 1);
	const results: R[] = [];
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
export const MAX_BACKGROUND_TASKS = 20;
