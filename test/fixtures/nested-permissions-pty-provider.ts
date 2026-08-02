import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-nested-permissions-pty";
const MODEL = "fixture-model";
const CHILD_TASK = "NESTED_PERMISSION_CHILD_TASK";
const GRANDCHILD_TASK = "NESTED_PERMISSION_GRANDCHILD_TASK";

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

function record(value: Record<string, unknown>): void {
	// biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
	const path = process.env["PI_STUFF_NESTED_PERMISSIONS_PTY_LOG"];
	if (!path) return;
	appendFileSync(path, `${JSON.stringify({ at: Date.now(), ...value })}\n`);
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

function toolCallStream(id: string, name: string, args: Record<string, unknown>) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCall = { type: "toolCall" as const, id, name, arguments: args };
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function latestToolResult(context: Context): { name: string; text: string } | undefined {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const entry = context.messages[index];
		if (entry?.role !== "toolResult") continue;
		const text = entry.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		return { name: entry.toolName, text };
	}
	return undefined;
}

function fixtureStream(context: Context, _options?: SimpleStreamOptions) {
	// biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
	const depth = Number(process.env["PI_SUBAGENT_DEPTH"] ?? "0");
	const toolResult = latestToolResult(context);
	record({ kind: "request", depth, toolResultName: toolResult?.name, toolResultText: toolResult?.text });

	if (depth >= 2) {
		if (toolResult?.name === "bash") {
			const denied = /\b(?:denied|blocked|rejected|not approved)\b/i.test(toolResult.text);
			record({ kind: "grandchild-result", denied, text: toolResult.text });
			return textStream(
				denied ? `GRANDCHILD_DENIED\n${toolResult.text}` : `GRANDCHILD_MISSING_DENIAL\n${toolResult.text}`,
			);
		}
		// biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
		const command = process.env["PI_STUFF_NESTED_PERMISSIONS_PTY_COMMAND"];
		if (!command) return textStream("GRANDCHILD_MISSING_COMMAND");
		return toolCallStream("nested-permissions-bash", "bash", { command });
	}

	if (depth === 1) {
		if (toolResult?.name === "subagent") {
			const denied = toolResult.text.includes("GRANDCHILD_DENIED");
			record({ kind: "child-result", denied, text: toolResult.text });
			return textStream(
				denied ? `CHILD_SAW_DENIAL\n${toolResult.text}` : `CHILD_MISSING_DENIAL\n${toolResult.text}`,
			);
		}
		return toolCallStream("nested-permissions-grandchild", "subagent", {
			agent: "permission-grandchild",
			task: GRANDCHILD_TASK,
			foreground: true,
			context: "fresh",
		});
	}

	const serialized = JSON.stringify(context.messages);
	if (serialized.includes("CHILD_SAW_DENIAL")) {
		record({ kind: "main-result", denied: true });
		return textStream("NESTED_MAIN_SAW_DENIAL");
	}
	if (toolResult?.name === "subagent") return textStream("NESTED_MAIN_NOT_BLOCKED");
	return toolCallStream("nested-permissions-child", "subagent", {
		agent: "permission-child",
		task: CHILD_TASK,
		foreground: false,
		context: "fresh",
	});
}

export default function nestedPermissionsPtyProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff nested permissions PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff nested permissions PTY fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
			fixtureStream(context, options),
	});
}
