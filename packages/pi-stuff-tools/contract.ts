import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
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
	/** Optional settled content below the shared lifecycle row, for media that cannot be reduced to text. */
	readonly resultBody?: (
		args: Readonly<TArgs>,
		result: AgentToolResult<TDetails>,
		options: ToolRenderResultOptions,
		theme: Theme,
	) => Component | undefined;
	readonly summarize?: (
		args: Readonly<TArgs>,
		result: AgentToolResult<TDetails>,
		state: Exclude<ToolActivityState, "running">,
		/** Undefined when Pi is replaying a historical row rather than executing it live. */
		durationMs: number | undefined,
	) => string;
	readonly target?: (args: Readonly<TArgs>) => string;
	/** Let runningSummary receive the live duration while the shared Tool blink tick repaints the row. */
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
	id: unknown;
	invalidate: () => void;
	markerVisible: boolean;
	setMarkerVisible: (visible: boolean) => void;
}

export interface ToolUiTimerScheduler {
	clearInterval(id: unknown): void;
	setInterval(callback: () => void, delayMs: number): unknown;
}

const TOOL_BLINK_INTERVAL_MS = 600;

const SYSTEM_TIMER_SCHEDULER: ToolUiTimerScheduler = {
	clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
	setInterval: (callback, delayMs) => {
		const id = setInterval(callback, delayMs);
		id.unref?.();
		return id;
	},
};

export class ToolUiRuntime {
	readonly activities = new ToolActivityStore();
	private readonly scheduler: ToolUiTimerScheduler;
	private reloadActiveToolNames: readonly string[] | undefined;
	private settingsStore: ToolUiSettingsStore;
	private readonly timers = new Map<string, RuntimeTimer>();

	constructor(settings = ToolUiSettingsStore.memory(), scheduler = SYSTEM_TIMER_SCHEDULER) {
		this.settingsStore = settings;
		this.scheduler = scheduler;
	}

	get settings(): ToolUiSettingsStore {
		return this.settingsStore;
	}

	/** Keep one runtime identity when Suite packages load before the Tool package. */
	configure(settings: ToolUiSettingsStore): void {
		this.stopAllTimers();
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
		this.stopAllTimers();
	}

	startTimer(
		toolCallId: string,
		invalidate: () => void,
		setMarkerVisible: (visible: boolean) => void = () => {},
	): void {
		let timer = this.timers.get(toolCallId);
		if (timer) {
			timer.invalidate = invalidate;
			timer.setMarkerVisible = setMarkerVisible;
			timer.setMarkerVisible(timer.markerVisible);
			return;
		}

		timer = {
			id: undefined,
			invalidate,
			markerVisible: true,
			setMarkerVisible,
		};
		this.timers.set(toolCallId, timer);
		const activeTimer = timer;
		activeTimer.id = this.scheduler.setInterval(() => {
			if (this.timers.get(toolCallId) !== activeTimer) return;
			activeTimer.markerVisible = !activeTimer.markerVisible;
			activeTimer.setMarkerVisible(activeTimer.markerVisible);
			activeTimer.invalidate();
		}, TOOL_BLINK_INTERVAL_MS);
	}

	stopTimer(toolCallId: string): void {
		const timer = this.timers.get(toolCallId);
		if (!timer) return;
		this.timers.delete(toolCallId);
		this.scheduler.clearInterval(timer.id);
		timer.setMarkerVisible(true);
	}

	syncTimers(): void {
		for (const timer of this.timers.values()) timer.invalidate();
	}

	private stopAllTimers(): void {
		const timers = [...this.timers.values()];
		this.timers.clear();
		for (const timer of timers) {
			this.scheduler.clearInterval(timer.id);
			timer.setMarkerVisible(true);
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
	const visible = visibleFor(presentation.transcript ?? "normal", "running");
	state.row.setVisible(visible);
	runtime.activities.begin({
		id: context.toolCallId,
		label: model.label,
		name: tool.name,
		...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
		target: model.target,
	});
	if (context.executionStarted && visible)
		runtime.startTimer(context.toolCallId, context.invalidate, (markerVisible) =>
			state.row?.setMarkerVisible(markerVisible),
		);
	else runtime.stopTimer(context.toolCallId);
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
	// renderResult runs inside Pi's synchronous ToolExecutionComponent update.
	// Invalidating from here re-enters that update before the outer render has
	// appended its result body, causing the body to be appended twice. The shared
	// row is already mutated in place and Pi requests a render after the tool event.
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
			const args = (context.state.args ?? context.args) as Readonly<Args>;
			settleRow(
				tool as unknown as ToolDefinition<TSchema, TDetails>,
				presentation,
				runtime,
				result,
				options,
				theme,
				context,
			);
			return (
				(options.isPartial ? undefined : presentation.resultBody?.(args, result, options, theme)) ??
				new EmptyToolComponent()
			);
		},
	};
	pi.registerTool(decorated);
}
