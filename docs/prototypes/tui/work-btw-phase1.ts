/**
 * PROTOTYPE — disposable native-Pi BTW information-structure proposal.
 *
 * This is not Runtime code. It answers one UI question: can the accepted shared
 * Command Dialog retain its Pi-native lifecycle while reducing BTW to the
 * question, Markdown answer, spinner, and contextual controls?
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	Loader,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import {
	type CommandDialogView,
	getCommandDialogCoordinator,
} from "../../../packages/pi-stuff/src/conversation-ui/index.ts";

const QUESTION = "Why should this remain outside the main transcript?";
const ANSWER = [
	"The side answer remains isolated while the main session stays unchanged.",
	"",
	"- **Context:** completed text, images, tool results, and compaction state",
	"- **Promotion:** `f` waits for the main Agent to become idle",
	"- **History:** local to this session across resume",
	"",
	"Markdown stays compact and uses the active Pi theme.",
].join("\n");

interface PrototypeExchange {
	readonly question: string;
	readonly answer: string;
}

const HISTORY: readonly PrototypeExchange[] = [
	{
		question: "Which context does BTW receive?",
		answer: "Completed conversation context, including tool results and compaction state.",
	},
	{
		question: "Does BTW change the original session?",
		answer: "No. Routine BTW questions, answers, and history remain outside the main transcript.",
	},
	{ question: QUESTION, answer: ANSWER },
];

type PrototypeMode = "answering" | "answered" | "history";

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

function bounded(line: string, width: number): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function questionLine(theme: Theme, question: string, selected: boolean): string {
	const command = selected ? theme.fg("accent", "/btw") : theme.fg("dim", "/btw");
	const text = selected ? theme.fg("text", question) : theme.fg("muted", question);
	return `  ${command} ${text}`;
}

class Phase1BtwSurface implements Component {
	private readonly loader: Loader;
	private readonly markdown: Markdown;
	private readonly timer: ReturnType<typeof setTimeout> | undefined;
	private selectedIndex: number;
	private mode: PrototypeMode;
	private feedback: string | undefined;
	private scrollTop = 0;

	constructor(
		private readonly theme: Theme,
		private readonly tui: TUI,
		mode: PrototypeMode,
		private readonly close: () => void,
	) {
		this.mode = mode;
		this.selectedIndex = mode === "history" ? HISTORY.length - 1 : 0;
		this.markdown = new Markdown("", 0, 0, markdownTheme(theme));
		this.loader = new Loader(
			tui,
			(frame) => theme.fg("accent", frame),
			(message) => theme.fg("muted", message),
			"Answering…",
		);
		if (mode === "answering") {
			this.timer = setTimeout(() => {
				this.mode = "answered";
				this.loader.stop();
				this.tui.requestRender();
			}, 2_200);
			this.timer.unref();
		} else {
			this.timer = undefined;
			this.loader.stop();
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
			this.close();
			return;
		}
		if (matchesKey(data, Key.left) && this.mode === "history") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.resetSelection();
			return;
		}
		if (matchesKey(data, Key.right) && this.mode === "history") {
			this.selectedIndex = Math.min(HISTORY.length - 1, this.selectedIndex + 1);
			this.resetSelection();
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.scrollTop = Math.max(0, this.scrollTop - 3);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.scrollTop += 3;
			this.tui.requestRender();
			return;
		}
		if (data === "c" && this.mode !== "answering") {
			this.feedback = "Copied answer";
			this.tui.requestRender();
			return;
		}
		if (data === "f" && this.mode !== "answering") {
			this.feedback = "Will open a new session after the main Agent becomes idle";
			this.tui.requestRender();
			return;
		}
		if (data === "x" && this.mode === "history") {
			this.mode = "answered";
			this.selectedIndex = 0;
			this.feedback = "Cleared earlier history";
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const selected = this.mode === "history" ? HISTORY[this.selectedIndex] : { question: QUESTION, answer: ANSWER };
		if (!selected) return [this.theme.fg("error", "Missing prototype exchange")];

		const lines = [this.theme.fg("border", "─".repeat(Math.max(1, width)))];
		if (this.mode === "history") {
			for (let index = 0; index < HISTORY.length; index++) {
				const exchange = HISTORY[index];
				if (exchange)
					lines.push(bounded(questionLine(this.theme, exchange.question, index === this.selectedIndex), width));
			}
		} else {
			lines.push(bounded(questionLine(this.theme, selected.question, true), width));
		}

		if (this.mode === "answering") {
			lines.push(...this.loader.render(Math.max(1, width - 2)).map((line) => bounded(`  ${line}`, width)));
		} else {
			this.markdown.setText(selected.answer);
			const rendered = this.markdown.render(Math.max(1, width - 4));
			const terminalRows = (this.tui.terminal as { rows?: number }).rows ?? 24;
			const reservedRows = this.mode === "history" ? HISTORY.length + 5 : 6;
			const viewport = Math.max(4, terminalRows - reservedRows);
			const maxScroll = Math.max(0, rendered.length - viewport);
			this.scrollTop = Math.min(Math.max(0, this.scrollTop), maxScroll);
			lines.push(
				"",
				...rendered.slice(this.scrollTop, this.scrollTop + viewport).map((line) => bounded(`  ${line}`, width)),
			);
		}

		lines.push("", bounded(`  ${this.theme.fg("dim", this.hints())}`, width));
		return lines;
	}

	invalidate(): void {
		this.markdown.invalidate();
		this.loader.invalidate();
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.loader.stop();
	}

	private hints(): string {
		if (this.feedback) return this.feedback;
		if (this.mode === "answering") return "Esc cancel";
		if (this.mode === "history") return "←/→ history · ↑/↓ scroll · c copy · f fork · x clear · Esc close";
		return "↑/↓ scroll · c copy · f fork · Esc close";
	}

	private resetSelection(): void {
		this.feedback = undefined;
		this.scrollTop = 0;
		this.tui.requestRender();
	}
}

function openPrototype(mode: PrototypeMode, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	const view: CommandDialogView = {
		priority: "normal",
		create: ({ theme, tui, close }) => new Phase1BtwSurface(theme, tui, mode, () => close()),
	};
	return getCommandDialogCoordinator(pi)
		.show(ctx, view)
		.then(() => undefined);
}

export default function workBtwPhase1Prototype(pi: ExtensionAPI): void {
	pi.registerCommand("prototype-btw-phase1", {
		description: "Open the disposable BTW Phase 1 information-structure prototype",
		handler: (args, ctx) => {
			const requested = args.trim();
			const mode: PrototypeMode =
				requested === "history" ? "history" : requested === "answered" ? "answered" : "answering";
			return openPrototype(mode, ctx, pi);
		},
	});
}
