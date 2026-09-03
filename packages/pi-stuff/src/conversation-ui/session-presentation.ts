import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandDialogCoordinatorImplementation } from "./command-dialog.js";
import { DiagnosticNoticeController } from "./diagnostic-notice.js";
import type { DiagnosticChannel } from "./diagnostics.js";
import { type InputEnhancementController, installInputEnhancementEditor } from "./input-enhancement.js";
import type { UiSettingsStore } from "./settings.js";
import {
	type BooleanValueSource,
	GitStatusSource,
	getCodexStatusChannel,
	getGoalStatusChannel,
	type StatuslineClock,
	StatuslineController,
	type StatuslinePreferences,
	type StatuslinePreferencesSource,
} from "./statusline.js";
import { HIDDEN_THINKING_LABEL, installThinkingLineDisplay } from "./thinking-line.js";
import { WelcomeHeaderController, WelcomeRegistrySource } from "./welcome-header.js";

/** Session-local presentation adapters installed by the Pi Stuff UI Capability. */
export interface UiSessionPresentation {
	dispose(): void;
	refreshGit(): Promise<void>;
	requestRender(force?: boolean): void;
	updateContextFileCount(count: number | undefined): void;
}

class StoreBooleanSource implements BooleanValueSource {
	private readonly id: "welcomeHeader";
	private readonly store: UiSettingsStore;

	constructor(store: UiSettingsStore, id: "welcomeHeader") {
		this.store = store;
		this.id = id;
	}

	get(): boolean {
		return this.store.getValue(this.id);
	}

	subscribe(listener: () => void): () => void {
		return this.store.subscribe(() => listener());
	}
}

class StoreStatuslinePreferencesSource implements StatuslinePreferencesSource {
	private readonly store: UiSettingsStore;

	constructor(store: UiSettingsStore) {
		this.store = store;
	}

	get(): StatuslinePreferences {
		const settings = this.store.get();
		return {
			density: settings.statuslineDensity,
			enabled: settings.statusline,
			latestPrompt: settings.statuslineLatestPrompt,
		};
	}

	subscribe(listener: () => void): () => void {
		return this.store.subscribe(() => listener());
	}
}

class EditorAutocompleteSource implements BooleanValueSource {
	private readonly editor: InputEnhancementController;

	constructor(editor: InputEnhancementController) {
		this.editor = editor;
	}

	get(): boolean {
		return this.editor.isShowingAutocomplete();
	}

	subscribe(listener: () => void): () => void {
		return this.editor.subscribe(() => listener());
	}
}

class InstalledUiSessionPresentation implements UiSessionPresentation {
	private disposed = false;
	private readonly editor: InputEnhancementController;
	private readonly git: GitStatusSource;
	private readonly notice: DiagnosticNoticeController;
	private readonly pi: ExtensionAPI;
	private readonly releaseThinkingLine: () => void;
	private readonly statusline: StatuslineController;
	private readonly unregisterStatuslineChrome: () => void;
	private readonly unregisterNoticeChrome: () => void;
	private readonly welcomeInventory: WelcomeRegistrySource;
	private readonly cwd: () => string;

	constructor(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		store: UiSettingsStore,
		coordinator: CommandDialogCoordinatorImplementation,
		diagnostics: DiagnosticChannel,
		releaseThinkingLine: () => void,
		repeatGoalClock?: StatuslineClock,
	) {
		this.pi = pi;
		this.releaseThinkingLine = releaseThinkingLine;
		this.cwd = () => ctx.sessionManager.getCwd() || ctx.cwd;
		this.editor = installInputEnhancementEditor(ctx, {
			getCommands: () => pi.getCommands(),
			getSettings: () => ({
				inlineSlashAutocomplete: store.getValue("inlineSlashAutocomplete"),
				inputHighlighting: store.getValue("inputHighlighting"),
			}),
			getTheme: () => ctx.ui.theme,
		});
		this.git = new GitStatusSource();
		this.statusline = new StatuslineController(pi, {
			autocompleteVisible: new EditorAutocompleteSource(this.editor),
			codexStatus: getCodexStatusChannel(pi).source,
			extensionStatusKeys: ["ponytail"],
			goalStatus: getGoalStatusChannel(pi).source,
			gitChanges: this.git,
			preferences: new StoreStatuslinePreferencesSource(store),
			repeat: repeatGoalClock,
		});
		this.unregisterStatuslineChrome = coordinator.registerChrome("statusline", this.statusline);
		this.notice = new DiagnosticNoticeController(ctx.ui, diagnostics);
		this.unregisterNoticeChrome = coordinator.registerChrome("diagnostics", this.notice);
		coordinator.installFooter(ctx, (tui, theme, footerData) =>
			this.statusline.createFooter(ctx, tui, theme, footerData),
		);

		this.welcomeInventory = new WelcomeRegistrySource(pi);
		const welcome = new WelcomeHeaderController(ctx, {
			enabled: new StoreBooleanSource(store, "welcomeHeader"),
			inventory: this.welcomeInventory,
		});
		if (welcome.enabledAtLaunch) {
			ctx.ui.setHeader((tui, theme) => welcome.createHeader(tui, theme));
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.releaseThinkingLine();
		this.unregisterStatuslineChrome();
		this.unregisterNoticeChrome();
		this.notice.dispose();
		this.statusline.dispose();
		this.git.dispose();
		this.editor.dispose();
	}

	refreshGit(): Promise<void> {
		if (this.disposed || !this.statusline.isEnabled()) return Promise.resolve();
		return this.git.refresh(this.pi, this.cwd());
	}

	requestRender(force?: boolean): void {
		if (this.disposed) return;
		this.editor.requestRender(force);
	}

	updateContextFileCount(count: number | undefined): void {
		if (this.disposed) return;
		this.welcomeInventory.setContextFileCount(count);
		this.welcomeInventory.refresh();
	}
}

/** Install the accepted normal-screen UI for one real TUI session. */
export function installUiSessionPresentation(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	store: UiSettingsStore,
	coordinator: CommandDialogCoordinatorImplementation,
	diagnostics: DiagnosticChannel,
	repeatGoalClock?: StatuslineClock,
): UiSessionPresentation | undefined {
	if (ctx.mode !== "tui") return undefined;
	const releaseThinkingLine = installThinkingLineDisplay();
	try {
		ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL);
		return new InstalledUiSessionPresentation(
			pi,
			ctx,
			store,
			coordinator,
			diagnostics,
			releaseThinkingLine,
			repeatGoalClock,
		);
	} catch (error) {
		releaseThinkingLine();
		throw error;
	}
}
