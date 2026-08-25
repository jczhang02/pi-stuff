import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { listenForUserAgentRunSettled } from "../conversation-ui/index.js";
import { SessionNamingController } from "./controller.js";
import { generateSessionName } from "./model.js";
import { loadSessionNamingSettings, type SessionNamingSettings } from "./settings.js";
import { type RenameMarker, SESSION_NAMING_STATE_ENTRY_TYPE } from "./state.js";

const CHILD_AGENT_ENV = "PI_SUBAGENT_CHILD";

export type SessionNamingHost = Pick<
	ExtensionAPI,
	"appendEntry" | "events" | "getSessionName" | "on" | "registerCommand" | "setSessionName"
>;

function isChildAgentSession(environment: NodeJS.ProcessEnv): boolean {
	return environment[CHILD_AGENT_ENV] === "1";
}

function createController(
	pi: SessionNamingHost,
	ctx: ExtensionContext,
	settings: SessionNamingSettings,
): SessionNamingController {
	return new SessionNamingController(settings, {
		appendMarker(marker: RenameMarker) {
			pi.appendEntry(SESSION_NAMING_STATE_ENTRY_TYPE, marker);
		},
		generate: (messages, currentName, signal) => generateSessionName(ctx, settings, messages, currentName, signal),
		getBranch: () => ctx.sessionManager.getBranch(),
		getSessionName: () => pi.getSessionName(),
		now: Date.now,
		setSessionName: (name) => pi.setSessionName(name),
	});
}

export function installSessionNamingCapability(
	pi: SessionNamingHost,
	settings: SessionNamingSettings,
	environment: NodeJS.ProcessEnv = process.env,
): void {
	let controller: SessionNamingController | undefined;
	let sessionContext: ExtensionContext | undefined;
	let active = true;
	const childSession = isChildAgentSession(environment);
	const stopListeningForUserAgentRunSettled = listenForUserAgentRunSettled(pi, (ctx) => {
		if (!active || childSession || ctx !== sessionContext) return;
		void controller?.handleSettled();
	});

	pi.registerCommand("autoname", {
		description: "Regenerate the current Session name",
		handler: async (_args, ctx) => {
			if (!settings.enabled) {
				ctx.ui.notify("Session Naming is disabled in pi-stuff.json.", "warning");
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
	pi.on("session_shutdown", () => {
		active = false;
		stopListeningForUserAgentRunSettled();
		controller?.shutdown();
		controller = undefined;
		sessionContext = undefined;
	});
}

export default async function piStuffSessionNaming(pi: ExtensionAPI): Promise<void> {
	installSessionNamingCapability(pi, await loadSessionNamingSettings());
}
