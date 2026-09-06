import { describe, expect, test } from "bun:test";
import { requiresFullAcceptance } from "../scripts/ci-acceptance-scope.js";

describe("CI acceptance scope", () => {
	test("skips expensive acceptance for Beads and whitelisted engineering documentation", () => {
		expect(requiresFullAcceptance([".beads/issues.jsonl"])).toBe(false);
		expect(
			requiresFullAcceptance([
				".beads/interactions.jsonl",
				"README.md",
				"packages/pi-stuff/README.md",
				"packages/pi-stuff/src/goal/README.md",
				"packages/pi-stuff/src/mcp/runtime/README.md",
				"AGENTS.md",
				".github/CONTRIBUTING.md",
				"docs/adr/0001-package-boundary.md",
				"docs/reports/review.html",
				"docs/reports/reference.png",
				"docs/reports/frame.ansi",
			]),
		).toBe(false);
	});

	test("runs expensive acceptance for runtime resources and ordinary repository changes", () => {
		expect(requiresFullAcceptance(["packages/pi-stuff/src/ponytail/skills/ponytail/SKILL.md"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/src/ponytail/prompt.md"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/suite.json"])).toBe(true);
		expect(requiresFullAcceptance(["docs/examples/capture.sh"])).toBe(true);
		expect(requiresFullAcceptance(["docs/examples/example.ts"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/index.ts"])).toBe(true);
	});

	test("requires full acceptance when documentation is mixed with a runtime change", () => {
		expect(requiresFullAcceptance(["packages/pi-stuff/README.md", "packages/pi-stuff/src/index.ts"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/src/mcp/runtime/README.md", "scripts/verify-package.ts"])).toBe(
			true,
		);
	});

	test("fails open when no changed path can be established", () => {
		expect(requiresFullAcceptance([])).toBe(true);
	});
});
