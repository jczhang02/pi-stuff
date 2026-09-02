import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Cause from "effect/Cause";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { HOST_SHUTDOWN_GRACE_MS } from "../lifecycle-deadline.js";
import type { EffectFoundation, EffectScopeOwner } from "../shared/effect-foundation.js";

function exitError<E>(exit: Exit.Exit<unknown, E>): Error | undefined {
	if (Exit.isSuccess(exit) || Cause.hasInterrupts(exit.cause)) return undefined;
	const cause = Cause.squash(exit.cause);
	return cause instanceof Error ? cause : new Error(String(cause));
}

export interface FastResumeOperationOwner {
	fork(program: Effect.Effect<void, Error>, onSettled: (error?: Error) => void): () => void;
	run<A>(program: Effect.Effect<A, Error>): Promise<A>;
}

export class FastResumeEffectOwner implements FastResumeOperationOwner {
	private capability: EffectScopeOwner | undefined;
	private readonly foundation: EffectFoundation;

	constructor(foundation: EffectFoundation) {
		this.foundation = foundation;
	}

	bindSession(context: ExtensionContext): void {
		const session = this.foundation.sessionFor(context.sessionManager);
		if (!session) throw new Error("Fast Resume Session Scope was not initialized.");
		this.capability = this.foundation.forkCapability(session);
	}

	async run<A>(program: Effect.Effect<A, Error>): Promise<A> {
		const capability = this.capability;
		if (!capability || !this.foundation.isCurrent(capability)) throw new Error("Fast Resume is not active.");
		const operation = this.foundation.forkOperation(capability);
		const exit = await this.foundation.run(operation, program);
		await this.foundation.close(operation, exit);
		if (Exit.isSuccess(exit)) return exit.value;
		throw exitError(exit) ?? new Error("Fast Resume operation was interrupted.");
	}

	fork(program: Effect.Effect<void, Error>, onSettled: (error?: Error) => void): () => void {
		const capability = this.capability;
		if (!capability || !this.foundation.isCurrent(capability)) return () => undefined;
		const operation = this.foundation.forkOperation(capability);
		void this.foundation.run(operation, program).then(async (exit) => {
			await this.foundation.close(operation, exit);
			const error = exitError(exit);
			onSettled(error);
		});
		return () => {
			void this.foundation.close(operation, Exit.interrupt());
		};
	}

	async shutdown(): Promise<void> {
		const capability = this.capability;
		this.capability = undefined;
		if (capability) await this.foundation.close(capability, Exit.interrupt(), HOST_SHUTDOWN_GRACE_MS);
	}
}
