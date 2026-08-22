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
import { type Static, type TSchema, Type } from "typebox";
import { Guard } from "typebox/guard";
import { Check } from "typebox/value";
import { getHostSharedResource } from "../conversation-ui/host-resource.js";
import { SELF_RENDERED_TRANSCRIPT_PADDING, TRANSCRIPT_CONTINUATION } from "../conversation-ui/transcript.js";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import {
	isRuntimeBoolean,
	isRuntimeFunction,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../shared/runtime-type.js";
import {
	type ActivityCategoryAggregate,
	type ActivitySummaryMember,
	classifyToolActivityGroupInvocation,
	effectiveToolActivityOutcome,
	type PlannedToolActivityGroup,
	type PlannedToolActivityMember,
	planToolActivityGroups,
	summarizeToolActivityAggregate,
	summarizeToolActivityGroup,
	type ToolActivityAggregate,
	type ToolActivityCategory,
	type ToolActivityGroupDisposition,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolActivityOutcome,
	type ToolArguments,
	toolActivityOutcome,
} from "./activity.js";
import { type ToolActivity, type ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	type ActivityGroupRowModel,
	type BashOperationRowModel,
	buildRawToolDetailLines,
	buildToolResultLines,
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

export {
	sendSuiteAgentMessage,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "../conversation-ui/index.js";

const TOOL_RUNTIME_REGISTRY = Symbol.for("@jczhang02/pi-stuff-tools/runtime-registry.v1");
const TOOL_RUNTIME_DISCOVERY_EVENT = "@jczhang02/pi-stuff-tools/runtime-discovery/v1";
const TOOL_RELOAD_HANDOFF = Symbol.for("@jczhang02/pi-stuff-tools/reload-handoff.v1");
const SUITE_ACTIVITY_RENDERER = Symbol.for("@jczhang02/pi-stuff-tools/activity-renderer.v1");
const SUITE_TOOL_ENVELOPE = Symbol.for("@jczhang02/pi-stuff-tools/tool-envelope.v1");
const SUITE_TOOL_ENVELOPE_COMPANION = Symbol.for("@jczhang02/pi-stuff-tools/tool-envelope-companion.v1");
const SUITE_TOOL_CODE_MODE = Symbol.for("@jczhang02/pi-stuff-tools/code-mode.v1");
const SUITE_TOOL_REPLAY = Symbol.for("@jczhang02/pi-stuff-tools/replay-definition.v1");
const ERROR_RESULT_SCHEMA = Type.Object({ isError: Type.Literal(true) }, { additionalProperties: true });

interface SuiteActivityRendererMarker {
	readonly activity: ToolActivityMetadata<ToolArguments, unknown>;
	readonly resultIsError?: (args: ToolArguments, result: AgentToolResult<unknown>) => boolean;
}

interface SuiteToolEnvelopeMarker {
	readonly decode: SuiteToolEnvelopeDecoder;
	readonly media?: SuiteToolEnvelopeMediaResolver;
	readonly registry: SuiteToolDefinitionRegistry;
}

interface SuiteToolEnvelopeCompanionMarker {
	readonly owner: string;
}

interface ToolDetailPresentation {
	readonly detailLines?: (
		args: ToolArguments,
		result: AgentToolResult<unknown>,
		state: Exclude<ToolActivityState, "running">,
	) => readonly string[];
	readonly label: (args: ToolArguments) => string;
	readonly summary: (
		args: ToolArguments,
		result: AgentToolResult<unknown> | undefined,
		state: ToolActivityState,
	) => string;
	readonly target: (args: ToolArguments) => string;
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

interface ToolRuntimeRecord {
	readonly activity?: unknown;
	readonly arguments?: unknown;
	readonly block?: unknown;
	readonly categories?: unknown;
	readonly classify?: unknown;
	readonly codeMode?: unknown;
	readonly compensate?: unknown;
	readonly content?: unknown;
	readonly decode?: unknown;
	readonly details?: unknown;
	readonly display?: unknown;
	readonly disposeExecution?: unknown;
	readonly execute?: unknown;
	readonly id?: unknown;
	readonly input?: unknown;
	readonly isError?: unknown;
	readonly lifecycle?: unknown;
	readonly media?: unknown;
	readonly name?: unknown;
	readonly onPassEnd?: unknown;
	readonly owner?: unknown;
	readonly partialResult?: unknown;
	readonly parameters?: unknown;
	readonly presentation?: unknown;
	readonly reason?: unknown;
	readonly renderCall?: unknown;
	readonly renderResult?: unknown;
	readonly registry?: unknown;
	readonly replay?: unknown;
	readonly requiresApproval?: unknown;
	readonly result?: unknown;
	readonly resultIsError?: unknown;
	readonly role?: unknown;
	readonly silentSuccess?: unknown;
	readonly stopReason?: unknown;
	readonly summarizeIssue?: unknown;
	readonly terminate?: unknown;
	readonly tool?: unknown;
	readonly toolCallId?: unknown;
	readonly toolName?: unknown;
	readonly type?: unknown;
	readonly usage?: unknown;
	readonly catalog?: unknown;
	readonly get?: unknown;
	readonly invoke?: unknown;
	readonly isActive?: unknown;
	readonly list?: unknown;
}

function isRecordValue<Value>(value: Value): value is Value & ToolRuntimeRecord {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function isToolArguments<Value>(value: Value): value is Value & ToolArguments {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

interface ToolReloadHandoff {
	readonly activeNames: readonly string[];
	readonly toolDefinitions: readonly SuiteToolReplayDefinition[];
}

function normalizeReloadHandoff(
	value: ToolReloadHandoff | readonly string[] | undefined,
): ToolReloadHandoff | undefined {
	if (!value) return undefined;
	return "activeNames" in value ? value : { activeNames: [...value], toolDefinitions: [] };
}

function reloadHandoff(value?: ToolReloadHandoff): ToolReloadHandoff | undefined {
	if (value !== undefined) {
		Object.defineProperty(globalThis, TOOL_RELOAD_HANDOFF, {
			configurable: true,
			value: {
				activeNames: [...value.activeNames],
				toolDefinitions: [...value.toolDefinitions],
			},
			writable: true,
		});
	}
	return normalizeReloadHandoff(Object.getOwnPropertyDescriptor(globalThis, TOOL_RELOAD_HANDOFF)?.value);
}

function consumeReloadHandoff(): ToolReloadHandoff | undefined {
	const value = normalizeReloadHandoff(Object.getOwnPropertyDescriptor(globalThis, TOOL_RELOAD_HANDOFF)?.value);
	Reflect.deleteProperty(globalThis, TOOL_RELOAD_HANDOFF);
	return value === undefined
		? undefined
		: {
				activeNames: [...value.activeNames],
				toolDefinitions: [...value.toolDefinitions],
			};
}

export interface SuiteToolPresentation<TArgs extends ToolArguments, TDetails> {
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

export interface SuiteToolReplayDefinition {
	readonly codeMode?: SuiteToolCodeModeContract;
	readonly presentation: SuiteToolPresentation<ToolArguments, unknown>;
	readonly tool: ToolDefinition<TSchema, unknown>;
}

export type SuiteToolEnvelopeOperationState = "cancelled" | "error" | "rejected" | "running" | "success";

export interface SuiteToolEnvelopeOperation {
	readonly args: ToolArguments;
	readonly attempt?: number;
	readonly executionId?: string;
	readonly id: string;
	/** Preserve media at the same boundary it occupied in the direct Tool result. */
	readonly mediaPlacements?: readonly SuiteToolEnvelopeMediaPlacement[];
	readonly name: string;
	readonly replayed?: boolean;
	readonly result?: AgentToolResult<unknown>;
	readonly sequence?: number;
	readonly state: SuiteToolEnvelopeOperationState;
}

export interface SuiteToolEnvelopeMediaPlacement {
	/** Number of non-media content blocks that preceded this media block. */
	readonly afterContentIndex: number;
	/** Index into the envelope presentation's normalized media segments. */
	readonly mediaIndex: number;
}

export type SuiteToolEnvelopeDetails = AgentToolResult<unknown>["details"];

export type SuiteToolEnvelopeDecoder = (details: SuiteToolEnvelopeDetails) => readonly SuiteToolEnvelopeOperation[];

export type SuiteToolEnvelopeMediaResolver = (
	details: SuiteToolEnvelopeDetails,
) => readonly (readonly AgentToolResult<unknown>["content"][number][])[];

export interface SuiteToolDefinitionRegistry {
	catalog(): readonly SuiteToolCatalogEntry[];
	compensate(invocation: SuiteToolCompensationInvocation): Promise<boolean>;
	get(name: string): ToolDefinition | undefined;
	invoke(invocation: SuiteToolInvocation): Promise<SuiteToolInvocationResult>;
	isActive(name: string): boolean;
	list(): readonly ToolDefinition[];
}

export interface SuiteToolCodeModeContract {
	/** Explicit inverse operation. It runs only from a user-requested compensation pass. */
	readonly compensate?: (invocation: SuiteToolCompensationInvocation) => Promise<void> | void;
	readonly lifecycle?: SuiteToolCodeModeLifecycle;
	readonly replay: "never" | "record" | "reexecute";
	readonly requiresApproval?: boolean;
}

export type SuiteToolCodeModeExecutionEndStatus = "completed" | "error" | "rejected" | "rolled_back";
export type SuiteToolCodeModePassEndStatus = SuiteToolCodeModeExecutionEndStatus | "paused";

export interface SuiteToolCodeModeLifecycle {
	disposeExecution?(executionId: string, status: SuiteToolCodeModeExecutionEndStatus): Promise<void> | void;
	onPassEnd?(executionId: string, status: SuiteToolCodeModePassEndStatus): Promise<void> | void;
}

export interface SuiteToolCompensationInvocation {
	readonly context: ExtensionContext;
	readonly executionId: string;
	readonly input: unknown;
	readonly name: string;
	readonly result: unknown;
	readonly sequence: number;
	readonly signal?: AbortSignal;
}

export interface SuiteToolCatalogEntry {
	readonly codeMode?: SuiteToolCodeModeContract;
	readonly definition: ToolDefinition;
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

interface RendererState<TArgs extends ToolArguments, TDetails> {
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

interface ToolRenderContext<TArgs extends ToolArguments> {
	readonly args: Readonly<TArgs>;
	readonly cwd: string;
	readonly executionStarted?: boolean;
	readonly expanded: boolean;
	readonly invalidate: () => void;
	readonly isError: boolean;
	readonly isPartial: boolean;
	readonly lastComponent: Component | undefined;
	readonly showImages: boolean;
	readonly state: object;
	readonly toolCallId: string;
}

interface ToolResultRenderOptions {
	readonly expanded: boolean;
	readonly isPartial: boolean;
}

interface PresentedToolMetadata {
	readonly args: ToolArguments;
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
	readonly details: Map<
		string,
		{
			readonly detail: string;
			readonly itemIndex: number;
			readonly order: number;
		}
	>;
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
		const indexed: IndexedSummaryMember = {
			...member,
			order,
			signature,
			target,
		};
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

	issue() {
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
		const aggregate: ToolActivityAggregate = {
			categories,
			outcome: effectiveToolActivityOutcome(
				[...this.members.values()].sort((left, right) => left.order - right.order),
			),
			stateCounts: { ...this.stateCounts },
			target,
		};
		if (firstIssueLabel) Object.assign(aggregate, { firstIssueLabel });
		this.cachedAggregate = aggregate;
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
			category.details.set(`${id}\u0000${String(itemIndex)}`, {
				detail: item.detail,
				itemIndex,
				order,
			});
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

export type ToolActivityDetailMode = "formatted" | "raw";

export interface ToolActivityDetailView {
	readonly activity: ToolActivity;
	readonly lines: readonly string[];
}

export interface ToolUiTimerScheduler {
	setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval> | number;
	clearInterval(id: ReturnType<typeof setInterval> | number): void;
}

const DEFAULT_TIMER_SCHEDULER: ToolUiTimerScheduler = {
	setInterval: (callback, delayMs) => {
		const id = setInterval(callback, delayMs);
		id.unref?.();
		return id;
	},
	clearInterval: (id) => clearInterval(id),
};

function isIssueState(state: ToolActivityState): state is "cancelled" | "error" | "rejected" {
	return state === "error" || state === "rejected" || state === "cancelled";
}

function assistantTerminalState<StopReason>(stopReason: StopReason): "cancelled" | "error" | undefined {
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

function hashRetryValue<Value>(hash: Hash, value: Value, seen = new WeakSet<object>()): void {
	if (value === null) {
		hash.update("n");
		return;
	}
	if (isRuntimeString(value)) {
		hash.update("s");
		hashRetryText(hash, value);
		return;
	}
	if (isRuntimeNumber(value)) {
		if (!Number.isFinite(value)) throw new TypeError("non-JSON Tool arguments");
		hash.update(`d${JSON.stringify(value)};`);
		return;
	}
	if (isRuntimeBoolean(value)) {
		hash.update(value ? "t" : "f");
		return;
	}
	if (!isRuntimeObject(value)) throw new TypeError("non-JSON Tool arguments");
	if (seen.has(value)) throw new TypeError("circular Tool arguments");
	seen.add(value);
	if (Array.isArray(value)) {
		hash.update(`a${String(value.length)}:`);
		for (const entry of value) hashRetryValue(hash, entry, seen);
	} else {
		if (!isRecordValue(value)) throw new TypeError("non-JSON Tool arguments");
		const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
		hash.update(`o${String(entries.length)}:`);
		for (const [key, entry] of entries) {
			hashRetryText(hash, key);
			hashRetryValue(hash, entry, seen);
		}
	}
	seen.delete(value);
}

function activityRecoveryKeys(
	name: string,
	args: ToolArguments,
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
	resultIsError: ((args: ToolArguments, result: AgentToolResult<unknown>) => boolean) | undefined,
): ToolActivityState {
	if (!member.result) return member.terminalState ?? "running";
	let domainError = Check(ERROR_RESULT_SCHEMA, member.result);
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
	private readonly activityPolicies = new Map<string, ToolActivityMetadata<ToolArguments, unknown>>();
	private readonly bindings = new Map<string, GroupedRowBinding>();
	private readonly detailPresentations = new Map<string, ToolDetailPresentation>();
	private readonly errorPolicies = new Map<
		string,
		(args: ToolArguments, result: AgentToolResult<unknown>) => boolean
	>();
	private readonly envelopeCalls = new Map<string, string>();
	private readonly envelopeDecoders = new Map<string, SuiteToolEnvelopeDecoder>();
	private readonly groupHints = new Map<string, HintState>();
	private readonly groupPulses = new Map<string, GroupPulseState>();
	private groupPulseTimer: ReturnType<ToolUiTimerScheduler["setInterval"]> | undefined;
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
	private readonly replayFallbackToolNames = new Set<string>();
	private readonly replayToolDefinitions = new Map<string, SuiteToolReplayDefinition>();
	private readonly replayOnlyToolNames = new Set<string>();
	private stagedReplayToolDefinitions: readonly SuiteToolReplayDefinition[] | undefined;
	private indexedMessages: unknown[] = [];
	private readonly renderedToolNames = new Set<string>();
	private streamActive = false;
	private readonly streamedProseIndexes = new Set<number>();
	private readonly streamedToolCallSignatures = new Map<string, string>();
	private agentActive = false;
	private readonly scheduler: ToolUiTimerScheduler;
	private settings: ToolUiSettingsStore;
	private tailForcedClosed = false;
	private timer: ReturnType<ToolUiTimerScheduler["setInterval"]> | undefined;
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
		if (handoff) this.stagedReplayToolDefinitions ??= handoff.toolDefinitions;
		const names = this.reloadActiveToolNames ?? handoff?.activeNames;
		this.reloadActiveToolNames = undefined;
		return names;
	}

	hasReloadSnapshot(): boolean {
		const handoff = reloadHandoff();
		if (handoff) {
			this.reloadActiveToolNames ??= handoff.activeNames;
			this.stagedReplayToolDefinitions ??= handoff.toolDefinitions;
		}
		return this.reloadActiveToolNames !== undefined;
	}

	prepareReload(activeToolNames: readonly string[]): void {
		this.reloadActiveToolNames = [...activeToolNames];
		reloadHandoff({
			activeNames: activeToolNames,
			toolDefinitions: this.resumeToolDefinitions(),
		});
		this.suspend();
		this.bindings.clear();
	}

	registerReplayToolDefinition(definition: SuiteToolReplayDefinition): void {
		this.replayToolDefinitions.set(definition.tool.name, definition);
	}

	markReplayOnlyTool(name: string): void {
		this.replayOnlyToolNames.add(name);
	}

	markLiveTool(name: string): boolean {
		return this.replayOnlyToolNames.delete(name);
	}

	isReplayOnlyTool(name: string): boolean {
		return this.replayOnlyToolNames.has(name);
	}

	replayOnlyTools(): readonly string[] {
		return [...this.replayOnlyToolNames];
	}

	resumeToolDefinitions(): readonly SuiteToolReplayDefinition[] {
		return [...this.replayToolDefinitions.values()];
	}

	stageResumeToolDefinitions(definitions: readonly SuiteToolReplayDefinition[]): void {
		this.stagedReplayToolDefinitions = [...definitions];
	}

	hasStagedResumeToolDefinitions(): boolean {
		return this.stagedReplayToolDefinitions !== undefined;
	}

	stageReplayFallbackToolNames(names: readonly string[]): void {
		for (const name of names) this.replayFallbackToolNames.add(name);
	}

	missingResumeToolDefinitions(
		registeredNames: ReadonlySet<string>,
		historicalNames?: ReadonlySet<string>,
	): readonly SuiteToolReplayDefinition[] {
		return (this.stagedReplayToolDefinitions ?? []).filter(
			(definition) =>
				(historicalNames === undefined || historicalNames.has(definition.tool.name)) &&
				!registeredNames.has(definition.tool.name),
		);
	}

	missingReplayFallbackToolNames(
		registeredNames: ReadonlySet<string>,
		historicalNames?: ReadonlySet<string>,
	): readonly string[] {
		return [...this.replayFallbackToolNames].filter(
			(name) => (historicalNames === undefined || historicalNames.has(name)) && !registeredNames.has(name),
		);
	}

	registerActivity<TArgs extends object, TDetails>(
		name: string,
		activity: ToolActivityMetadata<TArgs, TDetails>,
		resultIsError?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean,
	): void {
		// SAFETY: activity is retrieved only for the same registered Tool name whose schema produced the arguments.
		this.activityPolicies.set(name, activity as ToolActivityMetadata<ToolArguments, unknown>);
		if (resultIsError) {
			this.errorPolicies.set(
				name,
				// SAFETY: the error policy is invoked only with arguments and results from its registered Tool name.
				resultIsError as (args: ToolArguments, result: AgentToolResult<unknown>) => boolean,
			);
		} else {
			this.errorPolicies.delete(name);
		}
		if (this.renderedToolNames.has(name) && this.indexedMessages.length > 0) this.rebuildGroups();
	}

	registerDetailPresentation(name: string, presentation: ToolDetailPresentation): void {
		this.detailPresentations.set(name, presentation);
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
			const displayOnlyFallback = this.replayOnlyToolNames.has(name) && this.replayFallbackToolNames.has(name);
			return (
				!metadata || (metadata.categories.length === 0 && metadata.silentSuccess !== true && !displayOnlyFallback)
			);
		});
	}

	private groupDisposition(name: string, args: ToolArguments): ToolActivityGroupDisposition {
		if (!this.renderedToolNames.has(name)) return "boundary";
		return classifyToolActivityGroupInvocation(name, args, this.activityPolicies.get(name));
	}

	startTurn(messages?: readonly unknown[]): void {
		this.agentActive = true;
		this.tailForcedClosed = false;
		if (messages) {
			this.indexedMessages = [...messages];
			this.rebuildGroups();
		}
	}

	observeUserBoundary(): void {
		this.indexedMessages.push({ role: "user", content: [] });
		this.tailForcedClosed = true;
		this.closeOpenGroup();
	}

	endTurn(): void {
		this.agentActive = false;
		this.tailForcedClosed = true;
		this.closeOpenGroup();
	}

	observeAssistantProse(): void {
		this.tailForcedClosed = true;
		this.closeOpenGroup();
	}

	observeAssistantUpdate<Message>(message: Message): void {
		if (!isRecordValue(message) || message.role !== "assistant" || !Array.isArray(message.content)) return;
		if (!this.streamActive) {
			this.streamActive = true;
			this.streamedProseIndexes.clear();
			this.streamedToolCallSignatures.clear();
		}
		this.applyAssistantContent(message.content, true, assistantTerminalState(message.stopReason));
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
		if (!id || !name || !isToolArguments(args) || this.streamedToolCallSignatures.has(id)) return;
		this.streamedToolCallSignatures.set(id, "complete");
		this.appendToolCall({ args, id, name });
	}

	indexMessages(messages: readonly unknown[], closeTail = !this.agentActive): void {
		this.pendingResults.clear();
		this.indexedMessages = [...messages];
		this.tailForcedClosed = closeTail;
		this.rebuildGroups();
	}

	indexMessage<Message>(message: Message): void {
		this.indexedMessages.push(message);
		this.applyMessage(message);
		if (isRecordValue(message) && message.role === "assistant") {
			this.streamActive = false;
			this.streamedProseIndexes.clear();
			this.streamedToolCallSignatures.clear();
		}
	}

	observeEnvelopeResult(envelopeName: string, envelopeId: string, details: SuiteToolEnvelopeDetails): void {
		for (const operation of this.decodeEnvelope(envelopeName, details)) {
			const owner = this.envelopeCalls.get(operation.id);
			if (owner && owner !== envelopeId) continue;
			if (!owner) this.envelopeCalls.set(operation.id, envelopeId);
			if (operation.state === "running" && operation.result) {
				this.observeToolExecutionUpdate(operation.id, operation.result);
			}
			const result = envelopeOperationResult(operation);
			const member = {
				args: operation.args,
				id: operation.id,
				name: operation.name,
			};
			if (result) Object.assign(member, { result });
			this.appendToolCall(member);
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
		this.streamActive = false;
		this.streamedProseIndexes.clear();
		this.streamedToolCallSignatures.clear();
		this.agentActive = false;
		this.tailForcedClosed = false;
		this.activities.clear();
	}

	suspend(): void {
		for (const toolCallId of Array.from(this.timerStates.keys())) this.stopTimer(toolCallId);
		for (const leaderId of Array.from(this.groupPulses.keys())) this.stopGroupPulse(leaderId);
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
		const leaderId = this.membership.get(toolCallId);
		if (expanded || (leaderId && this.groups.get(leaderId)?.standalone)) {
			this.reconcileGroupForTool(toolCallId, false);
		}
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
			const oldestId = this.timerStates.keys().next().value;
			if (!oldestId) break;
			const oldest = this.timerStates.get(oldestId);
			this.timerStates.delete(oldestId);
			oldest?.setMarkerVisible(true);
			this.pulseGroup(oldestId, true);
			this.reconcileGroupForTool(oldestId);
		}
		this.timerStates.set(toolCallId, {
			invalidate,
			setMarkerVisible,
			visible,
		});
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
		const match = matches[0];
		if (!match) return undefined;
		const { order: _order, ...group } = match;
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

	isStandaloneInvocation(name: string, args: ToolArguments): boolean {
		return this.groupDisposition(name, args) === "boundary";
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
			return activity ?? this.activityFromPlan(member);
		});
	}

	toolActivityDetail(toolCallId: string, mode: ToolActivityDetailMode): ToolActivityDetailView | undefined {
		const leaderId = this.membership.get(toolCallId);
		const memberIndex = this.memberIndexes.get(toolCallId);
		const member =
			leaderId === undefined || memberIndex === undefined
				? undefined
				: this.groups.get(leaderId)?.members[memberIndex];
		const binding = this.bindings.get(toolCallId);
		const activity = this.activities.get(toolCallId) ?? (member ? this.activityFromPlan(member) : undefined);
		if (!activity) return undefined;
		const args = member?.args ?? binding?.metadata.args ?? {};
		const name = member?.name ?? binding?.metadata.name ?? activity.name;
		const result = member?.result ?? binding?.metadata.result ?? this.liveResults.get(toolCallId);
		if (mode === "raw") {
			return {
				activity,
				lines: buildRawToolDetailLines(toolCallId, name, args, result),
			};
		}
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
						? buildToolResultLines(result)
						: activity.detailLines.length > 0
							? activity.detailLines
							: ["Details are available after completion."],
				DETAIL_LINE_LIMIT,
				DETAIL_BYTE_LIMIT,
			),
		};
	}

	private decodeEnvelope(name: string, details: SuiteToolEnvelopeDetails): readonly SuiteToolEnvelopeOperation[] {
		const decode = this.envelopeDecoders.get(name);
		if (!decode) return [];
		return decodeEnvelopeOperations(decode, details);
	}

	/** Project registered Tool envelopes into the ordinary calls and results they contain. */
	projectMessages(messages: readonly unknown[]): readonly unknown[] {
		if (this.envelopeDecoders.size === 0) return messages;
		const envelopeNamesById = new Map<string, string>();
		for (const candidate of messages) {
			if (!isRecordValue(candidate) || candidate["role"] !== "assistant" || !Array.isArray(candidate["content"])) {
				continue;
			}
			for (const block of candidate["content"]) {
				if (!isRecordValue(block) || block["type"] !== "toolCall") continue;
				const id = block["id"];
				const name = block["name"];
				if (isRuntimeString(id) && isRuntimeString(name) && this.envelopeDecoders.has(name)) {
					envelopeNamesById.set(id, name);
				}
			}
		}
		const operationsById = new Map<string, readonly SuiteToolEnvelopeOperation[]>();
		for (const candidate of messages) {
			if (!isRecordValue(candidate) || candidate["role"] !== "toolResult") continue;
			const id = candidate["toolCallId"];
			if (!isRuntimeString(id)) continue;
			const name = envelopeNamesById.get(id);
			if (!name) continue;
			operationsById.set(id, this.decodeEnvelope(name, candidate["details"]));
		}
		const projected: unknown[] = [];
		for (const candidate of messages) {
			if (!isRecordValue(candidate)) {
				projected.push(candidate);
				continue;
			}
			if (candidate["role"] === "assistant" && Array.isArray(candidate["content"])) {
				const content = candidate["content"].flatMap((block) => {
					if (!isRecordValue(block) || block["type"] !== "toolCall") return [block];
					const id = block["id"];
					const name = block["name"];
					if (!isRuntimeString(id) || !isRuntimeString(name) || !this.envelopeDecoders.has(name)) {
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
				const operations = isRuntimeString(id) ? operationsById.get(id) : undefined;
				if (!operations) {
					projected.push(candidate);
					continue;
				}
				for (const operation of operations) {
					const result = envelopeOperationResult(operation);
					if (!result) continue;
					const projectedResult = {
						role: "toolResult",
						toolCallId: operation.id,
						toolName: operation.name,
						content: result.content,
						details: result.details,
					};
					if (result.isError === true) Object.assign(projectedResult, { isError: true });
					projected.push(projectedResult);
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
		const planned = planToolActivityGroups(
			this.projectMessages(this.indexedMessages),
			(name, args) => this.groupDisposition(name, args),
			closeTail,
		);
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
		for (const key of Array.from(this.groupHints.keys())) {
			if (!this.groups.has(key)) this.groupHints.delete(key);
		}
		for (const leaderId of Array.from(this.groupPulses.keys())) {
			if (!this.groups.has(leaderId)) this.stopGroupPulse(leaderId);
		}
	}

	private applyMessage<Message>(message: Message): void {
		if (!isRecordValue(message)) return;
		const role = message.role;
		if (role === "assistant" && Array.isArray(message.content)) {
			this.applyAssistantContent(message.content, false, assistantTerminalState(message.stopReason));
			return;
		}
		if (role === "toolResult") {
			const id = message.toolCallId;
			const content = message.content;
			if (!isRuntimeString(id) || !Array.isArray(content)) return;
			const name = "toolName" in message ? message.toolName : undefined;
			if (isRuntimeString(name) && this.envelopeDecoders.has(name)) {
				this.rebuildGroups();
				return;
			}
			const baseResult: AgentToolResult<unknown> & { isError?: true } = {
				// SAFETY: Pi tool-result messages own this content array; the UI preserves blocks without interpreting them here.
				content: content as AgentToolResult<unknown>["content"],
				details: message.details,
			};
			if (message.isError === true) Object.assign(baseResult, { isError: true as const });
			this.updateToolResult(id, baseResult);
			return;
		}
		if (role === "user" || role === "bashExecution" || (role === "custom" && message.display === true)) {
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
			if (!isRecordValue(block)) continue;
			if (block.type === "text" && "text" in block && isRuntimeString(block.text) && block.text.trim()) {
				if (
					streaming
						? this.streamedProseIndexes.has(index)
						: this.streamActive && this.streamedProseIndexes.has(index)
				) {
					continue;
				}
				this.streamedProseIndexes.add(index);
				this.tailForcedClosed = true;
				this.closeOpenGroup();
				continue;
			}
			if (block.type !== "toolCall") continue;
			const id = block.id;
			const name = block.name;
			const args = block.arguments;
			if (!isRuntimeString(id) || !id || !isRuntimeString(name) || !name || !isToolArguments(args)) continue;
			if (streaming && name === "bash") continue;
			const trackedSnapshot = streaming || this.streamActive;
			let signature = "";
			if (trackedSnapshot) {
				try {
					const hash = createHash("sha256");
					hashRetryValue(hash, [name, args, terminalState ?? ""]);
					signature = hash.digest("base64url");
				} catch {
					signature = "invalid";
				}
			}
			const previousSignature = trackedSnapshot ? this.streamedToolCallSignatures.get(id) : undefined;
			if (trackedSnapshot && previousSignature === signature) continue;
			if (trackedSnapshot) this.streamedToolCallSignatures.set(id, signature);
			const member = { args, id, name };
			if (terminalState) Object.assign(member, { terminalState });
			this.appendToolCall(member);
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
			const completeMember = {
				args: member.args,
				id: member.id,
				name: member.name,
			};
			if (result) Object.assign(completeMember, { result });
			if (terminalState) Object.assign(completeMember, { terminalState });
			this.mutableMembers(group)[memberIndex] = completeMember;
			this.pendingResults.delete(member.id);
			this.reconcileGroup(group, member.id);
			if (terminalState) this.stopTimer(member.id);
			return;
		}
		const disposition = this.groupDisposition(member.name, member.args);
		if (disposition === "boundary") {
			this.closeOpenGroup();
			this.tailForcedClosed = true;
		}
		let group = this.openGroupLeaderId ? this.groups.get(this.openGroupLeaderId) : undefined;
		const result = member.result ?? this.pendingResults.get(member.id);
		const terminalState = result ? undefined : member.terminalState;
		const completeMember = {
			args: member.args,
			id: member.id,
			name: member.name,
		};
		if (result) Object.assign(completeMember, { result });
		if (terminalState) Object.assign(completeMember, { terminalState });
		this.pendingResults.delete(member.id);
		if (!group || group.closed) {
			const nextGroup = {
				closed: disposition === "boundary" || !this.agentActive,
				leaderId: member.id,
				members: [completeMember],
			};
			if (disposition === "boundary") Object.assign(nextGroup, { standalone: true });
			group = nextGroup;
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
					const oldest = this.pendingResults.keys().next().value;
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
		// SAFETY: groups are owned by this runtime; mutation is confined to its indexed reconciliation methods.
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
		if (group.standalone) {
			if (!leader) return;
			this.stopGroupPulse(group.leaderId);
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
			this.stopGroupPulse(group.leaderId);
			for (const member of group.members) {
				const binding = this.bindings.get(member.id);
				if (!binding) continue;
				if (member.name === "bash") this.applyBashOperation(member, binding);
				else this.applyBinding(binding, binding.baseModel, true);
			}
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
			return {
				text: binding.bashOutput ?? "",
				truncated: binding.bashOutputTruncated === true,
			};
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
			...binding?.metadata,
			args: binding?.metadata.args ?? member.args,
			name: member.name,
		};
		if (member.result) Object.assign(metadata, { result: member.result });
		const transparent = this.groupDisposition(member.name, metadata.args) === "transparent";
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
			const input = {
				args: metadata.args,
				state,
			};
			if (metadata.cwd) Object.assign(input, { cwd: metadata.cwd });
			if (metadata.result) Object.assign(input, { result: metadata.result });
			const classified = policy.classify(input);
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
		const transparent = this.groupDisposition(member.name, member.args) === "transparent";
		const metadata: PresentedToolMetadata = {
			args: member.args,
			name: member.name,
		};
		if (member.result) Object.assign(metadata, { result: member.result });
		const classifiedItems =
			transparent || (member.terminalState && !member.result) ? [] : this.classify(metadata, state);
		const items = visibleActivityItems(classifiedItems, state);
		const summary = summarizeToolActivityGroup([{ items, state }], state !== "running");
		const presentation = this.detailPresentations.get(member.name);
		let label = member.name;
		let target =
			items
				.map((item) => item.target)
				.filter(Boolean)
				.at(-1) ?? "";
		let toolSummary = summary.summary;
		if (presentation) {
			try {
				label = presentation.label(member.args);
				target = presentation.target(member.args);
				toolSummary = presentation.summary(member.args, member.result, state);
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
			target,
		};
	}
}

function runtimeRegistry(): WeakMap<object, ToolUiRuntime> {
	const existing = Object.getOwnPropertyDescriptor(globalThis, TOOL_RUNTIME_REGISTRY)?.value;
	if (existing instanceof WeakMap) {
		// SAFETY: this global symbol is written only below with ToolUiRuntime values keyed by Pi event facades.
		return existing as WeakMap<object, ToolUiRuntime>;
	}
	const registry = new WeakMap<object, ToolUiRuntime>();
	Object.defineProperty(globalThis, TOOL_RUNTIME_REGISTRY, {
		configurable: true,
		value: registry,
	});
	return registry;
}

export type ToolUiRuntimeHost = Pick<ExtensionAPI, "events" | "on">;
export type SuiteToolRegistrationHost = ToolUiRuntimeHost &
	Pick<ExtensionAPI, "getActiveTools" | "registerTool" | "setActiveTools">;

export function getToolUiRuntime(pi: ToolUiRuntimeHost): ToolUiRuntime {
	const registry = runtimeRegistry();
	return getHostSharedResource(pi.events, registry, TOOL_RUNTIME_DISCOVERY_EVENT, () => new ToolUiRuntime(), {
		registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup),
	});
}

/** Predeclare Activity metadata for a conditionally registered owned Tool. */
export function registerSuiteToolActivityMetadata<TArgs extends ToolArguments, TDetails>(
	pi: ToolUiRuntimeHost,
	name: string,
	activity: ToolActivityMetadata<TArgs, TDetails>,
	resultIsError?: (args: Readonly<TArgs>, result: AgentToolResult<TDetails>) => boolean,
): void {
	getToolUiRuntime(pi).registerActivity(name, activity, resultIsError);
}

export type SuiteToolTrackerHost = SuiteToolRegistrationHost & Pick<ExtensionAPI, "getAllTools">;

export interface SuiteToolRegistrationTracker<Host extends SuiteToolTrackerHost = ExtensionAPI> {
	readonly api: Host;
	readonly registry: SuiteToolDefinitionRegistry;
	readonly surface: SuiteToolSurfaceController;
	readonly toolNames: ReadonlySet<string>;
}

function suiteActivityRendererMarker<Tool>(tool: Tool): SuiteActivityRendererMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	if (!isRuntimeFunction(tool["renderCall"]) || !isRuntimeFunction(tool["renderResult"])) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_ACTIVITY_RENDERER)?.value;
	return isSuiteActivityRendererMarker(marker) ? marker : undefined;
}

function hasSuiteActivityRenderer<Tool>(tool: Tool): boolean {
	return suiteActivityRendererMarker(tool) !== undefined;
}

function isSuiteActivityRendererMarker<Value>(value: Value): value is Value & SuiteActivityRendererMarker {
	if (!isRecordValue(value) || !isRecordValue(value["activity"])) return false;
	const activity = value["activity"];
	return (
		Array.isArray(activity["categories"]) &&
		isRuntimeFunction(activity["classify"]) &&
		(activity["silentSuccess"] === undefined || isRuntimeBoolean(activity["silentSuccess"])) &&
		(activity["summarizeIssue"] === undefined || isRuntimeFunction(activity["summarizeIssue"])) &&
		(value["resultIsError"] === undefined || isRuntimeFunction(value["resultIsError"]))
	);
}

function isSuiteToolCodeModeContract<Value>(value: Value): value is Value & SuiteToolCodeModeContract {
	if (!isRecordValue(value)) return false;
	if (value["replay"] !== "never" && value["replay"] !== "record" && value["replay"] !== "reexecute") {
		return false;
	}
	if (value["compensate"] !== undefined && !isRuntimeFunction(value["compensate"])) return false;
	if (value["requiresApproval"] !== undefined && !isRuntimeBoolean(value["requiresApproval"])) return false;
	if (value["lifecycle"] !== undefined) {
		if (!isRecordValue(value["lifecycle"])) return false;
		if (
			value["lifecycle"]["disposeExecution"] !== undefined &&
			!isRuntimeFunction(value["lifecycle"]["disposeExecution"])
		) {
			return false;
		}
		if (value["lifecycle"]["onPassEnd"] !== undefined && !isRuntimeFunction(value["lifecycle"]["onPassEnd"])) {
			return false;
		}
	}
	return true;
}

function suiteToolCodeModeContract<Tool>(tool: Tool): SuiteToolCodeModeContract | undefined {
	if (!isRecordValue(tool)) return undefined;
	const value = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_CODE_MODE)?.value;
	return isSuiteToolCodeModeContract(value) ? value : undefined;
}

function suiteToolEnvelopeMarker<Tool>(tool: Tool): SuiteToolEnvelopeMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_ENVELOPE)?.value;
	return isSuiteToolEnvelopeMarker(marker) ? marker : undefined;
}

function isSuiteToolEnvelopeMarker<Value>(value: Value): value is Value & SuiteToolEnvelopeMarker {
	if (!isRecordValue(value) || !isRuntimeFunction(value["decode"]) || !isRecordValue(value["registry"])) {
		return false;
	}
	const registry = value["registry"];
	return (
		(value["media"] === undefined || isRuntimeFunction(value["media"])) &&
		isRuntimeFunction(registry["catalog"]) &&
		isRuntimeFunction(registry["compensate"]) &&
		isRuntimeFunction(registry["get"]) &&
		isRuntimeFunction(registry["invoke"]) &&
		isRuntimeFunction(registry["isActive"]) &&
		isRuntimeFunction(registry["list"])
	);
}

function suiteToolEnvelopeCompanionMarker<Tool>(tool: Tool): SuiteToolEnvelopeCompanionMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_ENVELOPE_COMPANION)?.value;
	return isSuiteToolEnvelopeCompanionMarker(marker) ? marker : undefined;
}

function isSuiteToolEnvelopeCompanionMarker<Value>(value: Value): value is Value & SuiteToolEnvelopeCompanionMarker {
	return isRecordValue(value) && isRuntimeString(value["owner"]);
}

function suiteToolReplayDefinition<Tool>(tool: Tool): SuiteToolReplayDefinition | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_REPLAY)?.value;
	return isSuiteToolReplayDefinition(marker) ? marker : undefined;
}

function isSuiteToolReplayDefinition<Value>(value: Value): value is Value & SuiteToolReplayDefinition {
	if (!isRecordValue(value) || !isRecordValue(value["tool"]) || !isRecordValue(value["presentation"])) {
		return false;
	}
	const presentation = value["presentation"];
	const tool = value["tool"];
	return (
		(value["codeMode"] === undefined || isSuiteToolCodeModeContract(value["codeMode"])) &&
		isSuiteActivityRendererMarker({
			activity: presentation["activity"],
			resultIsError: presentation["resultIsError"],
		}) &&
		isRuntimeString(tool["name"]) &&
		isRecordValue(tool["parameters"]) &&
		isRuntimeFunction(tool["execute"])
	);
}

const CAPTURED_TOOL_EVENTS = new Set([
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);

function uniqueToolNames(names: readonly string[]): string[] {
	return [...new Set(names)];
}

function errorToolResult(cause: unknown): AgentToolResult<unknown> {
	return {
		content: [
			{
				type: "text",
				text: cause instanceof Error ? cause.message : String(cause),
			},
		],
		details: {},
	};
}

interface CapturedToolHandlerResult {
	readonly block?: boolean;
	readonly content?: AgentToolResult<unknown>["content"];
	readonly details?: unknown;
	readonly isError?: boolean;
	readonly reason?: string;
	readonly terminate?: boolean;
	readonly usage?: AgentToolResult<unknown>["usage"];
}

interface CapturedToolEvent {
	readonly args?: unknown;
	content?: AgentToolResult<unknown>["content"];
	details?: SuiteToolEnvelopeDetails;
	readonly input?: unknown;
	isError?: boolean;
	readonly partialResult?: AgentToolResult<unknown>;
	readonly result?: AgentToolResult<unknown>;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly type: string;
	usage?: AgentToolResult<unknown>["usage"];
}

type CapturedToolHandler = (
	event: CapturedToolEvent,
	context: ExtensionContext,
) => CapturedToolHandlerResult | undefined | Promise<CapturedToolHandlerResult | undefined>;

function isCapturedToolHandler<Value>(value: Value): value is Value & CapturedToolHandler {
	return isRuntimeFunction(value);
}

/** Observe every Tool registered by Suite modules without changing the Host API. */
export function createSuiteToolRegistrationTracker<Host extends SuiteToolTrackerHost>(
	pi: Host,
): SuiteToolRegistrationTracker<Host> {
	const capturedHandlers = new Map<string, CapturedToolHandler[]>();
	const envelopeCompanions = new Map<string, Set<string>>();
	const envelopeTools = new Set<string>();
	const toolNames = new Set<string>();
	const tools = new Map<string, ToolDefinition>();
	let enabledEnvelope: string | undefined;
	let virtualActiveTools: string[] | undefined;

	const projectActiveTools = (names: readonly string[], envelope: string): string[] => {
		const projected: string[] = [];
		let inserted = false;
		const insertEnvelope = (): void => {
			if (inserted) return;
			projected.push(envelope, ...(envelopeCompanions.get(envelope) ?? []));
			inserted = true;
		};
		for (const name of uniqueToolNames(names)) {
			if (envelopeTools.has(name)) continue;
			if (tools.has(name)) {
				insertEnvelope();
				continue;
			}
			projected.push(name);
		}
		insertEnvelope();
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
	const on = new Proxy(pi.on, {
		apply(target, _thisArgument, argumentsList) {
			const [event, handler] = argumentsList;
			if (isRuntimeString(event) && CAPTURED_TOOL_EVENTS.has(event) && isCapturedToolHandler(handler)) {
				const handlers = capturedHandlers.get(event) ?? [];
				handlers.push(handler);
				capturedHandlers.set(event, handlers);
			}
			return Function.prototype.apply.call(target, pi, argumentsList);
		},
	});

	const dispatchInformational = async (
		event: "tool_execution_end" | "tool_execution_start" | "tool_execution_update",
		value: CapturedToolEvent,
		context: ExtensionContext,
	): Promise<void> => {
		for (const handler of capturedHandlers.get(event) ?? []) {
			try {
				await handler.call(undefined, value, context);
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

		let prepared: ToolArguments;
		try {
			const rawArguments = tool.prepareArguments ? tool.prepareArguments(invocation.input) : invocation.input;
			// SAFETY: the registry erases each Tool's schema, while validation immediately below restores its runtime contract.
			const validated = validateToolArguments(
				tool as never,
				// SAFETY: the call record matches Pi's ToolCall shape and is consumed only by the selected Tool's schema validator.
				{
					arguments: rawArguments,
					id: invocation.toolCallId,
					name: invocation.name,
					type: "toolCall",
				} as never,
			);
			if (!isToolArguments(validated)) throw new Error(`Suite Tool ${invocation.name} requires object arguments`);
			prepared = validated;
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

		const callEvent: CapturedToolEvent = {
			input: prepared,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_call",
		};
		try {
			for (const handler of capturedHandlers.get("tool_call") ?? []) {
				const decision = await handler.call(undefined, callEvent, invocation.context);
				if (!isRecordValue(decision) || decision["block"] !== true) continue;
				const result = errorToolResult(
					isRuntimeString(decision["reason"]) ? decision["reason"] : "Tool execution was blocked",
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
			// SAFETY: validation above produced the argument type owned by this registry-selected Tool definition.
			result = await tool.execute(
				invocation.toolCallId,
				prepared as never,
				invocation.signal,
				(partialResult) => {
					if (!acceptingUpdates) return;
					try {
						invocation.onUpdate?.(partialResult);
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

		const resultEvent: CapturedToolEvent = {
			content: result.content ?? [],
			details: result.details,
			input: prepared,
			isError,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_result",
		};
		if (result.usage) resultEvent.usage = result.usage;
		for (const handler of capturedHandlers.get("tool_result") ?? []) {
			try {
				const replacement = await handler.call(undefined, resultEvent, invocation.context);
				if (!isRecordValue(replacement)) continue;
				for (const key of ["content", "details", "isError", "usage"] as const) {
					if (replacement[key] !== undefined) {
						Object.defineProperty(resultEvent, key, {
							configurable: true,
							enumerable: true,
							value: replacement[key],
							writable: true,
						});
					}
				}
			} catch {
				// Pi reports result-handler failures and keeps the previous result.
			}
		}
		const finalResult = {
			...result,
			content: resultEvent.content ?? [],
			details: resultEvent.details,
		};
		if (resultEvent.usage !== undefined) Object.assign(finalResult, { usage: resultEvent.usage });
		result = finalResult;
		isError = resultEvent.isError === true;
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
		catalog: () =>
			[...tools.values()].map((definition) => {
				const codeMode = suiteToolCodeModeContract(definition);
				const entry: SuiteToolCatalogEntry = { definition };
				if (codeMode) Object.assign(entry, { codeMode });
				return entry;
			}),
		async compensate(invocation) {
			const contract = suiteToolCodeModeContract(tools.get(invocation.name));
			if (!contract?.compensate) return false;
			await contract.compensate(invocation);
			return true;
		},
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
				const hidden = new Set([name, ...(envelopeCompanions.get(name) ?? [])]);
				pi.setActiveTools(pi.getActiveTools().filter((toolName) => !hidden.has(toolName)));
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
		const companion = suiteToolEnvelopeCompanionMarker(tool);
		const replay = suiteToolReplayDefinition(tool);
		pi.registerTool(tool);
		const runtime = getToolUiRuntime(pi);
		if (replay) runtime.registerReplayToolDefinition(replay);
		if (envelope) {
			envelopeTools.add(tool.name);
			runtime.registerEnvelope(tool.name, envelope.decode);
			applyActiveProjection();
			return;
		}
		if (companion) {
			envelopeTools.add(tool.name);
			const names = envelopeCompanions.get(companion.owner) ?? new Set<string>();
			names.add(tool.name);
			envelopeCompanions.set(companion.owner, names);
			applyActiveProjection();
			return;
		}
		toolNames.add(tool.name);
		// SAFETY: this registry preserves each Tool definition intact and erases generics only for name-based lookup.
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
			const value = readHostProxyProperty(target, property, target);
			return Guard.IsFunction(value) ? value.bind(target) : value;
		},
	});
	return { api, registry, surface, toolNames };
}

/** Fail fast when a Suite-owned Tool bypasses or under-declares the required Activity contract. */
export function assertSuiteToolActivityCoverage(
	pi: SuiteToolTrackerHost,
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

export function installToolUiRuntime(pi: ToolUiRuntimeHost, settings: ToolUiSettingsStore): ToolUiRuntime {
	const runtime = getToolUiRuntime(pi);
	runtime.configure(settings);
	return runtime;
}

function capPresentationDetails(result: AgentToolResult<unknown>, extra: readonly string[] | undefined): string[] {
	return capDetailLines(
		extra && extra.length > 0 ? extra : buildToolResultLines(result),
		DETAIL_LINE_LIMIT,
		DETAIL_BYTE_LIMIT,
	);
}

function labelFor<TArgs extends ToolArguments, TDetails>(
	tool: ToolDefinition<TSchema, TDetails>,
	presentation: SuiteToolPresentation<TArgs, TDetails>,
	args: Readonly<TArgs>,
): string {
	const label = isRuntimeFunction(presentation.label) ? presentation.label(args) : presentation.label;
	return sanitizeTerminalText(label ?? tool.label ?? tool.name) || tool.name;
}

function updateRunningRow<TArgs extends ToolArguments, TDetails>(
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
	const summary = isRuntimeFunction(summarySource)
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
		const activity = {
			id: context.toolCallId,
			label: model.label,
			name: tool.name,
			target: model.target,
		};
		if (state.startedAt !== undefined) Object.assign(activity, { startedAt: state.startedAt });
		runtime.activities.begin(activity);
	}
	const metadata: PresentedToolMetadata = {
		args,
		cwd: context.cwd,
		name: tool.name,
	};
	runtime.presentRow(context.toolCallId, state.component, model, true, context.invalidate, context.expanded, metadata);
	if (startLiveEffects) {
		state.liveEffectsStarted = true;
		runtime.startTimer(context.toolCallId, context.invalidate, (visible) =>
			state.component?.setMarkerVisible(visible),
		);
	}
	return state.component;
}

function settleRow<TArgs extends ToolArguments, TDetails>(
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
	const lightweightHistoricalReplay =
		state.wasLiveExecution === false && !context.expanded && !runtime.isStandaloneInvocation(tool.name, args);
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
				state.lastResult,
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
		state.detailLines = capPresentationDetails(result, presentation.detailLines?.(args, result, activityState));
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
		result,
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
		const activity = {
			id: context.toolCallId,
			label: model.label,
			name: tool.name,
			target: model.target,
		};
		if (state.startedAt !== undefined) Object.assign(activity, { startedAt: state.startedAt });
		runtime.activities.begin(activity);
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

function resultBody<TArgs extends ToolArguments, TDetails>(
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
					isRuntimeString(item.data) &&
					isRuntimeString(item.mimeType) &&
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

function attachRenderer<TParams extends TSchema, TDetails>(
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolPresentation<Static<TParams> & ToolArguments, TDetails>,
	runtime: ToolUiRuntime,
): ToolDefinition<TParams, TDetails> {
	type TArgs = Static<TParams> & ToolArguments;
	const argsForPresentation = <Args>(args: Args): Readonly<TArgs> => {
		// SAFETY: this renderer is attached to the same Tool definition and therefore receives its schema-validated arguments.
		return args as Readonly<TArgs>;
	};
	const resultForPresentation = (result: AgentToolResult<unknown>): AgentToolResult<TDetails> => {
		// SAFETY: this renderer is attached to the same Tool definition and therefore receives its declared result details.
		return result as AgentToolResult<TDetails>;
	};
	const detailPresentation: ToolDetailPresentation = {
		label: (args) => labelFor(tool, presentation, argsForPresentation(args)),
		summary: (args, result, state) => {
			const typedArgs = argsForPresentation(args);
			if (state === "running") {
				const source = presentation.runningSummary;
				return oneLine(isRuntimeFunction(source) ? source(typedArgs, undefined) : (source ?? "working"));
			}
			return oneLine(
				result
					? (presentation.summarize?.(typedArgs, resultForPresentation(result), state, undefined) ??
							(state === "success" ? "done" : state))
					: state,
			);
		},
		target: (args) => oneLine(presentation.target?.(argsForPresentation(args)) ?? ""),
	};
	if (presentation.detailLines) {
		Object.assign(detailPresentation, {
			detailLines: (
				args: ToolArguments,
				result: AgentToolResult<unknown>,
				state: Exclude<ToolActivityState, "running">,
			) => presentation.detailLines?.(argsForPresentation(args), resultForPresentation(result), state) ?? [],
		});
	}
	runtime.registerDetailPresentation(tool.name, detailPresentation);
	const decorated: ToolDefinition<TParams, TDetails> = {
		...tool,
		renderShell: "self" as const,
		renderCall: (args, theme, context) => {
			const typedArgs = argsForPresentation(args);
			const typed: ToolRenderContext<TArgs> = {
				...context,
				args: typedArgs,
			};
			// SAFETY: Pi preserves this mutable state object across renderCall and renderResult for one Tool call.
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
				const replayArgs = typedArgs;
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
			// SAFETY: Pi supplies this documented two-flag render options object to Tool result renderers.
			const renderOptions = options as ToolResultRenderOptions;
			// SAFETY: Pi reuses the state object initialized by this Tool's renderCall callback.
			const state = context.state as RendererState<TArgs, TDetails>;
			const args = state.args ?? argsForPresentation({});
			const typed: ToolRenderContext<TArgs> = {
				...context,
				args,
				expanded: renderOptions.expanded,
				isPartial: renderOptions.isPartial,
			};
			if (renderOptions.isPartial) {
				updateRunningRow(tool, presentation, runtime, state, typed, theme);
				return new EmptyToolComponent();
			}
			settleRow(tool, presentation, runtime, state, result, typed, theme);
			const embeddedHostImageKeys = Object.getOwnPropertyDescriptor(typed, EMBEDDED_HOST_IMAGE_KEYS)?.value;
			return resultBody(
				state,
				result,
				renderOptions.expanded,
				typed.showImages,
				theme,
				tool.name === "bash",
				Object.getOwnPropertyDescriptor(typed, EMBEDDED_TOOL_RESULT)?.value === true,
				embeddedHostImageKeys instanceof Map ? embeddedHostImageKeys : undefined,
			);
		},
	};
	// SAFETY: marker consumers recover this metadata only from the Tool definition that owns the same argument schema.
	const marker: SuiteActivityRendererMarker = {
		activity: presentation.activity as ToolActivityMetadata<ToolArguments, unknown>,
	};
	if (presentation.resultIsError) {
		// SAFETY: marker consumers invoke this callback only with results from the Tool definition that owns this presentation.
		Object.assign(marker, {
			resultIsError: presentation.resultIsError as NonNullable<SuiteActivityRendererMarker["resultIsError"]>,
		});
	}
	Object.defineProperty(decorated, SUITE_ACTIVITY_RENDERER, {
		enumerable: true,
		value: marker,
	});
	return decorated;
}

interface EnvelopeChildRenderer {
	component?: Component;
	readonly state: ToolRenderContext<ToolArguments>["state"];
}

interface EnvelopeRendererState {
	readonly children: Map<string, EnvelopeChildRenderer>;
}

const ENVELOPE_RENDERER_STATES = new WeakMap<object, EnvelopeRendererState>();

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

function envelopeRendererState(state: ToolRenderContext<ToolArguments>["state"]): EnvelopeRendererState {
	const existing = ENVELOPE_RENDERER_STATES.get(state);
	if (existing) return existing;
	const rendererState = { children: new Map<string, EnvelopeChildRenderer>() };
	ENVELOPE_RENDERER_STATES.set(state, rendererState);
	return rendererState;
}

function decodeEnvelopeOperations(
	decode: SuiteToolEnvelopeDecoder,
	details: SuiteToolEnvelopeDetails,
): readonly SuiteToolEnvelopeOperation[] {
	try {
		return decode(details).filter(
			(operation) =>
				isRuntimeString(operation.id) &&
				operation.id.length > 0 &&
				isRuntimeString(operation.name) &&
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
	context: ToolRenderContext<ToolArguments>,
	presentation: SuiteToolEnvelopePresentation,
): Component {
	const operations = decodeEnvelopeOperations(presentation.decode, result.details);
	if (operations.length === 0) return new EmptyToolComponent();
	let hostImageKeys: Map<string, Set<string>> | undefined;
	if (getCapabilities().images && context.showImages) {
		for (const item of result.content) {
			if (item.type !== "image" || !isRuntimeString(item.data) || !isRuntimeString(item.mimeType)) continue;
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
		if (hostImageKeys)
			Object.assign(childContext, {
				[EMBEDDED_HOST_IMAGE_KEYS]: hostImageKeys,
			});
		const container = new Container();
		// SAFETY: the registry returns the Tool that owns this decoded operation and child renderer context.
		const call = tool.renderCall(operation.args, theme, childContext as never);
		child.component = call;
		container.addChild(call);
		renderedOperations.push(container);
		if (!operation.result || !tool.renderResult) continue;
		const operationResult = projectEnvelopeOperationResult(operation, media);
		if (!operationResult) continue;
		const childIsPartial = options.isPartial && operation.state === "running";
		// SAFETY: the registry-selected Tool owns both the decoded result and the child renderer context.
		const body = tool.renderResult(
			operationResult,
			{ expanded: options.expanded, isPartial: childIsPartial },
			theme,
			{
				...childContext,
				isPartial: childIsPartial,
				lastComponent: call,
			} as never,
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
	pi: SuiteToolRegistrationHost,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolEnvelopePresentation,
): void {
	const runtime = getToolUiRuntime(pi);
	const replacesReplay = runtime.markLiveTool(tool.name);
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
			// SAFETY: this adapter preserves Pi's renderer values while erasing only the envelope Tool's generic parameters.
			renderEnvelopeOperations(
				result as AgentToolResult<unknown>,
				options as ToolResultRenderOptions,
				theme,
				context as ToolRenderContext<ToolArguments>,
				presentation,
			),
	};
	const marker: SuiteToolEnvelopeMarker = {
		decode: presentation.decode,
		registry: presentation.registry,
	};
	if (presentation.media) Object.assign(marker, { media: presentation.media });
	Object.defineProperty(decorated, SUITE_TOOL_ENVELOPE, {
		enumerable: true,
		value: marker,
	});
	pi.registerTool<TParams, TDetails>(decorated);
	if (replacesReplay && !pi.getActiveTools().includes(tool.name)) {
		pi.setActiveTools([...pi.getActiveTools(), tool.name]);
	}
}

/** Register a Tool that is visible only while its owning execution envelope is enabled. */
export function registerSuiteToolEnvelopeCompanion<TParams extends TSchema, TDetails = unknown>(
	pi: SuiteToolRegistrationHost,
	owner: string,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolPresentation<Static<TParams> & ToolArguments, TDetails>,
): void {
	const runtime = getToolUiRuntime(pi);
	const replacesReplay = runtime.markLiveTool(tool.name);
	registerSuiteToolActivityMetadata(pi, tool.name, presentation.activity, presentation.resultIsError);
	const decorated = attachRenderer<TParams, TDetails>(tool, presentation, runtime);
	Object.defineProperty(decorated, SUITE_TOOL_ENVELOPE_COMPANION, {
		enumerable: true,
		value: { owner } satisfies SuiteToolEnvelopeCompanionMarker,
	});
	pi.registerTool<TParams, TDetails>(decorated);
	if (replacesReplay && !pi.getActiveTools().includes(tool.name)) {
		pi.setActiveTools([...pi.getActiveTools(), tool.name]);
	}
	runtime.markRendererAttached(tool.name);
}

/** Register a Suite-owned Tool without changing its execute protocol or result. */
export function registerSuiteOwnedTool<TParams extends TSchema, TDetails = unknown>(
	pi: SuiteToolRegistrationHost,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolPresentation<Static<TParams> & ToolArguments, TDetails>,
	codeMode?: SuiteToolCodeModeContract,
): void {
	const runtime = getToolUiRuntime(pi);
	const replacesReplay = runtime.markLiveTool(tool.name);
	registerSuiteToolActivityMetadata(pi, tool.name, presentation.activity, presentation.resultIsError);
	const decorated = attachRenderer<TParams, TDetails>(tool, presentation, runtime);
	if (codeMode)
		Object.defineProperty(decorated, SUITE_TOOL_CODE_MODE, {
			enumerable: true,
			value: codeMode,
		});
	Object.defineProperty(decorated, SUITE_TOOL_REPLAY, {
		enumerable: true,
		// SAFETY: replay markers remain attached to the Tool and presentation whose generic schema this registry erases.
		value: Object.assign(
			{
				presentation: presentation as SuiteToolPresentation<ToolArguments, unknown>,
				tool: tool as ToolDefinition<TSchema, unknown>,
			},
			codeMode ? { codeMode } : undefined,
		) satisfies SuiteToolReplayDefinition,
	});
	pi.registerTool<TParams, TDetails>(decorated);
	if (replacesReplay && !pi.getActiveTools().includes(tool.name)) {
		pi.setActiveTools([...pi.getActiveTools(), tool.name]);
	}
	runtime.markRendererAttached(tool.name);
}

function replayFallbackLabel(name: string): string {
	return (
		name
			.split(/[_-]+/u)
			.filter(Boolean)
			.map((part) => (part.toLowerCase() === "ctx" ? "Context" : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
			.join(" ") || name
	);
}

function replayFallbackDefinition(name: string): SuiteToolReplayDefinition {
	return {
		tool: {
			name,
			label: replayFallbackLabel(name),
			description: `Historical ${name} Tool display`,
			parameters: Type.Object({}, { additionalProperties: true }),
			execute: async () => ({
				content: [
					{
						type: "text",
						text: `${name} is unavailable during Session replay.`,
					},
				],
				details: undefined,
				isError: true,
			}),
		},
		presentation: {
			activity: { categories: [], classify: () => [] },
			runningSummary: "working",
			summarize: (_args, result, state) =>
				buildToolResultLines(result)[0] ?? (state === "success" ? "done" : "failed"),
			target: (args) => {
				for (const key of ["action", "path", "query", "id", "to"] as const) {
					if (isRuntimeString(args[key]) && args[key]) return args[key];
				}
				return "";
			},
		},
	};
}

function registerMissingReplayToolDefinitions(
	pi: ExtensionAPI,
	registeredNames: Set<string>,
	historicalNames?: ReadonlySet<string>,
): readonly string[] {
	const runtime = getToolUiRuntime(pi);
	const registeredReplayNames: string[] = [];
	for (const definition of runtime.missingResumeToolDefinitions(registeredNames, historicalNames)) {
		registerSuiteOwnedTool(
			pi,
			{
				...definition.tool,
				execute: async () => ({
					content: [
						{
							type: "text",
							text: `${definition.tool.name} is unavailable during Session replay.`,
						},
					],
					details: undefined,
					isError: true,
				}),
			},
			definition.presentation,
			definition.codeMode,
		);
		runtime.markReplayOnlyTool(definition.tool.name);
		registeredNames.add(definition.tool.name);
		registeredReplayNames.push(definition.tool.name);
	}
	for (const name of runtime.missingReplayFallbackToolNames(registeredNames, historicalNames)) {
		const definition = replayFallbackDefinition(name);
		registerSuiteOwnedTool(pi, definition.tool, definition.presentation);
		runtime.markReplayOnlyTool(name);
		registeredNames.add(name);
		registeredReplayNames.push(name);
	}
	return registeredReplayNames;
}

/** Stage the Suite catalog and prebind it only when the Host is replacing a Session in-process. */
export function configureSuiteToolReplay(
	pi: ExtensionAPI,
	registeredNames: ReadonlySet<string>,
	fallbackNames: readonly string[] = [],
): void {
	const runtime = getToolUiRuntime(pi);
	runtime.stageReplayFallbackToolNames(fallbackNames);
	const hasReloadHandoff = runtime.hasReloadSnapshot();
	if (!hasReloadHandoff && !runtime.hasStagedResumeToolDefinitions()) return;
	registerMissingReplayToolDefinitions(pi, new Set(registeredNames));
}

/** Bind only known Suite definitions that are missing and present in the current historical branch. */
export function registerHistoricalSuiteToolDefinitions(
	pi: ExtensionAPI,
	historicalNames: ReadonlySet<string>,
): readonly string[] {
	const runtime = getToolUiRuntime(pi);
	runtime.hasReloadSnapshot();
	return registerMissingReplayToolDefinitions(pi, new Set(pi.getAllTools().map((tool) => tool.name)), historicalNames);
}
