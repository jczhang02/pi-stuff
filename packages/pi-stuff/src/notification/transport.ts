import { boundTerminalLine } from "../tool-display/index.js";

export type TerminalDeliveryMode = "auto" | "kitty" | "osc9" | "osc777" | "bell";

export interface TerminalNotificationInput {
	readonly body: string;
	readonly delivery: TerminalDeliveryMode;
	readonly hasUI: boolean;
	readonly mode: "tui" | "rpc" | "json" | "print";
	readonly terminalBell: boolean;
	readonly title: string;
}

export type TerminalNotificationResult = "sent" | "unsupported" | "not-interactive" | "failed";

export function sendTerminalNotification(
	input: TerminalNotificationInput,
	options: {
		readonly environment?: NodeJS.ProcessEnv;
		readonly write?: (bytes: string) => void;
	} = {},
): TerminalNotificationResult {
	if (input.mode !== "tui" || !input.hasUI) return "not-interactive";
	const environment = options.environment ?? process.env;
	const tmuxAttention = input.delivery === "auto" && Boolean(environment["TMUX"]);
	let delivery = input.delivery;
	if (delivery === "auto") {
		const program = environment["TERM_PROGRAM"]?.toLowerCase();
		const term = environment["TERM"]?.toLowerCase();
		if (environment["KITTY_WINDOW_ID"] || term?.includes("kitty")) delivery = "kitty";
		else if (environment["GHOSTTY_RESOURCES_DIR"] || program === "ghostty") delivery = "osc777";
		else if (program === "iterm.app" || program === "wezterm") delivery = "osc9";
		else return "unsupported";
	}
	const title = boundTerminalLine(input.title, 64) || "Pi Stuff";
	const body = boundTerminalLine(input.body, 160);
	let bytes: string;
	if (delivery === "kitty") {
		const encodedTitle = Buffer.from(title, "utf8").toString("base64");
		const encodedBody = Buffer.from(body, "utf8").toString("base64");
		bytes = `\x1b]99;i=pi-stuff:d=0:e=1;${encodedTitle}\x1b\\\x1b]99;i=pi-stuff:p=body:e=1;${encodedBody}\x1b\\`;
	} else if (delivery === "osc9") {
		bytes = `\x1b]9;${title}${title && body ? ": " : ""}${body}\x1b\\`;
	} else if (delivery === "osc777") {
		bytes = `\x1b]777;notify;${title.replaceAll(";", " ")};${body.replaceAll(";", " ")}\x1b\\`;
	} else if (delivery === "bell") {
		bytes = "\x07";
	} else {
		return "unsupported";
	}
	if (environment["TMUX"] && delivery !== "bell") {
		bytes = `\x1bPtmux;${bytes.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
	}
	if ((input.terminalBell || tmuxAttention) && delivery !== "bell") bytes += "\x07";
	try {
		(options.write ?? ((value: string) => process.stdout.write(value)))(bytes);
		return "sent";
	} catch {
		return "failed";
	}
}
