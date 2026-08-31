import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS } from "../lifecycle-deadline.js";
import { type EffectFoundation, installEffectFoundation } from "../shared/effect-foundation.js";
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
	CERTIFIED_RTK_VERSION,
	RtkRuntime,
	type RtkRuntimeOptions,
	type RtkRuntimeSnapshot,
	type RtkRuntimeState,
} from "./runtime.js";
export { type RtkSettings, RtkSettingsStore } from "./settings.js";

async function runRtkOperation<Value, ErrorType>(
	foundation: EffectFoundation,
	program: Effect.Effect<Value, ErrorType>,
	signal?: AbortSignal,
): Promise<Value | undefined> {
	const session = foundation.currentSession();
	if (!session) return undefined;
	const operation = foundation.forkOperation(session);
	const exit = await foundation.run(operation, program, { signal });
	await foundation.close(operation, exit);
	if (Exit.isFailure(exit)) {
		if (Cause.hasInterrupts(exit.cause)) return undefined;
		throw Cause.squash(exit.cause);
	}
	return foundation.isCurrent(session) ? exit.value : undefined;
}

export default async function piStuffRtk(pi: ExtensionAPI): Promise<void> {
	const foundation = installEffectFoundation(pi);
	const dialogs = getCommandDialogCoordinator(pi);
	const settings = await Effect.runPromise(RtkSettingsStore.load());
	const runtime = new RtkRuntime();
	const projection = createRtkProjectionAdapter({ enabled: () => settings.get().outputProjection });
	pi.on("tool_call", async (event, ctx) => {
		if (!settings.get().rewriteCommands || !isToolCallEventType("bash", event)) return;
		const rewritten = await runRtkOperation(foundation, runtime.rewrite(pi, event.input.command), ctx.signal);
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
					createRtkSettingsView(
						settings,
						{
							setOutputProjection: async (enabled) => {
								await runRtkOperation(foundation, settings.setOutputProjection(enabled));
							},
							setRewriteCommands: async (enabled) => {
								await runRtkOperation(foundation, settings.setRewriteCommands(enabled));
							},
						},
						{ onPersistenceError: (message) => ctx.ui.notify(message, "error") },
					),
				);
				return;
			}
			if (!action || action === "status" || action === "verify") {
				await runRtkOperation(foundation, runtime.verify(pi, { refresh: true }), ctx.signal);
			} else if (action === "clear-stats") {
				projection.reset();
				note = "Projection statistics cleared.";
			} else if (action === "help") {
				note = "/rtk [status|settings|verify|stats|clear-stats|help]";
			} else if (action !== "stats") {
				note = `Unknown action: ${action}`;
			}
			const dialogOptions = { projection, runtime, settings };
			await dialogs.show(ctx, createRtkDialogView(note === undefined ? dialogOptions : { ...dialogOptions, note }));
		},
	});

	pi.on("session_start", () => {
		runtime.reset();
		projection.reset();
	});
	pi.on("session_tree", () => projection.reset());
	pi.on("session_shutdown", async () => {
		await Effect.runPromise(settings.whenIdle().pipe(Effect.timeoutOption(HOST_SHUTDOWN_GRACE_MS), Effect.asVoid));
	});
}
