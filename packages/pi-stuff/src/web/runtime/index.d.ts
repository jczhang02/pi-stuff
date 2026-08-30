import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Effect } from "effect";
import type { WebFetchInput } from "../url-policy.ts";

export interface RuntimeSsrfDefaults {
	readonly allowRanges?: readonly string[];
	readonly trustEnvProxy?: boolean;
}

export type PiWebAccessHost = Pick<ExtensionAPI, "appendEntry" | "on" | "registerTool">;

export class WebContentSessionError extends Error {}

export interface WebRuntimeEffectOptions {
	readonly prepareFetch: (input: WebFetchInput) => Effect<void, Error>;
	readonly runContentOperation: <A, E, Result>(
		ctx: ExtensionContext,
		program: Effect<A, E>,
		handlers: { readonly interrupted?: () => Result; readonly success: (value: A) => Result },
		signal?: AbortSignal | undefined,
	) => Promise<Result>;
}

export function configureRuntimeSsrfDefaults(defaults?: RuntimeSsrfDefaults): void;

declare const piWebAccess: (pi: PiWebAccessHost, effects: WebRuntimeEffectOptions) => void;
export default piWebAccess;
