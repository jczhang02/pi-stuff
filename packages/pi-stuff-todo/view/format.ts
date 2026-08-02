import type { Theme } from "@earendil-works/pi-coding-agent";
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

function compareTaskIds(left: OverlayTask, right: OverlayTask): number {
	if (left.id === right.id) return 0;
	if (/^\d+$/.test(left.id) && /^\d+$/.test(right.id)) {
		const leftNumber = BigInt(left.id);
		const rightNumber = BigInt(right.id);
		if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
	}
	return left.id < right.id ? -1 : 1;
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
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

function overlayStatusGlyph(status: TaskStatus, theme: Theme): string {
	switch (status) {
		case "pending":
			return theme.fg("dim", "□");
		case "in_progress":
			return theme.fg("accent", "■");
		case "completed":
			return theme.fg("dim", "✓");
		case "deleted":
			return theme.fg("error", "✗");
	}
}

/** Format one unheaded, single-line task row. */
export function formatOverlayTaskLine(row: OverlayTaskRow, theme: Theme): string {
	const { task, openBlockers } = row;
	const glyph = overlayStatusGlyph(task.status, theme);
	const text = singleLine(task.subject);
	let subject: string;
	if (task.status === "completed" || task.status === "deleted") {
		subject = theme.strikethrough(theme.fg("dim", text));
	} else if (task.status === "in_progress") {
		subject = theme.bold(theme.fg("accent", text));
	} else if (openBlockers.length > 0) {
		subject = theme.fg("dim", text);
	} else {
		subject = theme.fg("text", text);
	}

	const blockerSuffix =
		openBlockers.length > 0
			? ` ${theme.fg("dim", `blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}`)}`
			: "";
	return `${glyph} ${subject}${blockerSuffix}`;
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
	const label = theme.fg("dim", "Next:");
	if (!next) return `${label} ${theme.fg("dim", "all tasks complete")}`;
	const subject = singleLine(next.task.subject);
	const text = next.openBlockers.length > 0 ? theme.fg("dim", subject) : theme.fg("text", subject);
	return `${label} ${text}`;
}
