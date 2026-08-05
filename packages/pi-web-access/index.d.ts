import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface PiWebAccessOptions {
  githubClone?: boolean;
  youtubeSpecialization?: boolean;
}

export interface RuntimeSsrfDefaults {
  readonly allowRanges?: readonly string[];
  readonly trustEnvProxy?: boolean;
}

export function configureRuntimeSsrfDefaults(defaults?: RuntimeSsrfDefaults): void;

export function createPiWebAccess(options?: PiWebAccessOptions): (pi: ExtensionAPI) => void;

declare const piWebAccess: (pi: ExtensionAPI) => void;
export default piWebAccess;
