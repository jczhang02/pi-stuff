import { basename } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isRuntimeNumber } from "../shared/runtime-type.js";
import { getHostSharedResource } from "./host-resource.js";
import type { GitChangeCounts, GitChangeCountsSource } from "./statusline-git.js";
import {
	type PromptPreview,
	readSkillAliases,
	type SessionStatusSnapshot,
	SessionStatusSource,
	type StatuslineSessionManager,
	type UsageTotals,
} from "./statusline-session.js";
import { sanitizeOneLine } from "./terminal-text.js";

export type { GitChangeCounts } from "./statusline-git.js";
export { GitStatusSource, parseGitStatusPorcelain } from "./statusline-git.js";

const DEFAULT_EXTENSION_STATUS_KEYS: readonly string[] = [];
const GOAL_CLOCK_REFRESH_MS = 1_000;
const MIN_TRUNCATED_PROMPT_WIDTH = 6;
const STATUSLINE_SEPARATOR = " · ";

interface StatuslineIcons {
	readonly ahead: string;
	readonly behind: string;
	readonly branch: string;
	readonly cache: string;
	readonly conflict: string;
	readonly context: string;
	readonly cost: string;
	readonly fast: string;
	readonly folder: string;
	readonly goalActive: string;
	readonly goalAttention: string;
	readonly goalComplete: string;
	readonly goalPaused: string;
	readonly model: string;
	readonly prompt: string;
	readonly staged: string;
	readonly thinking: string;
	readonly unstaged: string;
	readonly untracked: string;
	readonly weekly: string;
}

const STATUSLINE_ICONS: StatuslineIcons = {
	ahead: "\uF431",
	behind: "\uF433",
	branch: "\uF418",
	cache: "\u{F01BC}",
	conflict: "\uF421",
	context: "\u{F0328}",
	cost: "\uF155",
	fast: "\uF0E7",
	folder: "\u{F024B}",
	goalActive: "\uF111",
	goalAttention: "\uF06A",
	goalComplete: "\uF49E",
	goalPaused: "\uF28B",
	model: "\u{F167A}",
	prompt: "\uF460",
	staged: "\uF457",
	thinking: "\uF0EB",
	unstaged: "\uF459",
	untracked: "\uF420",
	weekly: "\u{F029A}",
};

export interface BooleanValueSource {
	get(): boolean;
	subscribe(listener: () => void): () => void;
}

export interface CodexStatusSnapshot {
	readonly fastEnabled: boolean;
	readonly weeklyRemainingPercent?: number;
}

export interface CodexStatusSource {
	getSnapshot(): CodexStatusSnapshot;
	subscribe(listener: () => void): () => void;
}

export interface CodexStatusChannel {
	readonly source: CodexStatusSource;
	clear(): void;
	publish(snapshot: CodexStatusSnapshot): void;
}

export type GoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";

export interface GoalStatusSnapshot {
	readonly activeStartedAt?: number;
	readonly status: GoalStatus;
	readonly timeUsedSeconds: number;
	readonly tokenBudget?: number;
	readonly tokensUsed: number;
}

export interface GoalStatusSource {
	getSnapshot(): GoalStatusSnapshot | undefined;
	subscribe(listener: () => void): () => void;
}

export interface GoalStatusChannel {
	readonly source: GoalStatusSource;
	clear(): void;
	publish(snapshot: GoalStatusSnapshot): void;
}

const CODEX_STATUS_CHANNELS = Symbol.for("@jczhang02/pi-stuff-ui/codex-status-channels/v1");
const GOAL_STATUS_CHANNELS = Symbol.for("@jczhang02/pi-stuff-ui/goal-status-channels/v1");
const CODEX_STATUS_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/codex-status-discovery/v1";
const GOAL_STATUS_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/goal-status-discovery/v1";

type StatusChannelHost = Pick<ExtensionAPI, "events"> & Partial<Pick<ExtensionAPI, "on">>;

function registerStatusChannelCleanup(pi: StatusChannelHost, cleanup: () => void): void {
	pi.on?.("session_shutdown", cleanup);
}

class SharedCodexStatusChannel implements CodexStatusChannel, CodexStatusSource {
	private readonly listeners = new Set<() => void>();
	private snapshot: CodexStatusSnapshot = { fastEnabled: false };
	readonly source: CodexStatusSource = this;

	clear(): void {
		this.setSnapshot({ fastEnabled: false });
	}

	getSnapshot(): CodexStatusSnapshot {
		return this.snapshot;
	}

	publish(snapshot: CodexStatusSnapshot): void {
		const next: CodexStatusSnapshot = {
			fastEnabled: snapshot.fastEnabled === true,
		};
		if (isRuntimeNumber(snapshot.weeklyRemainingPercent) && Number.isFinite(snapshot.weeklyRemainingPercent)) {
			Object.assign(next, { weeklyRemainingPercent: snapshot.weeklyRemainingPercent });
		}
		this.setSnapshot(next);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setSnapshot(next: CodexStatusSnapshot): void {
		if (
			this.snapshot.fastEnabled === next.fastEnabled &&
			this.snapshot.weeklyRemainingPercent === next.weeklyRemainingPercent
		) {
			return;
		}
		this.snapshot = next;
		for (const listener of this.listeners) callObserver(listener);
	}
}

function codexStatusChannels(): WeakMap<ExtensionAPI["events"], CodexStatusChannel> {
	// SAFETY: this package is the sole writer of the symbol-owned slot and stores only the declared WeakMap.
	const root = globalThis as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], CodexStatusChannel> | undefined;
	};
	root[CODEX_STATUS_CHANNELS] ??= new WeakMap();
	return root[CODEX_STATUS_CHANNELS];
}

/** Share one late-bindable Codex presentation channel across Capability copies. */
export function getCodexStatusChannel(pi: StatusChannelHost): CodexStatusChannel {
	const channels = codexStatusChannels();
	// SAFETY: ExtensionAPI events are objects, so this WeakMap's keys satisfy the shared resource's object-key contract.
	const sharedChannels = channels as WeakMap<object, CodexStatusChannel>;
	return getHostSharedResource(
		pi.events,
		sharedChannels,
		CODEX_STATUS_DISCOVERY_EVENT,
		() => new SharedCodexStatusChannel(),
		{ registerOwnerCleanup: (cleanup) => registerStatusChannelCleanup(pi, cleanup) },
	);
}

class SharedGoalStatusChannel implements GoalStatusChannel, GoalStatusSource {
	private readonly listeners = new Set<() => void>();
	private snapshot: GoalStatusSnapshot | undefined;
	readonly source: GoalStatusSource = this;

	clear(): void {
		this.setSnapshot(undefined);
	}

	getSnapshot(): GoalStatusSnapshot | undefined {
		return this.snapshot;
	}

	publish(snapshot: GoalStatusSnapshot): void {
		if (!isGoalStatus(snapshot.status)) return;
		const tokensUsed = finiteNonNegative(snapshot.tokensUsed);
		const timeUsedSeconds = finiteNonNegative(snapshot.timeUsedSeconds);
		const tokenBudget = finitePositive(snapshot.tokenBudget);
		const next: GoalStatusSnapshot = {
			status: snapshot.status,
			timeUsedSeconds,
			tokensUsed,
		};
		const activeStartedAt = snapshot.status === "active" ? finitePositive(snapshot.activeStartedAt) : undefined;
		if (activeStartedAt !== undefined) Object.assign(next, { activeStartedAt });
		if (tokenBudget !== undefined) Object.assign(next, { tokenBudget });
		this.setSnapshot(next);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setSnapshot(next: GoalStatusSnapshot | undefined): void {
		if (
			this.snapshot?.activeStartedAt === next?.activeStartedAt &&
			this.snapshot?.status === next?.status &&
			this.snapshot?.timeUsedSeconds === next?.timeUsedSeconds &&
			this.snapshot?.tokensUsed === next?.tokensUsed &&
			this.snapshot?.tokenBudget === next?.tokenBudget
		) {
			return;
		}
		this.snapshot = next;
		for (const listener of this.listeners) callObserver(listener);
	}
}

function goalStatusChannels(): WeakMap<ExtensionAPI["events"], GoalStatusChannel> {
	// SAFETY: this package is the sole writer of the symbol-owned slot and stores only the declared WeakMap.
	const root = globalThis as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], GoalStatusChannel> | undefined;
	};
	root[GOAL_STATUS_CHANNELS] ??= new WeakMap();
	return root[GOAL_STATUS_CHANNELS];
}

/** Share one observation-only Goal presentation channel across Capability copies. */
export function getGoalStatusChannel(pi: StatusChannelHost): GoalStatusChannel {
	const channels = goalStatusChannels();
	// SAFETY: ExtensionAPI events are objects, so this WeakMap's keys satisfy the shared resource's object-key contract.
	const sharedChannels = channels as WeakMap<object, GoalStatusChannel>;
	return getHostSharedResource(
		pi.events,
		sharedChannels,
		GOAL_STATUS_DISCOVERY_EVENT,
		() => new SharedGoalStatusChannel(),
		{ registerOwnerCleanup: (cleanup) => registerStatusChannelCleanup(pi, cleanup) },
	);
}

export type StatuslineDensity = "auto" | "full" | "compact";

export interface StatuslinePreferences {
	readonly density: StatuslineDensity;
	readonly enabled: boolean;
	readonly latestPrompt: boolean;
}

export interface StatuslinePreferencesSource {
	get(): StatuslinePreferences;
	subscribe(listener: () => void): () => void;
}

interface SharedStatuslineControllerOptions {
	readonly autocompleteVisible?: BooleanValueSource;
	readonly codexStatus?: CodexStatusSource;
	readonly extensionStatusKeys?: readonly string[];
	readonly gitChanges?: GitChangeCountsSource;
	readonly goalStatus?: GoalStatusSource;
}

export type StatuslineControllerOptions = SharedStatuslineControllerOptions &
	(
		| { readonly enabled: BooleanValueSource; readonly preferences?: never }
		| { readonly enabled?: never; readonly preferences: StatuslinePreferencesSource }
	);

interface RenderRegistration {
	requestRender(force?: boolean): void;
}

export type StatuslineHost = Pick<ExtensionAPI, "getCommands" | "getThinkingLevel">;

export interface StatuslineContext {
	readonly cwd: string;
	getContextUsage():
		| { readonly contextWindow: number | null; readonly percent: number | null; readonly tokens: number | null }
		| undefined;
	readonly model: ExtensionContext["model"];
	readonly modelRegistry: Pick<ExtensionContext["modelRegistry"], "isUsingOAuth">;
	readonly sessionManager: StatuslineSessionManager;
	readonly thinkingLevel?: ExtensionContext["thinkingLevel"];
}

/**
 * Owns Statusline suppression independently from its data and settings. The
 * controller is structurally compatible with CommandDialogChrome.
 */
export class StatuslineController {
	private disposed = false;
	private goalClockTimer: ReturnType<typeof setInterval> | undefined;
	private readonly options: StatuslineControllerOptions;
	private readonly pi: StatuslineHost;
	private readonly renderers = new Set<RenderRegistration>();
	private readonly sessionStatusSources = new WeakMap<StatuslineSessionManager, SessionStatusSource>();
	private readonly skillAliases: ReadonlyMap<string, string>;
	private suppressed = false;

	constructor(pi: StatuslineHost, options: StatuslineControllerOptions) {
		this.pi = pi;
		this.options = options;
		this.skillAliases = readSkillAliases(pi);
	}

	createFooter(
		ctx: StatuslineContext,
		tui: RenderRegistration,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	): Component & { dispose(): void } {
		return new StatuslineFooter(this, ctx, tui, theme, footerData);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearGoalClockTimer();
		this.requestRender();
		this.renderers.clear();
	}

	isVisible(): boolean {
		return (
			!this.disposed &&
			!this.suppressed &&
			this.getPreferences().enabled &&
			!(this.options.autocompleteVisible?.get() ?? false)
		);
	}

	isEnabled(): boolean {
		return !this.disposed && this.getPreferences().enabled;
	}

	registerRenderer(renderer: RenderRegistration): () => void {
		if (this.disposed) return () => {};
		this.renderers.add(renderer);
		this.syncGoalClockTimer();
		return () => {
			this.renderers.delete(renderer);
			this.syncGoalClockTimer();
		};
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		const notify = () => {
			this.syncGoalClockTimer();
			callObserver(listener);
		};
		const unsubscribe: Array<() => void> = [];
		const preferencesSource = this.options.preferences ?? this.options.enabled;
		subscribeObserver(preferencesSource, notify, unsubscribe);
		if (this.options.autocompleteVisible) subscribeObserver(this.options.autocompleteVisible, notify, unsubscribe);
		if (this.options.codexStatus) subscribeObserver(this.options.codexStatus, notify, unsubscribe);
		if (this.options.gitChanges) subscribeObserver(this.options.gitChanges, notify, unsubscribe);
		if (this.options.goalStatus) subscribeObserver(this.options.goalStatus, notify, unsubscribe);
		return () => {
			for (const remove of unsubscribe.splice(0)) callObserver(remove);
		};
	}

	render(ctx: StatuslineContext, theme: Theme, footerData: ReadonlyFooterDataProvider, width: number): string[] {
		if (!this.isVisible()) return [];
		const renderWidth = Math.max(0, Math.floor(width));
		if (renderWidth < 1) return [];
		const sessionStatus = this.getSessionStatusSource(ctx).get();
		const branch = sanitizeOneLine(footerData.getGitBranch() ?? "");
		const preferences = this.getPreferences();
		const lines = renderStatusline(
			this.pi,
			ctx,
			theme,
			footerData,
			branch,
			this.options.gitChanges?.get(readRawCwd(ctx), branch),
			this.options.extensionStatusKeys ?? DEFAULT_EXTENSION_STATUS_KEYS,
			sessionStatus,
			readCodexStatus(ctx, this.options.codexStatus),
			readGoalStatus(this.options.goalStatus),
			renderWidth,
			preferences,
		);
		return lines.map((line) =>
			visibleWidth(line) <= renderWidth ? line : truncateToWidth(line, renderWidth, theme.fg("dim", "…")),
		);
	}

	setSuppressed(suppressed: boolean): void {
		if (this.disposed || this.suppressed === suppressed) return;
		this.suppressed = suppressed;
		this.syncGoalClockTimer();
		this.requestRender();
	}

	handleBranchChange(): void {
		if (this.disposed) return;
		this.requestRender();
	}

	private requestRender(): void {
		for (const renderer of this.renderers) callObserver(() => renderer.requestRender());
	}

	private syncGoalClockTimer(): void {
		const snapshot = readGoalStatus(this.options.goalStatus);
		const shouldRun =
			this.renderers.size > 0 &&
			this.isVisible() &&
			snapshot?.status === "active" &&
			snapshot.activeStartedAt !== undefined;
		if (shouldRun && !this.goalClockTimer) {
			this.goalClockTimer = setInterval(() => this.requestRender(), GOAL_CLOCK_REFRESH_MS);
			this.goalClockTimer.unref?.();
		} else if (!shouldRun) {
			this.clearGoalClockTimer();
		}
	}

	private clearGoalClockTimer(): void {
		if (!this.goalClockTimer) return;
		clearInterval(this.goalClockTimer);
		this.goalClockTimer = undefined;
	}

	private getPreferences(): StatuslinePreferences {
		if (this.options.preferences) return this.options.preferences.get();
		return {
			density: "auto",
			enabled: this.options.enabled.get(),
			latestPrompt: true,
		};
	}

	private getSessionStatusSource(ctx: StatuslineContext): SessionStatusSource {
		const sessionManager = ctx.sessionManager;
		let source = this.sessionStatusSources.get(sessionManager);
		if (!source) {
			source = new SessionStatusSource(sessionManager, this.skillAliases);
			this.sessionStatusSources.set(sessionManager, source);
		}
		return source;
	}
}

class StatuslineFooter implements Component {
	private readonly controller: StatuslineController;
	private readonly ctx: StatuslineContext;
	private disposed = false;
	private readonly footerData: ReadonlyFooterDataProvider;
	private readonly theme: Theme;
	private readonly tui: RenderRegistration;
	private readonly unsubscribe: Array<() => void>;

	constructor(
		controller: StatuslineController,
		ctx: StatuslineContext,
		tui: RenderRegistration,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	) {
		this.controller = controller;
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.footerData = footerData;
		const render = () => callObserver(() => this.tui.requestRender());
		this.unsubscribe = [controller.registerRenderer({ requestRender: render })];
		try {
			this.unsubscribe.push(footerData.onBranchChange(() => this.controller.handleBranchChange()));
		} catch {
			// A broken branch observer must not prevent the footer from rendering.
		}
		this.unsubscribe.push(controller.subscribe(render));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of this.unsubscribe.splice(0)) callObserver(unsubscribe);
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.disposed) return [];
		return this.controller.render(this.ctx, this.theme, this.footerData, width);
	}
}

type StatusSegmentId =
	| "model"
	| "thinking"
	| "fast"
	| "cwd"
	| "branch"
	| "diff"
	| "context"
	| "cache"
	| "cost"
	| "codex"
	| "goal"
	| "extension";

interface StatusSegment {
	readonly compact: string;
	readonly full: string;
	readonly id: StatusSegmentId;
	readonly minimum?: string;
	readonly priority: number;
}

interface SegmentText {
	readonly compact: string;
	readonly full: string;
}

interface GoalStatusAppearance {
	readonly color: ThemeColor;
	readonly icon: string;
	readonly label: string;
}

interface GitSegments {
	branch?: SegmentText;
	diff?: SegmentText;
}

function renderStatusline(
	pi: StatuslineHost,
	ctx: StatuslineContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	branch: string,
	gitChanges: GitChangeCounts | undefined,
	extensionStatusKeys: readonly string[],
	sessionStatus: SessionStatusSnapshot,
	codexStatus: CodexStatusSnapshot | undefined,
	goalStatus: GoalStatusSnapshot | undefined,
	width: number,
	preferences: StatuslinePreferences,
): string[] {
	const icons = STATUSLINE_ICONS;
	const usage = sessionStatus.usage;
	const segments: StatusSegment[] = [];
	const modelName = displayModelIdentity(ctx);
	const model = theme.fg("accent", withIcon(icons.model, modelName));
	const compactModel = theme.fg("accent", withIcon(icons.model, displayCompactModelName(ctx)));
	const minimumModel = theme.fg("accent", icons.model);
	segments.push(statusSegment("model", 100, model, compactModel, minimumModel));
	if (ctx.model?.reasoning !== false) {
		const thinkingLevel = readThinkingLevel(pi, ctx);
		const thinking = `${theme.fg(thinkingColor(thinkingLevel), icons.thinking)} ${theme.fg(
			"muted",
			formatThinking(thinkingLevel),
		)}`;
		segments.push(statusSegment("thinking", 65, thinking));
	}
	if (ctx.model?.provider === "openai-codex" && codexStatus?.fastEnabled === true) {
		segments.push(statusSegment("fast", 55, theme.fg("warning", withIcon(icons.fast, "fast"))));
	}
	const cwd = readCwd(ctx);
	const cwdText = basename(cwd) || cwd;
	const cwdSegment = `${theme.fg("accent", icons.folder)} ${theme.fg("text", cwdText)}`;
	segments.push(statusSegment("cwd", 95, cwdSegment));

	const gitSegments = renderGitSegments(theme, icons, branch, gitChanges);
	if (gitSegments.branch) {
		segments.push(statusSegment("branch", 90, gitSegments.branch.full, gitSegments.branch.compact));
	}
	if (gitSegments.diff) segments.push(statusSegment("diff", 50, gitSegments.diff.full, gitSegments.diff.compact));

	const statuses = footerData.getExtensionStatuses();
	const contextSegment = renderContextSegment(ctx, theme, icons, statuses);
	if (contextSegment) segments.push(statusSegment("context", 96, contextSegment.full, contextSegment.compact));
	const cacheHitRate = formatCacheHitRate(usage);
	if (cacheHitRate) {
		const cache = `${theme.fg("muted", icons.cache)} ${theme.fg("text", cacheHitRate)}`;
		segments.push(statusSegment("cache", 45, cache));
	}
	if (ctx.model?.provider === "openai-codex") {
		const weekly = formatCodexWeekly(codexStatus);
		if (weekly) {
			const value = `${theme.fg("warning", icons.weekly)} ${theme.fg("text", weekly)}`;
			segments.push(statusSegment("codex", 80, value));
		}
	} else if (usage.cost > 0 && shouldShowCost(ctx)) {
		const cost = `${theme.fg("warning", icons.cost)} ${theme.fg("text", `$${usage.cost.toFixed(2)}`)}`;
		segments.push(statusSegment("cost", 80, cost));
	}
	const goal = renderGoalSegment(theme, icons, goalStatus);
	if (goal) segments.push(statusSegment("goal", 99, goal.full, goal.compact));

	const extensionStatusSegment = renderExtensionStatusSegment(theme, statuses, extensionStatusKeys);
	if (extensionStatusSegment) segments.push(statusSegment("extension", 35, extensionStatusSegment));

	const status = renderStatusRow(segments, width, theme, preferences.density);
	const prompt = preferences.latestPrompt
		? renderPromptRow(sessionStatus.latestPrompt, width, theme, icons)
		: undefined;
	return [status, prompt].filter((line): line is string => line !== undefined && line.length > 0);
}

function statusSegment(
	id: StatusSegmentId,
	priority: number,
	full: string,
	compact = full,
	minimum?: string,
): StatusSegment {
	const segment: StatusSegment = { compact, full, id, priority };
	if (minimum) Object.assign(segment, { minimum });
	return segment;
}

function renderGitSegments(theme: Theme, icons: StatuslineIcons, branch: string, counts: GitChangeCounts | undefined) {
	const ahead = counts?.ahead ?? 0;
	const behind = counts?.behind ?? 0;
	const conflicted = counts?.conflicted ?? 0;
	const dirty = !!counts && (counts.staged > 0 || counts.unstaged > 0 || counts.untracked > 0 || conflicted > 0);
	const branchColor: ThemeColor = conflicted > 0 ? "error" : dirty || behind > 0 ? "warning" : "success";
	let branchSegment: SegmentText | undefined;
	if (branch) {
		const tracking = [
			ahead > 0 ? theme.fg("success", `${icons.ahead}${String(ahead)}`) : "",
			behind > 0 ? theme.fg("warning", `${icons.behind}${String(behind)}`) : "",
		].filter(Boolean);
		const fullBranch = `${theme.fg(branchColor, icons.branch)} ${theme.fg("text", branch)}`;
		const compactBranch = `${theme.fg(branchColor, icons.branch)} ${theme.fg("text", middleTruncate(branch, 14))}`;
		branchSegment = {
			compact: [compactBranch, ...tracking].join(" "),
			full: [fullBranch, ...tracking].join(" "),
		};
	}

	const fullState: string[] = [];
	if (conflicted > 0) fullState.push(theme.fg("error", `${icons.conflict}${String(conflicted)}`));
	if (counts?.staged) fullState.push(theme.fg("success", `${icons.staged}${String(counts.staged)}`));
	if (counts?.unstaged) fullState.push(theme.fg("warning", `${icons.unstaged}${String(counts.unstaged)}`));
	if (counts?.untracked) fullState.push(theme.fg("muted", `${icons.untracked}${String(counts.untracked)}`));
	const compactState: string[] = [];
	if (conflicted > 0) compactState.push(theme.fg("error", `${icons.conflict}${compactCount(conflicted)}`));
	const changed = (counts?.staged ?? 0) + (counts?.unstaged ?? 0) + (counts?.untracked ?? 0);
	if (changed > 0) compactState.push(theme.fg("warning", `${icons.unstaged}${compactCount(changed)}`));
	const diffSegment =
		fullState.length > 0
			? {
					compact: compactState.join(" "),
					full: fullState.join(" "),
				}
			: undefined;
	const segments: GitSegments = {};
	if (branchSegment) segments.branch = branchSegment;
	if (diffSegment) segments.diff = diffSegment;
	return segments;
}

function compactCount(value: number): string {
	return value > 99 ? "99+" : String(value);
}

function renderContextSegment(
	ctx: StatuslineContext,
	theme: Theme,
	icons: StatuslineIcons,
	statuses: ReadonlyMap<string, string>,
): SegmentText | undefined {
	if (statuses.has("compact-policy")) return undefined;
	let usage: ReturnType<StatuslineContext["getContextUsage"]>;
	try {
		usage = ctx.getContextUsage();
	} catch {
		return undefined;
	}
	const percent = usage?.percent;
	const knownPercent = isRuntimeNumber(percent) && Number.isFinite(percent);
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	const knownWindow = isRuntimeNumber(contextWindow) && Number.isFinite(contextWindow) && contextWindow > 0;
	if (!knownPercent && !knownWindow) return undefined;
	const boundedPercent = knownPercent ? Math.max(0, percent) : undefined;
	const fullValue = boundedPercent === undefined ? "?" : `${boundedPercent.toFixed(1).replace(/\.0$/u, "")}%`;
	const compactValue = boundedPercent === undefined ? "?" : `${String(Math.round(boundedPercent))}%`;
	const color: ThemeColor =
		boundedPercent === undefined ? "dim" : boundedPercent >= 90 ? "error" : boundedPercent >= 70 ? "warning" : "dim";
	return {
		compact: `${theme.fg(color, icons.context)} ${theme.fg("text", compactValue)}`,
		full: `${theme.fg(color, icons.context)} ${theme.fg("text", fullValue)}`,
	};
}

function renderExtensionStatusSegment(
	theme: Theme,
	statuses: ReadonlyMap<string, string>,
	keys: readonly string[],
): string | undefined {
	const selected: string[] = [];
	const seen = new Set<string>();
	for (const key of keys) {
		const status = sanitizeOneLine(statuses.get(key) ?? "");
		if (!status || status.startsWith("[") || seen.has(status)) continue;
		seen.add(status);
		selected.push(status);
	}
	return selected.length > 0 ? theme.fg("muted", selected.join(" · ")) : undefined;
}

function renderGoalSegment(
	theme: Theme,
	icons: StatuslineIcons,
	snapshot: GoalStatusSnapshot | undefined,
): SegmentText | undefined {
	if (!snapshot) return undefined;
	const appearance = goalStatusAppearance(snapshot.status, icons);
	const icon = theme.fg(appearance.color, appearance.icon);
	const identity = `${icon} ${theme.fg("text", "goal")}`;
	const budget =
		snapshot.tokenBudget === undefined
			? ""
			: theme.fg("text", `${formatCompactTokens(snapshot.tokensUsed)}/${formatCompactTokens(snapshot.tokenBudget)}`);
	const elapsed = theme.fg("muted", formatGoalElapsed(snapshot));
	const full = [identity, appearance.label && theme.fg(appearance.color, appearance.label), budget, elapsed]
		.filter(Boolean)
		.join(" ");
	return { compact: full, full };
}

function goalStatusAppearance(status: GoalStatus, icons: StatuslineIcons): GoalStatusAppearance {
	if (status === "paused") return { color: "muted", icon: icons.goalPaused, label: "paused" };
	if (status === "blocked") return { color: "warning", icon: icons.goalAttention, label: "blocked" };
	if (status === "usage_limited") return { color: "warning", icon: icons.goalAttention, label: "usage" };
	if (status === "budget_limited") return { color: "warning", icon: icons.goalAttention, label: "budget" };
	if (status === "complete") return { color: "success", icon: icons.goalComplete, label: "complete" };
	return { color: "accent", icon: icons.goalActive, label: "" };
}

function formatCompactTokens(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${Number((value / 1_000).toFixed(1))}k`;
	return `${Number((value / 1_000_000).toFixed(1))}m`;
}

function formatGoalElapsed(snapshot: GoalStatusSnapshot): string {
	const liveSeconds =
		snapshot.status === "active" && snapshot.activeStartedAt !== undefined
			? Math.max(0, Date.now() - snapshot.activeStartedAt) / 1_000
			: 0;
	const seconds = Math.floor(snapshot.timeUsedSeconds + liveSeconds);
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${String(minutes)}m`;
	const hours = Math.floor(minutes / 60);
	return `${String(hours)}h${String(minutes % 60)}m`;
}

function finiteNonNegative(value: number): number {
	return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finitePositive(value: number | undefined): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isGoalStatus(value: string): value is GoalStatus {
	return ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(String(value));
}

function renderStatusRow(
	segments: readonly StatusSegment[],
	width: number,
	theme: Theme,
	density: StatuslineDensity,
): string {
	const compactIds = new Set<StatusSegmentId>(["model", "thinking", "cwd", "branch", "context", "goal"]);
	const eligible = density === "compact" ? segments.filter((segment) => compactIds.has(segment.id)) : segments;
	if (eligible.length === 0 || width < 1) return "";
	const full = eligible.map((segment) => segment.full).join(theme.fg("dim", STATUSLINE_SEPARATOR));
	if (density !== "compact" && visibleWidth(full) <= width) return full;

	const selected = eligible.map((segment) => ({
		...segment,
		text: density === "full" ? segment.full : segment.compact,
	}));
	const render = (): string => selected.map((segment) => segment.text).join(theme.fg("dim", STATUSLINE_SEPARATOR));
	while (selected.length > 1 && visibleWidth(render()) > width) {
		let removalIndex = 0;
		for (let index = 1; index < selected.length; index += 1) {
			if ((selected[index]?.priority ?? Number.POSITIVE_INFINITY) < (selected[removalIndex]?.priority ?? 0)) {
				removalIndex = index;
			}
		}
		selected.splice(removalIndex, 1);
	}
	const rendered = render();
	if (visibleWidth(rendered) <= width) return rendered;
	const minimum = selected[0]?.minimum;
	return minimum && visibleWidth(minimum) <= width ? minimum : "";
}

function renderPromptRow(
	prompt: PromptPreview | undefined,
	width: number,
	theme: Theme,
	icons: StatuslineIcons,
): string | undefined {
	if (!prompt || width < 2) return undefined;
	const promptText = prompt.text ?? "";
	const fullBadge = formatSkillBadge(prompt.skills, false);
	const compactBadge = formatSkillBadge(prompt.skills, true);
	const prefix = `${theme.fg("muted", icons.prompt)} `;
	const contentWidth = width - visibleWidth(prefix);
	if (contentWidth < 1) return truncateToWidth(prefix, width, "");
	const badge =
		fullBadge !== compactBadge && visibleWidth(joinPromptAndBadge(promptText, fullBadge)) > contentWidth
			? compactBadge
			: fullBadge;
	const content = fitPromptAndBadge(promptText, badge, contentWidth);
	return `${prefix}${theme.fg("muted", content)}`;
}

function fitPromptAndBadge(prompt: string, badge: string, width: number): string {
	if (!badge) return truncateToWidth(prompt, width, "…");
	const badgeWidth = visibleWidth(badge);
	if (badgeWidth >= width) return truncateToWidth(badge, width, "…");
	const promptWidth = Math.max(0, width - badgeWidth - (prompt ? 1 : 0));
	const fittedPrompt =
		visibleWidth(prompt) <= promptWidth || promptWidth >= MIN_TRUNCATED_PROMPT_WIDTH
			? truncateToWidth(prompt, promptWidth, "…")
			: "";
	return joinPromptAndBadge(fittedPrompt, badge);
}

function joinPromptAndBadge(prompt: string, badge: string): string {
	return [prompt, badge].filter(Boolean).join(" ");
}

function formatSkillBadge(skills: readonly string[], compact: boolean): string {
	if (skills.length === 0) return "";
	if (skills.length === 1) return `[skill:${skills[0] ?? ""}]`;
	return compact ? `[skills:${String(skills.length)}]` : `[skills:${skills.join(",")}]`;
}

function formatCacheHitRate(usage: UsageTotals): string | undefined {
	const denominator = usage.input + usage.cacheRead + usage.cacheWrite;
	if (!Number.isFinite(denominator) || denominator <= 0) return undefined;
	const percent = (usage.cacheRead / denominator) * 100;
	return `${percent.toFixed(1).replace(/\.0$/u, "")}%`;
}

function readCodexStatus(
	ctx: StatuslineContext,
	source: CodexStatusSource | undefined,
): CodexStatusSnapshot | undefined {
	if (ctx.model?.provider !== "openai-codex" || !source) return undefined;
	try {
		return source.getSnapshot();
	} catch {
		return undefined;
	}
}

function readGoalStatus(source: GoalStatusSource | undefined): GoalStatusSnapshot | undefined {
	if (!source) return undefined;
	try {
		return source.getSnapshot();
	} catch {
		return undefined;
	}
}

function formatCodexWeekly(snapshot: CodexStatusSnapshot | undefined): string | undefined {
	if (!snapshot) return undefined;
	const weekly = snapshot.weeklyRemainingPercent;
	return isRuntimeNumber(weekly) && Number.isFinite(weekly)
		? `${String(Math.round(Math.max(0, Math.min(100, weekly))))}%`
		: undefined;
}

function shouldShowCost(ctx: StatuslineContext): boolean {
	const model = ctx.model;
	if (!model) return false;
	if (model.provider === "kimi-coding") return false;
	try {
		if (ctx.modelRegistry.isUsingOAuth(model)) return false;
	} catch {
		// A partial or third-party registry may not expose auth state. Fall back
		// to the model's public metering table rather than hiding real cost.
	}
	const cost = model.cost;
	if (!cost) return false;
	const rates = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite];
	for (const tier of cost.tiers ?? []) rates.push(tier.input, tier.output, tier.cacheRead, tier.cacheWrite);
	return rates.some((rate) => Number.isFinite(rate) && rate > 0);
}

function readThinkingLevel(pi: StatuslineHost, ctx: StatuslineContext): string {
	try {
		return pi.getThinkingLevel();
	} catch {
		return ctx.thinkingLevel ?? "off";
	}
}

function formatThinking(level: string): string {
	interface ThinkingLabels {
		readonly [level: string]: string;
	}
	const labels: ThinkingLabels = {
		high: "high",
		low: "low",
		max: "max",
		medium: "med",
		minimal: "min",
		off: "off",
		xhigh: "xhigh",
	};
	return labels[level] ?? sanitizeOneLine(level);
}

function thinkingColor(level: string): ThemeColor {
	interface ThinkingColors {
		readonly [level: string]: ThemeColor;
	}
	const colors: ThinkingColors = {
		high: "thinkingHigh",
		low: "thinkingLow",
		max: "thinkingMax",
		medium: "thinkingMedium",
		minimal: "thinkingMinimal",
		off: "thinkingOff",
		xhigh: "thinkingXhigh",
	};
	return colors[level] ?? "thinkingText";
}

function displayModelIdentity(ctx: StatuslineContext): string {
	const provider = sanitizeOneLine(ctx.model?.provider ?? "");
	const model = sanitizeOneLine(ctx.model?.id ?? ctx.model?.name ?? "no-model").replace(/^Claude\s+/u, "");
	if (!provider || model.startsWith(`${provider}/`)) return model || "no-model";
	return `${provider}/${model || "no-model"}`;
}

function displayCompactModelName(ctx: StatuslineContext): string {
	const model = sanitizeOneLine(ctx.model?.id ?? ctx.model?.name ?? "no-model").replace(/^Claude\s+/u, "");
	return middleTruncate(model || "no-model", 11);
}

function middleTruncate(value: string, maximumWidth: number): string {
	if (visibleWidth(value) <= maximumWidth) return value;
	if (maximumWidth <= 1) return truncateToWidth(value, maximumWidth, "…");
	const suffixWidth = Math.floor((maximumWidth - 1) / 2);
	const prefixWidth = maximumWidth - suffixWidth - 1;
	const prefix = truncateToWidth(value, prefixWidth, "");
	return `${prefix}…${visibleSuffix(value, suffixWidth)}`;
}

function visibleSuffix(value: string, maximumWidth: number): string {
	let suffix = "";
	for (const character of [...value].reverse()) {
		const candidate = `${character}${suffix}`;
		if (visibleWidth(candidate) > maximumWidth) break;
		suffix = candidate;
	}
	return suffix;
}

function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

function readCwd(ctx: StatuslineContext): string {
	return sanitizeOneLine(readRawCwd(ctx)) || ".";
}

function readRawCwd(ctx: StatuslineContext): string {
	try {
		return ctx.sessionManager.getCwd() || ctx.cwd || ".";
	} catch {
		return ctx.cwd || ".";
	}
}

function callObserver(observer: () => void): void {
	try {
		observer();
	} catch {
		// Presentation observers are recoverable and independent.
	}
}

function subscribeObserver(
	source: { subscribe(listener: () => void): () => void },
	listener: () => void,
	unsubscribers: Array<() => void>,
): void {
	try {
		unsubscribers.push(source.subscribe(listener));
	} catch {
		// One unavailable observer source must not disable the Statusline.
	}
}
