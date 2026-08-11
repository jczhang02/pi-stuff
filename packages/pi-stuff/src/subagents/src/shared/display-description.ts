import { boundTerminalLine } from "../../../tool-display/index.js";

const MAX_DISPLAY_DESCRIPTION_WIDTH = 60;
const MAX_DISPLAY_SOURCE_WIDTH = 4_096;
const PATH_TOKEN = /(?:\.{1,2}\/|\/)[^\s"'`<>|,，;；:：!?！？()[\]{}]+/gu;

function basename(token: string): string {
	const normalized = token.replaceAll("\\", "/").replace(/[.。]+$/u, "");
	return normalized.split("/").filter(Boolean).at(-1) ?? token;
}

function compactPaths(value: string): string {
	return value.replace(PATH_TOKEN, basename);
}

/** Strip terminal controls and collapse one bounded display line. */
export function boundedTerminalLine(value: unknown): string {
	return boundTerminalLine(value, MAX_DISPLAY_SOURCE_WIDTH);
}

/** Resolve one terminal-safe, bounded label without asking another model. */
export function resolveDisplayDescription(description: unknown, task: unknown): string {
	const explicit = boundedTerminalLine(description);
	if (explicit) return boundTerminalLine(explicit, MAX_DISPLAY_DESCRIPTION_WIDTH);
	const legacyTask = compactPaths(boundedTerminalLine(task));
	const source = legacyTask || "Agent task";
	return boundTerminalLine(source, MAX_DISPLAY_DESCRIPTION_WIDTH);
}
