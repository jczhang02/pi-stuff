import type { Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogRowSections,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogExitKeyHelp,
	commandDialogListIndex,
	commandDialogListKeyHelp,
	commandDialogNavigation,
	commandDialogPrimaryKey,
	commandDialogReadKeyHelp,
	commandDialogRows,
	fitFixedCommandDialogRows,
	matchesCommandDialogCancel,
	matchesCommandDialogConfirm,
	matchesCommandDialogHelp,
	matchesCommandDialogPaneSwitch,
	renderCommandDialogKeyHelp,
	renderCommandDialogSplit,
	WIDE_COMMAND_DIALOG_MIN_WIDTH,
} from "../conversation-ui/index.js";
import { type ToolActivityOutcome, toolActivityOutcome } from "./activity.js";
import type { ToolActivity, ToolActivityState } from "./activity-store.js";
import type { ToolActivityGroupView, ToolUiRuntime } from "./contract.js";
import { oneLine, sanitizeTerminalText, toolStateGlyph } from "./render.js";

type ToolDialogMode = "detail" | "list";
type ToolDetailRepresentation = "formatted" | "raw";

const GUTTER = "  ";
const DETAIL_MEMBER_WINDOW = 5;
const NARROW_WIDTH = 64;
const LIST_ROWS = 8;
const NARROW_LIST_ROWS = 6;
const TOOL_DIALOG_ROWS = 18;

function stateText(theme: Theme, state: ToolActivityOutcome | ToolActivityState, value: string): string {
	switch (state) {
		case "running":
			return theme.fg("accent", value);
		case "success":
			return theme.fg("success", value);
		case "error":
			return theme.fg("error", value);
		case "warning":
		case "rejected":
		case "cancelled":
			return theme.fg("warning", value);
	}
}

function sectionHeading(theme: Theme, label: string): string {
	return `${GUTTER}${theme.fg("accent", "◆")} ${theme.bold(label)}`;
}

function activityCount(count: number): string {
	return `${String(count)} ${count === 1 ? "activity" : "activities"}`;
}

function callCount(count: number): string {
	return `${String(count)} ${count === 1 ? "call" : "calls"}`;
}

function activityRow(theme: Theme, group: ToolActivityGroupView, selected: boolean, width: number): string {
	const cursor = selected ? theme.fg("accent", "›") : " ";
	const glyph = stateText(theme, group.state, toolStateGlyph(group.state));
	const count =
		width >= 32 && group.memberIds.length > 1 ? theme.fg("dim", ` · ${callCount(group.memberIds.length)}`) : "";
	const suffix = `${glyph}${count}`;
	const prefix = `${GUTTER}${cursor} `;
	const summaryWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix) - 1);
	const summary = truncateToWidth(oneLine(group.summary) || "Tool activity", summaryWidth, "…");
	const label = selected ? theme.bold(summary) : summary;
	const gap = Math.max(1, width - visibleWidth(prefix) - visibleWidth(label) - visibleWidth(suffix));
	return `${prefix}${label}${" ".repeat(gap)}${suffix}`;
}

function bounded(width: number, line: string): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function hintLines(theme: Theme, width: number, hints: readonly string[]): string[] {
	const available = Math.max(1, width - visibleWidth(GUTTER));
	const lines: string[] = [];
	let current = "";
	for (const hint of hints) {
		const safeHint = oneLine(hint);
		if (!safeHint) continue;
		const candidate = current ? `${current} · ${safeHint}` : safeHint;
		if (current && visibleWidth(candidate) > available) {
			lines.push(current);
			current = "";
		}
		if (visibleWidth(safeHint) <= available) {
			current = current ? `${current} · ${safeHint}` : safeHint;
			continue;
		}
		const wrapped = wrapTextWithAnsi(safeHint, available);
		lines.push(...wrapped.slice(0, -1));
		current = wrapped.at(-1) ?? "";
	}
	if (current) lines.push(current);
	if (lines.length === 0) lines.push("Esc close");
	return lines.map((line) => `${GUTTER}${theme.fg("dim", line)}`);
}

function wrapDetailLines(lines: readonly string[], width: number): string[] {
	const contentWidth = Math.max(1, width - visibleWidth(GUTTER));
	return lines.flatMap((line) => {
		const safeLine = sanitizeTerminalText(line);
		return safeLine ? wrapTextWithAnsi(safeLine, contentWidth) : [""];
	});
}

interface DetailWrapCache {
	readonly activityId: string;
	readonly contentKey: string;
	readonly document: readonly string[];
	readonly representation: ToolDetailRepresentation;
	readonly width: number;
}

function singletonGroup(activity: ToolActivity): ToolActivityGroupView {
	return {
		id: activity.id,
		memberIds: [activity.id],
		state: toolActivityOutcome(activity.state),
		summary: activity.summary || activity.label,
	};
}

class ToolDialogComponent implements CommandDialogComponent {
	private activities: readonly ToolActivity[];
	private readonly context: CommandDialogViewContext<void>;
	private detailWrapCache: DetailWrapCache | undefined;
	private detailRepresentation: ToolDetailRepresentation = "formatted";
	private disposed = false;
	private groups: readonly ToolActivityGroupView[];
	private lastDetailWidth = 64;
	private lastListViewportRows = NARROW_LIST_ROWS;
	private lastRenderWidth = 64;
	private detailMemberIndex = 0;
	private mode: ToolDialogMode;
	private splitFocus: "left" | "right" = "left";
	private pendingFocusId: string | undefined;
	private pinnedGroup: ToolActivityGroupView | undefined;
	private readonly runtime: ToolUiRuntime;
	private scrollOffset = 0;
	private selectedId: string | undefined;
	private showKeyHelp = false;
	private readonly unsubscribe: () => void;

	constructor(runtime: ToolUiRuntime, context: CommandDialogViewContext<void>, initialId?: string) {
		this.runtime = runtime;
		this.context = context;
		this.activities = runtime.activities.list();
		this.groups = this.currentGroups();
		const initial = initialId ? runtime.resolveGroup(initialId) : undefined;
		const initialActivity = initialId ? runtime.activities.resolve(initialId) : undefined;
		const initialGroup =
			initial && initial !== "ambiguous"
				? initial
				: initialActivity
					? this.groups.find((group) => group.memberIds.includes(initialActivity.id))
					: undefined;
		this.pinnedGroup = initialGroup;
		this.pendingFocusId = initialActivity?.id;
		this.groups = this.currentGroups();
		this.selectedId = initialGroup?.id ?? this.groups[0]?.id;
		this.mode = initialGroup ? "detail" : "list";
		if (initialGroup) this.splitFocus = "right";
		this.unsubscribe = runtime.activities.subscribe((activities) => {
			this.activities = activities;
			this.groups = this.currentGroups();
			this.reconcileSelection();
			this.context.requestRender();
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
	}

	handleInput(data: string): void {
		if (this.disposed || isKeyRelease(data)) return;
		if (this.showKeyHelp) {
			if (matchesCommandDialogCancel(data, this.context.keybindings)) {
				this.showKeyHelp = false;
				this.context.requestRender();
			}
			return;
		}
		if (matchesCommandDialogHelp(data)) {
			this.showKeyHelp = true;
			this.context.requestRender();
			return;
		}
		if (matchesCommandDialogCancel(data, this.context.keybindings)) {
			if (this.isSplit()) {
				if (this.detailRepresentation === "raw") this.detailRepresentation = "formatted";
				else if (this.splitFocus === "right") this.splitFocus = "left";
				else this.context.close();
				this.scrollOffset = 0;
				this.detailWrapCache = undefined;
				this.context.requestRender();
				return;
			}
			if (this.mode === "detail") {
				if (this.detailRepresentation === "raw") this.detailRepresentation = "formatted";
				else this.mode = "list";
				this.scrollOffset = 0;
				this.detailWrapCache = undefined;
				this.context.requestRender();
			} else this.context.close();
			return;
		}
		if (this.isSplit() && matchesCommandDialogPaneSwitch(data)) {
			this.splitFocus = this.splitFocus === "left" ? "right" : "left";
			this.scrollOffset = 0;
			this.detailWrapCache = undefined;
			this.context.requestRender();
			return;
		}
		if (this.isSplit()) {
			if (this.splitFocus === "left") this.handleListInput(data);
			else this.handleDetailInput(data);
		} else if (this.mode === "list") this.handleListInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const wasSplit = this.isSplit();
		this.lastRenderWidth = renderWidth;
		this.groups = this.currentGroups();
		this.reconcileSelection();
		const isSplit = this.isSplit();
		if (wasSplit !== isSplit) {
			if (isSplit) this.splitFocus = this.mode === "detail" ? "right" : "left";
			else this.mode = this.splitFocus === "right" ? "detail" : "list";
		}
		if (this.showKeyHelp) {
			const list = isSplit ? this.splitFocus === "left" : this.mode === "list";
			const pane = isSplit ? [{ keys: "Tab/Shift+Tab", description: "Switch panes" }] : [];
			let keyHelp = commandDialogReadKeyHelp(this.context.keybindings, "call", [
				...pane,
				{ keys: "r", description: "Toggle formatted/raw result" },
			]);
			if (list) {
				keyHelp =
					this.groups.length > 0
						? commandDialogListKeyHelp(this.context.keybindings, "activity", pane)
						: commandDialogExitKeyHelp(this.context.keybindings);
			}
			return renderCommandDialogKeyHelp(this.context, renderWidth, "Tools", keyHelp);
		}
		const lines = isSplit
			? this.renderSplit(renderWidth)
			: this.mode === "list"
				? this.renderList(renderWidth)
				: this.renderDetail(renderWidth);
		return lines.map((line) => bounded(renderWidth, line));
	}

	private renderSplit(width: number): string[] {
		return renderCommandDialogSplit(
			this.context.theme,
			width,
			(leftWidth) => this.renderList(leftWidth, this.splitFocus === "left"),
			(rightWidth) => this.renderDetail(rightWidth, this.splitFocus === "right"),
		);
	}

	private isSplit(): boolean {
		return this.lastRenderWidth >= WIDE_COMMAND_DIALOG_MIN_WIDTH && this.groups.length > 0;
	}

	private currentGroups(): readonly ToolActivityGroupView[] {
		const groups = this.runtime.listGroups();
		const listed = groups.length > 0 ? groups : this.activities.map(singletonGroup);
		const resolved = this.pinnedGroup ? this.runtime.resolveGroup(this.pinnedGroup.id) : undefined;
		const pinned = resolved && resolved !== "ambiguous" ? resolved : this.pinnedGroup;
		this.pinnedGroup = pinned;
		return pinned && !listed.some((group) => group.id === pinned.id) ? [pinned, ...listed] : listed;
	}

	private handleListInput(data: string): void {
		if (matchesCommandDialogConfirm(data, this.context.keybindings)) {
			if (!this.selected()) return;
			if (this.isSplit()) {
				this.splitFocus = "right";
				this.detailMemberIndex = 0;
				this.detailRepresentation = "formatted";
				this.scrollOffset = 0;
				this.detailWrapCache = undefined;
				this.context.requestRender();
				return;
			}
			this.mode = "detail";
			this.detailMemberIndex = 0;
			this.detailRepresentation = "formatted";
			this.scrollOffset = 0;
			this.context.requestRender();
			return;
		}
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (!navigation) return;
		if (this.groups.length === 0) return;
		const current = Math.max(
			0,
			this.groups.findIndex((group) => group.id === this.selectedId),
		);
		const next = commandDialogListIndex(current, this.groups.length, this.lastListViewportRows, navigation);
		this.selectedId = this.groups[next]?.id;
		this.detailMemberIndex = 0;
		this.detailRepresentation = "formatted";
		this.scrollOffset = 0;
		this.detailWrapCache = undefined;
		this.context.requestRender();
	}

	private handleDetailInput(data: string): void {
		const group = this.selected();
		if (!group) return;
		if (data === "r" || data === "R") {
			this.detailRepresentation = this.detailRepresentation === "formatted" ? "raw" : "formatted";
			this.scrollOffset = 0;
			this.detailWrapCache = undefined;
			this.context.requestRender();
			return;
		}
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (navigation === "up" || navigation === "down") {
			const delta = navigation === "up" ? -1 : 1;
			this.detailMemberIndex = Math.max(0, Math.min(group.memberIds.length - 1, this.detailMemberIndex + delta));
			this.scrollOffset = 0;
			this.detailWrapCache = undefined;
			this.context.requestRender();
			return;
		}
		if (!navigation) return;
		const layout = this.detailLayout(group, this.lastDetailWidth);
		const page = Math.max(1, layout.viewportRows);
		if (navigation === "pageDown") {
			this.scrollOffset = Math.max(0, Math.min(layout.maxOffset, this.scrollOffset + page));
			this.context.requestRender();
			return;
		}
		if (navigation === "pageUp") {
			this.scrollOffset = Math.max(0, this.scrollOffset - page);
			this.context.requestRender();
			return;
		}
		this.scrollOffset = navigation === "home" ? 0 : layout.maxOffset;
		this.context.requestRender();
	}

	private renderList(width: number, focused = false): string[] {
		const theme = this.context.theme;
		const maximumRows = Math.min(TOOL_DIALOG_ROWS, commandDialogRows(this.context));
		const preferredRows = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const confirm = commandDialogPrimaryKey(this.context.keybindings, "tui.select.confirm", "Enter");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		const activityHints: string[] = [];
		if (this.groups.length > 0) {
			activityHints.push(`${up}/${down} select`);
			if (this.isSplit()) activityHints.push("Tab pane");
			activityHints.push(`${confirm} details`);
		}
		const footer = hintLines(theme, width, [...activityHints, "? keys", `${cancel} close`]);
		const viewportRows = Math.min(preferredRows, Math.max(0, maximumRows - 2 - footer.length - 2));
		this.lastListViewportRows = Math.max(1, viewportRows);
		const selectedIndex = Math.max(
			0,
			this.groups.findIndex((group) => group.id === this.selectedId),
		);
		const start = Math.max(
			0,
			Math.min(selectedIndex - Math.floor(viewportRows / 2), this.groups.length - viewportRows),
		);
		const visible = viewportRows > 0 ? this.groups.slice(start, start + viewportRows) : [];
		const count = width >= 30 ? theme.fg("dim", ` · ${activityCount(this.groups.length)}`) : "";
		const title = focused ? theme.bold(theme.fg("accent", "Tools")) : theme.bold("Tools");
		const header = [theme.fg("border", "━".repeat(width)), `${GUTTER}${title}${count}`];
		const body = [""];
		if (visible.length === 0) body.push(`${GUTTER}${theme.fg("dim", "No tool activity in this session.")}`);
		else {
			if (start > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${String(start)} newer`)}`);
			for (const group of visible) {
				const selected = group.id === this.selectedId;
				body.push(activityRow(theme, group, selected, width));
			}
			const older = this.groups.length - start - visible.length;
			if (older > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${String(older)} older`)}`);
		}
		body.push("");
		const priority = body.find((line) => line.includes("›")) ?? body.find((line) => line.trim().length > 0);
		let sections: CommandDialogRowSections = { header, body, footer };
		if (priority) sections = { ...sections, priority: [priority] };
		return fitFixedCommandDialogRows(sections, maximumRows);
	}

	private renderDetail(width: number, focused = false): string[] {
		this.lastDetailWidth = width;
		const theme = this.context.theme;
		const group = this.selected();
		if (!group) {
			this.mode = "list";
			return this.renderList(width, focused);
		}
		if (this.pendingFocusId) {
			const focusIndex = group.memberIds.indexOf(this.pendingFocusId);
			if (focusIndex >= 0) this.detailMemberIndex = focusIndex;
			this.pendingFocusId = undefined;
			this.scrollOffset = 0;
			this.detailWrapCache = undefined;
		}
		const layout = this.detailLayout(group, width);
		this.scrollOffset = Math.min(layout.maxOffset, Math.max(0, this.scrollOffset));
		const detail = layout.document.slice(this.scrollOffset, this.scrollOffset + layout.viewportRows);
		const heading = `Tools / ${oneLine(group.summary) || "Tool activity"}`;
		const title = focused ? theme.bold(theme.fg("accent", heading)) : theme.bold(heading);
		const header = [
			theme.fg("border", "━".repeat(width)),
			`${GUTTER}${title}`,
			`${GUTTER}${stateText(theme, group.state, `${toolStateGlyph(group.state)} ${group.state}`)} ${theme.fg(
				"dim",
				`· ${callCount(group.memberIds.length)}`,
			)}`,
		];
		const showCalls = group.memberIds.length > 1;
		const body = [
			"",
			...(showCalls
				? [
						sectionHeading(theme, "Calls"),
						...layout.members.map((activity, index) => {
							const memberIndex = layout.memberStart + index;
							const selected = memberIndex === this.detailMemberIndex;
							const cursor = selected ? theme.fg("accent", "›") : " ";
							const glyph = stateText(theme, activity.state, toolStateGlyph(activity.state));
							const label = `${activity.label}${activity.target ? ` · ${activity.target}` : ""}`;
							return `${GUTTER}${cursor} ${glyph} ${selected ? theme.bold(label) : label}`;
						}),
						"",
					]
				: []),
			sectionHeading(theme, this.detailRepresentation === "raw" ? "Raw" : "Result"),
			...detail.map((line) => `${GUTTER}${line}`),
			"",
		];
		const priority = body.find((line) => line.includes("›")) ?? header[2];
		let sections: CommandDialogRowSections = { header, body, footer: layout.footer };
		if (priority) sections = { ...sections, priority: [priority] };
		return fitFixedCommandDialogRows(sections, Math.min(TOOL_DIALOG_ROWS, commandDialogRows(this.context)));
	}

	private detailLayout(group: ToolActivityGroupView, width: number) {
		const memberStart = Math.max(
			0,
			Math.min(
				this.detailMemberIndex - Math.floor(DETAIL_MEMBER_WINDOW / 2),
				group.memberIds.length - DETAIL_MEMBER_WINDOW,
			),
		);
		const members = this.runtime.groupActivityPage(group.id, memberStart, DETAIL_MEMBER_WINDOW);
		const document = this.detailDocument(group, width);
		const maximumRows = Math.min(TOOL_DIALOG_ROWS, commandDialogRows(this.context));
		const showCalls = group.memberIds.length > 1;
		const fixedRows = 6 + (showCalls ? members.length + 2 : 0);
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const pageUp = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageUp", "PgUp");
		const pageDown = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageDown", "PgDn");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		let viewportRows = Math.max(0, maximumRows - fixedRows - 1);
		let footer = hintLines(this.context.theme, width, [
			...(showCalls ? [`${up}/${down} call`] : []),
			...(this.isSplit() ? ["Tab pane"] : []),
			"? keys",
			`${cancel} back`,
		]);
		for (let iteration = 0; iteration < 3; iteration += 1) {
			viewportRows = Math.max(0, maximumRows - fixedRows - footer.length);
			const maximumOffset = Math.max(0, document.length - viewportRows);
			const offset = Math.min(maximumOffset, Math.max(0, this.scrollOffset));
			const rangeEnd = Math.min(document.length, offset + viewportRows);
			const range =
				viewportRows > 0 && document.length > viewportRows
					? ` · ${String(offset + 1)}–${String(rangeEnd)}/${String(document.length)}`
					: "";
			const nextFooter = hintLines(this.context.theme, width, [
				...(showCalls
					? [`${up}/${down} call ${String(this.detailMemberIndex + 1)}/${String(group.memberIds.length)}`]
					: []),
				...(document.length > viewportRows ? [`${pageUp}/${pageDown} page${range}`] : []),
				...(this.isSplit() ? ["Tab pane"] : []),
				this.detailRepresentation === "formatted" ? "r raw" : "r formatted",
				"? keys",
				this.detailRepresentation === "raw" ? `${cancel} formatted` : `${cancel} back`,
			]);
			if (nextFooter.length === footer.length) {
				footer = nextFooter;
				break;
			}
			footer = nextFooter;
		}
		viewportRows = Math.max(0, maximumRows - fixedRows - footer.length);
		return {
			document,
			footer,
			maxOffset: Math.max(0, document.length - viewportRows),
			members,
			memberStart,
			viewportRows,
		};
	}

	private detailDocument(group: ToolActivityGroupView, width: number): readonly string[] {
		const activityId = group.memberIds[this.detailMemberIndex];
		if (!activityId) return [];
		const detail = this.runtime.toolActivityDetail(activityId, this.detailRepresentation);
		if (!detail) return [];
		const activity = detail.activity;
		const raw =
			this.detailRepresentation === "raw"
				? detail.lines
				: [...(activity.target ? [activity.target, ""] : []), ...detail.lines];
		const contentKey = JSON.stringify(raw);
		const cached = this.detailWrapCache;
		if (
			cached?.activityId === activityId &&
			cached.representation === this.detailRepresentation &&
			cached.contentKey === contentKey &&
			cached.width === width
		)
			return cached.document;
		const document = wrapDetailLines(raw, width);
		this.detailWrapCache = {
			activityId,
			contentKey,
			document,
			representation: this.detailRepresentation,
			width,
		};
		return document;
	}

	private reconcileSelection(): void {
		if (this.selectedId && this.groups.some((group) => group.id === this.selectedId)) return;
		this.selectedId = this.groups[0]?.id;
		if (!this.selectedId) {
			this.mode = "list";
			this.splitFocus = "left";
		}
		this.scrollOffset = 0;
		this.detailMemberIndex = 0;
	}

	private selected(): ToolActivityGroupView | undefined {
		return this.groups.find((group) => group.id === this.selectedId);
	}
}

export function createToolDialogView(runtime: ToolUiRuntime, initialId?: string): CommandDialogView<void> {
	return { priority: "normal", create: (context) => new ToolDialogComponent(runtime, context, initialId) };
}
