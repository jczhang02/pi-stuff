import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ToolActivityState } from "./activity-store.js";

const DETAIL_MAX_BYTES = 24 * 1024;
const DETAIL_MAX_LINES = 240;
const DETAIL_RAW_SCAN_FACTOR = 4;
const ROW_PREVIEW_MAX_BYTES = 4 * 1024;
const ROW_PREVIEW_MAX_CODE_UNITS = 8 * 1024;
const SUMMARY_TEXT_MAX_CODE_UNITS = 64 * 1024;

const MAX_ROW_CACHE_WIDTHS = 6;

export interface ToolRowModel {
	readonly durationMs: number | undefined;
	readonly label: string;
	readonly state: ToolActivityState;
	readonly summary: string;
	readonly target: string;
}

export class EmptyToolComponent implements Component {
	invalidate(): void {}

	render(): string[] {
		return [];
	}
}

function sameModel(left: ToolRowModel, right: ToolRowModel): boolean {
	return (
		left.durationMs === right.durationMs &&
		left.label === right.label &&
		left.state === right.state &&
		left.summary === right.summary &&
		left.target === right.target
	);
}

/** Settled rows retain their already-fitted result for every recently seen width. */
export class CachedToolRow implements Component {
	private readonly cache = new Map<number, string[]>();
	private computationCountValue = 0;
	private model: ToolRowModel;
	private readonly theme: Theme;
	private visible = true;

	constructor(theme: Theme, model: ToolRowModel) {
		this.theme = theme;
		this.model = model;
	}

	get computationCount(): number {
		return this.computationCountValue;
	}

	invalidate(): void {
		// Pi invalidates settled transcript rows during unrelated repaint work. The
		// width cache remains valid until setModel() changes semantic content.
	}

	render(width: number): string[] {
		if (!this.visible) return [];
		const normalizedWidth = Math.max(1, Math.floor(width));
		const cached = this.cache.get(normalizedWidth);
		if (cached) return cached;
		const rendered = [renderToolRow(this.model, this.theme, normalizedWidth)];
		this.computationCountValue += 1;
		this.cache.set(normalizedWidth, rendered);
		while (this.cache.size > MAX_ROW_CACHE_WIDTHS) {
			const oldest = this.cache.keys().next().value as number | undefined;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
		}
		return rendered;
	}

	setModel(model: ToolRowModel): void {
		if (sameModel(this.model, model)) return;
		this.model = model;
		this.cache.clear();
	}

	setVisible(visible: boolean): void {
		if (this.visible === visible) return;
		this.visible = visible;
		this.cache.clear();
	}
}

const TOOL_STATE_GLYPHS = {
	running: "⦿",
	success: "⊛",
	error: "⊗",
	rejected: "⊘",
	cancelled: "⊖",
} as const satisfies Record<ToolActivityState, string>;

/** One neutral-width circled-math family keeps status marks optically aligned. */
export function toolStateGlyph(state: ToolActivityState): string {
	return TOOL_STATE_GLYPHS[state];
}

function styleState(theme: Theme, state: ToolActivityState, text: string): string {
	switch (state) {
		case "running":
			return theme.fg("accent", text);
		case "success":
			return theme.fg("success", text);
		case "error":
			return theme.fg("error", text);
		case "rejected":
			return theme.fg("warning", text);
		case "cancelled":
			return theme.fg("muted", text);
	}
}

function fitRow(prefix: string, tail: string, width: number): string {
	const separator = tail ? " · " : "";
	const full = `${prefix}${separator}${tail}`;
	if (visibleWidth(full) <= width) return full;
	if (!tail) return truncateToWidth(prefix, width, "…");
	const tailWidth = visibleWidth(tail);
	if (tailWidth + visibleWidth(separator) >= width) return truncateToWidth(tail, width, "…");
	const prefixWidth = Math.max(1, width - tailWidth - visibleWidth(separator));
	return `${truncateToWidth(prefix, prefixWidth, "…")}${separator}${tail}`;
}

function renderToolRow(model: ToolRowModel, theme: Theme, width: number): string {
	const glyph = styleState(theme, model.state, toolStateGlyph(model.state));
	const safeLabel = oneLine(model.label);
	const safeTarget = oneLine(model.target);
	const safeSummary = oneLine(model.summary);
	const label = theme.fg("toolTitle", theme.bold(safeLabel));
	const target = safeTarget ? ` ${theme.fg("muted", safeTarget)}` : "";
	const summary =
		model.state === "success" ? theme.fg("muted", safeSummary) : styleState(theme, model.state, safeSummary);
	return fitRow(`${glyph} ${label}${target}`, summary, width);
}

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

/** Strip terminal control protocols while retaining printable Unicode text. */
export function sanitizeTerminalText(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = value.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index += 2;
				while (index < value.length) {
					const candidate = value.charCodeAt(index);
					if (candidate >= 0x40 && candidate <= 0x7e) break;
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
					if (candidate === 0x07) break;
					if (candidate === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
						index += 1;
						break;
					}
					index += 1;
				}
				continue;
			}
			if (Number.isNaN(introducer)) continue;
			index += 1;
			while (index + 1 < value.length) {
				const candidate = value.charCodeAt(index);
				if (candidate < 0x20 || candidate > 0x2f) break;
				index += 1;
			}
			continue;
		}
		if (code === 0x9b) {
			index += 1;
			while (index < value.length) {
				const candidate = value.charCodeAt(index);
				if (candidate >= 0x40 && candidate <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		if (code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
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
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		) {
			output += " ";
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			output += " ";
			continue;
		}
		output += value[index];
	}
	return output;
}

export function oneLine(value: string): string {
	const raw = value.slice(0, ROW_PREVIEW_MAX_CODE_UNITS);
	const clipped = raw.length < value.length;
	const normalized = sanitizeTerminalText(raw).replace(/\s+/gu, " ").trim();
	const suffix = clipped ? "…" : "";
	return truncateUtf8(`${normalized}${suffix}`, ROW_PREVIEW_MAX_BYTES);
}

function stringArgument(args: Readonly<Record<string, unknown>>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

export function describeBuiltinTarget(name: string, args: Readonly<Record<string, unknown>>): string {
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
		const tail = tailLength > 0 ? entry.text.slice(-tailLength) : "";
		output += `${separator}${entry.text.slice(0, headLength)}${marker}${tail}`;
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
	if (/^\[pi-stuff-permissions\]\s/iu.test(text) || /^Tool execution was blocked\b/iu.test(text)) {
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

function writeLineCount(value: string): { readonly count: number; readonly truncated: boolean } {
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

function diffCounts(value: string): { readonly additions: number; readonly deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of value.slice(0, SUMMARY_TEXT_MAX_CODE_UNITS).split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
		if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
	}
	return { additions, deletions };
}

function detailsRecord(result: AgentToolResult<unknown>): Record<string, unknown> {
	return typeof result.details === "object" && result.details !== null && !Array.isArray(result.details)
		? (result.details as Record<string, unknown>)
		: {};
}

export function summarizeBuiltin(
	name: string,
	args: Readonly<Record<string, unknown>>,
	result: AgentToolResult<unknown>,
	state: Exclude<ToolActivityState, "running">,
	durationMs: number | undefined,
): string {
	const text = textFromResult(result);
	if (state === "rejected") return "rejected";
	if (state === "cancelled") return "cancelled";
	if (state === "error") return oneLine(name === "bash" ? lastNonEmptyLine(text) : firstNonEmptyLine(text));
	if (result.content.some((entry) => entry.type === "image")) return "image loaded";
	if (name === "read") return `${String(lineCount(text))} lines`;
	if (name === "write") {
		const content = stringArgument(args, "content");
		const lines = writeLineCount(content);
		return `${lines.truncated ? "≥" : ""}${String(lines.count)} ${lines.count === 1 ? "line" : "lines"}`;
	}
	if (name === "edit") {
		// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
		const diff = detailsRecord(result)["diff"];
		if (typeof diff !== "string" || !diff) return "applied";
		const counts = diffCounts(diff);
		return `+${String(counts.additions)}/-${String(counts.deletions)}`;
	}
	if (name === "bash") return durationMs === undefined ? "done" : `done in ${formatElapsed(durationMs)}`;
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

function truncateUtf8(value: string, maxBytes: number): string {
	let output = "";
	let bytes = 0;
	for (const character of value) {
		const characterBytes = Buffer.byteLength(character);
		if (bytes + characterBytes > maxBytes) break;
		output += character;
		bytes += characterBytes;
	}
	return output;
}

function boundedJson(value: unknown, maxCodeUnits: number): string {
	const parts: string[] = [];
	let remaining = Math.max(1, Math.floor(maxCodeUnits));
	let truncated = false;
	const seen = new WeakSet<object>();
	const append = (text: string): boolean => {
		if (remaining <= 0) {
			truncated = true;
			return false;
		}
		const next = text.slice(0, remaining);
		parts.push(next);
		remaining -= next.length;
		if (next.length < text.length) truncated = true;
		return !truncated;
	};
	const visit = (candidate: unknown, depth: number): void => {
		if (truncated) return;
		if (candidate === null) {
			append("null");
			return;
		}
		if (typeof candidate === "string") {
			const slice = candidate.slice(0, Math.max(0, remaining - 2));
			append(JSON.stringify(slice));
			if (slice.length < candidate.length) truncated = true;
			return;
		}
		if (typeof candidate === "number" || typeof candidate === "boolean") {
			append(String(candidate));
			return;
		}
		if (typeof candidate === "bigint") {
			append(`${String(candidate)}n`);
			return;
		}
		if (typeof candidate === "undefined") {
			append("undefined");
			return;
		}
		if (typeof candidate === "symbol" || typeof candidate === "function") {
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
		for (const key in candidate) {
			if (truncated) break;
			if (!Object.hasOwn(candidate, key)) continue;
			if (!first) append(", ");
			first = false;
			append(JSON.stringify(key));
			append(": ");
			try {
				visit((candidate as Record<string, unknown>)[key], depth + 1);
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
	return truncated ? `${output.slice(0, Math.max(0, maxCodeUnits - 1))}…` : output;
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
		const rawSlice = rawLine.slice(0, scanLimit);
		const safe = sanitizeTerminalText(rawSlice);
		const bounded = truncateUtf8(safe, available);
		this.lines.push(bounded);
		this.bytes += separatorBytes + Buffer.byteLength(bounded);
		if (rawSlice.length < rawLine.length || bounded.length < safe.length) {
			this.capped = true;
			return false;
		}
		return true;
	}

	finish(): string[] {
		if (!this.capped) return this.lines;
		const fullMarker = `… detail capped at ${String(this.lineLimit)} lines / ${String(this.byteLimit)} bytes`;
		const marker = truncateUtf8(fullMarker, this.byteLimit);
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
	const rawChunkLimit = Math.max(1_024, DETAIL_MAX_BYTES * DETAIL_RAW_SCAN_FACTOR);
	while (!collector.isCapped()) {
		const chunkEnd = Math.min(value.length, offset + rawChunkLimit);
		const chunk = value.slice(offset, chunkEnd);
		const relativeNewline = chunk.indexOf("\n");
		if (relativeNewline >= 0) {
			const newline = offset + relativeNewline;
			if (!collector.add(`${prefix}${value.slice(offset, newline)}`)) return;
			offset = newline + 1;
			if (offset === value.length) collector.add(prefix);
			continue;
		}
		if (chunkEnd < value.length) {
			collector.add(`${prefix}${value.slice(offset, chunkEnd)}`);
			collector.markCapped();
			return;
		}
		collector.add(`${prefix}${value.slice(offset)}`);
		return;
	}
}

export function capDetailLines(
	lines: readonly string[],
	maxLines = DETAIL_MAX_LINES,
	maxBytes = DETAIL_MAX_BYTES,
): string[] {
	const collector = new DetailCollector(maxLines, maxBytes);
	for (const line of lines) {
		if (!collector.add(line)) break;
	}
	return collector.finish();
}

export function buildToolDetailLines(
	args: Readonly<Record<string, unknown>>,
	result: AgentToolResult<unknown>,
): string[] {
	const collector = new DetailCollector(DETAIL_MAX_LINES, DETAIL_MAX_BYTES);
	collector.add("Call");
	let argumentCount = 0;
	for (const key in args) {
		if (collector.isCapped()) break;
		if (!Object.hasOwn(args, key)) continue;
		argumentCount += 1;
		const value = args[key];
		const safeKey = oneLine(key);
		if (typeof value === "string") {
			collector.add(`${safeKey}:`);
			addMultiline(collector, value, "  ");
		} else {
			collector.add(`${safeKey}: ${boundedJson(value, DETAIL_MAX_BYTES)}`);
		}
	}
	if (argumentCount === 0) collector.add("(no arguments)");
	collector.add("");
	collector.add("Result");
	let contentCount = 0;
	for (const entry of result.content) {
		if (collector.isCapped()) break;
		contentCount += 1;
		if (entry.type === "text") addMultiline(collector, entry.text);
		else collector.add(`[image ${oneLine(entry.mimeType)}]`);
	}
	if (contentCount === 0) collector.add("(no result content)");
	if (result.details !== undefined && !collector.isCapped()) {
		collector.add("");
		collector.add("Details");
		addMultiline(collector, boundedJson(result.details, DETAIL_MAX_BYTES));
	}
	return collector.finish();
}
