import { describe, expect, test } from "bun:test";
import { Check } from "typebox/value";
import { toEngineParams } from "../../packages/pi-stuff-agents/src/extension/product-executor.js";
import { SubagentParams } from "../../packages/pi-stuff-agents/src/extension/schemas.js";
import { deriveLaunchRunId } from "../../packages/pi-stuff-agents/src/runs/foreground/subagent-executor.js";

describe("Agent product contract", () => {
	test("accepts only single, parallel, and four current-session controls", () => {
		const accepted = [
			{ agent: "general-purpose", task: "Investigate" },
			{
				tasks: [
					{ agent: "general-purpose", description: "Implement parser", task: "Implement" },
					{ agent: "general-purpose", task: "Review" },
				],
				foreground: true,
				context: "fork",
				isolation: "worktree",
			},
			{ action: "status", id: "run-a" },
			{ action: "steer", id: "run-a", index: 1, message: "Check the parser" },
			{ action: "stop", id: "run-a" },
			{ action: "resume", id: "run-a", message: "Continue" },
		];
		for (const input of accepted) expect(Check(SubagentParams, input)).toBe(true);

		const excluded = [
			{ chain: [{ agent: "general-purpose", task: "Legacy chain" }] },
			{ chainName: "legacy" },
			{ workflow: "legacy" },
			{ memory: { scope: "project" } },
			{ clarify: true },
			{ share: true },
			{ acceptance: { gates: [] } },
			{ review: true },
			{ profile: "fast" },
			{ schedule: "+1h" },
			{ wait: true },
			{ action: "doctor" },
			{ action: "create", agent: "legacy" },
		];
		for (const input of excluded) expect(Check(SubagentParams, input)).toBe(false);
	});

	test("maps the complete allowed parallel launch without legacy fields", () => {
		expect(
			toEngineParams({
				context: "fork",
				foreground: true,
				isolation: "worktree",
				tasks: [
					{
						agent: "general-purpose",
						cwd: "packages/core",
						description: "Implement core change",
						model: "provider/model",
						skill: ["research", "review"],
						task: "Implement and verify",
						toolBudget: { hard: 8, soft: 5, block: ["browser"] },
						turnBudget: { maxTurns: 12, graceTurns: 2 },
					},
				],
			}),
		).toEqual({
			async: false,
			context: "fork",
			tasks: [
				{
					agent: "general-purpose",
					cwd: "packages/core",
					description: "Implement core change",
					model: "provider/model",
					skill: ["research", "review"],
					task: "Implement and verify",
					toolBudget: { hard: 8, soft: 5, block: ["browser"] },
					turnBudget: { maxTurns: 12, graceTurns: 2 },
				},
			],
			worktree: true,
		});
	});

	test("derives a stable filesystem-safe run id from the tool-call id", () => {
		const first = deriveLaunchRunId("tool-call-123");
		expect(first).toBe(deriveLaunchRunId("tool-call-123"));
		expect(first).not.toBe(deriveLaunchRunId("tool-call-456"));
		expect(first).toMatch(/^[a-f0-9]{12}$/);
	});
});
