import { type SettingItem, SettingsList, type SettingsListTheme, truncateToWidth } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "../conversation-ui/index.js";

const GUTTER = "  ";
const MIN_RENDER_WIDTH = 24;

export interface CodeModeDialogSnapshot {
	readonly enabled: boolean;
	readonly executionCount: number;
	readonly pendingCount: number;
	readonly snippetCount: number;
	readonly toolCount: number;
}

export interface CodeModeDialogControls {
	getSnapshot(): CodeModeDialogSnapshot;
	setEnabled(enabled: boolean): Promise<void> | void;
}

function settingsListTheme(context: CommandDialogViewContext<void>): SettingsListTheme {
	const theme = context.theme;
	return {
		label: (text, selected) => (selected ? theme.fg("accent", text) : text),
		value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
		description: (text) => theme.fg("dim", text),
		cursor: theme.fg("accent", "→ "),
		hint: (text) => theme.fg("dim", text),
	};
}

function countLabel(count: number, singular: string): string {
	return `${String(count)} ${singular}${count === 1 ? "" : "s"}`;
}

class CodeModeDialog implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private readonly controls: CodeModeDialogControls;
	private readonly settingsList: SettingsList;
	private error: string | undefined;
	private saving = false;

	constructor(context: CommandDialogViewContext<void>, controls: CodeModeDialogControls) {
		this.context = context;
		this.controls = controls;
		const items: SettingItem[] = [
			{
				currentValue: controls.getSnapshot().enabled ? "on" : "off",
				description: "Replace Package Tool schemas with the local JavaScript envelope",
				id: "enabled",
				label: "Code Mode",
				values: ["off", "on"],
			},
		];
		this.settingsList = new SettingsList(
			items,
			1,
			settingsListTheme(context),
			(_id, value) => {
				void this.updateEnabled(value === "on");
			},
			() => context.close(),
			{ enableSearch: false },
		);
	}

	handleInput(data: string): void {
		this.settingsList.handleInput?.(data);
		this.context.requestRender();
	}

	invalidate(): void {
		this.settingsList.invalidate();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const snapshot = this.controls.getSnapshot();
		this.settingsList.updateValue("enabled", snapshot.enabled ? "on" : "off");
		const nativeBody = this.settingsList
			.render(Math.max(MIN_RENDER_WIDTH, renderWidth))
			.filter((line) => !line.includes("Enter/Space to change") && !line.includes("Enter/Space change"));
		const selected = nativeBody.find((line) => line.includes("→"));
		const session = [
			countLabel(snapshot.executionCount, "execution"),
			countLabel(snapshot.pendingCount, "pending"),
			countLabel(snapshot.snippetCount, "snippet"),
		].join(" · ");
		const body = [
			...nativeBody,
			...(this.error ? [`${GUTTER}${this.context.theme.fg("error", this.error)}`] : []),
			"",
			`${GUTTER}${this.context.theme.bold("Provider surface")}`,
			`${GUTTER}${this.context.theme.fg("muted", "codemode · tool_search")}`,
			"",
			`${GUTTER}${this.context.theme.bold("Local catalog")}`,
			`${GUTTER}${this.context.theme.fg("muted", countLabel(snapshot.toolCount, "Package Tool"))}`,
			"",
			`${GUTTER}${this.context.theme.bold("Session")}`,
			`${GUTTER}${this.context.theme.fg("muted", session)}`,
		];
		const lines = fitCommandDialogRows(
			{
				header: [
					this.context.theme.fg("border", "━".repeat(renderWidth)),
					`${GUTTER}${this.context.theme.bold("Code Mode")}`,
				],
				body,
				footer: [
					`${GUTTER}${this.context.theme.fg("dim", this.saving ? "Saving project setting… · Esc close" : "Enter toggle · Esc close")}`,
				],
				priority: [
					this.error
						? `${GUTTER}${this.context.theme.fg("error", this.error)}`
						: (selected ?? `${GUTTER}Code Mode ${snapshot.enabled ? "on" : "off"}`),
				],
			},
			commandDialogRows(this.context),
		);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private async updateEnabled(enabled: boolean): Promise<void> {
		if (this.saving) return;
		this.error = undefined;
		this.saving = true;
		this.context.requestRender();
		try {
			await this.controls.setEnabled(enabled);
		} catch {
			this.error = "Unable to save this project's Code Mode setting";
		} finally {
			this.saving = false;
			const current = this.controls.getSnapshot().enabled;
			this.settingsList.updateValue("enabled", current ? "on" : "off");
			this.context.requestRender();
		}
	}
}

export function createCodeModeDialogView(controls: CodeModeDialogControls): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new CodeModeDialog(context, controls),
	};
}
