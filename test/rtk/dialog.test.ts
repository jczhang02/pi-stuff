import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { compactRtkBinaryPath } from "../../packages/pi-stuff-rtk/rtk-dialog.js";
import { createRtkSettingsView } from "../../packages/pi-stuff-rtk/rtk-settings-dialog.js";
import { RtkSettingsStore } from "../../packages/pi-stuff-rtk/settings.js";
import type { CommandDialogViewContext } from "../../packages/pi-stuff-ui/index.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

describe("RTK dialog path presentation", () => {
	test("keeps a long managed binary path on one meaningful narrow line", () => {
		const path = `${homedir()}/.local/share/mise/installs/cargo-https-github-com-rtk-ai-rtk/ref-8a7dd7e5570d7744d4b6508479a3674fe8c49286/bin/rtk`;
		const rendered = compactRtkBinaryPath(path, 38);
		expect(rendered).toBe("~/.local/…/bin/rtk");
		expect(visibleWidth(rendered)).toBeLessThanOrEqual(38);
	});

	test("preserves an already compact path verbatim", () => {
		expect(compactRtkBinaryPath("/usr/local/bin/rtk", 38)).toBe("/usr/local/bin/rtk");
	});
});

describe("RTK-owned settings", () => {
	test("keeps behavior controls under /rtk and cycles them with native settings keys", async () => {
		initTheme("dark", false);
		let closed = 0;
		const settings = RtkSettingsStore.memory();
		const context = {
			close: () => {
				closed += 1;
			},
			keybindings: {},
			requestRender: () => {},
			signal: new AbortController().signal,
			theme,
			tui: { terminal: { rows: 28 } },
		} as unknown as CommandDialogViewContext<void>;
		const component = createRtkSettingsView(settings).create(context);

		const initial = component.render(64).join("\n");
		expect(initial).toContain("RTK settings");
		expect(initial).toContain("Command rewriting");
		expect(initial).toContain("Model projection");
		expect(initial).not.toMatch(/[╭╮╰╯]/u);
		component.handleInput?.("\r");
		await Promise.resolve();
		expect(settings.get().rewriteCommands).toBe(false);

		component.handleInput?.("\u001b");
		expect(closed).toBe(1);
		component.dispose?.();
	});
});
