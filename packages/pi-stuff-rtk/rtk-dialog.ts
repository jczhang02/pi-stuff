import { isKeyRelease, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CommandDialogComponent, CommandDialogView, CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import type { RtkProjectionAdapter } from "./projection.js";
import type { RtkRuntime } from "./runtime.js";
import type { RtkSettingsStore } from "./settings.js";

const GUTTER = "  ";
const NORMAL_SCREEN_RESERVE_ROWS = 3;

export interface RtkDialogOptions {
	readonly note?: string;
	readonly projection: RtkProjectionAdapter;
	readonly runtime: RtkRuntime;
	readonly settings: RtkSettingsStore;
}

function terminalRows(context: CommandDialogViewContext): number {
	const rows = (context.tui.terminal as { rows?: number }).rows;
	if (rows === undefined || !Number.isFinite(rows)) return 24;
	return Math.max(0, Math.floor(rows));
}

function dialogRows(context: CommandDialogViewContext): number {
	const rows = terminalRows(context);
	return rows === 0 ? 0 : Math.max(1, rows - NORMAL_SCREEN_RESERVE_ROWS);
}

function percent(saved: number, original: number): string {
	return original > 0 ? `${String(Math.round((saved / original) * 100))}%` : "0%";
}

function oneLine(value: string): string {
	return value
		.replaceAll(/[\p{Cc}\p{Cf}]+/gu, " ")
		.replaceAll(/\s+/gu, " ")
		.trim();
}

class RtkDialogComponent implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private readonly options: RtkDialogOptions;

	constructor(context: CommandDialogViewContext<void>, options: RtkDialogOptions) {
		this.context = context;
		this.options = options;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") this.context.close();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const maximumRows = dialogRows(this.context);
		if (maximumRows === 0) return [];
		const theme = this.context.theme;
		const runtime = this.options.runtime.snapshot();
		const settings = this.options.settings.get();
		const stats = this.options.projection.stats();
		const runtimeColor = runtime.state === "ready" ? "success" : runtime.state === "unchecked" ? "dim" : "error";
		const techniques = Object.entries(stats.techniques)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, count]) => `${name} ${String(count)}`)
			.join(" · ");
		const body = [
			theme.fg("border", "─".repeat(renderWidth)),
			`${GUTTER}${theme.bold("RTK")}`,
			"",
			`${GUTTER}${theme.fg(runtimeColor, runtime.state)}${runtime.version ? theme.fg("dim", ` · ${runtime.version}`) : ""}`,
			...(runtime.path ? this.wrapped(renderWidth, `Binary  ${runtime.path}`) : []),
			...(runtime.sha256 ? [`${GUTTER}${theme.fg("dim", `SHA-256  ${runtime.sha256.slice(0, 16)}…`)}`] : []),
			...(runtime.lastError ? this.wrapped(renderWidth, theme.fg("error", oneLine(runtime.lastError))) : []),
			"",
			`${GUTTER}Command rewriting  ${settings.rewriteCommands ? theme.fg("success", "on") : theme.fg("dim", "off")}`,
			`${GUTTER}Model projection  ${settings.outputProjection ? theme.fg("success", "on") : theme.fg("dim", "off")}`,
			`${GUTTER}Saved  ${String(stats.savedChars)} chars (${percent(stats.savedChars, stats.originalChars)}) · ${String(stats.resultCount)} results`,
			...(techniques ? this.wrapped(renderWidth, `Techniques  ${techniques}`) : []),
			...(this.options.note ? ["", ...this.wrapped(renderWidth, this.options.note)] : []),
			"",
			`${GUTTER}${theme.fg("dim", "Configure in /ui · Enter/Esc close")}`,
		];
		return body.slice(0, maximumRows).map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private wrapped(width: number, value: string): string[] {
		const available = Math.max(1, width - GUTTER.length);
		return wrapTextWithAnsi(value, available).map((line) => `${GUTTER}${line}`);
	}
}

export function createRtkDialogView(options: RtkDialogOptions): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new RtkDialogComponent(context, options),
	};
}
