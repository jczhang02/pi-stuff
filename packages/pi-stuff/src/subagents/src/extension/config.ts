export const MAX_AGENT_DEPTH = 3;
export const MAX_RUNNING_AGENTS = 20;

const CONFIG = Object.freeze({
	maxSubagentDepth: MAX_AGENT_DEPTH,
	maxRunningAgents: MAX_RUNNING_AGENTS,
});
export type PiStuffAgentsConfig = typeof CONFIG;

/** Fixed product invariants; Agents has no private settings file or settings UI. */
export function loadConfig(): PiStuffAgentsConfig {
	return CONFIG;
}
