/** Local Anthropic Messages fixture for black-box Claude Code 2.1.197 UI capture. */

import { appendFile, writeFile } from "node:fs/promises";

interface MessageBlock {
	type?: string;
	text?: string;
}

interface Message {
	content?: MessageBlock[] | string;
}

interface MessagesRequest {
	messages?: Message[];
	model?: string;
}

const readyFile = process.argv[2];
const eventLog = process.argv[3];
const childDelayMilliseconds = Number(process.argv[4] ?? "12000");

if (!readyFile || !eventLog || !Number.isFinite(childDelayMilliseconds) || childDelayMilliseconds < 1_000) {
	throw new Error("Usage: bun claude-2.1.197-agent-activity-mock.ts <ready-file> <event-log> [child-delay-ms]");
}

let identifier = 0;

function nextIdentifier(prefix: string): string {
	identifier += 1;
	return `${prefix}_pi_stuff_${identifier.toString().padStart(4, "0")}`;
}

function extractText(messages: Message[]): string {
	return messages
		.flatMap((message) => {
			if (typeof message.content === "string") return [message.content];
			return (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "");
		})
		.join("\n");
}

function hasToolResults(messages: Message[]): boolean {
	return messages.some(
		(message) => Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result"),
	);
}

function event(name: string, payload: unknown): string {
	return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function messageStart(request: MessagesRequest): string {
	return event("message_start", {
		type: "message_start",
		message: {
			id: nextIdentifier("msg"),
			type: "message",
			role: "assistant",
			model: request.model ?? "claude-sonnet-4-5-20250929",
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: 120,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				output_tokens: 1,
			},
		},
	});
}

function messageEnd(stopReason: "end_turn" | "tool_use", outputTokens: number): string {
	return (
		event("message_delta", {
			type: "message_delta",
			delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { output_tokens: outputTokens },
		}) + event("message_stop", { type: "message_stop" })
	);
}

function sse(body: string): Response {
	return new Response(body, {
		headers: {
			"cache-control": "no-cache",
			connection: "close",
			"content-type": "text/event-stream",
		},
	});
}

function textResponse(request: MessagesRequest, text: string): Response {
	const body =
		messageStart(request) +
		event("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		}) +
		event("content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		}) +
		event("content_block_stop", { type: "content_block_stop", index: 0 }) +
		messageEnd("end_turn", Math.max(8, Math.ceil(text.length / 4)));
	return sse(body);
}

function parallelAgentResponse(request: MessagesRequest): Response {
	const calls = [
		{
			description: "Inspect Claude activity UI",
			prompt: "Inspect Claude activity states. Return one short observation and use no tools.",
			subagent_type: "explorer",
			run_in_background: false,
		},
		{
			description: "Inspect tintin activity UI",
			prompt: "Inspect tintin activity states. Return one short observation and use no tools.",
			subagent_type: "reviewer",
			run_in_background: false,
		},
	];

	let body = messageStart(request);
	for (const [index, call] of calls.entries()) {
		body += event("content_block_start", {
			type: "content_block_start",
			index,
			content_block: {
				type: "tool_use",
				id: nextIdentifier("toolu"),
				name: "Agent",
				input: {},
			},
		});
		body += event("content_block_delta", {
			type: "content_block_delta",
			index,
			delta: { type: "input_json_delta", partial_json: JSON.stringify(call) },
		});
		body += event("content_block_stop", { type: "content_block_stop", index });
	}
	body += messageEnd("tool_use", 76);
	return sse(body);
}

async function record(kind: string): Promise<void> {
	await appendFile(eventLog, `${JSON.stringify({ kind, timestamp: Date.now() })}\n`);
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method !== "POST") return new Response("Not found", { status: 404 });
		if (url.pathname === "/v1/messages/count_tokens") {
			return Response.json({ input_tokens: 120 });
		}
		if (url.pathname !== "/v1/messages") return new Response("Not found", { status: 404 });

		const payload = (await request.json()) as MessagesRequest;
		const messages = payload.messages ?? [];
		const text = extractText(messages);

		if (text.includes("Inspect Claude activity states") && !hasToolResults(messages)) {
			await record("explorer-child");
			await Bun.sleep(childDelayMilliseconds);
			return textResponse(payload, "Claude activity UI: grouped foreground agent line observed.");
		}
		if (text.includes("Inspect tintin activity states") && !hasToolResults(messages)) {
			await record("reviewer-child");
			await Bun.sleep(childDelayMilliseconds);
			return textResponse(payload, "Tintin activity UI: persistent above-editor widget observed.");
		}
		if (hasToolResults(messages)) {
			await record("parent-continuation");
			return textResponse(payload, "Both UI investigations are complete.");
		}
		if (text.includes("Write the title") || text.includes("<session>")) {
			await record("session-title");
			return textResponse(payload, "Agent activity reference");
		}

		await record("parent");
		return parallelAgentResponse(payload);
	},
});

await writeFile(readyFile, `${server.port}\n`);
