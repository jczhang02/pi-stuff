import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "../conversation-ui/index.js";
import type { RtkSettingsStore } from "./settings.js";

const GUTTER = "  ";
const MIN_RENDER_WIDTH = 24;

export interface RtkSettingsViewOptions {
	readonly onPersistenceError?: (message: string) => void;
}

export interface RtkSettingsActions {
	setOutputProjection(enabled: boolean): Promise<void>;
	setRewriteCommands(enabled: boolean): Promise<void>;
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

class RtkSettingsDialog implements CommandDialogComponent {
	private readonly actions: RtkSettingsActions;
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private error = "";
	private readonly generations = new Map<string, number>();
	private readonly onPersistenceError: ((message: string) => void) | undefined;
	private readonly settings: RtkSettingsStore;
	private readonly settingsList: SettingsList;
	private readonly unsubscribe: () => void;

	constructor(
		context: CommandDialogViewContext<void>,
		settings: RtkSettingsStore,
		actions: RtkSettingsActions,
		options: RtkSettingsViewOptions,
	) {
		this.actions = actions;
		this.context = context;
		this.onPersistenceError = options.onPersistenceError;
		this.settings = settings;
		const current = settings.get();
		const items: SettingItem[] = [
			{
				currentValue: String(current.rewriteCommands),
				description: "Rewrite supported shell commands through RTK",
				id: "rewriteCommands",
				label: "Command rewriting",
				values: ["true", "false"],
			},
			{
				currentValue: String(current.outputProjection),
				description: "Compact supported Tool results in model-visible context",
				id: "outputProjection",
				label: "Model projection",
				values: ["true", "false"],
			},
		];
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
			// A presentation observer cannot block dialog teardown.
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
		let nativeHintIndex = -1;
		for (let index = nativeLines.length - 1; index >= 0; index -= 1) {
			const line = nativeLines[index] ?? "";
			if (!line.includes("Enter/Space to change")) continue;
			nativeHintIndex = index;
			break;
		}
		const nativeBody = nativeLines.filter((_line, index) => index !== nativeHintIndex);
		const errorLine = this.error ? `${GUTTER}${this.context.theme.fg("error", this.error)}` : undefined;
		const selected = nativeBody.find((line) => line.includes("→"));
		const lines = fitCommandDialogRows(
			{
				header: [
					this.context.theme.fg("border", "─".repeat(renderWidth)),
					`${GUTTER}${this.context.theme.bold("RTK settings")}`,
				],
				body: [...nativeBody, ...(errorLine ? ["", errorLine] : [])],
				footer: [this.context.theme.fg("dim", settingsHint(renderWidth))],
				priority: [errorLine ?? selected ?? `${GUTTER}No RTK settings`],
			},
			maximumRows,
		);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private setValue(id: string, value: string): void {
		if (value !== "true" && value !== "false") return;
		const generation = (this.generations.get(id) ?? 0) + 1;
		this.generations.set(id, generation);
		this.error = "";
		const enabled = value === "true";
		const update =
			id === "rewriteCommands"
				? this.actions.setRewriteCommands(enabled)
				: id === "outputProjection"
					? this.actions.setOutputProjection(enabled)
					: undefined;
		if (!update) return;
		void update.catch((error) => {
			if (this.generations.get(id) !== generation) return;
			const message = oneLine(String(error)) || "Unable to save RTK setting.";
			if (this.disposed) {
				try {
					this.onPersistenceError?.(message);
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
		const current = this.settings.get();
		this.settingsList.updateValue("rewriteCommands", String(current.rewriteCommands));
		this.settingsList.updateValue("outputProjection", String(current.outputProjection));
		this.context.requestRender();
	}
}

export function createRtkSettingsView(
	settings: RtkSettingsStore,
	actions: RtkSettingsActions,
	options: RtkSettingsViewOptions = {},
): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new RtkSettingsDialog(context, settings, actions, options),
	};
}
