import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import { getCurrentWorkSources } from "./src/current-work.js";
import { type BackgroundWorkOutcome, BackgroundWorkRuntime } from "./src/runtime.js";
import { reconcileStaleRuns } from "./src/storage.js";
import { createTasksDialogView } from "./src/tasks-dialog.js";
import { registerWorkTools, type WorkToolRuntimeRef } from "./src/tools.js";

export {
	type CurrentWorkProjectionItem,
	type CurrentWorkProjectionStatus,
	type CurrentWorkSource,
	CurrentWorkSources,
	getCurrentWorkSources,
	registerCurrentWorkSource,
} from "./src/current-work.js";
export {
	type BackgroundWorkKind,
	type BackgroundWorkOutcome,
	BackgroundWorkRuntime,
	type BackgroundWorkSnapshot,
	type BackgroundWorkStatus,
	type BackgroundWorkTerminalStatus,
} from "./src/runtime.js";
export { type ReconciliationResult, reconcileStaleRuns, WorkRunStorage } from "./src/storage.js";

const COMPLETION_MESSAGE_TYPE = "pi-stuff-background-work-result";

interface CompletionDetails {
	readonly outcomes?: readonly BackgroundWorkOutcome[];
}

function registerCompletionRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<CompletionDetails>(COMPLETION_MESSAGE_TYPE, (message, _options, theme) => {
		const outcomes = message.details?.outcomes ?? [];
		if (outcomes.length === 0) return new Text(theme.fg("dim", "Background work updated."), 0, 0);
		const lines = outcomes.map((outcome) => {
			const color = outcome.status === "completed" ? "success" : outcome.status === "stopped" ? "dim" : "error";
			return `${theme.fg(color, "●")} ${theme.fg("muted", outcome.summary)}`;
		});
		return new Text(lines.join("\n"), 0, 0);
	});
}

function hostSettings(ctx: ExtensionContext): { readonly commandPrefix?: string; readonly shellPath?: string } {
	const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
	const commandPrefix = settings.getShellCommandPrefix();
	const shellPath = settings.getShellPath();
	return {
		...(commandPrefix !== undefined ? { commandPrefix } : {}),
		...(shellPath !== undefined ? { shellPath } : {}),
	};
}

export default async function piStuffWork(pi: ExtensionAPI): Promise<void> {
	let runtime: BackgroundWorkRuntime | undefined;
	let removeTerminalInput: (() => void) | undefined;
	const runtimeRef: WorkToolRuntimeRef = { current: () => runtime };
	const sources = getCurrentWorkSources(pi);
	const dialogs = getCommandDialogCoordinator(pi);

	// Install renderers before session replay. The session_start registration runs
	// after Pi Stuff Tools and reclaims Bash execution for the live session.
	registerCompletionRenderer(pi);
	registerWorkTools(pi, runtimeRef, { includeBash: false });

	pi.registerCommand("tasks", {
		description: "Inspect and control current-session Background Work",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/tasks requires interactive TUI mode.", "warning");
				return;
			}
			if (!runtime) {
				ctx.ui.notify("Background Work is not available during session transition.", "warning");
				return;
			}
			await dialogs.show(ctx, createTasksDialogView(runtime, sources));
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		if (runtime) await runtime.shutdown();
		const reconciliation = await reconcileStaleRuns(ctx.cwd);
		if (reconciliation.unresolvedDirectories > 0) {
			console.warn(
				`[pi-stuff-work] left ${String(reconciliation.unresolvedDirectories)} unverified stale runtime director${reconciliation.unresolvedDirectories === 1 ? "y" : "ies"} untouched`,
			);
		}
		const settings = hostSettings(ctx);
		runtime = new BackgroundWorkRuntime({
			...settings,
			cwd: ctx.cwd,
			pi,
			sessionId: ctx.sessionManager.getSessionId(),
		});
		registerWorkTools(pi, runtimeRef);
		if (ctx.mode === "tui") {
			removeTerminalInput = ctx.ui.onTerminalInput((data) => {
				if (isKeyRelease(data) || !matchesKey(data, Key.ctrl("b"))) return undefined;
				return runtime?.detachActiveForeground() ? { consume: true } : undefined;
			});
		}
	});

	pi.on("session_shutdown", async () => {
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		const active = runtime;
		runtime = undefined;
		if (active) await active.shutdown();
	});
}
