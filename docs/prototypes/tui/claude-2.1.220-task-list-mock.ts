/**
 * Local Anthropic Messages fixture for black-box Claude Code 2.1.220 task-list capture.
 *
 * The released binary owns every rendered cell. This server supplies only synthetic
 * TaskCreate/TaskUpdate model responses and never contacts an external model API.
 */

import { appendFile, writeFile } from "node:fs/promises";

interface MessageBlock {
	type?: string;
	text?: string;
	name?: string;
	content?: unknown;
}

interface Message {
	content?: MessageBlock[] | string;
}

interface MessagesRequest {
	messages?: Message[];
	model?: string;
	tools?: Array<{ name?: string }>;
}

interface ToolCall {
	name: "TaskCreate" | "TaskUpdate";
	input: Record<string, unknown>;
}

const readyFile = process.argv[2];
const eventLog = process.argv[3];
const phaseDelayMilliseconds = Number(process.argv[4] ?? "12000");

if (!readyFile || !eventLog || !Number.isFinite(phaseDelayMilliseconds) || phaseDelayMilliseconds < 5_000) {
	throw new Error("Usage: bun claude-2.1.220-task-list-mock.ts <ready-file> <event-log> [phase-delay-ms]");
}

let identifier = 0;

function nextIdentifier(prefix: string): string {
	identifier += 1;
	return `${prefix}_pi_stuff_task_list_${identifier.toString().padStart(4, "0")}`;
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
		messageEnd("end_turn", Math.max(8, Math.ceil(responseText.length / 4)));
	return sse(body);
}

function toolResponse(request: MessagesRequest, calls: ToolCall[]): Response {
	let body = messageStart(request);
	for (const [index, call] of calls.entries()) {
		body += event("content_block_start", {
			type: "content_block_start",
			index,
			content_block: {
				type: "tool_use",
				id: nextIdentifier("toolu"),
				name: call.name,
				input: {},
			},
		});
		body += event("content_block_delta", {
			type: "content_block_delta",
			index,
			delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) },
		});
		body += event("content_block_stop", { type: "content_block_stop", index });
	}
	body += messageEnd("tool_use", 40 + calls.length * 8);
	return sse(body);
}

function messageBlocks(messages: Message[]): MessageBlock[] {
	return messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
}

function extractText(messages: Message[]): string {
	return messages
		.flatMap((message) => {
			if (typeof message.content === "string") return [message.content];
			return (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "");
		})
		.join("\n");
}

function toolCount(messages: Message[], name: string): number {
	return messageBlocks(messages).filter((block) => block.type === "tool_use" && block.name === name).length;
}

function taskIdentifiers(messages: Message[]): string[] {
	const identifiers: string[] = [];
	for (const block of messageBlocks(messages)) {
		if (block.type !== "tool_result") continue;
		const serialized = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
		for (const match of serialized.matchAll(/"id"\s*:\s*"([^"\\]+)"/g)) {
			identifiers.push(match[1]);
		}
		for (const match of serialized.matchAll(/Task\s+#?(\d+)/gi)) {
			identifiers.push(match[1]);
		}
	}
	return [...new Set(identifiers)];
}

async function record(kind: string, payload: unknown = {}): Promise<void> {
	await appendFile(eventLog, `${JSON.stringify({ kind, payload, timestamp: Date.now() })}\n`);
}

const tasks = [
	"Inspect task list placement",
	"Compare visible row density",
	"Verify completed item treatment",
	"Check narrow terminal behavior",
	"Confirm keyboard toggle",
	"Document full-list access",
	"Summarize the UI decision",
];

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
		const messages = request.messages ?? [];
		const requestText = extractText(messages);
		const createCount = toolCount(messages, "TaskCreate");
		const updateCount = toolCount(messages, "TaskUpdate");
		const taskIds = taskIdentifiers(messages);
		const availableTools = (request.tools ?? []).map((tool) => tool.name);
		await record("request", { createCount, updateCount, taskIds, availableTools });

		if (requestText.includes("Write the title") || requestText.includes("<session>")) {
			return textResponse(request, "Task list UI reference");
		}

		if (createCount === 0) {
			await record("create-seven");
			return toolResponse(
				request,
				tasks.map((subject) => ({
					name: "TaskCreate",
					input: { subject, description: `${subject}.`, activeForm: `${subject}…` },
				})),
			);
		}

		if (taskIds.length < tasks.length) {
			await record("missing-task-identifiers", { taskIds });
			return textResponse(request, `Fixture could not recover task IDs: ${taskIds.join(", ")}`);
		}

		if (updateCount === 0) {
			await record("first-running", { taskId: taskIds[0] });
			return toolResponse(request, [{ name: "TaskUpdate", input: { taskId: taskIds[0], status: "in_progress" } }]);
		}

		if (updateCount === 1) {
			await record("hold-running");
			await Bun.sleep(phaseDelayMilliseconds);
			await record("mixed-update");
			return toolResponse(request, [
				{ name: "TaskUpdate", input: { taskId: taskIds[0], status: "completed" } },
				{ name: "TaskUpdate", input: { taskId: taskIds[1], status: "in_progress" } },
			]);
		}

		if (updateCount === 3) {
			await record("hold-mixed");
			await Bun.sleep(phaseDelayMilliseconds);
			await record("complete-all");
			return toolResponse(
				request,
				taskIds.slice(1).map((taskId) => ({
					name: "TaskUpdate",
					input: { taskId, status: "completed" },
				})),
			);
		}

		await record("hold-complete");
		await Bun.sleep(phaseDelayMilliseconds);
		return textResponse(request, "Task-list probe complete.");
	},
});

await writeFile(readyFile, `${server.port}\n`);
