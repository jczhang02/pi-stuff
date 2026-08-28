/** Durable background launch and status contracts. */

import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import type { JsonInputValue } from "../../../../shared/json-value.js";
import type {
	ActivityState,
	AgentContextUsage,
	ArtifactConfig,
	CostSummary,
	JsonSchemaObject,
	MaxOutputConfig,
	ResolvedControlConfig,
	ResolvedToolBudget,
	ResolvedTurnBudget,
	SteeringStatus,
	SubagentLifecycleArtifactVersion,
	SubagentRunMode,
	TokenUsage,
	ToolBudgetState,
	TurnBudgetState,
} from "../../shared/types.ts";
import type { ResolvedSubagentCapabilityCeiling, SubagentCapabilityAudit } from "../shared/capability-ceiling.ts";
import type {
	AsyncParallelGroupStatus,
	NestedRouteInfo,
	NestedRunSummary,
	NestedStepSummary,
} from "../shared/nested-contract.ts";
import type { ModelAttempt } from "../shared/run-result.ts";
import type { ProcessTerminalV1 } from "./process-terminal.ts";

export interface SteeringRecoveryDescriptor {
	version: 1;
	launchContractDigest?: string;
	sourceRunId: string;
	agent: string;
	sessionFile?: string;
	cwd: string;
	model?: string;
	fallbackModels?: string[];
	thinking?: string;
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mcpDirectTools?: string[];
	systemPrompt?: string;
	systemPromptMode: "append" | "replace";
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	skills?: string[];
	skillPath?: string[];
	agentFilePath?: string;
	completionGuard?: boolean;
	outputPath?: string;
	outputMode: "inline" | "file-only";
	structuredOutputSchema?: JsonSchemaObject;
	acceptance?: JsonInputValue;
	controlConfig?: ResolvedControlConfig;
	absoluteDeadlineAt?: number;
	initialTurnBudget?: ResolvedTurnBudget;
	initialToolBudget?: ResolvedToolBudget;
	maxSubagentDepth: number;
	maxOutput?: MaxOutputConfig;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	sessionDir?: string;
	artifactsDir?: string;
	artifactConfig?: ArtifactConfig;
}

export interface AsyncStartedEvent {
	lifecycleArtifactVersion?: SubagentLifecycleArtifactVersion;
	id?: string;
	asyncDir?: string;
	/** Parent-resolved launch directory, used as a trusted artifact root while this session is live. */
	cwd?: string;
	pid?: number;
	processStartIdentity?: string;
	sessionId?: string;
	mode?: SubagentRunMode;
	agent?: string;
	agents?: string[];
	/** Short first-child UI description. */
	description?: string;
	/** Short per-child UI descriptions. */
	descriptions?: string[];
	/** Truncated first child task retained for backwards compatibility. */
	task?: string;
	/** Bounded per-child task previews retained by the current-session detail surface. */
	tasks?: string[];
	/** Caller task, falling back to the first child task. */
	goal?: string;
	parallelGroups?: AsyncParallelGroupStatus[];
	launchContractDigest?: string;
	timeoutMs?: number;
	deadlineAt?: number;
	turnBudget?: TurnBudgetState;
	nestedRoute?: NestedRouteInfo;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
}

export interface AsyncStatusStep extends NestedStepSummary {
	/** In-memory compatibility proof recovered asynchronously from a legacy transcript. */
	legacyFinalReportComplete?: true;
	/** Resolved launch context for this child step. */
	context?: "fresh" | "fork";
	phase?: string;
	label?: string;
	outputName?: string;
	structured?: boolean;
	/** Bounded final Agent answer retained separately from recent activity. */
	finalOutput?: string | undefined;
	savedOutputPath?: string | undefined;
	currentToolArgs?: string | undefined;
	recentTools?: Array<{ tool: string; args: string; endMs: number }>;
	recentOutput?: string[] | undefined;
	durationMs?: number | undefined;
	exitCode?: number | null | undefined;
	tokens?: TokenUsage | undefined;
	contextUsage?: AgentContextUsage | undefined;
	skills?: string[];
	model?: string | undefined;
	thinking?: string | undefined;
	attemptedModels?: string[] | undefined;
	modelAttempts?: ModelAttempt[] | undefined;
	totalCost?: CostSummary | undefined;
	steering?: SteeringStatus;
	structuredOutput?: unknown;
	structuredOutputPath?: string;
	structuredOutputSchemaPath?: string;
	acceptance?: JsonInputValue;
	launchContractDigest?: string;
}

export interface AsyncStatus {
	lifecycleArtifactVersion?: SubagentLifecycleArtifactVersion;
	runId: string;
	sessionId?: string;
	/** Origin of the parent Agent run; absent only on legacy lifecycle artifacts. */
	parentRunOrigin?: AgentWorkOrigin;
	mode: SubagentRunMode;
	isNested?: boolean;
	/** Exact nested event route selected at launch; legacy statuses may omit it. */
	nestedRoute?: NestedRouteInfo | undefined;
	state: "queued" | "running" | "complete" | "failed" | "paused" | "stopped";
	error?: string | undefined;
	activityState?: ActivityState | undefined;
	lastActivityAt?: number | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	steering?: SteeringStatus | undefined;
	startedAt: number;
	endedAt?: number | undefined;
	lastUpdate?: number | undefined;
	timeoutMs?: number | undefined;
	deadlineAt?: number | undefined;
	timedOut?: boolean | undefined;
	stopped?: boolean | undefined;
	turnBudget?: TurnBudgetState | undefined;
	turnBudgetExceeded?: boolean | undefined;
	wrapUpRequested?: boolean | undefined;
	toolBudget?: ToolBudgetState | undefined;
	toolBudgetBlocked?: boolean | undefined;
	pid?: number;
	/** OS process-birth identity paired with pid to reject PID reuse. */
	processStartIdentity?: string;
	/** First escalation boundary for a proven, stale runner process. */
	runnerTerminationRequestedAt?: number;
	cwd?: string | undefined;
	currentStep?: number | undefined;
	parallelGroups?: AsyncParallelGroupStatus[];
	processTerminal?: ProcessTerminalV1 | undefined;
	launchContractDigest?: string;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
	steps?: AsyncStatusStep[] | undefined;
	sessionDir?: string | undefined;
	outputFile?: string | undefined;
	totalTokens?: TokenUsage | undefined;
	totalCost?: CostSummary;
	sessionFile?: string | undefined;
}

export type AsyncJobStep = AsyncStatusStep & {
	index?: number;
};

export interface AsyncJobState {
	asyncId: string;
	asyncDir: string;
	/** Parent-resolved launch directory retained for trusted live artifact lookup. */
	cwd?: string | undefined;
	status: "queued" | "running" | "complete" | "failed" | "paused" | "stopped";
	error?: string | undefined;
	/** Short caller-facing task/goal shown in Agent surfaces when available. */
	description?: string | undefined;
	/** Short per-child UI descriptions available before the first status poll. */
	descriptions?: string[] | undefined;
	/** Bounded per-child task previews available before the first status poll. */
	tasks?: string[] | undefined;
	pid?: number | undefined;
	sessionId?: string | undefined;
	activityState?: ActivityState | undefined;
	lastActivityAt?: number | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	steering?: SteeringStatus | undefined;
	mode?: SubagentRunMode | undefined;
	/** Run-level context summary derived from step contexts. */
	context?: "fresh" | "fork" | "mixed" | undefined;
	agents?: string[] | undefined;
	currentStep?: number | undefined;
	parallelGroups?: AsyncParallelGroupStatus[] | undefined;
	steps?: AsyncJobStep[];
	stepsTotal?: number | undefined;
	runningSteps?: number;
	completedSteps?: number;
	hasParallelGroups?: boolean | undefined;
	activeParallelGroup?: boolean | undefined;
	startedAt?: number | undefined;
	updatedAt?: number | undefined;
	timeoutMs?: number | undefined;
	deadlineAt?: number | undefined;
	timedOut?: boolean | undefined;
	stopped?: boolean | undefined;
	/** Detached runner/writer proof; pending/unknown keeps physical recovery polled. */
	processTerminal?: ProcessTerminalV1 | undefined;
	turnBudget?: TurnBudgetState | undefined;
	turnBudgetExceeded?: boolean | undefined;
	wrapUpRequested?: boolean | undefined;
	toolBudget?: ToolBudgetState | undefined;
	toolBudgetBlocked?: boolean | undefined;
	sessionDir?: string | undefined;
	outputFile?: string | undefined;
	totalTokens?: TokenUsage | undefined;
	sessionFile?: string | undefined;
	controlEventCursor?: number;
	/** A restored observer failed to stat events; first successful read starts at EOF. */
	controlEventCursorPending?: boolean | undefined;
	nestedRoute?: NestedRouteInfo | undefined;
	nestedChildren?: NestedRunSummary[];
}
