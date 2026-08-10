import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	type EditorComponent,
	isKeyRelease,
	Key,
	matchesKey,
	parseKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { AgentRow, AgentSessionSnapshot, CurrentAgents } from "../session/current-agents.js";
import { boundedTerminalLine } from "../shared/display-description.js";

const WIDGET_KEY = "pi-stuff-agent-roster";
const NORMAL_CHILD_LIMIT = 5;
const NARROW_CHILD_LIMIT = 4;
const NARROW_WIDTH = 64;
const ELAPSED_REFRESH_MS = 1_000;
const TERMINAL_LINGER_MS = 30_000;

const LIVE_STATUSES = new Set(["queued", "resuming", "running", "stopping", "waiting_supervisor"]);
const TERMINAL_STATUSES = new Set(["agent_stopped", "completed", "crashed", "failed", "user_cancelled"]);

type RosterUi = Pick<ExtensionUIContext, "getEditorText" | "notify" | "onTerminalInput" | "setWidget">;

export interface AgentRosterContext {
	readonly hasUI: boolean;
	readonly ui: RosterUi;
}

export interface AgentRosterOptions {
	readonly onOpen: (key: string) => Promise<void> | void;
	readonly now?: () => number;
	readonly setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface IndexedRow {
	readonly index: number;
	readonly row: AgentRow;
}

/** Claude-style projection of the current session's direct children. */
export class AgentRoster {
	private readonly current: CurrentAgents;
	private readonly clearTimeout: NonNullable<AgentRosterOptions["clearTimeout"]>;
	private readonly dismissedTerminalKeys = new Set<string>();
	private readonly now: () => number;
	private readonly onOpen: AgentRosterOptions["onOpen"];
	private readonly setTimeout: NonNullable<AgentRosterOptions["setTimeout"]>;
	private readonly terminalStartedAt = new Map<string, number>();
	private readonly unsubscribeCurrent: () => void;
	private context: AgentRosterContext | undefined;
	private inputUnsubscribe: (() => void) | undefined;
	private refreshTimer: ReturnType<typeof setInterval> | undefined;
	private lingerTimer: ReturnType<typeof setTimeout> | undefined;
	private snapshotValue: AgentSessionSnapshot;
	private suppressed = false;
	private navigationActive = false;
	private selectedKey = "main";
	private footerAttachment: { readonly tui: TUI } | undefined;
	private footerHosted = false;
	private widgetTui: TUI | undefined;
	private widgetRegistered = false;

	constructor(current: CurrentAgents, options: AgentRosterOptions) {
		this.current = current;
		this.onOpen = options.onOpen;
		this.now = options.now ?? Date.now;
		this.setTimeout = options.setTimeout ?? setTimeout;
		this.clearTimeout = options.clearTimeout ?? clearTimeout;
		this.snapshotValue = current.snapshot();
		this.reconcileTerminalStarts();
		this.unsubscribeCurrent = current.subscribe((snapshot) => {
			if (snapshot.sessionId !== this.snapshotValue.sessionId) {
				this.terminalStartedAt.clear();
				this.dismissedTerminalKeys.clear();
			}
			this.snapshotValue = snapshot;
			this.reconcileTerminalStarts();
			this.reconcileSelection();
			this.syncRegistration();
		});
	}

	setContext(context: AgentRosterContext): void {
		if (!context.hasUI) {
			this.clearRegistration();
			this.context = undefined;
			return;
		}
		if (this.context?.ui === context.ui) {
			this.context = context;
			this.syncRegistration();
			return;
		}

		this.clearRegistration();
		this.context = context;
		this.syncRegistration();
	}

	setSuppressed(suppressed: boolean): void {
		if (this.suppressed === suppressed) return;
		this.suppressed = suppressed;
		this.syncRegistration();
	}

	/** Use the shared Suite Footer, retaining belowEditor as a defensive fallback. */
	setFooterHosted(hosted: boolean): void {
		if (this.footerHosted === hosted) return;
		this.footerHosted = hosted;
		if (hosted) this.clearWidget();
		this.syncRegistration();
		this.requestRender();
	}

	/** Create the Fleetview tail rendered after the shared Statusline. */
	createFooterTail(tui: TUI, theme: Theme): Component & { dispose(): void } {
		const attachment = { tui };
		this.footerAttachment = attachment;
		this.syncRegistration();
		return {
			dispose: () => {
				if (this.footerAttachment === attachment) this.footerAttachment = undefined;
			},
			invalidate: () => {},
			render: (width: number) => (this.footerHosted ? this.render(theme, width) : []),
		};
	}

	dispose(): void {
		this.unsubscribeCurrent();
		this.clearRegistration();
		this.context = undefined;
		this.navigationActive = false;
		this.selectedKey = "main";
		this.footerAttachment = undefined;
	}

	private rows(): readonly AgentRow[] {
		const now = this.now();
		return this.snapshotValue.rows.filter((row) => {
			if (!isTerminal(row)) return true;
			if (this.dismissedTerminalKeys.has(row.key)) return false;
			const startedAt = this.terminalStartedAt.get(row.key) ?? now;
			return now - startedAt < TERMINAL_LINGER_MS;
		});
	}

	private reconcileTerminalStarts(): void {
		const present = new Set(this.snapshotValue.rows.map((row) => row.key));
		for (const key of this.terminalStartedAt.keys()) {
			if (!present.has(key)) {
				this.terminalStartedAt.delete(key);
				this.dismissedTerminalKeys.delete(key);
			}
		}
		for (const row of this.snapshotValue.rows) {
			if (!isTerminal(row)) {
				this.terminalStartedAt.delete(row.key);
				this.dismissedTerminalKeys.delete(row.key);
				continue;
			}
			if (!this.terminalStartedAt.has(row.key)) {
				this.terminalStartedAt.set(row.key, row.endedAt ?? this.now());
			}
		}
	}

	private orderedRows(): readonly AgentRow[] {
		return this.rows()
			.map((row, index): IndexedRow => ({ index, row }))
			.sort((left, right) => rowPriority(left.row) - rowPriority(right.row) || left.index - right.index)
			.map(({ row }) => row);
	}

	private reconcileSelection(): void {
		if (this.selectedKey === "main") return;
		if (this.rows().some((row) => row.key === this.selectedKey)) return;
		this.selectedKey = "main";
	}

	private syncRegistration(): void {
		const context = this.context;
		const shouldRegister = context !== undefined && !this.suppressed && this.rows().length > 0;
		if (!shouldRegister) {
			if (this.rows().length === 0) {
				this.navigationActive = false;
				this.selectedKey = "main";
			}
			this.clearRegistration();
			return;
		}

		if (!this.inputUnsubscribe) {
			this.inputUnsubscribe = context.ui.onTerminalInput((data) => this.handleInput(data));
		}
		if (!this.footerHosted && !this.widgetRegistered) {
			context.ui.setWidget(
				WIDGET_KEY,
				(tui, theme) => {
					this.widgetTui = tui;
					return {
						invalidate: () => {},
						render: (width: number) => this.render(theme, width),
					};
				},
				{ placement: "belowEditor" },
			);
			this.widgetRegistered = true;
		}
		if (this.footerHosted) this.clearWidget();
		this.syncRefreshTimer();
		this.syncLingerTimer();
		this.requestRender();
	}

	private clearRegistration(): void {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = undefined;
		if (this.lingerTimer) this.clearTimeout(this.lingerTimer);
		this.lingerTimer = undefined;
		this.inputUnsubscribe?.();
		this.inputUnsubscribe = undefined;
		this.clearWidget();
	}

	private clearWidget(): void {
		if (this.widgetRegistered) this.context?.ui.setWidget(WIDGET_KEY, undefined);
		this.widgetRegistered = false;
		this.widgetTui = undefined;
	}

	private requestRender(): void {
		this.activeTui()?.requestRender();
	}

	private activeTui(): TUI | undefined {
		return this.footerAttachment?.tui ?? this.widgetTui;
	}

	private syncLingerTimer(): void {
		if (this.lingerTimer) this.clearTimeout(this.lingerTimer);
		this.lingerTimer = undefined;
		const now = this.now();
		let nextExpiry = Number.POSITIVE_INFINITY;
		for (const row of this.snapshotValue.rows) {
			if (!isTerminal(row)) continue;
			const startedAt = this.terminalStartedAt.get(row.key);
			if (startedAt === undefined) continue;
			const expiresAt = startedAt + TERMINAL_LINGER_MS;
			if (expiresAt > now) nextExpiry = Math.min(nextExpiry, expiresAt);
		}
		if (!Number.isFinite(nextExpiry)) return;
		this.lingerTimer = this.setTimeout(
			() => {
				this.lingerTimer = undefined;
				this.reconcileSelection();
				this.syncRegistration();
			},
			Math.max(0, nextExpiry - now),
		);
		this.lingerTimer.unref?.();
	}

	private syncRefreshTimer(): void {
		const hasRunningElapsed = this.rows().some(
			(row) => row.status === "running" && typeof row.startedAt === "number" && Number.isFinite(row.startedAt),
		);
		if (!hasRunningElapsed) {
			if (this.refreshTimer) clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
			return;
		}
		if (this.refreshTimer) return;
		this.refreshTimer = setInterval(() => this.requestRender(), ELAPSED_REFRESH_MS);
		this.refreshTimer.unref?.();
	}

	private handleInput(data: string): { consume?: boolean } | undefined {
		if (isKeyRelease(data)) return undefined;
		const context = this.context;
		if (!context || !this.editorHasFocus() || context.ui.getEditorText() !== "") {
			this.leaveNavigation();
			return undefined;
		}

		if (!this.navigationActive) {
			if (!matchesKey(data, Key.down)) return undefined;
			this.navigationActive = true;
			this.selectedKey = "main";
			this.requestRender();
			return { consume: true };
		}

		if (matchesKey(data, Key.escape)) {
			this.leaveNavigation();
			return { consume: true };
		}

		const keys = ["main", ...this.orderedRows().map((row) => row.key)];
		const currentIndex = Math.max(0, keys.indexOf(this.selectedKey));
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			const delta = matchesKey(data, Key.up) ? -1 : 1;
			const nextIndex = Math.min(keys.length - 1, Math.max(0, currentIndex + delta));
			this.selectedKey = keys[nextIndex] ?? "main";
			this.requestRender();
			return { consume: true };
		}

		if (matchesKey(data, Key.enter)) {
			if (this.selectedKey === "main") {
				this.leaveNavigation();
			} else {
				this.openSelected();
			}
			return { consume: true };
		}

		const printable = decodePrintable(data);
		if (printable?.toLowerCase() === "x" && this.selectedKey !== "main") {
			this.controlSelected();
			return { consume: true };
		}
		if (printable !== undefined) this.leaveNavigation();
		return undefined;
	}

	private leaveNavigation(): void {
		if (!this.navigationActive && this.selectedKey === "main") return;
		this.navigationActive = false;
		this.selectedKey = "main";
		this.requestRender();
	}

	private openSelected(): void {
		const key = this.selectedKey;
		try {
			void Promise.resolve(this.onOpen(key)).catch((error) => {
				this.context?.ui.notify(`Unable to open Agent: ${errorMessage(error)}`, "error");
			});
		} catch (error) {
			this.context?.ui.notify(`Unable to open Agent: ${errorMessage(error)}`, "error");
		}
	}

	private controlSelected(): void {
		const row = this.rows().find((candidate) => candidate.key === this.selectedKey);
		if (!row) return;
		if (isTerminal(row)) {
			this.dismissedTerminalKeys.add(row.key);
			this.reconcileSelection();
			this.syncRegistration();
			return;
		}
		void this.current.control({ type: "stop", key: row.key }).catch((error) => {
			this.context?.ui.notify(`Unable to stop Agent: ${errorMessage(error)}`, "error");
		});
	}

	private editorHasFocus(): boolean {
		const focused = (this.activeTui() as unknown as { focusedComponent?: unknown } | undefined)?.focusedComponent;
		return isEditorComponent(focused);
	}

	private render(theme: Theme, width: number): string[] {
		const ordered = this.orderedRows();
		if (ordered.length === 0) return [];
		const renderWidth = Math.max(1, width);
		const limit = renderWidth <= NARROW_WIDTH ? NARROW_CHILD_LIMIT : NORMAL_CHILD_LIMIT;
		const visible = visibleRows(ordered, limit, this.navigationActive ? this.selectedKey : "main");
		const hidden = ordered.length - visible.length;
		const lines = [
			this.renderHint(theme, renderWidth),
			this.renderMain(theme, renderWidth),
			...visible.map((row) => renderAgentRow(row, this.rowMarker(row, theme), theme, renderWidth, this.now())),
		];
		if (hidden > 0) lines.push(truncateToWidth(`  ${theme.fg("dim", `… +${hidden} more`)}`, renderWidth, ""));
		return lines;
	}

	private renderHint(theme: Theme, width: number): string {
		if (!this.navigationActive) return "";
		const hint =
			width <= NARROW_WIDTH ? "↑/↓ select · Enter · x stop · Esc" : "↑/↓ select · Enter view · x stop · Esc return";
		return truncateToWidth(`  ${theme.fg("dim", hint)}`, width, "");
	}

	private renderMain(theme: Theme, width: number): string {
		const marker = this.selectedMarker("main", theme);
		return truncateToWidth(`  ${marker} ${theme.fg("text", "main")}`, width, "");
	}

	private selectedMarker(key: string, theme: Theme): string {
		const selected = this.navigationActive ? this.selectedKey === key : key === "main";
		return selected ? theme.fg("accent", "●") : theme.fg("muted", "○");
	}

	private rowMarker(row: AgentRow, theme: Theme): string {
		if (this.navigationActive && this.selectedKey === row.key) return theme.fg("accent", "●");
		if (row.status === "completed") return theme.fg("success", "○");
		if (row.status === "failed" || row.status === "crashed") return theme.fg("error", "○");
		if (row.status === "waiting_supervisor") {
			return theme.fg("warning", "○");
		}
		return theme.fg("muted", "○");
	}
}

function visibleRows(rows: readonly AgentRow[], limit: number, selectedKey: string): AgentRow[] {
	if (rows.length <= limit) return [...rows];
	const visible = rows.slice(0, limit);
	if (selectedKey === "main" || visible.some((row) => row.key === selectedKey)) return visible;
	const selected = rows.find((row) => row.key === selectedKey);
	if (!selected) return visible;
	visible[visible.length - 1] = selected;
	const order = new Map(rows.map((row, index) => [row.key, index]));
	return visible.sort((left, right) => (order.get(left.key) ?? 0) - (order.get(right.key) ?? 0));
}

function rowPriority(row: AgentRow): number {
	return LIVE_STATUSES.has(row.status) ? 0 : 1;
}

function isTerminal(row: AgentRow): boolean {
	return TERMINAL_STATUSES.has(row.status);
}

function isEditorComponent(
	value: unknown,
): value is Pick<EditorComponent, "getText" | "handleInput" | "invalidate" | "render" | "setText"> {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<EditorComponent>;
	return (
		typeof candidate.getText === "function" &&
		typeof candidate.setText === "function" &&
		typeof candidate.handleInput === "function" &&
		typeof candidate.invalidate === "function" &&
		typeof candidate.render === "function"
	);
}

function decodePrintable(data: string): string | undefined {
	const kittyPrintable = decodeKittyPrintable(data);
	if (kittyPrintable !== undefined) return kittyPrintable;
	const parsed = parseKey(data);
	if (parsed !== undefined && [...parsed].length === 1) return parsed;
	if ([...data].length !== 1) return undefined;
	const codePoint = data.codePointAt(0);
	return codePoint !== undefined && codePoint >= 32 && codePoint !== 127 ? data : undefined;
}

function renderAgentRow(row: AgentRow, marker: string, theme: Theme, width: number, now: number): string {
	const name = boundedTerminalLine(row.name) || "agent";
	const description = boundedTerminalLine(row.description ?? row.task);
	const right = styledState(row, theme, now);
	const markerPrefix = `  ${marker} `;
	const rightWidth = visibleWidth(right);
	const leftWidth = Math.max(1, width - (rightWidth > 0 ? rightWidth + 2 : 0));
	const plainPrefixWidth = visibleWidth(markerPrefix);
	const nameBudget = Math.max(1, leftWidth - plainPrefixWidth);
	const boundedName = truncateToWidth(name, nameBudget, "…");
	const styledName = theme.fg("text", boundedName);
	const descriptionBudget = Math.max(0, leftWidth - plainPrefixWidth - visibleWidth(styledName) - 2);
	const fittedDescription = fitAgentDescription(description, descriptionBudget);
	const left = truncateToWidth(
		`${markerPrefix}${styledName}${fittedDescription ? `  ${theme.fg("muted", fittedDescription)}` : ""}`,
		leftWidth,
		"",
	);
	if (rightWidth === 0) return truncateToWidth(left, width, "");
	const gap = Math.max(2, width - visibleWidth(left) - rightWidth);
	return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "");
}

function styledState(row: AgentRow, theme: Theme, now: number): string {
	const elapsed = elapsedText(row, now);
	switch (row.status) {
		case "queued":
			return theme.fg("warning", "queued");
		case "waiting_supervisor":
			return theme.fg("warning", "waiting");
		case "stopping":
			return theme.fg("warning", "stopping");
		case "resuming":
			return theme.fg("warning", "resuming");
		case "completed":
			return theme.fg("success", elapsed || "✓");
		case "failed":
			return theme.fg("error", elapsed ? `failed · ${elapsed}` : "failed");
		case "crashed":
			return theme.fg("error", elapsed ? `crashed · ${elapsed}` : "crashed");
		case "agent_stopped":
			return theme.fg("muted", elapsed ? `stopped · ${elapsed}` : "stopped");
		case "user_cancelled":
			return theme.fg("muted", elapsed ? `cancelled · ${elapsed}` : "cancelled");
		case "running":
			return theme.fg("muted", elapsed || "running");
	}
}

function elapsedText(row: AgentRow, now: number): string {
	const elapsedMs =
		!isTerminal(row) && typeof row.startedAt === "number" && Number.isFinite(row.startedAt)
			? now - row.startedAt
			: typeof row.elapsedMs === "number" && Number.isFinite(row.elapsedMs)
				? row.elapsedMs
				: undefined;
	if (elapsedMs === undefined) return "";
	const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Keep a description only when the complete short label remains readable. */
export function fitAgentDescription(description: string, availableWidth: number): string {
	const safe = boundedTerminalLine(description);
	return safe && visibleWidth(safe) <= availableWidth ? safe : "";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
