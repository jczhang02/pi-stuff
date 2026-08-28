import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type CommandDialogPriority = "blocking" | "normal";

export interface CommandDialogChrome {
	setSuppressed(suppressed: boolean): void;
}

export type CommandDialogCoordinatorHost = Pick<ExtensionAPI, "events" | "on">;

export interface CommandDialogComponent extends Component {
	dispose?(): void;
}

export type CommandDialogKeybindings = Pick<KeybindingsManager, "getKeys" | "matches">;

export interface CommandDialogViewContext<Result = void> {
	readonly keybindings: CommandDialogKeybindings;
	readonly signal: AbortSignal;
	readonly theme: Theme;
	readonly tui: TUI;
	close(result?: Result): void;
	requestRender(force?: boolean): void;
}

export interface CommandDialogView<Result = void> {
	readonly priority: CommandDialogPriority;
	create(context: CommandDialogViewContext<Result>): CommandDialogComponent;
}

export interface CommandDialogShowOptions {
	/** Restore the editor text captured before the dialog opened. Defaults to true. */
	readonly restoreDraft?: boolean;
}

export interface CommandDialogCoordinator {
	registerChrome(id: string, chrome: CommandDialogChrome): () => void;
	/** Add a Suite-owned region after the primary Statusline Footer. */
	registerFooterTail?(id: string, factory: FooterTailFactory): () => void;
	/** Report whether this TUI context is currently hosted by the shared Footer. */
	hasInstalledFooter?(ctx: ExtensionContext): boolean;
	setWorkingVisible(ctx: ExtensionContext, visible: boolean): void;
	show<Result = void>(
		ctx: ExtensionContext,
		view: CommandDialogView<Result>,
		options?: CommandDialogShowOptions,
	): Promise<Result | undefined>;
	whenIdle(): Promise<void>;
}

export type FooterFactory = NonNullable<Parameters<ExtensionUIContext["setFooter"]>[0]>;
export type FooterTailComponent = Component & {
	/** Replace the primary Footer's second row while this tail renders its controls. */
	readonly replacesBaseRow2?: boolean;
};
export type FooterTailFactory = (tui: TUI, theme: Theme) => FooterTailComponent;
