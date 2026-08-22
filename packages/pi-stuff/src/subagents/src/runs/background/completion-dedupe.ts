import { isRuntimeBoolean, isRuntimeNumber, isRuntimeString } from "../../../../shared/runtime-type.js";

interface CompletionDataLike {
	id?: unknown;
	agent?: unknown;
	timestamp?: unknown;
	sessionId?: unknown;
	taskIndex?: unknown;
	totalTasks?: unknown;
	success?: unknown;
}

function asNonEmptyString<Value>(value: Value): string | undefined {
	if (!isRuntimeString(value)) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteNumber<Value>(value: Value): number | undefined {
	if (!isRuntimeNumber(value)) return undefined;
	return Number.isFinite(value) ? value : undefined;
}

export function buildCompletionKey(data: CompletionDataLike, fallback: string): string {
	const sessionId = asNonEmptyString(data.sessionId) ?? "no-session";
	const id = asNonEmptyString(data.id);
	if (id) return `session:${sessionId}:id:${id}`;
	const agent = asNonEmptyString(data.agent) ?? "unknown";
	const timestamp = asFiniteNumber(data.timestamp);
	const taskIndex = asFiniteNumber(data.taskIndex);
	const totalTasks = asFiniteNumber(data.totalTasks);
	const success = isRuntimeBoolean(data.success) ? (data.success ? "1" : "0") : "?";
	return [
		"meta",
		sessionId,
		agent,
		timestamp !== undefined ? String(timestamp) : "no-ts",
		taskIndex !== undefined ? String(taskIndex) : "-",
		totalTasks !== undefined ? String(totalTasks) : "-",
		success,
		fallback,
	].join(":");
}

function pruneSeenMap(seen: Map<string, number>, now: number, ttlMs: number): void {
	for (const [key, ts] of seen.entries()) {
		if (now - ts > ttlMs) seen.delete(key);
	}
}

export function markSeenWithTtl(seen: Map<string, number>, key: string, now: number, ttlMs: number): boolean {
	pruneSeenMap(seen, now, ttlMs);
	if (seen.has(key)) return true;
	seen.set(key, now);
	return false;
}
