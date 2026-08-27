import { createHash, randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withAgentWorkOrigin } from "../../conversation-ui/agent-run-origin.js";
import { sendSuiteAgentMessage, withDirectUserActivation } from "../../conversation-ui/index.js";
import { type GoalStatusSnapshot, getGoalStatusChannel } from "../../conversation-ui/statusline.js";
import { isJsonInputObject } from "../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { formatTokenCount, updateGoalUsage } from "./accounting.js";
import { formatError, truncateNotification } from "./errors.js";
import { appendGoalPromptMarker, extractContinuationMarker, extractGoalPromptMarker } from "./markers.js";
import {
	type ActiveGoal,
	clearLegacyPersistedGoal,
	type GoalStateEntryData,
	type PendingQueueAction,
	type SafetyPauseCause,
	serializeGoalState,
} from "./persistence.js";
import { abortCurrentTurn, formatBudget, hasPendingMessages, type StatusContext, transitionGoal } from "./policy.js";
import { buildContinuePrompt, type GoalStatus } from "./prompts.js";
import { nextToolFreeRepeatState, resetGoalSafetyEpoch } from "./safety.js";

export type { StatusContext } from "./policy.js";
export {
	abortCurrentTurn,
	blocksStaleGoalToolCalls,
	createGoal,
	editedGoalStatus,
	formatBudget,
	formatStatus,
	goalIdRejectionReason,
	goalSummary,
	hasPendingMessages,
	incrementGoal,
	isContradictoryCompletionSummary,
	isResumableGoalStatus,
	nextGoalInstance,
	stoppedStatusLabel,
	transitionGoal,
} from "./policy.js";
export { queueGoalSafetyReset, resetGoalSafetyEpoch } from "./safety.js";

import { DEFAULT_GOAL_SETTINGS, type GoalSettings, type GoalSettingsLoadIssue } from "./settings.js";

export interface ContinuationTicket {
	goalId: string;
	iteration: number;
	marker: string;
	prompt: string;
}

export interface BudgetWrapUp {
	goalId: string;
	delivered: boolean;
}

type GoalRecoveryKind = "provider_retry" | "compaction_retry";

export type GoalRunOrigin = "manual" | "automatic";

export interface GoalRecovery {
	goalId: string;
	kind: GoalRecoveryKind;
	automaticOwner: boolean;
	errorMessage?: string | undefined;
}

export interface CompletedGoalRun {
	goalId?: string | null | undefined;
	origin?: GoalRunOrigin | undefined;
	toolAttempted: boolean;
}

export interface GoalToolVisibilitySnapshot {
	activeTools: string[];
	goalToolsUnlocked: boolean;
	goalToolsHiddenByPolicy: string[];
}

export interface GoalPromptDeliveryOptions {
	readonly isCurrent?: () => boolean;
	readonly resetSafetyEpoch?: boolean;
	readonly userDriven?: boolean;
}

export interface GoalCompactionEvent {
	readonly reason?: "manual" | "overflow" | "threshold";
	readonly willRetry?: boolean;
}

interface GoalMessageCandidate {
	readonly customType?: unknown;
	readonly details?: unknown;
	readonly role?: unknown;
	readonly stopReason?: unknown;
}

const GOAL_STATE_ENTRY_TYPE = "goal-state";
export const GOAL_COMPLETE_TOOL = "goal_complete";
export const GOAL_BLOCKED_TOOL = "goal_blocked";
export const EMERGENCY_AUTOMATIC_TURN_LIMIT = 10_000;
const GOAL_TOOL_NAMES = [GOAL_COMPLETE_TOOL, GOAL_BLOCKED_TOOL] as const;

/** Canonical Goal state passed to the in-process managed-run publisher. */
export type GoalStateSnapshotStatus = GoalStatus | "cleared";

export interface GoalStateSnapshot {
	goalId: string;
	status: GoalStateSnapshotStatus;
	summary?: string;
	reason?: string;
}

/** Terminal statuses for Goal persistence and managed-run lifecycle publication. */
export function isTerminalGoalStatus(status: GoalStateSnapshotStatus): boolean {
	return status !== "active" && status !== "queued";
}

function buildGoalStateSnapshot(
	goal: ActiveGoal,
	summary: string | undefined,
	reason: string | undefined,
): GoalStateSnapshot {
	const snapshot: GoalStateSnapshot = { goalId: goal.id, status: goal.status };
	if (goal.status === "complete" && summary) snapshot.summary = summary;
	else if (goal.status !== "complete" && isTerminalGoalStatus(goal.status) && reason) {
		snapshot.reason = reason;
	}
	return snapshot;
}

interface GoalTerminalDetails {
	goalId: string;
	summary?: string;
	reason?: string;
}

export interface GoalSettingsRuntimeSnapshot {
	settings: GoalSettings;
	activeGoal?: ActiveGoal | undefined;
	queueFrozen: boolean;
	queueFreezeAwaitingSettle: boolean;
	continuationIntent?: ContinuationTicket | undefined;
	continuationDelivery?: ContinuationTicket | undefined;
	goalRecovery?: GoalRecovery | undefined;
	budgetWrapUp?: BudgetWrapUp | undefined;
	guardAbortGoalId?: string | undefined;
	staleGoalToolCallsBlocked: boolean;
	cancelledContinuationMarkers: string[];
	terminalDetails?: GoalTerminalDetails | undefined;
	toolVisibility: GoalToolVisibilitySnapshot;
}

interface PendingGoalPrompt {
	goalId: string;
	origin: GoalRunOrigin;
	resetSafetyEpoch: boolean;
}

interface PendingNonGoalInput {
	behavior: "idle" | "steer" | "followUp";
	fingerprint: string;
	origin: GoalRunOrigin;
	resetSafetyEpoch: boolean;
}

const BUDGET_WRAP_UP_MESSAGE_TYPE = "goal-budget-wrap-up";
export const GOAL_PROMPT_MESSAGE_TYPE = "pi-stuff-goal-prompt";
export const GOAL_CONTEXT_MESSAGE_TYPE = "pi-stuff-goal-context";
const BUDGET_WRAP_UP_PROMPT =
	"The active /goal token budget is exhausted. Stop substantive work and do not call substantive tools. Summarize progress, verified results, remaining work, and blockers concisely. Treat completion as unproven. Do not call goal_complete unless authoritative, requirement-by-requirement evidence already proves every requirement is complete. Weak, indirect, or missing evidence is not enough. Budget exhaustion is not completion.";
// One instance belongs to one extension factory. It owns all mutable session state
// and the cross-cutting invariants used by command and lifecycle orchestration.
// Keep this state machine cohesive despite its size: prompt ownership, continuation,
// budget, safety, and tool-policy transitions share ordering-sensitive invariants.
// Cohesion justification: Goal transitions, continuation ownership, queue state, and budget/retry
// recovery share one generation-guarded runtime; separating them would duplicate stale-turn and
// persistence invariants across modules.
export class GoalRuntime {
	settings: GoalSettings = DEFAULT_GOAL_SETTINGS;
	settingsLoadIssue: GoalSettingsLoadIssue | undefined;
	activeGoal: ActiveGoal | undefined;
	/** Terminal details captured for the matching persisted-state snapshot. */
	private terminalDetails: GoalTerminalDetails | undefined;
	private goalStateSink: ((snapshot: GoalStateSnapshot) => void) | undefined;
	private deferredSessionStartState: GoalStateEntryData | undefined;
	private sessionStartReadOnly = false;
	queuedGoals: ActiveGoal[] = [];
	pendingQueueAction: PendingQueueAction | undefined;
	queueFrozen = false;
	queueFreezeAwaitingSettle = false;
	completionStatusTimer: NodeJS.Timeout | undefined;
	continuationIntent: ContinuationTicket | undefined;
	continuationDelivery: ContinuationTicket | undefined;
	goalRecovery: GoalRecovery | undefined;
	budgetWrapUp: BudgetWrapUp | undefined;
	/** `null` marks a run that must not be charged to the active goal. */
	agentRunGoalId: string | null | undefined;
	agentRunOrigin: GoalRunOrigin | undefined;
	agentRunToolAttempted = false;
	guardAbortGoalId: string | undefined;
	staleGoalToolCallsBlocked = false;
	/** Once true, goal tools stay in the active set for this runtime (prompt-cache stable). */
	goalToolsUnlocked = false;
	/** Exact lazy goal tools this runtime removed and may restore on a mode change. */
	goalToolsHiddenByPolicy = new Set<string>();
	// Pi's delivery queues are not capped. These mirrors must retain every
	// unresolved marker until delivery or an explicit lifecycle clear; evicting an
	// older entry can silently transfer Goal ownership or safety policy.
	pendingGoalPromptMarkers = new Map<string, PendingGoalPrompt>();
	claimedGoalPromptMarkers = new Map<string, PendingGoalPrompt>();
	cancelledContinuationMarkers = new Set<string>();
	claimedContinuationMarkers = new Set<string>();
	pendingNonGoalInputs: PendingNonGoalInput[] = [];
	menuGeneration = 0;
	menuController = new AbortController();

	readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	setGoalStateSink(sink: ((snapshot: GoalStateSnapshot) => void) | undefined) {
		this.goalStateSink = sink;
	}

	beginReadOnlySessionStart() {
		this.sessionStartReadOnly = true;
		this.deferredSessionStartState = undefined;
	}

	endReadOnlySessionStart() {
		this.sessionStartReadOnly = false;
	}

	flushDeferredSessionStartState() {
		const state = this.deferredSessionStartState;
		if (!state || this.sessionStartReadOnly) return;
		this.deferredSessionStartState = undefined;
		this.pi.appendEntry(GOAL_STATE_ENTRY_TYPE, state);
	}

	private publishGoalState(snapshot: GoalStateSnapshot) {
		try {
			this.goalStateSink?.(snapshot);
		} catch {
			// Protocol publication must not interrupt canonical Goal persistence.
		}
	}

	replaceMenuSession() {
		this.menuGeneration += 1;
		this.menuController.abort(new DOMException("Goal session replaced", "AbortError"));
		this.menuController = new AbortController();
	}

	closeMenuSession() {
		this.menuGeneration += 1;
		this.menuController.abort(new DOMException("Goal session shut down", "AbortError"));
	}

	canRecordGoalUsage(goalId?: string) {
		return (
			this.agentRunGoalId !== null &&
			(goalId === undefined || this.agentRunGoalId === undefined || this.agentRunGoalId === goalId) &&
			!(this.pendingQueueAction?.kind === "prioritize" && this.pendingQueueAction.displacedUsageFinalized === true)
		);
	}

	hasActiveBudgetWrapUp() {
		return (
			this.activeGoal?.status === "budget_limited" &&
			this.budgetWrapUp?.goalId === this.activeGoal.id &&
			this.budgetWrapUp.delivered
		);
	}

	hasActiveGoalRecovery() {
		return Boolean(this.activeGoal && this.goalRecovery?.goalId === this.activeGoal.id);
	}

	beginAgentRun(goalId: string | null | undefined, origin: GoalRunOrigin | undefined) {
		this.agentRunGoalId = goalId;
		this.agentRunOrigin = origin;
		this.agentRunToolAttempted = false;
	}

	beginRecoveryRunIfNeeded() {
		if (this.agentRunGoalId !== undefined || !this.activeGoal) return;
		const recovery = this.goalRecovery;
		if (!recovery || recovery.goalId !== this.activeGoal.id) return;
		this.beginAgentRun(recovery.goalId, recovery.automaticOwner ? "automatic" : "manual");
	}

	markAgentToolAttempted() {
		if (this.agentRunGoalId !== undefined) this.agentRunToolAttempted = true;
	}

	finishAgentRun(): CompletedGoalRun {
		const run = {
			goalId: this.agentRunGoalId,
			origin: this.agentRunOrigin,
			toolAttempted: this.agentRunToolAttempted,
		};
		this.clearAgentRun();
		return run;
	}

	clearAgentRun() {
		this.agentRunGoalId = undefined;
		this.agentRunOrigin = undefined;
		this.agentRunToolAttempted = false;
	}

	reclassifyAgentRunAsManual() {
		if (this.agentRunGoalId !== undefined) this.agentRunOrigin = "manual";
	}

	isAutomaticRunForGoal(goalId: string) {
		return this.agentRunGoalId === goalId && this.agentRunOrigin === "automatic";
	}

	recordGoalUsage(goal: ActiveGoal, ctx: StatusContext, checkpointActiveTime = goal.status === "active") {
		if (!this.canRecordGoalUsage(goal.id)) return false;
		updateGoalUsage(goal, ctx, checkpointActiveTime);
		return true;
	}

	requestContinuation(goal: ActiveGoal) {
		if (this.hasContinuationWorkForGoal(goal.id)) return false;
		const marker = continuationMarker(goal);
		this.continuationIntent = {
			goalId: goal.id,
			iteration: goal.iteration,
			marker,
			prompt: buildContinuePrompt(goal, marker),
		};
		return true;
	}

	async dispatchContinuationIfSettled(ctx: StatusContext): Promise<boolean> {
		const intent = this.continuationIntent;
		if (!intent) return false;
		if (this.activeGoal?.status === "active" && !this.goalToolsAvailable()) {
			this.pauseGoalForUnavailableTools(ctx);
			return false;
		}
		if (!this.activeGoal || this.activeGoal.id !== intent.goalId || this.activeGoal.status !== "active") {
			this.continuationIntent = undefined;
			return false;
		}
		if (this.enforceAutomaticTurnLimit(ctx, false) || this.enforceNoProgressLimit(ctx)) {
			return false;
		}
		if (ctx.isIdle?.() !== true || hasPendingMessages(ctx)) return false;

		this.continuationIntent = undefined;
		this.continuationDelivery = intent;
		try {
			const delivered = await sendHiddenGoalPrompt(this.pi, intent.prompt);
			if (delivered) return true;
			if (this.continuationDelivery?.marker === intent.marker) {
				this.continuationDelivery = undefined;
			}
			return false;
		} catch (error) {
			if (this.continuationDelivery?.marker === intent.marker) {
				this.continuationDelivery = undefined;
			}
			if (this.activeGoal?.id === intent.goalId && this.activeGoal.status === "active") {
				this.continuationIntent = intent;
			}
			ctx.ui.notify(`Goal prompt failed: ${formatError(error)}`, "error");
			return false;
		}
	}

	hasContinuationWorkForGoal(goalId: string) {
		return this.continuationIntent?.goalId === goalId || this.continuationDelivery?.goalId === goalId;
	}

	updateStatus(_ctx: StatusContext, goal: ActiveGoal) {
		this.clearCompletionStatusTimer();
		this.publishPresentationStatus(goal);
	}

	publishPresentationStatus(goal: ActiveGoal | undefined) {
		if (!goal || goal.status === "queued") {
			this.clearPresentationStatus();
			return;
		}
		const snapshot: GoalStatusSnapshot = {
			status: goal.status,
			timeUsedSeconds: goal.timeUsedSeconds,
			tokensUsed: goal.tokensUsed,
		};
		if (goal.activeStartedAt !== undefined) Object.assign(snapshot, { activeStartedAt: goal.activeStartedAt });
		if (goal.tokenBudget !== undefined) Object.assign(snapshot, { tokenBudget: goal.tokenBudget });
		getGoalStatusChannel(this.pi).publish(snapshot);
	}

	clearPresentationStatus() {
		getGoalStatusChannel(this.pi).clear();
	}

	blockStaleGoalToolCalls() {
		this.staleGoalToolCallsBlocked = true;
	}

	clearStaleGoalToolCallBlock() {
		this.staleGoalToolCallsBlocked = false;
	}

	clearGoalRecovery() {
		this.goalRecovery = undefined;
	}

	clearBudgetWrapUp() {
		this.budgetWrapUp = undefined;
	}

	setCompletionSummary(goalId: string, summary: string) {
		this.terminalDetails = { goalId, summary };
	}

	setTerminalReason(goalId: string, reason: string) {
		this.terminalDetails = { goalId, reason };
	}

	clearTerminalDetails() {
		this.terminalDetails = undefined;
	}

	isActiveBudgetWrapUpMessage(message: GoalMessageCandidate | null | undefined) {
		if (!message || !isRuntimeObject(message)) return false;
		const details = isJsonInputObject(message.details) ? message.details : undefined;
		return (
			message.role === "custom" &&
			message.customType === BUDGET_WRAP_UP_MESSAGE_TYPE &&
			isRuntimeString(details?.["goalId"]) &&
			details["goalId"] === this.budgetWrapUp?.goalId &&
			details["goalId"] === this.activeGoal?.id
		);
	}

	keepBudgetWrapUpMessage(message: GoalMessageCandidate | null | undefined) {
		if (!message || !isRuntimeObject(message)) return true;
		if (message.role !== "custom" || message.customType !== BUDGET_WRAP_UP_MESSAGE_TYPE) {
			return true;
		}
		return this.isActiveBudgetWrapUpMessage(message);
	}

	queueBudgetWrapUp(ctx: StatusContext, goal: ActiveGoal) {
		if (!this.budgetWrapUp || this.budgetWrapUp.goalId !== goal.id) {
			this.budgetWrapUp = { goalId: goal.id, delivered: false };
		}
		if (this.budgetWrapUp.delivered) return true;
		const pendingWrapUp = this.budgetWrapUp;
		pendingWrapUp.delivered = true;
		const isCurrent = () =>
			this.budgetWrapUp === pendingWrapUp &&
			this.activeGoal?.id === goal.id &&
			this.activeGoal.status === "budget_limited";
		void sendSuiteAgentMessage(
			this.pi,
			withAgentWorkOrigin(
				{
					customType: BUDGET_WRAP_UP_MESSAGE_TYPE,
					content: BUDGET_WRAP_UP_PROMPT,
					display: true,
					details: { goalId: goal.id },
				},
				"automatic",
			),
			{ deliverAs: "steer" },
			isCurrent,
		).then(
			(accepted) => {
				if (!accepted && this.budgetWrapUp === pendingWrapUp) pendingWrapUp.delivered = false;
			},
			(error) => {
				if (!isCurrent()) return;
				pendingWrapUp.delivered = false;
				ctx.ui.notify(`Goal budget wrap-up failed: ${formatError(error)}`, "error");
			},
		);
		return true;
	}

	limitActiveGoalForBudget(ctx: StatusContext, sendWrapUp: boolean) {
		const goal = this.activeGoal;
		if (goal?.status !== "active" || goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget) {
			return false;
		}

		this.cancelContinuationWork();
		this.clearGoalRecoveryForGoal(goal.id);
		this.clearBudgetWrapUp();
		this.activeGoal = transitionGoal(goal, "budget_limited");
		this.setTerminalReason(this.activeGoal.id, `token budget reached (${formatBudget(this.activeGoal)})`);
		this.persistGoal(this.activeGoal);
		this.updateStatus(ctx, this.activeGoal);
		ctx.ui.notify(`Goal token budget reached: ${formatBudget(this.activeGoal)}`, "warning");
		if (sendWrapUp) this.queueBudgetWrapUp(ctx, this.activeGoal);
		return true;
	}

	recordAutomaticTurn(ctx: StatusContext, message: GoalMessageCandidate | null | undefined) {
		const goal = this.activeGoal;
		if (goal?.status !== "active" || !this.isAutomaticRunForGoal(goal.id)) return false;
		if (message?.role === "assistant" && message.stopReason === "aborted") return false;
		goal.automaticModelTurns = Math.min(Number.MAX_SAFE_INTEGER, goal.automaticModelTurns + 1);
		this.recordGoalUsage(goal, ctx);
		this.persistGoal(goal);
		this.updateStatus(ctx, goal);
		// Terminal errors need agent_end classification before a safety pause can
		// choose between usage_limited, blocked, or retryable cleanup.
		if (message?.role === "assistant" && message.stopReason === "error") return false;
		return this.enforceAutomaticTurnLimit(ctx, true);
	}

	recordAutomaticRunProgress(
		ctx: StatusContext,
		goalId: string,
		messages: readonly unknown[],
		toolAttempted: boolean,
	) {
		const goal = this.activeGoal;
		if (goal?.id !== goalId || goal.status !== "active") return false;
		const next = nextToolFreeRepeatState(goal, messages, toolAttempted);
		goal.toolFreeRepeatCount = next.toolFreeRepeatCount;
		goal.lastToolFreeOutputFingerprint = next.lastToolFreeOutputFingerprint;
		this.persistGoal(goal);
		this.updateStatus(ctx, goal);
		const limit = this.settings.continuationLimits.noProgressTurns;
		if (limit === null || goal.toolFreeRepeatCount < limit) return false;
		return this.pauseGoalForSafety(ctx, "no_progress", false);
	}

	enforceAutomaticTurnLimit(ctx: StatusContext, abortTurn: boolean) {
		const goal = this.activeGoal;
		const configuredLimit = this.settings.continuationLimits.automaticTurns;
		const limit = Math.min(configuredLimit ?? Number.POSITIVE_INFINITY, EMERGENCY_AUTOMATIC_TURN_LIMIT);
		if (goal?.status !== "active" || goal.automaticModelTurns < limit) {
			return false;
		}
		return this.pauseGoalForSafety(
			ctx,
			configuredLimit === null || configuredLimit > EMERGENCY_AUTOMATIC_TURN_LIMIT
				? "runaway_backstop"
				: "continuation_limit",
			abortTurn,
		);
	}

	enforceNoProgressLimit(ctx: StatusContext, abortTurn = false) {
		const goal = this.activeGoal;
		const limit = this.settings.continuationLimits.noProgressTurns;
		if (goal?.status !== "active" || limit === null || goal.toolFreeRepeatCount < limit) {
			return false;
		}
		return this.pauseGoalForSafety(ctx, "no_progress", abortTurn);
	}

	pauseGoalForSafety(ctx: StatusContext, cause: SafetyPauseCause, abortTurn: boolean) {
		const goal = this.activeGoal;
		if (goal?.status !== "active") return false;
		this.cancelContinuationWork();
		this.clearGoalRecoveryForGoal(goal.id);
		this.clearBudgetWrapUp();
		this.blockStaleGoalToolCalls();
		if (abortTurn) {
			this.guardAbortGoalId = goal.id;
			abortCurrentTurn(ctx);
		}
		this.activeGoal = transitionGoal({ ...goal, safetyPauseCause: cause }, "paused");
		const count =
			cause === "continuation_limit" || cause === "runaway_backstop"
				? `${this.activeGoal.automaticModelTurns} automatic model responses`
				: `no progress across ${this.activeGoal.toolFreeRepeatCount} automatic runs`;
		this.setTerminalReason(
			this.activeGoal.id,
			`${cause} (${count}; ${formatTokenCount(this.activeGoal.tokensUsed)} tokens)`,
		);
		this.persistGoal(this.activeGoal);
		this.updateStatus(ctx, this.activeGoal);
		ctx.ui.notify(
			`Goal paused: ${count}; ${formatTokenCount(this.activeGoal.tokensUsed)} cumulative tokens. Run /goal resume to continue.`,
			"warning",
		);
		return true;
	}

	resetActiveSafetyEpoch(ctx: StatusContext) {
		const goal = this.activeGoal;
		if (goal?.status !== "active") return false;
		this.activeGoal = resetGoalSafetyEpoch(goal);
		this.reclassifyAgentRunAsManual();
		this.persistGoal(this.activeGoal);
		this.updateStatus(ctx, this.activeGoal);
		return true;
	}

	finalizeSettledRecovery(ctx: StatusContext) {
		const recovery = this.goalRecovery;
		if (!recovery) return false;
		this.goalRecovery = undefined;
		const goal = this.activeGoal;
		if (goal?.id !== recovery.goalId || goal.status !== "active") return false;
		this.cancelContinuationWork();
		this.clearBudgetWrapUp();
		const details = recovery.errorMessage ? `: ${truncateNotification(recovery.errorMessage)}` : "";
		this.clearStaleGoalToolCallBlock();
		this.persistGoal(goal);
		this.updateStatus(ctx, goal);
		ctx.ui.notify(
			`Goal provider retry was exhausted${details}. The Goal remains active and will continue from the next settled boundary.`,
			"warning",
		);
		this.requestContinuation(goal);
		return true;
	}

	clearSettledSafetyTracking() {
		this.guardAbortGoalId = undefined;
		this.pendingNonGoalInputs = [];
		this.claimedGoalPromptMarkers.clear();
		this.claimedContinuationMarkers.clear();
		this.clearAgentRun();
	}

	clearGoalRecoveryForGoal(goalId: string) {
		if (this.goalRecovery?.goalId === goalId) this.goalRecovery = undefined;
	}

	isPiOwnedCompactionRetry(event: GoalCompactionEvent, goalId: string) {
		if (event.willRetry === true) return true;
		return (
			this.goalRecovery?.goalId === goalId &&
			this.goalRecovery.kind === "compaction_retry" &&
			(event.reason === undefined || event.reason === "overflow")
		);
	}

	clearContinuationTracking() {
		this.continuationIntent = undefined;
		this.continuationDelivery = undefined;
		this.cancelledContinuationMarkers.clear();
		this.claimedContinuationMarkers.clear();
	}

	clearPendingGoalPrompts() {
		this.pendingGoalPromptMarkers.clear();
		this.claimedGoalPromptMarkers.clear();
		this.pendingNonGoalInputs = [];
	}

	async sendOwnedGoalPrompt(
		ctx: StatusContext,
		goalId: string,
		prompt: string,
		options: GoalPromptDeliveryOptions = {},
	) {
		const { isCurrent, resetSafetyEpoch = true, userDriven = false } = options;
		const ownsPrompt = () =>
			this.activeGoal?.id === goalId && this.activeGoal.status === "active" && (isCurrent?.() ?? true);
		const pending = this.rememberPendingGoalPrompt(
			goalId,
			prompt,
			resetSafetyEpoch,
			userDriven ? "manual" : "automatic",
		);
		const sent = await sendPrompt(this.pi, ctx, pending.prompt, userDriven, ownsPrompt);
		if (!sent || !ownsPrompt()) {
			this.pendingGoalPromptMarkers.delete(pending.marker);
			return false;
		}
		return true;
	}

	cancelContinuationWork() {
		if (this.continuationDelivery) {
			this.rememberCancelledContinuationMarker(this.continuationDelivery.marker);
		}
		this.continuationIntent = undefined;
		this.continuationDelivery = undefined;
	}

	consumeCancelledContinuationPrompt(prompt: string) {
		const marker = extractContinuationMarker(prompt);
		return marker ? this.cancelledContinuationMarkers.delete(marker) : false;
	}

	hasPendingOwnedGoalPrompt(prompt: string) {
		const marker = extractGoalPromptMarker(prompt);
		return marker ? this.pendingGoalPromptMarkers.has(marker) : false;
	}

	hasOwnedPromptBoundary(prompt: string) {
		const goalMarker = extractGoalPromptMarker(prompt);
		if (
			goalMarker &&
			(this.pendingGoalPromptMarkers.has(goalMarker) || this.claimedGoalPromptMarkers.has(goalMarker))
		) {
			return true;
		}
		const continuationMarker = extractContinuationMarker(prompt);
		return Boolean(
			continuationMarker &&
				(this.continuationDelivery?.marker === continuationMarker ||
					this.claimedContinuationMarkers.has(continuationMarker)),
		);
	}

	consumeStaleOwnedGoalPrompt(prompt: string) {
		const marker = extractGoalPromptMarker(prompt);
		if (!marker) return false;
		const pending = this.pendingGoalPromptMarkers.get(marker);
		if (!pending) return false;
		if (
			!this.queueFrozen &&
			!this.pendingQueueAction &&
			this.activeGoal?.id === pending.goalId &&
			this.activeGoal.status === "active"
		) {
			return false;
		}
		this.pendingGoalPromptMarkers.delete(marker);
		return true;
	}

	noteQueuedNonGoalInput(
		prompt: string,
		behavior: "idle" | "steer" | "followUp",
		origin: GoalRunOrigin,
		resetSafetyEpoch = origin === "manual",
	) {
		// A new idle prompt starts a new Host run. Any older mirror belongs to an
		// input attempt that was handled or rejected before delivery.
		if (behavior === "idle") this.pendingNonGoalInputs = [];
		this.pendingNonGoalInputs.push({
			behavior,
			fingerprint: inputFingerprint(prompt),
			origin,
			resetSafetyEpoch,
		});
	}

	discardQueuedNonGoalInputs(behaviors: readonly ("idle" | "steer" | "followUp")[]) {
		this.pendingNonGoalInputs = this.pendingNonGoalInputs.filter((pending) => !behaviors.includes(pending.behavior));
	}

	consumeQueuedNonGoalInput(
		prompt: string,
		allowDeliveryFallback = true,
		behaviors: readonly ("idle" | "steer" | "followUp")[] = ["steer", "followUp"],
	) {
		if (!isRuntimeString(prompt)) return undefined;
		const fingerprint = inputFingerprint(prompt);
		const candidates = this.pendingNonGoalInputs.filter((pending) => behaviors.includes(pending.behavior));
		if (
			new Set(candidates.map((pending) => pending.origin)).size > 1 ||
			new Set(candidates.map((pending) => pending.resetSafetyEpoch)).size > 1
		) {
			// A separately loaded Extension can handle or transform after this Package's
			// input handler. Mixed user/automatic mirrors cannot be correlated safely,
			// even across steer/follow-up classes or an exact-text collision.
			const behavior = (["steer", "followUp", "idle"] as const).find((candidate) =>
				candidates.some((pending) => pending.behavior === candidate),
			);
			this.pendingNonGoalInputs = [];
			return behavior ? { behavior, fingerprint, origin: "automatic" as const, resetSafetyEpoch: false } : undefined;
		}
		// Pi drains steers before follow-ups. Select that delivery class before
		// comparing text: a Skill may expand one queued prompt into text that happens
		// to equal a later prompt in the other class.
		for (const behavior of ["steer", "followUp", "idle"] as const) {
			if (!behaviors.includes(behavior)) continue;
			const firstIndex = this.pendingNonGoalInputs.findIndex((pending) => pending.behavior === behavior);
			if (firstIndex < 0) continue;
			const exactIndex = this.pendingNonGoalInputs.findIndex(
				(pending) => pending.behavior === behavior && pending.fingerprint === fingerprint,
			);
			if (exactIndex >= 0) return this.pendingNonGoalInputs.splice(exactIndex, 1)[0];
			// An owned Goal/recovery boundary must not consume a transformed non-Goal
			// input. It also must not skip a higher-priority steer to claim a follow-up.
			if (!allowDeliveryFallback) return undefined;
			return this.pendingNonGoalInputs.splice(firstIndex, 1)[0];
		}
		return undefined;
	}

	markContinuationStarted(prompt: string) {
		const marker = extractContinuationMarker(prompt);
		if (!marker) {
			// A user, retry, or another extension started newer work. Cancel both an
			// unsent intent and a delivery that may have lost the non-atomic idle race;
			// the newer work's agent_end will record a fresh intent.
			this.cancelContinuationWork();
			return undefined;
		}
		if (this.continuationDelivery?.marker === marker) {
			const goalId = this.continuationDelivery.goalId;
			this.continuationDelivery = undefined;
			this.rememberClaimedContinuationMarker(marker);
			return goalId;
		}
		if (this.claimedContinuationMarkers.has(marker)) return marker.split(":", 1)[0];
		// Marker syntax is not authority. User text or another Extension may contain
		// a lookalike comment; only an exact outstanding or already-claimed ticket
		// belongs to this Goal runtime.
		this.cancelContinuationWork();
		return undefined;
	}

	persistGoal(goal: ActiveGoal) {
		if (!isTerminalGoalStatus(goal.status) || this.terminalDetails?.goalId !== goal.id) {
			this.clearTerminalDetails();
		}
		this.persistGoalState(serializeGoalState(goal, this.queuedGoals, this.pendingQueueAction));
		this.publishGoalState(buildGoalStateSnapshot(goal, this.terminalDetails?.summary, this.terminalDetails?.reason));
		// A synchronous managed-run listener may pause, clear, or replace the Goal
		// while the state event is being published. Never let the older transition
		// overwrite the presentation snapshot produced by that nested mutation.
		if (this.activeGoal?.id === goal.id && this.activeGoal.status === goal.status) {
			this.publishPresentationStatus(goal);
		}
	}

	async clearPersistedGoal(cwd: string, clearedGoal?: ActiveGoal, reason = "goal cleared"): Promise<void> {
		this.persistGoalState(serializeGoalState(undefined, [], undefined));
		if (clearedGoal) {
			this.publishGoalState({
				goalId: clearedGoal.id,
				status: "cleared",
				reason,
			});
		}
		this.clearTerminalDetails();
		this.clearPresentationStatus();
		await clearLegacyPersistedGoal(cwd);
	}

	private persistGoalState(state: GoalStateEntryData) {
		if (this.sessionStartReadOnly) {
			this.deferredSessionStartState = state;
			return;
		}
		this.deferredSessionStartState = undefined;
		this.pi.appendEntry(GOAL_STATE_ENTRY_TYPE, state);
	}

	async clearActiveGoal(ctx: StatusContext, reason = "goal cleared"): Promise<void> {
		const clearedGoal = this.activeGoal;
		this.cancelContinuationWork();
		this.clearGoalRecovery();
		this.clearBudgetWrapUp();
		this.clearStaleGoalToolCallBlock();
		this.activeGoal = undefined;
		this.queuedGoals = [];
		this.pendingQueueAction = undefined;
		this.queueFrozen = false;
		this.queueFreezeAwaitingSettle = false;
		await this.clearPersistedGoal(ctx.cwd, clearedGoal, reason);
		// Do not clear goalToolsUnlocked: after first activation, keep tools visible
		// for the rest of this extension runtime to avoid repeated goal-tool schema
		// churn within the same runtime.
	}

	isGoalToolName(name: string) {
		return GOAL_TOOL_NAMES.some((toolName) => toolName === name);
	}

	goalToolsAvailable() {
		const active = new Set(this.pi.getActiveTools());
		return GOAL_TOOL_NAMES.every((name) => active.has(name));
	}

	hideGoalToolsIfLocked() {
		if (this.goalToolsUnlocked) return;
		const active = this.pi.getActiveTools();
		const hidden = active.filter((name) => this.isGoalToolName(name));
		if (hidden.length === 0) return;
		this.pi.setActiveTools(active.filter((name) => !this.isGoalToolName(name)));
		for (const name of hidden) this.goalToolsHiddenByPolicy.add(name);
	}

	restoreGoalToolsHiddenByPolicy() {
		const activeBeforeRestore = this.pi.getActiveTools();
		const activeSet = new Set(activeBeforeRestore);
		const missingOwnedTools = [...this.goalToolsHiddenByPolicy].filter((name) => !activeSet.has(name));
		if (missingOwnedTools.length === 0) {
			this.goalToolsHiddenByPolicy.clear();
			return;
		}
		try {
			this.pi.setActiveTools([...activeBeforeRestore, ...missingOwnedTools]);
			const restored = new Set(this.pi.getActiveTools());
			if (missingOwnedTools.some((name) => !restored.has(name))) {
				throw new Error("the active tool policy rejected a previously hidden goal tool");
			}
			this.goalToolsHiddenByPolicy.clear();
		} catch (error) {
			this.pi.setActiveTools(activeBeforeRestore);
			throw error;
		}
	}

	assertGoalToolsAvailable() {
		if (this.goalToolsAvailable()) return;
		throw new Error(
			"goal_complete and goal_blocked are unavailable; include them in the active tool allowlist or leave the restrictive tool mode first.",
		);
	}

	ensureGoalToolsVisible() {
		const active = this.pi.getActiveTools();
		const activeSet = new Set(active);
		const missing = GOAL_TOOL_NAMES.filter((name) => !activeSet.has(name));
		if (missing.length > 0) this.pi.setActiveTools([...active, ...missing]);
		this.assertGoalToolsAvailable();
	}

	prepareGoalToolsForActivation(ctx: StatusContext) {
		if (this.settings.toolVisibility === "after-first-goal") {
			if (!this.goalToolsAvailable() && ctx.isIdle?.() !== true) {
				throw new Error("wait until Pi is idle before revealing the goal tools");
			}
			this.revealGoalTools();
			return;
		}
		this.assertGoalToolsAvailable();
	}

	/** Mark lazy tools permanently desired for this runtime and make them active now. */
	revealGoalTools() {
		const activeBeforeReveal = this.pi.getActiveTools();
		const wasUnlocked = this.goalToolsUnlocked;
		try {
			this.ensureGoalToolsVisible();
			this.goalToolsUnlocked = true;
			this.goalToolsHiddenByPolicy.clear();
		} catch (error) {
			this.pi.setActiveTools(activeBeforeReveal);
			this.goalToolsUnlocked = wasUnlocked;
			throw error;
		}
	}

	snapshotGoalToolVisibility(): GoalToolVisibilitySnapshot {
		return {
			activeTools: this.pi.getActiveTools(),
			goalToolsUnlocked: this.goalToolsUnlocked,
			goalToolsHiddenByPolicy: [...this.goalToolsHiddenByPolicy],
		};
	}

	snapshotSettingsApplicationState(): GoalSettingsRuntimeSnapshot {
		return {
			settings: structuredClone(this.settings),
			activeGoal: this.activeGoal ? structuredClone(this.activeGoal) : undefined,
			queueFrozen: this.queueFrozen,
			queueFreezeAwaitingSettle: this.queueFreezeAwaitingSettle,
			continuationIntent: this.continuationIntent ? structuredClone(this.continuationIntent) : undefined,
			continuationDelivery: this.continuationDelivery ? structuredClone(this.continuationDelivery) : undefined,
			goalRecovery: this.goalRecovery ? structuredClone(this.goalRecovery) : undefined,
			budgetWrapUp: this.budgetWrapUp ? structuredClone(this.budgetWrapUp) : undefined,
			guardAbortGoalId: this.guardAbortGoalId,
			staleGoalToolCallsBlocked: this.staleGoalToolCallsBlocked,
			cancelledContinuationMarkers: [...this.cancelledContinuationMarkers],
			terminalDetails: this.terminalDetails ? structuredClone(this.terminalDetails) : undefined,
			toolVisibility: this.snapshotGoalToolVisibility(),
		};
	}

	restoreSettingsApplicationState(snapshot: GoalSettingsRuntimeSnapshot) {
		this.settings = structuredClone(snapshot.settings);
		this.activeGoal = snapshot.activeGoal ? structuredClone(snapshot.activeGoal) : undefined;
		this.queueFrozen = snapshot.queueFrozen;
		this.queueFreezeAwaitingSettle = snapshot.queueFreezeAwaitingSettle;
		this.continuationIntent = snapshot.continuationIntent ? structuredClone(snapshot.continuationIntent) : undefined;
		this.continuationDelivery = snapshot.continuationDelivery
			? structuredClone(snapshot.continuationDelivery)
			: undefined;
		this.goalRecovery = snapshot.goalRecovery ? structuredClone(snapshot.goalRecovery) : undefined;
		this.budgetWrapUp = snapshot.budgetWrapUp ? structuredClone(snapshot.budgetWrapUp) : undefined;
		this.guardAbortGoalId = snapshot.guardAbortGoalId;
		this.staleGoalToolCallsBlocked = snapshot.staleGoalToolCallsBlocked;
		this.cancelledContinuationMarkers = new Set(snapshot.cancelledContinuationMarkers);
		this.terminalDetails = snapshot.terminalDetails ? structuredClone(snapshot.terminalDetails) : undefined;
		this.restoreGoalToolVisibility(snapshot.toolVisibility);
	}

	restoreGoalToolVisibility(snapshot: GoalToolVisibilitySnapshot) {
		this.pi.setActiveTools(snapshot.activeTools);
		this.goalToolsUnlocked = snapshot.goalToolsUnlocked;
		this.goalToolsHiddenByPolicy.clear();
		for (const name of snapshot.goalToolsHiddenByPolicy) {
			this.goalToolsHiddenByPolicy.add(name);
		}
	}

	pauseGoalForUnavailableTools(ctx: StatusContext, abortTurn = true, recordUsage = true) {
		const goal = this.activeGoal;
		if (goal?.status !== "active") return false;
		if (recordUsage) this.recordGoalUsage(goal, ctx);
		this.cancelContinuationWork();
		this.clearGoalRecoveryForGoal(goal.id);
		this.clearBudgetWrapUp();
		if (abortTurn) {
			this.blockStaleGoalToolCalls();
			abortCurrentTurn(ctx);
		} else {
			this.clearStaleGoalToolCallBlock();
		}
		this.activeGoal = transitionGoal(goal, "paused");
		this.persistGoal(this.activeGoal);
		this.updateStatus(ctx, this.activeGoal);
		ctx.ui.notify(
			"Goal tools are unavailable, so the active goal was paused. Restore the tools and run /goal resume.",
			"warning",
		);
		return true;
	}

	showCompletionStatus(_ctx: StatusContext, timeUsedSeconds = 0) {
		this.clearCompletionStatusTimer();
		getGoalStatusChannel(this.pi).publish({ status: "complete", timeUsedSeconds, tokensUsed: 0 });
		this.completionStatusTimer = setTimeout(() => {
			this.completionStatusTimer = undefined;
			this.clearPresentationStatus();
		}, 8_000);
	}

	clearCompletionStatusTimer() {
		if (!this.completionStatusTimer) return;
		clearTimeout(this.completionStatusTimer);
		this.completionStatusTimer = undefined;
	}

	private rememberPendingGoalPrompt(goalId: string, prompt: string, resetSafetyEpoch: boolean, origin: GoalRunOrigin) {
		const marker = randomUUID();
		this.pendingGoalPromptMarkers.set(marker, { goalId, origin, resetSafetyEpoch });
		return { marker, prompt: appendGoalPromptMarker(prompt, marker) };
	}

	private consumePendingGoalPrompt(prompt: string) {
		const marker = extractGoalPromptMarker(prompt);
		if (!marker) return undefined;
		const pending = this.pendingGoalPromptMarkers.get(marker);
		this.pendingGoalPromptMarkers.delete(marker);
		if (pending) {
			this.rememberClaimedGoalPromptMarker(marker, pending);
			return pending;
		}
		return this.claimedGoalPromptMarkers.get(marker);
	}

	private rememberClaimedGoalPromptMarker(marker: string, pending: PendingGoalPrompt) {
		this.claimedGoalPromptMarkers.set(marker, pending);
	}

	private rememberClaimedContinuationMarker(marker: string) {
		this.claimedContinuationMarkers.add(marker);
	}

	consumeOwnedGoalPrompt(prompt: string) {
		return this.consumePendingGoalPrompt(prompt);
	}

	private rememberCancelledContinuationMarker(marker: string) {
		this.cancelledContinuationMarkers.add(marker);
	}
}

function inputFingerprint(prompt: string) {
	return createHash("sha256").update(prompt, "utf8").digest("hex");
}

async function sendPrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	prompt: string,
	userDriven: boolean,
	isCurrent?: () => boolean,
) {
	try {
		return await sendHiddenGoalPrompt(pi, prompt, userDriven, isCurrent);
	} catch (error) {
		if (!isCurrent || isCurrent()) {
			ctx.ui.notify(`Goal prompt failed: ${formatError(error)}`, "error");
		}
		return false;
	}
}

function sendHiddenGoalPrompt(
	pi: ExtensionAPI,
	prompt: string,
	userDriven = false,
	isCurrent: () => boolean = () => true,
) {
	const message = withAgentWorkOrigin(
		{
			customType: GOAL_PROMPT_MESSAGE_TYPE,
			content: prompt,
			display: false,
		},
		userDriven ? "user" : "automatic",
	);
	return sendSuiteAgentMessage(
		pi,
		userDriven ? withDirectUserActivation(message) : message,
		{ deliverAs: "followUp", triggerTurn: true },
		isCurrent,
	);
}

function continuationMarker(goal: ActiveGoal) {
	return `${goal.id}:${goal.iteration}:${randomUUID()}`;
}

export type { AssistantMessageLike } from "./errors.js";
export {
	findFinalAssistantMessage,
	formatError,
	isExternallyBlockedGoalInterruption,
	isGoalContextOverflow,
	isRetryableGoalInterruption,
	isUsageLimitedGoalInterruption,
	truncateNotification,
} from "./errors.js";
