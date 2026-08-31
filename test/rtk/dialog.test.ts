import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import * as Effect from "effect/Effect";
import type { CommandDialogViewContext } from "../../packages/pi-stuff/src/conversation-ui/index.js";
import { RtkProjectionAdapter } from "../../packages/pi-stuff/src/rtk/projection.js";
import { compactRtkBinaryPath, createRtkDialogView } from "../../packages/pi-stuff/src/rtk/rtk-dialog.js";
import { createRtkSettingsView } from "../../packages/pi-stuff/src/rtk/rtk-settings-dialog.js";
import { RtkRuntime } from "../../packages/pi-stuff/src/rtk/runtime.js";
import { RtkSettingsStore } from "../../packages/pi-stuff/src/rtk/settings.js";
import { compactPath } from "../../packages/pi-stuff/src/rtk/upstream/techniques/path-utils.js";
import { TestTui } from "../fixtures/test-tui.js";

// SAFETY: this test fixture implements the exact Host surface exercised by this case.
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as Theme;

describe("RTK dialog path presentation", () => {
	test("keeps a long managed binary path on one meaningful narrow line", () => {
		const path = `${homedir()}/.local/share/mise/installs/cargo-https-github-com-rtk-ai-rtk/ref-8a7dd7e5570d7744d4b6508479a3674fe8c49286/bin/rtk`;
		const rendered = compactRtkBinaryPath(path, 38);
		expect(rendered).toBe("~/.../bin/rtk");
		expect(visibleWidth(rendered)).toBeLessThanOrEqual(38);
	});

	test("preserves an already compact path verbatim", () => {
		expect(compactRtkBinaryPath("/usr/local/bin/rtk", 38)).toBe("/usr/local/bin/rtk");
	});

	test("keeps RTK search and linter paths inside a terminal-cell budget", () => {
		const rendered = compactPath("/workspace/packages/深层/file.ts", 14);
		expect(rendered).toBe(".../深层/file…");
		expect(visibleWidth(rendered)).toBeLessThanOrEqual(14);
		expect(rendered).not.toMatch(/(?:[⋯…][\\/]|[\\/][⋯…])/u);
	});
});

describe("RTK-owned settings", () => {
	test("keeps behavior controls under /rtk and cycles them with native settings keys", async () => {
		initTheme("dark", false);
		let closed = 0;
		const settings = RtkSettingsStore.memory();
		const tui = new TestTui(28);
		const context = {
			close: () => {
				closed += 1;
			},
			keybindings: new KeybindingsManager(TUI_KEYBINDINGS),
			requestRender: () => {},
			signal: new AbortController().signal,
			theme,
			tui,
		} satisfies CommandDialogViewContext<void>;
		const component = createRtkSettingsView(settings, {
			setOutputProjection: (enabled) => Effect.runPromise(settings.setOutputProjection(enabled)),
			setRewriteCommands: (enabled) => Effect.runPromise(settings.setRewriteCommands(enabled)),
		}).create(context);

		const initial = component.render(64).join("\n");
		expect(initial).toContain("RTK settings");
		expect(initial).toContain("Command rewriting");
		expect(initial).toContain("Model projection");
		expect(initial).not.toMatch(/[╭╮╰╯]/u);
		tui.rows = 6;
		const low = component.render(64);
		expect(low).toHaveLength(3);
		expect(low.join("\n")).toContain("RTK settings");
		expect(low.join("\n")).toContain("Command rewriting");
		expect(low.at(-1)).toMatch(/Esc(?: to)? close/);
		tui.rows = 28;
		component.handleInput?.("\r");
		await Promise.resolve();
		expect(settings.get().rewriteCommands).toBe(false);

		component.handleInput?.("\u001b");
		expect(closed).toBe(1);
		component.dispose?.();
	});
});

test("RTK status keeps unchecked and off states readable at low height", () => {
	const colors: Array<{ color: string; text: string }> = [];
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const recordingTheme = {
		bold: (value: string) => value,
		fg: (color: string, text: string) => {
			colors.push({ color, text });
			return text;
		},
	} as Theme;
	let closed = 0;
	const component = createRtkDialogView({
		projection: new RtkProjectionAdapter(),
		runtime: new RtkRuntime(),
		settings: RtkSettingsStore.memory({ outputProjection: false, rewriteCommands: false, schemaVersion: 1 }),
	}).create({
		close: () => {
			closed += 1;
		},
		keybindings: new KeybindingsManager(TUI_KEYBINDINGS),
		requestRender: () => {},
		signal: new AbortController().signal,
		theme: recordingTheme,
		tui: new TestTui(6),
	} satisfies CommandDialogViewContext<void>);
	const lines = component.render(64);
	expect(lines).toHaveLength(3);
	expect(lines.join("\n")).toContain("RTK");
	expect(lines.join("\n")).toContain("unchecked");
	expect(lines.at(-1)).toContain("Esc close");
	expect(colors).toContainEqual({ color: "muted", text: "○ unchecked" });
	expect(colors.filter(({ color, text }) => color === "muted" && text === "○")).toHaveLength(2);
	component.handleInput?.("\r");
	component.handleInput?.("q");
	expect(closed).toBe(0);
	component.handleInput?.("?");
	expect(component.render(64).join("\n")).toContain("RTK / Keys");
	component.handleInput?.("\u001b");
	expect(closed).toBe(0);
	component.handleInput?.("\u001b");
	expect(closed).toBe(1);
	component.dispose?.();
});
