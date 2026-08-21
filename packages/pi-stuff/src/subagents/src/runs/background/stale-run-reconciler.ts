import * as fs from "node:fs";
import * as path from "node:path";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";
import { writeAtomicJson } from "../../shared/atomic-json.ts";
import { resolveEffectiveThinking } from "../../shared/model-info.ts";
import { readBoundedOwnedFile } from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import { tryAcquireStatusMutationClaim } from "../../shared/status-mutation.ts";
import {
	type AsyncParallelGroupStatus,
	type AsyncStatus,
	type NestedRunSummary,
	RESULTS_DIR,
	type SubagentRunMode,
} from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import {
	attachRootChildrenToSteps,
	type NestedRoute,
	nestedSummaryFromAsyncStatus,
	nestedWorkIncludesUser,
	projectNestedEvents,
	resolveNestedAsyncDir,
	sanitizeSummary,
	writeNestedEvent,
} from "../shared/nested-events.ts";
import { normalizeParallelGroups } from "./parallel-groups.ts";
import {
	persistRecoveredProcessTerminal,
	processTerminalPath,
	processTerminalResumeDisposition,
	readProcessTerminal,
} from "./process-terminal.ts";
import { terminateOrphanWriterProcesses } from "./writer-process-registry.ts";

export type PidLiveness = "alive" | "dead" | "unknown";

type KillFn = (pid: number, signal?: NodeJS.Signals | 0) => boolean;

const MAX_RESULT_FILE_BYTES = 32 * 1024 * 1024;

interface StartedRunMetadata {
	runId: string;
	pid?: number;
	sessionId?: string;
	mode?: SubagentRunMode;
	agents?: string[];
	parallelGroups?: AsyncParallelGroupStatus[];
	startedAt?: number;
	sessionFile?: string;
	nestedRoute?: AsyncStatus["nestedRoute"];
}

interface ReconcileAsyncRunOptions {
	resultsDir?: string;
	kill?: KillFn;
	now?: () => number;
	startedRun?: StartedRunMetadata;
	missingStatusGraceMs?: number;
	staleAlivePidMs?: number;
	readProcessStartIdentity?: (pid: number) => string | undefined;
	runnerTerminationGraceMs?: number;
}

interface ReconcileAsyncRunResult {
	status: AsyncStatus | null;
	repaired: boolean;
	resultPath?: string;
	message?: string;
}

function getErrorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function readRunnerStartupDiagnostics(asyncDir: string): string | undefined {
	const stderrPath = path.join(asyncDir, "runner.stderr.log");
	const maxBytes = 64 * 1024;
	let content: string;
	try {
		const stat = fs.statSync(stderrPath);
		if (stat.size <= 0) return undefined;
		const fd = fs.openSync(stderrPath, "r");
		try {
			const bytesToRead = Math.min(stat.size, maxBytes);
			const start = Math.max(0, stat.size - bytesToRead);
			const buffer = Buffer.alloc(bytesToRead);
			fs.readSync(fd, buffer, 0, bytesToRead, start);
			content = buffer.toString("utf-8").trim();
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
	if (!content) return undefined;
	const lines = content.split(/\r?\n/).slice(-30).join("\n");
	return lines.length > 4000 ? `${lines.slice(-4000)}\n[stderr tail truncated]` : lines;
}

function isNotFoundError(cause: unknown): boolean {
	return (
		isRuntimeObject(cause) && cause !== null && "code" in cause && (cause as NodeJS.ErrnoException).code === "ENOENT"
	);
}

function safeRunId(value: unknown): value is string {
	return (
		isRuntimeString(value) &&
		value.length > 0 &&
		value.trim() === value &&
		!path.isAbsolute(value) &&
		!/[\\/]/.test(value) &&
		!value.includes("..")
	);
}

function safeDirectory(directory: string): boolean {
	try {
		const stat = fs.lstatSync(directory);
		return stat.isDirectory() && !stat.isSymbolicLink();
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

function safeRegularFile(root: string, target: string, label: string, maxBytes: number): "missing" | "present" {
	const resolvedRoot = path.resolve(root);
	const resolvedTarget = path.resolve(target);
	if (path.dirname(resolvedTarget) !== resolvedRoot) {
		throw new Error(`${label} '${target}' is not a direct child of '${root}'.`);
	}
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(resolvedTarget);
	} catch (error) {
		if (isNotFoundError(error)) return "missing";
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) {
		throw new Error(`${label} '${target}' is not a safe bounded regular file.`);
	}
	let rootStat: fs.Stats;
	try {
		rootStat = fs.lstatSync(resolvedRoot);
	} catch (error) {
		if (isNotFoundError(error)) return "missing";
		throw error;
	}
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		throw new Error(`${label} root '${root}' is not a safe directory.`);
	}
	if (path.dirname(fs.realpathSync(resolvedTarget)) !== fs.realpathSync(resolvedRoot)) {
		throw new Error(`${label} '${target}' escapes its storage root.`);
	}
	return "present";
}

function appendJsonlBestEffort<Payload extends object>(filePath: string, payload: Payload): void {
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
	} catch {
		// Repair status/result writes are the important path. A broken or full
		// diagnostic event log must not make stale-run reconciliation fail.
	}
}

function readStatusFile(asyncDir: string): AsyncStatus | null {
	return readStatus(asyncDir);
}

interface ResultChildOutcome {
	agent?: string;
	success?: boolean;
	exitCode?: number | null;
	error?: string;
	interrupted?: boolean;
	stopped?: boolean;
	timedOut?: boolean;
	turnBudget?: NonNullable<AsyncStatus["steps"]>[number]["turnBudget"];
	turnBudgetExceeded?: boolean;
	wrapUpRequested?: boolean;
	toolBudget?: NonNullable<AsyncStatus["steps"]>[number]["toolBudget"];
	toolBudgetBlocked?: boolean;
	sessionFile?: string;
	model?: string;
	thinking?: string;
	attemptedModels?: string[];
	modelAttempts?: NonNullable<AsyncStatus["steps"]>[number]["modelAttempts"];
	totalCost?: NonNullable<AsyncStatus["steps"]>[number]["totalCost"];
	transcriptPath?: string;
	transcriptError?: string;
	children?: NestedRunSummary[];
}

interface ResultRepairData {
	parentRunOrigin?: AsyncStatus["parentRunOrigin"];
	state: "complete" | "failed" | "paused" | "stopped";
	startedAt?: number;
	endedAt?: number;
	timedOut?: boolean;
	results?: ResultChildOutcome[];
	nestedChildren?: NestedRunSummary[];
}

function finiteTimestamp(value: unknown): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readResultRepairData(
	resultPath: string,
	expectedRunId: string,
	resultContent?: string,
): ResultRepairData | undefined {
	try {
		const data = JSON.parse(resultContent ?? readBoundedOwnedFile(resultPath, MAX_RESULT_FILE_BYTES)) as {
			id?: unknown;
			runId?: unknown;
			success?: boolean;
			state?: string;
			exitCode?: number;
			startedAt?: number;
			endedAt?: number;
			timedOut?: boolean;
			parentRunOrigin?: unknown;
			results?: unknown;
			nestedChildren?: unknown;
		};
		if (
			(data.id !== undefined && data.id !== expectedRunId) ||
			(data.runId !== undefined && data.runId !== expectedRunId)
		) {
			throw new Error(`Async result file '${resultPath}' does not match run '${expectedRunId}'.`);
		}
		const state = data.success
			? "complete"
			: data.state === "stopped"
				? "stopped"
				: data.state === "paused" || data.exitCode === 0
					? "paused"
					: "failed";
		const results = Array.isArray(data.results)
			? data.results.map((entry, index) => {
					if (!entry || !isRuntimeObject(entry) || Array.isArray(entry)) return {};
					const child = entry as ResultChildOutcome;
					if (child.model !== undefined && !isRuntimeString(child.model))
						throw new Error(
							`Invalid async result file '${resultPath}': results[${index}].model must be a string.`,
						);
					if (child.thinking !== undefined && !isRuntimeString(child.thinking))
						throw new Error(
							`Invalid async result file '${resultPath}': results[${index}].thinking must be a string.`,
						);
					const children = Array.isArray((entry as { children?: unknown }).children)
						? (entry as { children: unknown[] }).children
								.map((nested) => sanitizeSummary(nested))
								.filter((nested): nested is NestedRunSummary => Boolean(nested))
						: undefined;
					return { ...child, ...(children?.length ? { children } : {}) };
				})
			: undefined;
		const nestedChildren = Array.isArray(data.nestedChildren)
			? data.nestedChildren
					.map((child) => sanitizeSummary(child))
					.filter((child): child is NestedRunSummary => Boolean(child))
			: undefined;
		return {
			...(data.parentRunOrigin === "automatic" || data.parentRunOrigin === "user"
				? { parentRunOrigin: data.parentRunOrigin }
				: {}),
			state,
			...(finiteTimestamp(data.startedAt) !== undefined ? { startedAt: finiteTimestamp(data.startedAt) } : {}),
			...(finiteTimestamp(data.endedAt) !== undefined ? { endedAt: finiteTimestamp(data.endedAt) } : {}),
			...(data.timedOut === true || results?.some((child) => child.timedOut === true) ? { timedOut: true } : {}),
			...(results ? { results } : {}),
			...(nestedChildren ? { nestedChildren } : {}),
		};
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw new Error(`Failed to read async result file '${resultPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
}

function childState(
	overallState: ResultRepairData["state"],
	child: ResultChildOutcome | undefined,
): "complete" | "failed" | "paused" | "stopped" {
	if (child?.stopped === true) return "stopped";
	if (child?.interrupted === true) return "paused";
	if (child?.success === true) return "complete";
	if (child?.success === false) return "failed";
	return overallState;
}

function terminalStatusFromResult(
	status: AsyncStatus,
	resultPath: string,
	runId: string,
	now: number,
	resultContent?: string,
): AsyncStatus | undefined {
	const repair = readResultRepairData(resultPath, runId, resultContent);
	if (!repair) return undefined;
	const endedAt = repair.endedAt ?? now;
	const steps = (status.steps ?? []).map((step, index) => {
		if (step.status !== "running" && step.status !== "pending") return step;
		const child = repair.results?.[index];
		const state = childState(repair.state, child);
		const model = child?.model ?? step.model;
		const thinking = resolveEffectiveThinking(model, child?.thinking ?? step.thinking);
		return {
			...step,
			status: state === "complete" ? ("complete" as const) : state,
			endedAt: step.endedAt ?? endedAt,
			durationMs:
				step.startedAt !== undefined && step.durationMs === undefined
					? Math.max(0, endedAt - step.startedAt)
					: step.durationMs,
			exitCode: child?.exitCode ?? step.exitCode ?? (state === "complete" ? 0 : 1),
			error: child?.error ?? step.error,
			stopped: state === "stopped" ? true : undefined,
			timedOut: child?.timedOut === true ? true : undefined,
			turnBudget: child?.turnBudget ?? step.turnBudget,
			turnBudgetExceeded: child?.turnBudgetExceeded === true ? true : undefined,
			wrapUpRequested: child?.wrapUpRequested === true ? true : undefined,
			toolBudget: child?.toolBudget ?? step.toolBudget,
			toolBudgetBlocked: child?.toolBudgetBlocked === true ? true : undefined,
			sessionFile: step.sessionFile ?? child?.sessionFile,
			model,
			thinking,
			attemptedModels: child?.attemptedModels ?? step.attemptedModels,
			modelAttempts: child?.modelAttempts ?? step.modelAttempts,
			totalCost: child?.totalCost ?? step.totalCost,
			transcriptPath: child?.transcriptPath ?? step.transcriptPath,
			transcriptError: child?.transcriptError ?? step.transcriptError,
			children: child?.children ?? step.children,
			activityState: undefined,
			currentTool: undefined,
			currentToolArgs: undefined,
			currentToolStartedAt: undefined,
			currentPath: undefined,
		};
	});
	if (repair.nestedChildren !== undefined) attachRootChildrenToSteps(runId, steps, repair.nestedChildren);
	const stateDrivingFailure =
		repair.state === "failed"
			? repair.results?.find((child) => !child.success && !child.stopped && !child.interrupted)
			: repair.state === "stopped"
				? repair.results?.find((child) => child.stopped)
				: repair.state === "paused"
					? repair.results?.find((child) => child.interrupted)
					: undefined;
	const error = stateDrivingFailure?.error ?? repair.results?.find((child) => child.error)?.error;
	const parentRunOrigin =
		status.parentRunOrigin === "user" ||
		repair.parentRunOrigin === "user" ||
		nestedWorkIncludesUser(repair.nestedChildren)
			? "user"
			: (status.parentRunOrigin ?? repair.parentRunOrigin);
	return {
		...status,
		...(parentRunOrigin ? { parentRunOrigin } : {}),
		startedAt: repair.startedAt ?? status.startedAt,
		state: repair.state,
		...(status.lifecycleArtifactVersion === 3 &&
		(!status.processTerminal || status.processTerminal.state === "pending")
			? {
					processTerminal: {
						version: 1 as const,
						state: "unknown" as const,
						runId: status.runId,
						runnerProcessInstanceId: "observer-unavailable",
						reason: "observer-unavailable" as const,
					},
				}
			: {}),
		error: repair.state === "complete" ? undefined : (error ?? status.error),
		stopped: repair.state === "stopped" ? true : undefined,
		timedOut: repair.timedOut === true ? true : undefined,
		activityState: undefined,
		currentTool: undefined,
		currentToolStartedAt: undefined,
		currentPath: undefined,
		lastUpdate: endedAt,
		endedAt: status.endedAt ?? endedAt,
		steps,
	};
}

/**
 * Make a committed semantic result durable in status.json before a result
 * watcher is allowed to delete the delivery artifact. Returns undefined while
 * either artifact is missing so the caller can retain and retry the result.
 */
export function repairTerminalStatusFromResult(
	asyncDir: string,
	resultPath: string,
	now = Date.now(),
	resultContent?: string,
): AsyncStatus | undefined {
	if (!safeDirectory(asyncDir)) return undefined;
	const claim = tryAcquireStatusMutationClaim(asyncDir);
	if (!claim) return undefined;
	try {
		const status = readStatusFile(asyncDir);
		if (!status) return undefined;
		const runId = path.basename(asyncDir);
		if (!safeRunId(runId) || status.runId !== runId || path.basename(resultPath) !== `${runId}.json`) {
			throw new Error(`Async result/status identity does not match run directory '${runId}'.`);
		}
		if (
			resultContent === undefined &&
			safeRegularFile(path.dirname(resultPath), resultPath, "Async result file", MAX_RESULT_FILE_BYTES) === "missing"
		) {
			return undefined;
		}
		if (status.lifecycleArtifactVersion === 3) {
			const proof = readProcessTerminal(asyncDir, {
				runId,
				runnerProcessInstanceId: status.processTerminal?.runnerProcessInstanceId,
			});
			if (proof?.state !== "observed") return status;
			if (status.state !== "running" && status.state !== "queued") {
				if (status.processTerminal?.state === "observed") return status;
				const finalized = { ...status, processTerminal: proof };
				writeAtomicJson(path.join(asyncDir, "status.json"), finalized);
				return finalized;
			}
			const terminalStatus = terminalStatusFromResult(status, resultPath, runId, now, resultContent);
			if (!terminalStatus) return undefined;
			const finalized = { ...terminalStatus, processTerminal: proof };
			writeAtomicJson(path.join(asyncDir, "status.json"), finalized);
			return finalized;
		}
		if (status.state !== "running" && status.state !== "queued") return status;
		const terminalStatus = terminalStatusFromResult(status, resultPath, runId, now, resultContent);
		if (!terminalStatus) return undefined;
		writeAtomicJson(path.join(asyncDir, "status.json"), terminalStatus);
		return terminalStatus;
	} finally {
		claim.release();
	}
}

function buildStartedStatus(asyncDir: string, startedRun: StartedRunMetadata, now: number): AsyncStatus {
	const startedAt = startedRun.startedAt ?? now;
	const agents = startedRun.agents?.length ? startedRun.agents : ["subagent"];
	const parallelGroups = normalizeParallelGroups(startedRun.parallelGroups, agents.length);
	return {
		runId: startedRun.runId || path.basename(asyncDir),
		...(startedRun.sessionId ? { sessionId: startedRun.sessionId } : {}),
		mode: startedRun.mode ?? (agents.length > 1 ? "parallel" : "single"),
		...(startedRun.nestedRoute ? { nestedRoute: startedRun.nestedRoute } : {}),
		state: "running",
		pid: startedRun.pid,
		startedAt,
		lastUpdate: now,
		currentStep: 0,
		...(parallelGroups.length ? { parallelGroups } : {}),
		steps: agents.map((agent) => ({
			agent,
			status: "running" as const,
			startedAt,
		})),
		...(startedRun.sessionFile ? { sessionFile: startedRun.sessionFile } : {}),
	};
}

function buildFailedRepair(status: AsyncStatus, asyncDir: string, now: number, reason?: string) {
	const runId = status.runId || path.basename(asyncDir);
	const pid = isRuntimeNumber(status.pid) ? status.pid : "unknown";
	const baseMessage =
		reason ??
		`Async runner process ${pid} exited or disappeared before writing a result. Marked run failed by stale-run reconciliation.`;
	const diagnostics = readRunnerStartupDiagnostics(asyncDir);
	const message = diagnostics ? `${baseMessage}\n\nRunner stderr tail:\n${diagnostics}` : baseMessage;
	const steps = status.steps?.length ? status.steps : [{ agent: "subagent", status: "running" as const }];
	const repairedSteps = steps.map((step) =>
		step.status === "running" || step.status === "pending"
			? {
					...step,
					status: "failed" as const,
					activityState: undefined,
					currentTool: undefined,
					currentToolArgs: undefined,
					currentToolStartedAt: undefined,
					currentPath: undefined,
					endedAt: step.endedAt ?? now,
					durationMs:
						step.startedAt !== undefined && step.durationMs === undefined
							? Math.max(0, now - step.startedAt)
							: step.durationMs,
					exitCode: step.exitCode ?? 1,
					error: step.error ?? message,
				}
			: step,
	);
	const repairedStatus: AsyncStatus = {
		...status,
		state: "failed",
		...(status.lifecycleArtifactVersion === 3 &&
		(!status.processTerminal || status.processTerminal.state === "pending")
			? {
					processTerminal: {
						version: 1 as const,
						state: "unknown" as const,
						runId,
						runnerProcessInstanceId: "observer-unavailable",
						reason: "stale-repair" as const,
					},
				}
			: {}),
		activityState: undefined,
		currentTool: undefined,
		currentToolStartedAt: undefined,
		currentPath: undefined,
		lastUpdate: now,
		endedAt: now,
		steps: repairedSteps,
	};
	const resultAgent = repairedSteps[status.currentStep ?? 0]?.agent ?? repairedSteps[0]?.agent ?? "subagent";
	return {
		status: repairedStatus,
		message,
		result: {
			id: runId,
			...(status.parentRunOrigin ? { parentRunOrigin: status.parentRunOrigin } : {}),
			agent: resultAgent,
			mode: status.mode,
			success: false,
			state: "failed",
			summary: message,
			results: repairedSteps.map((step) => ({
				agent: step.agent,
				output: step.status === "complete" || step.status === "completed" ? "" : message,
				error: step.status === "complete" || step.status === "completed" ? undefined : (step.error ?? message),
				success: step.status === "complete" || step.status === "completed",
				model: step.model,
				attemptedModels: step.attemptedModels,
				modelAttempts: step.modelAttempts,
				sessionFile: step.sessionFile,
			})),
			exitCode: 1,
			timestamp: now,
			durationMs: Math.max(0, now - status.startedAt),
			asyncDir,
			sessionId: status.sessionId,
			sessionFile: status.sessionFile,
		},
	};
}

function writeFailedRepair(
	asyncDir: string,
	status: AsyncStatus,
	resultPath: string,
	now: number,
	reason?: string,
): ReconcileAsyncRunResult {
	const repair = buildFailedRepair(status, asyncDir, now, reason);
	if (repair.status.lifecycleArtifactVersion === 3) {
		// Persist the physical proof against the semantic state we are about to
		// commit. Building it from the stale running status would incorrectly mark a
		// recoverable failed session as unavailable.
		const proof = persistRecoveredProcessTerminal(asyncDir, repair.status, now);
		repair.status = { ...repair.status, processTerminal: proof };
	}
	writeAtomicJson(resultPath, repair.result);
	writeAtomicJson(path.join(asyncDir, "status.json"), repair.status);
	appendJsonlBestEffort(path.join(asyncDir, "events.jsonl"), {
		type: "subagent.run.repaired_stale",
		ts: now,
		runId: repair.status.runId,
		pid: status.pid,
		resultPath,
		message: repair.message,
	});
	return { status: repair.status, repaired: true, resultPath, message: repair.message };
}

function terminal(state: AsyncStatus["state"]): boolean {
	return state === "complete" || state === "failed" || state === "paused" || state === "stopped";
}

function alignProcessTerminalWithStatus(
	asyncDir: string,
	proof: NonNullable<AsyncStatus["processTerminal"]>,
	status: AsyncStatus,
): NonNullable<AsyncStatus["processTerminal"]> {
	const resumeDisposition = processTerminalResumeDisposition(status.state, status.sessionFile);
	if (proof.resumeDisposition === resumeDisposition) return proof;
	const aligned = { ...proof, resumeDisposition };
	writeAtomicJson(processTerminalPath(asyncDir), aligned);
	return aligned;
}

function* nestedRuns(children: NestedRunSummary[] | undefined): Generator<NestedRunSummary> {
	for (const child of children ?? []) {
		yield child;
		yield* nestedRuns(child.children);
		yield* nestedRuns(child.steps?.flatMap((step) => step.children ?? []));
	}
}

export function reconcileNestedAsyncDescendants(route: NestedRoute, options: ReconcileAsyncRunOptions = {}): void {
	const registry = projectNestedEvents(route);
	for (const run of nestedRuns(registry.children)) {
		if (run.state !== "running" && run.state !== "queued") continue;
		const asyncDir = resolveNestedAsyncDir(route.rootRunId, run);
		if (!asyncDir) continue;
		const result = reconcileAsyncRun(asyncDir, {
			...options,
			resultsDir: path.join(options.resultsDir ?? RESULTS_DIR, "nested", route.rootRunId),
		});
		const status = result.status;
		if (!status) continue;
		if (!result.repaired && !terminal(status.state)) continue;
		const ts = options.now?.() ?? Date.now();
		writeNestedEvent(route, {
			type: terminal(status.state) ? "subagent.nested.completed" : "subagent.nested.updated",
			ts,
			parentRunId: run.parentRunId,
			parentStepIndex: run.parentStepIndex,
			child: nestedSummaryFromAsyncStatus(status, asyncDir, {
				id: run.id,
				parentRunId: run.parentRunId,
				parentStepIndex: run.parentStepIndex,
				depth: run.depth,
				path: run.path,
				mode: run.mode,
				ts,
			}),
		});
	}
}

export function checkPidLiveness(pid: number, kill: KillFn = process.kill): PidLiveness {
	try {
		kill(pid, 0);
		return "alive";
	} catch (error) {
		const code =
			isRuntimeObject(error) && error !== null && "code" in error
				? (error as NodeJS.ErrnoException).code
				: undefined;
		if (code === "ESRCH") return "dead";
		if (code === "EPERM") return "unknown";
		return "unknown";
	}
}

export function reconcileAsyncRun(asyncDir: string, options: ReconcileAsyncRunOptions = {}): ReconcileAsyncRunResult {
	if (!safeDirectory(asyncDir)) return { status: null, repaired: false };
	const claim = tryAcquireStatusMutationClaim(asyncDir);
	if (!claim) {
		return {
			status: readStatusFile(asyncDir) ?? null,
			repaired: false,
			message: `Agent lifecycle status for '${path.basename(asyncDir)}' is being updated; recovery will retry.`,
		};
	}
	try {
		return reconcileAsyncRunWithStatusClaim(asyncDir, options);
	} finally {
		claim.release();
	}
}

function reconcileAsyncRunWithStatusClaim(
	asyncDir: string,
	options: ReconcileAsyncRunOptions,
): ReconcileAsyncRunResult {
	const now = options.now?.() ?? Date.now();
	const status = readStatusFile(asyncDir);
	const startedStatus =
		!status && options.startedRun ? buildStartedStatus(asyncDir, options.startedRun, now) : undefined;
	const effectiveStatus = status ?? startedStatus;
	if (!effectiveStatus) return { status: null, repaired: false };
	const statusPath = path.join(asyncDir, "status.json");
	for (const [index, step] of (effectiveStatus.steps ?? []).entries()) {
		const stepRecord = step as Record<string, unknown>;
		if (stepRecord.model !== undefined && !isRuntimeString(stepRecord.model))
			throw new Error(`Invalid async status file '${statusPath}': steps[${index}].model must be a string.`);
		if (stepRecord.thinking !== undefined && !isRuntimeString(stepRecord.thinking))
			throw new Error(`Invalid async status file '${statusPath}': steps[${index}].thinking must be a string.`);
	}

	const runId = path.basename(asyncDir);
	if (!safeRunId(runId) || effectiveStatus.runId !== runId) {
		throw new Error(`Async status runId must exactly match its directory '${runId}'.`);
	}
	const resultsDir = options.resultsDir ?? RESULTS_DIR;
	const resultPath = path.join(resultsDir, `${runId}.json`);
	const resultPresent =
		safeRegularFile(resultsDir, resultPath, "Async result file", MAX_RESULT_FILE_BYTES) === "present";
	let durableProcessTerminal =
		effectiveStatus.lifecycleArtifactVersion === 3
			? readProcessTerminal(asyncDir, {
					runId,
					runnerProcessInstanceId: effectiveStatus.processTerminal?.runnerProcessInstanceId,
				})
			: undefined;
	if (durableProcessTerminal?.state === "observed" && terminal(effectiveStatus.state)) {
		durableProcessTerminal = alignProcessTerminalWithStatus(asyncDir, durableProcessTerminal, effectiveStatus);
		const finalized = { ...effectiveStatus, processTerminal: durableProcessTerminal };
		const changed = JSON.stringify(effectiveStatus.processTerminal) !== JSON.stringify(durableProcessTerminal);
		if (changed) writeAtomicJson(statusPath, finalized);
		return {
			status: finalized,
			repaired: changed,
			resultPath: resultPresent ? resultPath : undefined,
			...(changed ? { message: "Merged durable Agent process-terminal proof into terminal status." } : {}),
		};
	}
	if (resultPresent) {
		const terminalStatus =
			effectiveStatus.state === "running" || effectiveStatus.state === "queued"
				? effectiveStatus.lifecycleArtifactVersion !== 3 || durableProcessTerminal?.state === "observed"
					? terminalStatusFromResult(effectiveStatus, resultPath, runId, now)
					: undefined
				: undefined;
		if (terminalStatus) {
			const alignedProof = durableProcessTerminal
				? alignProcessTerminalWithStatus(asyncDir, durableProcessTerminal, terminalStatus)
				: undefined;
			const finalized = alignedProof ? { ...terminalStatus, processTerminal: alignedProof } : terminalStatus;
			writeAtomicJson(path.join(asyncDir, "status.json"), finalized);
			return {
				status: finalized,
				repaired: true,
				resultPath,
				message: "Existing async result file was used to repair stale running status.",
			};
		}
		if (effectiveStatus.lifecycleArtifactVersion !== 3 || durableProcessTerminal?.state === "observed") {
			return {
				status:
					durableProcessTerminal && effectiveStatus.processTerminal?.state !== "observed"
						? { ...effectiveStatus, processTerminal: durableProcessTerminal }
						: effectiveStatus,
				repaired: false,
				resultPath,
			};
		}
	}

	const needsProcessRecovery =
		effectiveStatus.lifecycleArtifactVersion === 3 && durableProcessTerminal?.state !== "observed";
	if ((!needsProcessRecovery && effectiveStatus.state !== "running") || !isRuntimeNumber(effectiveStatus.pid)) {
		return { status: status ?? null, repaired: false, resultPath };
	}

	if (!status) {
		const startedAt = options.startedRun?.startedAt ?? effectiveStatus.startedAt;
		if (now - startedAt < (options.missingStatusGraceMs ?? 1000)) {
			return { status: null, repaired: false, resultPath };
		}
	}

	let liveness = checkPidLiveness(effectiveStatus.pid, options.kill);
	if (liveness === "alive") {
		const currentIdentity = (options.readProcessStartIdentity ?? readProcessStartIdentity)(effectiveStatus.pid);
		if (!effectiveStatus.processStartIdentity || !currentIdentity) {
			return {
				status: status ?? null,
				repaired: false,
				resultPath,
				message: `Runner '${runId}' has a live PID, but its process identity cannot be proven; retaining the run.`,
			};
		}
		if (currentIdentity !== effectiveStatus.processStartIdentity) liveness = "dead";
	}
	if (liveness === "unknown") {
		return {
			status: status ?? null,
			repaired: false,
			resultPath,
			message: `Runner '${runId}' process liveness is unknown; retaining the run.`,
		};
	}
	if (liveness === "alive") {
		const staleAfterMs = options.staleAlivePidMs ?? 24 * 60 * 60 * 1000;
		const lastUpdate = effectiveStatus.lastUpdate ?? effectiveStatus.startedAt;
		if (now - lastUpdate <= staleAfterMs) return { status: status ?? null, repaired: false, resultPath };
		const requestedAt = effectiveStatus.runnerTerminationRequestedAt;
		if (requestedAt === undefined) {
			const identityBeforeTerm = (options.readProcessStartIdentity ?? readProcessStartIdentity)(effectiveStatus.pid);
			if (identityBeforeTerm !== effectiveStatus.processStartIdentity) {
				const currentLiveness = checkPidLiveness(effectiveStatus.pid, options.kill);
				if (identityBeforeTerm === undefined && currentLiveness !== "dead") {
					return {
						status: status ?? null,
						repaired: false,
						resultPath,
						message: `Runner '${runId}' identity became unverifiable before SIGTERM; retaining the run.`,
					};
				}
				liveness = "dead";
			}
			try {
				if (liveness !== "dead") (options.kill ?? process.kill)(effectiveStatus.pid, "SIGTERM");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") liveness = "dead";
				else {
					return {
						status: status ?? null,
						repaired: false,
						resultPath,
						message: `Unable to terminate stale runner '${runId}'; retaining the run.`,
					};
				}
			}
			if (liveness !== "dead") {
				const terminatingStatus = { ...effectiveStatus, runnerTerminationRequestedAt: now };
				writeAtomicJson(statusPath, terminatingStatus);
				return {
					status: terminatingStatus,
					repaired: false,
					resultPath,
					message: `Requested graceful termination of stale runner '${runId}'.`,
				};
			}
		} else if (now - requestedAt < (options.runnerTerminationGraceMs ?? 2_000)) {
			return {
				status: status ?? null,
				repaired: false,
				resultPath,
				message: `Waiting for stale runner '${runId}' to exit after SIGTERM.`,
			};
		} else {
			const identityBeforeKill = (options.readProcessStartIdentity ?? readProcessStartIdentity)(effectiveStatus.pid);
			if (identityBeforeKill !== effectiveStatus.processStartIdentity) {
				const currentLiveness = checkPidLiveness(effectiveStatus.pid, options.kill);
				if (identityBeforeKill === undefined && currentLiveness !== "dead") {
					return {
						status: status ?? null,
						repaired: false,
						resultPath,
						message: `Runner '${runId}' identity became unverifiable before SIGKILL; retaining the run.`,
					};
				}
				liveness = "dead";
			}
			try {
				if (liveness !== "dead") (options.kill ?? process.kill)(effectiveStatus.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					return {
						status: status ?? null,
						repaired: false,
						resultPath,
						message: `Unable to kill stale runner '${runId}'; retaining the run.`,
					};
				}
			}
			const afterKill = liveness === "dead" ? "dead" : checkPidLiveness(effectiveStatus.pid, options.kill);
			const afterIdentity =
				afterKill === "alive"
					? (options.readProcessStartIdentity ?? readProcessStartIdentity)(effectiveStatus.pid)
					: undefined;
			if (
				afterKill !== "dead" &&
				!(afterKill === "alive" && afterIdentity && afterIdentity !== effectiveStatus.processStartIdentity)
			) {
				return {
					status: status ?? null,
					repaired: false,
					resultPath,
					message: `Stale runner '${runId}' has not exited after SIGKILL; retaining the run.`,
				};
			}
			liveness = "dead";
		}
	}

	const writers = terminateOrphanWriterProcesses(asyncDir, options.kill);
	if (writers.remaining > 0) {
		return {
			status: status ?? null,
			repaired: false,
			resultPath,
			message: `Runner '${runId}' exited, but ${writers.remaining} writer process(es) remain live or unverifiable; the run stays active and counted.`,
		};
	}
	// The runner may commit its semantic result while liveness/reaping checks are
	// in progress. Re-read the exact result now, immediately before any synthetic
	// failure could overwrite it, and always prefer a valid semantic result.
	const latestResultPresent =
		safeRegularFile(resultsDir, resultPath, "Async result file", MAX_RESULT_FILE_BYTES) === "present";
	if (latestResultPresent) {
		const semantic =
			effectiveStatus.state === "running" || effectiveStatus.state === "queued"
				? terminalStatusFromResult(effectiveStatus, resultPath, runId, now)
				: effectiveStatus;
		if (!semantic) return { status: effectiveStatus, repaired: false, resultPath };
		if (effectiveStatus.lifecycleArtifactVersion === 3) {
			durableProcessTerminal = persistRecoveredProcessTerminal(asyncDir, semantic, now);
		}
		const finalized = durableProcessTerminal ? { ...semantic, processTerminal: durableProcessTerminal } : semantic;
		writeAtomicJson(path.join(asyncDir, "status.json"), finalized);
		return {
			status: finalized,
			repaired: true,
			resultPath,
			message: durableProcessTerminal
				? "Recovered terminal Agent process proof after confirming runner and writers were gone."
				: "A concurrently committed Agent result was used instead of stale failure repair.",
		};
	}
	if (effectiveStatus.lifecycleArtifactVersion === 3 && terminal(effectiveStatus.state)) {
		durableProcessTerminal = persistRecoveredProcessTerminal(asyncDir, effectiveStatus, now);
	}
	if (durableProcessTerminal && terminal(effectiveStatus.state)) {
		const finalized = { ...effectiveStatus, processTerminal: durableProcessTerminal };
		writeAtomicJson(path.join(asyncDir, "status.json"), finalized);
		return { status: finalized, repaired: true, resultPath };
	}
	return writeFailedRepair(asyncDir, effectiveStatus, resultPath, now);
}
