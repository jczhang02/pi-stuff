import { homedir } from "node:os";
import { isKeyRelease, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogHintLines,
	commandDialogNavigation,
	commandDialogPrimaryKey,
	commandDialogReadKeyHelp,
	commandDialogRows,
	commandDialogScrollOffset,
	fitCommandDialogRows,
	matchesCommandDialogCancel,
	matchesCommandDialogHelp,
	renderCommandDialogKeyHelp,
} from "../conversation-ui/index.js";
import { boundTerminalLine, compactTerminalPath } from "../tool-display/index.js";
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

function sectionHeading(theme: CommandDialogViewContext["theme"], value: string): string {
	return `${GUTTER}${theme.fg("accent", "◆")} ${theme.bold(value)}`;
}

const RUNTIME_STYLES = {
	drifted: { color: "warning", glyph: "!" },
	ready: { color: "success", glyph: "✓" },
	unavailable: { color: "error", glyph: "×" },
	unchecked: { color: "muted", glyph: "○" },
} as const;

/** Keep the executable identity useful without letting a package-manager path consume the dialog. */
export function compactRtkBinaryPath(value: string, maximumWidth: number): string {
	const width = Math.max(1, Math.floor(maximumWidth));
	const clean = boundTerminalLine(value, Number.MAX_SAFE_INTEGER);
	const home = boundTerminalLine(homedir(), Number.MAX_SAFE_INTEGER);
	const display = home && (clean === home || clean.startsWith(`${home}/`)) ? `~${clean.slice(home.length)}` : clean;
	return compactTerminalPath(display, width);
}

class RtkDialogComponent implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private lastMaximumScroll = 0;
	private lastViewportRows = 1;
	private readonly options: RtkDialogOptions;
	private scrollOffset = 0;
	private showKeyHelp = false;

	constructor(context: CommandDialogViewContext<void>, options: RtkDialogOptions) {
		this.context = context;
		this.options = options;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (this.showKeyHelp) {
			if (matchesCommandDialogCancel(data, this.context.keybindings)) {
				this.showKeyHelp = false;
				this.context.requestRender();
			}
			return;
		}
		if (matchesCommandDialogHelp(data)) {
			this.showKeyHelp = true;
			this.context.requestRender();
			return;
		}
		if (matchesCommandDialogCancel(data, this.context.keybindings)) {
			this.context.close();
			return;
		}
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (!navigation) return;
		this.scrollOffset = commandDialogScrollOffset(
			this.scrollOffset,
			this.lastMaximumScroll,
			this.lastViewportRows,
			navigation,
		);
		this.context.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		if (this.showKeyHelp) {
			return renderCommandDialogKeyHelp(
				this.context,
				renderWidth,
				"RTK",
				commandDialogReadKeyHelp(this.context.keybindings, "line", [
					{ keys: "/rtk settings", description: "Open RTK settings" },
				]),
			);
		}
		const maximumRows = commandDialogRows(this.context);
		if (maximumRows === 0) return [];
		const theme = this.context.theme;
		const runtime = this.options.runtime.snapshot();
		const settings = this.options.settings.get();
		const stats = this.options.projection.stats();
		const { color: runtimeColor, glyph: runtimeGlyph } = RUNTIME_STYLES[runtime.state];
		const techniques = Object.entries(stats.techniques)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, count]) => `${name} ${String(count)}`)
			.join(" · ");
		const version = runtime.version
			? runtime.version.startsWith("v")
				? runtime.version
				: `v${runtime.version}`
			: "";
		const runtimeLine = `${GUTTER}${theme.fg(runtimeColor, `${runtimeGlyph} ${runtime.state}`)}${
			version ? theme.fg("dim", ` · ${version}`) : ""
		}`;
		const errorLines = runtime.lastError
			? this.wrapped(renderWidth, theme.fg("error", boundTerminalLine(runtime.lastError, 220)))
			: [];
		const noteHeading = this.options.note?.startsWith("/rtk ") ? "Commands" : "Feedback";
		const note = this.options.note
			? this.options.note === "Projection statistics cleared."
				? "✓ Projection statistics cleared."
				: this.options.note.startsWith("Unknown action")
					? `! ${this.options.note}`
					: this.options.note
			: undefined;
		const body = [
			"",
			sectionHeading(theme, "Runtime"),
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
			...(runtime.state === "unchecked" && !runtime.path
				? [`${GUTTER}${theme.fg("muted", "Not verified yet.")}`]
				: []),
			...(errorLines.length > 0
				? ["", sectionHeading(theme, "Error"), ...errorLines, `${GUTTER}${theme.fg("warning", "Run /rtk verify")}`]
				: []),
			"",
			sectionHeading(theme, "Behavior"),
			`${GUTTER}${settings.rewriteCommands ? theme.fg("success", "✓") : theme.fg("muted", "○")} Command rewriting ${settings.rewriteCommands ? "on" : "off"}`,
			`${GUTTER}${settings.outputProjection ? theme.fg("success", "✓") : theme.fg("muted", "○")} Model projection ${settings.outputProjection ? "on" : "off"}`,
			...this.wrapped(
				renderWidth,
				theme.fg(
					"dim",
					"Model projection changes only the compact copy sent to the model; stored output stays exact.",
				),
			),
			"",
			sectionHeading(theme, "Session savings"),
			`${GUTTER}${String(stats.savedChars)} chars (${percent(stats.savedChars, stats.originalChars)}) · ${String(stats.resultCount)} results`,
			...(techniques ? this.wrapped(renderWidth, `Techniques  ${techniques}`) : []),
			...(note ? ["", sectionHeading(theme, noteHeading), ...this.wrapped(renderWidth, note)] : []),
		];
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const pageUp = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageUp", "PgUp");
		const pageDown = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageDown", "PgDn");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		const footerFor = (overflow: boolean) =>
			commandDialogHintLines(theme, renderWidth, [
				...(overflow ? [`${up}/${down} scroll`, `${pageUp}/${pageDown} page`] : []),
				"/rtk settings",
				"? keys",
				`${cancel} close`,
			]);
		let footer = footerFor(false);
		this.lastViewportRows = Math.max(1, maximumRows - 2 - footer.length);
		this.lastMaximumScroll = Math.max(0, body.length - this.lastViewportRows);
		footer = footerFor(this.lastMaximumScroll > 0);
		this.lastViewportRows = Math.max(1, maximumRows - 2 - footer.length);
		this.lastMaximumScroll = Math.max(0, body.length - this.lastViewportRows);
		this.scrollOffset = Math.min(this.lastMaximumScroll, Math.max(0, this.scrollOffset));
		const visibleBody = body.slice(this.scrollOffset, this.scrollOffset + this.lastViewportRows);
		const lines = fitCommandDialogRows(
			{
				header: [theme.fg("border", "━".repeat(renderWidth)), `${GUTTER}${theme.bold("RTK")}`],
				body: visibleBody,
				footer,
				priority: [visibleBody.find((line) => line.trim().length > 0) ?? errorLines[0] ?? runtimeLine],
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
