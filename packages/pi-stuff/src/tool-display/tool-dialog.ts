import type { Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "../conversation-ui/index.js";
import { type ToolActivityOutcome, toolActivityOutcome } from "./activity.js";
import type { ToolActivity, ToolActivityState } from "./activity-store.js";
import type { ToolActivityGroupView, ToolUiRuntime } from "./contract.js";
import { oneLine, sanitizeTerminalText, toolStateGlyph } from "./render.js";

type ToolDialogMode = "detail" | "list";
type ToolDetailRepresentation = "formatted" | "raw";

const GUTTER = "  ";
const DETAIL_NON_DOCUMENT_ROWS = 8;
const DETAIL_MEMBER_WINDOW = 5;
const NARROW_WIDTH = 64;
const LIST_ROWS = 8;
const NARROW_LIST_ROWS = 6;
const SPLIT_MIN_WIDTH = 96;
const SPLIT_LEFT_WIDTH = 36;

function stateText(theme: Theme, state: ToolActivityOutcome | ToolActivityState, value: string): string {
	switch (state) {
		case "running":
			return theme.fg("muted", value);
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
	private lastRenderWidth = 64;
	private detailMemberIndex = 0;
	private mode: ToolDialogMode;
	private splitFocus: "left" | "right" = "left";
	private pendingFocusId: string | undefined;
	private pinnedGroup: ToolActivityGroupView | undefined;
	private readonly runtime: ToolUiRuntime;
	private scrollOffset = 0;
	private selectedId: string | undefined;
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
		if (matchesKey(data, Key.escape)) {
			if (this.lastRenderWidth >= SPLIT_MIN_WIDTH) {
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
		if (this.lastRenderWidth >= SPLIT_MIN_WIDTH) {
			if (this.splitFocus === "left") this.handleListInput(data);
			else this.handleDetailInput(data);
		} else if (this.mode === "list") this.handleListInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		this.lastRenderWidth = renderWidth;
		this.groups = this.currentGroups();
		this.reconcileSelection();
		// prototype: split-pane exploration; formal adoption should rewrite and consolidate this path.
		const lines =
			renderWidth >= SPLIT_MIN_WIDTH
				? this.renderSplit(renderWidth)
				: this.mode === "list"
					? this.renderList(renderWidth)
					: this.renderDetail(renderWidth);
		return lines.map((line) => bounded(renderWidth, line));
	}

	private renderSplit(width: number): string[] {
		const leftWidth = Math.min(SPLIT_LEFT_WIDTH, Math.max(30, Math.floor(width * 0.38)));
		const rightWidth = Math.max(1, width - leftWidth - 1);
		const left = this.renderList(leftWidth);
		const right = this.renderDetail(rightWidth);
		const rows = Math.max(left.length, right.length);
		const divider = this.context.theme.fg("border", "│");
		return Array.from({ length: rows }, (_, index) => {
			const l = bounded(leftWidth, left[index] ?? "").padEnd(leftWidth, " ");
			const r = bounded(rightWidth, right[index] ?? "");
			return `${l}${divider}${r}`;
		});
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
		if (matchesKey(data, Key.enter)) {
			if (!this.selected()) return;
			if (this.lastRenderWidth >= SPLIT_MIN_WIDTH) {
				this.splitFocus = "right";
				this.detailMemberIndex = 0;
				this.detailRepresentation = "formatted";
				this.scrollOffset = 0;
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
		if (!matchesKey(data, Key.up) && !matchesKey(data, Key.down)) return;
		if (this.groups.length === 0) return;
		const current = Math.max(
			0,
			this.groups.findIndex((group) => group.id === this.selectedId),
		);
		const delta = matchesKey(data, Key.up) ? -1 : 1;
		const next = Math.max(0, Math.min(this.groups.length - 1, current + delta));
		this.selectedId = this.groups[next]?.id;
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
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			const delta = matchesKey(data, Key.up) ? -1 : 1;
			this.detailMemberIndex = Math.max(0, Math.min(group.memberIds.length - 1, this.detailMemberIndex + delta));
			this.scrollOffset = 0;
			this.detailWrapCache = undefined;
			this.context.requestRender();
			return;
		}
		if (
			!matchesKey(data, "pageUp") &&
			!matchesKey(data, "pageDown") &&
			!matchesKey(data, "home") &&
			!matchesKey(data, "end")
		)
			return;
		const layout = this.detailLayout(group, this.lastRenderWidth);
		const page = Math.max(1, layout.viewportRows);
		if (matchesKey(data, "pageDown")) {
			this.scrollOffset = Math.max(0, Math.min(layout.maxOffset, this.scrollOffset + page));
			this.context.requestRender();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - page);
			this.context.requestRender();
			return;
		}
		this.scrollOffset = matchesKey(data, "home") ? 0 : layout.maxOffset;
		this.context.requestRender();
	}

	private renderList(width: number): string[] {
		const theme = this.context.theme;
		const footer = hintLines(theme, width, ["↑/↓ select", "Enter details", "Esc close"]);
		const maximumRows = commandDialogRows(this.context);
		const preferredRows = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const viewportRows = Math.min(preferredRows, Math.max(0, maximumRows - 2 - footer.length - 2));
		const selectedIndex = Math.max(
			0,
			this.groups.findIndex((group) => group.id === this.selectedId),
		);
		const start = Math.max(
			0,
			Math.min(selectedIndex - Math.floor(viewportRows / 2), this.groups.length - viewportRows),
		);
		const visible = viewportRows > 0 ? this.groups.slice(start, start + viewportRows) : [];
		const count = width >= 52 ? theme.fg("dim", ` · ${String(this.groups.length)} items`) : "";
		const header = [theme.fg("border", "─".repeat(width)), `${GUTTER}${theme.bold("Tools")}${count}`];
		const body = [""];
		if (visible.length === 0) body.push(`${GUTTER}${theme.fg("dim", "No tool activity in this session.")}`);
		else {
			if (start > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${String(start)} newer`)}`);
			for (const group of visible) {
				const selected = group.id === this.selectedId;
				const cursor = selected ? theme.fg("accent", "›") : " ";
				const glyph = stateText(theme, group.state, toolStateGlyph(group.state));
				const summary = selected ? theme.bold(oneLine(group.summary)) : oneLine(group.summary);
				const members = theme.fg(
					"dim",
					` · ${String(group.memberIds.length)} ${group.memberIds.length === 1 ? "tool" : "tools"}`,
				);
				body.push(`${GUTTER}${cursor} ${glyph} ${summary}${members}`);
			}
			const older = this.groups.length - start - visible.length;
			if (older > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${String(older)} older`)}`);
		}
		body.push("");
		const priority = body.find((line) => line.includes("›")) ?? body.find((line) => line.trim().length > 0);
		return fitCommandDialogRows({ header, body, footer, ...(priority ? { priority: [priority] } : {}) }, maximumRows);
	}

	private renderDetail(width: number): string[] {
		const theme = this.context.theme;
		const group = this.selected();
		if (!group) {
			this.mode = "list";
			return this.renderList(width);
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
		const header = [
			theme.fg("border", "─".repeat(width)),
			`${GUTTER}${theme.bold("Tool activity details")} ${theme.fg(
				"dim",
				`· ${String(group.memberIds.length)} ${group.memberIds.length === 1 ? "tool" : "tools"}`,
			)}`,
		];
		const body = [
			"",
			`${GUTTER}${theme.fg("dim", "State")}   ${stateText(theme, group.state, group.state)}`,
			`${GUTTER}${theme.fg("dim", "Summary")} ${oneLine(group.summary) || "—"}`,
			"",
			...layout.members.map((activity, index) => {
				const memberIndex = layout.memberStart + index;
				const selected = memberIndex === this.detailMemberIndex;
				const cursor = selected ? theme.fg("accent", "›") : " ";
				const glyph = stateText(theme, activity.state, toolStateGlyph(activity.state));
				const title = `${String(memberIndex + 1)}. ${activity.label}${activity.target ? ` · ${activity.target}` : ""}`;
				return `${GUTTER}${cursor} ${glyph} ${selected ? theme.bold(title) : title}`;
			}),
			"",
			...detail.map((line) => `${GUTTER}${line}`),
			"",
		];
		const priority = body.find((line) => line.includes("›")) ?? body[1];
		return fitCommandDialogRows(
			{ header, body, footer: layout.footer, ...(priority ? { priority: [priority] } : {}) },
			commandDialogRows(this.context),
		);
	}

	private detailLayout(
		group: ToolActivityGroupView,
		width: number,
	): {
		readonly document: readonly string[];
		readonly footer: readonly string[];
		readonly maxOffset: number;
		readonly members: readonly ToolActivity[];
		readonly memberStart: number;
		readonly viewportRows: number;
	} {
		const memberStart = Math.max(
			0,
			Math.min(
				this.detailMemberIndex - Math.floor(DETAIL_MEMBER_WINDOW / 2),
				group.memberIds.length - DETAIL_MEMBER_WINDOW,
			),
		);
		const members = this.runtime.groupActivityPage(group.id, memberStart, DETAIL_MEMBER_WINDOW);
		const document = this.detailDocument(group, width);
		const maximumRows = commandDialogRows(this.context);
		const fixedRows = DETAIL_NON_DOCUMENT_ROWS + members.length;
		let viewportRows = Math.max(0, maximumRows - fixedRows - 1);
		let footer = hintLines(this.context.theme, width, ["↑/↓ member", "Esc back"]);
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
				`↑/↓ member ${String(this.detailMemberIndex + 1)}/${String(group.memberIds.length)}`,
				...(viewportRows > 0 ? [`PgUp/PgDn scroll${range}`, "Home/End"] : []),
				this.detailRepresentation === "formatted" ? "r raw" : "r formatted",
				this.detailRepresentation === "raw" ? "Esc formatted" : "Esc back",
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
				? ["Raw protocol", "", ...detail.lines]
				: [
						activity.label,
						...(activity.target ? [`Target: ${activity.target}`] : []),
						`Status: ${activity.state}`,
						...(activity.summary ? [`Summary: ${activity.summary}`] : []),
						"",
						...detail.lines,
					];
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
		if (!this.selectedId) this.mode = "list";
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
