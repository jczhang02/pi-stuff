import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type BeforeAgentStartEvent, type ExtensionAPI, loadSkills } from "@earendil-works/pi-coding-agent";
import { PonytailPromptRenderer } from "../../packages/pi-stuff/src/ponytail/prompt.js";
import { countPonytailPromptTokens } from "../../packages/pi-stuff/src/ponytail/prompt-budget.js";

const PONYTAIL_ROOT = resolve(import.meta.dir, "../../packages/pi-stuff/src/ponytail");
function prompt(tools: readonly string[]): string {
	const skills = loadSkills({
		agentDir: resolve(import.meta.dir, ".missing-agent-dir"),
		cwd: PONYTAIL_ROOT,
		includeDefaults: false,
		skillPaths: [resolve(PONYTAIL_ROOT, "skills")],
	}).skills;
	// SAFETY: the renderer reads only getActiveTools from this controlled Host fixture.
	const pi = { getActiveTools: () => [...tools] } as ExtensionAPI;
	// SAFETY: this fixture supplies every BeforeAgentStartEvent field read by the renderer.
	const event = {
		type: "before_agent_start",
		prompt: "task",
		systemPrompt: "Host",
		systemPromptOptions: { cwd: PONYTAIL_ROOT, skills },
	} as BeforeAgentStartEvent;
	return new PonytailPromptRenderer(pi).renderAgent(event, "full") ?? "";
}

describe("Ponytail prompt budget", () => {
	test("budgets Ponytail independently from Context Management", () => {
		const ordinary = prompt(["read", "bash"]);
		const codeMode = prompt(["codemode"]);
		const ordinaryTokens = countPonytailPromptTokens(ordinary);
		const codeModeTokens = countPonytailPromptTokens(codeMode);

		expect(ordinary).toContain("PONYTAIL MODE ACTIVE — level: full");
		expect(ordinary).not.toContain("<available_skills>");
		expect(codeMode).toContain("<available_skills>");
		expect(ordinary.length).toBeLessThanOrEqual(5_500);
		expect(ordinaryTokens).toBeLessThanOrEqual(1_400);
		expect(codeModeTokens - ordinaryTokens).toBeLessThanOrEqual(1_400);
		expect(codeModeTokens).toBeLessThanOrEqual(2_800);
	});
});
