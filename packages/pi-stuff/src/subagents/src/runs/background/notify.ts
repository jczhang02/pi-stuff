import type { SubagentRunMode } from "../../shared/types.ts";
import type { BackgroundCompletion } from "./runner-state.ts";

/** Persisted background completion projected onto the current Agent product contract. */
export type CompletionNotification = Partial<
	Omit<BackgroundCompletion, "id" | "mode" | "state" | "results" | "nestedChildren" | "worktree">
> & {
	/** Stable idempotency key for cross-process delivery and external transports. */
	deliveryId?: string;
	id?: string | null;
	mode?: SubagentRunMode;
	state?: string;
	source?: "async" | "foreground";
	agent?: string | null;
	exitCode?: number;
	timestamp?: number;
	durationMs?: number;
	taskIndex?: number;
	totalTasks?: number;
	triggerTurn?: boolean;
	intercomDelivered?: boolean;
	launchContractDigest?: string;
	capabilityCeiling?: unknown;
	worktree?: unknown;
	results?: unknown[];
	nestedChildren?: unknown[];
};

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
