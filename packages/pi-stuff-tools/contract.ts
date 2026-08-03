import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { type ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	buildToolDetailLines,
	CachedToolRow,
	capDetailLines,
	classifyTerminalState,
	EmptyToolComponent,
	oneLine,
	type ToolRowModel,
} from "./render.js";
import { ToolUiSettingsStore } from "./settings.js";

export type ToolTranscriptMode = "errors-only" | "hidden" | "normal";

export interface SuiteToolPresentation<TArgs extends Record<string, unknown>, TDetails> {
	readonly detailLines?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => readonly string[];
	readonly label?: string | ((args: Readonly<TArgs>) => string);
	readonly runningSummary?: string | ((args: Readonly<TArgs>, durationMs: number) => string);
	readonly resultIsError?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean;
	readonly summarize?: (
		args: Readonly<TArgs>,
		result: AgentToolResult<TDetails>,
		state: Exclude<ToolActivityState, "running">,
		/** Undefined when Pi is replaying a historical row rather than executing it live. */
		durationMs: number | undefined,
	) => string;
	readonly target?: (args: Readonly<TArgs>) => string;
	/** Opt into one-second running-row invalidation because runningSummary displays duration. */
	readonly tracksElapsed?: boolean;
	readonly transcript?: ToolTranscriptMode;
}

interface ToolRendererState<TArgs extends Record<string, unknown>> {
	args?: Readonly<TArgs>;
	endedAt?: number;
	liveExecutionObserved?: boolean;
	model?: ToolRowModel;
	row?: CachedToolRow;
	settled?: boolean;
	startedAt?: number;
}

interface RendererContext<TArgs extends Record<string, unknown>> {
	readonly args: TArgs;
	readonly executionStarted: boolean;
	readonly invalidate: () => void;
	readonly isError: boolean;
	readonly lastComponent: import("@earendil-works/pi-tui").Component | undefined;
	readonly state: ToolRendererState<TArgs>;
	readonly toolCallId: string;
}

interface RuntimeTimer {
	id: ReturnType<typeof setInterval> | undefined;
	readonly invalidate: () => void;
}

export class ToolUiRuntime {
	readonly activities = new ToolActivityStore();
	private reloadActiveToolNames: readonly string[] | undefined;
	private settingsStore: ToolUiSettingsStore;
	private readonly timers = new Map<string, RuntimeTimer>();

	constructor(settings = ToolUiSettingsStore.memory()) {
		this.settingsStore = settings;
	}

	get settings(): ToolUiSettingsStore {
		return this.settingsStore;
	}

	/** Keep one runtime identity when Suite packages load before the Tool package. */
	configure(settings: ToolUiSettingsStore): void {
		for (const timer of this.timers.values()) {
			if (timer.id !== undefined) clearInterval(timer.id);
		}
		this.timers.clear();
		this.settingsStore = settings;
	}

	consumeReloadActiveTools(): readonly string[] | undefined {
		const names = this.reloadActiveToolNames;
		this.reloadActiveToolNames = undefined;
		return names;
	}

	hasReloadSnapshot(): boolean {
		return this.reloadActiveToolNames !== undefined;
	}

	prepareReload(activeToolNames: readonly string[]): void {
		this.reloadActiveToolNames = [...activeToolNames];
		this.suspend();
	}

	clear(): void {
		this.suspend();
		this.activities.clear();
	}

	/** Stop repaint work while retaining the bounded session projection across /reload. */
	suspend(): void {
		for (const timer of this.timers.values()) {
			if (timer.id !== undefined) clearInterval(timer.id);
		}
		this.timers.clear();
	}

	startTimer(toolCallId: string, invalidate: () => void): void {
		let timer = this.timers.get(toolCallId);
		if (!timer) {
			timer = { id: undefined, invalidate };
			this.timers.set(toolCallId, timer);
		}
		if (!this.settingsStore.get().liveElapsed || timer.id !== undefined) return;
		timer.id = setInterval(() => timer?.invalidate(), 1_000);
		timer.id.unref?.();
	}

	stopTimer(toolCallId: string): void {
		const timer = this.timers.get(toolCallId);
		if (!timer) return;
		if (timer.id !== undefined) clearInterval(timer.id);
		this.timers.delete(toolCallId);
	}

	syncTimers(): void {
		const enabled = this.settingsStore.get().liveElapsed;
		for (const timer of this.timers.values()) {
			if (timer.id !== undefined) clearInterval(timer.id);
			timer.id = undefined;
			if (enabled) {
				timer.id = setInterval(() => timer.invalidate(), 1_000);
				timer.id.unref?.();
			}
			timer.invalidate();
		}
	}
}

const RUNTIME_REGISTRY = Symbol.for("@jczhang02/pi-stuff-tools/runtime/v1");

function runtimeRegistry(): WeakMap<ExtensionAPI["events"], ToolUiRuntime> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], ToolUiRuntime> | undefined;
	};
	root[RUNTIME_REGISTRY] ??= new WeakMap();
	return root[RUNTIME_REGISTRY];
}

export function getToolUiRuntime(pi: ExtensionAPI): ToolUiRuntime {
	const registry = runtimeRegistry();
	const existing = registry.get(pi.events);
	if (existing) return existing;
	const runtime = new ToolUiRuntime();
	registry.set(pi.events, runtime);
	return runtime;
}

export function installToolUiRuntime(pi: ExtensionAPI, settings: ToolUiSettingsStore): ToolUiRuntime {
	const runtime = getToolUiRuntime(pi);
	runtime.configure(settings);
	return runtime;
}

function presentationLabel<TArgs extends Record<string, unknown>, TDetails>(
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	fallback: string,
	args: Readonly<TArgs>,
): string {
	const value = typeof presentation.label === "function" ? presentation.label(args) : presentation.label;
	return oneLine(value ?? fallback) || fallback;
}

function runningSummary<TArgs extends Record<string, unknown>, TDetails>(
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	runtime: ToolUiRuntime,
	args: Readonly<TArgs>,
	durationMs: number,
): string {
	if (presentation.tracksElapsed === true && !runtime.settings.get().liveElapsed) return "running";
	const value =
		typeof presentation.runningSummary === "function"
			? presentation.runningSummary(args, durationMs)
			: presentation.runningSummary;
	return oneLine(value ?? "running") || "running";
}

function visibleFor(mode: ToolTranscriptMode, state: ToolActivityState): boolean {
	if (mode === "hidden") return false;
	if (mode === "errors-only") return state !== "running" && state !== "success";
	return true;
}

function updateRunningRow<TArgs extends Record<string, unknown>, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	runtime: ToolUiRuntime,
	args: Readonly<TArgs>,
	theme: Theme,
	context: RendererContext<TArgs>,
): CachedToolRow {
	const state = context.state;
	if (state.settled && state.row) return state.row;
	if (context.executionStarted && state.liveExecutionObserved !== true) {
		state.liveExecutionObserved = true;
		state.startedAt = Date.now();
	}
	state.args = args;
	const durationMs = state.startedAt === undefined ? 0 : Math.max(0, Date.now() - state.startedAt);
	const model: ToolRowModel = {
		durationMs,
		label: presentationLabel(presentation, tool.label, args),
		state: "running",
		summary: runningSummary(presentation, runtime, args, durationMs),
		target: oneLine(presentation.target?.(args) ?? ""),
	};
	state.model = model;
	state.row ??=
		context.lastComponent instanceof CachedToolRow ? context.lastComponent : new CachedToolRow(theme, model);
	state.row.setModel(model);
	state.row.setVisible(visibleFor(presentation.transcript ?? "normal", "running"));
	runtime.activities.begin({
		id: context.toolCallId,
		label: model.label,
		name: tool.name,
		...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
		target: model.target,
	});
	if (context.executionStarted && presentation.tracksElapsed === true) {
		runtime.startTimer(context.toolCallId, context.invalidate);
	}
	return state.row;
}

function settleRow<TArgs extends Record<string, unknown>, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	runtime: ToolUiRuntime,
	result: AgentToolResult<TDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: RendererContext<TArgs>,
): void {
	if (options.isPartial || context.state.settled) return;
	const state = context.state;
	const args = (state.args ?? context.args) as Readonly<TArgs>;
	if (context.executionStarted && state.liveExecutionObserved !== true) {
		state.liveExecutionObserved = true;
		state.startedAt = Date.now();
	}
	const endedAt = state.liveExecutionObserved === true ? Date.now() : undefined;
	if (endedAt !== undefined) state.endedAt = endedAt;
	const measuredDurationMs =
		state.startedAt === undefined || endedAt === undefined ? undefined : Math.max(0, endedAt - state.startedAt);
	const durationMs = measuredDurationMs ?? runtime.activities.get(context.toolCallId)?.durationMs;
	const presentationError = presentation.resultIsError?.(args, result) ?? false;
	const terminalState = classifyTerminalState(result, context.isError || presentationError);
	const fallbackSummary = terminalState === "success" ? "done" : terminalState;
	const summary = oneLine(presentation.summarize?.(args, result, terminalState, durationMs) ?? fallbackSummary);
	const model: ToolRowModel = {
		durationMs,
		label: presentationLabel(presentation, tool.label, args),
		state: terminalState,
		summary: summary || fallbackSummary,
		target: oneLine(presentation.target?.(args) ?? ""),
	};
	state.model = model;
	state.row ??= new CachedToolRow(theme, model);
	state.row.setModel(model);
	state.row.setVisible(visibleFor(presentation.transcript ?? "normal", terminalState));
	state.settled = true;
	runtime.stopTimer(context.toolCallId);
	const detailLines = capDetailLines(presentation.detailLines?.(args, result) ?? buildToolDetailLines(args, result));
	runtime.activities.settle(context.toolCallId, {
		detailLines,
		durationMs,
		state: terminalState,
		summary: model.summary,
	});
	context.invalidate();
}

/** Decorate only presentation slots; schema, prompt metadata and execute stay referentially intact. */
export function registerSuiteOwnedTool<TParams extends TSchema, TDetails = unknown, TOriginalState = unknown>(
	pi: ExtensionAPI,
	tool: ToolDefinition<TParams, TDetails, TOriginalState>,
	presentation: SuiteToolPresentation<Static<TParams> & Record<string, unknown>, TDetails> = {},
): void {
	type Args = Static<TParams> & Record<string, unknown>;
	const runtime = getToolUiRuntime(pi);
	const decorated: ToolDefinition<TParams, TDetails, ToolRendererState<Args>> = {
		...tool,
		renderShell: "self",
		renderCall: (args, theme, context) =>
			updateRunningRow(
				tool as unknown as ToolDefinition<TSchema, TDetails>,
				presentation,
				runtime,
				args as Args,
				theme,
				context,
			),
		renderResult: (result, options, theme, context) => {
			settleRow(
				tool as unknown as ToolDefinition<TSchema, TDetails>,
				presentation,
				runtime,
				result,
				options,
				theme,
				context,
			);
			return new EmptyToolComponent();
		},
	};
	pi.registerTool(decorated);
}
