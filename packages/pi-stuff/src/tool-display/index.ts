import {
	type ExtensionAPI,
	type ExtensionContext,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import {
	ensureUiSettingsCommand,
	getCommandDialogCoordinator,
	getHostSharedResource,
} from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { registerBuiltins, resolveBuiltinHostSettings } from "./builtin-tools.js";
import { installToolUiRuntime, registerHistoricalSuiteToolDefinitions } from "./contract.js";
import { consumeResumeToolHandoff, prepareResumeToolHandoff, restoreResumeActiveToolOrder } from "./session-handoff.js";
import { ToolUiSettingsStore } from "./settings.js";
import { createToolDialogView } from "./tool-dialog.js";

const BUILTIN_TOOL_NAMES = new Set(["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"]);
const TOOL_LIFECYCLE_STATES = Symbol.for("@jczhang02/pi-stuff-tools/lifecycle-states/v1");
const TOOL_LIFECYCLE_DISCOVERY_EVENT = "@jczhang02/pi-stuff-tools/lifecycle-discovery/v1";

interface ToolLifecycleState {
	active: boolean;
	activation?: symbol;
}

function toolLifecycleStates(): WeakMap<object, ToolLifecycleState> {
	const existing = Object.getOwnPropertyDescriptor(globalThis, TOOL_LIFECYCLE_STATES)?.value;
	if (existing instanceof WeakMap) return existing;
	const created = new WeakMap<object, ToolLifecycleState>();
	Object.defineProperty(globalThis, TOOL_LIFECYCLE_STATES, {
		configurable: true,
		value: created,
		writable: true,
	});
	return created;
}

function releaseToolLifecycle(state: ToolLifecycleState, activation: symbol): void {
	if (state.activation !== activation) return;
	state.active = false;
	delete state.activation;
}

interface CurrentTranscript {
	readonly messages: readonly unknown[];
	readonly toolNames: ReadonlySet<string>;
}

function currentTranscript(ctx: ExtensionContext): CurrentTranscript {
	const messages: unknown[] = [];
	const toolNames = new Set<string>();
	for (const entry of ctx.sessionManager.getBranch()) {
		for (const message of sessionEntryToContextMessages(entry)) {
			messages.push(message);
			if (message.role !== "assistant") continue;
			for (const part of message.content) {
				if (part.type === "toolCall") toolNames.add(part.name);
			}
		}
	}
	return { messages, toolNames };
}

export {
	activityKey,
	activityTarget,
	bashResultMovedToBackground,
	classifyBashActivity,
	classifyBashRetrievalActivity,
	classifyToolActivityGroupInvocation,
	singleActivity,
	type ToolActivityCategory,
	type ToolActivityClassifierInput,
	type ToolActivityGroupDisposition,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolArguments,
} from "./activity.js";
export { BASH_CODE_MODE_CONTRACT } from "./builtin-tools.js";
export {
	assertSuiteToolActivityCoverage,
	configureSuiteToolReplay,
	createSuiteToolRegistrationTracker,
	getToolUiRuntime,
	registerHistoricalSuiteToolDefinitions,
	registerSuiteOwnedTool,
	registerSuiteToolActivityMetadata,
	registerSuiteToolEnvelope,
	registerSuiteToolEnvelopeCompanion,
	type SuiteToolCatalogEntry,
	type SuiteToolCodeModeContract,
	type SuiteToolCodeModeExecutionEndStatus,
	type SuiteToolCodeModeLifecycle,
	type SuiteToolCodeModePassEndStatus,
	type SuiteToolDefinitionRegistry,
	type SuiteToolEnvelopeOperation,
	type SuiteToolInvocation,
	type SuiteToolInvocationResult,
	type SuiteToolPresentation,
	type SuiteToolRegistrationHost,
	type SuiteToolRegistrationTracker,
	type SuiteToolReplayDefinition,
	type SuiteToolSurfaceController,
	type SuiteToolTrackerHost,
	type ToolActivityDetailMode,
	type ToolActivityDetailView,
	type ToolActivityGroupView,
	ToolUiRuntime,
	type ToolUiRuntimeHost,
} from "./contract.js";
export { CachedToolRow, formatElapsed } from "./render.js";
export {
	boundTerminalLine,
	boundTerminalText,
	compactTerminalPath,
	graphemePrefix,
	sanitizeTerminalText,
} from "./terminal.js";

export default async function piStuffTools(pi: ExtensionAPI): Promise<void> {
	const lifecycle = getHostSharedResource<ToolLifecycleState>(
		pi.events,
		toolLifecycleStates(),
		TOOL_LIFECYCLE_DISCOVERY_EVENT,
		() => ({ active: false }),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	if (lifecycle.active) return;
	const activation = Symbol("tool-display-lifecycle");
	lifecycle.active = true;
	lifecycle.activation = activation;
	try {
		const resumeHandoff = consumeResumeToolHandoff();
		const settings = await ToolUiSettingsStore.load();
		const runtime = installToolUiRuntime(pi, settings);
		if (resumeHandoff) runtime.stageResumeToolDefinitions(resumeHandoff.toolDefinitions);
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
			const transcript = currentTranscript(ctx);
			const replayOnlyNames = new Set(runtime.replayOnlyTools());
			registerBuiltins(pi, ctx.cwd, resolveBuiltinHostSettings(ctx.cwd, ctx.isProjectTrusted()));
			let restoredActiveTools: readonly string[] | undefined;
			if (resumeHandoff) {
				restoredActiveTools = restoreResumeActiveToolOrder(
					pi.getActiveTools().filter((name) => !replayOnlyNames.has(name)),
					resumeHandoff,
				);
			} else {
				const restoreActiveBuiltins = runtime.consumeReloadActiveTools();
				if (restoreActiveBuiltins) {
					const activeNonBuiltins = pi
						.getActiveTools()
						.filter((name) => !BUILTIN_TOOL_NAMES.has(name) && !replayOnlyNames.has(name));
					restoredActiveTools = [...activeNonBuiltins, ...restoreActiveBuiltins];
				}
			}
			const activeToolsBeforeReplay = restoredActiveTools ?? pi.getActiveTools();
			const registeredReplayNames = registerHistoricalSuiteToolDefinitions(pi, transcript.toolNames);
			if (restoredActiveTools || registeredReplayNames.length > 0) pi.setActiveTools([...activeToolsBeforeReplay]);
			runtime.resetProjection(transcript.messages);
		});
		pi.on("session_compact", (_event, ctx) => {
			const transcript = currentTranscript(ctx);
			const activeTools = pi.getActiveTools();
			if (registerHistoricalSuiteToolDefinitions(pi, transcript.toolNames).length > 0)
				pi.setActiveTools(activeTools);
			runtime.resetProjection(transcript.messages);
		});
		pi.on("session_tree", (_event, ctx) => {
			const transcript = currentTranscript(ctx);
			const activeTools = pi.getActiveTools();
			if (registerHistoricalSuiteToolDefinitions(pi, transcript.toolNames).length > 0)
				pi.setActiveTools(activeTools);
			runtime.resetProjection(transcript.messages);
		});
		pi.on("input", () => {
			runtime.observeUserBoundary();
		});
		pi.on("tool_execution_start", (event) => {
			if (runtime.hasActivityRenderer(event.toolName)) {
				runtime.observeToolExecutionStart(event.toolCallId);
			}
		});
		pi.on("tool_execution_update", (event) => {
			if (runtime.hasActivityRenderer(event.toolName)) {
				runtime.observeToolExecutionUpdate(event.toolCallId, event.partialResult);
			}
		});
		pi.on("tool_execution_end", (event) => {
			if (runtime.hasActivityRenderer(event.toolName)) {
				runtime.observeToolExecutionEnd(
					event.toolCallId,
					event.isError ? { ...event.result, isError: true } : event.result,
				);
			}
		});
		pi.on("agent_start", () => {
			runtime.startTurn();
		});
		pi.on("message_update", (event) => {
			runtime.observeAssistantEvent(event.assistantMessageEvent);
		});
		pi.on("message_end", (event) => {
			if (
				event.message.role === "assistant" ||
				event.message.role === "bashExecution" ||
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
			unsubscribeSettings();
			unregisterUiSetting();
			if (event.reason === "reload") {
				runtime.prepareReload(pi.getActiveTools().filter((name) => BUILTIN_TOOL_NAMES.has(name)));
			} else {
				if (event.reason === "resume") {
					prepareResumeToolHandoff(pi.getActiveTools(), runtime.resumeToolDefinitions());
				}
				// Pi can emit session_shutdown while rebuilding the current transcript
				// for tree navigation. Keep the display projection available to the
				// surviving Tool components; the next session_start replaces it.
				runtime.suspend();
			}
			releaseToolLifecycle(lifecycle, activation);
			await settleWithin(settings.whenIdle(), HOST_SHUTDOWN_GRACE_MS);
		});
	} catch (error) {
		releaseToolLifecycle(lifecycle, activation);
		throw error;
	}
}
