import { expect, test } from "bun:test";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerWorkTools } from "../../packages/pi-stuff/src/background-work/src/tools.js";
import {
	createSuiteToolRegistrationTracker,
	getToolUiRuntime,
} from "../../packages/pi-stuff/src/tool-display/contract.js";

function registeredBash(): { readonly api: ExtensionAPI; readonly bash: ToolDefinition } {
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
	return { api, bash: bash as ToolDefinition };
}

test("the live Background Work Bash keeps its Code Mode contract", () => {
	const tools = new Map<string, ToolDefinition>();
	const api = {
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => ["bash"],
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		on: () => {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		setActiveTools: () => {},
	} as unknown as ExtensionAPI;
	const registrations = createSuiteToolRegistrationTracker(api);
	registerWorkTools(registrations.api, { current: () => undefined });

	expect(registrations.registry.catalog().find((entry) => entry.definition.name === "bash")).toMatchObject({
		codeMode: { replay: "never" },
	});
});

test("/tools formats a background Bash handoff from structured result details", () => {
	const { api } = registeredBash();
	const runtime = getToolUiRuntime(api);
	const args = {
		command: "bun run check",
		description: "Run the complete checks",
		run_in_background: true,
	};
	runtime.indexMessages(
		[
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "bash-background", name: "bash", arguments: args }],
			},
			{
				role: "toolResult",
				toolCallId: "bash-background",
				content: [{ type: "text", text: "legacy display text that formatted detail must not expose" }],
				details: {
					backgroundTaskId: "bf8t2miir",
					fullOutputPath: "/tmp/bf8t2miir.output",
				},
			},
		],
		true,
	);

	expect(runtime.toolActivityDetail("bash-background", "formatted")?.lines).toEqual([
		"Started in background · bf8t2miir",
		"",
		"Output file",
		"/tmp/bf8t2miir.output",
		"",
		"Result will be delivered automatically.",
	]);
});

test("standalone Bash preserves an automatic foreground-to-background handoff in its child output", () => {
	const { api, bash } = registeredBash();
	const args = { command: "sleep 300", description: "Wait for service" };
	const result = {
		content: [
			{
				text: "Command still running after 120s; moved to background task abc123. Continue useful work.",
				type: "text" as const,
			},
		],
		details: {},
	};
	getToolUiRuntime(api).indexMessages(
		[
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "bash-auto-background", name: "bash", arguments: args }],
			},
			{ role: "toolResult", toolCallId: "bash-auto-background", content: result.content, details: result.details },
		],
		true,
	);
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
	bash.renderResult?.(result, { expanded: false, isPartial: false }, theme, {
		...context,
		lastComponent: row,
	} as never);

	const rendered = row?.render(100).join("\n") ?? "";
	expect(rendered).toContain("• Bash(sleep 300)");
	expect(rendered).toContain("⎿  Command still running after 120s; moved to background task abc123.");
	expect(rendered).not.toContain("Launched 1 background task");
});
