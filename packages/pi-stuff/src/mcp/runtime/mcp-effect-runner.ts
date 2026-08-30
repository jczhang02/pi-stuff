import { Cause, Effect, Exit, Option } from "effect";

export type McpEffectRunner = <Value, ErrorValue>(
	program: Effect.Effect<Value, ErrorValue>,
	signal?: AbortSignal,
) => Promise<Value>;

/** Project an MCP Effect back into the Promise and AbortSignal contract owned by Pi. */
export const runMcpEffect: McpEffectRunner = async (program, signal) => {
	const exit = await Effect.runPromiseExit(program, { signal });
	if (Exit.isSuccess(exit)) return exit.value;

	const failure = Cause.findErrorOption(exit.cause);
	if (signal?.aborted) {
		if (Option.isSome(failure) && failure.value instanceof AggregateError) throw failure.value;
		throw signal.reason;
	}
	if (Option.isSome(failure)) throw failure.value;
	throw Cause.squash(exit.cause);
};
