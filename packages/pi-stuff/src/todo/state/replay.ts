import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import {
	TASK_SNAPSHOT_CAPABILITY,
	TASK_SNAPSHOT_SCHEMA_VERSION,
	TASK_TOOL_NAMES,
	type Task,
	type TaskDetails,
	type TaskStatus,
} from "../tool/types.js";
import { EMPTY_STATE, type TaskState } from "./state.js";
import { hasCycle } from "./task-graph.js";

const VERSIONED_TOOL_NAMES = new Set<string>(Object.values(TASK_TOOL_NAMES));
const LEGACY_TOOL_NAME = "todo";

interface RawTask {
	id?: unknown;
	subject?: unknown;
	description?: unknown;
	activeForm?: unknown;
	status?: unknown;
	blockedBy?: unknown;
	owner?: unknown;
	metadata?: unknown;
}

interface RawSnapshot {
	capability?: unknown;
	schemaVersion?: unknown;
	tasks?: unknown;
	nextId?: unknown;
}

interface RawToolResult {
	role?: unknown;
	toolName?: unknown;
	details?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
	return value === "pending" || value === "in_progress" || value === "completed" || value === "deleted";
}

function cloneMetadata(value: unknown): Record<string, unknown> | undefined | null {
	if (!isRecord(value)) return value === undefined ? undefined : null;
	return { ...value };
}

function normalizeVersionedTask(value: unknown): Task | null {
	if (!isRecord(value)) return null;
	const raw = value as RawTask;
	if (typeof raw.id !== "string" || raw.id.length === 0) return null;
	if (typeof raw.subject !== "string" || typeof raw.description !== "string") return null;
	if (!isTaskStatus(raw.status)) return null;

	const task: Task = {
		id: raw.id,
		subject: raw.subject,
		description: raw.description,
		status: raw.status,
	};
	if (raw.activeForm !== undefined) {
		if (typeof raw.activeForm !== "string") return null;
		task.activeForm = raw.activeForm;
	}
	if (raw.owner !== undefined) {
		if (typeof raw.owner !== "string") return null;
		task.owner = raw.owner;
	}
	if (raw.blockedBy !== undefined) {
		if (!Array.isArray(raw.blockedBy) || raw.blockedBy.some((id) => typeof id !== "string" || id.length === 0)) {
			return null;
		}
		const blockedBy = [...new Set(raw.blockedBy as string[])];
		if (blockedBy.length > 0) task.blockedBy = blockedBy;
	}
	const metadata = cloneMetadata(raw.metadata);
	if (metadata === null) return null;
	if (metadata !== undefined) task.metadata = metadata;
	return task;
}

function normalizeLegacyTask(value: unknown): Task | null {
	if (!isRecord(value)) return null;
	const raw = value as RawTask;
	if (!Number.isSafeInteger(raw.id) || (raw.id as number) < 1) return null;
	if (typeof raw.subject !== "string" || !isTaskStatus(raw.status)) return null;
	if (raw.description !== undefined && typeof raw.description !== "string") return null;

	const task: Task = {
		id: String(raw.id),
		subject: raw.subject,
		description: raw.description ?? "",
		status: raw.status,
	};
	if (raw.activeForm !== undefined) {
		if (typeof raw.activeForm !== "string") return null;
		task.activeForm = raw.activeForm;
	}
	if (raw.owner !== undefined) {
		if (typeof raw.owner !== "string") return null;
		task.owner = raw.owner;
	}
	if (raw.blockedBy !== undefined) {
		if (
			!Array.isArray(raw.blockedBy) ||
			raw.blockedBy.some((id) => !Number.isSafeInteger(id) || (id as number) < 1)
		) {
			return null;
		}
		const blockedBy = [...new Set((raw.blockedBy as number[]).map(String))];
		if (blockedBy.length > 0) task.blockedBy = blockedBy;
	}
	const metadata = cloneMetadata(raw.metadata);
	if (metadata === null) return null;
	if (metadata !== undefined) task.metadata = metadata;
	return task;
}

function numericIdFloor(tasks: readonly Task[]): number {
	let nextId = 1;
	for (const task of tasks) {
		if (!/^[1-9]\d*$/.test(task.id)) continue;
		const id = Number(task.id);
		if (Number.isSafeInteger(id)) nextId = Math.max(nextId, id + 1);
	}
	return nextId;
}

function validateTasks(tasks: readonly Task[]): boolean {
	const ids = new Set(tasks.map((task) => task.id));
	if (ids.size !== tasks.length) return false;
	for (const task of tasks) {
		for (const blockerId of task.blockedBy ?? []) {
			if (blockerId === task.id || !ids.has(blockerId)) return false;
		}
	}
	return !hasCycle(tasks);
}

function decodeTasks(values: unknown, normalize: (value: unknown) => Task | null): Task[] | null {
	if (!Array.isArray(values)) return null;
	const tasks: Task[] = [];
	for (const value of values) {
		const task = normalize(value);
		if (!task) return null;
		tasks.push(task);
	}
	return validateTasks(tasks) ? tasks : null;
}

function normalizeNextId(value: unknown, tasks: readonly Task[]): number | null {
	if (!Number.isSafeInteger(value) || (value as number) < 1) return null;
	return Math.max(value as number, numericIdFloor(tasks));
}

function decodeVersionedSnapshot(value: unknown): TaskState | null {
	if (!isRecord(value)) return null;
	const raw = value as RawSnapshot;
	if (raw.capability !== TASK_SNAPSHOT_CAPABILITY || raw.schemaVersion !== TASK_SNAPSHOT_SCHEMA_VERSION) return null;
	const tasks = decodeTasks(raw.tasks, normalizeVersionedTask);
	if (!tasks) return null;
	const nextId = normalizeNextId(raw.nextId, tasks);
	return nextId === null ? null : { tasks, nextId };
}

function decodeLegacySnapshot(value: unknown): TaskState | null {
	if (!isRecord(value)) return null;
	const raw = value as RawSnapshot;
	const tasks = decodeTasks(raw.tasks, normalizeLegacyTask);
	if (!tasks) return null;
	const nextId = normalizeNextId(raw.nextId, tasks);
	return nextId === null ? null : { tasks, nextId };
}

/** Strict discriminator for the new, versioned task snapshot envelope. */
export function isTaskDetails(value: unknown): value is TaskDetails {
	return decodeVersionedSnapshot(value) !== null;
}

/**
 * Rebuild task state from the latest valid task tool result on the current
 * branch. New snapshots are accepted only from the four Task* tools; the old
 * numeric snapshot is accepted only from the historical `todo` tool.
 */
export function replayFromBranch(
	ctx: { sessionManager: { getBranch(): Iterable<unknown> } },
	projectMessages: (messages: readonly unknown[]) => readonly unknown[] = (messages) => messages,
): TaskState {
	let result: TaskState = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
	let highWaterNextId = result.nextId;
	const branchMessages = [...ctx.sessionManager.getBranch()].flatMap((entry) =>
		sessionEntryToContextMessages(entry as never),
	);
	for (const candidate of projectMessages(branchMessages)) {
		if (!isRecord(candidate)) continue;
		const message = candidate as RawToolResult;
		if (message.role !== "toolResult" || typeof message.toolName !== "string") continue;

		const snapshot =
			message.toolName === LEGACY_TOOL_NAME
				? decodeLegacySnapshot(message.details)
				: VERSIONED_TOOL_NAMES.has(message.toolName)
					? decodeVersionedSnapshot(message.details)
					: null;
		if (snapshot) {
			result = snapshot;
			highWaterNextId = Math.max(highWaterNextId, snapshot.nextId);
		}
	}
	return result.nextId === highWaterNextId ? result : { tasks: result.tasks, nextId: highWaterNextId };
}
