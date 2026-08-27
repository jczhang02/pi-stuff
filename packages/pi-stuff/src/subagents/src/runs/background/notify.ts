import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import type { SubagentRunMode } from "../../shared/types.ts";

/** Persisted background completion projected onto the current Agent product contract. */
export interface CompletionNotification {
	/** Stable idempotency key for cross-process delivery and external transports. */
	deliveryId?: string;
	id?: string | null;
	runId?: string;
	/** Effective parent origin, monotonically promoted by accepted direct user steering. */
	parentRunOrigin?: AgentWorkOrigin;
	mode?: SubagentRunMode;
	source?: "async" | "foreground";
	agent?: string | null;
	success?: boolean;
	summary?: string;
	exitCode?: number;
	state?: string;
	timestamp?: number;
	durationMs?: number;
	cwd?: string;
	sessionFile?: string;
	taskIndex?: number;
	totalTasks?: number;
	sessionId?: string | null;
	triggerTurn?: boolean;
	intercomDelivered?: boolean;
	stopped?: boolean;
	timedOut?: boolean;
	interrupted?: boolean;
	startedAt?: number;
	endedAt?: number;
	asyncDir?: string;
	launchContractDigest?: string;
	capabilityCeiling?: unknown;
	worktree?: unknown;
	results?: unknown[];
	nestedChildren?: unknown[];
}

export async function deliverNotificationWithAbort(
	notifier: { deliver(notification: CompletionNotification, signal?: AbortSignal): Promise<boolean> },
	completion: CompletionNotification,
	signal: AbortSignal,
): Promise<boolean> {
	if (signal.aborted) return false;
	return Promise.race([
		notifier.deliver(completion, signal),
		new Promise<boolean>((resolve) => {
			signal.addEventListener("abort", () => resolve(false), { once: true });
		}),
	]);
}
