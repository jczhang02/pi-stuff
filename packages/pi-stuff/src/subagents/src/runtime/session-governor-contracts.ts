import type * as nodeFs from "node:fs/promises";
import type { JsonValue } from "../../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";

export interface SessionGovernorLimits {
	readonly maxDepth: number;
	readonly maxRunning: number;
	readonly maxTotal: number;
}

export type SessionGovernorLimitInput = Partial<SessionGovernorLimits>;

export const DEFAULT_SESSION_GOVERNOR_LIMITS: SessionGovernorLimits = {
	maxDepth: 3,
	maxRunning: 20,
	maxTotal: 200,
};

export interface SessionAgentGovernorOptions {
	readonly rootDir: string;
	readonly sessionId: string;
	readonly ownerAgentPath?: readonly string[];
	readonly limits?: SessionGovernorLimitInput | undefined;
	readonly pid?: number;
	readonly now?: () => number;
	readonly token?: () => string;
	readonly lockRetryMs?: number;
	readonly lockTimeoutMs?: number;
	readonly readProcessStartIdentity?: (pid: number) => string | undefined;
	readonly readSystemBootIdentity?: (() => string | undefined) | undefined;
	readonly fs?: SessionGovernorFileSystem;
}

export type SessionGovernorFileSystem = Pick<
	typeof nodeFs,
	"chmod" | "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "stat" | "writeFile"
>;

export interface AcquireAgentRequest {
	readonly logicalAgentId: string;
	readonly runtimeRunId?: string;
	readonly childIndex?: number;
	readonly pid?: number;
}

export interface AcquireSpawnRequest extends AcquireAgentRequest {
	readonly childLimits?: SessionGovernorLimitInput;
}

export type AgentGovernorLease = Readonly<Omit<LeaseRecord, "ownerAgentPath" | "agentPath">> & {
	readonly sessionId: string;
	readonly ownerAgentPath: readonly string[];
	readonly agentPath: readonly string[];
};
export type SessionGovernorAgentSnapshot = AgentRecord;

export type SessionGovernorHistoricalAgent = SessionGovernorAgentSnapshot;

export interface SessionGovernorSnapshot {
	readonly sessionId: string;
	readonly limits: SessionGovernorLimits;
	readonly effectiveLimits: SessionGovernorLimits;
	readonly ownerAgentPath: readonly string[];
	readonly total: number;
	readonly running: number;
	readonly agents: readonly SessionGovernorAgentSnapshot[];
	readonly leases: readonly AgentGovernorLease[];
}

export type SessionGovernorLimitCode = "depth_limit" | "running_limit" | "total_limit";

export interface SessionGovernorLimitError {
	readonly kind: "limit";
	readonly code: SessionGovernorLimitCode;
	readonly limit: number;
	readonly used: number;
	readonly requested: number;
	readonly logicalAgentId: string;
	readonly message: string;
}

export type SessionGovernorConflictCode =
	| "logical_agent_exists"
	| "logical_agent_running"
	| "logical_agent_unknown"
	| "owner_mismatch"
	| "runtime_address_in_use";

export interface SessionGovernorConflictError {
	readonly kind: "conflict";
	readonly code: SessionGovernorConflictCode;
	readonly logicalAgentId: string;
	readonly message: string;
}

export type SessionGovernorAcquireError = SessionGovernorLimitError | SessionGovernorConflictError;

export type SessionGovernorAcquireResult =
	| {
			readonly ok: true;
			readonly lease: AgentGovernorLease;
			readonly snapshot: SessionGovernorSnapshot;
	  }
	| {
			readonly ok: false;
			readonly error: SessionGovernorAcquireError;
			readonly snapshot: SessionGovernorSnapshot;
	  };

export type SessionGovernorBatchAcquireResult =
	| {
			readonly ok: true;
			readonly leases: readonly AgentGovernorLease[];
			readonly snapshot: SessionGovernorSnapshot;
	  }
	| {
			readonly ok: false;
			readonly error: SessionGovernorAcquireError;
			readonly snapshot: SessionGovernorSnapshot;
	  };

export interface SessionGovernorReleaseResult {
	readonly released: boolean;
	readonly reason?: "already_released" | "ownership_changed";
	readonly snapshot: SessionGovernorSnapshot;
}

export type RebindAgentRuntimeRequest = Partial<
	Pick<LeaseRecord, "runtimeRunId" | "childIndex" | "pid" | "processStartIdentity" | "asyncDir">
>;

export type SessionGovernorRebindResult =
	| {
			readonly rebound: true;
			readonly lease: AgentGovernorLease;
			readonly snapshot: SessionGovernorSnapshot;
	  }
	| {
			readonly rebound: false;
			readonly reason: "already_released" | "ownership_changed" | "runtime_address_in_use";
			readonly snapshot: SessionGovernorSnapshot;
	  };

export type SessionGovernorBatchReleaseReason = "already_released" | "duplicate_logical_agent_id" | "ownership_changed";

export type SessionGovernorBatchReleaseResult =
	| {
			readonly released: true;
			readonly releasedCount: number;
			readonly snapshot: SessionGovernorSnapshot;
	  }
	| {
			readonly released: false;
			readonly releasedCount: 0;
			readonly logicalAgentId: string;
			readonly reason: SessionGovernorBatchReleaseReason;
			readonly snapshot: SessionGovernorSnapshot;
	  };

export interface SessionGovernorReconcileResult {
	readonly reclaimedLogicalAgentIds: readonly string[];
	readonly snapshot: SessionGovernorSnapshot;
}

export class SessionGovernorStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionGovernorStateError";
	}
}

export interface AgentRecord {
	readonly logicalAgentId: string;
	readonly ownerAgentPath: readonly string[];
	readonly agentPath: readonly string[];
	readonly limits: SessionGovernorLimits;
	readonly createdAtMs: number;
}

export interface LeaseRecord {
	logicalAgentId: string;
	runtimeRunId: string;
	childIndex: number;
	leaseId: string;
	ownerAgentPath: string[];
	agentPath: string[];
	pid: number;
	processStartIdentity?: string;
	systemBootIdentity?: string;
	asyncDir?: string;
	mode: "spawn" | "resume";
	acquiredAtMs: number;
}

export function runtimeAddressKey(value: Pick<LeaseRecord, "runtimeRunId" | "childIndex">): string {
	return `${value.runtimeRunId}\0${value.childIndex}`;
}

export interface GovernorLedger {
	version: 1;
	sessionId: string;
	limits: SessionGovernorLimits;
	total: number;
	agents: AgentRecord[];
	leases: LeaseRecord[];
	updatedAtMs: number;
}

export interface TransactionResult<Value> {
	readonly value: Value;
	readonly changed: boolean;
}

export type ValidatedSpawnRequest = Readonly<
	Pick<LeaseRecord, "logicalAgentId" | "runtimeRunId" | "childIndex" | "pid" | "processStartIdentity">
> & {
	readonly childLimits: SessionGovernorLimitInput;
};

export interface ValidatedBatchLease {
	readonly logicalAgentId: string;
	readonly leaseId: string;
	readonly rollback?: {
		readonly acquiredAtMs: number;
		readonly ownerAgentPath: readonly string[];
		readonly agentPath: readonly string[];
	};
}

export function resolveSessionGovernorLimits(input: SessionGovernorLimitInput = {}): SessionGovernorLimits {
	return {
		maxDepth: positiveInteger("maxDepth", input.maxDepth ?? DEFAULT_SESSION_GOVERNOR_LIMITS.maxDepth),
		maxRunning: positiveInteger("maxRunning", input.maxRunning ?? DEFAULT_SESSION_GOVERNOR_LIMITS.maxRunning),
		maxTotal: positiveInteger("maxTotal", input.maxTotal ?? DEFAULT_SESSION_GOVERNOR_LIMITS.maxTotal),
	};
}

export function tightenSessionGovernorLimits(
	parent: SessionGovernorLimits,
	child: SessionGovernorLimitInput = {},
): SessionGovernorLimits {
	const validatedParent = readCompleteLimits(parent);
	const requested = validateLimitInput(child);
	return {
		maxDepth: Math.min(validatedParent.maxDepth, requested.maxDepth ?? validatedParent.maxDepth),
		maxRunning: Math.min(validatedParent.maxRunning, requested.maxRunning ?? validatedParent.maxRunning),
		maxTotal: Math.min(validatedParent.maxTotal, requested.maxTotal ?? validatedParent.maxTotal),
	};
}

export function readCompleteLimits(value: SessionGovernorLimits | JsonValue | undefined): SessionGovernorLimits {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) {
		throw new TypeError("Session governor limits must be an object.");
	}
	return {
		maxDepth: positiveInteger("maxDepth", value["maxDepth"]),
		maxRunning: positiveInteger("maxRunning", value["maxRunning"]),
		maxTotal: positiveInteger("maxTotal", value["maxTotal"]),
	};
}

export function validateLimitInput(value: SessionGovernorLimitInput): SessionGovernorLimitInput {
	let limits: SessionGovernorLimitInput = {};
	if (value.maxDepth !== undefined) limits = { ...limits, maxDepth: positiveInteger("maxDepth", value.maxDepth) };
	if (value.maxRunning !== undefined) {
		limits = { ...limits, maxRunning: positiveInteger("maxRunning", value.maxRunning) };
	}
	if (value.maxTotal !== undefined) limits = { ...limits, maxTotal: positiveInteger("maxTotal", value.maxTotal) };
	return limits;
}

export function stableText<Value>(name: string, value: Value): string {
	if (
		!isRuntimeString(value) ||
		value.length === 0 ||
		value.length > 256 ||
		value.trim() !== value ||
		containsControlCharacter(value)
	) {
		throw new TypeError(`${name} must be a non-empty stable identifier of at most 256 characters.`);
	}
	return value;
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code !== undefined && (code <= 31 || code === 127)) return true;
	}
	return false;
}

export function positiveInteger<Value>(name: string, value: Value): number {
	if (!isRuntimeNumber(value) || !Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive safe integer; unlimited and zero are not supported.`);
	}
	return value;
}

export function nonNegativeInteger<Value>(name: string, value: Value): number {
	if (!isRuntimeNumber(value) || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

export function finiteNumber<Value>(name: string, value: Value): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) throw new SessionGovernorStateError(`${name} is invalid.`);
	return value;
}

export function samePath(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function safeSystemBootIdentity(readIdentity: () => string | undefined): string | undefined {
	try {
		const identity = readIdentity();
		return identity === undefined ? undefined : stableText("systemBootIdentity", identity);
	} catch {
		return undefined;
	}
}
