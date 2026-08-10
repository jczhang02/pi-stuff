import { homedir } from "node:os";
import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "../conversation-ui/index.js";
import type { RtkProjectionAdapter } from "./projection.js";
import type { RtkRuntime } from "./runtime.js";
import type { RtkSettingsStore } from "./settings.js";

const GUTTER = "  ";

export interface RtkDialogOptions {
	readonly note?: string;
	readonly projection: RtkProjectionAdapter;
	readonly runtime: RtkRuntime;
	readonly settings: RtkSettingsStore;
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

/** Keep the executable identity useful without letting a package-manager path consume the dialog. */
export function compactRtkBinaryPath(value: string, maximumWidth: number): string {
	const width = Math.max(1, Math.floor(maximumWidth));
	const clean = oneLine(value);
	const home = oneLine(homedir());
	const display = home && (clean === home || clean.startsWith(`${home}/`)) ? `~${clean.slice(home.length)}` : clean;
	if (visibleWidth(display) <= width) return display;

	const root = display.startsWith("~/") ? "~/" : display.startsWith("/") ? "/" : "";
	const remainder = root === "~/" ? display.slice(2) : root === "/" ? display.slice(1) : display;
	const pieces = remainder.split("/").filter(Boolean);
	if (pieces.length >= 3) {
		const tail = pieces.slice(-2).join("/");
		const withOrigin = `${root}${pieces[0]}/…/${tail}`;
		if (visibleWidth(withOrigin) <= width) return withOrigin;
		const tailOnly = `…/${tail}`;
		if (visibleWidth(tailOnly) <= width) return tailOnly;
	}
	return truncateToWidth(display, width, "…");
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
		const maximumRows = commandDialogRows(this.context);
		if (maximumRows === 0) return [];
		const theme = this.context.theme;
		const runtime = this.options.runtime.snapshot();
		const settings = this.options.settings.get();
		const stats = this.options.projection.stats();
		const runtimeColor = runtime.state === "ready" ? "success" : runtime.state === "unchecked" ? "muted" : "error";
		const techniques = Object.entries(stats.techniques)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, count]) => `${name} ${String(count)}`)
			.join(" · ");
		const runtimeLine = `${GUTTER}${theme.fg(runtimeColor, runtime.state)}${runtime.version ? theme.fg("dim", ` · ${runtime.version}`) : ""}`;
		const errorLines = runtime.lastError
			? this.wrapped(renderWidth, theme.fg("error", oneLine(runtime.lastError)))
			: [];
		const body = [
			"",
			runtimeLine,
			...(runtime.path
				? [
						`${GUTTER}Binary  ${compactRtkBinaryPath(
							runtime.path,
							Math.max(1, renderWidth - GUTTER.length - "Binary  ".length),
						)}`,
					]
				: []),
			...(runtime.sha256 ? [`${GUTTER}${theme.fg("dim", `SHA-256  ${runtime.sha256.slice(0, 16)}…`)}`] : []),
			...errorLines,
			"",
			`${GUTTER}Command rewriting  ${settings.rewriteCommands ? theme.fg("success", "on") : theme.fg("muted", "off")}`,
			`${GUTTER}Model projection  ${settings.outputProjection ? theme.fg("success", "on") : theme.fg("muted", "off")}`,
			`${GUTTER}Saved  ${String(stats.savedChars)} chars (${percent(stats.savedChars, stats.originalChars)}) · ${String(stats.resultCount)} results`,
			...(techniques ? this.wrapped(renderWidth, `Techniques  ${techniques}`) : []),
			...(this.options.note ? ["", ...this.wrapped(renderWidth, this.options.note)] : []),
		];
		const lines = fitCommandDialogRows(
			{
				header: [theme.fg("border", "─".repeat(renderWidth)), `${GUTTER}${theme.bold("RTK")}`],
				body,
				footer: [`${GUTTER}${theme.fg("dim", "Configure with /rtk settings · Enter/Esc close")}`],
				priority: [errorLines[0] ?? runtimeLine],
			},
			maximumRows,
		);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
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
