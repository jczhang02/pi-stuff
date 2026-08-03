import type { Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CommandDialogComponent, CommandDialogView, CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import type { ToolActivity, ToolActivityState } from "./activity-store.js";
import type { ToolUiRuntime } from "./contract.js";
import { formatElapsed, oneLine, sanitizeTerminalText, toolStateGlyph } from "./render.js";

type ToolDialogMode = "detail" | "list";

const GUTTER = "  ";
const NORMAL_SCREEN_RESERVE_ROWS = 3;
const DETAIL_NON_DOCUMENT_ROWS = 9;
const NARROW_WIDTH = 64;
const LIST_ROWS = 8;
const NARROW_LIST_ROWS = 6;

function terminalRows(context: CommandDialogViewContext): number {
	const rows = (context.tui.terminal as { rows?: number }).rows;
	if (rows === undefined || !Number.isFinite(rows)) return 24;
	return Math.max(0, Math.floor(rows));
}

function dialogRows(context: CommandDialogViewContext): number {
	const rows = terminalRows(context);
	if (rows === 0) return 0;
	return Math.max(1, rows - NORMAL_SCREEN_RESERVE_ROWS);
}

function stateText(theme: Theme, state: ToolActivityState, value: string): string {
	switch (state) {
		case "running":
			return theme.fg("accent", value);
		case "success":
			return theme.fg("success", value);
		case "error":
			return theme.fg("error", value);
		case "rejected":
			return theme.fg("warning", value);
		case "cancelled":
			return theme.fg("muted", value);
	}
}

function bounded(width: number, line: string): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function hintLines(theme: Theme, width: number, hints: readonly string[]): string[] {
	const available = Math.max(1, width - visibleWidth(GUTTER));
	const lines: string[] = [];
	let current = "";
	for (const hint of hints) {
		const safeHint = oneLine(hint);
		if (!safeHint) continue;
		const candidate = current ? `${current} · ${safeHint}` : safeHint;
		if (current && visibleWidth(candidate) > available) {
			lines.push(current);
			current = "";
		}
		if (visibleWidth(safeHint) <= available) {
			current = current ? `${current} · ${safeHint}` : safeHint;
			continue;
		}
		const wrapped = wrapTextWithAnsi(safeHint, available);
		lines.push(...wrapped.slice(0, -1));
		current = wrapped.at(-1) ?? "";
	}
	if (current) lines.push(current);
	if (lines.length === 0) lines.push("Esc close");
	return lines.map((line) => `${GUTTER}${theme.fg("dim", line)}`);
}

function fitRows(
	header: readonly string[],
	body: readonly string[],
	footer: readonly string[],
	maximumRows: number,
): string[] {
	if (maximumRows <= 0) return [];
	const visibleFooter = footer.slice(-Math.min(maximumRows, footer.length));
	const rowsBeforeFooter = maximumRows - visibleFooter.length;
	const visibleHeader = header.slice(0, rowsBeforeFooter);
	const bodyRows = Math.max(0, rowsBeforeFooter - visibleHeader.length);
	return [...visibleHeader, ...body.slice(0, bodyRows), ...visibleFooter];
}

function wrapDetailLines(lines: readonly string[], width: number): string[] {
	const contentWidth = Math.max(1, width - visibleWidth(GUTTER));
	return lines.flatMap((line) => {
		const safeLine = sanitizeTerminalText(line);
		return safeLine ? wrapTextWithAnsi(safeLine, contentWidth) : [""];
	});
}

interface DetailWrapCache {
	readonly activityId: string;
	readonly contentKey: string;
	readonly document: readonly string[];
	readonly source: readonly string[];
	readonly width: number;
}

class ToolDialogComponent implements CommandDialogComponent {
	private activities: readonly ToolActivity[];
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private detailWrapCache: DetailWrapCache | undefined;
	private lastRenderWidth = 64;
	private mode: ToolDialogMode;
	private scrollOffset = 0;
	private selectedId: string | undefined;
	private readonly unsubscribe: () => void;

	constructor(runtime: ToolUiRuntime, context: CommandDialogViewContext<void>, initialId?: string) {
		this.context = context;
		this.activities = runtime.activities.list();
		const initial = initialId ? runtime.activities.resolve(initialId) : undefined;
		this.selectedId = initial?.id ?? this.activities[0]?.id;
		this.mode = initial ? "detail" : "list";
		this.unsubscribe = runtime.activities.subscribe((activities) => {
			this.activities = activities;
			this.reconcileSelection();
			this.context.requestRender();
		});
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
			} else {
				this.context.close();
			}
			return;
		}
		if (this.mode === "list") this.handleListInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		this.lastRenderWidth = renderWidth;
		const lines = this.mode === "list" ? this.renderList(renderWidth) : this.renderDetail(renderWidth);
		return lines.map((line) => bounded(renderWidth, line));
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.enter)) {
			if (!this.selected()) return;
			this.mode = "detail";
			this.scrollOffset = 0;
			this.context.requestRender();
			return;
		}
		if (!matchesKey(data, Key.up) && !matchesKey(data, Key.down)) return;
		if (this.activities.length === 0) return;
		const current = Math.max(
			0,
			this.activities.findIndex((activity) => activity.id === this.selectedId),
		);
		const delta = matchesKey(data, Key.up) ? -1 : 1;
		const next = Math.max(0, Math.min(this.activities.length - 1, current + delta));
		this.selectedId = this.activities[next]?.id;
		this.context.requestRender();
	}

	private handleDetailInput(data: string): void {
		if (
			!matchesKey(data, Key.up) &&
			!matchesKey(data, Key.down) &&
			!matchesKey(data, "pageUp") &&
			!matchesKey(data, "pageDown")
		) {
			return;
		}
		const activity = this.selected();
		if (!activity) return;
		const layout = this.detailLayout(activity, this.lastRenderWidth);
		const page = Math.max(1, layout.viewportRows);
		const delta = matchesKey(data, Key.up)
			? -1
			: matchesKey(data, Key.down)
				? 1
				: matchesKey(data, "pageUp")
					? -page
					: page;
		this.scrollOffset = Math.max(0, Math.min(layout.maxOffset, this.scrollOffset + delta));
		this.context.requestRender();
	}

	private renderList(width: number): string[] {
		const theme = this.context.theme;
		const footer = hintLines(theme, width, ["↑/↓ select", "Enter details", "Esc close"]);
		const maximumRows = dialogRows(this.context);
		const preferredRows = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const viewportRows = Math.min(preferredRows, Math.max(0, maximumRows - 2 - footer.length - 2));
		const selectedIndex = Math.max(
			0,
			this.activities.findIndex((activity) => activity.id === this.selectedId),
		);
		const start = Math.max(
			0,
			Math.min(selectedIndex - Math.floor(viewportRows / 2), this.activities.length - viewportRows),
		);
		const visible = viewportRows > 0 ? this.activities.slice(start, start + viewportRows) : [];
		const count =
			width >= 52 ? theme.fg("dim", ` · ${String(this.activities.length)} current-session operations`) : "";
		const header = [theme.fg("border", "─".repeat(width)), `${GUTTER}${theme.bold("Tools")}${count}`];
		const body = [""];
		if (visible.length === 0) {
			if (this.activities.length === 0)
				body.push(`${GUTTER}${theme.fg("dim", "No tool operations in this session.")}`);
		} else {
			if (start > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${String(start)} newer`)}`);
			for (const activity of visible) {
				const selected = activity.id === this.selectedId;
				const cursor = selected ? theme.fg("accent", "›") : " ";
				const glyph = stateText(theme, activity.state, toolStateGlyph(activity.state));
				const label = selected ? theme.bold(activity.label) : activity.label;
				const target = activity.target ? ` ${theme.fg("dim", oneLine(activity.target))}` : "";
				const summary = activity.summary ? ` · ${stateText(theme, activity.state, oneLine(activity.summary))}` : "";
				body.push(`${GUTTER}${cursor} ${glyph} ${label}${target}${summary}`);
			}
			const older = this.activities.length - start - visible.length;
			if (older > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${String(older)} older`)}`);
		}
		body.push("");
		return fitRows(header, body, footer, maximumRows);
	}

	private renderDetail(width: number): string[] {
		const theme = this.context.theme;
		const activity = this.selected();
		if (!activity) {
			this.mode = "list";
			return this.renderList(width);
		}
		const layout = this.detailLayout(activity, width);
		this.scrollOffset = Math.min(layout.maxOffset, Math.max(0, this.scrollOffset));
		const detail = layout.document.slice(this.scrollOffset, this.scrollOffset + layout.viewportRows);
		const suffix =
			activity.state === "running"
				? "running"
				: activity.durationMs === undefined
					? "—"
					: formatElapsed(activity.durationMs);
		const header = [
			theme.fg("border", "─".repeat(width)),
			`${GUTTER}${theme.bold("Tool details")} ${theme.fg("dim", `· ${oneLine(activity.label)}`)}`,
		];
		const body = [
			"",
			`${GUTTER}${theme.fg("dim", "State")}  ${stateText(theme, activity.state, activity.state)} ${theme.fg("dim", `· ${suffix}`)}`,
			`${GUTTER}${theme.fg("dim", "Target")} ${oneLine(activity.target) || "—"}`,
			`${GUTTER}${theme.fg("dim", "Result")} ${oneLine(activity.summary) || "—"}`,
			`${GUTTER}${theme.fg("dim", "ID")}     ${oneLine(activity.id)}`,
			"",
			...detail.map((line) => `${GUTTER}${activity.detailLines.length === 0 ? theme.fg("dim", line) : line}`),
			"",
		];
		return fitRows(header, body, layout.footer, dialogRows(this.context));
	}

	private detailLayout(
		activity: ToolActivity,
		width: number,
	): {
		readonly document: readonly string[];
		readonly footer: readonly string[];
		readonly maxOffset: number;
		readonly viewportRows: number;
	} {
		const document = this.detailDocument(activity, width);
		const maximumRows = dialogRows(this.context);
		let viewportRows = Math.max(0, maximumRows - DETAIL_NON_DOCUMENT_ROWS - 1);
		let footer = hintLines(this.context.theme, width, ["↑/↓ scroll", "Esc back"]);

		for (let iteration = 0; iteration < 3; iteration += 1) {
			viewportRows = Math.max(0, maximumRows - DETAIL_NON_DOCUMENT_ROWS - footer.length);
			const maximumOffset = Math.max(0, document.length - viewportRows);
			const offset = Math.min(maximumOffset, Math.max(0, this.scrollOffset));
			const rangeEnd = Math.min(document.length, offset + viewportRows);
			const range =
				viewportRows > 0 && document.length > viewportRows
					? ` · ${String(offset + 1)}–${String(rangeEnd)}/${String(document.length)}`
					: "";
			const hints = viewportRows > 0 ? [`↑/↓ scroll${range}`, "Esc back"] : ["Esc back"];
			const nextFooter = hintLines(this.context.theme, width, hints);
			if (nextFooter.length === footer.length) {
				footer = nextFooter;
				break;
			}
			footer = nextFooter;
		}

		viewportRows = Math.max(0, maximumRows - DETAIL_NON_DOCUMENT_ROWS - footer.length);
		return {
			document,
			footer,
			maxOffset: Math.max(0, document.length - viewportRows),
			viewportRows,
		};
	}

	private detailDocument(activity: ToolActivity, width: number): readonly string[] {
		const cached = this.detailWrapCache;
		if (cached?.activityId === activity.id && cached.source === activity.detailLines && cached.width === width) {
			return cached.document;
		}

		const contentKey =
			cached?.activityId === activity.id && cached.source === activity.detailLines
				? cached.contentKey
				: JSON.stringify(activity.detailLines);
		if (cached?.activityId === activity.id && cached.contentKey === contentKey && cached.width === width) {
			this.detailWrapCache = { ...cached, source: activity.detailLines };
			return cached.document;
		}

		const document =
			activity.detailLines.length > 0
				? wrapDetailLines(activity.detailLines, width)
				: ["Details are available after completion."];
		this.detailWrapCache = {
			activityId: activity.id,
			contentKey,
			document,
			source: activity.detailLines,
			width,
		};
		return document;
	}

	private reconcileSelection(): void {
		if (this.selectedId && this.activities.some((activity) => activity.id === this.selectedId)) return;
		this.selectedId = this.activities[0]?.id;
		if (!this.selectedId) this.mode = "list";
		this.scrollOffset = 0;
	}

	private selected(): ToolActivity | undefined {
		return this.activities.find((activity) => activity.id === this.selectedId);
	}
}

export function createToolDialogView(runtime: ToolUiRuntime, initialId?: string): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new ToolDialogComponent(runtime, context, initialId),
	};
}
