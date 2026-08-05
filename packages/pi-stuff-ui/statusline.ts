import { basename } from "node:path";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	SessionEntry,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const DEFAULT_EXTENSION_STATUS_KEYS: readonly string[] = [];
const GIT_STATUS_TIMEOUT_MS = 2_000;
const MAX_DYNAMIC_TEXT_CODE_UNITS = 16 * 1024;
const MIN_TRUNCATED_PROMPT_WIDTH = 6;
const STATUSLINE_SEPARATOR = " · ";

interface StatuslineIcons {
	readonly branch: string;
	readonly cache: string;
	readonly context: string;
	readonly cost: string;
	readonly diff: string;
	readonly fast: string;
	readonly folder: string;
	readonly model: string;
	readonly prompt: string;
	readonly thinking: string;
	readonly weekly: string;
}

const ASCII_STATUSLINE_ICONS: StatuslineIcons = {
	branch: "⎇",
	cache: "↻",
	context: "◔",
	cost: "¤",
	diff: "Δ",
	fast: "⚡",
	folder: "▣",
	model: "◆",
	prompt: "•",
	thinking: "◉",
	weekly: "◷",
};

const NERD_STATUSLINE_ICONS: StatuslineIcons = {
	branch: "\uF418",
	cache: "\u{F01BC}",
	context: "\u{F035B}",
	cost: "\uF0E7",
	diff: "\uF459",
	fast: "\uF0E7",
	folder: "\u{F024B}",
	model: "\u{F06A9}",
	prompt: "\uF111",
	thinking: "\uF441",
	weekly: "\u{F00ED}",
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
	readonly status: GoalStatus;
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
			...(typeof snapshot.weeklyRemainingPercent === "number" && Number.isFinite(snapshot.weeklyRemainingPercent)
				? { weeklyRemainingPercent: snapshot.weeklyRemainingPercent }
				: {}),
		};
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
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], CodexStatusChannel> | undefined;
	};
	root[CODEX_STATUS_CHANNELS] ??= new WeakMap();
	return root[CODEX_STATUS_CHANNELS];
}

/** Share one late-bindable Codex presentation channel across Capability copies. */
export function getCodexStatusChannel(pi: Pick<ExtensionAPI, "events">): CodexStatusChannel {
	const channels = codexStatusChannels();
	const existing = channels.get(pi.events);
	if (existing) return existing;
	const channel = new SharedCodexStatusChannel();
	channels.set(pi.events, channel);
	return channel;
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
		const tokenBudget = finitePositive(snapshot.tokenBudget);
		this.setSnapshot({
			status: snapshot.status,
			tokensUsed,
			...(tokenBudget === undefined ? {} : { tokenBudget }),
		});
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setSnapshot(next: GoalStatusSnapshot | undefined): void {
		if (
			this.snapshot?.status === next?.status &&
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
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], GoalStatusChannel> | undefined;
	};
	root[GOAL_STATUS_CHANNELS] ??= new WeakMap();
	return root[GOAL_STATUS_CHANNELS];
}

/** Share one observation-only Goal presentation channel across Capability copies. */
export function getGoalStatusChannel(pi: Pick<ExtensionAPI, "events">): GoalStatusChannel {
	const channels = goalStatusChannels();
	const existing = channels.get(pi.events);
	if (existing) return existing;
	const channel = new SharedGoalStatusChannel();
	channels.set(pi.events, channel);
	return channel;
}

export type StatuslineDensity = "auto" | "full" | "compact";
export type StatuslineIconMode = "auto" | "nerd" | "ascii";

export interface StatuslinePreferences {
	readonly density: StatuslineDensity;
	readonly enabled: boolean;
	readonly iconMode: StatuslineIconMode;
	readonly latestPrompt: boolean;
}

export interface StatuslinePreferencesSource {
	get(): StatuslinePreferences;
	subscribe(listener: () => void): () => void;
}

export interface GitChangeCounts {
	readonly ahead?: number;
	readonly behind?: number;
	readonly conflicted?: number;
	readonly staged: number;
	readonly unstaged: number;
	readonly untracked: number;
}

interface GitChangeCountsSource {
	get(cwd?: string, branch?: string): GitChangeCounts | undefined;
	subscribe(listener: () => void): () => void;
}

interface SharedStatuslineControllerOptions {
	readonly autocompleteVisible?: BooleanValueSource;
	readonly codexStatus?: CodexStatusSource;
	readonly extensionStatusKeys?: readonly string[];
	readonly gitChanges?: GitChangeCountsSource;
}

export type StatuslineControllerOptions = SharedStatuslineControllerOptions &
	(
		| { readonly enabled: BooleanValueSource; readonly preferences?: never }
		| { readonly enabled?: never; readonly preferences: StatuslinePreferencesSource }
	);

interface UsageTotals {
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	input: number;
}

interface PromptPreview {
	readonly skills: readonly string[];
	readonly text: string | undefined;
}

interface SessionStatusSnapshot {
	readonly latestPrompt: PromptPreview | undefined;
	readonly usage: UsageTotals;
}

interface RenderRegistration {
	requestRender(): void;
}

/**
 * Mutable Git summary refreshed by the integration layer after accepted Host
 * lifecycle events. Construction and session startup remain free of subprocess
 * work.
 */
export class GitStatusSource implements GitChangeCountsSource {
	private counts: GitChangeCounts | undefined;
	private disposed = false;
	private generation = 0;
	private readonly listeners = new Set<() => void>();
	private measuredBranch: string | undefined;
	private measuredCwd: string | undefined;
	private refreshPromise: Promise<void> | undefined;
	private requestedCwd: string | undefined;

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.requestedCwd = undefined;
		this.listeners.clear();
	}

	get(cwd?: string, branch?: string): GitChangeCounts | undefined {
		if (cwd !== undefined && cwd !== this.measuredCwd) return undefined;
		if (branch !== undefined && branch !== this.measuredBranch) return undefined;
		return this.counts;
	}

	refresh(pi: ExtensionAPI, cwd: string): Promise<void> {
		if (this.disposed) return Promise.resolve();
		this.requestedCwd = cwd;
		if (this.refreshPromise) return this.refreshPromise;
		const refresh = this.drainRefreshes(pi);
		const completion = refresh.finally(() => {
			if (this.refreshPromise === completion) {
				this.refreshPromise = undefined;
			}
		});
		this.refreshPromise = completion;
		return completion;
	}

	private async drainRefreshes(pi: ExtensionAPI): Promise<void> {
		while (!this.disposed && this.requestedCwd !== undefined) {
			const cwd = this.requestedCwd;
			this.requestedCwd = undefined;
			await this.performRefresh(pi, cwd);
		}
	}

	private async performRefresh(pi: ExtensionAPI, cwd: string): Promise<void> {
		const generation = ++this.generation;
		let next: GitChangeCounts | undefined;
		let nextBranch: string | undefined;
		try {
			const result = await pi.exec(
				"git",
				["--no-optional-locks", "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=normal"],
				{ cwd, timeout: GIT_STATUS_TIMEOUT_MS },
			);
			if (!result.killed && result.code === 0) {
				next = parseGitStatusPorcelain(result.stdout);
				nextBranch = parseGitBranchPorcelain(result.stdout);
			}
		} catch {
			// Missing Git and a non-repository cwd are ordinary Statusline states.
			next = undefined;
		}
		if (this.disposed || generation !== this.generation) return;
		this.set(next, next ? cwd : undefined, nextBranch);
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(next: GitChangeCounts | undefined, measuredCwd?: string, measuredBranch?: string): void {
		if (
			sameGitCounts(this.counts, next) &&
			this.measuredCwd === measuredCwd &&
			this.measuredBranch === measuredBranch
		) {
			return;
		}
		this.counts = next;
		this.measuredCwd = measuredCwd;
		this.measuredBranch = measuredBranch;
		for (const listener of this.listeners) callObserver(listener);
	}
}

/** Interpret NUL-delimited `git status --porcelain=v1 -z` output. */
export function parseGitStatusPorcelain(output: string): GitChangeCounts {
	let ahead = 0;
	let behind = 0;
	let conflicted = 0;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	const records = output.split("\0");
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index] ?? "";
		if (record.startsWith("## ")) {
			ahead = parseGitTrackingCount(record, "ahead");
			behind = parseGitTrackingCount(record, "behind");
			continue;
		}
		if (record.length < 3) continue;
		const indexStatus = record[0] ?? " ";
		const worktreeStatus = record[1] ?? " ";
		if (indexStatus === "!" && worktreeStatus === "!") continue;

		if (isGitConflict(indexStatus, worktreeStatus)) {
			conflicted += 1;
		} else if (indexStatus === "?" && worktreeStatus === "?") {
			untracked += 1;
		} else {
			if (indexStatus !== " ") staged += 1;
			if (worktreeStatus !== " ") unstaged += 1;
		}

		// Rename/copy records carry a second NUL-delimited path with no status.
		if (/[RC]/u.test(indexStatus) || /[RC]/u.test(worktreeStatus)) index += 1;
	}
	return { ahead, behind, conflicted, staged, unstaged, untracked };
}

function parseGitTrackingCount(header: string, label: "ahead" | "behind"): number {
	const match = header.match(new RegExp(`\\b${label} (\\d+)(?:[,\\]]|$)`, "u"));
	return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

function isGitConflict(indexStatus: string, worktreeStatus: string): boolean {
	return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${worktreeStatus}`);
}

function parseGitBranchPorcelain(output: string): string | undefined {
	const header = output.split("\0", 1)[0];
	if (!header?.startsWith("## ")) return undefined;
	const value = header.slice(3);
	for (const prefix of ["No commits yet on ", "Initial commit on "]) {
		if (value.startsWith(prefix)) return sanitizeOneLine(value.slice(prefix.length)) || undefined;
	}
	if (value === "HEAD (no branch)") return "detached";
	const upstream = value.indexOf("...");
	return sanitizeOneLine(upstream >= 0 ? value.slice(0, upstream) : value) || undefined;
}

/**
 * Owns Statusline suppression independently from its data and settings. The
 * controller is structurally compatible with CommandDialogChrome.
 */
export class StatuslineController {
	private disposed = false;
	private readonly options: StatuslineControllerOptions;
	private readonly pi: ExtensionAPI;
	private readonly renderers = new Set<RenderRegistration>();
	private readonly sessionStatusSources = new WeakMap<ExtensionContext["sessionManager"], SessionStatusSource>();
	private readonly skillAliases: ReadonlyMap<string, string>;
	private suppressed = false;

	constructor(pi: ExtensionAPI, options: StatuslineControllerOptions) {
		this.pi = pi;
		this.options = options;
		this.skillAliases = readSkillAliases(pi);
	}

	createFooter(
		ctx: ExtensionContext,
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	): Component & { dispose(): void } {
		return new StatuslineFooter(this, ctx, tui, theme, footerData);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
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
		return () => this.renderers.delete(renderer);
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		const notify = () => callObserver(listener);
		const unsubscribe: Array<() => void> = [];
		const preferencesSource = this.options.preferences ?? this.options.enabled;
		subscribeObserver(preferencesSource, notify, unsubscribe);
		if (this.options.autocompleteVisible) subscribeObserver(this.options.autocompleteVisible, notify, unsubscribe);
		if (this.options.codexStatus) subscribeObserver(this.options.codexStatus, notify, unsubscribe);
		if (this.options.gitChanges) subscribeObserver(this.options.gitChanges, notify, unsubscribe);
		return () => {
			for (const remove of unsubscribe.splice(0)) callObserver(remove);
		};
	}

	render(ctx: ExtensionContext, theme: Theme, footerData: ReadonlyFooterDataProvider, width: number): string[] {
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
		this.requestRender();
	}

	handleBranchChange(): void {
		if (this.disposed) return;
		this.requestRender();
	}

	private requestRender(): void {
		for (const renderer of this.renderers) callObserver(() => renderer.requestRender());
	}

	private getPreferences(): StatuslinePreferences {
		if (this.options.preferences) return this.options.preferences.get();
		return {
			density: "auto",
			enabled: this.options.enabled.get(),
			iconMode: "auto",
			latestPrompt: true,
		};
	}

	private getSessionStatusSource(ctx: ExtensionContext): SessionStatusSource {
		const sessionManager = ctx.sessionManager;
		let source = this.sessionStatusSources.get(sessionManager);
		if (!source) {
			source = new SessionStatusSource(sessionManager, this.skillAliases);
			this.sessionStatusSources.set(sessionManager, source);
		}
		return source;
	}
}

/**
 * Incrementally derives the session-backed fields from Pi's append-only entry
 * tree. A repaint only reads the current leaf id; new tails are folded until a
 * cached ancestor is reached, including after tree navigation or compaction.
 */
class SessionStatusSource {
	private activeLeafId: string | null | undefined;
	private readonly byEntryId = new Map<string, SessionStatusSnapshot>();
	private readonly sessionManager: ExtensionContext["sessionManager"];
	private sessionId: string | undefined;
	private snapshot = emptySessionStatus();
	private readonly skillAliases: ReadonlyMap<string, string>;

	constructor(sessionManager: ExtensionContext["sessionManager"], skillAliases: ReadonlyMap<string, string>) {
		this.sessionManager = sessionManager;
		this.skillAliases = skillAliases;
	}

	get(): SessionStatusSnapshot {
		let leafId: string | null;
		let sessionId: string;
		try {
			sessionId = this.sessionManager.getSessionId();
			leafId = this.sessionManager.getLeafId();
		} catch {
			return emptySessionStatus();
		}

		if (sessionId !== this.sessionId) this.reset(sessionId);
		if (leafId === this.activeLeafId) return this.snapshot;
		if (leafId === null) {
			this.activeLeafId = null;
			this.snapshot = emptySessionStatus();
			return this.snapshot;
		}

		let next: SessionStatusSnapshot | undefined;
		try {
			next = this.buildSnapshot(leafId);
		} catch {
			// A partial third-party SessionManager must not take down the TUI. Do
			// not cache the failure, so a later repaint can recover automatically.
			return emptySessionStatus();
		}
		if (!next) return emptySessionStatus();

		this.activeLeafId = leafId;
		this.snapshot = next;
		return next;
	}

	private buildSnapshot(leafId: string): SessionStatusSnapshot | undefined {
		const tail: SessionEntry[] = [];
		const visited = new Set<string>();
		let ancestor = emptySessionStatus();
		let entryId: string | null = leafId;

		while (entryId !== null) {
			const cached = this.byEntryId.get(entryId);
			if (cached) {
				ancestor = cached;
				break;
			}
			if (visited.has(entryId)) return undefined;
			visited.add(entryId);

			const entry = this.sessionManager.getEntry(entryId);
			if (!entry || entry.id !== entryId) return undefined;
			tail.push(entry);
			entryId = entry.parentId;
		}

		for (let index = tail.length - 1; index >= 0; index -= 1) {
			const entry = tail[index];
			if (!entry) continue;
			ancestor = extendSessionStatus(ancestor, entry, this.skillAliases);
			this.byEntryId.set(entry.id, ancestor);
		}
		return ancestor;
	}

	private reset(sessionId: string): void {
		this.sessionId = sessionId;
		this.activeLeafId = undefined;
		this.snapshot = emptySessionStatus();
		this.byEntryId.clear();
	}
}

class StatuslineFooter implements Component {
	private readonly controller: StatuslineController;
	private readonly ctx: ExtensionContext;
	private disposed = false;
	private readonly footerData: ReadonlyFooterDataProvider;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly unsubscribe: Array<() => void>;

	constructor(
		controller: StatuslineController,
		ctx: ExtensionContext,
		tui: TUI,
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
	| "extension";

interface StatusSegment {
	readonly compact: string;
	readonly full: string;
	readonly id: StatusSegmentId;
	readonly priority: number;
}

interface SegmentText {
	readonly compact: string;
	readonly full: string;
}

function renderStatusline(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	branch: string,
	gitChanges: GitChangeCounts | undefined,
	extensionStatusKeys: readonly string[],
	sessionStatus: SessionStatusSnapshot,
	codexStatus: CodexStatusSnapshot | undefined,
	width: number,
	preferences: StatuslinePreferences,
): string[] {
	const icons = statuslineIcons(preferences.iconMode);
	const usage = sessionStatus.usage;
	const segments: StatusSegment[] = [];
	const modelName = displayModelIdentity(ctx);
	const model = theme.fg("accent", withIcon(icons.model, modelName));
	const compactModel = theme.fg("accent", withIcon(icons.model, displayCompactModelName(ctx)));
	segments.push(statusSegment("model", 100, model, compactModel));
	if (ctx.model?.reasoning !== false) {
		const thinkingLevel = readThinkingLevel(pi, ctx);
		const thinking = `${theme.fg(thinkingColor(thinkingLevel), icons.thinking)} ${theme.fg(
			"muted",
			formatThinking(thinkingLevel),
		)}`;
		segments.push(statusSegment("thinking", 65, thinking));
	}
	if (ctx.model?.provider === "openai-codex" && codexStatus?.fastEnabled === true) {
		segments.push(statusSegment("fast", 55, theme.fg("warning", withIcon(icons.fast, "Fast"))));
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

	const extensionStatusSegment = renderExtensionStatusSegment(theme, statuses, extensionStatusKeys);
	if (extensionStatusSegment) segments.push(statusSegment("extension", 35, extensionStatusSegment));

	const status = renderStatusRow(segments, width, theme, preferences.density);
	const prompt = preferences.latestPrompt
		? renderPromptRow(sessionStatus.latestPrompt, width, theme, icons)
		: undefined;
	return [status, prompt].filter((line): line is string => line !== undefined && line.length > 0);
}

function statusSegment(id: StatusSegmentId, priority: number, full: string, compact = full): StatusSegment {
	return { compact, full, id, priority };
}

function renderGitSegments(
	theme: Theme,
	icons: StatuslineIcons,
	branch: string,
	counts: GitChangeCounts | undefined,
): { readonly branch?: SegmentText; readonly diff?: SegmentText } {
	const ahead = counts?.ahead ?? 0;
	const behind = counts?.behind ?? 0;
	const conflicted = counts?.conflicted ?? 0;
	const dirty = !!counts && (counts.staged > 0 || counts.unstaged > 0 || counts.untracked > 0 || conflicted > 0);
	const branchColor: ThemeColor = conflicted > 0 ? "error" : dirty || behind > 0 ? "warning" : "success";
	let branchSegment: SegmentText | undefined;
	if (branch) {
		const tracking = [
			ahead > 0 ? theme.fg("success", `⇡${String(ahead)}`) : "",
			behind > 0 ? theme.fg("warning", `⇣${String(behind)}`) : "",
		].filter(Boolean);
		const fullBranch = `${theme.fg(branchColor, icons.branch)} ${theme.fg("text", branch)}`;
		const compactBranch = `${theme.fg(branchColor, icons.branch)} ${theme.fg("text", middleTruncate(branch, 14))}`;
		branchSegment = {
			compact: [compactBranch, ...tracking].join(" "),
			full: [fullBranch, ...tracking].join(" "),
		};
	}

	const fullState: string[] = [];
	if (conflicted > 0) fullState.push(theme.fg("error", `!${String(conflicted)}`));
	if (counts?.staged) fullState.push(theme.fg("success", `+${String(counts.staged)}`));
	if (counts?.unstaged) fullState.push(theme.fg("warning", `~${String(counts.unstaged)}`));
	if (counts?.untracked) fullState.push(theme.fg("muted", `?${String(counts.untracked)}`));
	const compactState: string[] = [];
	if (conflicted > 0) compactState.push(theme.fg("error", `!${compactCount(conflicted)}`));
	const changed = (counts?.staged ?? 0) + (counts?.unstaged ?? 0) + (counts?.untracked ?? 0);
	if (changed > 0) compactState.push(theme.fg("warning", `Δ${compactCount(changed)}`));
	const diffSegment =
		fullState.length > 0
			? {
					compact: `${theme.fg("muted", icons.diff)} ${compactState.join(" ")}`,
					full: `${theme.fg("muted", icons.diff)} ${fullState.join(" ")}`,
				}
			: undefined;
	return { ...(branchSegment ? { branch: branchSegment } : {}), ...(diffSegment ? { diff: diffSegment } : {}) };
}

function compactCount(value: number): string {
	return value > 99 ? "99+" : String(value);
}

function renderContextSegment(
	ctx: ExtensionContext,
	theme: Theme,
	icons: StatuslineIcons,
	statuses: ReadonlyMap<string, string>,
): SegmentText | undefined {
	if (statuses.has("compact-policy")) return undefined;
	let usage: ReturnType<ExtensionContext["getContextUsage"]>;
	try {
		usage = ctx.getContextUsage();
	} catch {
		return undefined;
	}
	const percent = usage?.percent;
	const knownPercent = typeof percent === "number" && Number.isFinite(percent);
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	const knownWindow = typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0;
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

function finiteNonNegative(value: number): number {
	return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finitePositive(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isGoalStatus(value: unknown): value is GoalStatus {
	return ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(String(value));
}

function renderStatusRow(
	segments: readonly StatusSegment[],
	width: number,
	theme: Theme,
	density: StatuslineDensity,
): string {
	const compactIds = new Set<StatusSegmentId>(["model", "thinking", "cwd", "branch", "context"]);
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
	return truncateToWidth(render(), width, theme.fg("dim", "…"));
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
	const prefix = `${theme.fg("accent", icons.prompt)} `;
	const contentWidth = width - visibleWidth(prefix);
	if (contentWidth < 1) return truncateToWidth(prefix, width, "");
	const badge =
		fullBadge !== compactBadge && visibleWidth(joinPromptAndBadge(promptText, fullBadge)) > contentWidth
			? compactBadge
			: fullBadge;
	const content = fitPromptAndBadge(promptText, badge, contentWidth);
	return `${prefix}${theme.fg("dim", content)}`;
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

function emptySessionStatus(): SessionStatusSnapshot {
	return { latestPrompt: undefined, usage: { cacheRead: 0, cacheWrite: 0, cost: 0, input: 0 } };
}

function extendSessionStatus(
	previous: SessionStatusSnapshot,
	entry: SessionEntry,
	skillAliases: ReadonlyMap<string, string>,
): SessionStatusSnapshot {
	const usage = { ...previous.usage };
	let latestPrompt = previous.latestPrompt;
	if (entry.type === "message") {
		if (
			entry.message.role === "assistant" &&
			entry.message.stopReason !== "error" &&
			entry.message.stopReason !== "aborted"
		) {
			addUsage(usage, (entry.message as AssistantMessage).usage);
		}
		if (entry.message.role === "user") latestPrompt = userPrompt(entry.message.content, skillAliases) ?? latestPrompt;
	}
	return { latestPrompt, usage };
}

function userPrompt(
	content: string | ReadonlyArray<{ type: string; text?: string }>,
	skillAliases: ReadonlyMap<string, string>,
): PromptPreview | undefined {
	const text =
		typeof content === "string"
			? content
			: content
					.filter((part): part is { type: "text"; text: string } => part.type === "text" && !!part.text)
					.map((part) => part.text)
					.join(" ");
	return buildPromptPreview(text, skillAliases);
}

function buildPromptPreview(rawText: string, skillAliases: ReadonlyMap<string, string>): PromptPreview | undefined {
	const parsed = parseSkillBlock(rawText);
	if (parsed) {
		const skill = normalizeSkillName(parsed.name);
		const userText = parsed.userMessage ?? extractEmbeddedSkillUserText(parsed.content);
		const rawPreview = rawSkillPromptPreview(userText ?? "", skillAliases);
		return promptPreview(rawPreview.text, uniqueSkills([...(skill ? [skill] : []), ...rawPreview.skills]));
	}

	const source = rawText;
	const skills: string[] = [];
	for (const match of source.matchAll(/<skill\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
		const skill = normalizeSkillName(match[1] ?? "");
		if (skill && !skills.includes(skill)) skills.push(skill);
	}
	const embeddedUserText = extractEmbeddedSkillUserText(source);
	if (embeddedUserText) {
		const rawPreview = rawSkillPromptPreview(embeddedUserText, skillAliases);
		return promptPreview(rawPreview.text, uniqueSkills([...skills, ...rawPreview.skills]));
	}

	const withoutSkillPayloads = source
		.replace(/<skill\b[^>]*>[\s\S]*?<\/skill>/giu, " ")
		.replace(/<skill\b[^>]*>[\s\S]*$/giu, " ");
	const rawPreview = rawSkillPromptPreview(withoutSkillPayloads, skillAliases);
	return promptPreview(rawPreview.text, uniqueSkills([...skills, ...rawPreview.skills]));
}

function rawSkillPromptPreview(
	value: string,
	aliases: ReadonlyMap<string, string>,
): { readonly skills: readonly string[]; readonly text: string | undefined } {
	const skills: string[] = [];
	const text = value.replace(/(^|\s)\/([^\s]+)/gu, (match, prefix: string, commandName: string) => {
		const skill = aliases.get(commandName.toLowerCase());
		if (!skill) return match;
		skills.push(skill);
		return prefix;
	});
	return { skills: uniqueSkills(skills), text: sanitizeOneLine(text) || undefined };
}

function readSkillAliases(pi: ExtensionAPI): ReadonlyMap<string, string> {
	const aliases = new Map<string, string>();
	try {
		for (const command of pi.getCommands()) {
			if (command.source !== "skill") continue;
			const name = sanitizeOneLine(command.name);
			const skill = normalizeSkillName(name);
			if (name && skill) aliases.set(name.toLowerCase(), skill);
		}
	} catch {
		// Registry discovery is optional presentation data.
	}
	return aliases;
}

function uniqueSkills(values: readonly string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function extractEmbeddedSkillUserText(value: string): string | undefined {
	let latest: string | undefined;
	for (const match of value.matchAll(/(?:^|\r?\n)\s*User:\s*([\s\S]*?)(?=\r?\n\s*<\/skill>|<\/skill>|$)/giu)) {
		const candidate = match[1]?.trim();
		if (candidate) latest = candidate;
	}
	return latest;
}

function normalizeSkillName(value: string): string {
	return sanitizeOneLine(value).replace(/^skill:/iu, "");
}

function promptPreview(text: string | undefined, skills: readonly string[]): PromptPreview | undefined {
	const normalizedText = text || undefined;
	if (!normalizedText && skills.length === 0) return undefined;
	return { skills, text: normalizedText };
}

function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
	if (!usage) return;
	if (Number.isFinite(usage.input) && usage.input > 0) totals.input += usage.input;
	if (Number.isFinite(usage.cacheRead) && usage.cacheRead > 0) totals.cacheRead += usage.cacheRead;
	if (Number.isFinite(usage.cacheWrite) && usage.cacheWrite > 0) totals.cacheWrite += usage.cacheWrite;
	if (Number.isFinite(usage.cost.total) && usage.cost.total > 0) totals.cost += usage.cost.total;
}

function formatCacheHitRate(usage: UsageTotals): string | undefined {
	const denominator = usage.input + usage.cacheRead + usage.cacheWrite;
	if (!Number.isFinite(denominator) || denominator <= 0) return undefined;
	const percent = (usage.cacheRead / denominator) * 100;
	return `${percent.toFixed(1).replace(/\.0$/u, "")}%`;
}

function readCodexStatus(
	ctx: ExtensionContext,
	source: CodexStatusSource | undefined,
): CodexStatusSnapshot | undefined {
	if (ctx.model?.provider !== "openai-codex" || !source) return undefined;
	try {
		return source.getSnapshot();
	} catch {
		return undefined;
	}
}

function formatCodexWeekly(snapshot: CodexStatusSnapshot | undefined): string | undefined {
	if (!snapshot) return undefined;
	const weekly = snapshot.weeklyRemainingPercent;
	return typeof weekly === "number" && Number.isFinite(weekly)
		? `${String(Math.round(Math.max(0, Math.min(100, weekly))))}%`
		: undefined;
}

function shouldShowCost(ctx: ExtensionContext): boolean {
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

function readThinkingLevel(pi: ExtensionAPI, ctx: ExtensionContext): string {
	try {
		return pi.getThinkingLevel();
	} catch {
		return ctx.thinkingLevel ?? "off";
	}
}

function formatThinking(level: string): string {
	const labels: Record<string, string> = {
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
	const colors: Record<string, ThemeColor> = {
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

function displayModelIdentity(ctx: ExtensionContext): string {
	const provider = sanitizeOneLine(ctx.model?.provider ?? "");
	const model = sanitizeOneLine(ctx.model?.id ?? ctx.model?.name ?? "no-model").replace(/^Claude\s+/u, "");
	if (!provider || model.startsWith(`${provider}/`)) return model || "no-model";
	return `${provider}/${model || "no-model"}`;
}

function displayCompactModelName(ctx: ExtensionContext): string {
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

function statuslineIcons(mode: StatuslineIconMode): StatuslineIcons {
	if (mode === "nerd") return NERD_STATUSLINE_ICONS;
	if (mode === "ascii") return ASCII_STATUSLINE_ICONS;
	return hasNerdFonts() ? NERD_STATUSLINE_ICONS : ASCII_STATUSLINE_ICONS;
}

function hasNerdFonts(): boolean {
	const { GHOSTTY_RESOURCES_DIR, POWERLINE_NERD_FONTS, TERM_PROGRAM } = process.env;
	if (POWERLINE_NERD_FONTS === "1") return true;
	if (POWERLINE_NERD_FONTS === "0") return false;
	if (GHOSTTY_RESOURCES_DIR) return true;
	const terminal = (TERM_PROGRAM ?? "").toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((name) => terminal.includes(name));
}

function readCwd(ctx: ExtensionContext): string {
	return sanitizeOneLine(readRawCwd(ctx)) || ".";
}

function readRawCwd(ctx: ExtensionContext): string {
	try {
		return ctx.sessionManager.getCwd() || ctx.cwd || ".";
	} catch {
		return ctx.cwd || ".";
	}
}

function sanitizeOneLine(value: string): string {
	return stripTerminalControls(value.slice(0, MAX_DYNAMIC_TEXT_CODE_UNITS)).replace(/\s+/gu, " ").trim();
}

function stripTerminalControls(value: string): string {
	let text = "";
	let index = 0;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = value.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index = skipControlSequence(value, index + 2);
				continue;
			}
			if (isStringControl(introducer)) {
				index = skipControlString(value, index + 2);
				continue;
			}
			index += 1;
			while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) index += 1;
			if (index < value.length) index += 1;
			continue;
		}
		if (code === 0x9b) {
			index = skipControlSequence(value, index + 1);
			continue;
		}
		if (isC1StringControl(code)) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (isBidiControl(code) || code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			text += " ";
			index += 1;
			continue;
		}
		const point = value.codePointAt(index);
		if (point === undefined) break;
		text += String.fromCodePoint(point);
		index += point > 0xffff ? 2 : 1;
	}
	return text;
}

function skipControlSequence(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index++);
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x07 || code === 0x9c) return index + 1;
		if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index += 1;
	}
	return index;
}

function isStringControl(code: number): boolean {
	return code === 0x5d || code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f;
}

function isC1StringControl(code: number): boolean {
	return code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f;
}

function isBidiControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
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

function sameGitCounts(left: GitChangeCounts | undefined, right: GitChangeCounts | undefined): boolean {
	return (
		left === right ||
		(left !== undefined &&
			right !== undefined &&
			(left.ahead ?? 0) === (right.ahead ?? 0) &&
			(left.behind ?? 0) === (right.behind ?? 0) &&
			(left.conflicted ?? 0) === (right.conflicted ?? 0) &&
			left.staged === right.staged &&
			left.unstaged === right.unstaged &&
			left.untracked === right.untracked)
	);
}
