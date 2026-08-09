import type { AgentToolResult, BashToolDetails, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	activityKey,
	classifyBashActivity,
	registerSuiteOwnedTool,
	type SuiteToolPresentation,
	singleActivity,
} from "@jczhang02/pi-stuff-tools";
import { Type } from "typebox";
import { startMonitor } from "./monitor.js";
import { DEFAULT_MODEL_OUTPUT_LIMIT } from "./output.js";
import type { BackgroundWorkOutcome, BackgroundWorkRuntime } from "./runtime.js";

const BASH_PARAMETERS = Type.Object({
	command: Type.String({ description: "Shell command to execute", maxLength: 1_000_000, minLength: 1 }),
	description: Type.Optional(
		Type.String({ description: "Short task-oriented label shown in /tasks", maxLength: 160, minLength: 1 }),
	),
	run_in_background: Type.Optional(
		Type.Boolean({
			description: "Start detached from the foreground tool call and continue useful work immediately",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Maximum command runtime in seconds; omit for no runtime limit",
			maximum: 86_400,
			minimum: 0.1,
		}),
	),
});

const BACKGROUND_PARAMETERS = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("output"), Type.Literal("stop")]),
	max_bytes: Type.Optional(
		Type.Integer({ description: "Maximum recent output bytes", maximum: 51_200, minimum: 1_024 }),
	),
	task_id: Type.Optional(Type.String({ maxLength: 64, minLength: 1 })),
});

const MONITOR_PARAMETERS = Type.Object({
	description: Type.Optional(Type.String({ maxLength: 160, minLength: 1 })),
	failure_text: Type.Optional(
		Type.String({ description: "Exact substring that ends the Monitor as failed", maxLength: 4_096, minLength: 1 }),
	),
	interval_seconds: Type.Optional(
		Type.Number({ description: "Polling interval for file, log, and HTTP sources", maximum: 60, minimum: 0.1 }),
	),
	source: Type.Union([Type.Literal("command"), Type.Literal("file"), Type.Literal("http"), Type.Literal("log")]),
	start_at_end: Type.Optional(
		Type.Boolean({ description: "For log sources, ignore content that already exists when the Monitor starts" }),
	),
	success_text: Type.Optional(
		Type.String({ description: "Exact substring that satisfies the Monitor", maxLength: 4_096, minLength: 1 }),
	),
	target: Type.String({
		description: "Command, file path, log path, or HTTP(S) URL",
		maxLength: 1_000_000,
		minLength: 1,
	}),
	timeout_seconds: Type.Optional(
		Type.Number({
			description: "Deadline for observing the condition; defaults to 600 seconds",
			maximum: 86_400,
			minimum: 0.1,
		}),
	),
});

interface WorkToolDetails {
	readonly action?: string;
	readonly error?: string;
	readonly outputPath?: string;
	readonly status?: string;
	readonly taskId?: string;
}

export interface WorkToolRuntimeRef {
	current(): BackgroundWorkRuntime | undefined;
}

function textResult<T>(text: string, details: T, isError = false): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) };
}

function firstLine(value: unknown): string {
	return typeof value === "string" ? (value.trim().split(/\r?\n/u)[0]?.trim().slice(0, 180) ?? "") : "";
}

function resultText<T>(result: AgentToolResult<T>): string {
	const item = result.content.find((content) => content.type === "text");
	return item?.type === "text" ? item.text : "";
}

export function isForegroundBashResult(result: AgentToolResult<BashToolDetails | undefined>): boolean {
	return !/\b(?:started|moved|manually moved) to background task\b/u.test(resultText(result));
}

function requireRuntime(ref: WorkToolRuntimeRef): BackgroundWorkRuntime {
	const runtime = ref.current();
	if (!runtime) throw new Error("Background Work is not available before session startup or during shutdown");
	return runtime;
}

function requireTaskId(value: string | undefined, action: string): string {
	const id = value?.trim();
	if (!id) throw new Error(`background ${action} requires task_id`);
	return id;
}

function outcomeText(outcome: BackgroundWorkOutcome): string {
	const output = outcome.recentOutput?.trim();
	return output ? `${outcome.summary}\n\n${output}` : outcome.summary;
}

function listText(runtime: BackgroundWorkRuntime): string {
	const snapshots = runtime.snapshot();
	if (snapshots.length === 0) return "No Background Shell or Monitor activity is running in this session.";
	return snapshots.map((task) => `${task.id}  ${task.kind}  ${task.status}  ${task.title}`).join("\n");
}

const backgroundPresentation: SuiteToolPresentation<Record<string, unknown>, WorkToolDetails> = {
	activity: {
		categories: ["inspect-background", "read-background", "stop-background"],
		classify: ({ args }) => {
			const action = String(args["action"] ?? "list");
			const taskId = typeof args["task_id"] === "string" ? args["task_id"] : action;
			if (action === "output")
				return singleActivity("read-background", { key: activityKey(taskId), target: taskId });
			if (action === "stop") return singleActivity("stop-background", { key: activityKey(taskId), target: taskId });
			return singleActivity("inspect-background", { count: 1, target: "background tasks" });
		},
		summarizeIssue: (_args, result, state) => result.details.error ?? (firstLine(resultText(result)) || state),
	},
	label: "Background",
	resultIsError: (_args, result) => Boolean(result.details.error),
	runningSummary: "checking",
	summarize: (_args, result) =>
		result.details.error ?? result.details.status ?? (firstLine(resultText(result)) || "done"),
	target: (args) => (typeof args["task_id"] === "string" ? args["task_id"] : String(args["action"] ?? "")),
};

export function registerWorkTools(
	pi: ExtensionAPI,
	runtimeRef: WorkToolRuntimeRef,
	options: { readonly includeBash?: boolean } = {},
): void {
	const includeBash = options.includeBash !== false;
	const bashWasActive = includeBash ? pi.getActiveTools().includes("bash") : false;
	if (includeBash) {
		const bash: ToolDefinition<typeof BASH_PARAMETERS, BashToolDetails | undefined> = {
			name: "bash",
			label: "bash",
			description:
				"Execute a shell command in the current working directory. Output is bounded. Set run_in_background for servers or other independent long work; a foreground command still running after two minutes moves to the background automatically. timeout limits total runtime and stops the process tree.",
			promptSnippet: "Execute shell commands; use run_in_background for independent long-running work",
			promptGuidelines: [
				"Continue useful work after a Bash command moves to the background; its terminal result is delivered automatically instead of requiring polling.",
				"Inspect PI_* environment variables for current model and session details.",
			],
			parameters: BASH_PARAMETERS,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				return requireRuntime(runtimeRef).executeBash(
					{
						command: params.command,
						...(params.description ? { description: params.description } : {}),
						...(onUpdate ? { onUpdate } : {}),
						...(params.run_in_background !== undefined ? { runInBackground: params.run_in_background } : {}),
						...(signal ? { signal } : {}),
						...(params.timeout !== undefined ? { timeoutSeconds: params.timeout } : {}),
						toolCallId,
					},
					ctx,
				);
			},
		};
		registerSuiteOwnedTool(pi, bash, {
			activity: {
				categories: ["commit", "push", "merge", "rebase", "create-pr", "launch-background", "run-command"],
				classify: (input) => {
					if (input.result && !isForegroundBashResult(input.result)) {
						const text = resultText(input.result);
						const taskId = text.match(/background task ([a-z0-9]+)/u)?.[1];
						return singleActivity("launch-background", {
							key: activityKey(taskId ?? input.args.description ?? input.args.command),
							target: firstLine(input.args.description) || "background command",
						});
					}
					return classifyBashActivity(input);
				},
				summarizeIssue: (_args, result, state) => {
					const line = resultText(result).trim().split(/\r?\n/u).at(-1)?.trim();
					return line || state;
				},
			},
			label: "Bash",
			runningSummary: (_args, durationMs) =>
				`running ${String(Math.max(0, Math.floor((durationMs ?? 0) / 1_000)))}s`,
			summarize: (_args, result, state) => {
				const text = resultText(result);
				const id = text.match(/background task ([a-z0-9]+)/u)?.[1];
				if (id) return `background · ${id}`;
				if (state === "success") return "done";
				const terminal = text.trim().split(/\r?\n/u).at(-1)?.trim();
				return terminal || state;
			},
			target: (args) => firstLine(args.description) || "command",
			tracksElapsed: true,
		});
	}

	const background: ToolDefinition<typeof BACKGROUND_PARAMETERS, WorkToolDetails> = {
		name: "background",
		label: "Background",
		description:
			"Inspect or stop current-session Background Shell and Monitor activities. Completion is delivered automatically; use output only when current evidence is specifically needed.",
		parameters: BACKGROUND_PARAMETERS,
		executionMode: "parallel",
		async execute(_toolCallId, params) {
			try {
				const runtime = requireRuntime(runtimeRef);
				if (params.action === "list") return textResult(listText(runtime), { action: "list", status: "listed" });
				const taskId = requireTaskId(params.task_id, params.action);
				if (params.action === "output") {
					const output = runtime.readOutput(taskId, params.max_bytes ?? DEFAULT_MODEL_OUTPUT_LIMIT);
					return textResult(output, { action: "output", status: "read", taskId });
				}
				const outcome = await runtime.stop(taskId);
				return textResult(outcomeText(outcome), {
					action: "stop",
					...(outcome.outputPath ? { outputPath: outcome.outputPath } : {}),
					status: outcome.status,
					taskId,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Error: ${message}`, { action: params.action, error: message }, true);
			}
		},
	};
	registerSuiteOwnedTool(pi, background, backgroundPresentation);

	const monitor: ToolDefinition<typeof MONITOR_PARAMETERS, WorkToolDetails> = {
		name: "monitor",
		label: "Monitor",
		description:
			"Wait asynchronously for one explicit command, file, new log text, or HTTP condition. The tool returns immediately, wakes the Agent once on success/failure/timeout, and must not be followed by conversational polling.",
		promptSnippet: "Wait asynchronously for one known command, file, log, or HTTP condition",
		promptGuidelines: [
			"Use Monitor only for a concrete observable condition with a deadline; after it starts, continue useful work and do not poll it from the conversation.",
		],
		parameters: MONITOR_PARAMETERS,
		executionMode: "parallel",
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const started = startMonitor(
					requireRuntime(runtimeRef),
					{
						...(params.description ? { description: params.description } : {}),
						...(params.failure_text ? { failureText: params.failure_text } : {}),
						...(params.interval_seconds !== undefined ? { intervalSeconds: params.interval_seconds } : {}),
						source: params.source,
						...(params.start_at_end !== undefined ? { startAtEnd: params.start_at_end } : {}),
						...(params.success_text ? { successText: params.success_text } : {}),
						target: params.target,
						...(params.timeout_seconds !== undefined ? { timeoutSeconds: params.timeout_seconds } : {}),
						toolCallId,
					},
					ctx,
				);
				return textResult(
					`Monitor ${started.id} is waiting for "${started.title}". Its terminal result will be delivered automatically; continue useful work instead of polling.`,
					{
						...(started.outputPath ? { outputPath: started.outputPath } : {}),
						status: "running",
						taskId: started.id,
					},
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Error: ${message}`, { error: message }, true);
			}
		},
	};
	registerSuiteOwnedTool(pi, monitor, {
		activity: {
			categories: ["start-monitor"],
			classify: ({ args, result }) =>
				singleActivity("start-monitor", {
					key: activityKey(result?.details.taskId ?? args.target),
					target: firstLine(args.description) || `${args.source} monitor`,
				}),
			summarizeIssue: (_args, result, state) => result.details.error ?? (firstLine(resultText(result)) || state),
		},
		label: "Monitor",
		resultIsError: (_args, result) => Boolean(result.details.error),
		runningSummary: "starting",
		summarize: (_args, result) => result.details.error ?? `waiting · ${result.details.taskId ?? "—"}`,
		target: (args) => firstLine(args.target),
	});
	if (includeBash && !bashWasActive) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "bash"));
}
