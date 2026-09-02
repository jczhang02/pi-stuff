import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import {
	type Focusable,
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { commandDialogRows, fitCommandDialogRows } from "../conversation-ui/dialog-layout.js";
import type { CommandDialogComponent, CommandDialogView, CommandDialogViewContext } from "../conversation-ui/index.js";
import type { FastResumeSnapshot } from "./controller.js";
import {
	buildSessionTree,
	buildTreePrefix,
	type FlatSessionNode,
	filterAndSortSessions,
	flattenSessionTree,
	hasSessionName,
	type NameFilter,
	type PickerScope,
	parseSearchQuery,
	type SortMode,
} from "./search.js";
import type { SessionHeader } from "./session.js";
import type { DeleteSessionResult } from "./session-operations.js";

const GUTTER = "  ";
const HOME = homedir();

type DialogMode = "list" | "rename";
type Notice = { readonly message: string; readonly type: "error" | "info" };

export interface FastResumeDialogController {
	delete(path: string, scope: PickerScope): Promise<DeleteSessionResult>;
	dispose(): void;
	refresh(scope: PickerScope): void;
	rename(path: string, name: string, scope: PickerScope): Promise<void>;
	snapshot(): FastResumeSnapshot;
	start(): void;
	subscribe(listener: (snapshot: FastResumeSnapshot) => void): () => void;
}

function safeText(value: string): string {
	return Array.from(stripVTControlCharacters(value), (character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127 ? " " : character;
	})
		.join("")
		.trim();
}

function shortPath(path: string): string {
	const safe = safeText(path);
	return HOME && safe.startsWith(HOME) ? `~${safe.slice(HOME.length)}` : safe;
}

function sessionAge(date: Date): string {
	const milliseconds = Math.max(0, Date.now() - date.getTime());
	const minutes = Math.floor(milliseconds / 60_000);
	const hours = Math.floor(milliseconds / 3_600_000);
	const days = Math.floor(milliseconds / 86_400_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${String(minutes)}m`;
	if (hours < 24) return `${String(hours)}h`;
	if (days < 7) return `${String(days)}d`;
	if (days < 30) return `${String(Math.floor(days / 7))}w`;
	if (days < 365) return `${String(Math.floor(days / 30))}mo`;
	return `${String(Math.floor(days / 365))}y`;
}

function sortLabel(mode: SortMode): string {
	if (mode === "threaded") return "Threaded";
	if (mode === "recent") return "Recent";
	return "Fuzzy";
}

function nextSort(mode: SortMode): SortMode {
	if (mode === "threaded") return "recent";
	if (mode === "recent") return "relevance";
	return "threaded";
}

class FastResumeDialog implements CommandDialogComponent, Focusable {
	private _focused = false;
	private readonly context: CommandDialogViewContext<string>;
	private readonly controller: FastResumeDialogController;
	private busy = false;
	private confirmingDeletePath: string | undefined;
	private disposed = false;
	private filteredNodes: FlatSessionNode[] = [];
	private mode: DialogMode = "list";
	private nameFilter: NameFilter = "all";
	private notice: Notice | undefined;
	private pageSize = 10;
	private readonly queryInput = new Input();
	private readonly renameInput = new Input();
	private renameTargetPath: string | undefined;
	private scope: PickerScope = "current";
	private selectedIndex = 0;
	private showPath = false;
	private snapshot: FastResumeSnapshot;
	private sortMode: SortMode = "threaded";
	private readonly unsubscribe: () => void;

	constructor(
		context: CommandDialogViewContext<string>,
		controller: FastResumeDialogController,
		initialQuery: string,
	) {
		this.context = context;
		this.controller = controller;
		this.snapshot = controller.snapshot();
		this.queryInput.setValue(initialQuery);
		this.rebuild();
		this.unsubscribe = controller.subscribe((snapshot) => this.update(snapshot));
		controller.start();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.queryInput.focused = value && this.mode === "list";
		this.renameInput.focused = value && this.mode === "rename";
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
		this.controller.dispose();
	}

	invalidate(): void {
		this.queryInput.invalidate();
		this.renameInput.invalidate();
	}

	handleInput(data: string): void {
		if (this.busy || this.disposed) return;
		if (this.mode === "rename") {
			this.handleRenameInput(data);
			return;
		}
		if (this.confirmingDeletePath) {
			this.handleDeleteConfirmation(data);
			return;
		}
		this.notice = undefined;
		const keys = this.context.keybindings;
		if (keys.matches(data, "tui.input.tab") || matchesKey(data, "shift+tab")) this.toggleScope();
		else if (keys.matches(data, "app.session.toggleSort")) this.toggleSort();
		else if (keys.matches(data, "app.session.toggleNamedFilter")) this.toggleNames();
		else if (keys.matches(data, "app.session.togglePath")) this.showPath = !this.showPath;
		else if (keys.matches(data, "app.session.delete")) this.beginDelete();
		else if (matchesKey(data, "ctrl+l")) this.controller.refresh(this.scope);
		else if (keys.matches(data, "app.session.rename")) this.beginRename();
		else if (keys.matches(data, "app.session.deleteNoninvasive") && this.queryInput.getValue().length === 0) {
			this.beginDelete();
		} else if (keys.matches(data, "tui.select.up")) this.move(-1);
		else if (keys.matches(data, "tui.select.down")) this.move(1);
		else if (keys.matches(data, "tui.select.pageUp")) this.move(-this.pageSize);
		else if (keys.matches(data, "tui.select.pageDown")) this.move(this.pageSize);
		else if (matchesKey(data, "home")) this.selectedIndex = 0;
		else if (matchesKey(data, "end")) this.selectedIndex = Math.max(0, this.filteredNodes.length - 1);
		else if (keys.matches(data, "tui.select.confirm")) this.select();
		else if (keys.matches(data, "tui.select.cancel")) this.close();
		else {
			this.queryInput.handleInput(data);
			this.rebuild();
		}
		this.context.requestRender();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const lines = this.mode === "rename" ? this.renderRename(renderWidth) : this.renderList(renderWidth);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private update(snapshot: FastResumeSnapshot): void {
		const selectedPath = this.filteredNodes[this.selectedIndex]?.session.path;
		this.snapshot = snapshot;
		if (snapshot.error) this.notice = { message: snapshot.error, type: "error" };
		this.rebuild(selectedPath);
		this.context.requestRender();
	}

	private sessions(): readonly SessionHeader[] {
		return this.scope === "current" ? this.snapshot.currentSessions : (this.snapshot.allSessions ?? []);
	}

	private rebuild(selectedPath?: string): void {
		const sessions = this.sessions();
		const query = this.queryInput.getValue().trim();
		const queryError = parseSearchQuery(query).error;
		if (queryError) this.notice = { message: `Invalid regex: ${safeText(queryError)}`, type: "error" };
		if (this.sortMode === "threaded" && !query) {
			const named = this.nameFilter === "named" ? sessions.filter(hasSessionName) : sessions;
			this.filteredNodes = flattenSessionTree(buildSessionTree(named));
		} else {
			this.filteredNodes = filterAndSortSessions(sessions, query, this.sortMode, this.nameFilter).map((session) => ({
				ancestorContinues: [],
				depth: 0,
				isLast: true,
				session,
			}));
		}
		const index = selectedPath
			? this.filteredNodes.findIndex((node) => node.session.path === selectedPath)
			: this.selectedIndex;
		this.selectedIndex = Math.max(0, Math.min(index < 0 ? 0 : index, this.filteredNodes.length - 1));
	}

	private renderList(width: number): string[] {
		const loading = this.scope === "current" ? this.snapshot.currentLoading : this.snapshot.allLoading;
		const progress = this.scope === "all" ? this.snapshot.allProgress : undefined;
		const title = `Fast Resume (${this.scope === "current" ? "Current Folder" : "All"})`;
		const scope = this.scope === "current" ? "◉ Current Folder | ○ All" : "○ Current Folder | ◉ All";
		const right = [
			loading ? `Loading${progress ? ` ${progress.loaded}/${progress.total}` : "…"}` : scope,
			`${String(this.filteredNodes.length)} Sessions`,
			`Name: ${this.nameFilter === "all" ? "All" : "Named"}`,
			`Sort: ${sortLabel(this.sortMode)}`,
		].join("  ");
		const left = truncateToWidth(title, Math.max(1, width - 1), "");
		const rightText = truncateToWidth(right, Math.max(0, width - visibleWidth(left) - 1), "");
		const titleLine =
			this.context.theme.bold(left) +
			" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(rightText))) +
			this.context.theme.fg("muted", rightText);
		const notice = this.noticeLines(width);
		const queryLines = this.queryInput.render(Math.max(1, width - GUTTER.length)).map((line) => GUTTER + line);
		const rowBudget = Math.max(1, commandDialogRows(this.context) - 8 - notice.length - queryLines.length);
		this.pageSize = rowBudget;
		const rows = this.renderRows(width, rowBudget);
		const selected = rows.find((line) => line.includes("› ")) ?? rows[0] ?? titleLine;
		return fitCommandDialogRows(
			{
				header: [this.context.theme.fg("border", "━".repeat(width)), GUTTER + titleLine],
				body: [
					GUTTER + this.context.theme.fg("muted", 'Tab scope · re:<pattern> regex · "phrase" exact'),
					GUTTER +
						this.context.theme.fg(
							"muted",
							`Sort · Named · Delete · Path ${this.showPath ? "on" : "off"} · Rename · Ctrl+L refresh`,
						),
					...notice,
					...queryLines,
					"",
					...rows,
				],
				footer: [
					GUTTER +
						this.context.theme.fg(
							"dim",
							this.confirmingDeletePath ? "Enter confirm · Esc cancel" : "↑/↓ select · Enter resume · Esc close",
						),
				],
				priority: [selected],
			},
			commandDialogRows(this.context),
		);
	}

	private noticeLines(width: number): string[] {
		if (this.confirmingDeletePath)
			return [GUTTER + this.context.theme.fg("error", "Delete Session? This may permanently remove it.")];
		if (!this.notice) return [];
		const color = this.notice.type === "error" ? "error" : "accent";
		return wrapTextWithAnsi(safeText(this.notice.message), Math.max(1, width - GUTTER.length)).map(
			(line) => GUTTER + this.context.theme.fg(color, line),
		);
	}

	private renderRows(width: number, maximum: number): string[] {
		if (this.filteredNodes.length === 0) {
			if (this.scope === "all" && this.snapshot.allLoading)
				return [GUTTER + this.context.theme.fg("muted", "Loading Sessions…")];
			const suffix = this.nameFilter === "named" ? " named" : "";
			return [GUTTER + this.context.theme.fg("muted", `No${suffix} Sessions found`)];
		}
		const start = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maximum / 2), this.filteredNodes.length - maximum),
		);
		const end = Math.min(this.filteredNodes.length, start + maximum);
		const rows: string[] = [];
		for (let index = start; index < end; index += 1) {
			const node = this.filteredNodes[index];
			if (node) rows.push(this.renderRow(node, index, width));
		}
		if (start > 0 || end < this.filteredNodes.length)
			rows.push(GUTTER + this.context.theme.fg("muted", `(${this.selectedIndex + 1}/${this.filteredNodes.length})`));
		return rows;
	}

	private renderRow(node: FlatSessionNode, index: number, width: number): string {
		const session = node.session;
		const selected = index === this.selectedIndex;
		const active = (session.canonicalPath ?? session.path) === this.snapshot.currentSessionPath;
		const deleting = session.path === this.confirmingDeletePath;
		const prefix = buildTreePrefix(node);
		const message = safeText(session.name ?? session.firstMessage) || "(no messages)";
		const metadata = [
			...(this.showPath ? [shortPath(session.path)] : []),
			...(this.scope === "all" ? [shortPath(session.cwd)] : []),
			...(active ? ["active"] : []),
			session._fwdReachedEof ? String(session.messageCount) : `≈${String(session.messageCount)}`,
			sessionAge(session.modified),
		].join(" ");
		const cursor = selected ? this.context.theme.fg("accent", "› ") : "  ";
		const available = Math.max(10, width - visibleWidth(cursor + prefix) - visibleWidth(metadata) - 1);
		let styled = truncateToWidth(message, available, "…");
		if (deleting) styled = this.context.theme.fg("error", styled);
		else if (active) styled = this.context.theme.fg("accent", styled);
		else if (session.name) styled = this.context.theme.fg("warning", styled);
		if (selected) styled = this.context.theme.bold(styled);
		const left = cursor + this.context.theme.fg("dim", prefix) + styled;
		const line =
			left +
			" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(metadata))) +
			this.context.theme.fg(deleting ? "error" : "dim", metadata);
		return selected ? this.context.theme.bg("selectedBg", line) : line;
	}

	private renderRename(width: number): string[] {
		const input = this.renameInput.render(Math.max(1, width - GUTTER.length)).map((line) => GUTTER + line);
		return fitCommandDialogRows(
			{
				header: [
					this.context.theme.fg("border", "━".repeat(width)),
					GUTTER + this.context.theme.bold("Rename Session"),
				],
				body: ["", ...input],
				footer: [GUTTER + this.context.theme.fg("dim", this.busy ? "Saving…" : "Enter save · Esc cancel")],
				priority: [input[0] ?? "Rename Session"],
			},
			commandDialogRows(this.context),
		);
	}

	private toggleScope(): void {
		this.scope = this.scope === "current" ? "all" : "current";
		this.rebuild();
	}

	private toggleSort(): void {
		this.sortMode = nextSort(this.sortMode);
		this.rebuild();
	}

	private toggleNames(): void {
		this.nameFilter = this.nameFilter === "all" ? "named" : "all";
		this.rebuild();
	}

	private move(offset: number): void {
		this.selectedIndex = Math.max(0, Math.min(this.filteredNodes.length - 1, this.selectedIndex + offset));
	}

	private selected(): SessionHeader | undefined {
		return this.filteredNodes[this.selectedIndex]?.session;
	}

	private select(): void {
		const selected = this.selected();
		if (selected) this.close(selected.path);
	}

	private close(path?: string): void {
		this.dispose();
		this.context.close(path);
	}

	private beginDelete(): void {
		const selected = this.selected();
		if (!selected) return;
		if ((selected.canonicalPath ?? selected.path) === this.snapshot.currentSessionPath) {
			this.notice = { message: "Cannot delete the currently active Session", type: "error" };
			return;
		}
		this.confirmingDeletePath = selected.path;
	}

	private handleDeleteConfirmation(data: string): void {
		if (this.context.keybindings.matches(data, "tui.select.cancel")) {
			this.confirmingDeletePath = undefined;
			this.context.requestRender();
			return;
		}
		if (!this.context.keybindings.matches(data, "tui.select.confirm")) return;
		const path = this.confirmingDeletePath;
		this.confirmingDeletePath = undefined;
		if (path) void this.delete(path);
	}

	private async delete(path: string): Promise<void> {
		this.busy = true;
		this.context.requestRender();
		try {
			const result = await this.controller.delete(path, this.scope);
			this.notice = result.ok
				? { message: result.method === "trash" ? "Session moved to trash" : "Session deleted", type: "info" }
				: { message: "Failed to delete Session", type: "error" };
		} catch {
			this.notice = { message: "Failed to delete Session", type: "error" };
		} finally {
			this.busy = false;
			this.context.requestRender();
		}
	}

	private beginRename(): void {
		const selected = this.selected();
		const loading = this.scope === "current" ? this.snapshot.currentLoading : this.snapshot.allLoading;
		if (!selected || loading) return;
		this.mode = "rename";
		this.renameTargetPath = selected.path;
		this.renameInput.setValue(selected.name ?? "");
		this.focused = this._focused;
	}

	private handleRenameInput(data: string): void {
		if (this.context.keybindings.matches(data, "tui.select.cancel")) {
			this.exitRename();
			return;
		}
		if (this.context.keybindings.matches(data, "tui.select.confirm")) {
			const name = this.renameInput.getValue().trim();
			if (name) void this.rename(name);
			return;
		}
		this.renameInput.handleInput(data);
		this.context.requestRender();
	}

	private async rename(name: string): Promise<void> {
		const path = this.renameTargetPath;
		if (!path) return;
		this.busy = true;
		this.context.requestRender();
		try {
			await this.controller.rename(path, name, this.scope);
			this.notice = { message: "Session renamed", type: "info" };
		} catch {
			this.notice = { message: "Failed to rename Session", type: "error" };
		} finally {
			this.busy = false;
			this.exitRename();
		}
	}

	private exitRename(): void {
		this.mode = "list";
		this.renameTargetPath = undefined;
		this.focused = this._focused;
		this.context.requestRender();
	}
}

export function createFastResumeDialogView(
	controller: FastResumeDialogController,
	initialQuery = "",
): CommandDialogView<string> {
	return {
		create: (context) => new FastResumeDialog(context, controller, initialQuery),
		priority: "normal",
	};
}
