import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import type { ToolArguments } from "../../../tool-display/activity.js";
import { withArtifactGroupWriteClaim } from "./artifacts.ts";
import { extractTextFromContent, extractToolArgsPreview } from "./utils.ts";

const MAX_TOOL_PAYLOAD_BYTES = 32 * 1024;
const TOOL_PAYLOAD_TRUNCATION_MARKER = "\n\n… payload truncated";

function boundedPayload<Value>(value: Value, maxBytes = MAX_TOOL_PAYLOAD_BYTES): string | undefined {
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

interface TranscriptUsageRecord {
	readonly cacheRead?: unknown;
	readonly cacheWrite?: unknown;
	readonly cost?: unknown;
	readonly input?: unknown;
	readonly inputTokens?: unknown;
	readonly output?: unknown;
	readonly outputTokens?: unknown;
	readonly total?: unknown;
}

interface NormalizedTranscriptUsage {
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly cost: number;
	readonly input: number;
	readonly output: number;
}

interface ChildTranscriptRecord {
	version: typeof CHILD_TRANSCRIPT_ARTIFACT_VERSION;
	recordType: ChildTranscriptRecordType;
	source: ChildTranscriptSource;
	runId: string;
	agent: string;
	childIndex?: number;
	cwd: string;
	ts: number;
	timestamp: string;
	argsPayload?: string;
	argsPreview?: string;
	customType?: string;
	display?: boolean;
	errorMessage?: string;
	isError?: boolean;
	maxBytes?: number;
	message?: unknown;
	model?: string;
	outputTruncated?: boolean;
	role?: string;
	sourceEventType?: string;
	stopReason?: string;
	text?: string;
	toolCallId?: string;
	toolName?: string;
	usage?: NormalizedTranscriptUsage;
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

function errorMessage<Cause>(cause: Cause): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function finiteNumber<Value>(value: Value): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) ? value : undefined;
}

function usageRecord<Value>(value: Value): TranscriptUsageRecord {
	if (!isRuntimeObject(value) || value === null || Array.isArray(value)) return {};
	// SAFETY: transcript projection reads only the declared usage fields and validates every number.
	return value as Value & TranscriptUsageRecord;
}

function normalizeUsage<Value>(value: Value): NormalizedTranscriptUsage | undefined {
	if (!value || !isRuntimeObject(value)) return undefined;
	const raw = usageRecord(value);
	const rawCost = raw.cost;
	const cost =
		rawCost && isRuntimeObject(rawCost)
			? (finiteNumber(usageRecord(rawCost).total) ?? 0)
			: (finiteNumber(rawCost) ?? 0);
	return {
		input: finiteNumber(raw.input) ?? finiteNumber(raw.inputTokens) ?? 0,
		output: finiteNumber(raw.output) ?? finiteNumber(raw.outputTokens) ?? 0,
		cacheRead: finiteNumber(raw.cacheRead) ?? 0,
		cacheWrite: finiteNumber(raw.cacheWrite) ?? 0,
		cost,
	};
}

function eventArgs(event: ChildTranscriptEvent): ToolArguments {
	if (!event.args || !isRuntimeObject(event.args) || Array.isArray(event.args)) return {};
	// SAFETY: Pi owns Tool arguments as a string-keyed object; this writer only previews and serializes them.
	return event.args as ToolArguments;
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

	const baseRecord = (recordType: ChildTranscriptRecordType): ChildTranscriptRecord => {
		const ts = Date.now();
		const record: ChildTranscriptRecord = {
			version: CHILD_TRANSCRIPT_ARTIFACT_VERSION,
			recordType,
			source: input.source,
			runId: input.runId,
			agent: input.agent,
			cwd: input.cwd,
			ts,
			timestamp: new Date(ts).toISOString(),
		};
		if (input.childIndex !== undefined) record.childIndex = input.childIndex;
		return record;
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

	const writeRecord = (record: ChildTranscriptRecord) => {
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
			const nestedMessage = {
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				isError: message.isError,
				content: output ? [{ type: "text", text: output }] : [],
			};
			if (message.timestamp !== undefined) Object.assign(nestedMessage, { timestamp: message.timestamp });
			const record: ChildTranscriptRecord = {
				...baseRecord("message"),
				sourceEventType,
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				isError: message.isError,
				message: nestedMessage,
			};
			if (output) {
				record.text = output;
				record.outputTruncated = output.includes("… payload truncated");
			}
			writeRecord(record);
			return;
		}
		const record: ChildTranscriptRecord = {
			...baseRecord("message"),
			sourceEventType,
			role: message.role,
			message,
		};
		if (message.role === "custom") {
			record.customType = message.customType;
			record.display = message.display;
		}
		if (text) record.text = text;
		if (message.model) record.model = message.model;
		if (message.stopReason) record.stopReason = message.stopReason;
		if (message.errorMessage) record.errorMessage = message.errorMessage;
		if (message.usage) record.usage = normalizeUsage(message.usage);
		writeRecord(record);
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
				const record: ChildTranscriptRecord = {
					...baseRecord("tool_start"),
					sourceEventType: event.type,
					toolName: event.toolName,
				};
				if (event.toolCallId) record.toolCallId = event.toolCallId;
				if (Object.keys(args).length > 0) record.argsPreview = extractToolArgsPreview(args);
				if (argsPayload) record.argsPayload = argsPayload;
				writeRecord(record);
				return;
			}
			if (event.type === "tool_execution_end") {
				const record: ChildTranscriptRecord = {
					...baseRecord("tool_end"),
					sourceEventType: event.type,
				};
				if (event.toolCallId) record.toolCallId = event.toolCallId;
				if (event.toolName) record.toolName = event.toolName;
				if (isRuntimeBoolean(event.isError)) record.isError = event.isError;
				writeRecord(record);
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
