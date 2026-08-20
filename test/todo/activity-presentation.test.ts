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
	messages?: readonly unknown[],
	expanded = false,
): string {
	expect(tool).toBeDefined();
	getToolUiRuntime(api).indexMessages(
		messages ?? [
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
		expanded,
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
	tool?.renderResult?.(result, { expanded, isPartial: false }, theme, {
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
	const runtime = getToolUiRuntime(api);
	expect(runtime.listGroups()).toHaveLength(1);
	expect(runtime.toolActivityDetail("call-empty-list", "formatted")).toBeDefined();
	expect(
		renderedSummary(
			api,
			tools.get("TaskList"),
			{},
			{ content: [{ text: "No tasks found", type: "text" }], details: { tasks: [] } },
			"call-empty-list",
			undefined,
			true,
		),
	).toContain("Task list");
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

test("rejected and cancelled Task calls remain visible", () => {
	for (const [id, message] of [
		["rejected", "Tool execution was blocked by policy"],
		["cancelled", "Operation was cancelled"],
	] as const) {
		const { api, tools } = registeredTools();
		const output = renderedSummary(
			api,
			tools.get("TaskUpdate"),
			{ status: "completed", taskId: id },
			{ content: [{ text: message, type: "text" }], details: { error: message } },
			`call-${id}`,
		);
		expect(output).toContain(message);
		expect(getToolUiRuntime(api).toolActivityDetail(`call-${id}`, "formatted")?.activity.state).toBe(id);
	}
});

test("Code Mode-nested Task calls use the same success and issue visibility", () => {
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

	for (const [state, message] of [
		["error", "Task creation failed"],
		["rejected", "Tool execution was blocked by policy"],
		["cancelled", "Operation was cancelled"],
	] as const) {
		const failed = registeredTools();
		getToolUiRuntime(failed.api).registerEnvelope("codemode", decodeCodeModeOperations);
		const failedResult = {
			content: [{ text: message, type: "text" as const }],
			details: { error: message },
		};
		const failure = renderedSummary(
			failed.api,
			failed.tools.get("TaskCreate"),
			{ description: "Nested", subject: "Nested" },
			failedResult,
			`nested-${state}`,
			[
				{
					role: "assistant",
					content: [{ type: "toolCall", id: `outer-${state}`, name: "codemode", arguments: {} }],
				},
				{
					role: "toolResult",
					toolCallId: `outer-${state}`,
					details: {
						kind: "pi-stuff-code-mode",
						operations: [
							{
								args: { description: "Nested", subject: "Nested" },
								id: `nested-${state}`,
								name: "TaskCreate",
								result: failedResult,
								state,
							},
						],
						status: state === "cancelled" ? "cancelled" : "error",
					},
				},
			],
		);
		expect(failure).toContain(message);
		expect(getToolUiRuntime(failed.api).toolActivityDetail(`nested-${state}`, "formatted")?.activity.state).toBe(
			state,
		);
	}
});
