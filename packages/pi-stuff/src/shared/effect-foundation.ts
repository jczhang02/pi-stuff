import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect, Exit, Fiber, Option, Scope } from "effect";
import { HOST_SHUTDOWN_GRACE_MS } from "../lifecycle-deadline.js";
import { getHostSharedResource } from "./host-resource.js";

const EFFECT_FOUNDATION_DISCOVERY_EVENT = "@jczhang02/pi-stuff/effect-foundation-discovery/v1";
const FOUNDATIONS = new WeakMap<object, EffectFoundation>();
const SCOPE = Symbol("PiStuffEffectScope");

export type EffectScopeKind = "session" | "capability" | "operation";

export interface EffectScopeOwner {
	readonly generation: number;
	readonly kind: EffectScopeKind;
	readonly [SCOPE]: Scope.Closeable;
}

function owner(kind: EffectScopeKind, generation: number, scope: Scope.Closeable): EffectScopeOwner {
	return { generation, kind, [SCOPE]: scope };
}

export class EffectFoundation {
	private readonly root = Scope.makeUnsafe("sequential");
	private readonly shutdownGraceMs: number;
	private closed = false;
	private generation = 0;
	private session: EffectScopeOwner | undefined;
	private shutdownResult: Promise<boolean> | undefined;

	constructor(shutdownGraceMs = HOST_SHUTDOWN_GRACE_MS) {
		this.shutdownGraceMs = shutdownGraceMs;
	}

	currentSession(): EffectScopeOwner | undefined {
		return this.session;
	}

	async startSession(): Promise<EffectScopeOwner> {
		if (this.closed) throw new Error("Effect foundation is closed.");
		const previous = this.session;
		this.generation += 1;
		const session = owner("session", this.generation, Scope.forkUnsafe(this.root, "sequential"));
		this.session = session;
		if (previous) await this.close(previous, Exit.interrupt(), this.shutdownGraceMs);
		return session;
	}

	forkCapability(): EffectScopeOwner {
		return this.fork("capability", this.requireSession());
	}

	forkOperation(parent: EffectScopeOwner = this.requireSession()): EffectScopeOwner {
		if (parent.kind === "operation") throw new Error("An operation Scope cannot own another operation Scope.");
		return this.fork("operation", parent);
	}

	isCurrent(scope: EffectScopeOwner): boolean {
		return !this.closed && scope.generation === this.session?.generation && scope[SCOPE].state._tag !== "Closed";
	}

	run<A, E>(
		scope: EffectScopeOwner,
		program: Effect.Effect<A, E, Scope.Scope>,
		options?: Effect.RunOptions,
	): Promise<Exit.Exit<A, E>> {
		if (!this.isCurrent(scope)) return Promise.resolve(Exit.interrupt());
		const attached = Effect.gen(function* () {
			const fiber = yield* Effect.forkIn(Scope.provide(scope[SCOPE])(program), scope[SCOPE]);
			return yield* Fiber.join(fiber);
		});
		return Effect.runPromiseExit(attached, options);
	}

	async close(
		scope: EffectScopeOwner,
		exit: Exit.Exit<unknown, unknown> = Exit.void,
		timeoutMs?: number,
	): Promise<boolean> {
		const finalizers = Scope.closeUnsafe(scope[SCOPE], exit);
		if (!finalizers) return true;
		return this.settleFinalizers(finalizers, timeoutMs);
	}

	shutdown(): Promise<boolean> {
		if (this.shutdownResult) return this.shutdownResult;
		this.closed = true;
		this.generation += 1;
		this.session = undefined;
		const finalizers = Scope.closeUnsafe(this.root, Exit.interrupt());
		this.shutdownResult = finalizers
			? this.settleFinalizers(finalizers, this.shutdownGraceMs)
			: Promise.resolve(true);
		return this.shutdownResult;
	}

	private fork(kind: "capability" | "operation", parent: EffectScopeOwner): EffectScopeOwner {
		if (!this.isCurrent(parent)) throw new Error(`Cannot create ${kind} Scope from a stale owner.`);
		return owner(kind, parent.generation, Scope.forkUnsafe(parent[SCOPE], "sequential"));
	}

	private requireSession(): EffectScopeOwner {
		const session = this.session;
		if (!session || !this.isCurrent(session)) throw new Error("No current Effect Session Scope.");
		return session;
	}

	private settleFinalizers(finalizers: Effect.Effect<void>, timeoutMs?: number): Promise<boolean> {
		const completed = Effect.map(Effect.exit(finalizers), () => true);
		return Effect.runPromise(
			timeoutMs === undefined
				? completed
				: completed.pipe(Effect.timeoutOption(Math.max(0, timeoutMs)), Effect.map(Option.isSome)),
		);
	}
}

/** Install or discover the Effect foundation owned by this Host event bus. */
export function installEffectFoundation(pi: ExtensionAPI): EffectFoundation {
	return getHostSharedResource(
		pi.events,
		FOUNDATIONS,
		EFFECT_FOUNDATION_DISCOVERY_EVENT,
		() => {
			const foundation = new EffectFoundation();
			pi.on("session_start", async () => {
				await foundation.startSession();
			});
			pi.on("session_shutdown", async () => {
				await foundation.shutdown();
			});
			return foundation;
		},
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
}
