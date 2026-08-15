import { expect, test } from "bun:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { createCodeModeDialogView } from "../../packages/pi-stuff/src/code-mode/dialog.js";
import type { CommandDialogViewContext } from "../../packages/pi-stuff/src/conversation-ui/index.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

initTheme("dark", false);

test("shows Code Mode state and persists toggles inside the shared Command Dialog", async () => {
	let enabled = false;
	let closed = false;
	const component = createCodeModeDialogView({
		getSnapshot: () => ({
			enabled,
			executionCount: 2,
			pendingCount: 1,
			snippetCount: 3,
			toolCount: 22,
		}),
		setEnabled: (value) => {
			enabled = value;
		},
	}).create({
		close: () => {
			closed = true;
		},
		keybindings: {},
		requestRender: () => {},
		signal: new AbortController().signal,
		theme,
		tui: { terminal: { rows: 24 } },
	} as unknown as CommandDialogViewContext<void>);

	const initial = component.render(64).join("\n");
	expect(initial).toContain("Code Mode");
	expect(initial).toContain("off");
	expect(initial).toContain("codemode · tool_search");
	expect(initial).toContain("22 Package Tools");
	expect(initial).toContain("2 executions · 1 pending · 3 snippets");

	component.handleInput?.("\r");
	await Promise.resolve();
	expect(enabled).toBe(true);
	expect(component.render(64).join("\n")).toContain("on");
	component.handleInput?.("\u001b");
	expect(closed).toBe(true);
});

test("keeps the prior Code Mode state visible when project persistence fails", async () => {
	const component = createCodeModeDialogView({
		getSnapshot: () => ({
			enabled: false,
			executionCount: 0,
			pendingCount: 0,
			snippetCount: 0,
			toolCount: 22,
		}),
		setEnabled: async () => {
			throw new Error("disk full");
		},
	}).create({
		close: () => {},
		keybindings: {},
		requestRender: () => {},
		signal: new AbortController().signal,
		theme,
		tui: { terminal: { rows: 24 } },
	} as unknown as CommandDialogViewContext<void>);

	component.handleInput?.("\r");
	await Promise.resolve();
	await Promise.resolve();
	const rendered = component.render(64).join("\n");
	expect(rendered).toContain("off");
	expect(rendered).toContain("Unable to save this project's Code Mode setting");
});

test("keeps the Code Mode selection and Escape reachable at low terminal height", () => {
	const component = createCodeModeDialogView({
		getSnapshot: () => ({
			enabled: true,
			executionCount: 0,
			pendingCount: 0,
			snippetCount: 0,
			toolCount: 22,
		}),
		setEnabled: () => {},
	}).create({
		close: () => {},
		keybindings: {},
		requestRender: () => {},
		signal: new AbortController().signal,
		theme,
		tui: { terminal: { rows: 6 } },
	} as unknown as CommandDialogViewContext<void>);
	const lines = component.render(42);
	expect(lines).toHaveLength(3);
	expect(lines.join("\n")).toContain("Code Mode");
	expect(lines.join("\n")).toContain("on");
	expect(lines.at(-1)).toContain("Esc close");
});
