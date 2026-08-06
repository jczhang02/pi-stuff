import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	activityKey,
	registerSuiteOwnedTool,
	type SuiteToolPresentation,
	type ToolActivityCategory,
} from "@jczhang02/pi-stuff-tools";
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

interface TaskIdPresentationParams extends Record<string, unknown> {
	readonly taskId?: unknown;
}

const SHARED_GUIDELINES = [
	"Use the Task tools for multi-step work that benefits from visible progress; skip them for a single trivial action.",
	"Set a task to in_progress before working on it and completed only after its result has been verified.",
	"Use TaskUpdate to add dependencies. A pending task with unresolved blockers should not be started.",
];

function resultText(result: AgentToolResult<TaskDetails>): string {
	const content = result.content.find((item) => item.type === "text");
	return content?.type === "text" ? content.text : "Task operation failed";
}

function taskIdTarget(params: Readonly<TaskIdPresentationParams>): string {
	const taskId = params.taskId;
	return typeof taskId === "string" && taskId ? `#${taskId}` : "";
}

function taskPresentation<TParams extends Record<string, unknown>>(
	label: string,
	category: Extract<ToolActivityCategory, "check-task" | "update-task">,
	target: (params: Readonly<TParams>) => string,
	summarize: (result: AgentToolResult<TaskDetails>) => string = resultText,
): SuiteToolPresentation<TParams, TaskDetails> {
	return {
		activity: {
			categories: [category],
			classify: ({ args, result }) => {
				const value = target(args);
				const returnedIds = result?.details?.affectedTaskIds?.map((taskId) => activityKey(taskId));
				return [
					{
						category,
						countKeys: returnedIds && returnedIds.length > 0 ? returnedIds : [activityKey(value || label)],
						...(value ? { target: value } : {}),
					},
				];
			},
		},
		label,
		resultIsError: (_params, result) => Boolean(result.details?.error),
		runningSummary: "updating",
		summarize: (_params, result) => result.details?.error ?? summarize(result),
		target,
	};
}

/** Keep TaskList useful in /tools without retaining a clipped model-facing row. */
export function summarizeTaskList(result: AgentToolResult<TaskDetails>): string {
	const tasks = (result.details?.tasks ?? []).filter((task) => task.status !== "deleted");
	const done = tasks.filter((task) => task.status === "completed").length;
	return `${String(tasks.length)} tasks (${String(done)} done, ${String(tasks.length - done)} open)`;
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

	const createTool: ToolDefinition<typeof TaskCreateParamsSchema, TaskDetails> = {
		name: TASK_CREATE_TOOL_NAME,
		label: TASK_CREATE_TOOL_NAME,
		description: "Create one task with a short subject and enough detail to know when it is done.",
		promptSnippet: "Create a task in the current session task list",
		promptGuidelines: SHARED_GUIDELINES,
		parameters: TaskCreateParamsSchema,
		executionMode: "parallel",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return execute("create", params, ctx);
		},
	};
	registerSuiteOwnedTool(
		pi,
		createTool,
		taskPresentation("Task create", "update-task", (params) => params.subject),
	);

	const getTool: ToolDefinition<typeof TaskGetParamsSchema, TaskDetails> = {
		name: TASK_GET_TOOL_NAME,
		label: TASK_GET_TOOL_NAME,
		description: "Return the full current record for one task, or not found when the ID is absent.",
		promptSnippet: "Retrieve one task by ID",
		parameters: TaskGetParamsSchema,
		executionMode: "parallel",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return execute("get", params, ctx);
		},
	};
	registerSuiteOwnedTool(pi, getTool, taskPresentation("Task get", "check-task", taskIdTarget));

	const listTool: ToolDefinition<typeof TaskListParamsSchema, TaskDetails> = {
		name: TASK_LIST_TOOL_NAME,
		label: TASK_LIST_TOOL_NAME,
		description: "Return the authoritative list of current, non-deleted tasks and unresolved blockers.",
		promptSnippet: "List all current tasks",
		parameters: TaskListParamsSchema,
		executionMode: "parallel",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return execute("list", {}, ctx);
		},
	};
	registerSuiteOwnedTool(
		pi,
		listTool,
		taskPresentation("Task list", "check-task", () => "", summarizeTaskList),
	);

	const updateTool: ToolDefinition<typeof TaskUpdateParamsSchema, TaskDetails> = {
		name: TASK_UPDATE_TOOL_NAME,
		label: TASK_UPDATE_TOOL_NAME,
		description:
			"Incrementally update one task's fields, status, owner, or dependencies. Set status to deleted to remove it.",
		promptSnippet: "Update a task or its dependencies",
		parameters: TaskUpdateParamsSchema,
		executionMode: "parallel",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return execute("update", params, ctx);
		},
	};
	registerSuiteOwnedTool(pi, updateTool, taskPresentation("Task update", "update-task", taskIdTarget));
}
