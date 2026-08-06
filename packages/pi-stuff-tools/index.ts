import {
	type ExtensionAPI,
	type ExtensionContext,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { ensureUiSettingsCommand, getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import { registerBuiltins, resolveBuiltinHostSettings } from "./builtin-tools.js";
import { installToolUiRuntime } from "./contract.js";
import { consumeResumeToolHandoff, prepareResumeToolHandoff, restoreResumeActiveToolOrder } from "./session-handoff.js";
import { ToolUiSettingsStore } from "./settings.js";
import { createToolDialogView } from "./tool-dialog.js";

const BUILTIN_TOOL_NAMES = new Set(["bash", "edit", "find", "grep", "ls", "read", "write"]);

function currentTranscriptMessages(ctx: ExtensionContext): unknown[] {
	return ctx.sessionManager.getBranch().flatMap(sessionEntryToContextMessages);
}

export {
	activityKey,
	activityTarget,
	classifyBashActivity,
	singleActivity,
	type ToolActivityCategory,
	type ToolActivityClassifierInput,
	type ToolActivityItem,
	type ToolActivityMetadata,
} from "./activity.js";
export {
	assertSuiteToolActivityCoverage,
	createSuiteToolRegistrationTracker,
	getToolUiRuntime,
	registerSuiteOwnedTool,
	registerSuiteToolActivityMetadata,
	type SuiteToolPresentation,
	type ToolActivityGroupView,
	ToolUiRuntime,
} from "./contract.js";
export { sanitizeTerminalText } from "./render.js";

export default async function piStuffTools(pi: ExtensionAPI): Promise<void> {
	const resumeHandoff = consumeResumeToolHandoff();
	if (resumeHandoff !== undefined) {
		// Pi reconstructs a replaced session before session_start. Register only
		// the outgoing active built-ins so historical rows get compact renderers
		// without reviving disabled built-ins in the incoming runtime.
		registerBuiltins(
			pi,
			process.cwd(),
			resolveBuiltinHostSettings(process.cwd(), false),
			{},
			new Set(resumeHandoff.builtinNames),
		);
	}
	const settings = await ToolUiSettingsStore.load();
	const runtime = installToolUiRuntime(pi, settings);
	const unsubscribeSettings = settings.subscribe(() => runtime.syncTimers());
	const unregisterUiSetting = ensureUiSettingsCommand(pi).register({
		description: "Show elapsed time while long-running tools work",
		get: () => String(settings.get().liveElapsed),
		id: "toolRunningTimer",
		label: "Tool running timer",
		order: 50,
		set: async (value) => {
			if (value !== "true" && value !== "false") throw new Error(`Invalid toolRunningTimer value: ${value}`);
			await settings.setLiveElapsed(value === "true");
		},
		subscribe: (listener) => settings.subscribe(() => listener()),
		values: ["true", "false"],
	});
	if (runtime.hasReloadSnapshot()) {
		// During /reload, Pi rebuilds historical components before session_start.
		// A bounded snapshot lets us install safe renderers for that rebuild; the
		// exact active-tool set is restored as soon as the new runtime is bound.
		registerBuiltins(pi, process.cwd(), resolveBuiltinHostSettings(process.cwd(), false));
	}

	pi.registerCommand("tools", {
		description: "Inspect current-session Tool operations",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/tools requires interactive TUI mode.", "warning");
				return;
			}
			const requestedId = args.trim();
			if (requestedId) {
				const resolved = runtime.resolveGroup(requestedId);
				if (resolved === "ambiguous") {
					ctx.ui.notify(`More than one Tool Activity Group matches ${requestedId}.`, "warning");
					return;
				}
				if (!resolved) {
					ctx.ui.notify(`No current-session Tool Activity Group matches ${requestedId}.`, "warning");
					return;
				}
			}

			await getCommandDialogCoordinator(pi).show(ctx, createToolDialogView(runtime, requestedId || undefined));
		},
	});

	pi.on("session_start", (_event, ctx) => {
		registerBuiltins(pi, ctx.cwd, resolveBuiltinHostSettings(ctx.cwd, ctx.isProjectTrusted()));
		if (resumeHandoff) {
			pi.setActiveTools(restoreResumeActiveToolOrder(pi.getActiveTools(), resumeHandoff));
		} else {
			const restoreActiveBuiltins = runtime.consumeReloadActiveTools();
			if (restoreActiveBuiltins) {
				const activeNonBuiltins = pi.getActiveTools().filter((name) => !BUILTIN_TOOL_NAMES.has(name));
				pi.setActiveTools([...activeNonBuiltins, ...restoreActiveBuiltins]);
			}
		}
		runtime.resetProjection(currentTranscriptMessages(ctx));
	});
	pi.on("session_compact", (_event, ctx) => {
		runtime.resetProjection(currentTranscriptMessages(ctx));
	});
	pi.on("session_tree", (_event, ctx) => {
		runtime.resetProjection(currentTranscriptMessages(ctx));
	});
	pi.on("input", () => {
		runtime.observeUserBoundary();
	});
	pi.on("agent_start", () => {
		runtime.startTurn();
	});
	pi.on("message_update", (event) => {
		if (
			event.message.role === "assistant" &&
			event.message.content.some((block) => block.type === "text" && block.text.trim().length > 0)
		) {
			runtime.observeAssistantProse();
		}
	});
	pi.on("message_end", (event) => {
		if (
			event.message.role === "assistant" ||
			event.message.role === "toolResult" ||
			event.message.role === "custom"
		) {
			runtime.indexMessage(event.message);
		}
	});
	pi.on("agent_end", () => {
		runtime.endTurn();
	});
	pi.on("session_shutdown", async (event) => {
		await settings.whenIdle();
		unsubscribeSettings();
		unregisterUiSetting();
		if (event.reason === "reload") {
			runtime.prepareReload(pi.getActiveTools().filter((name) => BUILTIN_TOOL_NAMES.has(name)));
		} else {
			if (event.reason === "resume") {
				prepareResumeToolHandoff(pi.getActiveTools());
			}
			// Pi can emit session_shutdown while rebuilding the current transcript
			// for tree navigation. Keep the display projection available to the
			// surviving Tool components; the next session_start replaces it.
			runtime.suspend();
		}
	});
}
