import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { createRtkProjectionAdapter } from "./projection.js";
import { createRtkDialogView } from "./rtk-dialog.js";
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
		description: "Inspect and configure RTK",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/rtk requires interactive TUI mode.", "warning");
				return;
			}
			if (args.trim()) {
				ctx.ui.notify("/rtk takes no subcommands; run /rtk.", "warning");
				return;
			}
			await dialogs.show(
				ctx,
				createRtkDialogView({
					onPersistenceError: (message) => ctx.ui.notify(message, "error"),
					projection,
					runtime,
					settings,
					verify: async (signal) => {
						await runtime.verify(pi, { refresh: true, signal });
					},
				}),
			);
		},
	});

	pi.on("session_start", () => {
		runtime.reset();
		projection.reset();
	});
	pi.on("session_tree", () => projection.reset());
	pi.on("session_shutdown", async () => {
		await settleWithin(settings.whenIdle(), HOST_SHUTDOWN_GRACE_MS);
	});
}
