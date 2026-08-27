import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import {
	isRuntimeBigInt,
	isRuntimeBoolean,
	isRuntimeFunction,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
	isRuntimeSymbol,
	isRuntimeUndefined,
} from "../shared/runtime-type.js";
import type { ToolArguments } from "./activity.js";
import type { ToolActivityState } from "./activity-store.js";
import { DETAIL_BYTE_LIMIT, DETAIL_LINE_LIMIT, ROW_PREVIEW_BYTE_LIMIT, ROW_PREVIEW_CODE_UNIT_LIMIT } from "./limits.js";
import { graphemePrefix, graphemeSuffix, sanitizeTerminalText, truncateUtf8Graphemes } from "./terminal.js";

const DETAIL_RAW_SCAN_FACTOR = 4;
const SUMMARY_TEXT_MAX_CODE_UNITS = 64 * 1024;

export function formatElapsed(milliseconds: number): string {
	if (milliseconds < 1_000) return "<1s";
	const seconds = Math.floor(milliseconds / 1_000);
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${String(minutes)}m ${String(remainingSeconds).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function oneLine(value: string): string {
	const normalized = sanitizeTerminalText(value).replace(/\s+/gu, " ").trim();
	const raw = graphemePrefix(normalized, ROW_PREVIEW_CODE_UNIT_LIMIT);
	const clipped = raw.length < normalized.length;
	const suffix = clipped ? "…" : "";
	return truncateUtf8Graphemes(`${raw}${suffix}`, ROW_PREVIEW_BYTE_LIMIT);
}

function stringArgument(args: ToolArguments, key: string): string {
	const value = args[key];
	return isRuntimeString(value) ? value : "";
}

export function describeBuiltinTarget(name: string, args: ToolArguments): string {
	if (name === "bash") return oneLine(stringArgument(args, "command"));
	if (name === "grep" || name === "find") {
		const pattern = oneLine(stringArgument(args, "pattern"));
		const path = oneLine(stringArgument(args, "path"));
		return oneLine(path ? `${pattern} in ${path}` : pattern);
	}
	return oneLine(stringArgument(args, "path") || stringArgument(args, "name"));
}

function textFromResult(result: AgentToolResult<unknown>): string {
	let output = "";
	for (const entry of result.content) {
		if (entry.type !== "text") continue;
		const separator = output ? "\n" : "";
		const remaining = SUMMARY_TEXT_MAX_CODE_UNITS - output.length - separator.length;
		if (remaining <= 0) break;
		if (entry.text.length <= remaining) {
			output += `${separator}${entry.text}`;
			continue;
		}
		const marker = "\n…\n";
		const contentBudget = Math.max(0, remaining - marker.length);
		const headLength = Math.ceil(contentBudget / 2);
		const tailLength = Math.floor(contentBudget / 2);
		const tail = tailLength > 0 ? graphemeSuffix(entry.text, tailLength) : "";
		output += `${separator}${graphemePrefix(entry.text, headLength)}${marker}${tail}`;
		break;
	}
	return output.trim();
}

function firstNonEmptyLine(value: string): string {
	return (
		value
			.split("\n")
			.find((line) => line.trim().length > 0)
			?.trim() ?? "error"
	);
}

function lastNonEmptyLine(value: string): string {
	const lines = value.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "error";
}

export function classifyTerminalState(
	result: AgentToolResult<unknown>,
	isError: boolean,
): Exclude<ToolActivityState, "running"> {
	if (!isError) return "success";
	const text = textFromResult(result);
	if (/^Tool execution was blocked\b/iu.test(text)) {
		return "rejected";
	}
	if (/\b(?:operation|request|command) (?:was )?abort(?:ed)?\b|\bcancel(?:led|ed)\b/iu.test(text)) {
		return "cancelled";
	}
	return "error";
}

function lineCount(value: string): number {
	if (!value) return 0;
	let lines = 1;
	for (let index = 0; index < value.length; index += 1) {
		if (value.charCodeAt(index) === 0x0a) lines += 1;
	}
	return lines;
}

function writeLineCount(value: string) {
	if (!value) return { count: 0, truncated: false };
	const scanLength = Math.min(value.length, SUMMARY_TEXT_MAX_CODE_UNITS);
	let count = 1;
	for (let index = 0; index < scanLength; index += 1) {
		if (value.charCodeAt(index) === 0x0a && index < value.length - 1) count += 1;
	}
	return { count, truncated: scanLength < value.length };
}

function nonEmptyLineCount(value: string): number {
	return value.split("\n").filter((line) => line.trim().length > 0).length;
}

function diffCounts(value: string) {
	let additions = 0;
	let deletions = 0;
	for (const line of value.slice(0, SUMMARY_TEXT_MAX_CODE_UNITS).split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
		if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
	}
	return { additions, deletions };
}

function diffDetail(result: AgentToolResult<unknown>): string | undefined {
	const details = result.details;
	return isRuntimeObject(details) &&
		details !== null &&
		!Array.isArray(details) &&
		"diff" in details &&
		isRuntimeString(details.diff)
		? details.diff
		: undefined;
}

export function summarizeBuiltin(
	name: string,
	args: ToolArguments,
	result: AgentToolResult<unknown>,
	state: Exclude<ToolActivityState, "running">,
	durationMs: number | undefined,
): string {
	if (state === "rejected") return "rejected";
	if (state === "cancelled") return "cancelled";
	if (state === "error") {
		const text = textFromResult(result);
		return oneLine(name === "bash" ? lastNonEmptyLine(text) : firstNonEmptyLine(text));
	}
	if (result.content.some((entry) => entry.type === "image")) return "image loaded";
	if (name === "write") {
		const content = stringArgument(args, "content");
		const lines = writeLineCount(content);
		return `${lines.truncated ? "≥" : ""}${String(lines.count)} ${lines.count === 1 ? "line" : "lines"}`;
	}
	if (name === "edit") {
		const diff = diffDetail(result);
		if (!diff) return "applied";
		const counts = diffCounts(diff);
		return `+${String(counts.additions)}/-${String(counts.deletions)}`;
	}
	if (name === "bash") return durationMs === undefined ? "done" : `done in ${formatElapsed(durationMs)}`;
	const text = textFromResult(result);
	if (name === "read") return `${String(lineCount(text))} lines`;
	if (name === "grep") {
		if (/^No matches found/iu.test(text)) return "0 matches";
		const matches = text
			.split("\n")
			.map((line) => line.match(/^(.+?):\d+:/u))
			.filter((match) => match !== null);
		const files = new Set(matches.map((match) => match[1])).size;
		return `${String(matches.length)} ${matches.length === 1 ? "match" : "matches"} in ${String(files)} ${files === 1 ? "file" : "files"}`;
	}
	if (name === "find" || name === "ls") {
		const count = nonEmptyLineCount(text);
		const singular = name === "find" ? "file" : "entry";
		const plural = name === "find" ? "files" : "entries";
		return `${String(count)} ${count === 1 ? singular : plural}`;
	}
	return oneLine(firstNonEmptyLine(text || "done"));
}

function boundedJson<Value>(value: Value, maxCodeUnits: number): string {
	const parts: string[] = [];
	let remaining = Math.max(1, Math.floor(maxCodeUnits));
	let truncated = false;
	const seen = new WeakSet<object>();
	const append = (text: string): boolean => {
		if (remaining <= 0) {
			truncated = true;
			return false;
		}
		const next = graphemePrefix(text, remaining);
		parts.push(next);
		remaining -= next.length;
		if (next.length < text.length) truncated = true;
		return !truncated;
	};
	const visit = <Candidate>(candidate: Candidate, depth: number): void => {
		if (truncated) return;
		if (candidate === null) {
			append("null");
			return;
		}
		if (isRuntimeString(candidate)) {
			const slice = graphemePrefix(candidate, Math.max(0, remaining - 2));
			append(JSON.stringify(slice));
			if (slice.length < candidate.length) truncated = true;
			return;
		}
		if (isRuntimeNumber(candidate) || isRuntimeBoolean(candidate)) {
			append(String(candidate));
			return;
		}
		if (isRuntimeBigInt(candidate)) {
			append(`${String(candidate)}n`);
			return;
		}
		if (isRuntimeUndefined(candidate)) {
			append("undefined");
			return;
		}
		if (isRuntimeSymbol(candidate) || isRuntimeFunction(candidate)) {
			append(JSON.stringify(String(candidate)));
			return;
		}
		if (!isRuntimeObject(candidate)) {
			append(JSON.stringify(String(candidate)));
			return;
		}
		if (depth >= 8) {
			append('"[depth limit]"');
			return;
		}
		if (seen.has(candidate)) {
			append('"[circular]"');
			return;
		}
		seen.add(candidate);
		if (Array.isArray(candidate)) {
			append("[");
			for (let index = 0; index < candidate.length && !truncated; index += 1) {
				if (index > 0) append(", ");
				visit(candidate[index], depth + 1);
			}
			append("]");
			return;
		}
		append("{");
		let first = true;
		for (const key of Object.keys(candidate)) {
			if (truncated) break;
			if (!first) append(", ");
			first = false;
			append(JSON.stringify(key));
			append(": ");
			try {
				visit(readHostProxyProperty(candidate, key), depth + 1);
			} catch {
				append('"[unavailable]"');
			}
		}
		append("}");
	};
	try {
		visit(value, 0);
	} catch {
		append('"[unavailable]"');
	}
	const output = parts.join("");
	return truncated ? `${graphemePrefix(output, Math.max(0, maxCodeUnits - 1))}…` : output;
}

class DetailCollector {
	private bytes = 0;
	private capped = false;
	private readonly lineLimit: number;
	private readonly byteLimit: number;
	private readonly lines: string[] = [];

	constructor(maxLines: number, maxBytes: number) {
		this.lineLimit = Math.max(1, Math.floor(maxLines));
		this.byteLimit = Math.max(0, Math.floor(maxBytes));
	}

	add(rawLine: string): boolean {
		if (this.capped) return false;
		if (this.lines.length >= this.lineLimit) {
			this.capped = true;
			return false;
		}
		const separatorBytes = this.lines.length > 0 ? 1 : 0;
		const available = this.byteLimit - this.bytes - separatorBytes;
		if (available < 0) {
			this.capped = true;
			return false;
		}
		const scanLimit = Math.max(1_024, available * DETAIL_RAW_SCAN_FACTOR);
		const safe = sanitizeTerminalText(rawLine);
		const rawSlice = graphemePrefix(safe, scanLimit);
		const bounded = truncateUtf8Graphemes(rawSlice, available);
		this.lines.push(bounded);
		this.bytes += separatorBytes + Buffer.byteLength(bounded);
		if (rawSlice.length < safe.length || bounded.length < rawSlice.length) {
			this.capped = true;
			return false;
		}
		return true;
	}

	finish(): string[] {
		if (!this.capped) return this.lines;
		const fullMarker = `… detail capped at ${String(this.lineLimit)} lines / ${String(this.byteLimit)} bytes`;
		const marker = truncateUtf8Graphemes(fullMarker, this.byteLimit);
		if (!marker) return [];
		const markerBytes = Buffer.byteLength(marker);
		while (this.lines.length > 0) {
			const separatorBytes = this.lines.length > 0 ? 1 : 0;
			if (this.lines.length < this.lineLimit && this.bytes + separatorBytes + markerBytes <= this.byteLimit) break;
			const removed = this.lines.pop() ?? "";
			this.bytes -= Buffer.byteLength(removed) + (this.lines.length > 0 ? 1 : 0);
		}
		if (this.lines.length === 0 && markerBytes > this.byteLimit) return [];
		this.lines.push(marker);
		return this.lines;
	}

	isCapped(): boolean {
		return this.capped;
	}

	markCapped(): void {
		this.capped = true;
	}
}

function addMultiline(collector: DetailCollector, value: string, prefix = ""): void {
	let offset = 0;
	const rawChunkLimit = Math.max(1_024, DETAIL_BYTE_LIMIT * DETAIL_RAW_SCAN_FACTOR);
	while (!collector.isCapped()) {
		const newline = value.indexOf("\n", offset);
		if (newline >= 0 && newline - offset <= rawChunkLimit) {
			if (!collector.add(`${prefix}${value.slice(offset, newline)}`)) return;
			offset = newline + 1;
			if (offset === value.length) collector.add(prefix);
			continue;
		}
		if (value.length - offset > rawChunkLimit) {
			collector.add(`${prefix}${graphemePrefix(value.slice(offset), rawChunkLimit)}`);
			collector.markCapped();
			return;
		}
		collector.add(`${prefix}${value.slice(offset)}`);
		return;
	}
}

export function capDetailLines(
	lines: readonly string[],
	maxLines = DETAIL_LINE_LIMIT,
	maxBytes = DETAIL_BYTE_LIMIT,
): string[] {
	const collector = new DetailCollector(maxLines, maxBytes);
	for (const line of lines) {
		if (!collector.add(line)) break;
	}
	return collector.finish();
}

/** Bounded formatted result text without protocol headings or argument dumps. */
export function buildToolResultLines(result: AgentToolResult<unknown>): string[] {
	const collector = new DetailCollector(DETAIL_LINE_LIMIT, DETAIL_BYTE_LIMIT);
	for (const entry of result.content) {
		if (collector.isCapped()) break;
		if (entry.type === "text") addMultiline(collector, entry.text);
		else collector.add(`[image ${oneLine(entry.mimeType)}]`);
	}
	if (result.content.length === 0) collector.add("(no result content)");
	return collector.finish();
}

/** Bounded raw protocol projection built only for the selected Tool call. */
export function buildRawToolDetailLines(
	id: string,
	name: string,
	args: ToolArguments,
	result: AgentToolResult<unknown> | undefined,
): string[] {
	return capDetailLines([
		`Call ID: ${oneLine(id)}`,
		`Tool name: ${oneLine(name)}`,
		"",
		"Arguments",
		boundedJson(args, DETAIL_BYTE_LIMIT),
		"",
		"Result content",
		...(result ? buildToolResultLines(result) : ["(pending)"]),
		"",
		"Details",
		result?.details === undefined ? "(none)" : boundedJson(result.details, DETAIL_BYTE_LIMIT),
	]);
}
