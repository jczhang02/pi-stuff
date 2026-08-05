/**
 * PROTOTYPE ONLY — compare bottom-stack seams and official Pi-mark treatments
 * inside the real Pi Host. This is disposable visual evidence, not production.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PROVIDER = "bottom-welcome-fixture";
const MODEL = "gpt-5.6-sol";
const MODEL_IDENTITY = "openai-codex/gpt-5.6-sol";
const PROMPT = "请保持主任务继续，并让我随时查看并行 Agent。";
const WIDE_LEFT_COLUMN_WIDTH = 52;

type Variant = "a" | "b" | "c";
type Surface = "bottom" | "welcome";

interface Segment {
	readonly priority: number;
	readonly text: string;
}

function configuredVariant(): Variant {
	// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket access.
	const value = process.env["PI_STUFF_PROTOTYPE_VARIANT"]?.toLowerCase();
	return value === "b" || value === "c" ? value : "a";
}

function configuredSurface(): Surface {
	// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket access.
	return process.env["PI_STUFF_PROTOTYPE_SURFACE"] === "welcome" ? "welcome" : "bottom";
}

class EmptyComponent implements Component {
	invalidate(): void {}
	render(): string[] {
		return [];
	}
}

class BottomPrototype implements Component {
	private readonly theme: Theme;
	private readonly variant: Variant;

	constructor(theme: Theme, variant: Variant) {
		this.theme = theme;
		this.variant = variant;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const boundedWidth = Math.max(1, Math.floor(width));
		const status = packStatus(boundedWidth, this.theme);
		const prompt = promptRow(PROMPT, boundedWidth, this.theme);
		const fleet = fleetRows(boundedWidth, this.theme);
		if (this.variant === "b") return [status, prompt, "", ...fleet];
		if (this.variant === "c") {
			return [status, prompt, this.theme.fg("borderMuted", "─".repeat(boundedWidth)), ...fleet];
		}
		return [status, prompt, ...fleet];
	}
}

class WelcomePrototype implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly variant: Variant;

	constructor(theme: Theme, tui: TUI, variant: Variant) {
		this.theme = theme;
		this.tui = tui;
		this.variant = variant;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const boundedWidth = Math.max(1, Math.floor(width));
		if (boundedWidth < 18) return [truncateToWidth("Pi Stuff", boundedWidth, "")];
		const terminalRows = readTerminalRows(this.tui);
		const compact = this.variant === "c" || (this.variant === "a" && (boundedWidth < 48 || terminalRows <= 18));
		const color = this.variant === "b" ? "text" : "accent";
		const logo = officialPiMark(this.theme, compact, color);
		return boundedWidth >= 70
			? wideWelcome(this.theme, boundedWidth, logo)
			: narrowWelcome(this.theme, boundedWidth, logo);
	}
}

function statusSegments(theme: Theme): readonly Segment[] {
	return [
		{ priority: 100, text: `${theme.fg("accent", "󰚩")} ${theme.fg("accent", MODEL_IDENTITY)}` },
		{ priority: 65, text: `${theme.fg("accent", "")} ${theme.fg("muted", "high")}` },
		{ priority: 55, text: theme.fg("warning", " Fast") },
		{ priority: 95, text: `${theme.fg("accent", "󰉋")} ${theme.fg("text", "pi-stuff")}` },
		{ priority: 90, text: `${theme.fg("muted", "")} ${theme.fg("text", "main")}` },
		{
			priority: 50,
			text: `${theme.fg("muted", "")} ${theme.fg("success", "(+6,")}${theme.fg("error", "-0")}${theme.fg("success", ")")}`,
		},
		{ priority: 85, text: `${theme.fg("muted", "󰍛")} ${theme.fg("text", "42%")}` },
		{ priority: 45, text: `${theme.fg("muted", "󰆼")} ${theme.fg("text", "78%")}` },
		{ priority: 80, text: `${theme.fg("warning", "󰃭")} ${theme.fg("text", "52%")}` },
	];
}

function packStatus(width: number, theme: Theme): string {
	const selected = [...statusSegments(theme)];
	const separator = theme.fg("dim", " · ");
	const render = (): string => selected.map((segment) => segment.text).join(separator);
	while (selected.length > 1 && visibleWidth(render()) > width) {
		let removalIndex = 0;
		for (let index = 1; index < selected.length; index += 1) {
			if ((selected[index]?.priority ?? Infinity) < (selected[removalIndex]?.priority ?? 0)) removalIndex = index;
		}
		selected.splice(removalIndex, 1);
	}
	return truncateToWidth(render(), width, theme.fg("dim", "…"));
}

function promptRow(prompt: string, width: number, theme: Theme): string {
	const markerGap = visibleWidth(Array.from(prompt)[0] ?? "") > 1 ? "" : " ";
	const marker = `${theme.fg("accent", "")}${markerGap}`;
	return `${marker}${theme.fg("dim", truncateToWidth(prompt, Math.max(1, width - visibleWidth(marker)), "…"))}`;
}

function fleetRows(width: number, theme: Theme): string[] {
	return [
		truncateToWidth(`  ${theme.fg("dim", "↓ to manage")}`, width, ""),
		truncateToWidth(`  ${theme.fg("accent", "●")} ${theme.fg("text", "main")}`, width, ""),
		fleetRow("explorer", "Inspect Claude activity UI", "14s", width, theme),
		fleetRow("reviewer", "Check Pi interaction constraints", "11s", width, theme),
	];
}

function fleetRow(name: string, description: string, state: string, width: number, theme: Theme): string {
	const prefix = `  ${theme.fg("muted", "○")} `;
	const right = theme.fg("dim", state);
	const rightWidth = visibleWidth(right);
	const leftBudget = Math.max(1, width - rightWidth - 2);
	const nameText = theme.fg("text", truncateToWidth(name, Math.max(1, leftBudget - visibleWidth(prefix)), "…"));
	const descriptionBudget = Math.max(0, leftBudget - visibleWidth(prefix) - visibleWidth(nameText) - 2);
	const fittedDescription = visibleWidth(description) <= descriptionBudget ? description : "";
	const left = `${prefix}${nameText}${fittedDescription ? `  ${theme.fg("muted", fittedDescription)}` : ""}`;
	const gap = Math.max(2, width - visibleWidth(left) - rightWidth);
	return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "");
}

function officialPiMark(theme: Theme, compact: boolean, color: "accent" | "text"): readonly string[] {
	const rows = compact ? ["█▀█ ", "█▀ █"] : ["██████  ", "██  ██  ", "████  ██", "██    ██"];
	return rows.map((row) => theme.fg(color, row));
}

function wideWelcome(theme: Theme, width: number, logo: readonly string[]): string[] {
	const rightWidth = Math.max(1, width - WIDE_LEFT_COLUMN_WIDTH - 3);
	const rightDivider = theme.fg("borderMuted", "─".repeat(Math.max(0, rightWidth - 2)));
	const loadedRows = [theme.bold("Loaded"), "3 context · 24 extensions", "30 tools · 77 skills"];
	const identityRowCount = Math.max(logo.length, loadedRows.length);
	const identityRows = Array.from({ length: identityRowCount }, (_unused, index) =>
		wideBoxRow(theme, width, logo[index] ?? "", loadedRows[index] ?? ""),
	);
	const logoGap = logo.length >= loadedRows.length ? [wideBoxRow(theme, width, "", "")] : [];
	return [
		boxTop(theme, width, true),
		wideBoxRow(theme, width, "", theme.bold("Tips for getting started")),
		wideBoxRow(theme, width, theme.bold("Welcome back!"), "Type / to browse commands"),
		wideBoxRow(theme, width, "", rightDivider),
		...identityRows,
		...logoGap,
		wideBoxRow(theme, width, `${theme.fg("accent", "gpt-5.6-sol")} · openai-codex`, ""),
		wideBoxRow(theme, width, theme.fg("muted", "~/dev/pi-stuff"), ""),
		boxBottom(theme, width),
	];
}

function narrowWelcome(theme: Theme, width: number, logo: readonly string[]): string[] {
	return [
		boxTop(theme, width, false),
		boxRow(theme, width, theme.bold("Welcome back!")),
		boxRow(theme, width, ""),
		...logo.map((row) => boxRow(theme, width, row)),
		boxRow(theme, width, ""),
		boxRow(theme, width, theme.fg("accent", "gpt-5.6-sol")),
		boxRow(theme, width, theme.fg("muted", "openai-codex")),
		boxRow(theme, width, theme.fg("muted", "~/dev/pi-stuff")),
		boxBottom(theme, width),
	];
}

function boxTop(theme: Theme, width: number, wide: boolean): string {
	const leading = wide ? "───" : "─";
	const title = " Pi Stuff ";
	const remaining = Math.max(0, width - visibleWidth(leading) - visibleWidth(title) - 2);
	return `${theme.fg("borderMuted", `╭${leading}`)}${theme.bold(title)}${theme.fg("borderMuted", `${"─".repeat(remaining)}╮`)}`;
}

function boxBottom(theme: Theme, width: number): string {
	return theme.fg("borderMuted", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

function boxRow(theme: Theme, width: number, content: string): string {
	return `${theme.fg("borderMuted", "│")}${centerCell(content, Math.max(0, width - 2))}${theme.fg("borderMuted", "│")}`;
}

function wideBoxRow(theme: Theme, width: number, left: string, right: string): string {
	const rightWidth = Math.max(0, width - WIDE_LEFT_COLUMN_WIDTH - 3);
	return `${theme.fg("borderMuted", "│")}${centerCell(left, WIDE_LEFT_COLUMN_WIDTH, 3)}${theme.fg("borderMuted", "│")}${startCell(right, rightWidth)}${theme.fg("borderMuted", "│")}`;
}

function centerCell(content: string, width: number, minimumInset = 0): string {
	const inset = Math.min(Math.max(0, minimumInset), Math.floor(Math.max(0, width) / 2));
	const fitted = truncateToWidth(content, Math.max(0, width - inset * 2), "…");
	const padding = Math.max(0, width - visibleWidth(fitted));
	const left = Math.floor(padding / 2);
	return `${" ".repeat(left)}${fitted}${" ".repeat(padding - left)}`;
}

function startCell(content: string, width: number): string {
	if (width < 1) return "";
	const fitted = truncateToWidth(content, Math.max(0, width - 2), "…");
	const line = ` ${fitted}`;
	return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

function readTerminalRows(tui: TUI): number {
	const rows = (tui as unknown as { terminal?: { rows?: unknown } }).terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : Infinity;
}

export default function registerBottomWelcomePrototype(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Bottom and Welcome visual fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "GPT-5.6 Sol fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 272_000,
				maxTokens: 8_192,
			},
		],
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		const variant = configuredVariant();
		if (configuredSurface() === "welcome") {
			ctx.ui.setHeader((tui, theme) => new WelcomePrototype(theme, tui, variant));
			ctx.ui.setFooter(() => new EmptyComponent());
			return;
		}
		ctx.ui.setHeader(() => new EmptyComponent());
		ctx.ui.setFooter((_tui, theme) => new BottomPrototype(theme, variant));
	});
}
