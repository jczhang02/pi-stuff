import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSuiteOwnedTool } from "../../packages/pi-stuff-tools/contract.js";

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
];
const FAILURE_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "fixture_state", arguments: { state: "error" } },
	{ name: "read", arguments: { path: "input-工具.txt" } },
];
const MUTATION_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "bash", arguments: { command: "printf mutation > bash-mutation-工具.txt" } },
	{ name: "read", arguments: { path: "input-工具.txt" } },
];
const BACKGROUND_CALLS: readonly FixtureCall[] = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "bash", arguments: { command: "sleep 30" } },
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "bash", arguments: { command: "sleep 31", run_in_background: true } },
	{ name: "read", arguments: { path: "input-工具.txt" } },
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
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
	stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
	return stream;
}

function toolCallsStream(prefix: string, fixtures: readonly FixtureCall[]) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCalls = fixtures.map((fixture, index) => ({
		type: "toolCall" as const,
		id: `${prefix}-${String(index + 1)}`,
		name: fixture.name,
		arguments: fixture.arguments,
	}));
	stream.push({ type: "start", partial: pending });
	for (const [index, toolCall] of toolCalls.entries()) {
		stream.push({ type: "toolcall_start", contentIndex: index, partial: pending });
		stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: pending });
	}
	stream.push({ type: "done", reason: "toolUse", message: message(toolCalls, "toolUse") });
	return stream;
}

function textContent(message: Context["messages"][number]): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
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
	const completed = context.messages.slice(lastUserIndex + 1).filter((entry) => entry.role === "toolResult").length;
	if (request.includes("failure")) {
		return completed === 0 ? toolCallsStream("group-failure", FAILURE_CALLS) : textStream("GROUP_FAILURE_DONE");
	}
	if (request.includes("mutation")) {
		return completed === 0 ? toolCallsStream("group-mutation", MUTATION_CALLS) : textStream("GROUP_MUTATION_DONE");
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
	return completed === 0 ? toolCallsStream("group-success", SUCCESS_CALLS) : textStream("GROUP_SUCCESS_DONE");
}

export default function toolsGroupingPtyProvider(pi: ExtensionAPI): void {
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return one deterministic error for Tool grouping certification",
			execute: async () => ({ content: [{ type: "text", text: "FIXTURE_GROUP_ERROR" }], details: { error: true } }),
			label: "State",
			name: "fixture_state",
			parameters: Type.Object({ state: Type.Literal("error") }),
		},
		{
			resultIsError: () => true,
			summarize: () => "FIXTURE_GROUP_ERROR",
			target: () => "error",
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
		{ detailLines: () => ["deterministic compaction padding"], label: "Padding", summarize: () => "padded" },
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
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => fixtureStream(context),
	});
}
