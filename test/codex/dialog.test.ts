import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import { createCodexDialogView, formatCodexToolLines } from "../../packages/pi-stuff-codex/dialog.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

test("packs complete Codex Tool labels at wide and narrow widths", () => {
	expect(formatCodexToolLines(80)).toEqual(["apply_patch · view_image · imagegen · gpt-image-2"]);
	expect(formatCodexToolLines(46)).toEqual(["apply_patch · view_image", "imagegen · gpt-image-2"]);
	expect(formatCodexToolLines(12)).toEqual(["apply_patch", "view_image", "imagegen"]);
	for (const width of [12, 22, 46, 80]) {
		for (const line of formatCodexToolLines(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
});

test("keeps Codex error, selection, and Escape reachable at very low height", async () => {
	const context = {
		close: () => {},
		keybindings: {},
		requestRender: () => {},
		signal: new AbortController().signal,
		theme,
		tui: { terminal: { rows: 6 } },
	} as unknown as CommandDialogViewContext<void>;
	const component = createCodexDialogView({
		getFast: () => false,
		getUsage: () => undefined,
		refreshUsage: async () => {
			throw new Error("usage service unavailable");
		},
		setFast: async () => {},
	}).create(context);
	await Bun.sleep(0);
	const lines = component.render(64);
	expect(lines).toHaveLength(3);
	expect(lines.join("\n")).toContain("Codex");
	expect(lines.join("\n")).toContain("usage service unavailable");
	expect(lines.at(-1)).toContain("Esc close");
	component.dispose?.();
});

test("keeps Codex usage state and Tool identities above the tertiary dim token", () => {
	const colors: Array<{ color: string; text: string }> = [];
	const recordingTheme = {
		...theme,
		fg: (color: string, text: string) => {
			colors.push({ color, text });
			return text;
		},
	} as unknown as Theme;
	const component = createCodexDialogView({
		getFast: () => false,
		getUsage: () => undefined,
		refreshUsage: async () => {
			throw new Error("usage unavailable");
		},
		setFast: async () => {},
	}).create({
		close: () => {},
		keybindings: {},
		requestRender: () => {},
		signal: new AbortController().signal,
		theme: recordingTheme,
		tui: { terminal: { rows: 24 } },
	} as unknown as CommandDialogViewContext<void>);
	component.render(64);
	expect(colors).toContainEqual({ color: "muted", text: "Loading usage…" });
	expect(colors.some(({ color, text }) => color === "muted" && text.includes("apply_patch"))).toBe(true);
	expect(colors.some(({ color, text }) => color === "dim" && text.includes("apply_patch"))).toBe(false);
	component.dispose?.();
});
