import { renderTreeSource } from "./indentation-tree.js";
import { renderChartSource } from "./unicode-chart.js";

const TARGET_FENCE = /(?:^|\n) {0,3}(?:\x60{3,}|~{3,})[\t ]*(?:chart|tree)(?=[\t \r\n]|$)/iu;
const OPENING_FENCE = /^( {0,3})(\x60{3,}|~{3,})[^\S\r\n]*(.*)$/u;
const BACKTICK = String.fromCharCode(0x60);
const MAX_SOURCE_LENGTH = 12_000;

type FenceCharacter = "backtick" | "tilde";
type VisualizationLanguage = "chart" | "tree";

interface Fence {
	readonly character: FenceCharacter;
	readonly length: number;
}

interface OpeningFence {
	readonly fence: Fence;
	readonly indentation: number;
	readonly language: string;
}

/** Project complete chart/tree fences into safe Markdown while preserving canonical source. */
export function projectFencedVisualizations(markdown: string, availableWidth: number): string {
	if (!Number.isFinite(availableWidth) || availableWidth < 1 || !TARGET_FENCE.test(markdown)) return markdown;
	const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
	const lines = markdown.split(/\r?\n/u);
	const output: string[] = [];
	let changed = false;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const opening = parseOpeningFence(line);
		if (!opening) {
			output.push(line);
			continue;
		}

		const close = findClosingFence(lines, index + 1, opening.fence);
		if (close === undefined) {
			output.push(...lines.slice(index));
			break;
		}
		const language = visualizationLanguage(opening.language);
		if (!language) {
			output.push(...lines.slice(index, close + 1));
			index = close;
			continue;
		}

		if (sourceLengthExceedsLimit(lines, index + 1, close)) {
			output.push(...lines.slice(index, close + 1));
			index = close;
			continue;
		}
		const source = lines.slice(index + 1, close).join("\n");
		const width = Math.max(0, Math.floor(availableWidth) - opening.indentation);
		const rendered = sourceIsSafe(source) ? renderVisualization(language, source, width) : [];
		if (rendered.length === 0) {
			output.push(...lines.slice(index, close + 1));
		} else {
			const indentation = " ".repeat(opening.indentation);
			for (const renderedLine of rendered) output.push(`${indentation}${codeSpan(renderedLine)}  `);
			changed = true;
		}
		index = close;
	}
	return changed ? output.join(newline) : markdown;
}

function sourceLengthExceedsLimit(lines: readonly string[], start: number, end: number): boolean {
	let length = Math.max(0, end - start - 1);
	for (let index = start; index < end; index += 1) {
		length += lines[index]?.length ?? 0;
		if (length > MAX_SOURCE_LENGTH) return true;
	}
	return false;
}

function visualizationLanguage(value: string): VisualizationLanguage | undefined {
	if (value === "chart" || value === "tree") return value;
	return undefined;
}

function renderVisualization(language: VisualizationLanguage, source: string, width: number): readonly string[] {
	return language === "chart" ? renderChartSource(source, width) : renderTreeSource(source, width);
}

function parseOpeningFence(line: string): OpeningFence | undefined {
	const match = OPENING_FENCE.exec(line);
	const marker = match?.[2];
	if (!marker) return undefined;
	const character: FenceCharacter = marker.charCodeAt(0) === 0x60 ? "backtick" : "tilde";
	const info = (match[3] ?? "").trim();
	if (character === "backtick" && info.includes(BACKTICK)) return undefined;
	return {
		fence: { character, length: marker.length },
		indentation: match[1]?.length ?? 0,
		language: info.split(/\s+/u, 1)[0]?.toLowerCase() ?? "",
	};
}

function findClosingFence(lines: readonly string[], start: number, fence: Fence): number | undefined {
	const marker = fence.character === "backtick" ? BACKTICK : "~";
	for (let index = start; index < lines.length; index += 1) {
		const trimmed = (lines[index] ?? "").replace(/^ {0,3}/u, "").trimEnd();
		if (trimmed.length < fence.length) continue;
		let valid = true;
		for (const character of trimmed) {
			if (character !== marker) {
				valid = false;
				break;
			}
		}
		if (valid) return index;
	}
	return undefined;
}

function sourceIsSafe(source: string): boolean {
	for (let index = 0; index < source.length; index += 1) {
		const code = source.charCodeAt(index);
		if (
			(code < 0x20 && code !== 0x09 && code !== 0x0a) ||
			(code >= 0x7f && code <= 0x9f) ||
			code === 0x061c ||
			code === 0x200b ||
			code === 0x200e ||
			code === 0x200f ||
			code === 0x2028 ||
			code === 0x2029 ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069) ||
			code === 0xfeff
		) {
			return false;
		}
	}
	return true;
}

function codeSpan(line: string): string {
	const content = line || "\u00a0";
	let longestRun = 0;
	for (const match of content.matchAll(/\x60+/gu)) longestRun = Math.max(longestRun, match[0].length);
	const delimiter = BACKTICK.repeat(longestRun + 1);
	const padding =
		content.startsWith(BACKTICK) || content.endsWith(BACKTICK) || content.startsWith(" ") || content.endsWith(" ")
			? " "
			: "";
	return delimiter + padding + content + padding + delimiter;
}
