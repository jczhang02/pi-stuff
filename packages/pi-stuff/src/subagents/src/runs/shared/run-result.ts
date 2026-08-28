/** Foreground and delivered Agent result contracts. */

import type { Message } from "@earendil-works/pi-ai";
import type { JsonInputValue } from "../../../../shared/json-value.js";
import type {
	ActivityState,
	AgentContextUsage,
	AgentContract,
	ArtifactPaths,
	ControlEvent,
	CostSummary,
	EffectsProjection,
	ExecutionProjection,
	OutputMode,
	ResolvedToolBudget,
	ResolvedTurnBudget,
	SavedOutputReference,
	SteerActionResult,
	SubagentResultStatus,
	SubagentRunMode,
	ToolBudgetState,
	TurnBudgetState,
	Usage,
} from "../../shared/types.ts";
import type { ProcessTerminalV1 } from "../background/process-terminal.ts";
import type { ResolvedSubagentCapabilityCeiling, SubagentCapabilityAudit } from "./capability-ceiling.ts";
import type { NestedRunSummary, PublicNestedRunSummary } from "./nested-contract.ts";

interface TruncationResult {
	text: string;
	truncated: boolean;
	originalBytes?: number;
	originalLines?: number;
	artifactPath?: string | undefined;
}

export interface SubagentResultIntercomChild {
	agent: string;
	status: SubagentResultStatus;
	summary: string;
	index?: number;
	artifactPath?: string;
	sessionPath?: string;
	intercomTarget?: string;
	children?: PublicNestedRunSummary[];
}

export interface SubagentResultIntercomPayload {
	to: string;
	message: string;
	requestId?: string;
	runId: string;
	mode: SubagentRunMode;
	status: SubagentResultStatus;
	summary: string;
	source: "foreground" | "async";
	children: SubagentResultIntercomChild[];
	asyncId?: string;
	asyncDir?: string;
	agent?: string;
	index?: number;
	artifactPath?: string;
	sessionPath?: string;
}

export interface AgentProgress {
	index: number;
	agent: string;
	status: "pending" | "running" | "completed" | "failed" | "detached";
	activityState?: ActivityState;
	task: string;
	skills?: string[];
	lastActivityAt?: number;
	currentTool?: string;
	currentToolArgs?: string;
	currentToolStartedAt?: number;
	currentPath?: string;
	recentTools: Array<{ tool: string; args: string; endMs: number }>;
	recentOutput: string[];
	toolCount: number;
	turnCount?: number;
	tokens: number;
	/** Resolved launch model/effort and split usage for public live projections. */
	model?: string;
	thinking?: string;
	inputTokens?: number;
	outputTokens?: number;
	durationMs: number;
	error?: string;
	failedTool?: string;
}

export interface ToolCallSummary {
	text: string;
	expandedText: string;
}

interface ProgressSummary {
	toolCount: number;
	tokens: number;
	durationMs: number;
}

export interface ModelAttempt {
	model: string;
	success: boolean;
	exitCode?: number | null;
	error?: string | undefined;
	usage?: Usage;
}

export interface ProtocolOutputLimit {
	code: "protocol_output_limit";
	stream: "stdout" | "stderr";
	scope?: "aggregate" | "line";
	limitBytes: number;
	observedBytes: number;
	diagnosticPrefix: string;
	diagnosticTail: string;
}

export interface SingleResult {
	agent: string;
	task: string;
	/** Exact resolved child working directory, used by durable resume. */
	cwd?: string;
	/** Resolved launch context for this child. */
	context?: "fresh" | "fork";
	exitCode: number;
	processSignal?: string | null;
	detached?: boolean;
	detachedReason?: string;
	interrupted?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	/** Explicit process proof that the writer died from an external signal. */
	crashed?: boolean;
	turnBudget?: TurnBudgetState;
	turnBudgetExceeded?: boolean;
	wrapUpRequested?: boolean;
	contextNudgeObserved?: boolean;
	toolBudget?: ToolBudgetState;
	toolBudgetBlocked?: boolean;
	messages?: Message[];
	usage: Usage;
	contextUsage?: AgentContextUsage;
	model?: string;
	/** Effective thinking level used by this foreground child, when known. */
	thinking?: string;
	attemptedModels?: string[];
	modelAttempts?: ModelAttempt[];
	controlEvents?: ControlEvent[];
	error?: string;
	protocolError?: ProtocolOutputLimit;
	sessionFile?: string;
	skills?: string[];
	skillsWarning?: string;
	progress?: AgentProgress;
	progressSummary?: ProgressSummary;
	toolCalls?: ToolCallSummary[];
	artifactPaths?: ArtifactPaths;
	truncation?: TruncationResult;
	finalOutput?: string;
	outputMode?: OutputMode;
	savedOutputPath?: string;
	outputReference?: SavedOutputReference;
	outputSaveError?: string;
	structuredOutput?: unknown;
	structuredOutputFailed?: boolean;
	structuredOutputPath?: string;
	structuredOutputSchemaPath?: string;
	acceptance?: JsonInputValue;
	agentContract?: AgentContract;
	launchContractDigest?: string;
	execution?: ExecutionProjection;
	review?: JsonInputValue;
	effects?: EffectsProjection;
	transcriptPath?: string;
	transcriptError?: string;
	children?: NestedRunSummary[];
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
}

export interface SpawnBudgetGrant {
	sessionId: string;
	amount: number;
	grantedAt: number;
	previousLimit: number;
	limit: number;
}

export interface SpawnBudgetSnapshot {
	used: number;
	configuredLimit: number | null;
	granted: number;
	limit: number | null;
	remaining: number | null;
	grantRemaining: number | null;
	grantHistory: SpawnBudgetGrant[];
}

export interface Details {
	mode: SubagentRunMode | "management";
	runId?: string;
	/** Exact effective working directory for durable foreground resume. */
	cwd?: string;
	/** Run-level context summary. "mixed" when children resolved to different modes. */
	context?: "fresh" | "fork" | "mixed";
	results: SingleResult[];
	controlEvents?: ControlEvent[];
	steering?: SteerActionResult;
	asyncId?: string;
	asyncDir?: string;
	timeoutMs?: number;
	deadlineAt?: number;
	timedOut?: boolean;
	stopped?: boolean;
	turnBudget?: ResolvedTurnBudget;
	toolBudget?: ResolvedToolBudget;
	progress?: AgentProgress[];
	progressSummary?: ProgressSummary;
	artifacts?: {
		dir: string;
		files: ArtifactPaths[];
	};
	truncation?: {
		truncated: boolean;
		originalBytes?: number;
		originalLines?: number;
		artifactPath?: string;
	};
	// Aggregated child usage across all agents in the run
	totalChildUsage?: Usage;
	// Aggregated cost across all agents in the run
	totalCost?: CostSummary;
	spawnBudget?: SpawnBudgetSnapshot;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
	lifecycleStatus?: {
		processTerminal?: ProcessTerminalV1;
	};
	launchContractDigest?: string;
	/** Original launch contract whose persisted session is being revived. */
	sourceLaunchContractDigest?: string;
	/** Internal engine→governor startup gate; removed by the public projection. */
	lifecycleBinding?: {
		pid: number;
		/** Absent only when startup identity capture failed and recovery must stay conservative. */
		processStartIdentity?: string;
		asyncDir: string;
		acknowledgeStart?: () => void;
		abortStart?: () => boolean;
	};
}
