import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface RuntimeSsrfDefaults {
	readonly allowRanges?: readonly string[];
	readonly trustEnvProxy?: boolean;
}

export type PiWebAccessHost = Pick<ExtensionAPI, "appendEntry" | "on" | "registerTool">;

export function configureRuntimeSsrfDefaults(defaults?: RuntimeSsrfDefaults): void;

declare const piWebAccess: (pi: PiWebAccessHost) => void;
export default piWebAccess;
