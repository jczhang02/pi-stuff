import type {
	AgentEndEvent,
	ContextEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Cause, type Effect, Exit } from "effect";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { hasDirectUserActivation } from "../../conversation-ui/agent-run-origin.js";
import { whenSuiteSessionReady } from "../../conversation-ui/index.js";
import { type EffectFoundation, installEffectFoundation } from "../../shared/effect-foundation.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { currentTokenTotal } from "./accounting.js";
import { GoalCommandController, registerGoalCommand } from "./commands.js";
import { GoalCompactionCoordinator } from "./compaction.js";
import { type ActiveGoal, loadGoalStateFromSession } from "./persistence.js";
import { buildGoalPrompt, buildGoalSystemPrompt } from "./prompts.js";
import { activateQueuedGoal } from "./queue.js";
import { GoalRunController } from "./run-protocol.js";
import {
	type AssistantMessageLike,
	abortCurrentTurn,
	blocksStaleGoalToolCalls,
	findFinalAssistantMessage,
	formatError,
	GOAL_CONTEXT_MESSAGE_TYPE,
	GOAL_PROMPT_MESSAGE_TYPE,
	type GoalRunOrigin,
	GoalRuntime,
	incrementGoal,
	isExternallyBlockedGoalInterruption,
	isGoalContextOverflow,
	isRetryableGoalInterruption,
	isUsageLimitedGoalInterruption,
	resetGoalSafetyEpoch,
	type StatusContext,
	transitionGoal,
	truncateNotification,
} from "./runtime.js";
import { hasAssistantToolCall } from "./safety.js";
import { DEFAULT_GOAL_SETTINGS, readGoalSettings } from "./settings.js";
import { registerGoalTerminalTools } from "./terminal-tools.js";

// goal.ts remains the Pi-facing composition root because lifecycle-event registration is
// order-sensitive. Terminal Tool execution, per-session mechanisms, and command transitions
// live behind their owning seams; each factory stays isolated.

interface GoalOptions {
	settingsPath?: string;
}

interface GoalLifecycle {
	readonly commands: GoalCommandController;
	readonly compaction: GoalCompactionCoordinator;
	goalProjectionNeeded: boolean;
	readonly options: GoalOptions;
	readonly pi: ExtensionAPI;
	readonly runController: GoalRunController;
	readonly runtime: GoalRuntime;
	turnActive: boolean;
}

type StartupDispatch = () => Promise<void>;

const EXPERIMENTAL_GOALS_WARNING =
	"Experimental ordered goals are enabled for pi-goal. Queue behavior and persisted state may change.";
const MESSAGE_ENVELOPE_SCHEMA = Type.Object(
	{
		content: Type.Optional(Type.Unknown()),
		customType: Type.Optional(Type.String()),
		role: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
type MessageEnvelope = Static<typeof MESSAGE_ENVELOPE_SCHEMA>;
type GoalMessage = ContextEvent["messages"][number];
const TEXT_MESSAGE_PART_SCHEMA = Type.Object(
	{ text: Type.Optional(Type.String()), type: Type.Literal("text") },
	{ additionalProperties: true },
);

function clearGoalSessionWork(runtime: GoalRuntime): void {
	runtime.prompts.clearContinuationTracking();
	runtime.prompts.clearPendingGoalPrompts();
	runtime.clearAgentRun();
	runtime.guardAbortGoalId = undefined;
	runtime.goalRecovery = undefined;
	runtime.clearBudgetWrapUp();
	runtime.clearStaleGoalToolCallBlock();
	runtime.queuedGoals = [];
	runtime.pendingQueueAction = undefined;
	runtime.queueFrozen = false;
	runtime.queueFreezeAwaitingSettle = false;
}

function resetGoalSession(lifecycle: GoalLifecycle): void {
	const { runtime } = lifecycle;
	runtime.invalidateMenuSession();
	runtime.clearCompletionStatusTimer();
	clearGoalSessionWork(runtime);
	runtime.clearTerminalDetails();
}

function loadGoalSessionSettings(
	lifecycle: GoalLifecycle,
	ctx: ExtensionContext,
	previousToolVisibility: GoalRuntime["settings"]["toolVisibility"],
): void {
	const { options, runtime } = lifecycle;
	const apply = (result: ReturnType<typeof readGoalSettings>): void => {
		runtime.settings = result.kind === "loaded" ? result.settings : DEFAULT_GOAL_SETTINGS;
		runtime.settingsLoadIssue = result.kind === "invalid" ? result : undefined;
		if (result.kind === "invalid") {
			ctx.ui.notify(`pi-goal settings ignored: ${result.reason}. Using default settings.`, "warning");
		}
		if (runtime.settings.experimental.goals) ctx.ui.notify(EXPERIMENTAL_GOALS_WARNING, "warning");
		if (runtime.settings.toolVisibility === "after-first-goal" && previousToolVisibility === "always") {
			runtime.goalToolsUnlocked = false;
		}
		if (runtime.settings.toolVisibility !== "always") return;
		if (runtime.goalToolsHiddenByPolicy.size > 0) {
			try {
				runtime.restoreGoalToolsHiddenByPolicy();
			} catch (error) {
				ctx.ui.notify(`Could not restore always-visible goal tools: ${formatError(error)}`, "error");
			}
		}
		runtime.goalToolsUnlocked = true;
	};
	apply(readGoalSettings(options.settingsPath));
}

function restoreActiveGoalSession(
	lifecycle: GoalLifecycle,
	ctx: ExtensionContext,
	startRestoredQueuedGoal: boolean,
	reloaded: boolean,
): StartupDispatch | undefined {
	const { pi, runtime } = lifecycle;
	if (runtime.activeGoal?.status === "active" && runtime.activeGoal.safetyResetPending) {
		runtime.activeGoal = resetGoalSafetyEpoch(runtime.activeGoal);
	}
	if (runtime.activeGoal?.status === "active") {
		runtime.recordGoalUsage(runtime.activeGoal, ctx);
		if (runtime.limitActiveGoalForBudget(ctx, false)) return;
		if (runtime.enforceAutomaticTurnLimit(ctx, false) || runtime.enforceNoProgressLimit(ctx)) return;
	}
	if (runtime.settings.toolVisibility === "after-first-goal") {
		// A restrictive earlier session_start policy wins; lazy visibility does not widen it.
		runtime.goalToolsUnlocked = true;
		runtime.goalToolsHiddenByPolicy.clear();
	}
	if (runtime.activeGoal?.status === "active" && !runtime.goalToolsAvailable()) {
		runtime.pauseGoalForUnavailableTools(ctx, false);
		return;
	}
	if (!runtime.activeGoal) return;
	runtime.persistGoal(runtime.activeGoal);
	if (startRestoredQueuedGoal) {
		const restoredGoal = runtime.activeGoal;
		return async () => {
			if (!(await whenSuiteSessionReady(pi, ctx))) return;
			if (runtime.activeGoal?.id !== restoredGoal.id || runtime.activeGoal.status !== "active") return;
			const sent = await runtime.sendOwnedGoalPrompt(ctx, restoredGoal.id, buildGoalPrompt(restoredGoal), {
				resetSafetyEpoch: false,
			});
			if (!sent && runtime.activeGoal?.id === restoredGoal.id) {
				runtime.activeGoal = transitionGoal(restoredGoal, "paused");
				runtime.blockStaleGoalToolCalls();
				runtime.persistGoal(runtime.activeGoal);
			}
		};
	}
	if (runtime.activeGoal.status !== "active" || !reloaded) return;
	runtime.prompts.requestContinuation(runtime.activeGoal);
	return async () => {
		if (await whenSuiteSessionReady(pi, ctx)) await runtime.dispatchContinuationIfSettled(ctx);
	};
}

function restoreGoalSession(
	lifecycle: GoalLifecycle,
	ctx: ExtensionContext,
	reloaded: boolean,
): StartupDispatch | undefined {
	const { commands, pi, runController, runtime } = lifecycle;
	const loaded = loadGoalStateFromSession(ctx);
	lifecycle.goalProjectionNeeded = loaded.source !== "none";
	runtime.activeGoal = loaded.goal;
	runtime.queuedGoals = loaded.queue;
	runtime.pendingQueueAction = loaded.pendingAction;
	runtime.queueFrozen = loaded.hasExperimentalQueueState && !runtime.settings.experimental.goals;
	runController.bindSession(ctx);
	if (runtime.queueFrozen) {
		if (runtime.activeGoal) runtime.persistGoal(runtime.activeGoal);
		runtime.publishPresentationStatus(runtime.activeGoal);
		ctx.ui.notify(
			"An experimental goal queue is frozen because experimental.goals is disabled. Re-enable it and run /reload to continue, or use /goal clear.",
			"warning",
		);
		return;
	}

	let startRestoredQueuedGoal = false;
	if (runtime.activeGoal?.status === "queued" && !runtime.pendingQueueAction) {
		runtime.activeGoal = activateQueuedGoal(runtime.activeGoal, currentTokenTotal(ctx));
		startRestoredQueuedGoal = runtime.activeGoal.status === "active";
	}
	if (runtime.pendingQueueAction) {
		if (runtime.activeGoal) {
			runtime.persistGoal(runtime.activeGoal);
		} else runtime.clearPresentationStatus();
		return async () => {
			if (await whenSuiteSessionReady(pi, ctx)) await commands.dispatchPendingQueueActionIfSettled(ctx);
		};
	}
	if (runtime.activeGoal) return restoreActiveGoalSession(lifecycle, ctx, startRestoredQueuedGoal, reloaded);
	if (runtime.settings.toolVisibility === "after-first-goal" && !runtime.goalToolsUnlocked) {
		runtime.hideGoalToolsIfLocked();
	}
	runtime.clearPresentationStatus();
}

async function startGoalSession(
	lifecycle: GoalLifecycle,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const { runtime } = lifecycle;
	lifecycle.goalProjectionNeeded = false;
	lifecycle.turnActive = false;
	runtime.beginReadOnlySessionStart();
	let dispatchAfterSuiteReady: StartupDispatch | undefined;
	try {
		const previousToolVisibility = runtime.settings.toolVisibility;
		resetGoalSession(lifecycle);
		loadGoalSessionSettings(lifecycle, ctx, previousToolVisibility);
		dispatchAfterSuiteReady = restoreGoalSession(lifecycle, ctx, event.reason === "reload");
	} finally {
		runtime.endReadOnlySessionStart();
		if (dispatchAfterSuiteReady) {
			void dispatchAfterSuiteReady().catch((error) => {
				ctx.ui.notify(`Goal startup continuation failed: ${formatError(error)}`, "error");
			});
		}
	}
}

function shutdownGoalSession(lifecycle: GoalLifecycle, ctx: ExtensionContext): void {
	const { compaction, runController, runtime } = lifecycle;
	lifecycle.goalProjectionNeeded = false;
	lifecycle.turnActive = false;
	compaction.clear();
	runController.unbindSession();
	runtime.invalidateMenuSession();
	if (runtime.activeGoal) {
		if (!runtime.queueFrozen && runtime.activeGoal.status === "active") {
			runtime.recordGoalUsage(runtime.activeGoal, ctx, false);
		}
		runtime.persistGoal(runtime.activeGoal);
	}
	clearGoalSessionWork(runtime);
	runtime.activeGoal = undefined;
	runtime.clearPresentationStatus();
	runtime.clearCompletionStatusTimer();
	runtime.clearTerminalDetails();
}

function registerGoalSessionHandlers(lifecycle: GoalLifecycle): void {
	const { compaction, pi } = lifecycle;
	pi.on("session_start", (event, ctx) => startGoalSession(lifecycle, event, ctx));
	pi.on("session_shutdown", (_event, ctx) => shutdownGoalSession(lifecycle, ctx));
	pi.on("session_before_compact", (event, ctx) => compaction.before(event, ctx));
	pi.on("session_compact_failed", (event, ctx) => compaction.failed(event, ctx));
	pi.on("session_compact", (event, ctx) => compaction.complete(event, ctx));
}

function prepareNonGoalDelivery(lifecycle: GoalLifecycle, resetSafetyEpoch: boolean, origin?: GoalRunOrigin): void {
	const { runtime } = lifecycle;
	runtime.goalRecovery = undefined;
	runtime.guardAbortGoalId = undefined;
	runtime.clearStaleGoalToolCallBlock();
	if (resetSafetyEpoch) runtime.clearBudgetWrapUp();
	const activeGoalId = runtime.activeGoal?.status === "active" ? runtime.activeGoal.id : undefined;
	if (origin) runtime.beginAgentRun(activeGoalId ?? null, activeGoalId ? origin : undefined);
	if (resetSafetyEpoch) runtime.resetActiveSafetyEpoch();
}

function beginPromptRun(lifecycle: GoalLifecycle, prompt: string, ctx: StatusContext): ActiveGoal | undefined {
	const { runtime } = lifecycle;
	runtime.clearAgentRun();
	if (runtime.prompts.consumeCancelledContinuationPrompt(prompt) || runtime.consumeStaleOwnedGoalPrompt(prompt)) {
		runtime.beginAgentRun(null, undefined);
		abortCurrentTurn(ctx);
		return;
	}
	if (runtime.queueFrozen) return;
	// A normal prompt boundary supersedes stale retry and hard-cap cleanup ownership.
	runtime.goalRecovery = undefined;
	if (runtime.guardAbortGoalId) runtime.guardAbortGoalId = undefined;
	const goalPrompt = runtime.prompts.consumeOwnedGoalPrompt(prompt);
	const goalPromptGoalId = goalPrompt?.goalId;
	const continuationGoalId = goalPromptGoalId ? undefined : runtime.prompts.markContinuationStarted(prompt);
	const ownedPromptGoalId = goalPromptGoalId ?? continuationGoalId;
	const activeBudgetWrapUp = runtime.hasActiveBudgetWrapUp();
	const runOrigin = continuationGoalId ? "automatic" : (goalPrompt?.origin ?? "automatic");
	if (runtime.pendingQueueAction?.kind === "prioritize" && !activeBudgetWrapUp) {
		if (!runtime.pendingQueueAction.displacedUsageFinalized) {
			if (runtime.activeGoal?.status === "active") runtime.recordGoalUsage(runtime.activeGoal, ctx, false);
			runtime.pendingQueueAction.displacedUsageFinalized = true;
			if (runtime.activeGoal) {
				runtime.persistGoal(runtime.activeGoal);
			}
		}
		runtime.beginAgentRun(null, undefined);
		if (ownedPromptGoalId) abortCurrentTurn(ctx);
		return;
	}
	if (activeBudgetWrapUp && runtime.activeGoal) {
		runtime.beginAgentRun(runtime.activeGoal.id, "manual");
		return;
	}
	if (runtime.pendingQueueAction?.kind === "advance" && runtime.pendingQueueAction.goalId === runtime.activeGoal?.id) {
		runtime.beginAgentRun(ownedPromptGoalId ?? runtime.activeGoal.id, runOrigin);
		if (ownedPromptGoalId) abortCurrentTurn(ctx);
		return;
	}
	if (ownedPromptGoalId && ownedPromptGoalId !== runtime.activeGoal?.id) {
		runtime.beginAgentRun(ownedPromptGoalId, runOrigin);
		if (runtime.activeGoal?.status === "active" && !runtime.goalToolsAvailable()) {
			runtime.pauseGoalForUnavailableTools(ctx, false);
		}
		abortCurrentTurn(ctx);
		return;
	}
	if (runtime.activeGoal?.status !== "active") return;
	runtime.beginAgentRun(runtime.activeGoal.id, runOrigin);
	if (!runtime.goalToolsAvailable()) {
		runtime.pauseGoalForUnavailableTools(ctx, ownedPromptGoalId !== undefined);
		return;
	}
	if (goalPrompt?.resetSafetyEpoch && goalPromptGoalId === runtime.activeGoal.id) {
		runtime.activeGoal = resetGoalSafetyEpoch(runtime.activeGoal);
		runtime.persistGoal(runtime.activeGoal);
	}
	return runtime.activeGoal;
}

function registerGoalInputHandlers(lifecycle: GoalLifecycle): void {
	const { pi, runtime } = lifecycle;
	pi.on("input", (event) => {
		if (event.source === "extension") {
			if (
				runtime.prompts.consumeCancelledContinuationPrompt(event.text) ||
				runtime.consumeStaleOwnedGoalPrompt(event.text)
			) {
				return { action: "handled" as const };
			}
			if (runtime.queueFrozen) return;
			if (runtime.prompts.hasPendingOwnedGoalPrompt(event.text)) return;
			runtime.prompts.noteQueuedNonGoalInput(event.text, event.streamingBehavior ?? "idle", "automatic", false);
			return;
		}
		if (runtime.queueFrozen || /^\/goal(?:\s|$)/u.test(event.text.trimStart())) return;
		runtime.prompts.noteQueuedNonGoalInput(event.text, event.streamingBehavior ?? "idle", "manual", true);
	});
	pi.on("turn_start", () => {
		lifecycle.turnActive = true;
	});
}

function handleGoalMessageStart(lifecycle: GoalLifecycle, messageValue: GoalMessage, ctx: ExtensionContext): void {
	const { runtime } = lifecycle;
	const message: MessageEnvelope = Check(MESSAGE_ENVELOPE_SCHEMA, messageValue) ? messageValue : {};
	if (
		message.role === "assistant" &&
		runtime.activeGoal?.status === "paused" &&
		runtime.guardAbortGoalId === runtime.activeGoal.id
	) {
		abortCurrentTurn(ctx);
		return;
	}
	if (message.role === "custom") {
		if (lifecycle.turnActive) runtime.prompts.discardQueuedNonGoalInputs(["idle"]);
		if (message.customType === GOAL_PROMPT_MESSAGE_TYPE && isRuntimeString(message.content)) {
			beginPromptRun(lifecycle, message.content, ctx);
			return;
		}
		if (message.customType === GOAL_CONTEXT_MESSAGE_TYPE || runtime.isActiveBudgetWrapUpMessage(message)) return;
		if (!lifecycle.turnActive) return;
		const origin = hasDirectUserActivation(message) ? "manual" : "automatic";
		prepareNonGoalDelivery(lifecycle, origin === "manual", origin);
		return;
	}
	if (message.role !== "user") return;
	const prompt = Array.isArray(message.content)
		? message.content
				.filter((part) => Check(TEXT_MESSAGE_PART_SCHEMA, part))
				.flatMap((part) => (part.text === undefined ? [] : [part.text]))
				.join("\n")
		: Check(Type.String(), message.content)
			? message.content
			: "";
	const ownedPrompt = runtime.prompts.consumeOwnedGoalPrompt(prompt);
	const ownedPromptBoundary = runtime.prompts.hasOwnedPromptBoundary(prompt);
	const queued = runtime.prompts.consumeQueuedNonGoalInput(prompt, !ownedPromptBoundary, [
		"steer",
		"followUp",
		"idle",
	]);
	if (!ownedPrompt) {
		if (queued?.behavior === "followUp") {
			prepareNonGoalDelivery(lifecycle, queued.resetSafetyEpoch, queued.origin);
		} else if (queued) prepareNonGoalDelivery(lifecycle, queued.resetSafetyEpoch);
		return;
	}
	if (runtime.activeGoal?.id !== ownedPrompt.goalId || runtime.activeGoal.status !== "active") return;
	if (runtime.agentRunGoalId !== undefined && runtime.agentRunGoalId !== ownedPrompt.goalId) {
		runtime.activeGoal.baselineTokens = Math.max(0, currentTokenTotal(ctx) - runtime.activeGoal.tokensUsed);
	}
	runtime.beginAgentRun(ownedPrompt.goalId, ownedPrompt.origin);
	if (ownedPrompt.resetSafetyEpoch) runtime.activeGoal = resetGoalSafetyEpoch(runtime.activeGoal);
	runtime.persistGoal(runtime.activeGoal);
}

function projectGoalContext(lifecycle: GoalLifecycle, event: ContextEvent, ctx: ExtensionContext) {
	const { runtime } = lifecycle;
	if (!lifecycle.goalProjectionNeeded) return;
	const latestGoalContextIndex = findLatestGoalContextIndex(event.messages);
	const messages = event.messages.filter(
		(message, index) =>
			runtime.keepBudgetWrapUpMessage(message) &&
			(!isGoalContextMessage(message) || index === latestGoalContextIndex),
	);
	if (runtime.activeGoal?.status === "paused" && runtime.guardAbortGoalId === runtime.activeGoal.id) {
		abortCurrentTurn(ctx);
	}
	if (messages.length !== event.messages.length) return { messages };
}

function registerGoalMessageHandlers(lifecycle: GoalLifecycle): void {
	const { pi } = lifecycle;
	pi.on("message_start", (event, ctx) => handleGoalMessageStart(lifecycle, event.message, ctx));
	pi.on("context", (event, ctx) => projectGoalContext(lifecycle, event, ctx));
}

function registerGoalToolHandlers(lifecycle: GoalLifecycle): void {
	const { pi, runtime } = lifecycle;
	pi.on("tool_call", (event, ctx) => {
		runtime.markAgentToolAttempted();
		if (runtime.queueFrozen) {
			if (!runtime.isGoalToolName(event.toolName)) return;
			abortCurrentTurn(ctx);
			return {
				block: true,
				reason:
					"The experimental goal queue is frozen. Re-enable experimental.goals and run /reload, or use /goal clear.",
			};
		}
		if (
			runtime.activeGoal?.status === "budget_limited" &&
			runtime.budgetWrapUp?.goalId === runtime.activeGoal.id &&
			event.toolName !== "goal_complete"
		) {
			abortCurrentTurn(ctx);
			return {
				block: true,
				reason: "Goal token budget is exhausted; only goal_complete is allowed during wrap-up.",
			};
		}
		if (!runtime.staleGoalToolCallsBlocked) return;
		if (!runtime.activeGoal || !blocksStaleGoalToolCalls(runtime.activeGoal.status)) {
			runtime.clearStaleGoalToolCallBlock();
			return;
		}
		abortCurrentTurn(ctx);
		return {
			block: true,
			reason: "Blocked stale /goal tool call after the goal stopped or was interrupted.",
		};
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		if (runtime.queueFrozen) return;
		if (
			runtime.activeGoal?.status === "budget_limited" &&
			runtime.budgetWrapUp?.goalId === runtime.activeGoal.id &&
			!runtime.budgetWrapUp.delivered
		) {
			runtime.queueBudgetWrapUp(ctx, runtime.activeGoal);
			return;
		}
		if (runtime.activeGoal?.status !== "active") return;
		if (!runtime.recordGoalUsage(runtime.activeGoal, ctx)) return;
		runtime.persistGoal(runtime.activeGoal);
		if (runtime.limitActiveGoalForBudget(ctx, true)) return;
		if (!runtime.goalToolsAvailable()) runtime.pauseGoalForUnavailableTools(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		runtime.flushDeferredSessionStartState();
		const activeGoal = beginPromptRun(lifecycle, event.prompt, ctx);
		if (!activeGoal) return;
		lifecycle.goalProjectionNeeded = true;
		return {
			message: {
				customType: GOAL_CONTEXT_MESSAGE_TYPE,
				content: buildGoalSystemPrompt(activeGoal),
				display: false,
			},
		};
	});
}

function stopGoalAfterAgentEnd(
	lifecycle: GoalLifecycle,
	ctx: StatusContext,
	goal: ActiveGoal,
	assistant: AssistantMessageLike,
	status: "paused" | "usage_limited",
): void {
	const { runtime } = lifecycle;
	runtime.prompts.cancelContinuationWork();
	runtime.clearBudgetWrapUp();
	runtime.blockStaleGoalToolCalls();
	abortCurrentTurn(ctx);
	runtime.activeGoal = transitionGoal(goal, status);
	runtime.setTerminalReason(
		runtime.activeGoal.id,
		assistant.errorMessage ?? `goal ${status} after agent interruption`,
	);
	runtime.persistGoal(runtime.activeGoal);

	const details = assistant.errorMessage ? ` (${truncateNotification(assistant.errorMessage)})` : "";
	if (status === "paused") {
		ctx.ui.notify(`Goal paused after interruption${details}. Run /goal resume to continue.`, "warning");
		return;
	}
	ctx.ui.notify(
		`Goal stopped after provider usage limit${details}. Run /goal resume when usage is available.`,
		"warning",
	);
}

function handleGoalAgentEnd(lifecycle: GoalLifecycle, event: AgentEndEvent, ctx: ExtensionContext): void {
	const { runtime } = lifecycle;
	const run = runtime.finishAgentRun();
	if (runtime.queueFrozen || run.goalId === null) return;
	if (!runtime.canRecordGoalUsage() && !runtime.hasActiveBudgetWrapUp()) return;
	if (run.goalId && run.goalId !== runtime.activeGoal?.id) return;
	if (!runtime.activeGoal) return;
	if (runtime.activeGoal.status === "budget_limited" && runtime.budgetWrapUp?.goalId === runtime.activeGoal.id) {
		runtime.recordGoalUsage(runtime.activeGoal, ctx);
		runtime.persistGoal(runtime.activeGoal);
		runtime.clearBudgetWrapUp();
		return;
	}
	if (runtime.activeGoal.status !== "active") return;
	if (runtime.pendingQueueAction?.kind === "advance" && runtime.pendingQueueAction.goalId === runtime.activeGoal.id) {
		runtime.recordGoalUsage(runtime.activeGoal, ctx);
		runtime.persistGoal(runtime.activeGoal);
		return;
	}

	const goalId = runtime.activeGoal.id;
	const alreadyAwaitingContinuation = runtime.prompts.hasContinuationWorkForGoal(goalId);
	const finalAssistant = findFinalAssistantMessage(event.messages);
	if (!alreadyAwaitingContinuation) runtime.activeGoal = incrementGoal(runtime.activeGoal);
	runtime.recordGoalUsage(runtime.activeGoal, ctx);

	if (finalAssistant?.stopReason === "aborted") {
		runtime.clearGoalRecoveryForGoal(goalId);
		stopGoalAfterAgentEnd(lifecycle, ctx, runtime.activeGoal, finalAssistant, "paused");
		return;
	}
	if (finalAssistant?.stopReason === "error") {
		if (isRetryableGoalInterruption(finalAssistant)) {
			if (run.origin === "automatic" && runtime.enforceAutomaticTurnLimit(ctx, true)) return;
			if (runtime.limitActiveGoalForBudget(ctx, false)) return;
			if (!runtime.goalToolsAvailable()) {
				runtime.pauseGoalForUnavailableTools(ctx);
				return;
			}
			runtime.goalRecovery = {
				goalId,
				kind: isGoalContextOverflow(finalAssistant) ? "compaction_retry" : "provider_retry",
				automaticOwner: run.origin === "automatic",
				errorMessage: finalAssistant.errorMessage,
			};
			runtime.prompts.cancelContinuationWork();
			runtime.persistGoal(runtime.activeGoal);
			return;
		}
		runtime.clearGoalRecoveryForGoal(goalId);
		if (isUsageLimitedGoalInterruption(finalAssistant) || isExternallyBlockedGoalInterruption(finalAssistant)) {
			const status = isUsageLimitedGoalInterruption(finalAssistant) ? "usage_limited" : "paused";
			stopGoalAfterAgentEnd(lifecycle, ctx, runtime.activeGoal, finalAssistant, status);
			return;
		}
		runtime.goalRecovery = {
			goalId,
			kind: "provider_retry",
			automaticOwner: run.origin === "automatic",
			errorMessage: finalAssistant.errorMessage,
		};
		runtime.prompts.cancelContinuationWork();
		runtime.persistGoal(runtime.activeGoal);
		return;
	}

	runtime.clearGoalRecoveryForGoal(goalId);
	if (runtime.limitActiveGoalForBudget(ctx, false)) return;
	if (!runtime.goalToolsAvailable()) {
		runtime.pauseGoalForUnavailableTools(ctx);
		return;
	}
	if (
		run.origin === "automatic" &&
		runtime.recordAutomaticRunProgress(
			ctx,
			goalId,
			event.messages,
			run.toolAttempted || hasAssistantToolCall(event.messages),
		)
	)
		return;
	runtime.persistGoal(runtime.activeGoal);
	const currentGoal = runtime.activeGoal;
	if (!currentGoal || currentGoal.id !== goalId || currentGoal.status !== "active") return;
	if (runtime.pendingQueueAction?.kind === "prioritize") return;
	runtime.prompts.requestContinuation(currentGoal);
}

function registerGoalAgentHandlers(lifecycle: GoalLifecycle): void {
	const { commands, pi, runtime } = lifecycle;
	pi.on("agent_start", () => {
		if (runtime.queueFrozen) return;
		const activeGoal = runtime.activeGoal;
		if (activeGoal && runtime.guardAbortGoalId === activeGoal.id && activeGoal.status === "paused") return;
		runtime.beginRecoveryRunIfNeeded();
	});
	pi.on("turn_end", (event, ctx) => {
		lifecycle.turnActive = false;
		if (!runtime.queueFrozen) runtime.recordAutomaticTurn(ctx, event.message);
	});
	pi.on("agent_end", (event, ctx) => handleGoalAgentEnd(lifecycle, event, ctx));
	pi.on("agent_settled", async (_event, ctx) => {
		lifecycle.turnActive = false;
		if (runtime.queueFrozen) {
			runtime.clearSettledSafetyTracking();
			runtime.queueFreezeAwaitingSettle = false;
			if (runtime.settings.experimental.goals) await commands.resumeQueueAfterUnfreeze(ctx);
			return;
		}
		runtime.finalizeSettledRecovery(ctx);
		const dispatched = runtime.pendingQueueAction ? await commands.dispatchPendingQueueActionIfSettled(ctx) : false;
		if (!dispatched) await runtime.dispatchContinuationIfSettled(ctx);
		runtime.clearSettledSafetyTracking();
	});
}

async function runGoalMenuOperation(
	foundation: EffectFoundation,
	ctx: ExtensionCommandContext,
	program: Effect.Effect<void>,
): Promise<void> {
	const session = foundation.sessionFor(ctx.sessionManager) ?? foundation.currentSession();
	if (!session || !foundation.isCurrent(session)) {
		throw new Error("Goal menu is unavailable before Session start.");
	}
	const operation = foundation.forkOperation(session);
	const exit = await foundation.run(operation, program, { signal: ctx.signal });
	await foundation.close(operation, exit);
	if (ctx.signal?.aborted || (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause))) return;
	if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
}

// Cohesion justification: command, tool, continuation, and lifecycle handlers coordinate one
// guarded Goal state machine whose ordering and stale-turn invariants share the same closures.
function registerGoalRuntime(pi: ExtensionAPI, options: GoalOptions = {}) {
	const effects = installEffectFoundation(pi);
	const runtime = new GoalRuntime(pi);
	const commands = new GoalCommandController(runtime);
	const compaction = new GoalCompactionCoordinator(runtime, commands);
	const runController = new GoalRunController(runtime, commands);
	const lifecycle: GoalLifecycle = {
		commands,
		compaction,
		goalProjectionNeeded: false,
		options,
		pi,
		runController,
		runtime,
		turnActive: false,
	};
	runController.register(pi);

	registerGoalTerminalTools(pi, runtime);
	// Do not touch the active tool set during factory registration: ExtensionAPI
	// actions are unbound until the session binds the runtime. session_start applies
	// baseline visibility once actions work; later hooks only enforce goal safety.

	registerGoalCommand(pi, runtime, commands, {
		onProjectionNeeded: () => {
			lifecycle.goalProjectionNeeded = true;
		},
		runMenu: (ctx, program) => runGoalMenuOperation(effects, ctx, program),
		settingsPath: options.settingsPath,
	});
	registerGoalSessionHandlers(lifecycle);
	registerGoalInputHandlers(lifecycle);
	registerGoalMessageHandlers(lifecycle);
	registerGoalToolHandlers(lifecycle);
	registerGoalAgentHandlers(lifecycle);
	return runtime;
}

export default function goal(pi: ExtensionAPI, options: GoalOptions = {}) {
	return registerGoalRuntime(pi, options);
}

export {
	assistantUsageTokens,
	cumulativeAssistantTokens,
	formatDuration,
	formatTokenCount,
} from "./accounting.js";

export {
	completeGoalArguments,
	parseCommand,
	parseTokenBudget,
	validateObjective,
} from "./command.js";

export { buildGoalSystemPrompt } from "./prompts.js";

export {
	EMERGENCY_AUTOMATIC_TURN_LIMIT,
	findFinalAssistantMessage,
	formatStatus,
	GOAL_CONTEXT_MESSAGE_TYPE,
	GOAL_PROMPT_MESSAGE_TYPE,
	isContradictoryCompletionSummary,
	isRetryableGoalInterruption,
	isUsageLimitedGoalInterruption,
} from "./runtime.js";

function isGoalContextMessage(message: GoalMessage) {
	return (
		message.role === "custom" &&
		(message.customType === GOAL_PROMPT_MESSAGE_TYPE || message.customType === GOAL_CONTEXT_MESSAGE_TYPE)
	);
}

function findLatestGoalContextIndex(messages: readonly GoalMessage[]) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message && isGoalContextMessage(message)) return index;
	}
	return -1;
}
