import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonValue } from "../../../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { errnoCode, readOwnedFileTailAsync } from "../../shared/private-directory.ts";
import type { AsyncStatus } from "../../shared/types.ts";
import { mapConcurrent } from "../shared/parallel-utils.ts";

export const MAX_RECENT_AGENT_JOBS = 200;
const RESTORE_READ_CONCURRENCY = 8;
const MAX_LEGACY_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

export type AsyncStatusReader = (asyncDir: string) => Promise<AsyncStatus | null> | AsyncStatus | null;

export interface TrackerEventRecord {
	readonly channels?: unknown;
	readonly childIntercomTarget?: unknown;
	readonly error?: unknown;
	readonly errorMessage?: unknown;
	readonly event?: unknown;
	readonly intercom?: unknown;
	readonly isError?: unknown;
	readonly message?: unknown;
	readonly noticeText?: unknown;
	readonly recordType?: unknown;
	readonly role?: unknown;
	readonly sourceEventType?: unknown;
	readonly stopReason?: unknown;
	readonly text?: unknown;
	readonly type?: unknown;
}

export function parseTrackerEventRecord(value: string): TrackerEventRecord {
	const parsed = parseJsonValue(value);
	if (!isRuntimeObject(parsed) || parsed === null || Array.isArray(parsed)) return {};
	// SAFETY: consumers read only the declared raw fields and validate them before dispatch.
	return parsed as TrackerEventRecord;
}

function ambiguousLegacyFinalDrain(step: NonNullable<AsyncStatus["steps"]>[number]): boolean {
	const terminal = step.processTerminal;
	if (step.error || step.status !== "failed" || terminal?.state !== "observed") return false;
	const writers = terminal.instances.filter(
		(instance): instance is Extract<(typeof terminal.instances)[number], { kind: "pi-writer" }> =>
			instance.kind === "pi-writer" && Number.isInteger(instance.attempt),
	);
	const finalAttempt = writers.reduce(
		(latest, instance) => Math.max(latest, instance.attempt),
		Number.NEGATIVE_INFINITY,
	);
	return writers.some(
		(instance) =>
			instance.attempt === finalAttempt &&
			instance.terminationOrigin === undefined &&
			(instance.signal === "SIGTERM" || (instance.signal === null && instance.exitCode === 143)),
	);
}

export async function recoverLegacyFinalReports(status: AsyncStatus): Promise<AsyncStatus> {
	if (status.state !== "failed" || !status.steps?.some(ambiguousLegacyFinalDrain)) return status;
	let changed = false;
	const steps = await mapConcurrent(status.steps, 4, async (step) => {
		if (!ambiguousLegacyFinalDrain(step) || !step.transcriptPath || !path.isAbsolute(step.transcriptPath))
			return step;
		try {
			const tail = await readOwnedFileTailAsync(step.transcriptPath, MAX_LEGACY_TRANSCRIPT_TAIL_BYTES);
			const lastLine = tail.text.trimEnd().split("\n").at(-1);
			if (!lastLine) return step;
			const entry = parseTrackerEventRecord(lastLine);
			// SAFETY: the runtime guards below establish a non-array record before reading its optional field.
			const messageError =
				isRuntimeObject(entry.message) && entry.message !== null && !Array.isArray(entry.message)
					? (entry.message as { readonly errorMessage?: unknown }).errorMessage
					: undefined;
			if (
				entry.recordType !== "message" ||
				entry.sourceEventType !== "message_end" ||
				entry.role !== "assistant" ||
				entry.stopReason !== "stop" ||
				entry.isError === true ||
				!isRuntimeString(entry.text) ||
				!entry.text.trim() ||
				isRuntimeString(entry.error) ||
				isRuntimeString(entry.errorMessage) ||
				isRuntimeString(messageError)
			)
				return step;
			changed = true;
			return { ...step, legacyFinalReportComplete: true as const };
		} catch {
			return step;
		}
	});
	return changed ? { ...status, steps } : status;
}

export interface RestoredAsyncJob {
	readonly asyncDir: string;
	readonly sessionId: string;
	readonly status: AsyncStatus;
}

export async function scanRestorableAsyncJobs(
	asyncDirRoot: string,
	asyncDirectories: readonly string[] | undefined,
	readRunStatus: AsyncStatusReader,
	normalizeSessionId: (sessionId: string | undefined, runId: string) => string | undefined,
	signal: AbortSignal,
): Promise<readonly RestoredAsyncJob[]> {
	let directories: string[];
	if (asyncDirectories) {
		const root = path.resolve(asyncDirRoot);
		directories = [...new Set(asyncDirectories.map((directory) => path.resolve(directory)))].filter(
			(directory) => path.dirname(directory) === root,
		);
	} else {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(asyncDirRoot, { withFileTypes: true });
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return [];
			throw error;
		}
		directories = entries
			.filter((entry) => entry.isDirectory() && entry.name !== "." && entry.name !== "..")
			.map((entry) => path.join(asyncDirRoot, entry.name));
	}
	const statuses = await mapConcurrent(directories, RESTORE_READ_CONCURRENCY, async (asyncDir) => {
		if (signal.aborted) return undefined;
		try {
			const observedStatus = await readRunStatus(asyncDir);
			if (!observedStatus || signal.aborted) return undefined;
			const status = await recoverLegacyFinalReports(observedStatus);
			const sessionId = normalizeSessionId(status.sessionId, status.runId);
			return sessionId ? { asyncDir, sessionId, status } : undefined;
		} catch (error) {
			reportAgentDiagnostic(`Failed to inspect async run '${asyncDir}'; leaving it untouched for retry:`, error);
			return undefined;
		}
	});
	const observed = statuses.filter((value) => value !== undefined);
	const active = observed.filter(({ status }) => status.state === "queued" || status.state === "running");
	const terminal = observed
		.filter(({ status }) => status.state !== "queued" && status.state !== "running")
		.sort(
			(left, right) =>
				(right.status.lastUpdate ?? right.status.endedAt ?? right.status.startedAt) -
				(left.status.lastUpdate ?? left.status.endedAt ?? left.status.startedAt),
		)
		.slice(0, MAX_RECENT_AGENT_JOBS);
	return [...active, ...terminal];
}
