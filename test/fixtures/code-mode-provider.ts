import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { type ExtensionAPI, estimateTokens } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-code-mode-fixture";
const MODEL = "fixture";
const LOG_ENV = "PI_STUFF_CODE_MODE_FIXTURE_LOG";
const DIRECT_ENV = "PI_STUFF_CODE_MODE_FIXTURE_DIRECT";
const HIDE_RESULT_ENV = "PI_STUFF_CODE_MODE_FIXTURE_HIDE_RESULT";
const SCENARIO_ENV = "PI_STUFF_CODE_MODE_FIXTURE_SCENARIO";
const ZERO_USAGE = {
	cacheRead: 0,
	cacheWrite: 0,
	cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
	input: 0,
	output: 0,
	totalTokens: 0,
};

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		api: "openai-completions",
		content,
		model: MODEL,
		provider: PROVIDER,
		role: "assistant",
		stopReason,
		timestamp: Date.now(),
		usage: ZERO_USAGE,
	};
}

function textStream(value: string) {
	const stream = createAssistantMessageEventStream();
	const pending = assistant([], "pending");
	stream.push({ partial: pending, type: "start" });
	stream.push({ contentIndex: 0, partial: pending, type: "text_start" });
	stream.push({ contentIndex: 0, delta: value, partial: pending, type: "text_delta" });
	stream.push({ content: value, contentIndex: 0, partial: pending, type: "text_end" });
	stream.push({ message: assistant([{ text: value, type: "text" }], "stop"), reason: "stop", type: "done" });
	return stream;
}

function codeModeStream() {
	const stream = createAssistantMessageEventStream();
	const pending = assistant([], "pending");
	const toolCall = {
		arguments: {
			code:
				process.env[SCENARIO_ENV] === "failure"
					? 'await suite.read({ path: "pi-stuff-code-mode-missing-file" });'
					: process.env[SCENARIO_ENV] === "cancel"
						? `const cancelled = await suite.bash({
  command: "printf 'Operation aborted\\n' >&2; exit 1",
  description: "Cancellation fixture"
});
text(cancelled.content.find((part) => part.type === "text")?.text ?? "Operation aborted");`
						: process.env[SCENARIO_ENV] === "media"
							? 'await Promise.all([suite.read({ path: "pixel.png" }), suite.read({ path: "README.md", limit: 1 }), suite.read({ path: "pixel-copy.png" })]); text("MEDIA_OK");'
							: `const matches = codemode.search("read file");
const selected = matches.results.find((entry) => entry.method === "read");
if (!selected) throw new Error("read not found");
const docs = codemode.describe(selected.path);
const contextDocs = codemode.describe("suite.ctx_search");
const result = await suite[selected.method]({ path: "README.md", limit: 1 });
await suite.bash({ command: "printf CODE_MODE_GROUP_OK", description: "Check Tool grouping" });
await suite.background({ action: "list" });
await suite.subagent({ action: "status" });
const firstLine = result.content.find((part) => part.type === "text")?.text.split("\\n")[0];
text(JSON.stringify({
  context: contextDocs.inputSchema.type === "object",
  firstLine,
  typed: docs.inputSchema.properties.path.type === "string"
}));`,
		},
		id: "pi-stuff-code-mode-fixture-1",
		name: "codemode",
		type: "toolCall" as const,
	};
	stream.push({ partial: pending, type: "start" });
	stream.push({ contentIndex: 0, partial: pending, type: "toolcall_start" });
	stream.push({ contentIndex: 0, partial: pending, toolCall, type: "toolcall_end" });
	stream.push({ message: assistant([toolCall], "toolUse"), reason: "toolUse", type: "done" });
	return stream;
}

function directToolStream() {
	const stream = createAssistantMessageEventStream();
	const pending = assistant([], "pending");
	const toolCalls =
		process.env[SCENARIO_ENV] === "failure"
			? [
					{
						arguments: { path: "pi-stuff-code-mode-missing-file" },
						id: "pi-stuff-direct-read-failure-fixture-1",
						name: "read",
						type: "toolCall" as const,
					},
				]
			: process.env[SCENARIO_ENV] === "cancel"
				? [
						{
							arguments: {
								command: "printf 'Operation aborted\\n' >&2; exit 1",
								description: "Cancellation fixture",
							},
							id: "pi-stuff-direct-bash-cancel-fixture-1",
							name: "bash",
							type: "toolCall" as const,
						},
					]
				: process.env[SCENARIO_ENV] === "media"
					? [
							{
								arguments: { path: "pixel.png" },
								id: "pi-stuff-direct-read-media-fixture-1",
								name: "read",
								type: "toolCall" as const,
							},
							{
								arguments: { limit: 1, path: "README.md" },
								id: "pi-stuff-direct-read-media-fixture-2",
								name: "read",
								type: "toolCall" as const,
							},
							{
								arguments: { path: "pixel-copy.png" },
								id: "pi-stuff-direct-read-media-fixture-3",
								name: "read",
								type: "toolCall" as const,
							},
						]
					: [
							{
								arguments: { limit: 1, path: "README.md" },
								id: "pi-stuff-direct-read-fixture-1",
								name: "read",
								type: "toolCall" as const,
							},
							{
								arguments: { command: "printf CODE_MODE_GROUP_OK", description: "Check Tool grouping" },
								id: "pi-stuff-direct-bash-fixture-1",
								name: "bash",
								type: "toolCall" as const,
							},
							{
								arguments: { action: "list" },
								id: "pi-stuff-direct-background-fixture-1",
								name: "background",
								type: "toolCall" as const,
							},
							{
								arguments: { action: "status" },
								id: "pi-stuff-direct-subagent-fixture-1",
								name: "subagent",
								type: "toolCall" as const,
							},
						];
	stream.push({ partial: pending, type: "start" });
	for (const [contentIndex, toolCall] of toolCalls.entries()) {
		stream.push({ contentIndex, partial: pending, type: "toolcall_start" });
		stream.push({ contentIndex, partial: pending, toolCall, type: "toolcall_end" });
	}
	stream.push({ message: assistant(toolCalls, "toolUse"), reason: "toolUse", type: "done" });
	return stream;
}

function fixtureStream(context: Context) {
	const toolNames = (context.tools ?? []).map((tool) => tool.name);
	const direct = process.env[DIRECT_ENV] === "1";
	const directResultName = process.env[SCENARIO_ENV] === "cancel" ? "bash" : "read";
	const result = [...context.messages]
		.reverse()
		.find(
			(message) => message.role === "toolResult" && message.toolName === (direct ? directResultName : "codemode"),
		);
	const logPath = process.env[LOG_ENV];
	if (logPath) {
		const schemaChars = JSON.stringify(context.tools ?? []).length;
		const systemPromptChars = context.systemPrompt?.length ?? 0;
		const messageTokens = context.messages.reduce((total, message) => total + estimateTokens(message), 0);
		appendFileSync(
			logPath,
			`${JSON.stringify({
				estimatedInputTokens: Math.ceil(systemPromptChars / 4) + Math.ceil(schemaChars / 4) + messageTokens,
				hasResult: Boolean(result),
				messageTokens,
				resultImageCount:
					result?.role === "toolResult" && Array.isArray(result.content)
						? result.content.filter((part) => part.type === "image").length
						: 0,
				schemaChars,
				systemPromptChars,
				toolNames,
			})}\n`,
		);
	}
	if (!result) return direct ? directToolStream() : codeModeStream();
	const resultText =
		result?.role === "toolResult" && Array.isArray(result.content)
			? result.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n")
			: "";
	return textStream(
		process.env[HIDE_RESULT_ENV] === "1"
			? "VERIFY_COMPLETE"
			: `${direct ? "DIRECT_COMPLETE" : "CODE_MODE_COMPLETE"} ${resultText}`,
	);
}

export default function codeModeFixtureProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		api: "openai-completions",
		apiKey: "offline-fixture",
		baseUrl: "https://fixture.invalid",
		models: [
			{
				api: "openai-completions",
				contextWindow: 400_000,
				cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
				id: MODEL,
				input: ["text", "image"],
				maxTokens: 4_096,
				name: "Pi Stuff Code Mode fixture",
				reasoning: false,
			},
		],
		name: "Pi Stuff Code Mode fixture",
		streamSimple: (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => fixtureStream(context),
	});
}
