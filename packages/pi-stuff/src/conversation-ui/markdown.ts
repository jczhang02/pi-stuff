import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

function markdownTheme(theme: Theme): MarkdownTheme {
	return {
		heading: (text) => theme.fg("text", theme.bold(text)),
		link: (text) => theme.fg("accent", text),
		linkUrl: (text) => theme.fg("dim", text),
		code: (text) => theme.fg("accent", text),
		codeBlock: (text) => theme.fg("text", text),
		codeBlockBorder: (text) => theme.fg("borderMuted", text),
		quote: (text) => theme.fg("muted", text),
		quoteBorder: (text) => theme.fg("borderMuted", text),
		hr: (text) => theme.fg("border", text),
		listBullet: (text) => theme.fg("accent", text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		strikethrough: (text) => theme.strikethrough(text),
		underline: (text) => theme.underline(text),
	};
}

/** Create the shared Pi-theme Markdown renderer used by conversation-adjacent surfaces. */
export function createMarkdownRenderer(theme: Theme): Markdown {
	return new Markdown("", 0, 0, markdownTheme(theme));
}
