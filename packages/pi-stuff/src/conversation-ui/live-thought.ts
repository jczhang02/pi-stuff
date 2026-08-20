import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
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

/** Register the display-only Thought projection through Pi's public Host seam. */
export function registerLiveThoughtDisplay(pi: ExtensionAPI): void {
	if (!hasMarkdownTransformer(pi)) {
		throw new Error("Pi Stuff Live Thoughts require an upstream Pi Host with registerMarkdownTransformer() support");
	}
	pi.registerMarkdownTransformer(createLiveThoughtTransformer());
}

const HOST_THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const PENDING_ASSISTANT_MARKER = Symbol.for("@jczhang02/pi-stuff:pending-assistant-marker");

type PendingAssistantMarkerTheme = Theme & {
	[PENDING_ASSISTANT_MARKER]?: { restore(): void };
};

/**
 * Host Markdown normalizes every unordered-list source marker to `-`. Arm only
 * the next list-marker paint, which is the synthetic outer item returned by
 * renderAssistantTranscript(). The wrapper restores itself before nested
 * Markdown markers render; the microtask is a safety fallback for malformed or
 * extremely narrow projections that never reach a list marker.
 */
function armAssistantTranscriptMarker(): void {
	const themed = (globalThis as Record<symbol, unknown>)[HOST_THEME_KEY] as PendingAssistantMarkerTheme | undefined;
	if (!themed || typeof themed.fg !== "function" || themed[PENDING_ASSISTANT_MARKER]) return;
	const originalFg = themed.fg;
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		themed.fg = originalFg;
		delete themed[PENDING_ASSISTANT_MARKER];
	};
	Object.defineProperty(themed, PENDING_ASSISTANT_MARKER, {
		configurable: true,
		value: { restore },
	});
	themed.fg = ((color, text) => {
		if (color !== "mdListBullet" || text !== ASSISTANT_LIST_PREFIX) {
			return originalFg.call(themed, color, text);
		}
		restore();
		return originalFg.call(themed, color, `${TRANSCRIPT_MARKER} `);
	}) as Theme["fg"];
	queueMicrotask(restore);
}

/** Build the pure projection separately so width and safety behavior can be certified. */
export function createLiveThoughtTransformer(): ThoughtMarkdownTransformer {
	return (markdown, context) => {
		if (context.messageType === "assistant") return renderAssistantTranscript(markdown, context.availableWidth);
		if (context.messageType !== "assistant-thinking") return markdown;

		const fragment = latestMeaningfulMarkdownFragment(markdown);
		if (!fragment) return "";
		return renderThought(fragment, context.availableWidth);
	};
}

function renderAssistantTranscript(markdown: string, availableWidth: number): string {
	const sanitized = sanitizeMarkdown(markdown);
	const text = sanitized.trim();
	const width = normalizeWidth(availableWidth);
	if (!text || width === 0) return "";
	if (width <= visibleWidth(ASSISTANT_LIST_PREFIX)) return fitHead(`${ASSISTANT_LIST_PREFIX}${text}`, width);
	armAssistantTranscriptMarker();
	const firstLine = (sanitized.split("\n").find((line) => line.trim()) ?? "").trimEnd();
	if (LIST_ITEM.test(firstLine) && !THEMATIC_BREAK.test(firstLine)) {
		return `${ASSISTANT_LIST_PREFIX}${ASSISTANT_MARKER_ANCHOR}\n${ASSISTANT_LIST_CONTINUATION}${text.replaceAll("\n", `\n${ASSISTANT_LIST_CONTINUATION}`)}`;
	}
	return `${ASSISTANT_LIST_PREFIX}${text.replaceAll("\n", `\n${ASSISTANT_LIST_CONTINUATION}`)}`;
}

function hasMarkdownTransformer(pi: ExtensionAPI): pi is ExtensionAPI & MarkdownTransformerExtensionAPI {
	const candidate = pi as ExtensionAPI & Partial<MarkdownTransformerExtensionAPI>;
	return typeof candidate.registerMarkdownTransformer === "function";
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

function isBidiControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200b ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069) ||
		code === 0xfeff
	);
}

function skipControlSequence(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		index += 1;
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x07 || code === 0x9c) return index + 1;
		if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index += 1;
	}
	return index;
}

function sanitizeMarkdown(value: string): string {
	let text = "";
	let index = 0;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = value.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index = skipControlSequence(value, index + 2);
				continue;
			}
			if (
				introducer === 0x5d ||
				introducer === 0x50 ||
				introducer === 0x58 ||
				introducer === 0x5e ||
				introducer === 0x5f
			) {
				index = skipControlString(value, index + 2);
				continue;
			}
			index += 1;
			while (index < value.length) {
				const intermediate = value.charCodeAt(index);
				if (intermediate < 0x20 || intermediate > 0x2f) break;
				index += 1;
			}
			if (index < value.length) index += 1;
			continue;
		}
		if (code === 0x9b) {
			index = skipControlSequence(value, index + 1);
			continue;
		}
		if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (code === 0x0d) {
			text += "\n";
			index += value.charCodeAt(index + 1) === 0x0a ? 2 : 1;
			continue;
		}
		if (code === 0x0a) {
			text += "\n";
			index += 1;
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || isBidiControl(code)) {
			text += " ";
			index += 1;
			continue;
		}
		text += value[index];
		index += 1;
	}
	return text;
}

/** Collapse sanitized model text to one printable row. */
function sanitizeInline(value: string): string {
	const text = sanitizeMarkdown(value);
	return text.replaceAll(/\s+/gu, " ").trim();
}
