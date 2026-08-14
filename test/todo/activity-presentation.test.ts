import { expect, test } from "bun:test";
import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerTaskTools } from "../../packages/pi-stuff/src/todo/todo.js";
import { getToolUiRuntime } from "../../packages/pi-stuff/src/tool-display/contract.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function registeredTools(): { readonly api: ExtensionAPI; readonly tools: Map<string, ToolDefinition> } {
	const tools = new Map<string, ToolDefinition>();
	const api = {
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		on: () => {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
	} as unknown as ExtensionAPI;
	registerTaskTools(api);
	return { api, tools };
}

function renderedSummary(
	api: ExtensionAPI,
	tool: ToolDefinition | undefined,
	args: Record<string, unknown>,
	result: AgentToolResult<unknown>,
	toolCallId: string,
): string {
	expect(tool).toBeDefined();
	getToolUiRuntime(api).indexMessages(
		[
			{ role: "assistant", content: [{ type: "toolCall", id: toolCallId, name: tool?.name, arguments: args }] },
			{ role: "toolResult", toolCallId, content: result.content, details: result.details },
		],
		true,
	);
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
		toolCallId,
	};
	const row = tool?.renderCall?.(args, theme, context as never);
	expect(row).toBeDefined();
	tool?.renderResult?.(result, { expanded: false, isPartial: false }, theme, {
		...context,
		lastComponent: row,
	} as never);
	return row?.render(100).join("\n") ?? "";
}

test("TaskUpdate reports a no-op as a check instead of a mutation", () => {
	const { api, tools } = registeredTools();
	const tool = tools.get("TaskUpdate");
	const args = { status: "completed", taskId: "task-1" };
	const noOp = renderedSummary(
		api,
		tool,
		args,
		{
			content: [{ text: "Task #task-1 already matches the requested values", type: "text" }],
			details: {},
		},
		"call-no-op",
	);
	const updated = renderedSummary(
		api,
		tool,
		args,
		{
			content: [{ text: "Task task-1 updated: status", type: "text" }],
			details: {},
		},
		"call-update",
	);

	expect(noOp).toContain("Checked 1 task");
	expect(updated).toContain("Updated 1 task");
});

test("an empty TaskList reports zero returned tasks", () => {
	const { api, tools } = registeredTools();
	const empty = renderedSummary(
		api,
		tools.get("TaskList"),
		{},
		{
			content: [{ text: "No tasks found", type: "text" }],
			details: { tasks: [] },
		},
		"call-empty-list",
	);

	expect(empty).toContain("Checked 0 tasks");
});
