import { expect, test } from "bun:test";
import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { decodeCodeModeOperations } from "../../packages/pi-stuff/src/code-mode/extension.js";
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
	messages: readonly unknown[] = [
		{ role: "assistant", content: [{ type: "toolCall", id: toolCallId, name: tool?.name, arguments: args }] },
		{ role: "toolResult", toolCallId, content: result.content, details: result.details },
	],
): string {
	expect(tool).toBeDefined();
	getToolUiRuntime(api).indexMessages(messages, true);
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

test("successful TaskUpdate calls stay silent but remain inspectable", () => {
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

	expect(noOp).toBe("");
	expect(updated).toBe("");
	expect(getToolUiRuntime(api).listGroups()).toHaveLength(2);
});

test("successful TaskList calls stay silent but remain inspectable", () => {
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

	expect(empty).toBe("");
	expect(getToolUiRuntime(api).listGroups()).toHaveLength(1);
});

test("failed Task calls remain visible", () => {
	const { api, tools } = registeredTools();
	const failure = renderedSummary(
		api,
		tools.get("TaskUpdate"),
		{ status: "completed", taskId: "missing" },
		{
			content: [{ text: "Task #missing not found", type: "text" }],
			details: { error: "Task #missing not found" },
		},
		"call-failed",
	);

	expect(failure).toContain("Task #missing not found");
});

test("Code Mode-nested Task calls use the same success and failure visibility", () => {
	const successful = registeredTools();
	const successRuntime = getToolUiRuntime(successful.api);
	successRuntime.registerEnvelope("codemode", decodeCodeModeOperations);
	const successResult = {
		content: [{ text: "Task #1 created successfully", type: "text" as const }],
		details: {},
	};
	const success = renderedSummary(
		successful.api,
		successful.tools.get("TaskCreate"),
		{ description: "Nested", subject: "Nested" },
		successResult,
		"nested-success",
		[
			{ role: "assistant", content: [{ type: "toolCall", id: "outer-success", name: "codemode", arguments: {} }] },
			{
				role: "toolResult",
				toolCallId: "outer-success",
				details: {
					kind: "pi-stuff-code-mode",
					operations: [
						{
							args: { description: "Nested", subject: "Nested" },
							id: "nested-success",
							name: "TaskCreate",
							result: successResult,
							state: "success",
						},
					],
					status: "success",
				},
			},
		],
	);
	expect(success).toBe("");

	const failed = registeredTools();
	const failedRuntime = getToolUiRuntime(failed.api);
	failedRuntime.registerEnvelope("codemode", decodeCodeModeOperations);
	const failedResult = {
		content: [{ text: "Task creation failed", type: "text" as const }],
		details: { error: "Task creation failed" },
	};
	const failure = renderedSummary(
		failed.api,
		failed.tools.get("TaskCreate"),
		{ description: "Nested", subject: "Nested" },
		failedResult,
		"nested-failure",
		[
			{ role: "assistant", content: [{ type: "toolCall", id: "outer-failure", name: "codemode", arguments: {} }] },
			{
				role: "toolResult",
				toolCallId: "outer-failure",
				details: {
					kind: "pi-stuff-code-mode",
					operations: [
						{
							args: { description: "Nested", subject: "Nested" },
							id: "nested-failure",
							name: "TaskCreate",
							result: failedResult,
							state: "error",
						},
					],
					status: "error",
				},
			},
		],
	);
	expect(failure).toContain("Task creation failed");
});
