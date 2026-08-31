import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

export type McpEffectRunner = <Value, ErrorValue>(
	program: Effect.Effect<Value, ErrorValue>,
	signal?: AbortSignal,
) => Promise<Value>;

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
}

function failOnAbort(signal: AbortSignal): Effect.Effect<never, Error> {
	return Effect.callback<never, Error>((resume) => {
		const abort = () => resume(Effect.fail(abortReason(signal)));
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		return Effect.sync(() => signal.removeEventListener("abort", abort));
	});
}

export function mcpNativePromise<Value>(
	request: (signal: AbortSignal) => PromiseLike<Value>,
	signal?: AbortSignal,
): Effect.Effect<Value, Error> {
	return Effect.suspend(() => {
		if (signal?.aborted) return Effect.fail(abortReason(signal));
		const native = Effect.tryPromise({
			try: (effectSignal) => request(signal ? AbortSignal.any([signal, effectSignal]) : effectSignal),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
		return signal ? Effect.raceFirst(native, failOnAbort(signal)) : native;
	});
}

export function runMcpEffectExit<Value, ErrorValue>(
	program: Effect.Effect<Value, ErrorValue>,
	signal?: AbortSignal,
): Promise<Exit.Exit<Value, ErrorValue>> {
	return Effect.runPromiseExit(program, { signal });
}

/** Project an MCP Effect back into the Promise and AbortSignal contract owned by Pi. */
export const runMcpEffect: McpEffectRunner = async (program, signal) => {
	const exit = await runMcpEffectExit(program, signal);
	if (Exit.isSuccess(exit)) return exit.value;

	const failure = Cause.findErrorOption(exit.cause);
	if (signal?.aborted) {
		if (Option.isSome(failure) && failure.value instanceof AggregateError) throw failure.value;
		throw signal.reason;
	}
	if (Option.isSome(failure)) throw failure.value;
	throw Cause.squash(exit.cause);
};
