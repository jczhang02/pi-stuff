import { boundTerminalLine } from "../../../tool-display/index.js";

const MAX_DISPLAY_DESCRIPTION_WIDTH = 60;
const MAX_DISPLAY_SOURCE_WIDTH = 4_096;
const PATH_TOKEN = /(?<![\p{L}\p{N}_:/\\.-])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>|,，;；:：!?！？()[\]{}]+/gu;

function basename(token: string): string {
	const normalized = token.replaceAll("\\", "/").replace(/[.。]+$/u, "");
	return normalized.split("/").filter(Boolean).at(-1) ?? token;
}

function compactPaths(value: string): string {
	return value.replace(PATH_TOKEN, basename);
}

/** Strip terminal controls and collapse one bounded display line. */
export function boundedTerminalLine(value: string | null | undefined): string {
	return boundTerminalLine(value, MAX_DISPLAY_SOURCE_WIDTH);
}

/** Match only exact task text or the deterministic wrappers emitted by Agent runtimes. */
export function isTaskOnlyAgentText(value: string | null | undefined, task: string | null | undefined): boolean {
	const expected = boundedTerminalLine(task);
	if (!expected) return false;
	let candidate = boundedTerminalLine(value);
	candidate = candidate.replace(/^(?:User|You)(?:\s*:)?\s+/iu, "").replace(/^Task\s*:\s*/iu, "");
	const xml = candidate.match(/^<task>\s*(.*?)\s*<\/task>$/iu)?.[1];
	return (xml ?? candidate) === expected;
}

/** Resolve one terminal-safe, bounded label without asking another model. */
export function resolveDisplayDescription(
	description: string | null | undefined,
	task: string | null | undefined,
): string {
	const explicit = boundedTerminalLine(description);
	if (explicit) return boundTerminalLine(explicit, MAX_DISPLAY_DESCRIPTION_WIDTH);
	const legacyTask = compactPaths(boundedTerminalLine(task));
	const source = legacyTask || "Agent task";
	return boundTerminalLine(source, MAX_DISPLAY_DESCRIPTION_WIDTH);
}
