import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	SELF_RENDERED_TRANSCRIPT_PADDING,
	TRANSCRIPT_CONTINUATION,
	TRANSCRIPT_MARKER,
} from "../conversation-ui/transcript.js";
import type { ToolActivityState } from "./activity-store.js";
import { ROW_PREVIEW_CODE_UNIT_LIMIT } from "./limits.js";
import { boundTerminalText, graphemePrefix } from "./terminal.js";

const COMPACT_IDENTITY_CODE_UNITS = 160;
const COMPACT_IDENTITY_LINES = 2;
const GUTTER = " ".repeat(SELF_RENDERED_TRANSCRIPT_PADDING);

export interface OperationEvidenceLine {
	readonly diffKind?: "add" | "context" | "delete";
	readonly kind: "diff" | "meta" | "outcome" | "source";
	readonly newLine?: number;
	readonly oldLine?: number;
	readonly text: string;
	readonly tone?: "error" | "muted" | "success" | "warning";
}

export interface OperationBlockRowModel {
	readonly active: boolean;
	readonly evidence: readonly OperationEvidenceLine[];
	readonly expandable: boolean;
	readonly expanded: boolean;
	readonly identity: string;
	readonly identityCodeUnits?: number;
	readonly identityLineLimit?: number;
	readonly identityMultiline?: boolean;
	readonly kind: "operation-block";
	readonly label: string;
	readonly languagePath?: string;
	readonly state: ToolActivityState;
}

export function sameOperationBlock(left: OperationBlockRowModel, right: OperationBlockRowModel): boolean {
	return (
		left.active === right.active &&
		left.expandable === right.expandable &&
		left.expanded === right.expanded &&
		left.identity === right.identity &&
		left.identityCodeUnits === right.identityCodeUnits &&
		left.identityLineLimit === right.identityLineLimit &&
		left.identityMultiline === right.identityMultiline &&
		left.label === right.label &&
		left.languagePath === right.languagePath &&
		left.state === right.state &&
		left.evidence.length === right.evidence.length &&
		left.evidence.every((line, index) => {
			const other = right.evidence[index];
			return (
				other !== undefined &&
				line.diffKind === other.diffKind &&
				line.kind === other.kind &&
				line.newLine === other.newLine &&
				line.oldLine === other.oldLine &&
				line.text === other.text &&
				line.tone === other.tone
			);
		})
	);
}

function stateColor(state: ToolActivityState): "error" | "muted" | "success" | "warning" {
	if (state === "error") return "error";
	if (state === "rejected" || state === "cancelled") return "warning";
	if (state === "success") return "success";
	return "muted";
}

function identityLines(model: OperationBlockRowModel): string[] {
	const maximumCodeUnits =
		model.identityCodeUnits ?? (model.expanded ? ROW_PREVIEW_CODE_UNIT_LIMIT : COMPACT_IDENTITY_CODE_UNITS);
	const maximumLines = model.identityMultiline
		? model.expanded
			? (model.identityLineLimit ?? 240)
			: COMPACT_IDENTITY_LINES
		: 1;
	const safe = boundTerminalText(model.identity, maximumCodeUnits + 1, "").trim();
	const clipped = graphemePrefix(safe, maximumCodeUnits);
	const source = clipped.split("\n");
	const lines = source.slice(0, maximumLines);
	if (lines.length === 0) lines.push("");
	if (clipped.length < safe.length || source.length > maximumLines) {
		const last = lines.length - 1;
		lines[last] = `${lines[last]?.trimEnd() ?? ""}…`;
	}
	const last = lines.length - 1;
	lines[last] = `${lines[last] ?? ""})`;
	return lines;
}

function highlightedEvidence(model: OperationBlockRowModel): string[] {
	const source = model.evidence.filter((line) => line.kind === "source" || line.kind === "diff");
	const language = model.languagePath ? getLanguageFromPath(model.languagePath) : undefined;
	if (!language || source.length === 0) return source.map((line) => line.text);
	return highlightCode(source.map((line) => line.text).join("\n"), language);
}

function lineNumberWidth(model: OperationBlockRowModel): number {
	let maximum = 1;
	for (const line of model.evidence) maximum = Math.max(maximum, line.oldLine ?? 0, line.newLine ?? 0);
	return String(maximum).length;
}

function renderEvidence(
	model: OperationBlockRowModel,
	theme: Theme,
	width: number,
	firstPrefix: string,
	continuationPrefix: string,
): string[] {
	const rendered: string[] = [];
	const highlighted = highlightedEvidence(model);
	const numberWidth = lineNumberWidth(model);
	let sourceIndex = 0;
	for (const [index, line] of model.evidence.entries()) {
		const prefix = index === 0 ? firstPrefix : continuationPrefix;
		const available = Math.max(1, width - visibleWidth(prefix));
		let content: string;
		if (line.kind === "source") {
			const number = String(line.newLine ?? line.oldLine ?? "").padStart(numberWidth);
			const gutter = theme.fg("dim", `${number} │ `);
			content = `${gutter}${highlighted[sourceIndex] ?? line.text}`;
			sourceIndex += 1;
		} else if (line.kind === "diff") {
			const oldLine = String(line.oldLine ?? "").padStart(numberWidth);
			const newLine = String(line.newLine ?? "").padStart(numberWidth);
			const marker = line.diffKind === "add" ? "+" : line.diffKind === "delete" ? "-" : " ";
			const markerColor = marker === "+" ? "success" : marker === "-" ? "error" : "dim";
			content = `${theme.fg("dim", `${oldLine} ${newLine} │ `)}${theme.fg(markerColor, marker)} ${highlighted[sourceIndex] ?? line.text}`;
			sourceIndex += 1;
		} else {
			const color = line.tone ?? (line.kind === "outcome" ? stateColor(model.state) : "muted");
			content = theme.fg(color, line.text);
		}
		const wrapped = wrapTextWithAnsi(content, available);
		for (const [wrapIndex, value] of wrapped.entries()) {
			rendered.push(`${wrapIndex === 0 ? prefix : continuationPrefix}${value}`);
		}
	}
	return rendered;
}

export function renderOperationBlockRow(
	model: OperationBlockRowModel,
	theme: Theme,
	width: number,
	markerVisible: boolean,
): string[] {
	const marker = model.active && !markerVisible ? " " : TRANSCRIPT_MARKER;
	const markerSlot = `${GUTTER}${theme.fg(stateColor(model.state), marker)} `;
	const headerPrefix = `${markerSlot}${theme.bold(model.label)}(`;
	const continuationPrefix = `${GUTTER}${" ".repeat(visibleWidth(model.label) + 1)}`;
	const rendered: string[] = [];
	for (const [index, sourceLine] of identityLines(model).entries()) {
		const prefix = index === 0 ? headerPrefix : continuationPrefix;
		const available = Math.max(1, width - visibleWidth(prefix));
		const wrapped = wrapTextWithAnsi(theme.fg("text", sourceLine), available);
		for (const [wrapIndex, line] of wrapped.entries()) {
			rendered.push(`${wrapIndex === 0 ? prefix : continuationPrefix}${line}`);
		}
	}
	const childPrefix = theme.fg("muted", `${TRANSCRIPT_CONTINUATION}⎿  `);
	const childContinuation = `${GUTTER}${TRANSCRIPT_CONTINUATION}${" ".repeat(visibleWidth("⎿ "))}`;
	rendered.push(...renderEvidence(model, theme, width, childPrefix, childContinuation));
	return rendered.map((line) => truncateToWidth(line, width, "…"));
}
