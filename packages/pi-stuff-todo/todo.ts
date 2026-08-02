import type { AgentToolResult, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { applyTaskMutation, type Op } from "./state/state-reducer.js";
import { commitState, getState, sid } from "./state/store.js";
import { buildToolResult } from "./tool/response-envelope.js";
import {
	TASK_CREATE_TOOL_NAME,
	TASK_GET_TOOL_NAME,
	TASK_LIST_TOOL_NAME,
	TASK_UPDATE_TOOL_NAME,
	type TaskAction,
	TaskCreateParamsSchema,
	type TaskDetails,
	TaskGetParamsSchema,
	TaskListParamsSchema,
	type TaskMutationParams,
	TaskUpdateParamsSchema,
} from "./tool/types.js";

interface TaskMutationEvent {
	readonly action: "create" | "update";
	readonly sessionId: string;
	readonly op: Extract<Op, { kind: "create" | "update" }>;
}

type TaskMutationListener = (event: TaskMutationEvent) => void;

const SHARED_GUIDELINES = [
	"Use the Task tools for multi-step work that benefits from visible progress; skip them for a single trivial action.",
	"Set a task to in_progress before working on it and completed only after its result has been verified.",
	"Use TaskUpdate to add dependencies. A pending task with unresolved blockers should not be started.",
];

function hiddenComponent(): Text {
	return new Text("", 0, 0);
}

function resultText(result: AgentToolResult<TaskDetails>): string {
	const content = result.content.find((item) => item.type === "text");
	return content?.type === "text" ? content.text : "Task operation failed";
}

function renderTaskResult(
	result: AgentToolResult<TaskDetails>,
	theme: Theme,
	context: { readonly isError: boolean },
): Text {
	const details = result.details as TaskDetails | undefined;
	if (!context.isError && !details?.error) return hiddenComponent();
	return new Text(theme.fg("error", details?.error ?? resultText(result)), 0, 0);
}

export function registerTaskTools(pi: ExtensionAPI, onMutation?: TaskMutationListener): void {
	function execute(action: TaskAction, params: TaskMutationParams, ctx: Parameters<typeof sid>[0]) {
		const sessionId = sid(ctx);
		const previous = getState(sessionId);
		const result = applyTaskMutation(previous, action, params);
		commitState(sessionId, result.state);

		if (onMutation && result.op.kind !== "error" && (result.op.kind === "create" || result.op.kind === "update")) {
			try {
				onMutation({ action: result.op.kind, sessionId, op: result.op });
			} catch (error) {
				console.warn(`[pi-stuff-todo] widget refresh failed: ${String(error)}`);
			}
		}

		return buildToolResult(action, params, result.state, result.op);
	}

	pi.registerTool<typeof TaskCreateParamsSchema, TaskDetails>({
		name: TASK_CREATE_TOOL_NAME,
		label: TASK_CREATE_TOOL_NAME,
		description: "Create one task with a short subject and enough detail to know when it is done.",
		promptSnippet: "Create a task in the current session task list",
		promptGuidelines: SHARED_GUIDELINES,
		parameters: TaskCreateParamsSchema,
		renderShell: "self",
		executionMode: "parallel",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return execute("create", params, ctx);
		},
		renderCall: hiddenComponent,
		renderResult(result, _options, theme, context) {
			return renderTaskResult(result, theme, context);
		},
	});

	pi.registerTool<typeof TaskGetParamsSchema, TaskDetails>({
		name: TASK_GET_TOOL_NAME,
		label: TASK_GET_TOOL_NAME,
		description: "Return the full current record for one task, or not found when the ID is absent.",
		promptSnippet: "Retrieve one task by ID",
		parameters: TaskGetParamsSchema,
		renderShell: "self",
		executionMode: "parallel",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return execute("get", params, ctx);
		},
		renderCall: hiddenComponent,
		renderResult(result, _options, theme, context) {
			return renderTaskResult(result, theme, context);
		},
	});

	pi.registerTool<typeof TaskListParamsSchema, TaskDetails>({
		name: TASK_LIST_TOOL_NAME,
		label: TASK_LIST_TOOL_NAME,
		description: "Return the authoritative list of current, non-deleted tasks and unresolved blockers.",
		promptSnippet: "List all current tasks",
		parameters: TaskListParamsSchema,
		renderShell: "self",
		executionMode: "parallel",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return execute("list", {}, ctx);
		},
		renderCall: hiddenComponent,
		renderResult(result, _options, theme, context) {
			return renderTaskResult(result, theme, context);
		},
	});

	pi.registerTool<typeof TaskUpdateParamsSchema, TaskDetails>({
		name: TASK_UPDATE_TOOL_NAME,
		label: TASK_UPDATE_TOOL_NAME,
		description:
			"Incrementally update one task's fields, status, owner, or dependencies. Set status to deleted to remove it.",
		promptSnippet: "Update a task or its dependencies",
		parameters: TaskUpdateParamsSchema,
		renderShell: "self",
		executionMode: "parallel",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return execute("update", params, ctx);
		},
		renderCall: hiddenComponent,
		renderResult(result, _options, theme, context) {
			return renderTaskResult(result, theme, context);
		},
	});
}
