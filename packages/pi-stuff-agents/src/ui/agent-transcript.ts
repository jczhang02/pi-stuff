import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTranscriptReader, AgentTranscriptRequest } from "./agent-dialog.ts";

const READ_BYTE_MULTIPLIER = 4;
const MIN_READ_BYTES = 16 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;

function cleanTerminalText(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === 27 && value[index + 1] === "[") {
			index += 2;
			while (index < value.length) {
				const terminator = value.charCodeAt(index);
				if (terminator >= 64 && terminator <= 126) break;
				index += 1;
			}
			continue;
		}
		if (code === 9 || code === 10 || code === 13 || code >= 32) {
			if (code !== 127) result += value[index] ?? "";
		}
	}
	return result.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function boundedTail(value: string, maxChars: number): string {
	const clean = cleanTerminalText(value).trim();
	if (clean.length <= maxChars) return clean;
	return `… earlier transcript omitted\n\n${clean.slice(-maxChars).replace(/^\S*\n?/, "")}`.trim();
}

function readTail(filePath: string, maxChars: number): { readonly text: string; readonly truncated: boolean } | null {
	let file: number | undefined;
	try {
		const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
		file = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
		const stat = fs.fstatSync(file);
		if (!stat.isFile() || stat.size === 0) return null;
		const maximumBytes = Math.min(MAX_READ_BYTES, Math.max(MIN_READ_BYTES, maxChars * READ_BYTE_MULTIPLIER));
		const bytes = Math.min(stat.size, maximumBytes);
		const start = stat.size - bytes;
		const buffer = Buffer.alloc(bytes);
		const read = fs.readSync(file, buffer, 0, bytes, start);
		return { text: buffer.subarray(0, read).toString("utf8"), truncated: start > 0 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	} finally {
		if (file !== undefined) fs.closeSync(file);
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((item) => {
			if (typeof item === "string") return item;
			const part = record(item);
			if (!part) return "";
			if (typeof part.text === "string") return part.text;
			if (typeof part.content === "string") return part.content;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageBlock(entry: Record<string, unknown>): string | null {
	const message = record(entry.message);
	const role =
		typeof entry.role === "string" ? entry.role : typeof message?.role === "string" ? message.role : undefined;
	const text =
		(typeof entry.text === "string" ? entry.text : "") ||
		contentText(entry.content) ||
		(typeof message?.text === "string" ? message.text : "") ||
		contentText(message?.content);
	if (!text.trim()) return null;
	if (role === "assistant") return `Agent\n${text.trim()}`;
	if (role === "user") return `User\n${text.trim()}`;
	if (role === "toolResult" || role === "tool_result") return `Tool result\n${text.trim()}`;
	return text.trim();
}

function jsonlTranscript(source: string, sourceTruncated: boolean): string {
	let lines = source.split(/\r?\n/);
	if (sourceTruncated && lines.length > 0) lines = lines.slice(1);
	const blocks: string[] = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		let entry: Record<string, unknown> | undefined;
		try {
			entry = record(JSON.parse(line));
		} catch {
			continue;
		}
		if (!entry) continue;
		const recordType = typeof entry.recordType === "string" ? entry.recordType : undefined;
		if (recordType === "tool_start") {
			const name = typeof entry.toolName === "string" ? entry.toolName : "tool";
			const preview = typeof entry.argsPreview === "string" ? ` ${entry.argsPreview}` : "";
			blocks.push(`Tool · ${name}${preview}`);
			continue;
		}
		if (recordType && recordType !== "message") continue;
		const block = messageBlock(entry);
		if (block && blocks.at(-1) !== block) blocks.push(block);
	}
	return `${sourceTruncated ? "… earlier transcript omitted\n\n" : ""}${blocks.join("\n\n")}`.trim();
}

function transcriptCandidate(request: AgentTranscriptRequest): string | null {
	return request.row.transcriptPath ?? request.row.savedOutputPath ?? request.row.sessionFile;
}

/** Bounded, no-follow transcript reader for the shared Agent Command Dialog. */
export const readAgentTranscript: AgentTranscriptReader = (request) => {
	if (request.signal.aborted) return null;
	const candidate = transcriptCandidate(request);
	if (!candidate || !path.isAbsolute(candidate)) return request.row.partialResult;
	const tail = readTail(candidate, request.maxChars);
	if (request.signal.aborted) return null;
	if (!tail) return request.row.partialResult;
	const parsed = candidate.endsWith(".jsonl")
		? jsonlTranscript(tail.text, tail.truncated)
		: `${tail.truncated ? "… earlier transcript omitted\n\n" : ""}${tail.text}`;
	return boundedTail(parsed || request.row.partialResult || "", request.maxChars) || null;
};
