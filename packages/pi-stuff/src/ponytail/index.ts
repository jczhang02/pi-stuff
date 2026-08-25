import {
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { registerContextPromptContributor } from "../context-management/index.js";
import {
	createPonytailDialogView,
	getCommandDialogCoordinator,
	type PonytailDialogAction,
	type PonytailDialogSnapshot,
	reportDiagnostic,
} from "../conversation-ui/index.js";
import { isJsonInputObject } from "../shared/json-value.js";
import { PonytailConfigStore, type PonytailSettingsPatch } from "./config.js";
import { preparePonytailInstructions } from "./instructions.js";
import { PonytailPromptRenderer } from "./prompt.js";
import { type PonytailRuntimeRegistry, ponytailRuntimeRegistry } from "./state.js";
import {
	inheritedPonytailMode,
	isPonytailDeactivationCommand,
	normalizePonytailMode,
	PONYTAIL_DEFAULT_MODE,
	PONYTAIL_MODES,
	PONYTAIL_SESSION_ENTRY_TYPE,
	PONYTAIL_SPECIALIZED_SKILLS,
	type PonytailEffectiveSettings,
	type PonytailMode,
	type PonytailSpecializedSkill,
} from "./types.js";

const PONYTAIL_STATUS_KEY = "ponytail";

export { getPonytailMode } from "./state.js";

function entryMode(entry: SessionEntry): PonytailMode | undefined {
	if (entry.type !== "custom" || entry.customType !== PONYTAIL_SESSION_ENTRY_TYPE) return undefined;
	const data = entry.data;
	if (!isJsonInputObject(data)) return undefined;
	return normalizePonytailMode(data["mode"]);
}

export function newestPonytailBranchMode(entries: readonly SessionEntry[]): PonytailMode | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry) continue;
		const mode = entryMode(entry);
		if (mode) return mode;
	}
	return undefined;
}

function activationMode(settings: PonytailEffectiveSettings): PonytailMode {
	return settings.defaultMode === "off" ? PONYTAIL_DEFAULT_MODE : settings.defaultMode;
}

function sessionIdentity(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionId() ?? ctx.sessionManager.getSessionFile() ?? undefined;
}

class PonytailRuntime {
	private readonly config: PonytailConfigStore;
	private readonly pi: ExtensionAPI;
	private readonly prompt: PonytailPromptRenderer;
	private readonly registry: PonytailRuntimeRegistry;
	private readonly releasePrompt: () => void;
	private mode: PonytailMode = PONYTAIL_DEFAULT_MODE;
	private settings: PonytailEffectiveSettings;
	private lastSettingsError: string | undefined;
	private disposed = false;

	constructor(pi: ExtensionAPI, registry: PonytailRuntimeRegistry) {
		preparePonytailInstructions();
		this.pi = pi;
		this.registry = registry;
		this.config = new PonytailConfigStore(getAgentDir());
		this.prompt = new PonytailPromptRenderer(pi);
		this.settings = this.config.read();
		this.releasePrompt = registerContextPromptContributor(pi, {
			id: "ponytail",
			order: 300,
			renderAgent: (event) => this.renderAgentPrompt(event),
			renderProvider: () => this.prompt.renderProvider(this.mode),
		});
	}

	install(): void {
		this.pi.on("session_start", (_event, ctx) => this.startSession(ctx));
		this.pi.on("session_tree", (_event, ctx) => this.restoreBranchMode(ctx));
		this.pi.on("input", async (event, ctx) => {
			if (event.source !== "extension" && isPonytailDeactivationCommand(event.text)) {
				await this.setMode("off", ctx, false);
			}
			return { action: "continue" };
		});
		this.pi.on("session_shutdown", (_event, ctx) => this.shutdown(ctx));
		this.pi.registerCommand("ponytail", {
			description: "Configure Ponytail's KISS mode and open its control dialog",
			getArgumentCompletions: (prefix) => this.completions(prefix),
			handler: (args, ctx) => this.handleCommand(args, ctx),
		});
		for (const skill of PONYTAIL_SPECIALIZED_SKILLS) {
			this.pi.registerCommand(skill, {
				description: `Run the ${skill} Skill`,
				handler: (args, ctx) => this.launchSkill(skill, ctx, args),
			});
		}
	}

	currentMode(): PonytailMode {
		return this.mode;
	}

	private renderAgentPrompt(event: BeforeAgentStartEvent): string | undefined {
		return this.prompt.renderAgent(event, this.mode);
	}

	private startSession(ctx: ExtensionContext): void {
		this.settings = this.config.read();
		this.reportSettingsError();
		this.restoreBranchMode(ctx);
		const identity = sessionIdentity(ctx);
		if (
			ctx.hasUI &&
			this.mode !== "off" &&
			!this.settings.quietStartup &&
			identity &&
			!this.registry.startupNotified.has(identity)
		) {
			this.registry.startupNotified.add(identity);
			ctx.ui.notify(`Ponytail active · ${this.mode} mode`, "info");
		}
	}

	private restoreBranchMode(ctx: ExtensionContext): void {
		const restored = newestPonytailBranchMode(ctx.sessionManager.getBranch());
		this.mode = restored ?? inheritedPonytailMode() ?? this.settings.defaultMode;
		this.syncStatus(ctx);
	}

	private async setMode(mode: PonytailMode, ctx: ExtensionContext, notify: boolean): Promise<void> {
		this.mode = mode;
		this.pi.appendEntry(PONYTAIL_SESSION_ENTRY_TYPE, { mode });
		this.syncStatus(ctx);
		if (notify) ctx.ui.notify(`Ponytail mode: ${mode}`, "info");
	}

	private async updateSettings(patch: PonytailSettingsPatch, ctx: ExtensionContext): Promise<void> {
		this.settings = await this.config.write(patch);
		this.reportSettingsError();
		this.syncStatus(ctx);
	}

	private syncStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			PONYTAIL_STATUS_KEY,
			this.settings.hideStatus || this.mode === "off" ? undefined : `♞ ${this.mode}`,
		);
	}

	private reportSettingsError(): void {
		if (!this.settings.error || this.settings.error === this.lastSettingsError) return;
		this.lastSettingsError = this.settings.error;
		reportDiagnostic({
			capability: "Ponytail",
			key: "settings",
			severity: "warning",
			summary: "Ponytail configuration is invalid; safe defaults are active.",
			details: this.settings.error,
			visibility: "silent",
		});
	}

	private async handleCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const tokens = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
		if (tokens.length === 0) {
			await this.showDialog(ctx);
			return;
		}
		const head = tokens[0];
		const directMode = normalizePonytailMode(head);
		if (directMode && tokens.length === 1) {
			await this.setMode(directMode, ctx, true);
			return;
		}
		if (head === "on" && tokens.length === 1) {
			await this.setMode(activationMode(this.settings), ctx, true);
			return;
		}
		if (head === "status" && tokens.length === 1) {
			ctx.ui.notify(this.statusText(), "info");
			return;
		}
		if (head === "default" && tokens.length === 2) {
			const mode = normalizePonytailMode(tokens[1]);
			if (!mode) return this.usage(ctx);
			try {
				await this.updateSettings({ defaultMode: mode }, ctx);
				ctx.ui.notify(
					this.settings.defaultModeOverridden
						? `Saved default ${mode}; PONYTAIL_DEFAULT_MODE keeps ${this.settings.defaultMode} effective.`
						: `Ponytail default: ${mode}`,
					"info",
				);
			} catch (error) {
				this.writeError(ctx, error);
			}
			return;
		}
		if (head === "status" && tokens.length === 2 && (tokens[1] === "show" || tokens[1] === "hide")) {
			try {
				await this.updateSettings({ hideStatus: tokens[1] === "hide" }, ctx);
				ctx.ui.notify(
					this.settings.hideStatusOverridden
						? "Saved Statusline preference; PONYTAIL_HIDE_STATUS remains effective."
						: `Ponytail Statusline: ${tokens[1] === "hide" ? "hidden" : "shown"}`,
					"info",
				);
			} catch (error) {
				this.writeError(ctx, error);
			}
			return;
		}
		if (head === "startup" && tokens.length === 2 && (tokens[1] === "show" || tokens[1] === "quiet")) {
			try {
				await this.updateSettings({ quietStartup: tokens[1] === "quiet" }, ctx);
				ctx.ui.notify(
					this.settings.quietStartupOverridden
						? "Saved startup preference; PONYTAIL_QUIET_STARTUP remains effective."
						: `Ponytail startup notification: ${tokens[1]}`,
					"info",
				);
			} catch (error) {
				this.writeError(ctx, error);
			}
			return;
		}
		this.usage(ctx);
	}

	private async showDialog(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify("The Ponytail dialog is available in interactive TUI sessions.", "warning");
			return;
		}
		const skill = await getCommandDialogCoordinator(this.pi).show<PonytailSpecializedSkill>(
			ctx,
			createPonytailDialogView(this.dialogSnapshot(), {
				apply: (action) => this.applyDialogAction(action, ctx),
			}),
		);
		if (skill) await this.launchSkill(skill, ctx);
	}

	private async applyDialogAction(
		action: PonytailDialogAction,
		ctx: ExtensionContext,
	): Promise<PonytailDialogSnapshot> {
		if (action.type === "set-mode") await this.setMode(action.mode, ctx, false);
		else if (action.type === "set-default") await this.updateSettings({ defaultMode: action.mode }, ctx);
		else if (action.type === "set-status") await this.updateSettings({ hideStatus: action.hide }, ctx);
		else await this.updateSettings({ quietStartup: action.quiet }, ctx);
		return this.dialogSnapshot();
	}

	private launchSkill(skill: PonytailSpecializedSkill, ctx: ExtensionContext, args = ""): Promise<void> {
		const suffix = args.trim();
		const content = `/skill:${skill}${suffix ? ` ${suffix}` : ""}`;
		if (ctx.isIdle()) this.pi.sendUserMessage(content, { expandPromptTemplates: true });
		else this.pi.sendUserMessage(content, { deliverAs: "followUp", expandPromptTemplates: true });
		return Promise.resolve();
	}

	private dialogSnapshot(): PonytailDialogSnapshot {
		const snapshot = {
			mode: this.mode,
			defaultMode: this.settings.defaultMode,
			savedDefaultMode: this.settings.saved.defaultMode,
			hideStatus: this.settings.hideStatus,
			savedHideStatus: this.settings.saved.hideStatus,
			quietStartup: this.settings.quietStartup,
			savedQuietStartup: this.settings.saved.quietStartup,
			defaultModeOverridden: this.settings.defaultModeOverridden,
			hideStatusOverridden: this.settings.hideStatusOverridden,
			quietStartupOverridden: this.settings.quietStartupOverridden,
			source: this.settings.source,
		};
		return this.settings.error ? { ...snapshot, error: this.settings.error } : snapshot;
	}

	private statusText(): string {
		return `Ponytail · mode ${this.mode} · default ${this.settings.defaultMode} · Statusline ${this.settings.hideStatus ? "hidden" : "shown"} · startup ${this.settings.quietStartup ? "quiet" : "shown"}`;
	}

	private writeError<ErrorValue>(ctx: ExtensionContext, error: ErrorValue): void {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}

	private usage(ctx: ExtensionContext): void {
		ctx.ui.notify(
			"Usage: /ponytail [on|off|lite|full|ultra|status [show|hide]|startup [show|quiet]|default <mode>]",
			"warning",
		);
	}

	private completions(prefix: string): AutocompleteItem[] | null {
		const normalized = prefix.trimStart().toLowerCase();
		const all = [
			...PONYTAIL_MODES.map((mode) => ({ value: mode, description: `Use ${mode} mode in this Session` })),
			{ value: "on", description: "Activate the configured default mode" },
			{ value: "status", description: "Show Ponytail status" },
			{ value: "status show", description: "Show Ponytail in the Statusline" },
			{ value: "status hide", description: "Hide Ponytail from the Statusline" },
			{ value: "startup show", description: "Show the startup notification" },
			{ value: "startup quiet", description: "Suppress the startup notification" },
			...PONYTAIL_MODES.map((mode) => ({ value: `default ${mode}`, description: `Use ${mode} for new Sessions` })),
		];
		const matches = all.filter((item) => item.value.startsWith(normalized));
		return matches.length > 0 ? matches.map((item) => ({ ...item, label: item.value })) : null;
	}

	private shutdown(ctx: ExtensionContext): void {
		if (this.disposed) return;
		this.disposed = true;
		this.releasePrompt();
		ctx.ui.setStatus(PONYTAIL_STATUS_KEY, undefined);
		// SAFETY: Pi's events surface is the stable object identity shared by duplicate ExtensionAPI wrappers.
		const owner = this.pi.events as object;
		if (this.registry.owners.get(owner) === this) this.registry.owners.delete(owner);
	}
}

export default function ponytailCapability(pi: ExtensionAPI): void {
	const registry = ponytailRuntimeRegistry();
	// SAFETY: Pi's events surface is the stable object identity shared by duplicate ExtensionAPI wrappers.
	const owner = pi.events as object;
	if (registry.owners.has(owner)) return;
	const runtime = new PonytailRuntime(pi, registry);
	registry.owners.set(owner, runtime);
	runtime.install();
}
