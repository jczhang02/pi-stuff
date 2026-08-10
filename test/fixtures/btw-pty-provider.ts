import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { getCommandDialogCoordinator } from "../../packages/pi-stuff/src/conversation-ui/index.js";

const PROVIDER = "pi-stuff-pty";
const MODEL = "fixture-model";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(text: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
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
	let user: Context["messages"][number] | undefined;
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (message?.role !== "user") continue;
		user = message;
		break;
	}
	if (!user) return "";
	if (typeof user.content === "string") return user.content;
	return user.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function recordRequest(context: Context): void {
	const { PI_STUFF_PTY_LOG: path } = process.env;
	if (!path) return;
	appendFileSync(
		path,
		`${JSON.stringify({
			lastUser: lastUserText(context),
			messageCount: context.messages.length,
			tools: (context.tools ?? []).map((tool) => tool.name),
		})}\n`,
	);
}

function fixtureStream(context: Context, options?: SimpleStreamOptions) {
	recordRequest(context);
	const stream = createAssistantMessageEventStream();
	const pending = message("", "pending");
	const sideQuestion = (context.tools ?? []).length === 0;
	const first = sideQuestion ? "BTW_STREAM" : "MAIN_START";
	const second = sideQuestion
		? `\nBTW_SCROLL_TOP\n${Array.from({ length: 48 }, (_, index) => `scroll line ${index + 1}`).join("\n")}\nBTW_DONE`
		: " MAIN_DONE";
	let settled = false;
	const finish = (): void => {
		if (settled) return;
		settled = true;
		stream.push({ type: "text_delta", contentIndex: 0, delta: second, partial: pending });
		stream.push({ type: "text_end", contentIndex: 0, content: `${first}${second}`, partial: pending });
		stream.push({ type: "done", reason: "stop", message: message(`${first}${second}`, "stop") });
	};
	const abort = (): void => {
		if (settled) return;
		settled = true;
		stream.push({ type: "error", reason: "aborted", error: message(first, "aborted") });
	};

	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: first, partial: pending });
	setTimeout(finish, sideQuestion ? 100 : 2_000);
	options?.signal?.addEventListener("abort", abort, { once: true });
	return stream;
}

export default function btwPtyProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff PTY fixture",
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

	pi.registerShortcut(Key.f12, {
		description: "Open the PTY draft-restoration fixture",
		handler: async (ctx) => {
			const coordinator = getCommandDialogCoordinator(pi);
			await coordinator.show(ctx, {
				priority: "normal",
				create: ({ close }) => ({
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape)) close();
					},
					invalidate: () => {},
					render: () => ["DRAFT_SURFACE"],
				}),
			});
		},
	});
}
