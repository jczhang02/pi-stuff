import type { ExtensionConfig } from "../shared/types.ts";

export const MAX_AGENT_DEPTH = 3;
export const MAX_RUNNING_AGENTS = 20;
export const MAX_AGENTS_PER_SESSION = 200;

export interface PiStuffAgentsConfig extends ExtensionConfig {
	readonly maxSubagentDepth: 3;
	readonly maxRunningAgents: 20;
	readonly maxAgentsPerSession: 200;
}

const CONFIG: PiStuffAgentsConfig = Object.freeze({
	maxSubagentDepth: MAX_AGENT_DEPTH,
	maxRunningAgents: MAX_RUNNING_AGENTS,
	maxAgentsPerSession: MAX_AGENTS_PER_SESSION,
});

/** Fixed product invariants; Agents has no private settings file or settings UI. */
export function loadConfig(): PiStuffAgentsConfig {
	return CONFIG;
}
