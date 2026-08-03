import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

export interface ThoughtMarkdownTransformContext {
	readonly availableWidth: number;
	readonly isStreaming: boolean;
	readonly messageType: "assistant" | "assistant-thinking" | "user";
}

export type ThoughtMarkdownTransformer = (markdown: string, context: ThoughtMarkdownTransformContext) => string;

interface MarkdownTransformerExtensionAPI {
	registerMarkdownTransformer(transformer: ThoughtMarkdownTransformer): void;
}

const FULL_PREFIX = "✻ thoughts: ";
const COMPACT_PREFIX = "✻ ";
const LABEL = "✻ thoughts:";
const ELLIPSIS = "…";
const SENTENCE_SEGMENTER = new Intl.Segmenter("und", { granularity: "sentence" });
const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });
const MEANINGFUL_TEXT = /[\p{L}\p{N}\p{S}]/u;
const MARKDOWN_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu;

/** Register the display-only Thought projection through Pi's public Host seam. */
export function registerLiveThoughtDisplay(pi: ExtensionAPI): void {
	if (!hasMarkdownTransformer(pi)) {
		throw new Error("Pi Stuff Live Thoughts require an upstream Pi Host with registerMarkdownTransformer() support");
	}
	pi.registerMarkdownTransformer(createLiveThoughtTransformer());
}

/** Build the pure projection separately so width and safety behavior can be certified. */
export function createLiveThoughtTransformer(): ThoughtMarkdownTransformer {
	return (markdown, context) => {
		if (context.messageType !== "assistant-thinking") return markdown;

		const fragment = latestMeaningfulFragment(sanitizeInline(markdown));
		if (!fragment) return "";
		return renderThought(fragment, context.availableWidth);
	};
}

function hasMarkdownTransformer(pi: ExtensionAPI): pi is ExtensionAPI & MarkdownTransformerExtensionAPI {
	const candidate = pi as ExtensionAPI & Partial<MarkdownTransformerExtensionAPI>;
	return typeof candidate.registerMarkdownTransformer === "function";
}

function latestMeaningfulFragment(text: string): string {
	let latest = "";
	for (const { segment } of SENTENCE_SEGMENTER.segment(text)) {
		const candidate = segment.trim();
		if (MEANINGFUL_TEXT.test(candidate)) latest = candidate;
	}
	return latest;
}

function renderThought(fragment: string, availableWidth: number): string {
	const width = normalizeWidth(availableWidth);
	if (width === 0) return "";

	const fullPrefixWidth = visibleWidth(FULL_PREFIX);
	if (width > fullPrefixWidth) {
		const content = fitTail(fragment, width - fullPrefixWidth);
		if (content) return `${FULL_PREFIX}${escapeMarkdown(content)}`;
	}

	const compactPrefixWidth = visibleWidth(COMPACT_PREFIX);
	if (width > compactPrefixWidth) {
		const content = fitTail(fragment, width - compactPrefixWidth);
		return `${COMPACT_PREFIX}${escapeMarkdown(content)}`;
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

function fitTail(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	if (width <= 0) return "";

	const budget = width - visibleWidth(ELLIPSIS);
	const segments = [...GRAPHEME_SEGMENTER.segment(text)].map(({ segment }) => segment);
	const last = segments.at(-1) ?? "";
	if (budget <= 0) return visibleWidth(last) <= width ? last : "";

	let result = "";
	let used = 0;
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const segment = segments[index];
		if (segment === undefined) continue;
		const segmentWidth = visibleWidth(segment);
		if (used + segmentWidth > budget) break;
		result = `${segment}${result}`;
		used += segmentWidth;
	}
	if (!result) return visibleWidth(last) <= width ? last : "";
	return `${ELLIPSIS}${result.trimStart()}`;
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

/** Remove terminal protocols and collapse real model text to one printable row. */
function sanitizeInline(value: string): string {
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
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || isBidiControl(code)) {
			text += " ";
			index += 1;
			continue;
		}
		text += value[index];
		index += 1;
	}
	return text.replaceAll(/\s+/gu, " ").trim();
}
