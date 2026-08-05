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

export type ToolGrouping<TArgs extends Record<string, unknown>> =
	| "exploration"
	| ((args: Readonly<TArgs>) => "exploration" | "standalone");

export interface SuiteToolPresentation<TArgs extends Record<string, unknown>, TDetails> {
	/** Final-result veto for an initially exploratory call (for example, a command that detached to background). */
	readonly canCollapse?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean;
	readonly detailLines?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => readonly string[];
	/** Successful adjacent calls with the same exploration contract may share one settled transcript row. */
	readonly grouping?: ToolGrouping<TArgs>;
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
	collapsible?: boolean;
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

interface GroupedRowBinding {
	args?: Readonly<Record<string, unknown>>;
	baseModel: ToolRowModel;
	baseVisible: boolean;
	collapsible: boolean;
	invalidate: () => void;
	name?: string;
	result?: AgentToolResult<unknown>;
	row: CachedToolRow;
	appliedModel?: ToolRowModel;
	appliedVisible?: boolean;
}

interface PlannedToolGroup {
	readonly leaderId: string;
	readonly memberIds: readonly string[];
}

function isCollapsibleSuccess(binding: GroupedRowBinding | undefined): binding is GroupedRowBinding {
	return Boolean(binding?.baseVisible && binding.collapsible && binding.baseModel.state === "success");
}

type GroupingPolicy = (args: Readonly<Record<string, unknown>>) => boolean;
type CollapsePolicy = (args: Readonly<Record<string, unknown>>, result: AgentToolResult<unknown>) => boolean;

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
	private readonly collapsePolicies = new Map<string, CollapsePolicy>();
	private readonly groupingPolicies = new Map<string, GroupingPolicy>();
	private readonly groups = new Map<string, PlannedToolGroup>();
	private readonly groupLeaderByMember = new Map<string, string>();
	private invalidationGeneration = 0;
	private invalidationScheduled = false;
	private indexedMessages: unknown[] = [];
	private readonly pendingInvalidations = new Set<() => void>();
	private readonly rows = new Map<string, GroupedRowBinding>();
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
		// Historical components are reconstructed before the next session_start.
		// Drop callbacks into the outgoing component tree so old and new rows
		// cannot alternately invalidate one another during that reconstruction.
		this.clearRowBindings();
	}

	clear(): void {
		this.suspend();
		this.clearRowBindings();
		this.groups.clear();
		this.groupLeaderByMember.clear();
		this.indexedMessages = [];
		this.activities.clear();
	}

	registerGrouping<TArgs extends Record<string, unknown>, TDetails = unknown>(
		name: string,
		grouping?: ToolGrouping<TArgs>,
		canCollapse?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean,
	): void {
		if (
			grouping === undefined &&
			canCollapse === undefined &&
			!this.groupingPolicies.has(name) &&
			!this.collapsePolicies.has(name)
		)
			return;
		if (grouping === undefined) {
			this.groupingPolicies.delete(name);
		} else if (grouping === "exploration") {
			this.groupingPolicies.set(name, () => true);
		} else {
			this.groupingPolicies.set(name, (args) => grouping(args as Readonly<TArgs>) === "exploration");
		}
		if (canCollapse === undefined) this.collapsePolicies.delete(name);
		else {
			this.collapsePolicies.set(name, (args, result) =>
				canCollapse(args as Readonly<TArgs>, result as AgentToolResult<TDetails>),
			);
		}
		for (const binding of this.rows.values()) {
			if (binding.name !== name || !binding.args || !binding.result) continue;
			binding.collapsible = this.collapseAllowed(name, binding.args, binding.result);
		}
		if (this.indexedMessages.length > 0) this.rebuildGroups(this.indexedMessages);
	}

	/** Rebuild display-only grouping plans from the Host's current model context before transcript replay. */
	indexMessages(messages: readonly unknown[]): void {
		this.indexedMessages = [...messages];
		this.rebuildGroups(this.indexedMessages);
	}

	private rebuildGroups(messages: readonly unknown[]): void {
		for (const binding of this.rows.values()) this.applyRow(binding, binding.baseModel, binding.baseVisible);
		this.groups.clear();
		this.groupLeaderByMember.clear();
		for (const message of messages) this.planMessageGroups(message);
		this.reconcileAllGroups();
	}

	/** Add one completed assistant message to the display-only grouping plan. */
	indexMessage(message: unknown): void {
		this.indexedMessages.push(message);
		for (const leaderId of this.planMessageGroups(message)) this.reconcileGroup(leaderId);
	}

	private planMessageGroups(message: unknown): string[] {
		if (!isRecord(message) || message["role"] !== "assistant" || !Array.isArray(message["content"])) return [];
		const leaderIds: string[] = [];
		let run: string[] = [];
		const flush = () => {
			if (run.length >= 2) {
				const leaderId = this.addGroup(run);
				if (leaderId) leaderIds.push(leaderId);
			}
			run = [];
		};
		for (const block of message["content"]) {
			const call = toolCall(block);
			if (!call || !this.isExploration(call.name, call.args)) {
				flush();
				continue;
			}
			run.push(call.id);
		}
		flush();
		return leaderIds;
	}

	presentRow(
		toolCallId: string,
		row: CachedToolRow,
		baseModel: ToolRowModel,
		baseVisible: boolean,
		invalidate: () => void,
		collapsible = true,
		metadata?: {
			readonly args: Readonly<Record<string, unknown>>;
			readonly name: string;
			readonly result: AgentToolResult<unknown>;
		},
	): boolean {
		const existing = this.rows.get(toolCallId);
		const binding: GroupedRowBinding = existing ?? { baseModel, baseVisible, collapsible, invalidate, row };
		binding.baseModel = baseModel;
		binding.baseVisible = baseVisible;
		binding.invalidate = invalidate;
		if (metadata) {
			binding.args = metadata.args;
			binding.name = metadata.name;
			binding.result = metadata.result;
			binding.collapsible = this.collapseAllowed(metadata.name, metadata.args, metadata.result);
		} else if (!binding.result) binding.collapsible = collapsible;
		binding.row = row;
		this.rows.set(toolCallId, binding);
		const leaderId = this.groupLeaderByMember.get(toolCallId);
		if (leaderId) this.reconcileGroup(leaderId);
		else this.applyRow(binding, baseModel, baseVisible);
		return binding.collapsible;
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

	private clearRowBindings(): void {
		this.invalidationGeneration += 1;
		this.invalidationScheduled = false;
		this.pendingInvalidations.clear();
		this.rows.clear();
	}

	private addGroup(memberIds: readonly string[]): string | undefined {
		if (memberIds.some((id) => this.groupLeaderByMember.has(id))) return undefined;
		const leaderId = memberIds[0];
		if (!leaderId) return undefined;
		const group = { leaderId, memberIds: [...memberIds] } as const;
		this.groups.set(leaderId, group);
		for (const id of memberIds) this.groupLeaderByMember.set(id, leaderId);
		return leaderId;
	}

	private applyRow(binding: GroupedRowBinding, model: ToolRowModel, visible: boolean): void {
		const changed = binding.appliedVisible !== visible || !sameToolRowModel(binding.appliedModel, model);
		binding.row.setModel(model);
		binding.row.setVisible(visible);
		binding.appliedModel = model;
		binding.appliedVisible = visible;
		if (changed) this.scheduleInvalidation(binding.invalidate);
	}

	private isExploration(name: string, args: Readonly<Record<string, unknown>>): boolean {
		const policy = this.groupingPolicies.get(name);
		if (!policy) return false;
		try {
			return policy(args);
		} catch {
			return false;
		}
	}

	private collapseAllowed(
		name: string,
		args: Readonly<Record<string, unknown>>,
		result: AgentToolResult<unknown>,
	): boolean {
		const policy = this.collapsePolicies.get(name);
		if (!policy) return true;
		try {
			return policy(args, result);
		} catch {
			return false;
		}
	}

	private reconcileAllGroups(): void {
		for (const leaderId of this.groups.keys()) this.reconcileGroup(leaderId);
	}

	private reconcileGroup(leaderId: string): void {
		const group = this.groups.get(leaderId);
		if (!group) return;
		const bindings = group.memberIds.map((id) => this.rows.get(id));
		const collapsed = bindings.every(isCollapsibleSuccess);
		if (!collapsed) {
			for (const binding of bindings) {
				if (binding) this.applyRow(binding, binding.baseModel, binding.baseVisible);
			}
			return;
		}
		const leader = bindings[0];
		if (!leader) return;
		this.applyRow(leader, groupedModel(bindings), true);
		for (const follower of bindings.slice(1)) this.applyRow(follower, follower.baseModel, false);
	}

	private scheduleInvalidation(invalidate: () => void): void {
		this.pendingInvalidations.add(invalidate);
		if (this.invalidationScheduled) return;
		this.invalidationScheduled = true;
		const generation = this.invalidationGeneration;
		queueMicrotask(() => {
			if (generation !== this.invalidationGeneration) return;
			this.invalidationScheduled = false;
			const invalidations = [...this.pendingInvalidations];
			this.pendingInvalidations.clear();
			for (const pending of invalidations) pending();
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCall(
	value: unknown,
): { readonly args: Readonly<Record<string, unknown>>; readonly id: string; readonly name: string } | undefined {
	if (!isRecord(value) || value["type"] !== "toolCall") return undefined;
	const id = value["id"];
	const name = value["name"];
	const args = value["arguments"];
	if (typeof id !== "string" || !id || typeof name !== "string" || !name || !isRecord(args)) return undefined;
	return { args, id, name };
}

function sameToolRowModel(left: ToolRowModel | undefined, right: ToolRowModel): boolean {
	return (
		left !== undefined &&
		left.durationMs === right.durationMs &&
		left.label === right.label &&
		left.state === right.state &&
		left.summary === right.summary &&
		left.target === right.target
	);
}

function groupedModel(bindings: readonly GroupedRowBinding[]): ToolRowModel {
	const counts = new Map<string, number>();
	let durationMs: number | undefined;
	for (const binding of bindings) {
		const label = oneLine(binding.baseModel.label) || "Tool";
		counts.set(label, (counts.get(label) ?? 0) + 1);
		const duration = binding.baseModel.durationMs;
		if (duration !== undefined) durationMs = Math.max(durationMs ?? 0, duration);
	}
	const entries = [...counts.entries()];
	const representatives = entries.slice(0, 2);
	const representedCount = representatives.reduce((total, [, count]) => total + count, 0);
	let summary = representatives.map(([label, count]) => (count > 1 ? `${label} ×${String(count)}` : label)).join(", ");
	const overflow = bindings.length - representedCount;
	if (overflow > 0) summary += `${summary ? " " : ""}+${String(overflow)} more`;
	return {
		durationMs,
		label: "Explore",
		state: "success",
		summary: summary || "done",
		target: `${String(bindings.length)} operations`,
	};
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
	if (state.settled && state.row && state.model) {
		runtime.presentRow(
			context.toolCallId,
			state.row,
			state.model,
			visibleFor(presentation.transcript ?? "normal", state.model.state),
			context.invalidate,
			state.collapsible,
		);
		return state.row;
	}
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
	const visible = visibleFor(presentation.transcript ?? "normal", "running");
	runtime.presentRow(context.toolCallId, state.row, model, visible, context.invalidate);
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
	state.settled = true;
	runtime.stopTimer(context.toolCallId);
	const detailLines = capDetailLines(presentation.detailLines?.(args, result) ?? buildToolDetailLines(args, result));
	runtime.activities.settle(context.toolCallId, {
		detailLines,
		durationMs,
		state: terminalState,
		summary: model.summary,
	});
	state.collapsible = runtime.presentRow(
		context.toolCallId,
		state.row,
		model,
		visibleFor(presentation.transcript ?? "normal", terminalState),
		context.invalidate,
		true,
		{ args, name: tool.name, result },
	);
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
	runtime.registerGrouping(tool.name, presentation.grouping, presentation.canCollapse);
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
