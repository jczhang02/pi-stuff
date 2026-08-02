import { copyToClipboard, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { BTW_VISIBLE_EARLIER_LIMIT, type BtwExchange } from "./btw-history.js";

const GUTTER = "  ";
const COPY_FEEDBACK_MS = 2_000;
const SCROLL_STEP = 3;

type DisplayState = "pending" | "success" | "error";

interface DisplayExchange {
	id: string | undefined;
	question: string;
	answer: string;
	state: DisplayState;
	error: string | undefined;
	contextTrimmed: boolean;
}

export interface BtwDialogOptions {
	readonly question?: string;
	readonly history: readonly BtwExchange[];
	readonly error?: string;
	readonly onClose: () => void;
	readonly onClearEarlier: (currentId: string | undefined) => void;
	readonly copyText?: (text: string) => Promise<void>;
}

function successfulDisplay(exchange: BtwExchange): DisplayExchange {
	return {
		id: exchange.id,
		question: exchange.question,
		answer: exchange.answer,
		state: "success",
		error: undefined,
		contextTrimmed: exchange.contextTrimmed,
	};
}

function stripTerminalControls(text: string): string {
	let result = "";
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 27 && text[index + 1] === "[") {
			index += 2;
			while (index < text.length) {
				const terminator = text.charCodeAt(index);
				if (terminator >= 64 && terminator <= 126) break;
				index++;
			}
			continue;
		}
		if (code === 9 || code === 10 || code >= 32) {
			if (code !== 127) result += text[index] ?? "";
		}
	}
	return result;
}

function oneLine(text: string): string {
	return stripTerminalControls(text).replace(/\s+/g, " ").trim();
}

function bounded(line: string, width: number): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function divider(theme: Theme, width: number): string {
	return theme.fg("border", "─".repeat(Math.max(1, width)));
}

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

function joinHints(theme: Theme, width: number, hints: readonly string[]): string {
	const available = Math.max(1, width - GUTTER.length);
	let text = "";
	for (const hint of hints) {
		const candidate = text.length === 0 ? hint : `${text} · ${hint}`;
		if (visibleWidth(candidate) > available) break;
		text = candidate;
	}
	return `${GUTTER}${theme.fg("dim", text || "Esc return")}`;
}

export class BtwDialogController implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly closeDialog: () => void;
	private readonly clearEarlier: (currentId: string | undefined) => void;
	private readonly copyText: (text: string) => Promise<void>;
	private readonly markdown: Markdown;
	private exchanges: DisplayExchange[];
	private currentIndex: number;
	private selectedIndex: number;
	private hiddenEarlier: number;
	private scrollTop = 0;
	private followTail = true;
	private copyFeedback: "copied" | "failed" | undefined;
	private copyTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(theme: Theme, tui: TUI, options: BtwDialogOptions) {
		this.theme = theme;
		this.tui = tui;
		this.closeDialog = options.onClose;
		this.clearEarlier = options.onClearEarlier;
		this.copyText = options.copyText ?? copyToClipboard;

		const visibleHistoryCount =
			options.question === undefined ? BTW_VISIBLE_EARLIER_LIMIT + 1 : BTW_VISIBLE_EARLIER_LIMIT;
		const earlier = options.history.slice(-visibleHistoryCount);
		this.hiddenEarlier = Math.max(0, options.history.length - earlier.length);
		this.exchanges = earlier.map(successfulDisplay);
		if (options.question !== undefined) {
			this.exchanges.push({
				id: undefined,
				question: options.question,
				answer: "",
				state: options.error === undefined ? "pending" : "error",
				error: options.error,
				contextTrimmed: false,
			});
		}
		if (this.exchanges.length === 0) {
			this.exchanges.push({
				id: undefined,
				question: "/btw",
				answer: "",
				state: "error",
				error: options.error ?? "No previous /btw exchange in this session.",
				contextTrimmed: false,
			});
		}
		this.currentIndex = this.exchanges.length - 1;
		this.selectedIndex = this.currentIndex;
		this.markdown = new Markdown("", 0, 0, markdownTheme(theme));
	}

	appendText(delta: string): void {
		const current = this.exchanges[this.currentIndex];
		if (this.disposed || current?.state !== "pending") return;
		current.answer += delta;
		this.requestRender();
	}

	resetForRetry(): void {
		const current = this.exchanges[this.currentIndex];
		if (this.disposed || !current) return;
		current.answer = "";
		current.error = undefined;
		current.state = "pending";
		this.scrollTop = 0;
		this.followTail = true;
		this.requestRender();
	}

	setSuccess(exchange: BtwExchange): void {
		const current = this.exchanges[this.currentIndex];
		if (this.disposed || !current) return;
		current.id = exchange.id;
		current.answer = exchange.answer;
		current.state = "success";
		current.error = undefined;
		current.contextTrimmed = exchange.contextTrimmed;
		this.selectedIndex = this.currentIndex;
		this.followTail = true;
		this.requestRender();
	}

	setError(message: string, partial: string): void {
		const current = this.exchanges[this.currentIndex];
		if (this.disposed || !current) return;
		current.answer = partial;
		current.error = message;
		current.state = "error";
		this.selectedIndex = this.currentIndex;
		this.followTail = true;
		this.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.closeDialog();
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.select(Math.max(0, this.selectedIndex - 1));
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.select(Math.min(this.exchanges.length - 1, this.selectedIndex + 1));
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
			this.followTail = false;
			this.scrollTop = Math.max(0, this.scrollTop - SCROLL_STEP);
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
			this.scrollTop += SCROLL_STEP;
			this.requestRender();
			return;
		}
		if (data === "c") {
			void this.copySelected();
			return;
		}
		if (data === "x" && this.hasEarlier()) this.clearEarlierHistory();
	}

	render(width: number): string[] {
		const selected = this.exchangeAt(this.selectedIndex);
		const historyLines = this.renderHistory(width);
		const questionWidth = Math.max(1, width - GUTTER.length);
		const question = bounded(`${GUTTER}${this.theme.fg("text", oneLine(selected.question))}`, width);
		const answerLines = this.renderAnswer(selected, questionWidth);
		const terminalRows = (this.tui.terminal as { rows?: number }).rows ?? 24;
		const viewportHeight = Math.max(5, terminalRows - 11 - historyLines.length);
		const maxScroll = Math.max(0, answerLines.length - viewportHeight);
		if (this.followTail) this.scrollTop = maxScroll;
		this.scrollTop = Math.min(maxScroll, Math.max(0, this.scrollTop));
		if (this.scrollTop === maxScroll) this.followTail = true;
		const visibleAnswer = answerLines.slice(this.scrollTop, this.scrollTop + viewportHeight);

		const titleSuffix = width >= 64 ? this.theme.fg("dim", " · side question · main task continues") : "";
		const lines = [
			divider(this.theme, width),
			bounded(`${GUTTER}${this.theme.fg("text", this.theme.bold("BTW"))}${titleSuffix}`, width),
			...historyLines,
			"",
			bounded(`${GUTTER}${this.theme.fg("muted", "Question")}`, width),
			question,
			"",
			bounded(`${GUTTER}${this.theme.fg("muted", "Answer")}`, width),
			...visibleAnswer.map((line) => bounded(`${GUTTER}${line}`, width)),
		];
		if (selected.contextTrimmed) {
			lines.push(bounded(`${GUTTER}${this.theme.fg("warning", "Context trimmed to fit the model window")}`, width));
		}
		lines.push("", this.renderFooter(selected, width, maxScroll));
		return lines;
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	dispose(): void {
		this.disposed = true;
		if (this.copyTimer) clearTimeout(this.copyTimer);
		this.copyTimer = undefined;
	}

	private requestRender(): void {
		if (!this.disposed) this.tui.requestRender();
	}

	private select(index: number): void {
		if (index === this.selectedIndex) return;
		this.selectedIndex = index;
		this.scrollTop = 0;
		this.followTail = false;
		this.copyFeedback = undefined;
		this.requestRender();
	}

	private hasEarlier(): boolean {
		return this.hiddenEarlier > 0 || this.exchanges.length > 1;
	}

	private clearEarlierHistory(): void {
		const selected = this.exchangeAt(this.selectedIndex);
		const active = this.exchangeAt(this.currentIndex);
		const retained = active.state === "pending" ? active : selected;
		this.clearEarlier(retained.state === "success" ? retained.id : undefined);
		this.exchanges = [retained];
		this.currentIndex = 0;
		this.selectedIndex = 0;
		this.hiddenEarlier = 0;
		this.scrollTop = 0;
		this.followTail = true;
		this.requestRender();
	}

	private async copySelected(): Promise<void> {
		const selected = this.exchangeAt(this.selectedIndex);
		if (selected.state !== "success" || selected.answer.length === 0) return;
		try {
			await this.copyText(stripTerminalControls(selected.answer));
			this.copyFeedback = "copied";
		} catch {
			this.copyFeedback = "failed";
		}
		if (this.copyTimer) clearTimeout(this.copyTimer);
		this.copyTimer = setTimeout(() => {
			this.copyFeedback = undefined;
			this.copyTimer = undefined;
			this.requestRender();
		}, COPY_FEEDBACK_MS);
		this.copyTimer.unref();
		this.requestRender();
	}

	private renderHistory(width: number): string[] {
		if (this.exchanges.length === 1 && this.hiddenEarlier === 0) return [];
		const lines: string[] = [];
		if (this.hiddenEarlier > 0) {
			lines.push(bounded(`${GUTTER}${this.theme.fg("dim", `(+${this.hiddenEarlier} earlier /btw)`)}`, width));
		}
		for (let index = 0; index < this.exchanges.length; index++) {
			const exchange = this.exchanges[index];
			if (!exchange) continue;
			const selected = index === this.selectedIndex;
			const marker = selected ? this.theme.fg("accent", "●") : this.theme.fg("dim", "○");
			const text = oneLine(exchange.question);
			const styled = selected ? this.theme.fg("text", this.theme.bold(text)) : this.theme.fg("muted", text);
			lines.push(bounded(`${GUTTER}${marker} ${styled}`, width));
		}
		return lines;
	}

	private exchangeAt(index: number): DisplayExchange {
		const exchange = this.exchanges[index];
		if (!exchange) throw new Error(`Missing /btw display exchange at index ${index}`);
		return exchange;
	}

	private renderAnswer(exchange: DisplayExchange, width: number): string[] {
		const safeAnswer = stripTerminalControls(exchange.answer);
		if (safeAnswer.length > 0) {
			this.markdown.setText(safeAnswer);
		} else {
			this.markdown.setText("");
		}
		const lines = safeAnswer.length > 0 ? this.markdown.render(Math.max(1, width)) : [];
		if (exchange.state === "pending") {
			lines.push(this.theme.fg("warning", safeAnswer.length === 0 ? "Answering…" : "…"));
		} else if (exchange.state === "error") {
			if (safeAnswer.length > 0) lines.push(this.theme.fg("warning", "Incomplete answer"));
			const error = stripTerminalControls(exchange.error ?? "Unknown /btw error");
			lines.push(...wrapTextWithAnsi(this.theme.fg("error", error), Math.max(1, width)));
		}
		return lines.length > 0 ? lines : [this.theme.fg("dim", "(empty answer)")];
	}

	private renderFooter(exchange: DisplayExchange, width: number, maxScroll: number): string {
		if (this.copyFeedback === "copied") return `${GUTTER}${this.theme.fg("success", "Copied answer")}`;
		if (this.copyFeedback === "failed") return `${GUTTER}${this.theme.fg("error", "Could not copy answer")}`;
		const hints = [exchange.state === "pending" ? "Esc cancel" : "Esc return"];
		if (maxScroll > 0) hints.push("↑/↓ scroll");
		if (this.exchanges.length > 1) hints.push("←/→ history");
		if (exchange.state === "success") hints.push("c copy");
		if (this.hasEarlier()) hints.push("x clear earlier");
		return joinHints(this.theme, width, hints);
	}
}
