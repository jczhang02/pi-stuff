import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import {
	getHostSharedResource,
	hasDirectUserActivation,
	registerSuiteAgentMessagePreparation,
	reportDiagnostic,
} from "../conversation-ui/index.js";
import { deferToHostTurn } from "../lifecycle-deadline.js";
import { type MagicContextPreparation, type MagicContextPreparationOptions, prepareMagicContext } from "./config.js";
import type { MagicModule, NativeCompactionSettings } from "./magic-runtime.js";
import { loadMagicContextWorker } from "./magic-worker-client.js";
import type { ContextProjection, ContextProjectionAudience, ContextProjectionOptions } from "./projection.js";
import { estimateProjectionTokens, extractMagicProjection, formatProjection, nativeProjection } from "./projection.js";
import { applyContextPromptContributions, applyContextPromptContributionsToProvider } from "./prompt-contributions.js";
import {
	type ContextCapability,
	type ContextCapabilityRegistry,
	ContextCapabilityRuntime,
	type ContextCapabilityState,
} from "./runtime.js";

export type { NativeCompactionSettings } from "./magic-runtime.js";
export type {
	ContextProjection,
	ContextProjectionAudience,
	ContextProjectionOptions,
} from "./projection.js";
export type {
	ContextActivationTrigger,
	ContextCapability,
	ContextCapabilityState,
	ContextStatusSnapshot,
} from "./runtime.js";

const CONTEXT_CAPABILITY_REGISTRY = Symbol.for("@jczhang02/pi-stuff-context/runtime/v2");
const CONTEXT_CAPABILITY_DISCOVERY_EVENT = "@jczhang02/pi-stuff-context/runtime-discovery/v1";

const MAGIC_SUBAGENT_ENV = "MAGIC_CONTEXT_PI_SUBAGENT";

export interface ContextCapabilityDependencies {
	readonly loadMagicContext?: () => Promise<MagicModule>;
	readonly magicSubagent?: () => boolean;
	readonly prepareMagicContext?: (
		ctx: ExtensionContext,
		options: MagicContextPreparationOptions,
	) => Promise<MagicContextPreparation | undefined>;
	readonly readNativeCompactionSettings?: (ctx: ExtensionContext) => NativeCompactionSettings | undefined;
}

function capabilityRegistry(): ContextCapabilityRegistry {
	// SAFETY: this package-owned symbol slot is initialized only with ContextCapabilityRegistry.
	const root = globalThis as {
		[key: symbol]: ContextCapabilityRegistry | undefined;
	};
	root[CONTEXT_CAPABILITY_REGISTRY] ??= {
		capabilities: new WeakMap(),
		contexts: new WeakMap(),
		owners: new WeakMap(),
		runtimes: new Set(),
	};
	return root[CONTEXT_CAPABILITY_REGISTRY];
}

function nativeCapability(): ContextCapability {
	return {
		status: () => ({ state: "native", engine: "native" }),
		activate: async () => ({ state: "native", engine: "native" }),
		projectCurrentContext: async (audience, ctx, options) => nativeProjection(audience, ctx, options),
	};
}

function readNativeCompactionSettings(ctx: ExtensionContext): NativeCompactionSettings {
	return SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	}).getCompactionSettings();
}

export function getContextCapability(ctx: ExtensionContext): ContextCapability {
	const registry = capabilityRegistry();
	const runtime = registry.contexts.get(ctx.sessionManager);
	return (runtime && registry.capabilities.get(runtime)) ?? nativeCapability();
}

export async function projectCurrentContext(
	audience: ContextProjectionAudience,
	ctx: ExtensionContext,
	options?: ContextProjectionOptions,
): Promise<ContextProjection> {
	const registry = capabilityRegistry();
	const runtime = registry.contexts.get(ctx.sessionManager);
	const capability = runtime ? registry.capabilities.get(runtime) : undefined;
	return (capability ?? nativeCapability()).projectCurrentContext(audience, ctx, options);
}

async function runContextOwned(ctx: ExtensionContext, program: Effect.Effect<void>): Promise<void> {
	// These callbacks acknowledge before their work settles, so the current Pi
	// Session signal—not a detached Fiber—owns interruption.
	try {
		await Effect.runPromise(program, { signal: ctx.signal });
	} catch (error) {
		if (ctx.signal?.aborted) return;
		reportDiagnostic({
			capability: "Context",
			error,
			key: "owned-effect",
			severity: "error",
			summary: "A Session-owned Context operation failed",
			visibility: "silent",
		});
	}
}

function requiresInputActivation(state: ContextCapabilityState): boolean {
	return state !== "active" && state !== "native";
}

function deferInputActivation(runtime: ContextCapabilityRuntime, ctx: ExtensionContext): void {
	deferToHostTurn(() => {
		if (!runtime.consumeDirectInputActivation()) return;
		if (requiresInputActivation(runtime.status().state)) {
			void runContextOwned(ctx, runtime.activate(ctx, "input"));
		}
	});
}

function registerContextProjection(pi: ExtensionAPI, runtime: ContextCapabilityRuntime): void {
	pi.on("context", (event, ctx) => {
		const interactivePaint = runtime.yieldForInteractivePaint();
		return Effect.runPromise(
			interactivePaint
				? interactivePaint.pipe(
						Effect.flatMap((current) =>
							current ? runtime.projectMagicContext(event, ctx) : Effect.succeed(undefined),
						),
					)
				: runtime.projectMagicContext(event, ctx),
		);
	});
}

export default async function piStuffContext(
	pi: ExtensionAPI,
	dependencies: ContextCapabilityDependencies = {},
): Promise<void> {
	const registry = capabilityRegistry();
	const magicSubagent = dependencies.magicSubagent ?? (() => process.env[MAGIC_SUBAGENT_ENV] === "1");
	let created = false;
	let runtime: ContextCapabilityRuntime;
	const boundary = {
		activate: (ctx: ExtensionContext, trigger: Parameters<ContextCapability["activate"]>[1]) =>
			Effect.runPromise(runtime.activate(ctx, trigger)),
		committedFailure: (cause: unknown, ctx: ExtensionContext) =>
			runContextOwned(ctx, runtime.handleCommittedFailure(cause, ctx)),
	};
	runtime = getHostSharedResource(
		pi.events,
		registry.owners,
		CONTEXT_CAPABILITY_DISCOVERY_EVENT,
		() => {
			created = true;
			return new ContextCapabilityRuntime(
				pi,
				{
					loadMagicContext: dependencies.loadMagicContext ?? loadMagicContextWorker,
					magicSubagent,
					readNativeCompactionSettings: dependencies.readNativeCompactionSettings ?? readNativeCompactionSettings,
					prepareMagicContext:
						dependencies.prepareMagicContext ??
						(dependencies.loadMagicContext ? async () => undefined : prepareMagicContext),
				},
				registry,
				boundary,
			);
		},
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	if (!created) return;
	registry.runtimes.add(runtime);
	registry.capabilities.set(runtime, {
		status: () => runtime.status(),
		activate: boundary.activate,
		projectCurrentContext: (audience, ctx, options) =>
			Effect.runPromise(runtime.projectCurrentContext(audience, ctx, options)),
	});
	const unregisterSuiteAgentMessagePreparation = registerSuiteAgentMessagePreparation(pi, {
		prepare: (origin, options) => Effect.runPromise(runtime.prepareSuiteAgentMessage(origin, options)),
		stage: (options) => {
			const token = runtime.stageSuiteCustomContextGuidance(options);
			return token ? () => runtime.cancelSuiteCustomContextGuidance(token) : undefined;
		},
	});
	pi.on("session_shutdown", (event, ctx) => {
		unregisterSuiteAgentMessagePreparation();
		return Effect.runPromise(runtime.dispose(event, ctx));
	});
	runtime.registerToolHandoffs();

	pi.on("session_start", (event, ctx) => Effect.runPromise(runtime.startSession(event, ctx)));
	registerContextProjection(pi, runtime);
	pi.on("session_compact", () => runtime.invalidateProjection());
	pi.on("session_tree", () => {
		runtime.invalidateProjection();
	});
	pi.on("input", (event, ctx) => {
		const state = runtime.noteInput(event.source);
		// A later Extension may still handle an Extension-authored input, in which
		// case Pi never starts an Agent turn. Defer that path to the authoritative
		// before_agent_start boundary so a display-only or rejected continuation
		// cannot initialize or write Magic Context state. Direct user input starts
		// activation without delaying the Host's input acknowledgement.
		if (event.source !== "extension" && requiresInputActivation(state)) {
			deferInputActivation(runtime, ctx);
		}
	});
	pi.on("message_start", async (event, ctx) => {
		if (event.message.role !== "custom") return;
		try {
			// Pi also emits message_start for idle, non-triggering display entries.
			if (ctx.isIdle()) return;
		} catch {
			// A real Pi Host supplies this boundary. A partial third-party wrapper
			// fails toward preserving context for accepted custom Agent work.
		}
		await boundary.activate(ctx, hasDirectUserActivation(event.message) ? "input" : "automatic-turn");
	});
	// Pi checks compaction after input interception but before before_agent_start.
	// This lightweight gate joins the activation already started by input, so an
	// immediate first submission can paint without allowing native compaction to
	// race ahead of Magic Context.
	pi.on("session_before_compact", async (_event, ctx) => {
		runtime.consumeDirectInputActivation();
		await boundary.activate(ctx, "input");
		runtime.yieldExtremeOverflowToNative(ctx);
	});
	pi.on("before_agent_start", async (event, ctx) => {
		const trigger = runtime.consumeDirectInputActivation() ? "input" : "automatic-turn";
		await Effect.runPromise(
			runtime.activate(ctx, trigger).pipe(Effect.andThen(runtime.preflightExtremeOverflow(ctx))),
		);
		return applyContextPromptContributions(pi, event, ctx);
	});
	let providerPromptDiagnosticReported = false;
	pi.on("before_provider_request", async (event, ctx) => {
		const projection = await applyContextPromptContributionsToProvider(pi, event.payload, ctx);
		if (projection.active && !projection.found && !providerPromptDiagnosticReported) {
			providerPromptDiagnosticReported = true;
			reportDiagnostic({
				capability: "Context",
				error: new Error("Provider payload has no supported system-prompt field."),
				key: "provider-prompt-contribution",
				severity: "warning",
				summary: "A Context prompt contribution could not be projected into this Provider request",
				visibility: "silent",
			});
		}
		return projection.payload === event.payload ? undefined : projection.payload;
	});
}

export { registerContextPromptContributor } from "./prompt-contributions.js";

export const __test = {
	async clear(): Promise<void> {
		const registry = capabilityRegistry();
		await Promise.all(Array.from(registry.runtimes, (runtime) => Effect.runPromise(runtime.dispose())));
		// SAFETY: this package-owned symbol slot contains only ContextCapabilityRegistry.
		const root = globalThis as { [key: symbol]: ContextCapabilityRegistry | undefined };
		delete root[CONTEXT_CAPABILITY_REGISTRY];
	},
	extractMagicProjection,
	estimateProjectionTokens,
	formatProjection,
	requiresInputActivation,
};
