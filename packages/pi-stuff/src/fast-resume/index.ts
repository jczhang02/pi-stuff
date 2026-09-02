import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import {
	type CommandDialogCoordinatorHost,
	getCommandDialogCoordinator,
	reportDiagnostic,
} from "../conversation-ui/index.js";
import { installEffectFoundation } from "../shared/effect-foundation.js";
import { prepareFastResumeController } from "./controller.js";
import { createFastResumeDialogView } from "./dialog.js";
import { FastResumeEffectOwner } from "./effect-owner.js";
import {
	type FastResumeHostPatch,
	installCertifiedFastResumeHostPatch,
	usesDefaultSessionDirectory,
} from "./host-adapter.js";
import { FastResumeSettingsStore } from "./settings.js";

export type FastResumeHost = CommandDialogCoordinatorHost &
	Pick<ExtensionAPI, "on" | "registerCommand" | "registerShortcut">;

function reportPatchProblem(message: string): void {
	reportDiagnostic({
		action: "Run /fast-resume directly or disable fastResume.hijackResume, then run /reload.",
		capability: "Fast Resume",
		details: message,
		key: "fast-resume-host-patch",
		severity: "warning",
		summary: "Fast Resume could not take over the certified Host resume entry point",
	});
}

async function showFastResume(
	context: ExtensionCommandContext,
	query: string,
	owner: FastResumeEffectOwner,
	dialogs: ReturnType<typeof getCommandDialogCoordinator>,
): Promise<void> {
	if (context.mode !== "tui" || !context.hasUI) {
		context.ui.notify("Fast Resume requires interactive TUI mode.", "warning");
		return;
	}
	const currentSessionPath = context.sessionManager.getSessionFile();
	const baseOptions = {
		cwd: context.sessionManager.getCwd(),
		owner,
		sessionDir: context.sessionManager.getSessionDir(),
		usesDefaultSessionDir: usesDefaultSessionDirectory(context.sessionManager),
	};
	const controllerOptions = currentSessionPath ? { ...baseOptions, currentSessionPath } : baseOptions;
	const controller = await owner.run(prepareFastResumeController(controllerOptions));
	const selected = await dialogs.show(context, createFastResumeDialogView(controller, query.trim()));
	if (!selected) return;
	try {
		await context.switchSession(selected);
	} catch {
		context.ui.notify("Fast Resume could not switch to the selected Session.", "error");
	}
}

export function installFastResumeCapability(pi: FastResumeHost, settingsStore: FastResumeSettingsStore): void {
	const foundation = installEffectFoundation(pi);
	const owner = new FastResumeEffectOwner(foundation);
	const dialogs = getCommandDialogCoordinator(pi);
	const settings = settingsStore.get();
	const open = (context: ExtensionCommandContext, query = "") => showFastResume(context, query, owner, dialogs);
	const openCommand = async (context: ExtensionCommandContext, query = "") => {
		try {
			await open(context, query);
		} catch {
			context.ui.notify("Fast Resume could not open the Session list.", "error");
		}
	};
	const patch: FastResumeHostPatch = installCertifiedFastResumeHostPatch({
		captureShortcutContext: settings.shortcut !== undefined,
		hijackResume: settings.hijackResume,
		open,
		report: reportPatchProblem,
	});

	if (!settings.hijackResume || !patch.hijackInstalled) {
		pi.registerCommand("fast-resume", {
			description: "Open the fast local Session picker",
			handler: (args, context) => openCommand(context, args),
		});
	}
	if (settings.shortcut) {
		pi.registerShortcut(settings.shortcut, {
			description: "Open Fast Resume",
			handler: (context) => {
				const commandContext = patch.commandContext();
				if (commandContext) return openCommand(commandContext);
				const fallback = settings.hijackResume ? "/resume" : "/fast-resume";
				context.ui.notify(`Fast Resume shortcut is not ready; run ${fallback} instead.`, "warning");
			},
		});
	}
	pi.on("session_start", (_event, context: ExtensionContext) => {
		owner.bindSession(context);
	});
	pi.on("session_shutdown", async () => {
		patch.restore();
		await owner.shutdown();
	});
}

export default async function piStuffFastResume(pi: ExtensionAPI): Promise<void> {
	installFastResumeCapability(pi, await Effect.runPromise(FastResumeSettingsStore.load()));
}
