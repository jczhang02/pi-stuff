/** In-memory foreground and extension runtime state. */

import type { FSWatcher } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AsyncJobState } from "../runs/background/async-contract.ts";
import type { NestedRouteInfo, NestedRunSummary } from "../runs/shared/nested-contract.ts";
import type { SessionCompatibilityScope } from "../shared/session-identity.ts";
import type {
	ActivityState,
	AgentContextUsage,
	ArtifactDirPreference,
	SingleResult,
	SubagentResultStatus,
	SubagentRunMode,
} from "../shared/types.ts";

export type ForegroundResumeChild = Omit<Partial<SingleResult>, "task"> & {
	agent: string;
	index: number;
	description?: string | undefined;
	task?: string | undefined;
	startedAt?: number;
	status: SubagentResultStatus;
	activityState?: ActivityState | undefined;
	lastActivityAt?: number;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number;
	toolCount?: number;
	savedOutputPath?: string;
	updatedAt?: number;
};

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

interface ForegroundActivity {
	description?: string | undefined;
	task?: string;
	startedAt: number;
	updatedAt: number;
	currentActivityState?: ActivityState | undefined;
	lastActivityAt?: number | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	turnCount?: number | undefined;
	contextUsage?: AgentContextUsage | undefined;
	toolCount?: number | undefined;
}

export interface ForegroundChildControl extends ForegroundActivity {
	index: number;
	agent: string;
	status?: "pending" | "running" | "complete" | "completed" | "failed" | "paused" | "stopped";
	interrupt?: () => boolean;
}

export interface ForegroundRunControl extends ForegroundActivity {
	runId: string;
	/** Originating parent session; required for current-session projection. */
	sessionId?: string;
	mode: SubagentRunMode;
	/** Effective working directory used to resolve live transcript artifacts. */
	cwd?: string;
	currentAgent?: string;
	currentIndex?: number;
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
