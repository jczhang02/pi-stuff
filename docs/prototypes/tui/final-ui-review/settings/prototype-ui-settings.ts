/**
 * PROTOTYPE — throwaway real-Pi UI evidence, not product code.
 *
 * Question: Does the agreed flat `/ui` surface feel correct when it is
 * rendered by Pi's real SettingsList inside a non-overlay Command Dialog?
 *
 * Run from the repository root:
 *   docs/prototypes/tui/final-ui-review/settings/capture.sh
 */

import { type ExtensionAPI, getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

const DEFAULTS = {
	statusline: "true",
	welcomeHeader: "true",
	inputHighlighting: "true",
	inlineSlashAutocomplete: "true",
	toolRunningTimer: "true",
} as const;

type SettingId = keyof typeof DEFAULTS;
type BooleanText = "false" | "true";

const LABELS = {
	statusline: "Statusline",
	welcomeHeader: "Welcome header",
	inputHighlighting: "Input highlighting",
	inlineSlashAutocomplete: "Inline slash autocomplete",
	toolRunningTimer: "Tool running timer",
} satisfies Record<SettingId, string>;

const DESCRIPTIONS = {
	statusline: "Show session and context information below the editor",
	welcomeHeader: "Show startup context summary (applies next launch)",
	inputHighlighting: "Highlight recognized commands and skills while typing",
	inlineSlashAutocomplete: "Suggest real commands and skills after slash text anywhere in the input",
	toolRunningTimer: "Show elapsed time while long-running tools work",
} satisfies Record<SettingId, string>;

function isSettingId(value: string): value is SettingId {
	return value in DEFAULTS;
}

class EmptyComponent implements Component {
	invalidate(): void {}

	render(): string[] {
		return [];
	}
}

class UiSettingsPrototype implements Component {
	// SAFETY: DEFAULTS is the closed source whose keys and values are exactly SettingId and BooleanText.
	private readonly values = new Map<SettingId, BooleanText>(
		Object.entries(DEFAULTS) as Array<[SettingId, BooleanText]>,
	);
	private readonly settingsList: SettingsList;
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly close: () => void;

	constructor(theme: Theme, requestRender: () => void, close: () => void) {
		this.theme = theme;
		this.requestRender = requestRender;
		this.close = close;
		// SAFETY: DEFAULTS is the closed source; every runtime key is a SettingId.
		const items = (Object.keys(DEFAULTS) as SettingId[]).map<SettingItem>((id) => ({
			id,
			label: LABELS[id],
			description: DESCRIPTIONS[id],
			currentValue: this.values.get(id) ?? "true",
			values: ["true", "false"],
		}));

		this.settingsList = new SettingsList(
			items,
			5,
			getSettingsListTheme(),
			(id, value) => {
				if (isSettingId(id) && (value === "true" || value === "false")) {
					this.values.set(id, value);
				}
				this.requestRender();
			},
			() => this.close(),
			{ enableSearch: true },
		);
	}

	handleInput(data: string): void {
		this.settingsList.handleInput?.(data);
		this.requestRender();
	}

	invalidate(): void {
		this.settingsList.invalidate();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		return [
			this.theme.fg("border", "─".repeat(renderWidth)),
			`  ${this.theme.bold("UI")}`,
			...this.settingsList.render(renderWidth),
		];
	}
}

export default function registerUiSettingsPrototype(pi: ExtensionAPI): void {
	pi.registerCommand("ui", {
		description: "Open the throwaway Pi Stuff UI settings prototype",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/ui requires interactive TUI mode", "error");
				return;
			}

			ctx.ui.setFooter(() => new EmptyComponent());
			ctx.ui.setWorkingVisible(false);
			try {
				await ctx.ui.custom<void>(
					(tui, theme, _keybindings, done) => new UiSettingsPrototype(theme, () => tui.requestRender(), done),
					{ overlay: false },
				);
			} finally {
				ctx.ui.setFooter(undefined);
				ctx.ui.setWorkingVisible(true);
			}
		},
	});
}
