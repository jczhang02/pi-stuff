import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogComponent, CommandDialogView, CommandDialogViewContext } from "./index.js";
import type { RegisteredUiSetting, UiSettingRegistry } from "./settings.js";

const GUTTER = "  ";
const MIN_RENDER_WIDTH = 24;
const NORMAL_SCREEN_RESERVE_ROWS = 3;

export interface UiSettingsViewOptions {
	readonly onPersistenceError?: (message: string) => void;
}

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

function oneLine(value: string): string {
	let result = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		result += codePoint < 32 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
	}
	return result.replaceAll(/\s+/gu, " ").trim();
}

function settingsHint(width: number): string {
	const candidates = [
		"  Type to search · Enter/Space to change · Esc to close",
		"  Type search · Enter/Space change · Esc close",
		"  Enter/Space · Esc close",
		"  Enter · Esc close",
		"  Esc close",
	];
	return candidates.find((candidate) => visibleWidth(candidate) <= width) ?? "Esc";
}

class UiSettingsDialog implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private error = "";
	private readonly generations = new Map<string, number>();
	private readonly onPersistenceError: ((message: string) => void) | undefined;
	private readonly settings: readonly RegisteredUiSetting[];
	private readonly settingsList: SettingsList;
	private readonly unsubscribers: Array<() => void>;

	constructor(context: CommandDialogViewContext<void>, registry: UiSettingRegistry, options: UiSettingsViewOptions) {
		this.context = context;
		this.onPersistenceError = options.onPersistenceError;
		this.settings = registry.list();
		const items = this.settings.map<SettingItem>((setting) => ({
			currentValue: setting.get(),
			description: setting.description,
			id: setting.id,
			label: setting.label,
			values: [...setting.values],
		}));
		this.settingsList = new SettingsList(
			items,
			Math.max(1, items.length),
			getSettingsListTheme(),
			(id, value) => this.setValue(id, value),
			() => context.close(),
			{ enableSearch: true },
		);
		this.unsubscribers = this.settings.map((setting) => {
			try {
				return setting.subscribe(() => this.sync(setting));
			} catch (error) {
				console.warn(`[pi-stuff-ui] unable to observe /ui setting ${setting.id}: ${String(error)}`);
				return () => {};
			}
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of this.unsubscribers.splice(0)) {
			try {
				unsubscribe();
			} catch (error) {
				console.warn(`[pi-stuff-ui] unable to release a /ui setting observer: ${String(error)}`);
			}
		}
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
		const maximumRows = dialogRows(this.context);
		if (maximumRows === 0) return [];
		const nativeLines = this.settingsList.render(Math.max(MIN_RENDER_WIDTH, renderWidth));
		let nativeHintIndex = -1;
		for (let index = nativeLines.length - 1; index >= 0; index -= 1) {
			const line = nativeLines[index] ?? "";
			if (!line.includes("Type to search") && !line.includes("Enter/Space to change")) continue;
			nativeHintIndex = index;
			break;
		}
		if (nativeHintIndex >= 0) {
			nativeLines[nativeHintIndex] = this.context.theme.fg("dim", settingsHint(renderWidth));
		}
		const lines = [
			this.context.theme.fg("border", "─".repeat(renderWidth)),
			`${GUTTER}${this.context.theme.bold("UI")}`,
			...nativeLines,
			...(this.error ? ["", `${GUTTER}${this.context.theme.fg("error", this.error)}`] : []),
		];
		const fitted = lines.length <= maximumRows ? lines : this.fitLowHeight(lines, maximumRows);
		return fitted.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private fitLowHeight(lines: readonly string[], maximumRows: number): string[] {
		if (maximumRows === 1) return [`${GUTTER}${this.context.theme.fg("dim", "Esc close")}`];
		const selected = lines.find((line) => line.includes("→")) ?? lines[2] ?? GUTTER;
		if (maximumRows === 2) return [selected, `${GUTTER}${this.context.theme.fg("dim", "Esc close")}`];
		return [lines[0] ?? "", lines[1] ?? `${GUTTER}${this.context.theme.bold("UI")}`, selected].slice(0, maximumRows);
	}

	private setValue(id: string, value: string): void {
		const setting = this.settings.find((candidate) => candidate.id === id);
		if (!setting?.values.includes(value)) return;
		const generation = (this.generations.get(id) ?? 0) + 1;
		this.generations.set(id, generation);
		this.error = "";
		void setting.set(value).catch((error: unknown) => {
			if (this.generations.get(id) !== generation) return;
			const message = oneLine(String(error)) || "Unable to save UI setting.";
			if (this.disposed) {
				try {
					this.onPersistenceError?.(message);
				} catch {
					// A notification adapter cannot turn a handled persistence failure into an unhandled rejection.
				}
				return;
			}
			this.error = message;
			this.sync(setting);
		});
	}

	private sync(setting: RegisteredUiSetting): void {
		if (this.disposed) return;
		this.settingsList.updateValue(setting.id, setting.get());
		this.context.requestRender();
	}
}

export function createUiSettingsView(
	registry: UiSettingRegistry,
	options: UiSettingsViewOptions = {},
): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new UiSettingsDialog(context, registry, options),
	};
}
