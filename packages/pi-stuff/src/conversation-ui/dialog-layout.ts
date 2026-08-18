import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogViewContext } from "./index.js";

const DEFAULT_TERMINAL_ROWS = 24;
const DEFAULT_NORMAL_SCREEN_RESERVE_ROWS = 3;

export const WIDE_COMMAND_DIALOG_MIN_WIDTH = 96;

export interface CommandDialogRowSections {
	readonly body: readonly string[];
	/** Divider and title lines in their natural display order. */
	readonly header: readonly string[];
	/** Semantic title used only when overflow forces the ordinary layout to collapse. */
	readonly overflowTitle?: string;
	/** The selected row, current error, or state line that must survive overflow. */
	readonly priority?: readonly string[];
	/** Hint lines in their natural display order; the final line must contain the escape route. */
	readonly footer: readonly string[];
}

/** Shared vertical budget for a focused full-width Command Dialog. */
export function commandDialogRows(
	context: Pick<CommandDialogViewContext<unknown>, "tui">,
	reserveRows = DEFAULT_NORMAL_SCREEN_RESERVE_ROWS,
): number {
	const terminalRows = (context.tui.terminal as { readonly rows?: number }).rows;
	const rows =
		typeof terminalRows === "number" && Number.isFinite(terminalRows)
			? Math.max(0, Math.floor(terminalRows))
			: DEFAULT_TERMINAL_ROWS;
	if (rows === 0) return 0;
	return Math.max(1, rows - Math.max(0, Math.floor(reserveRows)));
}

export function matchesCommandDialogPageUp(data: string): boolean {
	return matchesKey(data, Key.pageUp) || matchesKey(data, Key.shift(Key.up));
}

export function matchesCommandDialogPageDown(data: string): boolean {
	return matchesKey(data, Key.pageDown) || matchesKey(data, Key.shift(Key.down));
}

function withoutPriority(body: readonly string[], priority: readonly string[]): string[] {
	const remaining = [...body];
	for (const line of priority) {
		const index = remaining.indexOf(line);
		if (index >= 0) remaining.splice(index, 1);
	}
	return remaining.filter((line) => line.trim().length > 0);
}

/**
 * Preserve the ordinary layout when it fits. During low-height overflow, keep
 * one escape line first, then the current state/selection and title before
 * allocating optional hints, divider chrome, and body rows.
 */
export function fitCommandDialogRows(sections: CommandDialogRowSections, maximumRows: number): string[] {
	const limit = Math.max(0, Math.floor(maximumRows));
	if (limit === 0) return [];
	const full = [...sections.header, ...sections.body, ...sections.footer];
	if (full.length <= limit) return full;

	const title = sections.overflowTitle ?? sections.header.at(-1);
	const headerPrefix =
		sections.overflowTitle === undefined && title !== undefined ? sections.header.slice(0, -1) : [...sections.header];
	const close = sections.footer.at(-1);
	const footerPrefix = close === undefined ? [...sections.footer] : sections.footer.slice(0, -1);
	const priority = [...new Set((sections.priority ?? []).filter((line) => line.trim().length > 0))];
	const primary =
		priority.find((line) => line !== title) ?? sections.body.find((line) => line !== title && line.trim().length > 0);

	if (limit === 1) return [close ?? primary ?? title ?? full[0] ?? ""];
	if (limit === 2) return [primary ?? title ?? full[0] ?? "", close ?? title ?? full.at(-1) ?? ""];

	let remaining = limit;
	const visibleClose = close ? [close] : [];
	remaining -= visibleClose.length;
	const visiblePriority = primary ? [primary] : [];
	remaining -= visiblePriority.length;
	const visibleTitle = title && remaining > 0 ? [title] : [];
	remaining -= visibleTitle.length;

	const visibleFooterPrefix = remaining > 0 ? footerPrefix.slice(-Math.min(remaining, footerPrefix.length)) : [];
	remaining -= visibleFooterPrefix.length;
	const visibleHeaderPrefix = remaining > 0 ? headerPrefix.slice(-Math.min(remaining, headerPrefix.length)) : [];
	remaining -= visibleHeaderPrefix.length;
	const additionalPriority = priority.filter((line) => line !== title && line !== primary).slice(0, remaining);
	remaining -= additionalPriority.length;
	const visibleBody = withoutPriority(sections.body, priority).slice(0, remaining);

	return [
		...visibleHeaderPrefix,
		...visibleTitle,
		...visiblePriority,
		...additionalPriority,
		...visibleBody,
		...visibleFooterPrefix,
		...visibleClose,
	];
}

/** Keep a stable Dialog height while anchoring its footer to the bottom row. */
export function fitFixedCommandDialogRows(sections: CommandDialogRowSections, maximumRows: number): string[] {
	const fitted = fitCommandDialogRows(sections, maximumRows);
	const missingRows = Math.max(0, maximumRows - fitted.length);
	if (missingRows === 0) return fitted;
	const footerStart = Math.max(0, fitted.length - sections.footer.length);
	return [
		...fitted.slice(0, footerStart),
		...Array.from({ length: missingRows }, () => ""),
		...fitted.slice(footerStart),
	];
}

/** Render list and detail as one full-width Dialog with one structural divider. */
export function renderCommandDialogSplit(
	theme: Theme,
	width: number,
	renderLeft: (width: number) => readonly string[],
	renderRight: (width: number) => readonly string[],
	preferredLeftWidth = 36,
): string[] {
	const totalWidth = Math.max(1, Math.floor(width));
	const leftWidth = Math.min(preferredLeftWidth, Math.max(30, Math.floor(totalWidth * 0.38)));
	const rightWidth = Math.max(1, totalWidth - leftWidth - 1);
	const left = renderLeft(leftWidth);
	const right = renderRight(rightWidth);
	const rows = Math.max(left.length, right.length);
	const divider = theme.fg("border", "┃");

	return Array.from({ length: rows }, (_, index) => {
		if (index === 0) return theme.fg("border", "━".repeat(totalWidth));
		const leftLine = truncateToWidth(left[index] ?? "", leftWidth, "…");
		const rightLine = truncateToWidth(right[index] ?? "", rightWidth, "…");
		return `${leftLine}${" ".repeat(Math.max(0, leftWidth - visibleWidth(leftLine)))}${divider}${rightLine}`;
	});
}
