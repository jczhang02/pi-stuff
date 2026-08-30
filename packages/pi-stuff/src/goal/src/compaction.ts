import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { isSuiteNativeCompactionPreflight } from "../../conversation-ui/index.js";
import type { GoalCommandController } from "./commands.js";
import { loadGoalStateFromSession } from "./persistence.js";
import type { GoalCompactionEvent, GoalRuntime, StatusContext } from "./runtime.js";

type GoalCompactionContext = ExtensionContext & StatusContext;

interface PendingCompaction {
	readonly ctx: GoalCompactionContext;
	readonly generation: number;
	readonly goalId: string;
	readonly sessionManager: ExtensionContext["sessionManager"];
}

export class GoalCompactionCoordinator {
	private readonly runtime: GoalRuntime;
	private readonly commands: GoalCommandController;
	private generation = 0;
	private pending: PendingCompaction | undefined;

	constructor(runtime: GoalRuntime, commands: GoalCommandController) {
		this.runtime = runtime;
		this.commands = commands;
	}

	clear(): void {
		this.generation++;
		this.pending = undefined;
	}

	before(event: GoalCompactionEvent, ctx: GoalCompactionContext): { cancel: true } | undefined {
		this.clear();
		const suiteNativePreflight = isSuiteNativeCompactionPreflight(ctx);
		if (this.runtime.queueFrozen) return;
		if (this.runtime.activeGoal?.status === "budget_limited") {
			return event.willRetry ? { cancel: true } : undefined;
		}
		if (this.runtime.activeGoal?.status !== "active") return;
		if (!this.runtime.recordGoalUsage(this.runtime.activeGoal, ctx)) return;
		this.runtime.prompts.cancelContinuationWork();
		if (!suiteNativePreflight) this.arm(ctx, this.runtime.activeGoal.id);
		this.runtime.persistGoal(this.runtime.activeGoal);
		if (this.runtime.pendingQueueAction) return;
		if (this.runtime.limitActiveGoalForBudget(ctx)) return { cancel: true };
	}

	failed(event: GoalCompactionEvent, ctx: GoalCompactionContext): Effect.Effect<void, unknown> | undefined {
		const pending = this.pending;
		if (!pending || ctx.sessionManager !== pending.sessionManager) return;
		this.pending = undefined;
		return Effect.sleep(0).pipe(Effect.andThen(this.resumeAfterFailure(pending, event)));
	}

	complete(event: GoalCompactionEvent, ctx: GoalCompactionContext): Effect.Effect<void, unknown> {
		return Effect.gen({ self: this }, function* () {
			this.clear();
			const suiteNativePreflight = isSuiteNativeCompactionPreflight(ctx);
			if (this.runtime.queueFrozen) return;
			if (this.runtime.activeGoal?.status !== "active") {
				this.runtime.goalRecovery = undefined;
				if (!suiteNativePreflight && this.runtime.pendingQueueAction) {
					yield* this.commands.dispatchPendingQueueActionIfSettled(ctx);
				}
				return;
			}

			const restoredState = loadGoalStateFromSession(ctx);
			if (restoredState.goal?.id === this.runtime.activeGoal.id) {
				this.runtime.activeGoal = restoredState.goal;
				this.runtime.queuedGoals = restoredState.queue;
				this.runtime.pendingQueueAction = restoredState.pendingAction;
			}
			const usageRecorded = this.runtime.recordGoalUsage(this.runtime.activeGoal, ctx);
			if (usageRecorded) this.runtime.persistGoal(this.runtime.activeGoal);
			if (suiteNativePreflight) {
				if (usageRecorded) this.runtime.limitActiveGoalForBudget(ctx);
				this.runtime.clearGoalRecoveryForGoal(this.runtime.activeGoal.id);
				return;
			}
			if (this.runtime.pendingQueueAction) {
				yield* this.commands.dispatchPendingQueueActionIfSettled(ctx);
				return;
			}
			if (!usageRecorded || this.runtime.limitActiveGoalForBudget(ctx)) return;
			if (this.runtime.isPiOwnedCompactionRetry(event, this.runtime.activeGoal.id)) return;
			this.runtime.clearGoalRecoveryForGoal(this.runtime.activeGoal.id);
			this.runtime.prompts.requestContinuation(this.runtime.activeGoal);
			// Manual compaction does not emit agent_settled, so dispatch from this settled fallback.
			yield* this.runtime.dispatchContinuationIfSettled(ctx);
		});
	}

	private arm(ctx: GoalCompactionContext, goalId: string): void {
		this.pending = { ctx, generation: this.generation, goalId, sessionManager: ctx.sessionManager };
	}

	private resumeAfterFailure(pending: PendingCompaction, event: GoalCompactionEvent): Effect.Effect<void, unknown> {
		return Effect.gen({ self: this }, function* () {
			const waitForIdle = pending.ctx.waitForIdle;
			if (waitForIdle) {
				yield* Effect.catch(
					Effect.tryPromise({
						try: waitForIdle,
						catch: (error) => (error instanceof Error ? error : new Error(String(error))),
					}),
					() => Effect.void,
				);
			}
			if (pending.generation !== this.generation) return;
			const activeGoal = this.runtime.activeGoal;
			if (!activeGoal || activeGoal.id !== pending.goalId || activeGoal.status !== "active") return;
			if (this.runtime.pendingQueueAction) {
				yield* this.commands.dispatchPendingQueueActionIfSettled(pending.ctx);
				return;
			}
			if (this.runtime.isPiOwnedCompactionRetry(event, activeGoal.id)) return;
			this.runtime.clearGoalRecoveryForGoal(activeGoal.id);
			this.runtime.prompts.requestContinuation(activeGoal);
			yield* this.runtime.dispatchContinuationIfSettled(pending.ctx);
		});
	}
}
