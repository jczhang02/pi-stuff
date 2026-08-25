import { describe, expect, test } from "bun:test";
import type { BeforeAgentStartEvent, ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { PONYTAIL_SKILL_NAMES, PonytailPromptRenderer } from "../../packages/pi-stuff/src/ponytail/prompt.js";

function skill(name: string): Skill {
	return {
		baseDir: "/package/skills",
		description: `${name} description`,
		disableModelInvocation: false,
		filePath: `/package/skills/${name}/SKILL.md`,
		name,
		sourceInfo: { path: `/package/skills/${name}/SKILL.md`, source: "package" },
	} as Skill;
}

function event(systemPrompt = "Host"): BeforeAgentStartEvent {
	return {
		type: "before_agent_start",
		prompt: "task",
		systemPrompt,
		systemPromptOptions: { cwd: "/workspace", skills: PONYTAIL_SKILL_NAMES.map(skill) },
	} as BeforeAgentStartEvent;
}

function pi(tools: string[]): ExtensionAPI {
	return { getActiveTools: () => tools } as ExtensionAPI;
}

describe("Ponytail prompt renderer", () => {
	test("uses the Host catalog when top-level read is active", () => {
		const rendered = new PonytailPromptRenderer(pi(["read", "bash"])).renderAgent(event(), "full");
		expect(rendered).toStartWith("PONYTAIL MODE ACTIVE — level: full");
		expect(rendered).not.toContain("<available_skills>");
	});

	test("restores all six model-visible Skills under Code Mode before instructions", () => {
		const rendered = new PonytailPromptRenderer(pi(["codemode"])).renderAgent(event(), "ultra");
		if (!rendered) throw new Error("Ponytail did not render");
		expect(rendered).toContain("<available_skills>");
		for (const name of PONYTAIL_SKILL_NAMES) expect(rendered).toContain(`<name>${name}</name>`);
		expect(rendered.indexOf("<available_skills>")).toBeLessThan(rendered.indexOf("PONYTAIL MODE ACTIVE"));
		expect(rendered.match(/<name>ponytail<\/name>/gu)).toHaveLength(1);
	});

	test("keeps the Code Mode catalog visible while runtime mode is off", () => {
		const rendered = new PonytailPromptRenderer(pi(["codemode"])).renderAgent(event(), "off");
		expect(rendered).toContain("<available_skills>");
		expect(rendered).not.toContain("PONYTAIL MODE ACTIVE");
	});

	test("does not recreate Skills removed by Host resource filtering", () => {
		const renderer = new PonytailPromptRenderer(pi(["codemode"]));
		const noSkills = { ...event(), systemPromptOptions: { cwd: "/workspace", skills: [] } } as BeforeAgentStartEvent;
		expect(renderer.renderAgent(noSkills, "off")).toBeUndefined();
		expect(renderer.renderProvider("off")).toBeUndefined();
	});

	test("reuses the latest Host-visible catalog for Provider fallback", () => {
		const renderer = new PonytailPromptRenderer(pi(["codemode"]));
		renderer.renderAgent(event(), "full");
		const rendered = renderer.renderProvider("lite");
		expect(rendered).toContain("<available_skills>");
		expect(rendered).toContain("PONYTAIL MODE ACTIVE — level: lite");
	});
});
