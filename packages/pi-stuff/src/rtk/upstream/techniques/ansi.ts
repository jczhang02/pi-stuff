const ESCAPE_PATTERN = String.raw`\u001b`;
const BELL_PATTERN = String.raw`\u0007`;
const STRING_TERMINATOR_PATTERN = `(?:${BELL_PATTERN}|${ESCAPE_PATTERN}\\\\)`;
const CSI_PATTERN = new RegExp(`${ESCAPE_PATTERN}\\[[0-9;]*[a-zA-Z]`, "gu");
const OSC_PREFIX_PATTERN = new RegExp(`${ESCAPE_PATTERN}\\][0-9;]*${STRING_TERMINATOR_PATTERN}`, "gu");
const OSC_PATTERN = new RegExp(
	`${ESCAPE_PATTERN}\\][^${BELL_PATTERN}${ESCAPE_PATTERN}]*${STRING_TERMINATOR_PATTERN}`,
	"gu",
);

export function stripAnsi(text: string): string {
	return text.replace(CSI_PATTERN, "").replace(OSC_PREFIX_PATTERN, "").replace(OSC_PATTERN, "");
}

export function stripAnsiFast(text: string): string {
	if (!text.includes("\u001b")) {
		return text;
	}
	return stripAnsi(text);
}
