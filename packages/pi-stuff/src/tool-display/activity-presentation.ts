import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isRuntimeString } from "../shared/runtime-type.js";
import {
	type ActivitySummaryMember,
	type PlannedRetrievalGroup,
	type PlannedToolActivityMember,
	type RetrievalGroupDisposition,
	summarizeRetrievalGroup,
	summarizeToolActivityAggregate,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolArguments,
	toolActivityOutcome,
} from "./activity.js";
import { ToolActivityClock } from "./activity-clock.js";
import { type ToolActivity, type ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	activityRecoveryKeys,
	canonicalCountKey,
	GroupSummaryIndex,
	isIssueState,
	terminalStateFromResult,
	visibleActivityItems,
} from "./activity-summary.js";
import type {
	PresentedToolMetadata,
	ToolActivityDetailMode,
	ToolActivityDetailView,
	ToolActivityView,
	ToolDetailPresentation,
	ToolUiTimerScheduler,
} from "./contract.js";
import type { ToolEnvelopeProjection } from "./envelope-projection.js";
import type { ToolGroupProjection } from "./group-projection.js";
import {
	BASH_OUTPUT_COLLAPSED_SOURCE_LIMIT,
	BASH_OUTPUT_SOURCE_LIMIT,
	DETAIL_BYTE_LIMIT,
	DETAIL_LINE_LIMIT,
} from "./limits.js";
import { formattedResultLines } from "./registered-tool-renderer.js";
import type { BashOperationRowModel, CachedToolRow, RetrievalGroupRowModel, ToolRowModel } from "./render.js";
import type { ToolUiSettingsStore } from "./settings.js";
import { buildRawToolDetailLines, capDetailLines, formatElapsed, oneLine, summarizeBuiltin } from "./tool-text.js";

const ACTIVITY_HINT_HOLD_MS = 700;
const BINDING_LIMIT = 768;
const GROUP_LIST_LIMIT = 768;

interface GroupedRowBinding {
	bashOutput?: string;
	bashOutputExpanded?: boolean;
	bashOutputResult?: AgentToolResult<unknown>;
	bashOutputTruncated?: boolean;
	baseModel: ToolRowModel;
	baseVisible: boolean;
	expanded: boolean;
	invalidate: () => void;
	metadata: PresentedToolMetadata;
	row: CachedToolRow;
	startedAt: number | undefined;
}

interface HintState {
	candidate: string;
	shownAt: number;
	value: string;
}

type ResultErrorPolicy = (args: ToolArguments, result: AgentToolResult<unknown>) => boolean;

export class ToolActivityPresentation {
	readonly activities = new ToolActivityStore();
	private readonly activityPolicies: ReadonlyMap<string, ToolActivityMetadata<ToolArguments, unknown>>;
	private readonly bindings = new Map<string, GroupedRowBinding>();
	private readonly clock: ToolActivityClock;
	private readonly detailPresentations: ReadonlyMap<string, ToolDetailPresentation>;
	private readonly disposition: (name: string, args: ToolArguments) => RetrievalGroupDisposition;
	private readonly envelopes: ToolEnvelopeProjection;
	private readonly errorPolicies: ReadonlyMap<string, ResultErrorPolicy>;
	private readonly groupSource: () => ToolGroupProjection;
	private readonly groupHints = new Map<string, HintState>();
	private readonly groupSummaries = new Map<string, GroupSummaryIndex>();
	private invalidationGeneration = 0;
	private invalidationScheduled = false;
	private readonly isRendered: (name: string) => boolean;
	private readonly liveResults = new Map<string, AgentToolResult<unknown>>();
	private readonly now: () => number;
	private readonly pendingInvalidations = new Set<() => void>();
	private settings: ToolUiSettingsStore;

	constructor(
		groupSource: () => ToolGroupProjection,
		envelopes: ToolEnvelopeProjection,
		activityPolicies: ReadonlyMap<string, ToolActivityMetadata<ToolArguments, unknown>>,
		detailPresentations: ReadonlyMap<string, ToolDetailPresentation>,
		errorPolicies: ReadonlyMap<string, ResultErrorPolicy>,
		disposition: (name: string, args: ToolArguments) => RetrievalGroupDisposition,
		isRendered: (name: string) => boolean,
		settings: ToolUiSettingsStore,
		scheduler: ToolUiTimerScheduler,
		now: () => number,
	) {
		this.groupSource = groupSource;
		this.envelopes = envelopes;
		this.activityPolicies = activityPolicies;
		this.detailPresentations = detailPresentations;
		this.errorPolicies = errorPolicies;
		this.disposition = disposition;
		this.isRendered = isRendered;
		this.settings = settings;
		this.now = now;
		this.clock = new ToolActivityClock(scheduler, {
			leaderIdFor: (toolCallId) => this.groups().leaderIdFor(toolCallId),
			reconcileLeader: (leaderId) => this.reconcileGroup(this.groups().group(leaderId)),
			reconcileTool: (toolCallId) => this.reconcileGroupForTool(toolCallId),
			runningMemberId: (leaderId) => this.runningMemberId(leaderId),
			setLeaderMarker: (leaderId, visible, invalidate) => this.setLeaderMarker(leaderId, visible, invalidate),
		});
	}

	configure(settings: ToolUiSettingsStore): void {
		this.suspend();
		this.settings = settings;
	}

	showLiveElapsed(): boolean {
		return this.settings.get().liveElapsed;
	}

	discardBindings(): void {
		this.bindings.clear();
	}

	shouldQueueResult(toolCallId: string): boolean {
		const binding = this.bindings.get(toolCallId);
		return Boolean(binding && this.isRendered(binding.metadata.name));
	}

	observeToolExecutionStart(toolCallId: string): void {
		this.liveResults.delete(toolCallId);
		this.groups().discardPendingResult(toolCallId);
		const binding = this.bindings.get(toolCallId);
		if (!binding?.metadata.result) return;
		const { result: _result, ...metadata } = binding.metadata;
		binding.metadata = metadata;
		delete binding.bashOutput;
		delete binding.bashOutputResult;
	}

	observeToolExecutionUpdate(toolCallId: string, result: AgentToolResult<unknown>): void {
		if (this.liveResults.get(toolCallId) === result) return;
		this.liveResults.set(toolCallId, result);
		const binding = this.bindings.get(toolCallId);
		if (!binding) return;
		binding.metadata = { ...binding.metadata, result };
		this.reconcileGroupForTool(toolCallId);
	}

	observeToolExecutionEnd(toolCallId: string, result: AgentToolResult<unknown>): void {
		this.liveResults.delete(toolCallId);
		const binding = this.bindings.get(toolCallId);
		if (binding) binding.metadata = { ...binding.metadata, result };
		this.groups().updateToolResult(toolCallId, result);
	}

	resetProjection(): void {
		this.suspend();
		this.groupHints.clear();
		this.activities.clear();
	}

	groupsRebuilt(): void {
		this.groupSummaries.clear();
		const groups = this.groups().groupsInOrder();
		for (const group of groups) this.reconcileGroup(group);
		for (const [toolCallId, binding] of this.bindings) {
			if (!this.groups().leaderIdFor(toolCallId)) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
		}
		const leaderIds = new Set(groups.map((group) => group.leaderId));
		for (const leaderId of Array.from(this.groupHints.keys())) {
			if (!leaderIds.has(leaderId)) this.groupHints.delete(leaderId);
		}
		this.clock.pruneGroups(leaderIds);
	}

	retainBindings(toolCallIds: ReadonlySet<string>): void {
		for (const toolCallId of this.bindings.keys()) {
			if (!toolCallIds.has(toolCallId)) this.bindings.delete(toolCallId);
		}
	}

	clear(): void {
		this.suspend();
		for (const binding of this.bindings.values()) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
		this.bindings.clear();
		this.groupSummaries.clear();
		this.groupHints.clear();
		this.activities.clear();
	}

	suspend(): void {
		this.clock.suspend();
		this.invalidationGeneration += 1;
		this.invalidationScheduled = false;
		this.pendingInvalidations.clear();
		this.liveResults.clear();
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
		const projectedResult = metadata.result ?? this.liveResults.get(toolCallId) ?? binding?.metadata.result;
		const projectedMetadata = projectedResult === undefined ? metadata : { ...metadata, result: projectedResult };
		if (!binding) {
			binding = {
				baseModel: model,
				baseVisible: visible,
				expanded,
				invalidate,
				metadata: projectedMetadata,
				row,
				startedAt: model.state === "running" ? this.now() : undefined,
			};
		} else {
			binding.row = row;
			binding.baseModel = model;
			binding.baseVisible = visible;
			binding.expanded = expanded;
			binding.invalidate = invalidate;
			binding.metadata = projectedMetadata;
			if (binding.startedAt === undefined && model.state === "running") binding.startedAt = this.now();
		}
		this.bindings.delete(toolCallId);
		this.bindings.set(toolCallId, binding);
		this.reconcileGroupForTool(toolCallId, projectedMetadata.result !== this.groups().projectedResult(toolCallId));
		this.trimBindings(toolCallId);
	}

	updateProjectedRow(
		toolCallId: string,
		row: CachedToolRow,
		model: ToolRowModel,
		visible: boolean,
		invalidate: () => void,
		expanded: boolean,
		metadata: PresentedToolMetadata,
	): boolean {
		const binding = this.bindings.get(toolCallId);
		if (!binding) return false;
		Object.assign(binding, { baseModel: model, baseVisible: visible, expanded, invalidate, metadata, row });
		if (binding.startedAt === undefined && model.state === "running") binding.startedAt = this.now();
		this.bindings.delete(toolCallId);
		this.bindings.set(toolCallId, binding);
		const group = this.groups().groupForTool(toolCallId);
		if (expanded || group?.standalone) this.reconcileGroupForTool(toolCallId, false);
		return true;
	}

	setRowExpanded(toolCallId: string, expanded: boolean): void {
		const binding = this.bindings.get(toolCallId);
		if (!binding || binding.expanded === expanded) return;
		binding.expanded = expanded;
		this.reconcileGroupForTool(toolCallId);
	}

	startTimer(
		toolCallId: string,
		invalidate: () => void,
		setMarkerVisible: (visible: boolean) => void = () => {},
	): void {
		this.clock.start(toolCallId, invalidate, setMarkerVisible);
	}

	stopTimer(toolCallId: string): void {
		this.clock.stop(toolCallId);
	}

	syncTimers(): void {
		this.clock.sync();
	}

	listGroups(): readonly ToolActivityView[] {
		return this.allGroupViews()
			.sort((left, right) => right.order - left.order)
			.slice(0, GROUP_LIST_LIMIT)
			.map(({ order: _order, ...group }) => group);
	}

	resolveGroup(query: string): ToolActivityView | "ambiguous" | undefined {
		const normalized = query.trim();
		if (!normalized) return undefined;
		const matches = this.allGroupViews().filter(
			(group) =>
				group.id === normalized ||
				group.id.startsWith(normalized) ||
				group.memberIds.some((memberId) => memberId === normalized || memberId.startsWith(normalized)),
		);
		if (matches.length !== 1) return matches.length > 1 ? "ambiguous" : undefined;
		const match = matches[0];
		if (!match) return undefined;
		const { order: _order, ...group } = match;
		return group;
	}

	groupActivities(groupId: string): readonly ToolActivity[] {
		return this.groupActivityPage(groupId, 0, Number.POSITIVE_INFINITY);
	}

	groupActivityPage(groupId: string, offset: number, limit: number): readonly ToolActivity[] {
		const start = Math.max(0, Math.floor(offset));
		const requested = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.MAX_SAFE_INTEGER;
		const group = this.groups().group(groupId);
		if (!group) {
			const standalone = this.activities.get(groupId);
			return standalone && start === 0 && requested > 0 ? [standalone] : [];
		}
		return group.members.slice(start, start + requested).map((member) => {
			return this.activities.get(member.id) ?? this.activityFromPlan(member);
		});
	}

	toolActivityDetail(toolCallId: string, mode: ToolActivityDetailMode): ToolActivityDetailView | undefined {
		const member = this.groups().member(toolCallId);
		const binding = this.bindings.get(toolCallId);
		const activity = this.activities.get(toolCallId) ?? (member ? this.activityFromPlan(member) : undefined);
		if (!activity) return undefined;
		const args = member?.args ?? binding?.metadata.args ?? {};
		const rawArgs = this.envelopes.rawArgumentsFor(toolCallId) ?? args;
		const name = member?.name ?? binding?.metadata.name ?? activity.name;
		const result = member?.result ?? binding?.metadata.result ?? this.liveResults.get(toolCallId);
		if (mode === "raw") return { activity, lines: buildRawToolDetailLines(toolCallId, name, rawArgs, result) };
		let lines: readonly string[] | undefined;
		const presentation = this.detailPresentations.get(name);
		if (result && activity.state !== "running" && presentation?.detailLines) {
			try {
				lines = presentation.detailLines(args, result, activity.state);
			} catch {
				// Fall back to bounded result text when an optional formatter fails.
			}
		}
		return {
			activity,
			lines: capDetailLines(
				lines && lines.length > 0
					? lines
					: result
						? formattedResultLines(result, {
								fromResult: activity.summaryFromResult === true,
								text: activity.summary,
							})
						: activity.detailLines.length > 0
							? activity.detailLines
							: ["Details are available after completion."],
				DETAIL_LINE_LIMIT,
				DETAIL_BYTE_LIMIT,
			),
		};
	}

	dropGroup(leaderId: string): void {
		this.clock.dropGroup(leaderId);
		this.groupSummaries.delete(leaderId);
		this.groupHints.delete(leaderId);
	}

	reconcileGroupForTool(toolCallId: string, semanticChange = true): void {
		const group = this.groups().groupForTool(toolCallId);
		if (!group) {
			const binding = this.bindings.get(toolCallId);
			if (binding) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
			return;
		}
		this.reconcileGroup(group, semanticChange ? toolCallId : undefined);
	}

	reconcileGroup(group: PlannedRetrievalGroup | undefined, changedMemberId?: string): void {
		if (!group) return;
		const leader = this.bindings.get(group.leaderId);
		if (group.standalone) {
			if (!leader) return;
			this.clock.dropGroup(group.leaderId);
			const member = group.members[0];
			if (member?.name === "bash") this.applyBashOperation(member, leader);
			else {
				const silentSuccess =
					member !== undefined &&
					this.summaryMember(member).state === "success" &&
					this.activityPolicies.get(member.name)?.silentSuccess === true;
				this.applyBinding(leader, leader.baseModel, leader.baseVisible && (!silentSuccess || leader.expanded));
			}
			return;
		}
		const index = this.summaryIndex(group, changedMemberId);
		if (!leader) {
			for (const member of group.members.slice(1)) {
				const binding = this.bindings.get(member.id);
				if (!binding) continue;
				if (binding.expanded) this.applyBinding(binding, binding.baseModel, true);
				else if (binding.row.setVisible(false)) this.scheduleInvalidation(binding.invalidate);
			}
			return;
		}
		if (leader.expanded) {
			this.clock.dropGroup(group.leaderId);
			for (const member of group.members) {
				const binding = this.bindings.get(member.id);
				if (!binding) continue;
				if (member.name === "bash") this.applyBashOperation(member, binding);
				else this.applyBinding(binding, binding.baseModel, true);
			}
			return;
		}
		const summary = summarizeToolActivityAggregate(index.aggregate(), group.closed);
		this.clock.reconcileGroup(group, summary.active);
		const model: RetrievalGroupRowModel = {
			active: summary.active,
			elapsed: this.groupElapsed(group),
			expandable: true,
			issueDetail: this.firstIssueDetail(index),
			issueText: summary.semanticSummary ? summary.issueText : summary.summary,
			kind: "activity",
			outcome: summary.outcome,
			semanticSummary: summary.semanticSummary,
			summary: summary.summary,
			target: this.stableTarget(group.leaderId, summary.target, summary.active),
		};
		const modelChanged = leader.row.setModel(model);
		const visibilityChanged = leader.row.setVisible(Boolean(summary.summary));
		if (modelChanged || visibilityChanged) this.scheduleInvalidation(leader.invalidate);
		for (const member of group.members.slice(1)) {
			const binding = this.bindings.get(member.id);
			if (!binding) continue;
			if (binding.expanded) this.applyBinding(binding, binding.baseModel, true);
			else if (binding.row.setVisible(false)) this.scheduleInvalidation(binding.invalidate);
		}
	}

	private groups(): ToolGroupProjection {
		return this.groupSource();
	}

	private allGroupViews(): Array<ToolActivityView & { order: number }> {
		const groups = this.groups().groupsInOrder();
		const grouped = groups
			.map((group) => this.groupView(group))
			.filter((group): group is ToolActivityView => group !== undefined)
			.map((group, order) => ({ ...(group.summary ? group : { ...group, summary: "Internal activity" }), order }));
		const covered = new Set(grouped.flatMap((group) => group.memberIds));
		const standalone = this.activities
			.list()
			.filter((activity) => !covered.has(activity.id))
			.map((activity) => ({
				id: activity.id,
				memberIds: [activity.id],
				order: groups.length + activity.sequence,
				state: toolActivityOutcome(activity.state),
				summary: activity.label,
			}));
		return [...grouped, ...standalone];
	}

	private applyBashOperation(member: PlannedToolActivityMember, binding: GroupedRowBinding): void {
		const summaryMember = this.summaryMember(member);
		const output = this.bashOutput(binding, member.result ?? binding.metadata.result, binding.expanded);
		const model: BashOperationRowModel = {
			active: summaryMember.state === "running",
			command: isRuntimeString(member.args["command"]) ? member.args["command"] : String(member.args["value"] ?? ""),
			expandable: true,
			expanded: binding.expanded,
			kind: "bash-operation",
			output: output.text,
			outputTruncated: output.truncated,
			state: summaryMember.state,
		};
		const modelChanged = binding.row.setModel(model);
		const visibilityChanged = binding.row.setVisible(true);
		if (modelChanged || visibilityChanged) this.scheduleInvalidation(binding.invalidate);
	}

	private bashOutput(binding: GroupedRowBinding, result: AgentToolResult<unknown> | undefined, expanded: boolean) {
		if (binding.bashOutputResult === result && binding.bashOutputExpanded === expanded) {
			return { text: binding.bashOutput ?? "", truncated: binding.bashOutputTruncated === true };
		}
		const limit = expanded ? BASH_OUTPUT_SOURCE_LIMIT : BASH_OUTPUT_COLLAPSED_SOURCE_LIMIT;
		let output = "";
		let truncated = false;
		for (const item of result?.content ?? []) {
			if (item.type !== "text") continue;
			const separator = output ? "\n" : "";
			const remaining = limit - output.length - separator.length;
			if (remaining <= 0) {
				truncated = true;
				break;
			}
			const text = item.text.slice(0, remaining);
			output += `${separator}${text}`;
			if (text.length < item.text.length) {
				truncated = true;
				break;
			}
		}
		if (result) {
			binding.bashOutputResult = result;
			binding.bashOutputExpanded = expanded;
		} else {
			delete binding.bashOutputResult;
			delete binding.bashOutputExpanded;
		}
		binding.bashOutput = output;
		binding.bashOutputTruncated = truncated;
		return { text: output, truncated };
	}

	private summaryIndex(group: PlannedRetrievalGroup, changedMemberId?: string): GroupSummaryIndex {
		let index = this.groupSummaries.get(group.leaderId);
		if (!index) {
			index = new GroupSummaryIndex();
			this.groupSummaries.set(group.leaderId, index);
		}
		for (let memberIndex = index.size; memberIndex < group.members.length; memberIndex += 1) {
			const member = group.members[memberIndex];
			if (member) index.upsert(member.id, memberIndex, this.summaryMember(member));
		}
		if (changedMemberId) {
			const memberIndex = this.groups().memberIndex(changedMemberId);
			const member = memberIndex === undefined ? undefined : group.members[memberIndex];
			if (member && memberIndex !== undefined) index.upsert(member.id, memberIndex, this.summaryMember(member));
		}
		return index;
	}

	private summaryMember(member: PlannedToolActivityMember): ActivitySummaryMember {
		const binding = this.bindings.get(member.id);
		const forcedTerminal = !member.result ? member.terminalState : undefined;
		const state =
			forcedTerminal ??
			(member.result
				? terminalStateFromResult(member, this.errorPolicies.get(member.name))
				: (binding?.baseModel.state ?? "running"));
		const metadata: PresentedToolMetadata = {
			...binding?.metadata,
			args: binding?.metadata.args ?? member.args,
			name: member.name,
		};
		if (member.result) Object.assign(metadata, { result: member.result });
		const transparent = this.disposition(member.name, metadata.args) === "transparent";
		const silentSuccess = state === "success" && this.activityPolicies.get(member.name)?.silentSuccess === true;
		const classifiedItems = forcedTerminal || transparent || silentSuccess ? [] : this.classify(metadata, state);
		const items = visibleActivityItems(classifiedItems, state);
		const infrastructureIssue =
			isIssueState(state) &&
			items.length === 0 &&
			(transparent || this.activityPolicies.get(member.name)?.silentSuccess === true);
		const issueLabel =
			state === "success" || state === "running" || infrastructureIssue
				? undefined
				: (binding?.baseModel.label ?? member.name);
		const issueDetail =
			state === "success" || state === "running"
				? undefined
				: forcedTerminal
					? state === "cancelled"
						? "Tool call was cancelled before execution"
						: "Tool call failed before execution"
					: metadata.result
						? this.issueDetail(member.name, metadata.args, metadata.result, state)
						: (binding?.baseModel.summary ?? issueLabel);
		const summary: ActivitySummaryMember = {
			items,
			recoveryKeys: transparent ? [] : activityRecoveryKeys(member.name, metadata.args, classifiedItems),
			state,
		};
		if (issueDetail) Object.assign(summary, { issueDetail });
		if (issueLabel) Object.assign(summary, { issueLabel });
		return summary;
	}

	private issueDetail(
		name: string,
		args: ToolArguments,
		result: AgentToolResult<unknown>,
		state: Exclude<ToolActivityState, "running" | "success">,
	): string {
		const summarizeIssue = this.activityPolicies.get(name)?.summarizeIssue;
		if (summarizeIssue) {
			try {
				const summary = oneLine(summarizeIssue(args, result, state));
				if (summary) return summary;
			} catch {
				// Keep the compact projection available when optional semantic extraction fails.
			}
		}
		for (const item of result.content) {
			if (item.type !== "text") continue;
			const summary = oneLine(item.text.split(/\r?\n/u)[0] ?? "");
			if (summary) return summary;
		}
		return summarizeBuiltin(name, args, result, state, undefined);
	}

	private classify(metadata: PresentedToolMetadata, state: ToolActivityState): readonly ToolActivityItem[] {
		const policy = this.activityPolicies.get(metadata.name);
		if (!policy) return [];
		try {
			const input = { args: metadata.args, state };
			if (metadata.cwd) Object.assign(input, { cwd: metadata.cwd });
			if (metadata.result) Object.assign(input, { result: metadata.result });
			return policy.classify(input).map((item) =>
				item.countKeys
					? {
							...item,
							countKeys: item.countKeys.map((key) => canonicalCountKey(item.category, key, metadata.cwd)),
						}
					: item,
			);
		} catch {
			return [];
		}
	}

	private firstIssueDetail(index: GroupSummaryIndex): string {
		const issueSummary = index.issue();
		return !issueSummary.id || !issueSummary.detail ? "" : oneLine(issueSummary.detail);
	}

	private groupElapsed(group: PlannedRetrievalGroup): string {
		if (!this.showLiveElapsed()) return "";
		for (let index = group.members.length - 1; index >= 0; index -= 1) {
			const binding = this.bindings.get(group.members[index]?.id ?? "");
			if (binding?.baseModel.state !== "running") continue;
			const elapsed = Math.max(
				binding.baseModel.durationMs ?? 0,
				binding.startedAt === undefined ? 0 : this.now() - binding.startedAt,
			);
			return elapsed < 2_000 ? "" : formatElapsed(elapsed);
		}
		return "";
	}

	private stableTarget(leaderId: string, candidate: string, active: boolean): string {
		if (!active || !candidate) {
			if (!active) this.groupHints.delete(leaderId);
			return "";
		}
		const now = this.now();
		let state = this.groupHints.get(leaderId);
		if (!state) {
			state = { candidate, shownAt: now, value: "" };
			this.groupHints.set(leaderId, state);
			return state.value;
		}
		if (candidate !== state.candidate) {
			state.candidate = candidate;
			state.shownAt = now;
			return state.value;
		}
		if (candidate !== state.value && now - state.shownAt >= ACTIVITY_HINT_HOLD_MS) state.value = candidate;
		return state.value;
	}

	private trimBindings(currentToolCallId: string): void {
		const protectedIds = new Set([currentToolCallId]);
		const leaderId = this.groups().leaderIdFor(currentToolCallId);
		if (leaderId) protectedIds.add(leaderId);
		while (this.bindings.size > BINDING_LIMIT) {
			let oldest: string | undefined;
			for (const id of this.bindings.keys()) {
				if (!protectedIds.has(id)) {
					oldest = id;
					break;
				}
			}
			if (!oldest) return;
			this.bindings.delete(oldest);
		}
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

	private groupView(group: PlannedRetrievalGroup): ToolActivityView | undefined {
		if (group.standalone) {
			const member = group.members[0];
			if (!member) return undefined;
			const activity = this.activities.get(member.id) ?? this.activityFromPlan(member);
			return {
				id: group.leaderId,
				memberIds: [member.id],
				state: toolActivityOutcome(activity.state),
				summary: activity.summary ? `${activity.label} · ${activity.summary}` : activity.label,
			};
		}
		const summary = summarizeToolActivityAggregate(this.summaryIndex(group).aggregate(), group.closed);
		return {
			id: group.leaderId,
			memberIds: group.members.map((member) => member.id),
			state: summary.outcome,
			summary: summary.summary,
		};
	}

	private activityFromPlan(member: PlannedToolActivityMember): ToolActivity {
		const state = terminalStateFromResult(member, this.errorPolicies.get(member.name));
		const transparent = this.disposition(member.name, member.args) === "transparent";
		const metadata: PresentedToolMetadata = { args: member.args, name: member.name };
		if (member.result) Object.assign(metadata, { result: member.result });
		const classifiedItems =
			transparent || (member.terminalState && !member.result) ? [] : this.classify(metadata, state);
		const items = visibleActivityItems(classifiedItems, state);
		const summary = summarizeRetrievalGroup([{ items, state }], state !== "running");
		const presentation = this.detailPresentations.get(member.name);
		let label = member.name;
		let target =
			items
				.map((item) => item.target)
				.filter(Boolean)
				.at(-1) ?? "";
		let toolSummary = summary.summary;
		let summaryFromResult = false;
		if (presentation) {
			try {
				label = presentation.label(member.args);
				target = presentation.target(member.args);
				const value = presentation.summary(member.args, member.result, state);
				const projectedSummary = isRuntimeString(value) ? { fromResult: false, text: value } : value;
				toolSummary = projectedSummary.text;
				summaryFromResult = projectedSummary.fromResult;
			} catch {
				// Historical detail remains available with semantic fallbacks.
			}
		}
		return {
			detailLines: [],
			durationMs: undefined,
			id: member.id,
			label,
			name: member.name,
			sequence: 0,
			startedAt: undefined,
			state,
			summary: toolSummary,
			summaryFromResult,
			target,
		};
	}

	private runningMemberId(leaderId: string): string | undefined {
		return this.groups()
			.group(leaderId)
			?.members.find((member) => this.bindings.get(member.id)?.baseModel.state === "running")?.id;
	}

	private setLeaderMarker(leaderId: string, visible: boolean, invalidate: boolean): void {
		const leader = this.bindings.get(leaderId);
		if (leader?.row.setMarkerVisible(visible) && invalidate) this.scheduleInvalidation(leader.invalidate);
	}
}
