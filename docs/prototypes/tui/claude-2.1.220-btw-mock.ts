/**
 * Local Anthropic Messages fixture for black-box Claude Code 2.1.220 BTW capture.
 *
 * The released binary owns command handling, concurrency, focus, history, keys,
 * lifecycle, and every rendered cell. This localhost server supplies only
 * deterministic synthetic response content and never contacts an external model.
 */

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
	stream?: boolean;
	tools?: Array<{ name?: string }>;
}

const readyFile = process.argv[2];
const eventLog = process.argv[3];
const mainDelayMilliseconds = Number(process.argv[4] ?? "120000");
const sideDelayMilliseconds = Number(process.argv[5] ?? "2500");

if (
	!readyFile ||
	!eventLog ||
	!Number.isFinite(mainDelayMilliseconds) ||
	mainDelayMilliseconds < 30_000 ||
	!Number.isFinite(sideDelayMilliseconds) ||
	sideDelayMilliseconds < 1_000
) {
	throw new Error("Usage: bun claude-2.1.220-btw-mock.ts <ready-file> <event-log> [main-delay-ms] [side-delay-ms]");
}

let identifier = 0;

function nextIdentifier(prefix: string): string {
	identifier += 1;
	return `${prefix}_pi_stuff_btw_${identifier.toString().padStart(4, "0")}`;
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

function messageEnd(outputTokens: number): string {
	return (
		event("message_delta", {
			type: "message_delta",
			delta: { stop_reason: "end_turn", stop_sequence: null },
			usage: { output_tokens: outputTokens },
		}) + event("message_stop", { type: "message_stop" })
	);
}

function textResponse(request: MessagesRequest, responseText: string): Response {
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
			delta: { type: "text_delta", text: responseText },
		}) +
		event("content_block_stop", { type: "content_block_stop", index: 0 }) +
		messageEnd(Math.max(8, Math.ceil(responseText.length / 4)));

	return new Response(body, {
		headers: {
			"cache-control": "no-cache",
			connection: "close",
			"content-type": "text/event-stream",
		},
	});
}

function extractText(messages: Message[]): string {
	return messages
		.flatMap((message) => {
			if (typeof message.content === "string") return [message.content];
			return (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "");
		})
		.join("\n");
}

async function record(kind: string, payload: unknown = {}): Promise<void> {
	await appendFile(eventLog, `${JSON.stringify({ kind, payload, timestamp: Date.now() })}\n`);
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(incomingRequest) {
		const url = new URL(incomingRequest.url);
		if (incomingRequest.method !== "POST") return new Response("Not found", { status: 404 });
		if (url.pathname === "/v1/messages/count_tokens") {
			return Response.json({ input_tokens: 120 });
		}
		if (url.pathname !== "/v1/messages") return new Response("Not found", { status: 404 });

		const request = (await incomingRequest.json()) as MessagesRequest;
		const requestText = extractText(request.messages ?? []);
		const requestToolSchemas = (request.tools ?? []).map((tool) => tool.name);
		const requestFacts = { stream: request.stream, requestToolSchemas };

		if (requestText.includes("SIDE_CAPTURE_TWO")) {
			await record("side-two-request", requestFacts);
			await Bun.sleep(sideDelayMilliseconds);
			await record("side-two-response");
			return textResponse(request, "Named file: runtime.ts.");
		}

		if (requestText.includes("SIDE_CAPTURE_ONE")) {
			await record("side-one-request", requestFacts);
			await Bun.sleep(sideDelayMilliseconds);
			await record("side-one-response");
			return textResponse(
				request,
				"The file already named in the main conversation is src/config/runtime.ts.\n\nNo tool lookup was used.",
			);
		}

		if (requestText.includes("MAIN_CAPTURE_MARKER")) {
			await record("main-request", requestFacts);
			await Bun.sleep(mainDelayMilliseconds);
			await record("main-response");
			return textResponse(request, "The primary task has now finished.");
		}

		await record("unexpected-request", requestFacts);
		return textResponse(request, "The local BTW fixture received an unexpected request.");
	},
});

await writeFile(readyFile, `${server.port}\n`);
