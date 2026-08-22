import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createPanelKeys, type PanelKeybindings, type PanelKeys } from "./panel-keys.ts";
import type { ImportKind } from "./types.ts";
import { KNOWN_SERVER_PRESETS, type ConfigWritePreview, type KnownServerPreset, type McpDiscoverySummary } from "./config.ts";
import { redactTraceText } from "./mcp-trace.ts";
import type { McpOnboardingState } from "./onboarding-state.ts";
import { formatTerminalError } from "./utils.ts";
import {
	commandDialogPrimaryKey,
	fitCommandDialogRows,
	matchesCommandDialogCancel,
} from "../../conversation-ui/index.js";

interface SetupTheme {
	border: (text: string) => string;
	title: (text: string) => string;
	selected: (text: string) => string;
	hint: (text: string) => string;
	section: (text: string) => string;
	success: (text: string) => string;
	warning: (text: string) => string;
	muted: (text: string) => string;
}

function createSetupTheme(theme: Theme): SetupTheme {
	return {
		border: text => theme.fg("border", text),
		title: text => theme.bold(text),
		selected: text => theme.fg("accent", text),
		hint: text => theme.fg("dim", text),
		section: text => theme.fg("muted", text),
		success: text => theme.fg("success", text),
		warning: text => theme.fg("warning", text),
		muted: text => theme.fg("muted", text),
	};
}

const COMPACT_WIDTH = 60;
const LIST_WINDOW_ROWS = 7;
const PREVIEW_ROWS = 5;
const DESKTOP_PREVIEW_WIDTH = 74;
const VERBOSE_WIDTH = 80;

function fg(style: (text: string) => string, text: string): string {
	return style(text);
}

export interface SetupPanelCallbacks {
  previewImports: (imports: ImportKind[]) => ConfigWritePreview;
  previewStarterProject: () => ConfigWritePreview;
  previewRepoPrompt: () => ConfigWritePreview | null;
  previewKnownServer: (preset: KnownServerPreset) => ConfigWritePreview;
  adoptImports: (imports: ImportKind[]) => Promise<{ added: ImportKind[]; path: string }>;
  scaffoldProjectConfig: () => Promise<{ path: string }>;
  addRepoPrompt: () => Promise<{ path: string; serverName: string }>;
  addKnownServer: (preset: KnownServerPreset) => Promise<{ path: string; serverName: string }>;
  openPath: (path: string) => Promise<void>;
  markSetupCompleted: () => void;
}

export interface SetupPanelOptions {
  mode: "empty" | "setup";
  onboardingState: McpOnboardingState;
  keybindings?: PanelKeybindings;
}

type Screen = "empty" | "setup" | "imports" | "paths";

type ActionId =
  | "run-setup"
  | "adopt-imports"
  | "view-example"
  | "show-precedence"
  | "open-paths"
  | "add-repoprompt"
  | "add-known-server"
  | "scaffold-project";

interface Action {
  id: ActionId;
  label: string;
  description: string;
  preset?: KnownServerPreset;
}

type PendingWrite =
	| { readonly kind: "action"; readonly action: Action }
	| { readonly kind: "imports" };

interface SetupTui {
	requestRender(): void;
	readonly terminal?: { readonly rows?: number };
}

interface DiscoverySummaryLine {
	text: string;
	tone: "hint" | "warning";
}

interface VisibleRange {
	start: number;
	end: number;
}

export class McpSetupPanel {
  private screen: Screen;
  private actionCursor = 0;
  private importCursor = 0;
  private pathCursor = 0;
  private selectedImports = new Set<ImportKind>();
  private busy = false;
	private busyCanClose = false;
	private disposed = false;
	private confirmation: PendingWrite | null = null;
	private confirmCursor = 0;
  private notice: { text: string; tone: "success" | "warning" | "muted" } | null = null;
  private tui: SetupTui;
	private readonly t: SetupTheme;
  private keys: PanelKeys;
  private inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly INACTIVITY_MS = 60_000;

  constructor(
    private discovery: McpDiscoverySummary,
		private callbacks: SetupPanelCallbacks,
		private options: SetupPanelOptions,
		tui: SetupTui,
		theme: Theme,
		private done: () => void,
	) {
		this.tui = tui;
		this.t = createSetupTheme(theme);
    this.keys = createPanelKeys(options.keybindings);
    this.screen = options.mode;
    for (const entry of discovery.imports) {
      this.selectedImports.add(entry.kind);
    }
    this.resetInactivityTimeout();
  }

  private resetInactivityTimeout(): void {
    if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
		this.inactivityTimeout = null;
		if (this.busy || this.disposed) return;
    this.inactivityTimeout = setTimeout(() => {
      this.cleanup();
			this.disposed = true;
      this.done();
    }, McpSetupPanel.INACTIVITY_MS);
  }

  private cleanup(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }

  private getActions(): Action[] {
    const actions: Action[] = [];
    if (this.screen === "empty") {
      actions.push({ id: "run-setup", label: "Run setup", description: "Inspect detected configs, adopt imports, and scaffold a minimal `.mcp.json`." });
    }
    if (this.discovery.imports.length > 0) {
      actions.push({ id: "adopt-imports", label: "Adopt detected compatibility imports", description: `Choose which host-specific MCP configs Pi should import into its own override file. ${this.discovery.imports.length} source${this.discovery.imports.length === 1 ? "" : "s"} found.` });
    }
    actions.push({ id: "view-example", label: "View example `.mcp.json`", description: "Preview a working shared MCP config you can paste or adapt." });
    if (!this.discovery.sources.some((source) => source.id === "shared-project" && source.exists)) {
      actions.push({ id: "scaffold-project", label: "Scaffold project `.mcp.json`", description: "Write a minimal project config using the standard shared MCP file path, then reload Pi." });
    }
    actions.push({ id: "show-precedence", label: "Explain config precedence", description: "Show the read order and where Pi writes compatibility settings." });
    if (this.getDetectedPaths().length > 0) {
      actions.push({ id: "open-paths", label: "Open detected config paths", description: "Browse the actual config files that Pi discovered on this machine." });
    }
    for (const preset of KNOWN_SERVER_PRESETS) {
      actions.push({ id: "add-known-server", label: preset.name, description: preset.summary, preset });
    }
    if (!this.discovery.repoPrompt.configured && this.discovery.repoPrompt.executablePath && this.discovery.repoPrompt.targetPath && this.discovery.repoPrompt.entry && this.discovery.repoPrompt.serverName) {
      actions.push({ id: "add-repoprompt", label: "Add RepoPrompt to shared MCP config", description: "Write a standard MCP entry for RepoPrompt to the recommended shared target, then reload MCP in-session." });
    }
    return actions;
  }

  private getDetectedPaths(): string[] {
    const paths = [
      ...this.discovery.sources.filter((source) => source.exists).map((source) => source.path),
      ...this.discovery.imports.map((entry) => entry.path),
    ];
    return [...new Set(paths)];
  }

  private getSelectedAction(): Action | null {
    const actions = this.getActions();
    return actions[this.actionCursor] ?? null;
  }

  handleInput(data: string): void {
		if (this.disposed) return;
		if (this.busy) {
			const cancel =
				matchesKey(data, "ctrl+c")
				|| matchesKey(data, "escape")
				|| !!(this.options.keybindings && matchesCommandDialogCancel(data, this.options.keybindings));
			if (!this.busyCanClose || !cancel) return;
			this.cleanup();
			this.disposed = true;
			this.done();
			return;
		}
    this.resetInactivityTimeout();
    this.notice = null;

    if (matchesKey(data, "ctrl+c")) {
      this.cleanup();
			this.disposed = true;
      this.done();
      return;
    }

		if (this.confirmation) {
			this.handleConfirmationInput(data);
			return;
		}

    if (
		matchesKey(data, "escape") ||
		(this.options.keybindings && matchesCommandDialogCancel(data, this.options.keybindings))
	) {
      if (this.screen === "imports" || this.screen === "paths") {
        this.screen = this.discovery.hasAnyConfig ? "setup" : "empty";
        this.tui.requestRender();
        return;
      }
      this.cleanup();
			this.disposed = true;
      this.done();
      return;
    }

    if (this.screen === "imports") {
      this.handleImportsInput(data);
      return;
    }
    if (this.screen === "paths") {
      this.handlePathsInput(data);
      return;
    }

    const actions = this.getActions();
    if (this.keys.selectUp(data)) {
      this.actionCursor = Math.max(0, this.actionCursor - 1);
      this.tui.requestRender();
      return;
    }
    if (this.keys.selectDown(data)) {
      this.actionCursor = Math.min(actions.length - 1, this.actionCursor + 1);
      this.tui.requestRender();
      return;
    }
    if (actions.length > LIST_WINDOW_ROWS && this.isPageUp(data)) {
      this.actionCursor = Math.max(0, this.actionCursor - LIST_WINDOW_ROWS);
      this.tui.requestRender();
      return;
    }
    if (actions.length > LIST_WINDOW_ROWS && this.isPageDown(data)) {
      this.actionCursor = Math.min(actions.length - 1, this.actionCursor + LIST_WINDOW_ROWS);
      this.tui.requestRender();
      return;
    }
		if (matchesKey(data, Key.home) || matchesKey(data, Key.end)) {
			this.actionCursor = matchesKey(data, Key.home) ? 0 : Math.max(0, actions.length - 1);
			this.tui.requestRender();
			return;
		}
    if (this.keys.selectConfirm(data)) {
      const selected = this.getSelectedAction();
			if (!selected) return;
			if (this.isWriteAction(selected)) {
				this.confirmation = { kind: "action", action: selected };
				this.confirmCursor = 0;
				this.tui.requestRender();
			} else void this.runAction(selected);
    }
  }

  private handleImportsInput(data: string): void {
    const imports = this.discovery.imports;
    if (this.keys.selectUp(data)) {
      this.importCursor = Math.max(0, this.importCursor - 1);
      this.tui.requestRender();
      return;
    }
    if (this.keys.selectDown(data)) {
      this.importCursor = Math.min(imports.length - 1, this.importCursor + 1);
      this.tui.requestRender();
      return;
    }
		if (imports.length > LIST_WINDOW_ROWS && this.isPageUp(data)) {
			this.importCursor = Math.max(0, this.importCursor - LIST_WINDOW_ROWS);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "space")) {
			const current = imports[this.importCursor];
      if (!current) return;
      if (this.selectedImports.has(current.kind)) {
        this.selectedImports.delete(current.kind);
      } else {
        this.selectedImports.add(current.kind);
      }
			this.tui.requestRender();
			return;
		}
		if (imports.length > LIST_WINDOW_ROWS && this.isPageDown(data)) {
			this.importCursor = Math.min(imports.length - 1, this.importCursor + LIST_WINDOW_ROWS);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.home) || matchesKey(data, Key.end)) {
			this.importCursor = matchesKey(data, Key.home) ? 0 : Math.max(0, imports.length - 1);
			this.tui.requestRender();
			return;
		}
		if (this.keys.selectConfirm(data)) {
			const selected = this.discovery.imports.filter((entry) => this.selectedImports.has(entry.kind));
			if (selected.length === 0) {
				this.notice = { text: "Select at least one compatibility import first.", tone: "warning" };
				this.tui.requestRender();
				return;
			}
			this.confirmation = { kind: "imports" };
			this.confirmCursor = 0;
			this.tui.requestRender();
    }
  }

	private handleConfirmationInput(data: string): void {
		if (
			matchesKey(data, "escape") ||
			(this.options.keybindings && matchesCommandDialogCancel(data, this.options.keybindings))
		) {
			this.confirmation = null;
			this.tui.requestRender();
			return;
		}
		if (this.keys.selectUp(data)) {
			this.confirmCursor = 0;
			this.tui.requestRender();
			return;
		}
		if (this.keys.selectDown(data)) {
			this.confirmCursor = 1;
			this.tui.requestRender();
			return;
		}
		if (!this.keys.selectConfirm(data)) return;
		const pending = this.confirmation;
		this.confirmation = null;
		if (!pending) return;
		if (this.confirmCursor === 0) {
			this.tui.requestRender();
			return;
		}
		if (pending.kind === "imports") void this.applySelectedImports();
		else void this.runAction(pending.action);
	}

	private isWriteAction(action: Action): boolean {
		return action.id === "scaffold-project" || action.id === "add-repoprompt" || action.id === "add-known-server";
	}

  private handlePathsInput(data: string): void {
    const paths = this.getDetectedPaths();
    if (this.keys.selectUp(data)) {
      this.pathCursor = Math.max(0, this.pathCursor - 1);
      this.tui.requestRender();
      return;
    }
    if (this.keys.selectDown(data)) {
      this.pathCursor = Math.min(paths.length - 1, this.pathCursor + 1);
      this.tui.requestRender();
      return;
    }
    if (paths.length > LIST_WINDOW_ROWS && this.isPageUp(data)) {
      this.pathCursor = Math.max(0, this.pathCursor - LIST_WINDOW_ROWS);
      this.tui.requestRender();
      return;
    }
    if (paths.length > LIST_WINDOW_ROWS && this.isPageDown(data)) {
      this.pathCursor = Math.min(paths.length - 1, this.pathCursor + LIST_WINDOW_ROWS);
      this.tui.requestRender();
      return;
    }
		if (matchesKey(data, Key.home) || matchesKey(data, Key.end)) {
			this.pathCursor = matchesKey(data, Key.home) ? 0 : Math.max(0, paths.length - 1);
			this.tui.requestRender();
			return;
		}
    if (this.keys.selectConfirm(data)) {
      const selected = paths[this.pathCursor];
      if (!selected) return;
      void this.runBusy(async () => {
        await this.callbacks.openPath(selected);
        this.notice = { text: `Opened ${selected}`, tone: "success" };
      }, true);
    }
  }

  private async runAction(action: Action): Promise<void> {
    if (action.id === "run-setup") {
      this.screen = "setup";
      this.actionCursor = 0;
      this.tui.requestRender();
      return;
    }
    if (action.id === "adopt-imports") {
      this.screen = "imports";
      this.importCursor = 0;
      this.tui.requestRender();
      return;
    }
    if (action.id === "open-paths") {
      this.screen = "paths";
      this.pathCursor = 0;
      this.tui.requestRender();
      return;
    }
    if (action.id === "scaffold-project") {
      await this.runBusy(async () => {
        const result = await this.callbacks.scaffoldProjectConfig();
        this.callbacks.markSetupCompleted();
        this.notice = { text: `Wrote starter config to ${result.path}. Pi will reload after this panel closes.`, tone: "success" };
      });
      return;
    }
    if (action.id === "add-repoprompt") {
      await this.runBusy(async () => {
        const result = await this.callbacks.addRepoPrompt();
        this.callbacks.markSetupCompleted();
        this.notice = { text: `Added ${result.serverName} to ${result.path}. Pi will reload after this panel closes.`, tone: "success" };
      });
      return;
    }
    if (action.id === "add-known-server" && action.preset) {
      const preset = action.preset;
      await this.runBusy(async () => {
        const result = await this.callbacks.addKnownServer(preset);
        this.callbacks.markSetupCompleted();
        this.notice = { text: `Added ${result.serverName} to ${result.path}. Pi will reload after this panel closes.`, tone: "success" };
      });
      return;
    }
    this.notice = { text: "Review the details below. Press Enter on an action with a side effect to apply it.", tone: "muted" };
    this.tui.requestRender();
  }

  private async applySelectedImports(): Promise<void> {
    const selected = this.discovery.imports.filter((entry) => this.selectedImports.has(entry.kind)).map((entry) => entry.kind);
    if (selected.length === 0) {
      this.notice = { text: "Select at least one compatibility import first.", tone: "warning" };
      this.tui.requestRender();
      return;
    }

    await this.runBusy(async () => {
      const result = await this.callbacks.adoptImports(selected);
      this.callbacks.markSetupCompleted();
      this.notice = result.added.length > 0
        ? { text: `Added ${result.added.join(", ")} to ${result.path}. Pi will reload after this panel closes.`, tone: "success" }
        : { text: `No changes needed in ${result.path}.`, tone: "muted" };
      this.screen = this.discovery.hasAnyConfig ? "setup" : "empty";
      this.actionCursor = 0;
    });
  }

  private async runBusy(fn: () => Promise<void>, canClose = false): Promise<void> {
    this.busy = true;
		this.busyCanClose = canClose;
		this.cleanup();
    this.notice = { text: "Working...", tone: "muted" };
    this.tui.requestRender();
    try {
      await fn();
    } catch (error) {
      this.notice = {
        text: redactTraceText(formatTerminalError(error), 240),
        tone: "warning",
      };
    } finally {
      this.busy = false;
			this.busyCanClose = false;
			if (!this.disposed) {
				this.resetInactivityTimeout();
				this.tui.requestRender();
			}
    }
  }

  render(width: number): string[] {
		const panelW = Math.max(1, Math.floor(width));
		const contentW = this.contentWidth(panelW);
		const header = [fg(this.t.border, "━".repeat(panelW)), this.padLine(fg(this.t.title, "MCP setup"), panelW)];
		const body: string[] = [];
		const summary = this.discoverySummary();
		for (const line of wrapTextWithAnsi(summary.text, contentW)) {
			body.push(this.padLine(fg(summary.tone === "warning" ? this.t.warning : this.t.hint, line), panelW));
		}
		if (panelW >= VERBOSE_WIDTH) {
			for (const line of wrapTextWithAnsi(this.secondarySummaryLine(), contentW)) {
				body.push(this.padLine(fg(this.t.muted, line), panelW));
			}
		}
		body.push(this.padLine("", panelW));

		let noticeLine: string | undefined;
		if (this.notice) {
			const tone = this.notice.tone === "success" ? this.t.success : this.notice.tone === "warning" ? this.t.warning : this.t.hint;
			const icon = this.busy ? "●" : this.notice.tone === "success" ? "✓" : this.notice.tone === "warning" ? "!" : "○";
			for (const [index, line] of wrapTextWithAnsi(this.notice.text, Math.max(1, contentW - 2)).entries()) {
				const rendered = this.padLine(fg(tone, `${index === 0 ? `${icon} ` : "  "}${line}`), panelW);
				body.push(rendered);
				noticeLine ??= rendered;
			}
			body.push(this.padLine("", panelW));
		}

		if (this.confirmation) {
			body.push(...this.renderConfirmation(panelW));
		} else if (this.screen === "imports") {
			body.push(...this.renderImports(panelW));
		} else if (this.screen === "paths") {
			body.push(...this.renderPaths(panelW));
		} else {
			body.push(...this.renderActions(panelW));
		}
		const selected = body.find((line) => line.includes("›"));
		const question = body.find((line) => line.includes("! "));
		const confirmHeading = body.find((line) => line.includes("◆ Confirm change"));
		const previewHeading = body.find((line) => line.includes("◆ Preview"));
		const previewDetail = previewHeading ? body[body.indexOf(previewHeading) + 1] : undefined;
		const priority = [
			question ?? selected ?? noticeLine ?? body[0],
			noticeLine,
			selected,
			confirmHeading,
			previewHeading,
			previewDetail,
		].filter(
			(line, index, lines): line is string => !!line && lines.indexOf(line) === index,
		);
		const lines = fitCommandDialogRows(
			{ header, body, footer: this.renderFooter(panelW), priority },
			this.maximumRows(),
		);
		return lines.map((line) => truncateToWidth(line, panelW, "…"));
  }

	private renderConfirmation(innerW: number): string[] {
		const pending = this.confirmation;
		if (!pending) return [];
		const contentW = this.contentWidth(innerW);
		const action = pending.kind === "action" ? pending.action : undefined;
		const question = pending.kind === "imports"
			? "Write selected compatibility imports?"
			: action?.id === "scaffold-project"
				? "Write starter project .mcp.json?"
				: action?.id === "add-repoprompt"
					? "Add RepoPrompt to the MCP config?"
					: `Add ${action?.label ?? "this server"} to the MCP config?`;
		const lines = [
			this.padLine(fg(this.t.section, "◆ Confirm change"), innerW),
			this.padLine(fg(this.t.warning, `! ${question}`), innerW),
			this.padLine(fg(this.t.muted, "Review the target and exact diff before writing."), innerW),
			this.padLine("", innerW),
			this.padLine(fg(this.t.section, "◆ Preview"), innerW),
		];
		const preview = this.safePreview(() => pending.kind === "imports"
			? this.formatWritePreview(
					"Compatibility import write preview",
					this.callbacks.previewImports(
						this.discovery.imports
							.filter((entry) => this.selectedImports.has(entry.kind))
							.map((entry) => entry.kind),
					),
					[],
					this.previewWidth(innerW),
				)
			: this.getActionPreview(action, this.previewWidth(innerW)), this.previewWidth(innerW));
		for (const line of this.boundedPreview(preview, innerW < COMPACT_WIDTH ? 4 : PREVIEW_ROWS)) {
			lines.push(this.padLine(truncateToWidth(line, contentW, "…"), innerW));
		}
		lines.push(
			this.padLine("", innerW),
			this.padLine(`${this.confirmCursor === 0 ? fg(this.t.selected, "›") : " "} Cancel`, innerW),
			this.padLine(`${this.confirmCursor === 1 ? fg(this.t.selected, "›") : " "} Write and reload`, innerW),
			this.padLine("", innerW),
		);
		return lines;
	}

  private renderActions(innerW: number): string[] {
    const lines: string[] = [];
    const actions = this.getActions();
		const { start, end } = this.visibleRange(actions.length, this.actionCursor);

    if (start > 0) {
			lines.push(this.padLine(fg(this.t.muted, `… ${start} earlier`), innerW));
    }
		let section: string | undefined;
    for (let index = start; index < end; index++) {
      const action = actions[index];
			const nextSection = this.actionSection(action);
			if (nextSection !== section) {
				lines.push(this.padLine(fg(this.t.section, `◆ ${nextSection}`), innerW));
				section = nextSection;
      }
      const selected = index === this.actionCursor;
      const cursor = selected ? fg(this.t.selected, "›") : " ";
      lines.push(this.padLine(`${cursor} ${truncateToWidth(action.label, this.contentWidth(innerW) - 2)}`, innerW));
    }
    if (end < actions.length) {
			lines.push(this.padLine(fg(this.t.muted, `… ${actions.length - end} later`), innerW));
    }
		if (innerW >= COMPACT_WIDTH) {
			lines.push(this.padLine("", innerW));
			lines.push(this.padLine(fg(this.t.section, "◆ Preview"), innerW));
			const preview = this.safePreview(
				() => this.getActionPreview(this.getSelectedAction(), this.previewWidth(innerW)),
				this.previewWidth(innerW),
			);
			for (const line of this.boundedPreview(preview)) {
				lines.push(this.padLine(line, innerW));
			}
		}
		lines.push(this.padLine("", innerW));
    return lines;
  }

  private renderImports(innerW: number): string[] {
    const lines: string[] = [];
		lines.push(this.padLine(fg(this.t.section, "◆ Compatibility imports"), innerW));
		lines.push(this.padLine(fg(this.t.muted, "Choose sources to copy into Pi-owned compatibility config."), innerW));
    lines.push(this.padLine("", innerW));
		const { start, end } = this.visibleRange(this.discovery.imports.length, this.importCursor);
		if (start > 0) lines.push(this.padLine(fg(this.t.muted, `… ${start} earlier`), innerW));
		for (let index = start; index < end; index++) {
      const entry = this.discovery.imports[index];
      const selected = this.selectedImports.has(entry.kind) ? "[x]" : "[ ]";
      const cursor = index === this.importCursor ? fg(this.t.selected, "›") : " ";
      lines.push(this.padLine(`${cursor} ${selected} ${entry.kind}  ${entry.path}`, innerW));
    }
		if (end < this.discovery.imports.length) {
			lines.push(this.padLine(fg(this.t.muted, `… ${this.discovery.imports.length - end} later`), innerW));
		}
    lines.push(this.padLine("", innerW));
    const selected = this.discovery.imports.filter((entry) => this.selectedImports.has(entry.kind)).map((entry) => entry.kind);
		lines.push(this.padLine(fg(this.t.muted, `${selected.length} selected`), innerW));
		if (innerW >= COMPACT_WIDTH) {
			lines.push(this.padLine("", innerW));
			lines.push(this.padLine(fg(this.t.section, "◆ Preview"), innerW));
			const preview = this.safePreview(
				() => this.formatWritePreview(
					"Compatibility import write preview",
					this.callbacks.previewImports(selected),
					[],
					this.previewWidth(innerW),
				),
				this.previewWidth(innerW),
			);
			for (const line of this.boundedPreview(
				preview,
			)) {
				lines.push(this.padLine(line, innerW));
			}
    }
    return lines;
  }

  private renderPaths(innerW: number): string[] {
    const lines: string[] = [];
		lines.push(this.padLine(fg(this.t.section, "◆ Detected paths"), innerW));
		lines.push(this.padLine(fg(this.t.muted, "Open a discovered MCP config in the Host."), innerW));
    lines.push(this.padLine("", innerW));
    const paths = this.getDetectedPaths();
		const { start, end } = this.visibleRange(paths.length, this.pathCursor);
		if (start > 0) lines.push(this.padLine(fg(this.t.muted, `… ${start} earlier`), innerW));
		for (let index = start; index < end; index++) {
      const cursor = index === this.pathCursor ? fg(this.t.selected, "›") : " ";
      lines.push(this.padLine(`${cursor} ${paths[index]}`, innerW));
    }
		if (end < paths.length) lines.push(this.padLine(fg(this.t.muted, `… ${paths.length - end} later`), innerW));
    return lines;
  }

  private discoverySummary(): DiscoverySummaryLine {
    if (!this.discovery.hasAnyConfig) {
			return {
				text: this.options.onboardingState.setupCompleted
					? "No MCP servers are active right now."
					: "No MCP config is active yet.",
				tone: "warning",
			};
    }

    if (this.discovery.totalServerCount === 0 && (this.discovery.imports.length > 0 || !!this.discovery.repoPrompt.executablePath)) {
			return { text: "Pi found MCP-related setup options, but none are active in Pi yet.", tone: "warning" };
    }

    const shared = this.discovery.sources.filter((source) => source.kind === "shared" && source.serverCount > 0).length;
    const piOwned = this.discovery.sources.filter((source) => source.kind === "pi" && source.serverCount > 0).length;
		return {
			text: `Detected ${this.discovery.totalServerCount} configured servers across ${shared} shared and ${piOwned} Pi-owned source${shared + piOwned === 1 ? "" : "s"}.`,
			tone: "hint",
		};
  }

  private secondarySummaryLine(): string {
    const hostNote = this.discovery.hostConfigs.length > 0
      ? ` Host discovery is ${this.discovery.hostConfigDiscovery}; ${this.discovery.hostConfigs.length} host source${this.discovery.hostConfigs.length === 1 ? "" : "s"} detected.`
      : "";
    const conflictNote = this.discovery.conflicts.length > 0
      ? ` ${this.discovery.conflicts.length} same-name conflict${this.discovery.conflicts.length === 1 ? "" : "s"} reported.`
      : "";
    if (!this.discovery.hasAnyConfig) {
      return `Create a shared .mcp.json, adopt host imports, or quick-add RepoPrompt from this screen.${hostNote}${conflictNote}`;
    }
    if (this.discovery.totalServerCount === 0 && this.discovery.imports.length > 0) {
      return `Detected ${this.discovery.imports.length} compatibility import source${this.discovery.imports.length === 1 ? "" : "s"}. Adopt them into Pi or inspect the underlying files.${hostNote}${conflictNote}`;
    }
    return `Shared MCP files are preferred. Pi-owned files are only for compatibility imports and adapter-specific overrides.${hostNote}${conflictNote}`;
  }

  private visibleRange(total: number, cursor: number): VisibleRange {
		if (total <= LIST_WINDOW_ROWS) return { start: 0, end: total };
		const half = Math.floor(LIST_WINDOW_ROWS / 2);
		const start = Math.min(Math.max(0, cursor - half), Math.max(0, total - LIST_WINDOW_ROWS));
		return { start, end: Math.min(total, start + LIST_WINDOW_ROWS) };
  }

	private actionSection(action: Action): "Known servers" | "Setup" {
		return action.id === "add-known-server" || action.id === "add-repoprompt" ? "Known servers" : "Setup";
	}

	private boundedPreview(lines: string[], maximum = PREVIEW_ROWS): string[] {
		if (lines.length <= maximum) return lines;
		return [
			...lines.slice(0, Math.max(1, maximum - 1)),
			fg(this.t.muted, `… ${lines.length - maximum + 1} more line${lines.length - maximum + 1 === 1 ? "" : "s"}`),
		];
	}

	private safePreview(render: () => string[], width: number): string[] {
		try {
			return render();
		} catch (error) {
			const lines = this.formatPreview([
				`! ${redactTraceText(formatTerminalError(error), 240)}`,
				"Fix the config file before writing.",
			], width);
			return lines.map((line, index) => fg(index === 0 ? this.t.warning : this.t.hint, line));
		}
	}

	private isPageUp(data: string): boolean {
		return this.keys.selectPageUp(data);
	}

	private isPageDown(data: string): boolean {
		return this.keys.selectPageDown(data);
	}

  private contentWidth(innerW: number): number {
		return Math.max(1, innerW - 2);
  }

  private previewWidth(innerW: number): number {
    return Math.max(12, Math.min(DESKTOP_PREVIEW_WIDTH, this.contentWidth(innerW)));
  }

  private getActionPreview(action?: Action, previewW = DESKTOP_PREVIEW_WIDTH): string[] {
    switch (action?.id) {
      case "run-setup":
        return this.formatPreview([
          "Run setup to adopt host-specific imports, inspect detected paths, and scaffold a minimal `.mcp.json` if needed.",
        ], previewW);
      case "adopt-imports":
        return this.formatWritePreview(
          "Compatibility import write preview",
          this.callbacks.previewImports(this.discovery.imports.filter((entry) => this.selectedImports.has(entry.kind)).map((entry) => entry.kind)),
          [
            `Detected imports: ${this.discovery.imports.map((entry) => `${entry.kind} (${entry.serverCount} servers)`).join(", ")}`,
            "Selected imports are written into the Pi agent dir config as Pi-owned compatibility state.",
          ],
          previewW,
        );
      case "view-example":
        return this.formatPreview([
          "Example shared `.mcp.json`:",
          "{",
          '  "mcpServers": {',
          '    "chrome-devtools": {',
          '      "command": "npx",',
          '      "args": ["-y", "chrome-devtools-mcp@latest"]',
          "    }",
          "  }",
          "}",
          "",
          "Use Scaffold project `.mcp.json` when you want a safe empty shell instead of a live example server.",
        ], previewW);
      case "show-precedence":
        return this.formatPreview([
          "Read order (later entries win):",
          "0. detected host configs (opt-in lowest-precedence fallback)",
          `1. ${this.discovery.sources.find((source) => source.id === "shared-global")?.path ?? "$XDG_CONFIG_HOME/mcp/mcp.json"}`,
          "2. ~/.agents/mcp.json",
          "3. ~/.agents/mcp/mcp.json",
          "4. <Pi agent dir>/mcp.json",
          "5. .mcp.json",
          "6. .pi/mcp.json",
          `Host discovery: ${this.discovery.hostConfigDiscovery}. Conflicts reported: ${this.discovery.conflicts.length}.`,
          ...this.discovery.conflicts.slice(0, 8).map((conflict) =>
            `${conflict.serverName}: ${conflict.sources.map((source) => source.path).join(" -> ")} (winner: ${conflict.winner.path})`,
          ),
          "Pi writes compatibility imports and adapter-only overrides to Pi-owned files."
        ], previewW);
      case "open-paths":
        return this.formatPreview(this.getDetectedPaths().length > 0
          ? ["Detected paths:", ...this.getDetectedPaths()]
          : ["No config paths were detected."], previewW);
      case "add-repoprompt": {
        const repoPrompt = this.discovery.repoPrompt;
        const preview = this.callbacks.previewRepoPrompt();
        if (!preview) {
          return this.formatPreview(["RepoPrompt is not available to add from this setup screen."], previewW);
        }
        return this.formatWritePreview(
          "RepoPrompt write preview",
          preview,
          [
            `Executable: ${repoPrompt.executablePath ?? "not found"}`,
            `Target: ${repoPrompt.targetPath ?? "n/a"}`,
            `Server name: ${repoPrompt.serverName ?? "repoprompt"}`,
          ],
          previewW,
        );
      }
      case "add-known-server": {
        const preset = action.preset;
        if (!preset) return this.formatPreview(["Known server preset is unavailable."], previewW);
        return this.formatWritePreview(
          `${preset.name} write preview`,
          this.callbacks.previewKnownServer(preset),
          [preset.summary],
          previewW,
        );
      }
      case "scaffold-project":
        return this.formatWritePreview(
          "Starter project `.mcp.json` write preview",
          this.callbacks.previewStarterProject(),
          [
            "This writes a minimal `.mcp.json` in the current project using the shared MCP layout.",
            "It intentionally avoids adding a fake placeholder server that would fail on first reload.",
          ],
          previewW,
        );
      default:
				return [];
    }
  }

  private formatPreview(lines: string[], width = DESKTOP_PREVIEW_WIDTH): string[] {
    const preview: string[] = [];
    for (const line of lines) {
			if (/^\s|^[{}]$|^"/u.test(line)) preview.push(truncateToWidth(line, width, "…", true));
			else preview.push(...wrapTextWithAnsi(line, width));
    }
    return preview;
  }

  private formatWritePreview(title: string, preview: ConfigWritePreview, intro: string[] = [], width = DESKTOP_PREVIEW_WIDTH): string[] {
    const lines: string[] = [];
    for (const line of intro) {
      lines.push(...wrapTextWithAnsi(line, width));
    }
    if (intro.length > 0) lines.push("");
    lines.push(...wrapTextWithAnsi(`${title}: ${preview.path}`, width));
    lines.push(...wrapTextWithAnsi(preview.existed ? "Existing file detected. Showing exact before/after diff." : "New file will be created. Showing exact content diff.", width));
    lines.push("");
    const diffLines = preview.diffText.split("\n");
    const maxLines = 18;
    const shown = diffLines.slice(0, maxLines);
    for (const line of shown) {
			lines.push(truncateToWidth(line, width, "…", true));
    }
    if (diffLines.length > maxLines) {
      lines.push(...wrapTextWithAnsi(`… ${diffLines.length - maxLines} more diff line${diffLines.length - maxLines === 1 ? "" : "s"}`, width));
    }
    return lines;
  }

  private padLine(text: string, innerW: number): string {
    const inset = 2;
		const contentW = Math.max(0, innerW - inset);
    const fitted = truncateToWidth(text, contentW, "…", true);
		return `${" ".repeat(Math.min(inset, innerW))}${fitted}`;
  }

	private renderFooter(width: number): string[] {
		const total = this.screen === "imports"
			? this.discovery.imports.length
			: this.screen === "paths"
				? this.getDetectedPaths().length
				: this.getActions().length;
		const keybindings = this.options.keybindings;
		const up = keybindings ? commandDialogPrimaryKey(keybindings, "tui.select.up", "↑") : "↑";
		const down = keybindings ? commandDialogPrimaryKey(keybindings, "tui.select.down", "↓") : "↓";
		const pageUp = keybindings ? commandDialogPrimaryKey(keybindings, "tui.select.pageUp", "PgUp") : "PgUp";
		const pageDown = keybindings ? commandDialogPrimaryKey(keybindings, "tui.select.pageDown", "PgDn") : "PgDn";
		const confirm = keybindings ? commandDialogPrimaryKey(keybindings, "tui.select.confirm", "Enter") : "Enter";
		const cancel = keybindings ? commandDialogPrimaryKey(keybindings, "tui.select.cancel", "Esc") : "Esc";
		const page = total > LIST_WINDOW_ROWS ? ` · ${pageUp}/${pageDown} page` : "";
		const action = this.confirmation
			? `${up}/${down} navigate · ${confirm} select`
			: this.screen === "imports"
				? `${up}/${down} navigate${page} · Space toggle · ${confirm} review`
				: this.screen === "paths"
					? `${up}/${down} navigate${page} · ${confirm} open`
					: `${up}/${down} navigate${page} · ${confirm} select`;
		return [
			this.padLine(fg(this.t.muted, action), width),
			this.padLine(
				fg(
					this.t.muted,
					`${cancel} ${this.screen === "imports" || this.screen === "paths" || this.confirmation ? "back" : "close"}`,
				),
				width,
			),
		];
	}

	private maximumRows(): number {
		const rows = this.tui.terminal?.rows;
		return isRuntimeNumber(rows) && Number.isFinite(rows) ? Math.max(1, Math.floor(rows) - 3) : 21;
	}

  invalidate(): void {}

  dispose(): void {
		this.disposed = true;
    this.cleanup();
  }
}

export function createMcpSetupPanel(
  discovery: McpDiscoverySummary,
  callbacks: SetupPanelCallbacks,
	options: SetupPanelOptions,
	tui: SetupTui,
	theme: Theme,
	done: () => void,
): McpSetupPanel & { dispose(): void } {
	return new McpSetupPanel(discovery, callbacks, options, tui, theme, done);
}
