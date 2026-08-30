import type { ContextEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Deferred, Effect } from "effect";
import {
	type AgentMessage,
	type ContextProjection,
	type ContextProjectionAudience,
	type ContextProjectionOptions,
	currentAgentMessages,
	estimateProjectionTokens,
	extractMagicProjection,
	formatProjection,
	nativeProjection,
	projectionKey,
	projectMemoryOnly,
} from "./projection-format.js";

export type { ContextProjection, ContextProjectionAudience, ContextProjectionOptions };
export { estimateProjectionTokens, extractMagicProjection, formatProjection, nativeProjection };

export interface MagicContextEventResult {
	readonly messages?: AgentMessage[];
}

export interface MagicProjectionAttempt {
	readonly full: string | undefined;
	readonly result: MagicContextEventResult | undefined;
}

export type MagicContextHandler = (
	event: ContextEvent,
	ctx: ExtensionContext,
) => MagicContextEventResult | undefined | Promise<MagicContextEventResult | undefined>;

interface ProjectionHostSnapshot {
	readonly active: boolean;
	readonly generation: number;
	readonly handler: MagicContextHandler | undefined;
}

type ContextProjectionTrigger = "automatic-turn" | "projection";

interface ContextProjectionRuntimeHost {
	readonly activate: (ctx: ExtensionContext) => Effect.Effect<void>;
	readonly current: () => ProjectionHostSnapshot;
	readonly fail: (error: Error, trigger: ContextProjectionTrigger) => void;
	readonly quietContext: (ctx: ExtensionContext) => ExtensionContext;
	readonly succeed: (trigger: ContextProjectionTrigger) => void;
}

interface ProjectionFlight {
	readonly generation: number;
	readonly deferred: Deferred.Deferred<string | undefined>;
}

export class ContextProjectionRuntime {
	private generation = 0;
	private readonly flights = new Map<string, ProjectionFlight>();
	private readonly host: ContextProjectionRuntimeHost;
	/** Last valid project-memory snapshot, captured only by the normal Magic context event. */
	private readonly memories = new Map<string, string>();
	private readonly projections = new Map<string, string>();

	constructor(host: ContextProjectionRuntimeHost) {
		this.host = host;
	}

	invalidate(clearMemories: boolean): number {
		this.generation++;
		for (const { deferred } of this.flights.values()) {
			Deferred.doneUnsafe(deferred, Effect.succeed(undefined));
		}
		this.flights.clear();
		this.projections.clear();
		if (clearMemories) this.memories.clear();
		return this.generation;
	}

	private capture(ctx: ExtensionContext, full: string): void {
		const key = projectionKey(ctx);
		this.projections.set(key, full);
		const memory = projectMemoryOnly(full);
		if (memory) this.memories.set(key, memory);
		else this.memories.delete(key);
	}

	private remove(ctx: ExtensionContext): void {
		const key = projectionKey(ctx);
		this.projections.delete(key);
		this.memories.delete(key);
	}

	projectMagicEvent(event: ContextEvent, ctx: ExtensionContext): Effect.Effect<MagicProjectionAttempt | undefined> {
		const { generation, handler } = this.host.current();
		if (!handler) return Effect.succeed(undefined);
		return this.runProjection(event, ctx, handler, generation, this.invalidate(false), "automatic-turn");
	}

	projectCurrent(
		audience: ContextProjectionAudience,
		ctx: ExtensionContext,
		options?: ContextProjectionOptions,
	): Effect.Effect<ContextProjection> {
		// Magic's handler is stateful, so caller-owned snapshots never invoke it.
		// BTW may reuse only project memory captured by the normal Context event;
		// forked Agents use a bounded native envelope from the frozen snapshot.
		if (options?.sourceMessages !== undefined) {
			if (audience === "btw" && this.host.current().active) {
				const memory = this.memories.get(projectionKey(ctx));
				if (memory) {
					return Effect.succeed({ source: "magic-context", ...formatProjection(memory, audience, options) });
				}
			}
			return Effect.succeed(nativeProjection(audience, ctx, options));
		}
		return this.host.activate(ctx).pipe(
			Effect.flatMap(() =>
				Effect.suspend(() => {
					const key = projectionKey(ctx);
					const cached = this.projections.get(key);
					const { generation, handler } = this.host.current();
					const projectionGeneration = this.generation;
					if (cached || !handler || this.host.current().generation !== generation) {
						return Effect.succeed(cached);
					}
					const current = this.flights.get(key);
					if (current?.generation === projectionGeneration) return Deferred.await(current.deferred);
					const flight: ProjectionFlight = {
						deferred: Deferred.makeUnsafe<string | undefined>(),
						generation: projectionGeneration,
					};
					this.flights.set(key, flight);
					return this.createProjection(ctx, handler, generation, projectionGeneration).pipe(
						Effect.onExit((exit) => Deferred.done(flight.deferred, exit)),
						Effect.ensuring(
							Effect.sync(() => {
								if (this.flights.get(key) === flight) this.flights.delete(key);
							}),
						),
					);
				}),
			),
			Effect.map((full) => full ?? this.projections.get(projectionKey(ctx))),
			Effect.map((full) =>
				full
					? { source: "magic-context", ...formatProjection(full, audience, options) }
					: nativeProjection(audience, ctx, options),
			),
		);
	}

	private createProjection(
		ctx: ExtensionContext,
		handler: MagicContextHandler,
		generation: number,
		projectionGeneration: number,
	): Effect.Effect<string | undefined> {
		const event: ContextEvent = { type: "context", messages: currentAgentMessages(ctx) };
		return this.runProjection(event, ctx, handler, generation, projectionGeneration, "projection").pipe(
			Effect.map((attempt) => attempt.full),
		);
	}

	private runProjection(
		event: ContextEvent,
		ctx: ExtensionContext,
		handler: MagicContextHandler,
		generation: number,
		projectionGeneration: number,
		trigger: ContextProjectionTrigger,
	): Effect.Effect<MagicProjectionAttempt> {
		const nativeResult: MagicContextEventResult = { messages: [...event.messages] };
		return Effect.tryPromise({
			try: async () => handler(event, this.host.quietContext(ctx)),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		}).pipe(
			Effect.flatMap((result) =>
				Effect.try({
					try: () => {
						if (!this.isCurrentProjection(generation, projectionGeneration)) {
							return { full: undefined, result: nativeResult };
						}
						const full = extractMagicProjection(result?.messages ?? event.messages);
						if (!full) throw new Error("Magic Context produced no valid history projection.");
						this.capture(ctx, full);
						this.host.succeed(trigger);
						return { full, result };
					},
					catch: (error) => (error instanceof Error ? error : new Error(String(error))),
				}),
			),
			Effect.catch((error) => {
				if (!this.isCurrentProjection(generation, projectionGeneration)) {
					return Effect.succeed({ full: undefined, result: nativeResult });
				}
				if (trigger === "automatic-turn") this.remove(ctx);
				this.host.fail(error, trigger);
				return Effect.succeed({ full: undefined, result: nativeResult });
			}),
		);
	}

	private isCurrentProjection(generation: number, projectionGeneration: number): boolean {
		return this.host.current().generation === generation && this.generation === projectionGeneration;
	}
}
