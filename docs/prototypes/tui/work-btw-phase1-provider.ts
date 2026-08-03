/**
 * PROTOTYPE SUPPORT — deterministic localhost-free provider for native Pi BTW captures.
 *
 * The provider never contacts a model. It supplies a completed main turn and a
 * delayed side answer so the production BTW surface can be photographed in its
 * answering and answered states.
 */

import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-btw-phase1";
const MODEL = "fixture";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(text: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content: text.length === 0 ? [] : [{ type: "text", text }],
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
		const message = context.messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function streamText(text: string, delayMilliseconds: number, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	const pending = assistant("", "pending");
	let settled = false;

	const finish = (): void => {
		if (settled) return;
		settled = true;
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
		stream.push({ type: "done", reason: "stop", message: assistant(text, "stop") });
	};
	const abort = (): void => {
		if (settled) return;
		settled = true;
		stream.push({ type: "error", reason: "aborted", error: assistant("", "aborted") });
	};

	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	const timer = setTimeout(finish, delayMilliseconds);
	timer.unref();
	options?.signal?.addEventListener(
		"abort",
		() => {
			clearTimeout(timer);
			abort();
		},
		{ once: true },
	);
	return stream;
}

export default function phase1CaptureProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff BTW Phase 1 fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff BTW Phase 1 fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
			const question = lastUserText(context);
			if (question.includes("MAIN_PHASE1")) {
				return streamText(
					"MAIN_PHASE1_DONE\n\nThe main transcript remains available while BTW owns the focused region.",
					40,
					options,
				);
			}
			const answer = question.includes("second")
				? "The first answer emphasized transcript isolation and an unchanged main session."
				: "The side answer stays outside the main transcript.\n\n- **Main session:** unchanged\n- **Selected answer:** may be copied or promoted\n- **Tools:** unavailable inside BTW";
			return streamText(answer, 4_000, options);
		},
	});
}
