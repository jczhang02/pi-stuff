import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isRuntimeString } from "../shared/runtime-type.js";
import {
	type ActivitySummaryMember,
	type PlannedRetrievalGroup,
	type PlannedToolActivityMember,
	type RetrievalGroupDisposition,
	summarizeRetrievalGroup,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolActivitySummary,
	type ToolArguments,
	toolActivityOutcome,
} from "./activity.js";
import type { ToolActivity, ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	activityRecoveryKeys,
	canonicalCountKey,
	type GroupSummaryIndex,
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
	ToolFormattedSection,
} from "./contract.js";
import type { ToolEnvelopeProjection } from "./envelope-projection.js";
import { formattedToolSections } from "./formatted-detail.js";
import type { ToolGroupProjection } from "./group-projection.js";
import { DETAIL_BYTE_LIMIT, DETAIL_LINE_LIMIT } from "./limits.js";
import { formattedResultLines } from "./registered-tool-renderer.js";
import type { ToolRowModel } from "./render.js";
import { buildRawToolDetailLines, capDetailLines, oneLine, summarizeBuiltin } from "./tool-text.js";

const GROUP_LIST_LIMIT = 768;

function capSections(sections: readonly ToolFormattedSection[]): readonly ToolFormattedSection[] {
	const flattened = sections.flatMap((section, index) => [`@@pi-stuff-section:${String(index)}@@`, ...section.lines]);
	const capped = capDetailLines(flattened, DETAIL_LINE_LIMIT, DETAIL_BYTE_LIMIT);
	const output: Array<{ lines: string[]; title: string }> = [];
	let current: { lines: string[]; title: string } | undefined;
	for (const line of capped) {
		const marker = line.match(/^@@pi-stuff-section:(\d+)@@$/u);
		if (marker) {
			const source = sections[Number(marker[1])];
			if (!source) continue;
			current = { lines: [], title: source.title };
			output.push(current);
		} else current?.lines.push(line);
	}
	return output;
}

export type ResultErrorPolicy = (args: ToolArguments, result: AgentToolResult<unknown>) => boolean;

export interface ToolActivityQueryBinding {
	readonly baseModel: ToolRowModel;
	readonly metadata: PresentedToolMetadata;
}

interface ToolActivityQuerySource {
	readonly activities: ToolActivityStore;
	readonly activityPolicies: ReadonlyMap<string, ToolActivityMetadata<ToolArguments, unknown>>;
	readonly bindingFor: (toolCallId: string) => ToolActivityQueryBinding | undefined;
	readonly detailPresentations: ReadonlyMap<string, ToolDetailPresentation>;
	readonly disposition: (name: string, args: ToolArguments) => RetrievalGroupDisposition;
	readonly envelopes: ToolEnvelopeProjection;
	readonly errorPolicies: ReadonlyMap<string, ResultErrorPolicy>;
	readonly groupSource: () => ToolGroupProjection;
	readonly groupSummary: (group: PlannedRetrievalGroup) => ToolActivitySummary;
	readonly liveResultFor: (toolCallId: string) => AgentToolResult<unknown> | undefined;
}

/** Projects current and historical Tool activity into stable read-side views. */
export class ToolActivityQueryProjection {
	private readonly source: ToolActivityQuerySource;

	constructor(source: ToolActivityQuerySource) {
		this.source = source;
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
		const group = this.source.groupSource().group(groupId);
		if (!group) {
			const standalone = this.source.activities.get(groupId);
			return standalone && start === 0 && requested > 0 ? [standalone] : [];
		}
		return group.members.slice(start, start + requested).map((member) => {
			return this.activityForMember(member);
		});
	}

	toolActivityDetail(toolCallId: string, mode: ToolActivityDetailMode): ToolActivityDetailView | undefined {
		const member = this.source.groupSource().member(toolCallId);
		const binding = this.source.bindingFor(toolCallId);
		const activity = member ? this.activityForMember(member) : this.source.activities.get(toolCallId);
		if (!activity) return undefined;
		const args = member?.args ?? binding?.metadata.args ?? {};
		const rawArgs = this.source.envelopes.rawArgumentsFor(toolCallId) ?? args;
		const name = member?.name ?? binding?.metadata.name ?? activity.name;
		const result = member?.result ?? binding?.metadata.result ?? this.source.liveResultFor(toolCallId);
		if (name === "codemode" && activity.state === "success") return undefined;
		if (mode === "raw") return { activity, lines: buildRawToolDetailLines(toolCallId, name, rawArgs, result) };
		let lines: readonly string[] | undefined;
		let sections: readonly ToolFormattedSection[] | undefined;
		const presentation = this.source.detailPresentations.get(name);
		if (result && activity.state !== "running" && presentation?.detailSections) {
			try {
				sections = presentation.detailSections(args, result, activity.state);
			} catch {
				// Fall through to the shared semantic projection.
			}
		}
		if (result && activity.state !== "running" && presentation?.detailLines) {
			try {
				lines = presentation.detailLines(args, result, activity.state);
			} catch {
				// Fall back to bounded result text when an optional formatter fails.
			}
		}
		const fallback =
			lines && lines.length > 0
				? lines
				: result
					? formattedResultLines(result, {
							fromResult: activity.summaryFromResult === true,
							text: activity.summary,
						})
					: activity.detailLines.length > 0
						? activity.detailLines
						: ["Details are available after completion."];
		const semantic = capSections(
			sections && sections.length > 0
				? sections
				: result && activity.state !== "running"
					? formattedToolSections(name, args, result, activity.state, fallback)
					: [{ lines: fallback, title: "Status" }],
		);
		const images = result?.content.flatMap((item) =>
			item.type === "image" && isRuntimeString(item.data) && isRuntimeString(item.mimeType)
				? [{ data: item.data, mimeType: item.mimeType }]
				: [],
		);
		const detail: ToolActivityDetailView = {
			activity,
			lines: semantic.flatMap((section) => section.lines),
			sections: semantic,
		};
		return images && images.length > 0 ? { ...detail, images } : detail;
	}

	summaryMember(member: PlannedToolActivityMember): ActivitySummaryMember {
		const binding = this.source.bindingFor(member.id);
		const forcedTerminal = member.terminalState;
		const state =
			forcedTerminal ??
			(member.result
				? terminalStateFromResult(member, this.source.errorPolicies.get(member.name))
				: (binding?.baseModel.state ?? "running"));
		const metadata: PresentedToolMetadata = {
			...binding?.metadata,
			args: binding?.metadata.args ?? member.args,
			name: member.name,
		};
		if (member.result) Object.assign(metadata, { result: member.result });
		const transparent = this.source.disposition(member.name, metadata.args) === "transparent";
		const silentSuccess = state === "success" && this.isSilentSuccess(member.name);
		const classifiedItems = forcedTerminal || transparent || silentSuccess ? [] : this.classify(metadata, state);
		const items = visibleActivityItems(classifiedItems, state);
		const infrastructureIssue =
			isIssueState(state) && items.length === 0 && (transparent || this.isSilentSuccess(member.name));
		const issueLabel =
			state === "success" || state === "running" || infrastructureIssue
				? undefined
				: (binding?.baseModel.label ?? member.name);
		const issueDetail =
			state === "success" || state === "running"
				? undefined
				: metadata.result
					? this.issueDetail(member.name, metadata.args, metadata.result, state)
					: forcedTerminal
						? state === "cancelled"
							? "Tool call was cancelled before execution"
							: "Tool call failed before execution"
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

	isSilentSuccess(name: string): boolean {
		return this.source.activityPolicies.get(name)?.silentSuccess === true;
	}

	firstIssueDetail(index: GroupSummaryIndex): string {
		const issueSummary = index.issue();
		return !issueSummary.id || !issueSummary.detail ? "" : oneLine(issueSummary.detail);
	}

	activityFromPlan(member: PlannedToolActivityMember): ToolActivity {
		const state = terminalStateFromResult(member, this.source.errorPolicies.get(member.name));
		const transparent = this.source.disposition(member.name, member.args) === "transparent";
		const metadata: PresentedToolMetadata = { args: member.args, name: member.name };
		if (member.result) Object.assign(metadata, { result: member.result });
		const classifiedItems = transparent || member.terminalState ? [] : this.classify(metadata, state);
		const items = visibleActivityItems(classifiedItems, state);
		const summary = summarizeRetrievalGroup([{ items, state }], state !== "running");
		const presentation = this.source.detailPresentations.get(member.name);
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

	private activityForMember(member: PlannedToolActivityMember): ToolActivity {
		const stored = this.source.activities.get(member.id);
		if (!member.result && !member.terminalState) return stored ?? this.activityFromPlan(member);
		const settled = this.activityFromPlan(member);
		return stored
			? {
					...settled,
					detailLines: stored.detailLines,
					durationMs: stored.durationMs,
					sequence: stored.sequence,
					startedAt: stored.startedAt,
				}
			: settled;
	}

	private allGroupViews(): Array<ToolActivityView & { order: number }> {
		const groups = this.source.groupSource().groupsInOrder();
		const grouped = groups
			.map((group) => this.groupView(group))
			.filter((group): group is ToolActivityView => group !== undefined)
			.map((group, order) => ({ ...(group.summary ? group : { ...group, summary: "Internal activity" }), order }));
		const covered = new Set(grouped.flatMap((group) => group.memberIds));
		const standalone = this.source.activities
			.list()
			.filter((activity) => !covered.has(activity.id))
			.map((activity) => ({
				id: activity.id,
				label: activity.label,
				memberIds: [activity.id],
				operation: activity.target,
				order: groups.length + activity.sequence,
				outcome: activity.summary,
				state:
					activity.state === "rejected" || activity.state === "cancelled"
						? activity.state
						: toolActivityOutcome(activity.state),
				summary: activity.label,
			}));
		return [...grouped, ...standalone];
	}

	private groupView(group: PlannedRetrievalGroup): ToolActivityView | undefined {
		if (group.standalone) {
			const member = group.members[0];
			if (!member) return undefined;
			const activity = this.activityForMember(member);
			if (member.name === "codemode" && activity.state === "success") return undefined;
			return {
				id: group.leaderId,
				label: activity.label,
				memberIds: [member.id],
				operation: activity.target,
				outcome: activity.summary,
				state:
					activity.state === "rejected" || activity.state === "cancelled"
						? activity.state
						: toolActivityOutcome(activity.state),
				summary: activity.summary ? `${activity.label} · ${activity.summary}` : activity.label,
			};
		}
		const summary = this.source.groupSummary(group);
		const members = group.members.map((member) => this.activityForMember(member));
		const labels = new Set(members.map((activity) => activity.label));
		const states = group.members.map((member) => this.summaryMember(member).state);
		const state = states.every((candidate) => candidate === "rejected")
			? "rejected"
			: states.every((candidate) => candidate === "cancelled")
				? "cancelled"
				: summary.outcome;
		return {
			id: group.leaderId,
			label: labels.size === 1 ? (members[0]?.label ?? "Tools") : "Tools",
			memberIds: group.members.map((member) => member.id),
			operation: summary.target,
			outcome: summary.summary,
			state,
			summary: summary.summary,
		};
	}

	private issueDetail(
		name: string,
		args: ToolArguments,
		result: AgentToolResult<unknown>,
		state: Exclude<ToolActivityState, "running" | "success">,
	): string {
		const summarizeIssue = this.source.activityPolicies.get(name)?.summarizeIssue;
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
		const policy = this.source.activityPolicies.get(metadata.name);
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
}
