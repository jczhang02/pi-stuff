import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import { withArtifactGroupWriteClaim } from "./artifacts.ts";
import { extractTextFromContent, extractToolArgsPreview } from "./utils.ts";

const MAX_TOOL_PAYLOAD_BYTES = 32 * 1024;
const TOOL_PAYLOAD_TRUNCATION_MARKER = "\n\n… payload truncated";

function boundedPayload(value: unknown, maxBytes = MAX_TOOL_PAYLOAD_BYTES): string | undefined {
	let text: string;
	if (isRuntimeString(value)) text = value;
	else {
		try {
			const serialized = JSON.stringify(value, null, 2);
			if (serialized === undefined) return undefined;
			text = serialized;
		} catch {
			return undefined;
		}
	}
	if (!text.trim()) return undefined;
	const payload = Buffer.from(text, "utf-8");
	if (payload.length <= maxBytes) return text;
	const markerBytes = Buffer.byteLength(TOOL_PAYLOAD_TRUNCATION_MARKER, "utf-8");
	let end = Math.max(0, maxBytes - markerBytes);
	while (end > 0) {
		const byte = payload[end];
		if (byte === undefined || (byte & 0xc0) !== 0x80) break;
		end--;
	}
	return `${payload.subarray(0, end).toString("utf-8")}${TOOL_PAYLOAD_TRUNCATION_MARKER}`;
}

export const CHILD_TRANSCRIPT_ARTIFACT_VERSION = 1;
const DEFAULT_MAX_CHILD_TRANSCRIPT_BYTES = 50 * 1024 * 1024;

type ChildTranscriptSource = "foreground" | "async";
type ChildTranscriptRecordType = "message" | "tool_start" | "tool_end" | "stdout" | "stderr" | "truncated";

type PiCustomMessage = Extract<AgentMessage, { role: "custom" }>;

type ChildTranscriptMessage = (Message | PiCustomMessage) & {
	model?: string;
	errorMessage?: string;
	stopReason?: string;
	usage?: unknown;
};

interface ChildTranscriptEvent {
	type?: string;
	message?: ChildTranscriptMessage;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	isError?: boolean;
}

interface ChildTranscriptWriterInput {
	transcriptPath: string;
	source: ChildTranscriptSource;
	runId: string;
	agent: string;
	childIndex?: number;
	cwd: string;
	maxBytes?: number;
	artifactManaged?: boolean;
}

export interface ChildTranscriptWriter {
	path: string;
	writeInitialUserMessage(prompt: string): void;
	writeChildEvent(event: ChildTranscriptEvent): void;
	writeStdoutLine(line: string): void;
	writeStderrLine(line: string): void;
	writeStderrText(text: string): void;
	getError(): string | undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function finiteNumber(value: unknown): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(
	value: unknown,
): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } | undefined {
	if (!value || !isRuntimeObject(value)) return undefined;
	const raw = value as Record<string, unknown>;
	const rawCost = raw.cost;
	const cost =
		rawCost && isRuntimeObject(rawCost)
			? (finiteNumber((rawCost as { total?: unknown }).total) ?? 0)
			: (finiteNumber(rawCost) ?? 0);
	return {
		input: finiteNumber(raw.input) ?? finiteNumber(raw.inputTokens) ?? 0,
		output: finiteNumber(raw.output) ?? finiteNumber(raw.outputTokens) ?? 0,
		cacheRead: finiteNumber(raw.cacheRead) ?? 0,
		cacheWrite: finiteNumber(raw.cacheWrite) ?? 0,
		cost,
	};
}

function eventArgs(event: ChildTranscriptEvent): Record<string, unknown> {
	return event.args && isRuntimeObject(event.args) && !Array.isArray(event.args)
		? (event.args as Record<string, unknown>)
		: {};
}

export function createChildTranscriptWriter(input: ChildTranscriptWriterInput): ChildTranscriptWriter {
	let bytesWritten = 0;
	let writeError: string | undefined;
	let truncated = false;
	const maxBytes = input.maxBytes ?? DEFAULT_MAX_CHILD_TRANSCRIPT_BYTES;
	const writeFile = (operation: () => void): void => {
		if (input.artifactManaged) withArtifactGroupWriteClaim(input.transcriptPath, operation);
		else operation();
	};

	const baseRecord = (recordType: ChildTranscriptRecordType) => {
		const ts = Date.now();
		return {
			version: CHILD_TRANSCRIPT_ARTIFACT_VERSION,
			recordType,
			source: input.source,
			runId: input.runId,
			agent: input.agent,
			...(input.childIndex !== undefined ? { childIndex: input.childIndex } : {}),
			cwd: input.cwd,
			ts,
			timestamp: new Date(ts).toISOString(),
		};
	};

	const writeTruncatedMarker = () => {
		truncated = true;
		const marker = `${JSON.stringify({
			...baseRecord("truncated"),
			maxBytes,
			message: `Child transcript exceeded ${maxBytes} bytes; further records were omitted.`,
		})}\n`;
		const markerBytes = Buffer.byteLength(marker, "utf-8");
		if (bytesWritten + markerBytes > maxBytes) return false;
		try {
			writeFile(() => fs.appendFileSync(input.transcriptPath, marker, "utf-8"));
			bytesWritten += markerBytes;
			return true;
		} catch (error) {
			writeError = `Failed to write child transcript '${input.transcriptPath}': ${errorMessage(error)}`;
			return false;
		}
	};

	const writeRecord = (record: Record<string, unknown>) => {
		if (writeError || truncated) return;
		const line = `${JSON.stringify(record)}\n`;
		const bytes = Buffer.byteLength(line, "utf-8");
		if (bytesWritten + bytes > maxBytes) {
			writeTruncatedMarker();
			return;
		}
		const markerProbe = `${JSON.stringify({
			...baseRecord("truncated"),
			maxBytes,
			message: `Child transcript exceeded ${maxBytes} bytes; further records were omitted.`,
		})}\n`;
		if (bytesWritten + bytes + Buffer.byteLength(markerProbe, "utf-8") > maxBytes) {
			writeTruncatedMarker();
			return;
		}
		try {
			writeFile(() => fs.appendFileSync(input.transcriptPath, line, "utf-8"));
			bytesWritten += bytes;
		} catch (error) {
			writeError = `Failed to write child transcript '${input.transcriptPath}': ${errorMessage(error)}`;
		}
	};

	try {
		fs.mkdirSync(path.dirname(input.transcriptPath), { recursive: true });
		writeFile(() => fs.writeFileSync(input.transcriptPath, "", "utf-8"));
	} catch (error) {
		writeError = `Failed to initialize child transcript '${input.transcriptPath}': ${errorMessage(error)}`;
	}

	const writeMessage = (sourceEventType: string, message: ChildTranscriptMessage) => {
		const text = extractTextFromContent(message.content);
		if (message.role === "toolResult") {
			const output = boundedPayload(text);
			writeRecord({
				...baseRecord("message"),
				sourceEventType,
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				isError: message.isError,
				...(output ? { text: output, outputTruncated: output.includes("… payload truncated") } : {}),
				message: {
					role: message.role,
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					isError: message.isError,
					content: output ? [{ type: "text", text: output }] : [],
					...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
				},
			});
			return;
		}
		writeRecord({
			...baseRecord("message"),
			sourceEventType,
			role: message.role,
			...(message.role === "custom" ? { customType: message.customType, display: message.display } : {}),
			...(text ? { text } : {}),
			...(message.model ? { model: message.model } : {}),
			...(message.stopReason ? { stopReason: message.stopReason } : {}),
			...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
			...(message.usage ? { usage: normalizeUsage(message.usage) } : {}),
			message,
		});
	};

	return {
		path: input.transcriptPath,
		writeInitialUserMessage(prompt: string) {
			writeRecord({
				...baseRecord("message"),
				sourceEventType: "initial_prompt",
				role: "user",
				text: prompt,
				message: { role: "user", content: [{ type: "text", text: prompt }] },
			});
		},
		writeChildEvent(event: ChildTranscriptEvent) {
			if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) {
				writeMessage(event.type, event.message);
				return;
			}
			if (event.type === "tool_execution_start" && event.toolName) {
				const args = eventArgs(event);
				const argsPayload = boundedPayload(args);
				writeRecord({
					...baseRecord("tool_start"),
					sourceEventType: event.type,
					...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
					toolName: event.toolName,
					...(Object.keys(args).length > 0 ? { argsPreview: extractToolArgsPreview(args) } : {}),
					...(argsPayload ? { argsPayload } : {}),
				});
				return;
			}
			if (event.type === "tool_execution_end") {
				writeRecord({
					...baseRecord("tool_end"),
					sourceEventType: event.type,
					...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
					...(event.toolName ? { toolName: event.toolName } : {}),
					...(isRuntimeBoolean(event.isError) ? { isError: event.isError } : {}),
				});
			}
		},
		writeStdoutLine(line: string) {
			if (!line.trim()) return;
			writeRecord({ ...baseRecord("stdout"), text: line });
		},
		writeStderrLine(line: string) {
			if (!line.trim()) return;
			writeRecord({ ...baseRecord("stderr"), text: line });
		},
		writeStderrText(text: string) {
			for (const line of text.split(/\r?\n/)) this.writeStderrLine(line);
		},
		getError() {
			return writeError;
		},
	};
}
