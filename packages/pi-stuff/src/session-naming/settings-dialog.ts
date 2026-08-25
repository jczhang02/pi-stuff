import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "../conversation-ui/index.js";
import type { SessionNamingSettings, SessionNamingSettingsPatch, SessionNamingSettingsStore } from "./settings.js";

const GUTTER = "  ";
const MIN_RENDER_WIDTH = 24;
const BOOLEAN_VALUES = ["on", "off"] as const;
const COOLDOWN_PRESETS = [10, 30, 60, 360, 1_440] as const;

export interface SessionNamingSettingsViewOptions {
	readonly onPersistenceError?: (message: string) => void;
}

function settingsHint(width: number): string {
	const candidates = [
		"  Enter/Space to change · Esc to close",
		"  Enter/Space change · Esc close",
		"  Enter/Space · Esc close",
		"  Enter · Esc close",
		"  Esc close",
	];
	return candidates.find((candidate) => visibleWidth(candidate) <= width) ?? "Esc";
}

function oneLine(value: string): string {
	return value
		.replaceAll(/[\p{Cc}\p{Cf}]+/gu, " ")
		.replaceAll(/\s+/gu, " ")
		.trim();
}

function formatCooldown(minutes: number): string {
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		return `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
	}
	return `${String(minutes)} min`;
}

function cooldownValues(current: number): string[] {
	return [...new Set<number>([...COOLDOWN_PRESETS, current])].sort((left, right) => left - right).map(formatCooldown);
}

function settingsItems(settings: SessionNamingSettings): SettingItem[] {
	return [
		{
			currentValue: settings.enabled ? "on" : "off",
			description: "Name settled direct-user Sessions automatically",
			id: "enabled",
			label: "Automatic naming",
			values: [...BOOLEAN_VALUES],
		},
		{
			currentValue: formatCooldown(settings.cooldownMinutes),
			description: "Wait this long before reconsidering an existing name",
			id: "cooldownMinutes",
			label: "Rename cooldown",
			values: cooldownValues(settings.cooldownMinutes),
		},
		{
			currentValue: settings.respectManualName ? "on" : "off",
			description: "Keep names assigned through Pi instead of replacing them",
			id: "respectManualName",
			label: "Keep manually assigned names",
			values: [...BOOLEAN_VALUES],
		},
	];
}

function settingPatch(id: string, value: string): SessionNamingSettingsPatch | undefined {
	if (id === "enabled" || id === "respectManualName") {
		if (!BOOLEAN_VALUES.some((candidate) => candidate === value)) return undefined;
		return id === "enabled" ? { enabled: value === "on" } : { respectManualName: value === "on" };
	}
	if (id !== "cooldownMinutes") return undefined;
	const match = /^(\d+) (hour|hours|min)$/u.exec(value);
	if (!match?.[1]) return undefined;
	const quantity = Number.parseInt(match[1], 10);
	const cooldownMinutes = match[2] === "min" ? quantity : quantity * 60;
	if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 1 || cooldownMinutes > 1_440) return undefined;
	return { cooldownMinutes };
}

class SessionNamingSettingsDialog implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private error = "";
	private readonly generations = new Map<string, number>();
	private readonly options: SessionNamingSettingsViewOptions;
	private readonly settings: SessionNamingSettingsStore;
	private readonly settingsList: SettingsList;
	private readonly unsubscribe: () => void;

	constructor(
		context: CommandDialogViewContext<void>,
		settings: SessionNamingSettingsStore,
		options: SessionNamingSettingsViewOptions,
	) {
		this.context = context;
		this.options = options;
		this.settings = settings;
		const items = settingsItems(settings.get());
		this.settingsList = new SettingsList(
			items,
			items.length,
			getSettingsListTheme(),
			(id, value) => this.setValue(id, value),
			() => context.close(),
			{ enableSearch: false },
		);
		this.unsubscribe = settings.subscribe(() => this.sync());
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		try {
			this.unsubscribe();
		} catch {
			// A presentation observer cannot block Dialog teardown.
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
		const maximumRows = commandDialogRows(this.context);
		if (maximumRows === 0) return [];
		const nativeLines = this.settingsList.render(Math.max(MIN_RENDER_WIDTH, renderWidth));
		const nativeHintIndex = nativeLines.map((line) => line.includes("Enter/Space to change")).lastIndexOf(true);
		const nativeBody = nativeLines.filter((_line, index) => index !== nativeHintIndex);
		const errorLine = this.error ? `${GUTTER}${this.context.theme.fg("error", this.error)}` : undefined;
		const selected = nativeBody.find((line) => line.includes("→"));
		const lines = fitCommandDialogRows(
			{
				header: [
					this.context.theme.fg("border", "─".repeat(renderWidth)),
					`${GUTTER}${this.context.theme.bold("Session Naming")}`,
				],
				body: [...nativeBody, ...(errorLine ? ["", errorLine] : [])],
				footer: [this.context.theme.fg("dim", settingsHint(renderWidth))],
				priority: [errorLine ?? selected ?? `${GUTTER}No Session Naming settings`],
			},
			maximumRows,
		);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private setValue(id: string, value: string): void {
		const patch = settingPatch(id, value);
		if (!patch) return;
		const generation = (this.generations.get(id) ?? 0) + 1;
		this.generations.set(id, generation);
		this.error = "";
		void this.settings.update(patch).catch((error) => {
			if (this.generations.get(id) !== generation) return;
			const message = oneLine(String(error)) || "Unable to save Session Naming setting.";
			if (this.disposed) {
				try {
					this.options.onPersistenceError?.(message);
				} catch {
					// A notification adapter cannot turn a handled persistence failure into an unhandled rejection.
				}
				return;
			}
			this.error = message;
			this.sync();
		});
	}

	private sync(): void {
		if (this.disposed) return;
		for (const item of settingsItems(this.settings.get())) {
			this.settingsList.updateValue(item.id, item.currentValue);
		}
		this.context.requestRender();
	}
}

export function createSessionNamingSettingsView(
	settings: SessionNamingSettingsStore,
	options: SessionNamingSettingsViewOptions = {},
): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new SessionNamingSettingsDialog(context, settings, options),
	};
}
