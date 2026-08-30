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
	readonly runContentOperation: <A, E>(
		ctx: ExtensionContext,
		program: Effect<A, E>,
		signal?: AbortSignal | undefined,
	) => Promise<A>;
}

export function configureRuntimeSsrfDefaults(defaults?: RuntimeSsrfDefaults): void;

declare const piWebAccess: (pi: PiWebAccessHost, effects: WebRuntimeEffectOptions) => void;
export default piWebAccess;
