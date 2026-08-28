/** In-memory foreground and extension runtime state. */

import type { FSWatcher } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JsonInputValue } from "../../../shared/json-value.js";
import type { AsyncJobState } from "../runs/background/async-contract.ts";
import type { ResolvedSubagentCapabilityCeiling, SubagentCapabilityAudit } from "../runs/shared/capability-ceiling.ts";
import type { NestedRouteInfo, NestedRunSummary } from "../runs/shared/nested-contract.ts";
import type { SpawnBudgetGrant } from "../runs/shared/run-result.ts";
import type { SessionCompatibilityScope } from "../shared/session-identity.ts";
import type {
	ActivityState,
	AgentContextUsage,
	ArtifactDirPreference,
	ArtifactPaths,
	OutputMode,
	SubagentResultStatus,
	SubagentRunMode,
} from "../shared/types.ts";

export interface ForegroundResumeChild {
	agent: string;
	index: number;
	cwd?: string;
	description?: string | undefined;
	task?: string | undefined;
	startedAt?: number;
	context?: "fresh" | "fork";
	sessionFile?: string;
	model?: string;
	thinking?: string;
	status: SubagentResultStatus;
	/** Explicit process proof projected by the shared foreground runner. */
	crashed?: boolean;
	activityState?: ActivityState | undefined;
	lastActivityAt?: number;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number;
	tokens?: number;
	contextUsage?: AgentContextUsage;
	toolCount?: number;
	exitCode?: number;
	error?: string;
	finalOutput?: string;
	outputMode?: OutputMode;
	savedOutputPath?: string;
	outputSaveError?: string;
	artifactPaths?: ArtifactPaths;
	transcriptPath?: string;
	transcriptError?: string;
	detachedReason?: string;
	acceptance?: JsonInputValue;
	launchContractDigest?: string;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: SubagentCapabilityAudit;
	children?: NestedRunSummary[];
	updatedAt?: number;
}

export interface ForegroundResumeRun {
	runId: string;
	mode: SubagentRunMode;
	cwd: string;
	/** Exact private runtime directory used to resume root route settlement. */
	asyncDir?: string;
	/** Originating parent session. Detached exits can outlive the active session. */
	sessionId?: string;
	updatedAt: number;
	nestedRoute?: NestedRouteInfo;
	children: ForegroundResumeChild[];
}

export interface ForegroundChildControl {
	index: number;
	agent: string;
	description?: string | undefined;
	task?: string;
	startedAt: number;
	updatedAt: number;
	status?: "pending" | "running" | "complete" | "completed" | "failed" | "paused" | "stopped";
	currentActivityState?: ActivityState | undefined;
	lastActivityAt?: number | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	tokens?: number;
	contextUsage?: AgentContextUsage | undefined;
	inputTokens?: number;
	outputTokens?: number;
	model?: string;
	thinking?: string;
	toolCount?: number | undefined;
	interrupt?: () => boolean;
}

export interface ForegroundRunControl {
	runId: string;
	/** Originating parent session; required for current-session projection. */
	sessionId?: string;
	mode: SubagentRunMode;
	startedAt: number;
	updatedAt: number;
	/** Effective working directory used to resolve live transcript artifacts. */
	cwd?: string;
	currentAgent?: string;
	currentIndex?: number;
	/** Short caller-facing task/goal shown in Agent surfaces when available. */
	description?: string;
	/** Full execution task for the detail surface. */
	task?: string;
	currentActivityState?: ActivityState;
	lastActivityAt?: number;
	currentTool?: string;
	currentToolStartedAt?: number;
	currentPath?: string;
	turnCount?: number;
	tokens?: number;
	contextUsage?: AgentContextUsage;
	inputTokens?: number;
	outputTokens?: number;
	model?: string;
	thinking?: string;
	toolCount?: number;
	/** Independently tracked children for foreground parallel work and Agent inspection. */
	activeChildren?: Map<number, ForegroundChildControl>;
	nestedRoute?: NestedRouteInfo;
	nestedChildren?: NestedRunSummary[];
	interrupt?: () => boolean;
}

export interface SubagentState {
	baseCwd: string;
	currentSessionId: string | null;
	/** In-memory v1 artifact bridge proven from the active Pi session branch. */
	currentSessionScope?: SessionCompatibilityScope | null;
	/** Selected governor namespace; normally v2, legacy only for a proven live upgrade. */
	currentGovernorSessionId?: string | null;
	/** Runtime-owned artifact resolution inputs used by Agent transcript targeting. */
	artifactDirPreference?: ArtifactDirPreference;
	parentSessionFile?: string | null;
	/** Last valid parent session model observed for this session; used when continuation contexts omit ctx.model. */
	lastParentModel?: { provider: string; id: string };
	subagentSpawns?: {
		sessionId: string | null;
		count: number;
		configuredLimit?: number | null;
		granted?: number;
		grantHistory?: SpawnBudgetGrant[];
	};
	asyncJobs: Map<string, AsyncJobState>;
	/** Current-session active and recent runs retained for the Agent roster. */
	recentAgentJobs?: Map<string, AsyncJobState>;
	foregroundRuns?: Map<string, ForegroundResumeRun>;
	foregroundControls: Map<string, ForegroundRunControl>;
	lastForegroundControlId: string | null;
	pendingForegroundControlNotices?: Map<string, ReturnType<typeof setTimeout>>;
	cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
	lastUiContext: ExtensionContext | null;
	completionSeen: Map<string, number>;
	watcher: FSWatcher | null;
	watcherRestartTimer: ReturnType<typeof setTimeout> | null;
	resultFileCoalescer: {
		schedule(file: string, delayMs?: number): boolean;
		clear(): void;
	};
}
