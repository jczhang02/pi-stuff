import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import { type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { type DurableClaim, tryAcquireDurableClaim } from "../../shared/durable-claim.ts";
import {
	assertPrivateDirectory,
	assertPrivateDirectoryWithin,
	ensurePrivateDirectory,
	type OwnedFileSnapshot,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshot,
} from "../../shared/private-directory.ts";
import { tryAcquireStatusMutationClaim } from "../../shared/status-mutation.ts";
import {
	ASYNC_DIR,
	type AsyncJobState,
	type AsyncStatus,
	type NestedRouteInfo,
	type NestedRunState,
	type NestedRunSummary,
	type NestedStepSummary,
	RESULTS_DIR,
	type SubagentRunMode,
	type SubagentState,
	TEMP_ROOT_DIR,
	type TurnBudgetState,
} from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import { readProcessTerminal, sanitizeProcessTerminal } from "../background/process-terminal.ts";
import {
	decodeSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
	type SubagentCapabilityAudit,
} from "./capability-ceiling.ts";
import { isSafeNestedPathId, type NestedPathEntry, parseNestedPathEnv, sanitizeNestedPath } from "./nested-path.ts";
import { MAX_BACKGROUND_TASKS } from "./parallel-utils.ts";
import {
	SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV,
	SUBAGENT_PARENT_CHILD_INDEX_ENV,
	SUBAGENT_PARENT_CONTROL_INBOX_ENV,
	SUBAGENT_PARENT_DEPTH_ENV,
	SUBAGENT_PARENT_EVENT_SINK_ENV,
	SUBAGENT_PARENT_PATH_ENV,
	SUBAGENT_PARENT_ROOT_RUN_ID_ENV,
	SUBAGENT_PARENT_RUN_ID_ENV,
} from "./pi-args.ts";

export const NESTED_EVENTS_DIR = path.join(TEMP_ROOT_DIR, "nested-subagent-events");
const ROUTE_FILE = "route.json";
const REGISTRY_FILE = "registry.json";
const ROOT_TERMINAL_FILE = "root-terminal.json";
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_ROUTE_METADATA_BYTES = 16 * 1024;
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_FILES_PER_PROJECTION = 2_000;
const MAX_PROCESSED_EVENTS = 1_000;
const REGISTRY_LOCK = "registry-project.lock";
const AUTHORITATIVE_PROJECTION_TIMEOUT_MS = 3_000;
const AUTHORITATIVE_PROJECTION_RETRY_MS = 20;
const MAX_STEPS = MAX_BACKGROUND_TASKS;
const MAX_CHILDREN = 200;
const MAX_DEPTH = 3;
const MAX_REGISTRY_CACHE_ENTRIES = 256;
const MAX_REGISTRY_CACHE_WEIGHT_BYTES = 64 * 1024 * 1024;
const REGISTRY_CACHE_OBJECT_WEIGHT_MULTIPLIER = 4;
const MIN_REGISTRY_CACHE_ENTRY_WEIGHT_BYTES = 4 * 1024;

type NestedStatusEventType = "subagent.nested.started" | "subagent.nested.updated" | "subagent.nested.completed";

export type NestedRoute = NestedRouteInfo;

export interface NestedEventRecord {
	type: NestedStatusEventType;
	ts: number;
	rootRunId: string;
	parentRunId: string;
	parentStepIndex?: number;
	capabilityToken: string;
	child: NestedRunSummary;
}

export interface NestedRegistry {
	rootRunId: string;
	updatedAt: number;
	children: NestedRunSummary[];
	pendingChildren: NestedRunSummary[];
	processedEvents: string[];
}

type NestedRegistryFingerprint = Omit<OwnedFileSnapshot, "text">;

interface CachedNestedRegistry {
	readonly fingerprint: NestedRegistryFingerprint;
	readonly registry: NestedRegistry;
	readonly weightBytes: number;
}

interface RawNestedRoute {
	rootRunId?: unknown;
	eventSink?: unknown;
	controlInbox?: unknown;
	capabilityToken?: unknown;
}

interface RawTokenUsage {
	input?: unknown;
	output?: unknown;
	total?: unknown;
}

interface RawCost {
	inputTokens?: unknown;
	outputTokens?: unknown;
	costUsd?: unknown;
}

interface RawTurnBudget {
	maxTurns?: unknown;
	graceTurns?: unknown;
	turnCount?: unknown;
	outcome?: unknown;
	wrapUpRequestedAtTurn?: unknown;
	terminationDeferredAtTurn?: unknown;
	exceededAtTurn?: unknown;
}

interface RawToolBudget {
	hard?: unknown;
	soft?: unknown;
	block?: unknown;
	outcome?: unknown;
	toolCount?: unknown;
	softReachedAt?: unknown;
	hardReachedAt?: unknown;
	blockedTool?: unknown;
}

interface RawCapabilityAudit {
	ceiling?: unknown;
	requestedTools?: unknown;
	effectiveTools?: unknown;
	removedTools?: unknown;
	internalTools?: unknown;
	extensionsDenied?: unknown;
	removedExtensionCount?: unknown;
	requestedMcpToolCount?: unknown;
	effectiveMcpTools?: unknown;
}

interface RawParallelGroup {
	start?: unknown;
	count?: unknown;
	stepIndex?: unknown;
}

interface RawNestedStep {
	agent?: unknown;
	delegatedTask?: unknown;
	task?: unknown;
	description?: unknown;
	agentStatus?: unknown;
	status?: unknown;
	sessionFile?: unknown;
	transcriptPath?: unknown;
	transcriptError?: unknown;
	activityState?: unknown;
	lastActivityAt?: unknown;
	currentTool?: unknown;
	currentToolStartedAt?: unknown;
	currentPath?: unknown;
	turnCount?: unknown;
	toolCount?: unknown;
	startedAt?: unknown;
	endedAt?: unknown;
	error?: unknown;
	timedOut?: unknown;
	stopped?: unknown;
	turnBudget?: unknown;
	turnBudgetExceeded?: unknown;
	wrapUpRequested?: unknown;
	toolBudget?: unknown;
	toolBudgetBlocked?: unknown;
	processTerminal?: unknown;
	capabilityCeiling?: unknown;
	capabilityAudit?: unknown;
	children?: unknown;
}

interface RawNestedSummary extends RawNestedStep {
	id?: unknown;
	parentRunOrigin?: unknown;
	parentRunId?: unknown;
	parentStepIndex?: unknown;
	parentAgent?: unknown;
	depth?: unknown;
	path?: unknown;
	state?: unknown;
	asyncDir?: unknown;
	pid?: unknown;
	sessionId?: unknown;
	intercomTarget?: unknown;
	ownerIntercomTarget?: unknown;
	leafIntercomTarget?: unknown;
	ownerState?: unknown;
	controlInbox?: unknown;
	capabilityToken?: unknown;
	mode?: unknown;
	agents?: unknown;
	currentStep?: unknown;
	parallelGroups?: unknown;
	totalTokens?: unknown;
	totalCost?: unknown;
	lastUpdate?: unknown;
	timeoutMs?: unknown;
	deadlineAt?: unknown;
	steps?: unknown;
}

interface RawNestedEvent {
	type?: unknown;
	ts?: unknown;
	rootRunId?: unknown;
	parentRunId?: unknown;
	parentStepIndex?: unknown;
	capabilityToken?: unknown;
	child?: unknown;
}

interface RawNestedRegistry {
	rootRunId?: unknown;
	updatedAt?: unknown;
	children?: unknown;
	pendingChildren?: unknown;
	processedEvents?: unknown;
}

interface NestedParentAddress {
	parentRunId: string;
	parentStepIndex?: number;
	depth: number;
	path: NestedPathEntry[];
}

/**
 * CurrentAgents refreshes several times per second while work is live. Keep a
 * bounded, stat-keyed cache so an unchanged registry is not repeatedly read
 * and parsed (a full registry can be 8 MiB). Atomic registry replacement
 * changes its inode and invalidates the entry naturally.
 */
const nestedRegistryCache = new Map<string, CachedNestedRegistry>();
let nestedRegistryCacheWeightBytes = 0;

export interface AuthoritativeNestedProjectionOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export function isSafeNestedId<Value>(value: Value): value is Value & string {
	return isSafeNestedPathId(value);
}

export function assertSafeNestedId(label: string, value: string): void {
	if (!isSafeNestedId(value)) throw new Error(`${label} must be a non-empty safe id token.`);
}

function assertSafeId(label: string, value: string): void {
	assertSafeNestedId(label, value);
}

function containedPath(base: string, candidate: string): boolean {
	const resolvedBase = path.resolve(base);
	const resolvedCandidate = path.resolve(candidate);
	return resolvedCandidate === resolvedBase || resolvedCandidate.startsWith(`${resolvedBase}${path.sep}`);
}

function commonRouteRoot(route: Pick<NestedRoute, "eventSink" | "controlInbox">): string {
	return path.dirname(path.resolve(route.eventSink));
}

function validateRoutePaths(route: NestedRoute): void {
	assertSafeId("rootRunId", route.rootRunId);
	assertSafeId("capabilityToken", route.capabilityToken);
	if (!containedPath(NESTED_EVENTS_DIR, route.eventSink))
		throw new Error("Nested event sink is outside the subagent nested event root.");
	if (!containedPath(NESTED_EVENTS_DIR, route.controlInbox))
		throw new Error("Nested control inbox is outside the subagent nested event root.");
	if (commonRouteRoot(route) !== path.dirname(path.resolve(route.controlInbox)))
		throw new Error("Nested event sink and control inbox must share one route root.");
}

function validateRouteStorage(route: NestedRoute): void {
	validateRoutePaths(route);
	assertPrivateDirectory(TEMP_ROOT_DIR);
	assertPrivateDirectory(NESTED_EVENTS_DIR);
	const routeRoot = commonRouteRoot(route);
	assertPrivateDirectory(routeRoot);
	assertPrivateDirectory(route.eventSink);
	assertPrivateDirectory(route.controlInbox);
	const metadata = parseJsonValue(readBoundedOwnedFile(path.join(routeRoot, ROUTE_FILE), MAX_ROUTE_METADATA_BYTES));
	if (!isRuntimeObject(metadata) || metadata === null || Array.isArray(metadata)) {
		throw new Error("Nested event route metadata is not an object.");
	}
	if (metadata.rootRunId !== route.rootRunId || metadata.capabilityToken !== route.capabilityToken) {
		throw new Error("Nested event route metadata does not match the provided root id and capability token.");
	}
}

export function createNestedRoute(rootRunId: string): NestedRoute {
	assertSafeId("rootRunId", rootRunId);
	const capabilityToken = randomUUID();
	const routeRoot = path.join(NESTED_EVENTS_DIR, `${rootRunId}-${capabilityToken}`);
	const stagingRoot = path.join(NESTED_EVENTS_DIR, `.creating-${rootRunId}-${capabilityToken}`);
	const eventSink = path.join(routeRoot, "events");
	const controlInbox = path.join(routeRoot, "controls");
	ensurePrivateDirectory(TEMP_ROOT_DIR);
	ensurePrivateDirectory(NESTED_EVENTS_DIR);
	fs.mkdirSync(stagingRoot, { mode: 0o700 });
	const staged = fs.lstatSync(stagingRoot);
	try {
		ensurePrivateDirectory(stagingRoot);
		ensurePrivateDirectory(path.join(stagingRoot, "events"));
		ensurePrivateDirectory(path.join(stagingRoot, "controls"));
		fs.writeFileSync(
			path.join(stagingRoot, ROUTE_FILE),
			`${JSON.stringify({ rootRunId, capabilityToken, createdAt: Date.now() })}\n`,
			{ mode: 0o600, flag: "wx" },
		);
		fs.renameSync(stagingRoot, routeRoot);
	} catch (error) {
		try {
			const current = fs.lstatSync(stagingRoot);
			if (current.isDirectory() && current.dev === staged.dev && current.ino === staged.ino) {
				fs.rmSync(stagingRoot, { recursive: true });
			}
		} catch {
			// Preserve the original route construction failure.
		}
		throw error;
	}
	const route = { rootRunId, eventSink, controlInbox, capabilityToken };
	validateRouteStorage(route);
	return route;
}

export function resolveNestedRouteFromEnv(env: NodeJS.ProcessEnv = process.env): NestedRoute | undefined {
	const rootRunId = env[SUBAGENT_PARENT_ROOT_RUN_ID_ENV];
	const eventSink = env[SUBAGENT_PARENT_EVENT_SINK_ENV];
	const controlInbox = env[SUBAGENT_PARENT_CONTROL_INBOX_ENV];
	const capabilityToken = env[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV];
	if (!rootRunId || !eventSink || !controlInbox || !capabilityToken) return undefined;
	const route = { rootRunId, eventSink, controlInbox, capabilityToken };
	validateRouteStorage(route);
	return route;
}

export function resolveInheritedNestedRouteFromEnv(env: NodeJS.ProcessEnv = process.env): NestedRoute | undefined {
	try {
		return resolveNestedRouteFromEnv(env);
	} catch (error) {
		reportAgentDiagnostic("Ignoring invalid nested subagent event route:", error);
		return undefined;
	}
}

/** Validate one exact persisted route without falling back to another route with the same root id. */
export function resolvePersistedNestedRoute<Value>(value: Value, expectedRootRunId: string): NestedRoute | undefined {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) return undefined;
	// SAFETY: the object guard proves the persisted route can be inspected through its optional raw fields.
	const raw = value as Value & RawNestedRoute;
	if (
		raw.rootRunId !== expectedRootRunId ||
		!isSafeNestedId(raw.rootRunId) ||
		!isRuntimeString(raw.eventSink) ||
		!isRuntimeString(raw.controlInbox) ||
		!isSafeNestedId(raw.capabilityToken)
	) {
		return undefined;
	}
	const route: NestedRoute = {
		rootRunId: raw.rootRunId,
		eventSink: raw.eventSink,
		controlInbox: raw.controlInbox,
		capabilityToken: raw.capabilityToken,
	};
	try {
		validateRouteStorage(route);
		return route;
	} catch {
		return undefined;
	}
}

/**
 * Recover a terminal root after its exact route was already retired. This also
 * repairs a stale status overlay that resurrected the retired route pointer.
 */
export function recoverRetiredNestedRouteStatus(route: NestedRoute, rootAsyncDir: string): AsyncStatus | undefined {
	validateRoutePaths(route);
	if (path.basename(rootAsyncDir) !== route.rootRunId) return undefined;
	assertPrivateDirectoryWithin(TEMP_ROOT_DIR, rootAsyncDir);
	try {
		fs.lstatSync(commonRouteRoot(route));
		return undefined;
	} catch (error) {
		if (!isRuntimeObject(error) || error === null || !("code" in error) || error.code !== "ENOENT") return undefined;
	}
	const claim = tryAcquireStatusMutationClaim(rootAsyncDir);
	if (!claim) return undefined;
	try {
		const status = readStatus(rootAsyncDir);
		if (!status || status.runId !== route.rootRunId || !terminal(status.state)) return undefined;
		if (status.nestedRoute) {
			const persisted = status.nestedRoute;
			if (
				persisted.rootRunId !== route.rootRunId ||
				persisted.capabilityToken !== route.capabilityToken ||
				path.resolve(persisted.eventSink) !== path.resolve(route.eventSink) ||
				path.resolve(persisted.controlInbox) !== path.resolve(route.controlInbox)
			)
				return undefined;
		}
		const processTerminal = readProcessTerminal(rootAsyncDir, {
			runId: status.runId,
			runnerProcessInstanceId: status.processTerminal?.runnerProcessInstanceId,
		});
		const repaired: AsyncStatus = {
			...status,
			nestedRoute: undefined,
		};
		if (processTerminal) repaired.processTerminal = processTerminal;
		writePrivateAtomicJson(path.join(rootAsyncDir, "status.json"), repaired);
		return repaired;
	} finally {
		claim.release();
	}
}

export function resolveNestedParentAddressFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): NestedParentAddress | undefined {
	const parentRunId = env[SUBAGENT_PARENT_RUN_ID_ENV];
	if (!isSafeNestedId(parentRunId)) return undefined;
	const rawIndex = env[SUBAGENT_PARENT_CHILD_INDEX_ENV];
	const parentStepIndex = rawIndex && /^\d+$/.test(rawIndex) ? Number(rawIndex) : undefined;
	const depth = Math.min(Math.max(1, clampNumber(Number(env[SUBAGENT_PARENT_DEPTH_ENV])) ?? 1), MAX_DEPTH);
	const parsedPath = parseNestedPathEnv(env[SUBAGENT_PARENT_PATH_ENV]);
	const parentPath: NestedPathEntry = { runId: parentRunId };
	if (parentStepIndex !== undefined) parentPath.stepIndex = parentStepIndex;
	const nestedPath = parsedPath.length ? parsedPath : [parentPath];
	const address: NestedParentAddress = {
		parentRunId,
		depth,
		path: nestedPath,
	};
	if (parentStepIndex !== undefined) address.parentStepIndex = parentStepIndex;
	return address;
}

export function resolveNestedAsyncDir(rootRunId: string, run: NestedRunSummary): string | undefined {
	if (!isSafeNestedId(rootRunId) || !isSafeNestedId(run.id)) return undefined;
	const expected = path.resolve(TEMP_ROOT_DIR, "nested-subagent-runs", rootRunId, run.id);
	// The nested run directory is a trusted, deterministic address. Event
	// projections may deliberately omit an unusually long locator to stay
	// bounded; when they do, control and transcript fallback must still work.
	if (run.asyncDir && path.resolve(run.asyncDir) !== expected) return undefined;
	try {
		assertPrivateDirectoryWithin(TEMP_ROOT_DIR, expected);
		return expected;
	} catch {
		return undefined;
	}
}

function clampNumber<Value>(value: Value): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) ? value : undefined;
}

function stringValue<Value>(value: Value, max = 512): string | undefined {
	return isRuntimeString(value) && value.length > 0 ? value.slice(0, max) : undefined;
}

function sanitizeTokenUsage<Value>(value: Value): NestedRunSummary["totalTokens"] | undefined {
	if (!value || !isRuntimeObject(value)) return undefined;
	// SAFETY: the object guard proves this token-usage candidate has inspectable optional raw fields.
	const raw = value as Value & RawTokenUsage;
	const input = clampNumber(raw.input);
	const output = clampNumber(raw.output);
	const total = clampNumber(raw.total);
	return input !== undefined && output !== undefined && total !== undefined ? { input, output, total } : undefined;
}

function sanitizeCost<Value>(value: Value): NestedRunSummary["totalCost"] | undefined {
	if (!value || !isRuntimeObject(value)) return undefined;
	// SAFETY: the object guard proves this cost candidate has inspectable optional raw fields.
	const raw = value as Value & RawCost;
	const inputTokens = clampNumber(raw.inputTokens);
	const outputTokens = clampNumber(raw.outputTokens);
	const costUsd = clampNumber(raw.costUsd);
	return inputTokens !== undefined && outputTokens !== undefined && costUsd !== undefined
		? { inputTokens, outputTokens, costUsd }
		: undefined;
}

function sanitizeTurnBudget<Value>(value: Value): TurnBudgetState | undefined {
	if (!value || !isRuntimeObject(value)) return undefined;
	// SAFETY: the object guard proves this turn-budget candidate has inspectable optional raw fields.
	const raw = value as Value & RawTurnBudget;
	const maxTurns = clampNumber(raw.maxTurns);
	const graceTurns = clampNumber(raw.graceTurns);
	const turnCount = clampNumber(raw.turnCount);
	const outcome =
		raw.outcome === "within-budget" ||
		raw.outcome === "wrap-up-requested" ||
		raw.outcome === "termination-deferred" ||
		raw.outcome === "exceeded"
			? raw.outcome
			: undefined;
	if (maxTurns === undefined || graceTurns === undefined || turnCount === undefined || !outcome) return undefined;
	const budget: TurnBudgetState = { maxTurns, graceTurns, turnCount, outcome };
	const wrapUpRequestedAtTurn = clampNumber(raw.wrapUpRequestedAtTurn);
	const terminationDeferredAtTurn = clampNumber(raw.terminationDeferredAtTurn);
	const exceededAtTurn = clampNumber(raw.exceededAtTurn);
	if (wrapUpRequestedAtTurn !== undefined) budget.wrapUpRequestedAtTurn = wrapUpRequestedAtTurn;
	if (terminationDeferredAtTurn !== undefined) budget.terminationDeferredAtTurn = terminationDeferredAtTurn;
	if (exceededAtTurn !== undefined) budget.exceededAtTurn = exceededAtTurn;
	return budget;
}

function sanitizeToolBudget<Value>(value: Value): NestedStepSummary["toolBudget"] | undefined {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) return undefined;
	// SAFETY: the non-array object guard proves this tool-budget candidate has inspectable optional raw fields.
	const raw = value as Value & RawToolBudget;
	const hard = clampNumber(raw.hard);
	const toolCount = clampNumber(raw.toolCount);
	const outcome =
		raw.outcome === "within-budget" || raw.outcome === "soft-reached" || raw.outcome === "hard-blocked"
			? raw.outcome
			: undefined;
	const block =
		raw.block === "*"
			? "*"
			: Array.isArray(raw.block)
				? raw.block
						.map((entry) => stringValue(entry, 128))
						.filter((entry): entry is string => Boolean(entry))
						.slice(0, 256)
				: undefined;
	if (
		hard === undefined ||
		!Number.isInteger(hard) ||
		hard < 0 ||
		toolCount === undefined ||
		!Number.isInteger(toolCount) ||
		toolCount < 0 ||
		!outcome ||
		block === undefined
	) {
		return undefined;
	}
	const soft = clampNumber(raw.soft);
	const budget: NonNullable<NestedStepSummary["toolBudget"]> = { hard, block, outcome, toolCount };
	const softReachedAt = clampNumber(raw.softReachedAt);
	const hardReachedAt = clampNumber(raw.hardReachedAt);
	const blockedTool = stringValue(raw.blockedTool, 128);
	if (soft !== undefined && Number.isInteger(soft) && soft >= 0) budget.soft = soft;
	if (softReachedAt !== undefined) budget.softReachedAt = softReachedAt;
	if (hardReachedAt !== undefined) budget.hardReachedAt = hardReachedAt;
	if (blockedTool) budget.blockedTool = blockedTool;
	return budget;
}

function sanitizeCapabilityCeiling<Value>(value: Value): ResolvedSubagentCapabilityCeiling | undefined {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) return undefined;
	try {
		return decodeSubagentCapabilityCeiling(Buffer.from(JSON.stringify(value), "utf8").toString("base64url"));
	} catch {
		return undefined;
	}
}

function sanitizeStringList<Value>(value: Value): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.map((entry) => stringValue(entry, 128))
		.filter((entry): entry is string => Boolean(entry))
		.slice(0, 256);
}

function sanitizeCapabilityAudit<Value>(value: Value): SubagentCapabilityAudit | undefined {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) return undefined;
	// SAFETY: the non-array object guard proves this audit candidate has inspectable optional raw fields.
	const raw = value as Value & RawCapabilityAudit;
	const ceiling = sanitizeCapabilityCeiling(raw.ceiling);
	const effectiveTools = sanitizeStringList(raw.effectiveTools);
	const removedTools = sanitizeStringList(raw.removedTools);
	const internalTools = sanitizeStringList(raw.internalTools);
	const effectiveMcpTools = sanitizeStringList(raw.effectiveMcpTools);
	const removedExtensionCount = clampNumber(raw.removedExtensionCount);
	const requestedMcpToolCount = clampNumber(raw.requestedMcpToolCount);
	if (
		!ceiling ||
		!effectiveTools ||
		!removedTools ||
		!internalTools ||
		!effectiveMcpTools ||
		!isRuntimeBoolean(raw.extensionsDenied) ||
		removedExtensionCount === undefined ||
		!Number.isInteger(removedExtensionCount) ||
		removedExtensionCount < 0 ||
		requestedMcpToolCount === undefined ||
		!Number.isInteger(requestedMcpToolCount) ||
		requestedMcpToolCount < 0
	) {
		return undefined;
	}
	const requestedTools = sanitizeStringList(raw.requestedTools);
	const audit: SubagentCapabilityAudit = {
		ceiling,
		effectiveTools,
		removedTools,
		internalTools,
		extensionsDenied: raw.extensionsDenied,
		removedExtensionCount,
		requestedMcpToolCount,
		effectiveMcpTools,
	};
	if (requestedTools) audit.requestedTools = requestedTools;
	return audit;
}

function sanitizeState<Value>(value: Value, fallback: NestedRunState): NestedRunState {
	if (!isRuntimeString(value)) return fallback;
	switch (value) {
		case "queued":
			return "queued";
		case "running":
			return "running";
		case "complete":
			return "complete";
		case "failed":
			return "failed";
		case "paused":
			return "paused";
		case "stopped":
			return "stopped";
		default:
			return fallback;
	}
}

function sanitizeParallelGroups<Value>(value: Value): NestedRunSummary["parallelGroups"] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.map((entry) => {
			if (!entry || !isRuntimeObject(entry) || Array.isArray(entry)) return undefined;
			// SAFETY: the non-array object guard proves this parallel-group candidate has inspectable optional raw fields.
			const raw = entry as RawParallelGroup;
			const start = clampNumber(raw.start);
			const count = clampNumber(raw.count);
			const stepIndex = clampNumber(raw.stepIndex);
			return start !== undefined &&
				count !== undefined &&
				stepIndex !== undefined &&
				[start, count, stepIndex].every((number) => Number.isInteger(number) && number >= 0)
				? { start, count, stepIndex }
				: undefined;
		})
		.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
		.slice(0, MAX_STEPS);
}

function sanitizeStep<Value>(input: Value, depth: number): NestedStepSummary | undefined {
	if (!input || !isRuntimeObject(input)) return undefined;
	// SAFETY: the object guard proves this nested-step candidate has inspectable optional raw fields.
	const raw = input as Value & RawNestedStep;
	const agent = stringValue(raw.agent, 128);
	if (!agent) return undefined;
	const status =
		raw.status === "pending" ||
		raw.status === "running" ||
		raw.status === "complete" ||
		raw.status === "completed" ||
		raw.status === "failed" ||
		raw.status === "paused" ||
		raw.status === "stopped"
			? raw.status
			: "pending";
	const processTerminal = sanitizeProcessTerminal(raw.processTerminal, {}, "nested step");
	const capabilityCeiling = sanitizeCapabilityCeiling(raw.capabilityCeiling);
	const capabilityAudit = sanitizeCapabilityAudit(raw.capabilityAudit);
	const toolBudget = sanitizeToolBudget(raw.toolBudget);
	const step: Partial<NestedStepSummary> = { agent };
	const delegatedTask = stringValue(raw.delegatedTask, 500);
	const task = stringValue(raw.task, 500);
	const description = stringValue(raw.description, 500);
	const sessionFile = stringValue(raw.sessionFile, 2048);
	const transcriptPath = stringValue(raw.transcriptPath, 2048);
	const transcriptError = stringValue(raw.transcriptError, 1024);
	const lastActivityAt = clampNumber(raw.lastActivityAt);
	const currentTool = stringValue(raw.currentTool, 128);
	const currentToolStartedAt = clampNumber(raw.currentToolStartedAt);
	const currentPath = stringValue(raw.currentPath, 2048);
	const turnCount = clampNumber(raw.turnCount);
	const toolCount = clampNumber(raw.toolCount);
	const startedAt = clampNumber(raw.startedAt);
	const endedAt = clampNumber(raw.endedAt);
	const error = stringValue(raw.error, 1024);
	const turnBudget = sanitizeTurnBudget(raw.turnBudget);
	if (delegatedTask) step.delegatedTask = delegatedTask;
	if (task) step.task = task;
	if (description) step.description = description;
	if (raw.agentStatus === "crashed") step.agentStatus = "crashed";
	step.status = status;
	if (sessionFile) step.sessionFile = sessionFile;
	if (transcriptPath) step.transcriptPath = transcriptPath;
	if (transcriptError) step.transcriptError = transcriptError;
	if (raw.activityState === "active_long_running" || raw.activityState === "needs_attention") {
		step.activityState = raw.activityState;
	}
	if (lastActivityAt !== undefined) step.lastActivityAt = lastActivityAt;
	if (currentTool) step.currentTool = currentTool;
	if (currentToolStartedAt !== undefined) step.currentToolStartedAt = currentToolStartedAt;
	if (currentPath) step.currentPath = currentPath;
	if (turnCount !== undefined) step.turnCount = turnCount;
	if (toolCount !== undefined) step.toolCount = toolCount;
	if (startedAt !== undefined) step.startedAt = startedAt;
	if (endedAt !== undefined) step.endedAt = endedAt;
	if (error) step.error = error;
	if (raw.timedOut === true) step.timedOut = true;
	if (raw.stopped === true) step.stopped = true;
	if (turnBudget) step.turnBudget = turnBudget;
	if (raw.turnBudgetExceeded === true) step.turnBudgetExceeded = true;
	if (raw.wrapUpRequested === true) step.wrapUpRequested = true;
	if (toolBudget) step.toolBudget = toolBudget;
	if (raw.toolBudgetBlocked === true) step.toolBudgetBlocked = true;
	if (processTerminal) step.processTerminal = processTerminal;
	if (capabilityCeiling) step.capabilityCeiling = capabilityCeiling;
	if (capabilityAudit) step.capabilityAudit = capabilityAudit;
	if (depth < MAX_DEPTH && Array.isArray(raw.children)) {
		step.children = raw.children
			.map((child) => sanitizeSummary(child, depth + 1))
			.filter((child): child is NestedRunSummary => Boolean(child))
			.slice(0, MAX_CHILDREN);
	}
	// SAFETY: agent and status are assigned before every return; all optional fields are individually validated.
	return step as NestedStepSummary;
}

export function sanitizeSummary<Value>(input: Value, depth = 0): NestedRunSummary | undefined {
	if (!input || !isRuntimeObject(input)) return undefined;
	// SAFETY: the object guard proves this nested-summary candidate has inspectable optional raw fields.
	const raw = input as Value & RawNestedSummary;
	if (!isSafeNestedId(raw.id) || !isSafeNestedId(raw.parentRunId)) return undefined;
	const pathParts = sanitizeNestedPath(raw.path);
	const steps = Array.isArray(raw.steps)
		? raw.steps
				.map((step) => sanitizeStep(step, depth + 1))
				.filter((step): step is NestedStepSummary => Boolean(step))
				.slice(0, MAX_STEPS)
		: undefined;
	const totalTokens = sanitizeTokenUsage(raw.totalTokens);
	const totalCost = sanitizeCost(raw.totalCost);
	const pid = clampNumber(raw.pid);
	const processTerminal = sanitizeProcessTerminal(raw.processTerminal, {}, "nested run");
	const capabilityCeiling = sanitizeCapabilityCeiling(raw.capabilityCeiling);
	const capabilityAudit = sanitizeCapabilityAudit(raw.capabilityAudit);
	const parallelGroups = sanitizeParallelGroups(raw.parallelGroups);
	const toolBudget = sanitizeToolBudget(raw.toolBudget);
	const summary: Partial<NestedRunSummary> = { id: raw.id };
	const parentStepIndex = clampNumber(raw.parentStepIndex);
	const parentAgent = stringValue(raw.parentAgent, 128);
	const asyncDir = stringValue(raw.asyncDir, 2048);
	const sessionId = stringValue(raw.sessionId, 256);
	const sessionFile = stringValue(raw.sessionFile, 2048);
	const intercomTarget = stringValue(raw.intercomTarget, 256);
	const ownerIntercomTarget = stringValue(raw.ownerIntercomTarget, 256);
	const leafIntercomTarget = stringValue(raw.leafIntercomTarget, 256);
	const controlInbox = stringValue(raw.controlInbox, 2048);
	const capabilityToken = stringValue(raw.capabilityToken, 128);
	const agent = stringValue(raw.agent, 128);
	const currentStep = clampNumber(raw.currentStep);
	const lastActivityAt = clampNumber(raw.lastActivityAt);
	const currentTool = stringValue(raw.currentTool, 128);
	const currentToolStartedAt = clampNumber(raw.currentToolStartedAt);
	const currentPath = stringValue(raw.currentPath, 2048);
	const turnCount = clampNumber(raw.turnCount);
	const toolCount = clampNumber(raw.toolCount);
	const startedAt = clampNumber(raw.startedAt);
	const endedAt = clampNumber(raw.endedAt);
	const lastUpdate = clampNumber(raw.lastUpdate);
	const timeoutMs = clampNumber(raw.timeoutMs);
	const deadlineAt = clampNumber(raw.deadlineAt);
	const turnBudget = sanitizeTurnBudget(raw.turnBudget);
	const error = stringValue(raw.error, 1024);
	if (raw.agentStatus === "crashed") summary.agentStatus = "crashed";
	if (raw.parentRunOrigin === "automatic" || raw.parentRunOrigin === "user") {
		summary.parentRunOrigin = raw.parentRunOrigin;
	}
	summary.parentRunId = raw.parentRunId;
	if (parentStepIndex !== undefined) summary.parentStepIndex = parentStepIndex;
	if (parentAgent) summary.parentAgent = parentAgent;
	summary.depth = Math.min(Math.max(0, clampNumber(raw.depth) ?? 0), MAX_DEPTH);
	summary.path = pathParts;
	summary.state = sanitizeState(raw.state, "running");
	if (asyncDir) summary.asyncDir = asyncDir;
	if (pid !== undefined && pid > 0 && Number.isInteger(pid)) summary.pid = pid;
	if (sessionId) summary.sessionId = sessionId;
	if (sessionFile) summary.sessionFile = sessionFile;
	if (intercomTarget) summary.intercomTarget = intercomTarget;
	if (ownerIntercomTarget) summary.ownerIntercomTarget = ownerIntercomTarget;
	if (leafIntercomTarget) summary.leafIntercomTarget = leafIntercomTarget;
	if (raw.ownerState === "live" || raw.ownerState === "gone" || raw.ownerState === "unknown") {
		summary.ownerState = raw.ownerState;
	}
	if (controlInbox) summary.controlInbox = controlInbox;
	if (capabilityToken) summary.capabilityToken = capabilityToken;
	if (raw.mode === "single" || raw.mode === "parallel") summary.mode = raw.mode;
	if (agent) summary.agent = agent;
	if (Array.isArray(raw.agents)) {
		summary.agents = raw.agents
			.map((candidate) => stringValue(candidate, 128))
			.filter((candidate): candidate is string => Boolean(candidate))
			.slice(0, MAX_STEPS);
	}
	if (currentStep !== undefined) summary.currentStep = currentStep;
	if (parallelGroups?.length) summary.parallelGroups = parallelGroups;
	if (raw.activityState === "active_long_running" || raw.activityState === "needs_attention") {
		summary.activityState = raw.activityState;
	}
	if (lastActivityAt !== undefined) summary.lastActivityAt = lastActivityAt;
	if (currentTool) summary.currentTool = currentTool;
	if (currentToolStartedAt !== undefined) summary.currentToolStartedAt = currentToolStartedAt;
	if (currentPath) summary.currentPath = currentPath;
	if (turnCount !== undefined) summary.turnCount = turnCount;
	if (toolCount !== undefined) summary.toolCount = toolCount;
	if (totalTokens) summary.totalTokens = totalTokens;
	if (totalCost) summary.totalCost = totalCost;
	if (startedAt !== undefined) summary.startedAt = startedAt;
	if (endedAt !== undefined) summary.endedAt = endedAt;
	if (lastUpdate !== undefined) summary.lastUpdate = lastUpdate;
	if (timeoutMs !== undefined) summary.timeoutMs = timeoutMs;
	if (deadlineAt !== undefined) summary.deadlineAt = deadlineAt;
	if (raw.timedOut === true) summary.timedOut = true;
	if (raw.stopped === true) summary.stopped = true;
	if (turnBudget) summary.turnBudget = turnBudget;
	if (raw.turnBudgetExceeded === true) summary.turnBudgetExceeded = true;
	if (raw.wrapUpRequested === true) summary.wrapUpRequested = true;
	if (toolBudget) summary.toolBudget = toolBudget;
	if (raw.toolBudgetBlocked === true) summary.toolBudgetBlocked = true;
	if (processTerminal) summary.processTerminal = processTerminal;
	if (capabilityCeiling) summary.capabilityCeiling = capabilityCeiling;
	if (capabilityAudit) summary.capabilityAudit = capabilityAudit;
	if (error) summary.error = error;
	if (steps && steps.length > 0) summary.steps = steps;
	if (depth < MAX_DEPTH && Array.isArray(raw.children)) {
		summary.children = raw.children
			.map((child) => sanitizeSummary(child, depth + 1))
			.filter((child): child is NestedRunSummary => Boolean(child))
			.slice(0, MAX_CHILDREN);
	}
	// SAFETY: all required NestedRunSummary fields are assigned after id and parentRunId pass safe-id validation.
	return summary as NestedRunSummary;
}

function truncateUtf8(value: string | undefined, maxBytes: number): string | undefined {
	if (!value) return undefined;
	if (Buffer.byteLength(value, "utf-8") <= maxBytes) return value;
	let end = Math.min(value.length, maxBytes);
	while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf-8") > maxBytes) end -= 1;
	return end > 0 ? value.slice(0, end) : undefined;
}

function exactBoundedLocator(value: string | undefined, maxBytes: number): string | undefined {
	return value && Buffer.byteLength(value, "utf-8") <= maxBytes ? value : undefined;
}

function externalWriterCrash(processTerminal: NestedStepSummary["processTerminal"]): boolean {
	if (processTerminal?.state !== "observed") return false;
	const writers = processTerminal.instances.filter(
		(instance): instance is Extract<(typeof processTerminal.instances)[number], { kind: "pi-writer" }> =>
			instance.kind === "pi-writer",
	);
	const finalAttempt = writers.reduce((latest, instance) => Math.max(latest, instance.attempt), -1);
	return writers.some((instance) => instance.attempt === finalAttempt && instance.terminationOrigin === "external");
}

/**
 * Nested event files are a bounded projection, not the durable transcript or
 * capability authority. Keep every child and its inspectable transcript
 * references while removing repeated capability/tool lists that remain in the
 * child's own status file.
 */
function compactStepForTransport(step: NestedStepSummary, includeChildren: boolean): NestedStepSummary {
	const {
		capabilityAudit: _capabilityAudit,
		capabilityCeiling: _capabilityCeiling,
		children: _children,
		currentPath: _currentPath,
		delegatedTask: _delegatedTask,
		description: _description,
		error: _error,
		processTerminal: _processTerminal,
		sessionFile: _sessionFile,
		task: _task,
		toolBudget: _toolBudget,
		transcriptError: _transcriptError,
		transcriptPath: _transcriptPath,
		...base
	} = step;
	const sessionFile = exactBoundedLocator(step.sessionFile, 768);
	const transcriptPath = exactBoundedLocator(step.transcriptPath, 768);
	const locatorOmitted = (step.sessionFile && !sessionFile) || (step.transcriptPath && !transcriptPath);
	const transcriptError = locatorOmitted
		? "Transcript locator omitted from the bounded nested projection; inspect the child status artifact."
		: truncateUtf8(step.transcriptError, 256);
	const compact: NestedStepSummary = { ...base };
	const delegatedTask = truncateUtf8(step.delegatedTask, 512);
	const task = truncateUtf8(step.task, 512);
	const description = truncateUtf8(step.description, 256);
	const currentPath = truncateUtf8(step.currentPath, 256);
	const error = truncateUtf8(step.error, 256);
	if (delegatedTask) compact.delegatedTask = delegatedTask;
	if (task) compact.task = task;
	if (description) compact.description = description;
	if (step.agentStatus === "crashed" || externalWriterCrash(step.processTerminal)) compact.agentStatus = "crashed";
	if (sessionFile) compact.sessionFile = sessionFile;
	if (transcriptPath) compact.transcriptPath = transcriptPath;
	if (transcriptError) compact.transcriptError = transcriptError;
	if (currentPath) compact.currentPath = currentPath;
	if (error) compact.error = error;
	if (includeChildren && step.children?.length) {
		compact.children = step.children.slice(-MAX_CHILDREN).map((child) => compactSummaryForTransport(child, true));
	}
	return compact;
}

function compactSummaryForTransport(summary: NestedRunSummary, includeChildren: boolean): NestedRunSummary {
	const {
		asyncDir: _asyncDir,
		capabilityAudit: _capabilityAudit,
		capabilityCeiling: _capabilityCeiling,
		children: _children,
		controlInbox: _controlInbox,
		currentPath: _currentPath,
		error: _error,
		processTerminal: _processTerminal,
		sessionFile: _sessionFile,
		steps: _steps,
		toolBudget: _toolBudget,
		...base
	} = summary;
	const asyncDir = exactBoundedLocator(summary.asyncDir, 768);
	const sessionFile = exactBoundedLocator(summary.sessionFile, 768);
	const controlInbox = exactBoundedLocator(summary.controlInbox, 768);
	const compact: NestedRunSummary = { ...base };
	const currentPath = truncateUtf8(summary.currentPath, 256);
	const error = truncateUtf8(summary.error, 256);
	if (summary.agentStatus === "crashed" || externalWriterCrash(summary.processTerminal))
		compact.agentStatus = "crashed";
	if (asyncDir) compact.asyncDir = asyncDir;
	if (sessionFile) compact.sessionFile = sessionFile;
	if (controlInbox) compact.controlInbox = controlInbox;
	if (currentPath) compact.currentPath = currentPath;
	if (error) compact.error = error;
	if (summary.steps?.length) {
		compact.steps = summary.steps.slice(0, MAX_STEPS).map((step) => compactStepForTransport(step, includeChildren));
	}
	if (includeChildren && summary.children?.length) {
		compact.children = summary.children.slice(-MAX_CHILDREN).map((child) => compactSummaryForTransport(child, true));
	}
	return compact;
}

function registryJsonBytes(registry: NestedRegistry): number {
	return Buffer.byteLength(JSON.stringify(registry, null, 2), "utf-8");
}

function compactSummaryForRegistry(summary: NestedRunSummary, remainingDepth: number): NestedRunSummary {
	const compact = compactSummaryForTransport(summary, false);
	if (summary.children?.length) {
		compact.children = summary.children
			.slice(-MAX_CHILDREN)
			.map((child) =>
				remainingDepth > 0 ? compactSummaryForRegistry(child, remainingDepth - 1) : skeletonSummary(child),
			);
	}
	if (remainingDepth > 0 && summary.steps?.length) {
		compact.steps = summary.steps.slice(0, MAX_STEPS).map((step) => {
			const compactStep = compactStepForTransport(step, false);
			if (step.children?.length) {
				compactStep.children = step.children
					.slice(-MAX_CHILDREN)
					.map((child) => compactSummaryForRegistry(child, remainingDepth - 1));
			}
			return compactStep;
		});
	}
	return compact;
}

function skeletonSummary(summary: NestedRunSummary): NestedRunSummary {
	const skeleton: Partial<NestedRunSummary> = { id: summary.id };
	if (summary.parentRunOrigin) skeleton.parentRunOrigin = summary.parentRunOrigin;
	skeleton.parentRunId = summary.parentRunId;
	if (summary.parentStepIndex !== undefined) skeleton.parentStepIndex = summary.parentStepIndex;
	if (summary.parentAgent) skeleton.parentAgent = summary.parentAgent;
	skeleton.depth = summary.depth;
	skeleton.path = summary.path;
	skeleton.state = summary.state;
	if (summary.ownerState) skeleton.ownerState = summary.ownerState;
	if (summary.agent) skeleton.agent = summary.agent;
	if (summary.agents?.length) skeleton.agents = summary.agents.slice(0, MAX_STEPS);
	if (summary.startedAt !== undefined) skeleton.startedAt = summary.startedAt;
	if (summary.endedAt !== undefined) skeleton.endedAt = summary.endedAt;
	if (summary.lastUpdate !== undefined) skeleton.lastUpdate = summary.lastUpdate;
	if (summary.agentStatus === "crashed") skeleton.agentStatus = "crashed";
	const asyncDir = exactBoundedLocator(summary.asyncDir, 768);
	const controlInbox = exactBoundedLocator(summary.controlInbox, 768);
	if (asyncDir) skeleton.asyncDir = asyncDir;
	if (controlInbox) skeleton.controlInbox = controlInbox;
	if (summary.capabilityToken) skeleton.capabilityToken = summary.capabilityToken;
	if (summary.children?.length) {
		skeleton.children = summary.children.slice(-MAX_CHILDREN).map(skeletonSummary);
	}
	// SAFETY: the required summary address and state fields are copied before every return.
	return skeleton as NestedRunSummary;
}

function boundedRegistry(registry: NestedRegistry): NestedRegistry {
	for (let depth = MAX_DEPTH; depth >= 0; depth -= 1) {
		const bounded = {
			...registry,
			children: registry.children.slice(-MAX_CHILDREN).map((child) => compactSummaryForRegistry(child, depth)),
			pendingChildren: registry.pendingChildren
				.slice(-MAX_CHILDREN)
				.map((child) => compactSummaryForRegistry(child, depth)),
			processedEvents: registry.processedEvents.slice(-MAX_PROCESSED_EVENTS),
		};
		if (registryJsonBytes(bounded) <= MAX_REGISTRY_BYTES) return bounded;
	}
	// The legal forest cardinality must remain live even when every optional
	// projection field is maximally sized. Preserve every canonical node as a
	// small skeleton instead of retrying the same oversized event forever.
	return {
		...registry,
		children: registry.children.slice(-MAX_CHILDREN).map(skeletonSummary),
		pendingChildren: registry.pendingChildren.slice(-MAX_CHILDREN).map(skeletonSummary),
		processedEvents: registry.processedEvents.slice(-Math.min(MAX_PROCESSED_EVENTS, 200)),
	};
}

function parseRecord(content: string, route: NestedRoute): NestedEventRecord | undefined {
	if (Buffer.byteLength(content, "utf-8") > MAX_EVENT_BYTES) return undefined;
	let parsed: JsonValue;
	try {
		parsed = parseJsonValue(content);
	} catch {
		return undefined;
	}
	if (!parsed || !isRuntimeObject(parsed)) return undefined;
	// SAFETY: the parsed non-null JSON object can be inspected through the event schema's optional raw fields.
	const raw = parsed as RawNestedEvent;
	if (
		raw.type !== "subagent.nested.started" &&
		raw.type !== "subagent.nested.updated" &&
		raw.type !== "subagent.nested.completed"
	)
		return undefined;
	if (raw.rootRunId !== route.rootRunId || raw.capabilityToken !== route.capabilityToken) return undefined;
	if (!isSafeNestedId(raw.parentRunId)) return undefined;
	const parentStepIndex = clampNumber(raw.parentStepIndex);
	if (
		raw.parentStepIndex !== undefined &&
		(parentStepIndex === undefined || !Number.isSafeInteger(parentStepIndex) || parentStepIndex < 0)
	)
		return undefined;
	const ts = clampNumber(raw.ts);
	if (ts === undefined) return undefined;
	const child = sanitizeSummary(raw.child);
	if (!child || child.id === route.rootRunId) return undefined;
	if (child.parentRunId !== raw.parentRunId || child.parentStepIndex !== parentStepIndex) return undefined;
	const routedChild: NestedRunSummary = {
		...child,
		controlInbox: route.controlInbox,
		capabilityToken: route.capabilityToken,
		ownerState: child.ownerState ?? "unknown",
	};
	const record: NestedEventRecord = {
		type: raw.type,
		ts,
		rootRunId: route.rootRunId,
		parentRunId: raw.parentRunId,
		capabilityToken: route.capabilityToken,
		child: routedChild,
	};
	if (parentStepIndex !== undefined) record.parentStepIndex = parentStepIndex;
	return record;
}

export function parseNestedEventRecords(content: string, route: NestedRoute): NestedEventRecord[] {
	if (!content.includes("\n")) {
		const record = parseRecord(content.trim(), route);
		return record ? [record] : [];
	}
	return content
		.split("\n")
		.slice(0, content.endsWith("\n") ? undefined : -1)
		.map((line) => (line.trim() ? parseRecord(line, route) : undefined))
		.filter((event): event is NestedEventRecord => Boolean(event));
}

function terminal(state: NestedRunState): boolean {
	return state === "complete" || state === "failed" || state === "paused" || state === "stopped";
}

function mergedParentRunOrigin(
	existing: NestedRunSummary["parentRunOrigin"],
	incoming: NestedRunSummary["parentRunOrigin"],
): NestedRunSummary["parentRunOrigin"] {
	if (existing === "user" || incoming === "user") return "user";
	return existing ?? incoming;
}

function withMergedParentRunOrigin(
	summary: NestedRunSummary,
	existing: NestedRunSummary["parentRunOrigin"],
	incoming: NestedRunSummary["parentRunOrigin"],
): NestedRunSummary {
	const parentRunOrigin = mergedParentRunOrigin(existing, incoming);
	return parentRunOrigin && summary.parentRunOrigin !== parentRunOrigin ? { ...summary, parentRunOrigin } : summary;
}

function mergeSummary(existing: NestedRunSummary | undefined, event: NestedEventRecord): NestedRunSummary {
	const incomingState =
		event.type === "subagent.nested.completed" && event.child.state === "running" ? "complete" : event.child.state;
	const incoming = { ...event.child, state: incomingState, lastUpdate: event.child.lastUpdate ?? event.ts };
	if (!existing) return incoming;
	const existingUpdate = existing.lastUpdate ?? 0;
	const incomingUpdate = incoming.lastUpdate ?? event.ts;
	if (incomingUpdate < existingUpdate)
		return withMergedParentRunOrigin(existing, existing.parentRunOrigin, incoming.parentRunOrigin);
	if (terminal(existing.state) && !terminal(incoming.state))
		return withMergedParentRunOrigin(existing, existing.parentRunOrigin, incoming.parentRunOrigin);
	if (terminal(existing.state) && terminal(incoming.state) && incomingUpdate === existingUpdate)
		return withMergedParentRunOrigin(existing, existing.parentRunOrigin, incoming.parentRunOrigin);
	return withMergedParentRunOrigin(
		{ ...existing, ...incoming, state: incoming.state, lastUpdate: Math.max(existingUpdate, incomingUpdate) },
		existing.parentRunOrigin,
		incoming.parentRunOrigin,
	);
}

function mergeStoredSummary(existing: NestedRunSummary | undefined, incoming: NestedRunSummary): NestedRunSummary {
	if (!existing) return incoming;
	const existingUpdate = existing.lastUpdate ?? 0;
	const incomingUpdate = incoming.lastUpdate ?? 0;
	if (incomingUpdate < existingUpdate)
		return withMergedParentRunOrigin(existing, existing.parentRunOrigin, incoming.parentRunOrigin);
	if (terminal(existing.state) && !terminal(incoming.state))
		return withMergedParentRunOrigin(existing, existing.parentRunOrigin, incoming.parentRunOrigin);
	return withMergedParentRunOrigin(
		{ ...existing, ...incoming, lastUpdate: Math.max(existingUpdate, incomingUpdate) },
		existing.parentRunOrigin,
		incoming.parentRunOrigin,
	);
}

function canonicalNestedForest(
	rootRunId: string,
	children: NestedRunSummary[],
	pendingChildren: NestedRunSummary[],
	incoming: NestedRunSummary,
): Pick<NestedRegistry, "children" | "pendingChildren"> {
	const summaries = new Map<string, NestedRunSummary>();
	const collect = (run: NestedRunSummary): void => {
		const nested = [...(run.children ?? []), ...(run.steps?.flatMap((step) => step.children ?? []) ?? [])];
		const stripped: NestedRunSummary = {
			...run,
			children: undefined,
		};
		if (run.steps) stripped.steps = run.steps.map((step) => ({ ...step, children: undefined }));
		summaries.set(run.id, mergeStoredSummary(summaries.get(run.id), stripped));
		for (const child of nested) collect(child);
	};
	for (const run of [...children, ...pendingChildren, incoming]) collect(run);

	const retained = [...summaries.values()]
		.sort((left, right) => {
			const leftLive = terminal(left.state) ? 1 : 0;
			const rightLive = terminal(right.state) ? 1 : 0;
			return (
				leftLive - rightLive || (right.lastUpdate ?? 0) - (left.lastUpdate ?? 0) || left.id.localeCompare(right.id)
			);
		})
		.slice(0, MAX_CHILDREN);
	const nodes = new Map(
		retained.map((run) => {
			const children: NestedRunSummary[] = [];
			const entry: [string, NestedRunSummary] = [run.id, { ...run, children }];
			return entry;
		}),
	);
	const wouldCycle = (run: NestedRunSummary): boolean => {
		const seen = new Set([run.id]);
		let parentId = run.parentRunId;
		while (parentId !== rootRunId) {
			if (seen.has(parentId)) return true;
			seen.add(parentId);
			const parent = nodes.get(parentId);
			if (!parent) return false;
			parentId = parent.parentRunId;
		}
		return false;
	};
	const roots: NestedRunSummary[] = [];
	const pending: NestedRunSummary[] = [];
	for (const run of nodes.values()) {
		if (run.parentRunId === rootRunId) {
			roots.push(run);
			continue;
		}
		const parent = nodes.get(run.parentRunId);
		if (!parent || wouldCycle(run)) {
			pending.push(run);
			continue;
		}
		parent.children = [...(parent.children ?? []), run].slice(-MAX_CHILDREN);
	}
	const stable = (left: NestedRunSummary, right: NestedRunSummary) =>
		(left.startedAt ?? left.lastUpdate ?? 0) - (right.startedAt ?? right.lastUpdate ?? 0) ||
		left.id.localeCompare(right.id);
	const sortTree = (run: NestedRunSummary): NestedRunSummary => {
		const sorted = { ...run };
		sorted.children = run.children?.length ? run.children.map(sortTree).sort(stable) : undefined;
		return sorted;
	};
	return {
		children: roots.map(sortTree).sort(stable),
		pendingChildren: pending.map(sortTree).sort(stable),
	};
}

export function applyNestedEvent(registry: NestedRegistry, event: NestedEventRecord): NestedRegistry {
	const existing = findNestedRun([...registry.children, ...registry.pendingChildren], event.child.id);
	const child = mergeSummary(existing, event);
	return {
		...registry,
		updatedAt: Math.max(registry.updatedAt, event.ts),
		...canonicalNestedForest(registry.rootRunId, registry.children, registry.pendingChildren, child),
	};
}

function registryPath(route: NestedRoute): string {
	return path.join(commonRouteRoot(route), REGISTRY_FILE);
}

function sameRegistryFingerprint(stat: fs.Stats, fingerprint: NestedRegistryFingerprint): boolean {
	return (
		stat.dev === fingerprint.dev &&
		stat.ino === fingerprint.ino &&
		stat.size === fingerprint.size &&
		stat.ctimeMs === fingerprint.ctimeMs &&
		stat.mtimeMs === fingerprint.mtimeMs
	);
}

function forgetNestedRegistry(filePath: string): void {
	const cached = nestedRegistryCache.get(filePath);
	if (!cached) return;
	nestedRegistryCache.delete(filePath);
	nestedRegistryCacheWeightBytes = Math.max(0, nestedRegistryCacheWeightBytes - cached.weightBytes);
}

function cachedNestedRegistry(filePath: string): NestedRegistry | undefined {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(filePath);
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") {
			forgetNestedRegistry(filePath);
			return undefined;
		}
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`Agent runtime file '${filePath}' must be a regular file.`);
	}
	const currentUid = process.getuid?.();
	if (currentUid !== undefined && stat.uid !== currentUid) {
		throw new Error(`Agent runtime file '${filePath}' is owned by another user.`);
	}
	if (stat.size > MAX_REGISTRY_BYTES) {
		throw new Error(`Agent runtime file '${filePath}' exceeds the ${MAX_REGISTRY_BYTES}-byte limit.`);
	}

	const cached = nestedRegistryCache.get(filePath);
	if (!cached) return undefined;
	if (!sameRegistryFingerprint(stat, cached.fingerprint)) {
		forgetNestedRegistry(filePath);
		return undefined;
	}

	// Refresh insertion order to make the fixed-size map a simple LRU.
	nestedRegistryCache.delete(filePath);
	nestedRegistryCache.set(filePath, cached);
	return cached.registry;
}

function rememberNestedRegistry(filePath: string, snapshot: NestedRegistryFingerprint, registry: NestedRegistry): void {
	forgetNestedRegistry(filePath);
	const weightBytes = Math.max(
		MIN_REGISTRY_CACHE_ENTRY_WEIGHT_BYTES,
		snapshot.size * REGISTRY_CACHE_OBJECT_WEIGHT_MULTIPLIER,
	);
	nestedRegistryCache.set(filePath, { fingerprint: snapshot, registry, weightBytes });
	nestedRegistryCacheWeightBytes += weightBytes;
	while (
		nestedRegistryCache.size > MAX_REGISTRY_CACHE_ENTRIES ||
		nestedRegistryCacheWeightBytes > MAX_REGISTRY_CACHE_WEIGHT_BYTES
	) {
		const oldest = nestedRegistryCache.keys().next().value;
		if (oldest === undefined) break;
		forgetNestedRegistry(oldest);
	}
}

function nestedRouteEntries(): string[] {
	try {
		assertPrivateDirectory(TEMP_ROOT_DIR);
		assertPrivateDirectory(NESTED_EVENTS_DIR);
		return fs.readdirSync(NESTED_EVENTS_DIR);
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
}

function routeFromRoot(routeRoot: string): NestedRoute | undefined {
	try {
		assertPrivateDirectory(routeRoot);
		const metadata = parseJsonValue(readBoundedOwnedFile(path.join(routeRoot, ROUTE_FILE), MAX_ROUTE_METADATA_BYTES));
		if (!isRuntimeObject(metadata) || metadata === null || Array.isArray(metadata)) return undefined;
		if (!isSafeNestedId(metadata.rootRunId) || !isSafeNestedId(metadata.capabilityToken)) return undefined;
		if (path.basename(routeRoot) !== `${metadata.rootRunId}-${metadata.capabilityToken}`) return undefined;
		const route: NestedRoute = {
			rootRunId: metadata.rootRunId,
			eventSink: path.join(routeRoot, "events"),
			controlInbox: path.join(routeRoot, "controls"),
			capabilityToken: metadata.capabilityToken,
		};
		validateRouteStorage(route);
		return route;
	} catch {
		return undefined;
	}
}

export function findNestedRouteForRootId(rootRunId: string): NestedRoute | undefined {
	assertSafeId("rootRunId", rootRunId);
	for (const entry of nestedRouteEntries()) {
		if (!entry.startsWith(`${rootRunId}-`)) continue;
		const route = routeFromRoot(path.join(NESTED_EVENTS_DIR, entry));
		if (route?.rootRunId === rootRunId) return route;
	}
	return undefined;
}

/**
 * Scan the nested-events directory once and index every route by its root run
 * id. Use this when resolving routes for many runs (e.g. listAsyncRuns) so the
 * cost is O(routes) total instead of O(runs * routes) from calling
 * findNestedRouteForRootId per run.
 */
export function buildNestedRouteIndex(): Map<string, NestedRoute> {
	const index = new Map<string, NestedRoute>();
	for (const entry of nestedRouteEntries()) {
		const route = routeFromRoot(path.join(NESTED_EVENTS_DIR, entry));
		if (route && !index.has(route.rootRunId)) index.set(route.rootRunId, route);
	}
	return index;
}

export function projectNestedRegistryForRoot(rootRunId: string): NestedRegistry | undefined {
	const route = findNestedRouteForRootId(rootRunId);
	return route ? projectNestedEvents(route) : undefined;
}

export async function projectNestedRegistryForRootAuthoritatively(
	rootRunId: string,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<NestedRegistry | undefined> {
	const route = findNestedRouteForRootId(rootRunId);
	return route ? projectNestedEventsAuthoritatively(route, options) : undefined;
}

export function findNestedRun(children: NestedRunSummary[] | undefined, id: string): NestedRunSummary | undefined {
	if (!children?.length) return undefined;
	for (const child of children) {
		if (child.id === id) return child;
		const nested =
			findNestedRun(child.children, id) ??
			findNestedRun(
				child.steps?.flatMap((step) => step.children ?? []),
				id,
			);
		if (nested) return nested;
	}
	return undefined;
}

export interface NestedRunMatch {
	rootRunId: string;
	route: NestedRoute;
	run: NestedRunSummary;
}

export interface NestedRunResolutionScope {
	routes: NestedRoute[];
	descendantOf?: { parentRunId: string; parentStepIndex?: number };
}

function collectNestedRuns(
	children: NestedRunSummary[] | undefined,
	output: NestedRunSummary[] = [],
): NestedRunSummary[] {
	for (const child of children ?? []) {
		output.push(child);
		collectNestedRuns(child.children, output);
		collectNestedRuns(
			child.steps?.flatMap((step) => step.children ?? []),
			output,
		);
	}
	return output;
}

function collectScopedNestedRuns(
	children: NestedRunSummary[] | undefined,
	scope: NestedRunResolutionScope["descendantOf"],
	output: NestedRunSummary[] = [],
): NestedRunSummary[] {
	if (!scope) return collectNestedRuns(children, output);
	for (const child of children ?? []) {
		if (
			child.parentRunId === scope.parentRunId &&
			(scope.parentStepIndex === undefined || child.parentStepIndex === scope.parentStepIndex)
		) {
			collectNestedRuns([child], output);
			continue;
		}
		collectScopedNestedRuns(child.children, scope, output);
		collectScopedNestedRuns(
			child.steps?.flatMap((step) => step.children ?? []),
			scope,
			output,
		);
	}
	return output;
}

function listNestedRoutes(): NestedRoute[] {
	const routes: NestedRoute[] = [];
	for (const entry of nestedRouteEntries()) {
		const route = routeFromRoot(path.join(NESTED_EVENTS_DIR, entry));
		if (route) routes.push(route);
	}
	return routes;
}

function collectMatchesFromRegistry(
	matches: NestedRunMatch[],
	route: NestedRoute,
	registry: NestedRegistry,
	id: string,
	options: { prefix?: boolean; scope?: NestedRunResolutionScope },
): void {
	for (const run of collectScopedNestedRuns(registry.children, options.scope?.descendantOf)) {
		if (options.prefix ? run.id.startsWith(id) : run.id === id) {
			matches.push({ rootRunId: route.rootRunId, route, run });
		}
	}
}

export function findNestedRunMatchesById(
	id: string,
	options: { prefix?: boolean; scope?: NestedRunResolutionScope } = {},
): NestedRunMatch[] {
	assertSafeId("id", id);
	const matches: NestedRunMatch[] = [];
	for (const route of options.scope?.routes ?? listNestedRoutes()) {
		try {
			const registry = projectNestedEvents(route);
			collectMatchesFromRegistry(matches, route, registry, id, options);
		} catch {}
	}
	return matches;
}

/** Resolve a control target without treating another projector's live claim as an empty registry. */
export async function findNestedRunMatchesByIdAuthoritatively(
	id: string,
	options: { prefix?: boolean; scope?: NestedRunResolutionScope; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<NestedRunMatch[]> {
	assertSafeId("id", id);
	const routes = options.scope?.routes ?? listNestedRoutes();
	const deadline = Date.now() + (options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS);
	const matches: NestedRunMatch[] = [];
	for (const route of routes) {
		const remaining = Math.max(0, deadline - Date.now());
		const registry = await projectNestedEventsAuthoritatively(route, {
			timeoutMs: remaining,
			signal: options.signal,
		});
		collectMatchesFromRegistry(matches, route, registry, id, options);
	}
	return matches;
}

export function findNestedRunById(id: string): { rootRunId: string; run: NestedRunSummary } | undefined {
	const match = findNestedRunMatchesById(id)[0];
	return match ? { rootRunId: match.rootRunId, run: match.run } : undefined;
}

export function readNestedRegistry(route: NestedRoute): NestedRegistry {
	validateRouteStorage(route);
	const filePath = registryPath(route);
	const cached = cachedNestedRegistry(filePath);
	if (cached) return cached;
	try {
		const snapshot = readBoundedOwnedFileSnapshot(filePath, MAX_REGISTRY_BYTES);
		const parsed = parseJsonValue(snapshot.text);
		if (!isRuntimeObject(parsed) || parsed === null || Array.isArray(parsed)) {
			throw new Error("Nested registry is not an object.");
		}
		// SAFETY: the parsed JSON object can be inspected through the registry schema's optional raw fields.
		const raw = parsed as RawNestedRegistry;
		if (raw.rootRunId !== route.rootRunId) {
			throw new Error("Nested registry root id does not match its route metadata.");
		}
		const registry = {
			rootRunId: route.rootRunId,
			updatedAt: isRuntimeNumber(raw.updatedAt) ? raw.updatedAt : 0,
			children: Array.isArray(raw.children)
				? raw.children
						.map((child) => sanitizeSummary(child))
						.filter((child): child is NestedRunSummary => Boolean(child))
				: [],
			pendingChildren: Array.isArray(raw.pendingChildren)
				? raw.pendingChildren
						.map((child) => sanitizeSummary(child))
						.filter((child): child is NestedRunSummary => Boolean(child))
				: [],
			processedEvents: Array.isArray(raw.processedEvents)
				? raw.processedEvents
						.filter(
							(item): item is string =>
								isRuntimeString(item) && path.basename(item) === item && item.length <= 256,
						)
						.slice(-MAX_PROCESSED_EVENTS)
				: [],
		};
		// Deliberately construct a text-free fingerprint. Passing the complete
		// snapshot would retain the raw JSON alongside the parsed registry.
		rememberNestedRegistry(
			filePath,
			{
				ctimeMs: snapshot.ctimeMs,
				dev: snapshot.dev,
				ino: snapshot.ino,
				mtimeMs: snapshot.mtimeMs,
				size: snapshot.size,
			},
			registry,
		);
		return registry;
	} catch (error) {
		if (!isRuntimeObject(error) || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
		forgetNestedRegistry(filePath);
		return {
			rootRunId: route.rootRunId,
			updatedAt: 0,
			children: [],
			pendingChildren: [],
			processedEvents: [],
		};
	}
}

function discardInvalidImmutableEvent(eventPath: string, onlyStructurallyUnsafe = false): boolean {
	try {
		const stat = fs.lstatSync(eventPath);
		const currentUid = process.getuid?.();
		if (currentUid !== undefined && stat.uid !== currentUid) return false;
		if (!stat.isFile() && !stat.isSymbolicLink()) return false;
		if (onlyStructurallyUnsafe && !stat.isSymbolicLink() && stat.size <= MAX_EVENT_BYTES) return false;
		fs.unlinkSync(eventPath);
		return true;
	} catch (error) {
		return isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT";
	}
}

function projectNestedEventBatch(route: NestedRoute, registry: NestedRegistry) {
	const seen = new Set(registry.processedEvents);
	let changed = false;
	let entries: string[] = [];
	try {
		entries = fs
			.readdirSync(route.eventSink)
			.filter((entry) => entry.endsWith(".json") || entry.endsWith(".jsonl"))
			.sort()
			.filter((entry) => !seen.has(entry))
			.slice(0, MAX_EVENT_FILES_PER_PROJECTION);
	} catch (error) {
		if (!isRuntimeObject(error) || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	for (const entry of entries) {
		const eventPath = path.join(route.eventSink, entry);
		if (!containedPath(route.eventSink, eventPath)) continue;
		let content: string;
		try {
			content = readBoundedOwnedFile(eventPath, MAX_EVENT_BYTES);
		} catch {
			if (discardInvalidImmutableEvent(eventPath, true)) {
				seen.add(entry);
				changed = true;
			}
			continue;
		}
		const records = parseNestedEventRecords(content, route);
		if (records.length === 0) {
			if (discardInvalidImmutableEvent(eventPath)) {
				seen.add(entry);
				changed = true;
			}
			continue;
		}
		for (const event of records) {
			registry = applyNestedEvent(registry, event);
			changed = true;
		}
		seen.add(entry);
		changed = true;
	}
	if (changed) {
		const processedEvents = [...seen];
		const retainedEvents = processedEvents.slice(-MAX_PROCESSED_EVENTS);
		registry = boundedRegistry({ ...registry, processedEvents: retainedEvents });
		const retainedSet = new Set(registry.processedEvents);
		const evictedEvents = processedEvents.filter((entry) => !retainedSet.has(entry));
		// This route-level claim covers the complete read→project→write→cleanup
		// transaction across root, runner, and owner Pi processes.
		writePrivateAtomicJson(registryPath(route), registry);

		// Remove immutable records only after their projection is durable.
		for (const entry of evictedEvents) {
			const eventPath = path.join(route.eventSink, entry);
			if (!containedPath(route.eventSink, eventPath)) continue;
			try {
				fs.unlinkSync(eventPath);
			} catch {
				// Cleanup is best-effort; the retained cursor remains authoritative.
			}
		}
	}
	return { registry, entriesRead: entries.length };
}

function projectNestedEventsUnderClaim(
	route: NestedRoute,
	options: { drain?: boolean; deadline?: number } = {},
): NestedRegistry {
	let registry = readNestedRegistry(route);
	for (;;) {
		const batch = projectNestedEventBatch(route, registry);
		registry = batch.registry;
		if (!options.drain || batch.entriesRead < MAX_EVENT_FILES_PER_PROJECTION) return registry;
		if (options.deadline !== undefined && Date.now() >= options.deadline) {
			throw new Error(
				`Nested registry for '${route.rootRunId}' could not drain all pending events before its authoritative deadline.`,
			);
		}
	}
}

function projectNestedEventsWithClaim(
	route: NestedRoute,
	claim: DurableClaim,
	options: { drain?: boolean; deadline?: number } = {},
): NestedRegistry {
	try {
		return projectNestedEventsUnderClaim(route, options);
	} finally {
		claim.release();
	}
}

/**
 * Best-effort projection for status and UI refreshes. If another process owns
 * the projector claim, return the last durable snapshot without blocking the
 * interactive host.
 */
export function projectNestedEvents(route: NestedRoute): NestedRegistry {
	validateRouteStorage(route);
	const claim = tryAcquireDurableClaim(commonRouteRoot(route), REGISTRY_LOCK);
	return claim ? projectNestedEventsWithClaim(route, claim) : readNestedRegistry(route);
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Nested registry projection was aborted.");
}

function waitForProjectionRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(signal ? abortReason(signal) : new Error("Nested registry projection was aborted."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function routeHasRetainedState(route: NestedRoute): boolean {
	if (fs.readdirSync(route.eventSink).length > 0 || fs.readdirSync(route.controlInbox).length > 0) return true;
	const routeRoot = commonRouteRoot(route);
	const allowed = new Set([
		ROUTE_FILE,
		REGISTRY_FILE,
		ROOT_TERMINAL_FILE,
		`${REGISTRY_LOCK}.lock`,
		"events",
		"controls",
	]);
	if (fs.readdirSync(routeRoot).some((entry) => !allowed.has(entry))) return true;
	try {
		const registry = readNestedRegistry(route);
		return registry.children.length > 0 || registry.pendingChildren.length > 0 || registry.processedEvents.length > 0;
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") return false;
		return true;
	}
}

/**
 * Retire the exact capability-owned route after its root run has durably
 * terminalized. Renaming while holding the projector claim makes stale route
 * users fail closed; the moved inode is removed only after the claim is closed.
 */
export async function retireUnusedNestedRoute(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<boolean> {
	validateRouteStorage(route);
	const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new Error("Nested route retirement timeout must be a finite non-negative number.");
	}
	const deadline = Date.now() + timeoutMs;
	const routeRoot = commonRouteRoot(route);
	for (;;) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const claim = tryAcquireDurableClaim(routeRoot, REGISTRY_LOCK);
		if (claim) {
			let retiredRoot: string | undefined;
			try {
				validateRouteStorage(route);
				if (routeHasRetainedState(route)) return false;
				const before = fs.lstatSync(routeRoot);
				retiredRoot = path.join(NESTED_EVENTS_DIR, `.retired-${path.basename(routeRoot)}-${claim.token}`);
				fs.renameSync(routeRoot, retiredRoot);
				forgetNestedRegistry(registryPath(route));
				const moved = fs.lstatSync(retiredRoot);
				if (!moved.isDirectory() || moved.dev !== before.dev || moved.ino !== before.ino) {
					throw new Error("Nested route inode changed during retirement.");
				}
			} finally {
				claim.release();
			}
			if (retiredRoot) fs.rmSync(retiredRoot, { recursive: true });
			return Boolean(retiredRoot);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) return false;
		await waitForProjectionRetry(Math.min(AUTHORITATIVE_PROJECTION_RETRY_MS, remaining), options.signal);
	}
}

interface NestedRootTerminalMarker {
	readonly version: 1;
	readonly rootRunId: string;
	readonly capabilityToken: string;
	readonly rootAsyncDir: string;
	readonly committedAt: number;
}

function readRootTerminalMarker(route: NestedRoute): NestedRootTerminalMarker | undefined {
	try {
		const marker = parseJsonValue(
			readBoundedOwnedFile(path.join(commonRouteRoot(route), ROOT_TERMINAL_FILE), MAX_ROUTE_METADATA_BYTES),
		);
		if (!isRuntimeObject(marker) || marker === null || Array.isArray(marker)) return undefined;
		if (
			marker.version === 1 &&
			marker.rootRunId === route.rootRunId &&
			marker.capabilityToken === route.capabilityToken &&
			isRuntimeString(marker.rootAsyncDir) &&
			isRuntimeNumber(marker.committedAt) &&
			Number.isFinite(marker.committedAt)
		) {
			return {
				version: 1,
				rootRunId: marker.rootRunId,
				capabilityToken: marker.capabilityToken,
				rootAsyncDir: marker.rootAsyncDir,
				committedAt: marker.committedAt,
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function persistTerminalRootProjection(
	route: NestedRoute,
	marker: NestedRootTerminalMarker,
	registry: NestedRegistry,
	retiring: boolean,
): boolean {
	let statusClaim: ReturnType<typeof tryAcquireStatusMutationClaim>;
	try {
		if (path.basename(marker.rootAsyncDir) !== route.rootRunId) return false;
		assertPrivateDirectoryWithin(TEMP_ROOT_DIR, marker.rootAsyncDir);
		statusClaim = tryAcquireStatusMutationClaim(marker.rootAsyncDir);
		if (!statusClaim) return false;
		const status = readStatus(marker.rootAsyncDir);
		if (!status || status.runId !== route.rootRunId || !terminal(status.state)) return false;
		const processTerminal = readProcessTerminal(marker.rootAsyncDir, {
			runId: status.runId,
			runnerProcessInstanceId: status.processTerminal?.runnerProcessInstanceId,
		});
		const steps = status.steps ?? [];
		attachRootChildrenToSteps(route.rootRunId, steps, registry.children);
		const parentRunOrigin =
			status.parentRunOrigin === "user" || nestedWorkIncludesUser(registry.children)
				? "user"
				: status.parentRunOrigin;
		const updated: AsyncStatus = {
			...status,
			steps,
			nestedRoute: retiring ? undefined : route,
			lastUpdate: Math.max(status.lastUpdate ?? 0, registry.updatedAt),
		};
		if (parentRunOrigin) updated.parentRunOrigin = parentRunOrigin;
		if (processTerminal) updated.processTerminal = processTerminal;
		writePrivateAtomicJson(path.join(marker.rootAsyncDir, "status.json"), updated);
		return true;
	} catch {
		return false;
	} finally {
		statusClaim?.release();
	}
}

function retireClaimedRoute(route: NestedRoute, claim: DurableClaim): string {
	const routeRoot = commonRouteRoot(route);
	const before = fs.lstatSync(routeRoot);
	const retiredRoot = path.join(NESTED_EVENTS_DIR, `.retired-${path.basename(routeRoot)}-${claim.token}`);
	fs.renameSync(routeRoot, retiredRoot);
	forgetNestedRegistry(registryPath(route));
	const moved = fs.lstatSync(retiredRoot);
	if (!moved.isDirectory() || moved.dev !== before.dev || moved.ino !== before.ino) {
		throw new Error("Nested route inode changed during retirement.");
	}
	return retiredRoot;
}

async function settleTerminalNestedRoute(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions,
	rootAsyncDir?: string,
): Promise<boolean> {
	validateRouteStorage(route);
	const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new Error("Nested route settlement timeout must be a finite non-negative number.");
	}
	const deadline = Date.now() + timeoutMs;
	const routeRoot = commonRouteRoot(route);
	for (;;) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const claim = tryAcquireDurableClaim(routeRoot, REGISTRY_LOCK);
		if (claim) {
			let retiredRoot: string | undefined;
			try {
				validateRouteStorage(route);
				if (rootAsyncDir) {
					if (path.basename(rootAsyncDir) !== route.rootRunId) {
						throw new Error("Nested route root runtime does not match its root run id.");
					}
					assertPrivateDirectoryWithin(TEMP_ROOT_DIR, rootAsyncDir);
					// The projector claim serializes marker publication with route
					// retirement, so atomic writing cannot recreate a retired route root.
					writePrivateAtomicJson(path.join(routeRoot, ROOT_TERMINAL_FILE), {
						version: 1,
						rootRunId: route.rootRunId,
						capabilityToken: route.capabilityToken,
						rootAsyncDir,
						committedAt: Date.now(),
					} satisfies NestedRootTerminalMarker);
				}
				const registry = projectNestedEventsUnderClaim(route, { drain: true, deadline });
				const marker = readRootTerminalMarker(route);
				if (!marker) return false;
				const hasLiveDescendants = hasLiveNestedDescendants([...registry.children, ...registry.pendingChildren]);
				// Publish the latest authoritative descendants even when the root
				// cannot retire yet. The foreground result can then show live detached
				// children while status retains the route for subsequent projection.
				if (!persistTerminalRootProjection(route, marker, registry, !hasLiveDescendants)) return false;
				if (hasLiveDescendants) return false;
				retiredRoot = retireClaimedRoute(route, claim);
			} finally {
				claim.release();
			}
			if (retiredRoot) fs.rmSync(retiredRoot, { recursive: true });
			return Boolean(retiredRoot);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) return false;
		await waitForProjectionRetry(Math.min(AUTHORITATIVE_PROJECTION_RETRY_MS, remaining), options.signal);
	}
}

/** Mark the root result durable and retire immediately only when no descendant remains live. */
export function finalizeNestedRouteRoot(
	route: NestedRoute,
	rootAsyncDir: string,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<boolean> {
	return settleTerminalNestedRoute(route, options, rootAsyncDir);
}

/** Let the final descendant retire a route whose root already committed terminal state. */
export function retireCompletedNestedRoute(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<boolean> {
	return settleTerminalNestedRoute(route, options);
}

/**
 * Authoritative projection for control and terminal delivery paths. A busy
 * projector is not an empty registry: wait for its durable transaction to
 * finish, then project any newly-arrived immutable events ourselves.
 */
export async function projectNestedEventsAuthoritatively(
	route: NestedRoute,
	options: AuthoritativeNestedProjectionOptions = {},
): Promise<NestedRegistry> {
	validateRouteStorage(route);
	const timeoutMs = options.timeoutMs ?? AUTHORITATIVE_PROJECTION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new Error("Authoritative nested projection timeout must be a finite non-negative number.");
	}
	const deadline = Date.now() + timeoutMs;
	const routeRoot = commonRouteRoot(route);
	for (;;) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const claim = tryAcquireDurableClaim(routeRoot, REGISTRY_LOCK);
		if (claim) return projectNestedEventsWithClaim(route, claim, { drain: true, deadline });
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(
				`Nested registry for '${route.rootRunId}' remained busy for ${timeoutMs}ms; authoritative projection was not completed.`,
			);
		}
		await waitForProjectionRetry(Math.min(AUTHORITATIVE_PROJECTION_RETRY_MS, remaining), options.signal);
	}
}

function writeRouteRecord(dir: string, ts: number, payload: NestedEventRecord): string {
	const content = `${JSON.stringify(payload)}\n`;
	if (Buffer.byteLength(content, "utf-8") > MAX_EVENT_BYTES)
		throw new Error("Nested route record exceeds the maximum size.");
	assertPrivateDirectory(dir);
	const name = `${String(ts).padStart(13, "0")}-${randomUUID()}.json`;
	const tmp = path.join(dir, `.${name}.tmp`);
	const finalPath = path.join(dir, name);
	fs.writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
	fs.renameSync(tmp, finalPath);
	return finalPath;
}

export function writeNestedEvent(
	route: NestedRoute,
	event: Omit<NestedEventRecord, "rootRunId" | "capabilityToken">,
): void {
	validateRouteStorage(route);
	const child = sanitizeSummary(event.child);
	if (!child || child.id === route.rootRunId) throw new Error("Nested event child failed validation.");
	const record: NestedEventRecord = {
		...event,
		rootRunId: route.rootRunId,
		capabilityToken: route.capabilityToken,
		child: compactSummaryForTransport(child, false),
	};
	const sanitized = parseRecord(JSON.stringify(record), route);
	if (!sanitized) throw new Error("Nested event record failed validation.");
	writeRouteRecord(route.eventSink, sanitized.ts, sanitized);
}

export interface NestedRouteEnvironment {
	readonly [SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV]: string;
	readonly [SUBAGENT_PARENT_CONTROL_INBOX_ENV]: string;
	readonly [SUBAGENT_PARENT_EVENT_SINK_ENV]: string;
	readonly [SUBAGENT_PARENT_ROOT_RUN_ID_ENV]: string;
}

export function nestedRouteEnv(route: NestedRoute): NestedRouteEnvironment {
	validateRouteStorage(route);
	return {
		[SUBAGENT_PARENT_EVENT_SINK_ENV]: route.eventSink,
		[SUBAGENT_PARENT_CONTROL_INBOX_ENV]: route.controlInbox,
		[SUBAGENT_PARENT_ROOT_RUN_ID_ENV]: route.rootRunId,
		[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV]: route.capabilityToken,
	};
}

export function attachRootChildrenToSteps<T extends { children?: NestedRunSummary[]; index?: number }>(
	rootRunId: string,
	steps: T[] | undefined,
	children: NestedRunSummary[] | undefined,
): void {
	if (!steps?.length) return;
	for (const step of steps) {
		step.children = undefined;
	}
	if (!children?.length) return;
	for (const child of children) {
		if (child.parentRunId !== rootRunId || child.parentStepIndex === undefined) continue;
		const step = steps.find((candidate, index) => (candidate.index ?? index) === child.parentStepIndex);
		if (!step) continue;
		step.children ??= [];
		step.children = [...step.children.filter((existing) => existing.id !== child.id), child].slice(-MAX_CHILDREN);
	}
}

export function updateAsyncJobNestedProjection(job: AsyncJobState): void {
	if (!job.nestedRoute) return;
	const registry = projectNestedEvents(job.nestedRoute);
	job.nestedChildren = registry.children;
	attachRootChildrenToSteps(job.asyncId, job.steps, registry.children);
}

export function updateForegroundNestedProjection(
	control: SubagentState["foregroundControls"] extends Map<string, infer T> ? T : never,
): void {
	if (!control.nestedRoute) return;
	const registry = projectNestedEvents(control.nestedRoute);
	control.nestedChildren = registry.children;
}

export function hasLiveNestedDescendants(children: NestedRunSummary[] | undefined): boolean {
	if (!children?.length) return false;
	for (const child of children) {
		if (!terminal(child.state)) return true;
		if (hasLiveNestedDescendants(child.children)) return true;
		if (hasLiveNestedDescendants(child.steps?.flatMap((step) => step.children ?? []))) return true;
	}
	return false;
}

interface NestedOriginProjection {
	readonly parentRunOrigin?: AgentWorkOrigin;
	readonly children?: readonly NestedOriginProjection[];
	readonly steps?: readonly { readonly children?: readonly NestedOriginProjection[] }[];
}

/** Whether any descendant was directly taken over by user-attributed work. */
export function nestedWorkIncludesUser(children: readonly NestedOriginProjection[] | undefined): boolean {
	for (const child of children ?? []) {
		if (child.parentRunOrigin === "user") return true;
		if (nestedWorkIncludesUser(child.children)) return true;
		if (nestedWorkIncludesUser(child.steps?.flatMap((step) => step.children ?? []))) return true;
	}
	return false;
}

export function nestedSummaryFromAsyncStatus(
	status: AsyncStatus,
	asyncDir: string,
	fallback: {
		id: string;
		parentRunId: string;
		parentStepIndex?: number;
		depth: number;
		path?: Array<{ runId: string; stepIndex?: number; agent?: string }>;
		mode?: SubagentRunMode;
		ts: number;
	},
): NestedRunSummary {
	const runId = status.runId || fallback.id;
	const fallbackPath: NestedPathEntry = { runId: fallback.parentRunId };
	if (fallback.parentStepIndex !== undefined) fallbackPath.stepIndex = fallback.parentStepIndex;
	const summary: Partial<NestedRunSummary> = { id: runId };
	if (status.parentRunOrigin) summary.parentRunOrigin = status.parentRunOrigin;
	summary.parentRunId = fallback.parentRunId;
	if (fallback.parentStepIndex !== undefined) summary.parentStepIndex = fallback.parentStepIndex;
	summary.depth = fallback.depth;
	summary.path = fallback.path ?? [fallbackPath];
	summary.asyncDir = asyncDir;
	if (status.pid) summary.pid = status.pid;
	if (status.sessionId) summary.sessionId = status.sessionId;
	summary.mode = status.mode ?? fallback.mode;
	summary.ownerState =
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
			? "gone"
			: status.pid
				? "live"
				: "unknown";
	if (status.processTerminal) {
		summary.processTerminal = sanitizeProcessTerminal(
			status.processTerminal,
			{ runId, runnerProcessInstanceId: status.processTerminal.runnerProcessInstanceId },
			`${asyncDir}/status.json`,
		);
	}
	if (status.capabilityCeiling) summary.capabilityCeiling = status.capabilityCeiling;
	if (status.capabilityAudit) summary.capabilityAudit = status.capabilityAudit;
	summary.state = status.state;
	if (status.currentStep !== undefined) summary.currentStep = status.currentStep;
	if (status.activityState) summary.activityState = status.activityState;
	if (status.lastActivityAt !== undefined) summary.lastActivityAt = status.lastActivityAt;
	if (status.currentTool) summary.currentTool = status.currentTool;
	if (status.currentToolStartedAt !== undefined) summary.currentToolStartedAt = status.currentToolStartedAt;
	if (status.currentPath) summary.currentPath = status.currentPath;
	if (status.turnCount !== undefined) summary.turnCount = status.turnCount;
	if (status.toolCount !== undefined) summary.toolCount = status.toolCount;
	if (status.totalTokens) summary.totalTokens = status.totalTokens;
	if (status.timeoutMs !== undefined) summary.timeoutMs = status.timeoutMs;
	if (status.deadlineAt !== undefined) summary.deadlineAt = status.deadlineAt;
	if (status.timedOut !== undefined) summary.timedOut = status.timedOut;
	if (status.stopped !== undefined) summary.stopped = status.stopped;
	if (status.turnBudget) summary.turnBudget = status.turnBudget;
	if (status.turnBudgetExceeded !== undefined) summary.turnBudgetExceeded = status.turnBudgetExceeded;
	if (status.wrapUpRequested !== undefined) summary.wrapUpRequested = status.wrapUpRequested;
	if (status.error) summary.error = status.error;
	summary.startedAt = status.startedAt ?? fallback.ts;
	if (status.endedAt !== undefined) summary.endedAt = status.endedAt;
	summary.lastUpdate = status.lastUpdate ?? fallback.ts;
	if (status.sessionFile) summary.sessionFile = status.sessionFile;
	if (status.steps?.length) {
		summary.steps = status.steps
			.map((step, index) => {
				const projected: Partial<NestedStepSummary> = { agent: step.agent };
				if (step.delegatedTask) projected.delegatedTask = step.delegatedTask;
				if (step.task) projected.task = step.task;
				if (step.label) projected.description = step.label;
				projected.status = step.status;
				if (step.sessionFile) projected.sessionFile = step.sessionFile;
				if (step.transcriptPath) projected.transcriptPath = step.transcriptPath;
				if (step.transcriptError) projected.transcriptError = step.transcriptError;
				if (step.activityState) projected.activityState = step.activityState;
				if (step.lastActivityAt !== undefined) projected.lastActivityAt = step.lastActivityAt;
				if (step.currentTool) projected.currentTool = step.currentTool;
				if (step.currentToolStartedAt !== undefined) projected.currentToolStartedAt = step.currentToolStartedAt;
				if (step.currentPath) projected.currentPath = step.currentPath;
				if (step.turnCount !== undefined) projected.turnCount = step.turnCount;
				if (step.toolCount !== undefined) projected.toolCount = step.toolCount;
				if (step.startedAt !== undefined) projected.startedAt = step.startedAt;
				if (step.endedAt !== undefined) projected.endedAt = step.endedAt;
				if (step.error) projected.error = step.error;
				if (step.timedOut !== undefined) projected.timedOut = step.timedOut;
				if (step.stopped !== undefined) projected.stopped = step.stopped;
				if (step.turnBudget) projected.turnBudget = step.turnBudget;
				if (step.turnBudgetExceeded !== undefined) projected.turnBudgetExceeded = step.turnBudgetExceeded;
				if (step.wrapUpRequested !== undefined) projected.wrapUpRequested = step.wrapUpRequested;
				if (step.processTerminal) {
					projected.processTerminal = sanitizeProcessTerminal(
						step.processTerminal,
						{ runId, runnerProcessInstanceId: step.processTerminal.runnerProcessInstanceId },
						`${asyncDir}/status.json step ${index}`,
					);
				}
				if (step.capabilityCeiling) projected.capabilityCeiling = step.capabilityCeiling;
				if (step.capabilityAudit) projected.capabilityAudit = step.capabilityAudit;
				// SAFETY: agent and status are copied from the canonical AsyncStatus step before returning the projection.
				return projected as NestedStepSummary;
			})
			.slice(0, MAX_STEPS);
	}
	// SAFETY: the required nested address and state fields are assigned from canonical status and fallback inputs.
	return summary as NestedRunSummary;
}

export interface NestedArtifactEnvironment {
	readonly PI_SUBAGENT_NESTED_PARENT_RUN_ID: string;
	readonly PI_SUBAGENT_NESTED_ROOT_RUN_ID: string;
}

export function nestedArtifactEnv(rootRunId: string, parentRunId: string): NestedArtifactEnvironment {
	return {
		PI_SUBAGENT_NESTED_ROOT_RUN_ID: rootRunId,
		PI_SUBAGENT_NESTED_PARENT_RUN_ID: parentRunId,
	};
}

export function isTopLevelAsyncDir(asyncDir: string): boolean {
	const resolved = path.resolve(asyncDir);
	return (
		containedPath(ASYNC_DIR, resolved) && !containedPath(path.join(TEMP_ROOT_DIR, "nested-subagent-runs"), resolved)
	);
}

export function nestedResultsPath(rootRunId: string, id: string): string {
	assertSafeId("rootRunId", rootRunId);
	assertSafeId("id", id);
	return path.join(RESULTS_DIR, "nested", rootRunId, `${id}.json`);
}
