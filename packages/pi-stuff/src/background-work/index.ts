import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";
import { getCurrentWorkSources } from "./src/current-work.js";
import { type BackgroundWorkOutcome, BackgroundWorkRuntime } from "./src/runtime.js";
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

export default async function piStuffWork(
	pi: ExtensionAPI,
	options: {
		createRuntime?: (input: ConstructorParameters<typeof BackgroundWorkRuntime>[0]) => BackgroundWorkRuntime;
	} = {},
): Promise<void> {
	let runtime: BackgroundWorkRuntime | undefined;
	let removeTerminalInput: (() => void) | undefined;
	let lifecycleEpoch = 0;
	let hostActive = false;
	let transitionTail: Promise<void> = Promise.resolve();
	const createRuntime = options.createRuntime ?? ((input) => new BackgroundWorkRuntime(input));
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
			await runtime.prepare();
			await dialogs.show(ctx, createTasksDialogView(runtime, sources));
		},
	});

	const enqueueTransition = (operation: () => Promise<void>): Promise<void> => {
		const pending = transitionTail.then(operation, operation);
		transitionTail = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	};

	pi.on("session_start", async (_event, ctx) => {
		const epoch = ++lifecycleEpoch;
		hostActive = true;
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		// Detach synchronously so a concurrent shutdown cannot mistake the old
		// runtime for the new session owner while its asynchronous shutdown waits.
		const previous = runtime;
		runtime = undefined;
		await enqueueTransition(async () => {
			if (previous) await previous.shutdown();
			if (!hostActive || lifecycleEpoch !== epoch) return;
			const settings = hostSettings(ctx);
			const created = createRuntime({
				...settings,
				cwd: ctx.cwd,
				pi,
				sessionId: ctx.sessionManager.getSessionId(),
			});
			if (!hostActive || lifecycleEpoch !== epoch) {
				await created.shutdown();
				return;
			}
			runtime = created;
			registerWorkTools(pi, runtimeRef);
			if (ctx.mode === "tui") {
				removeTerminalInput = ctx.ui.onTerminalInput((data) => {
					if (isKeyRelease(data) || !matchesKey(data, Key.ctrl("b"))) return undefined;
					return runtime === created && created.detachActiveForeground() ? { consume: true } : undefined;
				});
			}
		});
	});

	pi.on("session_shutdown", async () => {
		lifecycleEpoch += 1;
		hostActive = false;
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		const active = runtime;
		runtime = undefined;
		await enqueueTransition(async () => {
			if (active) await active.shutdown();
		});
	});
}
