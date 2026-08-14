import { describe, expect, test } from "bun:test";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import {
	__workContinuityTest,
	WorkContinuityGovernor,
} from "../../packages/pi-stuff/src/context-management/work-continuity.js";

function input(governor: WorkContinuityGovernor, text: string, behavior: "idle" | "steer" | "followUp" = "idle") {
	governor.noteInput({ source: "interactive", ...(behavior === "idle" ? {} : { streamingBehavior: behavior }), text });
	governor.noteMessageStart({ role: "user", content: [{ type: "text", text }] }, true);
}

function context(messages: ContextEvent["messages"] = []): ContextEvent {
	return { type: "context", messages };
}

function anchorContent(result: ReturnType<WorkContinuityGovernor["project"]>): string {
	const anchor = result?.messages.find(
		(message) => message.role === "custom" && message.customType === __workContinuityTest.TASK_ANCHOR_TYPE,
	);
	return anchor?.role === "custom" && typeof anchor.content === "string" ? anchor.content : "";
}

function toolResult(governor: WorkContinuityGovernor, toolName: string, content: string, isError = false) {
	governor.noteToolResult({
		toolName,
		input: { path: content },
		content: [{ type: "text", text: content }],
		isError,
	});
}

describe("user-work continuity governor", () => {
	test("starts user-attributed custom work even when no raw input event exists", () => {
		const governor = new WorkContinuityGovernor();
		governor.noteMessageStart(
			{
				role: "custom",
				content: "Implement the requested change. Return the verified result and any remaining limitation.",
			},
			true,
		);

		const content = anchorContent(governor.project(context()));
		expect(content).toContain("Implement the requested change");
		expect(content).toContain("Return the verified result");
	});

	test("injects one bounded current-request anchor on every provider context projection", () => {
		const governor = new WorkContinuityGovernor();
		input(
			governor,
			"Review the Subagents implementation. You must run the Agent matrix. Final output must include findings and a merge recommendation.",
		);

		const first = governor.project(context());
		const content = anchorContent(first);
		expect(content).toContain("Current request:");
		expect(content).toContain("Review the Subagents implementation");
		expect(content).toContain("Required deliverable:");
		expect(content).toContain("Material constraints:");
		expect(content).toContain("Done when:");

		const second = governor.project(context(first?.messages ?? []));
		expect(
			second?.messages.filter(
				(message) => message.role === "custom" && message.customType === __workContinuityTest.TASK_ANCHOR_TYPE,
			),
		).toHaveLength(1);
	});

	test("keeps the canonical conversation after the projected task anchor", () => {
		const governor = new WorkContinuityGovernor();
		input(governor, "Review the implementation and report the verified result.");
		const original = [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "Review the implementation and report the verified result." }],
				timestamp: 1,
			},
		];

		const projected = governor.project(context(original));

		expect(projected?.messages[0]).toMatchObject({
			role: "custom",
			customType: __workContinuityTest.TASK_ANCHOR_TYPE,
		});
		expect(projected?.messages.slice(1)).toEqual(original);
	});

	test("preserves the latest user correction as authoritative across repeated managed compactions", () => {
		const governor = new WorkContinuityGovernor({ softCompactions: 30, hardCompactions: 40 });
		input(governor, "Investigate the long-running Agent failure and return a detailed written report.");
		input(
			governor,
			"Stop exploring immediately. Report now using existing evidence. Do not call more Tools.",
			"steer",
		);
		for (let index = 0; index < 30; index++) governor.noteCompaction();

		const content = anchorContent(governor.project(context()));
		expect(content).toContain("Latest user correction (authoritative");
		expect(content).toContain("Stop exploring immediately");
		expect(content).toContain("Report now using existing evidence");
		expect(content).toContain("Do not call more Tools");
	});

	test("counts direct managed-history entries once while ignoring the pre-work baseline", () => {
		const governor = new WorkContinuityGovernor({ softCompactions: 2, hardCompactions: 4 });
		governor.resetForSession([{ type: "compaction", id: "historical" }]);
		input(governor, "Investigate the failure and return a supported conclusion.");

		governor.observeCompactions([
			{ type: "compaction", id: "historical" },
			{ type: "compaction", id: "managed-1" },
		]);
		governor.observeCompactions([
			{ type: "compaction", id: "historical" },
			{ type: "compaction", id: "managed-1" },
		]);
		expect(governor.snapshot().compactions).toBe(1);

		governor.observeCompactions([
			{ type: "compaction", id: "historical" },
			{ type: "compaction", id: "managed-1" },
			{ type: "compaction", id: "managed-2" },
		]);
		expect(governor.snapshot()).toMatchObject({ compactions: 2, synthesisCause: "compactions" });
	});

	test("requires synthesis after aggregate growth even when every Tool call succeeds", () => {
		const governor = new WorkContinuityGovernor({
			softTurns: 3,
			softTools: 4,
			hardTurns: 6,
			hardTools: 8,
			evidenceProgressCredits: 1,
		});
		input(governor, "Audit this branch and return the findings.");

		for (let index = 0; index < 4; index++) {
			expect(governor.noteToolCall({ toolName: "read" })).toBeUndefined();
			toolResult(governor, "read", `unique-evidence-${index}`);
			governor.noteTurnEnd({ turnIndex: index });
		}

		const content = anchorContent(governor.project(context()));
		expect(content).toContain("Convergence state: SYNTHESIS REQUIRED");
		expect(content).toContain("Stop expanding the investigation");

		const decision = governor.noteToolCall({ toolName: "read" });
		expect(decision?.block).toBe(true);
		expect(decision?.reason).toContain("return the best supported result now");
	});

	test("repeated identical evidence is not unlimited progress", () => {
		const governor = new WorkContinuityGovernor({
			softTurns: 100,
			softTools: 100,
			noProgressTurns: 2,
			evidenceProgressCredits: 1,
		});
		input(governor, "Inspect the code and report.");
		for (let index = 0; index < 3; index++) {
			governor.noteToolCall({ toolName: "read" });
			toolResult(governor, "read", "the same evidence");
			governor.noteTurnEnd({ turnIndex: index });
		}
		expect(governor.snapshot().synthesisCause).toBe("no-progress");
	});

	test("different inputs with repeated or empty Tool output do not refresh progress", () => {
		const governor = new WorkContinuityGovernor({
			softTurns: 100,
			softTools: 100,
			noProgressTurns: 2,
			evidenceProgressCredits: 1,
		});
		input(governor, "Inspect the code and report only supported findings.");

		for (const [index, text] of ["the same evidence", "the same evidence", ""].entries()) {
			governor.noteToolCall({ toolName: "read", input: { path: `different-${index}.ts` } });
			governor.noteToolResult({
				toolName: "read",
				input: { path: `different-${index}.ts` },
				content: text ? [{ type: "text", text }] : [],
				isError: false,
			});
			governor.noteTurnEnd({ turnIndex: index });
		}

		expect(governor.snapshot().synthesisCause).toBe("no-progress");
	});

	test("keeps successful Bun verification visible until later work changes", () => {
		const governor = new WorkContinuityGovernor({
			softTurns: 100,
			softTools: 100,
			noProgressTurns: 2,
		});
		input(governor, "Review the diff, run the requested Bun tests once, and return the verified result.");
		governor.noteToolResult({
			toolName: "bash",
			input: { command: "bun test requested-files" },
			content: [
				{ type: "text", text: "158 pass\n0 fail\n594 expect() calls\nRan 158 tests across 3 files. [50.11s]" },
			],
			isError: false,
		});

		const verifiedProjection = governor.project(
			context([
				{
					role: "user",
					content: [{ type: "text", text: "Review the diff and run the requested Bun tests once." }],
					timestamp: 1,
				},
			]),
		);
		const verified = anchorContent(verifiedProjection);
		expect(verified).toContain("Completed verification (do not rerun unless later work changed):");
		expect(verified).toContain("command: bun test requested-files");
		expect(verified).toContain("158 pass; 0 fail; Ran 158 tests across 3 files.");
		expect(verified).not.toContain("50.11s");
		expect(verifiedProjection?.messages.at(-1)).toMatchObject({
			role: "custom",
			customType: __workContinuityTest.TASK_ANCHOR_TYPE,
		});
		governor.noteTurnEnd({ turnIndex: 0 });

		for (const [index, duration] of ["50.12s", "50.13s"].entries()) {
			governor.noteToolResult({
				toolName: "bash",
				input: { command: "bun test requested-files" },
				content: [
					{
						type: "text",
						text: `158 pass\n0 fail\n594 expect() calls\nRan 158 tests across 3 files. [${duration}]`,
					},
				],
				isError: false,
			});
			governor.noteTurnEnd({ turnIndex: index + 1 });
		}
		expect(governor.snapshot().synthesisCause).toBe("no-progress");

		toolResult(governor, "edit", "changed source");
		expect(anchorContent(governor.project(context()))).not.toContain("Completed verification");
	});

	test("blocks the next automatic continuation at hard turn or compaction boundaries", () => {
		const turnGovernor = new WorkContinuityGovernor({ softTurns: 1, hardTurns: 2 });
		input(turnGovernor, "Finish the task and return one final report.");
		turnGovernor.noteTurnEnd({ turnIndex: 0 });
		expect(turnGovernor.automaticContinuationBlockReason()).toBeUndefined();
		turnGovernor.noteTurnEnd({ turnIndex: 1 });
		expect(turnGovernor.automaticContinuationBlockReason()).toContain("return the best supported result now");

		const compactionGovernor = new WorkContinuityGovernor({ softCompactions: 1, hardCompactions: 2 });
		input(compactionGovernor, "Preserve this request and return the verified result.");
		compactionGovernor.noteCompaction();
		expect(compactionGovernor.automaticContinuationBlockReason()).toBeUndefined();
		compactionGovernor.noteCompaction();
		expect(compactionGovernor.automaticContinuationBlockReason()).toContain("return the best supported result now");
	});

	test("continues recognizing unique evidence after the per-turn evidence allowance resets", () => {
		const governor = new WorkContinuityGovernor({
			softTurns: 100,
			softTools: 100,
			noProgressTurns: 2,
			evidenceProgressCredits: 1,
		});
		input(governor, "Inspect each distinct result and return one supported review.");

		for (let index = 0; index < 25; index++) {
			governor.noteToolCall({ toolName: "read" });
			toolResult(governor, "read", `unique-later-turn-evidence-${index}`);
			governor.noteTurnEnd({ turnIndex: index });
		}

		expect(governor.snapshot()).toMatchObject({
			turns: 25,
			noProgressTurns: 0,
		});
		expect(governor.snapshot().synthesisCause).toBeUndefined();
	});

	test("default limits do not interrupt a bounded 80-turn review with 480 unique Tool results", () => {
		const governor = new WorkContinuityGovernor();
		input(governor, "Complete a repository review and return one evidence-backed merge recommendation.");

		for (let turn = 0; turn < 80; turn++) {
			for (let result = 0; result < 6; result++) {
				expect(governor.noteToolCall({ toolName: "read" })).toBeUndefined();
				toolResult(governor, "read", `turn-${turn}-unique-evidence-${result}`);
			}
			governor.noteTurnEnd({ turnIndex: turn });
		}

		expect(governor.snapshot()).toMatchObject({
			turns: 80,
			tools: 480,
			noProgressTurns: 0,
		});
		expect(governor.snapshot().synthesisCause).toBeUndefined();
	});

	test("repeated child failures converge by normalized category instead of exact text", () => {
		const governor = new WorkContinuityGovernor({ repeatedFailureLimit: 3, softTools: 100 });
		input(governor, "Use Agents to review the implementation and return one report.");
		for (const text of [
			"Agent abc failed: protocol_invalid_event at message 42",
			"Agent def failed: malformed event at message 99",
			"Agent ghi failed: protocol message.role invalid",
		]) {
			governor.noteToolCall({ toolName: "subagent" });
			toolResult(governor, "subagent", text, true);
		}
		expect(governor.snapshot().synthesisCause).toBe("repeated-failure");
	});

	test("counts only Subagent launches as delegations", () => {
		const governor = new WorkContinuityGovernor({ softDelegations: 2, hardDelegations: 3 });
		input(governor, "Launch one review, inspect its status, and return the result.");

		for (const action of ["status", "steer", "stop", "resume"] as const) {
			expect(governor.noteToolCall({ toolName: "subagent", input: { action } })).toBeUndefined();
		}
		expect(governor.snapshot().delegations).toBe(0);
		expect(governor.snapshot().synthesisCause).toBeUndefined();

		expect(
			governor.noteToolCall({ toolName: "subagent", input: { agent: "reviewer", task: "Review the diff." } }),
		).toBeUndefined();
		expect(governor.snapshot().delegations).toBe(1);
		expect(governor.snapshot().synthesisCause).toBeUndefined();
	});

	test("uses a bounded hard stop when the model ignores synthesis and keeps calling Tools", () => {
		const governor = new WorkContinuityGovernor({ softTools: 1, hardTools: 2, softTurns: 20, hardTurns: 30 });
		input(governor, "Review and report.");
		expect(governor.noteToolCall({ toolName: "read" })).toBeUndefined();
		governor.project(context());
		const first = governor.noteToolCall({ toolName: "read" });
		const second = governor.noteToolCall({ toolName: "read" });
		expect(first?.block).toBe(true);
		expect(first?.terminate).toBe(false);
		expect(second?.block).toBe(true);
		expect(second?.terminate).toBe(true);
	});

	test("allows Goal completion tools after synthesis is required", () => {
		const governor = new WorkContinuityGovernor({ softTools: 1, hardTools: 2 });
		input(governor, "Complete the goal and report verified evidence.");
		governor.noteToolCall({ toolName: "read" });
		governor.project(context());

		expect(governor.noteToolCall({ toolName: "goal_complete" })).toBeUndefined();
		expect(governor.noteToolCall({ toolName: "goal_blocked" })).toBeUndefined();
		expect(governor.snapshot().blockedToolAttempts).toBe(0);
	});

	test("reports the aggregate dimension that reached each hard boundary", () => {
		const delegationGovernor = new WorkContinuityGovernor({
			softDelegations: 1,
			hardDelegations: 1,
			softTools: 20,
			hardTools: 30,
		});
		input(delegationGovernor, "Delegate one review and return the result.");
		expect(delegationGovernor.noteToolCall({ toolName: "subagent" })).toBeUndefined();
		delegationGovernor.project(context());
		expect(delegationGovernor.noteToolCall({ toolName: "subagent" })?.reason).toContain(
			"Boundary cause: delegations",
		);

		const compactionGovernor = new WorkContinuityGovernor({
			softCompactions: 1,
			hardCompactions: 1,
			softTools: 20,
			hardTools: 30,
		});
		input(compactionGovernor, "Review the compacted evidence and return the result.");
		compactionGovernor.noteCompaction();
		compactionGovernor.project(context());
		expect(compactionGovernor.noteToolCall({ toolName: "read" })?.reason).toContain("Boundary cause: compactions");
	});

	test("clears the work boundary only after the complete Agent run settles", () => {
		const governor = new WorkContinuityGovernor();
		input(governor, "Review and report.");
		governor.noteTurnEnd({ turnIndex: 0 });
		expect(governor.snapshot().active).toBe(true);
		governor.settleIfQuiet(true, true);
		expect(governor.snapshot().active).toBe(true);
		governor.settleIfQuiet(false, false);
		expect(governor.snapshot().active).toBe(true);
		governor.settleIfQuiet(true, false);
		expect(governor.snapshot().active).toBe(false);
		expect(governor.project(context())).toBeUndefined();
	});
});
