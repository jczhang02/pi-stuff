import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TaskStatus } from "../tool/types.js";

export type OverlayTaskId = string;

/** Structural view input kept independent from persistence-only task fields. */
export interface OverlayTask {
	readonly id: OverlayTaskId;
	readonly subject: string;
	readonly status: TaskStatus;
	readonly blockedBy?: readonly OverlayTaskId[];
}

export interface OverlayTaskRow {
	readonly task: OverlayTask;
	readonly openBlockers: readonly OverlayTaskId[];
}

export interface OverlayLayout {
	readonly visible: readonly OverlayTaskRow[];
	readonly hidden: readonly OverlayTaskRow[];
	readonly next: OverlayTaskRow | undefined;
}

const MAX_OVERLAY_TASK_ROWS = 5;
const MIN_TRUNCATED_SUBJECT_WIDTH = 6;
const UNTITLED_TASK = "untitled task";

function compareTaskIds(left: OverlayTask, right: OverlayTask): number {
	if (left.id === right.id) return 0;
	if (/^\d+$/.test(left.id) && /^\d+$/.test(right.id)) {
		const leftNumber = BigInt(left.id);
		const rightNumber = BigInt(right.id);
		if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
	}
	return left.id < right.id ? -1 : 1;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x07 || code === 0x9c) return index + 1;
		if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index++;
	}
	return index;
}

function skipControlSequence(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index++);
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function isBidiFormatControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}

/** Remove terminal commands and collapse user-controlled content to one row. */
function singleLine(value: string): string {
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
			if (
				introducer === 0x5d ||
				introducer === 0x50 ||
				introducer === 0x58 ||
				introducer === 0x5e ||
				introducer === 0x5f
			) {
				index = skipControlString(value, index + 2);
				continue;
			}
			index++;
			while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) {
				index++;
			}
			if (index < value.length) index++;
			continue;
		}
		if (code === 0x9b) {
			index = skipControlSequence(value, index + 1);
			continue;
		}
		if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			if (code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d) text += " ";
			index++;
			continue;
		}
		if (isBidiFormatControl(code)) {
			index++;
			continue;
		}
		const point = value.codePointAt(index);
		if (point === undefined) break;
		text += String.fromCodePoint(point);
		index += point > 0xffff ? 2 : 1;
	}
	return text.replace(/\s+/gu, " ").trim();
}

/**
 * Resolve dependencies against the complete task set. Missing references stay
 * open; completed and deleted dependencies are resolved.
 */
export function selectOpenBlockers(
	task: OverlayTask,
	tasksById: ReadonlyMap<string, OverlayTask>,
): readonly OverlayTaskId[] {
	return (task.blockedBy ?? []).filter((blockerId) => {
		const blocker = tasksById.get(blockerId);
		return blocker === undefined || (blocker.status !== "completed" && blocker.status !== "deleted");
	});
}

function rowRank(row: OverlayTaskRow, recentCompletedIds: ReadonlySet<string>): number {
	if (row.task.status === "completed") return recentCompletedIds.has(row.task.id) ? 0 : 4;
	if (row.task.status === "in_progress") return 1;
	if (row.task.status === "pending") return row.openBlockers.length === 0 ? 2 : 3;
	return 5;
}

/**
 * Order the bounded checklist as recent completions, active work, runnable
 * pending work, blocked pending work, then older completions. Rows inside each
 * group are deterministic by task id.
 */
export function selectOverlayLayout(
	tasks: readonly OverlayTask[],
	recentCompletedIds: ReadonlySet<string> = new Set<string>(),
	maxRows = MAX_OVERLAY_TASK_ROWS,
): OverlayLayout {
	const tasksById = new Map(tasks.map((task) => [task.id, task]));
	const rows = tasks
		.filter((task) => task.status !== "deleted")
		.map((task) => ({ task, openBlockers: selectOpenBlockers(task, tasksById) }))
		.sort((left, right) => {
			const rankDifference = rowRank(left, recentCompletedIds) - rowRank(right, recentCompletedIds);
			return rankDifference || compareTaskIds(left.task, right.task);
		});
	const rowLimit = Math.max(0, Math.min(MAX_OVERLAY_TASK_ROWS, Math.floor(maxRows)));
	const visible = rows.slice(0, rowLimit);
	const hidden = rows.slice(rowLimit);
	const next = rows.find((row) => row.task.status === "in_progress" || row.task.status === "pending");
	return { visible, hidden, next };
}

function overlayStatusGlyph(status: TaskStatus, blocked: boolean, theme: Theme): string {
	switch (status) {
		case "pending":
			return theme.fg(blocked ? "warning" : "muted", "□");
		case "in_progress":
			return theme.fg("accent", "■");
		case "completed":
			return theme.fg("dim", "✓");
		case "deleted":
			return theme.fg("error", "✗");
	}
}

function fitOptionalSubject(subject: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(subject) <= width) return subject;
	return width >= MIN_TRUNCATED_SUBJECT_WIDTH ? truncateToWidth(subject, width, "…") : "";
}

/** Format one unheaded, single-line task row with the subject always taking the available width. */
export function formatOverlayTaskLine(row: OverlayTaskRow, theme: Theme, width = Number.POSITIVE_INFINITY): string {
	const { task, openBlockers } = row;
	const glyph = overlayStatusGlyph(task.status, openBlockers.length > 0, theme);
	const text = singleLine(task.subject) || UNTITLED_TASK;
	let subject: string;
	if (task.status === "completed" || task.status === "deleted") {
		subject = theme.strikethrough(theme.fg("dim", text));
	} else if (task.status === "in_progress") {
		subject = theme.bold(theme.fg("accent", text));
	} else if (openBlockers.length > 0) {
		subject = theme.fg("muted", text);
	} else {
		subject = theme.fg("text", text);
	}

	const identity = `${glyph} `;
	if (!Number.isFinite(width)) return `${identity}${subject}`;
	const normalizedWidth = Math.max(0, Math.floor(width));
	if (normalizedWidth <= visibleWidth(identity)) return truncateToWidth(identity, normalizedWidth, "");
	return `${identity}${fitOptionalSubject(subject, normalizedWidth - visibleWidth(identity))}`;
}

export function formatOverlayOverflowLine(hidden: readonly OverlayTaskRow[], theme: Theme): string {
	const statuses = new Set(hidden.map((row) => row.task.status));
	let label = "more";
	if (statuses.size === 1) {
		const status = hidden[0]?.task.status;
		if (status === "pending") label = "pending";
		else if (status === "in_progress") label = "in progress";
		else if (status === "completed") label = "completed";
	}
	return theme.fg("dim", `… +${hidden.length} ${label}`);
}

export function formatCollapsedNextLine(next: OverlayTaskRow | undefined, theme: Theme): string {
	const label = theme.fg("muted", "Next:");
	if (!next) return `${label} ${theme.fg("dim", "all tasks complete")}`;
	const subject = singleLine(next.task.subject) || UNTITLED_TASK;
	if (next.openBlockers.length > 0) {
		return `${label} ${theme.fg("warning", "□")} ${theme.fg("muted", subject)}`;
	}
	return `${label} ${theme.fg("text", subject)}`;
}
