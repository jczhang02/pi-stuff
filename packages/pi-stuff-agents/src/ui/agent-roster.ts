import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
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

const WIDGET_KEY = "pi-stuff-agent-roster";
const NORMAL_CHILD_LIMIT = 5;
const NARROW_CHILD_LIMIT = 4;
const NARROW_WIDTH = 64;
const ELAPSED_REFRESH_MS = 1_000;

const LIVE_STATUSES = new Set([
	"queued",
	"resuming",
	"running",
	"stopping",
	"waiting_permission",
	"waiting_supervisor",
]);
const TERMINAL_STATUSES = new Set(["agent_stopped", "completed", "crashed", "failed", "user_cancelled"]);

type RosterUi = Pick<ExtensionUIContext, "getEditorText" | "notify" | "onTerminalInput" | "setWidget">;

export interface AgentRosterContext {
	readonly hasUI: boolean;
	readonly ui: RosterUi;
}

export interface AgentRosterOptions {
	readonly onOpen: (key: string) => Promise<void> | void;
}

interface IndexedRow {
	readonly index: number;
	readonly row: AgentRow;
}

/** Claude-style, below-editor projection of the current session's direct children. */
export class AgentRoster {
	private readonly current: CurrentAgents;
	private readonly onOpen: AgentRosterOptions["onOpen"];
	private readonly unsubscribeCurrent: () => void;
	private context: AgentRosterContext | undefined;
	private inputUnsubscribe: (() => void) | undefined;
	private refreshTimer: ReturnType<typeof setInterval> | undefined;
	private snapshotValue: AgentSessionSnapshot;
	private suppressed = false;
	private navigationActive = false;
	private selectedKey = "main";
	private tui: TUI | undefined;
	private widgetRegistered = false;

	constructor(current: CurrentAgents, options: AgentRosterOptions) {
		this.current = current;
		this.onOpen = options.onOpen;
		this.snapshotValue = current.snapshot();
		this.unsubscribeCurrent = current.subscribe((snapshot) => {
			this.snapshotValue = snapshot;
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

	dispose(): void {
		this.unsubscribeCurrent();
		this.clearRegistration();
		this.context = undefined;
		this.navigationActive = false;
		this.selectedKey = "main";
	}

	private rows(): readonly AgentRow[] {
		return this.snapshotValue.rows;
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
		if (!this.widgetRegistered) {
			context.ui.setWidget(
				WIDGET_KEY,
				(tui, theme) => {
					this.tui = tui;
					return {
						invalidate: () => {},
						render: (width: number) => this.render(theme, width),
					};
				},
				{ placement: "belowEditor" },
			);
			this.widgetRegistered = true;
		}
		this.syncRefreshTimer();
		this.tui?.requestRender();
	}

	private clearRegistration(): void {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = undefined;
		this.inputUnsubscribe?.();
		this.inputUnsubscribe = undefined;
		if (this.widgetRegistered) this.context?.ui.setWidget(WIDGET_KEY, undefined);
		this.widgetRegistered = false;
		this.tui = undefined;
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
		this.refreshTimer = setInterval(() => this.tui?.requestRender(), ELAPSED_REFRESH_MS);
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
			this.tui?.requestRender();
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
			this.tui?.requestRender();
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
		this.tui?.requestRender();
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
		const type = isTerminal(row) ? "dismiss-terminal" : "stop";
		void this.current.control({ type, key: row.key }).catch((error) => {
			this.context?.ui.notify(
				`Unable to ${type === "stop" ? "stop" : "dismiss"} Agent: ${errorMessage(error)}`,
				"error",
			);
		});
	}

	private editorHasFocus(): boolean {
		const focused = (this.tui as unknown as { focusedComponent?: unknown } | undefined)?.focusedComponent;
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
			...visible.map((row) => renderAgentRow(row, this.selectedMarker(row.key, theme), theme, renderWidth)),
		];
		if (hidden > 0) lines.push(truncateToWidth(`  ${theme.fg("dim", `… +${hidden} more`)}`, renderWidth, ""));
		return lines;
	}

	private renderHint(theme: Theme, width: number): string {
		const hint = this.navigationActive
			? width <= NARROW_WIDTH
				? "↑/↓ select · Enter view · x stop · Esc return"
				: "↑/↓ to select · Enter to view · x stop/dismiss · Esc to return"
			: "↓ to manage";
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

function renderAgentRow(row: AgentRow, marker: string, theme: Theme, width: number): string {
	const name = oneLine(row.name) || "agent";
	const task = oneLine(row.task);
	const right = styledState(row, theme);
	const markerPrefix = `  ${marker} `;
	const rightWidth = visibleWidth(right);
	const leftWidth = Math.max(1, width - (rightWidth > 0 ? rightWidth + 1 : 0));
	const plainPrefixWidth = visibleWidth(markerPrefix);
	const nameBudget = Math.max(1, leftWidth - plainPrefixWidth);
	const boundedName = truncateToWidth(name, nameBudget, "…");
	const styledName = theme.fg("text", boundedName);
	const taskBudget = Math.max(0, leftWidth - plainPrefixWidth - visibleWidth(styledName) - 2);
	const boundedTask = taskBudget > 0 ? truncateToWidth(task, taskBudget, "…") : "";
	const left = truncateToWidth(
		`${markerPrefix}${styledName}${boundedTask ? `  ${theme.fg("muted", boundedTask)}` : ""}`,
		leftWidth,
		"",
	);
	if (rightWidth === 0) return truncateToWidth(left, width, "");
	const gap = Math.max(1, width - visibleWidth(left) - rightWidth);
	return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "");
}

function styledState(row: AgentRow, theme: Theme): string {
	const elapsed = elapsedText(row);
	switch (row.status) {
		case "queued":
			return theme.fg("warning", "queued");
		case "waiting_permission":
			return theme.fg("warning", "permission");
		case "waiting_supervisor":
			return theme.fg("warning", "waiting");
		case "stopping":
			return theme.fg("warning", "stopping");
		case "resuming":
			return theme.fg("warning", "resuming");
		case "completed":
			return theme.fg("success", elapsed ? `done · ${elapsed}` : "done");
		case "failed":
			return theme.fg("error", elapsed ? `failed · ${elapsed}` : "failed");
		case "crashed":
			return theme.fg("error", elapsed ? `crashed · ${elapsed}` : "crashed");
		case "agent_stopped":
			return theme.fg("muted", elapsed ? `stopped · ${elapsed}` : "stopped");
		case "user_cancelled":
			return theme.fg("muted", elapsed ? `cancelled · ${elapsed}` : "cancelled");
		case "running":
			return theme.fg("dim", elapsed || "running");
	}
}

function elapsedText(row: AgentRow): string {
	const elapsedMs =
		!isTerminal(row) && typeof row.startedAt === "number" && Number.isFinite(row.startedAt)
			? Date.now() - row.startedAt
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

function oneLine(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === 27 && value[index + 1] === "[") {
			index += 2;
			while (index < value.length) {
				const terminator = value.charCodeAt(index);
				if (terminator >= 64 && terminator <= 126) break;
				index++;
			}
			continue;
		}
		if (code === 9 || code === 10 || code === 13 || code >= 32) {
			if (code !== 127) result += value[index] ?? "";
		}
	}
	return result.replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
