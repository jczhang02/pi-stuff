import { createHash } from "node:crypto";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { type Static, type TSchema, Type } from "typebox";
import { getHostSharedResource } from "../conversation-ui/host-resource.js";
import { isRuntimeString } from "../shared/runtime-type.js";
import {
	type ActivitySummaryMember,
	classifyToolActivityGroupInvocation,
	type PlannedToolActivityGroup,
	type PlannedToolActivityMember,
	planToolActivityGroups,
	summarizeToolActivityAggregate,
	summarizeToolActivityGroup,
	type ToolActivityGroupDisposition,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolActivityOutcome,
	type ToolArguments,
	toolActivityOutcome,
} from "./activity.js";
import { type ToolActivity, type ToolActivityState, ToolActivityStore } from "./activity-store.js";
import {
	activityRecoveryKeys,
	assistantTerminalState,
	canonicalCountKey,
	GroupSummaryIndex,
	hashRetryValue,
	isIssueState,
	terminalStateFromResult,
	visibleActivityItems,
} from "./activity-summary.js";
import {
	decodeEnvelopeOperations,
	envelopeFallbackVisible,
	envelopeOperationResult,
	prepareEnvelopeRenderArguments,
	renderEnvelopeOperations,
} from "./envelope-renderer.js";
import {
	BASH_OUTPUT_COLLAPSED_SOURCE_LIMIT,
	BASH_OUTPUT_SOURCE_LIMIT,
	DETAIL_BYTE_LIMIT,
	DETAIL_LINE_LIMIT,
} from "./limits.js";
import { attachRenderer, formattedResultLines, terminalSummary } from "./registered-tool-renderer.js";
import {
	createSuiteToolRegistrationTrackerWithRuntime,
	SUITE_TOOL_CODE_MODE,
	SUITE_TOOL_ENVELOPE,
	SUITE_TOOL_ENVELOPE_COMPANION,
	SUITE_TOOL_REPLAY,
	type SuiteToolEnvelopeCompanionMarker,
	type SuiteToolEnvelopeMarker,
} from "./registration-tracker.js";
import {
	type ActivityGroupRowModel,
	type BashOperationRowModel,
	buildRawToolDetailLines,
	buildToolResultLines,
	type CachedToolRow,
	capDetailLines,
	EmptyToolComponent,
	oneLine,
	sanitizeTerminalText,
	summarizeBuiltin,
	type ToolRowModel,
} from "./render.js";
import { ToolUiSettingsStore } from "./settings.js";
import { isRecordValue, isToolArguments } from "./tool-value.js";

export {
	sendSuiteAgentMessage,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "../conversation-ui/index.js";

const TOOL_RUNTIME_REGISTRY = Symbol.for("@jczhang02/pi-stuff-tools/runtime-registry.v1");
const TOOL_RUNTIME_DISCOVERY_EVENT = "@jczhang02/pi-stuff-tools/runtime-discovery/v1";
const TOOL_RELOAD_HANDOFF = Symbol.for("@jczhang02/pi-stuff-tools/reload-handoff.v1");
export interface ToolSummaryProjection {
	readonly fromResult: boolean;
	readonly text: string;
}

export interface ToolDetailPresentation {
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
	) => string | ToolSummaryProjection;
	readonly target: (args: ToolArguments) => string;
}
const ACTIVITY_HINT_HOLD_MS = 700;
const GROUP_LIST_LIMIT = 768;
const PENDING_RESULT_LIMIT = 768;
const BINDING_LIMIT = 768;
const TIMER_STATE_LIMIT = 768;

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
type SuiteToolEnvelopeArgumentPreparer = (operation: SuiteToolEnvelopeOperation) => ToolArguments;
export type SuiteToolEnvelopeFallbackVisibility = (
	args: ToolArguments,
	result: AgentToolResult<unknown>,
	state: ToolActivityState,
) => boolean;

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
	readonly showFallback?: SuiteToolEnvelopeFallbackVisibility;
}

export interface RendererState<TArgs extends ToolArguments, TDetails> {
	args?: Readonly<TArgs>;
	component?: CachedToolRow;
	detailLines?: readonly string[];
	detailMaterialized?: boolean;
	lastResult?: AgentToolResult<TDetails>;
	liveEffectsStarted?: boolean;
	projectedReplay?: boolean;
	startedAt?: number;
	summary?: ToolSummaryProjection;
	terminalModelMaterialized?: boolean;
	terminalState?: Exclude<ToolActivityState, "running">;
	wasLiveExecution?: boolean;
}

export interface ToolRenderContext<TArgs extends ToolArguments> {
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

export interface ToolResultRenderOptions {
	readonly expanded: boolean;
	readonly isPartial: boolean;
}

export interface PresentedToolMetadata {
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
	private readonly envelopeArgumentPreparers = new Map<string, SuiteToolEnvelopeArgumentPreparer>();
	private readonly envelopeDecoders = new Map<string, SuiteToolEnvelopeDecoder>();
	private readonly envelopeFallbackVisibility = new Map<string, SuiteToolEnvelopeFallbackVisibility>();
	private readonly envelopeRawArguments = new Map<string, ToolArguments>();
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

	registerEnvelope(
		name: string,
		decode: SuiteToolEnvelopeDecoder,
		prepareArguments?: SuiteToolEnvelopeArgumentPreparer,
		showFallback?: SuiteToolEnvelopeFallbackVisibility,
	): void {
		this.envelopeDecoders.set(name, decode);
		if (prepareArguments) this.envelopeArgumentPreparers.set(name, prepareArguments);
		else this.envelopeArgumentPreparers.delete(name);
		if (showFallback) this.envelopeFallbackVisibility.set(name, showFallback);
		else this.envelopeFallbackVisibility.delete(name);
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
		const rawArgs = this.envelopeRawArguments.get(toolCallId) ?? args;
		const name = member?.name ?? binding?.metadata.name ?? activity.name;
		const result = member?.result ?? binding?.metadata.result ?? this.liveResults.get(toolCallId);
		if (mode === "raw") {
			return {
				activity,
				lines: buildRawToolDetailLines(toolCallId, name, rawArgs, result),
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

	private decodeEnvelope(name: string, details: SuiteToolEnvelopeDetails): readonly SuiteToolEnvelopeOperation[] {
		const decode = this.envelopeDecoders.get(name);
		if (!decode) return [];
		return decodeEnvelopeOperations(decode, details);
	}

	private prepareEnvelopeArguments(name: string, operation: SuiteToolEnvelopeOperation): ToolArguments {
		const prepare = this.envelopeArgumentPreparers.get(name);
		if (!prepare) return operation.args;
		try {
			return prepare(operation);
		} catch {
			return operation.args;
		}
	}

	private showEnvelopeFallback(
		name: string,
		args: ToolArguments,
		result: AgentToolResult<unknown>,
		state: ToolActivityState,
	): boolean {
		return envelopeFallbackVisible(this.envelopeFallbackVisibility.get(name), args, result, state);
	}

	/** Project registered Tool envelopes into the ordinary calls and results they contain. */
	projectMessages(messages: readonly unknown[]): readonly unknown[] {
		if (this.envelopeDecoders.size === 0) return messages;
		this.envelopeRawArguments.clear();
		const envelopeCallsById = new Map<string, { readonly args: ToolArguments; readonly name: string }>();
		for (const candidate of messages) {
			if (!isRecordValue(candidate) || candidate["role"] !== "assistant" || !Array.isArray(candidate["content"])) {
				continue;
			}
			for (const block of candidate["content"]) {
				if (!isRecordValue(block) || block["type"] !== "toolCall") continue;
				const id = block["id"];
				const name = block["name"];
				if (isRuntimeString(id) && isRuntimeString(name) && this.envelopeDecoders.has(name)) {
					envelopeCallsById.set(id, {
						args: isToolArguments(block["arguments"]) ? block["arguments"] : {},
						name,
					});
				}
			}
		}
		const projectionsById = new Map<
			string,
			{
				readonly fallback: boolean;
				readonly name: string;
				readonly operations: readonly SuiteToolEnvelopeOperation[];
			}
		>();
		for (const candidate of messages) {
			if (!isRecordValue(candidate) || candidate["role"] !== "toolResult") continue;
			const id = candidate["toolCallId"];
			if (!isRuntimeString(id)) continue;
			const envelope = envelopeCallsById.get(id);
			if (!envelope) continue;
			const content = Array.isArray(candidate["content"]) ? candidate["content"] : [];
			const operations = this.decodeEnvelope(envelope.name, candidate["details"]);
			const result: AgentToolResult<unknown> & { isError?: true } = {
				// SAFETY: Pi tool-result messages own this content array; visibility never rewrites its blocks.
				content: content as AgentToolResult<unknown>["content"],
				details: candidate["details"],
			};
			if (candidate["isError"] === true) Object.assign(result, { isError: true as const });
			const state: Exclude<ToolActivityState, "running"> = candidate["isError"] === true ? "error" : "success";
			const ownsOuterOutcome =
				operations.length === 0 ||
				(candidate["isError"] === true &&
					!operations.some((operation) => operation.state !== "running" && operation.state !== "success"));
			projectionsById.set(id, {
				fallback: ownsOuterOutcome && this.showEnvelopeFallback(envelope.name, envelope.args, result, state),
				name: envelope.name,
				operations,
			});
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
					const projection = projectionsById.get(id);
					if (!projection) return [block];
					const nested = projection.operations.map((operation) => {
						this.envelopeRawArguments.set(operation.id, operation.args);
						return {
							arguments: this.prepareEnvelopeArguments(projection.name, operation),
							id: operation.id,
							name: operation.name,
							type: "toolCall",
						};
					});
					return projection.fallback ? [...nested, block] : nested;
				});
				projected.push({ ...candidate, content });
				continue;
			}
			if (candidate["role"] === "toolResult") {
				const id = candidate["toolCallId"];
				const projection = isRuntimeString(id) ? projectionsById.get(id) : undefined;
				if (!projection) {
					projected.push(candidate);
					continue;
				}
				for (const operation of projection.operations) {
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
				if (projection.fallback) projected.push(candidate);
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

/** Observe every Tool registered by Suite modules without changing the Host API. */
export function createSuiteToolRegistrationTracker<Host extends SuiteToolTrackerHost>(
	pi: Host,
): SuiteToolRegistrationTracker<Host> {
	return createSuiteToolRegistrationTrackerWithRuntime(pi, getToolUiRuntime(pi), prepareEnvelopeRenderArguments);
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

/**
 * Register an execution envelope whose nested Suite Tools retain their original
 * Tool Activity renderers. The envelope stays silent only while nested rows own its outcome.
 */
export function registerSuiteToolEnvelope<TParams extends TSchema, TDetails = unknown>(
	pi: SuiteToolRegistrationHost,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolEnvelopePresentation,
): void {
	const runtime = getToolUiRuntime(pi);
	const replacesReplay = runtime.markLiveTool(tool.name);
	runtime.registerEnvelope(
		tool.name,
		presentation.decode,
		(operation) => {
			const nested = presentation.registry.get(operation.name);
			return nested ? prepareEnvelopeRenderArguments(nested, operation.args) : operation.args;
		},
		presentation.showFallback,
	);
	runtime.registerDetailPresentation(tool.name, {
		label: () => sanitizeTerminalText(tool.label ?? tool.name) || tool.name,
		summary: (_args, result, state) =>
			state === "running"
				? { fromResult: false, text: "working" }
				: result
					? terminalSummary(result, state, true)
					: { fromResult: false, text: state },
		target: () => "",
	});
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
				tool as ToolDefinition,
			),
	};
	const marker: SuiteToolEnvelopeMarker = {
		decode: presentation.decode,
		registry: presentation.registry,
	};
	if (presentation.media) Object.assign(marker, { media: presentation.media });
	if (presentation.showFallback) Object.assign(marker, { showFallback: presentation.showFallback });
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

/**
 * Register a Suite-owned Tool without changing its execute protocol or result.
 * Returns the exact registered definition so an owner can refresh dynamic model-facing fields through Pi's public API.
 */
export function registerSuiteOwnedTool<TParams extends TSchema, TDetails = unknown>(
	pi: SuiteToolRegistrationHost,
	tool: ToolDefinition<TParams, TDetails>,
	presentation: SuiteToolPresentation<Static<TParams> & ToolArguments, TDetails>,
	codeMode?: SuiteToolCodeModeContract,
): ToolDefinition<TParams, TDetails> {
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
	return decorated;
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
