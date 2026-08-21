import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface PiWebAccessOptions {
  githubClone?: boolean;
  youtubeSpecialization?: boolean;
}

export interface RuntimeSsrfDefaults {
  readonly allowRanges?: readonly string[];
  readonly trustEnvProxy?: boolean;
}

export type PiWebAccessHost = Pick<
  ExtensionAPI,
  "appendEntry" | "exec" | "on" | "registerCommand" | "registerShortcut" | "registerTool" | "sendMessage"
>;

export function configureRuntimeSsrfDefaults(defaults?: RuntimeSsrfDefaults): void;

export function createPiWebAccess(options?: PiWebAccessOptions): (pi: PiWebAccessHost) => void;

declare const piWebAccess: (pi: PiWebAccessHost) => void;
export default piWebAccess;
