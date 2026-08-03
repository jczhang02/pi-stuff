import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureUiSettingsCommand, getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import { registerBuiltins, resolveBuiltinHostSettings } from "./builtin-tools.js";
import { installToolUiRuntime } from "./contract.js";
import { ToolUiSettingsStore } from "./settings.js";
import { createToolDialogView } from "./tool-dialog.js";

const BUILTIN_TOOL_NAMES = new Set(["bash", "edit", "find", "grep", "ls", "read", "write"]);

export {
	getToolUiRuntime,
	registerSuiteOwnedTool,
	type SuiteToolPresentation,
	type ToolTranscriptMode,
	ToolUiRuntime,
} from "./contract.js";

export default async function piStuffTools(pi: ExtensionAPI): Promise<void> {
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
			if (requestedId && !runtime.activities.resolve(requestedId)) {
				ctx.ui.notify(`No current-session Tool operation matches ${requestedId}.`, "warning");
				return;
			}
			await getCommandDialogCoordinator(pi).show(ctx, createToolDialogView(runtime, requestedId || undefined));
		},
	});

	pi.on("session_start", (_event, ctx) => {
		registerBuiltins(pi, ctx.cwd, resolveBuiltinHostSettings(ctx.cwd, ctx.isProjectTrusted()));
		const reloadActiveBuiltins = runtime.consumeReloadActiveTools();
		if (reloadActiveBuiltins) {
			const activeNonBuiltins = pi.getActiveTools().filter((name) => !BUILTIN_TOOL_NAMES.has(name));
			pi.setActiveTools([...activeNonBuiltins, ...reloadActiveBuiltins]);
		}
	});
	pi.on("session_compact", () => {
		runtime.clear();
	});
	pi.on("session_tree", () => {
		runtime.clear();
	});
	pi.on("session_shutdown", async (event) => {
		await settings.whenIdle();
		unsubscribeSettings();
		unregisterUiSetting();
		if (event.reason === "reload") {
			runtime.prepareReload(pi.getActiveTools().filter((name) => BUILTIN_TOOL_NAMES.has(name)));
		} else runtime.clear();
	});
}
