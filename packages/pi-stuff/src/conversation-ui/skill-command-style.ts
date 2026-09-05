import { terminalControlEnd } from "../shared/terminal-text.js";

// pi-agent Powerline footer, c2018703, packages/jc-powerline-footer/theme.ts.
const RAINBOW = [
	"178;129;214",
	"215;135;175",
	"254;188;56",
	"228;192;15",
	"137;210;129",
	"0;175;175",
	"23;143;185",
	"178;129;214",
];

export function rainbowSkillCommand(text: string, restore = "\u001b[39m"): string {
	let index = 0;
	return (
		Array.from(text, (character) => {
			if (character === ":" || character === " ") return character;
			const color = RAINBOW[index++ % RAINBOW.length];
			return `\u001b[38;2;${color}m${character}`;
		}).join("") + restore
	);
}

function foregroundAfter(control: string, previous: string): string {
	if (!control.startsWith("\u001b[") || !control.endsWith("m")) return previous;
	const codes = control.slice(2, -1).split(";");
	let foreground = previous;
	for (let index = 0; index < codes.length; index += 1) {
		const code = Number(codes[index]);
		if (code === 0 || code === 39) foreground = "\u001b[39m";
		else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) foreground = `\u001b[${code}m`;
		else if (code === 38 || code === 48 || code === 58) {
			const mode = codes[index + 1];
			const count = mode === "2" ? 4 : mode === "5" ? 2 : 0;
			if (count === 0 || index + count >= codes.length) break;
			if (code === 38) foreground = `\u001b[${codes.slice(index, index + count + 1).join(";")}m`;
			index += count;
		}
	}
	return foreground;
}

/** Decorate visible command text without editing OSC hyperlinks or native foreground restoration. */
export function highlightSkillCommands(text: string): string {
	let output = "";
	let foreground = "\u001b[39m";
	for (let index = 0; index < text.length; ) {
		if (text.charCodeAt(index) === 0x1b) {
			const end = terminalControlEnd(text, index);
			const control = text.slice(index, end);
			foreground = foregroundAfter(control, foreground);
			output += control;
			index = end;
			continue;
		}
		const next = text.indexOf("\u001b", index);
		const end = next < 0 ? text.length : next;
		output += text
			.slice(index, end)
			.replace(
				/(^|[^A-Za-z0-9_./:@-])(\/skill:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*)(?![A-Za-z0-9_./:@-])/gu,
				(_match, boundary: string, command: string) => boundary + rainbowSkillCommand(command, foreground),
			);
		index = end;
	}
	return output;
}
