import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { readProcessStartIdentity, readSystemBootIdentity } from "../shared/process-identity.ts";
import {
	type AcquireAgentRequest,
	type AcquireSpawnRequest,
	type AgentGovernorLease,
	type AgentRecord,
	type AgentWorkExpansionResult,
	type AgentWorkUnitSnapshot,
	checkedUsageTotal,
	costGuardError,
	createLease,
	emptyAgentWorkUsage,
	expansionResult,
	finiteNumber,
	type GovernorLedger,
	nonNegativeFiniteNumber,
	nonNegativeInteger,
	positiveInteger,
	type RebindAgentRuntimeRequest,
	type RecordAgentWorkAttemptRequest,
	readCompleteLimits,
	runtimeAddressKey,
	type SessionAgentGovernorOptions,
	type SessionGovernorAcquireError,
	type SessionGovernorAcquireResult,
	type SessionGovernorBatchAcquireResult,
	type SessionGovernorBatchReleaseReason,
	type SessionGovernorBatchReleaseResult,
	type SessionGovernorHistoricalAgent,
	SessionGovernorLedger,
	type SessionGovernorLimits,
	type SessionGovernorRebindResult,
	type SessionGovernorReconcileResult,
	type SessionGovernorReleaseResult,
	type SessionGovernorSnapshot,
	SessionGovernorStateError,
	safeSystemBootIdentity,
	samePath,
	snapshotLedger,
	snapshotWorkUnit,
	stableText,
	type TransactionResult,
	tightenSessionGovernorLimits,
	toLeaseRecord,
	toPublicLease,
	type ValidatedBatchLease,
	validateLimitInput,
} from "./session-governor-ledger.ts";
import {
	conflictError,
	firstDuplicateLogicalAgentId,
	limitError,
	reserveSpawnBatch,
	validateSpawnRequests,
} from "./session-governor-spawn.ts";

export type {
	AcquireAgentRequest,
	AcquireSpawnRequest,
	AgentGovernorLease,
	AgentWorkCostGuardCode,
	AgentWorkCostPolicy,
	AgentWorkExpansionResult,
	AgentWorkUnitSnapshot,
	AgentWorkUsage,
	RebindAgentRuntimeRequest,
	RecordAgentWorkAttemptRequest,
	SessionAgentGovernorOptions,
	SessionGovernorAcquireError,
	SessionGovernorAcquireResult,
	SessionGovernorAgentSnapshot,
	SessionGovernorBatchAcquireResult,
	SessionGovernorBatchReleaseReason,
	SessionGovernorBatchReleaseResult,
	SessionGovernorConflictCode,
	SessionGovernorConflictError,
	SessionGovernorCostGuardError,
	SessionGovernorFileSystem,
	SessionGovernorHistoricalAgent,
	SessionGovernorLimitCode,
	SessionGovernorLimitError,
	SessionGovernorLimitInput,
	SessionGovernorLimits,
	SessionGovernorRebindResult,
	SessionGovernorReconcileResult,
	SessionGovernorReleaseResult,
	SessionGovernorSnapshot,
} from "./session-governor-ledger.ts";
export {
	DEFAULT_AGENT_WORK_COST_POLICY,
	DEFAULT_SESSION_GOVERNOR_LIMITS,
	resolveSessionGovernorLimits,
	SessionGovernorStateError,
	tightenSessionGovernorLimits,
} from "./session-governor-ledger.ts";

export class SessionAgentGovernor {
	private readonly ledger: SessionGovernorLedger;
	private readonly sessionId: string;
	private readonly ownerAgentPath: readonly string[];
	private readonly pid: number;
	private readonly now: () => number;
	private readonly token: () => string;
	private readonly readProcessStartIdentity: (pid: number) => string | undefined;
	private readonly readSystemBootIdentity: () => string | undefined;
	private systemBootIdentity: string | undefined;
	private systemBootIdentityRead = false;

	constructor(options: SessionAgentGovernorOptions) {
		if (!path.isAbsolute(options.rootDir)) throw new TypeError("Session governor rootDir must be absolute.");
		this.sessionId = stableText("sessionId", options.sessionId);
		this.ownerAgentPath = Object.freeze(
			(options.ownerAgentPath ?? []).map((entry) => stableText("ownerAgentPath entry", entry)),
		);
		const configuredLimits = validateLimitInput(options.limits ?? {});
		this.pid = positiveInteger("pid", options.pid ?? process.pid);
		this.now = options.now ?? Date.now;
		this.token = options.token ?? randomUUID;
		this.readProcessStartIdentity = options.readProcessStartIdentity ?? readProcessStartIdentity;
		this.readSystemBootIdentity = options.readSystemBootIdentity ?? readSystemBootIdentity;
		this.ledger = new SessionGovernorLedger({
			rootDir: options.rootDir,
			sessionId: this.sessionId,
			ownerAgentPath: this.ownerAgentPath,
			configuredLimits,
			pid: this.pid,
			now: this.now,
			token: this.token,
			lockRetryMs: nonNegativeInteger("lockRetryMs", options.lockRetryMs ?? 5),
			lockTimeoutMs: positiveInteger("lockTimeoutMs", options.lockTimeoutMs ?? 5_000),
			fs: options.fs,
		});
	}

	async hasLedger(): Promise<boolean> {
		return this.ledger.hasLedger();
	}

	async inspectExistingSnapshot(): Promise<SessionGovernorSnapshot | undefined> {
		return this.ledger.inspectExistingSnapshot();
	}

	async snapshot(): Promise<SessionGovernorSnapshot> {
		return this.ledger.snapshot();
	}

	async workUnit(logicalAgentId: string): Promise<AgentWorkUnitSnapshot> {
		const validatedId = stableText("logicalAgentId", logicalAgentId);
		return this.ledger.transact((ledger) => ({
			value: snapshotWorkUnit(this.ownedAgent(ledger, validatedId)),
			changed: false,
		}));
	}

	async authorizeWorkExpansion(logicalAgentId: string): Promise<AgentWorkExpansionResult> {
		const workUnit = await this.workUnit(logicalAgentId);
		return expansionResult(workUnit);
	}

	/** Settle one Provider/model attempt before any later automatic expansion is considered. */
	async recordWorkAttempt(request: RecordAgentWorkAttemptRequest): Promise<AgentWorkUnitSnapshot> {
		const logicalAgentId = stableText("logicalAgentId", request.logicalAgentId);
		const delta = {
			turns: nonNegativeInteger("turns", request.turns),
			toolCalls: nonNegativeInteger("toolCalls", request.toolCalls),
			inputTokens: nonNegativeInteger("inputTokens", request.inputTokens),
			outputTokens: nonNegativeInteger("outputTokens", request.outputTokens),
		};
		const reportedCostUsd =
			request.reportedCostUsd === undefined
				? undefined
				: nonNegativeFiniteNumber("reportedCostUsd", request.reportedCostUsd);
		return this.ledger.transact((ledger) => {
			const agent = this.ownedAgent(ledger, logicalAgentId);
			const usage = agent.workUsage;
			usage.turns = checkedUsageTotal("turns", usage.turns, delta.turns);
			usage.toolCalls = checkedUsageTotal("toolCalls", usage.toolCalls, delta.toolCalls);
			usage.inputTokens = checkedUsageTotal("inputTokens", usage.inputTokens, delta.inputTokens);
			usage.outputTokens = checkedUsageTotal("outputTokens", usage.outputTokens, delta.outputTokens);
			usage.modelAttempts = checkedUsageTotal("modelAttempts", usage.modelAttempts, 1);
			if (reportedCostUsd !== undefined) {
				usage.reportedCostUsd = nonNegativeFiniteNumber(
					"cumulative reportedCostUsd",
					(usage.reportedCostUsd ?? 0) + reportedCostUsd,
				);
			}
			return { value: snapshotWorkUnit(agent), changed: true };
		});
	}

	private ownedAgent(ledger: GovernorLedger, logicalAgentId: string): AgentRecord {
		const agent = ledger.agents.find((candidate) => candidate.logicalAgentId === logicalAgentId);
		if (!agent) {
			throw new SessionGovernorStateError(`Logical Agent '${logicalAgentId}' has no durable session record.`);
		}
		if (!samePath(agent.ownerAgentPath, this.ownerAgentPath)) {
			throw new SessionGovernorStateError(
				`Logical Agent '${logicalAgentId}' does not belong to this governor owner path.`,
			);
		}
		return agent;
	}

	/** Atomically and idempotently account for proven pre-upgrade Agent records; never imports leases. */
	async importHistoricalAgents(records: readonly SessionGovernorHistoricalAgent[]): Promise<SessionGovernorSnapshot> {
		if (this.ownerAgentPath.length > 0) {
			throw new SessionGovernorStateError("Only the root Agent host may import historical governor records.");
		}
		const validated = records
			.map((record): AgentRecord => {
				const logicalAgentId = stableText("logicalAgentId", record.logicalAgentId);
				const ownerAgentPath = record.ownerAgentPath.map((entry) => stableText("ownerAgentPath entry", entry));
				const agentPath = record.agentPath.map((entry) => stableText("agentPath entry", entry));
				if (!samePath(agentPath, [...ownerAgentPath, logicalAgentId])) {
					throw new SessionGovernorStateError(`Logical Agent '${logicalAgentId}' has an invalid import path.`);
				}
				return {
					logicalAgentId,
					ownerAgentPath,
					agentPath,
					limits: readCompleteLimits(record.limits),
					createdAtMs: finiteNumber("createdAtMs", record.createdAtMs),
					workUsage: emptyAgentWorkUsage(),
				};
			})
			.sort((left, right) => left.agentPath.length - right.agentPath.length);
		if (new Set(validated.map(({ logicalAgentId }) => logicalAgentId)).size !== validated.length) {
			throw new SessionGovernorStateError("Historical governor import contains duplicate logical Agent IDs.");
		}

		return this.ledger.transact((ledger, effectiveLimits) => {
			let changed = false;
			for (const record of validated) {
				const existing = ledger.agents.find(({ logicalAgentId }) => logicalAgentId === record.logicalAgentId);
				if (existing) {
					if (
						!samePath(existing.ownerAgentPath, record.ownerAgentPath) ||
						!samePath(existing.agentPath, record.agentPath)
					) {
						throw new SessionGovernorStateError(
							`Historical Agent '${record.logicalAgentId}' conflicts with the durable governor ledger.`,
						);
					}
					continue;
				}
				if (record.ownerAgentPath.length > 0) {
					const owner = ledger.agents.find((candidate) => samePath(candidate.agentPath, record.ownerAgentPath));
					if (!owner) {
						throw new SessionGovernorStateError(
							`Historical Agent '${record.logicalAgentId}' has no imported owner record.`,
						);
					}
				}
				ledger.agents.push({
					...record,
					limits: tightenSessionGovernorLimits(ledger.limits, record.limits),
				});
				changed = true;
			}
			if (changed) ledger.total = ledger.agents.length;
			return {
				value: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				changed,
			};
		});
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
		const systemBootIdentity = this.currentSystemBootIdentity();
		const validated = validateSpawnRequests(requests, this.pid, this.readProcessStartIdentity);
		return this.ledger.transact((ledger, effectiveLimits) => {
			if (this.ownerAgentPath.length > 0) {
				const owner = ledger.agents.find((agent) => samePath(agent.agentPath, this.ownerAgentPath));
				if (!owner) {
					throw new SessionGovernorStateError(
						`Owner Agent path '${this.ownerAgentPath.join(" / ")}' is not registered in session '${this.sessionId}'.`,
					);
				}
				const workUnit = snapshotWorkUnit(owner);
				const guard = expansionResult(workUnit);
				if (!guard.allowed) {
					return {
						value: {
							ok: false,
							error: costGuardError(workUnit, guard.reason),
							snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
						},
						changed: false,
					};
				}
			}
			return reserveSpawnBatch({
				ledger,
				effectiveLimits,
				requests: validated,
				sessionId: this.sessionId,
				ownerAgentPath: this.ownerAgentPath,
				systemBootIdentity,
				now: this.now,
				token: this.token,
			});
		});
	}

	async acquireResume(request: AcquireAgentRequest): Promise<SessionGovernorAcquireResult> {
		const logicalAgentId = stableText("logicalAgentId", request.logicalAgentId);
		const runtimeRunId = stableText("runtimeRunId", request.runtimeRunId ?? logicalAgentId);
		const childIndex = nonNegativeInteger("childIndex", request.childIndex ?? 0);
		const pid = positiveInteger("pid", request.pid ?? this.pid);
		const processStartIdentity = this.readProcessStartIdentity(pid);
		const systemBootIdentity = this.currentSystemBootIdentity();
		const runtimeAddress = runtimeAddressKey({ runtimeRunId, childIndex });

		return this.ledger.transact<SessionGovernorAcquireResult>((ledger, effectiveLimits) => {
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
			if (ledger.leases.some((lease) => runtimeAddressKey(lease) === runtimeAddress)) {
				return acquireFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					conflictError(
						"runtime_address_in_use",
						logicalAgentId,
						`Runtime Agent address '${runtimeRunId}:${childIndex}' is already reserved in this session.`,
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
			const workUnit = snapshotWorkUnit(agent);
			const guard = expansionResult(workUnit);
			if (!guard.allowed && request.acknowledgeCost !== true) {
				return acquireFailure(ledger, effectiveLimits, this.ownerAgentPath, costGuardError(workUnit, guard.reason));
			}

			let leaseInput: AgentGovernorLease = {
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
			};
			if (processStartIdentity) leaseInput = { ...leaseInput, processStartIdentity };
			if (systemBootIdentity) leaseInput = { ...leaseInput, systemBootIdentity };
			const lease = createLease(leaseInput);
			ledger.leases.push(toLeaseRecord(lease));
			agent.workUsage.resumes = checkedUsageTotal("resumes", agent.workUsage.resumes, 1);
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
		const processStartIdentity =
			request.processStartIdentity === undefined
				? undefined
				: stableText("processStartIdentity", request.processStartIdentity);
		const asyncDir = request.asyncDir === undefined ? undefined : stableText("asyncDir", request.asyncDir);

		return this.ledger.transact<SessionGovernorRebindResult>((ledger, effectiveLimits) => {
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
			const nextRuntimeAddress = runtimeAddressKey({
				runtimeRunId: nextRuntimeRunId,
				childIndex: nextChildIndex,
			});
			if (
				ledger.leases.some(
					(candidate) => candidate !== current && runtimeAddressKey(candidate) === nextRuntimeAddress,
				)
			) {
				return {
					value: {
						rebound: false,
						reason: "runtime_address_in_use",
						snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
					},
					changed: false,
				};
			}
			const nextPid = pid ?? current.pid;
			const nextProcessStartIdentity =
				processStartIdentity ??
				(pid !== undefined && pid !== current.pid ? undefined : current.processStartIdentity);
			const nextAsyncDir = asyncDir ?? current.asyncDir;
			const changed =
				nextRuntimeRunId !== current.runtimeRunId ||
				nextChildIndex !== current.childIndex ||
				nextPid !== current.pid ||
				nextProcessStartIdentity !== current.processStartIdentity ||
				nextAsyncDir !== current.asyncDir;
			current.runtimeRunId = nextRuntimeRunId;
			current.childIndex = nextChildIndex;
			current.pid = nextPid;
			if (nextProcessStartIdentity === undefined) delete current.processStartIdentity;
			else current.processStartIdentity = nextProcessStartIdentity;
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
		return this.ledger.transact((ledger) => {
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

		return this.ledger.transact<SessionGovernorReleaseResult>((ledger, effectiveLimits) => {
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

	/**
	 * Roll back a spawn that failed before any Agent started. Unlike release(),
	 * this removes the newly-created logical records and restores maxTotal.
	 */
	async abortSpawnBatch(leases: readonly AgentGovernorLease[]): Promise<SessionGovernorBatchReleaseResult> {
		const validated: ValidatedBatchLease[] = leases.map((lease) => {
			if (lease.sessionId !== this.sessionId) {
				throw new TypeError("Cannot abort an Agent spawn reservation from another session.");
			}
			if (lease.mode !== "spawn") throw new TypeError("Only spawn reservations can be rolled back.");
			return {
				logicalAgentId: stableText("logicalAgentId", lease.logicalAgentId),
				leaseId: stableText("leaseId", lease.leaseId),
				rollback: {
					acquiredAtMs: lease.acquiredAtMs,
					ownerAgentPath: lease.ownerAgentPath,
					agentPath: lease.agentPath,
				},
			};
		});
		return this.releaseValidatedBatch(validated, true);
	}

	/** Release every matching lease under one ledger lock; any mismatch releases none. */
	async releaseBatch(leases: readonly AgentGovernorLease[]): Promise<SessionGovernorBatchReleaseResult> {
		const validated: ValidatedBatchLease[] = leases.map((lease) => {
			if (lease.sessionId !== this.sessionId) {
				throw new TypeError("Cannot release an Agent lease from another session.");
			}
			return {
				logicalAgentId: stableText("logicalAgentId", lease.logicalAgentId),
				leaseId: stableText("leaseId", lease.leaseId),
			};
		});
		return this.releaseValidatedBatch(validated, false);
	}

	private releaseValidatedBatch(
		leases: readonly ValidatedBatchLease[],
		rollbackAgents: boolean,
	): Promise<SessionGovernorBatchReleaseResult> {
		return this.ledger.transact((ledger, effectiveLimits) => {
			const duplicate = firstDuplicateLogicalAgentId(leases);
			if (duplicate) {
				return batchReleaseFailure(
					ledger,
					effectiveLimits,
					this.ownerAgentPath,
					duplicate,
					"duplicate_logical_agent_id",
				);
			}

			for (const lease of leases) {
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
				const rollback = lease.rollback;
				const agent = rollback
					? ledger.agents.find((candidate) => candidate.logicalAgentId === lease.logicalAgentId)
					: undefined;
				if (
					current.leaseId !== lease.leaseId ||
					(rollbackAgents &&
						(!rollback ||
							current.mode !== "spawn" ||
							!agent ||
							agent.createdAtMs !== rollback.acquiredAtMs ||
							!samePath(agent.ownerAgentPath, rollback.ownerAgentPath) ||
							!samePath(agent.agentPath, rollback.agentPath)))
				) {
					return batchReleaseFailure(
						ledger,
						effectiveLimits,
						this.ownerAgentPath,
						lease.logicalAgentId,
						"ownership_changed",
					);
				}
			}

			const releasedIds = new Set(leases.map(({ logicalAgentId }) => logicalAgentId));
			if (releasedIds.size > 0) {
				ledger.leases = ledger.leases.filter((lease) => !releasedIds.has(lease.logicalAgentId));
				if (rollbackAgents) {
					ledger.agents = ledger.agents.filter((agent) => !releasedIds.has(agent.logicalAgentId));
					ledger.total = Math.max(0, ledger.total - releasedIds.size);
				}
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
		// Process inspection may include bounded TERM/KILL waits. Snapshot under
		// the ledger lock, perform every OS operation after releasing it, then
		// conditionally remove only the same lease IDs under a fresh lock.
		const observed = await this.ledger.transact((ledger, effectiveLimits) => ({
			value: {
				leases: ledger.leases.map((record) => toPublicLease(this.sessionId, record)),
				snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
			},
			changed: false,
		}));
		const reclaimable = observed.leases.filter((lease) => isPidAlive(lease.pid, lease) === false);
		if (reclaimable.length === 0) {
			return { reclaimedLogicalAgentIds: [], snapshot: observed.snapshot };
		}
		const expectedLeaseIds = new Map(reclaimable.map((lease) => [lease.logicalAgentId, lease.leaseId]));
		return this.ledger.transact((ledger, effectiveLimits) => {
			const reclaimed = ledger.leases
				.filter((record) => expectedLeaseIds.get(record.logicalAgentId) === record.leaseId)
				.map((record) => record.logicalAgentId);
			const reclaimedSet = new Set(reclaimed);
			ledger.leases = ledger.leases.filter((record) => !reclaimedSet.has(record.logicalAgentId));
			return {
				value: {
					reclaimedLogicalAgentIds: reclaimed,
					snapshot: snapshotLedger(ledger, effectiveLimits, this.ownerAgentPath),
				},
				changed: reclaimed.length > 0,
			};
		});
	}
	private currentSystemBootIdentity(): string | undefined {
		if (!this.systemBootIdentityRead) {
			this.systemBootIdentity = safeSystemBootIdentity(this.readSystemBootIdentity);
			this.systemBootIdentityRead = true;
		}
		return this.systemBootIdentity;
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
