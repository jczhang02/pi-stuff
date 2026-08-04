import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type KeybindingsManager, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { createMcpStatusView } from "../../packages/pi-stuff-mcp/mcp-dialog.js";
import { McpStatusStore } from "../../packages/pi-stuff-mcp/status-store.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

describe("MCP Command Dialog", () => {
	test("renders live status as a full-width bounded surface", () => {
		const store = new McpStatusStore();
		store.set({
			connectedCount: 1,
			disabledCount: 1,
			servers: [
				{ disabled: false, name: "local-filesystem-with-a-very-long-name", status: "connected", toolCount: 8 },
				{ disabled: true, name: "remote", status: "disabled", toolCount: 0 },
			],
			totalResources: 0,
			totalTools: 8,
			version: 1,
		});
		let closed = 0;
		const component = createMcpStatusView(store).create({
			close: () => {
				closed += 1;
			},
			keybindings: {} as KeybindingsManager,
			requestRender: () => undefined,
			signal: new AbortController().signal,
			theme,
			tui: { terminal: { rows: 20 } } as unknown as TUI,
		});
		const lines = component.render(36);

		expect(lines[0]).toBe("─".repeat(36));
		expect(lines.join("\n")).toContain("MCP · 1/1 connected · 8 tools");
		expect(lines.join("\n")).toContain("local-filesystem");
		expect(lines.every((line) => visibleWidth(line) <= 36)).toBe(true);
		component.handleInput?.("\u001b");
		expect(closed).toBe(1);
		component.dispose?.();
	});
});
