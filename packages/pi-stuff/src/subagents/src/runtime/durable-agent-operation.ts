import { Effect, Fiber } from "effect";

const RETRY_DELAYS_MS = [25, 100, 500, 2_000] as const;

export interface DurableAgentOperation {
	retryIndex: number;
	retryFiber?: Fiber.Fiber<void, unknown>;
	inFlight?: Fiber.Fiber<void, unknown>;
}

/** Owns retry and in-flight fibers for a durable ledger record across Pi Session changes. */
export function runDurableAgentOperation(
	operation: DurableAgentOperation,
	isPending: () => boolean,
	attempt: () => Effect.Effect<void, unknown>,
): Effect.Effect<void, unknown> {
	if (!isPending()) return Effect.void;
	if (operation.inFlight) return Fiber.join(operation.inFlight);
	const inFlight = Effect.runFork(Effect.suspend(attempt));
	operation.inFlight = inFlight;
	inFlight.addObserver(() => {
		if (operation.inFlight === inFlight) delete operation.inFlight;
	});
	return Fiber.join(inFlight);
}

export function scheduleDurableAgentOperation(
	operation: DurableAgentOperation,
	isPending: () => boolean,
	attempt: () => Effect.Effect<void, unknown>,
): void {
	if (!isPending() || operation.retryFiber) return;
	const delay = RETRY_DELAYS_MS[Math.min(operation.retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 2_000;
	operation.retryIndex += 1;
	let retryFiber!: Fiber.Fiber<void, unknown>;
	retryFiber = Effect.runFork(
		Effect.sleep(delay).pipe(
			Effect.andThen(
				Effect.sync(() => {
					if (operation.retryFiber === retryFiber) delete operation.retryFiber;
				}),
			),
			Effect.andThen(Effect.suspend(() => runDurableAgentOperation(operation, isPending, attempt))),
			Effect.catch(() => Effect.sync(() => scheduleDurableAgentOperation(operation, isPending, attempt))),
		),
	);
	operation.retryFiber = retryFiber;
	retryFiber.addObserver(() => {
		if (operation.retryFiber === retryFiber) delete operation.retryFiber;
	});
}

export function stopDurableAgentOperation(operation: DurableAgentOperation): void {
	const retryFiber = operation.retryFiber;
	delete operation.retryFiber;
	if (retryFiber) Effect.runFork(Fiber.interrupt(retryFiber));
}
