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
import { Check } from "typebox/value";
import {
	beginSuiteNativeCompactionPreflight,
	registerSuiteAgentMessagePreparation,
	reportDiagnostic,
	type SuiteAgentMessageOptions,
} from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
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
	readonly owners: WeakMap<object, ContextCapabilityRuntime>;
	readonly runtimes: Set<ContextCapabilityRuntime>;
}

function ownerKey(pi: ExtensionAPI): object {
	return isRuntimeObject(pi.events) && pi.events !== null ? pi.events : pi;
}

export class ContextCapabilityRuntime implements ContextCapability {
	private readonly pi: ExtensionAPI;
	private readonly dependencies: ContextRuntimeDependencies;
	private state: ContextStatusSnapshot = { state: "dormant", engine: "native" };
	private activation: Promise<ContextStatusSnapshot> | undefined;
	private activationTrigger: ContextActivationTrigger | undefined;
	private cleanup: Promise<void> | undefined;
	private sessionStartQueue: Promise<void> | undefined;
	private generation = 0;
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
	private nativeCompactionPreflight: Promise<void> | undefined;
	private interactivePaintPending = false;
	private magicPromptInstalledForSession = false;
	private readonly suiteCustomContextGuidance = new Set<symbol>();
	private readonly unregisterSuiteAgentMessagePreparation: () => void;

	constructor(pi: ExtensionAPI, dependencies: ContextRuntimeDependencies, registry: ContextCapabilityRegistry) {
		this.pi = pi;
		this.commandRuntime = new ContextCommandRuntime(pi, {
			activate: (ctx) => this.activate(ctx, "input").then(() => undefined),
			commands: this.magicCommands,
			currentContext: () => this.sessionContext,
			error: () => this.state.error,
			quietContext: magicCommandContext,
		});
		this.projectionRuntime = new ContextProjectionRuntime({
			activate: (ctx) => this.activate(ctx, "projection").then(() => undefined),
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
		this.unregisterSuiteAgentMessagePreparation = registerSuiteAgentMessagePreparation(pi, {
			prepare: (origin, options) => this.prepareSuiteAgentMessage(origin, options),
			stage: (options) => {
				const token = this.stageSuiteCustomContextGuidance(options);
				return token ? () => this.cancelSuiteCustomContextGuidance(token) : undefined;
			},
		});
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

	yieldForInteractivePaint(): Promise<boolean> | undefined {
		if (!this.interactivePaintPending) return;
		this.interactivePaintPending = false;
		const generation = this.generation;
		return new Promise((resolveTurn) => {
			setImmediate(() => resolveTurn(this.isCurrentGeneration(generation)));
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

	async startSession(event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
		const previous = this.sessionStartQueue ?? Promise.resolve();
		let tracked: Promise<void>;
		tracked = previous
			.catch(() => undefined)
			.then(() => this.startSessionNow(event, ctx))
			.finally(() => {
				if (this.sessionStartQueue === tracked) this.sessionStartQueue = undefined;
			});
		this.sessionStartQueue = tracked;
		return tracked;
	}

	private async startSessionNow(event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
		if (this.disposed) return;
		const forwardsToActiveMagic = this.state.state === "active" && this.magicContextHandler !== undefined;
		this.captureSessionStart(event, ctx);
		if (!forwardsToActiveMagic) {
			await this.activate(ctx, "startup");
			return;
		}
		const generation = this.generation;
		try {
			for (const handler of this.magicSessionStartHandlers) {
				await handler(event, quietMagicContext(ctx));
				if (!this.isCurrentGeneration(generation)) return;
			}
		} catch (error) {
			if (this.isCurrentGeneration(generation)) await this.degradeCommittedMagic(error, ctx);
		}
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

	async preflightExtremeOverflow(ctx: ExtensionContext): Promise<void> {
		if (!this.yieldExtremeOverflowToNative(ctx)) return;
		await this.preflightNativeCustomTurn(ctx, false);
	}

	async dispose(event?: SessionShutdownEvent, ctx?: ExtensionContext): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		const trigger = this.state.trigger;
		this.state =
			trigger === undefined ? { state: "native", engine: "native" } : { state: "native", engine: "native", trigger };
		this.suiteCustomContextGuidance.clear();
		this.sessionContext = undefined;
		this.generation++;
		this.magicSessionStartHandlers = [];
		this.unregisterSuiteAgentMessagePreparation();
		if (event && ctx) this.shutdown = { event, ctx };
		this.projectionRuntime.invalidate(true);
		for (const key of this.ownedContexts) {
			if (this.registry.contexts.get(key) === this) this.registry.contexts.delete(key);
		}
		this.ownedContexts.clear();
		if (this.registry.owners.get(this.owner) === this) this.registry.owners.delete(this.owner);
		this.registry.runtimes.delete(this);
		const handlers = this.magicShutdownHandlers.splice(0);
		const shutdownHandlers =
			event && ctx
				? Promise.allSettled(
						handlers.map((handler) => Promise.resolve().then(() => handler(event, quietMagicContext(ctx)))),
					)
				: undefined;
		const pending = [
			this.activation,
			this.sessionStartQueue,
			this.nativeCompactionPreflight,
			shutdownHandlers,
			this.cleanup,
		].filter((operation) => operation !== undefined);
		await settleWithin(Promise.allSettled(pending), HOST_SHUTDOWN_GRACE_MS);
	}

	async activate(ctx: ExtensionContext, trigger: ContextActivationTrigger): Promise<ContextStatusSnapshot> {
		if (this.disposed) return { state: "native", engine: "native" };
		if (this.cleanup) {
			await this.cleanup;
			if (this.disposed) return { state: "native", engine: "native" };
			return this.activate(ctx, trigger);
		}
		if (this.dependencies.magicSubagent()) {
			this.state = { state: "native", engine: "native", trigger };
			return this.status();
		}
		if (this.state.state === "active" || this.state.state === "native") return this.status();
		if (this.magicContextHandler) return this.status();
		if (this.activation) {
			const joinedTrigger = this.activationTrigger;
			const result = await this.activation;
			if (
				trigger !== "automatic-turn" &&
				joinedTrigger === "automatic-turn" &&
				result.state === "dormant" &&
				!this.disposed
			) {
				return this.activate(ctx, trigger);
			}
			return result;
		}

		this.state = { state: "loading", engine: "native", trigger };
		const generation = ++this.generation;
		const sessionStart = this.sessionStart ? { ...this.sessionStart } : undefined;
		let tracked: Promise<ContextStatusSnapshot>;
		tracked = this.startMagicContext(ctx, trigger, generation, sessionStart).finally(() => {
			if (this.activation !== tracked) return;
			this.activation = undefined;
			this.activationTrigger = undefined;
		});
		this.activationTrigger = trigger;
		this.activation = tracked;
		return this.activation;
	}

	async prepareSuiteAgentMessage(
		activation: "automatic" | "direct-user",
		options: SuiteAgentMessageOptions,
	): Promise<void> {
		const ctx = this.sessionContext;
		if (!ctx) return;
		let idle = false;
		try {
			idle = ctx.isIdle();
		} catch {
			// A partial Host context must fail toward preserving model context.
		}
		let startsOrJoinsAgentWork = options?.triggerTurn === true;
		if (!startsOrJoinsAgentWork) {
			startsOrJoinsAgentWork = !idle;
		}
		if (!startsOrJoinsAgentWork) return;
		await this.activate(ctx, activation === "direct-user" ? "input" : "automatic-turn");
		if (options?.triggerTurn === true && idle && this.state.state !== "active") {
			await this.preflightNativeCustomTurn(ctx);
		}
	}

	private stageSuiteCustomContextGuidance(options: SuiteAgentMessageOptions): symbol | undefined {
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

	private cancelSuiteCustomContextGuidance(token: symbol): void {
		this.suiteCustomContextGuidance.delete(token);
	}

	private consumeSuiteCustomContextGuidance(): boolean {
		const token = this.suiteCustomContextGuidance.values().next().value;
		if (!isRuntimeSymbol(token)) return false;
		this.suiteCustomContextGuidance.delete(token);
		return true;
	}

	private async preflightNativeCustomTurn(ctx: ExtensionContext, requireIdle = true): Promise<void> {
		if (this.nativeCompactionPreflight) {
			await this.nativeCompactionPreflight;
			return;
		}
		if (requireIdle) {
			try {
				if (!ctx.isIdle()) return;
			} catch {
				return;
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
			return;
		}
		if (!settings?.enabled || !Number.isFinite(settings.reserveTokens) || settings.reserveTokens < 0) return;
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null || usage.contextWindow <= 0) return;
		if (usage.tokens <= usage.contextWindow - settings.reserveTokens) return;

		const finishPreflight = beginSuiteNativeCompactionPreflight(ctx);
		let tracked: Promise<void>;
		tracked = new Promise<void>((resolve) => {
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
				resolve();
			};
			try {
				ctx.compact({
					onComplete: () => finish(),
					onError: finish,
				});
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		}).finally(() => {
			finishPreflight();
			if (this.nativeCompactionPreflight === tracked) this.nativeCompactionPreflight = undefined;
		});
		this.nativeCompactionPreflight = tracked;
		await tracked;
	}

	async projectCurrentContext(
		audience: ContextProjectionAudience,
		ctx: ExtensionContext,
		options?: ContextProjectionOptions,
	): Promise<ContextProjection> {
		return this.projectionRuntime.projectCurrent(audience, ctx, options);
	}

	private async startMagicContext(
		ctx: ExtensionContext,
		trigger: ContextActivationTrigger,
		generation: number,
		sessionStart: SessionStartEvent | undefined,
	): Promise<ContextStatusSnapshot> {
		const plan: MagicRegistrationPlan = { commands: new Map(), handlers: [], tools: [], shutdownComplete: false };
		let committed = false;
		try {
			const preparation = await this.dependencies.prepareMagicContext(ctx, {
				allowConfigurationMutation: trigger !== "automatic-turn" && trigger !== "startup",
			});
			if (preparation === "deferred") {
				if (!this.isCurrentGeneration(generation)) return { state: "native", engine: "native", trigger };
				this.state = { state: "dormant", engine: "native" };
				return this.status();
			}
			const module = await this.dependencies.magicModules.load();
			if (!this.isCurrentGeneration(generation)) {
				await this.rollbackRegistrationPlan(plan, ctx);
				return { state: "native", engine: "native", trigger };
			}
			const magicPi = magicPiAdapter(this.pi, plan, (data) => this.commandRuntime.captureStatus(data));
			await module.default(magicPi, (cause) => {
				if (!committed || !this.isCurrentGeneration(generation)) return;
				void this.degradeCommittedMagic(cause, ctx);
			});
			if (!this.isCurrentGeneration(generation)) {
				await this.rollbackRegistrationPlan(plan, ctx);
				return { state: "native", engine: "native", trigger };
			}
			// Session startup is part of the activation transaction. Running it before
			// commit lets a partial upstream startup fail open without leaving Magic
			// registered as the active Context owner.
			await this.replaySessionStart(plan, sessionStart, ctx);
			if (!this.isCurrentGeneration(generation)) {
				await this.rollbackRegistrationPlan(plan, ctx);
				return { state: "native", engine: "native", trigger };
			}
			if (!plan.contextHandler) {
				await this.rollbackRegistrationPlan(plan, ctx);
				if (!this.isCurrentGeneration(generation)) return { state: "native", engine: "native", trigger };
				this.dependencies.magicModules.invalidate();
				this.deactivateToolHandoffs();
				this.setDegraded(
					"Magic Context did not register its context adapter; Pi native context remains active.",
					trigger,
				);
				return this.status();
			}
			this.commitRegistrationPlan(plan, generation);
			committed = true;
			this.state = { state: "active", engine: "magic-context", trigger };
			return this.status();
		} catch (error) {
			await this.rollbackRegistrationPlan(plan, ctx);
			if (!this.isCurrentGeneration(generation)) return { state: "native", engine: "native", trigger };
			this.dependencies.magicModules.invalidate();
			this.magicContextHandler = undefined;
			this.deactivateToolHandoffs();
			this.setDegraded(error, trigger);
			return this.status();
		}
	}

	private async replaySessionStart(
		plan: MagicRegistrationPlan,
		event: SessionStartEvent | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		if (!event) return;
		for (const staged of plan.handlers) {
			if (staged.event === "session_start") await staged.handler(event, quietMagicContext(ctx));
		}
	}

	private async degradeCommittedMagic(cause: unknown, ctx: ExtensionContext): Promise<void> {
		const generation = ++this.generation;
		this.projectionRuntime.invalidate(true);
		this.commandRuntime.clearActive();
		this.magicCommands.clear();
		this.magicContextHandler = undefined;
		this.magicSessionStartHandlers = [];
		this.magicTools.clear();
		this.deactivateToolHandoffs();
		this.dependencies.magicModules.invalidate();
		const handlers = this.magicShutdownHandlers.splice(0);
		this.state = { state: "loading", engine: "native", trigger: "startup" };
		let cleanup: Promise<void>;
		cleanup = Promise.resolve()
			.then(async () => {
				for (const handler of handlers) {
					try {
						await handler({ type: "session_shutdown", reason: "reload" }, quietMagicContext(ctx));
					} catch {
						// Native fallback must survive optional engine cleanup failures.
					}
				}
			})
			.finally(() => {
				if (this.cleanup === cleanup) this.cleanup = undefined;
			});
		this.cleanup = cleanup;
		await cleanup;
		if (!this.isCurrentGeneration(generation)) return;
		this.setDegraded(cause, "startup");
	}

	private isCurrentGeneration(generation: number): boolean {
		return !this.disposed && this.generation === generation;
	}

	private async rollbackRegistrationPlan(plan: MagicRegistrationPlan, ctx: ExtensionContext): Promise<void> {
		if (plan.shutdownComplete) return;
		plan.shutdownComplete = true;
		const event: SessionShutdownEvent = this.shutdown?.event ?? { type: "session_shutdown", reason: "reload" };
		for (const { event: name, handler } of plan.handlers) {
			if (name !== "session_shutdown") continue;
			try {
				await handler(event, quietMagicContext(this.shutdown?.ctx ?? ctx));
			} catch {
				// A failed optional engine must not prevent native fallback.
			}
		}
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

	async projectMagicContext(event: ContextEvent, ctx: ExtensionContext): Promise<MagicContextEventResult | undefined> {
		const attempt = await this.projectionRuntime.projectMagicEvent(event, ctx);
		if (!attempt?.full) return attempt?.result;
		if (!this.consumeSuiteCustomContextGuidance()) return attempt.result;
		return {
			...attempt.result,
			messages: addCompactMagicContextMessage(attempt.result?.messages ?? event.messages),
		};
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
					if (this.isCurrentGeneration(generation)) await this.degradeCommittedMagic(error, ctx);
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
				if (this.isCurrentGeneration(generation)) await this.degradeCommittedMagic(error, ctx);
				return;
			}
		});
	}
}
