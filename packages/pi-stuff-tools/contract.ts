import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Container, Image, Spacer, Text } from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";
import {
	type ActivitySummaryMember,
	type PlannedToolActivityGroup,
	type PlannedToolActivityMember,
	planToolActivityGroups,
	summarizeToolActivityGroup,
	type ToolActivityCategory,
	type ToolActivityItem,
	type ToolActivityMetadata,
} from "./activity.js";
import { type ToolActivity, type ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	type ActivityGroupRowModel,
	buildToolDetailLines,
	CachedToolRow,
	capDetailLines,
	classifyTerminalState,
	EmptyToolComponent,
	oneLine,
	sanitizeTerminalText,
	type ToolRowModel,
} from "./render.js";
import { ToolUiSettingsStore } from "./settings.js";

const TOOL_RUNTIME_REGISTRY = Symbol.for("@jczhang02/pi-stuff-tools/runtime-registry.v1");
const TOOL_RELOAD_HANDOFF = Symbol.for("@jczhang02/pi-stuff-tools/reload-handoff.v1");
const DETAIL_LINE_LIMIT = 240;
const DETAIL_BYTE_LIMIT = 24 * 1_024;
const ACTIVITY_HINT_HOLD_MS = 700;
const GROUP_LIST_LIMIT = 768;

function reloadHandoff(value?: readonly string[]): readonly string[] | undefined {
	const host = globalThis as typeof globalThis & {
		[key: symbol]: readonly string[] | undefined;
	};
	if (value !== undefined) host[TOOL_RELOAD_HANDOFF] = [...value];
	return host[TOOL_RELOAD_HANDOFF];
}

function consumeReloadHandoff(): readonly string[] | undefined {
	const host = globalThis as typeof globalThis & {
		[key: symbol]: readonly string[] | undefined;
	};
	const value = host[TOOL_RELOAD_HANDOFF];
	host[TOOL_RELOAD_HANDOFF] = undefined;
	return value;
}

export interface SuiteToolPresentation<TArgs extends Record<string, unknown>, TDetails> {
	/** Required semantic metadata for complete Tool Activity Group projection. */
	readonly activity: ToolActivityMetadata<TArgs, TDetails>;
	readonly detailLines?: (
		args: Readonly<TArgs>,
		result: AgentToolResult<TDetails>,
		state: Exclude<ToolActivityState, "running">,
	) => readonly string[];
	readonly label?: string | ((args: Readonly<TArgs>) => string);
	readonly resultIsError?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean;
	readonly runningSummary?: string | ((args: Readonly<TArgs>, durationMs: number | undefined) => string);
	readonly summarize?: (
		args: Readonly<TArgs>,
		result: AgentToolResult<TDetails>,
		state: Exclude<ToolActivityState, "running">,
		durationMs: number | undefined,
	) => string;
	readonly target?: (args: Readonly<TArgs>) => string;
	readonly tracksElapsed?: boolean;
}

interface RendererState<TArgs extends Record<string, unknown>, TDetails> {
	args?: Readonly<TArgs>;
	component?: CachedToolRow;
	detailLines?: readonly string[];
	lastResult?: AgentToolResult<TDetails>;
	startedAt?: number;
	wasLiveExecution?: boolean;
}

interface ToolRenderContext<TArgs extends Record<string, unknown>> {
	readonly args: TArgs;
	readonly executionStarted?: boolean;
	readonly expanded: boolean;
	readonly invalidate: () => void;
	readonly isError: boolean;
	readonly isPartial: boolean;
	readonly lastComponent: Component | undefined;
	readonly state: Record<string, unknown>;
	readonly toolCallId: string;
}

interface ToolResultRenderOptions {
	readonly expanded: boolean;
	readonly isPartial: boolean;
}

interface PresentedToolMetadata {
	readonly args: Readonly<Record<string, unknown>>;
	readonly name: string;
	readonly result?: AgentToolResult<unknown>;
}

interface GroupedRowBinding {
	baseModel: ToolRowModel;
	baseVisible: boolean;
	expanded: boolean;
	invalidate: () => void;
	metadata: PresentedToolMetadata;
	row: CachedToolRow;
}

interface HintState {
	candidate: string;
	shownAt: number;
	value: string;
}

export interface ToolActivityGroupView {
	readonly id: string;
	readonly memberIds: readonly string[];
	readonly state: ToolActivityState;
	readonly summary: string;
}

export interface ToolUiTimerScheduler {
	setInterval(callback: () => void, delayMs: number): unknown;
	clearInterval(id: unknown): void;
}

const DEFAULT_TIMER_SCHEDULER: ToolUiTimerScheduler = {
	setInterval: (callback, delayMs) => setInterval(callback, delayMs),
	clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

function isIssueState(state: ToolActivityState): state is "cancelled" | "error" | "rejected" {
	return state === "error" || state === "rejected" || state === "cancelled";
}

const SUCCESS_ONLY_ACTIVITY_CATEGORIES = new Set<ToolActivityCategory>([
	"block-goal",
	"change-file",
	"commit",
	"complete-goal",
	"connect-mcp",
	"create-pr",
	"generate-image",
	"launch-agent",
	"launch-background",
	"merge",
	"push",
	"rebase",
	"record-result",
	"save-memory",
	"save-note",
	"start-monitor",
	"stop-background",
	"update-memory",
	"update-note",
	"update-task",
]);

function terminalStateFromResult(
	member: PlannedToolActivityMember,
	resultIsError: ((args: Readonly<Record<string, unknown>>, result: AgentToolResult<unknown>) => boolean) | undefined,
): ToolActivityState {
	if (!member.result) return "running";
	let domainError = Reflect.get(member.result, "isError") === true;
	if (!domainError && resultIsError) {
		try {
			domainError = resultIsError(member.args, member.result);
		} catch {
			domainError = true;
		}
	}
	return classifyTerminalState(member.result, domainError);
}

export class ToolUiRuntime {
	readonly activities = new ToolActivityStore();
	private readonly activityPolicies = new Map<string, ToolActivityMetadata<Record<string, unknown>, unknown>>();
	private readonly bindings = new Map<string, GroupedRowBinding>();
	private readonly errorPolicies = new Map<
		string,
		(args: Readonly<Record<string, unknown>>, result: AgentToolResult<unknown>) => boolean
	>();
	private readonly groupHints = new Map<string, HintState>();
	private readonly groupPulseTimers = new Map<string, unknown>();
	private readonly groupPulseVisibility = new Map<string, boolean>();
	private readonly groupOrder: string[] = [];
	private readonly groups = new Map<string, PlannedToolActivityGroup>();
	private invalidationGeneration = 0;
	private invalidationScheduled = false;
	private readonly membership = new Map<string, string>();
	private readonly now: () => number;
	private readonly pendingInvalidations = new Set<() => void>();
	private reloadActiveToolNames: readonly string[] | undefined;
	private indexedMessages: unknown[] = [];
	private agentActive = false;
	private readonly scheduler: ToolUiTimerScheduler;
	private settings: ToolUiSettingsStore;
	private tailForcedClosed = false;
	private timer: unknown | undefined;
	private readonly timerInvalidators = new Map<string, () => void>();
	private readonly timerMarkers = new Map<string, (visible: boolean) => void>();
	private readonly timerVisibility = new Map<string, boolean>();

	constructor(
		settings = ToolUiSettingsStore.memory(),
		scheduler: ToolUiTimerScheduler = DEFAULT_TIMER_SCHEDULER,
		now: () => number = Date.now,
	) {
		this.settings = settings;
		this.scheduler = scheduler;
		this.now = now;
	}

	configure(settings: ToolUiSettingsStore): void {
		this.suspend();
		this.settings = settings;
	}

	showLiveElapsed(): boolean {
		return this.settings.get().liveElapsed;
	}

	consumeReloadActiveTools(): readonly string[] | undefined {
		const handoff = consumeReloadHandoff();
		const names = this.reloadActiveToolNames ?? handoff;
		this.reloadActiveToolNames = undefined;
		return names;
	}

	hasReloadSnapshot(): boolean {
		return this.reloadActiveToolNames !== undefined || reloadHandoff() !== undefined;
	}

	prepareReload(activeToolNames: readonly string[]): void {
		this.reloadActiveToolNames = [...activeToolNames];
		reloadHandoff(activeToolNames);
		this.suspend();
		this.bindings.clear();
	}

	registerActivity<TArgs extends Record<string, unknown>, TDetails>(
		name: string,
		activity: ToolActivityMetadata<TArgs, TDetails>,
		resultIsError?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean,
	): void {
		this.activityPolicies.set(name, activity as unknown as ToolActivityMetadata<Record<string, unknown>, unknown>);
		if (resultIsError) {
			this.errorPolicies.set(
				name,
				resultIsError as unknown as (
					args: Readonly<Record<string, unknown>>,
					result: AgentToolResult<unknown>,
				) => boolean,
			);
		} else {
			this.errorPolicies.delete(name);
		}
		if (this.indexedMessages.length > 0) this.rebuildGroups();
	}

	missingActivityMetadata(toolNames: readonly string[]): readonly string[] {
		return toolNames.filter((name) => {
			const metadata = this.activityPolicies.get(name);
			return !metadata || (metadata.categories.length === 0 && metadata.silentSuccess !== true);
		});
	}

	startTurn(messages?: readonly unknown[]): void {
		this.agentActive = true;
		this.tailForcedClosed = false;
		if (messages) this.indexedMessages = [...messages];
		this.rebuildGroups();
	}

	observeUserBoundary(): void {
		this.indexedMessages.push({ role: "user", content: [] });
		this.tailForcedClosed = true;
		this.rebuildGroups(true);
	}

	endTurn(): void {
		this.agentActive = false;
		this.tailForcedClosed = true;
		this.rebuildGroups();
	}

	observeAssistantProse(): void {
		if (this.tailForcedClosed) return;
		this.tailForcedClosed = true;
		this.rebuildGroups(true);
	}

	indexMessages(messages: readonly unknown[], closeTail = !this.agentActive): void {
		this.indexedMessages = [...messages];
		this.tailForcedClosed = closeTail;
		this.rebuildGroups();
	}

	indexMessage(message: unknown): void {
		this.indexedMessages.push(message);
		const tailBoundary = messageTailBoundary(message);
		if (tailBoundary !== undefined) this.tailForcedClosed = tailBoundary;
		this.rebuildGroups(true);
	}

	resetProjection(messages: readonly unknown[]): void {
		this.suspend();
		this.groupHints.clear();
		this.activities.clear();
		this.indexedMessages = [...messages];
		this.rebuildGroups();
		const currentToolCallIds = new Set(
			this.groupOrder.flatMap((groupId) => this.groups.get(groupId)?.members.map((member) => member.id) ?? []),
		);
		for (const toolCallId of this.bindings.keys()) {
			if (!currentToolCallIds.has(toolCallId)) this.bindings.delete(toolCallId);
		}
	}

	clear(): void {
		this.suspend();
		for (const binding of this.bindings.values()) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
		this.bindings.clear();
		this.groups.clear();
		this.groupOrder.splice(0);
		this.membership.clear();
		this.groupHints.clear();
		this.indexedMessages = [];
		this.agentActive = false;
		this.tailForcedClosed = false;
		this.activities.clear();
	}

	suspend(): void {
		for (const toolCallId of [...this.timerInvalidators.keys()]) this.stopTimer(toolCallId);
		for (const leaderId of [...this.groupPulseTimers.keys()]) this.stopGroupPulse(leaderId);
		this.invalidationGeneration += 1;
		this.invalidationScheduled = false;
		this.pendingInvalidations.clear();
	}

	presentRow(
		toolCallId: string,
		row: CachedToolRow,
		model: ToolRowModel,
		visible: boolean,
		invalidate: () => void,
		expanded: boolean,
		metadata: PresentedToolMetadata,
	): void {
		let binding = this.bindings.get(toolCallId);
		if (!binding) {
			binding = {
				baseModel: model,
				baseVisible: visible,
				expanded,
				invalidate,
				metadata,
				row,
			};
			this.bindings.set(toolCallId, binding);
		} else {
			binding.row = row;
			binding.baseModel = model;
			binding.baseVisible = visible;
			binding.expanded = expanded;
			binding.invalidate = invalidate;
			binding.metadata = metadata;
		}
		if (!this.membership.has(toolCallId) && this.activityPolicies.has(metadata.name)) {
			const group: PlannedToolActivityGroup = {
				closed: !this.agentActive,
				leaderId: toolCallId,
				members: [
					{
						args: metadata.args,
						id: toolCallId,
						name: metadata.name,
						...(metadata.result ? { result: metadata.result } : {}),
					},
				],
			};
			this.groups.set(toolCallId, group);
			this.groupOrder.push(toolCallId);
			this.membership.set(toolCallId, toolCallId);
		}
		this.reconcileGroupForTool(toolCallId);
	}

	startTimer(
		toolCallId: string,
		invalidate: () => void,
		setMarkerVisible: (visible: boolean) => void = () => {},
	): void {
		this.timerInvalidators.set(toolCallId, invalidate);
		this.timerMarkers.set(toolCallId, setMarkerVisible);
		this.timerVisibility.set(toolCallId, true);
		setMarkerVisible(true);
		if (this.isGroupMarkerDriver(toolCallId)) this.pulseGroup(toolCallId, true);
		if (this.timer === undefined) {
			this.timer = this.scheduler.setInterval(() => this.tickTimers(), 600);
		}
		this.reconcileGroupForTool(toolCallId);
	}

	stopTimer(toolCallId: string): void {
		this.timerInvalidators.delete(toolCallId);
		this.timerVisibility.delete(toolCallId);
		this.timerMarkers.get(toolCallId)?.(true);
		this.timerMarkers.delete(toolCallId);
		if (this.timerInvalidators.size === 0 && this.timer !== undefined) {
			this.scheduler.clearInterval(this.timer);
			this.timer = undefined;
		}
		this.pulseGroup(toolCallId, true);
		this.reconcileGroupForTool(toolCallId);
	}

	syncTimers(): void {
		for (const [toolCallId, invalidate] of this.timerInvalidators) {
			this.timerVisibility.set(toolCallId, true);
			this.timerMarkers.get(toolCallId)?.(true);
			this.pulseGroup(toolCallId, true);
			invalidate();
		}
		this.reconcileTimerGroups();
	}

	private tickTimers(): void {
		for (const [toolCallId, invalidate] of this.timerInvalidators) {
			const visible = !(this.timerVisibility.get(toolCallId) ?? true);
			this.timerVisibility.set(toolCallId, visible);
			this.timerMarkers.get(toolCallId)?.(visible);
			invalidate();
		}
		this.reconcileTimerGroups();
	}

	private reconcileTimerGroups(): void {
		const groups = new Set<string>();
		for (const toolCallId of this.timerInvalidators.keys()) {
			const leaderId = this.membership.get(toolCallId);
			if (leaderId) groups.add(leaderId);
			else this.reconcileGroupForTool(toolCallId);
		}
		for (const leaderId of groups) this.reconcileGroup(this.groups.get(leaderId));
	}

	listGroups(): readonly ToolActivityGroupView[] {
		const grouped = this.groupOrder
			.map((id) => this.groupView(this.groups.get(id)))
			.filter((group): group is ToolActivityGroupView => group !== undefined)
			.map((group) => (group.summary ? group : { ...group, summary: "Internal activity" }));
		const covered = new Set(grouped.flatMap((group) => group.memberIds));
		const standalone = this.activities
			.list()
			.filter((activity) => !covered.has(activity.id))
			.map((activity) => ({
				id: activity.id,
				memberIds: [activity.id],
				state: activity.state,
				summary: activity.label,
			}));
		const sequence = (group: ToolActivityGroupView): number =>
			Math.max(...group.memberIds.map((id) => this.activities.get(id)?.sequence ?? -1));
		return [...grouped, ...standalone]
			.sort((left, right) => sequence(right) - sequence(left))
			.slice(0, GROUP_LIST_LIMIT);
	}

	resolveGroup(query: string): ToolActivityGroupView | "ambiguous" | undefined {
		const normalized = query.trim();
		if (!normalized) return undefined;
		const matches = this.listGroups().filter(
			(group) =>
				group.id === normalized ||
				group.id.startsWith(normalized) ||
				group.memberIds.some((memberId) => memberId === normalized || memberId.startsWith(normalized)),
		);
		return matches.length === 1 ? matches[0] : matches.length > 1 ? "ambiguous" : undefined;
	}

	groupActivities(groupId: string): readonly ToolActivity[] {
		return this.groupActivityPage(groupId, 0, Number.POSITIVE_INFINITY);
	}

	groupActivityPage(groupId: string, offset: number, limit: number): readonly ToolActivity[] {
		const start = Math.max(0, Math.floor(offset));
		const requested = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.MAX_SAFE_INTEGER;
		const group = this.groups.get(groupId);
		if (!group) {
			const standalone = this.activities.get(groupId);
			return standalone && start === 0 && requested > 0 ? [standalone] : [];
		}
		return group.members
			.slice(start, start + requested)
			.map((member) => this.activities.get(member.id) ?? this.activityFromPlan(member));
	}

	private rebuildGroups(tailOnly = false): void {
		if (tailOnly && this.groups.size > 0) {
			this.rebuildGroupsFromNarrativeTail();
			return;
		}
		for (const binding of this.bindings.values()) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
		this.groups.clear();
		this.groupOrder.splice(0);
		this.membership.clear();
		const closeTail = !this.agentActive || this.tailForcedClosed;
		const planned = planToolActivityGroups(this.indexedMessages, new Set(this.activityPolicies.keys()), closeTail);
		for (const group of planned) {
			this.groups.set(group.leaderId, group);
			this.groupOrder.push(group.leaderId);
			for (const member of group.members) this.membership.set(member.id, group.leaderId);
		}
		for (const group of planned) this.reconcileGroup(group);
		for (const key of [...this.groupHints.keys()]) {
			if (!this.groups.has(key)) this.groupHints.delete(key);
		}
		for (const leaderId of [...this.groupPulseTimers.keys()]) {
			if (!this.groups.has(leaderId)) this.stopGroupPulse(leaderId);
		}
	}

	/**
	 * Streaming messages only affect the current narrative tail. Replan that
	 * bounded suffix instead of rescanning every historical session message on
	 * every Tool result. Full lifecycle rebuilds still use rebuildGroups().
	 */
	private rebuildGroupsFromNarrativeTail(): void {
		const tailStart = this.narrativeTailStart();
		const closeTail = !this.agentActive || this.tailForcedClosed;
		const planned = planToolActivityGroups(
			this.indexedMessages.slice(tailStart),
			new Set(this.activityPolicies.keys()),
			closeTail,
		);
		const plannedMembers = new Set(planned.flatMap((group) => group.members.map((member) => member.id)));
		const replaced = new Set(
			this.groupOrder.filter((leaderId) =>
				this.groups.get(leaderId)?.members.some((member) => plannedMembers.has(member.id)),
			),
		);

		for (const leaderId of replaced) {
			const group = this.groups.get(leaderId);
			if (!group) continue;
			for (const member of group.members) {
				const binding = this.bindings.get(member.id);
				if (binding) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
				this.membership.delete(member.id);
			}
			this.groups.delete(leaderId);
		}

		const preserved: string[] = [];
		for (const leaderId of this.groupOrder) {
			if (replaced.has(leaderId)) continue;
			const group = this.groups.get(leaderId);
			if (!group) continue;
			if (!group.closed) {
				const closed = { ...group, closed: true };
				this.groups.set(leaderId, closed);
				this.reconcileGroup(closed);
			}
			preserved.push(leaderId);
		}

		this.groupOrder.splice(0, this.groupOrder.length, ...preserved);
		for (const group of planned) {
			this.groups.set(group.leaderId, group);
			this.groupOrder.push(group.leaderId);
			for (const member of group.members) this.membership.set(member.id, group.leaderId);
		}
		for (const group of planned) this.reconcileGroup(group);

		for (const key of [...this.groupHints.keys()]) {
			if (!this.groups.has(key)) this.groupHints.delete(key);
		}
		for (const leaderId of [...this.groupPulseTimers.keys()]) {
			if (!this.groups.has(leaderId)) this.stopGroupPulse(leaderId);
		}
	}

	private narrativeTailStart(): number {
		for (let index = this.indexedMessages.length - 1; index >= 0; index -= 1) {
			const message = this.indexedMessages[index];
			if (typeof message !== "object" || message === null) continue;
			const value = message as Record<string, unknown>;
			if (value["role"] === "user" || value["role"] === "bashExecution") return index + 1;
			if (value["role"] === "custom" && value["display"] === true) return index + 1;
			if (value["role"] !== "assistant" || !Array.isArray(value["content"])) continue;
			for (const block of value["content"]) {
				if (typeof block !== "object" || block === null) continue;
				const item = block as Record<string, unknown>;
				if (item["type"] === "text" && typeof item["text"] === "string" && item["text"].trim()) {
					return index;
				}
				if (
					item["type"] === "toolCall" &&
					typeof item["name"] === "string" &&
					!this.activityPolicies.has(item["name"])
				) {
					return index;
				}
			}
		}
		return 0;
	}

	private reconcileGroupForTool(toolCallId: string): void {
		const leaderId = this.membership.get(toolCallId);
		if (!leaderId) {
			const binding = this.bindings.get(toolCallId);
			if (binding) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
			return;
		}
		this.reconcileGroup(this.groups.get(leaderId));
	}

	private reconcileGroup(group: PlannedToolActivityGroup | undefined): void {
		if (!group) return;
		const leader = this.bindings.get(group.leaderId);
		if (!leader) return;
		if (leader.expanded) {
			this.stopGroupPulse(group.leaderId);
			for (const member of group.members) {
				const binding = this.bindings.get(member.id);
				if (binding) this.applyBinding(binding, binding.baseModel, true);
			}
			return;
		}
		const members = group.members.map((member) => this.summaryMember(member));
		const summary = summarizeToolActivityGroup(members, group.closed);
		this.reconcileGroupPulse(group, summary.active);
		const issueHint = this.issueHint(group);
		const hint = issueHint || this.stableTarget(group.leaderId, summary.target, summary.active);
		const model: ActivityGroupRowModel = {
			active: summary.active,
			expandable: true,
			hint,
			issueState: summary.issueState,
			kind: "activity",
			summary: summary.summary,
		};
		const leaderModelChanged = leader.row.setModel(model);
		const leaderVisibilityChanged = leader.row.setVisible(Boolean(summary.summary));
		if (leaderModelChanged || leaderVisibilityChanged) this.scheduleInvalidation(leader.invalidate);
		for (const member of group.members.slice(1)) {
			const binding = this.bindings.get(member.id);
			if (!binding) continue;
			if (binding.expanded) this.applyBinding(binding, binding.baseModel, true);
			else if (binding.row.setVisible(false)) this.scheduleInvalidation(binding.invalidate);
		}
	}

	private summaryMember(member: PlannedToolActivityMember): ActivitySummaryMember {
		const binding = this.bindings.get(member.id);
		const state = binding?.baseModel.state ?? terminalStateFromResult(member, this.errorPolicies.get(member.name));
		const metadata = binding?.metadata ?? {
			args: member.args,
			name: member.name,
			...(member.result ? { result: member.result } : {}),
		};
		return {
			issueLabel: binding?.baseModel.label ?? member.name,
			items: this.classify(metadata, state),
			state,
		};
	}

	private classify(metadata: PresentedToolMetadata, state: ToolActivityState): readonly ToolActivityItem[] {
		const policy = this.activityPolicies.get(metadata.name);
		if (!policy) return [];
		try {
			const items = policy.classify({
				args: metadata.args,
				...(metadata.result ? { result: metadata.result } : {}),
				state,
			});
			return isIssueState(state)
				? items.filter((item) => !SUCCESS_ONLY_ACTIVITY_CATEGORIES.has(item.category))
				: items;
		} catch {
			return [];
		}
	}

	private issueHint(group: PlannedToolActivityGroup): string {
		const issues = group.members
			.map((member) => this.bindings.get(member.id))
			.filter((binding): binding is GroupedRowBinding => Boolean(binding && isIssueState(binding.baseModel.state)));
		const issue = issues[0];
		if (!issue) return "";
		const remaining = Math.max(0, issues.length - 1);
		return oneLine(
			`${issue.baseModel.label} ${issue.baseModel.summary}${remaining > 0 ? ` · +${String(remaining)} issues` : ""}`,
		);
	}

	private stableTarget(leaderId: string, candidate: string, active: boolean): string {
		if (!active || !candidate) {
			if (!active) this.groupHints.delete(leaderId);
			return "";
		}
		const now = this.now();
		let state = this.groupHints.get(leaderId);
		if (!state) {
			state = { candidate, shownAt: now, value: candidate };
			this.groupHints.set(leaderId, state);
			return state.value;
		}
		if (candidate === state.value) {
			state.candidate = candidate;
			return state.value;
		}
		state.candidate = candidate;
		if (now - state.shownAt >= ACTIVITY_HINT_HOLD_MS) {
			state.value = candidate;
			state.shownAt = now;
		}
		return state.value;
	}

	private pulseGroup(toolCallId: string, visible: boolean): void {
		const leaderId = this.membership.get(toolCallId);
		if (!leaderId) return;
		this.bindings.get(leaderId)?.row.setMarkerVisible(visible);
	}

	private isGroupMarkerDriver(toolCallId: string): boolean {
		const leaderId = this.membership.get(toolCallId);
		const group = leaderId ? this.groups.get(leaderId) : undefined;
		if (!group) return true;
		return (
			group.members.find((member) => this.bindings.get(member.id)?.baseModel.state === "running")?.id === toolCallId
		);
	}

	private reconcileGroupPulse(group: PlannedToolActivityGroup, active: boolean): void {
		const hasToolTimer = group.members.some((member) => this.timerInvalidators.has(member.id));
		if (!active || hasToolTimer) {
			this.stopGroupPulse(group.leaderId);
			return;
		}
		if (this.groupPulseTimers.has(group.leaderId)) return;
		this.groupPulseVisibility.set(group.leaderId, true);
		const timer = this.scheduler.setInterval(() => {
			const visible = !(this.groupPulseVisibility.get(group.leaderId) ?? true);
			this.groupPulseVisibility.set(group.leaderId, visible);
			const leader = this.bindings.get(group.leaderId);
			if (leader?.row.setMarkerVisible(visible)) this.scheduleInvalidation(leader.invalidate);
			this.reconcileGroupForTool(group.leaderId);
		}, 600);
		this.groupPulseTimers.set(group.leaderId, timer);
	}

	private stopGroupPulse(leaderId: string): void {
		const timer = this.groupPulseTimers.get(leaderId);
		if (timer !== undefined) this.scheduler.clearInterval(timer);
		this.groupPulseTimers.delete(leaderId);
		this.groupPulseVisibility.delete(leaderId);
		const leader = this.bindings.get(leaderId);
		if (leader?.row.setMarkerVisible(true)) this.scheduleInvalidation(leader.invalidate);
	}

	private applyBinding(binding: GroupedRowBinding, model: ToolRowModel, visible: boolean): void {
		const modelChanged = binding.row.setModel(model);
		const visibilityChanged = binding.row.setVisible(visible);
		if (modelChanged || visibilityChanged) this.scheduleInvalidation(binding.invalidate);
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

	private groupView(group: PlannedToolActivityGroup | undefined): ToolActivityGroupView | undefined {
		if (!group) return undefined;
		const summary = summarizeToolActivityGroup(
			group.members.map((member) => this.summaryMember(member)),
			group.closed,
		);
		return {
			id: group.leaderId,
			memberIds: group.members.map((member) => member.id),
			state: summary.issueState ?? (summary.active ? "running" : "success"),
			summary: summary.summary,
		};
	}

	private activityFromPlan(member: PlannedToolActivityMember): ToolActivity {
		const state = terminalStateFromResult(member, this.errorPolicies.get(member.name));
		const items = this.classify(
			{
				args: member.args,
				name: member.name,
				...(member.result ? { result: member.result } : {}),
			},
			state,
		);
		const summary = summarizeToolActivityGroup([{ items, state }], state !== "running");
		const pending: AgentToolResult<unknown> = {
			content: [{ type: "text", text: "(pending)" }],
			details: undefined,
		};
		return {
			detailLines: buildToolDetailLines(member.args, member.result ?? pending),
			durationMs: undefined,
			id: member.id,
			label: member.name,
			name: member.name,
			sequence: 0,
			startedAt: undefined,
			state,
			summary: summary.summary,
			target:
				items
					.map((item) => item.target)
					.filter(Boolean)
					.at(-1) ?? "",
		};
	}
}

function messageTailBoundary(message: unknown): boolean | undefined {
	if (typeof message !== "object" || message === null) return undefined;
	const value = message as Record<string, unknown>;
	if (value["role"] === "custom") return value["display"] === true ? true : undefined;
	if (value["role"] !== "assistant" || !Array.isArray(value["content"])) {
		return value["role"] === "user" || value["role"] === "bashExecution" ? true : undefined;
	}
	let boundary: boolean | undefined;
	for (const block of value["content"]) {
		if (typeof block !== "object" || block === null) continue;
		const item = block as Record<string, unknown>;
		if (item["type"] === "text" && typeof item["text"] === "string" && item["text"].trim()) boundary = true;
		if (item["type"] === "toolCall") boundary = false;
	}
	return boundary;
}

function runtimeRegistry(): WeakMap<ExtensionAPI["events"], ToolUiRuntime> {
	const host = globalThis as typeof globalThis & {
		[key: symbol]: WeakMap<ExtensionAPI["events"], ToolUiRuntime> | undefined;
	};
	const existing = host[TOOL_RUNTIME_REGISTRY];
	if (existing) return existing;
	const registry = new WeakMap<ExtensionAPI["events"], ToolUiRuntime>();
	host[TOOL_RUNTIME_REGISTRY] = registry;
	return registry;
}

export function getToolUiRuntime(pi: ExtensionAPI): ToolUiRuntime {
	const registry = runtimeRegistry();
	const existing = registry.get(pi.events);
	if (existing) return existing;
	const runtime = new ToolUiRuntime();
	registry.set(pi.events, runtime);
	return runtime;
}

/** Predeclare Activity metadata for a conditionally registered owned Tool. */
export function registerSuiteToolActivityMetadata<TArgs extends Record<string, unknown>, TDetails>(
	pi: ExtensionAPI,
	name: string,
	activity: ToolActivityMetadata<TArgs, TDetails>,
	resultIsError?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean,
): void {
	getToolUiRuntime(pi).registerActivity(name, activity, resultIsError);
}

export interface SuiteToolRegistrationTracker {
	readonly api: ExtensionAPI;
	readonly toolNames: ReadonlySet<string>;
}

/** Observe every Tool registered by Aggregate capabilities without changing the Host API. */
export function createSuiteToolRegistrationTracker(pi: ExtensionAPI): SuiteToolRegistrationTracker {
	const toolNames = new Set<string>();
	const registerTool: ExtensionAPI["registerTool"] = (tool) => {
		toolNames.add(tool.name);
		pi.registerTool(tool);
	};
	const api = new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") return registerTool;
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { api, toolNames };
}

/** Fail fast when an Aggregate-owned Tool bypasses or under-declares the required Activity contract. */
export function assertSuiteToolActivityCoverage(
	pi: ExtensionAPI,
	declaredToolNames: readonly string[],
	registeredToolNames?: ReadonlySet<string>,
	optionalToolNames: readonly string[] = [],
	deferredToolNames: readonly string[] = [],
): void {
	let metadataToolNames = [...declaredToolNames, ...deferredToolNames];
	if (registeredToolNames) {
		const declared = new Set([...declaredToolNames, ...deferredToolNames, ...optionalToolNames]);
		// A capability may be intentionally idempotent when the Aggregate is loaded
		// twice in one Host. Count Tools that are already installed on the shared
		// Extension API as present, while still using this invocation's tracker to
		// reject newly registered undeclared Tools.
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		const undeclared = [...registeredToolNames].filter((name) => !declared.has(name)).sort();
		if (undeclared.length > 0) {
			throw new Error(`Aggregate registered undeclared Tools: ${undeclared.join(", ")}`);
		}
		const unregistered = declaredToolNames
			.filter((name) => !registeredToolNames.has(name) && !available.has(name))
			.sort();
		if (unregistered.length > 0) {
			throw new Error(`Aggregate declared unregistered Tools: ${unregistered.join(", ")}`);
		}
		metadataToolNames = [
			...declaredToolNames,
			...deferredToolNames,
			...optionalToolNames.filter((name) => registeredToolNames.has(name) || available.has(name)),
		];
	}
	const missing = getToolUiRuntime(pi).missingActivityMetadata(metadataToolNames);
	if (missing.length > 0) {
		throw new Error(`Aggregate Tools missing Activity metadata: ${missing.join(", ")}`);
	}
}

export function installToolUiRuntime(pi: ExtensionAPI, settings: ToolUiSettingsStore): ToolUiRuntime {
	const runtime = getToolUiRuntime(pi);
	runtime.configure(settings);
	return runtime;
}

function capPresentationDetails(base: readonly string[], extra: readonly string[] | undefined): string[] {
	return capDetailLines(
		extra && extra.length > 0 ? [...base, "", "Presentation", ...extra] : base,
		DETAIL_LINE_LIMIT,
		DETAIL_BYTE_LIMIT,
	);
}

function labelFor<TArgs extends Record<string, unknown>, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	args: Readonly<TArgs>,
): string {
	const label = typeof presentation.label === "function" ? presentation.label(args) : presentation.label;
	return sanitizeTerminalText(label ?? tool.label ?? tool.name) || tool.name;
}

function updateRunningRow<TArgs extends Record<string, unknown>, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	runtime: ToolUiRuntime,
	state: RendererState<TArgs, TDetails>,
	context: ToolRenderContext<TArgs>,
	theme: Theme,
): CachedToolRow {
	const args = context.args;
	state.args = args;
	state.wasLiveExecution ??= context.executionStarted !== false;
	if (state.wasLiveExecution && state.startedAt === undefined) state.startedAt = Date.now();
	const durationMs = state.startedAt === undefined ? undefined : Math.max(0, Date.now() - state.startedAt);
	const summarySource = presentation.runningSummary;
	const summary =
		typeof summarySource === "function"
			? summarySource(args, presentation.tracksElapsed && runtime.showLiveElapsed() ? durationMs : undefined)
			: (summarySource ?? "working");
	const model: ToolRowModel = {
		durationMs,
		label: labelFor(tool, presentation, args),
		state: "running",
		summary: oneLine(summary),
		target: oneLine(presentation.target?.(args) ?? ""),
	};
	if (!state.component) state.component = new CachedToolRow(theme, model);
	runtime.activities.begin({
		id: context.toolCallId,
		label: model.label,
		name: tool.name,
		...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
		target: model.target,
	});
	const metadata: PresentedToolMetadata = { args, name: tool.name };
	runtime.presentRow(context.toolCallId, state.component, model, true, context.invalidate, context.expanded, metadata);
	if (state.wasLiveExecution) {
		runtime.startTimer(context.toolCallId, context.invalidate, (visible) =>
			state.component?.setMarkerVisible(visible),
		);
	}
	return state.component;
}

function settleRow<TArgs extends Record<string, unknown>, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	runtime: ToolUiRuntime,
	state: RendererState<TArgs, TDetails>,
	result: AgentToolResult<TDetails>,
	context: ToolRenderContext<TArgs>,
	theme: Theme,
): CachedToolRow {
	const args = state.args ?? context.args;
	state.args = args;
	let domainError = context.isError;
	if (!domainError && presentation.resultIsError) {
		try {
			domainError = presentation.resultIsError(args, result);
		} catch {
			domainError = true;
		}
	}
	const activityState = classifyTerminalState(result, domainError);
	const finishedAt = Date.now();
	const durationMs = state.startedAt === undefined ? undefined : Math.max(0, finishedAt - state.startedAt);
	const summary = oneLine(
		presentation.summarize?.(args, result, activityState, durationMs) ??
			(activityState === "success" ? "done" : activityState),
	);
	const model: ToolRowModel = {
		durationMs,
		label: labelFor(tool, presentation, args),
		state: activityState,
		summary,
		target: oneLine(presentation.target?.(args) ?? ""),
	};
	if (!state.component) state.component = new CachedToolRow(theme, model);
	state.lastResult = result;
	state.detailLines = capPresentationDetails(
		buildToolDetailLines(args, result as AgentToolResult<unknown>),
		presentation.detailLines?.(args, result, activityState),
	);
	runtime.stopTimer(context.toolCallId);
	runtime.presentRow(context.toolCallId, state.component, model, true, context.invalidate, context.expanded, {
		args,
		name: tool.name,
		result: result as AgentToolResult<unknown>,
	});
	runtime.activities.begin({
		id: context.toolCallId,
		label: model.label,
		name: tool.name,
		...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
		target: model.target,
	});
	runtime.activities.settle(context.toolCallId, {
		detailLines: state.detailLines,
		durationMs,
		state: activityState,
		summary,
	});
	return state.component;
}

function resultBody<TArgs extends Record<string, unknown>, TDetails>(
	state: RendererState<TArgs, TDetails>,
	result: AgentToolResult<TDetails>,
	expanded: boolean,
	theme: Theme,
): Component {
	const container = new Container();
	const text = expanded ? (state.detailLines?.join("\n") ?? "") : "";
	if (text) container.addChild(new Text(theme.fg("toolOutput", text), 2, 0));
	const images = result.content.filter(
		(
			item,
		): item is {
			readonly type: "image";
			readonly data: string;
			readonly mimeType: string;
		} => item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string",
	);
	for (const [index, image] of images.entries()) {
		if (text || index > 0) container.addChild(new Spacer(1));
		container.addChild(
			new Image(
				image.data,
				image.mimeType,
				{ fallbackColor: (value) => theme.fg("dim", value) },
				{ maxWidthCells: 60 },
			),
		);
	}
	return text || images.length > 0 ? container : new EmptyToolComponent();
}

function attachRenderer<TArgs extends Record<string, unknown>, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	runtime: ToolUiRuntime,
): ToolDefinition<TSchema, TDetails> {
	return {
		...tool,
		renderShell: "self",
		renderCall: (args, theme, context) => {
			const typed = {
				...context,
				args,
			} as unknown as ToolRenderContext<TArgs>;
			const state = typed.state as RendererState<TArgs, TDetails>;
			if (state.lastResult) {
				return settleRow(tool, presentation, runtime, state, state.lastResult, typed, theme);
			}
			return updateRunningRow(tool, presentation, runtime, state, typed, theme);
		},
		renderResult: (result, options, theme, context) => {
			const renderOptions = options as ToolResultRenderOptions;
			const state = context.state as RendererState<TArgs, TDetails>;
			const typed = {
				...context,
				args: state.args ?? ({} as TArgs),
				expanded: renderOptions.expanded,
				isPartial: renderOptions.isPartial,
			} as unknown as ToolRenderContext<TArgs>;
			if (renderOptions.isPartial) return new EmptyToolComponent();
			settleRow(tool, presentation, runtime, state, result, typed, theme);
			return resultBody(state, result, renderOptions.expanded, theme);
		},
	};
}

/** Register a Suite-owned Tool without changing its execute protocol or result. */
export function registerSuiteOwnedTool<TParams extends TSchema, TDetails = unknown>(
	pi: ExtensionAPI,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolPresentation<Static<TParams> & Record<string, unknown>, TDetails>,
): void {
	const runtime = getToolUiRuntime(pi);
	registerSuiteToolActivityMetadata(pi, tool.name, presentation.activity, presentation.resultIsError);
	pi.registerTool(
		attachRenderer(tool as unknown as ToolDefinition<TSchema, TDetails>, presentation, runtime) as ToolDefinition<
			TParams,
			TDetails
		>,
	);
}
