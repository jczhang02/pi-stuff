import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { type JsonObject, type JsonValue, parseJsonValue } from "../../../shared/json-value.js";
import { isRuntimeFunction, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import { type DurableClaim, tryAcquireDurableClaim } from "../shared/durable-claim.ts";
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
	readonly staleLockMs?: number;
	readonly isLockOwnerAlive?: (pid: number) => boolean | undefined;
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

export interface AgentGovernorLease {
	readonly sessionId: string;
	readonly logicalAgentId: string;
	readonly runtimeRunId: string;
	readonly childIndex: number;
	readonly leaseId: string;
	readonly ownerAgentPath: readonly string[];
	readonly agentPath: readonly string[];
	readonly pid: number;
	readonly processStartIdentity?: string;
	readonly systemBootIdentity?: string;
	readonly asyncDir?: string;
	readonly mode: "spawn" | "resume";
	readonly acquiredAtMs: number;
}

export interface SessionGovernorAgentSnapshot {
	readonly logicalAgentId: string;
	readonly ownerAgentPath: readonly string[];
	readonly agentPath: readonly string[];
	readonly limits: SessionGovernorLimits;
	readonly createdAtMs: number;
}

export interface SessionGovernorHistoricalAgent {
	readonly logicalAgentId: string;
	readonly ownerAgentPath: readonly string[];
	readonly agentPath: readonly string[];
	readonly limits: SessionGovernorLimits;
	readonly createdAtMs: number;
}

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
	| "owner_mismatch";

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

export interface RebindAgentRuntimeRequest {
	readonly runtimeRunId?: string;
	readonly childIndex?: number;
	readonly pid?: number;
	readonly processStartIdentity?: string;
	readonly asyncDir?: string;
}

export type SessionGovernorRebindResult =
	| {
			readonly rebound: true;
			readonly lease: AgentGovernorLease;
			readonly snapshot: SessionGovernorSnapshot;
	  }
	| {
			readonly rebound: false;
			readonly reason: "already_released" | "ownership_changed";
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
	logicalAgentId: string;
	ownerAgentPath: string[];
	agentPath: string[];
	limits: SessionGovernorLimits;
	createdAtMs: number;
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

export interface ValidatedSpawnRequest {
	readonly logicalAgentId: string;
	readonly runtimeRunId: string;
	readonly childIndex: number;
	readonly pid: number;
	readonly processStartIdentity?: string;
	readonly childLimits: SessionGovernorLimitInput;
}

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

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LEDGER_VERSION = 1;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;

interface ReadLedgerResult {
	readonly ledger: GovernorLedger;
	readonly migrated: boolean;
}

export interface SessionGovernorLedgerOptions {
	readonly rootDir: string;
	readonly sessionId: string;
	readonly ownerAgentPath: readonly string[];
	readonly configuredLimits: SessionGovernorLimitInput;
	readonly pid: number;
	readonly now: () => number;
	readonly token: () => string;
	readonly lockRetryMs: number;
	readonly lockTimeoutMs: number;
	readonly fs: SessionGovernorFileSystem | undefined;
}

/** Owns durable session state, locking, validation, and atomic commits. */
export class SessionGovernorLedger {
	private readonly rootDir: string;
	private readonly sessionDir: string;
	private readonly ledgerPath: string;
	private readonly sessionId: string;
	private readonly ownerAgentPath: readonly string[];
	private readonly configuredLimits: SessionGovernorLimitInput;
	private readonly pid: number;
	private readonly now: () => number;
	private readonly token: () => string;
	private readonly lockRetryMs: number;
	private readonly lockTimeoutMs: number;
	private readonly fs: SessionGovernorFileSystem;

	constructor(options: SessionGovernorLedgerOptions) {
		this.rootDir = path.resolve(options.rootDir);
		this.sessionId = options.sessionId;
		this.ownerAgentPath = options.ownerAgentPath;
		this.configuredLimits = options.configuredLimits;
		this.pid = options.pid;
		this.now = options.now;
		this.token = options.token;
		this.lockRetryMs = options.lockRetryMs;
		this.lockTimeoutMs = options.lockTimeoutMs;
		this.fs = options.fs ?? nodeFs;

		const sessionKey = createHash("sha256").update(this.sessionId).digest("hex");
		this.sessionDir = path.join(this.rootDir, sessionKey);
		this.ledgerPath = path.join(this.sessionDir, "ledger.json");
	}

	/** Read-only existence probe used to keep ordinary session startup at zero writes. */
	async hasLedger(): Promise<boolean> {
		try {
			const stat = await this.fs.lstat(this.ledgerPath);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				throw new SessionGovernorStateError(`Session governor ledger '${this.ledgerPath}' is not a safe file.`);
			}
			return true;
		} catch (error) {
			if (errorCode(error) === "ENOENT") return false;
			throw error;
		}
	}

	/** Inspect a pre-upgrade ledger without taking the current lock or writing. */
	async inspectExistingSnapshot(): Promise<SessionGovernorSnapshot | undefined> {
		if (!(await inspectExistingPrivateDirectory(this.fs, this.rootDir))) return undefined;
		if (!(await inspectExistingPrivateDirectory(this.fs, this.sessionDir))) return undefined;
		let raw: string;
		try {
			const stat = await this.fs.lstat(this.ledgerPath);
			const currentUid = isRuntimeFunction(process.getuid) ? process.getuid() : undefined;
			if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_LEDGER_BYTES) {
				throw new SessionGovernorStateError(`Session governor ledger '${this.ledgerPath}' is not a safe file.`);
			}
			if (currentUid !== undefined && stat.uid !== currentUid) {
				throw new SessionGovernorStateError(
					`Session governor ledger '${this.ledgerPath}' is not owned by the current user.`,
				);
			}
			raw = await this.fs.readFile(this.ledgerPath, "utf8");
		} catch (error) {
			if (errorCode(error) === "ENOENT") return undefined;
			throw error;
		}
		const loaded = parseLedger(raw, this.sessionId);
		return snapshotLedger(loaded.ledger, this.resolveOwnerLimits(loaded.ledger), this.ownerAgentPath);
	}

	async snapshot(): Promise<SessionGovernorSnapshot> {
		return this.transact((ledger, effectiveLimits) => ({
			value: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
			changed: false,
		}));
	}

	async transact<Value>(
		operation: (ledger: GovernorLedger, effectiveLimits: SessionGovernorLimits) => TransactionResult<Value>,
	): Promise<Value> {
		await ensurePrivateDirectory(this.fs, this.rootDir);
		await ensurePrivateDirectory(this.fs, this.sessionDir);
		const lock = await this.acquireLock();
		try {
			const loaded = await this.readLedger();
			const existing = loaded?.ledger;
			if (!existing && this.ownerAgentPath.length > 0) {
				throw new SessionGovernorStateError(
					"A child Agent cannot initialize the root session governor ledger; open the root governor first.",
				);
			}
			const ledger = existing ?? this.createLedger();
			const effectiveLimits = this.resolveOwnerLimits(ledger);
			const result = operation(ledger, effectiveLimits);
			if (!existing || result.changed || loaded.migrated) {
				ledger.updatedAtMs = this.now();
				await this.writeLedger(ledger);
			}
			return result.value;
		} finally {
			try {
				lock.release();
			} catch (error) {
				reportAgentDiagnostic(`Failed to release committed session governor lock '${lock.directory}':`, error);
			}
		}
	}

	private createLedger(): GovernorLedger {
		return {
			version: LEDGER_VERSION,
			sessionId: this.sessionId,
			limits: resolveSessionGovernorLimits(this.configuredLimits),
			total: 0,
			agents: [],
			leases: [],
			updatedAtMs: this.now(),
		};
	}

	private resolveOwnerLimits(ledger: GovernorLedger): SessionGovernorLimits {
		if (this.ownerAgentPath.length === 0) return tightenSessionGovernorLimits(ledger.limits, this.configuredLimits);
		const owner = ledger.agents.find((agent) => samePath(agent.agentPath, this.ownerAgentPath));
		if (!owner) {
			throw new SessionGovernorStateError(
				`Owner Agent path '${this.ownerAgentPath.join(" / ")}' is not registered in session '${this.sessionId}'.`,
			);
		}
		return tightenSessionGovernorLimits(owner.limits, this.configuredLimits);
	}

	private async readLedger(): Promise<ReadLedgerResult | undefined> {
		let raw: string;
		try {
			const stat = await this.fs.lstat(this.ledgerPath);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				throw new SessionGovernorStateError(`Session governor ledger '${this.ledgerPath}' is not a safe file.`);
			}
			if (stat.size > MAX_LEDGER_BYTES) {
				throw new SessionGovernorStateError(
					`Session governor ledger '${this.ledgerPath}' exceeds the ${MAX_LEDGER_BYTES}-byte safety limit.`,
				);
			}
			const currentUid = isRuntimeFunction(process.getuid) ? process.getuid() : undefined;
			if (currentUid !== undefined && stat.uid !== currentUid) {
				throw new SessionGovernorStateError(
					`Session governor ledger '${this.ledgerPath}' is not owned by the current user.`,
				);
			}
			raw = await this.fs.readFile(this.ledgerPath, "utf8");
		} catch (error) {
			if (errorCode(error) === "ENOENT") return undefined;
			throw error;
		}
		await this.fs.chmod(this.ledgerPath, PRIVATE_FILE_MODE);
		return parseLedger(raw, this.sessionId);
	}

	private async writeLedger(ledger: GovernorLedger): Promise<void> {
		const tempPath = path.join(this.sessionDir, `.ledger.${this.pid}.${this.token()}.tmp`);
		try {
			await this.fs.writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
				mode: PRIVATE_FILE_MODE,
			});
			await this.fs.chmod(tempPath, PRIVATE_FILE_MODE);
			await this.fs.rename(tempPath, this.ledgerPath);
		} finally {
			try {
				await this.fs.rm(tempPath, { force: true });
			} catch (error) {
				reportAgentDiagnostic(`Failed to remove session governor temporary ledger '${tempPath}':`, error);
			}
		}
		try {
			await this.fs.chmod(this.ledgerPath, PRIVATE_FILE_MODE);
		} catch (error) {
			// The temp file already had 0600 before the atomic rename. This is a
			// post-commit hardening retry, not a reason to report the transaction failed.
			reportAgentDiagnostic(
				`Failed to reassert private mode on committed governor ledger '${this.ledgerPath}':`,
				error,
			);
		}
	}

	private async acquireLock(): Promise<DurableClaim> {
		const startedAt = Date.now();
		while (Date.now() - startedAt < this.lockTimeoutMs) {
			try {
				const claim = tryAcquireDurableClaim(this.sessionDir, "ledger");
				if (claim) return claim;
			} catch (error) {
				throw new SessionGovernorStateError(
					`Failed to acquire the session governor ledger lock '${path.join(this.sessionDir, "ledger.lock")}': ${String(error)}`,
				);
			}
			await sleep(this.lockRetryMs);
		}
		throw new SessionGovernorStateError(
			`Timed out acquiring the session governor ledger lock for session '${this.sessionId}'.`,
		);
	}
}

export function createLease(input: AgentGovernorLease): AgentGovernorLease {
	return Object.freeze({
		...input,
		ownerAgentPath: Object.freeze([...input.ownerAgentPath]),
		agentPath: Object.freeze([...input.agentPath]),
	});
}

export function toLeaseRecord(lease: AgentGovernorLease): LeaseRecord {
	let record: LeaseRecord = {
		logicalAgentId: lease.logicalAgentId,
		runtimeRunId: lease.runtimeRunId,
		childIndex: lease.childIndex,
		leaseId: lease.leaseId,
		ownerAgentPath: [...lease.ownerAgentPath],
		agentPath: [...lease.agentPath],
		pid: lease.pid,
		mode: lease.mode,
		acquiredAtMs: lease.acquiredAtMs,
	};
	if (lease.processStartIdentity) record = { ...record, processStartIdentity: lease.processStartIdentity };
	if (lease.systemBootIdentity) record = { ...record, systemBootIdentity: lease.systemBootIdentity };
	if (lease.asyncDir) record = { ...record, asyncDir: lease.asyncDir };
	return record;
}

export function toPublicLease(sessionId: string, lease: LeaseRecord): AgentGovernorLease {
	return createLease({ sessionId, ...lease });
}

export function snapshotLedger(
	ledger: GovernorLedger,
	effectiveLimits: SessionGovernorLimits,
	ownerAgentPath: readonly string[],
): SessionGovernorSnapshot {
	return {
		sessionId: ledger.sessionId,
		limits: { ...ledger.limits },
		effectiveLimits: { ...effectiveLimits },
		ownerAgentPath: [...ownerAgentPath],
		total: ledger.total,
		running: ledger.leases.length,
		agents: ledger.agents.map((agent) => ({
			...agent,
			ownerAgentPath: [...agent.ownerAgentPath],
			agentPath: [...agent.agentPath],
			limits: { ...agent.limits },
		})),
		leases: ledger.leases.map((lease) => toPublicLease(ledger.sessionId, lease)),
	};
}

function parseLedger(raw: string, expectedSessionId: string): ReadLedgerResult {
	let value: JsonValue;
	try {
		value = parseJsonValue(raw);
	} catch {
		throw new SessionGovernorStateError("Session governor ledger is not valid JSON; refusing to overwrite it.");
	}
	if (!isRecord(value) || value["version"] !== LEDGER_VERSION || value["sessionId"] !== expectedSessionId) {
		throw new SessionGovernorStateError("Session governor ledger identity or version is invalid.");
	}
	if (!isRuntimeNumber(value["total"]) || !Number.isInteger(value["total"]) || value["total"] < 0) {
		throw new SessionGovernorStateError("Session governor ledger total is invalid.");
	}
	if (!Array.isArray(value["agents"]) || !Array.isArray(value["leases"])) {
		throw new SessionGovernorStateError("Session governor ledger records are invalid.");
	}

	const limits = readCompleteLimits(value["limits"]);
	const agents = value["agents"].map(parseAgentRecord);
	const rawLeases = value["leases"];
	const migrated = rawLeases.some(
		(lease) => isRecord(lease) && (lease["runtimeRunId"] === undefined || lease["childIndex"] === undefined),
	);
	const leases = rawLeases.map(parseLeaseRecord);
	if (value["total"] !== agents.length) {
		throw new SessionGovernorStateError("Session governor ledger total does not match its durable Agent records.");
	}
	if (new Set(agents.map((agent) => agent.logicalAgentId)).size !== agents.length) {
		throw new SessionGovernorStateError("Session governor ledger contains duplicate logical Agent IDs.");
	}
	if (new Set(leases.map((lease) => lease.logicalAgentId)).size !== leases.length) {
		throw new SessionGovernorStateError("Session governor ledger contains duplicate running leases.");
	}
	for (const lease of leases) {
		const agent = agents.find((candidate) => candidate.logicalAgentId === lease.logicalAgentId);
		if (
			!agent ||
			!samePath(agent.ownerAgentPath, lease.ownerAgentPath) ||
			!samePath(agent.agentPath, lease.agentPath)
		) {
			throw new SessionGovernorStateError(
				"Session governor ledger contains a lease without a matching Agent record.",
			);
		}
	}

	return {
		ledger: {
			version: LEDGER_VERSION,
			sessionId: expectedSessionId,
			limits,
			total: value["total"],
			agents,
			leases,
			updatedAtMs: finiteNumber("updatedAtMs", value["updatedAtMs"]),
		},
		migrated,
	};
}

function parseAgentRecord(value: JsonValue): AgentRecord {
	if (!isRecord(value)) throw new SessionGovernorStateError("Session governor Agent record is invalid.");
	const logicalAgentId = stableText("logicalAgentId", value["logicalAgentId"]);
	const ownerAgentPath = readAgentPath(value["ownerAgentPath"]);
	const agentPath = readAgentPath(value["agentPath"]);
	if (!samePath(agentPath, [...ownerAgentPath, logicalAgentId])) {
		throw new SessionGovernorStateError(`Logical Agent '${logicalAgentId}' has an invalid owner path.`);
	}
	return {
		logicalAgentId,
		ownerAgentPath,
		agentPath,
		limits: readCompleteLimits(value["limits"]),
		createdAtMs: finiteNumber("createdAtMs", value["createdAtMs"]),
	};
}

function parseLeaseRecord(value: JsonValue): LeaseRecord {
	if (!isRecord(value)) throw new SessionGovernorStateError("Session governor lease record is invalid.");
	const mode = value["mode"];
	if (mode !== "spawn" && mode !== "resume") {
		throw new SessionGovernorStateError("Session governor lease mode is invalid.");
	}
	const logicalAgentId = stableText("logicalAgentId", value["logicalAgentId"]);
	let record: LeaseRecord = {
		logicalAgentId,
		runtimeRunId: stableText("runtimeRunId", value["runtimeRunId"] ?? logicalAgentId),
		childIndex: nonNegativeInteger("childIndex", value["childIndex"] ?? 0),
		leaseId: stableText("leaseId", value["leaseId"]),
		ownerAgentPath: readAgentPath(value["ownerAgentPath"]),
		agentPath: readAgentPath(value["agentPath"]),
		pid: positiveInteger("pid", value["pid"]),
		mode,
		acquiredAtMs: finiteNumber("acquiredAtMs", value["acquiredAtMs"]),
	};
	if (value["processStartIdentity"] !== undefined) {
		record = { ...record, processStartIdentity: stableText("processStartIdentity", value["processStartIdentity"]) };
	}
	if (value["systemBootIdentity"] !== undefined) {
		record = { ...record, systemBootIdentity: stableText("systemBootIdentity", value["systemBootIdentity"]) };
	}
	if (value["asyncDir"] !== undefined) {
		record = { ...record, asyncDir: stableText("asyncDir", value["asyncDir"]) };
	}
	return record;
}

function readAgentPath(value: JsonValue | undefined): string[] {
	if (!Array.isArray(value)) throw new SessionGovernorStateError("Session governor Agent path is invalid.");
	return value.map((entry) => stableText("Agent path entry", entry));
}

function isRecord(value: JsonValue): value is JsonObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function errorCode<Cause>(cause: Cause): string | undefined {
	return isRuntimeObject(cause) && cause !== null && "code" in cause && isRuntimeString(cause.code)
		? cause.code
		: undefined;
}

async function ensurePrivateDirectory(fs: SessionGovernorFileSystem, directory: string): Promise<void> {
	await fs.mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
	const stat = await fs.lstat(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new SessionGovernorStateError(`Session governor directory '${directory}' is not a safe real directory.`);
	}
	const currentUid = isRuntimeFunction(process.getuid) ? process.getuid() : undefined;
	if (currentUid !== undefined && stat.uid !== currentUid) {
		throw new SessionGovernorStateError(
			`Session governor directory '${directory}' is not owned by the current user.`,
		);
	}
	await fs.chmod(directory, PRIVATE_DIRECTORY_MODE);
}

async function inspectExistingPrivateDirectory(fs: SessionGovernorFileSystem, directory: string): Promise<boolean> {
	try {
		const stat = await fs.lstat(directory);
		const currentUid = isRuntimeFunction(process.getuid) ? process.getuid() : undefined;
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new SessionGovernorStateError(`Session governor directory '${directory}' is not a safe real directory.`);
		}
		if (currentUid !== undefined && stat.uid !== currentUid) {
			throw new SessionGovernorStateError(
				`Session governor directory '${directory}' is not owned by the current user.`,
			);
		}
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

async function sleep(delayMs: number): Promise<void> {
	if (delayMs === 0) return;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}
