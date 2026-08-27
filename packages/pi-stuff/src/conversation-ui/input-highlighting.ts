import type { Theme } from "@earendil-works/pi-coding-agent";

const MAX_DESCRIPTION_CODE_UNITS = 320;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

type TerminalToken = { readonly control: boolean; readonly value: string };

type HighlightRange = { readonly end: number; readonly start: number };

function terminalControlEnd(value: string, start: number): number {
	const code = value.charCodeAt(start);
	const escapeIntroducer = code === 0x1b ? value.charCodeAt(start + 1) : code;
	const payloadStart = code === 0x1b ? start + 2 : start + 1;
	if (escapeIntroducer === 0x5b || escapeIntroducer === 0x9b) {
		let index = payloadStart;
		while (index < value.length) {
			const candidate = value.charCodeAt(index);
			index += 1;
			if (candidate >= 0x40 && candidate <= 0x7e) break;
		}
		return index;
	}
	if (
		escapeIntroducer === 0x5d ||
		escapeIntroducer === 0x50 ||
		escapeIntroducer === 0x58 ||
		escapeIntroducer === 0x5e ||
		escapeIntroducer === 0x5f ||
		escapeIntroducer === 0x90 ||
		escapeIntroducer === 0x98 ||
		escapeIntroducer === 0x9d ||
		escapeIntroducer === 0x9e ||
		escapeIntroducer === 0x9f
	) {
		let index = payloadStart;
		while (index < value.length) {
			const candidate = value.charCodeAt(index);
			if (candidate === 0x07 || candidate === 0x9c) return index + 1;
			if (candidate === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
			index += 1;
		}
		return index;
	}
	return Math.min(value.length, start + (code === 0x1b ? 2 : 1));
}

export function sanitizeTerminalText(value: string): string {
	let output = "";
	const bounded = value.slice(0, MAX_DESCRIPTION_CODE_UNITS);
	for (let index = 0; index < bounded.length; index += 1) {
		const code = bounded.charCodeAt(index);
		if (code === 0x90 || code === 0x98 || code === 0x9b || code === 0x9d || code === 0x9e || code === 0x9f) {
			index = terminalControlEnd(bounded, index) - 1;
			continue;
		}
		if (code === 0x1b) {
			const introducer = bounded.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index += 2;
				while (index < bounded.length) {
					const candidate = bounded.charCodeAt(index);
					if (candidate >= 0x40 && candidate <= 0x7e) break;
					index += 1;
				}
				continue;
			}
			if (
				introducer === 0x5d ||
				introducer === 0x50 ||
				introducer === 0x58 ||
				introducer === 0x5e ||
				introducer === 0x5f
			) {
				index += 2;
				while (index < bounded.length) {
					const candidate = bounded.charCodeAt(index);
					if (candidate === 0x07) break;
					if (candidate === 0x1b && bounded.charCodeAt(index + 1) === 0x5c) {
						index += 1;
						break;
					}
					index += 1;
				}
				continue;
			}
			if (!Number.isNaN(introducer)) index += 1;
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			output += " ";
			continue;
		}
		if (
			code === 0x061c ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		) {
			output += " ";
			continue;
		}
		output += bounded[index];
	}
	return output.replace(/\s+/gu, " ").trim();
}

function terminalTokens(value: string): TerminalToken[] {
	const tokens: TerminalToken[] = [];
	for (let index = 0; index < value.length; ) {
		const code = value.charCodeAt(index);
		if (code === 0x1b || (code >= 0x80 && code <= 0x9f) || code < 0x20 || code === 0x7f) {
			const end = terminalControlEnd(value, index);
			tokens.push({ control: true, value: value.slice(index, end) });
			index = end;
			continue;
		}
		const codePoint = value.codePointAt(index) ?? code;
		const length = codePoint > 0xffff ? 2 : 1;
		tokens.push({ control: false, value: value.slice(index, index + length) });
		index += length;
	}
	return tokens;
}

function invocationRanges(plain: string, names: ReadonlySet<string>): HighlightRange[] {
	const alternatives = [...names].sort((left, right) => right.length - left.length).map(escapeRegExp);
	if (alternatives.length === 0) return [];
	const pattern = new RegExp(`(^|[^A-Za-z0-9_./:@-])/(${alternatives.join("|")})(?![A-Za-z0-9:._/-])`, "gu");
	const ranges: HighlightRange[] = [];
	for (const match of plain.matchAll(pattern)) {
		const boundary = match[1] ?? "";
		const name = match[2];
		if (!name || match.index === undefined) continue;
		const start = match.index + boundary.length;
		ranges.push({ start, end: start + name.length + 1 });
	}
	return ranges;
}

export function styleKnownInvocations(line: string, names: ReadonlySet<string>, theme: Theme): string {
	if (names.size === 0 || !line.includes("/")) return line;
	const tokens = terminalTokens(line);
	const plain = tokens
		.filter((token) => !token.control)
		.map((token) => token.value)
		.join("");
	const ranges = invocationRanges(plain, names);
	if (ranges.length === 0) return line;

	let output = "";
	let plainOffset = 0;
	let buffered = "";
	let bufferedHighlight = false;
	const flush = (): void => {
		if (!buffered) return;
		output += bufferedHighlight ? theme.fg("accent", buffered) : buffered;
		buffered = "";
	};
	for (const token of tokens) {
		if (token.control) {
			flush();
			output += token.value;
			continue;
		}
		const highlighted = ranges.some((range) => plainOffset >= range.start && plainOffset < range.end);
		if (buffered && highlighted !== bufferedHighlight) flush();
		bufferedHighlight = highlighted;
		buffered += token.value;
		plainOffset += token.value.length;
	}
	flush();
	return output;
}
