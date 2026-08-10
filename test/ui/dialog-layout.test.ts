import { expect, test } from "bun:test";
import { commandDialogRows, fitCommandDialogRows } from "../../packages/pi-stuff/src/conversation-ui/dialog-layout.js";
import type { CommandDialogViewContext } from "../../packages/pi-stuff/src/conversation-ui/index.js";

function context(rows: number): Pick<CommandDialogViewContext<unknown>, "tui"> {
	return { tui: { terminal: { rows } } } as unknown as Pick<CommandDialogViewContext<unknown>, "tui">;
}

const sections = {
	header: ["divider", "title"],
	body: ["", "selected", "body one", "body two", ""],
	priority: ["selected"],
	footer: ["more actions", "Esc close"],
};

test("Command Dialog row budgets reserve normal Pi chrome", () => {
	expect(commandDialogRows(context(24))).toBe(21);
	expect(commandDialogRows(context(3))).toBe(1);
	expect(commandDialogRows(context(0))).toBe(0);
	expect(commandDialogRows({ tui: { terminal: {} } } as never)).toBe(21);
});

test("low-height fitting preserves escape, current state, and title before optional rows", () => {
	expect(fitCommandDialogRows(sections, 0)).toEqual([]);
	expect(fitCommandDialogRows(sections, 1)).toEqual(["Esc close"]);
	expect(fitCommandDialogRows(sections, 2)).toEqual(["selected", "Esc close"]);
	expect(fitCommandDialogRows(sections, 3)).toEqual(["title", "selected", "Esc close"]);
	expect(fitCommandDialogRows(sections, 4)).toEqual(["title", "selected", "more actions", "Esc close"]);
	expect(fitCommandDialogRows(sections, 5)).toEqual(["divider", "title", "selected", "more actions", "Esc close"]);
});

test("ordinary-height fitting preserves the original layout exactly", () => {
	expect(fitCommandDialogRows(sections, 9)).toEqual([
		"divider",
		"title",
		"",
		"selected",
		"body one",
		"body two",
		"",
		"more actions",
		"Esc close",
	]);
});

test("an overflow-only semantic title can replace decorative chrome without changing the full layout", () => {
	const sections = {
		header: ["divider"],
		overflowTitle: "/btw selected question",
		body: ["/btw selected question", "provider unavailable"],
		footer: ["Esc close"],
		priority: ["/btw selected question", "provider unavailable"],
	};
	expect(fitCommandDialogRows(sections, 8)).toEqual([
		"divider",
		"/btw selected question",
		"provider unavailable",
		"Esc close",
	]);
	expect(fitCommandDialogRows(sections, 3)).toEqual(["/btw selected question", "provider unavailable", "Esc close"]);
});
