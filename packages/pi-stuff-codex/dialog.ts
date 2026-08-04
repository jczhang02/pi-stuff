import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import type { CommandDialogComponent, CommandDialogView, CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import { type CodexUsageSnapshot, formatCodexUsage } from "./usage.js";

const GUTTER = "  ";
const MIN_RENDER_WIDTH = 24;
const RESERVED_ROWS = 3;

export interface CodexControls {
	getFast(): boolean;
	getUsage(): CodexUsageSnapshot | undefined;
	refreshUsage(signal: AbortSignal | undefined): Promise<CodexUsageSnapshot>;
	setFast(enabled: boolean): Promise<void>;
}

function oneLine(value: unknown): string {
	return String(value)
		.split("")
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 32 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
		})
		.join("")
		.replaceAll(/\s+/gu, " ")
		.trim();
}

function maximumRows(context: CommandDialogViewContext): number {
	const rows = (context.tui.terminal as { rows?: number }).rows;
	return Math.max(1, Math.floor(typeof rows === "number" && Number.isFinite(rows) ? rows : 24) - RESERVED_ROWS);
}

class CodexDialog implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private readonly controls: CodexControls;
	private disposed = false;
	private error = "";
	private loading = false;
	private readonly settingsList: SettingsList;
	private usage: CodexUsageSnapshot | undefined;

	constructor(context: CommandDialogViewContext<void>, controls: CodexControls) {
		this.context = context;
		this.controls = controls;
		this.usage = controls.getUsage();
		const items: SettingItem[] = [
			{
				currentValue: controls.getFast() ? "on" : "off",
				description: "Use OpenAI priority service tier for Codex turns",
				id: "fast",
				label: "Fast mode",
				values: ["off", "on"],
			},
		];
		this.settingsList = new SettingsList(
			items,
			1,
			getSettingsListTheme(),
			(_id, value) => this.updateFast(value === "on"),
			() => context.close(),
			{ enableSearch: false },
		);
		void this.refreshUsage();
	}

	dispose(): void {
		this.disposed = true;
	}

	handleInput(data: string): void {
		if (data === "r" || data === "R") void this.refreshUsage();
		else this.settingsList.handleInput?.(data);
		this.context.requestRender();
	}

	invalidate(): void {
		this.settingsList.invalidate();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const nativeLines = this.settingsList.render(Math.max(MIN_RENDER_WIDTH, renderWidth));
		const usageLines = this.loading
			? [this.context.theme.fg("dim", "Loading usage…")]
			: this.usage
				? formatCodexUsage(this.usage).split("\n")
				: [this.context.theme.fg("dim", "Usage unavailable")];
		const lines = [
			this.context.theme.fg("border", "─".repeat(renderWidth)),
			`${GUTTER}${this.context.theme.bold("Codex")}`,
			...nativeLines,
			"",
			`${GUTTER}${this.context.theme.bold("Usage")}`,
			...usageLines.map((line) => `${GUTTER}${line}`),
			"",
			`${GUTTER}${this.context.theme.bold("Tools")}`,
			`${GUTTER}${this.context.theme.fg("dim", "apply_patch · view_image · imagegen (gpt-image-2)")}`,
			...(this.error ? ["", `${GUTTER}${this.context.theme.fg("error", this.error)}`] : []),
			"",
			`${GUTTER}${this.context.theme.fg("dim", "Enter toggle · R refresh · Esc close")}`,
		];
		return this.fitHeight(lines, maximumRows(this.context)).map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private fitHeight(lines: readonly string[], rows: number): string[] {
		if (lines.length <= rows) return [...lines];
		if (rows <= 2) return lines.slice(0, rows);
		const selected = lines.find((line) => line.includes("→")) ?? lines[2] ?? GUTTER;
		const usage = lines.find((line) => line.includes("Weekly")) ?? `${GUTTER}Usage unavailable`;
		const compact = [lines[0] ?? "", lines[1] ?? `${GUTTER}Codex`, selected, usage];
		return compact.slice(0, rows);
	}

	private async refreshUsage(): Promise<void> {
		if (this.loading || this.disposed) return;
		this.loading = true;
		this.error = "";
		this.context.requestRender();
		try {
			this.usage = await this.controls.refreshUsage(this.context.signal);
		} catch (error) {
			this.error = oneLine(error) || "Unable to load Codex usage.";
		} finally {
			this.loading = false;
			if (!this.disposed) this.context.requestRender();
		}
	}

	private async updateFast(enabled: boolean): Promise<void> {
		this.error = "";
		try {
			await this.controls.setFast(enabled);
		} catch (error) {
			this.error = oneLine(error) || "Unable to save Fast mode.";
		} finally {
			this.settingsList.updateValue("fast", this.controls.getFast() ? "on" : "off");
			if (!this.disposed) this.context.requestRender();
		}
	}
}

export function createCodexDialogView(controls: CodexControls): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new CodexDialog(context, controls),
	};
}
