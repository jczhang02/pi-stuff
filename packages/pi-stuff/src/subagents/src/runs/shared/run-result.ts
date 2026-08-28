/** Foreground and delivered Agent result contracts. */

import type {
	AgentContextUsage,
	ArtifactPaths,
	ResolvedToolBudget,
	ResolvedTurnBudget,
	SteerActionResult,
	SubagentResultStatus,
	SubagentRunMode,
	ToolBudgetState,
	TurnBudgetState,
	Usage,
} from "../../shared/types.ts";
import type { ResolvedSubagentCapabilityCeiling, SubagentCapabilityAudit } from "./capability-ceiling.ts";
import type { NestedRunSummary, PublicNestedRunSummary } from "./nested-contract.ts";

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
	usage: Usage;
	contextUsage?: AgentContextUsage;
	model?: string;
	/** Effective thinking level used by this foreground child, when known. */
	thinking?: string;
	attemptedModels?: string[];
	modelAttempts?: ModelAttempt[];
	error?: string;
	protocolError?: ProtocolOutputLimit;
	sessionFile?: string;
	artifactPaths?: ArtifactPaths;
	finalOutput?: string;
	launchContractDigest?: string;
	transcriptPath?: string;
	transcriptError?: string;
	children?: NestedRunSummary[];
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
}

export interface Details {
	mode: SubagentRunMode | "management";
	runId?: string;
	/** Exact effective working directory for durable foreground resume. */
	cwd?: string;
	/** Run-level context summary. "mixed" when children resolved to different modes. */
	context?: "fresh" | "fork" | "mixed";
	results: SingleResult[];
	steering?: SteerActionResult;
	asyncId?: string;
	asyncDir?: string;
	timeoutMs?: number;
	deadlineAt?: number;
	timedOut?: boolean;
	stopped?: boolean;
	turnBudget?: ResolvedTurnBudget;
	toolBudget?: ResolvedToolBudget;
	artifacts?: {
		dir: string;
		files: ArtifactPaths[];
	};
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
	launchContractDigest?: string;
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
