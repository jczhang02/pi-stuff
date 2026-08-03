import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, type SettingItem, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import { getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";

import type { CommandConfigStore } from "./config-store";
import { DEFAULT_EXTENSION_CONFIG, type PermissionSystemExtensionConfig } from "./extension-config";
import type { Ruleset } from "./rule";

interface PermissionSystemConfigController {
	config: CommandConfigStore;
	/** Precomputed global config file path. */
	configPath: string;
	/** Returns the composed config-layer ruleset for the active agent scope. */
	getActiveAgentConfigRules(): Ruleset;
}

const ON_OFF = ["on", "off"];
const PERMISSION_MODES = ["unrestricted", "manual"];
const GUTTER = "  ";
const NORMAL_SCREEN_RESERVE_ROWS = 3;
const MIN_SETTINGS_RENDER_WIDTH = 24;
const COMMAND_ARGUMENTS = [
	{
		value: "show",
		label: "Show active settings",
		description: "Display the current Pi Stuff permissions summary",
	},
	{
		value: "path",
		label: "Show config path",
		description: "Display the Pi Stuff permissions config path",
	},
	{
		value: "reset",
		label: "Reset defaults",
		description: "Restore default yolo/logging settings and persist them",
	},
	{
		value: "help",
		label: "Show help",
		description: "Display command usage",
	},
] as const;
const USAGE_TEXT = "Usage: /permissions [show|path|reset|help] (or run /permissions with no args to open settings)";

function normalizeTerminalRows(rows: unknown): number {
	if (typeof rows !== "number" || !Number.isFinite(rows)) return 24;
	return Math.max(0, Math.floor(rows));
}

function dialogRows(rows: unknown): number {
	const normalized = normalizeTerminalRows(rows);
	if (normalized === 0) return 0;
	return Math.max(1, normalized - NORMAL_SCREEN_RESERVE_ROWS);
}

function fitSettingsRows(
	theme: Theme,
	width: number,
	maximumRows: number,
	header: readonly string[],
	nativeLines: readonly string[],
): string[] {
	const full = [...header, "", ...nativeLines];
	if (width >= MIN_SETTINGS_RENDER_WIDTH && full.length <= maximumRows) return full;
	if (maximumRows <= 0) return [];

	const selected = nativeLines.find((line) => line.includes("→")) ?? nativeLines.find(Boolean) ?? GUTTER;
	const escapeHint = `${GUTTER}${theme.fg("dim", "Esc to cancel")}`;
	if (maximumRows === 1) return [escapeHint];
	if (maximumRows === 2) return [selected, escapeHint];
	if (maximumRows === 3) return [header[1] ?? header[0] ?? GUTTER, selected, escapeHint];

	return maximumRows >= 5 ? [...header, "", selected, escapeHint] : [...header, selected, escapeHint];
}

function cloneDefaultConfig(): PermissionSystemExtensionConfig {
	return {
		permissionMode: DEFAULT_EXTENSION_CONFIG.permissionMode,
		debugLog: DEFAULT_EXTENSION_CONFIG.debugLog,
		permissionReviewLog: DEFAULT_EXTENSION_CONFIG.permissionReviewLog,
		yoloMode: DEFAULT_EXTENSION_CONFIG.yoloMode,
		doublePressToConfirm: DEFAULT_EXTENSION_CONFIG.doublePressToConfirm,
	};
}

function toOnOff(value: boolean): string {
	return value ? "on" : "off";
}

function formatRulesSummary(rules: Ruleset): string {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- origin may be absent despite its type
	const configRules = rules.filter((r) => r.layer === "config" && r.origin);
	if (configRules.length === 0) return "";
	const formatted = configRules
		.map((r) => {
			const key = r.pattern === "*" ? r.surface : `${r.surface}["${r.pattern}"]`;
			return `${key}=${r.action} (${r.origin})`;
		})
		.join(", ");
	return `\n  rules: ${formatted}`;
}

function summarizeConfig(config: PermissionSystemExtensionConfig, rules?: Ruleset): string {
	const knobs = [
		`permissionMode=${config.permissionMode}`,
		`yoloMode=${toOnOff(config.yoloMode)}`,
		`permissionReviewLog=${toOnOff(config.permissionReviewLog)}`,
		`debugLog=${toOnOff(config.debugLog)}`,
	].join(", ");
	const rulesSuffix = rules ? formatRulesSummary(rules) : "";
	return `${knobs}${rulesSuffix}`;
}

function buildSettingItems(config: PermissionSystemExtensionConfig): SettingItem[] {
	return [
		{
			id: "permissionMode",
			label: "Permission mode",
			description: "Unrestricted keeps normal work quiet; Manual asks for ordinary consequential tools",
			currentValue: config.permissionMode,
			values: PERMISSION_MODES,
		},
		{
			id: "permissionReviewLog",
			label: "Permission review log",
			description: "Write permission request and decision audit events to the extension logs directory",
			currentValue: toOnOff(config.permissionReviewLog),
			values: ON_OFF,
		},
		{
			id: "debugLog",
			label: "Debug logging",
			description: "Write verbose Pi Stuff permissions diagnostics to the extension logs directory",
			currentValue: toOnOff(config.debugLog),
			values: ON_OFF,
		},
		{
			id: "doublePressToConfirm",
			label: "Double-press to confirm",
			description: "Require a confirming second press of a decision hotkey in the inline TUI permission dialog",
			currentValue: toOnOff(config.doublePressToConfirm),
			values: ON_OFF,
		},
	];
}

function applySetting(
	config: PermissionSystemExtensionConfig,
	id: string,
	value: string,
): PermissionSystemExtensionConfig {
	switch (id) {
		case "permissionMode":
			return {
				...config,
				permissionMode: value === "manual" ? "manual" : "unrestricted",
			};
		case "permissionReviewLog":
			return { ...config, permissionReviewLog: value === "on" };
		case "debugLog":
			return { ...config, debugLog: value === "on" };
		case "doublePressToConfirm":
			return { ...config, doublePressToConfirm: value === "on" };
		default:
			return config;
	}
}

function syncSettingValues(settingsList: SettingsList, config: PermissionSystemExtensionConfig): void {
	settingsList.updateValue("permissionMode", config.permissionMode);
	settingsList.updateValue("permissionReviewLog", toOnOff(config.permissionReviewLog));
	settingsList.updateValue("debugLog", toOnOff(config.debugLog));
	settingsList.updateValue("doublePressToConfirm", toOnOff(config.doublePressToConfirm));
}

function getArgumentCompletions(
	argumentPrefix: string,
): Array<{ value: string; label: string; description: string }> | null {
	const normalized = argumentPrefix.trim().toLowerCase();
	if (normalized.includes(" ")) {
		return null;
	}

	const filtered = COMMAND_ARGUMENTS.filter((item) => item.value.startsWith(normalized));
	return filtered.length > 0 ? [...filtered] : null;
}

async function openSettings(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	controller: PermissionSystemConfigController,
): Promise<void> {
	await getCommandDialogCoordinator(pi).show(ctx, {
		priority: "normal",
		create: ({ tui, theme, close }) => {
			let current = controller.config.current();
			const getTerminalRows = (): number => normalizeTerminalRows((tui.terminal as { rows?: number }).rows);
			const rows = getTerminalRows();
			const settingsList = new SettingsList(
				buildSettingItems(current),
				Math.max(1, Math.min(14, rows - 8)),
				getSettingsListTheme(),
				(id, newValue) => {
					current = applySetting(current, id, newValue);
					controller.config.save(current, ctx);
					current = controller.config.current();
					syncSettingValues(settingsList, current);
				},
				() => close(),
			);
			return new PermissionSettingsDialog(theme, settingsList, getTerminalRows);
		},
	});
}

export class PermissionSettingsDialog implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly settings: SettingsList,
		private readonly getTerminalRows: () => number,
	) {}

	handleInput(data: string): void {
		this.settings.handleInput?.(data);
	}

	invalidate(): void {
		this.settings.invalidate();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const bounded = (line: string): string => truncateToWidth(line, renderWidth, "…");
		const header = [this.theme.fg("border", "─".repeat(renderWidth)), `${GUTTER}${this.theme.bold("Permissions")}`];
		const nativeLines = this.settings.render(Math.max(MIN_SETTINGS_RENDER_WIDTH, renderWidth));
		return fitSettingsRows(this.theme, renderWidth, dialogRows(this.getTerminalRows()), header, nativeLines).map(
			bounded,
		);
	}
}

function handleArgs(args: string, ctx: ExtensionCommandContext, controller: PermissionSystemConfigController): boolean {
	const normalized = args.trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	if (normalized === "show") {
		const rules = controller.getActiveAgentConfigRules();
		ctx.ui.notify(`Pi Stuff permissions: ${summarizeConfig(controller.config.current(), rules)}`, "info");
		return true;
	}

	if (normalized === "path") {
		ctx.ui.notify(`Pi Stuff permissions config: ${controller.configPath}`, "info");
		return true;
	}

	if (normalized === "reset") {
		controller.config.save(cloneDefaultConfig(), ctx);
		ctx.ui.notify("Pi Stuff permissions reset to defaults.", "info");
		return true;
	}

	if (normalized === "help") {
		ctx.ui.notify(USAGE_TEXT, "info");
		return true;
	}

	ctx.ui.notify(USAGE_TEXT, "warning");
	return true;
}

export function registerPermissionSystemCommand(pi: ExtensionAPI, controller: PermissionSystemConfigController): void {
	const command: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description: "Configure Pi Stuff permission behavior",
		getArgumentCompletions,
		handler: async (args, ctx) => {
			if (handleArgs(args, ctx, controller)) {
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("/permissions requires interactive TUI mode.", "warning");
				return;
			}

			await openSettings(pi, ctx, controller);
		},
	};
	pi.registerCommand("permissions", command);
}
