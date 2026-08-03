import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSuiteOwnedTool } from "../../packages/pi-stuff-tools/contract.js";

const PROVIDER = "pi-stuff-tools-pty";
const MODEL = "fixture-model";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const TOOL_SEQUENCE = [
	{ name: "read", arguments: { path: "input-工具.txt" } },
	{ name: "write", arguments: { path: "written.txt", content: "旧内容\nsecond line\n" } },
	{ name: "edit", arguments: { path: "written.txt", oldText: "旧内容", newText: "新内容" } },
	{ name: "bash", arguments: { command: "printf '\u001b]0;OWNED_TITLE\u0007BASH_CJK_工具\\n'" } },
	{ name: "grep", arguments: { pattern: "新内容", path: "." } },
	{ name: "find", arguments: { pattern: "*.txt", path: "." } },
	{ name: "ls", arguments: { path: "." } },
	{ name: "bash", arguments: { command: "printf 'BUILTIN_FAILURE_工具\\n' >&2; exit 7" } },
	{ name: "fixture_state", arguments: { state: "error" } },
	{ name: "fixture_state", arguments: { state: "rejected" } },
	{ name: "fixture_state", arguments: { state: "cancelled" } },
] as const;

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

function toolCallStream(index: number) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const fixture = TOOL_SEQUENCE[index];
	if (!fixture) return textStream("TOOLS_DONE");
	const toolCall = {
		type: "toolCall" as const,
		id: `tools-pty-${String(index + 1)}`,
		name: fixture.name,
		arguments: fixture.arguments,
	};
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function fixtureStream(context: Context) {
	const completed = context.messages.filter((entry) => entry.role === "toolResult").length;
	const tools = (context.tools ?? []).map((tool) => tool.name);
	// biome-ignore lint/complexity/useLiteralKeys: the test suite enables noPropertyAccessFromIndexSignature
	const logPath = process.env["PI_STUFF_TOOLS_PTY_LOG"];
	if (logPath) appendFileSync(logPath, `${JSON.stringify({ completed, tools })}\n`);
	if (process.env["PI_STUFF_TOOLS_PTY_PROBE_ONLY"] === "1") return textStream("TOOLS_PROBE_DONE");
	return completed < TOOL_SEQUENCE.length ? toolCallStream(completed) : textStream("TOOLS_DONE");
}

export default function toolsPtyProvider(pi: ExtensionAPI): void {
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return deterministic terminal states for Tool UI certification",
			execute: async (_toolCallId, args) => ({
				content: [
					{
						type: "text",
						text:
							args.state === "rejected"
								? "[pi-stuff-permissions] FIXTURE_REJECTED"
								: args.state === "cancelled"
									? "Command aborted: FIXTURE_CANCELLED"
									: "FIXTURE_ERROR",
					},
				],
				details: { state: args.state },
			}),
			label: "State",
			name: "fixture_state",
			parameters: Type.Object({
				state: Type.Union([Type.Literal("error"), Type.Literal("rejected"), Type.Literal("cancelled")]),
			}),
		},
		{
			resultIsError: () => true,
			summarize: (_args, _result, state) => state,
			target: (args) => args.state,
		},
	);
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff Tools PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff Tools PTY fixture",
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
