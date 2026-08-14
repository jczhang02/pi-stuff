import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hasDirectUserActivation } from "./agent-run-origin.js";
import { getHostSharedResource } from "./host-resource.js";

const SUITE_AGENT_MESSAGE_BROKER_DISCOVERY = "@jczhang02/pi-stuff-ui/suite-agent-message-broker/v1";
const SUITE_AGENT_MESSAGE_BROKERS = Symbol.for("@jczhang02/pi-stuff-ui/suite-agent-message-brokers/v1");
const NATIVE_COMPACTION_PREFLIGHTS = Symbol.for("@jczhang02/pi-stuff-ui/native-compaction-preflights/v1");

type SuiteAgentMessage = Parameters<ExtensionAPI["sendMessage"]>[0];
export type SuiteAgentMessageOptions = Parameters<ExtensionAPI["sendMessage"]>[1];

export interface SuiteAgentMessagePreparationDecision {
	readonly status: "convergence-blocked";
	readonly reason: string;
}

export type SuiteAgentMessageDeliveryResult = "accepted" | "stale" | "convergence-blocked";

export interface SuiteAgentMessagePreparation {
	prepare(
		activation: "automatic" | "direct-user",
		options: SuiteAgentMessageOptions,
	): Promise<SuiteAgentMessagePreparationDecision | undefined> | Promise<void>;
	/** Stage provider-only state immediately before the Host accepts the message. */
	stage?(options: SuiteAgentMessageOptions): (() => void) | undefined;
}

interface SuiteAgentMessageBroker {
	preparation: SuiteAgentMessagePreparation | undefined;
}

function brokerRegistry(): WeakMap<object, SuiteAgentMessageBroker> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<object, SuiteAgentMessageBroker> | undefined;
	};
	root[SUITE_AGENT_MESSAGE_BROKERS] ??= new WeakMap();
	return root[SUITE_AGENT_MESSAGE_BROKERS];
}

function brokerFor(pi: Pick<ExtensionAPI, "events">): SuiteAgentMessageBroker {
	const registry = brokerRegistry();
	const events = Reflect.get(pi as object, "events");
	if (typeof events === "object" && events !== null) {
		return getHostSharedResource(
			events as ExtensionAPI["events"],
			registry,
			SUITE_AGENT_MESSAGE_BROKER_DISCOVERY,
			() => ({ preparation: undefined }),
		);
	}
	const key = pi as object;
	let broker = registry.get(key);
	if (!broker) {
		broker = { preparation: undefined };
		registry.set(key, broker);
	}
	return broker;
}

/** Install the optional Context preparation hook on the shared Host delivery seam. */
export function registerSuiteAgentMessagePreparation(
	pi: Pick<ExtensionAPI, "events">,
	preparation: SuiteAgentMessagePreparation,
): () => void {
	const broker = brokerFor(pi);
	if (broker.preparation && broker.preparation !== preparation) {
		throw new Error("Suite Agent message preparation is already registered for this Pi Host");
	}
	broker.preparation = preparation;
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		if (broker.preparation === preparation) broker.preparation = undefined;
	};
}

/**
 * Send Suite-owned custom Agent work only after every installed preparation
 * hook has settled. The seam stays in the shared layer so Capability Modules do
 * not depend on Context; Context contributes behavior by registration instead.
 */
export async function deliverSuiteAgentMessage(
	pi: ExtensionAPI,
	message: SuiteAgentMessage,
	options?: SuiteAgentMessageOptions,
	isCurrent: () => boolean = () => true,
	onAccepted?: () => void,
): Promise<SuiteAgentMessageDeliveryResult> {
	if (!isCurrent()) return "stale";
	const preparation = brokerFor(pi).preparation;
	const decision = preparation
		? await preparation.prepare(hasDirectUserActivation(message) ? "direct-user" : "automatic", options)
		: undefined;
	if (!isCurrent()) return "stale";
	const blocked = typeof decision === "object" && decision?.status === "convergence-blocked";
	const deliveryOptions = blocked ? { ...options, triggerTurn: false } : options;
	const rollback = blocked ? undefined : preparation?.stage?.(deliveryOptions);
	try {
		const delivered = pi.sendMessage(message, deliveryOptions) as unknown;
		if (
			delivered !== null &&
			(typeof delivered === "object" || typeof delivered === "function") &&
			typeof Reflect.get(delivered, "then") === "function"
		) {
			await Promise.resolve(delivered as PromiseLike<unknown>);
		}
	} catch (error) {
		rollback?.();
		throw error;
	}
	if (!blocked) onAccepted?.();
	return blocked ? "convergence-blocked" : "accepted";
}

export async function sendSuiteAgentMessage(
	pi: ExtensionAPI,
	message: SuiteAgentMessage,
	options?: SuiteAgentMessageOptions,
	isCurrent: () => boolean = () => true,
	onAccepted?: () => void,
): Promise<boolean> {
	return (await deliverSuiteAgentMessage(pi, message, options, isCurrent, onAccepted)) !== "stale";
}

function nativeCompactionPreflights(): WeakMap<object, number> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<object, number> | undefined;
	};
	root[NATIVE_COMPACTION_PREFLIGHTS] ??= new WeakMap();
	return root[NATIVE_COMPACTION_PREFLIGHTS];
}

/** Mark a public Pi compaction as the Suite's custom-turn safety preflight. */
export function beginSuiteNativeCompactionPreflight(ctx: Pick<ExtensionContext, "sessionManager">): () => void {
	const preflights = nativeCompactionPreflights();
	const key = ctx.sessionManager;
	preflights.set(key, (preflights.get(key) ?? 0) + 1);
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		const remaining = (preflights.get(key) ?? 1) - 1;
		if (remaining > 0) preflights.set(key, remaining);
		else preflights.delete(key);
	};
}

export function isSuiteNativeCompactionPreflight(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
	return (nativeCompactionPreflights().get(ctx.sessionManager) ?? 0) > 0;
}
