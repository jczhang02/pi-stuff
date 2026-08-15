import { createHash, type Hash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { type AssistantMessageEvent, validateToolArguments } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
	Container,
	getCapabilities,
	getImageDimensions,
	Image,
	Spacer,
	Text,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";
import { getHostSharedResource } from "../conversation-ui/host-resource.js";
import { SELF_RENDERED_TRANSCRIPT_PADDING, TRANSCRIPT_CONTINUATION } from "../conversation-ui/transcript.js";
import {
	type ActivityCategoryAggregate,
	type ActivitySummaryMember,
	effectiveToolActivityOutcome,
	type PlannedToolActivityGroup,
	type PlannedToolActivityMember,
	planToolActivityGroups,
	summarizeToolActivityAggregate,
	summarizeToolActivityGroup,
	type ToolActivityAggregate,
	type ToolActivityCategory,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolActivityOutcome,
	toolActivityOutcome,
} from "./activity.js";
import { type ToolActivity, type ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	type ActivityGroupRowModel,
	type BashOperationRowModel,
	buildToolDetailLines,
	CachedToolRow,
	capDetailLines,
	classifyTerminalState,
	EmptyToolComponent,
	oneLine,
	sanitizeTerminalText,
	summarizeBuiltin,
	type ToolRowModel,
} from "./render.js";
import { ToolUiSettingsStore } from "./settings.js";

const TOOL_RUNTIME_REGISTRY = Symbol.for("@jczhang02/pi-stuff-tools/runtime-registry.v1");
const TOOL_RUNTIME_DISCOVERY_EVENT = "@jczhang02/pi-stuff-tools/runtime-discovery/v1";
const TOOL_RELOAD_HANDOFF = Symbol.for("@jczhang02/pi-stuff-tools/reload-handoff.v1");
const SUITE_ACTIVITY_RENDERER = Symbol.for("@jczhang02/pi-stuff-tools/activity-renderer.v1");
const SUITE_TOOL_ENVELOPE = Symbol.for("@jczhang02/pi-stuff-tools/tool-envelope.v1");

interface SuiteActivityRendererMarker {
	readonly activity: ToolActivityMetadata<Record<string, unknown>, unknown>;
	readonly resultIsError?: (args: Readonly<Record<string, unknown>>, result: AgentToolResult<unknown>) => boolean;
}

interface SuiteToolEnvelopeMarker {
	readonly decode: SuiteToolEnvelopeDecoder;
	readonly media?: SuiteToolEnvelopeMediaResolver;
	readonly registry: SuiteToolDefinitionRegistry;
}
const DETAIL_LINE_LIMIT = 240;
const DETAIL_BYTE_LIMIT = 24 * 1_024;
const ACTIVITY_HINT_HOLD_MS = 700;
const GROUP_LIST_LIMIT = 768;
const PENDING_RESULT_LIMIT = 768;
const BINDING_LIMIT = 768;
const TIMER_STATE_LIMIT = 768;
const BASH_OUTPUT_SOURCE_LIMIT = 32 * 1_024;
const BASH_OUTPUT_COLLAPSED_SOURCE_LIMIT = 2 * 1_024;

function isRecordValue(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export type SuiteToolEnvelopeOperationState = "cancelled" | "error" | "rejected" | "running" | "success";

export interface SuiteToolEnvelopeOperation {
	readonly args: Readonly<Record<string, unknown>>;
	readonly id: string;
	/** Preserve media at the same boundary it occupied in the direct Tool result. */
	readonly mediaPlacements?: readonly SuiteToolEnvelopeMediaPlacement[];
	readonly name: string;
	readonly result?: AgentToolResult<unknown>;
	readonly state: SuiteToolEnvelopeOperationState;
}

export interface SuiteToolEnvelopeMediaPlacement {
	/** Number of non-media content blocks that preceded this media block. */
	readonly afterContentIndex: number;
	/** Index into the envelope presentation's normalized media segments. */
	readonly mediaIndex: number;
}

export type SuiteToolEnvelopeDecoder = (details: unknown) => readonly SuiteToolEnvelopeOperation[];

export type SuiteToolEnvelopeMediaResolver = (
	details: unknown,
) => readonly (readonly AgentToolResult<unknown>["content"][number][])[];

export interface SuiteToolDefinitionRegistry {
	get(name: string): ToolDefinition | undefined;
	invoke(invocation: SuiteToolInvocation): Promise<SuiteToolInvocationResult>;
	isActive(name: string): boolean;
	list(): readonly ToolDefinition[];
}

export interface SuiteToolInvocation {
	readonly context: ExtensionContext;
	readonly input: unknown;
	readonly name: string;
	readonly onUpdate?: AgentToolUpdateCallback<unknown>;
	readonly signal?: AbortSignal;
	readonly toolCallId: string;
}

export interface SuiteToolInvocationResult {
	readonly isError: boolean;
	readonly result: AgentToolResult<unknown>;
}

export interface SuiteToolSurfaceController {
	disableEnvelope(name: string): void;
	enableEnvelope(name: string): void;
	isEnvelopeEnabled(name: string): boolean;
}

export interface SuiteToolEnvelopePresentation {
	readonly decode: SuiteToolEnvelopeDecoder;
	readonly media?: SuiteToolEnvelopeMediaResolver;
	readonly registry: SuiteToolDefinitionRegistry;
}

interface RendererState<TArgs extends Record<string, unknown>, TDetails> {
	args?: Readonly<TArgs>;
	component?: CachedToolRow;
	detailLines?: readonly string[];
	detailMaterialized?: boolean;
	lastResult?: AgentToolResult<TDetails>;
	liveEffectsStarted?: boolean;
	projectedReplay?: boolean;
	startedAt?: number;
	terminalModelMaterialized?: boolean;
	terminalState?: Exclude<ToolActivityState, "running">;
	wasLiveExecution?: boolean;
}

interface ToolRenderContext<TArgs extends Record<string, unknown>> {
	readonly args: TArgs;
	readonly cwd: string;
	readonly executionStarted?: boolean;
	readonly expanded: boolean;
	readonly invalidate: () => void;
	readonly isError: boolean;
	readonly isPartial: boolean;
	readonly lastComponent: Component | undefined;
	readonly showImages: boolean;
	readonly state: Record<string, unknown>;
	readonly toolCallId: string;
}

interface ToolResultRenderOptions {
	readonly expanded: boolean;
	readonly isPartial: boolean;
}

interface PresentedToolMetadata {
	readonly args: Readonly<Record<string, unknown>>;
	readonly cwd?: string;
	readonly name: string;
	readonly result?: AgentToolResult<unknown>;
}

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
}

interface HintState {
	candidate: string;
	shownAt: number;
	value: string;
}

interface GroupPulseState {
	visible: boolean;
}

interface ToolTimerState {
	invalidate: () => void;
	setMarkerVisible: (visible: boolean) => void;
	visible: boolean;
}

interface IndexedCategory {
	numericCount: number;
	readonly details: Map<string, { readonly detail: string; readonly itemIndex: number; readonly order: number }>;
	readonly keyRefs: Map<string, number>;
}

interface IndexedSummaryMember extends ActivitySummaryMember {
	readonly order: number;
	readonly signature: string;
	readonly target: string;
}

class GroupSummaryIndex {
	private cachedAggregate: ToolActivityAggregate | undefined;
	private readonly categories = new Map<ToolActivityCategory, IndexedCategory>();
	private firstIssueId: string | undefined;
	private readonly members = new Map<string, IndexedSummaryMember>();
	private readonly stateCounts: Partial<Record<ToolActivityState, number>> = {};
	private latestTargetOrder = -1;
	private readonly targetsByOrder: string[] = [];

	get size(): number {
		return this.members.size;
	}

	upsert(id: string, order: number, member: ActivitySummaryMember): boolean {
		const target =
			member.items
				.map((item) => item.target ?? "")
				.filter(Boolean)
				.at(-1) ?? "";
		const signature = JSON.stringify([
			member.state,
			member.issueLabel ?? "",
			member.issueDetail ?? "",
			member.items,
			member.recoveryKeys ?? [],
			target,
		]);
		const previous = this.members.get(id);
		if (previous?.signature === signature && previous.order === order) return false;
		this.cachedAggregate = undefined;
		if (previous) this.remove(id, previous);
		const indexed: IndexedSummaryMember = { ...member, order, signature, target };
		this.members.set(id, indexed);
		this.stateCounts[indexed.state] = (this.stateCounts[indexed.state] ?? 0) + 1;
		this.updateTarget(previous, indexed);
		indexed.items.forEach((item, itemIndex) => {
			this.addItem(id, indexed.order, itemIndex, item);
		});
		if (isIssueState(indexed.state)) {
			const first = this.firstIssueId ? this.members.get(this.firstIssueId) : undefined;
			if (!first || indexed.order < first.order) {
				this.firstIssueId = id;
			}
		}
		return true;
	}

	issue(): { readonly count: number; readonly detail: string | undefined; readonly id: string | undefined } {
		const first = this.firstIssueId ? this.members.get(this.firstIssueId) : undefined;
		return {
			count: (this.stateCounts.error ?? 0) + (this.stateCounts.rejected ?? 0) + (this.stateCounts.cancelled ?? 0),
			detail: first?.issueDetail ?? first?.issueLabel,
			id: this.firstIssueId,
		};
	}

	aggregate(): ToolActivityAggregate {
		if (this.cachedAggregate) return this.cachedAggregate;
		const target = this.targetsByOrder[this.latestTargetOrder] ?? "";
		const categories: ActivityCategoryAggregate[] = [];
		for (const [category, indexed] of this.categories) {
			categories.push({
				category,
				count: indexed.keyRefs.size + indexed.numericCount,
				details: [...indexed.details.values()]
					.sort((left, right) => left.order - right.order || left.itemIndex - right.itemIndex)
					.map((entry) => entry.detail),
			});
		}
		const firstIssueLabel = this.firstIssueId ? this.members.get(this.firstIssueId)?.issueLabel : undefined;
		this.cachedAggregate = {
			categories,
			...(firstIssueLabel ? { firstIssueLabel } : {}),
			outcome: effectiveToolActivityOutcome(
				[...this.members.values()].sort((left, right) => left.order - right.order),
			),
			stateCounts: { ...this.stateCounts },
			target,
		};
		return this.cachedAggregate;
	}

	private addItem(id: string, order: number, itemIndex: number, item: ToolActivityItem): void {
		let category = this.categories.get(item.category);
		if (!category) {
			category = { numericCount: 0, details: new Map(), keyRefs: new Map() };
			this.categories.set(item.category, category);
		}
		if (item.countKeys && item.countKeys.length > 0) {
			for (const rawKey of item.countKeys) {
				const key = canonicalCountKey(item.category, rawKey);
				category.keyRefs.set(key, (category.keyRefs.get(key) ?? 0) + 1);
			}
		} else {
			const count = Number.isFinite(item.count ?? 1) ? Math.max(0, Math.floor(item.count ?? 1)) : 0;
			category.numericCount += count;
		}
		if (item.detail)
			category.details.set(`${id}\u0000${String(itemIndex)}`, { detail: item.detail, itemIndex, order });
	}

	private remove(id: string, member: IndexedSummaryMember): void {
		this.members.delete(id);
		this.stateCounts[member.state] = Math.max(0, (this.stateCounts[member.state] ?? 0) - 1);
		member.items.forEach((item, itemIndex) => {
			const category = this.categories.get(item.category);
			if (!category) return;
			if (item.countKeys && item.countKeys.length > 0) {
				for (const rawKey of item.countKeys) {
					const key = canonicalCountKey(item.category, rawKey);
					const next = (category.keyRefs.get(key) ?? 0) - 1;
					if (next > 0) category.keyRefs.set(key, next);
					else category.keyRefs.delete(key);
				}
			} else {
				const count = Number.isFinite(item.count ?? 1) ? Math.max(0, Math.floor(item.count ?? 1)) : 0;
				category.numericCount = Math.max(0, category.numericCount - count);
			}
			category.details.delete(`${id}\u0000${String(itemIndex)}`);
			if (category.numericCount === 0 && category.keyRefs.size === 0 && category.details.size === 0) {
				this.categories.delete(item.category);
			}
		});
		if (this.firstIssueId === id) {
			this.firstIssueId = [...this.members.entries()]
				.filter(([, candidate]) => isIssueState(candidate.state))
				.sort(([, left], [, right]) => left.order - right.order)[0]?.[0];
		}
	}

	private updateTarget(previous: IndexedSummaryMember | undefined, member: IndexedSummaryMember): void {
		if (previous && previous.order !== member.order) this.targetsByOrder[previous.order] = "";
		this.targetsByOrder[member.order] = member.target;
		if (member.target && member.order >= this.latestTargetOrder) this.latestTargetOrder = member.order;
		while (this.latestTargetOrder >= 0 && !this.targetsByOrder[this.latestTargetOrder]) {
			this.latestTargetOrder -= 1;
		}
	}
}

export interface ToolActivityGroupView {
	readonly id: string;
	readonly memberIds: readonly string[];
	readonly state: ToolActivityOutcome;
	readonly summary: string;
}

export interface ToolUiTimerScheduler {
	setInterval(callback: () => void, delayMs: number): unknown;
	clearInterval(id: unknown): void;
}

const DEFAULT_TIMER_SCHEDULER: ToolUiTimerScheduler = {
	setInterval: (callback, delayMs) => {
		const id = setInterval(callback, delayMs);
		id.unref?.();
		return id;
	},
	clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

function isIssueState(state: ToolActivityState): state is "cancelled" | "error" | "rejected" {
	return state === "error" || state === "rejected" || state === "cancelled";
}

function assistantTerminalState(stopReason: unknown): "cancelled" | "error" | undefined {
	return stopReason === "aborted" ? "cancelled" : stopReason === "error" ? "error" : undefined;
}

function canonicalCountKey(category: ToolActivityCategory, key: string, cwd = process.cwd()): string {
	if (category === "fetch-page") {
		try {
			const url = new URL(key);
			url.hash = "";
			return url.href;
		} catch {
			return key;
		}
	}
	if (
		category !== "read-file" &&
		category !== "change-file" &&
		category !== "view-image" &&
		category !== "generate-image"
	)
		return key;
	const expanded = key === "~" ? homedir() : key.startsWith("~/") ? resolve(homedir(), key.slice(2)) : key;
	return resolve(cwd, expanded);
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
	"message-agent",
	"merge",
	"push",
	"rebase",
	"record-result",
	"resume-agent",
	"save-memory",
	"save-note",
	"start-monitor",
	"steer-agent",
	"stop-background",
	"stop-agent",
	"update-memory",
	"update-note",
	"update-task",
]);

function visibleActivityItems(
	items: readonly ToolActivityItem[],
	state: ToolActivityState,
): readonly ToolActivityItem[] {
	return isIssueState(state) ? items.filter((item) => !SUCCESS_ONLY_ACTIVITY_CATEGORIES.has(item.category)) : items;
}

function hashRetryText(hash: Hash, value: string): void {
	hash.update(`${String(value.length)}:`);
	hash.update(value);
}

function hashRetryValue(hash: Hash, value: unknown, seen = new WeakSet<object>()): void {
	if (value === null) {
		hash.update("n");
		return;
	}
	if (typeof value === "string") {
		hash.update("s");
		hashRetryText(hash, value);
		return;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("non-JSON Tool arguments");
		hash.update(`d${JSON.stringify(value)};`);
		return;
	}
	if (typeof value === "boolean") {
		hash.update(value ? "t" : "f");
		return;
	}
	if (typeof value !== "object") throw new TypeError("non-JSON Tool arguments");
	if (seen.has(value)) throw new TypeError("circular Tool arguments");
	seen.add(value);
	if (Array.isArray(value)) {
		hash.update(`a${String(value.length)}:`);
		for (const entry of value) hashRetryValue(hash, entry, seen);
	} else {
		if (!isRecordValue(value)) throw new TypeError("non-JSON Tool arguments");
		const keys = Object.keys(value).sort();
		hash.update(`o${String(keys.length)}:`);
		for (const key of keys) {
			hashRetryText(hash, key);
			hashRetryValue(hash, value[key], seen);
		}
	}
	seen.delete(value);
}

function activityRecoveryKeys(
	name: string,
	args: Readonly<Record<string, unknown>>,
	items: readonly ToolActivityItem[],
): readonly string[] {
	const keys = new Set<string>();
	try {
		const hash = createHash("sha256");
		hashRetryValue(hash, args);
		keys.add(`retry\u0000${name}\u0000${hash.digest("base64url")}`);
	} catch {
		// Invalid non-JSON arguments simply cannot prove an exact retry.
	}
	for (const item of items) {
		for (const key of item.countKeys ?? []) keys.add(`effect\u0000${item.category}\u0000${key}`);
	}
	return [...keys];
}

function terminalStateFromResult(
	member: PlannedToolActivityMember,
	resultIsError: ((args: Readonly<Record<string, unknown>>, result: AgentToolResult<unknown>) => boolean) | undefined,
): ToolActivityState {
	if (!member.result) return member.terminalState ?? "running";
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
	private readonly envelopeCalls = new Map<string, string>();
	private readonly envelopeDecoders = new Map<string, SuiteToolEnvelopeDecoder>();
	private readonly groupHints = new Map<string, HintState>();
	private readonly groupPulses = new Map<string, GroupPulseState>();
	private groupPulseTimer: unknown | undefined;
	private readonly groupOrder: string[] = [];
	private readonly groups = new Map<string, PlannedToolActivityGroup>();
	private readonly groupSummaries = new Map<string, GroupSummaryIndex>();
	private invalidationGeneration = 0;
	private invalidationScheduled = false;
	private readonly membership = new Map<string, string>();
	private readonly memberIndexes = new Map<string, number>();
	private readonly liveResults = new Map<string, AgentToolResult<unknown>>();
	private readonly now: () => number;
	private openGroupLeaderId: string | undefined;
	private readonly pendingInvalidations = new Set<() => void>();
	private readonly pendingResults = new Map<string, AgentToolResult<unknown>>();
	private reloadActiveToolNames: readonly string[] | undefined;
	private indexedMessages: unknown[] = [];
	private readonly renderedToolNames = new Set<string>();
	private continuationLeaderId: string | undefined;
	private streamActive = false;
	private readonly streamedProseIndexes = new Set<number>();
	private readonly streamedToolCallSignatures = new Map<string, string>();
	private agentActive = false;
	private readonly scheduler: ToolUiTimerScheduler;
	private settings: ToolUiSettingsStore;
	private tailForcedClosed = false;
	private timer: unknown | undefined;
	private readonly timerStates = new Map<string, ToolTimerState>();

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
		if (this.renderedToolNames.has(name) && this.indexedMessages.length > 0) this.rebuildGroups();
	}

	registerEnvelope(name: string, decode: SuiteToolEnvelopeDecoder): void {
		this.envelopeDecoders.set(name, decode);
		if (this.indexedMessages.length > 0) this.rebuildGroups();
	}

	hasActivityMetadata(name: string): boolean {
		return this.activityPolicies.has(name);
	}

	markRendererAttached(name: string): void {
		if (this.renderedToolNames.has(name)) return;
		this.renderedToolNames.add(name);
		if (this.indexedMessages.length > 0) this.rebuildGroups();
	}

	markRendererDetached(name: string): void {
		if (!this.renderedToolNames.delete(name)) return;
		if (this.indexedMessages.length > 0) this.rebuildGroups();
	}

	hasActivityRenderer(name: string): boolean {
		return this.renderedToolNames.has(name);
	}

	missingActivityRenderers(toolNames: readonly string[]): readonly string[] {
		return toolNames.filter((name) => !this.renderedToolNames.has(name));
	}

	synchronizeRenderedTools(names: ReadonlySet<string>): void {
		let changed = names.size !== this.renderedToolNames.size;
		if (!changed) {
			for (const name of names) {
				if (!this.renderedToolNames.has(name)) {
					changed = true;
					break;
				}
			}
		}
		if (!changed) return;
		this.renderedToolNames.clear();
		for (const name of names) this.renderedToolNames.add(name);
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
		if (messages) {
			this.continuationLeaderId = undefined;
			this.indexedMessages = [...messages];
			this.rebuildGroups();
			return;
		}
		const leaderId = this.continuationLeaderId;
		this.continuationLeaderId = undefined;
		const group = leaderId ? this.groups.get(leaderId) : undefined;
		if (!leaderId || !group?.closed || group.members.some((member) => member.name === "bash")) return;
		const open = { ...group, closed: false };
		this.groups.set(leaderId, open);
		this.openGroupLeaderId = leaderId;
		this.reconcileGroup(open);
	}

	observeUserBoundary(): void {
		this.indexedMessages.push({ role: "user", content: [] });
		this.continuationLeaderId = undefined;
		this.tailForcedClosed = true;
		this.closeOpenGroup();
	}

	endTurn(): void {
		const group = this.openGroupLeaderId ? this.groups.get(this.openGroupLeaderId) : undefined;
		this.continuationLeaderId = group?.members.some((member) => member.name === "bash")
			? undefined
			: this.openGroupLeaderId;
		this.agentActive = false;
		this.tailForcedClosed = true;
		this.closeOpenGroup();
	}

	observeAssistantProse(): void {
		this.continuationLeaderId = undefined;
		this.tailForcedClosed = true;
		this.closeOpenGroup();
	}

	observeAssistantUpdate(message: unknown): void {
		if (typeof message !== "object" || message === null) return;
		const value = message as Record<string, unknown>;
		if (value["role"] !== "assistant" || !Array.isArray(value["content"])) return;
		if (!this.streamActive) {
			this.streamActive = true;
			this.streamedProseIndexes.clear();
			this.streamedToolCallSignatures.clear();
		}
		this.applyAssistantContent(value["content"], true, assistantTerminalState(value["stopReason"]));
	}

	observeAssistantEvent(event: AssistantMessageEvent): void {
		if (!this.streamActive) {
			this.streamActive = true;
			this.streamedProseIndexes.clear();
			this.streamedToolCallSignatures.clear();
		}
		if (event.type === "text_delta" || event.type === "text_end") {
			const text = event.type === "text_delta" ? event.delta : event.content;
			if (!text.trim() || this.streamedProseIndexes.has(event.contentIndex)) return;
			this.streamedProseIndexes.add(event.contentIndex);
			this.observeAssistantProse();
			return;
		}
		if (event.type !== "toolcall_end") return;
		const { id, name, arguments: args } = event.toolCall;
		if (!id || !name || !isRecordValue(args) || this.streamedToolCallSignatures.has(id)) return;
		this.streamedToolCallSignatures.set(id, "complete");
		if (!this.renderedToolNames.has(name)) {
			this.observeAssistantProse();
			return;
		}
		this.appendToolCall({ args, id, name });
	}

	indexMessages(messages: readonly unknown[], closeTail = !this.agentActive): void {
		this.pendingResults.clear();
		this.continuationLeaderId = undefined;
		this.indexedMessages = [...messages];
		this.tailForcedClosed = closeTail;
		this.rebuildGroups();
	}

	indexMessage(message: unknown): void {
		this.indexedMessages.push(message);
		this.applyMessage(message);
		if (
			typeof message === "object" &&
			message !== null &&
			(message as Record<string, unknown>)["role"] === "assistant"
		) {
			this.streamActive = false;
			this.streamedProseIndexes.clear();
			this.streamedToolCallSignatures.clear();
		}
	}

	observeEnvelopeResult(envelopeName: string, envelopeId: string, details: unknown): void {
		for (const operation of this.decodeEnvelope(envelopeName, details)) {
			const owner = this.envelopeCalls.get(operation.id);
			if (owner && owner !== envelopeId) continue;
			if (!owner) this.envelopeCalls.set(operation.id, envelopeId);
			if (!this.renderedToolNames.has(operation.name)) {
				if (!owner) {
					this.tailForcedClosed = true;
					this.closeOpenGroup();
				}
				continue;
			}
			if (operation.state === "running" && operation.result) {
				this.observeToolExecutionUpdate(operation.id, operation.result);
			}
			const result = envelopeOperationResult(operation);
			this.appendToolCall({
				args: operation.args,
				id: operation.id,
				name: operation.name,
				...(result ? { result } : {}),
			});
		}
	}

	observeToolExecutionStart(toolCallId: string): void {
		this.liveResults.delete(toolCallId);
		this.pendingResults.delete(toolCallId);
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
		this.updateToolResult(toolCallId, result);
	}

	resetProjection(messages: readonly unknown[]): void {
		this.suspend();
		this.envelopeCalls.clear();
		this.continuationLeaderId = undefined;
		this.groupHints.clear();
		this.activities.clear();
		this.pendingResults.clear();
		this.indexedMessages = [...messages];
		this.streamActive = false;
		this.streamedProseIndexes.clear();
		this.streamedToolCallSignatures.clear();
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
		this.envelopeCalls.clear();
		for (const binding of this.bindings.values()) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
		this.bindings.clear();
		this.groups.clear();
		this.groupSummaries.clear();
		this.groupOrder.splice(0);
		this.membership.clear();
		this.memberIndexes.clear();
		this.liveResults.clear();
		this.pendingResults.clear();
		this.groupHints.clear();
		this.indexedMessages = [];
		this.openGroupLeaderId = undefined;
		this.continuationLeaderId = undefined;
		this.streamActive = false;
		this.streamedProseIndexes.clear();
		this.streamedToolCallSignatures.clear();
		this.agentActive = false;
		this.tailForcedClosed = false;
		this.activities.clear();
	}

	suspend(): void {
		for (const toolCallId of [...this.timerStates.keys()]) this.stopTimer(toolCallId);
		for (const leaderId of [...this.groupPulses.keys()]) this.stopGroupPulse(leaderId);
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
		const firstBinding = !binding;
		if (!binding) {
			binding = {
				baseModel: model,
				baseVisible: visible,
				expanded,
				invalidate: () => {},
				metadata: projectedMetadata,
				row,
			};
		} else {
			binding.row = row;
			binding.baseModel = model;
			binding.baseVisible = visible;
			binding.expanded = expanded;
			binding.invalidate = invalidate;
			binding.metadata = projectedMetadata;
		}
		this.bindings.delete(toolCallId);
		this.bindings.set(toolCallId, binding);
		this.reconcileGroupForTool(toolCallId, projectedMetadata.result !== this.projectedResult(toolCallId));
		if (firstBinding) binding.invalidate = invalidate;
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
		binding.row = row;
		binding.baseModel = model;
		binding.baseVisible = visible;
		binding.expanded = expanded;
		binding.invalidate = invalidate;
		binding.metadata = metadata;
		this.bindings.delete(toolCallId);
		this.bindings.set(toolCallId, binding);
		if (expanded) this.reconcileGroupForTool(toolCallId, false);
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
		const existing = this.timerStates.get(toolCallId);
		const visible = existing?.visible ?? true;
		if (existing) this.timerStates.delete(toolCallId);
		while (this.timerStates.size >= TIMER_STATE_LIMIT) {
			const oldestId = this.timerStates.keys().next().value as string | undefined;
			if (!oldestId) break;
			const oldest = this.timerStates.get(oldestId);
			this.timerStates.delete(oldestId);
			oldest?.setMarkerVisible(true);
			this.pulseGroup(oldestId, true);
			this.reconcileGroupForTool(oldestId);
		}
		this.timerStates.set(toolCallId, { invalidate, setMarkerVisible, visible });
		setMarkerVisible(visible);
		if (this.isGroupMarkerDriver(toolCallId)) this.pulseGroup(toolCallId, visible);
		if (this.timer === undefined) {
			this.timer = this.scheduler.setInterval(() => this.tickTimers(), 600);
		}
		this.reconcileGroupForTool(toolCallId);
	}

	stopTimer(toolCallId: string): void {
		const state = this.timerStates.get(toolCallId);
		if (!state) return;
		this.timerStates.delete(toolCallId);
		state.setMarkerVisible(true);
		if (this.timerStates.size === 0 && this.timer !== undefined) {
			this.scheduler.clearInterval(this.timer);
			this.timer = undefined;
		}
		this.pulseGroup(toolCallId, true);
		this.reconcileGroupForTool(toolCallId);
	}

	syncTimers(): void {
		for (const [toolCallId, state] of this.timerStates) {
			state.visible = true;
			state.setMarkerVisible(true);
			this.pulseGroup(toolCallId, true);
			state.invalidate();
		}
		this.reconcileTimerGroups();
	}

	private tickTimers(): void {
		for (const [toolCallId, state] of this.timerStates) {
			state.visible = !state.visible;
			state.setMarkerVisible(state.visible);
			if (this.isGroupMarkerDriver(toolCallId)) this.pulseGroup(toolCallId, state.visible);
			state.invalidate();
		}
		this.reconcileTimerGroups();
	}

	private reconcileTimerGroups(): void {
		const groups = new Set<string>();
		for (const toolCallId of this.timerStates.keys()) {
			const leaderId = this.membership.get(toolCallId);
			if (leaderId) groups.add(leaderId);
			else this.reconcileGroupForTool(toolCallId);
		}
		for (const leaderId of groups) this.reconcileGroup(this.groups.get(leaderId));
	}

	listGroups(): readonly ToolActivityGroupView[] {
		return this.allGroupViews()
			.sort((left, right) => right.order - left.order)
			.slice(0, GROUP_LIST_LIMIT)
			.map(({ order: _order, ...group }) => group);
	}

	private allGroupViews(): Array<ToolActivityGroupView & { order: number }> {
		const grouped = this.groupOrder
			.map((id) => this.groupView(this.groups.get(id)))
			.filter((group): group is ToolActivityGroupView => group !== undefined)
			.map((group, order) => ({
				...(group.summary ? group : { ...group, summary: "Internal activity" }),
				order,
			}));
		const covered = new Set(grouped.flatMap((group) => group.memberIds));
		const standalone = this.activities
			.list()
			.filter((activity) => !covered.has(activity.id))
			.map((activity) => ({
				id: activity.id,
				memberIds: [activity.id],
				order: this.groupOrder.length + activity.sequence,
				state: toolActivityOutcome(activity.state),
				summary: activity.label,
			}));
		return [...grouped, ...standalone];
	}

	resolveGroup(query: string): ToolActivityGroupView | "ambiguous" | undefined {
		const normalized = query.trim();
		if (!normalized) return undefined;
		const matches = this.allGroupViews().filter(
			(group) =>
				group.id === normalized ||
				group.id.startsWith(normalized) ||
				group.memberIds.some((memberId) => memberId === normalized || memberId.startsWith(normalized)),
		);
		if (matches.length !== 1) return matches.length > 1 ? "ambiguous" : undefined;
		const { order: _order, ...group } = matches[0] as ToolActivityGroupView & { order: number };
		return group;
	}

	groupActivities(groupId: string): readonly ToolActivity[] {
		return this.groupActivityPage(groupId, 0, Number.POSITIVE_INFINITY);
	}

	projectedResult(toolCallId: string): AgentToolResult<unknown> | undefined {
		const leaderId = this.membership.get(toolCallId);
		const memberIndex = this.memberIndexes.get(toolCallId);
		return leaderId === undefined || memberIndex === undefined
			? undefined
			: this.groups.get(leaderId)?.members[memberIndex]?.result;
	}

	groupActivityPage(groupId: string, offset: number, limit: number): readonly ToolActivity[] {
		const start = Math.max(0, Math.floor(offset));
		const requested = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.MAX_SAFE_INTEGER;
		const group = this.groups.get(groupId);
		if (!group) {
			const standalone = this.activities.get(groupId);
			return standalone && start === 0 && requested > 0 ? [standalone] : [];
		}
		return group.members.slice(start, start + requested).map((member) => {
			const activity = this.activities.get(member.id);
			return activity && (activity.state === "running" || activity.detailLines.length || !member.result)
				? activity
				: this.activityFromPlan(member);
		});
	}

	private decodeEnvelope(name: string, details: unknown): readonly SuiteToolEnvelopeOperation[] {
		const decode = this.envelopeDecoders.get(name);
		if (!decode) return [];
		return decodeEnvelopeOperations(decode, details);
	}

	private projectedMessages(): readonly unknown[] {
		if (this.envelopeDecoders.size === 0) return this.indexedMessages;
		const envelopeNamesById = new Map<string, string>();
		for (const candidate of this.indexedMessages) {
			if (!isRecordValue(candidate) || candidate["role"] !== "assistant" || !Array.isArray(candidate["content"])) {
				continue;
			}
			for (const block of candidate["content"]) {
				if (!isRecordValue(block) || block["type"] !== "toolCall") continue;
				const id = block["id"];
				const name = block["name"];
				if (typeof id === "string" && typeof name === "string" && this.envelopeDecoders.has(name)) {
					envelopeNamesById.set(id, name);
				}
			}
		}
		const operationsById = new Map<string, readonly SuiteToolEnvelopeOperation[]>();
		for (const candidate of this.indexedMessages) {
			if (!isRecordValue(candidate) || candidate["role"] !== "toolResult") continue;
			const id = candidate["toolCallId"];
			if (typeof id !== "string") continue;
			const name = envelopeNamesById.get(id);
			if (!name) continue;
			operationsById.set(id, this.decodeEnvelope(name, candidate["details"]));
		}
		const projected: unknown[] = [];
		for (const candidate of this.indexedMessages) {
			if (!isRecordValue(candidate)) {
				projected.push(candidate);
				continue;
			}
			if (candidate["role"] === "assistant" && Array.isArray(candidate["content"])) {
				const content = candidate["content"].flatMap((block) => {
					if (!isRecordValue(block) || block["type"] !== "toolCall") return [block];
					const id = block["id"];
					const name = block["name"];
					if (typeof id !== "string" || typeof name !== "string" || !this.envelopeDecoders.has(name)) {
						return [block];
					}
					return (operationsById.get(id) ?? []).map((operation) => ({
						arguments: operation.args,
						id: operation.id,
						name: operation.name,
						type: "toolCall",
					}));
				});
				projected.push({ ...candidate, content });
				continue;
			}
			if (candidate["role"] === "toolResult") {
				const id = candidate["toolCallId"];
				const operations = typeof id === "string" ? operationsById.get(id) : undefined;
				if (!operations) {
					projected.push(candidate);
					continue;
				}
				for (const operation of operations) {
					const result = envelopeOperationResult(operation);
					if (!result) continue;
					projected.push({
						role: "toolResult",
						toolCallId: operation.id,
						toolName: operation.name,
						content: result.content,
						details: result.details,
						...(result.isError === true ? { isError: true } : {}),
					});
				}
				continue;
			}
			projected.push(candidate);
		}
		return projected;
	}

	private rebuildGroups(): void {
		this.groups.clear();
		this.groupSummaries.clear();
		this.groupOrder.splice(0);
		this.membership.clear();
		this.memberIndexes.clear();
		this.openGroupLeaderId = undefined;
		const closeTail = !this.agentActive || this.tailForcedClosed;
		const planned = planToolActivityGroups(this.projectedMessages(), this.renderedToolNames, closeTail);
		for (const group of planned) {
			this.groups.set(group.leaderId, group);
			this.groupOrder.push(group.leaderId);
			group.members.forEach((member, index) => {
				this.membership.set(member.id, group.leaderId);
				this.memberIndexes.set(member.id, index);
			});
			if (!group.closed) this.openGroupLeaderId = group.leaderId;
		}
		for (const group of planned) this.reconcileGroup(group);
		for (const [toolCallId, binding] of this.bindings) {
			if (!this.membership.has(toolCallId)) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
		}
		for (const key of [...this.groupHints.keys()]) {
			if (!this.groups.has(key)) this.groupHints.delete(key);
		}
		for (const leaderId of [...this.groupPulses.keys()]) {
			if (!this.groups.has(leaderId)) this.stopGroupPulse(leaderId);
		}
	}

	private applyMessage(message: unknown): void {
		if (typeof message !== "object" || message === null) return;
		const value = message as Record<string, unknown>;
		const role = value["role"];
		if (role === "assistant" && Array.isArray(value["content"])) {
			this.applyAssistantContent(value["content"], false, assistantTerminalState(value["stopReason"]));
			return;
		}
		if (role === "toolResult") {
			const id = value["toolCallId"];
			const content = value["content"];
			if (typeof id !== "string" || !Array.isArray(content)) return;
			this.updateToolResult(id, {
				content: content as AgentToolResult<unknown>["content"],
				...(value["details"] !== undefined ? { details: value["details"] } : { details: undefined }),
				...(value["isError"] === true ? { isError: true } : {}),
			});
			return;
		}
		if (role === "user" || role === "bashExecution" || (role === "custom" && value["display"] === true)) {
			this.continuationLeaderId = undefined;
			this.tailForcedClosed = true;
			this.closeOpenGroup();
		}
	}

	private applyAssistantContent(
		content: readonly unknown[],
		streaming: boolean,
		terminalState?: "cancelled" | "error",
	): void {
		for (let index = 0; index < content.length; index += 1) {
			const block = content[index];
			if (typeof block !== "object" || block === null) continue;
			const item = block as Record<string, unknown>;
			if (item["type"] === "text" && typeof item["text"] === "string" && item["text"].trim()) {
				if (
					streaming
						? this.streamedProseIndexes.has(index)
						: this.streamActive && this.streamedProseIndexes.has(index)
				) {
					continue;
				}
				this.streamedProseIndexes.add(index);
				this.continuationLeaderId = undefined;
				this.tailForcedClosed = true;
				this.closeOpenGroup();
				continue;
			}
			if (item["type"] !== "toolCall") continue;
			const id = item["id"];
			const name = item["name"];
			const args = item["arguments"];
			if (typeof id !== "string" || !id || typeof name !== "string" || !name || !isRecordValue(args)) continue;
			const trackedSnapshot = streaming || this.streamActive;
			const signature = trackedSnapshot ? JSON.stringify([name, args, terminalState ?? ""]) : "";
			const previousSignature = trackedSnapshot ? this.streamedToolCallSignatures.get(id) : undefined;
			if (trackedSnapshot && previousSignature === signature) continue;
			if (trackedSnapshot) this.streamedToolCallSignatures.set(id, signature);
			if (!this.renderedToolNames.has(name)) {
				if (previousSignature === undefined) {
					this.continuationLeaderId = undefined;
					this.tailForcedClosed = true;
					this.closeOpenGroup();
				}
				continue;
			}
			this.appendToolCall({ args, id, name, ...(terminalState ? { terminalState } : {}) });
		}
	}

	private appendToolCall(member: PlannedToolActivityMember, preferMemberResult = false): void {
		const existingLeaderId = this.membership.get(member.id);
		if (existingLeaderId) {
			const group = this.groups.get(existingLeaderId);
			const memberIndex = this.memberIndexes.get(member.id);
			if (!group || memberIndex === undefined) return;
			const previous = group.members[memberIndex];
			const result = preferMemberResult
				? (member.result ?? previous?.result ?? this.pendingResults.get(member.id))
				: (previous?.result ?? member.result ?? this.pendingResults.get(member.id));
			const terminalState = result ? undefined : (member.terminalState ?? previous?.terminalState);
			const completeMember: PlannedToolActivityMember = {
				args: member.args,
				id: member.id,
				name: member.name,
				...(result ? { result } : {}),
				...(terminalState ? { terminalState } : {}),
			};
			this.mutableMembers(group)[memberIndex] = completeMember;
			this.pendingResults.delete(member.id);
			this.reconcileGroup(group, member.id);
			if (terminalState) this.stopTimer(member.id);
			return;
		}
		if (member.name === "bash") this.closeOpenGroup();
		let group = this.openGroupLeaderId ? this.groups.get(this.openGroupLeaderId) : undefined;
		const result = member.result ?? this.pendingResults.get(member.id);
		const terminalState = result ? undefined : member.terminalState;
		const completeMember: PlannedToolActivityMember = {
			args: member.args,
			id: member.id,
			name: member.name,
			...(result ? { result } : {}),
			...(terminalState ? { terminalState } : {}),
		};
		this.pendingResults.delete(member.id);
		if (!group || group.closed) {
			group = {
				closed: member.name === "bash" || !this.agentActive,
				leaderId: member.id,
				members: [completeMember],
			};
			this.groups.set(group.leaderId, group);
			this.groupOrder.push(group.leaderId);
			if (!group.closed) this.openGroupLeaderId = group.leaderId;
		} else {
			this.mutableMembers(group).push(completeMember);
		}
		const index = group.members.length - 1;
		this.membership.set(member.id, group.leaderId);
		this.memberIndexes.set(member.id, index);
		this.tailForcedClosed = group.closed;
		this.reconcileGroup(group, member.id);
		if (terminalState) this.stopTimer(member.id);
	}

	private updateToolResult(id: string, result: AgentToolResult<unknown>): void {
		const leaderId = this.membership.get(id);
		const group = leaderId ? this.groups.get(leaderId) : undefined;
		const memberIndex = this.memberIndexes.get(id);
		if (!group || memberIndex === undefined) {
			const binding = this.bindings.get(id);
			if (binding && this.renderedToolNames.has(binding.metadata.name)) {
				this.pendingResults.set(id, result);
				while (this.pendingResults.size > PENDING_RESULT_LIMIT) {
					const oldest = this.pendingResults.keys().next().value as string | undefined;
					if (oldest === undefined) break;
					this.pendingResults.delete(oldest);
				}
			}
			return;
		}
		const previous = group.members[memberIndex];
		if (!previous) return;
		this.mutableMembers(group)[memberIndex] = { ...previous, result };
		this.reconcileGroup(group, id);
	}

	private closeOpenGroup(): void {
		const leaderId = this.openGroupLeaderId;
		if (!leaderId) return;
		const group = this.groups.get(leaderId);
		this.openGroupLeaderId = undefined;
		if (!group || group.closed) return;
		const closed = { ...group, closed: true };
		this.groups.set(leaderId, closed);
		this.reconcileGroup(closed);
	}

	private mutableMembers(group: PlannedToolActivityGroup): PlannedToolActivityMember[] {
		return group.members as PlannedToolActivityMember[];
	}

	private reconcileGroupForTool(toolCallId: string, semanticChange = true): void {
		const leaderId = this.membership.get(toolCallId);
		if (!leaderId) {
			const binding = this.bindings.get(toolCallId);
			if (binding) this.applyBinding(binding, binding.baseModel, binding.baseVisible);
			return;
		}
		this.reconcileGroup(this.groups.get(leaderId), semanticChange ? toolCallId : undefined);
	}

	private reconcileGroup(group: PlannedToolActivityGroup | undefined, changedMemberId?: string): void {
		if (!group) return;
		const leader = this.bindings.get(group.leaderId);
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
		const standaloneBash = group.members.length === 1 && group.members[0]?.name === "bash";
		if (leader.expanded && !standaloneBash) {
			this.stopGroupPulse(group.leaderId);
			for (const member of group.members) {
				const binding = this.bindings.get(member.id);
				if (binding) this.applyBinding(binding, binding.baseModel, true);
			}
			return;
		}
		if (standaloneBash) {
			const member = group.members[0];
			if (!member) return;
			const binding = this.bindings.get(member.id);
			if (!binding) return;
			const summaryMember = this.summaryMember(member);
			const output = this.bashOutput(binding, member.result ?? binding.metadata.result, binding.expanded);
			const model: BashOperationRowModel = {
				active: summaryMember.state === "running",
				command:
					typeof member.args["command"] === "string" ? member.args["command"] : String(member.args["value"] ?? ""),
				expandable: true,
				expanded: binding.expanded,
				kind: "bash-operation",
				output: output.text,
				outputTruncated: output.truncated,
				state: summaryMember.state,
			};
			this.stopGroupPulse(group.leaderId);
			const modelChanged = binding.row.setModel(model);
			const visibilityChanged = binding.row.setVisible(true);
			if (modelChanged || visibilityChanged) this.scheduleInvalidation(binding.invalidate);
			return;
		}
		const summary = summarizeToolActivityAggregate(index.aggregate(), group.closed);
		this.reconcileGroupPulse(group, summary.active);
		const issueHint = this.issueHint(index);
		const elapsedHint = this.elapsedHint(group);
		const hint = issueHint || elapsedHint || this.stableTarget(group.leaderId, summary.target, summary.active);
		const model: ActivityGroupRowModel = {
			active: summary.active,
			expandable: true,
			hint,
			kind: "activity",
			outcome: summary.outcome,
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

	private bashOutput(
		binding: GroupedRowBinding,
		result: AgentToolResult<unknown> | undefined,
		expanded: boolean,
	): { readonly text: string; readonly truncated: boolean } {
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

	private summaryIndex(group: PlannedToolActivityGroup, changedMemberId?: string): GroupSummaryIndex {
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
			const memberIndex = this.memberIndexes.get(changedMemberId);
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
			...(binding?.metadata ?? {}),
			args: binding?.metadata.args ?? member.args,
			name: member.name,
			...(member.result ? { result: member.result } : {}),
		};
		const classifiedItems = forcedTerminal ? [] : this.classify(metadata, state);
		const items = visibleActivityItems(classifiedItems, state);
		const infrastructureIssue =
			isIssueState(state) && items.length === 0 && this.activityPolicies.get(member.name)?.silentSuccess === true;
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
		return {
			...(issueDetail ? { issueDetail } : {}),
			...(issueLabel ? { issueLabel } : {}),
			items,
			recoveryKeys: activityRecoveryKeys(member.name, metadata.args, classifiedItems),
			state,
		};
	}

	private issueDetail(
		name: string,
		args: Readonly<Record<string, unknown>>,
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
			const classified = policy.classify({
				args: metadata.args,
				...(metadata.cwd ? { cwd: metadata.cwd } : {}),
				...(metadata.result ? { result: metadata.result } : {}),
				state,
			});
			const items = classified.map((item) =>
				item.countKeys
					? {
							...item,
							countKeys: item.countKeys.map((key) => canonicalCountKey(item.category, key, metadata.cwd)),
						}
					: item,
			);
			return items;
		} catch {
			return [];
		}
	}

	private issueHint(index: GroupSummaryIndex): string {
		const issueSummary = index.issue();
		if (!issueSummary.id || !issueSummary.detail) return "";
		const remaining = Math.max(0, issueSummary.count - 1);
		return oneLine(`${issueSummary.detail}${remaining > 0 ? ` · +${String(remaining)} issues` : ""}`);
	}

	private elapsedHint(group: PlannedToolActivityGroup): string {
		for (let index = group.members.length - 1; index >= 0; index -= 1) {
			const binding = this.bindings.get(group.members[index]?.id ?? "");
			if (binding?.baseModel.state !== "running") continue;
			if ((binding.baseModel.durationMs ?? 0) < 2_000) return "";
			return oneLine(binding.baseModel.summary);
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
		const hasToolTimer = group.members.some((member) => this.timerStates.has(member.id));
		if (!active || hasToolTimer) {
			this.stopGroupPulse(group.leaderId);
			return;
		}
		if (this.groupPulses.has(group.leaderId)) return;
		this.groupPulses.set(group.leaderId, { visible: true });
		if (this.groupPulseTimer === undefined) {
			this.groupPulseTimer = this.scheduler.setInterval(() => this.tickGroupPulses(), 600);
		}
	}

	private stopGroupPulse(leaderId: string): void {
		if (!this.groupPulses.delete(leaderId)) return;
		if (this.groupPulses.size === 0 && this.groupPulseTimer !== undefined) {
			this.scheduler.clearInterval(this.groupPulseTimer);
			this.groupPulseTimer = undefined;
		}
		const leader = this.bindings.get(leaderId);
		if (leader?.row.setMarkerVisible(true)) this.scheduleInvalidation(leader.invalidate);
	}

	private tickGroupPulses(): void {
		for (const [leaderId, pulse] of this.groupPulses) {
			pulse.visible = !pulse.visible;
			const leader = this.bindings.get(leaderId);
			if (leader?.row.setMarkerVisible(pulse.visible)) this.scheduleInvalidation(leader.invalidate);
			this.reconcileGroupForTool(leaderId);
		}
	}

	private trimBindings(currentToolCallId: string): void {
		const protectedIds = new Set([currentToolCallId]);
		const leaderId = this.membership.get(currentToolCallId);
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

	private groupView(group: PlannedToolActivityGroup | undefined): ToolActivityGroupView | undefined {
		if (!group) return undefined;
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
		const classifiedItems =
			member.terminalState && !member.result
				? []
				: this.classify(
						{
							args: member.args,
							name: member.name,
							...(member.result ? { result: member.result } : {}),
						},
						state,
					);
		const items = visibleActivityItems(classifiedItems, state);
		const summary = summarizeToolActivityGroup([{ items, state }], state !== "running");
		const fallback: AgentToolResult<unknown> = {
			content: [
				{
					type: "text",
					text:
						state === "cancelled"
							? "(cancelled before execution)"
							: state === "error"
								? "(failed before execution)"
								: "(pending)",
				},
			],
			details: undefined,
		};
		return {
			detailLines: buildToolDetailLines(member.args, member.result ?? fallback),
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
	return getHostSharedResource(
		pi.events,
		registry as WeakMap<object, ToolUiRuntime>,
		TOOL_RUNTIME_DISCOVERY_EVENT,
		() => new ToolUiRuntime(),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
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
	readonly registry: SuiteToolDefinitionRegistry;
	readonly surface: SuiteToolSurfaceController;
	readonly toolNames: ReadonlySet<string>;
}

function suiteActivityRendererMarker(tool: unknown): SuiteActivityRendererMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	if (typeof tool["renderCall"] !== "function" || typeof tool["renderResult"] !== "function") return undefined;
	const marker = Reflect.get(tool, SUITE_ACTIVITY_RENDERER);
	return isRecordValue(marker) && isRecordValue(marker["activity"])
		? (marker as unknown as SuiteActivityRendererMarker)
		: undefined;
}

function hasSuiteActivityRenderer(tool: unknown): boolean {
	return suiteActivityRendererMarker(tool) !== undefined;
}

function suiteToolEnvelopeMarker(tool: unknown): SuiteToolEnvelopeMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Reflect.get(tool, SUITE_TOOL_ENVELOPE);
	if (!isRecordValue(marker) || typeof marker["decode"] !== "function" || !isRecordValue(marker["registry"])) {
		return undefined;
	}
	return marker as unknown as SuiteToolEnvelopeMarker;
}

const CAPTURED_TOOL_EVENTS = new Set([
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);

type CapturedToolHandler = (event: Record<string, unknown>, context: ExtensionContext) => unknown | Promise<unknown>;

function uniqueToolNames(names: readonly string[]): string[] {
	return [...new Set(names)];
}

function errorToolResult(error: unknown): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
		details: {},
	};
}

/** Observe every Tool registered by Suite modules without changing the Host API. */
export function createSuiteToolRegistrationTracker(pi: ExtensionAPI): SuiteToolRegistrationTracker {
	const capturedHandlers = new Map<string, CapturedToolHandler[]>();
	const envelopeTools = new Set<string>();
	const toolNames = new Set<string>();
	const tools = new Map<string, ToolDefinition>();
	let enabledEnvelope: string | undefined;
	let virtualActiveTools: string[] | undefined;

	const projectActiveTools = (names: readonly string[], envelope: string): string[] => {
		const projected: string[] = [];
		let inserted = false;
		for (const name of uniqueToolNames(names)) {
			if (envelopeTools.has(name)) continue;
			if (tools.has(name)) {
				if (!inserted) {
					projected.push(envelope);
					inserted = true;
				}
				continue;
			}
			projected.push(name);
		}
		if (!inserted) projected.push(envelope);
		return projected;
	};
	const applyActiveProjection = (): void => {
		if (!enabledEnvelope || !virtualActiveTools) return;
		pi.setActiveTools(projectActiveTools(virtualActiveTools, enabledEnvelope));
	};
	const getActiveTools: ExtensionAPI["getActiveTools"] = () =>
		enabledEnvelope && virtualActiveTools ? [...virtualActiveTools] : pi.getActiveTools();
	const setActiveTools: ExtensionAPI["setActiveTools"] = (names) => {
		if (!enabledEnvelope) {
			pi.setActiveTools(names);
			return;
		}
		virtualActiveTools = uniqueToolNames(names.filter((name) => !envelopeTools.has(name)));
		applyActiveProjection();
	};
	const on = ((event: string, handler: CapturedToolHandler) => {
		if (CAPTURED_TOOL_EVENTS.has(event)) {
			const handlers = capturedHandlers.get(event) ?? [];
			handlers.push(handler);
			capturedHandlers.set(event, handlers);
		}
		(pi.on as unknown as (name: string, value: CapturedToolHandler) => void)(event, handler);
	}) as unknown as ExtensionAPI["on"];

	const dispatchInformational = async (
		event: "tool_execution_end" | "tool_execution_start" | "tool_execution_update",
		value: Record<string, unknown>,
		context: ExtensionContext,
	): Promise<void> => {
		for (const handler of capturedHandlers.get(event) ?? []) {
			try {
				await handler(value, context);
			} catch {
				// Pi reports lifecycle handler failures without changing Tool execution.
			}
		}
	};
	const invoke = async (invocation: SuiteToolInvocation): Promise<SuiteToolInvocationResult> => {
		const tool = tools.get(invocation.name);
		if (!tool) throw new Error(`Unknown Suite Tool: ${invocation.name}`);
		if (!registry.isActive(invocation.name)) throw new Error(`Suite Tool is inactive: ${invocation.name}`);
		await dispatchInformational(
			"tool_execution_start",
			{
				args: invocation.input,
				toolCallId: invocation.toolCallId,
				toolName: invocation.name,
				type: "tool_execution_start",
			},
			invocation.context,
		);

		let prepared: unknown;
		try {
			prepared = tool.prepareArguments ? tool.prepareArguments(invocation.input) : invocation.input;
			prepared = validateToolArguments(
				tool as never,
				{
					arguments: prepared,
					id: invocation.toolCallId,
					name: invocation.name,
					type: "toolCall",
				} as never,
			);
			if (!isRecordValue(prepared)) throw new Error(`Suite Tool ${invocation.name} requires object arguments`);
		} catch (error) {
			const result = errorToolResult(error);
			await dispatchInformational(
				"tool_execution_end",
				{
					isError: true,
					result,
					toolCallId: invocation.toolCallId,
					toolName: invocation.name,
					type: "tool_execution_end",
				},
				invocation.context,
			);
			return { isError: true, result };
		}

		const callEvent: Record<string, unknown> = {
			input: prepared,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_call",
		};
		try {
			for (const handler of capturedHandlers.get("tool_call") ?? []) {
				const decision = await handler(callEvent, invocation.context);
				if (!isRecordValue(decision) || decision["block"] !== true) continue;
				const result = errorToolResult(
					typeof decision["reason"] === "string" ? decision["reason"] : "Tool execution was blocked",
				);
				if (decision["terminate"] === true) Reflect.set(result, "terminate", true);
				await dispatchInformational(
					"tool_execution_end",
					{
						isError: true,
						result,
						toolCallId: invocation.toolCallId,
						toolName: invocation.name,
						type: "tool_execution_end",
					},
					invocation.context,
				);
				return { isError: true, result };
			}
		} catch (error) {
			const result = errorToolResult(error);
			await dispatchInformational(
				"tool_execution_end",
				{
					isError: true,
					result,
					toolCallId: invocation.toolCallId,
					toolName: invocation.name,
					type: "tool_execution_end",
				},
				invocation.context,
			);
			return { isError: true, result };
		}
		if (invocation.signal?.aborted) {
			const result = errorToolResult("Operation aborted");
			await dispatchInformational(
				"tool_execution_end",
				{
					isError: true,
					result,
					toolCallId: invocation.toolCallId,
					toolName: invocation.name,
					type: "tool_execution_end",
				},
				invocation.context,
			);
			return { isError: true, result };
		}

		const updateEvents: Promise<void>[] = [];
		let acceptingUpdates = true;
		let result: AgentToolResult<unknown>;
		let isError = false;
		const activeBefore = getActiveTools();
		try {
			result = await tool.execute(
				invocation.toolCallId,
				prepared as never,
				invocation.signal,
				(partialResult) => {
					if (!acceptingUpdates) return;
					try {
						invocation.onUpdate?.(partialResult as AgentToolResult<unknown>);
					} catch {
						// Rendering updates do not change nested Tool execution.
					}
					updateEvents.push(
						dispatchInformational(
							"tool_execution_update",
							{
								args: prepared,
								partialResult,
								toolCallId: invocation.toolCallId,
								toolName: invocation.name,
								type: "tool_execution_update",
							},
							invocation.context,
						),
					);
				},
				invocation.context,
			);
			acceptingUpdates = false;
			const activeAfter = getActiveTools();
			if (activeBefore.every((name) => activeAfter.includes(name))) {
				const beforeNames = new Set(activeBefore);
				const addedToolNames = activeAfter.filter((name) => !beforeNames.has(name));
				if (addedToolNames.length > 0) {
					result = {
						...result,
						addedToolNames: [...new Set([...(result.addedToolNames ?? []), ...addedToolNames])],
					};
				}
			}
		} catch (error) {
			acceptingUpdates = false;
			result = errorToolResult(error);
			isError = true;
		} finally {
			acceptingUpdates = false;
		}
		await Promise.all(updateEvents);

		const resultEvent: Record<string, unknown> = {
			content: result.content ?? [],
			details: result.details,
			input: prepared,
			isError,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_result",
			...(result.usage ? { usage: result.usage } : {}),
		};
		for (const handler of capturedHandlers.get("tool_result") ?? []) {
			try {
				const replacement = await handler(resultEvent, invocation.context);
				if (!isRecordValue(replacement)) continue;
				for (const key of ["content", "details", "isError", "usage"] as const) {
					if (replacement[key] !== undefined) resultEvent[key] = replacement[key];
				}
			} catch {
				// Pi reports result-handler failures and keeps the previous result.
			}
		}
		result = {
			...result,
			content: resultEvent["content"] as AgentToolResult<unknown>["content"],
			details: resultEvent["details"],
			...(resultEvent["usage"] === undefined ? {} : { usage: resultEvent["usage"] as never }),
		};
		isError = resultEvent["isError"] === true;
		await dispatchInformational(
			"tool_execution_end",
			{
				isError,
				result,
				toolCallId: invocation.toolCallId,
				toolName: invocation.name,
				type: "tool_execution_end",
			},
			invocation.context,
		);
		return { isError, result };
	};
	const registry: SuiteToolDefinitionRegistry = {
		get: (name) => tools.get(name),
		invoke,
		isActive: (name) =>
			tools.has(name) &&
			(enabledEnvelope && virtualActiveTools
				? virtualActiveTools.includes(name)
				: pi.getActiveTools().includes(name)),
		list: () => [...tools.values()],
	};
	const surface: SuiteToolSurfaceController = {
		disableEnvelope(name) {
			if (enabledEnvelope === name && virtualActiveTools) {
				const restore = virtualActiveTools;
				enabledEnvelope = undefined;
				virtualActiveTools = undefined;
				pi.setActiveTools(restore);
				return;
			}
			if (!enabledEnvelope && envelopeTools.has(name)) {
				pi.setActiveTools(pi.getActiveTools().filter((toolName) => toolName !== name));
			}
		},
		enableEnvelope(name) {
			if (!envelopeTools.has(name)) throw new Error(`Unknown Suite Tool envelope: ${name}`);
			if (enabledEnvelope && enabledEnvelope !== name) {
				throw new Error(`Suite Tool envelope ${enabledEnvelope} is already enabled`);
			}
			if (!enabledEnvelope) {
				virtualActiveTools = uniqueToolNames(
					pi.getActiveTools().filter((toolName) => !envelopeTools.has(toolName)),
				);
				enabledEnvelope = name;
			}
			applyActiveProjection();
		},
		isEnvelopeEnabled: (name) => enabledEnvelope === name,
	};
	const registerTool: ExtensionAPI["registerTool"] = (tool) => {
		const envelope = suiteToolEnvelopeMarker(tool);
		pi.registerTool(tool);
		const runtime = getToolUiRuntime(pi);
		if (envelope) {
			envelopeTools.add(tool.name);
			runtime.registerEnvelope(tool.name, envelope.decode);
			applyActiveProjection();
			return;
		}
		toolNames.add(tool.name);
		tools.set(tool.name, tool as ToolDefinition);
		if (enabledEnvelope && virtualActiveTools && pi.getActiveTools().includes(tool.name)) {
			virtualActiveTools = uniqueToolNames([...virtualActiveTools, tool.name]);
			applyActiveProjection();
		}
		if (hasSuiteActivityRenderer(tool)) runtime.markRendererAttached(tool.name);
		else runtime.markRendererDetached(tool.name);
	};
	const api = new Proxy(pi, {
		get(target, property) {
			if (property === "getActiveTools") return getActiveTools;
			if (property === "on") return on;
			if (property === "registerTool") return registerTool;
			if (property === "setActiveTools") return setActiveTools;
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { api, registry, surface, toolNames };
}

/** Fail fast when a Suite-owned Tool bypasses or under-declares the required Activity contract. */
export function assertSuiteToolActivityCoverage(
	pi: ExtensionAPI,
	declaredToolNames: readonly string[],
	registeredToolNames?: ReadonlySet<string>,
	optionalToolNames: readonly string[] = [],
	deferredToolNames: readonly string[] = [],
): void {
	const finalTools = new Map(pi.getAllTools().map((tool) => [tool.name, tool] as const));
	const runtime = getToolUiRuntime(pi);
	let metadataToolNames = [...declaredToolNames, ...deferredToolNames];
	let rendererToolNames = [
		...declaredToolNames,
		...deferredToolNames.filter((name) => runtime.hasActivityRenderer(name)),
	];
	if (registeredToolNames) {
		const declared = new Set([...declaredToolNames, ...deferredToolNames, ...optionalToolNames]);
		// A module may be intentionally idempotent when the Suite is loaded
		// twice in one Host. Count Tools that are already installed on the shared
		// Extension API as present, while still using this invocation's tracker to
		// reject newly registered undeclared Tools.
		const available = new Set(finalTools.keys());
		const undeclared = [...registeredToolNames].filter((name) => !declared.has(name)).sort();
		if (undeclared.length > 0) {
			throw new Error(`Suite registered undeclared Tools: ${undeclared.join(", ")}`);
		}
		const unregistered = declaredToolNames
			.filter((name) => !registeredToolNames.has(name) && !available.has(name))
			.sort();
		if (unregistered.length > 0) {
			throw new Error(`Suite declared unregistered Tools: ${unregistered.join(", ")}`);
		}
		metadataToolNames = [
			...declaredToolNames,
			...deferredToolNames,
			...optionalToolNames.filter((name) => registeredToolNames.has(name) || runtime.hasActivityRenderer(name)),
		];
		rendererToolNames = [
			...declaredToolNames,
			...deferredToolNames.filter((name) => runtime.hasActivityRenderer(name)),
			...optionalToolNames.filter((name) => registeredToolNames.has(name) || runtime.hasActivityRenderer(name)),
		];
	}
	const missing = getToolUiRuntime(pi).missingActivityMetadata(metadataToolNames);
	if (missing.length > 0) {
		throw new Error(`Suite Tools missing Activity metadata: ${missing.join(", ")}`);
	}
	const missingRenderers = [...runtime.missingActivityRenderers(rendererToolNames)].sort();
	if (missingRenderers.length > 0) {
		throw new Error(`Suite Tools missing Activity renderer: ${missingRenderers.join(", ")}`);
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
	const startLiveEffects = state.wasLiveExecution && !state.liveEffectsStarted;
	if (startLiveEffects) {
		runtime.activities.begin({
			id: context.toolCallId,
			label: model.label,
			name: tool.name,
			...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
			target: model.target,
		});
	}
	const metadata: PresentedToolMetadata = { args, cwd: context.cwd, name: tool.name };
	runtime.presentRow(context.toolCallId, state.component, model, true, context.invalidate, context.expanded, metadata);
	if (startLiveEffects) {
		state.liveEffectsStarted = true;
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
	state.wasLiveExecution ??= context.executionStarted !== false;
	const lightweightHistoricalReplay = state.wasLiveExecution === false && !context.expanded;
	runtime.setRowExpanded(context.toolCallId, context.expanded);
	if (
		state.lastResult &&
		state.component &&
		state.terminalState &&
		(state.terminalModelMaterialized !== false || lightweightHistoricalReplay)
	) {
		if (!context.expanded || tool.name === "bash") {
			delete state.detailLines;
			state.detailMaterialized = false;
		} else if (!state.detailMaterialized) {
			state.detailLines = capPresentationDetails(
				buildToolDetailLines(args, state.lastResult as AgentToolResult<unknown>),
				presentation.detailLines?.(args, state.lastResult, state.terminalState),
			);
			state.detailMaterialized = true;
		}
		return state.component;
	}
	let activityState: Exclude<ToolActivityState, "running">;
	let model: ToolRowModel;
	if (lightweightHistoricalReplay) {
		activityState = context.isError ? classifyTerminalState(result, true) : "success";
		model = {
			durationMs: undefined,
			label: tool.name,
			state: activityState,
			summary: "",
			target: "",
		};
	} else {
		let domainError = context.isError;
		if (!domainError && presentation.resultIsError) {
			try {
				domainError = presentation.resultIsError(args, result);
			} catch {
				domainError = true;
			}
		}
		activityState = classifyTerminalState(result, domainError);
		const finishedAt = Date.now();
		const durationMs = state.startedAt === undefined ? undefined : Math.max(0, finishedAt - state.startedAt);
		model = {
			durationMs,
			label: labelFor(tool, presentation, args),
			state: activityState,
			summary: oneLine(
				presentation.summarize?.(args, result, activityState, durationMs) ??
					(activityState === "success" ? "done" : activityState),
			),
			target: oneLine(presentation.target?.(args) ?? ""),
		};
	}
	if (!state.component) state.component = new CachedToolRow(theme, model);
	state.lastResult = result;
	state.terminalState = activityState;
	state.terminalModelMaterialized = !lightweightHistoricalReplay || tool.name === "bash";
	if (context.expanded && tool.name !== "bash") {
		state.detailLines = capPresentationDetails(
			buildToolDetailLines(args, result as AgentToolResult<unknown>),
			presentation.detailLines?.(args, result, activityState),
		);
		state.detailMaterialized = true;
	} else {
		delete state.detailLines;
		state.detailMaterialized = false;
	}
	runtime.stopTimer(context.toolCallId);
	const metadata: PresentedToolMetadata = {
		args,
		cwd: context.cwd,
		name: tool.name,
		result: result as AgentToolResult<unknown>,
	};
	if (
		!state.projectedReplay ||
		!runtime.updateProjectedRow(
			context.toolCallId,
			state.component,
			model,
			true,
			context.invalidate,
			context.expanded,
			metadata,
		)
	) {
		runtime.presentRow(
			context.toolCallId,
			state.component,
			model,
			true,
			context.invalidate,
			context.expanded,
			metadata,
		);
	}
	state.projectedReplay = false;
	if (state.wasLiveExecution) {
		runtime.activities.begin({
			id: context.toolCallId,
			label: model.label,
			name: tool.name,
			...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
			target: model.target,
		});
		runtime.activities.settle(context.toolCallId, {
			detailLines: state.detailLines ?? [],
			durationMs: model.durationMs,
			state: activityState,
			summary: model.summary,
		});
	}
	return state.component;
}

const EMBEDDED_TOOL_RESULT = Symbol("pi-stuff-embedded-tool-result");
const EMBEDDED_HOST_IMAGE_KEYS = Symbol("pi-stuff-embedded-host-image-keys");
const MEDIA_FALLBACK_PADDING = SELF_RENDERED_TRANSCRIPT_PADDING + visibleWidth(TRANSCRIPT_CONTINUATION);

type ImageContentIndex = ReadonlyMap<string, ReadonlySet<string>>;

function imagePreviewFallback(mimeType: string, data: string, showImages: boolean): string {
	const subtype = mimeType.slice(mimeType.indexOf("/") + 1).split("+", 1)[0];
	const format = subtype ? subtype.toUpperCase() : "IMAGE";
	const dimensions = getImageDimensions(data, mimeType);
	return [
		showImages ? "Image preview unavailable" : "Image preview hidden",
		format,
		dimensions ? `${String(dimensions.widthPx)}×${String(dimensions.heightPx)}` : undefined,
	]
		.filter((part): part is string => part !== undefined)
		.join(" · ");
}

function resultBody<TArgs extends Record<string, unknown>, TDetails>(
	state: RendererState<TArgs, TDetails>,
	result: AgentToolResult<TDetails>,
	expanded: boolean,
	showImages: boolean,
	theme: Theme,
	hideExpandedText = false,
	embedded = false,
	hostImageKeys?: ImageContentIndex,
): Component {
	const container = new Container();
	const text = expanded && !hideExpandedText ? (state.detailLines?.join("\n") ?? "") : "";
	if (text) container.addChild(new Text(theme.fg("toolOutput", text), 2, 0));
	const inlineImageProtocol = getCapabilities().images;
	const hostRendersImages = Boolean(!embedded && inlineImageProtocol && showImages);
	const images = hostRendersImages
		? []
		: result.content.filter(
				(
					item,
				): item is {
					readonly type: "image";
					readonly data: string;
					readonly mimeType: string;
				} =>
					item.type === "image" &&
					typeof item.data === "string" &&
					typeof item.mimeType === "string" &&
					!hostImageKeys?.get(item.mimeType)?.has(item.data),
			);
	for (const [index, image] of images.entries()) {
		if ((embedded && Boolean(inlineImageProtocol && showImages)) || text || index > 0) {
			container.addChild(new Spacer(1));
		}
		container.addChild(
			showImages && inlineImageProtocol
				? new Image(
						image.data,
						image.mimeType,
						{ fallbackColor: (value) => theme.fg("toolOutput", value) },
						{ maxWidthCells: 60 },
					)
				: new Text(
						theme.fg("dim", imagePreviewFallback(image.mimeType, image.data, showImages)),
						MEDIA_FALLBACK_PADDING,
						0,
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
	const decorated: ToolDefinition<TSchema, TDetails> = {
		...tool,
		renderShell: "self" as const,
		renderCall: (args, theme, context) => {
			const typed = {
				...context,
				args,
			} as unknown as ToolRenderContext<TArgs>;
			const state = typed.state as RendererState<TArgs, TDetails>;
			if (state.lastResult && state.component) {
				runtime.setRowExpanded(context.toolCallId, typed.expanded);
				if (!typed.expanded) {
					delete state.detailLines;
					state.detailMaterialized = false;
				}
				return state.component;
			}
			const replayResult =
				context.executionStarted === false ? runtime.projectedResult(context.toolCallId) : undefined;
			if (replayResult) {
				const replayArgs = args as unknown as TArgs;
				state.args = replayArgs;
				state.wasLiveExecution = false;
				const model: ToolRowModel = {
					durationMs: undefined,
					label: tool.name,
					state: "success",
					summary: "",
					target: "",
				};
				state.component ??= new CachedToolRow(theme, model);
				runtime.presentRow(context.toolCallId, state.component, model, true, context.invalidate, false, {
					args: replayArgs,
					cwd: typed.cwd,
					name: tool.name,
					result: replayResult,
				});
				state.projectedReplay = true;
				return state.component;
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
			if (renderOptions.isPartial) {
				updateRunningRow(tool, presentation, runtime, state, typed, theme);
				return new EmptyToolComponent();
			}
			settleRow(tool, presentation, runtime, state, result, typed, theme);
			return resultBody(
				state,
				result,
				renderOptions.expanded,
				typed.showImages,
				theme,
				tool.name === "bash",
				Reflect.get(typed, EMBEDDED_TOOL_RESULT) === true,
				Reflect.get(typed, EMBEDDED_HOST_IMAGE_KEYS) instanceof Map
					? (Reflect.get(typed, EMBEDDED_HOST_IMAGE_KEYS) as ImageContentIndex)
					: undefined,
			);
		},
	};
	Object.defineProperty(decorated, SUITE_ACTIVITY_RENDERER, {
		enumerable: true,
		value: {
			activity: presentation.activity as unknown as ToolActivityMetadata<Record<string, unknown>, unknown>,
			...(presentation.resultIsError
				? {
						resultIsError: presentation.resultIsError as unknown as NonNullable<
							SuiteActivityRendererMarker["resultIsError"]
						>,
					}
				: {}),
		} satisfies SuiteActivityRendererMarker,
	});
	return decorated;
}

const ENVELOPE_CHILD_RENDERERS = Symbol("pi-stuff-tool-envelope-child-renderers");

interface EnvelopeChildRenderer {
	component?: Component;
	readonly state: Record<string, unknown>;
}

interface EnvelopeRendererState {
	readonly children: Map<string, EnvelopeChildRenderer>;
}

class EnvelopeOperationsComponent implements Component {
	private readonly operations: readonly Component[];

	constructor(operations: readonly Component[]) {
		this.operations = operations;
	}

	invalidate(): void {
		for (const operation of this.operations) operation.invalidate();
	}

	render(width: number): string[] {
		const output: string[] = [];
		for (const operation of this.operations) {
			const lines = operation.render(width);
			if (lines.length === 0) continue;
			if (output.length > 0) output.push("");
			output.push(...lines);
		}
		return output;
	}
}

function envelopeRendererState(state: Record<string, unknown>): EnvelopeRendererState {
	const host = state as Record<PropertyKey, unknown>;
	const existing = host[ENVELOPE_CHILD_RENDERERS];
	if (existing instanceof Map) return { children: existing as Map<string, EnvelopeChildRenderer> };
	const children = new Map<string, EnvelopeChildRenderer>();
	host[ENVELOPE_CHILD_RENDERERS] = children;
	return { children };
}

function decodeEnvelopeOperations(
	decode: SuiteToolEnvelopeDecoder,
	details: unknown,
): readonly SuiteToolEnvelopeOperation[] {
	try {
		return decode(details).filter(
			(operation) =>
				typeof operation.id === "string" &&
				operation.id.length > 0 &&
				typeof operation.name === "string" &&
				operation.name.length > 0 &&
				isRecordValue(operation.args),
		);
	} catch {
		return [];
	}
}

function envelopeOperationResult(
	operation: SuiteToolEnvelopeOperation,
): (AgentToolResult<unknown> & { readonly isError?: true }) | undefined {
	if (operation.state === "running") return undefined;
	const result = operation.result ?? {
		content: [
			{
				type: "text" as const,
				text:
					operation.state === "rejected" ? "Tool execution was blocked" : `${operation.name} ${operation.state}`,
			},
		],
		details: undefined,
	};
	return operation.state === "success" ? result : { ...result, isError: true };
}

function resolveEnvelopeMedia(
	result: AgentToolResult<unknown>,
	presentation: SuiteToolEnvelopePresentation,
): readonly (readonly AgentToolResult<unknown>["content"][number][])[] {
	if (presentation.media) {
		try {
			return presentation.media(result.details);
		} catch {
			return [];
		}
	}
	return result.content.flatMap((item) => (item.type === "image" ? [[item]] : []));
}

function projectEnvelopeOperationResult(
	operation: SuiteToolEnvelopeOperation,
	media: readonly (readonly AgentToolResult<unknown>["content"][number][])[],
): AgentToolResult<unknown> | undefined {
	if (!operation.result || !operation.mediaPlacements || operation.mediaPlacements.length === 0) {
		return operation.result;
	}
	const placements = new Map<number, AgentToolResult<unknown>["content"]>();
	for (const placement of operation.mediaPlacements) {
		if (!Number.isInteger(placement.afterContentIndex) || !Number.isInteger(placement.mediaIndex)) continue;
		if (placement.afterContentIndex < 0 || placement.afterContentIndex > operation.result.content.length) continue;
		const segment = media[placement.mediaIndex];
		if (!segment) continue;
		const atBoundary = placements.get(placement.afterContentIndex) ?? [];
		atBoundary.push(...segment);
		placements.set(placement.afterContentIndex, atBoundary);
	}
	if (placements.size === 0) return operation.result;
	const content: AgentToolResult<unknown>["content"] = [];
	for (let index = 0; index <= operation.result.content.length; index += 1) {
		content.push(...(placements.get(index) ?? []));
		const item = operation.result.content[index];
		if (item) content.push(item);
	}
	return { ...operation.result, content };
}

function renderEnvelopeOperations(
	result: AgentToolResult<unknown>,
	options: ToolResultRenderOptions,
	theme: Theme,
	context: ToolRenderContext<Record<string, unknown>>,
	presentation: SuiteToolEnvelopePresentation,
): Component {
	const operations = decodeEnvelopeOperations(presentation.decode, result.details);
	if (operations.length === 0) return new EmptyToolComponent();
	let hostImageKeys: Map<string, Set<string>> | undefined;
	if (getCapabilities().images && context.showImages) {
		for (const item of result.content) {
			if (item.type !== "image" || typeof item.data !== "string" || typeof item.mimeType !== "string") continue;
			hostImageKeys ??= new Map();
			const data = hostImageKeys.get(item.mimeType) ?? new Set<string>();
			data.add(item.data);
			hostImageKeys.set(item.mimeType, data);
		}
	}
	const media = resolveEnvelopeMedia(result, presentation);
	const rendererState = envelopeRendererState(context.state);
	const renderedOperations: Component[] = [];
	const retained = new Set<string>();
	for (const operation of operations) {
		const tool = presentation.registry.get(operation.name);
		if (!tool?.renderCall) continue;
		retained.add(operation.id);
		const child = rendererState.children.get(operation.id) ?? { state: {} };
		rendererState.children.set(operation.id, child);
		const childContext = {
			...context,
			...(hostImageKeys ? { [EMBEDDED_HOST_IMAGE_KEYS]: hostImageKeys } : {}),
			[EMBEDDED_TOOL_RESULT]: true,
			args: operation.args,
			argsComplete: true,
			executionStarted: operation.state === "running" && context.executionStarted !== false,
			isError: operation.state !== "running" && operation.state !== "success",
			isPartial: options.isPartial,
			lastComponent: child.component,
			state: child.state,
			toolCallId: operation.id,
		};
		const container = new Container();
		const call = tool.renderCall(operation.args, theme, childContext as never);
		child.component = call;
		container.addChild(call);
		renderedOperations.push(container);
		if (!operation.result || !tool.renderResult) continue;
		const operationResult = projectEnvelopeOperationResult(operation, media);
		if (!operationResult) continue;
		const childIsPartial = options.isPartial && operation.state === "running";
		const body = tool.renderResult(
			operationResult,
			{ expanded: options.expanded, isPartial: childIsPartial },
			theme,
			{ ...childContext, isPartial: childIsPartial, lastComponent: call } as never,
		);
		if (body) container.addChild(body);
	}
	for (const id of rendererState.children.keys()) {
		if (!retained.has(id)) rendererState.children.delete(id);
	}
	return new EnvelopeOperationsComponent(renderedOperations);
}

/**
 * Register an execution envelope whose nested Suite Tools retain their original
 * Tool Activity renderers. The envelope itself is intentionally visually silent.
 */
export function registerSuiteToolEnvelope<TParams extends TSchema, TDetails = unknown>(
	pi: ExtensionAPI,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolEnvelopePresentation,
): void {
	const runtime = getToolUiRuntime(pi);
	runtime.registerEnvelope(tool.name, presentation.decode);
	const decorated: ToolDefinition<TParams, TDetails> = {
		...tool,
		execute: async (toolCallId, input, signal, onUpdate, context) => {
			const observe = (result: AgentToolResult<TDetails>): void => {
				runtime.observeEnvelopeResult(tool.name, toolCallId, result.details);
			};
			const result = await tool.execute(
				toolCallId,
				input,
				signal,
				(partial) => {
					observe(partial);
					onUpdate?.(partial);
				},
				context,
			);
			observe(result);
			return result;
		},
		renderShell: "self" as const,
		renderCall: () => new EmptyToolComponent(),
		renderResult: (result, options, theme, context) =>
			renderEnvelopeOperations(
				result as AgentToolResult<unknown>,
				options as ToolResultRenderOptions,
				theme,
				context as unknown as ToolRenderContext<Record<string, unknown>>,
				presentation,
			),
	};
	Object.defineProperty(decorated, SUITE_TOOL_ENVELOPE, {
		enumerable: true,
		value: {
			decode: presentation.decode,
			...(presentation.media ? { media: presentation.media } : {}),
			registry: presentation.registry,
		} satisfies SuiteToolEnvelopeMarker,
	});
	pi.registerTool(decorated);
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
	runtime.markRendererAttached(tool.name);
}
