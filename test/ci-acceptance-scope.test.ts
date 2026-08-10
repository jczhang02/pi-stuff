import { describe, expect, test } from "bun:test";
import { requiresFullAcceptance } from "../scripts/ci-acceptance-scope.js";

describe("CI acceptance scope", () => {
	test("skips expensive acceptance only for Beads and recorded visual evidence", () => {
		expect(requiresFullAcceptance([".beads/issues.jsonl"])).toBe(false);
		expect(
			requiresFullAcceptance([
				".beads/interactions.jsonl",
				"docs/prototypes/tui/report.html",
				"docs/prototypes/tui/artifacts/reference.png",
				"docs/prototypes/tui/artifacts/frame.ansi",
			]),
		).toBe(false);
	});

	test("runs expensive acceptance for executable docs and ordinary repository changes", () => {
		expect(requiresFullAcceptance(["docs/prototypes/tui/capture.sh"])).toBe(true);
		expect(requiresFullAcceptance(["docs/prototypes/tui/prototype.ts"])).toBe(true);
		expect(requiresFullAcceptance(["README.md"])).toBe(true);
		expect(requiresFullAcceptance(["packages/pi-stuff/index.ts"])).toBe(true);
	});

	test("fails open when no changed path can be established", () => {
		expect(requiresFullAcceptance([])).toBe(true);
	});
});
