import { createRequire } from "node:module";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { isRuntimeFunction, isRuntimeObject } from "../shared/runtime-type.js";
import { isBidiControl, terminalControlEnd } from "../shared/terminal-text.js";
import { TRANSCRIPT_MARKER } from "./transcript.js";

export interface ThoughtMarkdownTransformContext {
	readonly availableWidth: number;
	readonly isStreaming: boolean;
	readonly messageType: "assistant" | "assistant-thinking" | "user";
}

export type ThoughtMarkdownTransformer = (markdown: string, context: ThoughtMarkdownTransformContext) => string;

interface MarkdownTransformerExtensionAPI {
	registerMarkdownTransformer(transformer: ThoughtMarkdownTransformer): void;
}

interface ProjectedVisualizationBlock {
	readonly firstLine: string;
	readonly language: string;
}

interface FencedVisualizationProjection {
	readonly markdown: string;
	readonly projectedBlocks: readonly ProjectedVisualizationBlock[];
}

type PrepareFencedVisualizations = (
	markdown: string,
	availableWidth: number,
	measureWidth: (value: string) => number,
) => FencedVisualizationProjection;

const requireConversationModule = createRequire(import.meta.url);
let prepareFencedVisualizations: PrepareFencedVisualizations | undefined;

function loadFencedVisualizationProjector(): PrepareFencedVisualizations {
	if (prepareFencedVisualizations) return prepareFencedVisualizations;
	// SAFETY: the fixed repository-owned module is loaded synchronously only after a target fence is detected.
	const loaded = requireConversationModule("./fenced-visualization.ts") as {
		prepareFencedVisualizations?: unknown;
	};
	if (!isRuntimeFunction(loaded.prepareFencedVisualizations)) {
		throw new Error("Pi Stuff fenced visualization projector is unavailable");
	}
	// SAFETY: the runtime check above establishes the fixed owned export is callable.
	prepareFencedVisualizations = loaded.prepareFencedVisualizations as PrepareFencedVisualizations;
	return prepareFencedVisualizations;
}

// U+2217 keeps the asterisk's light visual weight while centering it on the
// text axis; unlike ASCII `*`, it is not Markdown list punctuation.
const THOUGHT_MARKER = "∗";
const FULL_PREFIX = `${THOUGHT_MARKER} thoughts: `;
const COMPACT_PREFIX = `${THOUGHT_MARKER} `;
// Markdown normalizes the source '-' to the transcript's visible U+2022 while
// preserving all nested block structure inside one message-level list item.
const ASSISTANT_LIST_PREFIX = "- ";
const ASSISTANT_LIST_CONTINUATION = "  ";
const ASSISTANT_MARKER_ANCHOR = "\u2060";
const MARKDOWN_CODE_BLOCK_INDENT = "  ";
const MARKDOWN_CODE_BLOCK_INDENT_WIDTH = 2;
const LABEL = `${THOUGHT_MARKER} thoughts:`;
const ELLIPSIS = "…";
const MIDDLE_ELLIPSIS = " … ";
const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
const WORD_SEGMENTER = new Intl.Segmenter("und", { granularity: "word" });
const MEANINGFUL_TEXT = /[\p{L}\p{N}\p{S}]/u;
const LATIN_WORD = /^[\p{Script=Latin}\p{M}\p{N}'’-]+$/u;
const MARKDOWN_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu;
const HEADING = /^(#{1,6})[ \t]+(.*)$/u;
const TRAILING_HEADING_MARKER = /[ \t]+#+[ \t]*$/u;
const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])[ \t]+(.*)$/u;
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const EMPHASIS_MARKERS = ["***", "___", "**", "__", "*", "_"] as const;
const VISUALIZATION_FENCE_CANDIDATE = /(?:^|\r?\n)[ ]{0,3}(?:`{3,}|~{3,})[ \t]*(?:chart|tree)(?=[ \t]*(?:\r?$))/imu;

/** Register the display-only Thought projection through Pi's public Host seam. */
export function registerLiveThoughtDisplay(pi: ExtensionAPI): void {
	if (!hasMarkdownTransformer(pi)) {
		throw new Error("Pi Stuff Live Thoughts require an upstream Pi Host with registerMarkdownTransformer() support");
	}
	pi.registerMarkdownTransformer(createLiveThoughtTransformer());
}

const HOST_THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const PENDING_MARKDOWN_PROJECTION = Symbol.for("@jczhang02/pi-stuff:pending-markdown-projection");

interface PendingMarkdownTheme {
	fg: Theme["fg"];
	[PENDING_MARKDOWN_PROJECTION]?: { restore(): void };
}

function isPendingMarkdownTheme<Value>(value: Value): value is Value & PendingMarkdownTheme {
	return value !== null && isRuntimeObject(value) && "fg" in value && isRuntimeFunction(value.fg);
}

function restorePendingMarkdownThemeProjection(): void {
	const themed: unknown = Object.getOwnPropertyDescriptor(globalThis, HOST_THEME_KEY)?.value;
	if (isPendingMarkdownTheme(themed)) themed[PENDING_MARKDOWN_PROJECTION]?.restore();
}

/**
 * Map the synthetic Assistant marker and visualization code-block borders in one scoped Theme wrapper. Ordinary
 * Markdown paint passes through unchanged. Completion restores synchronously; the microtask covers malformed renders
 * that never consume every armed paint.
 */
function armMarkdownThemeProjection(assistantMarker: boolean, blocks: readonly ProjectedVisualizationBlock[]): void {
	if (!assistantMarker && blocks.length === 0) return;
	const themed: unknown = Object.getOwnPropertyDescriptor(globalThis, HOST_THEME_KEY)?.value;
	if (!isPendingMarkdownTheme(themed) || themed[PENDING_MARKDOWN_PROJECTION]) return;
	const originalFg = themed.fg;
	const border = String.fromCharCode(0x60).repeat(3);
	let markerPending = assistantMarker;
	let activeBlock = false;
	let currentBlock = 0;
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		themed.fg = originalFg;
		delete themed[PENDING_MARKDOWN_PROJECTION];
	};
	const restoreIfComplete = () => {
		if (!markerPending && !activeBlock && currentBlock === blocks.length) restore();
	};
	Object.defineProperty(themed, PENDING_MARKDOWN_PROJECTION, {
		configurable: true,
		value: { restore },
	});
	const wrappedFg: Theme["fg"] = (color, text) => {
		if (markerPending && color === "mdListBullet" && text === ASSISTANT_LIST_PREFIX) {
			markerPending = false;
			const rendered = originalFg.call(themed, color, `${TRANSCRIPT_MARKER} `);
			restoreIfComplete();
			return rendered;
		}
		if (color !== "mdCodeBlockBorder") return originalFg.call(themed, color, text);
		const block = blocks[currentBlock];
		if (!activeBlock && block && text === `${border}${block.language}`) {
			activeBlock = true;
			return originalFg.call(themed, "mdCodeBlock", `${MARKDOWN_CODE_BLOCK_INDENT}${block.firstLine}`);
		}
		if (!activeBlock || text !== border) return originalFg.call(themed, color, text);
		activeBlock = false;
		currentBlock += 1;
		restoreIfComplete();
		return "";
	};
	themed.fg = wrappedFg;
	queueMicrotask(restore);
}

function prepareVisualizationMarkdown(markdown: string, availableWidth: number): FencedVisualizationProjection {
	return loadFencedVisualizationProjector()(
		markdown,
		Math.max(0, availableWidth - MARKDOWN_CODE_BLOCK_INDENT_WIDTH),
		visibleWidth,
	);
}

/** Build the pure projection separately so width and safety behavior can be certified. */
export function createLiveThoughtTransformer(): ThoughtMarkdownTransformer {
	return (markdown, context) => {
		restorePendingMarkdownThemeProjection();
		if (context.messageType === "assistant") return renderAssistantTranscript(markdown, context.availableWidth);
		if (context.messageType === "user") {
			if (!VISUALIZATION_FENCE_CANDIDATE.test(markdown)) return markdown;
			const projection = prepareVisualizationMarkdown(markdown, context.availableWidth);
			armMarkdownThemeProjection(false, projection.projectedBlocks);
			return projection.markdown;
		}
		if (context.messageType !== "assistant-thinking") return markdown;

		const fragment = latestMeaningfulMarkdownFragment(markdown);
		if (!fragment) return "";
		return renderThought(fragment, context.availableWidth);
	};
}

function renderAssistantTranscript(markdown: string, availableWidth: number): string {
	const width = normalizeWidth(availableWidth);
	const visualizationWidth = Math.max(0, width - visibleWidth(ASSISTANT_LIST_PREFIX));
	const fenceDetection = { found: false };
	let sanitized = sanitizeMarkdown(markdown, fenceDetection);
	let projectedBlocks: readonly ProjectedVisualizationBlock[] = [];
	if (fenceDetection.found) {
		const projection = prepareVisualizationMarkdown(markdown, visualizationWidth);
		projectedBlocks = projection.projectedBlocks;
		if (projection.markdown !== markdown) sanitized = sanitizeMarkdown(projection.markdown);
	}
	const text = sanitized.trim();
	if (!text || width === 0) return "";
	if (width <= visibleWidth(ASSISTANT_LIST_PREFIX)) return fitHead(`${ASSISTANT_LIST_PREFIX}${text}`, width);
	armMarkdownThemeProjection(true, projectedBlocks);
	const firstLine = (sanitized.split("\n").find((line) => line.trim()) ?? "").trimEnd();
	if (LIST_ITEM.test(firstLine) && !THEMATIC_BREAK.test(firstLine)) {
		return `${ASSISTANT_LIST_PREFIX}${ASSISTANT_MARKER_ANCHOR}\n${ASSISTANT_LIST_CONTINUATION}${text.replaceAll("\n", `\n${ASSISTANT_LIST_CONTINUATION}`)}`;
	}
	return `${ASSISTANT_LIST_PREFIX}${text.replaceAll("\n", `\n${ASSISTANT_LIST_CONTINUATION}`)}`;
}

function hasMarkdownTransformer(pi: ExtensionAPI): pi is ExtensionAPI & MarkdownTransformerExtensionAPI {
	return "registerMarkdownTransformer" in pi && isRuntimeFunction(pi.registerMarkdownTransformer);
}

function latestMeaningfulMarkdownFragment(markdown: string): string {
	let latest = "";
	for (const block of semanticMarkdownBlocks(sanitizeMarkdown(markdown))) {
		const candidate = sanitizeInline(stripOuterPresentationMarkers(block));
		if (MEANINGFUL_TEXT.test(candidate)) latest = candidate;
	}
	return latest;
}

function semanticMarkdownBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	let currentLines: string[] = [];
	let currentEmphasis: (typeof EMPHASIS_MARKERS)[number] | undefined;

	const flush = () => {
		const block = currentLines.join(" ").trim();
		if (block) blocks.push(block);
		currentLines = [];
		currentEmphasis = undefined;
	};

	for (const rawLine of markdown.split("\n")) {
		const line = rawLine.trim();
		if (!line) {
			flush();
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flush();
			const content = (heading[2] ?? "").replace(TRAILING_HEADING_MARKER, "").trim();
			if (content) blocks.push(content);
			continue;
		}

		const listItem = LIST_ITEM.exec(line);
		if (listItem) {
			flush();
			currentLines = [(listItem[1] ?? "").trim()];
			continue;
		}

		const emphasis = openingEmphasisMarker(line);
		if (emphasis) {
			flush();
			currentLines = [line];
			currentEmphasis = emphasis;
			if (hasClosingEmphasis(line, emphasis)) flush();
			continue;
		}

		currentLines.push(line);
		if (currentEmphasis && hasClosingEmphasis(currentLines.join(" "), currentEmphasis)) flush();
	}

	flush();
	return blocks;
}

function openingEmphasisMarker(text: string): (typeof EMPHASIS_MARKERS)[number] | undefined {
	return EMPHASIS_MARKERS.find((marker) => text.startsWith(marker));
}

function hasClosingEmphasis(text: string, marker: (typeof EMPHASIS_MARKERS)[number]): boolean {
	const content = text.slice(marker.length).trimEnd();
	return content.length > 0 && content.endsWith(marker);
}

function stripOuterPresentationMarkers(value: string): string {
	let text = value.trim();
	const heading = HEADING.exec(text);
	if (heading) text = (heading[2] ?? "").replace(TRAILING_HEADING_MARKER, "").trim();

	const listItem = LIST_ITEM.exec(text);
	if (listItem) text = (listItem[1] ?? "").trim();

	const marker = openingEmphasisMarker(text);
	if (!marker) return text;

	text = text.slice(marker.length).trimStart();
	for (let markerLength = marker.length; markerLength > 0; markerLength -= 1) {
		const partialMarker = marker.slice(0, markerLength);
		if (text.trimEnd().endsWith(partialMarker)) {
			text = text.trimEnd().slice(0, -partialMarker.length).trimEnd();
			break;
		}
	}
	return text;
}

function renderThought(fragment: string, availableWidth: number): string {
	const width = normalizeWidth(availableWidth);
	if (width === 0) return "";

	const fullPrefixWidth = visibleWidth(FULL_PREFIX);
	if (width > fullPrefixWidth) {
		const content = fitFragment(fragment, width - fullPrefixWidth, true);
		if (content) return `${FULL_PREFIX}${escapeMarkdown(content)}`;
	}

	const compactPrefixWidth = visibleWidth(COMPACT_PREFIX);
	if (width > compactPrefixWidth) {
		const content = fitFragment(fragment, width - compactPrefixWidth, true);
		if (content) return `${COMPACT_PREFIX}${escapeMarkdown(content)}`;
	}
	if (width > fullPrefixWidth) {
		const content = fitFragment(fragment, width - fullPrefixWidth, false);
		if (content) return `${FULL_PREFIX}${escapeMarkdown(content)}`;
	}
	if (width > compactPrefixWidth) {
		const content = fitFragment(fragment, width - compactPrefixWidth, false);
		if (content) return `${COMPACT_PREFIX}${escapeMarkdown(content)}`;
	}

	return fitHead(LABEL, width);
}

function normalizeWidth(width: number): number {
	return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}

function fitHead(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	if (width <= visibleWidth(ELLIPSIS)) return firstGrapheme(text, width);

	const budget = width - visibleWidth(ELLIPSIS);
	let result = "";
	let used = 0;
	for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
		const segmentWidth = visibleWidth(segment);
		if (used + segmentWidth > budget) break;
		result += segment;
		used += segmentWidth;
	}
	return `${result}${ELLIPSIS}`;
}

function fitFragment(text: string, width: number, requireNewestTail: boolean): string {
	if (visibleWidth(text) <= width) return text;
	if (width <= 0) return "";

	const segments = [...WORD_SEGMENTER.segment(text)];
	const firstMeaningful = segments.find(({ segment }) => MEANINGFUL_TEXT.test(segment));
	if (!firstMeaningful) return "";

	const prefixEnd = firstMeaningful.index + firstMeaningful.segment.length;
	const prefix = text.slice(0, prefixEnd).trim();
	const tailBudget = width - visibleWidth(prefix) - visibleWidth(MIDDLE_ELLIPSIS);
	if (tailBudget > 0) {
		for (const segment of segments) {
			if (segment.index < prefixEnd || !MEANINGFUL_TEXT.test(segment.segment)) continue;
			const tail = text.slice(segment.index).trim();
			if (visibleWidth(tail) <= tailBudget) return `${prefix}${MIDDLE_ELLIPSIS}${tail}`;
		}
		let finalMeaningful: (typeof segments)[number] | undefined;
		for (let index = segments.length - 1; index >= 0; index -= 1) {
			const segment = segments[index];
			if (segment && MEANINGFUL_TEXT.test(segment.segment)) {
				finalMeaningful = segment;
				break;
			}
		}
		if (
			finalMeaningful &&
			finalMeaningful.index >= prefixEnd &&
			visibleWidth(finalMeaningful.segment) <= tailBudget
		) {
			return `${prefix}${MIDDLE_ELLIPSIS}${finalMeaningful.segment}`;
		}
	}

	if (requireNewestTail) return "";
	if (visibleWidth(prefix) + visibleWidth(ELLIPSIS) <= width) return `${prefix}${ELLIPSIS}`;
	if (LATIN_WORD.test(firstMeaningful.segment)) return "";
	return fitReadableHead(text, width);
}

function fitReadableHead(text: string, width: number): string {
	let result = "";
	let used = 0;
	for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
		const segmentWidth = visibleWidth(segment);
		if (used + segmentWidth > width) break;
		result += segment;
		used += segmentWidth;
	}
	if (!result) return "";
	return used + visibleWidth(ELLIPSIS) <= width ? `${result}${ELLIPSIS}` : result;
}

function firstGrapheme(text: string, width: number): string {
	for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
		return visibleWidth(segment) <= width ? segment : "";
	}
	return "";
}

function escapeMarkdown(text: string): string {
	return text.replace(MARKDOWN_PUNCTUATION, "\\$&");
}

interface VisualizationFenceDetection {
	found: boolean;
}

function sanitizeMarkdown(value: string, fenceDetection?: VisualizationFenceDetection): string {
	const segments: string[] = [];
	let segmentStart = 0;
	let index = 0;
	if (fenceDetection && startsVisualizationFence(value, 0)) fenceDetection.found = true;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (
			code === 0x1b ||
			code === 0x9b ||
			code === 0x90 ||
			code === 0x98 ||
			code === 0x9d ||
			code === 0x9e ||
			code === 0x9f
		) {
			const controlStart = index;
			index = terminalControlEnd(value, index);
			segments.push(value.slice(segmentStart, controlStart));
			segmentStart = index;
			continue;
		}
		if (code === 0x0d) {
			const carriageReturn = index;
			index += value.charCodeAt(index + 1) === 0x0a ? 2 : 1;
			segments.push(value.slice(segmentStart, carriageReturn), "\n");
			segmentStart = index;
			if (fenceDetection && !fenceDetection.found && startsVisualizationFence(value, index)) {
				fenceDetection.found = true;
			}
			continue;
		}
		if (code === 0x0a) {
			index += 1;
			if (fenceDetection && !fenceDetection.found && startsVisualizationFence(value, index)) {
				fenceDetection.found = true;
			}
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || isBidiControl(code)) {
			segments.push(value.slice(segmentStart, index), " ");
			index += 1;
			segmentStart = index;
			continue;
		}
		index += 1;
	}
	if (segments.length === 0) return value;
	segments.push(value.slice(segmentStart));
	return segments.join("");
}

function startsVisualizationFence(value: string, start: number): boolean {
	let index = start;
	let indentation = 0;
	while (value.charCodeAt(index) === 0x20 && indentation < 4) {
		indentation += 1;
		index += 1;
	}
	if (indentation > 3) return false;
	const marker = value.charCodeAt(index);
	if (marker !== 0x60 && marker !== 0x7e) return false;
	let markerLength = 0;
	while (value.charCodeAt(index) === marker) {
		markerLength += 1;
		index += 1;
	}
	if (markerLength < 3) return false;
	while (value.charCodeAt(index) === 0x20 || value.charCodeAt(index) === 0x09) index += 1;
	const languageLength = asciiEqualAt(value, index, "chart") ? 5 : asciiEqualAt(value, index, "tree") ? 4 : 0;
	if (languageLength === 0) return false;
	const boundary = value.charCodeAt(index + languageLength);
	return Number.isNaN(boundary) || boundary === 0x09 || boundary === 0x0a || boundary === 0x0d || boundary === 0x20;
}

function asciiEqualAt(value: string, start: number, expected: string): boolean {
	for (let offset = 0; offset < expected.length; offset += 1) {
		const code = value.charCodeAt(start + offset);
		const lower = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
		if (lower !== expected.charCodeAt(offset)) return false;
	}
	return true;
}

/** Collapse sanitized model text to one printable row. */
function sanitizeInline(value: string): string {
	const text = sanitizeMarkdown(value);
	return text.replaceAll(/\s+/gu, " ").trim();
}
