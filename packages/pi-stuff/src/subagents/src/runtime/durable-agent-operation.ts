import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type { AgentEffectOwner, AgentEffectTask } from "./agent-effect-owner.ts";

const RETRY_DELAYS_MS = [25, 100, 500, 2_000] as const;

export interface DurableAgentOperation {
	retryIndex: number;
	retryTask?: AgentEffectTask<void, unknown>;
	inFlight?: Deferred.Deferred<void, unknown>;
}

/** Owns retry and in-flight fibers for a durable ledger record across Pi Session changes. */
export function runDurableAgentOperation(
	operation: DurableAgentOperation,
	isPending: () => boolean,
	attempt: () => Effect.Effect<void, unknown>,
): Effect.Effect<void, unknown> {
	if (!isPending()) return Effect.void;
	if (operation.inFlight) return Deferred.await(operation.inFlight);
	const inFlight = Deferred.makeUnsafe<void, unknown>();
	operation.inFlight = inFlight;
	return Effect.suspend(attempt).pipe(
		Effect.onExit((exit) =>
			Effect.sync(() => {
				if (operation.inFlight === inFlight) delete operation.inFlight;
			}).pipe(Effect.andThen(Deferred.done(inFlight, exit))),
		),
	);
}

export function scheduleDurableAgentOperation(
	effects: AgentEffectOwner,
	operation: DurableAgentOperation,
	isPending: () => boolean,
	attempt: () => Effect.Effect<void, unknown>,
): void {
	if (!isPending() || operation.retryTask) return;
	const delay = RETRY_DELAYS_MS[Math.min(operation.retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 2_000;
	operation.retryIndex += 1;
	let retryTask: AgentEffectTask<void, unknown>;
	const program = Effect.sleep(delay).pipe(
		Effect.andThen(
			Effect.sync(() => {
				if (operation.retryTask === retryTask) delete operation.retryTask;
			}),
		),
		Effect.andThen(Effect.suspend(attempt)),
		Effect.catch(() => Effect.sync(() => scheduleDurableAgentOperation(effects, operation, isPending, attempt))),
	);
	try {
		retryTask = effects.start(program);
	} catch {
		return;
	}
	operation.retryTask = retryTask;
	void retryTask.result.then(() => {
		if (operation.retryTask === retryTask) delete operation.retryTask;
	});
}

export function stopDurableAgentOperation(operation: DurableAgentOperation, interrupt = false): void {
	const retryTask = operation.retryTask;
	delete operation.retryTask;
	if (interrupt && retryTask) void retryTask.interrupt();
}
