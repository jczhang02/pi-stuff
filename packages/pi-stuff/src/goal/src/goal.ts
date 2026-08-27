import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { hasDirectUserActivation } from "../../conversation-ui/agent-run-origin.js";
import { isSuiteNativeCompactionPreflight, whenSuiteSessionReady } from "../../conversation-ui/index.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { currentTokenTotal } from "./accounting.js";
import { completeGoalArguments, parseCommand } from "./command.js";
import { GoalCommandController } from "./commands.js";
import { showGoalManager } from "./menu.js";
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
	type GoalCompactionEvent,
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
import { DEFAULT_GOAL_SETTINGS, readGoalSettings, readGoalSettingsLocked, withGoalSettingsLock } from "./settings.js";
import { registerGoalTerminalTools } from "./terminal-tools.js";

// goal.ts remains the Pi-facing composition root because lifecycle-event registration is
// order-sensitive. Terminal Tool execution, per-session mechanisms, and command transitions
// live behind their owning seams; each factory stays isolated.

interface GoalOptions {
	settingsPath?: string;
}

const BUN_RUNTIME = process.versions["bun"] !== undefined;

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
const TEXT_MESSAGE_PART_SCHEMA = Type.Object(
	{ text: Type.Optional(Type.String()), type: Type.Literal("text") },
	{ additionalProperties: true },
);

// Cohesion justification: command, tool, continuation, and lifecycle handlers coordinate one
// guarded Goal state machine whose ordering and stale-turn invariants share the same closures.
function registerGoalRuntime(pi: ExtensionAPI, options: GoalOptions = {}) {
	const runtime = new GoalRuntime(pi);
	const commands = new GoalCommandController(runtime);
	const runController = new GoalRunController(runtime, commands);
	let goalProjectionNeeded = false;
	let turnActive = false;
	runController.register(pi);

	// Bind per-factory runtime operations once so event orchestration stays concise
	// without reintroducing module-global mutable state.
	const clearCompletionStatusTimer = runtime.clearCompletionStatusTimer.bind(runtime);
	const clearContinuationTracking = runtime.clearContinuationTracking.bind(runtime);
	const clearPendingGoalPrompts = runtime.clearPendingGoalPrompts.bind(runtime);
	const clearGoalRecovery = runtime.clearGoalRecovery.bind(runtime);
	const clearBudgetWrapUp = runtime.clearBudgetWrapUp.bind(runtime);
	const clearStaleGoalToolCallBlock = runtime.clearStaleGoalToolCallBlock.bind(runtime);
	const persistGoal = runtime.persistGoal.bind(runtime);
	const updateGoalUsage = runtime.recordGoalUsage.bind(runtime);
	const updateStatus = runtime.updateStatus.bind(runtime);
	const limitActiveGoalForBudget = runtime.limitActiveGoalForBudget.bind(runtime);
	const hideGoalToolsIfLocked = runtime.hideGoalToolsIfLocked.bind(runtime);
	const goalToolsAvailable = runtime.goalToolsAvailable.bind(runtime);
	const pauseGoalForUnavailableTools = runtime.pauseGoalForUnavailableTools.bind(runtime);
	const isPiOwnedCompactionRetry = runtime.isPiOwnedCompactionRetry.bind(runtime);
	const requestContinuation = runtime.requestContinuation.bind(runtime);
	const dispatchContinuationIfSettled = runtime.dispatchContinuationIfSettled.bind(runtime);
	const keepBudgetWrapUpMessage = runtime.keepBudgetWrapUpMessage.bind(runtime);
	const isGoalToolName = runtime.isGoalToolName.bind(runtime);
	const queueBudgetWrapUp = runtime.queueBudgetWrapUp.bind(runtime);
	const clearGoalRecoveryForGoal = runtime.clearGoalRecoveryForGoal.bind(runtime);
	const blockStaleGoalToolCalls = runtime.blockStaleGoalToolCalls.bind(runtime);
	const cancelContinuationWork = runtime.cancelContinuationWork.bind(runtime);
	const consumeCancelledContinuationPrompt = runtime.consumeCancelledContinuationPrompt.bind(runtime);
	const consumeStaleOwnedGoalPrompt = runtime.consumeStaleOwnedGoalPrompt.bind(runtime);
	const consumePendingGoalPrompt = runtime.consumeOwnedGoalPrompt.bind(runtime);
	const markContinuationStarted = runtime.markContinuationStarted.bind(runtime);
	const hasContinuationWorkForGoal = runtime.hasContinuationWorkForGoal.bind(runtime);
	const recordAutomaticTurn = runtime.recordAutomaticTurn.bind(runtime);
	const recordAutomaticRunProgress = runtime.recordAutomaticRunProgress.bind(runtime);
	const enforceAutomaticTurnLimit = runtime.enforceAutomaticTurnLimit.bind(runtime);
	const enforceNoProgressLimit = runtime.enforceNoProgressLimit.bind(runtime);
	const restoreGoalToolsHiddenByPolicy = runtime.restoreGoalToolsHiddenByPolicy.bind(runtime);
	const sendOwnedGoalPrompt = (
		_pi: ExtensionAPI,
		ctx: StatusContext,
		goalId: string,
		prompt: string,
		resetSafetyEpoch = true,
	) => runtime.sendOwnedGoalPrompt(ctx, goalId, prompt, { resetSafetyEpoch });
	const dispatchPendingQueueActionIfSettled = commands.dispatchPendingQueueActionIfSettled.bind(commands);
	type PendingCompaction = {
		readonly ctx: StatusContext;
		readonly generation: number;
		readonly goalId: string;
		readonly sessionManager: StatusContext["sessionManager"];
	};
	let compactionGeneration = 0;
	let compactionFailureTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingCompaction: PendingCompaction | undefined;

	const clearPendingCompaction = (): void => {
		compactionGeneration++;
		pendingCompaction = undefined;
		if (compactionFailureTimer !== undefined) clearTimeout(compactionFailureTimer);
		compactionFailureTimer = undefined;
	};
	const armCompaction = (ctx: StatusContext, goalId: string): void => {
		pendingCompaction = {
			ctx,
			generation: compactionGeneration,
			goalId,
			sessionManager: ctx.sessionManager,
		};
	};
	const resumeAfterFailedCompaction = async (
		pending: PendingCompaction,
		event: GoalCompactionEvent,
	): Promise<void> => {
		try {
			await pending.ctx.waitForIdle?.();
		} catch {
			// Fall through to the generation and live-idle checks below.
		}
		if (pending.generation !== compactionGeneration) return;
		const activeGoal = runtime.activeGoal;
		if (!activeGoal || activeGoal.id !== pending.goalId || activeGoal.status !== "active") return;
		if (runtime.pendingQueueAction) {
			await dispatchPendingQueueActionIfSettled(pending.ctx);
			return;
		}
		if (isPiOwnedCompactionRetry(event, activeGoal.id)) return;
		clearGoalRecoveryForGoal(activeGoal.id);
		requestContinuation(activeGoal);
		await dispatchContinuationIfSettled(pending.ctx);
	};

	registerGoalTerminalTools(pi, runtime);
	// Do not touch the active tool set during factory registration: ExtensionAPI
	// actions are unbound until the session binds the runtime. session_start applies
	// baseline visibility once actions work; later hooks only enforce goal safety.

	pi.registerCommand("goal", {
		description: "Run a goal to completion: /goal [--tokens 100k] <goal_to_complete>",
		getArgumentCompletions: (prefix) =>
			completeGoalArguments(prefix, {
				experimentalGoals: runtime.settings.experimental.goals,
			}),
		handler: async (args, ctx) => {
			const result = parseCommand(args, {
				experimentalGoals: runtime.settings.experimental.goals,
			});
			if (isRuntimeString(result)) {
				ctx.ui.notify(result, "warning");
				return;
			}
			if (result.kind === "show" && args.trim() === "") {
				await showGoalManager(runtime, commands, ctx, async (menuCtx) => {
					const { showGoalSettings } = await import("./settings-ui.js");
					return showGoalSettings(runtime, menuCtx, {
						settingsPath: options.settingsPath,
						withLock: BUN_RUNTIME ? withGoalSettingsLock : undefined,
						onQueueUnfrozen: async (settingsCtx) => {
							await commands.resumeQueueAfterUnfreeze(settingsCtx);
						},
					});
				});
				return;
			}
			if (runtime.queueFrozen) {
				if (result.kind === "show") commands.showGoal(ctx);
				else if (result.kind === "clear") await commands.clearGoal(ctx);
				else commands.notifyFrozenQueue(ctx);
				return;
			}
			if (runtime.pendingQueueAction && result.kind !== "show" && result.kind !== "clear") {
				ctx.ui.notify("A queued goal change is waiting for Pi to settle. Retry after it finishes.", "warning");
				return;
			}

			try {
				switch (result.kind) {
					case "show":
						commands.showGoal(ctx);
						return;
					case "pause":
						commands.pauseGoal(ctx);
						return;
					case "resume":
						await commands.resumeGoal(ctx);
						return;
					case "clear":
						await commands.clearGoal(ctx);
						return;
					case "edit":
						await commands.editGoal(result.objective ?? "", result.tokenBudget, ctx);
						return;
					case "add":
						await commands.addGoal(result.objective ?? "", result.tokenBudget, ctx);
						return;
					case "prioritize":
						await commands.prioritizeGoal(result.objective ?? "", result.tokenBudget, ctx);
						return;
					case "drop-last":
						await commands.dropLastGoal(ctx);
						return;
					case "skip":
						await commands.skipGoal(ctx);
						return;
					case "start":
						await commands.startGoal(result.objective ?? "", result.tokenBudget, ctx);
						return;
				}
			} finally {
				if (runtime.activeGoal || runtime.queuedGoals.length > 0 || runtime.pendingQueueAction) {
					goalProjectionNeeded = true;
				}
			}
		},
	});

	pi.on("session_start", async (event, ctx) => {
		goalProjectionNeeded = false;
		turnActive = false;
		runtime.beginReadOnlySessionStart();
		let dispatchAfterSuiteReady: (() => Promise<void>) | undefined;
		try {
			runtime.replaceMenuSession();
			clearCompletionStatusTimer();
			clearContinuationTracking();
			clearPendingGoalPrompts();
			runtime.clearAgentRun();
			runtime.guardAbortGoalId = undefined;
			clearGoalRecovery();
			clearBudgetWrapUp();
			clearStaleGoalToolCallBlock();
			runtime.queuedGoals = [];
			runtime.pendingQueueAction = undefined;
			runtime.queueFrozen = false;
			runtime.queueFreezeAwaitingSettle = false;
			runtime.clearTerminalDetails();
			const previousToolVisibility = runtime.settings.toolVisibility;
			const settingsResult = BUN_RUNTIME
				? await readGoalSettingsLocked(options.settingsPath)
				: readGoalSettings(options.settingsPath);
			runtime.settings = settingsResult.kind === "loaded" ? settingsResult.settings : DEFAULT_GOAL_SETTINGS;
			runtime.settingsLoadIssue = settingsResult.kind === "invalid" ? settingsResult : undefined;
			if (settingsResult.kind === "invalid") {
				ctx.ui.notify(`pi-goal settings ignored: ${settingsResult.reason}. Using default settings.`, "warning");
			}
			if (runtime.settings.experimental.goals) {
				ctx.ui.notify(EXPERIMENTAL_GOALS_WARNING, "warning");
			}
			if (runtime.settings.toolVisibility === "after-first-goal" && previousToolVisibility === "always") {
				runtime.goalToolsUnlocked = false;
			}
			if (runtime.settings.toolVisibility === "always") {
				if (runtime.goalToolsHiddenByPolicy.size > 0) {
					try {
						restoreGoalToolsHiddenByPolicy();
					} catch (error) {
						ctx.ui.notify(`Could not restore always-visible goal tools: ${formatError(error)}`, "error");
					}
				}
				runtime.goalToolsUnlocked = true;
			}

			const loaded = loadGoalStateFromSession(ctx);
			goalProjectionNeeded = loaded.source !== "none";
			runtime.activeGoal = loaded.goal;
			runtime.queuedGoals = loaded.queue;
			runtime.pendingQueueAction = loaded.pendingAction;
			runtime.queueFrozen = loaded.hasExperimentalQueueState && !runtime.settings.experimental.goals;
			runController.bindSession(ctx);
			if (runtime.queueFrozen) {
				if (runtime.activeGoal) persistGoal(runtime.activeGoal);
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
					persistGoal(runtime.activeGoal);
					updateStatus(ctx, runtime.activeGoal);
				} else {
					runtime.clearPresentationStatus();
				}
				dispatchAfterSuiteReady = async () => {
					if (await whenSuiteSessionReady(pi, ctx)) await dispatchPendingQueueActionIfSettled(ctx);
				};
				return;
			}
			if (runtime.activeGoal) {
				if (runtime.activeGoal.status === "active" && runtime.activeGoal.safetyResetPending) {
					// Resume/edit activation promises a fresh safety epoch. Session startup
					// buffers the updated snapshot; the next prompt boundary flushes it before
					// any model work starts.
					runtime.activeGoal = resetGoalSafetyEpoch(runtime.activeGoal);
				}
				if (runtime.activeGoal.status === "active") {
					updateGoalUsage(runtime.activeGoal, ctx);
					if (limitActiveGoalForBudget(ctx, false)) return;
					if (enforceAutomaticTurnLimit(ctx, false) || enforceNoProgressLimit(ctx)) return;
				}
				if (runtime.settings.toolVisibility === "after-first-goal") {
					// Registered tools are already active on an unrestricted fresh runtime.
					// If an earlier session_start handler removed them, that restrictive
					// policy wins: mark lazy visibility unlocked without widening its set.
					runtime.goalToolsUnlocked = true;
					runtime.goalToolsHiddenByPolicy.clear();
				}
				if (runtime.activeGoal.status === "active" && !goalToolsAvailable()) {
					pauseGoalForUnavailableTools(ctx, false);
					return;
				}
				persistGoal(runtime.activeGoal);
				updateStatus(ctx, runtime.activeGoal);
				if (startRestoredQueuedGoal) {
					const restoredGoal = runtime.activeGoal;
					dispatchAfterSuiteReady = async () => {
						if (!(await whenSuiteSessionReady(pi, ctx))) return;
						if (runtime.activeGoal?.id !== restoredGoal.id || runtime.activeGoal.status !== "active") return;
						const sent = await sendOwnedGoalPrompt(
							runtime.pi,
							ctx,
							restoredGoal.id,
							buildGoalPrompt(restoredGoal),
							false, // Reloaded queue activation preserves its persisted safety epoch.
						);
						if (!sent && runtime.activeGoal?.id === restoredGoal.id) {
							runtime.activeGoal = transitionGoal(restoredGoal, "paused");
							blockStaleGoalToolCalls();
							persistGoal(runtime.activeGoal);
							updateStatus(ctx, runtime.activeGoal);
						}
					};
				}
				if (runtime.activeGoal.status === "active" && !startRestoredQueuedGoal && event.reason === "reload") {
					requestContinuation(runtime.activeGoal);
					dispatchAfterSuiteReady = async () => {
						if (await whenSuiteSessionReady(pi, ctx)) await dispatchContinuationIfSettled(ctx);
					};
				}
			} else {
				if (runtime.settings.toolVisibility === "after-first-goal" && !runtime.goalToolsUnlocked) {
					hideGoalToolsIfLocked();
				}
				runtime.clearPresentationStatus();
			}
		} finally {
			runtime.endReadOnlySessionStart();
			if (dispatchAfterSuiteReady) {
				void dispatchAfterSuiteReady().catch((error) => {
					ctx.ui.notify(`Goal startup continuation failed: ${formatError(error)}`, "error");
				});
			}
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		goalProjectionNeeded = false;
		turnActive = false;
		clearPendingCompaction();
		runController.unbindSession();
		runtime.closeMenuSession();
		if (runtime.activeGoal) {
			if (!runtime.queueFrozen && runtime.activeGoal.status === "active") {
				updateGoalUsage(runtime.activeGoal, ctx, false);
			}
			persistGoal(runtime.activeGoal);
		}
		clearContinuationTracking();
		clearPendingGoalPrompts();
		runtime.clearAgentRun();
		runtime.guardAbortGoalId = undefined;
		clearGoalRecovery();
		clearBudgetWrapUp();
		clearStaleGoalToolCallBlock();
		runtime.activeGoal = undefined;
		runtime.queuedGoals = [];
		runtime.pendingQueueAction = undefined;
		runtime.queueFrozen = false;
		runtime.queueFreezeAwaitingSettle = false;
		runtime.clearPresentationStatus();
		clearCompletionStatusTimer();
		runtime.clearTerminalDetails();
	});

	pi.on("session_before_compact", (event, ctx) => {
		clearPendingCompaction();
		const suiteNativePreflight = isSuiteNativeCompactionPreflight(ctx);
		if (runtime.queueFrozen) return;
		if (runtime.activeGoal?.status === "budget_limited") {
			if (event.willRetry) return { cancel: true as const };
			return;
		}
		if (runtime.activeGoal?.status !== "active") return;
		if (!updateGoalUsage(runtime.activeGoal, ctx)) return;
		cancelContinuationWork();
		if (!suiteNativePreflight) armCompaction(ctx, runtime.activeGoal.id);
		persistGoal(runtime.activeGoal);
		updateStatus(ctx, runtime.activeGoal);
		if (runtime.pendingQueueAction) return;
		if (limitActiveGoalForBudget(ctx, false)) return { cancel: true as const };
	});

	pi.on("session_compact_failed", (event, ctx) => {
		const pending = pendingCompaction;
		if (!pending || ctx.sessionManager !== pending.sessionManager) return;
		pendingCompaction = undefined;
		if (compactionFailureTimer !== undefined) clearTimeout(compactionFailureTimer);
		compactionFailureTimer = setTimeout(() => {
			compactionFailureTimer = undefined;
			void resumeAfterFailedCompaction(pending, event);
		}, 0);
	});

	pi.on("session_compact", async (event, ctx) => {
		clearPendingCompaction();
		const suiteNativePreflight = isSuiteNativeCompactionPreflight(ctx);
		if (runtime.queueFrozen) return;
		if (runtime.activeGoal?.status !== "active") {
			clearGoalRecovery();
			if (suiteNativePreflight) return;
			if (runtime.pendingQueueAction) await dispatchPendingQueueActionIfSettled(ctx);
			return;
		}

		const restoredState = loadGoalStateFromSession(ctx);
		if (restoredState.goal?.id === runtime.activeGoal.id) {
			runtime.activeGoal = restoredState.goal;
			runtime.queuedGoals = restoredState.queue;
			runtime.pendingQueueAction = restoredState.pendingAction;
		}
		const usageRecorded = updateGoalUsage(runtime.activeGoal, ctx);
		if (usageRecorded) {
			persistGoal(runtime.activeGoal);
			updateStatus(ctx, runtime.activeGoal);
		}
		if (suiteNativePreflight) {
			if (usageRecorded) limitActiveGoalForBudget(ctx, false);
			clearGoalRecoveryForGoal(runtime.activeGoal.id);
			return;
		}
		if (runtime.pendingQueueAction) {
			await dispatchPendingQueueActionIfSettled(ctx);
			return;
		}
		if (!usageRecorded) return;
		if (limitActiveGoalForBudget(ctx, false)) return;

		const wasPiRetry = isPiOwnedCompactionRetry(event, runtime.activeGoal.id);
		if (wasPiRetry) return;
		clearGoalRecoveryForGoal(runtime.activeGoal.id);
		requestContinuation(runtime.activeGoal);
		// Manual compaction does not emit agent_settled. This common dispatcher is
		// therefore the narrow fallback; threshold compaction leaves the intent for
		// agent_settled when Pi is still busy.
		await dispatchContinuationIfSettled(ctx);
	});

	pi.on("input", (event) => {
		if (event.source === "extension") {
			if (consumeCancelledContinuationPrompt(event.text) || consumeStaleOwnedGoalPrompt(event.text)) {
				return { action: "handled" as const };
			}
			if (runtime.queueFrozen) return;
			// Streaming input is queued before its model work starts. Keep owned
			// markers pending for message_start, and track non-goal delivery mode so a
			// steer cannot consume a later follow-up's cleanup protection.
			if (runtime.hasPendingOwnedGoalPrompt(event.text)) return;
			runtime.noteQueuedNonGoalInput(event.text, event.streamingBehavior ?? "idle", "automatic", false);
			return;
		}
		if (runtime.queueFrozen) return;
		if (/^\/goal(?:\s|$)/u.test(event.text.trimStart())) return;
		runtime.noteQueuedNonGoalInput(event.text, event.streamingBehavior ?? "idle", "manual", true);
	});

	pi.on("turn_start", () => {
		turnActive = true;
	});

	pi.on("message_start", (event, ctx) => {
		const message: MessageEnvelope = Check(MESSAGE_ENVELOPE_SCHEMA, event.message) ? event.message : {};
		if (
			message.role === "assistant" &&
			runtime.activeGoal?.status === "paused" &&
			runtime.guardAbortGoalId === runtime.activeGoal.id
		) {
			abortCurrentTurn(ctx);
			return;
		}
		if (message.role === "custom") {
			if (turnActive) runtime.discardQueuedNonGoalInputs(["idle"]);
			if (message.customType === GOAL_PROMPT_MESSAGE_TYPE && isRuntimeString(message.content)) {
				beginPromptRun(message.content, ctx);
				return;
			}
			if (message.customType === GOAL_CONTEXT_MESSAGE_TYPE) return;
			if (runtime.isActiveBudgetWrapUpMessage(message)) return;
			// Idle display-only custom entries also emit message_start. Only messages
			// delivered inside a real Pi turn may mutate Goal lifecycle state.
			if (!turnActive) return;
			const origin = hasDirectUserActivation(message) ? "manual" : "automatic";
			beginNonGoalFollowUp(ctx, origin, origin === "manual");
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
		const ownedPrompt = consumePendingGoalPrompt(prompt);
		const ownedPromptBoundary = runtime.hasOwnedPromptBoundary(prompt);
		const queuedNonGoalInput = runtime.consumeQueuedNonGoalInput(prompt, !ownedPromptBoundary, [
			"steer",
			"followUp",
			"idle",
		]);
		if (!ownedPrompt) {
			if (queuedNonGoalInput?.behavior === "idle") {
				beginNonGoalIdle(ctx, queuedNonGoalInput.origin, queuedNonGoalInput.resetSafetyEpoch);
			} else if (queuedNonGoalInput?.behavior === "followUp") {
				beginNonGoalFollowUp(ctx, queuedNonGoalInput.origin, queuedNonGoalInput.resetSafetyEpoch);
			} else if (queuedNonGoalInput?.behavior === "steer") {
				beginNonGoalSteer(ctx, queuedNonGoalInput.origin, queuedNonGoalInput.resetSafetyEpoch);
			}
			return;
		}
		if (runtime.activeGoal?.id !== ownedPrompt.goalId || runtime.activeGoal.status !== "active") {
			return;
		}
		if (runtime.agentRunGoalId !== undefined && runtime.agentRunGoalId !== ownedPrompt.goalId) {
			runtime.activeGoal.baselineTokens = Math.max(0, currentTokenTotal(ctx) - runtime.activeGoal.tokensUsed);
		}
		runtime.beginAgentRun(ownedPrompt.goalId, ownedPrompt.origin);
		if (ownedPrompt.resetSafetyEpoch) {
			runtime.activeGoal = resetGoalSafetyEpoch(runtime.activeGoal);
		}
		persistGoal(runtime.activeGoal);
		updateStatus(ctx, runtime.activeGoal);
	});

	pi.on("context", (event, ctx) => {
		if (!goalProjectionNeeded) return;
		const latestGoalContextIndex = findLatestGoalContextIndex(event.messages);
		const messages = event.messages.filter(
			(message, index) =>
				keepBudgetWrapUpMessage(message) && (!isGoalContextMessage(message) || index === latestGoalContextIndex),
		);
		if (runtime.activeGoal?.status === "paused" && runtime.guardAbortGoalId === runtime.activeGoal.id) {
			// A current custom follow-up clears the guard at message_start. Otherwise,
			// context transformation aborts before the provider adapter receives the signal.
			abortCurrentTurn(ctx);
		}
		if (messages.length !== event.messages.length) return { messages };
	});

	pi.on("tool_call", (event, ctx) => {
		runtime.markAgentToolAttempted();
		if (runtime.queueFrozen) {
			if (!isGoalToolName(event.toolName)) return;
			// Blocking alone feeds an error tool result back to the model. Abort too so
			// stale Goal calls cannot loop while the experimental queue remains frozen.
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
			// A blocked tool result would normally trigger another model call. Abort the
			// wrap-up instead so a tool-seeking model cannot create an unbounded loop.
			abortCurrentTurn(ctx);
			return {
				block: true,
				reason: "Goal token budget is exhausted; only goal_complete is allowed during wrap-up.",
			};
		}
		if (!runtime.staleGoalToolCallsBlocked) return;
		if (!runtime.activeGoal || !blocksStaleGoalToolCalls(runtime.activeGoal.status)) {
			clearStaleGoalToolCallBlock();
			return;
		}
		// A blocked tool result would normally trigger another model call. Abort the
		// current turn so a tool-seeking model cannot create an unbounded loop that
		// burns provider quota while the goal is stopped.
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
			queueBudgetWrapUp(ctx, runtime.activeGoal);
			return;
		}
		if (runtime.activeGoal?.status !== "active") return;

		// AgentSession persists assistant message_end before tool execution events,
		// so the completed assistant call's usage is authoritative at this boundary.
		if (!updateGoalUsage(runtime.activeGoal, ctx)) return;
		persistGoal(runtime.activeGoal);
		updateStatus(ctx, runtime.activeGoal);
		if (limitActiveGoalForBudget(ctx, true)) return;
		if (!goalToolsAvailable()) pauseGoalForUnavailableTools(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		runtime.flushDeferredSessionStartState();
		const activeGoal = beginPromptRun(event.prompt, ctx);
		if (!activeGoal) return;
		goalProjectionNeeded = true;
		return {
			message: {
				customType: GOAL_CONTEXT_MESSAGE_TYPE,
				content: buildGoalSystemPrompt(activeGoal),
				display: false,
			},
		};
	});

	function beginPromptRun(prompt: string, ctx: StatusContext): ActiveGoal | undefined {
		runtime.clearAgentRun();
		if (consumeCancelledContinuationPrompt(prompt) || consumeStaleOwnedGoalPrompt(prompt)) {
			runtime.beginAgentRun(null, undefined);
			abortCurrentTurn(ctx);
			return;
		}
		if (runtime.queueFrozen) return;
		// Pi-owned retry/compaction recovery re-enters through agent_start without a
		// fresh prompt boundary. Reaching beginPromptRun is therefore authority that
		// a different accepted run superseded any stale recovery ticket.
		clearGoalRecovery();
		// Pi-owned retries emit agent_start directly. Reaching a normal prompt
		// boundary means cleanup no longer owns the next run, so the hard-cap guard
		// must not abort it.
		if (runtime.guardAbortGoalId) runtime.guardAbortGoalId = undefined;
		const goalPrompt = consumePendingGoalPrompt(prompt);
		const goalPromptGoalId = goalPrompt?.goalId;
		const continuationGoalId = goalPromptGoalId ? undefined : markContinuationStarted(prompt);
		const ownedPromptGoalId = goalPromptGoalId ?? continuationGoalId;
		const activeBudgetWrapUp = runtime.hasActiveBudgetWrapUp();
		const runOrigin = continuationGoalId ? "automatic" : (goalPrompt?.origin ?? "automatic");
		if (runtime.pendingQueueAction?.kind === "prioritize" && !activeBudgetWrapUp) {
			// A turn that starts after priority intent is committed belongs to neither
			// the displaced goal nor the not-yet-activated urgent goal. Persist the
			// displaced goal's final accounting boundary so reload cannot absorb this run.
			if (!runtime.pendingQueueAction.displacedUsageFinalized) {
				if (runtime.activeGoal?.status === "active") {
					updateGoalUsage(runtime.activeGoal, ctx, false);
				}
				runtime.pendingQueueAction.displacedUsageFinalized = true;
				if (runtime.activeGoal) {
					persistGoal(runtime.activeGoal);
					updateStatus(ctx, runtime.activeGoal);
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
		if (
			runtime.pendingQueueAction?.kind === "advance" &&
			runtime.pendingQueueAction.goalId === runtime.activeGoal?.id
		) {
			runtime.beginAgentRun(ownedPromptGoalId ?? runtime.activeGoal.id, runOrigin);
			if (ownedPromptGoalId) abortCurrentTurn(ctx);
			return;
		}
		if (ownedPromptGoalId && ownedPromptGoalId !== runtime.activeGoal?.id) {
			runtime.beginAgentRun(ownedPromptGoalId, runOrigin);
			if (runtime.activeGoal?.status === "active" && !goalToolsAvailable()) {
				pauseGoalForUnavailableTools(ctx, false);
			}
			abortCurrentTurn(ctx);
			return;
		}
		if (runtime.activeGoal?.status !== "active") return;
		runtime.beginAgentRun(runtime.activeGoal.id, runOrigin);
		if (!goalToolsAvailable()) {
			pauseGoalForUnavailableTools(ctx, ownedPromptGoalId !== undefined);
			return;
		}
		if (goalPrompt?.resetSafetyEpoch && goalPromptGoalId === runtime.activeGoal.id) {
			runtime.activeGoal = resetGoalSafetyEpoch(runtime.activeGoal);
			persistGoal(runtime.activeGoal);
			updateStatus(ctx, runtime.activeGoal);
		}
		return runtime.activeGoal;
	}

	pi.on("agent_start", (_event, _ctx) => {
		if (runtime.queueFrozen) return;
		const activeGoal = runtime.activeGoal;
		if (activeGoal && runtime.guardAbortGoalId === activeGoal.id && activeGoal.status === "paused") {
			// Delivery-specific cleanup waits for message_start. An input mirror may
			// belong to a prompt handled by a later Extension and is not authority here.
			return;
		}
		runtime.beginRecoveryRunIfNeeded();
	});

	pi.on("turn_end", (event, ctx) => {
		turnActive = false;
		if (runtime.queueFrozen) return;
		recordAutomaticTurn(ctx, event.message);
	});

	pi.on("agent_end", (event, ctx) => {
		const run = runtime.finishAgentRun();
		if (runtime.queueFrozen || run.goalId === null) return;
		if (!runtime.canRecordGoalUsage() && !runtime.hasActiveBudgetWrapUp()) return;
		if (run.goalId && run.goalId !== runtime.activeGoal?.id) return;
		if (!runtime.activeGoal) return;
		if (runtime.activeGoal.status === "budget_limited" && runtime.budgetWrapUp?.goalId === runtime.activeGoal.id) {
			updateGoalUsage(runtime.activeGoal, ctx);
			persistGoal(runtime.activeGoal);
			updateStatus(ctx, runtime.activeGoal);
			clearBudgetWrapUp();
			return;
		}
		if (runtime.activeGoal.status !== "active") return;
		if (
			runtime.pendingQueueAction?.kind === "advance" &&
			runtime.pendingQueueAction.goalId === runtime.activeGoal.id
		) {
			updateGoalUsage(runtime.activeGoal, ctx);
			persistGoal(runtime.activeGoal);
			updateStatus(ctx, runtime.activeGoal);
			return;
		}

		const goalId = runtime.activeGoal.id;
		const alreadyAwaitingContinuation = hasContinuationWorkForGoal(goalId);
		const finalAssistant = findFinalAssistantMessage(event.messages);

		if (!alreadyAwaitingContinuation) runtime.activeGoal = incrementGoal(runtime.activeGoal);
		updateGoalUsage(runtime.activeGoal, ctx);

		if (finalAssistant?.stopReason === "aborted") {
			clearGoalRecoveryForGoal(goalId);
			stopGoalAfterAgentEnd(ctx, runtime.activeGoal, finalAssistant, "paused");
			return;
		}

		if (finalAssistant?.stopReason === "error") {
			if (isRetryableGoalInterruption(finalAssistant)) {
				if (run.origin === "automatic" && enforceAutomaticTurnLimit(ctx, true)) return;
				if (limitActiveGoalForBudget(ctx, false)) return;
				if (!goalToolsAvailable()) {
					pauseGoalForUnavailableTools(ctx);
					return;
				}
				runtime.goalRecovery = {
					goalId,
					kind: isGoalContextOverflow(finalAssistant) ? "compaction_retry" : "provider_retry",
					automaticOwner: run.origin === "automatic",
					errorMessage: finalAssistant.errorMessage,
				};
				cancelContinuationWork();
				persistGoal(runtime.activeGoal);
				updateStatus(ctx, runtime.activeGoal);
				return;
			}
			clearGoalRecoveryForGoal(goalId);
			if (isUsageLimitedGoalInterruption(finalAssistant) || isExternallyBlockedGoalInterruption(finalAssistant)) {
				stopGoalAfterAgentEnd(
					ctx,
					runtime.activeGoal,
					finalAssistant,
					isUsageLimitedGoalInterruption(finalAssistant) ? "usage_limited" : "paused",
				);
				return;
			}
			runtime.goalRecovery = {
				goalId,
				kind: "provider_retry",
				automaticOwner: run.origin === "automatic",
				errorMessage: finalAssistant.errorMessage,
			};
			cancelContinuationWork();
			persistGoal(runtime.activeGoal);
			updateStatus(ctx, runtime.activeGoal);
			return;
		}

		clearGoalRecoveryForGoal(goalId);

		if (limitActiveGoalForBudget(ctx, false)) return;
		if (!goalToolsAvailable()) {
			pauseGoalForUnavailableTools(ctx);
			return;
		}
		if (
			run.origin === "automatic" &&
			recordAutomaticRunProgress(
				ctx,
				goalId,
				event.messages,
				run.toolAttempted || hasAssistantToolCall(event.messages),
			)
		) {
			return;
		}

		persistGoal(runtime.activeGoal);
		updateStatus(ctx, runtime.activeGoal);

		const currentGoal = runtime.activeGoal;
		if (!currentGoal || currentGoal.id !== goalId || currentGoal.status !== "active") return;
		if (runtime.pendingQueueAction?.kind === "prioritize") return;
		requestContinuation(currentGoal);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		turnActive = false;
		if (runtime.queueFrozen) {
			runtime.clearSettledSafetyTracking();
			runtime.queueFreezeAwaitingSettle = false;
			if (runtime.settings.experimental.goals) {
				await commands.resumeQueueAfterUnfreeze(ctx);
			}
			return;
		}
		runtime.finalizeSettledRecovery(ctx);
		let dispatchedQueueAction = false;
		if (runtime.pendingQueueAction) {
			dispatchedQueueAction = await dispatchPendingQueueActionIfSettled(ctx);
		}
		if (!dispatchedQueueAction) await dispatchContinuationIfSettled(ctx);
		runtime.clearSettledSafetyTracking();
	});

	function prepareNonGoalDelivery(ctx: StatusContext, resetSafetyEpoch: boolean) {
		clearGoalRecovery();
		runtime.guardAbortGoalId = undefined;
		clearStaleGoalToolCallBlock();
		if (resetSafetyEpoch) clearBudgetWrapUp();
		if (resetSafetyEpoch) runtime.resetActiveSafetyEpoch(ctx);
	}

	function beginNonGoalIdle(ctx: StatusContext, _origin: GoalRunOrigin, resetSafetyEpoch: boolean) {
		prepareNonGoalDelivery(ctx, resetSafetyEpoch);
	}

	function beginNonGoalSteer(ctx: StatusContext, _origin: GoalRunOrigin, resetSafetyEpoch: boolean) {
		prepareNonGoalDelivery(ctx, resetSafetyEpoch);
	}

	function beginNonGoalFollowUp(ctx: StatusContext, origin: GoalRunOrigin, resetSafetyEpoch: boolean) {
		clearGoalRecovery();
		runtime.guardAbortGoalId = undefined;
		clearStaleGoalToolCallBlock();
		if (resetSafetyEpoch) clearBudgetWrapUp();
		const activeGoalId = runtime.activeGoal?.status === "active" ? runtime.activeGoal.id : undefined;
		runtime.beginAgentRun(activeGoalId ?? null, activeGoalId ? origin : undefined);
		if (resetSafetyEpoch && activeGoalId) runtime.resetActiveSafetyEpoch(ctx);
	}

	function stopGoalAfterAgentEnd(
		ctx: StatusContext,
		goal: ActiveGoal,
		assistant: AssistantMessageLike,
		status: "paused" | "usage_limited",
	) {
		cancelContinuationWork();
		clearBudgetWrapUp();
		blockStaleGoalToolCalls();
		abortCurrentTurn(ctx);
		runtime.activeGoal = transitionGoal(goal, status);
		runtime.setTerminalReason(
			runtime.activeGoal.id,
			assistant.errorMessage ?? `goal ${status} after agent interruption`,
		);
		persistGoal(runtime.activeGoal);
		updateStatus(ctx, runtime.activeGoal);

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

type GoalContextMessage = ContextEvent["messages"][number];

function isGoalContextMessage(message: GoalContextMessage) {
	return (
		message.role === "custom" &&
		(message.customType === GOAL_PROMPT_MESSAGE_TYPE || message.customType === GOAL_CONTEXT_MESSAGE_TYPE)
	);
}

function findLatestGoalContextIndex(messages: readonly GoalContextMessage[]) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message && isGoalContextMessage(message)) return index;
	}
	return -1;
}
