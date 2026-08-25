import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type CommandDialogCoordinatorHost,
	getCommandDialogCoordinator,
	listenForUserAgentRunSettled,
} from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { SessionNamingController } from "./controller.js";
import { generateSessionName } from "./model.js";
import { SessionNamingSettingsStore } from "./settings.js";
import { createSessionNamingSettingsView, type SessionNamingModelChoice } from "./settings-dialog.js";
import { type RenameMarker, SESSION_NAMING_STATE_ENTRY_TYPE } from "./state.js";

const CHILD_AGENT_ENV = "PI_SUBAGENT_CHILD";

export type SessionNamingHost = CommandDialogCoordinatorHost &
	Pick<ExtensionAPI, "appendEntry" | "getSessionName" | "registerCommand" | "setSessionName">;

function isChildAgentSession(environment: NodeJS.ProcessEnv): boolean {
	return environment[CHILD_AGENT_ENV] === "1";
}

function createController(
	pi: SessionNamingHost,
	ctx: ExtensionContext,
	settings: SessionNamingSettingsStore,
): SessionNamingController {
	const current = settings.get();
	return new SessionNamingController(current, {
		appendMarker(marker: RenameMarker) {
			pi.appendEntry(SESSION_NAMING_STATE_ENTRY_TYPE, marker);
		},
		generate: (messages, currentName, signal) => generateSessionName(ctx, current, messages, currentName, signal),
		getBranch: () => ctx.sessionManager.getBranch(),
		getSessionName: () => pi.getSessionName(),
		now: Date.now,
		setSessionName: (name) => pi.setSessionName(name),
	});
}

function availableNamingModelChoices(ctx: ExtensionContext): SessionNamingModelChoice[] {
	const models =
		ctx.scopedModels.length > 0 ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
	return models.map((model): SessionNamingModelChoice => {
		const value = `${model.provider}/${model.id}`;
		if (model.name === model.id) return { value };
		return { description: model.name, value };
	});
}

export function installSessionNamingCapability(
	pi: SessionNamingHost,
	settings: SessionNamingSettingsStore,
	environment: NodeJS.ProcessEnv = process.env,
): void {
	const dialogs = getCommandDialogCoordinator(pi);
	let controller: SessionNamingController | undefined;
	let sessionContext: ExtensionContext | undefined;
	let active = true;
	const childSession = isChildAgentSession(environment);
	const rebuildController = () => {
		if (!active || !sessionContext) return;
		controller?.shutdown();
		controller = createController(pi, sessionContext, settings);
		controller.restore();
	};
	const stopListeningForSettings = settings.subscribe(rebuildController);
	const stopListeningForUserAgentRunSettled = listenForUserAgentRunSettled(pi, (ctx) => {
		if (!active || childSession || ctx !== sessionContext) return;
		void controller?.handleSettled();
	});

	pi.registerCommand("autoname", {
		description: "Regenerate or configure the current Session name",
		getArgumentCompletions: (prefix) => {
			const normalized = prefix.trimStart().toLowerCase();
			// Pi requeries after applying a completion; returning the exact item would reopen the list and trap submit.
			if (normalized === "settings") return null;
			if (/\s/u.test(normalized) || !"settings".startsWith(normalized)) return null;
			return [{ label: "settings", value: "settings" }];
		},
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			if (argument === "settings") {
				if (ctx.mode !== "tui" || !ctx.hasUI) {
					ctx.ui.notify("/autoname settings requires interactive TUI mode.", "warning");
					return;
				}
				await dialogs.show(
					ctx,
					createSessionNamingSettingsView(settings, {
						modelChoices: availableNamingModelChoices(ctx),
						onPersistenceError: (message) => ctx.ui.notify(message, "error"),
					}),
				);
				return;
			}
			if (argument) {
				ctx.ui.notify("Usage: /autoname [settings]", "warning");
				return;
			}
			if (!controller) {
				ctx.ui.notify("Session Naming is not ready.", "warning");
				return;
			}
			const name = await controller.renameManually();
			ctx.ui.notify(
				name ? `Session named: ${name}` : "Could not generate a Session name.",
				name ? "info" : "warning",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		controller?.shutdown();
		sessionContext = ctx;
		controller = createController(pi, ctx, settings);
		controller.restore();
	});
	pi.on("session_info_changed", (event) => controller?.observeSessionNameChange(event.name));
	pi.on("session_shutdown", async () => {
		active = false;
		stopListeningForSettings();
		stopListeningForUserAgentRunSettled();
		controller?.shutdown();
		controller = undefined;
		sessionContext = undefined;
		await settleWithin(settings.whenIdle(), HOST_SHUTDOWN_GRACE_MS);
	});
}

export default async function piStuffSessionNaming(pi: ExtensionAPI): Promise<void> {
	installSessionNamingCapability(pi, await SessionNamingSettingsStore.load());
}
