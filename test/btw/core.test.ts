import { describe, expect, test } from "bun:test";
import type { Api, AssistantMessage, Message, Model, UserMessage } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { type ExtensionContext, estimateTokens, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { executeBtw, type OpenBtwStream, readEffectiveContext } from "../../packages/pi-stuff-btw/btw.js";
import { fitBranch } from "../../packages/pi-stuff-btw/btw-budget.js";

const MODEL: Model<Api> = {
	id: "fixture-model",
	name: "Fixture model",
	api: "openai-completions",
	provider: "fixture",
	baseUrl: "http://127.0.0.1.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 4_096,
};

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
	text: string,
	stopReason: AssistantMessage["stopReason"] = "stop",
	errorMessage?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: text.length === 0 ? [] : [{ type: "text", text }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: ZERO_USAGE,
		stopReason,
		...(errorMessage === undefined ? {} : { errorMessage }),
		timestamp: Date.now(),
	};
}

function user(text: string): UserMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function messageEntry(id: string, message: Message, parentId: string | null = null): SessionEntry {
	return { type: "message", id, parentId, timestamp: new Date().toISOString(), message };
}

function extensionContext(
	buildContextEntries: () => SessionEntry[],
	mainSignal: AbortSignal = new AbortController().signal,
): ExtensionContext {
	return {
		model: MODEL,
		thinkingLevel: "high",
		signal: mainSignal,
		sessionManager: {
			buildContextEntries,
			getSessionId: () => "session-a",
			getBranch: () => {
				throw new Error("getBranch must not be used");
			},
		},
	} as unknown as ExtensionContext;
}

function completedStream(deltas: readonly string[], final: AssistantMessage) {
	const stream = createAssistantMessageEventStream();
	const pending = assistant("", "pending");
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	for (const delta of deltas) {
		stream.push({ type: "text_delta", contentIndex: 0, delta, partial: pending });
	}
	stream.push({ type: "text_end", contentIndex: 0, content: deltas.join(""), partial: pending });
	if (final.stopReason === "error" || final.stopReason === "aborted") {
		stream.push({ type: "error", reason: final.stopReason, error: final });
	} else {
		if (final.stopReason === "pending") throw new Error("pending is not a terminal stream result");
		stream.push({ type: "done", reason: final.stopReason, message: final });
	}
	return stream;
}

describe("BTW effective context", () => {
	test("uses Pi's compaction-aware context and removes a trailing pending assistant", () => {
		const entries: SessionEntry[] = [
			{
				type: "branch_summary",
				id: "summary",
				parentId: null,
				timestamp: new Date().toISOString(),
				fromId: "old",
				summary: "effective compacted summary",
			},
			{
				type: "custom_message",
				id: "custom",
				parentId: "summary",
				timestamp: new Date().toISOString(),
				customType: "fixture",
				content: "effective custom context",
				display: false,
			},
			messageEntry(
				"image",
				{
					role: "user",
					content: [
						{ type: "text", text: "look at this" },
						{ type: "image", data: "sensitive-base64", mimeType: "image/png" },
					],
					timestamp: Date.now(),
				},
				"custom",
			),
			messageEntry("pending", assistant("unfinished", "pending"), "image"),
		];
		const result = readEffectiveContext(extensionContext(() => entries));
		const serialized = JSON.stringify(result.messages);

		expect(serialized).toContain("effective compacted summary");
		expect(serialized).toContain("effective custom context");
		expect(serialized).toContain("Image omitted from /btw context.");
		expect(serialized).not.toContain("sensitive-base64");
		expect(serialized).not.toContain("unfinished");
	});
});

describe("BTW context budget", () => {
	test("bounds structured thinking and tool arguments when one recent turn is oversized", () => {
		const oversized = {
			...assistant(""),
			content: [
				{ type: "thinking" as const, thinking: "reasoning".repeat(2_000) },
				{
					type: "toolCall" as const,
					id: "tool-1",
					name: "write",
					arguments: { content: "payload".repeat(4_000), path: "/tmp/fixture" },
				},
			],
		};
		const mainRequest = user("main request");
		const messages: Message[] = [mainRequest, oversized];
		const result = fitBranch({
			entries: [messageEntry("user", mainRequest), messageEntry("assistant", oversized, "user")],
			messages,
			model: MODEL,
			systemPrompt: "side system",
			question: user("side question"),
			keepBudget: 100,
		});

		expect(result.messages.reduce((total, message) => total + estimateTokens(message), 0)).toBeLessThanOrEqual(100);
		expect(JSON.stringify(result.messages)).not.toContain("payloadpayloadpayload");
		expect(result.stubbed).toBe(true);
	});
});

describe("BTW stream execution", () => {
	test("streams text through the composed transport with no tools and an independent signal", async () => {
		const mainController = new AbortController();
		const sideController = new AbortController();
		const ctx = extensionContext(() => [messageEntry("main", user("main conversation"))], mainController.signal);
		const deltas: string[] = [];
		let captured: Parameters<OpenBtwStream>[0] | undefined;
		const openStream: OpenBtwStream = async (request) => {
			captured = request;
			return completedStream(["side ", "answer"], assistant("side answer"));
		};

		const result = await executeBtw(
			"isolated question",
			ctx,
			sideController.signal,
			{ onTextDelta: (delta) => deltas.push(delta) },
			openStream,
		);

		expect(result.kind).toBe("success");
		expect(deltas).toEqual(["side ", "answer"]);
		expect(captured?.signal).toBe(sideController.signal);
		expect(captured?.signal).not.toBe(mainController.signal);
		expect(captured?.context.tools).toEqual([]);
		const requestText = JSON.stringify(captured?.context.messages);
		expect(requestText).toContain("main conversation");
		expect(requestText).toContain("isolated question");
	});

	test("retries overflow once, resets partial output, and never re-reads a changed main branch", async () => {
		let contextReads = 0;
		const ctx = extensionContext(() => {
			contextReads++;
			return [messageEntry("main", user(contextReads === 1 ? "frozen context" : "leaked later context"))];
		});
		let calls = 0;
		const events: string[] = [];
		const requests: Parameters<OpenBtwStream>[0][] = [];
		const openStream: OpenBtwStream = async (request) => {
			requests.push(request);
			calls++;
			return calls === 1
				? completedStream(["discard me"], assistant("", "error", "prompt is too long"))
				: completedStream(["kept"], assistant("kept"));
		};

		const result = await executeBtw(
			"question",
			ctx,
			new AbortController().signal,
			{
				onTextDelta: (delta) => events.push(delta),
				onRetry: () => events.push("RESET"),
			},
			openStream,
		);

		expect(result.kind).toBe("success");
		expect(calls).toBe(2);
		expect(contextReads).toBe(1);
		expect(events).toEqual(["discard me", "RESET", "kept"]);
		expect(JSON.stringify(requests[1]?.context.messages)).toContain("frozen context");
		expect(JSON.stringify(requests[1]?.context.messages)).not.toContain("leaked later context");
	});

	test("keeps failed partial output ephemeral and rejects a model tool attempt", async () => {
		const stream = createAssistantMessageEventStream();
		const pending = assistant("", "pending");
		stream.push({ type: "start", partial: pending });
		stream.push({ type: "text_start", contentIndex: 0, partial: pending });
		stream.push({ type: "text_delta", contentIndex: 0, delta: "partial", partial: pending });
		stream.push({
			type: "toolcall_start",
			contentIndex: 1,
			partial: pending,
		});
		stream.push({
			type: "toolcall_end",
			contentIndex: 1,
			toolCall: { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
			partial: pending,
		});
		stream.push({ type: "done", reason: "toolUse", message: assistant("partial", "toolUse") });
		const result = await executeBtw(
			"question",
			extensionContext(() => []),
			new AbortController().signal,
			{},
			async () => stream,
		);

		expect(result).toMatchObject({ kind: "error", partial: "partial" });
		if (result.kind === "error") expect(result.error).toContain("tools are disabled");
	});

	test("an aborted side signal does not touch the main signal", async () => {
		const mainController = new AbortController();
		const sideController = new AbortController();
		const result = await executeBtw(
			"question",
			extensionContext(() => [], mainController.signal),
			sideController.signal,
			{},
			async () => {
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => {
					sideController.abort();
					stream.push({ type: "error", reason: "aborted", error: assistant("", "aborted") });
				});
				return stream;
			},
		);

		expect(result.kind).toBe("aborted");
		expect(mainController.signal.aborted).toBe(false);
	});

	test("projects a provider-originated abort as an in-surface error", async () => {
		const result = await executeBtw(
			"question",
			extensionContext(() => []),
			new AbortController().signal,
			{},
			async () => completedStream(["partial"], assistant("partial", "aborted")),
		);

		expect(result).toMatchObject({ kind: "error", partial: "partial", stopReason: "aborted" });
		if (result.kind === "error") expect(result.error).toContain("model provider");
	});
});
