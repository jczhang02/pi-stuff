import * as fs from "node:fs";
import * as path from "node:path";
import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import type { AgentConfig } from "../../agents/agents.ts";
import { readBoundedOwnedFile, validateOwnedRegularFile } from "../../shared/private-directory.ts";
import { type SessionCompatibilityScope, sessionArtifactMatches } from "../../shared/session-identity.ts";
import {
	type ArtifactConfig,
	ASYNC_DIR,
	type AsyncStatus,
	RESULTS_DIR,
	type ResolvedControlConfig,
} from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import {
	intersectSubagentCapabilityCeilings,
	parseSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
} from "../shared/capability-ceiling.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import { MAX_MODEL_CANDIDATES_PER_CHILD } from "../shared/model-fallback.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { resolveTurnBudgetConfig } from "../shared/turn-budget.ts";
import type { BackgroundRecoveryDescriptor } from "./async-execution.ts";
import { reconcileAsyncRun } from "./stale-run-reconciler.ts";

export type LegacyRecoveryDescriptor = Omit<BackgroundRecoveryDescriptor, "version" | "childIndex" | "context"> & {
	version: 1;
};
export type AsyncRecoveryDescriptor = LegacyRecoveryDescriptor | BackgroundRecoveryDescriptor;

export interface AsyncResumeParams {
	id?: string;
	runId?: string;
	dir?: string;
	index?: number;
}

export interface AsyncResumeDeps {
	asyncDirRoot?: string;
	resultsDir?: string;
	kill?: (pid: number, signal?: NodeJS.Signals | 0) => boolean;
	now?: () => number;
}

export interface AsyncResumeOptions {
	requireSessionFile?: boolean;
	sessionId?: string;
	sessionScope?: SessionCompatibilityScope;
}

const MAX_RECOVERY_DESCRIPTOR_BYTES = 2 * 1024 * 1024;
const MAX_ASYNC_RESULT_BYTES = 32 * 1024 * 1024;

export type AsyncResumeTarget = {
	kind: "live" | "revive";
	runId: string;
	asyncDir?: string;
	state: AsyncStatus["state"];
	agent: string;
	index: number;
	cwd?: string;
	sessionFile?: string;
	model?: string;
	thinking?: string;
	context?: ContextMode;
	recoveryDescriptor?: AsyncRecoveryDescriptor;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	launchContractDigest?: string;
};

interface AsyncResultFile {
	id?: string;
	runId?: string;
	agent?: string;
	mode?: string;
	state?: string;
	success?: boolean;
	cwd?: string;
	sessionId?: string;
	sessionFile?: string;
	model?: string;
	thinking?: string;
	launchContractDigest?: string;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	results?: Array<{
		agent?: string;
		success?: boolean;
		state?: string;
		interrupted?: boolean;
		stopped?: boolean;
		sessionFile?: string;
		intercomTarget?: string;
		model?: string;
		thinking?: string;
		launchContractDigest?: string;
		capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	}>;
}

export interface AsyncRunLocation {
	asyncDir: string | null;
	resultPath: string | null;
	resolvedId?: string;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function ensureObject(value: unknown, source: string): Record<string, unknown> {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) {
		throw new Error(`Async result file '${source}' must contain a JSON object.`);
	}
	return value as Record<string, unknown>;
}

function validateOptionalString(
	value: Record<string, unknown>,
	field: string,
	source: string,
	displayField = field,
): string | undefined {
	const fieldValue = value[field];
	if (fieldValue === undefined) return undefined;
	if (!isRuntimeString(fieldValue))
		throw new Error(`Invalid async result file '${source}': ${displayField} must be a string.`);
	return fieldValue;
}

function validateResultFile(value: unknown, resultPath: string): AsyncResultFile {
	const data = ensureObject(value, resultPath);
	const resultsValue = data.results;
	let results: AsyncResultFile["results"];
	if (resultsValue !== undefined) {
		if (!Array.isArray(resultsValue))
			throw new Error(`Invalid async result file '${resultPath}': results must be an array.`);
		results = resultsValue.map((entry, index) => {
			const child = ensureObject(entry, `${resultPath} results[${index}]`);
			const agent = validateOptionalString(child, "agent", resultPath, `results[${index}].agent`);
			const sessionFile = validateOptionalString(child, "sessionFile", resultPath, `results[${index}].sessionFile`);
			const intercomTarget = validateOptionalString(
				child,
				"intercomTarget",
				resultPath,
				`results[${index}].intercomTarget`,
			);
			const model = validateOptionalString(child, "model", resultPath, `results[${index}].model`);
			const thinking = validateOptionalString(child, "thinking", resultPath, `results[${index}].thinking`);
			const launchContractDigest = validateOptionalString(
				child,
				"launchContractDigest",
				resultPath,
				`results[${index}].launchContractDigest`,
			);
			const capabilityCeiling =
				child.capabilityCeiling === undefined
					? undefined
					: parseSubagentCapabilityCeiling(
							child.capabilityCeiling,
							`async result file '${resultPath}' results[${index}].capabilityCeiling`,
						);
			const success = child.success;
			if (success !== undefined && !isRuntimeBoolean(success))
				throw new Error(`Invalid async result file '${resultPath}': results[${index}].success must be a boolean.`);
			const interrupted = child.interrupted;
			if (interrupted !== undefined && !isRuntimeBoolean(interrupted)) {
				throw new Error(
					`Invalid async result file '${resultPath}': results[${index}].interrupted must be a boolean.`,
				);
			}
			const stopped = child.stopped;
			if (stopped !== undefined && !isRuntimeBoolean(stopped)) {
				throw new Error(`Invalid async result file '${resultPath}': results[${index}].stopped must be a boolean.`);
			}
			return {
				agent,
				state: validateOptionalString(child, "state", resultPath, `results[${index}].state`),
				sessionFile,
				intercomTarget,
				model,
				thinking,
				launchContractDigest,
				...(capabilityCeiling ? { capabilityCeiling } : {}),
				...(isRuntimeBoolean(success) ? { success } : {}),
				...(isRuntimeBoolean(interrupted) ? { interrupted } : {}),
				...(isRuntimeBoolean(stopped) ? { stopped } : {}),
			};
		});
	}
	const success = data.success;
	if (success !== undefined && !isRuntimeBoolean(success))
		throw new Error(`Invalid async result file '${resultPath}': success must be a boolean.`);
	return {
		id: validateOptionalString(data, "id", resultPath),
		runId: validateOptionalString(data, "runId", resultPath),
		agent: validateOptionalString(data, "agent", resultPath),
		mode: validateOptionalString(data, "mode", resultPath),
		state: validateOptionalString(data, "state", resultPath),
		cwd: validateOptionalString(data, "cwd", resultPath),
		sessionId: validateOptionalString(data, "sessionId", resultPath),
		sessionFile: validateOptionalString(data, "sessionFile", resultPath),
		model: validateOptionalString(data, "model", resultPath),
		thinking: validateOptionalString(data, "thinking", resultPath),
		launchContractDigest: validateOptionalString(data, "launchContractDigest", resultPath),
		...(data.capabilityCeiling === undefined
			? {}
			: {
					capabilityCeiling: parseSubagentCapabilityCeiling(
						data.capabilityCeiling,
						`async result file '${resultPath}' capabilityCeiling`,
					),
				}),
		...(isRuntimeBoolean(success) ? { success } : {}),
		...(results ? { results } : {}),
	};
}

function readResultFile(resultPath: string): AsyncResultFile {
	let raw: string;
	try {
		raw = readBoundedOwnedFile(resultPath, MAX_ASYNC_RESULT_BYTES);
	} catch (error) {
		throw new Error(`Failed to read async result file '${resultPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
	try {
		return validateResultFile(JSON.parse(raw), resultPath);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Failed to parse async result file '${resultPath}': ${getErrorMessage(error)}`, {
				cause: error,
			});
		}
		throw error;
	}
}

function assertRunId(value: string | undefined, field: "id" | "runId"): string | undefined {
	if (value === undefined) return undefined;
	if (value.trim() === "") throw new Error(`${field} must not be empty.`);
	if (path.isAbsolute(value) || /[\\/]/.test(value) || value.includes("..")) {
		throw new Error(`${field} must be an async run id or prefix, not a path.`);
	}
	return value;
}

function assertInsideRoot(root: string, target: string, label: string): void {
	const rootPath = path.resolve(root);
	const targetPath = path.resolve(target);
	const relative = path.relative(rootPath, targetPath);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
	throw new Error(`${label} must be inside ${rootPath}.`);
}

function isNotFoundError(error: unknown): boolean {
	return isRuntimeObject(error) && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isSafeDirectEntry(root: string, target: string, kind: "directory" | "file"): boolean {
	assertInsideRoot(root, target, kind === "directory" ? "Async run directory" : "Async result file");
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(target);
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
	if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) return false;
	const canonicalRoot = fs.realpathSync(root);
	const canonicalTarget = fs.realpathSync(target);
	return path.dirname(canonicalTarget) === canonicalRoot;
}

function prefixedRunIds(dir: string, prefix: string, suffix = ""): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter(
			(entry) =>
				entry.startsWith(prefix) &&
				(!suffix || entry.endsWith(suffix)) &&
				isSafeDirectEntry(dir, path.join(dir, entry), suffix ? "file" : "directory"),
		)
		.map((entry) => (suffix ? entry.slice(0, -suffix.length) : entry))
		.sort();
}

function exactResultPath(resultsDir: string, runId: string): string | null {
	const resultPath = path.join(resultsDir, `${runId}.json`);
	assertInsideRoot(resultsDir, resultPath, "Async result file");
	return isSafeDirectEntry(resultsDir, resultPath, "file") ? resultPath : null;
}

export function findAsyncRunPrefixMatches(
	prefix: string,
	asyncDirRoot: string,
	resultsDir: string,
	session?: string | SessionCompatibilityScope,
): Array<{ id: string; location: AsyncRunLocation }> {
	const requestedId = assertRunId(prefix, "id");
	if (!requestedId) return [];
	const asyncRoot = path.resolve(asyncDirRoot);
	const resultRoot = path.resolve(resultsDir);
	const matchingIds = [
		...new Set([...prefixedRunIds(asyncRoot, requestedId), ...prefixedRunIds(resultRoot, requestedId, ".json")]),
	].sort();
	return matchingIds.flatMap((id) => {
		const asyncDir = path.join(asyncRoot, id);
		assertInsideRoot(asyncRoot, asyncDir, "Async run directory");
		const location = {
			asyncDir: isSafeDirectEntry(asyncRoot, asyncDir, "directory") ? asyncDir : null,
			resultPath: exactResultPath(resultRoot, id),
			resolvedId: id,
		};
		if (session !== undefined) {
			let storedSessionId: string | undefined;
			try {
				storedSessionId = location.asyncDir ? readStatus(location.asyncDir)?.sessionId : undefined;
			} catch {
				// A malformed candidate outside the active session cannot make a valid
				// current-session prefix ambiguous.
			}
			if (storedSessionId === undefined && location.resultPath) {
				try {
					storedSessionId = readResultFile(location.resultPath).sessionId;
				} catch {
					// Conservatively exclude unreadable or unowned candidates.
				}
			}
			if (
				isRuntimeString(session)
					? storedSessionId !== session
					: !sessionArtifactMatches(session, storedSessionId, id)
			)
				return [];
		}
		return [
			{
				id,
				location,
			},
		];
	});
}

export function resolveAsyncRunLocation(
	params: AsyncResumeParams,
	asyncDirRoot: string,
	resultsDir: string,
): AsyncRunLocation {
	const asyncRoot = path.resolve(asyncDirRoot);
	const resultRoot = path.resolve(resultsDir);
	const requestedId = assertRunId(params.id, "id") ?? assertRunId(params.runId, "runId");
	if (params.dir) {
		const asyncDir = path.resolve(params.dir);
		assertInsideRoot(asyncRoot, asyncDir, "Async run directory");
		if (!isSafeDirectEntry(asyncRoot, asyncDir, "directory")) {
			throw new Error(`Async run directory '${asyncDir}' is not a safe direct child of ${asyncRoot}.`);
		}
		const resolvedId = requestedId ?? path.basename(asyncDir);
		if (requestedId && requestedId !== path.basename(asyncDir)) {
			throw new Error(`Async run id '${requestedId}' does not match directory '${path.basename(asyncDir)}'.`);
		}
		return { asyncDir, resultPath: exactResultPath(resultRoot, resolvedId), resolvedId };
	}
	if (!requestedId) return { asyncDir: null, resultPath: null };

	const directAsyncDir = path.join(asyncRoot, requestedId);
	assertInsideRoot(asyncRoot, directAsyncDir, "Async run directory");
	const directResultPath = exactResultPath(resultRoot, requestedId);
	const directAsyncExists = isSafeDirectEntry(asyncRoot, directAsyncDir, "directory");
	if (directAsyncExists || directResultPath) {
		return {
			asyncDir: directAsyncExists ? directAsyncDir : null,
			resultPath: directResultPath,
			resolvedId: requestedId,
		};
	}

	const matching = findAsyncRunPrefixMatches(requestedId, asyncRoot, resultRoot);
	if (matching.length === 0) return { asyncDir: null, resultPath: null, resolvedId: requestedId };
	if (matching.length > 1) {
		throw new Error(
			`Ambiguous async run id prefix '${requestedId}' matched: ${matching.map((match) => match.id).join(", ")}. Provide a longer id.`,
		);
	}
	const match = matching[0];
	if (!match) return { asyncDir: null, resultPath: null, resolvedId: requestedId };
	return match.location;
}

function resultState(result: AsyncResultFile): AsyncStatus["state"] {
	if (
		result.state === "complete" ||
		result.state === "failed" ||
		result.state === "paused" ||
		result.state === "stopped" ||
		result.state === "running" ||
		result.state === "queued"
	) {
		return result.state;
	}
	return result.success ? "complete" : "failed";
}

function validateStatusForResume(status: AsyncStatus | null, source: string): void {
	if (!status) return;
	if (!isRuntimeString(status.runId)) throw new Error(`Invalid async status '${source}': runId must be a string.`);
	if (status.sessionId !== undefined && !isRuntimeString(status.sessionId))
		throw new Error(`Invalid async status '${source}': sessionId must be a string.`);
	if (status.cwd !== undefined && !isRuntimeString(status.cwd))
		throw new Error(`Invalid async status '${source}': cwd must be a string.`);
	if (status.sessionFile !== undefined && !isRuntimeString(status.sessionFile))
		throw new Error(`Invalid async status '${source}': sessionFile must be a string.`);
	if (status.capabilityCeiling !== undefined)
		status.capabilityCeiling = parseSubagentCapabilityCeiling(
			status.capabilityCeiling,
			`async status '${source}' capabilityCeiling`,
		);
	if (status.steps !== undefined) {
		if (!Array.isArray(status.steps)) throw new Error(`Invalid async status '${source}': steps must be an array.`);
		status.steps.forEach((step, index) => {
			if (!step || !isRuntimeObject(step) || Array.isArray(step))
				throw new Error(`Invalid async status '${source}': steps[${index}] must be an object.`);
			const stepRecord = step as Record<string, unknown>;
			if (!isRuntimeString(stepRecord.agent))
				throw new Error(`Invalid async status '${source}': steps[${index}].agent must be a string.`);
			if (stepRecord.sessionFile !== undefined && !isRuntimeString(stepRecord.sessionFile))
				throw new Error(`Invalid async status '${source}': steps[${index}].sessionFile must be a string.`);
			if (stepRecord.model !== undefined && !isRuntimeString(stepRecord.model))
				throw new Error(`Invalid async status '${source}': steps[${index}].model must be a string.`);
			if (stepRecord.thinking !== undefined && !isRuntimeString(stepRecord.thinking))
				throw new Error(`Invalid async status '${source}': steps[${index}].thinking must be a string.`);
			if (stepRecord.launchContractDigest !== undefined && !isRuntimeString(stepRecord.launchContractDigest))
				throw new Error(`Invalid async status '${source}': steps[${index}].launchContractDigest must be a string.`);
			if (stepRecord.capabilityCeiling !== undefined)
				stepRecord.capabilityCeiling = parseSubagentCapabilityCeiling(
					stepRecord.capabilityCeiling,
					`async status '${source}' steps[${index}].capabilityCeiling`,
				);
		});
	}
}

function parseRecoveryJson(descriptorPath: string): unknown {
	try {
		return JSON.parse(readBoundedOwnedFile(descriptorPath, MAX_RECOVERY_DESCRIPTOR_BYTES));
	} catch (error) {
		throw new Error(`Failed to parse async recovery descriptor '${descriptorPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
}

function recoveryRecord<Value extends object>(value: Value): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value));
}

function recoveryStringArray(value: unknown, field: string, descriptorPath: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((entry) => !isRuntimeString(entry) || !entry.trim())) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': ${field} must contain non-empty strings.`,
		);
	}
	return [...value];
}

function recoveryNonemptyString(value: unknown, field: string, descriptorPath: string): string | undefined {
	if (value === undefined) return undefined;
	if (!isRuntimeString(value) || !value.trim()) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a non-empty string.`);
	}
	return value;
}

function requiredRecoveryString(value: unknown, field: string, descriptorPath: string): string {
	const parsed = recoveryNonemptyString(value, field, descriptorPath);
	if (parsed === undefined) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a non-empty string.`);
	}
	return parsed;
}

function requiredRecoveryBoolean(value: unknown, field: string, descriptorPath: string): boolean {
	if (!isRuntimeBoolean(value)) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a boolean.`);
	}
	return value;
}

function recoveryInteger(value: unknown, field: string, descriptorPath: string, minimum: number): number {
	if (!isRuntimeNumber(value) || !Number.isInteger(value) || value < minimum) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a ${minimum === 0 ? "non-negative" : "positive"} integer.`,
		);
	}
	return value;
}

function validateV2RecoveryDescriptor(value: unknown, descriptorPath: string): BackgroundRecoveryDescriptor {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': expected an object.`);
	}
	const parsed = recoveryRecord(value);
	const allowedFields = new Set([
		"version",
		"sourceRunId",
		"childIndex",
		"launchContractDigest",
		"agent",
		"context",
		"sessionFile",
		"cwd",
		"model",
		"fallbackModels",
		"thinking",
		"tools",
		"extensions",
		"subagentOnlyExtensions",
		"mcpDirectTools",
		"systemPrompt",
		"systemPromptMode",
		"inheritProjectContext",
		"inheritSkills",
		"skills",
		"skillPath",
		"agentFilePath",
		"controlConfig",
		"absoluteDeadlineAt",
		"initialTurnBudget",
		"initialToolBudget",
		"maxSubagentDepth",
		"capabilityCeiling",
		"sessionDir",
		"artifactsDir",
		"artifactConfig",
	]);
	for (const field of Object.keys(parsed)) {
		if (!allowedFields.has(field)) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': unknown field '${field}'.`);
		}
	}
	if (parsed.version !== 2) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': version must be 2.`);
	}
	const sourceRunId = requiredRecoveryString(parsed.sourceRunId, "sourceRunId", descriptorPath);
	const agent = requiredRecoveryString(parsed.agent, "agent", descriptorPath);
	const cwd = requiredRecoveryString(parsed.cwd, "cwd", descriptorPath);
	const childIndex = recoveryInteger(parsed.childIndex, "childIndex", descriptorPath, 0);
	const context = parsed.context;
	if (context !== undefined && context !== "fresh" && context !== "fork") {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': context must be fresh or fork.`);
	}
	const systemPromptMode = parsed.systemPromptMode;
	if (systemPromptMode !== "append" && systemPromptMode !== "replace") {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': systemPromptMode is invalid.`);
	}
	const inheritProjectContext = requiredRecoveryBoolean(
		parsed.inheritProjectContext,
		"inheritProjectContext",
		descriptorPath,
	);
	const inheritSkills = requiredRecoveryBoolean(parsed.inheritSkills, "inheritSkills", descriptorPath);
	const maxSubagentDepth = recoveryInteger(parsed.maxSubagentDepth, "maxSubagentDepth", descriptorPath, 0);
	const fallbackModels = recoveryStringArray(parsed.fallbackModels, "fallbackModels", descriptorPath);
	const tools = recoveryStringArray(parsed.tools, "tools", descriptorPath);
	const extensions = recoveryStringArray(parsed.extensions, "extensions", descriptorPath);
	const subagentOnlyExtensions = recoveryStringArray(
		parsed.subagentOnlyExtensions,
		"subagentOnlyExtensions",
		descriptorPath,
	);
	const mcpDirectTools = recoveryStringArray(parsed.mcpDirectTools, "mcpDirectTools", descriptorPath);
	const skills = recoveryStringArray(parsed.skills, "skills", descriptorPath);
	const skillPath = recoveryStringArray(parsed.skillPath, "skillPath", descriptorPath);
	if (fallbackModels && fallbackModels.length >= MAX_MODEL_CANDIDATES_PER_CHILD) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': fallbackModels must contain fewer than ${MAX_MODEL_CANDIDATES_PER_CHILD} entries.`,
		);
	}
	const systemPrompt = parsed.systemPrompt;
	if (systemPrompt !== undefined && !isRuntimeString(systemPrompt)) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': systemPrompt must be a string.`);
	}
	const launchContractDigest = recoveryNonemptyString(
		parsed.launchContractDigest,
		"launchContractDigest",
		descriptorPath,
	);
	const sessionFile = recoveryNonemptyString(parsed.sessionFile, "sessionFile", descriptorPath);
	const model = recoveryNonemptyString(parsed.model, "model", descriptorPath);
	const thinking = recoveryNonemptyString(parsed.thinking, "thinking", descriptorPath);
	const agentFilePath = recoveryNonemptyString(parsed.agentFilePath, "agentFilePath", descriptorPath);
	const sessionDir = recoveryNonemptyString(parsed.sessionDir, "sessionDir", descriptorPath);
	const artifactsDir = recoveryNonemptyString(parsed.artifactsDir, "artifactsDir", descriptorPath);
	const absoluteDeadlineAt = parsed.absoluteDeadlineAt;
	if (
		absoluteDeadlineAt !== undefined &&
		(!isRuntimeNumber(absoluteDeadlineAt) || !Number.isFinite(absoluteDeadlineAt) || absoluteDeadlineAt <= 0)
	) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': absoluteDeadlineAt must be a positive timestamp.`,
		);
	}
	let initialTurnBudget: BackgroundRecoveryDescriptor["initialTurnBudget"];
	if (parsed.initialTurnBudget !== undefined) {
		const result = resolveTurnBudgetConfig(parsed.initialTurnBudget, "recoveryDescriptor.initialTurnBudget");
		if (result.error) throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${result.error}`);
		initialTurnBudget = result.turnBudget;
	}
	let initialToolBudget: BackgroundRecoveryDescriptor["initialToolBudget"];
	if (parsed.initialToolBudget !== undefined) {
		const result = validateToolBudgetConfig(parsed.initialToolBudget, "recoveryDescriptor.initialToolBudget");
		if (result.error) throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${result.error}`);
		initialToolBudget = result.budget;
	}
	let capabilityCeiling: ResolvedSubagentCapabilityCeiling | undefined;
	if (parsed.capabilityCeiling !== undefined) {
		capabilityCeiling = parseSubagentCapabilityCeiling(
			parsed.capabilityCeiling,
			`async recovery descriptor '${descriptorPath}' capabilityCeiling`,
		);
	}
	let artifactConfig: ArtifactConfig | undefined;
	if (parsed.artifactConfig !== undefined) {
		if (!parsed.artifactConfig || !isRuntimeObject(parsed.artifactConfig) || Array.isArray(parsed.artifactConfig)) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': artifactConfig must be an object.`);
		}
		const artifact = recoveryRecord(parsed.artifactConfig);
		const allowedArtifactFields = new Set([
			"enabled",
			"dir",
			"includeInput",
			"includeOutput",
			"includeJsonl",
			"includeTranscript",
			"includeMetadata",
			"cleanupDays",
		]);
		const unknownArtifactField = Object.keys(artifact).find((field) => !allowedArtifactFields.has(field));
		if (unknownArtifactField) {
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': unknown artifactConfig field '${unknownArtifactField}'.`,
			);
		}
		const artifactEnabled = requiredRecoveryBoolean(artifact.enabled, "artifactConfig.enabled", descriptorPath);
		const includeInput = requiredRecoveryBoolean(
			artifact.includeInput,
			"artifactConfig.includeInput",
			descriptorPath,
		);
		const includeOutput = requiredRecoveryBoolean(
			artifact.includeOutput,
			"artifactConfig.includeOutput",
			descriptorPath,
		);
		const includeJsonl = requiredRecoveryBoolean(
			artifact.includeJsonl,
			"artifactConfig.includeJsonl",
			descriptorPath,
		);
		const includeMetadata = requiredRecoveryBoolean(
			artifact.includeMetadata,
			"artifactConfig.includeMetadata",
			descriptorPath,
		);
		if (artifact.includeTranscript !== undefined && !isRuntimeBoolean(artifact.includeTranscript)) {
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': artifactConfig.includeTranscript must be a boolean.`,
			);
		}
		if (
			artifact.dir !== undefined &&
			artifact.dir !== "project" &&
			artifact.dir !== "session" &&
			artifact.dir !== "temp"
		) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': artifactConfig.dir is invalid.`);
		}
		const cleanupDays = recoveryInteger(artifact.cleanupDays, "artifactConfig.cleanupDays", descriptorPath, 0);
		artifactConfig = {
			cleanupDays,
			enabled: artifactEnabled,
			includeInput,
			includeJsonl,
			includeMetadata,
			includeOutput,
			...(artifact.dir ? { dir: artifact.dir } : {}),
			...(artifact.includeTranscript === undefined ? {} : { includeTranscript: artifact.includeTranscript }),
		};
	}
	let controlConfig: ResolvedControlConfig | undefined;
	if (parsed.controlConfig !== undefined) {
		if (!parsed.controlConfig || !isRuntimeObject(parsed.controlConfig) || Array.isArray(parsed.controlConfig)) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': controlConfig must be an object.`);
		}
		const control = recoveryRecord(parsed.controlConfig);
		const allowedControlFields = new Set([
			"enabled",
			"needsAttentionAfterMs",
			"activeNoticeAfterMs",
			"activeNoticeAfterTurns",
			"activeNoticeAfterTokens",
			"failedToolAttemptsBeforeAttention",
			"notifyOn",
			"notifyChannels",
		]);
		const unknownControlField = Object.keys(control).find((field) => !allowedControlFields.has(field));
		if (unknownControlField) {
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': unknown controlConfig field '${unknownControlField}'.`,
			);
		}
		const controlEnabled = requiredRecoveryBoolean(control.enabled, "controlConfig.enabled", descriptorPath);
		const needsAttentionAfterMs = recoveryInteger(
			control.needsAttentionAfterMs,
			"controlConfig.needsAttentionAfterMs",
			descriptorPath,
			1,
		);
		const activeNoticeAfterMs = recoveryInteger(
			control.activeNoticeAfterMs,
			"controlConfig.activeNoticeAfterMs",
			descriptorPath,
			1,
		);
		const failedToolAttemptsBeforeAttention = recoveryInteger(
			control.failedToolAttemptsBeforeAttention,
			"controlConfig.failedToolAttemptsBeforeAttention",
			descriptorPath,
			1,
		);
		const activeNoticeAfterTurns =
			control.activeNoticeAfterTurns === undefined
				? undefined
				: recoveryInteger(
						control.activeNoticeAfterTurns,
						"controlConfig.activeNoticeAfterTurns",
						descriptorPath,
						1,
					);
		const activeNoticeAfterTokens =
			control.activeNoticeAfterTokens === undefined
				? undefined
				: recoveryInteger(
						control.activeNoticeAfterTokens,
						"controlConfig.activeNoticeAfterTokens",
						descriptorPath,
						1,
					);
		if (
			!Array.isArray(control.notifyOn) ||
			control.notifyOn.some((item) => item !== "active_long_running" && item !== "needs_attention")
		) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': controlConfig.notifyOn is invalid.`);
		}
		if (
			!Array.isArray(control.notifyChannels) ||
			control.notifyChannels.some((item) => item !== "event" && item !== "async" && item !== "intercom")
		) {
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': controlConfig.notifyChannels is invalid.`,
			);
		}
		const notifyOn = control.notifyOn.flatMap((item) =>
			item === "active_long_running" || item === "needs_attention" ? [item] : [],
		);
		const notifyChannels = control.notifyChannels.flatMap((item) =>
			item === "event" || item === "async" || item === "intercom" ? [item] : [],
		);
		controlConfig = {
			activeNoticeAfterMs,
			enabled: controlEnabled,
			failedToolAttemptsBeforeAttention,
			needsAttentionAfterMs,
			notifyChannels,
			notifyOn,
			...(activeNoticeAfterTurns === undefined ? {} : { activeNoticeAfterTurns }),
			...(activeNoticeAfterTokens === undefined ? {} : { activeNoticeAfterTokens }),
		};
	}
	return {
		agent,
		childIndex,
		cwd,
		inheritProjectContext,
		inheritSkills,
		maxSubagentDepth,
		sourceRunId,
		systemPromptMode,
		version: 2,
		...(launchContractDigest ? { launchContractDigest } : {}),
		...(context ? { context } : {}),
		...(sessionFile ? { sessionFile } : {}),
		...(model ? { model } : {}),
		...(fallbackModels ? { fallbackModels } : {}),
		...(thinking ? { thinking } : {}),
		...(tools ? { tools } : {}),
		...(extensions ? { extensions } : {}),
		...(subagentOnlyExtensions ? { subagentOnlyExtensions } : {}),
		...(mcpDirectTools ? { mcpDirectTools } : {}),
		...(systemPrompt === undefined ? {} : { systemPrompt }),
		...(skills ? { skills } : {}),
		...(skillPath ? { skillPath } : {}),
		...(agentFilePath ? { agentFilePath } : {}),
		...(controlConfig ? { controlConfig } : {}),
		...(absoluteDeadlineAt === undefined ? {} : { absoluteDeadlineAt }),
		...(initialTurnBudget ? { initialTurnBudget } : {}),
		...(initialToolBudget ? { initialToolBudget } : {}),
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		...(sessionDir ? { sessionDir } : {}),
		...(artifactsDir ? { artifactsDir } : {}),
		...(artifactConfig ? { artifactConfig } : {}),
	};
}

export function readAsyncRecoveryDescriptor(
	asyncDir: string | undefined,
	childIndex?: number,
): AsyncRecoveryDescriptor | undefined {
	if (!asyncDir) return undefined;
	const collectionPath = path.join(asyncDir, "recovery-descriptors.json");
	let descriptorPath = path.join(asyncDir, "recovery-descriptor.json");
	let value: unknown;
	if (fs.existsSync(collectionPath)) {
		const collection = parseRecoveryJson(collectionPath);
		if (!collection || !isRuntimeObject(collection) || Array.isArray(collection)) {
			throw new Error(`Invalid async recovery descriptor '${collectionPath}': expected an object.`);
		}
		const wrapper = collection as Record<string, unknown>;
		if (wrapper.version !== 2 || !Array.isArray(wrapper.children)) {
			throw new Error(
				`Invalid async recovery descriptor '${collectionPath}': expected version 2 with a children array.`,
			);
		}
		for (const field of Object.keys(wrapper)) {
			if (field !== "version" && field !== "children") {
				throw new Error(`Invalid async recovery descriptor '${collectionPath}': unknown field '${field}'.`);
			}
		}
		if (childIndex === undefined) {
			if (wrapper.children.length !== 1) return undefined;
			value = wrapper.children[0];
		} else {
			value = wrapper.children.find(
				(child) =>
					Boolean(child) &&
					isRuntimeObject(child) &&
					!Array.isArray(child) &&
					(child as Record<string, unknown>).childIndex === childIndex,
			);
			if (value === undefined) {
				throw new Error(`Invalid async recovery descriptor '${collectionPath}': child ${childIndex} is missing.`);
			}
		}
		descriptorPath = `${collectionPath} children[${childIndex ?? 0}]`;
	} else {
		if (!fs.existsSync(descriptorPath)) return undefined;
		value = parseRecoveryJson(descriptorPath);
	}
	if (!value || !isRuntimeObject(value) || Array.isArray(value))
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': expected an object.`);
	const parsed = value as Record<string, unknown>;
	if (parsed.version === 2) {
		const descriptor = validateV2RecoveryDescriptor(parsed, descriptorPath);
		if (childIndex !== undefined && descriptor.childIndex !== childIndex) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': expected childIndex ${childIndex}.`);
		}
		return descriptor;
	}
	const allowedFields = new Set([
		"version",
		"launchContractDigest",
		"sourceRunId",
		"agentContract",
		"agent",
		"sessionFile",
		"cwd",
		"model",
		"fallbackModels",
		"thinking",
		"tools",
		"extensions",
		"subagentOnlyExtensions",
		"mcpDirectTools",
		"systemPrompt",
		"systemPromptMode",
		"inheritProjectContext",
		"inheritSkills",
		"skills",
		"skillPath",
		"agentFilePath",
		"completionGuard",
		"outputPath",
		"outputMode",
		"structuredOutputSchema",
		"acceptance",
		"sessionDir",
		"artifactConfig",
		"artifactsDir",
		"maxOutput",
		"controlConfig",
		"absoluteDeadlineAt",
		"initialTurnBudget",
		"initialToolBudget",
		"maxSubagentDepth",
		"capabilityCeiling",
	]);
	for (const field of Object.keys(parsed)) {
		if (!allowedFields.has(field))
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': unknown field '${field}'.`);
	}
	const requiredStrings = ["sourceRunId", "agent", "cwd", "systemPromptMode"] as const;
	for (const field of requiredStrings) {
		if (!isRuntimeString(parsed[field]) || !(parsed[field] as string).trim())
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a non-empty string.`);
	}
	if (parsed.version !== 1)
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': version must be 1.`);
	if (parsed.capabilityCeiling !== undefined)
		parsed.capabilityCeiling = parseSubagentCapabilityCeiling(
			parsed.capabilityCeiling,
			`async recovery descriptor '${descriptorPath}' capabilityCeiling`,
		);
	if (parsed.systemPromptMode !== "append" && parsed.systemPromptMode !== "replace")
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': systemPromptMode is invalid.`);
	for (const field of ["inheritProjectContext", "inheritSkills"] as const) {
		if (!isRuntimeBoolean(parsed[field]))
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a boolean.`);
	}
	if (!Number.isInteger(parsed.maxSubagentDepth) || (parsed.maxSubagentDepth as number) < 0)
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': maxSubagentDepth must be a non-negative integer.`,
		);
	for (const field of [
		"fallbackModels",
		"tools",
		"extensions",
		"subagentOnlyExtensions",
		"mcpDirectTools",
		"skills",
		"skillPath",
	] as const) {
		const item = parsed[field];
		if (
			item !== undefined &&
			(!Array.isArray(item) || item.some((entry) => !isRuntimeString(entry) || !entry.trim()))
		)
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': ${field} must contain non-empty strings.`,
			);
	}
	if (Array.isArray(parsed.fallbackModels) && parsed.fallbackModels.length >= MAX_MODEL_CANDIDATES_PER_CHILD) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': fallbackModels must contain fewer than ${MAX_MODEL_CANDIDATES_PER_CHILD} entries.`,
		);
	}
	if (parsed.systemPrompt !== undefined && !isRuntimeString(parsed.systemPrompt))
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': systemPrompt must be a string.`);
	for (const field of [
		"launchContractDigest",
		"sessionFile",
		"model",
		"thinking",
		"agentFilePath",
		"sessionDir",
		"artifactsDir",
	] as const) {
		if (parsed[field] !== undefined && (!isRuntimeString(parsed[field]) || !(parsed[field] as string).trim()))
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a non-empty string.`);
	}
	if (
		parsed.absoluteDeadlineAt !== undefined &&
		(!Number.isFinite(parsed.absoluteDeadlineAt) || (parsed.absoluteDeadlineAt as number) <= 0)
	)
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': absoluteDeadlineAt must be a positive timestamp.`,
		);
	if (parsed.initialTurnBudget !== undefined) {
		const result = resolveTurnBudgetConfig(parsed.initialTurnBudget, "recoveryDescriptor.initialTurnBudget");
		if (result.error) throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${result.error}`);
	}
	if (parsed.initialToolBudget !== undefined) {
		const result = validateToolBudgetConfig(parsed.initialToolBudget, "recoveryDescriptor.initialToolBudget");
		if (result.error) throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${result.error}`);
	}
	if (parsed.artifactConfig !== undefined) {
		if (!parsed.artifactConfig || !isRuntimeObject(parsed.artifactConfig) || Array.isArray(parsed.artifactConfig))
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': artifactConfig must be an object.`);
		const artifact = parsed.artifactConfig as Record<string, unknown>;
		for (const field of ["enabled", "includeInput", "includeOutput", "includeJsonl", "includeMetadata"] as const) {
			if (!isRuntimeBoolean(artifact[field]))
				throw new Error(
					`Invalid async recovery descriptor '${descriptorPath}': artifactConfig.${field} must be a boolean.`,
				);
		}
		if (artifact.includeTranscript !== undefined && !isRuntimeBoolean(artifact.includeTranscript))
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': artifactConfig.includeTranscript must be a boolean.`,
			);
		if (!Number.isInteger(artifact.cleanupDays) || (artifact.cleanupDays as number) < 0)
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': artifactConfig.cleanupDays must be a non-negative integer.`,
			);
	}
	if (parsed.controlConfig !== undefined) {
		if (!parsed.controlConfig || !isRuntimeObject(parsed.controlConfig) || Array.isArray(parsed.controlConfig))
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': controlConfig must be an object.`);
		const control = parsed.controlConfig as Record<string, unknown>;
		if (!isRuntimeBoolean(control.enabled))
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': controlConfig.enabled must be a boolean.`,
			);
		for (const field of [
			"needsAttentionAfterMs",
			"activeNoticeAfterMs",
			"failedToolAttemptsBeforeAttention",
		] as const) {
			if (!Number.isInteger(control[field]) || (control[field] as number) < 1)
				throw new Error(
					`Invalid async recovery descriptor '${descriptorPath}': controlConfig.${field} must be a positive integer.`,
				);
		}
		for (const field of ["activeNoticeAfterTurns", "activeNoticeAfterTokens"] as const) {
			if (control[field] !== undefined && (!Number.isInteger(control[field]) || (control[field] as number) < 1))
				throw new Error(
					`Invalid async recovery descriptor '${descriptorPath}': controlConfig.${field} must be a positive integer.`,
				);
		}
		if (
			!Array.isArray(control.notifyOn) ||
			control.notifyOn.some((item) => item !== "active_long_running" && item !== "needs_attention")
		)
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': controlConfig.notifyOn is invalid.`);
		if (
			!Array.isArray(control.notifyChannels) ||
			control.notifyChannels.some((item) => item !== "event" && item !== "async" && item !== "intercom")
		)
			throw new Error(
				`Invalid async recovery descriptor '${descriptorPath}': controlConfig.notifyChannels is invalid.`,
			);
	}
	return parsed as LegacyRecoveryDescriptor;
}

function validateResumeSessionFile(runId: string, sessionFile: string): string {
	if (path.extname(sessionFile) !== ".jsonl")
		throw new Error(`Async run '${runId}' session file must be a .jsonl file: ${sessionFile}`);
	try {
		return validateOwnedRegularFile(sessionFile);
	} catch (error) {
		if (isNotFoundError(error)) {
			throw new Error(`Async run '${runId}' session file does not exist: ${sessionFile}`, { cause: error });
		}
		throw new Error(`Async run '${runId}' session file is not a safe regular file: ${sessionFile}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
}

function readResumeStatus(asyncDir: string): AsyncStatus | null {
	return readStatus(asyncDir);
}

export function resolveAsyncResumeTarget(
	params: AsyncResumeParams,
	deps: AsyncResumeDeps = {},
	options: AsyncResumeOptions = {},
): AsyncResumeTarget {
	const asyncDirRoot = deps.asyncDirRoot ?? ASYNC_DIR;
	const resultsDir = deps.resultsDir ?? RESULTS_DIR;
	const requireSessionFile = options.requireSessionFile ?? true;
	const location = resolveAsyncRunLocation(params, asyncDirRoot, resultsDir);
	if (!location.asyncDir && !location.resultPath) {
		throw new Error("Async run not found. Provide id or dir.");
	}

	// Establish immutable session ownership from safe, read-only records before
	// stale reconciliation is allowed to signal a process or rewrite status.
	const storedStatus = location.asyncDir ? readResumeStatus(location.asyncDir) : null;
	const result = location.resultPath ? readResultFile(location.resultPath) : undefined;
	const expectedRunId =
		location.resolvedId ??
		(location.asyncDir
			? path.basename(location.asyncDir)
			: location.resultPath
				? path.basename(location.resultPath, ".json")
				: undefined);
	if (!expectedRunId) throw new Error("Async run identity could not be established from its storage location.");
	for (const [field, value] of [
		["status.runId", storedStatus?.runId],
		["result.runId", result?.runId],
		["result.id", result?.id],
	] as const) {
		if (value !== undefined && value !== expectedRunId) {
			throw new Error(`Async run '${expectedRunId}' has mismatched ${field} '${value}'.`);
		}
	}
	const storedRunId = storedStatus?.runId ?? result?.runId ?? result?.id ?? expectedRunId;
	const recordMatchesSession = (sessionId: unknown): boolean =>
		options.sessionScope
			? sessionArtifactMatches(options.sessionScope, sessionId, storedRunId)
			: !options.sessionId || sessionId === options.sessionId;
	if (
		(options.sessionId || options.sessionScope) &&
		((storedStatus && !recordMatchesSession(storedStatus.sessionId)) ||
			(result && !recordMatchesSession(result.sessionId)) ||
			(!storedStatus && !result))
	) {
		throw new Error(`Async run '${storedRunId}' was not found in the active session.`);
	}
	const reconciliation = location.asyncDir
		? reconcileAsyncRun(location.asyncDir, { resultsDir, kill: deps.kill, now: deps.now })
		: undefined;
	const status = reconciliation?.status ?? storedStatus;
	validateStatusForResume(status, location.asyncDir ? path.join(location.asyncDir, "status.json") : "status.json");
	const recoveryDescriptor = readAsyncRecoveryDescriptor(location.asyncDir ?? undefined, params.index);
	const runId = status?.runId ?? storedRunId;
	if (recoveryDescriptor && recoveryDescriptor.sourceRunId !== runId)
		throw new Error(`Async run '${runId}' has a recovery descriptor for a different source run.`);
	const state = status?.state ?? (result ? resultState(result) : undefined);
	if (!state) throw new Error(`Status file not found for async run '${runId}'.`);

	const statusSteps = status?.steps ?? [];
	const resultSteps = result?.results ?? [];
	const stepCount = statusSteps.length || resultSteps.length || (result?.agent ? 1 : 0);
	const requestedIndex = params.index;
	if (requestedIndex !== undefined && !Number.isInteger(requestedIndex))
		throw new Error(`Async run '${runId}' index must be an integer.`);
	const terminalStepStatuses = new Set(["complete", "completed", "failed", "paused"]);

	if (state === "running") {
		if (requestedIndex !== undefined) {
			if (requestedIndex < 0 || requestedIndex >= stepCount)
				throw new Error(`Async run '${runId}' has ${stepCount} children. Index ${requestedIndex} is out of range.`);
			const selectedStep = statusSteps[requestedIndex];
			if (selectedStep?.status === "running") {
				const capabilityCeiling = intersectSubagentCapabilityCeilings(
					status?.capabilityCeiling,
					selectedStep.capabilityCeiling,
				);
				return {
					kind: "live",
					runId,
					asyncDir: location.asyncDir ?? undefined,
					state,
					agent: selectedStep.agent,
					index: requestedIndex,
					cwd: recoveryDescriptor?.cwd ?? status?.cwd ?? result?.cwd,
					sessionFile: selectedStep.sessionFile ?? status?.sessionFile ?? result?.sessionFile,
					model: selectedStep.model,
					thinking: selectedStep.thinking,
					...(recoveryDescriptor?.version === 2 && recoveryDescriptor.context
						? { context: recoveryDescriptor.context }
						: {}),
					launchContractDigest:
						selectedStep.launchContractDigest ??
						result?.results?.[requestedIndex]?.launchContractDigest ??
						result?.launchContractDigest ??
						recoveryDescriptor?.launchContractDigest,
					...(capabilityCeiling ? { capabilityCeiling } : {}),
					...(recoveryDescriptor ? { recoveryDescriptor } : {}),
				};
			}
			if (selectedStep?.status === "pending")
				throw new Error(
					`Async run '${runId}' child ${requestedIndex} is pending and has not started yet. Wait for it to run or complete before resuming.`,
				);
			if (selectedStep && !terminalStepStatuses.has(selectedStep.status))
				throw new Error(
					`Async run '${runId}' child ${requestedIndex} is ${selectedStep.status} and cannot be revived yet.`,
				);
		} else {
			const running = statusSteps
				.map((step, index) => ({ step, index }))
				.filter(({ step }) => step.status === "running");
			const selected = running.length === 1 ? running[0] : undefined;
			if (!selected) {
				throw new Error(
					`Async run '${runId}' has ${running.length} running children. Provide index to choose one.`,
				);
			}
			const capabilityCeiling = intersectSubagentCapabilityCeilings(
				status?.capabilityCeiling,
				selected.step.capabilityCeiling,
			);
			return {
				kind: "live",
				runId,
				asyncDir: location.asyncDir ?? undefined,
				state,
				agent: selected.step.agent,
				index: selected.index,
				cwd: recoveryDescriptor?.cwd ?? status?.cwd ?? result?.cwd,
				sessionFile: selected.step.sessionFile ?? status?.sessionFile ?? result?.sessionFile,
				model: selected.step.model,
				thinking: selected.step.thinking,
				...(recoveryDescriptor?.version === 2 && recoveryDescriptor.context
					? { context: recoveryDescriptor.context }
					: {}),
				launchContractDigest:
					selected.step.launchContractDigest ??
					result?.results?.[selected.index]?.launchContractDigest ??
					result?.launchContractDigest ??
					recoveryDescriptor?.launchContractDigest,
				...(capabilityCeiling ? { capabilityCeiling } : {}),
				...(recoveryDescriptor ? { recoveryDescriptor } : {}),
			};
		}
	}

	if (stepCount > 1 && requestedIndex === undefined) {
		throw new Error(`Async run '${runId}' has ${stepCount} children. Provide index to choose one.`);
	}
	const index = requestedIndex ?? 0;
	if (!Number.isInteger(index)) throw new Error(`Async run '${runId}' index must be an integer.`);
	if (index < 0 || index >= stepCount)
		throw new Error(`Async run '${runId}' has ${stepCount} children. Index ${index} is out of range.`);
	const selectedStopped =
		statusSteps[index]?.status === "stopped" ||
		resultSteps[index]?.state === "stopped" ||
		resultSteps[index]?.stopped === true ||
		(stepCount === 1 && state === "stopped");
	if (selectedStopped) {
		throw new Error(
			`Async run '${runId}' child ${index} was stopped and cannot be resumed. Start a new run instead.`,
		);
	}
	const agent = statusSteps[index]?.agent ?? resultSteps[index]?.agent ?? result?.agent;
	if (!agent) throw new Error(`Could not determine child agent for async run '${runId}'.`);
	if (recoveryDescriptor && recoveryDescriptor.agent !== agent)
		throw new Error(
			`Async run '${runId}' has a recovery descriptor for '${recoveryDescriptor.agent}', not '${agent}'.`,
		);
	const sessionFile =
		statusSteps[index]?.sessionFile ??
		resultSteps[index]?.sessionFile ??
		(stepCount === 1 ? (status?.sessionFile ?? result?.sessionFile) : undefined);
	if (!sessionFile && requireSessionFile)
		throw new Error(`Async run '${runId}' child ${index} does not have a persisted session file to resume from.`);
	const resolvedSessionFile = sessionFile ? validateResumeSessionFile(runId, sessionFile) : undefined;
	const stepModel =
		statusSteps[index]?.model ?? resultSteps[index]?.model ?? (stepCount === 1 ? result?.model : undefined);
	const stepThinking =
		statusSteps[index]?.thinking ?? resultSteps[index]?.thinking ?? (stepCount === 1 ? result?.thinking : undefined);
	const capabilityCeiling = intersectSubagentCapabilityCeilings(
		status?.capabilityCeiling,
		statusSteps[index]?.capabilityCeiling,
		result?.capabilityCeiling,
		resultSteps[index]?.capabilityCeiling,
	);

	return {
		kind: "revive",
		runId,
		asyncDir: location.asyncDir ?? undefined,
		state,
		agent,
		index,
		cwd: recoveryDescriptor?.cwd ?? status?.cwd ?? result?.cwd,
		...(resolvedSessionFile ? { sessionFile: resolvedSessionFile } : {}),
		...(stepModel ? { model: stepModel } : {}),
		...(stepThinking ? { thinking: stepThinking } : {}),
		...(recoveryDescriptor?.version === 2 && recoveryDescriptor.context
			? { context: recoveryDescriptor.context }
			: {}),
		launchContractDigest:
			statusSteps[index]?.launchContractDigest ??
			resultSteps[index]?.launchContractDigest ??
			result?.launchContractDigest ??
			recoveryDescriptor?.launchContractDigest,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		...(recoveryDescriptor ? { recoveryDescriptor } : {}),
	};
}

export function applySteeringRecoveryAgentConfig(
	agentConfig: AgentConfig,
	descriptor: AsyncRecoveryDescriptor,
): AgentConfig {
	return {
		...agentConfig,
		model: descriptor.model,
		fallbackModels: descriptor.fallbackModels ? [...descriptor.fallbackModels] : undefined,
		thinking: descriptor.thinking,
		tools: descriptor.tools ? [...descriptor.tools] : undefined,
		extensions: descriptor.extensions ? [...descriptor.extensions] : undefined,
		subagentOnlyExtensions: descriptor.subagentOnlyExtensions ? [...descriptor.subagentOnlyExtensions] : undefined,
		mcpDirectTools: descriptor.mcpDirectTools ? [...descriptor.mcpDirectTools] : undefined,
		systemPrompt: descriptor.systemPrompt ?? agentConfig.systemPrompt,
		systemPromptMode: descriptor.systemPromptMode,
		inheritProjectContext: descriptor.inheritProjectContext,
		inheritSkills: descriptor.inheritSkills,
		skills: descriptor.skills ? [...descriptor.skills] : undefined,
		skillPath: descriptor.skillPath ? [...descriptor.skillPath] : undefined,
		filePath: descriptor.agentFilePath ?? agentConfig.filePath,
		toolBudget: descriptor.initialToolBudget,
		maxSubagentDepth: descriptor.maxSubagentDepth,
	};
}

export function buildRevivedAsyncTask(target: AsyncResumeTarget, message: string): string {
	return [
		"You are reviving a previous subagent conversation.",
		"",
		`Original run: ${target.runId}`,
		`Original agent: ${target.agent}`,
		target.sessionFile ? `Original session file: ${target.sessionFile}` : undefined,
		"",
		"Use the stored session context as background. Answer the orchestrator's follow-up below. Do not assume the original child process is still alive.",
		"",
		"Follow-up:",
		message,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}
