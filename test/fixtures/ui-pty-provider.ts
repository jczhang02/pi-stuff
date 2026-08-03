import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { getCommandDialogCoordinator } from "../../packages/pi-stuff-ui/index.js";

const PROVIDER = "pi-stuff-ui-pty";
const MODEL = "ui-pty-model";
const SUBSCRIPTION_PROVIDER = "kimi-coding";
const SUBSCRIPTION_MODEL = "ui-pty-subscription";
export const FIRST_THOUGHT = "第一帧安全\u001b]0;OWNED_TITLE\u0007尾部。";
export const FINAL_THOUGHT = "正在验证中文🧪宽度与实时更新。";
const PRIMING_THOUGHT = "准备。";
export const FIXTURE_THINKING = `${PRIMING_THOUGHT}${FIRST_THOUGHT}${FINAL_THOUGHT}`;
const RESPONSE = [
	"UI_PTY_DONE 中文结果🧪",
	...Array.from({ length: 20 }, (_, index) => `真实输出 ${String(index + 1).padStart(2, "0")} · 对话保持优先`),
].join("\n");

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const FINAL_USAGE = {
	input: 64_000,
	output: 2_000,
	cacheRead: 18_000,
	cacheWrite: 0,
	totalTokens: 84_000,
	cost: { input: 0.3, output: 0.12, cacheRead: 0, cacheWrite: 0, total: 0.42 },
};

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	usage = ZERO_USAGE,
	provider = PROVIDER,
	model = MODEL,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider,
		model,
		usage,
		stopReason,
		timestamp: Date.now(),
	};
}

function lastUserText(context: Context): string {
	for (let index = context.messages.length - 1; index >= 0; index -= 1) {
		const message = context.messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((part): part is { readonly type: "text"; readonly text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function appendRecord(record: unknown): void {
	const { PI_STUFF_UI_PTY_LOG: path } = process.env;
	if (path) appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function preservesFixtureThinking(context: Context): boolean {
	return context.messages.some(
		(message) =>
			message.role === "assistant" &&
			message.content.some((content) => content.type === "thinking" && content.thinking === FIXTURE_THINKING),
	);
}

function textOnlyStream(model: Model<Api>, text: string) {
	const stream = createAssistantMessageEventStream();
	const pending = assistantMessage([], "pending", ZERO_USAGE, model.provider, model.id);
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
	stream.push({
		type: "done",
		reason: "stop",
		message: assistantMessage([{ type: "text", text }], "stop", ZERO_USAGE, model.provider, model.id),
	});
	return stream;
}

function fixtureStream(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const lastUser = lastUserText(context);
	const priorThinkingPreserved = preservesFixtureThinking(context);
	appendRecord({
		type: "request",
		lastUser,
		priorThinkingPreserved,
		tools: (context.tools ?? []).map((tool) => tool.name),
	});
	if (lastUser === "VERIFY_CONTEXT_REUSE") {
		return textOnlyStream(model, priorThinkingPreserved ? "CONTEXT_PRESERVED" : "CONTEXT_LOST");
	}
	const isThoughtProbe = lastUser.startsWith("THOUGHT_PROBE_");
	const response = isThoughtProbe ? `THOUGHT_DONE_${lastUser.slice("THOUGHT_PROBE_".length)}` : RESPONSE;
	const finalUsage = isThoughtProbe ? ZERO_USAGE : FINAL_USAGE;
	const stream = createAssistantMessageEventStream();
	const pending = assistantMessage([], "pending", ZERO_USAGE, model.provider, model.id);
	let thinking = "";
	let settled = false;

	const finish = (): void => {
		if (settled) return;
		settled = true;
		pending.content = [{ type: "thinking", thinking }];
		stream.push({ type: "thinking_end", contentIndex: 0, content: FIXTURE_THINKING, partial: pending });
		pending.content = [
			{ type: "thinking", thinking },
			{ type: "text", text: "" },
		];
		stream.push({ type: "text_start", contentIndex: 1, partial: pending });
		pending.content = [
			{ type: "thinking", thinking },
			{ type: "text", text: response },
		];
		stream.push({ type: "text_delta", contentIndex: 1, delta: response, partial: pending });
		stream.push({ type: "text_end", contentIndex: 1, content: response, partial: pending });
		stream.push({
			type: "done",
			reason: "stop",
			message: assistantMessage(
				[
					{ type: "thinking", thinking: FIXTURE_THINKING },
					{ type: "text", text: response },
				],
				"stop",
				finalUsage,
				model.provider,
				model.id,
			),
		});
	};
	const abort = (): void => {
		if (settled) return;
		settled = true;
		stream.push({
			type: "error",
			reason: "aborted",
			error: assistantMessage([], "aborted", ZERO_USAGE, model.provider, model.id),
		});
	};

	stream.push({ type: "start", partial: pending });
	pending.content = [{ type: "thinking", thinking }];
	stream.push({ type: "thinking_start", contentIndex: 0, partial: pending });
	thinking += PRIMING_THOUGHT;
	pending.content = [{ type: "thinking", thinking }];
	stream.push({ type: "thinking_delta", contentIndex: 0, delta: PRIMING_THOUGHT, partial: pending });
	setTimeout(() => {
		if (settled) return;
		thinking += FIRST_THOUGHT;
		pending.content = [{ type: "thinking", thinking }];
		stream.push({ type: "thinking_delta", contentIndex: 0, delta: FIRST_THOUGHT, partial: pending });
	}, 800);
	setTimeout(() => {
		if (settled) return;
		thinking += FINAL_THOUGHT;
		pending.content = [{ type: "thinking", thinking }];
		stream.push({
			type: "thinking_delta",
			contentIndex: 0,
			delta: FINAL_THOUGHT,
			partial: pending,
		});
	}, 2_000);
	setTimeout(finish, 3_200);
	options?.signal?.addEventListener("abort", abort, { once: true });
	return stream;
}

export default function uiPtyProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff UI PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: MODEL,
				reasoning: true,
				input: ["text"],
				cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
			fixtureStream(model, context, options),
	});
	pi.registerProvider(SUBSCRIPTION_PROVIDER, {
		name: "Pi Stuff API-key subscription fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: SUBSCRIPTION_MODEL,
				name: SUBSCRIPTION_MODEL,
				reasoning: true,
				input: ["text"],
				cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
			fixtureStream(model, context, options),
	});

	pi.registerShortcut(Key.f11, {
		description: "Switch to the API-key subscription fixture",
		handler: async (ctx) => {
			const model = ctx.modelRegistry.find(SUBSCRIPTION_PROVIDER, SUBSCRIPTION_MODEL);
			const usingOAuth = model ? ctx.modelRegistry.isUsingOAuth(model) : undefined;
			const selected = model ? await pi.setModel(model) : false;
			appendRecord({
				type: "subscription-switch",
				model: model?.id,
				provider: model?.provider,
				selected,
				usingOAuth,
			});
			ctx.ui.notify(
				selected ? "SUBSCRIPTION_MODEL_READY" : "SUBSCRIPTION_MODEL_FAILED",
				selected ? "info" : "error",
			);
		},
	});

	pi.registerShortcut(Key.f12, {
		description: "Open the UI PTY draft-restoration fixture",
		handler: async (ctx) => {
			await getCommandDialogCoordinator(pi).show(ctx, {
				priority: "normal",
				create: ({ close }) => ({
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape)) close();
					},
					invalidate: () => {},
					render: () => ["DRAFT_SURFACE 中文"],
				}),
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus("goal", "goal:UI");
		ctx.ui.setStatus("mcp", "mcp:2");
		ctx.ui.setStatus("loadout", "load:full");
		appendRecord({
			type: "inventory",
			commands: pi.getCommands().map((command) => command.name),
			markdownTransformer: typeof Reflect.get(pi, "registerMarkdownTransformer") === "function",
		});
	});
}
