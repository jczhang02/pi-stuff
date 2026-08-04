import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { ensureUiSettingsCommand, getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
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
	CERTIFIED_RTK_LINUX_X64_SHA256S,
	CERTIFIED_RTK_OFFICIAL_LINUX_X64_SHA256,
	CERTIFIED_RTK_VERSION,
	RtkRuntime,
	type RtkRuntimeOptions,
	type RtkRuntimeSnapshot,
	type RtkRuntimeState,
} from "./runtime.js";
export { type RtkSettings, RtkSettingsStore } from "./settings.js";

const BOOLEAN_VALUES = ["true", "false"] as const;

function booleanSetting(value: string, id: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`Invalid ${id} value: ${value}`);
}

export default async function piStuffRtk(pi: ExtensionAPI): Promise<void> {
	const dialogs = getCommandDialogCoordinator(pi);
	const settings = await RtkSettingsStore.load();
	const runtime = new RtkRuntime();
	const projection = createRtkProjectionAdapter({ enabled: () => settings.get().outputProjection });
	const registry = ensureUiSettingsCommand(pi);
	const unregisterSettings = [
		registry.register({
			description: "Rewrite supported Bash commands through the certified RTK runtime",
			get: () => String(settings.get().rewriteCommands),
			id: "rtkRewriteCommands",
			label: "RTK command rewriting",
			order: 60,
			set: async (value) => settings.setRewriteCommands(booleanSetting(value, "rtkRewriteCommands")),
			subscribe: (listener) => settings.subscribe(() => listener()),
			values: BOOLEAN_VALUES,
		}),
		registry.register({
			description: "Compact Bash and Grep results only in model-visible context",
			get: () => String(settings.get().outputProjection),
			id: "rtkOutputProjection",
			label: "RTK output projection",
			order: 61,
			set: async (value) => settings.setOutputProjection(booleanSetting(value, "rtkOutputProjection")),
			subscribe: (listener) => settings.subscribe(() => listener()),
			values: BOOLEAN_VALUES,
		}),
	];

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
			if (!action || action === "status" || action === "verify") {
				await runtime.verify(pi, { refresh: true, signal: ctx.signal });
			} else if (action === "clear-stats") {
				projection.reset();
				note = "Projection statistics cleared.";
			} else if (action === "help") {
				note = "/rtk [status|verify|stats|clear-stats|help]";
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
		for (const unregister of unregisterSettings.splice(0)) unregister();
		await settings.whenIdle();
	});
}
