import * as fs from "node:fs";
import * as path from "node:path";
import { isTaskOnlyAgentText } from "../shared/display-description.ts";
import { readStatus } from "../shared/utils.ts";
import type { AgentTranscriptReader, AgentTranscriptRequest } from "./agent-dialog.ts";

const READ_BYTE_MULTIPLIER = 4;
const MIN_READ_BYTES = 16 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;

function cleanTerminalText(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = value.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index += 2;
				while (index < value.length) {
					const terminator = value.charCodeAt(index);
					if (terminator >= 0x40 && terminator <= 0x7e) break;
					index += 1;
				}
				continue;
			}
			if (
				introducer === 0x5d ||
				introducer === 0x50 ||
				introducer === 0x58 ||
				introducer === 0x5e ||
				introducer === 0x5f
			) {
				index += 2;
				while (index < value.length) {
					const candidate = value.charCodeAt(index);
					if (candidate === 0x07 || candidate === 0x9c) break;
					if (candidate === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
						index += 1;
						break;
					}
					index += 1;
				}
				continue;
			}
			if (index + 1 < value.length) {
				index += 1;
				while (index + 1 < value.length) {
					const candidate = value.charCodeAt(index);
					if (candidate < 0x20 || candidate > 0x2f) break;
					index += 1;
				}
			}
			continue;
		}
		if (code === 0x9b) {
			index += 1;
			while (index < value.length) {
				const terminator = value.charCodeAt(index);
				if (terminator >= 0x40 && terminator <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
			index += 1;
			while (index < value.length) {
				const candidate = value.charCodeAt(index);
				if (candidate === 0x07 || candidate === 0x9c) break;
				if (candidate === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (
			code === 0x061c ||
			code === 0x200b ||
			code === 0x200e ||
			code === 0x200f ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069) ||
			code === 0xfeff
		) {
			result += " ";
			continue;
		}
		if (code === 0x09 || code === 0x0a || code === 0x0d) {
			result += value[index] ?? "";
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			result += " ";
			continue;
		}
		result += value[index] ?? "";
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

function field(entry: Record<string, unknown>, message: Record<string, unknown> | undefined, key: string): unknown {
	return entry[key] ?? message?.[key];
}

function stringField(
	entry: Record<string, unknown>,
	message: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = field(entry, message, key);
	return typeof value === "string" && value ? value : undefined;
}

function booleanField(
	entry: Record<string, unknown>,
	message: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = field(entry, message, key);
	return typeof value === "boolean" ? value : undefined;
}

function oneLine(value: string): string {
	return cleanTerminalText(value).replace(/\s+/gu, " ").trim();
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
	if (role === "toolResult" || role === "tool_result") return null;
	return text.trim();
}

type ToolOutcome = "cancelled" | "completed" | "failed" | "rejected" | "running";

interface ToolProjection {
	ended: boolean;
	isError: boolean | undefined;
	name: string;
	result: string;
	resultSeen: boolean;
	target: string;
	toolCallId: string | undefined;
}

type TranscriptItem =
	| { readonly kind: "message"; readonly text: string }
	| { readonly kind: "tool"; tool: ToolProjection };

function toolResultText(entry: Record<string, unknown>): string {
	const message = record(entry.message);
	return (
		(typeof entry.text === "string" ? entry.text : "") ||
		contentText(entry.content) ||
		(typeof message?.text === "string" ? message.text : "") ||
		contentText(message?.content)
	).trim();
}

function toolLabel(value: string): string {
	const safe = oneLine(value);
	if (!safe) return "Tool";
	return `${safe.charAt(0).toUpperCase()}${safe.slice(1)}`;
}

function toolOutcome(tool: ToolProjection): ToolOutcome {
	if (!tool.ended && !tool.resultSeen) return "running";
	if (tool.isError !== true) return "completed";
	const result = cleanTerminalText(tool.result).trim();
	if (/^Tool execution was blocked\b/iu.test(result)) return "rejected";
	if (/\b(?:operation|request|command) (?:was )?abort(?:ed)?\b|\bcancel(?:led|ed)\b/iu.test(result)) {
		return "cancelled";
	}
	return "failed";
}

function renderTool(tool: ToolProjection): string {
	const target = oneLine(tool.target);
	const header = `● ${toolLabel(tool.name)}${target ? ` ${target}` : ""} · ${toolOutcome(tool)}`;
	const result = tool.result.trim();
	return result ? `${header}\n${result}` : header;
}

function createToolProjection(
	items: TranscriptItem[],
	byId: Map<string, ToolProjection>,
	input: { readonly name?: string; readonly target?: string; readonly toolCallId?: string },
): ToolProjection {
	const tool: ToolProjection = {
		ended: false,
		isError: undefined,
		name: input.name ?? "Tool",
		result: "",
		resultSeen: false,
		target: input.target ?? "",
		toolCallId: input.toolCallId,
	};
	items.push({ kind: "tool", tool });
	if (input.toolCallId) byId.set(input.toolCallId, tool);
	return tool;
}

function unresolvedTools(items: readonly TranscriptItem[], name: string | undefined): ToolProjection[] {
	return items
		.filter((item): item is Extract<TranscriptItem, { readonly kind: "tool" }> => item.kind === "tool")
		.map((item) => item.tool)
		.filter((tool) => !tool.resultSeen && (name === undefined || tool.name === name));
}

function resolveTool(
	items: readonly TranscriptItem[],
	byId: ReadonlyMap<string, ToolProjection>,
	toolCallId: string | undefined,
	name: string | undefined,
): ToolProjection | undefined {
	if (toolCallId) return byId.get(toolCallId);
	const candidates = unresolvedTools(items, name);
	return candidates.length === 1 ? candidates[0] : undefined;
}

function jsonlTranscript(source: string, sourceTruncated: boolean, task: string): string {
	let lines = source.split(/\r?\n/);
	if (sourceTruncated && lines.length > 0) lines = lines.slice(1);
	const items: TranscriptItem[] = [];
	const toolsById = new Map<string, ToolProjection>();
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
			const toolCallId = stringField(entry, undefined, "toolCallId");
			const name = stringField(entry, undefined, "toolName") ?? "Tool";
			const target = stringField(entry, undefined, "argsPreview") ?? "";
			const existing = toolCallId ? toolsById.get(toolCallId) : undefined;
			if (existing) {
				existing.name = name;
				existing.target = target;
			} else createToolProjection(items, toolsById, { name, target, toolCallId });
			continue;
		}
		if (recordType === "tool_end") {
			const toolCallId = stringField(entry, undefined, "toolCallId");
			const name = stringField(entry, undefined, "toolName");
			const tool =
				resolveTool(items, toolsById, toolCallId, name) ??
				createToolProjection(items, toolsById, {
					...(name ? { name } : {}),
					...(toolCallId ? { toolCallId } : {}),
				});
			tool.ended = true;
			tool.isError = booleanField(entry, undefined, "isError") ?? tool.isError;
			continue;
		}
		if (recordType && recordType !== "message") continue;
		const message = record(entry.message);
		const role =
			typeof entry.role === "string" ? entry.role : typeof message?.role === "string" ? message.role : undefined;
		if (role === "toolResult" || role === "tool_result") {
			const toolCallId = stringField(entry, message, "toolCallId");
			const name = stringField(entry, message, "toolName");
			const tool =
				resolveTool(items, toolsById, toolCallId, name) ??
				createToolProjection(items, toolsById, {
					...(name ? { name } : {}),
					...(toolCallId ? { toolCallId } : {}),
				});
			if (name) tool.name = name;
			tool.result = toolResultText(entry);
			tool.resultSeen = true;
			tool.ended = true;
			tool.isError = booleanField(entry, message, "isError") ?? tool.isError ?? false;
			continue;
		}
		const block = messageBlock(entry);
		const previous = items.at(-1);
		if (
			block &&
			!(role === "user" && isTaskOnlyAgentText(block, task)) &&
			!(previous?.kind === "message" && previous.text === block)
		) {
			items.push({ kind: "message", text: block });
		}
	}
	const blocks = items.map((item) => (item.kind === "tool" ? renderTool(item.tool) : item.text));
	return `${sourceTruncated ? "… earlier transcript omitted\n\n" : ""}${blocks.join("\n\n")}`.trim();
}

function transcriptCandidate(request: AgentTranscriptRequest): string | null {
	const direct = request.row.transcriptPath ?? request.row.savedOutputPath ?? request.row.sessionFile;
	if (direct) return direct;
	if (!request.row.asyncDir || request.row.childIndex === undefined) return null;
	try {
		const status = readStatus(request.row.asyncDir);
		const step = status?.steps?.[request.row.childIndex];
		return step?.transcriptPath ?? step?.sessionFile ?? null;
	} catch {
		return null;
	}
}

/** Bounded, no-follow transcript reader for the shared Agent Command Dialog. */
export const readAgentTranscript: AgentTranscriptReader = (request) => {
	if (request.signal.aborted) return null;
	const partial = isTaskOnlyAgentText(request.row.partialResult, request.row.task) ? null : request.row.partialResult;
	const candidate = transcriptCandidate(request);
	if (!candidate || !path.isAbsolute(candidate)) return partial;
	const tail = readTail(candidate, request.maxChars);
	if (request.signal.aborted) return null;
	if (!tail) return partial;
	const parsed = candidate.endsWith(".jsonl")
		? jsonlTranscript(tail.text, tail.truncated, request.row.task)
		: `${tail.truncated ? "… earlier transcript omitted\n\n" : ""}${tail.text}`;
	const bounded = boundedTail(parsed || partial || "", request.maxChars) || null;
	return isTaskOnlyAgentText(bounded, request.row.task) ? null : bounded;
};
