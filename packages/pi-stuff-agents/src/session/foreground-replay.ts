import * as fs from "node:fs";
import * as path from "node:path";
import { terminateOrphanWriterProcesses } from "../runs/background/writer-process-registry.ts";
import { readForegroundOwnerExit } from "../runs/foreground/owner-exit.ts";
import { parseSubagentCapabilityCeiling } from "../runs/shared/capability-ceiling.ts";
import { resolvePersistedNestedRoute, sanitizeSummary } from "../runs/shared/nested-events.ts";
import { writePrivateAtomicJson } from "../shared/atomic-json.ts";
import { readBoundedOwnedFile } from "../shared/private-directory.ts";
import { readProcessStartIdentity } from "../shared/process-identity.ts";
import { type SessionCompatibilityScope, sessionArtifactMatches } from "../shared/session-identity.ts";
import { tryAcquireStatusMutationClaim } from "../shared/status-mutation.ts";
import type { AsyncStatus, ForegroundResumeChild, ForegroundResumeRun } from "../shared/types.ts";
import { readStatus } from "../shared/utils.ts";

const MAX_REPLAYED_FOREGROUND_RUNS = 200;
const MAX_REPLAYED_CHILDREN = 20;
const MAX_FOREGROUND_COMPLETION_BYTES = 32 * 1024 * 1024;
const FOREGROUND_OWNER_CRASH = "Foreground Agent crashed because its owning Pi process exited.";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function displayString(value: unknown, maxChars: number): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
	}
	return false;
}

function exactString(value: unknown, maxChars: number): string | undefined {
	if (typeof value !== "string" || !value.trim() || value.length > maxChars || hasControlCharacter(value)) {
		return undefined;
	}
	return value;
}

function finiteInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : undefined;
}

function entryTime(value: unknown): number {
	if (typeof value !== "string") return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function childStatus(child: Record<string, unknown>): ForegroundResumeChild["status"] {
	if (child.stopped === true) return "stopped";
	if (child.interrupted === true) return "paused";
	if (child.crashed === true) return "failed";
	return finiteInteger(child.exitCode) === 0 ? "completed" : "failed";
}

function replayChild(value: unknown, index: number, updatedAt: number): ForegroundResumeChild | undefined {
	const child = record(value);
	const agent = exactString(child.agent, 256);
	const task = displayString(child.task, 16 * 1024);
	const exitCode = finiteInteger(child.exitCode);
	if (!agent || !task || exitCode === undefined) return undefined;
	const context = child.context === "fresh" || child.context === "fork" ? child.context : undefined;
	const sessionFile = exactString(child.sessionFile, 4_096);
	if (child.sessionFile !== undefined && !sessionFile) return undefined;
	if (sessionFile && !path.isAbsolute(sessionFile)) return undefined;
	const childCwd = exactString(child.cwd, 4_096);
	if (child.cwd !== undefined && !childCwd) return undefined;
	if (childCwd && !path.isAbsolute(childCwd)) return undefined;
	const model = exactString(child.model, 256);
	if (child.model !== undefined && !model) return undefined;
	const thinking = exactString(child.thinking, 64);
	if (child.thinking !== undefined && !thinking) return undefined;
	const error = displayString(child.error, 8 * 1024);
	const finalOutput = displayString(child.finalOutput, 32 * 1024);
	const transcriptPath = exactString(child.transcriptPath, 4_096);
	if (child.transcriptPath !== undefined && !transcriptPath) return undefined;
	if (transcriptPath && !path.isAbsolute(transcriptPath)) return undefined;
	const transcriptError = displayString(child.transcriptError, 8 * 1024);
	const launchContractDigest = exactString(child.launchContractDigest, 256);
	if (child.launchContractDigest !== undefined && !launchContractDigest) return undefined;
	let capabilityCeiling: ForegroundResumeChild["capabilityCeiling"];
	if (child.capabilityCeiling !== undefined) {
		try {
			capabilityCeiling = parseSubagentCapabilityCeiling(
				child.capabilityCeiling,
				"replayed foreground capability ceiling",
			);
		} catch {
			return undefined;
		}
	}
	const children = Array.isArray(child.children)
		? child.children
				.map((nested) => sanitizeSummary(nested))
				.filter((nested): nested is NonNullable<typeof nested> => Boolean(nested))
		: undefined;
	return {
		agent,
		index,
		task,
		status: childStatus(child),
		exitCode,
		updatedAt,
		...(context ? { context } : {}),
		...(child.crashed === true ? { crashed: true } : {}),
		...(sessionFile ? { sessionFile } : {}),
		...(childCwd ? { cwd: childCwd } : {}),
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(error ? { error } : {}),
		...(finalOutput ? { finalOutput } : {}),
		...(transcriptPath ? { transcriptPath } : {}),
		...(transcriptError ? { transcriptError } : {}),
		...(launchContractDigest ? { launchContractDigest } : {}),
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		...(children?.length ? { children } : {}),
	};
}

/** Rebuild bounded foreground resume/report state from subagent tool results on the active session branch. */
export function replayForegroundRuns(entries: Iterable<unknown>, sessionId: string): Map<string, ForegroundResumeRun> {
	const runs = new Map<string, ForegroundResumeRun>();
	for (const value of entries) {
		const entry = record(value);
		if (entry.type !== "message") continue;
		const message = record(entry.message);
		if (message.role !== "toolResult" || message.toolName !== "subagent") continue;
		const details = record(message.details);
		const runId = exactString(details.runId, 256);
		const cwd = exactString(details.cwd, 4_096);
		const mode = details.mode === "single" || details.mode === "parallel" ? details.mode : undefined;
		const results = Array.isArray(details.results) ? details.results : undefined;
		if (
			!runId ||
			!cwd ||
			!path.isAbsolute(cwd) ||
			!mode ||
			!results?.length ||
			results.length > MAX_REPLAYED_CHILDREN
		) {
			continue;
		}
		const updatedAt = entryTime(entry.timestamp);
		const children = results
			.map((child, index) => replayChild(child, index, updatedAt))
			.filter((child): child is ForegroundResumeChild => child !== undefined);
		if (children.length !== results.length) continue;
		runs.set(runId, { runId, mode, cwd, sessionId, updatedAt, children });
	}
	return new Map(
		[...runs.entries()]
			.sort(([, left], [, right]) => right.updatedAt - left.updatedAt || right.runId.localeCompare(left.runId))
			.slice(0, MAX_REPLAYED_FOREGROUND_RUNS),
	);
}

function ownerLiveness(status: AsyncStatus): "alive" | "dead" | "unknown" {
	if (!Number.isSafeInteger(status.pid) || (status.pid ?? 0) <= 0 || !status.processStartIdentity) return "unknown";
	const current = readProcessStartIdentity(status.pid!);
	if (current) return current === status.processStartIdentity ? "alive" : "dead";
	try {
		process.kill(status.pid!, 0);
		return "unknown";
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown";
	}
}

function foregroundChildStatus(status: unknown): ForegroundResumeChild["status"] | undefined {
	if (status === "complete" || status === "completed") return "completed";
	if (status === "paused") return "paused";
	if (status === "stopped") return "stopped";
	if (status === "failed") return "failed";
	if (status === "running" || status === "pending" || status === "queued") return "detached";
	return undefined;
}

function finiteTimestamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function runtimeChild(value: unknown, index: number, updatedAt: number): ForegroundResumeChild | undefined {
	const step = record(value);
	const agent = exactString(step.agent, 256);
	const status = foregroundChildStatus(step.status);
	if (!agent || !status) return undefined;
	const description = displayString(step.label, 4_096);
	const task = displayString(step.task, 16 * 1024) ?? description;
	const context = step.context === "fresh" || step.context === "fork" ? step.context : undefined;
	const childCwd = exactString(step.cwd, 4_096);
	if (step.cwd !== undefined && (!childCwd || !path.isAbsolute(childCwd))) return undefined;
	const sessionFile = exactString(step.sessionFile, 4_096);
	if (step.sessionFile !== undefined && (!sessionFile || !path.isAbsolute(sessionFile))) return undefined;
	const model = exactString(step.model, 256);
	if (step.model !== undefined && !model) return undefined;
	const thinking = exactString(step.thinking, 64);
	if (step.thinking !== undefined && !thinking) return undefined;
	const launchContractDigest = exactString(step.launchContractDigest, 256);
	if (step.launchContractDigest !== undefined && !launchContractDigest) return undefined;
	let capabilityCeiling: ForegroundResumeChild["capabilityCeiling"];
	if (step.capabilityCeiling !== undefined) {
		try {
			capabilityCeiling = parseSubagentCapabilityCeiling(
				step.capabilityCeiling,
				"runtime foreground capability ceiling",
			);
		} catch {
			return undefined;
		}
	}
	const transcriptPath = exactString(step.transcriptPath, 4_096);
	if (step.transcriptPath !== undefined && (!transcriptPath || !path.isAbsolute(transcriptPath))) return undefined;
	const recentOutput = Array.isArray(step.recentOutput)
		? displayString(
				step.recentOutput
					.filter((line): line is string => typeof line === "string")
					.slice(-50)
					.join("\n"),
				32 * 1024,
			)
		: undefined;
	const children = Array.isArray(step.children)
		? step.children
				.map((child) => sanitizeSummary(child))
				.filter((child): child is NonNullable<typeof child> => Boolean(child))
		: undefined;
	const activityState =
		step.activityState === "active_long_running" || step.activityState === "needs_attention"
			? step.activityState
			: undefined;
	const currentTool = displayString(step.currentTool, 256);
	const currentPath = displayString(step.currentPath, 4_096);
	const exitCode = finiteInteger(step.exitCode);
	const turnCount = finiteInteger(step.turnCount);
	const toolCount = finiteInteger(step.toolCount);
	return {
		agent,
		index,
		...(description ? { description } : {}),
		...(task ? { task } : {}),
		...(context ? { context } : {}),
		status,
		...(step.agentStatus === "crashed" ? { crashed: true } : {}),
		...(sessionFile ? { sessionFile } : {}),
		...(childCwd ? { cwd: childCwd } : {}),
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(launchContractDigest ? { launchContractDigest } : {}),
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		...(exitCode !== undefined ? { exitCode } : {}),
		...(displayString(step.error, 8 * 1024) ? { error: displayString(step.error, 8 * 1024) } : {}),
		...(recentOutput ? { finalOutput: recentOutput } : {}),
		...(transcriptPath ? { transcriptPath } : {}),
		...(displayString(step.transcriptError, 8 * 1024)
			? { transcriptError: displayString(step.transcriptError, 8 * 1024) }
			: {}),
		...(children?.length ? { children } : {}),
		...(activityState ? { activityState } : {}),
		...(finiteTimestamp(step.lastActivityAt) !== undefined
			? { lastActivityAt: finiteTimestamp(step.lastActivityAt) }
			: {}),
		...(currentTool ? { currentTool } : {}),
		...(finiteTimestamp(step.currentToolStartedAt) !== undefined
			? { currentToolStartedAt: finiteTimestamp(step.currentToolStartedAt) }
			: {}),
		...(currentPath ? { currentPath } : {}),
		...(turnCount !== undefined && turnCount >= 0 ? { turnCount } : {}),
		...(toolCount !== undefined && toolCount >= 0 ? { toolCount } : {}),
		updatedAt: finiteTimestamp(step.endedAt) ?? updatedAt,
	};
}

function runFromStatus(value: unknown, asyncDir: string): ForegroundResumeRun | undefined {
	const status = record(value);
	const runId = exactString(status.runId, 256);
	const mode = status.mode === "single" || status.mode === "parallel" ? status.mode : undefined;
	const cwd = exactString(status.cwd, 4_096);
	const sessionId = exactString(status.sessionId, 4_096);
	const steps = Array.isArray(status.steps) ? status.steps : undefined;
	if (
		!runId ||
		!mode ||
		!cwd ||
		!path.isAbsolute(cwd) ||
		!sessionId ||
		!steps?.length ||
		steps.length > MAX_REPLAYED_CHILDREN
	)
		return undefined;
	const updatedAt =
		finiteTimestamp(status.endedAt) ?? finiteTimestamp(status.lastUpdate) ?? finiteTimestamp(status.startedAt) ?? 0;
	const children = steps
		.map((step, index) => runtimeChild(step, index, updatedAt))
		.filter((child): child is ForegroundResumeChild => child !== undefined);
	if (children.length !== steps.length) return undefined;
	const nestedRoute = resolvePersistedNestedRoute(status.nestedRoute, runId);
	return {
		runId,
		mode,
		cwd,
		asyncDir,
		sessionId,
		updatedAt,
		...(nestedRoute ? { nestedRoute } : {}),
		children,
	};
}

function applyCompletionToStatus(status: AsyncStatus, completionPath: string): AsyncStatus | undefined {
	let completion: Record<string, unknown>;
	try {
		completion = JSON.parse(readBoundedOwnedFile(completionPath, MAX_FOREGROUND_COMPLETION_BYTES)) as Record<
			string,
			unknown
		>;
	} catch {
		return undefined;
	}
	const identities = [completion.runId, completion.id].filter((value) => value !== undefined);
	if (
		identities.length === 0 ||
		identities.some((value) => value !== status.runId) ||
		!Array.isArray(completion.results) ||
		completion.results.length !== status.steps?.length
	)
		return undefined;
	const completionResults = completion.results as unknown[];
	for (const value of completionResults) {
		const result = record(value);
		for (const field of ["sessionFile", "transcriptPath"] as const) {
			if (result[field] === undefined) continue;
			const locator = exactString(result[field], 4_096);
			if (!locator || !path.isAbsolute(locator)) return undefined;
		}
	}
	const state =
		completion.state === "complete" ||
		completion.state === "failed" ||
		completion.state === "paused" ||
		completion.state === "stopped"
			? completion.state
			: undefined;
	if (!state) return undefined;
	const endedAt =
		typeof completion.endedAt === "number" && Number.isFinite(completion.endedAt) ? completion.endedAt : Date.now();
	const steps = (status.steps ?? []).map((step, index) => {
		const result = record(completionResults[index]);
		const childState =
			result.stopped === true
				? ("stopped" as const)
				: result.interrupted === true
					? ("paused" as const)
					: result.success === true
						? ("complete" as const)
						: ("failed" as const);
		const children = Array.isArray(result.children)
			? result.children
					.map((child) => sanitizeSummary(child))
					.filter((child): child is NonNullable<typeof child> => Boolean(child))
			: step.children;
		return {
			...step,
			status: childState,
			endedAt: step.endedAt ?? endedAt,
			exitCode: finiteInteger(result.exitCode) ?? (childState === "complete" ? 0 : 1),
			error: displayString(result.error, 8 * 1024) ?? step.error,
			sessionFile: exactString(result.sessionFile, 4_096) ?? step.sessionFile,
			transcriptPath: exactString(result.transcriptPath, 4_096) ?? step.transcriptPath,
			transcriptError: displayString(result.transcriptError, 8 * 1024) ?? step.transcriptError,
			recentOutput:
				typeof result.output === "string" && result.output
					? [displayString(result.output, 32 * 1024)!]
					: step.recentOutput,
			children,
			activityState: undefined,
			currentTool: undefined,
			currentToolStartedAt: undefined,
			currentPath: undefined,
		};
	});
	const merged: AsyncStatus = {
		...status,
		state,
		endedAt: status.endedAt ?? endedAt,
		lastUpdate: endedAt,
		error: state === "complete" ? undefined : (displayString(completion.summary, 8 * 1024) ?? status.error),
		steps,
	};
	return runFromStatus(merged, path.dirname(completionPath)) ? merged : undefined;
}

function recoverCrashedForegroundStatus(
	asyncDir: string,
	status: AsyncStatus,
	terminateWriters: typeof terminateOrphanWriterProcesses = terminateOrphanWriterProcesses,
): AsyncStatus {
	if (status.state !== "running" && status.state !== "queued") return status;
	const semanticOwnerExit = readForegroundOwnerExit(asyncDir, status.runId);
	if (!semanticOwnerExit && ownerLiveness(status) !== "dead") return status;
	const writers = terminateWriters(asyncDir);
	if (writers.remaining !== 0) return status;
	const endedAt = Date.now();
	const failure = semanticOwnerExit?.error ?? FOREGROUND_OWNER_CRASH;
	const recovered: AsyncStatus = {
		...status,
		state: "failed",
		error: failure,
		endedAt,
		lastUpdate: endedAt,
		activityState: undefined,
		currentTool: undefined,
		currentToolStartedAt: undefined,
		currentPath: undefined,
		steps: status.steps?.map((step) =>
			step.status === "running" || step.status === "pending"
				? {
						...step,
						status: "failed" as const,
						agentStatus: "crashed" as const,
						exitCode: 1,
						error: failure,
						endedAt,
						activityState: undefined,
						currentTool: undefined,
						currentToolStartedAt: undefined,
						currentPath: undefined,
					}
				: step,
		),
	};
	writePrivateAtomicJson(path.join(asyncDir, "status.json"), recovered);
	return recovered;
}

/**
 * Advance one cold foreground recovery by one nonblocking TERM/KILL/absence
 * step. The tracker calls this repeatedly so an orphan that ignores TERM does
 * not remain detached forever after the one session-start scan.
 */
export function refreshForegroundRuntimeRun(
	run: ForegroundResumeRun,
	options: { readonly terminateWriters?: typeof terminateOrphanWriterProcesses } = {},
): boolean {
	if (!run.asyncDir || path.basename(run.asyncDir) !== run.runId) return false;
	const claim = tryAcquireStatusMutationClaim(run.asyncDir);
	if (!claim) return false;
	try {
		let status = readStatus(run.asyncDir);
		if (!status || status.runId !== run.runId || !runFromStatus(status, run.asyncDir)) return false;
		const previousState = status.state;
		const completed = applyCompletionToStatus(status, path.join(run.asyncDir, "completion.json"));
		if (completed) {
			status = completed;
			if (
				(previousState === "running" || previousState === "queued") &&
				status.state !== "running" &&
				status.state !== "queued"
			) {
				writePrivateAtomicJson(path.join(run.asyncDir, "status.json"), status);
			}
		} else {
			status = recoverCrashedForegroundStatus(run.asyncDir, status, options.terminateWriters);
		}
		const refreshed = runFromStatus(status, run.asyncDir);
		if (!refreshed) return false;
		const normalizedSessionId = run.sessionId;
		Object.assign(run, refreshed, normalizedSessionId ? { sessionId: normalizedSessionId } : {});
		return previousState !== status.state;
	} finally {
		claim.release();
	}
}

/** Recover current-session foreground lifecycle left outside the session log by a Host crash. */
export function recoverForegroundRuntimeRuns(
	rootDirectory: string,
	sessionScope: SessionCompatibilityScope,
): Map<string, ForegroundResumeRun> {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
		throw error;
	}
	const candidates = entries
		.filter((entry) => entry.isDirectory() && /^[a-f0-9]{12}$/u.test(entry.name))
		.map((entry) => {
			const asyncDir = path.join(rootDirectory, entry.name);
			try {
				const stat = fs.lstatSync(asyncDir);
				return stat.isDirectory() && !stat.isSymbolicLink() ? { asyncDir, mtimeMs: stat.mtimeMs } : undefined;
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is { asyncDir: string; mtimeMs: number } => Boolean(entry))
		.sort((left, right) => right.mtimeMs - left.mtimeMs);
	const runs = new Map<string, ForegroundResumeRun>();
	for (const { asyncDir } of candidates) {
		try {
			let status = readStatus(asyncDir);
			if (
				!status ||
				!sessionArtifactMatches(sessionScope, status.sessionId, status.runId) ||
				status.runId !== path.basename(asyncDir)
			)
				continue;
			// Validate and sanitize before any completion merge, liveness inspection,
			// process mutation, or projection can consume repository-controlled bytes.
			if (!runFromStatus(status, asyncDir)) continue;
			const statusClaim = tryAcquireStatusMutationClaim(asyncDir);
			if (!statusClaim) continue;
			try {
				// Re-read only after acquiring the shared terminal mutation claim. A
				// nested projector may have attached children and retired its route
				// since the directory candidate was first inspected.
				status = readStatus(asyncDir);
				if (!status || !runFromStatus(status, asyncDir)) continue;
				const previousState = status.state;
				const completed = applyCompletionToStatus(status, path.join(asyncDir, "completion.json"));
				if (completed) {
					status = completed;
					if (
						(previousState === "running" || previousState === "queued") &&
						status.state !== "running" &&
						status.state !== "queued"
					) {
						try {
							writePrivateAtomicJson(path.join(asyncDir, "status.json"), status);
						} catch (error) {
							console.error(
								`Failed to persist recovered foreground terminal status for '${status.runId}':`,
								error,
							);
						}
					}
				} else {
					// A corrupt, oversized, foreign, or concurrently replaced completion
					// is not terminal evidence. Continue through the same owner/writer
					// recovery path as a missing completion instead of pinning the run.
					status = recoverCrashedForegroundStatus(asyncDir, status);
				}
			} finally {
				statusClaim.release();
			}
			const run = runFromStatus(status, asyncDir);
			if (run) runs.set(run.runId, { ...run, sessionId: sessionScope.sessionId });
		} catch {
			// One corrupt runtime directory cannot prevent healthy sibling recovery.
			continue;
		}
		if (runs.size >= MAX_REPLAYED_FOREGROUND_RUNS) break;
	}
	return runs;
}

/**
 * Project retained foreground runtime state without locks, writes, or process
 * signals. Session startup uses this observation-only lane; explicit Agent
 * interaction may later call the recovering variant above.
 */
export function observeForegroundRuntimeRuns(
	rootDirectory: string,
	sessionScope: SessionCompatibilityScope,
	deps: {
		readonly lstat?: typeof fs.lstatSync;
		readonly readRunStatus?: typeof readStatus;
	} = {},
): Map<string, ForegroundResumeRun> {
	const lstat = deps.lstat ?? fs.lstatSync;
	const readRunStatus = deps.readRunStatus ?? readStatus;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
		throw error;
	}
	const candidates = entries
		.filter((entry) => entry.isDirectory() && /^[a-f0-9]{12}$/u.test(entry.name))
		.map((entry) => {
			const asyncDir = path.join(rootDirectory, entry.name);
			try {
				const stat = lstat(asyncDir);
				return stat.isDirectory() && !stat.isSymbolicLink() ? { asyncDir, mtimeMs: stat.mtimeMs } : undefined;
			} catch {
				// A candidate can disappear between readdir and lstat. Healthy siblings
				// remain observable and a later activation can retry the missing run.
				return undefined;
			}
		})
		.filter((entry): entry is { asyncDir: string; mtimeMs: number } => Boolean(entry))
		.sort((left, right) => right.mtimeMs - left.mtimeMs);
	const runs = new Map<string, ForegroundResumeRun>();
	for (const { asyncDir } of candidates) {
		try {
			const status = readRunStatus(asyncDir);
			if (
				!status ||
				!sessionArtifactMatches(sessionScope, status.sessionId, status.runId) ||
				status.runId !== path.basename(asyncDir)
			) {
				continue;
			}
			const run = runFromStatus(status, asyncDir);
			if (run) runs.set(run.runId, { ...run, sessionId: sessionScope.sessionId });
		} catch {
			// Observation-only startup is best effort per candidate. A corrupt,
			// oversized, or concurrently removed status cannot hide healthy siblings.
			continue;
		}
		if (runs.size >= MAX_REPLAYED_FOREGROUND_RUNS) break;
	}
	return runs;
}

export function mergeForegroundRuns(
	primary: Map<string, ForegroundResumeRun>,
	fallback: Map<string, ForegroundResumeRun>,
): Map<string, ForegroundResumeRun> {
	const merged = new Map(primary);
	for (const [runId, run] of fallback) {
		const existing = merged.get(runId);
		if (!existing || run.updatedAt > existing.updatedAt || (Boolean(run.nestedRoute) && !existing.nestedRoute))
			merged.set(runId, run);
		else if (!existing.asyncDir && run.asyncDir) merged.set(runId, { ...existing, asyncDir: run.asyncDir });
	}
	return new Map(
		[...merged.entries()]
			.sort(([, left], [, right]) => right.updatedAt - left.updatedAt || right.runId.localeCompare(left.runId))
			.slice(0, MAX_REPLAYED_FOREGROUND_RUNS),
	);
}
