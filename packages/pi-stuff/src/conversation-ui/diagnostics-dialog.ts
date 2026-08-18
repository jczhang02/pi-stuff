import type { Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { DiagnosticChannel, DiagnosticRecord, DiagnosticSeverity } from "./diagnostics.js";
import {
	commandDialogRows,
	fitCommandDialogRows,
	matchesCommandDialogPageDown,
	matchesCommandDialogPageUp,
} from "./dialog-layout.js";
import type { CommandDialogComponent, CommandDialogView, CommandDialogViewContext } from "./index.js";

type DiagnosticsMode = "detail" | "list";

const GUTTER = "  ";
const LIST_ROWS = 8;
const NARROW_LIST_ROWS = 5;
const NARROW_WIDTH = 64;

function marker(theme: Theme, severity: DiagnosticSeverity): string {
	switch (severity) {
		case "info":
			return theme.fg("accent", "i");
		case "warning":
			return theme.fg("warning", "!");
		case "error":
			return theme.fg("error", "×");
	}
}

function state(theme: Theme, severity: DiagnosticSeverity): string {
	return theme.fg(severity === "error" ? "error" : severity === "warning" ? "warning" : "accent", severity);
}

function sectionHeading(theme: Theme, label: string): string {
	return `${theme.fg("accent", "◆")} ${theme.bold(label)}`;
}

function age(timestamp: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
	if (seconds < 10) return "now";
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${String(minutes)}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${String(hours)}h`;
	return `${String(Math.floor(hours / 24))}d`;
}

function hint(theme: Theme, width: number, values: readonly string[]): string[] {
	const available = Math.max(1, width - visibleWidth(GUTTER));
	const lines: string[] = [];
	let current = "";
	for (const value of values) {
		const candidate = current ? `${current} · ${value}` : value;
		if (current && visibleWidth(candidate) > available) {
			lines.push(current);
			current = value;
		} else current = candidate;
	}
	if (current) lines.push(current);
	return lines.map((line) => `${GUTTER}${theme.fg("dim", line)}`);
}

function bounded(width: number, line: string): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function listLine(theme: Theme, record: DiagnosticRecord, selected: boolean, width: number): string {
	const cursor = selected ? theme.fg("accent", "›") : " ";
	const available = Math.max(1, width - visibleWidth(GUTTER));
	const capabilityWidth = Math.min(18, Math.max(8, Math.floor(available * 0.25)));
	const capability = theme.fg("text", truncateToWidth(record.capability, capabilityWidth, "…"));
	const prefix = `${GUTTER}${cursor} ${marker(theme, record.severity)} ${capability}${theme.fg("dim", "  ")}`;
	const occurrence = record.count > 1 ? `×${String(record.count)} · ` : "";
	const suffix = theme.fg("dim", `  ${occurrence}${age(record.lastOccurredAt)}`);
	const summaryWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
	const summary = truncateToWidth(record.summary, summaryWidth, "…");
	return `${prefix}${selected ? theme.bold(summary) : theme.fg("muted", summary)}${suffix}`;
}

class DiagnosticsDialog implements CommandDialogComponent {
	private readonly channel: DiagnosticChannel;
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private lastWidth = 80;
	private mode: DiagnosticsMode = "list";
	private records: readonly DiagnosticRecord[];
	private scrollOffset = 0;
	private selectedId: string | undefined;
	private readonly unsubscribe: () => void;

	constructor(channel: DiagnosticChannel, context: CommandDialogViewContext<void>) {
		this.channel = channel;
		this.context = context;
		this.records = channel.list();
		this.selectedId = this.records[0]?.id;
		this.unsubscribe = channel.subscribe(() => this.refresh());
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
	}

	handleInput(data: string): void {
		if (this.disposed || isKeyRelease(data)) return;
		if (matchesKey(data, Key.escape)) {
			if (this.mode === "detail") {
				this.mode = "list";
				this.scrollOffset = 0;
				this.context.requestRender();
			} else this.context.close();
			return;
		}
		if (this.mode === "list") this.handleListInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		this.lastWidth = Math.max(1, Math.floor(width));
		this.reconcileSelection();
		const lines = this.mode === "list" ? this.renderList() : this.renderDetail();
		return lines.map((line) => bounded(this.lastWidth, line));
	}

	private refresh(): void {
		this.records = this.channel.list();
		this.reconcileSelection();
		this.context.requestRender();
	}

	private reconcileSelection(): void {
		if (this.selectedId && this.records.some((record) => record.id === this.selectedId)) return;
		this.selectedId = this.records[0]?.id;
		this.scrollOffset = 0;
		if (!this.selectedId) this.mode = "list";
	}

	private selected(): DiagnosticRecord | undefined {
		return this.records.find((record) => record.id === this.selectedId);
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, "c")) {
			this.channel.clear();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (!this.selected()) return;
			this.mode = "detail";
			this.scrollOffset = 0;
			this.context.requestRender();
			return;
		}
		if (
			!matchesKey(data, Key.up) &&
			!matchesKey(data, Key.down) &&
			!matchesCommandDialogPageUp(data) &&
			!matchesCommandDialogPageDown(data)
		)
			return;
		if (this.records.length === 0) return;
		const current = Math.max(
			0,
			this.records.findIndex((record) => record.id === this.selectedId),
		);
		const page = Math.max(1, this.lastWidth <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS);
		const delta = matchesKey(data, Key.up)
			? -1
			: matchesKey(data, Key.down)
				? 1
				: matchesCommandDialogPageUp(data)
					? -page
					: page;
		const next = Math.max(0, Math.min(this.records.length - 1, current + delta));
		this.selectedId = this.records[next]?.id;
		this.scrollOffset = 0;
		this.context.requestRender();
	}

	private handleDetailInput(data: string): void {
		if (
			!matchesKey(data, Key.up) &&
			!matchesKey(data, Key.down) &&
			!matchesCommandDialogPageUp(data) &&
			!matchesCommandDialogPageDown(data)
		)
			return;
		const record = this.selected();
		if (!record) return;
		const document = this.detailDocument(record);
		const page = Math.max(1, commandDialogRows(this.context) - 11);
		const delta = matchesKey(data, Key.up)
			? -1
			: matchesKey(data, Key.down)
				? 1
				: matchesCommandDialogPageUp(data)
					? -page
					: page;
		this.scrollOffset = Math.max(0, Math.min(Math.max(0, document.length - page), this.scrollOffset + delta));
		this.context.requestRender();
	}

	private renderList(): string[] {
		const width = this.lastWidth;
		const theme = this.context.theme;
		const maximum = commandDialogRows(this.context);
		const preferred = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const provisionalViewport = Math.min(preferred, Math.max(0, maximum - 5));
		const overflows = this.records.length > provisionalViewport;
		const footer = hint(theme, width, [
			...(this.records.length > 0
				? ["↑/↓ select", ...(overflows ? ["Pg/Shift+↑/↓ page"] : []), "Enter details", "c clear"]
				: []),
			"Esc return",
		]);
		const viewport = Math.min(preferred, Math.max(0, maximum - footer.length - 4));
		const selectedIndex = Math.max(
			0,
			this.records.findIndex((record) => record.id === this.selectedId),
		);
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(viewport / 2), this.records.length - viewport));
		const visible = viewport > 0 ? this.records.slice(start, start + viewport) : [];
		const count = theme.fg("dim", ` · ${String(this.records.length)} records`);
		const header = [theme.fg("border", "━".repeat(width)), `${GUTTER}${theme.bold("Diagnostics")}${count}`];
		const empty = `${GUTTER}${theme.fg("muted", "No Pi Stuff diagnostics yet.")}`;
		const older = this.records.length - start - visible.length;
		const body = [
			"",
			...(start > 0 ? [`${GUTTER}${theme.fg("dim", `… ${String(start)} newer`)}`] : []),
			...(visible.length > 0
				? visible.map((record) => listLine(theme, record, record.id === this.selectedId, width))
				: [empty]),
			...(older > 0 ? [`${GUTTER}${theme.fg("dim", `… ${String(older)} older`)}`] : []),
			"",
		];
		const priority = body.find((line) => line.includes("›")) ?? empty;
		const sections = { header, body, footer, priority: [priority] };
		return fitCommandDialogRows(sections, maximum);
	}

	private renderDetail(): string[] {
		const width = this.lastWidth;
		const record = this.selected();
		if (!record) {
			this.mode = "list";
			return this.renderList();
		}
		const theme = this.context.theme;
		const maximum = commandDialogRows(this.context);
		const document = this.detailDocument(record);
		let footer = hint(theme, width, ["↑/↓ scroll", "Esc back"]);
		let viewport = Math.max(0, maximum - 8 - footer.length);
		if (document.length > viewport) {
			footer = hint(theme, width, ["↑/↓ scroll", "Pg/Shift+↑/↓ page", "Esc back"]);
			viewport = Math.max(0, maximum - 8 - footer.length);
		}
		const maxOffset = Math.max(0, document.length - viewport);
		this.scrollOffset = Math.min(maxOffset, this.scrollOffset);
		const visible = document.slice(this.scrollOffset, this.scrollOffset + viewport);
		const occurrence = record.count === 1 ? "1 occurrence" : `${String(record.count)} occurrences`;
		const severityLine = `${GUTTER}${marker(theme, record.severity)} ${state(theme, record.severity)} ${theme.fg(
			"dim",
			`· ${occurrence} · latest ${age(record.lastOccurredAt)} ago`,
		)}`;
		const summaryLine = `${GUTTER}${theme.bold(record.summary)}`;
		const header = [
			theme.fg("border", "━".repeat(width)),
			`${GUTTER}${theme.bold(`Diagnostics / ${record.capability}`)}`,
		];
		const body = ["", severityLine, "", summaryLine, "", ...visible.map((line) => `${GUTTER}${line}`), ""];
		const sections = { header, body, footer, priority: [summaryLine, severityLine] };
		return fitCommandDialogRows(sections, maximum);
	}

	private detailDocument(record: DiagnosticRecord): readonly string[] {
		const available = Math.max(1, this.lastWidth - visibleWidth(GUTTER));
		const details = record.details.length > 0 ? record.details : ["No additional details were recorded."];
		const wrap = (lines: readonly string[]): string[] =>
			lines.flatMap((line) => wrapTextWithAnsi(line || " ", available));
		return [
			...(record.action ? [sectionHeading(this.context.theme, "Action"), ...wrap([record.action]), ""] : []),
			sectionHeading(this.context.theme, "Details"),
			...wrap(details),
		];
	}
}

export function createDiagnosticsView(channel: DiagnosticChannel): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new DiagnosticsDialog(channel, context),
	};
}
