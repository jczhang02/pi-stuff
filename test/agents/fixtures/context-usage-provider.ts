import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-context-usage";
const MODEL = "fixture-model";
export const CONTEXT_USAGE_PROVIDER_EXTENSION_PATH = import.meta.path;

function message(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	totalTokens = 0,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: PROVIDER,
		model: MODEL,
		usage: {
			input: totalTokens === 0 ? 0 : totalTokens - 1_000,
			output: totalTokens === 0 ? 0 : 1_000,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function streamFixture(_context: Context, _options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	const text = "PROCESS_CONTEXT_REPORTED";
	const pending = message([], "pending");
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
	queueMicrotask(() => {
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
		stream.push({
			type: "done",
			reason: "stop",
			message: message([{ type: "text", text }], "stop", 50_000),
		});
	});
	return stream;
}

export default function registerContextUsageProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff context usage fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff context usage fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
			streamFixture(context, options),
	});
}
