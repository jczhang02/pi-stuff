import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";
import { createRtkProjectionAdapter } from "./projection.js";
import { createRtkDialogView } from "./rtk-dialog.js";
import { createRtkSettingsView } from "./rtk-settings-dialog.js";
import { RtkRuntime } from "./runtime.js";
import { RtkSettingsStore } from "./settings.js";

export {
	type ContextProjectionAdapter,
	createRtkProjectionAdapter,
	RtkProjectionAdapter,
	type RtkProjectionOptions,
	type RtkProjectionStatsSnapshot,
} from "./projection.js";
export {
	CERTIFIED_RTK_LINUX_X64_SHA256,
	CERTIFIED_RTK_LINUX_X64_SHA256S,
	CERTIFIED_RTK_OFFICIAL_LINUX_X64_SHA256,
	CERTIFIED_RTK_VERSION,
	RtkRuntime,
	type RtkRuntimeOptions,
	type RtkRuntimeSnapshot,
	type RtkRuntimeState,
} from "./runtime.js";
export { type RtkSettings, RtkSettingsStore } from "./settings.js";

export default async function piStuffRtk(pi: ExtensionAPI): Promise<void> {
	const dialogs = getCommandDialogCoordinator(pi);
	const settings = await RtkSettingsStore.load();
	const runtime = new RtkRuntime();
	const projection = createRtkProjectionAdapter({ enabled: () => settings.get().outputProjection });
	pi.on("tool_call", async (event, ctx) => {
		if (!settings.get().rewriteCommands || !isToolCallEventType("bash", event)) return;
		const rewritten = await runtime.rewrite(pi, event.input.command, ctx.signal);
		if (rewritten) event.input.command = rewritten;
	});

	pi.on("context", (event, ctx) => {
		const messages = projection.project(event.messages, ctx.signal);
		return messages === event.messages ? undefined : { messages };
	});

	pi.registerCommand("rtk", {
		description: "Inspect RTK runtime and model-context savings",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/rtk requires interactive TUI mode.", "warning");
				return;
			}
			const action = args.trim().toLowerCase();
			let note: string | undefined;
			if (action === "settings") {
				await dialogs.show(
					ctx,
					createRtkSettingsView(settings, {
						onPersistenceError: (message) => ctx.ui.notify(message, "error"),
					}),
				);
				return;
			}
			if (!action || action === "status" || action === "verify") {
				await runtime.verify(pi, { refresh: true, signal: ctx.signal });
			} else if (action === "clear-stats") {
				projection.reset();
				note = "Projection statistics cleared.";
			} else if (action === "help") {
				note = "/rtk [status|settings|verify|stats|clear-stats|help]";
			} else if (action !== "stats") {
				note = `Unknown action: ${action}`;
			}
			await dialogs.show(ctx, createRtkDialogView({ note, projection, runtime, settings }));
		},
	});

	pi.on("session_start", () => {
		runtime.reset();
		projection.reset();
	});
	pi.on("session_tree", () => projection.reset());
	pi.on("session_shutdown", async () => {
		await settings.whenIdle();
	});
}
