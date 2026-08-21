import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Guard } from "typebox/guard";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { isRuntimeObject } from "../shared/runtime-type.js";

type SessionManager = ExtensionContext["sessionManager"];

interface ReadinessGate {
	readonly sessionManager: SessionManager;
	readonly promise: Promise<boolean>;
	resolve(ready: boolean): void;
	settled: boolean;
}

interface ReadinessState {
	activation: symbol | undefined;
	api: ExtensionAPI | undefined;
	current: ReadinessGate | undefined;
	installed: boolean;
}

const READINESS_STATES = new WeakMap<object, ReadinessState>();

function stateFor(pi: Pick<ExtensionAPI, "events">): ReadinessState {
	let state = READINESS_STATES.get(pi.events);
	if (!state) {
		state = { activation: undefined, api: undefined, current: undefined, installed: false };
		READINESS_STATES.set(pi.events, state);
	}
	return state;
}

function createGate(sessionManager: SessionManager): ReadinessGate {
	let settle = (_ready: boolean): void => {};
	const gate: ReadinessGate = {
		promise: new Promise<boolean>((resolve) => {
			settle = resolve;
		}),
		resolve(ready) {
			if (gate.settled) return;
			gate.settled = true;
			settle(ready);
		},
		sessionManager,
		settled: false,
	};
	return gate;
}

function createReadinessApi(pi: ExtensionAPI): ExtensionAPI {
	const on = ((event: string, handler: (...args: unknown[]) => unknown) => {
		if (event !== "session_start") {
			(pi.on as unknown as (name: string, value: typeof handler) => void)(event, handler);
			return;
		}
		(pi.on as unknown as (name: string, value: typeof handler) => void)(event, async (...args: unknown[]) => {
			try {
				return await handler(...args);
			} catch (error) {
				const ctx = args[1];
				if (ctx && isRuntimeObject(ctx)) {
					rejectSuiteSessionReadiness(pi, ctx as ExtensionContext);
				}
				throw error;
			}
		});
	}) as ExtensionAPI["on"];
	return new Proxy(pi, {
		get(target, property) {
			if (property === "on") return on;
			const value = readHostProxyProperty(target, property, target);
			return Guard.IsFunction(value) ? value.bind(target) : value;
		},
	});
}

/**
 * Register the first Suite session observer and return the API used by every
 * Capability. Its session_start wrapper records any earlier handler failure so
 * the final readiness marker cannot release Goal startup into a partial Suite.
 */
export function installSuiteSessionReadiness(pi: ExtensionAPI): ExtensionAPI {
	const state = stateFor(pi);
	state.api ??= createReadinessApi(pi);
	if (state.installed) return state.api;
	const activation = Symbol("suite-session-readiness");
	state.activation = activation;
	state.installed = true;
	pi.on("session_start", (_event, ctx) => {
		if (state.activation !== activation) return;
		state.current?.resolve(false);
		state.current = createGate(ctx.sessionManager);
	});
	pi.on("session_shutdown", () => {
		if (state.activation !== activation) return;
		state.current?.resolve(false);
		state.current = undefined;
	});
	return state.api;
}

/** Resolve only after every Suite Capability's session_start handler has settled. */
export function markSuiteSessionReady(pi: Pick<ExtensionAPI, "events">, ctx: ExtensionContext): void {
	const state = READINESS_STATES.get(pi.events);
	if (!state?.installed || state.current?.sessionManager !== ctx.sessionManager) return;
	state.current.resolve(true);
}

/** Reject startup work when the aggregate Suite cannot prove a safe session. */
export function rejectSuiteSessionReadiness(pi: Pick<ExtensionAPI, "events">, ctx: ExtensionContext): void {
	const state = READINESS_STATES.get(pi.events);
	if (!state?.installed || state.current?.sessionManager !== ctx.sessionManager) return;
	state.current.resolve(false);
}

/** Standalone Capability loading has no Suite barrier and is ready immediately. */
export function whenSuiteSessionReady(pi: Pick<ExtensionAPI, "events">, ctx: ExtensionContext): Promise<boolean> {
	const state = READINESS_STATES.get(pi.events);
	if (!state?.installed) return Promise.resolve(true);
	if (state.current?.sessionManager !== ctx.sessionManager) return Promise.resolve(false);
	return state.current.promise;
}
