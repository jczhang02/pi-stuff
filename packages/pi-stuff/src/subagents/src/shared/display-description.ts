import { truncateToWidth } from "@earendil-works/pi-tui";

const MAX_DISPLAY_DESCRIPTION_WIDTH = 60;
const MAX_DISPLAY_SOURCE_CODE_UNITS = 4_096;
const PATH_TOKEN = /(?:\.{1,2}\/|\/)[^\s"'`<>|,，;；:：!?！？()[\]{}]+/gu;

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

function skipControlSequence(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index++);
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function isBidiFormatControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}

function oneLine(value: string): string {
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
			if ([0x5d, 0x50, 0x58, 0x5e, 0x5f].includes(introducer)) {
				index = skipControlString(value, index + 2);
				continue;
			}
			index += 1;
			while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) {
				index += 1;
			}
			if (index < value.length) index += 1;
			continue;
		}
		if (code === 0x9b) {
			index = skipControlSequence(value, index + 1);
			continue;
		}
		if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			if ([0x09, 0x0a, 0x0b, 0x0c, 0x0d].includes(code)) text += " ";
			index += 1;
			continue;
		}
		if (isBidiFormatControl(code)) {
			index += 1;
			continue;
		}
		const point = value.codePointAt(index);
		if (point === undefined) break;
		text += String.fromCodePoint(point);
		index += point > 0xffff ? 2 : 1;
	}
	return text.replace(/\s+/gu, " ").trim();
}

function basename(token: string): string {
	const normalized = token.replaceAll("\\", "/").replace(/[.。]+$/u, "");
	const segments = normalized.split("/").filter(Boolean);
	return segments.at(-1) ?? token;
}

function compactPaths(value: string): string {
	return value.replace(PATH_TOKEN, (token) => basename(token));
}

/** Strip terminal controls and collapse one bounded display line. */
export function boundedTerminalLine(value: unknown): string {
	return typeof value === "string" ? oneLine(value.slice(0, MAX_DISPLAY_SOURCE_CODE_UNITS)) : "";
}

/** Match only exact task text or the deterministic wrappers emitted by Agent runtimes. */
export function isTaskOnlyAgentText(value: unknown, task: unknown): boolean {
	const expected = boundedTerminalLine(task);
	if (!expected) return false;
	let candidate = boundedTerminalLine(value);
	candidate = candidate.replace(/^User(?:\s*:)?\s+/iu, "").replace(/^Task\s*:\s*/iu, "");
	const xml = candidate.match(/^<task>\s*(.*?)\s*<\/task>$/iu)?.[1];
	return (xml ?? candidate) === expected;
}

/** Resolve one terminal-safe, bounded label without asking another model. */
export function resolveDisplayDescription(description: unknown, task: unknown): string {
	const explicit = boundedTerminalLine(description);
	if (explicit) return boundedTerminalLine(truncateToWidth(explicit, MAX_DISPLAY_DESCRIPTION_WIDTH, "…"));
	const legacyTask = compactPaths(boundedTerminalLine(task));
	const source = legacyTask || "Agent task";
	return boundedTerminalLine(truncateToWidth(source, MAX_DISPLAY_DESCRIPTION_WIDTH, "…"));
}
