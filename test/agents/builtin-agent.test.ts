import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENT_NAMES, discoverAgents } from "../../packages/pi-stuff-agents/src/agents/agents.js";

describe("Pi Stuff built-in Agent", () => {
	test("keeps one immediately usable general Agent instead of an upstream role zoo", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-stuff-agent-discovery-"));
		try {
			const builtin = discoverAgents(cwd, "project").agents.filter(({ source }) => source === "builtin");
			expect(BUILTIN_AGENT_NAMES).toEqual(["general-purpose"]);
			expect(builtin).toHaveLength(1);
			expect(builtin[0]).toMatchObject({
				inheritProjectContext: true,
				inheritSkills: true,
				name: "general-purpose",
				systemPromptMode: "append",
			});
			expect(builtin[0]?.systemPrompt).toContain("Work on the delegated task independently");
			expect(builtin[0]?.systemPrompt).toContain("Complete small or self-contained work directly");
			expect(builtin[0]?.systemPrompt).toContain("never fan out merely to inspect a few files");
		} finally {
			rmSync(cwd, { force: true, recursive: true });
		}
	});
});
