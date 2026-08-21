import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Guard } from "typebox/guard";

const PROVIDER = "pi-stuff-rtk-pty";
const MODEL = "fixture-model";
const LONG_OUTPUT_COMMAND =
	"printf '\\033[31mRAW_RTK_RESULT_MARKER\\033[0m\\n'; i=0; while [ \"$i\" -lt 1600 ]; do printf 'RAW_RTK_LONG_LINE_%04d\\n' \"$i\"; i=$((i + 1)); done";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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

function toolCallStream(id: string, command: string) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCall = { type: "toolCall" as const, id, name: "bash", arguments: { command } };
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function contextRecord(context: Context, phase: string): object {
	const bashCommands: string[] = [];
	const toolResults: Array<{ id: string; text: string }> = [];
	for (const entry of context.messages) {
		if (entry.role === "assistant") {
			for (const part of entry.content) {
				if (part.type !== "toolCall" || part.name !== "bash") continue;
				const command = part.arguments["command"];
				if (Guard.IsString(command)) bashCommands.push(command);
			}
		}
		if (entry.role !== "toolResult" || entry.toolName !== "bash") continue;
		toolResults.push({
			id: entry.toolCallId,
			text: entry.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n"),
		});
	}
	return { bashCommands, phase, toolResults };
}

function fixtureStream(context: Context) {
	const phase = process.env["PI_STUFF_RTK_PTY_PHASE"] ?? "fresh";
	const logPath = process.env["PI_STUFF_RTK_PTY_LOG"];
	if (logPath) appendFileSync(logPath, `${JSON.stringify(contextRecord(context, phase))}\n`);
	if (phase === "resume") return textStream("RTK_RESUME_DONE");
	const completed = context.messages.filter(
		(entry) => entry.role === "toolResult" && entry.toolName === "bash",
	).length;
	if (completed === 0) return toolCallStream("rtk-pty-git-status", "git status");
	if (completed === 1) return toolCallStream("rtk-pty-long-output", LONG_OUTPUT_COMMAND);
	return textStream("RTK_FRESH_DONE");
}

export default function rtkPtyProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff RTK PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff RTK PTY fixture",
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
