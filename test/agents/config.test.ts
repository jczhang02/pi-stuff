import { expect, test } from "bun:test";
import {
	loadConfig,
	MAX_AGENT_DEPTH,
	MAX_AGENTS_PER_SESSION,
	MAX_RUNNING_AGENTS,
} from "../../packages/pi-stuff/src/subagents/src/extension/config.ts";

test("Agent resource limits are fixed product invariants rather than a private settings surface", () => {
	expect(loadConfig()).toEqual({
		maxAgentsPerSession: 200,
		maxRunningAgents: 20,
		maxSubagentDepth: 3,
	});
	expect([MAX_AGENT_DEPTH, MAX_RUNNING_AGENTS, MAX_AGENTS_PER_SESSION]).toEqual([3, 20, 200]);
	expect(Object.isFrozen(loadConfig())).toBeTrue();
});
