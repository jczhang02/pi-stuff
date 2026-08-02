import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LEDGER_VERSION = 1;
const DEFAULT_LOCK_RETRY_MS = 5;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;

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
	readonly limits?: SessionGovernorLimitInput;
	readonly pid?: number;
	readonly now?: () => number;
	readonly token?: () => string;
	readonly lockRetryMs?: number;
	readonly lockTimeoutMs?: number;
	readonly staleLockMs?: number;
	readonly isLockOwnerAlive?: (pid: number) => boolean | undefined;
}

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

interface AgentRecord {
	logicalAgentId: string;
	ownerAgentPath: string[];
	agentPath: string[];
	limits: SessionGovernorLimits;
	createdAtMs: number;
}

interface LeaseRecord {
	logicalAgentId: string;
	runtimeRunId: string;
	childIndex: number;
	leaseId: string;
	ownerAgentPath: string[];
	agentPath: string[];
	pid: number;
	asyncDir?: string;
	mode: "spawn" | "resume";
	acquiredAtMs: number;
}

interface GovernorLedger {
	version: 1;
	sessionId: string;
	limits: SessionGovernorLimits;
	total: number;
	agents: AgentRecord[];
	leases: LeaseRecord[];
	updatedAtMs: number;
}

interface LockHandle {
	readonly token: string;
	readonly lockDir: string;
}

interface TransactionResult<Value> {
	readonly value: Value;
	readonly changed: boolean;
}

interface ReadLedgerResult {
	readonly ledger: GovernorLedger;
	readonly migrated: boolean;
}

interface ValidatedSpawnRequest {
	readonly logicalAgentId: string;
	readonly runtimeRunId: string;
	readonly childIndex: number;
	readonly pid: number;
	readonly childLimits: SessionGovernorLimitInput;
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

export class SessionAgentGovernor {
	private readonly rootDir: string;
	private readonly sessionDir: string;
	private readonly ledgerPath: string;
	private readonly lockDir: string;
	private readonly sessionId: string;
	private readonly ownerAgentPath: readonly string[];
	private readonly configuredLimits: SessionGovernorLimitInput;
	private readonly pid: number;
	private readonly now: () => number;
	private readonly token: () => string;
	private readonly lockRetryMs: number;
	private readonly lockTimeoutMs: number;
	private readonly staleLockMs: number;
	private readonly isLockOwnerAlive: (pid: number) => boolean | undefined;

	constructor(options: SessionAgentGovernorOptions) {
		if (!path.isAbsolute(options.rootDir)) throw new TypeError("Session governor rootDir must be absolute.");
		this.rootDir = path.resolve(options.rootDir);
		this.sessionId = stableText("sessionId", options.sessionId);
		this.ownerAgentPath = Object.freeze(
			(options.ownerAgentPath ?? []).map((entry) => stableText("ownerAgentPath entry", entry)),
		);
		this.configuredLimits = validateLimitInput(options.limits ?? {});
		this.pid = positiveInteger("pid", options.pid ?? process.pid);
		this.now = options.now ?? Date.now;
		this.token = options.token ?? randomUUID;
		this.lockRetryMs = nonNegativeInteger("lockRetryMs", options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);
		this.lockTimeoutMs = positiveInteger("lockTimeoutMs", options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
		this.staleLockMs = positiveInteger("staleLockMs", options.staleLockMs ?? DEFAULT_STALE_LOCK_MS);
		this.isLockOwnerAlive = options.isLockOwnerAlive ?? processIsAlive;

		const sessionKey = createHash("sha256").update(this.sessionId).digest("hex");
		this.sessionDir = path.join(this.rootDir, sessionKey);
		this.ledgerPath = path.join(this.sessionDir, "ledger.json");
		this.lockDir = path.join(this.sessionDir, "ledger.lock");
	}

	/** Read-only existence probe used to keep ordinary session startup at zero writes. */
	async hasLedger(): Promise<boolean> {
		try {
			return (await stat(this.ledgerPath)).isFile();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	async snapshot(): Promise<SessionGovernorSnapshot> {
		return this.transact((ledger, effectiveLimits) => ({
			value: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
			changed: false,
		}));
	}

	async acquireSpawn(request: AcquireSpawnRequest): Promise<SessionGovernorAcquireResult> {
		const result = await this.acquireSpawnBatch([request]);
		if (!result.ok) return result;
		const lease = result.leases[0];
		if (!lease) throw new SessionGovernorStateError("Single-Agent reservation returned no lease.");
		return { ok: true, lease, snapshot: result.snapshot };
	}

	/** Reserve every spawn under one ledger lock; any rejection leaves both counters unchanged. */
	async acquireSpawnBatch(requests: readonly AcquireSpawnRequest[]): Promise<SessionGovernorBatchAcquireResult> {
		const validated = requests.map((request): ValidatedSpawnRequest => {
			const logicalAgentId = stableText("logicalAgentId", request.logicalAgentId);
			return {
				logicalAgentId,
				runtimeRunId: stableText("runtimeRunId", request.runtimeRunId ?? logicalAgentId),
				childIndex: nonNegativeInteger("childIndex", request.childIndex ?? 0),
				pid: positiveInteger("pid", request.pid ?? this.pid),
				childLimits: validateLimitInput(request.childLimits ?? {}),
			};
		});

		return this.transact<SessionGovernorBatchAcquireResult>((ledger, effectiveLimits) => {
			const duplicate = firstDuplicateLogicalAgentId(validated);
			if (duplicate) {
				return batchAcquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					conflictError(
						"logical_agent_exists",
						duplicate,
						`Logical Agent '${duplicate}' appears more than once in the same spawn reservation.`,
					),
				);
			}

			for (const request of validated) {
				if (!ledger.agents.some((agent) => agent.logicalAgentId === request.logicalAgentId)) continue;
				return batchAcquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					conflictError(
						"logical_agent_exists",
						request.logicalAgentId,
						`Logical Agent '${request.logicalAgentId}' already exists in this session; use resume instead of spawning it again.`,
					),
				);
			}

			const firstRequest = validated[0];
			if (!firstRequest) {
				return {
					value: {
						ok: true,
						leases: Object.freeze([]),
						snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
					},
					changed: false,
				};
			}

			const childDepth = this.ownerAgentPath.length + 1;
			if (childDepth > effectiveLimits.maxDepth) {
				return batchAcquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					limitError(
						"depth_limit",
						firstRequest.logicalAgentId,
						effectiveLimits.maxDepth,
						this.ownerAgentPath.length,
						childDepth,
					),
				);
			}
			if (ledger.leases.length + validated.length > effectiveLimits.maxRunning) {
				const unavailable = firstUnavailableRequest(validated, effectiveLimits.maxRunning - ledger.leases.length);
				return batchAcquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					limitError(
						"running_limit",
						unavailable.logicalAgentId,
						effectiveLimits.maxRunning,
						ledger.leases.length,
						validated.length,
					),
				);
			}
			if (ledger.total + validated.length > effectiveLimits.maxTotal) {
				const unavailable = firstUnavailableRequest(validated, effectiveLimits.maxTotal - ledger.total);
				return batchAcquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					limitError(
						"total_limit",
						unavailable.logicalAgentId,
						effectiveLimits.maxTotal,
						ledger.total,
						validated.length,
					),
				);
			}

			const acquiredAtMs = this.now();
			const staged = validated.map((request) => {
				const agentPath = [...this.ownerAgentPath, request.logicalAgentId];
				const lease = createLease({
					sessionId: this.sessionId,
					logicalAgentId: request.logicalAgentId,
					runtimeRunId: request.runtimeRunId,
					childIndex: request.childIndex,
					leaseId: this.token(),
					ownerAgentPath: this.ownerAgentPath,
					agentPath,
					pid: request.pid,
					mode: "spawn",
					acquiredAtMs,
				});
				const agent: AgentRecord = {
					logicalAgentId: request.logicalAgentId,
					ownerAgentPath: [...this.ownerAgentPath],
					agentPath,
					limits: tightenSessionGovernorLimits(effectiveLimits, request.childLimits),
					createdAtMs: acquiredAtMs,
				};
				return { agent, lease };
			});

			ledger.total += staged.length;
			ledger.agents.push(...staged.map(({ agent }) => agent));
			ledger.leases.push(...staged.map(({ lease }) => toLeaseRecord(lease)));
			return {
				value: {
					ok: true,
					leases: Object.freeze(staged.map(({ lease }) => lease)),
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				},
				changed: staged.length > 0,
			};
		});
	}

	async acquireResume(request: AcquireAgentRequest): Promise<SessionGovernorAcquireResult> {
		const logicalAgentId = stableText("logicalAgentId", request.logicalAgentId);
		const runtimeRunId = stableText("runtimeRunId", request.runtimeRunId ?? logicalAgentId);
		const childIndex = nonNegativeInteger("childIndex", request.childIndex ?? 0);
		const pid = positiveInteger("pid", request.pid ?? this.pid);

		return this.transact<SessionGovernorAcquireResult>((ledger, effectiveLimits) => {
			const agent = ledger.agents.find((candidate) => candidate.logicalAgentId === logicalAgentId);
			if (!agent) {
				return acquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					conflictError(
						"logical_agent_unknown",
						logicalAgentId,
						`Logical Agent '${logicalAgentId}' has no durable session record to resume.`,
					),
				);
			}
			if (!samePath(agent.ownerAgentPath, this.ownerAgentPath)) {
				return acquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					conflictError(
						"owner_mismatch",
						logicalAgentId,
						`Logical Agent '${logicalAgentId}' can only be resumed by its recorded owner Agent path.`,
					),
				);
			}
			if (ledger.leases.some((lease) => lease.logicalAgentId === logicalAgentId)) {
				return acquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					conflictError(
						"logical_agent_running",
						logicalAgentId,
						`Logical Agent '${logicalAgentId}' already holds a running lease.`,
					),
				);
			}
			if (ledger.leases.length >= effectiveLimits.maxRunning) {
				return acquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					limitError("running_limit", logicalAgentId, effectiveLimits.maxRunning, ledger.leases.length, 1),
				);
			}

			const lease = createLease({
				sessionId: this.sessionId,
				logicalAgentId,
				runtimeRunId,
				childIndex,
				leaseId: this.token(),
				ownerAgentPath: agent.ownerAgentPath,
				agentPath: agent.agentPath,
				pid,
				mode: "resume",
				acquiredAtMs: this.now(),
			});
			ledger.leases.push(toLeaseRecord(lease));
			return {
				value: {
					ok: true,
					lease,
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				} satisfies SessionGovernorAcquireResult,
				changed: true,
			};
		});
	}

	async rebindRuntime(
		lease: AgentGovernorLease,
		request: RebindAgentRuntimeRequest,
	): Promise<SessionGovernorRebindResult> {
		if (lease.sessionId !== this.sessionId) {
			throw new TypeError("Cannot rebind an Agent lease from another session.");
		}
		const logicalAgentId = stableText("logicalAgentId", lease.logicalAgentId);
		const leaseId = stableText("leaseId", lease.leaseId);
		const runtimeRunId =
			request.runtimeRunId === undefined ? undefined : stableText("runtimeRunId", request.runtimeRunId);
		const childIndex =
			request.childIndex === undefined ? undefined : nonNegativeInteger("childIndex", request.childIndex);
		const pid = request.pid === undefined ? undefined : positiveInteger("pid", request.pid);
		const asyncDir = request.asyncDir === undefined ? undefined : stableText("asyncDir", request.asyncDir);

		return this.transact<SessionGovernorRebindResult>((ledger, effectiveLimits) => {
			const current = ledger.leases.find((candidate) => candidate.logicalAgentId === logicalAgentId);
			if (!current) {
				return {
					value: {
						rebound: false,
						reason: "already_released",
						snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
					},
					changed: false,
				};
			}
			if (current.leaseId !== leaseId) {
				return {
					value: {
						rebound: false,
						reason: "ownership_changed",
						snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
					},
					changed: false,
				};
			}

			const nextRuntimeRunId = runtimeRunId ?? current.runtimeRunId;
			const nextChildIndex = childIndex ?? current.childIndex;
			const nextPid = pid ?? current.pid;
			const nextAsyncDir = asyncDir ?? current.asyncDir;
			const changed =
				nextRuntimeRunId !== current.runtimeRunId ||
				nextChildIndex !== current.childIndex ||
				nextPid !== current.pid ||
				nextAsyncDir !== current.asyncDir;
			current.runtimeRunId = nextRuntimeRunId;
			current.childIndex = nextChildIndex;
			current.pid = nextPid;
			if (nextAsyncDir !== undefined) current.asyncDir = nextAsyncDir;
			return {
				value: {
					rebound: true,
					lease: toPublicLease(this.sessionId, current),
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				},
				changed,
			};
		});
	}

	async findRuntimeLease(runtimeRunId: string, childIndex: number): Promise<AgentGovernorLease | undefined> {
		const validatedRunId = stableText("runtimeRunId", runtimeRunId);
		const validatedChildIndex = nonNegativeInteger("childIndex", childIndex);
		return this.transact((ledger) => {
			const current = ledger.leases.find(
				(lease) => lease.runtimeRunId === validatedRunId && lease.childIndex === validatedChildIndex,
			);
			return {
				value: current ? toPublicLease(this.sessionId, current) : undefined,
				changed: false,
			};
		});
	}

	async release(lease: AgentGovernorLease): Promise<SessionGovernorReleaseResult> {
		if (lease.sessionId !== this.sessionId)
			throw new TypeError("Cannot release an Agent lease from another session.");
		stableText("logicalAgentId", lease.logicalAgentId);
		stableText("leaseId", lease.leaseId);

		return this.transact<SessionGovernorReleaseResult>((ledger, effectiveLimits) => {
			const index = ledger.leases.findIndex((candidate) => candidate.logicalAgentId === lease.logicalAgentId);
			if (index === -1) {
				return {
					value: {
						released: false,
						reason: "already_released",
						snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
					},
					changed: false,
				};
			}
			if (ledger.leases[index]?.leaseId !== lease.leaseId) {
				return {
					value: {
						released: false,
						reason: "ownership_changed",
						snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
					},
					changed: false,
				};
			}
			ledger.leases.splice(index, 1);
			return {
				value: {
					released: true,
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				},
				changed: true,
			};
		});
	}

	/** Release every matching lease under one ledger lock; any mismatch releases none. */
	async releaseBatch(leases: readonly AgentGovernorLease[]): Promise<SessionGovernorBatchReleaseResult> {
		const validated = leases.map((lease) => {
			if (lease.sessionId !== this.sessionId) {
				throw new TypeError("Cannot release an Agent lease from another session.");
			}
			return {
				logicalAgentId: stableText("logicalAgentId", lease.logicalAgentId),
				leaseId: stableText("leaseId", lease.leaseId),
			};
		});

		return this.transact<SessionGovernorBatchReleaseResult>((ledger, effectiveLimits) => {
			const duplicate = firstDuplicateLogicalAgentId(validated);
			if (duplicate) {
				return batchReleaseFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					duplicate,
					"duplicate_logical_agent_id",
				);
			}

			for (const lease of validated) {
				const current = ledger.leases.find((candidate) => candidate.logicalAgentId === lease.logicalAgentId);
				if (!current) {
					return batchReleaseFailure(
						ledger,
						effectiveLimits,
						this.ownerAgentPath,
						lease.logicalAgentId,
						"already_released",
					);
				}
				if (current.leaseId !== lease.leaseId) {
					return batchReleaseFailure(
						ledger,
						effectiveLimits,
						this.ownerAgentPath,
						lease.logicalAgentId,
						"ownership_changed",
					);
				}
			}

			const releasedIds = new Set(validated.map(({ logicalAgentId }) => logicalAgentId));
			if (releasedIds.size > 0) {
				ledger.leases = ledger.leases.filter((lease) => !releasedIds.has(lease.logicalAgentId));
			}
			return {
				value: {
					released: true,
					releasedCount: releasedIds.size,
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				},
				changed: releasedIds.size > 0,
			};
		});
	}

	async reconcile(
		isPidAlive: (pid: number, lease: AgentGovernorLease) => boolean | undefined,
	): Promise<SessionGovernorReconcileResult> {
		return this.transact((ledger, effectiveLimits) => {
			const reclaimed = ledger.leases
				.filter((record) => isPidAlive(record.pid, toPublicLease(this.sessionId, record)) === false)
				.map((record) => record.logicalAgentId);
			if (reclaimed.length > 0) {
				const reclaimedSet = new Set(reclaimed);
				ledger.leases = ledger.leases.filter((record) => !reclaimedSet.has(record.logicalAgentId));
			}
			return {
				value: {
					reclaimedLogicalAgentIds: reclaimed,
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				},
				changed: reclaimed.length > 0,
			};
		});
	}

	private async transact<Value>(
		operation: (ledger: GovernorLedger, effectiveLimits: SessionGovernorLimits) => TransactionResult<Value>,
	): Promise<Value> {
		await ensurePrivateDirectory(this.rootDir);
		await ensurePrivateDirectory(this.sessionDir);
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
			await this.releaseLock(lock);
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
			raw = await readFile(this.ledgerPath, "utf8");
		} catch (error) {
			if (errorCode(error) === "ENOENT") return undefined;
			throw error;
		}
		await chmod(this.ledgerPath, PRIVATE_FILE_MODE);
		return parseLedger(raw, this.sessionId);
	}

	private async writeLedger(ledger: GovernorLedger): Promise<void> {
		const tempPath = path.join(this.sessionDir, `.ledger.${this.pid}.${this.token()}.tmp`);
		try {
			await writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
				mode: PRIVATE_FILE_MODE,
			});
			await chmod(tempPath, PRIVATE_FILE_MODE);
			await rename(tempPath, this.ledgerPath);
			await chmod(this.ledgerPath, PRIVATE_FILE_MODE);
		} finally {
			await rm(tempPath, { force: true });
		}
	}

	private async acquireLock(): Promise<LockHandle> {
		const startedAt = Date.now();
		const token = this.token();
		while (Date.now() - startedAt < this.lockTimeoutMs) {
			try {
				await mkdir(this.lockDir, { mode: PRIVATE_DIRECTORY_MODE });
				await chmod(this.lockDir, PRIVATE_DIRECTORY_MODE);
				try {
					await writeFile(
						path.join(this.lockDir, "owner.json"),
						JSON.stringify({ token, pid: this.pid, acquiredAtMs: Date.now() }),
						{ encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE },
					);
					return { token, lockDir: this.lockDir };
				} catch (error) {
					await rm(this.lockDir, { recursive: true, force: true });
					throw error;
				}
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
				if (await this.reclaimStaleLock(token)) continue;
				await sleep(this.lockRetryMs);
			}
		}
		throw new SessionGovernorStateError(
			`Timed out acquiring the session governor ledger lock for session '${this.sessionId}'.`,
		);
	}

	private async reclaimStaleLock(token: string): Promise<boolean> {
		let lockStat: Stats;
		try {
			lockStat = await stat(this.lockDir);
		} catch (error) {
			return errorCode(error) === "ENOENT";
		}
		if (Date.now() - lockStat.mtimeMs < this.staleLockMs) return false;

		let ownerPid: number | undefined;
		try {
			const owner = JSON.parse(await readFile(path.join(this.lockDir, "owner.json"), "utf8")) as unknown;
			if (
				isRecord(owner) &&
				typeof owner["pid"] === "number" &&
				Number.isInteger(owner["pid"]) &&
				owner["pid"] > 0
			) {
				ownerPid = owner["pid"];
			}
		} catch {}
		if (ownerPid !== undefined && this.isLockOwnerAlive(ownerPid) !== false) return false;

		const stalePath = `${this.lockDir}.stale-${token}`;
		try {
			await rename(this.lockDir, stalePath);
			await rm(stalePath, { recursive: true, force: true });
			return true;
		} catch (error) {
			if (errorCode(error) === "ENOENT" || errorCode(error) === "EEXIST") return false;
			throw error;
		}
	}

	private async releaseLock(lock: LockHandle): Promise<void> {
		try {
			const owner = JSON.parse(await readFile(path.join(lock.lockDir, "owner.json"), "utf8")) as unknown;
			if (!isRecord(owner) || owner["token"] !== lock.token) return;
		} catch {
			return;
		}
		await rm(lock.lockDir, { recursive: true, force: true });
	}
}

function acquireFailure(
	ledger: GovernorLedger,
	effectiveLimits: SessionGovernorLimits,
	ownerAgentPath: readonly string[],
	error: SessionGovernorAcquireError,
): TransactionResult<SessionGovernorAcquireResult> {
	return {
		value: {
			ok: false,
			error,
			snapshot: snapshotLedger(ledger, effectiveLimits, ownerAgentPath),
		},
		changed: false,
	};
}

function batchAcquireFailure(
	ledger: GovernorLedger,
	effectiveLimits: SessionGovernorLimits,
	ownerAgentPath: readonly string[],
	error: SessionGovernorAcquireError,
): TransactionResult<SessionGovernorBatchAcquireResult> {
	return {
		value: {
			ok: false,
			error,
			snapshot: snapshotLedger(ledger, effectiveLimits, ownerAgentPath),
		},
		changed: false,
	};
}

function batchReleaseFailure(
	ledger: GovernorLedger,
	effectiveLimits: SessionGovernorLimits,
	ownerAgentPath: readonly string[],
	logicalAgentId: string,
	reason: SessionGovernorBatchReleaseReason,
): TransactionResult<SessionGovernorBatchReleaseResult> {
	return {
		value: {
			released: false,
			releasedCount: 0,
			logicalAgentId,
			reason,
			snapshot: snapshotLedger(ledger, effectiveLimits, ownerAgentPath),
		},
		changed: false,
	};
}

function firstDuplicateLogicalAgentId(entries: readonly { readonly logicalAgentId: string }[]): string | undefined {
	const seen = new Set<string>();
	for (const entry of entries) {
		if (seen.has(entry.logicalAgentId)) return entry.logicalAgentId;
		seen.add(entry.logicalAgentId);
	}
	return undefined;
}

function firstUnavailableRequest(requests: readonly ValidatedSpawnRequest[], available: number): ValidatedSpawnRequest {
	const index = Math.min(requests.length - 1, Math.max(0, available));
	const request = requests[index];
	if (!request) throw new SessionGovernorStateError("A non-empty batch reservation had no request.");
	return request;
}

function conflictError(
	code: SessionGovernorConflictCode,
	logicalAgentId: string,
	message: string,
): SessionGovernorConflictError {
	return { kind: "conflict", code, logicalAgentId, message };
}

function limitError(
	code: SessionGovernorLimitCode,
	logicalAgentId: string,
	limit: number,
	used: number,
	requested: number,
): SessionGovernorLimitError {
	const resource = code === "depth_limit" ? "depth" : code === "running_limit" ? "running Agent" : "session spawn";
	return {
		kind: "limit",
		code,
		limit,
		used,
		requested,
		logicalAgentId,
		message: `Cannot acquire '${logicalAgentId}': ${resource} limit ${limit} would be exceeded (used ${used}, requested ${requested}).`,
	};
}

function createLease(input: AgentGovernorLease): AgentGovernorLease {
	return Object.freeze({
		...input,
		ownerAgentPath: Object.freeze([...input.ownerAgentPath]),
		agentPath: Object.freeze([...input.agentPath]),
	});
}

function toLeaseRecord(lease: AgentGovernorLease): LeaseRecord {
	return {
		logicalAgentId: lease.logicalAgentId,
		runtimeRunId: lease.runtimeRunId,
		childIndex: lease.childIndex,
		leaseId: lease.leaseId,
		ownerAgentPath: [...lease.ownerAgentPath],
		agentPath: [...lease.agentPath],
		pid: lease.pid,
		...(lease.asyncDir ? { asyncDir: lease.asyncDir } : {}),
		mode: lease.mode,
		acquiredAtMs: lease.acquiredAtMs,
	};
}

function toPublicLease(sessionId: string, lease: LeaseRecord): AgentGovernorLease {
	return createLease({ sessionId, ...lease });
}

function snapshotLedger(
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
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new SessionGovernorStateError("Session governor ledger is not valid JSON; refusing to overwrite it.");
	}
	if (!isRecord(value) || value["version"] !== LEDGER_VERSION || value["sessionId"] !== expectedSessionId) {
		throw new SessionGovernorStateError("Session governor ledger identity or version is invalid.");
	}
	if (typeof value["total"] !== "number" || !Number.isInteger(value["total"]) || value["total"] < 0) {
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

function parseAgentRecord(value: unknown): AgentRecord {
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

function parseLeaseRecord(value: unknown): LeaseRecord {
	if (!isRecord(value)) throw new SessionGovernorStateError("Session governor lease record is invalid.");
	const mode = value["mode"];
	if (mode !== "spawn" && mode !== "resume") {
		throw new SessionGovernorStateError("Session governor lease mode is invalid.");
	}
	const logicalAgentId = stableText("logicalAgentId", value["logicalAgentId"]);
	return {
		logicalAgentId,
		runtimeRunId: stableText("runtimeRunId", value["runtimeRunId"] ?? logicalAgentId),
		childIndex: nonNegativeInteger("childIndex", value["childIndex"] ?? 0),
		leaseId: stableText("leaseId", value["leaseId"]),
		ownerAgentPath: readAgentPath(value["ownerAgentPath"]),
		agentPath: readAgentPath(value["agentPath"]),
		pid: positiveInteger("pid", value["pid"]),
		...(value["asyncDir"] === undefined ? {} : { asyncDir: stableText("asyncDir", value["asyncDir"]) }),
		mode,
		acquiredAtMs: finiteNumber("acquiredAtMs", value["acquiredAtMs"]),
	};
}

function readAgentPath(value: unknown): string[] {
	if (!Array.isArray(value)) throw new SessionGovernorStateError("Session governor Agent path is invalid.");
	return value.map((entry) => stableText("Agent path entry", entry));
}

function readCompleteLimits(value: unknown): SessionGovernorLimits {
	if (!isRecord(value)) throw new TypeError("Session governor limits must be an object.");
	return {
		maxDepth: positiveInteger("maxDepth", value["maxDepth"]),
		maxRunning: positiveInteger("maxRunning", value["maxRunning"]),
		maxTotal: positiveInteger("maxTotal", value["maxTotal"]),
	};
}

function validateLimitInput(value: SessionGovernorLimitInput): SessionGovernorLimitInput {
	return {
		...(value.maxDepth === undefined ? {} : { maxDepth: positiveInteger("maxDepth", value.maxDepth) }),
		...(value.maxRunning === undefined ? {} : { maxRunning: positiveInteger("maxRunning", value.maxRunning) }),
		...(value.maxTotal === undefined ? {} : { maxTotal: positiveInteger("maxTotal", value.maxTotal) }),
	};
}

function stableText(name: string, value: unknown): string {
	if (
		typeof value !== "string" ||
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

function positiveInteger(name: string, value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive safe integer; unlimited and zero are not supported.`);
	}
	return value;
}

function nonNegativeInteger(name: string, value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function finiteNumber(name: string, value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new SessionGovernorStateError(`${name} is invalid.`);
	return value;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof error["code"] === "string" ? error["code"] : undefined;
}

function processIsAlive(pid: number): boolean | undefined {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = errorCode(error);
		if (code === "ESRCH") return false;
		if (code === "EPERM") return true;
		return undefined;
	}
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
	await chmod(directory, PRIVATE_DIRECTORY_MODE);
}

async function sleep(delayMs: number): Promise<void> {
	if (delayMs === 0) return;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}
