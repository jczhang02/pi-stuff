import { expect, test } from "bun:test";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerWorkTools } from "../../packages/pi-stuff-work/src/tools.js";

function registeredBash(): ToolDefinition {
	const tools = new Map<string, ToolDefinition>();
	const api = {
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => ["bash"],
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		on: () => {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		setActiveTools: () => {},
	} as unknown as ExtensionAPI;
	registerWorkTools(api, { current: () => undefined });
	const bash = tools.get("bash");
	expect(bash).toBeDefined();
	return bash as ToolDefinition;
}

test("Bash classifies an automatic foreground-to-background handoff as a launch", () => {
	const bash = registeredBash();
	const args = { command: "sleep 300", description: "Wait for service" };
	const theme = {
		bold: (value: string) => value,
		fg: (_color: string, value: string) => value,
	} as unknown as Theme;
	const state = {};
	const context = {
		args,
		argsComplete: true,
		cwd: "/project",
		executionStarted: true,
		expanded: false,
		invalidate: () => {},
		isError: false,
		isPartial: false,
		lastComponent: undefined,
		showImages: true,
		state,
		toolCallId: "bash-auto-background",
	};
	const row = bash.renderCall?.(args, theme, context as never);
	expect(row).toBeDefined();
	bash.renderResult?.(
		{
			content: [
				{
					text: "Command still running after 120s; moved to background task abc123. Continue useful work.",
					type: "text",
				},
			],
			details: {},
		},
		{ expanded: false, isPartial: false },
		theme,
		{ ...context, lastComponent: row } as never,
	);

	expect(row?.render(100).join("\n")).toContain("Launched 1 background task");
});
