import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { Check } from "typebox/value";
import {
	beginSuiteNativeCompactionPreflight,
	reportDiagnostic,
	type SuiteAgentMessageOptions,
} from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS } from "../lifecycle-deadline.js";
import { isRuntimeObject, isRuntimeSymbol } from "../shared/runtime-type.js";
import { registerSuiteOwnedTool, registerSuiteToolActivityMetadata } from "../tool-display/index.js";
import { MAGIC_TOOL_LABELS, MAGIC_TOOL_NAME_SET, MAGIC_TOOL_NAMES } from "./activity.js";
import { ContextCommandRuntime, type MagicCommandDefinition } from "./command-runtime.js";
import {
	addCompactMagicContextMessage,
	addCompactMagicContextPrompt,
	CANCELLED_EVENT_RESULT_SCHEMA,
	COMPACT_PROMPT_EVENT_SCHEMA,
	type ContextRuntimeDependencies,
	type LooseEventHandler,
	MAGIC_CONTEXT_NATIVE_COMPACTION_MULTIPLIER,
	MAGIC_TOOL_HANDOFF_PARAMETERS,
	type MagicEventResult,
	type MagicRegistrationPlan,
	magicCommandContext,
	magicManualCompaction,
	magicPiAdapter,
	type NativeCompactionSettings,
	quietMagicContext,
} from "./magic-runtime.js";
import type { ContextProjection, ContextProjectionAudience, ContextProjectionOptions } from "./projection.js";
import { ContextProjectionRuntime, type MagicContextEventResult, type MagicContextHandler } from "./projection.js";
import { applyContextPromptContributions, stripContextPromptContributions } from "./prompt-contributions.js";
import { magicToolPresentation } from "./tool-presentation.js";

export type ContextActivationTrigger = "startup" | "input" | "automatic-turn" | "projection";
export type ContextCapabilityState = "dormant" | "loading" | "active" | "native" | "degraded";
export interface ContextStatusSnapshot {
	readonly state: ContextCapabilityState;
	readonly engine: "magic-context" | "native";
	readonly trigger?: ContextActivationTrigger;
	readonly error?: string;
}

export interface ContextCapability {
	status(): ContextStatusSnapshot;
	activate(ctx: ExtensionContext, trigger: ContextActivationTrigger): Promise<ContextStatusSnapshot>;
	projectCurrentContext(
		audience: ContextProjectionAudience,
		ctx: ExtensionContext,
		options?: ContextProjectionOptions,
	): Promise<ContextProjection>;
}

export interface ContextCapabilityRegistry {
	readonly contexts: WeakMap<object, ContextCapabilityRuntime>;
	readonly capabilities: WeakMap<ContextCapabilityRuntime, ContextCapability>;
	readonly owners: WeakMap<object, ContextCapabilityRuntime>;
	readonly runtimes: Set<ContextCapabilityRuntime>;
}

interface ContextRuntimeBoundary {
	readonly activate: (ctx: ExtensionContext, trigger: ContextActivationTrigger) => Promise<ContextStatusSnapshot>;
	readonly committedFailure: (cause: unknown, ctx: ExtensionContext) => Promise<void>;
}

type SharedFlight<A> = { readonly deferred: Deferred.Deferred<A> };

interface ActivationFlight extends SharedFlight<ContextStatusSnapshot> {
	readonly trigger: ContextActivationTrigger;
	retryTrigger?: ContextActivationTrigger;
}

function nativeEffect<A>(operation: () => A | PromiseLike<A>): Effect.Effect<A, unknown> {
	return Effect.tryPromise({ try: async () => operation(), catch: (error) => error });
}

function nativeStatus(trigger: ContextActivationTrigger): ContextStatusSnapshot {
	return { state: "native", engine: "native", trigger };
}

function ownerKey(pi: ExtensionAPI): object {
	return isRuntimeObject(pi.events) && pi.events !== null ? pi.events : pi;
}

export class ContextCapabilityRuntime {
	private readonly pi: ExtensionAPI;
	private readonly dependencies: ContextRuntimeDependencies;
	private state: ContextStatusSnapshot = { state: "dormant", engine: "native" };
	private activation: ActivationFlight | undefined;
	private cleanup: SharedFlight<void> | undefined;
	private readonly sessionStarts = Semaphore.makeUnsafe(1);
	private generation = 0;
	private readonly boundary: ContextRuntimeBoundary;
	private readonly commandRuntime: ContextCommandRuntime;
	private readonly magicCommands = new Map<string, MagicCommandDefinition>();
	private magicContextHandler: MagicContextHandler | undefined;
	private readonly magicTools = new Map<string, ToolDefinition>();
	private magicSessionStartHandlers: LooseEventHandler[] = [];
	private magicShutdownHandlers: LooseEventHandler[] = [];
	private sessionStart: SessionStartEvent | undefined;
	private sessionContext: ExtensionContext | undefined;
	private shutdown: { event: SessionShutdownEvent; ctx: ExtensionContext } | undefined;
	private disposed = false;
	private readonly projectionRuntime: ContextProjectionRuntime;
	private readonly registry: ContextCapabilityRegistry;
	private readonly owner: object;
	private readonly ownedContexts = new Set<object>();
	private nativeCompactionPreflight: Deferred.Deferred<void> | undefined;
	private interactivePaintPending = false;
	private magicPromptInstalledForSession = false;
	private readonly suiteCustomContextGuidance = new Set<symbol>();

	constructor(
		pi: ExtensionAPI,
		dependencies: ContextRuntimeDependencies,
		registry: ContextCapabilityRegistry,
		boundary: ContextRuntimeBoundary,
	) {
		this.pi = pi;
		this.boundary = boundary;
		this.commandRuntime = new ContextCommandRuntime(pi, {
			activate: (ctx) => this.boundary.activate(ctx, "input").then(() => undefined),
			commands: this.magicCommands,
			currentContext: () => this.sessionContext,
			error: () => this.state.error,
			quietContext: magicCommandContext,
		});
		this.projectionRuntime = new ContextProjectionRuntime({
			activate: (ctx) => this.activate(ctx, "projection").pipe(Effect.asVoid),
			current: () => ({
				active: this.state.state === "active",
				generation: this.generation,
				handler: this.magicContextHandler,
			}),
			fail: (error, trigger) => this.setDegraded(error, trigger),
			quietContext: (ctx) => quietMagicContext(ctx),
			succeed: (trigger) => {
				this.state = {
					state: "active",
					engine: "magic-context",
					trigger: trigger === "automatic-turn" ? (this.state.trigger ?? trigger) : trigger,
				};
			},
		});
		this.dependencies = dependencies;
		this.registry = registry;
		this.owner = ownerKey(pi);
	}

	status(): ContextStatusSnapshot {
		return { ...this.state };
	}

	private setDegraded(cause: unknown, trigger: ContextActivationTrigger | undefined): void {
		const error = cause instanceof Error ? cause.message : String(cause);
		this.state =
			trigger === undefined
				? { state: "degraded", engine: "native", error }
				: { state: "degraded", engine: "native", trigger, error };
	}

	noteInput(source: InputEvent["source"]): void {
		// Every submitted prompt starts a new branch snapshot. The automatic Context
		// event will repopulate this cache before tools run; retaining the previous
		// turn's projection could otherwise omit the user's newest decision.
		this.projectionRuntime.invalidate(false);
		this.interactivePaintPending = source === "interactive";
	}

	yieldForInteractivePaint(): Effect.Effect<boolean> | undefined {
		if (!this.interactivePaintPending) return;
		this.interactivePaintPending = false;
		const generation = this.generation;
		return Effect.callback((resume) => {
			const pending = setImmediate(() => resume(Effect.succeed(this.isCurrentGeneration(generation))));
			return Effect.sync(() => clearImmediate(pending));
		});
	}

	registerToolHandoffs(): void {
		if (this.dependencies.magicSubagent()) {
			for (const name of MAGIC_TOOL_NAMES) {
				registerSuiteToolActivityMetadata(this.pi, name, magicToolPresentation(name).activity);
			}
			return;
		}
		for (const name of MAGIC_TOOL_NAMES) {
			registerSuiteOwnedTool(
				this.pi,
				{
					name,
					label: MAGIC_TOOL_LABELS.get(name) ?? name,
					description: "Pi Stuff Context tool; its implementation activates before the next provider boundary.",
					parameters: MAGIC_TOOL_HANDOFF_PARAMETERS,
					execute: async () => {
						return {
							content: [
								{
									type: "text" as const,
									text: "Magic Context is unavailable; Pi native context remains active.",
								},
							],
							details: undefined,
							isError: true,
						};
					},
				},
				magicToolPresentation(name),
			);
		}
	}

	private deactivateToolHandoffs(): void {
		this.pi.setActiveTools(this.pi.getActiveTools().filter((name) => !MAGIC_TOOL_NAME_SET.has(name)));
	}

	private activateMagicTools(): void {
		this.pi.setActiveTools(
			this.pi.getActiveTools().filter((name) => !MAGIC_TOOL_NAME_SET.has(name) || this.magicTools.has(name)),
		);
	}

	captureSessionStart(event: SessionStartEvent, ctx: ExtensionContext): void {
		const previousSessionManager = this.sessionContext?.sessionManager;
		if (previousSessionManager && previousSessionManager !== ctx.sessionManager) {
			if (this.registry.contexts.get(previousSessionManager) === this) {
				this.registry.contexts.delete(previousSessionManager);
			}
			this.ownedContexts.delete(previousSessionManager);
		}
		this.sessionStart = { ...event };
		this.sessionContext = ctx;
		this.projectionRuntime.invalidate(true);
		this.interactivePaintPending = false;
		this.magicPromptInstalledForSession = false;
		this.suiteCustomContextGuidance.clear();
		this.registry.contexts.set(ctx.sessionManager, this);
		this.ownedContexts.add(ctx.sessionManager);
		if (this.magicTools.size > 0) this.activateMagicTools();
	}

	startSession(event: SessionStartEvent, ctx: ExtensionContext): Effect.Effect<void> {
		return this.sessionStarts.withPermit(this.startSessionNow(event, ctx));
	}

	private startSessionNow(event: SessionStartEvent, ctx: ExtensionContext): Effect.Effect<void> {
		return Effect.suspend(() => {
			if (this.disposed) return Effect.void;
			const forwardsToActiveMagic = this.state.state === "active" && this.magicContextHandler !== undefined;
			this.captureSessionStart(event, ctx);
			if (!forwardsToActiveMagic) return this.activate(ctx, "startup").pipe(Effect.asVoid);
			const generation = this.generation;
			const handlers = this.magicSessionStartHandlers;
			return Effect.gen({ self: this }, function* () {
				for (const handler of handlers) {
					yield* nativeEffect(() => handler(event, quietMagicContext(ctx)));
					if (!this.isCurrentGeneration(generation)) return;
				}
			}).pipe(
				Effect.catch((error) =>
					this.isCurrentGeneration(generation) ? this.handleCommittedFailure(error, ctx) : Effect.void,
				),
			);
		});
	}

	invalidateProjection(): void {
		this.projectionRuntime.invalidate(true);
	}

	yieldExtremeOverflowToNative(ctx: ExtensionContext): boolean {
		if (this.state.state !== "active" || !this.magicContextHandler) return false;
		let usage: ReturnType<ExtensionContext["getContextUsage"]>;
		try {
			usage = ctx.getContextUsage();
		} catch {
			return false;
		}
		if (
			!usage ||
			usage.tokens === null ||
			usage.contextWindow <= 0 ||
			usage.tokens <= usage.contextWindow * MAGIC_CONTEXT_NATIVE_COMPACTION_MULTIPLIER
		)
			return false;
		this.projectionRuntime.invalidate(true);
		this.setDegraded("Magic Context yielded an extreme-overflow turn to Pi native compaction.", this.state.trigger);
		return true;
	}

	preflightExtremeOverflow(ctx: ExtensionContext): Effect.Effect<void> {
		if (!this.yieldExtremeOverflowToNative(ctx)) return Effect.void;
		return this.preflightNativeCustomTurn(ctx, false);
	}

	dispose(event?: SessionShutdownEvent, ctx?: ExtensionContext): Effect.Effect<void> {
		return Effect.suspend(() => {
			if (this.disposed) return Effect.void;
			this.disposed = true;
			const trigger = this.state.trigger;
			this.state =
				trigger === undefined
					? { state: "native", engine: "native" }
					: { state: "native", engine: "native", trigger };
			this.suiteCustomContextGuidance.clear();
			this.sessionContext = undefined;
			this.generation++;
			this.magicSessionStartHandlers = [];
			if (event && ctx) this.shutdown = { event, ctx };
			this.projectionRuntime.invalidate(true);
			for (const key of this.ownedContexts) {
				if (this.registry.contexts.get(key) === this) this.registry.contexts.delete(key);
			}
			this.ownedContexts.clear();
			if (this.registry.owners.get(this.owner) === this) this.registry.owners.delete(this.owner);
			this.registry.runtimes.delete(this);
			const activation = this.activation;
			const cleanup = this.cleanup;
			const preflight = this.nativeCompactionPreflight;
			const handlers = this.magicShutdownHandlers.splice(0);
			const pending = [
				activation ? Deferred.await(activation.deferred).pipe(Effect.asVoid) : Effect.void,
				cleanup ? Deferred.await(cleanup.deferred) : Effect.void,
				preflight ? Deferred.await(preflight) : Effect.void,
				this.sessionStarts.withPermit(Effect.void),
				event && ctx
					? Effect.forEach(
							handlers,
							(handler) => nativeEffect(() => handler(event, quietMagicContext(ctx))).pipe(Effect.ignore),
							{ concurrency: "unbounded", discard: true },
						)
					: Effect.void,
			];
			return Effect.all(pending, { concurrency: "unbounded", discard: true }).pipe(
				Effect.timeoutOption(HOST_SHUTDOWN_GRACE_MS),
				Effect.asVoid,
			);
		});
	}

	activate(ctx: ExtensionContext, trigger: ContextActivationTrigger): Effect.Effect<ContextStatusSnapshot> {
		return Effect.suspend(() => {
			if (this.disposed) return Effect.succeed({ state: "native", engine: "native" });
			const cleanup = this.cleanup;
			if (cleanup) {
				return Deferred.await(cleanup.deferred).pipe(Effect.flatMap(() => this.activate(ctx, trigger)));
			}
			if (this.dependencies.magicSubagent()) {
				this.state = { state: "native", engine: "native", trigger };
				return Effect.succeed(this.status());
			}
			if (this.state.state === "active" || this.state.state === "native") return Effect.succeed(this.status());
			if (this.magicContextHandler) return Effect.succeed(this.status());
			const current = this.activation;
			if (current) {
				if (trigger !== "automatic-turn" && current.trigger === "automatic-turn") current.retryTrigger = trigger;
				return Deferred.await(current.deferred).pipe(
					Effect.flatMap((result) =>
						trigger !== "automatic-turn" &&
						current.trigger === "automatic-turn" &&
						result.state === "dormant" &&
						!this.disposed
							? this.activate(ctx, trigger)
							: Effect.succeed(result),
					),
				);
			}

			this.state = { state: "loading", engine: "native", trigger };
			const generation = ++this.generation;
			const sessionStart = this.sessionStart ? { ...this.sessionStart } : undefined;
			const flight: ActivationFlight = {
				deferred: Deferred.makeUnsafe<ContextStatusSnapshot>(),
				trigger,
			};
			this.activation = flight;
			return this.startMagicContext(ctx, trigger, generation, sessionStart).pipe(
				Effect.flatMap((result) => {
					const retryTrigger = flight.retryTrigger;
					if (retryTrigger && result.state === "dormant" && !this.disposed) {
						if (this.activation === flight) this.activation = undefined;
						return this.activate(ctx, retryTrigger);
					}
					return Effect.succeed(result);
				}),
				Effect.onExit((exit) => Deferred.done(flight.deferred, exit)),
				Effect.ensuring(
					Effect.sync(() => {
						if (this.activation === flight) this.activation = undefined;
					}),
				),
			);
		});
	}

	prepareSuiteAgentMessage(
		activation: "automatic" | "direct-user",
		options: SuiteAgentMessageOptions,
	): Effect.Effect<void> {
		const ctx = this.sessionContext;
		if (!ctx) return Effect.void;
		let idle = false;
		try {
			idle = ctx.isIdle();
		} catch {
			// A partial Host context must fail toward preserving model context.
		}
		const startsOrJoinsAgentWork = options?.triggerTurn === true || !idle;
		if (!startsOrJoinsAgentWork) return Effect.void;
		return this.activate(ctx, activation === "direct-user" ? "input" : "automatic-turn").pipe(
			Effect.flatMap(() =>
				options?.triggerTurn === true && idle && this.state.state !== "active"
					? this.preflightNativeCustomTurn(ctx)
					: Effect.void,
			),
		);
	}

	stageSuiteCustomContextGuidance(options: SuiteAgentMessageOptions): symbol | undefined {
		if (options?.triggerTurn !== true || this.state.state !== "active" || this.magicPromptInstalledForSession) {
			return undefined;
		}
		try {
			if (!this.sessionContext?.isIdle()) return undefined;
		} catch {
			return undefined;
		}
		const token = Symbol("suite-custom-context-guidance");
		this.suiteCustomContextGuidance.add(token);
		return token;
	}

	cancelSuiteCustomContextGuidance(token: symbol): void {
		this.suiteCustomContextGuidance.delete(token);
	}

	private consumeSuiteCustomContextGuidance(): boolean {
		const token = this.suiteCustomContextGuidance.values().next().value;
		if (!isRuntimeSymbol(token)) return false;
		this.suiteCustomContextGuidance.delete(token);
		return true;
	}
	private preflightNativeCustomTurn(ctx: ExtensionContext, requireIdle = true): Effect.Effect<void> {
		return Effect.suspend(() => {
			if (this.nativeCompactionPreflight) return Deferred.await(this.nativeCompactionPreflight);
			if (requireIdle) {
				try {
					if (!ctx.isIdle()) return Effect.void;
				} catch {
					return Effect.void;
				}
			}
			let settings: NativeCompactionSettings | undefined;
			try {
				settings = this.dependencies.readNativeCompactionSettings(ctx);
			} catch (error) {
				reportDiagnostic({
					capability: "Context",
					error,
					key: "native-custom-turn-settings",
					severity: "warning",
					summary: "Native compaction settings could not be read before a Suite custom turn",
					visibility: "silent",
				});
				return Effect.void;
			}
			if (!settings?.enabled || !Number.isFinite(settings.reserveTokens) || settings.reserveTokens < 0)
				return Effect.void;
			let usage: ReturnType<ExtensionContext["getContextUsage"]>;
			try {
				usage = ctx.getContextUsage();
			} catch {
				return Effect.void;
			}
			if (!usage || usage.tokens === null || usage.contextWindow <= 0) return Effect.void;
			if (usage.tokens <= usage.contextWindow - settings.reserveTokens) return Effect.void;
			const finishPreflight = beginSuiteNativeCompactionPreflight(ctx);
			const flight = Deferred.makeUnsafe<void>();
			this.nativeCompactionPreflight = flight;
			return Effect.callback<void>((resume) => {
				let settled = false;
				const finish = (error?: Error): void => {
					if (settled) return;
					settled = true;
					if (error) {
						reportDiagnostic({
							capability: "Context",
							error,
							key: "native-custom-turn-compaction",
							severity: "warning",
							summary: "Native compaction could not finish before a Suite custom turn",
							visibility: "silent",
						});
					}
					resume(Effect.void);
				};
				try {
					ctx.compact({ onComplete: () => finish(), onError: finish });
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			}).pipe(
				// Pi exposes no cancellation handle, so keep the flight published until its callback settles.
				Effect.uninterruptible,
				Effect.onExit((exit) => Deferred.done(flight, exit)),
				Effect.ensuring(
					Effect.sync(() => {
						finishPreflight();
						if (this.nativeCompactionPreflight === flight) this.nativeCompactionPreflight = undefined;
					}),
				),
			);
		});
	}
	projectCurrentContext(
		audience: ContextProjectionAudience,
		ctx: ExtensionContext,
		options?: ContextProjectionOptions,
	): Effect.Effect<ContextProjection> {
		return this.projectionRuntime.projectCurrent(audience, ctx, options);
	}

	private startMagicContext(
		ctx: ExtensionContext,
		trigger: ContextActivationTrigger,
		generation: number,
		sessionStart: SessionStartEvent | undefined,
	): Effect.Effect<ContextStatusSnapshot> {
		const plan: MagicRegistrationPlan = { commands: new Map(), handlers: [], tools: [], shutdownComplete: false };
		let committed = false;
		const transaction = Effect.gen({ self: this }, function* () {
			const preparation = yield* nativeEffect(() =>
				this.dependencies.prepareMagicContext(ctx, {
					allowConfigurationMutation: trigger !== "automatic-turn" && trigger !== "startup",
				}),
			);
			if (preparation === "deferred") {
				if (!this.isCurrentGeneration(generation)) return nativeStatus(trigger);
				this.state = { state: "dormant", engine: "native" };
				return this.status();
			}
			const module = yield* nativeEffect(() => this.dependencies.loadMagicContext());
			if (!this.isCurrentGeneration(generation)) {
				yield* this.rollbackRegistrationPlan(plan, ctx);
				return nativeStatus(trigger);
			}
			const magicPi = magicPiAdapter(this.pi, plan, (data) => this.commandRuntime.captureStatus(data));
			yield* nativeEffect(() =>
				module.default(magicPi, (cause) => {
					if (!committed || !this.isCurrentGeneration(generation)) return;
					void this.boundary.committedFailure(cause, ctx);
				}),
			);
			if (!this.isCurrentGeneration(generation)) {
				yield* this.rollbackRegistrationPlan(plan, ctx);
				return nativeStatus(trigger);
			}
			// Session startup is part of the activation transaction. Running it before
			// commit lets a partial upstream startup fail open without leaving Magic
			// registered as the active Context owner.
			yield* this.replaySessionStart(plan, sessionStart, ctx);
			if (!this.isCurrentGeneration(generation)) {
				yield* this.rollbackRegistrationPlan(plan, ctx);
				return nativeStatus(trigger);
			}
			if (!plan.contextHandler) {
				yield* this.rollbackRegistrationPlan(plan, ctx);
				if (!this.isCurrentGeneration(generation)) return nativeStatus(trigger);
				this.deactivateToolHandoffs();
				this.setDegraded(
					"Magic Context did not register its context adapter; Pi native context remains active.",
					trigger,
				);
				return this.status();
			}
			yield* Effect.try({
				try: () => this.commitRegistrationPlan(plan, generation),
				catch: (error) => error,
			});
			committed = true;
			this.state = { state: "active", engine: "magic-context", trigger };
			return this.status();
		});
		return transaction.pipe(
			Effect.catch((error) =>
				this.rollbackRegistrationPlan(plan, ctx).pipe(
					Effect.map(() => {
						if (!this.isCurrentGeneration(generation)) return nativeStatus(trigger);
						this.magicContextHandler = undefined;
						this.deactivateToolHandoffs();
						this.setDegraded(error, trigger);
						return this.status();
					}),
				),
			),
		);
	}

	private replaySessionStart(
		plan: MagicRegistrationPlan,
		event: SessionStartEvent | undefined,
		ctx: ExtensionContext,
	): Effect.Effect<void, unknown> {
		if (!event) return Effect.void;
		return Effect.forEach(
			plan.handlers,
			(staged) =>
				staged.event === "session_start"
					? nativeEffect(() => staged.handler(event, quietMagicContext(ctx))).pipe(Effect.asVoid)
					: Effect.void,
			{ discard: true },
		);
	}

	handleCommittedFailure(cause: unknown, ctx: ExtensionContext): Effect.Effect<void> {
		return Effect.suspend(() => {
			if (this.disposed) return Effect.void;
			const current = this.cleanup;
			if (current) return Deferred.await(current.deferred);
			const generation = ++this.generation;
			this.projectionRuntime.invalidate(true);
			this.commandRuntime.clearActive();
			this.magicCommands.clear();
			this.magicContextHandler = undefined;
			this.magicSessionStartHandlers = [];
			this.magicTools.clear();
			this.deactivateToolHandoffs();
			const handlers = this.magicShutdownHandlers.splice(0);
			this.state = { state: "loading", engine: "native", trigger: "startup" };
			const cleanup = { deferred: Deferred.makeUnsafe<void>() };
			this.cleanup = cleanup;
			return Effect.forEach(
				handlers,
				(handler) =>
					nativeEffect(() => handler({ type: "session_shutdown", reason: "reload" }, quietMagicContext(ctx))).pipe(
						Effect.ignore,
					),
				{ discard: true },
			).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						if (this.isCurrentGeneration(generation)) this.setDegraded(cause, "startup");
					}),
				),
				Effect.onExit((exit) => Deferred.done(cleanup.deferred, exit)),
				Effect.ensuring(
					Effect.sync(() => {
						if (this.cleanup === cleanup) this.cleanup = undefined;
					}),
				),
			);
		});
	}

	private isCurrentGeneration(generation: number): boolean {
		return !this.disposed && this.generation === generation;
	}

	private rollbackRegistrationPlan(plan: MagicRegistrationPlan, ctx: ExtensionContext): Effect.Effect<void> {
		return Effect.suspend(() => {
			if (plan.shutdownComplete) return Effect.void;
			plan.shutdownComplete = true;
			const event: SessionShutdownEvent = this.shutdown?.event ?? { type: "session_shutdown", reason: "reload" };
			return Effect.forEach(
				plan.handlers,
				({ event: name, handler }) =>
					name === "session_shutdown"
						? nativeEffect(() => handler(event, quietMagicContext(this.shutdown?.ctx ?? ctx))).pipe(Effect.ignore)
						: Effect.void,
				{ discard: true },
			);
		});
	}

	private commitRegistrationPlan(plan: MagicRegistrationPlan, generation: number): void {
		const activeBefore = this.pi.getActiveTools();
		this.magicContextHandler = plan.contextHandler;
		for (const [name, definition] of plan.commands) this.magicCommands.set(name, definition);
		for (const tool of plan.tools) {
			this.magicTools.set(tool.name, tool);
			registerSuiteOwnedTool(this.pi, tool, magicToolPresentation(tool.name));
		}
		for (const { event, handler } of plan.handlers) {
			if (event === "session_start") {
				this.magicSessionStartHandlers.push(handler);
				continue;
			}
			if (event === "session_shutdown") {
				this.magicShutdownHandlers.push(handler);
				continue;
			}
			if (event === "context") continue;
			this.registerMagicHandler(event, handler, generation);
		}
		this.pi.setActiveTools(
			activeBefore.filter((name) => !MAGIC_TOOL_NAME_SET.has(name) || this.magicTools.has(name)),
		);
	}

	projectMagicContext(event: ContextEvent, ctx: ExtensionContext): Effect.Effect<MagicContextEventResult | undefined> {
		return this.projectionRuntime.projectMagicEvent(event, ctx).pipe(
			Effect.map((attempt) => {
				if (!attempt?.full) return attempt?.result;
				if (!this.consumeSuiteCustomContextGuidance()) return attempt.result;
				return {
					...attempt.result,
					messages: addCompactMagicContextMessage(attempt.result?.messages ?? event.messages),
				};
			}),
		);
	}

	private registerMagicHandler(event: string, handler: LooseEventHandler, generation: number): void {
		// SAFETY: Magic registers only Pi event names through this adapter; each handler is normalized below.
		const register = this.pi.on.bind(this.pi) as (name: string, value: LooseEventHandler) => void;
		if (event === "session_before_compact") {
			register(event, async (rawEvent, ctx) => {
				if (!this.isCurrentGeneration(generation) || this.state.state !== "active" || !this.magicContextHandler)
					return;
				let result: MagicEventResult;
				try {
					result = await handler(rawEvent, quietMagicContext(ctx));
				} catch (error) {
					if (!this.isCurrentGeneration(generation)) return;
					this.setDegraded(error, this.state.trigger);
					try {
						ctx.ui.notify(
							"Magic Context could not finish this compaction. Pi did not add a second native summary; the full Session remains intact.",
							"error",
						);
					} catch {
						// Compaction safety must not depend on the optional TUI notification.
					}
					return { cancel: true };
				}
				if (!this.isCurrentGeneration(generation)) return;
				if (Check(CANCELLED_EVENT_RESULT_SCHEMA, result)) {
					const manual = magicManualCompaction(rawEvent);
					if (manual) return manual;
				}
				return result;
			});
			return;
		}
		if (event === "before_agent_start") {
			register(event, async (rawEvent, ctx) => {
				if (!this.isCurrentGeneration(generation)) return;
				this.magicPromptInstalledForSession = true;
				this.suiteCustomContextGuidance.clear();
				try {
					const withoutContributions = Check(COMPACT_PROMPT_EVENT_SCHEMA, rawEvent)
						? { ...rawEvent, systemPrompt: stripContextPromptContributions(this.pi, rawEvent.systemPrompt) }
						: rawEvent;
					const magicEvent = addCompactMagicContextPrompt(withoutContributions);
					const result = await handler(magicEvent, quietMagicContext(ctx));
					if (!this.isCurrentGeneration(generation)) return;
					if (!Check(COMPACT_PROMPT_EVENT_SCHEMA, magicEvent)) return result;
					// SAFETY: this handler was registered by Magic for before_agent_start.
					const beforeAgentResult = result as BeforeAgentStartEventResult | undefined;
					const magicSystemPrompt = beforeAgentResult?.systemPrompt ?? magicEvent.systemPrompt;
					// SAFETY: this branch handles Pi's before_agent_start event and changes only systemPrompt.
					const contributed = await applyContextPromptContributions(
						this.pi,
						{ ...magicEvent, systemPrompt: magicSystemPrompt } as BeforeAgentStartEvent,
						ctx,
					);
					if (!contributed?.systemPrompt) return result;
					return { ...beforeAgentResult, systemPrompt: contributed.systemPrompt };
				} catch (error) {
					if (this.isCurrentGeneration(generation)) await this.boundary.committedFailure(error, ctx);
					return;
				}
			});
			return;
		}
		register(event, async (rawEvent, ctx) => {
			if (!this.isCurrentGeneration(generation)) return;
			try {
				const result = await handler(rawEvent, quietMagicContext(ctx));
				return this.isCurrentGeneration(generation) ? result : undefined;
			} catch (error) {
				if (this.isCurrentGeneration(generation)) await this.boundary.committedFailure(error, ctx);
				return;
			}
		});
	}
}
