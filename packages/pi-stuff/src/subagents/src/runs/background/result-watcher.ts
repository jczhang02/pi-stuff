import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	attachNestedChildrenToResultChildren,
	buildSubagentResultIntercomPayload,
	compactNestedResultChildren,
	deliverSubagentResultIntercomEvent,
	resolveSubagentResultStatus,
} from "../../intercom/result-intercom.ts";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { type DurableClaim, shardedDurableClaimName, tryAcquireDurableClaim } from "../../shared/durable-claim.ts";
import { createFileCoalescer } from "../../shared/file-coalescer.ts";
import {
	type OwnedFileSnapshot,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshot,
	removeOwnedFileSnapshot,
} from "../../shared/private-directory.ts";
import { sessionArtifactMatches } from "../../shared/session-identity.ts";
import {
	ASYNC_DIR,
	type AsyncStatus,
	type IntercomEventBus,
	type NestedRunSummary,
	RESULTS_DIR,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	type SubagentResultIntercomChild,
	type SubagentState,
} from "../../shared/types.ts";
import { readStatus, resolveWatchPath } from "../../shared/utils.ts";
import {
	nestedWorkIncludesUser,
	projectNestedEventsAuthoritatively,
	projectNestedRegistryForRootAuthoritatively,
	sanitizeSummary,
} from "../shared/nested-events.ts";
import { buildCompletionKey, markSeenWithTtl } from "./completion-dedupe.ts";
import type { CompletionNotification } from "./notify.ts";
import { repairTerminalStatusFromResult } from "./stale-run-reconciler.ts";

const WATCHER_RESTART_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 3000;
const RETRY_DELAY_MS = 100;
const STATUS_REPAIR_RETRY_INITIAL_MS = 500;
const STATUS_REPAIR_RETRY_MAX_MS = 30_000;
const STATUS_REPAIR_LOG_INTERVAL_MS = 30_000;
const PROCESS_RETRY_INITIAL_MS = 100;
const PROCESS_RETRY_MAX_MS = 30_000;
const MAX_RESULT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_DELIVERY_STATE_BYTES = 16 * 1024;
const MAX_IGNORED_RESULT_FINGERPRINTS = 5_000;

type ResultFingerprint = Pick<OwnedFileSnapshot, "ctimeMs" | "dev" | "ino" | "mtimeMs" | "size">;

interface ResultDeliveryState {
	readonly version: 1;
	readonly completionKey: string;
	readonly resultDigest: string;
	readonly intercomComplete: boolean;
	readonly intercomDelivered: boolean;
	readonly notificationAccepted: boolean;
	readonly completionEmitted: boolean;
	readonly updatedAt: number;
}

type ResultWatcherFs = Pick<
	typeof fs,
	"existsSync" | "lstatSync" | "readFileSync" | "unlinkSync" | "readdirSync" | "realpathSync" | "watch"
>;

type ResultWatcherTimers = {
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
	setInterval: typeof setInterval;
	clearInterval: typeof clearInterval;
};

type ResultWatcherDeps = {
	acquireClaim?: typeof tryAcquireDurableClaim;
	fs?: ResultWatcherFs;
	timers?: ResultWatcherTimers;
	notifier?: { deliver(notification: CompletionNotification, signal?: AbortSignal): Promise<boolean> };
	/** External grouped-result transport. Disable when native completion notifications own delivery. */
	deliverIntercomResults?: boolean;
	watcherRestartDelayMs?: number;
	pollIntervalMs?: number;
	safetyScanIntervalMs?: number;
	asyncDirRoot?: string;
	readResultSnapshot?: (resultPath: string, maxBytes: number) => OwnedFileSnapshot;
	projectNestedEvents?: typeof projectNestedEventsAuthoritatively;
	projectNestedRegistry?: typeof projectNestedRegistryForRootAuthoritatively;
};

type ResultFileChild = {
	agent?: string;
	output?: string;
	error?: string;
	success?: boolean;
	state?: string;
	interrupted?: boolean;
	stopped?: boolean;
	sessionFile?: string;
	artifactPaths?: { outputPath?: string };
	intercomTarget?: string;
	children?: unknown;
};

type ResultFileData = CompletionNotification & {
	runId?: string;
	mode?: string;
	results?: ResultFileChild[];
	nestedChildren?: unknown;
	asyncDir?: string;
	intercomTarget?: string;
};

const COMPLETION_FIELDS = [
	"source",
	"parentRunOrigin",
	"agent",
	"success",
	"summary",
	"exitCode",
	"state",
	"timestamp",
	"durationMs",
	"cwd",
	"sessionFile",
	"taskIndex",
	"totalTasks",
	"sessionId",
	"stopped",
	"timedOut",
	"interrupted",
	"startedAt",
	"endedAt",
	"asyncDir",
	"worktree",
	"launchContractDigest",
	"capabilityCeiling",
] as const;

const RESULT_CHILD_FIELDS = [
	"context",
	"output",
	"success",
	"exitCode",
	"error",
	"interrupted",
	"timedOut",
	"stopped",
	"turnBudget",
	"turnBudgetExceeded",
	"wrapUpRequested",
	"toolBudget",
	"toolBudgetBlocked",
	"sessionFile",
	"intercomTarget",
	"model",
	"thinking",
	"attemptedModels",
	"modelAttempts",
	"totalCost",
	"artifactPaths",
	"transcriptPath",
	"transcriptError",
	"launchContractDigest",
	"capabilityCeiling",
	"capabilityAudit",
	"writerProcesses",
	"writerAttemptCount",
] as const;

function pickFields(source: object, fields: readonly string[]): Record<string, unknown> {
	const record = source as Record<string, unknown>;
	const picked: Record<string, unknown> = {};
	for (const field of fields) {
		if (record[field] !== undefined) picked[field] = record[field];
	}
	return picked;
}

function resultFileFromWatchEntry(fileName: string): string | undefined {
	if (fileName.endsWith(".json")) return fileName;
	return /^\.([^/\\]+\.json)\.\d+\.\d+\.[a-z0-9]+\.tmp$/i.exec(fileName)?.[1];
}

function sanitizeNestedResultChildren(
	value: unknown,
	resultPath: string,
	label: string,
): NestedRunSummary[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		reportAgentDiagnostic(
			`Ignoring invalid nested children in subagent result file '${resultPath}' at ${label}: expected an array.`,
		);
		return undefined;
	}
	const children = value
		.map((child) => sanitizeSummary(child))
		.filter((child): child is NestedRunSummary => Boolean(child));
	if (children.length !== value.length) {
		reportAgentDiagnostic(
			`Ignoring ${value.length - children.length} invalid nested child record(s) in subagent result file '${resultPath}' at ${label}.`,
		);
	}
	return children.length ? children : undefined;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? (error as NodeJS.ErrnoException).code
		: undefined;
}

function isNotFound(error: unknown): boolean {
	return errorCode(error) === "ENOENT";
}

function shouldPoll(error: unknown): boolean {
	const code = errorCode(error);
	return code === "EMFILE" || code === "ENOSPC";
}

function deliveryStatePath(resultsDir: string, file: string): string {
	return path.join(resultsDir, `.${file}.delivery-state`);
}

function deliveryClaimName(file: string): string {
	return shardedDurableClaimName("result-delivery", file);
}

function stableDeliveryId(completionKey: string): string {
	return `pi-stuff-result-${createHash("sha256").update(completionKey).digest("hex").slice(0, 32)}`;
}

function resultDigest(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

function readDeliveryState(
	resultsDir: string,
	file: string,
	completionKey: string,
	digest: string,
): ResultDeliveryState | undefined {
	try {
		const value = JSON.parse(readBoundedOwnedFile(deliveryStatePath(resultsDir, file), MAX_DELIVERY_STATE_BYTES)) as
			| Partial<ResultDeliveryState>
			| undefined;
		if (
			value?.version !== 1 ||
			value.completionKey !== completionKey ||
			value.resultDigest !== digest ||
			typeof value.intercomComplete !== "boolean" ||
			typeof value.intercomDelivered !== "boolean" ||
			typeof value.notificationAccepted !== "boolean" ||
			typeof value.completionEmitted !== "boolean" ||
			typeof value.updatedAt !== "number" ||
			!Number.isFinite(value.updatedAt)
		)
			return undefined;
		return value as ResultDeliveryState;
	} catch (error) {
		if (isNotFound(error)) return undefined;
		return undefined;
	}
}

function writeDeliveryState(resultsDir: string, file: string, state: ResultDeliveryState): void {
	writePrivateAtomicJson(deliveryStatePath(resultsDir, file), state);
}

function removeDeliveryArtifacts(resultsDir: string, file: string): void {
	try {
		fs.unlinkSync(deliveryStatePath(resultsDir, file));
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
}

async function deliverNotificationWithAbort(
	notifier: NonNullable<ResultWatcherDeps["notifier"]>,
	completion: CompletionNotification,
	signal: AbortSignal,
): Promise<boolean> {
	if (signal.aborted) return false;
	return Promise.race([
		notifier.deliver(completion, signal),
		new Promise<boolean>((resolve) => {
			signal.addEventListener("abort", () => resolve(false), { once: true });
		}),
	]);
}

/**
 * Watches persisted async results for the session currently owned by this
 * runtime. `stopResultWatcher()` revokes ownership before closing resources,
 * so old callbacks can never emit or delete after reload/session replacement.
 */
export function createResultWatcher(
	pi: { events: IntercomEventBus },
	state: SubagentState,
	resultsDir: string,
	completionTtlMs: number,
	deps: ResultWatcherDeps = {},
): {
	startResultWatcher: () => boolean;
	primeExistingResults: (options?: { triggerTurn?: boolean }) => void;
	stopResultWatcher: () => void;
} {
	const fsApi = deps.fs ?? fs;
	const asyncDirRoot =
		deps.asyncDirRoot ??
		(path.resolve(resultsDir) === path.resolve(RESULTS_DIR) ? ASYNC_DIR : path.dirname(path.resolve(resultsDir)));
	const timers = deps.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
	const notifier = deps.notifier ?? { deliver: async () => true };
	const deliverIntercomResults = deps.deliverIntercomResults !== false;
	const watcherRestartDelayMs = deps.watcherRestartDelayMs ?? WATCHER_RESTART_DELAY_MS;
	const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
	const safetyScanIntervalMs = deps.safetyScanIntervalMs ?? POLL_INTERVAL_MS;
	const readResultSnapshot = deps.readResultSnapshot ?? readBoundedOwnedFileSnapshot;
	const acquireClaim = deps.acquireClaim ?? tryAcquireDurableClaim;
	const projectNestedEvents = deps.projectNestedEvents ?? projectNestedEventsAuthoritatively;
	const projectNestedRegistry = deps.projectNestedRegistry ?? projectNestedRegistryForRootAuthoritatively;
	const pendingTriggerTurn = new Map<string, boolean>();
	const processing = new Map<string, symbol>();
	const deliveredPendingStatus = new Set<string>();
	const statusRepairRetryDelay = new Map<string, number>();
	const statusRepairLastLog = new Map<string, number>();
	const processRetryDelay = new Map<string, number>();
	const processRetryLastLog = new Map<string, number>();
	const deliveryControllers = new Map<symbol, AbortController>();
	const ignoredResultFingerprints = new Map<string, ResultFingerprint>();
	let deliveryActive = false;
	let deliveryEpoch = 0;
	let safetyScanTimer: ReturnType<typeof setInterval> | undefined;
	// The sole in-memory ownership lease. It is acquired for one active session
	// and revoked before the watcher, queues, or callbacks are torn down.
	let activeSessionId: string | null = null;

	const sameFingerprint = (left: ResultFingerprint, right: ResultFingerprint): boolean =>
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.ctimeMs === right.ctimeMs &&
		left.mtimeMs === right.mtimeMs;

	const currentFingerprint = (resultPath: string): ResultFingerprint | undefined => {
		try {
			const stat = fsApi.lstatSync(resultPath);
			return {
				ctimeMs: stat.ctimeMs,
				dev: stat.dev,
				ino: stat.ino,
				mtimeMs: stat.mtimeMs,
				size: stat.size,
			};
		} catch {
			return undefined;
		}
	};

	const rememberIgnoredResult = (file: string, snapshot: ResultFingerprint, epoch: number): void => {
		if (!deliveryActive || epoch !== deliveryEpoch) return;
		ignoredResultFingerprints.delete(file);
		ignoredResultFingerprints.set(file, snapshot);
		while (ignoredResultFingerprints.size > MAX_IGNORED_RESULT_FINGERPRINTS) {
			const oldest = ignoredResultFingerprints.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			ignoredResultFingerprints.delete(oldest);
		}
	};

	const validAsyncBinding = (data: ResultFileData, file: string): "valid" | "pending" | "invalid" => {
		const fileRunId = file.replace(/\.json$/iu, "");
		if ((data.runId !== undefined && data.runId !== fileRunId) || (data.id !== undefined && data.id !== fileRunId)) {
			return "invalid";
		}
		if (typeof data.asyncDir !== "string" || !data.asyncDir) return "valid";
		const runId = fileRunId;
		const expectedDir = path.join(path.resolve(asyncDirRoot), runId);
		if (path.resolve(data.asyncDir) !== expectedDir || path.dirname(expectedDir) !== path.resolve(asyncDirRoot)) {
			return "invalid";
		}
		let entry: fs.Stats;
		try {
			entry = fsApi.lstatSync(expectedDir);
		} catch (error) {
			if (isNotFound(error)) return "pending";
			throw error;
		}
		if (!entry.isDirectory() || entry.isSymbolicLink()) return "invalid";
		const canonicalRoot = fsApi.realpathSync(asyncDirRoot);
		const canonicalDir = fsApi.realpathSync(expectedDir);
		return path.dirname(canonicalDir) === canonicalRoot ? "valid" : "invalid";
	};

	const ownsSession = (sessionId: string, runId: string, epoch: number) => {
		if (!deliveryActive || epoch !== deliveryEpoch) return false;
		if (!activeSessionId && state.currentSessionId) activeSessionId = state.currentSessionId;
		const artifactMatches = state.currentSessionScope
			? sessionArtifactMatches(state.currentSessionScope, sessionId, runId)
			: sessionId === state.currentSessionId;
		return activeSessionId === state.currentSessionId && artifactMatches;
	};

	const scheduleResult = (file: string, triggerTurn: boolean, delayMs = 0) => {
		const pendingMode = pendingTriggerTurn.get(file);
		pendingTriggerTurn.set(file, !(pendingMode === false || !triggerTurn));
		state.resultFileCoalescer.schedule(file, delayMs);
	};

	const reportStatusRepair = (file: string, message: string, error?: unknown): void => {
		const now = Date.now();
		const last = statusRepairLastLog.get(file) ?? 0;
		if (now - last < STATUS_REPAIR_LOG_INTERVAL_MS) return;
		statusRepairLastLog.set(file, now);
		if (error === undefined) reportAgentDiagnostic(message);
		else reportAgentDiagnostic(message, error);
	};

	const scheduleStatusRepair = (file: string, triggerTurn: boolean): void => {
		const delay = statusRepairRetryDelay.get(file) ?? STATUS_REPAIR_RETRY_INITIAL_MS;
		statusRepairRetryDelay.set(file, Math.min(STATUS_REPAIR_RETRY_MAX_MS, delay * 2));
		scheduleResult(file, triggerTurn, delay);
	};

	const ensureTerminalStatus = (
		data: ResultFileData,
		resultPath: string,
		file: string,
		resultContent: string,
	): boolean => {
		if (typeof data.asyncDir !== "string" || !data.asyncDir) return true;
		try {
			const terminal = repairTerminalStatusFromResult(data.asyncDir, resultPath, Date.now(), resultContent);
			if (
				terminal &&
				terminal.state !== "running" &&
				terminal.state !== "queued" &&
				(terminal.lifecycleArtifactVersion !== 3 || terminal.processTerminal?.state === "observed")
			) {
				statusRepairRetryDelay.delete(file);
				statusRepairLastLog.delete(file);
				return true;
			}
			reportStatusRepair(
				file,
				`Subagent result '${resultPath}' has no durable terminal status yet; delivering once and retaining it for bounded repair retry.`,
			);
		} catch (error) {
			reportStatusRepair(
				file,
				`Failed to make terminal status durable for subagent result '${resultPath}'; delivering once and retaining it for bounded repair retry:`,
				error,
			);
		}
		return false;
	};

	const handleResult = async (file: string, triggerTurn: boolean) => {
		if (path.basename(file) !== file || !file.endsWith(".json")) {
			reportStatusRepair(file, `Ignoring unsafe subagent result entry '${file}'.`);
			return;
		}
		const resultPath = path.join(resultsDir, file);
		if (processing.has(file) || !fsApi.existsSync(resultPath)) return;
		const ignoredFingerprint = ignoredResultFingerprints.get(file);
		if (ignoredFingerprint) {
			const fingerprint = currentFingerprint(resultPath);
			if (fingerprint && sameFingerprint(ignoredFingerprint, fingerprint)) return;
			ignoredResultFingerprints.delete(file);
		}
		const attemptEpoch = deliveryEpoch;
		const attemptToken = Symbol(file);
		const deliveryController = new AbortController();
		let durableClaim: DurableClaim | undefined;
		processing.set(file, attemptToken);
		deliveryControllers.set(attemptToken, deliveryController);
		try {
			durableClaim = acquireClaim(resultsDir, deliveryClaimName(file));
			if (!durableClaim) {
				scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
				return;
			}
			const resultSnapshot = readResultSnapshot(resultPath, MAX_RESULT_FILE_BYTES);
			const rawResult = resultSnapshot.text;
			const data = JSON.parse(rawResult) as ResultFileData;
			processRetryDelay.delete(file);
			processRetryLastLog.delete(file);
			if (typeof data.sessionId !== "string" || !data.sessionId) {
				rememberIgnoredResult(file, resultSnapshot, attemptEpoch);
				return;
			}
			const runId = data.runId ?? data.id ?? file.replace(/\.json$/i, "");
			const epoch = deliveryEpoch;
			if (!ownsSession(data.sessionId, runId, epoch)) {
				rememberIgnoredResult(file, resultSnapshot, epoch);
				return;
			}
			const asyncBinding = validAsyncBinding(data, file);
			if (asyncBinding === "invalid") {
				rememberIgnoredResult(file, resultSnapshot, attemptEpoch);
				reportStatusRepair(file, `Ignoring subagent result '${resultPath}' with an unsafe asyncDir binding.`);
				return;
			}
			// An absent but lexically exact run directory is safe to deliver once.
			// ensureTerminalStatus retains the result and performs bounded repair
			// retries until the durable terminal status can be written.
			const terminalStatusReady = ensureTerminalStatus(data, resultPath, file, rawResult);

			const hasExplicitNestedChildren = data.nestedChildren !== undefined;
			let nestedChildren = compactNestedResultChildren(
				sanitizeNestedResultChildren(data.nestedChildren, resultPath, "nestedChildren"),
			);
			let persistedStatus: AsyncStatus | null = null;
			if (typeof data.asyncDir === "string" && data.asyncDir) {
				try {
					persistedStatus = readStatus(data.asyncDir);
				} catch (error) {
					reportAgentDiagnostic(`Failed to inspect exact nested status for '${resultPath}':`, error);
				}
			}
			const statusChildren = compactNestedResultChildren(
				persistedStatus?.steps?.flatMap((step) => step.children ?? []),
			);
			if (!nestedChildren?.length && !hasExplicitNestedChildren) {
				if (persistedStatus?.nestedRoute) {
					try {
						nestedChildren = compactNestedResultChildren(
							(await projectNestedEvents(persistedStatus.nestedRoute)).children,
						);
					} catch (error) {
						// An exact persisted route is authoritative. A busy projector is
						// not an empty tree, so retain the result and retry instead of
						// permanently delivering an incomplete nested summary.
						reportAgentDiagnostic(
							`Failed to project exact nested route for '${resultPath}'; retaining result for retry:`,
							error,
						);
						scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
						return;
					}
				} else {
					nestedChildren = statusChildren;
					if (!nestedChildren?.length) {
						try {
							nestedChildren = compactNestedResultChildren((await projectNestedRegistry(runId))?.children);
						} catch (error) {
							reportAgentDiagnostic(
								`Failed to authoritatively enrich legacy subagent result '${resultPath}'; retaining it for retry:`,
								error,
							);
							scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
							return;
						}
					}
				}
			}

			const completionKey = buildCompletionKey(data, `result:${file}`);
			const digest = resultDigest(rawResult);
			const restoredDeliveryState = readDeliveryState(resultsDir, file, completionKey, digest);
			let deliveryState =
				restoredDeliveryState ??
				({
					version: 1,
					completionKey,
					resultDigest: digest,
					intercomComplete: false,
					intercomDelivered: false,
					notificationAccepted: false,
					completionEmitted: false,
					updatedAt: Date.now(),
				} satisfies ResultDeliveryState);
			const lastSeenAt = state.completionSeen.get(completionKey);
			if (
				lastSeenAt !== undefined &&
				!deliveredPendingStatus.has(completionKey) &&
				Date.now() - lastSeenAt > completionTtlMs
			) {
				state.completionSeen.delete(completionKey);
			} else if (
				(lastSeenAt !== undefined || deliveredPendingStatus.has(completionKey)) &&
				(!restoredDeliveryState ||
					(restoredDeliveryState.intercomComplete &&
						restoredDeliveryState.notificationAccepted &&
						restoredDeliveryState.completionEmitted))
			) {
				if (!ownsSession(data.sessionId, runId, epoch) || !fsApi.existsSync(resultPath)) return;
				if (!terminalStatusReady) {
					scheduleStatusRepair(file, triggerTurn);
					return;
				}
				try {
					if (removeOwnedFileSnapshot(resultPath, resultSnapshot) === "changed") {
						scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
						return;
					}
					removeDeliveryArtifacts(resultsDir, file);
					deliveredPendingStatus.delete(completionKey);
					statusRepairRetryDelay.delete(file);
					statusRepairLastLog.delete(file);
				} catch (error) {
					if (!isNotFound(error)) {
						reportAgentDiagnostic(
							`Failed to remove delivered subagent result '${resultPath}'; will retry:`,
							error,
						);
						scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
					}
				}
				return;
			}

			const persistedResults = Array.isArray(data.results) && data.results.length > 0 ? data.results : undefined;
			const hasResultChildren = persistedResults !== undefined;
			const resultChildren: ResultFileChild[] = persistedResults ?? [
				{ agent: data.agent ?? undefined, output: data.summary, success: data.success },
			];
			const normalizedChildren = attachNestedChildrenToResultChildren(
				runId,
				resultChildren.map((result = {}, index): SubagentResultIntercomChild => {
					const baseOutput = result.output ?? data.summary;
					const hasRealOutput = typeof baseOutput === "string" && baseOutput.trim().length > 0;
					const output = hasRealOutput ? baseOutput : "(no output)";
					const summary =
						result.success === false && result.error
							? `${result.error}${hasRealOutput ? `\n\nOutput:\n${baseOutput}` : ""}`
							: output;
					const sessionPath = result.sessionFile ?? (resultChildren.length === 1 ? data.sessionFile : undefined);
					const childNestedChildren = sanitizeNestedResultChildren(
						result.children,
						resultPath,
						`results[${index}].children`,
					);
					const childState =
						result.state === "paused" || result.state === "stopped"
							? result.state
							: result.stopped === true
								? "stopped"
								: result.interrupted === true
									? "paused"
									: !hasResultChildren &&
											(data.state === "paused" ||
												data.state === "stopped" ||
												typeof result.success !== "boolean")
										? data.state
										: undefined;
					return {
						agent: result.agent ?? data.agent ?? `step-${index + 1}`,
						status: resolveSubagentResultStatus({ success: result.success, state: childState }),
						summary,
						index,
						artifactPath: result.artifactPaths?.outputPath,
						...(typeof sessionPath === "string" && fsApi.existsSync(sessionPath) ? { sessionPath } : {}),
						...(result.intercomTarget ? { intercomTarget: result.intercomTarget } : {}),
						...(childNestedChildren ? { children: childNestedChildren } : {}),
					};
				}),
				nestedChildren,
			);
			const mode =
				data.mode === "parallel" || (data.mode !== "single" && resultChildren.length > 1) ? "parallel" : "single";
			const projectedResults = Array.isArray(data.results)
				? hasResultChildren
					? normalizedChildren.map((child, index) => ({
							...pickFields(persistedResults?.[index] ?? {}, RESULT_CHILD_FIELDS),
							agent: child.agent,
							status: child.status,
							summary: child.summary,
							index: child.index,
							artifactPath: child.artifactPath,
							sessionPath: child.sessionPath,
							children: child.children,
						}))
					: []
				: undefined;
			const completion: CompletionNotification = {
				...pickFields(data, COMPLETION_FIELDS),
				...(persistedStatus?.parentRunOrigin === "user" ||
				nestedWorkIncludesUser(statusChildren) ||
				nestedWorkIncludesUser(nestedChildren)
					? { parentRunOrigin: "user" as const }
					: {}),
				id: data.id ?? runId,
				runId,
				...(activeSessionId ? { sessionId: activeSessionId } : {}),
				deliveryId: stableDeliveryId(completionKey),
				mode,
				triggerTurn,
				...(nestedChildren?.length ? { nestedChildren } : {}),
				...(projectedResults ? { results: projectedResults } : {}),
			};

			const intercomTarget = data.intercomTarget?.trim();
			let intercomDelivered = deliveryState.intercomDelivered;
			// `triggerTurn` controls only whether the local completion notifier should
			// wake the main model. An explicitly addressed result is a separate,
			// durable delivery obligation and must still be acknowledged during the
			// cold-start `primeExistingResults({ triggerTurn: false })` scan.
			const shouldDeliverIntercom = deliverIntercomResults && Boolean(intercomTarget);
			if (!deliveryState.intercomComplete && shouldDeliverIntercom && intercomTarget) {
				if (!ownsSession(data.sessionId, runId, epoch)) return;
				const payload = buildSubagentResultIntercomPayload({
					to: intercomTarget,
					runId,
					mode,
					source: "async",
					children: normalizedChildren,
					asyncId: data.id ?? undefined,
					asyncDir: data.asyncDir,
				});
				intercomDelivered = await deliverSubagentResultIntercomEvent(pi.events, {
					...payload,
					requestId: stableDeliveryId(completionKey),
				});
				if (!intercomDelivered)
					reportAgentDiagnostic(
						`Subagent async grouped result intercom delivery was not acknowledged for '${resultPath}'.`,
					);
			}
			if (!ownsSession(data.sessionId, runId, epoch)) return;
			if (!shouldDeliverIntercom || intercomDelivered) {
				deliveryState = {
					...deliveryState,
					intercomComplete: true,
					intercomDelivered,
					updatedAt: Date.now(),
				};
				writeDeliveryState(resultsDir, file, deliveryState);
			}
			if (!ownsSession(data.sessionId, runId, epoch)) return;

			completion.intercomDelivered = intercomDelivered;
			if (!deliveryState.notificationAccepted) {
				const accepted = await deliverNotificationWithAbort(notifier, completion, deliveryController.signal);
				if (!accepted) {
					if (ownsSession(data.sessionId, runId, epoch)) scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
					return;
				}
				deliveryState = { ...deliveryState, notificationAccepted: true, updatedAt: Date.now() };
				writeDeliveryState(resultsDir, file, deliveryState);
			}
			if (!ownsSession(data.sessionId, runId, epoch)) return;
			markSeenWithTtl(state.completionSeen, completionKey, Date.now(), completionTtlMs);
			if (!terminalStatusReady) deliveredPendingStatus.add(completionKey);
			if (!deliveryState.completionEmitted) {
				try {
					pi.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, completion);
				} catch (error) {
					reportAgentDiagnostic(`Completion observer failed for '${resultPath}':`, error);
				}
				deliveryState = { ...deliveryState, completionEmitted: true, updatedAt: Date.now() };
				writeDeliveryState(resultsDir, file, deliveryState);
			}
			if (!ownsSession(data.sessionId, runId, epoch) || !fsApi.existsSync(resultPath)) return;
			if (!deliveryState.intercomComplete) {
				// Local completion may already be durable, but an explicitly addressed
				// grouped result is not disposable until its stable-id delivery is acked.
				scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
				return;
			}
			if (!terminalStatusReady) {
				scheduleStatusRepair(file, triggerTurn);
				return;
			}
			try {
				if (removeOwnedFileSnapshot(resultPath, resultSnapshot) === "changed") {
					scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
					return;
				}
				removeDeliveryArtifacts(resultsDir, file);
				deliveredPendingStatus.delete(completionKey);
				statusRepairRetryDelay.delete(file);
				statusRepairLastLog.delete(file);
			} catch (error) {
				if (!isNotFound(error)) {
					reportAgentDiagnostic(`Failed to remove delivered subagent result '${resultPath}'; will retry:`, error);
					scheduleResult(file, triggerTurn, RETRY_DELAY_MS);
				}
			}
		} catch (error) {
			if (!isNotFound(error)) {
				const now = Date.now();
				const last = processRetryLastLog.get(file) ?? 0;
				if (now - last >= STATUS_REPAIR_LOG_INTERVAL_MS) {
					processRetryLastLog.set(file, now);
					reportAgentDiagnostic(`Failed to process subagent result file '${resultPath}'; will retry:`, error);
				}
				if (deliveryActive && attemptEpoch === deliveryEpoch && fsApi.existsSync(resultPath)) {
					const delay = processRetryDelay.get(file) ?? PROCESS_RETRY_INITIAL_MS;
					processRetryDelay.set(file, Math.min(PROCESS_RETRY_MAX_MS, delay * 2));
					scheduleResult(file, triggerTurn, delay);
				}
			}
		} finally {
			deliveryControllers.delete(attemptToken);
			try {
				durableClaim?.release();
			} catch (releaseError) {
				reportAgentDiagnostic(`Failed to release subagent result claim for '${resultPath}':`, releaseError);
			}
			// stop→restart may legitimately begin a new attempt while this old epoch
			// is still awaiting a notifier. Never release the new attempt's lock.
			if (processing.get(file) === attemptToken) processing.delete(file);
		}
	};

	state.resultFileCoalescer = createFileCoalescer((file) => {
		const triggerTurn = pendingTriggerTurn.get(file) !== false;
		pendingTriggerTurn.delete(file);
		void handleResult(file, triggerTurn);
	}, 50);

	const primeExistingResults = (options: { triggerTurn?: boolean } = {}) => {
		try {
			const triggerTurn = options.triggerTurn !== false;
			fsApi
				.readdirSync(resultsDir)
				.filter((f) => f.endsWith(".json"))
				.forEach((file) => {
					scheduleResult(file, triggerTurn);
				});
		} catch (error) {
			if (!isNotFound(error))
				reportAgentDiagnostic(`Failed to scan subagent result directory '${resultsDir}':`, error);
		}
	};

	const startPolling = (reason: unknown): boolean => {
		state.watcher?.close();
		state.watcher = null;
		if (safetyScanTimer) timers.clearInterval(safetyScanTimer);
		safetyScanTimer = undefined;
		if (state.watcherRestartTimer) return true;
		reportAgentDiagnostic(
			`Subagent result watcher for '${resultsDir}' fell back to polling because native fs.watch is unavailable (${errorCode(reason) ?? "unknown error"}).`,
		);
		primeExistingResults();
		state.watcherRestartTimer = timers.setInterval(primeExistingResults, pollIntervalMs);
		state.watcherRestartTimer.unref?.();
		return true;
	};

	const scheduleRestart = () => {
		if (state.watcherRestartTimer) return;
		state.watcherRestartTimer = timers.setTimeout(() => {
			state.watcherRestartTimer = null;
			if (!deliveryActive) return;
			try {
				if (startResultWatcher()) primeExistingResults();
				else scheduleRestart();
			} catch (error) {
				if (shouldPoll(error)) return startPolling(error);
				reportAgentDiagnostic(`Failed to restart subagent result watcher for '${resultsDir}':`, error);
				scheduleRestart();
			}
		}, watcherRestartDelayMs);
		state.watcherRestartTimer.unref?.();
	};

	const startResultWatcher = (): boolean => {
		if (state.watcher) return true;
		if (!deliveryActive || activeSessionId !== state.currentSessionId) {
			ignoredResultFingerprints.clear();
			activeSessionId = state.currentSessionId;
			deliveryActive = true;
			deliveryEpoch += 1;
		}
		if (state.watcherRestartTimer) {
			timers.clearTimeout(state.watcherRestartTimer);
			timers.clearInterval(state.watcherRestartTimer);
			state.watcherRestartTimer = null;
		}
		if (!fsApi.existsSync(resultsDir)) {
			scheduleRestart();
			return false;
		}
		try {
			const watchDir = resolveWatchPath(resultsDir, fsApi.realpathSync.native);
			state.watcher = fsApi.watch(watchDir, (event, file) => {
				if (event !== "rename") return;
				if (!file) {
					state.watcher?.close();
					state.watcher = null;
					scheduleRestart();
					return;
				}
				const fileName = file.toString();
				const resultFile = resultFileFromWatchEntry(fileName);
				if (!resultFile) return;
				ignoredResultFingerprints.delete(resultFile);
				scheduleResult(resultFile, true, resultFile === fileName ? undefined : RETRY_DELAY_MS);
			});
			if (!safetyScanTimer) {
				safetyScanTimer = timers.setInterval(primeExistingResults, safetyScanIntervalMs);
				safetyScanTimer.unref?.();
			}
			state.watcher.on("error", (error) => {
				if (shouldPoll(error)) return startPolling(error);
				reportAgentDiagnostic(`Subagent result watcher failed for '${resultsDir}':`, error);
				state.watcher?.close();
				state.watcher = null;
				scheduleRestart();
			});
			state.watcher.unref?.();
			return true;
		} catch (error) {
			if (shouldPoll(error)) return startPolling(error);
			reportAgentDiagnostic(`Failed to start subagent result watcher for '${resultsDir}':`, error);
			state.watcher = null;
			scheduleRestart();
			return false;
		}
	};

	const stopResultWatcher = () => {
		deliveryActive = false;
		activeSessionId = null;
		deliveryEpoch += 1;
		for (const controller of deliveryControllers.values()) controller.abort();
		state.watcher?.close();
		state.watcher = null;
		if (state.watcherRestartTimer) {
			timers.clearTimeout(state.watcherRestartTimer);
			timers.clearInterval(state.watcherRestartTimer);
		}
		state.watcherRestartTimer = null;
		if (safetyScanTimer) timers.clearInterval(safetyScanTimer);
		safetyScanTimer = undefined;
		state.resultFileCoalescer.clear();
		pendingTriggerTurn.clear();
		processing.clear();
		deliveredPendingStatus.clear();
		statusRepairRetryDelay.clear();
		statusRepairLastLog.clear();
		processRetryDelay.clear();
		processRetryLastLog.clear();
		ignoredResultFingerprints.clear();
	};

	return { startResultWatcher, primeExistingResults, stopResultWatcher };
}
