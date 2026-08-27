import { createHash } from "node:crypto";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { CommandDialogCoordinator } from "../../../conversation-ui/index.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import { CachedToolRow } from "../../../tool-display/index.js";
import type { CompletionNotification } from "../runs/background/notify.ts";
import { sessionArtifactMatches } from "../shared/session-identity.ts";
import type { SubagentState } from "../shared/types.ts";

// Retained only so sessions written by older Pi Stuff releases still render.
const COMPLETION_MESSAGE_TYPE = "pi-stuff-agent-complete";
const COMPLETION_ENTRY_TYPE = "pi-stuff-agent-outcome";

type CompletionOutcomeStatus = "completed" | "failed" | "stopped";

interface CompletionOutcomeEntry {
	readonly version: 1;
	readonly key: string;
	readonly count: number;
	readonly status: CompletionOutcomeStatus;
	readonly durationMs?: number;
}

interface CompletionStateProjection {
	status?: string;
	state?: string;
	stopped?: boolean;
	interrupted?: boolean;
	success?: boolean;
}

export interface CompactCompletionNotifier {
	deliver(result: CompletionNotification, signal?: AbortSignal): Promise<boolean>;
	reset(entries: readonly SessionEntry[]): void;
	dispose(): void;
}

function projectCompletionState<Value>(value: Value): CompletionStateProjection {
	if (!isRuntimeObject(value) || value === null || Array.isArray(value)) return {};
	const projection: CompletionStateProjection = {};
	if ("status" in value && isRuntimeString(value.status)) projection.status = value.status;
	if ("state" in value && isRuntimeString(value.state)) projection.state = value.state;
	if ("stopped" in value && isRuntimeBoolean(value.stopped)) projection.stopped = value.stopped;
	if ("interrupted" in value && isRuntimeBoolean(value.interrupted)) projection.interrupted = value.interrupted;
	if ("success" in value && isRuntimeBoolean(value.success)) projection.success = value.success;
	return projection;
}

function completionState(value: CompletionStateProjection, fallback: CompletionNotification): CompletionOutcomeStatus {
	const explicitState = isRuntimeString(value.status)
		? value.status
		: isRuntimeString(value.state)
			? value.state
			: undefined;
	if (
		["cancelled", "detached", "paused", "stopped"].includes(explicitState ?? "") ||
		value.stopped === true ||
		value.interrupted === true
	) {
		return "stopped";
	}
	if (explicitState === "crashed" || explicitState === "failed") return "failed";
	if (isRuntimeBoolean(value.success)) return value.success ? "completed" : "failed";
	if (explicitState !== undefined) return "completed";
	if (
		["cancelled", "detached", "paused", "stopped"].includes(fallback.state ?? "") ||
		fallback.stopped === true ||
		fallback.interrupted === true
	)
		return "stopped";
	if (fallback.state === "crashed" || fallback.state === "failed") return "failed";
	return fallback.success === false ? "failed" : "completed";
}

function completionKey(result: CompletionNotification): string {
	const identity = JSON.stringify([result.sessionId, result.id, result.runId, result.taskIndex, result.timestamp]);
	return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function completionDuration(result: CompletionNotification): number | undefined {
	const duration = isRuntimeNumber(result.durationMs)
		? result.durationMs
		: isRuntimeNumber(result.startedAt) && isRuntimeNumber(result.endedAt)
			? result.endedAt - result.startedAt
			: undefined;
	return duration !== undefined && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
}

function completionOutcome(result: CompletionNotification, key: string): CompletionOutcomeEntry {
	const raw = projectCompletionState(result);
	const children = result.results?.length ? result.results.map(projectCompletionState) : [raw];
	const states = children.map((child) => completionState(child, result));
	const status = states.includes("failed") ? "failed" : states.includes("stopped") ? "stopped" : "completed";
	const durationMs = completionDuration(result);
	let outcome: CompletionOutcomeEntry = {
		version: 1,
		key,
		count: children.length,
		status,
	};
	if (durationMs !== undefined) outcome = { ...outcome, durationMs };
	return outcome;
}

function formatDuration(durationMs: number | undefined): string | undefined {
	if (durationMs === undefined) return undefined;
	const seconds = Math.max(1, Math.round(durationMs / 1_000));
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(remainder)}s`;
}

function completionOutcomeText(data: CompletionOutcomeEntry): string {
	const subject = data.count === 1 ? "Agent" : `${String(data.count)} Agents`;
	const verb = data.status === "completed" ? "finished" : data.status;
	return [`${subject} ${verb}`, formatDuration(data.durationMs), "inspect with /agents"].filter(Boolean).join(" · ");
}

function createNotifier(
	pi: Pick<ExtensionAPI, "appendEntry">,
	state: Pick<SubagentState, "currentSessionId" | "currentSessionScope">,
	coordinator: Pick<CommandDialogCoordinator, "whenIdle">,
): CompactCompletionNotifier {
	const delivered = new Set<string>();
	let disposed = false;
	return {
		async deliver(result, signal) {
			if (
				disposed ||
				result.intercomDelivered === true ||
				!isRuntimeString(result.sessionId) ||
				!sessionArtifactMatches(state.currentSessionScope, result.sessionId, result.runId ?? result.id)
			) {
				return result.intercomDelivered === true;
			}
			const key = completionKey(result);
			if (delivered.has(key)) return true;
			try {
				await Promise.race([
					coordinator.whenIdle(),
					new Promise<void>((_, reject) => {
						if (signal?.aborted) return reject(signal.reason ?? new Error("Completion delivery cancelled."));
						signal?.addEventListener(
							"abort",
							() => reject(signal.reason ?? new Error("Completion delivery cancelled.")),
							{ once: true },
						);
					}),
				]);
				const alreadyDelivered = delivered.has(key);
				if (
					signal?.aborted ||
					disposed ||
					!sessionArtifactMatches(state.currentSessionScope, result.sessionId, result.runId ?? result.id) ||
					alreadyDelivered
				)
					return alreadyDelivered;
				// Custom entries persist and render with the session but are excluded from
				// model context, so completion cannot create an unsolicited main turn.
				pi.appendEntry<CompletionOutcomeEntry>(COMPLETION_ENTRY_TYPE, completionOutcome(result, key));
				delivered.add(key);
				return true;
			} catch {
				return false;
			}
		},
		reset(entries) {
			delivered.clear();
			for (const entry of entries) {
				if (entry.type !== "custom" || entry.customType !== COMPLETION_ENTRY_TYPE) continue;
				const data = entry.data;
				if (
					isRuntimeObject(data) &&
					data !== null &&
					!Array.isArray(data) &&
					"version" in data &&
					data.version === 1 &&
					"key" in data &&
					isRuntimeString(data.key)
				) {
					delivered.add(data.key);
				}
			}
		},
		dispose() {
			disposed = true;
			delivered.clear();
		},
	};
}

/** Install durable completion delivery and legacy/current Session renderers. */
export function installCompletionHandling(
	pi: ExtensionAPI,
	state: Pick<SubagentState, "currentSessionId" | "currentSessionScope">,
	coordinator: Pick<CommandDialogCoordinator, "whenIdle">,
): CompactCompletionNotifier {
	pi.registerMessageRenderer(COMPLETION_MESSAGE_TYPE, (message, _options, theme) => {
		const content = isRuntimeString(message.content) ? message.content : "";
		return new Text(theme.fg("text", content), 0, 0);
	});
	pi.registerEntryRenderer<CompletionOutcomeEntry>(COMPLETION_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (data?.version !== 1) return undefined;
		return new CachedToolRow(theme, {
			active: false,
			expandable: false,
			hint: "",
			kind: "activity",
			outcome: data.status === "completed" ? "success" : data.status === "failed" ? "error" : "stopped",
			summary: completionOutcomeText(data),
		});
	});
	return createNotifier(pi, state, coordinator);
}
