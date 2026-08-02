import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	formatCollapsedNextLine,
	formatOverlayOverflowLine,
	formatOverlayTaskLine,
	type OverlayTask,
	selectOpenBlockers,
	selectOverlayLayout,
} from "../../packages/pi-stuff-todo/view/format.js";

const recordingTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `<bold>${text}</bold>`,
	strikethrough: (text: string) => `<strike>${text}</strike>`,
} as unknown as Theme;

function task(overrides: Partial<OverlayTask> = {}): OverlayTask {
	return {
		id: "task-1",
		subject: "quiet task",
		status: "pending",
		...overrides,
	};
}

describe("formatOverlayTaskLine", () => {
	test("uses a quiet checkbox for runnable pending work", () => {
		expect(formatOverlayTaskLine({ task: task(), openBlockers: [] }, recordingTheme)).toBe(
			"<dim>□</dim> <text>quiet task</text>",
		);
	});

	test("uses an accent square and bold subject for in-progress work", () => {
		expect(formatOverlayTaskLine({ task: task({ status: "in_progress" }), openBlockers: [] }, recordingTheme)).toBe(
			"<accent>■</accent> <bold><accent>quiet task</accent></bold>",
		);
	});

	test("dims and strikes completed work", () => {
		expect(formatOverlayTaskLine({ task: task({ status: "completed" }), openBlockers: [] }, recordingTheme)).toBe(
			"<dim>✓</dim> <strike><dim>quiet task</dim></strike>",
		);
	});

	test("dims blocked work and explains every unresolved string id", () => {
		expect(formatOverlayTaskLine({ task: task(), openBlockers: ["dep-2", "missing"] }, recordingTheme)).toBe(
			"<dim>□</dim> <dim>quiet task</dim> <dim>blocked by #dep-2, #missing</dim>",
		);
	});

	test("normalizes embedded whitespace to keep every task on one terminal row", () => {
		const line = formatOverlayTaskLine(
			{ task: task({ subject: "first\nsecond\tthird" }), openBlockers: [] },
			recordingTheme,
		);
		expect(line).toContain("first second third");
		expect(line).not.toContain("\n");
	});
});

describe("selectOverlayLayout", () => {
	test("orders five rows by recency/status/blocking, then stable string id", () => {
		const tasks: OverlayTask[] = [
			task({ id: "10", subject: "recent 10", status: "completed" }),
			task({ id: "4", subject: "old", status: "completed" }),
			task({ id: "5", subject: "blocked", blockedBy: ["1"] }),
			task({ id: "3", subject: "active", status: "in_progress" }),
			task({ id: "1", subject: "runnable" }),
			task({ id: "2", subject: "recent 2", status: "completed" }),
		];
		const layout = selectOverlayLayout(tasks, new Set(["10", "2"]));

		expect(layout.visible.map((row) => row.task.id)).toEqual(["2", "10", "3", "1", "5"]);
		expect(layout.hidden.map((row) => row.task.id)).toEqual(["4"]);
		expect(layout.next?.task.id).toBe("3");
	});

	test("considers completed/deleted dependencies resolved and missing ones open", () => {
		const subject = task({ id: "subject", blockedBy: ["done", "deleted", "open", "missing"] });
		const all = [
			subject,
			task({ id: "done", status: "completed" }),
			task({ id: "deleted", status: "deleted" }),
			task({ id: "open", status: "pending" }),
		];
		const byId = new Map(all.map((item) => [String(item.id), item]));

		expect(selectOpenBlockers(subject, byId)).toEqual(["open", "missing"]);
	});

	test("never exposes more than five task rows", () => {
		const tasks = Array.from({ length: 8 }, (_, index) => task({ id: String(index + 1) }));
		const layout = selectOverlayLayout(tasks, new Set(), 99);
		expect(layout.visible).toHaveLength(5);
		expect(layout.hidden).toHaveLength(3);
		expect(formatOverlayOverflowLine(layout.hidden, recordingTheme)).toBe("<dim>… +3 pending</dim>");
	});
});

describe("formatCollapsedNextLine", () => {
	test("renders one compact Next line", () => {
		expect(formatCollapsedNextLine({ task: task({ subject: "ship it" }), openBlockers: [] }, recordingTheme)).toBe(
			"<dim>Next:</dim> <text>ship it</text>",
		);
	});

	test("has an all-complete fallback during the five-second linger", () => {
		expect(formatCollapsedNextLine(undefined, recordingTheme)).toBe("<dim>Next:</dim> <dim>all tasks complete</dim>");
	});
});
