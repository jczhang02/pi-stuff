import { type JsonObject, type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import {
	isFiniteRuntimeNumber as isFiniteNumber,
	isRuntimeBoolean,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { resolveEffectiveThinking } from "../../shared/model-info.ts";
import { readBoundedOwnedFile } from "../../shared/private-directory.ts";
import type { AsyncStatus, NestedRunSummary } from "../../shared/types.ts";
import { getErrorMessage, isNotFoundError } from "../../shared/utils.ts";
import {
	parseSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
} from "../shared/capability-ceiling.ts";
import {
	attachRootChildrenToSteps,
	nestedWorkIncludesUser,
	sanitizeCost,
	sanitizeSummary,
	sanitizeToolBudget,
	sanitizeTurnBudget,
} from "../shared/nested-events.ts";
import type { BackgroundTaskResult } from "../shared/parallel-utils.ts";
import type { CompletionNotification } from "./notify.ts";
import type { BackgroundCompletion } from "./runner-state.ts";

export const MAX_ASYNC_RESULT_BYTES = 32 * 1024 * 1024;

type ResultModelAttempt = NonNullable<BackgroundTaskResult["modelAttempts"]>[number];

export interface AsyncResultChild extends Partial<BackgroundTaskResult> {
	state?: string;
	children?: NestedRunSummary[];
}

export type AsyncResultFile = Partial<Omit<BackgroundCompletion, "mode" | "results" | "sessionId" | "state">> & {
	agent?: string;
	mode?: string;
	state?: string;
	sessionId?: string;
	model?: string;
	thinking?: string;
	launchContractDigest?: string;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	exitCode?: number | null;
	results?: AsyncResultChild[];
};

export type ResultFileChild = Partial<BackgroundTaskResult> & {
	state?: string;
	children?: JsonValue;
};

export type ResultFileData = CompletionNotification & {
	runId?: string;
	mode?: string;
	results?: ResultFileChild[];
	nestedChildren?: JsonValue;
	asyncDir?: string;
	intercomTarget?: string;
};

export const COMPLETION_FIELDS = [
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

export const RESULT_CHILD_FIELDS = [
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

export function pickFields<Source extends object, Key extends keyof Source>(
	source: Source,
	fields: readonly Key[],
): Partial<Pick<Source, Key>> {
	const picked: Partial<Pick<Source, Key>> = {};
	for (const field of fields) {
		if (source[field] !== undefined) picked[field] = source[field];
	}
	return picked;
}

export function sanitizeNestedResultChildren(
	value: JsonValue | undefined,
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

function resultObject(value: JsonValue, resultPath: string, field?: string): JsonObject {
	if (value && isRuntimeObject(value) && !Array.isArray(value)) return value;
	throw invalidResult(resultPath, field ? `${field} must be an object` : "expected an object");
}

function invalidResult(resultPath: string, message: string): Error {
	return new Error(`Invalid async result file '${resultPath}': ${message}.`);
}

function parseUsage(value: JsonValue, resultPath: string, field: string): NonNullable<ResultModelAttempt["usage"]> {
	const usage = resultObject(value, resultPath, field);
	const input = usage["input"];
	const output = usage["output"];
	const cacheRead = usage["cacheRead"];
	const cacheWrite = usage["cacheWrite"];
	const cost = usage["cost"];
	const turns = usage["turns"];
	if (
		!isFiniteNumber(input) ||
		!isFiniteNumber(output) ||
		!isFiniteNumber(cacheRead) ||
		!isFiniteNumber(cacheWrite) ||
		!isFiniteNumber(cost) ||
		!isFiniteNumber(turns)
	) {
		throw invalidResult(resultPath, `${field} is malformed`);
	}
	return { input, output, cacheRead, cacheWrite, cost, turns };
}

function parseModelAttempt(value: JsonValue, resultPath: string, field: string): ResultModelAttempt {
	const raw = resultObject(value, resultPath, field);
	const model = raw["model"];
	const success = raw["success"];
	if (!isRuntimeString(model)) throw invalidResult(resultPath, `${field}.model must be a string`);
	if (!isRuntimeBoolean(success)) throw invalidResult(resultPath, `${field}.success must be a boolean`);
	const attempt: ResultModelAttempt = { model, success };
	const exitCode = raw["exitCode"];
	if (exitCode !== undefined) {
		if (exitCode !== null && !isFiniteNumber(exitCode)) {
			throw invalidResult(resultPath, `${field}.exitCode must be a finite number or null`);
		}
		attempt.exitCode = exitCode;
	}
	const error = raw["error"];
	if (error !== undefined) {
		if (!isRuntimeString(error)) throw invalidResult(resultPath, `${field}.error must be a string`);
		attempt.error = error;
	}
	if (raw["usage"] !== undefined) attempt.usage = parseUsage(raw["usage"], resultPath, `${field}.usage`);
	return attempt;
}

function parseResultChild(value: JsonValue, resultPath: string, index: number): AsyncResultChild {
	const raw = resultObject(value, resultPath, `results[${index}]`);
	const child: AsyncResultChild = {};
	for (const field of [
		"agent",
		"state",
		"error",
		"sessionFile",
		"intercomTarget",
		"model",
		"thinking",
		"transcriptPath",
		"transcriptError",
		"launchContractDigest",
	] as const) {
		const fieldValue = raw[field];
		if (fieldValue === undefined) continue;
		if (!isRuntimeString(fieldValue)) {
			throw invalidResult(resultPath, `results[${index}].${field} must be a string`);
		}
		child[field] = fieldValue;
	}
	for (const field of [
		"success",
		"interrupted",
		"stopped",
		"timedOut",
		"turnBudgetExceeded",
		"wrapUpRequested",
		"toolBudgetBlocked",
	] as const) {
		const fieldValue = raw[field];
		if (fieldValue === undefined) continue;
		if (!isRuntimeBoolean(fieldValue)) {
			throw invalidResult(resultPath, `results[${index}].${field} must be a boolean`);
		}
		child[field] = fieldValue;
	}
	const exitCode = raw["exitCode"];
	if (exitCode !== undefined) {
		if (exitCode !== null && !isFiniteNumber(exitCode)) {
			throw invalidResult(resultPath, `results[${index}].exitCode must be a finite number or null`);
		}
		child.exitCode = exitCode;
	}
	const attemptedModels = raw["attemptedModels"];
	if (attemptedModels !== undefined) {
		if (!Array.isArray(attemptedModels) || !attemptedModels.every(isRuntimeString)) {
			throw invalidResult(resultPath, `results[${index}].attemptedModels must contain strings`);
		}
		child.attemptedModels = [...attemptedModels];
	}
	const turnBudget = sanitizeTurnBudget(raw["turnBudget"]);
	if (raw["turnBudget"] !== undefined && !turnBudget) {
		throw invalidResult(resultPath, `results[${index}].turnBudget is malformed`);
	}
	if (turnBudget) child.turnBudget = turnBudget;
	const toolBudget = sanitizeToolBudget(raw["toolBudget"]);
	if (raw["toolBudget"] !== undefined && !toolBudget) {
		throw invalidResult(resultPath, `results[${index}].toolBudget is malformed`);
	}
	if (toolBudget) child.toolBudget = toolBudget;
	const totalCost = sanitizeCost(raw["totalCost"]);
	if (raw["totalCost"] !== undefined && !totalCost) {
		throw invalidResult(resultPath, `results[${index}].totalCost is malformed`);
	}
	if (totalCost) child.totalCost = totalCost;
	const modelAttempts = raw["modelAttempts"];
	if (modelAttempts !== undefined) {
		if (!Array.isArray(modelAttempts)) {
			throw invalidResult(resultPath, `results[${index}].modelAttempts must be an array`);
		}
		child.modelAttempts = modelAttempts.map((attempt, attemptIndex) =>
			parseModelAttempt(attempt, resultPath, `results[${index}].modelAttempts[${attemptIndex}]`),
		);
	}
	if (raw["capabilityCeiling"] !== undefined) {
		child.capabilityCeiling = parseSubagentCapabilityCeiling(
			raw["capabilityCeiling"],
			`async result file '${resultPath}' results[${index}].capabilityCeiling`,
		);
	}
	if (Array.isArray(raw["children"])) {
		const children = raw["children"]
			.map(sanitizeSummary)
			.filter((entry): entry is NestedRunSummary => Boolean(entry));
		if (children.length) child.children = children;
	}
	return child;
}

export function parseAsyncResultFile(value: JsonValue, resultPath: string): AsyncResultFile {
	const raw = resultObject(value, resultPath);
	const result: AsyncResultFile = {};
	for (const field of [
		"id",
		"runId",
		"agent",
		"mode",
		"state",
		"cwd",
		"sessionId",
		"sessionFile",
		"model",
		"thinking",
		"launchContractDigest",
	] as const) {
		const fieldValue = raw[field];
		if (fieldValue === undefined) continue;
		if (!isRuntimeString(fieldValue)) throw invalidResult(resultPath, `${field} must be a string`);
		result[field] = fieldValue;
	}
	if (raw["success"] !== undefined) {
		if (!isRuntimeBoolean(raw["success"])) throw invalidResult(resultPath, "success must be a boolean");
		result.success = raw["success"];
	}
	if (raw["capabilityCeiling"] !== undefined) {
		result.capabilityCeiling = parseSubagentCapabilityCeiling(
			raw["capabilityCeiling"],
			`async result file '${resultPath}' capabilityCeiling`,
		);
	}
	if (raw["parentRunOrigin"] === "automatic" || raw["parentRunOrigin"] === "user") {
		result.parentRunOrigin = raw["parentRunOrigin"];
	}
	for (const field of ["startedAt", "endedAt"] as const) {
		const timestamp = raw[field];
		if (isFiniteNumber(timestamp) && timestamp >= 0) result[field] = timestamp;
	}
	const exitCode = raw["exitCode"];
	if (exitCode === null || isFiniteNumber(exitCode)) result.exitCode = exitCode;
	if (raw["timedOut"] === true) result.timedOut = true;
	if (raw["results"] !== undefined) {
		if (!Array.isArray(raw["results"])) throw invalidResult(resultPath, "results must be an array");
		result.results = raw["results"].map((entry, index) => parseResultChild(entry, resultPath, index));
	}
	if (Array.isArray(raw["nestedChildren"])) {
		result.nestedChildren = raw["nestedChildren"]
			.map(sanitizeSummary)
			.filter((entry): entry is NestedRunSummary => Boolean(entry));
	}
	return result;
}

interface ResultRepairData {
	parentRunOrigin?: AsyncStatus["parentRunOrigin"];
	state: "complete" | "failed" | "paused" | "stopped";
	startedAt?: number;
	endedAt?: number;
	timedOut?: boolean;
	results?: AsyncResultChild[];
	nestedChildren?: NestedRunSummary[];
}

function readResultRepairData(
	resultPath: string,
	expectedRunId: string,
	resultContent?: string,
): ResultRepairData | undefined {
	try {
		const data = parseAsyncResultFile(
			parseJsonValue(resultContent ?? readBoundedOwnedFile(resultPath, MAX_ASYNC_RESULT_BYTES)),
			resultPath,
		);
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
		const repair: ResultRepairData = { state };
		if (data.parentRunOrigin) repair.parentRunOrigin = data.parentRunOrigin;
		if (data.startedAt !== undefined) repair.startedAt = data.startedAt;
		if (data.endedAt !== undefined) repair.endedAt = data.endedAt;
		if (data.timedOut === true || data.results?.some((child) => child.timedOut === true)) repair.timedOut = true;
		if (data.results) repair.results = data.results;
		if (data.nestedChildren) repair.nestedChildren = data.nestedChildren;
		return repair;
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw new Error(`Failed to read async result file '${resultPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
}

function childState(
	overallState: ResultRepairData["state"],
	child: AsyncResultChild | undefined,
): "complete" | "failed" | "paused" | "stopped" {
	if (child?.stopped === true) return "stopped";
	if (child?.interrupted === true) return "paused";
	if (child?.success === true) return "complete";
	if (child?.success === false) return "failed";
	return overallState;
}

export function terminalStatusFromResult(
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
	const terminalStatus: AsyncStatus = {
		...status,
		startedAt: repair.startedAt ?? status.startedAt,
		state: repair.state,
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
	if (parentRunOrigin) terminalStatus.parentRunOrigin = parentRunOrigin;
	if (
		status.lifecycleArtifactVersion === 3 &&
		(!status.processTerminal || status.processTerminal.state === "pending")
	) {
		terminalStatus.processTerminal = {
			version: 1,
			state: "unknown",
			runId: status.runId,
			runnerProcessInstanceId: "observer-unavailable",
			reason: "observer-unavailable",
		};
	}
	return terminalStatus;
}
