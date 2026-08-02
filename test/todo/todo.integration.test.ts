import { beforeEach, describe, expect, it } from "bun:test";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import piStuffTodo, { TODO_TOGGLE_KEY } from "../../packages/pi-stuff-todo/index.js";
import { isTaskDetails } from "../../packages/pi-stuff-todo/state/replay.js";
import { __resetState } from "../../packages/pi-stuff-todo/state/store.js";
import { registerTaskTools } from "../../packages/pi-stuff-todo/todo.js";
import {
	TASK_CREATE_TOOL_NAME,
	TASK_GET_TOOL_NAME,
	TASK_LIST_TOOL_NAME,
	TASK_UPDATE_TOOL_NAME,
	type TaskDetails,
} from "../../packages/pi-stuff-todo/tool/types.js";

const TOOL_NAMES = [TASK_CREATE_TOOL_NAME, TASK_GET_TOOL_NAME, TASK_LIST_TOOL_NAME, TASK_UPDATE_TOOL_NAME];
type TaskMutationEvent = Parameters<NonNullable<Parameters<typeof registerTaskTools>[1]>>[0];

function createToolHarness(onMutation: (event: TaskMutationEvent) => void) {
	const definitions = new Map<string, ToolDefinition>();
	const api = {
		registerTool(definition: ToolDefinition) {
			definitions.set(definition.name, definition);
		},
	} as unknown as ExtensionAPI;
	registerTaskTools(api, onMutation);

	const context = {
		sessionManager: { getSessionId: () => "integration-session" },
	} as unknown as ExtensionContext;

	function tool(name: string): ToolDefinition {
		const definition = definitions.get(name);
		if (!definition) throw new Error(`Tool ${name} was not registered`);
		return definition;
	}

	async function execute(name: string, params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
		return tool(name).execute(`call-${name}`, params, undefined, undefined, context);
	}

	return { definitions, execute, tool };
}

function details(result: AgentToolResult<unknown>): TaskDetails {
	if (!isTaskDetails(result.details)) throw new Error("Expected a versioned task snapshot");
	return result.details;
}

function text(result: AgentToolResult<unknown>): string {
	const content = result.content.find((item) => item.type === "text");
	if (content?.type !== "text") throw new Error("Expected text tool output");
	return content.text;
}

function renderedLines(tool: ToolDefinition, result: AgentToolResult<unknown>, isError: boolean): string[] {
	const renderer = tool.renderResult;
	if (!renderer) throw new Error(`Tool ${tool.name} has no result renderer`);
	const theme = {
		fg: (_color: string, value: string) => value,
	} as unknown as Theme;
	const context = { isError } as Parameters<typeof renderer>[3];
	return renderer(result, { expanded: false, isPartial: false }, theme, context).render(80);
}

beforeEach(() => {
	__resetState();
});

describe("registered Task tools", () => {
	it("executes the Claude-style task flow through the registration boundary", async () => {
		const mutations: TaskMutationEvent[] = [];
		const harness = createToolHarness((event) => mutations.push(event));
		expect([...harness.definitions.keys()]).toEqual(TOOL_NAMES);

		const first = await harness.execute(TASK_CREATE_TOOL_NAME, {
			subject: "Prepare implementation",
			description: "Define the implementation boundary",
		});
		const second = await harness.execute(TASK_CREATE_TOOL_NAME, {
			subject: "Implement feature",
			description: "Build and verify the feature",
		});
		const firstDetails = details(first);
		const secondDetails = details(second);
		expect(firstDetails.tasks[0]?.id).toBe("1");
		expect(secondDetails.tasks[1]?.id).toBe("2");
		expect(typeof secondDetails.tasks[1]?.id).toBe("string");
		expect(secondDetails.nextId).toBe(3);

		const listed = await harness.execute(TASK_LIST_TOOL_NAME, {});
		expect(text(listed)).toContain("#1 [pending] Prepare implementation");
		expect(text(listed)).toContain("#2 [pending] Implement feature");

		const updated = await harness.execute(TASK_UPDATE_TOOL_NAME, {
			taskId: "1",
			status: "in_progress",
			addBlocks: ["2", "2"],
		});
		const updatedDetails = details(updated);
		expect(updatedDetails.tasks.find((task) => task.id === "1")?.status).toBe("in_progress");
		expect(updatedDetails.tasks.find((task) => task.id === "2")?.blockedBy).toEqual(["1"]);

		const fetched = await harness.execute(TASK_GET_TOOL_NAME, { taskId: "2" });
		expect(text(fetched)).toContain("Task #2: Implement feature");
		expect(text(fetched)).toContain("Blocked by: #1");

		expect(mutations.map(({ action }) => action)).toEqual(["create", "create", "update"]);
		expect(mutations.every(({ sessionId }) => sessionId === "integration-session")).toBe(true);
		expect(renderedLines(harness.tool(TASK_GET_TOOL_NAME), fetched, false)).toEqual([]);

		const failed = await harness.execute(TASK_UPDATE_TOOL_NAME, {
			taskId: "missing",
			status: "completed",
		});
		expect(details(failed).error).toBe("#missing not found");
		expect(renderedLines(harness.tool(TASK_UPDATE_TOOL_NAME), failed, false).join("\n")).toContain(
			"#missing not found",
		);
		const validationFailure = {
			content: [{ type: "text", text: "Invalid TaskUpdate input" }],
			details: undefined,
		} as unknown as AgentToolResult<unknown>;
		expect(renderedLines(harness.tool(TASK_UPDATE_TOOL_NAME), validationFailure, true).join("\n").trim()).toBe(
			"Invalid TaskUpdate input",
		);
		expect(mutations.map(({ action }) => action)).toEqual(["create", "create", "update"]);
	});
});

describe("extension registration", () => {
	it("registers Ctrl+Shift+T as the task-list toggle", () => {
		const shortcuts: Array<{ key: string; description: string }> = [];
		const events: string[] = [];
		const api = {
			registerTool: () => {},
			registerShortcut: (key: unknown, options: { description?: string }) => {
				shortcuts.push({ key: String(key), description: options.description ?? "" });
			},
			on: (event: string) => events.push(event),
		} as unknown as ExtensionAPI;

		piStuffTodo(api);

		expect(shortcuts).toEqual([{ key: TODO_TOGGLE_KEY, description: "Collapse or expand the current task list" }]);
		expect(TODO_TOGGLE_KEY).toBe("ctrl+shift+t");
		expect(events.sort()).toEqual(["session_compact", "session_shutdown", "session_start", "session_tree"]);
	});
});
