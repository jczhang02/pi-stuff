import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	SELF_RENDERED_TRANSCRIPT_PADDING,
	TRANSCRIPT_CONTINUATION,
	TRANSCRIPT_MARKER,
} from "../conversation-ui/transcript.js";
import type { ToolActivityOutcome } from "./activity.js";
import type { ToolActivityState } from "./activity-store.js";
import {
	boundTerminalText,
	graphemePrefix,
	graphemeSuffix,
	sanitizeTerminalText,
	truncateUtf8Graphemes,
} from "./terminal.js";

export { sanitizeTerminalText } from "./terminal.js";

const DETAIL_MAX_BYTES = 24 * 1024;
const DETAIL_MAX_LINES = 240;
const DETAIL_RAW_SCAN_FACTOR = 4;
const ROW_PREVIEW_MAX_BYTES = 4 * 1024;
const ROW_PREVIEW_MAX_CODE_UNITS = 8 * 1024;
const SUMMARY_TEXT_MAX_CODE_UNITS = 64 * 1024;

const MAX_ROW_CACHE_WIDTHS = 6;
const MAX_TRUNCATED_SUMMARY_WIDTH = 12;
const MIN_TRUNCATED_LABEL_WIDTH = 4;
const MIN_TRUNCATED_SUMMARY_WIDTH = 6;
const MIN_TRUNCATED_TARGET_WIDTH = 8;
const MIN_LATIN_PARTIAL_UNIT = 3;
const MIN_COMPACT_PARTIAL_UNIT = 2;
const SELF_RENDERED_TRANSCRIPT_GUTTER = " ".repeat(SELF_RENDERED_TRANSCRIPT_PADDING);

export interface ToolRowModel {
	readonly kind?: "tool";
	readonly durationMs: number | undefined;
	readonly label: string;
	readonly state: ToolActivityState;
	readonly summary: string;
	readonly target: string;
}

export interface ActivityGroupRowModel {
	readonly active: boolean;
	readonly expandable: boolean;
	readonly hint: string;
	readonly kind: "activity";
	readonly outcome: ToolActivityOutcome;
	readonly summary: string;
}

export interface BashOperationRowModel {
	readonly active: boolean;
	readonly command: string;
	readonly expandable: boolean;
	readonly expanded: boolean;
	readonly kind: "bash-operation";
	readonly output: string;
	readonly state: ToolActivityState;
}

export type ToolTranscriptRowModel = ActivityGroupRowModel | BashOperationRowModel | ToolRowModel;

export class EmptyToolComponent implements Component {
	invalidate(): void {}

	render(): string[] {
		return [];
	}
}

function sameModel(left: ToolTranscriptRowModel, right: ToolTranscriptRowModel): boolean {
	if (left.kind === "bash-operation" || right.kind === "bash-operation") {
		return (
			left.kind === "bash-operation" &&
			right.kind === "bash-operation" &&
			left.active === right.active &&
			left.command === right.command &&
			left.expandable === right.expandable &&
			left.expanded === right.expanded &&
			left.output === right.output &&
			left.state === right.state
		);
	}
	if (left.kind === "activity" || right.kind === "activity") {
		return (
			left.kind === "activity" &&
			right.kind === "activity" &&
			left.active === right.active &&
			left.expandable === right.expandable &&
			left.hint === right.hint &&
			left.outcome === right.outcome &&
			left.summary === right.summary
		);
	}
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
	private markerVisible = true;
	private model: ToolTranscriptRowModel;
	private readonly theme: Theme;
	private visible = true;

	constructor(theme: Theme, model: ToolTranscriptRowModel) {
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
		const rendered =
			this.model.kind === "activity"
				? renderActivityGroupRow(this.model, this.theme, normalizedWidth, this.markerVisible)
				: this.model.kind === "bash-operation"
					? renderBashOperationRow(this.model, this.theme, normalizedWidth, this.markerVisible)
					: [renderToolRow(this.model, this.theme, normalizedWidth, this.markerVisible)];
		this.computationCountValue += 1;
		this.cache.set(normalizedWidth, rendered);
		while (this.cache.size > MAX_ROW_CACHE_WIDTHS) {
			const oldest = this.cache.keys().next().value as number | undefined;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
		}
		return rendered;
	}

	setModel(model: ToolTranscriptRowModel): boolean {
		if (sameModel(this.model, model)) return false;
		this.model = model;
		this.cache.clear();
		return true;
	}

	setMarkerVisible(visible: boolean): boolean {
		if (this.markerVisible === visible) return false;
		this.markerVisible = visible;
		this.cache.clear();
		return true;
	}

	setVisible(visible: boolean): boolean {
		if (this.visible === visible) return false;
		this.visible = visible;
		this.cache.clear();
		return true;
	}
}

const CONTROL_STATE_GLYPH = "●";

/** Non-transcript controls retain their larger state glyph. */
export function toolStateGlyph(_state: ToolActivityOutcome | ToolActivityState): string {
	return CONTROL_STATE_GLYPH;
}

function styleState(theme: Theme, state: ToolActivityState, text: string): string {
	switch (state) {
		case "running":
			return theme.fg("muted", text);
		case "success":
			return theme.fg("success", text);
		case "error":
			return theme.fg("error", text);
		case "rejected":
		case "cancelled":
			return theme.fg("warning", text);
	}
}

const ACTIVITY_HINT_MAX_WIDTH = 160;
const BASH_COMMAND_MAX_CODE_UNITS = 160;
const BASH_COMMAND_MAX_LINES = 2;
const BASH_OUTPUT_PREVIEW_LINES = 3;

function activityMarkerColor(outcome: ToolActivityOutcome): "error" | "muted" | "success" | "warning" {
	if (outcome === "error") return "error";
	if (outcome === "success") return "success";
	if (outcome === "warning") return "warning";
	return "muted";
}

function renderActivityGroupRow(
	model: ActivityGroupRowModel,
	theme: Theme,
	width: number,
	markerVisible: boolean,
): string[] {
	if (!model.summary) return [];
	const marker = model.active && !markerVisible ? " " : TRANSCRIPT_MARKER;
	const markerSlot = `${SELF_RENDERED_TRANSCRIPT_GUTTER}${theme.fg(activityMarkerColor(model.outcome), marker)} `;
	const summary = theme.fg(model.active ? "text" : "muted", model.summary);
	const progress = model.active ? theme.fg("dim", "…") : "";
	const expandHint = model.expandable ? theme.fg("dim", "  (ctrl+o to expand)") : "";
	const contentWidth = Math.max(1, width - visibleWidth(markerSlot));
	const wrapped = wrapTextWithAnsi(`${summary}${progress}${expandHint}`, contentWidth);
	const continuationPrefix = `${SELF_RENDERED_TRANSCRIPT_GUTTER}${TRANSCRIPT_CONTINUATION}`;
	const lines = wrapped.map((line, index) => `${index === 0 ? markerSlot : continuationPrefix}${line}`);
	const safeHint = truncateToWidth(oneLine(model.hint), ACTIVITY_HINT_MAX_WIDTH, "…");
	if (!safeHint) return lines;
	const hintPrefix = `${continuationPrefix}⎿ `;
	const hintWidth = Math.max(1, width - visibleWidth(hintPrefix));
	const hintLines = wrapTextWithAnsi(theme.fg("dim", safeHint), hintWidth).slice(0, 2);
	const hintContinuation = " ".repeat(visibleWidth(hintPrefix));
	for (const [index, line] of hintLines.entries()) {
		lines.push(`${index === 0 ? hintPrefix : hintContinuation}${line}`);
	}
	return lines;
}

function bashCommandLines(command: string, expanded: boolean): string[] {
	const maximumCodeUnits = expanded ? ROW_PREVIEW_MAX_CODE_UNITS : BASH_COMMAND_MAX_CODE_UNITS;
	const maximumLines = expanded ? DETAIL_MAX_LINES : BASH_COMMAND_MAX_LINES;
	const safe = boundTerminalText(command, maximumCodeUnits + 1, "").trim();
	const clipped = graphemePrefix(safe, maximumCodeUnits);
	const truncatedByCodeUnits = clipped.length < safe.length;
	const sourceLines = clipped.split("\n");
	const truncatedByLines = sourceLines.length > maximumLines;
	const lines = sourceLines.slice(0, maximumLines);
	if (lines.length === 0) lines.push("");
	if (truncatedByCodeUnits || truncatedByLines) {
		const last = lines.length - 1;
		lines[last] = `${lines[last]?.trimEnd() ?? ""}…`;
	}
	const last = lines.length - 1;
	lines[last] = `${lines[last] ?? ""})`;
	return lines;
}

function bashOutputLines(model: BashOperationRowModel): { readonly hidden: number; readonly lines: string[] } {
	const normalized = boundTerminalText(model.output, ROW_PREVIEW_MAX_CODE_UNITS, "")
		.replaceAll("\r", "")
		.split("\n", DETAIL_MAX_LINES + 1)
		.slice(0, DETAIL_MAX_LINES)
		.join("\n")
		.trim();
	if (!normalized || normalized === "(no output)") {
		return { hidden: 0, lines: [model.active ? "Running…" : "(No output)"] };
	}
	let lines = normalized.split("\n");
	if (model.state === "rejected") {
		lines = ["Rejected", ...lines];
		const visible = model.expanded ? lines : lines.slice(0, BASH_OUTPUT_PREVIEW_LINES);
		return {
			hidden: model.expanded ? 0 : Math.max(0, lines.length - visible.length),
			lines: visible,
		};
	}
	if (model.state === "cancelled" && !lines.some((line) => /\b(?:interrupt|abort|cancel)/iu.test(line))) {
		lines.unshift("Interrupted");
	}
	const terminal = lines.at(-1)?.trim() ?? "";
	const exit = /^Command exited with code (\d+)$/u.exec(terminal);
	if (exit) {
		lines = lines.slice(0, -1);
		while (lines.at(-1)?.trim() === "") lines.pop();
		lines.unshift(`Error: Exit code ${exit[1] ?? "?"}`);
	} else if (terminal === "Command aborted" || /^Command timed out/u.test(terminal)) {
		lines = lines.slice(0, -1);
		while (lines.at(-1)?.trim() === "") lines.pop();
		lines.unshift(terminal === "Command aborted" ? "Interrupted" : `Error: ${terminal}`);
	}
	const hidden = model.expanded ? 0 : Math.max(0, lines.length - BASH_OUTPUT_PREVIEW_LINES);
	return { hidden, lines: model.expanded ? lines : lines.slice(0, BASH_OUTPUT_PREVIEW_LINES) };
}

function renderBashOperationRow(
	model: BashOperationRowModel,
	theme: Theme,
	width: number,
	markerVisible: boolean,
): string[] {
	const marker = model.active && !markerVisible ? " " : TRANSCRIPT_MARKER;
	const markerSlot = `${SELF_RENDERED_TRANSCRIPT_GUTTER}${styleState(theme, model.state, marker)} `;
	const label = "Bash";
	const headerPrefix = `${markerSlot}${theme.bold(label)}(`;
	const continuationPrefix = `${SELF_RENDERED_TRANSCRIPT_GUTTER}${" ".repeat(visibleWidth(label) + 1)}`;
	const commandLines = bashCommandLines(model.command, model.expanded);
	const rendered: string[] = [];
	for (const [index, sourceLine] of commandLines.entries()) {
		const prefix = index === 0 ? headerPrefix : continuationPrefix;
		const available = Math.max(1, width - visibleWidth(prefix));
		const wrapped = wrapTextWithAnsi(theme.fg("text", sourceLine), available);
		for (const [wrapIndex, line] of wrapped.entries()) {
			rendered.push(`${wrapIndex === 0 ? prefix : continuationPrefix}${line}`);
		}
	}
	const preview = bashOutputLines(model);
	// Pi's self-rendered Tool row already follows the one-cell Host outputPad. Bash
	// child rows use Claude's own two-cell operation gutter so their connector and
	// text origins match the reference even though Pi Stuff keeps its accepted `•`.
	const outputPrefix = theme.fg("muted", `${TRANSCRIPT_CONTINUATION}⎿  `);
	const outputContinuation = `${SELF_RENDERED_TRANSCRIPT_GUTTER}${TRANSCRIPT_CONTINUATION}${" ".repeat(visibleWidth("⎿ "))}`;
	const outputWidth = Math.max(1, width - visibleWidth(outputPrefix));
	for (const [index, outputLine] of preview.lines.entries()) {
		const colored = theme.fg(
			model.state !== "success" && model.state !== "running"
				? model.state === "error"
					? "error"
					: "warning"
				: model.active
					? "muted"
					: outputLine === "(No output)"
						? "muted"
						: "text",
			outputLine,
		);
		const wrapped = wrapTextWithAnsi(colored, outputWidth);
		for (const [wrapIndex, line] of wrapped.entries()) {
			rendered.push(`${index === 0 && wrapIndex === 0 ? outputPrefix : outputContinuation}${line}`);
		}
	}
	if (preview.hidden > 0) {
		const hint = model.expandable ? " (ctrl+o to expand)" : "";
		rendered.push(`${outputContinuation}${theme.fg("dim", `… +${String(preview.hidden)} lines${hint}`)}`);
	}
	return rendered.map((line) => truncateToWidth(line, width, "…"));
}

function fitIdentity(markerSlot: string, label: string, width: number): string {
	const markerWidth = visibleWidth(markerSlot);
	if (width <= markerWidth) return truncateToWidth(markerSlot, width, "");
	return `${markerSlot}${truncateToWidth(label, width - markerWidth, "…")}`;
}

function fitIdentityAndSummary(markerSlot: string, label: string, summary: string, width: number): string {
	const markerWidth = visibleWidth(markerSlot);
	const separator = " · ";
	const separatorWidth = visibleWidth(separator);
	const available = width - markerWidth - separatorWidth;
	if (available <= 1) return fitIdentity(markerSlot, label, width);

	const summaryWidth = visibleWidth(summary);
	const minimumSummaryWidth = Math.min(summaryWidth, MIN_TRUNCATED_SUMMARY_WIDTH);
	const labelFloor = Math.min(MIN_TRUNCATED_LABEL_WIDTH, Math.max(1, available - minimumSummaryWidth));
	const maximumSummaryWidth = available - labelFloor;
	if (maximumSummaryWidth < minimumSummaryWidth) return fitIdentity(markerSlot, label, width);

	const summaryBudget = Math.min(summaryWidth, MAX_TRUNCATED_SUMMARY_WIDTH, maximumSummaryWidth);
	const fittedSummary = truncateToWidth(summary, summaryBudget, "…");
	const labelBudget = Math.max(1, available - visibleWidth(fittedSummary));
	return `${markerSlot}${truncateToWidth(label, labelBudget, "…")}${separator}${fittedSummary}`;
}

function semanticCharacters(value: string): string[] {
	return value.match(/[\p{L}\p{N}\p{Extended_Pictographic}]/gu) ?? [];
}

function isCompactSemanticCharacter(value: string): boolean {
	return /[\p{Script=Han}\p{Extended_Pictographic}]/u.test(value);
}

function removeDanglingShellBoundary(value: string): string {
	return value
		.replaceAll(/\s+/gu, " ")
		.trimEnd()
		.replace(/(?:\s*(?:\|\||&&|[|&;]))+$/u, "")
		.trimEnd();
}

/** Truncate only after a recognizable unit; otherwise omit the optional target. */
function fitOptionalTarget(targetPart: string, width: number): string {
	const budget = Math.max(0, Math.floor(width));
	if (budget < MIN_TRUNCATED_TARGET_WIDTH) return "";
	if (visibleWidth(targetPart) <= budget) return targetPart;
	const plain = sanitizeTerminalText(targetPart);
	let prefix = sanitizeTerminalText(truncateToWidth(plain, Math.max(0, budget - visibleWidth("…")), "")).trimEnd();
	if (!prefix) return "";

	const next = plain.slice(prefix.length).at(0);
	const last = prefix.at(-1);
	const delimiter = /[\s/|&;,:=()[\]{}<>]/u;
	if (next && last && !delimiter.test(last) && !delimiter.test(next)) {
		let tokenStart = prefix.length;
		while (tokenStart > 0 && !delimiter.test(prefix[tokenStart - 1] ?? "")) tokenStart -= 1;
		const token = prefix.slice(tokenStart);
		const semantic = semanticCharacters(token);
		const compact = semantic.length > 0 && semantic.every(isCompactSemanticCharacter);
		const minimum = compact ? MIN_COMPACT_PARTIAL_UNIT : MIN_LATIN_PARTIAL_UNIT;
		if (semantic.length < minimum) prefix = prefix.slice(0, tokenStart);
	}

	prefix = removeDanglingShellBoundary(prefix);
	const meaningfulUnits = prefix.match(/[\p{L}\p{N}\p{Extended_Pictographic}]+/gu) ?? [];
	if (!meaningfulUnits.some((unit) => semanticCharacters(unit).length >= MIN_COMPACT_PARTIAL_UNIT)) return "";
	return truncateToWidth(targetPart, Math.min(budget, visibleWidth(prefix) + visibleWidth("…")), "…");
}

/** Fit one Tool row with identity first, result second, and optional target last. */
function fitToolRowParts(markerSlot: string, label: string, target: string, summary: string, width: number): string {
	const identity = `${markerSlot}${label}`;
	if (visibleWidth(identity) >= width) {
		return summary ? fitIdentityAndSummary(markerSlot, label, summary, width) : fitIdentity(markerSlot, label, width);
	}

	const targetPart = target ? ` ${target}` : "";
	const summaryPart = summary ? ` · ${summary}` : "";
	const full = `${identity}${targetPart}${summaryPart}`;
	if (visibleWidth(full) <= width) return full;

	const remaining = width - visibleWidth(identity);
	if (!summary) return `${identity}${fitOptionalTarget(targetPart, remaining)}`;

	const summarySeparator = " · ";
	const separatorWidth = visibleWidth(summarySeparator);
	if (remaining <= separatorWidth) return fitIdentityAndSummary(markerSlot, label, summary, width);
	const fullSummaryPart = `${summarySeparator}${summary}`;
	const fullSummaryWidth = visibleWidth(fullSummaryPart);
	if (fullSummaryWidth > remaining) return fitIdentityAndSummary(markerSlot, label, summary, width);

	const targetBudget = remaining - fullSummaryWidth;
	// A tiny path fragment adds noise and can visually bind its ellipsis to the
	// independently-owned result. Keep the result boundary and omit the optional
	// target until there is room for a recognisable fragment.
	const fittedTarget = fitOptionalTarget(targetPart, targetBudget);
	return `${identity}${fittedTarget}${fullSummaryPart}`;
}

function renderToolRow(model: ToolRowModel, theme: Theme, width: number, markerVisible: boolean): string {
	const marker = model.state === "running" && !markerVisible ? " " : TRANSCRIPT_MARKER;
	const markerSlot = `${SELF_RENDERED_TRANSCRIPT_GUTTER}${styleState(theme, model.state, marker)} `;
	const safeLabel = oneLine(model.label);
	const safeTarget = oneLine(model.target);
	const safeSummary = oneLine(model.summary);
	const label = theme.fg("toolTitle", theme.bold(safeLabel));
	const target = safeTarget ? theme.fg("muted", safeTarget) : "";
	const summary =
		model.state === "success" ? theme.fg("muted", safeSummary) : styleState(theme, model.state, safeSummary);
	return fitToolRowParts(markerSlot, label, target, summary, width);
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

export function oneLine(value: string): string {
	const normalized = sanitizeTerminalText(value).replace(/\s+/gu, " ").trim();
	const raw = graphemePrefix(normalized, ROW_PREVIEW_MAX_CODE_UNITS);
	const clipped = raw.length < normalized.length;
	const suffix = clipped ? "…" : "";
	return truncateUtf8Graphemes(`${raw}${suffix}`, ROW_PREVIEW_MAX_BYTES);
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
		const next = graphemePrefix(text, remaining);
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
			const slice = graphemePrefix(candidate, Math.max(0, remaining - 2));
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
		if (typeof candidate !== "object") {
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
	const rawChunkLimit = Math.max(1_024, DETAIL_MAX_BYTES * DETAIL_RAW_SCAN_FACTOR);
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
