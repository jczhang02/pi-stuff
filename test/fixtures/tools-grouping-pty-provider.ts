import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isRuntimeString } from "../../packages/pi-stuff/src/shared/runtime-type.js";
import { registerSuiteOwnedTool } from "../../packages/pi-stuff/src/tool-display/index.js";

const PROVIDER = "pi-stuff-tools-grouping-pty";
const MODEL = "fixture-model";
const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface FixtureCall {
	readonly arguments: Record<string, unknown>;
	readonly name: string;
}

const SUCCESS_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "find", arguments: { pattern: "*.txt", path: "." } },
	{ name: "ls", arguments: { path: "." } },
	{ name: "bash", arguments: { command: "pwd" } },
	{
		name: "TaskCreate",
		arguments: {
			subject: "Certify Activity Group",
			description: "Exercise a Suite-owned non-builtin Tool inside the same display group.",
		},
	},
];
const FAILURE_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{
		name: "bash",
		arguments: { command: "printf FIXTURE_GROUP_ERROR >&2; exit 17" },
	},
	{ name: "read", arguments: { path: "input-工具.txt" } },
];
const MUTATION_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{
		name: "bash",
		arguments: { command: "printf mutation > bash-mutation-工具.txt" },
	},
	{ name: "read", arguments: { path: "input-工具.txt" } },
];
const BACKGROUND_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "bash", arguments: { command: "sleep 30" } },
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{
		name: "bash",
		arguments: { command: "sleep 31", run_in_background: true },
	},
	{ name: "read", arguments: { path: "input-工具.txt" } },
];
const COMPLETION_CALLS: readonly FixtureCall[] = [
	{
		name: "bash",
		arguments: {
			command: "sleep 0.4; printf FIXTURE_BACKGROUND_COMPLETED",
			description: "completion fixture",
			run_in_background: true,
		},
	},
];
const MEDIA_CALLS: readonly FixtureCall[] = [{ name: "fixture_media", arguments: {} }];
const AGENT_CALLS: readonly FixtureCall[] = [{ name: "subagent", arguments: { action: "status" } }];
const RECOVERY_CALLS: readonly FixtureCall[] = [
	{ name: "fixture_retry", arguments: { value: "same exact retry" } },
	{ name: "fixture_retry", arguments: { value: "same exact retry" } },
];
const BASH_UI_CALLS: readonly FixtureCall[] = [
	{
		name: "bash",
		arguments: {
			command: "printf 'BASH_UI_ONE\\nBASH_UI_TWO\\nBASH_UI_THREE\\nBASH_UI_FOUR\\nBASH_UI_FIVE\\nBASH_UI_SIX\\n'",
		},
	},
	{
		name: "bash",
		arguments: { command: "printf BASH_UI_SECOND && printf '_DONE\\n'" },
	},
];
const PARTIAL_BASH_CALLS: readonly FixtureCall[] = [
	{
		name: "bash",
		arguments: { command: "sleep 2.1; printf PARTIAL_BASH_VISIBLE; sleep 0.6" },
	},
];

function message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: PROVIDER,
		model: MODEL,
		usage: ZERO_USAGE,
		stopReason,
		timestamp: Date.now(),
	};
}

function textStream(text: string) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({
		type: "text_delta",
		contentIndex: 0,
		delta: text,
		partial: pending,
	});
	stream.push({
		type: "text_end",
		contentIndex: 0,
		content: text,
		partial: pending,
	});
	stream.push({
		type: "done",
		reason: "stop",
		message: message([{ type: "text", text }], "stop"),
	});
	return stream;
}

function toolCallsStream(prefix: string, fixtures: readonly FixtureCall[], thinking = "") {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCalls = fixtures.map((fixture, index) => ({
		type: "toolCall" as const,
		id: `${prefix}-${String(index + 1)}`,
		name: fixture.name,
		arguments: fixture.arguments,
	}));
	stream.push({ type: "start", partial: pending });
	const contentOffset = thinking ? 1 : 0;
	if (thinking) {
		pending.content = [{ type: "thinking", thinking }];
		stream.push({
			type: "thinking_start",
			contentIndex: 0,
			partial: pending,
		});
		stream.push({
			type: "thinking_delta",
			contentIndex: 0,
			delta: thinking,
			partial: pending,
		});
		stream.push({
			type: "thinking_end",
			contentIndex: 0,
			content: thinking,
			partial: pending,
		});
	}
	for (const [index, toolCall] of toolCalls.entries()) {
		stream.push({
			type: "toolcall_start",
			contentIndex: index + contentOffset,
			partial: pending,
		});
		stream.push({
			type: "toolcall_end",
			contentIndex: index + contentOffset,
			toolCall,
			partial: pending,
		});
	}
	stream.push({
		type: "done",
		reason: "toolUse",
		message: message(thinking ? [{ type: "thinking", thinking }, ...toolCalls] : toolCalls, "toolUse"),
	});
	return stream;
}

function textContent(message: Context["messages"][number]): string {
	if (message.role !== "user") return "";
	if (isRuntimeString(message.content)) return message.content;
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

function fixtureStream(context: Context) {
	if ((context.tools?.length ?? 0) === 0) return textStream("GROUP_COMPACTION_SUMMARY");
	let lastUserIndex = -1;
	for (let index = context.messages.length - 1; index >= 0; index -= 1) {
		if (context.messages[index]?.role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	const request = lastUserIndex < 0 ? "" : textContent(context.messages[lastUserIndex] as Context["messages"][number]);
	const completed = context.messages.slice(lastUserIndex + 1).reduce((count, entry) => {
		if (entry.role !== "assistant") return count;
		return count + entry.content.filter((block) => block.type === "toolCall").length;
	}, 0);
	if (request.includes("failure")) {
		return completed === 0 ? toolCallsStream("group-failure", FAILURE_CALLS) : textStream("GROUP_FAILURE_DONE");
	}
	if (request.includes("mutation")) {
		return completed === 0 ? toolCallsStream("group-mutation", MUTATION_CALLS) : textStream("GROUP_MUTATION_DONE");
	}
	if (request.includes("permission")) {
		return completed === 0
			? toolCallsStream("group-permission", [{ name: "fixture_confirm", arguments: {} }])
			: textStream("GROUP_PERMISSION_DONE");
	}
	if (request.includes("rejection")) {
		return completed === 0
			? toolCallsStream("group-rejection", [{ name: "fixture_confirm", arguments: { reject: true } }])
			: textStream("GROUP_REJECTION_DONE");
	}
	if (request.includes("cancellation")) {
		return completed === 0
			? toolCallsStream("group-cancellation", [{ name: "fixture_cancel", arguments: {} }])
			: textStream("GROUP_CANCELLATION_DONE");
	}
	if (request.includes("completion")) {
		return completed === 0
			? toolCallsStream("group-completion", COMPLETION_CALLS)
			: textStream("GROUP_COMPLETION_DONE");
	}
	if (request.includes("media")) {
		return completed === 0 ? toolCallsStream("group-media", MEDIA_CALLS) : textStream("GROUP_MEDIA_DONE");
	}
	if (request.includes("agent")) {
		return completed === 0 ? toolCallsStream("group-agent", AGENT_CALLS) : textStream("GROUP_AGENT_DONE");
	}
	if (request.includes("recovery")) {
		return completed === 0 ? toolCallsStream("group-recovery", RECOVERY_CALLS) : textStream("GROUP_RECOVERY_DONE");
	}
	if (request.includes("bashui")) {
		return completed === 0 ? toolCallsStream("group-bash-ui", BASH_UI_CALLS) : textStream("GROUP_BASH_UI_DONE");
	}
	if (request.includes("partial-bash")) {
		return completed === 0
			? toolCallsStream("group-partial-bash", PARTIAL_BASH_CALLS)
			: textStream("GROUP_PARTIAL_BASH_DONE");
	}
	if (request.includes("structured")) {
		return textStream(
			[
				"## Structured result",
				"",
				"STRUCTURED_PARAGRAPH 中文",
				"",
				"- STRUCTURED_ITEM_ONE",
				"- STRUCTURED_ITEM_TWO",
				"",
				"```text",
				"STRUCTURED_CODE_LINE",
				"```",
			].join("\n"),
		);
	}
	if (request.includes("background")) {
		return completed === 0
			? toolCallsStream("group-background", BACKGROUND_CALLS)
			: textStream("GROUP_BACKGROUND_DONE");
	}
	if (request.includes("postcompact")) {
		return completed === 0
			? toolCallsStream("group-postcompact", SUCCESS_CALLS)
			: textStream("GROUP_POST_COMPACT_DONE");
	}
	if (request.includes("padding")) {
		return completed === 0
			? toolCallsStream("group-padding", [{ name: "padding_tool", arguments: {} }])
			: textStream("PADDING_DONE");
	}
	if (request.includes("plain")) return textStream("PLAIN_DONE");
	return completed < SUCCESS_CALLS.length
		? toolCallsStream(
				`group-success-${String(completed + 1)}`,
				[SUCCESS_CALLS[completed] as FixtureCall],
				`THINKING_STEP_${String(completed + 1)}`,
			)
		: textStream("GROUP_SUCCESS_DONE");
}

export default function toolsGroupingPtyProvider(pi: ExtensionAPI): void {
	registerSuiteOwnedTool(
		pi,
		{
			description: "Request deterministic interactive confirmation for Tool grouping certification",
			execute: async (_toolCallId, args, _signal, _onUpdate, context) => {
				const confirmed = await context.ui.confirm(
					args.reject ? "Fixture rejection" : "Fixture permission",
					"Allow the certified fixture operation?",
				);
				return {
					content: [
						{
							type: "text",
							text: confirmed ? "FIXTURE_PERMISSION_ALLOWED" : "Tool execution was blocked by user",
						},
					],
					details: { confirmed },
				};
			},
			label: "Permission",
			name: "fixture_confirm",
			parameters: Type.Object({ reject: Type.Optional(Type.Boolean()) }),
		},
		{
			activity: {
				categories: ["run-command"],
				classify: () => [{ category: "run-command", count: 1, target: "Waiting for permission…" }],
			},
			summarize: (_args, result) =>
				(result.details as { readonly confirmed?: boolean } | undefined)?.confirmed
					? "permission allowed"
					: "permission rejected",
			target: () => "Waiting for permission…",
			resultIsError: (_args, result) =>
				(result.details as { readonly confirmed?: boolean } | undefined)?.confirmed !== true,
		},
	);
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return one deterministic cancellation for Tool grouping certification",
			execute: async () => ({
				content: [{ type: "text", text: "Operation aborted" }],
				details: { cancelled: true },
			}),
			label: "Cancel",
			name: "fixture_cancel",
			parameters: Type.Object({}),
		},
		{
			activity: {
				categories: ["run-command"],
				classify: () => [{ category: "run-command", count: 1 }],
			},
			resultIsError: () => true,
			summarize: () => "Operation aborted",
			target: () => "Cancelling operation",
		},
	);
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return one deterministic error for Tool grouping certification",
			execute: async () => ({
				content: [{ type: "text", text: "FIXTURE_GROUP_ERROR" }],
				details: { error: true },
			}),
			label: "State",
			name: "fixture_state",
			parameters: Type.Object({ state: Type.Literal("error") }),
		},
		{
			activity: {
				categories: ["run-command"],
				classify: () => [{ category: "run-command", count: 1 }],
			},
			resultIsError: () => true,
			summarize: () => "FIXTURE_GROUP_ERROR",
			target: () => "error",
		},
	);
	registerSuiteOwnedTool(
		pi,
		{
			description: "Fail once, then complete the same exact operation for recovery certification",
			execute: async (toolCallId) => {
				const failed = toolCallId.endsWith("-1");
				return {
					content: [{ type: "text", text: failed ? "FIXTURE_RETRY_FAILED" : "FIXTURE_RETRY_RECOVERED" }],
					details: { failed },
				};
			},
			label: "Retry",
			name: "fixture_retry",
			parameters: Type.Object({ value: Type.String() }),
		},
		{
			activity: {
				categories: ["run-command"],
				classify: () => [{ category: "run-command", count: 1 }],
			},
			resultIsError: (_args, result) =>
				(result.details as { readonly failed?: boolean } | undefined)?.failed === true,
			summarize: (_args, _result, state) => (state === "success" ? "recovered" : "retry failed"),
			target: (args) => args.value,
		},
	);
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return one deterministic visible image for Tool grouping certification",
			execute: async () => ({
				content: [
					{
						data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
						mimeType: "image/png" as const,
						type: "image" as const,
					},
				],
				details: { visible: true },
			}),
			label: "Media",
			name: "fixture_media",
			parameters: Type.Object({}),
		},
		{
			activity: {
				categories: ["view-image"],
				classify: () => [{ category: "view-image", countKeys: ["fixture-media"] }],
			},
			summarize: () => "media loaded",
			target: () => "Visible image",
		},
	);
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return deterministic hidden context padding for compaction certification",
			execute: async () => ({
				content: Array.from({ length: 20 }, () => ({
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
					mimeType: "image/png" as const,
					type: "image" as const,
				})),
				details: undefined,
			}),
			label: "Padding",
			name: "padding_tool",
			parameters: Type.Object({}),
		},
		{
			activity: {
				categories: ["read-file"],
				classify: () => [{ category: "read-file", countKeys: ["padding"] }],
			},
			detailLines: () => ["deterministic compaction padding"],
			label: "Padding",
			summarize: () => "padded",
		},
	);
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff Tool grouping PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff Tool grouping PTY fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => fixtureStream(context),
	});
}
