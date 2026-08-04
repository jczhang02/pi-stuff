import { appendFileSync, writeFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSuiteOwnedTool } from "../../packages/pi-stuff-tools/contract.js";

const PROVIDER = "pi-stuff-context-pty";
const MODEL = "fixture-model";
const BULK_CONTEXT = "Historical Context evidence segment for real Magic Context compaction.\n".repeat(12_000);

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const HIGH_USAGE = {
	...ZERO_USAGE,
	input: 190_000,
	totalTokens: 190_000,
};
const LOW_USAGE = {
	...ZERO_USAGE,
	input: 1_000,
	totalTokens: 1_000,
};

function record(value: Readonly<Record<string, unknown>>): void {
	const path = process.env["PI_STUFF_CONTEXT_PTY_LOG"];
	if (path) appendFileSync(path, `${JSON.stringify(value)}\n`);
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const text = (part as { readonly text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function allText(context: Context): string {
	return context.messages
		.map((entry) => contentText((entry as { readonly content?: unknown }).content))
		.filter(Boolean)
		.join("\n");
}

function lastUserText(context: Context): string {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const entry = context.messages[index];
		if (entry?.role === "user") return contentText(entry.content);
	}
	return "";
}

function historianPayload(prompt: string): string {
	const range = /Messages\s+(\d+)-(\d+):/.exec(prompt);
	const start = Number(range?.[1] ?? "1");
	const end = Number(range?.[2] ?? String(start));
	record({ type: "historian", model: MODEL, start, end });
	return [
		"<output>",
		"<compartments>",
		`<compartment start="${String(start)}" end="${String(end)}" title="Pi Stuff Context verification" importance="50" episode_type="feature">`,
		"<p1>Preserved the verified Context session and its project-scoped decisions.</p1>",
		"<p2>Preserved the verified project Context session.</p2>",
		"<p3>Verified Context history was compacted.</p3>",
		"<p4/>",
		"</compartment>",
		"</compartments>",
		"<facts>",
		"<PROJECT_RULES>",
		"* Magic Context completed a real historian pass.",
		"</PROJECT_RULES>",
		"</facts>",
		"<events></events>",
		`<unprocessed_from>${String(end + 1)}</unprocessed_from>`,
		"</output>",
	].join("\n");
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	usage = ZERO_USAGE,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: PROVIDER,
		model: MODEL,
		usage,
		stopReason,
		timestamp: Date.now(),
	};
}

function textStream(text: string, usage = ZERO_USAGE) {
	const stream = createAssistantMessageEventStream();
	const pending = assistantMessage([], "pending", usage);
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
	stream.push({
		type: "done",
		reason: "stop",
		message: assistantMessage([{ type: "text", text }], "stop", usage),
	});
	return stream;
}

function toolCallStream(id: string, name: string, argumentsValue: Readonly<Record<string, unknown>>) {
	const stream = createAssistantMessageEventStream();
	const pending = assistantMessage([], "pending");
	const toolCall = {
		type: "toolCall" as const,
		id,
		name,
		arguments: argumentsValue,
	};
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: assistantMessage([toolCall], "toolUse") });
	return stream;
}

function fixtureStream(context: Context) {
	if (process.env["MAGIC_CONTEXT_PI_SUBAGENT"] === "1") {
		const marker = process.env["PI_STUFF_CONTEXT_PTY_HISTORIAN_MARKER"];
		if (marker) writeFileSync(marker, "ready\n");
		return textStream(historianPayload(lastUserText(context)));
	}
	const text = allText(context);
	const lastUser = lastUserText(context);
	const memoryResult = context.messages.find(
		(entry) => entry.role === "toolResult" && entry.toolName === "ctx_memory",
	);
	const searchResult = context.messages.find(
		(entry) => entry.role === "toolResult" && entry.toolName === "ctx_search",
	);
	const repeatSearchResult = context.messages.find(
		(entry) =>
			entry.role === "toolResult" &&
			entry.toolName === "ctx_search" &&
			(entry as { readonly toolCallId?: unknown }).toolCallId === "context-search-2",
	);
	const bulkResult = context.messages.find(
		(entry) => entry.role === "toolResult" && entry.toolName === "context_bulk",
	);
	record({
		type: "request",
		lastUser,
		hasHistory: text.includes("<session-history>"),
		hasSince: text.includes("<session-history-since>"),
		hasNativeSummary: text.includes("NATIVE_COMPACTION_SUMMARY_MARKER"),
		tools: (context.tools ?? []).map((tool) => tool.name),
		searchResult: searchResult ? contentText(searchResult.content) : undefined,
	});

	if (lastUser.includes("CONTEXT_MEMORY") && !memoryResult) {
		return toolCallStream("context-memory-1", "ctx_memory", {
			action: "write",
			category: "PROJECT_RULES",
			content: "中文检索标记：真实 Context 检索证据",
		});
	}
	if (lastUser.includes("CONTEXT_MEMORY")) return textStream("CONTEXT_MEMORY_DONE");
	if (lastUser.includes("CONTEXT_ISOLATION") && !searchResult) {
		return toolCallStream("context-isolation-1", "ctx_search", { query: "中文检索标记" });
	}
	if (lastUser.includes("CONTEXT_ISOLATION")) return textStream("CONTEXT_ISOLATION_DONE");
	if (lastUser.includes("CONTEXT_SEARCH_AGAIN") && !repeatSearchResult) {
		return toolCallStream("context-search-2", "ctx_search", { query: "中文检索标记" });
	}
	if (lastUser.includes("CONTEXT_SEARCH_AGAIN")) return textStream("CONTEXT_SEARCH_AGAIN_DONE");
	if (lastUser.includes("CONTEXT_SEARCH") && !searchResult) {
		return toolCallStream("context-search-1", "ctx_search", { query: "中文检索标记" });
	}
	if (lastUser.includes("CONTEXT_SEARCH")) return textStream("CONTEXT_SEARCH_DONE");
	if (lastUser.includes("CONTEXT_BULK") && !bulkResult) {
		return toolCallStream("context-bulk-1", "context_bulk", {});
	}
	if (lastUser.includes("CONTEXT_BULK")) return textStream("CONTEXT_BULK_DONE");
	if (lastUser.includes("CONTEXT_AFTER_COMPACT")) return textStream("CONTEXT_AFTER_COMPACT_DONE", HIGH_USAGE);
	if (lastUser.includes("CONTEXT_SETTLE")) return textStream("CONTEXT_SETTLE_DONE", LOW_USAGE);
	if (lastUser.includes("CONTEXT_RESUME")) return textStream("CONTEXT_RESUME_DONE");
	if (lastUser.includes("CONTEXT_DRAIN")) return textStream("CONTEXT_DRAIN_DONE");
	if (lastUser.includes("CONTEXT_NATIVE_RESUME")) return textStream("CONTEXT_NATIVE_RESUME_DONE");
	if (lastUser.includes("CONTEXT_FAIL_OPEN")) return textStream("CONTEXT_FAIL_OPEN_DONE");
	if (lastUser.includes("CONTEXT_SECOND")) return textStream("CONTEXT_SECOND_DONE");
	return textStream("CONTEXT_FIRST_DONE");
}

export default function contextPtyProvider(pi: ExtensionAPI): void {
	registerSuiteOwnedTool(
		pi,
		{
			name: "context_bulk",
			label: "Context fixture",
			description: "Create a large read-only history result for Context compaction verification.",
			parameters: Type.Object({}),
			execute: async () => ({
				content: [{ type: "text" as const, text: BULK_CONTEXT }],
				details: undefined,
			}),
		},
		{ label: "Context fixture", runningSummary: "preparing", summarize: () => "ready" },
	);

	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff Context PTY fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff Context PTY fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => fixtureStream(context),
	});

	pi.on("session_start", (_event, ctx) => {
		record({
			type: "session",
			cwd: ctx.cwd,
			sessionId: ctx.sessionManager.getSessionId(),
		});
	});
	pi.on("before_agent_start", () => {
		record({
			type: "inventory",
			subagent: process.env["MAGIC_CONTEXT_PI_SUBAGENT"] === "1",
			commands: pi.getCommands().map((command) => command.name),
			tools: pi.getAllTools().map((tool) => tool.name),
		});
	});
}
