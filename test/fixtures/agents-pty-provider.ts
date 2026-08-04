import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-agents-pty";
const MODEL = "fixture-model";
const DESCRIPTION = "复核工具结果 🧪";
const TASK =
	"AGENT_PTY_TASK · 中文长任务：独立只读复核 /tmp/pi-max-tools-019fc372-d606-77ef-b3d5-59ba054c8d1a/sample.txt 并检查终端截断与状态保留";
const SUBAGENT_CHILD_ENV = "PI_SUBAGENT_CHILD";
const SUBAGENT_PI_BINARY_ENV = "PI_SUBAGENT_PI_BINARY";

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

function lastUserText(context: Context): string {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const entry = context.messages[index];
		if (entry?.role !== "user") continue;
		if (typeof entry.content === "string") return entry.content;
		return entry.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function record(value: Record<string, unknown>): void {
	// biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
	const path = process.env["PI_STUFF_AGENTS_PTY_LOG"];
	if (!path) return;
	appendFileSync(path, `${JSON.stringify({ at: Date.now(), ...value })}\n`);
}

function textStream(first: string, second = "", delayMs = 0, onFinish?: () => void) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	let settled = false;
	const finish = (): void => {
		if (settled) return;
		settled = true;
		if (second) stream.push({ type: "text_delta", contentIndex: 0, delta: second, partial: pending });
		const text = `${first}${second}`;
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
		stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
		onFinish?.();
	};
	const abort = (): void => {
		if (settled) return;
		settled = true;
		stream.push({ type: "error", reason: "aborted", error: message([{ type: "text", text: first }], "aborted") });
	};

	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: first, partial: pending });
	if (delayMs > 0) setTimeout(finish, delayMs);
	else queueMicrotask(finish);
	return { stream, abort };
}

function launchStream() {
	return toolCallStream("agents-pty-launch", "subagent", {
		agent: "general-purpose",
		description: DESCRIPTION,
		task: TASK,
		foreground: false,
		context: "fresh",
	});
}

function childReadStream() {
	return toolCallStream("agents-pty-child-read", "read", { path: "agent-tool-target.txt" });
}

function toolCallStream(id: string, name: string, argumentsValue: Record<string, unknown>) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCall = {
		type: "toolCall" as const,
		id,
		name,
		arguments: argumentsValue,
	};
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function fixtureStream(context: Context, options?: SimpleStreamOptions) {
	// biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
	const child = process.env["PI_SUBAGENT_CHILD"] === "1";
	const serialized = JSON.stringify(context.messages);
	const completion = serialized.includes("CHILD_FINAL_SUMMARY");
	const toolResult = context.messages.some((entry) => entry.role === "toolResult" && entry.toolName === "subagent");
	const childReadResult = context.messages.some((entry) => entry.role === "toolResult" && entry.toolName === "read");
	const phase = child ? "child" : completion ? "completion" : toolResult ? "continued" : "launch";
	record({
		kind: "request",
		phase,
		role: child ? "child" : "main",
		lastUser: lastUserText(context),
		tools: (context.tools ?? []).map((tool) => tool.name),
		completion,
	});

	if (child) {
		if (!childReadResult) return childReadStream();
		const result = textStream("CHILD_RUNNING", "\nCHILD_FINAL_SUMMARY", 4_000, () => {
			record({ kind: "child-finished", role: "child" });
		});
		options?.signal?.addEventListener("abort", result.abort, { once: true });
		return result.stream;
	}
	if (completion) return textStream("UNSOLICITED_MAIN_TURN").stream;
	if (toolResult) return textStream("MAIN_NOT_BLOCKED").stream;
	return launchStream();
}

export default function agentsPtyProvider(pi: ExtensionAPI): void {
	// The parent Host must be inherited without the supported emergency override;
	// child processes keep the already-clean environment.
	if (process.env[SUBAGENT_CHILD_ENV] !== "1") delete process.env[SUBAGENT_PI_BINARY_ENV];
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff Agents PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff Agents PTY fixture",
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
