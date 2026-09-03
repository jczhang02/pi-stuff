import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { reportDiagnostic } from "../conversation-ui/index.js";
import { type EffectFoundation, installEffectFoundation } from "../shared/effect-foundation.js";
import { FastResumeEffectOwner } from "./effect-owner.js";
import { type FastResumeHostPatch, installCertifiedFastResumeHostPatch } from "./host-adapter.js";
import { openFastResumeSelector } from "./selector.js";
import { FastResumeSettingsStore } from "./settings.js";

export type FastResumeHost = Pick<ExtensionAPI, "events" | "on" | "registerCommand" | "registerShortcut">;

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
	foundation: EffectFoundation,
): Promise<void> {
	if (context.mode !== "tui" || !context.hasUI) {
		context.ui.notify("Fast Resume requires interactive TUI mode.", "warning");
		return;
	}
	const owner = new FastResumeEffectOwner(foundation);
	owner.bindSession(context);
	try {
		const selected = await openFastResumeSelector(context, owner, query);
		if (!selected) return;
		try {
			await context.switchSession(selected);
		} catch {
			context.ui.notify("Fast Resume could not switch to the selected Session.", "error");
		}
	} finally {
		await owner.shutdown();
	}
}

export function installFastResumeCapability(pi: FastResumeHost, settingsStore: FastResumeSettingsStore): void {
	const foundation = installEffectFoundation(pi);
	const settings = settingsStore.get();
	const open = (context: ExtensionCommandContext, query = "") => showFastResume(context, query, foundation);
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
			description: "Open the fast native Session selector",
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
	pi.on("session_shutdown", () => {
		patch.restore();
	});
}

export default async function piStuffFastResume(pi: ExtensionAPI): Promise<void> {
	installFastResumeCapability(pi, await Effect.runPromise(FastResumeSettingsStore.load()));
}
