import { describe, expect, test } from "bun:test";
import { requiresFullAcceptance } from "../../../scripts/ci-acceptance-scope.js";

describe("CI acceptance scope", () => {
	test("skips expensive acceptance for Beads and non-runtime documentation", () => {
		expect(requiresFullAcceptance([".beads/issues.jsonl"])).toBe(false);
		expect(
			requiresFullAcceptance([
				".beads/interactions.jsonl",
				"README.md",
				"AGENTS.md",
				"docs/adr/0001-package-boundary.md",
				"docs/reports/review.html",
				"docs/reports/reference.png",
				"docs/reports/frame.ansi",
			]),
		).toBe(false);
	});

	test("runs expensive acceptance for executable docs and ordinary repository changes", () => {
		expect(requiresFullAcceptance(["docs/examples/capture.sh"])).toBe(true);
		expect(requiresFullAcceptance(["docs/examples/example.ts"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/README.md"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/index.ts"])).toBe(true);
	});

	test("fails open when no changed path can be established", () => {
		expect(requiresFullAcceptance([])).toBe(true);
	});
});
