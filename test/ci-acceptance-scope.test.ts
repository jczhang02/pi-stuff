import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { requiresFullAcceptance } from "../scripts/ci-acceptance-scope.js";

describe("CI acceptance scope", () => {
	test("exposes the stable delivery checks and always aggregates their results", () => {
		const workflow = Bun.YAML.parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
		expect(workflow).toMatchObject({
			jobs: {
				plan: { name: "Plan", outputs: { tests_required: `\${{ steps.scope.outputs.acceptance_required }}` } },
				checks: {
					name: "Checks",
					steps: expect.arrayContaining([expect.objectContaining({ run: "bun run check:fast" })]),
				},
				tests: {
					name: "Tests",
					needs: ["plan", "checks"],
					if: `\${{ needs.plan.outputs.tests_required == 'true' }}`,
					steps: expect.arrayContaining([
						expect.objectContaining({ run: expect.stringContaining("bun run test:ci") }),
					]),
				},
				verify: {
					name: "Verify",
					if: `\${{ always() }}`,
					needs: ["plan", "checks", "tests"],
					steps: expect.arrayContaining([expect.objectContaining({ run: "bun scripts/verify-ci-result.ts" })]),
				},
			},
		});
	});

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
