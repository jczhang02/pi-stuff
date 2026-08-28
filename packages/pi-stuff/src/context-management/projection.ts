import type { ContextEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	readonly activate: (ctx: ExtensionContext) => Promise<void>;
	readonly current: () => ProjectionHostSnapshot;
	readonly fail: (error: Error, trigger: ContextProjectionTrigger) => void;
	readonly quietContext: (ctx: ExtensionContext) => ExtensionContext;
	readonly succeed: (trigger: ContextProjectionTrigger) => void;
}

interface ProjectionFlight {
	readonly generation: number;
	readonly promise: Promise<string | undefined>;
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

	async projectMagicEvent(event: ContextEvent, ctx: ExtensionContext) {
		const { generation, handler } = this.host.current();
		if (!handler) return;
		return this.runProjection(event, ctx, handler, generation, this.invalidate(false), "automatic-turn");
	}

	async projectCurrent(
		audience: ContextProjectionAudience,
		ctx: ExtensionContext,
		options?: ContextProjectionOptions,
	): Promise<ContextProjection> {
		// Magic's handler is stateful, so caller-owned snapshots never invoke it.
		// BTW may reuse only project memory captured by the normal Context event;
		// forked Agents use a bounded native envelope from the frozen snapshot.
		if (options?.sourceMessages !== undefined) {
			if (audience === "btw" && this.host.current().active) {
				const memory = this.memories.get(projectionKey(ctx));
				if (memory) return { source: "magic-context", ...formatProjection(memory, audience, options) };
			}
			return nativeProjection(audience, ctx, options);
		}
		await this.host.activate(ctx);
		const key = projectionKey(ctx);
		let cached = this.projections.get(key);
		const { generation, handler } = this.host.current();
		const projectionGeneration = this.generation;
		if (!cached && handler && this.host.current().generation === generation) {
			let flight = this.flights.get(key);
			if (!flight || flight.generation !== projectionGeneration) {
				const created = {
					generation: projectionGeneration,
					promise: this.createProjection(ctx, handler, generation, projectionGeneration),
				};
				this.flights.set(key, created);
				void created.promise.finally(() => {
					if (this.flights.get(key) === created) this.flights.delete(key);
				});
				flight = created;
			}
			cached = (await flight.promise) ?? this.projections.get(key);
		}
		if (!cached) return nativeProjection(audience, ctx, options);
		return { source: "magic-context", ...formatProjection(cached, audience, options) };
	}

	private async createProjection(
		ctx: ExtensionContext,
		handler: MagicContextHandler,
		generation: number,
		projectionGeneration: number,
	): Promise<string | undefined> {
		const event: ContextEvent = { type: "context", messages: currentAgentMessages(ctx) };
		const attempt = await this.runProjection(event, ctx, handler, generation, projectionGeneration, "projection");
		return attempt.full;
	}

	private async runProjection(
		event: ContextEvent,
		ctx: ExtensionContext,
		handler: MagicContextHandler,
		generation: number,
		projectionGeneration: number,
		trigger: ContextProjectionTrigger,
	) {
		const nativeResult: MagicContextEventResult = { messages: [...event.messages] };
		try {
			const result = await handler(event, this.host.quietContext(ctx));
			if (!this.isCurrentProjection(generation, projectionGeneration)) {
				return { full: undefined, result: nativeResult };
			}
			const full = extractMagicProjection(result?.messages ?? event.messages);
			if (!full) throw new Error("Magic Context produced no valid history projection.");
			this.capture(ctx, full);
			this.host.succeed(trigger);
			return { full, result };
		} catch (error) {
			if (!this.isCurrentProjection(generation, projectionGeneration)) {
				return { full: undefined, result: nativeResult };
			}
			if (trigger === "automatic-turn") this.remove(ctx);
			this.host.fail(error instanceof Error ? error : new Error(String(error)), trigger);
			return { full: undefined, result: nativeResult };
		}
	}

	private isCurrentProjection(generation: number, projectionGeneration: number): boolean {
		return this.host.current().generation === generation && this.generation === projectionGeneration;
	}
}
