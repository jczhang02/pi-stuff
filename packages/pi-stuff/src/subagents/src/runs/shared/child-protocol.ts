import { Buffer } from "node:buffer";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { ProtocolOutputLimit } from "../../shared/types.ts";

export type { ProtocolOutputLimit } from "../../shared/types.ts";

export const MAX_CHILD_PENDING_LINE_BYTES = 16 * 1024 * 1024;
export const MAX_CHILD_STDERR_BYTES = 128 * 1024;
const MAX_PROTOCOL_DIAGNOSTIC_BYTES = 4096;

type PiCustomMessage = Extract<AgentMessage, { role: "custom" }>;

export type ChildProtocolMessage = (Message | PiCustomMessage) & {
	model?: string;
	errorMessage?: string;
	stopReason?: string;
	usage?: {
		input?: number;
		inputTokens?: number;
		output?: number;
		outputTokens?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: { total?: number };
	};
};

const CHILD_PROTOCOL_EVENT_TYPES = new Set([
	"session",
	"agent_start",
	"agent_end",
	"agent_settled",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_result_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"entry_appended",
	"session_info_changed",
	"thinking_level_changed",
	"auto_retry_start",
	"auto_retry_end",
	"summarization_retry_scheduled",
	"summarization_retry_attempt_start",
	"summarization_retry_finished",
	"bash_execution_update",
]);

export interface ChildProtocolEvent {
	type: string;
	message?: ChildProtocolMessage;
	toolCallId?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	isError?: boolean;
	willRetry?: unknown;
}

export function childMessageProtocolError(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "message must be an object";
	const message = value as Record<string, unknown>;
	if (
		message.role !== "assistant" &&
		message.role !== "user" &&
		message.role !== "toolResult" &&
		message.role !== "custom"
	) {
		return "message.role is invalid";
	}
	for (const field of ["model", "errorMessage", "stopReason"] as const) {
		if (message[field] !== undefined && typeof message[field] !== "string") {
			return `message.${field} must be a string`;
		}
	}
	if (message.role === "custom") {
		if (typeof message.customType !== "string" || !message.customType.trim()) {
			return "message.customType must be a non-empty string";
		}
		if (typeof message.display !== "boolean") return "message.display must be a boolean";
		if (typeof message.timestamp !== "number" || !Number.isFinite(message.timestamp)) {
			return "message.timestamp must be a finite number";
		}
		if (typeof message.content === "string") return undefined;
		if (!Array.isArray(message.content)) return "message.content for role 'custom' must be a string or array";
	}
	if (message.role === "user" && typeof message.content === "string") return undefined;
	if (!Array.isArray(message.content)) return `message.content for role '${message.role}' must be an array`;
	for (const part of message.content) {
		if (!part || typeof part !== "object" || Array.isArray(part)) return "message.content contains a non-object part";
		const content = part as Record<string, unknown>;
		if (typeof content.type !== "string") return "message.content part type must be a string";
		if (content.type === "text" && typeof content.text !== "string") {
			return "message.content text must be a string";
		}
		if (content.type === "thinking" && typeof content.thinking !== "string") {
			return "message.content thinking must be a string";
		}
		if (content.type === "image" && (typeof content.data !== "string" || typeof content.mimeType !== "string")) {
			return "message.content image fields must be strings";
		}
		if (
			content.type === "toolCall" &&
			(typeof content.id !== "string" ||
				typeof content.name !== "string" ||
				!content.arguments ||
				typeof content.arguments !== "object" ||
				Array.isArray(content.arguments))
		) {
			return "message.content toolCall fields are invalid";
		}
		const allowedTypes =
			message.role === "assistant"
				? ["text", "thinking", "toolCall"]
				: message.role === "user" || message.role === "toolResult" || message.role === "custom"
					? ["text", "image"]
					: [];
		if (!allowedTypes.includes(content.type)) {
			return `message.content type '${content.type}' is invalid for role '${message.role}'`;
		}
	}
	return undefined;
}

export function parseChildProtocolEvent(value: unknown): { event?: ChildProtocolEvent; error?: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { error: "event must be an object" };
	}
	const event = value as Record<string, unknown>;
	if (typeof event.type !== "string" || !event.type.trim()) {
		return { error: "event.type must be a non-empty string" };
	}
	if (!CHILD_PROTOCOL_EVENT_TYPES.has(event.type)) {
		return { error: `event.type '${event.type}' is unsupported` };
	}
	if (event.type === "message_end" || event.type === "tool_result_end") {
		const error = childMessageProtocolError(event.message);
		if (error) return { error: `${event.type} ${error}` };
	}
	return { event: { ...event, type: event.type } };
}

export function formatProtocolOutputLimit(limit: ProtocolOutputLimit): string {
	if (limit.scope === "aggregate") {
		return `${limit.code}: child ${limit.stream} exceeded the ${limit.limitBytes}-byte aggregate protocol limit (observed at least ${limit.observedBytes} bytes).`;
	}
	return `${limit.code}: child ${limit.stream} line exceeded ${limit.limitBytes} bytes (observed at least ${limit.observedBytes} bytes without a newline).`;
}

export function createBoundedLineReader(options: {
	stream?: "stdout" | "stderr";
	maxPendingLineBytes?: number;
	onLine: (line: string) => void;
	onLimit: (limit: ProtocolOutputLimit) => void;
}): {
	push(chunk: Buffer | string): void;
	end(): void;
	exceeded(): boolean;
} {
	const maxPendingLineBytes = options.maxPendingLineBytes ?? MAX_CHILD_PENDING_LINE_BYTES;
	if (!Number.isInteger(maxPendingLineBytes) || maxPendingLineBytes < 1) {
		throw new Error("maxPendingLineBytes must be a positive integer.");
	}
	let pending: Buffer[] = [];
	let pendingBytes = 0;
	let limitExceeded = false;

	const emitPending = (): void => {
		if (pendingBytes === 0) return;
		options.onLine(Buffer.concat(pending, pendingBytes).toString("utf8"));
		pending = [];
		pendingBytes = 0;
	};

	const append = (segment: Buffer): boolean => {
		if (segment.length === 0) return true;
		const observedBytes = pendingBytes + segment.length;
		if (observedBytes > maxPendingLineBytes) {
			const prior = pendingBytes > 0 ? Buffer.concat(pending, pendingBytes) : Buffer.alloc(0);
			const prefixFromPrior = prior.subarray(0, MAX_PROTOCOL_DIAGNOSTIC_BYTES);
			const prefix =
				prefixFromPrior.length === MAX_PROTOCOL_DIAGNOSTIC_BYTES
					? prefixFromPrior
					: Buffer.concat([
							prefixFromPrior,
							segment.subarray(0, MAX_PROTOCOL_DIAGNOSTIC_BYTES - prefixFromPrior.length),
						]);
			const tailFromSegment = segment.subarray(Math.max(0, segment.length - MAX_PROTOCOL_DIAGNOSTIC_BYTES));
			const tail =
				tailFromSegment.length === MAX_PROTOCOL_DIAGNOSTIC_BYTES
					? tailFromSegment
					: Buffer.concat([
							prior.subarray(
								Math.max(0, prior.length - (MAX_PROTOCOL_DIAGNOSTIC_BYTES - tailFromSegment.length)),
							),
							tailFromSegment,
						]);
			limitExceeded = true;
			pending = [];
			pendingBytes = 0;
			options.onLimit({
				code: "protocol_output_limit",
				stream: options.stream ?? "stdout",
				scope: "line",
				limitBytes: maxPendingLineBytes,
				observedBytes,
				diagnosticPrefix: prefix.toString("utf8"),
				diagnosticTail: tail.toString("utf8"),
			});
			return false;
		}
		pending.push(segment);
		pendingBytes = observedBytes;
		return true;
	};

	return {
		push(chunk) {
			if (limitExceeded) return;
			const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			let start = 0;
			for (let index = 0; index < bytes.length; index++) {
				if (bytes[index] !== 0x0a) continue;
				if (!append(bytes.subarray(start, index))) return;
				emitPending();
				start = index + 1;
			}
			append(bytes.subarray(start));
		},
		end() {
			if (!limitExceeded) emitPending();
		},
		exceeded: () => limitExceeded,
	};
}

function trimToUtf8Boundary(buffer: Buffer, maxBytes: number): Buffer {
	if (buffer.length <= maxBytes) return buffer;
	let start = buffer.length - maxBytes;
	while (start < buffer.length) {
		const byte = buffer[start];
		if (byte === undefined || (byte & 0xc0) !== 0x80) break;
		start++;
	}
	return buffer.subarray(start);
}

export function createBoundedByteTail(maxBytes = MAX_CHILD_STDERR_BYTES): {
	push(chunk: Buffer | string): void;
	text(): string;
	byteLength(): number;
} {
	if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer.");
	let tail: Buffer = Buffer.alloc(0);
	return {
		push(chunk) {
			const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			tail = trimToUtf8Boundary(Buffer.concat([tail, bytes]), maxBytes);
		},
		text: () => tail.toString("utf8"),
		byteLength: () => tail.length,
	};
}

export type ChildLifecycleAction = "start-drain" | "cancel-drain" | "none";

export function projectChildLifecycle(
	event: { type?: string; willRetry?: unknown },
	terminalAssistantStop = false,
): ChildLifecycleAction {
	if (event.type === "agent_end" && event.willRetry === true) return "cancel-drain";
	if (event.type === "agent_settled") return "start-drain";
	if (terminalAssistantStop) return "start-drain";
	if (event.type === "agent_start" || event.type === "message_start" || event.type === "message_end") {
		return "cancel-drain";
	}
	return "none";
}
