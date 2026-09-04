type WhitespaceMode = "line" | "multiline" | "prose" | "whitespace";

export function wellFormedText(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				output += `${value[index] ?? ""}${value[index + 1] ?? ""}`;
				index += 1;
			} else output += "�";
			continue;
		}
		output += code >= 0xdc00 && code <= 0xdfff ? "�" : (value[index] ?? "");
	}
	return output;
}

export function terminalControlEnd(value: string, start: number): number {
	const code = value.charCodeAt(start);
	const introducer = code === 0x1b ? value.charCodeAt(start + 1) : code;
	let index = start + (code === 0x1b ? 2 : 1);
	if (introducer === 0x5b || introducer === 0x9b) {
		while (index < value.length) {
			const candidate = value.charCodeAt(index++);
			if (candidate >= 0x40 && candidate <= 0x7e) break;
		}
		return index;
	}
	if (isStringControl(introducer)) {
		while (index < value.length) {
			const candidate = value.charCodeAt(index);
			if ((isOsc(introducer) && candidate === 0x07) || candidate === 0x9c) return index + 1;
			if (candidate === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
			index += 1;
		}
		return index;
	}
	if (code !== 0x1b) return start + 1;
	if (introducer >= 0x30 && introducer <= 0x7e) return index;
	while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) index += 1;
	return index < value.length ? index + 1 : index;
}

function isStringControl(code: number): boolean {
	return (
		code === 0x5d ||
		code === 0x50 ||
		code === 0x58 ||
		code === 0x5e ||
		code === 0x5f ||
		code === 0x9d ||
		code === 0x90 ||
		code === 0x98 ||
		code === 0x9e ||
		code === 0x9f
	);
}

function isOsc(code: number): boolean {
	return code === 0x5d || code === 0x9d;
}

export function isBidiControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200b ||
		(code >= 0x200e && code <= 0x200f) ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069) ||
		code === 0xfeff
	);
}

function sanitize(value: string, mode: WhitespaceMode): string {
	const source = wellFormedText(value);
	let output = "";
	for (let index = 0; index < source.length; index += 1) {
		const code = source.charCodeAt(index);
		if (code === 0x1b || code === 0x9b || (code >= 0x90 && code <= 0x9f && isStringControl(code))) {
			index = terminalControlEnd(source, index) - 1;
			continue;
		}
		if (isBidiControl(code)) {
			if (mode === "prose") output += " ";
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			if (mode === "whitespace" && (code === 0x09 || code === 0x0a || code === 0x0d)) output += source[index];
			else if (mode === "prose" && (code === 0x09 || code === 0x0a)) output += source[index];
			else if (mode === "multiline" && code === 0x0a) output += "\n";
			else if (mode !== "whitespace") output += " ";
			continue;
		}
		output += source[index] ?? "";
	}
	return output;
}

/** Strip terminal protocols and flatten control whitespace. */
export function sanitizeTerminalText(value: string): string {
	return sanitize(value, "line");
}

/** Strip terminal protocols while preserving line feeds. */
export function sanitizeMultilineTerminalText(value: string): string {
	return sanitize(value, "multiline");
}

/** Strip terminal protocols while preserving prose tabs and line feeds. */
export function sanitizeTerminalProse(value: string): string {
	return sanitize(value, "prose");
}

/** Strip terminal protocols while preserving raw tab, line-feed, and carriage-return bytes. */
export function sanitizeTerminalWhitespace(value: string): string {
	return sanitize(value, "whitespace");
}

/** Normalize safe terminal input to the dialog editor's newline and tab conventions. */
export function sanitizeTerminalInput(value: string): string {
	return sanitizeTerminalWhitespace(value).replace(/\r\n?/gu, "\n").replace(/\t/gu, "    ");
}

/** Incremental control stripping without retaining an unbounded OSC or DCS payload. */
export class TerminalTextStream {
	private state: "text" | "escape" | "intermediate" | "csi" | "string" = "text";
	private osc = false;
	private stringEscape = false;

	append(value: string): string {
		let output = "";
		for (const character of value) {
			const code = character.charCodeAt(0);
			if (this.state === "string") {
				if ((this.osc && code === 0x07) || code === 0x9c || (this.stringEscape && code === 0x5c))
					this.state = "text";
				this.stringEscape = code === 0x1b;
				continue;
			}
			if (this.state === "csi") {
				if (code >= 0x40 && code <= 0x7e) this.state = "text";
				continue;
			}
			if (this.state === "intermediate") {
				if (code < 0x20 || code > 0x2f) this.state = "text";
				continue;
			}
			if (this.state === "escape") {
				this.state = "text";
				if (code === 0x5b) this.state = "csi";
				else if (isStringControl(code)) this.beginString(code);
				else if (code >= 0x20 && code <= 0x2f) this.state = "intermediate";
				continue;
			}
			if (code === 0x1b) this.state = "escape";
			else if (code === 0x9b) this.state = "csi";
			else if (code >= 0x90 && code <= 0x9f && isStringControl(code)) this.beginString(code);
			else output += character;
		}
		return sanitizeTerminalWhitespace(output);
	}

	private beginString(code: number): void {
		this.state = "string";
		this.osc = isOsc(code);
		this.stringEscape = false;
	}
}
