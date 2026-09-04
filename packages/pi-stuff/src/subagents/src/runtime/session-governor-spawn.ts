import {
	type AcquireSpawnRequest,
	type AgentGovernorLease,
	type AgentRecord,
	createLease,
	emptyAgentWorkUsage,
	type GovernorLedger,
	nonNegativeInteger,
	positiveInteger,
	runtimeAddressKey,
	type SessionGovernorAcquireError,
	type SessionGovernorBatchAcquireResult,
	type SessionGovernorConflictCode,
	type SessionGovernorConflictError,
	type SessionGovernorLimitCode,
	type SessionGovernorLimitError,
	type SessionGovernorLimits,
	SessionGovernorStateError,
	snapshotLedger,
	stableText,
	type TransactionResult,
	tightenSessionGovernorLimits,
	toLeaseRecord,
	type ValidatedSpawnRequest,
	validateLimitInput,
} from "./session-governor-ledger.ts";

interface SpawnReservationContext {
	readonly ledger: GovernorLedger;
	readonly effectiveLimits: SessionGovernorLimits;
	readonly requests: readonly ValidatedSpawnRequest[];
	readonly sessionId: string;
	readonly ownerAgentPath: readonly string[];
	readonly systemBootIdentity: string | undefined;
	readonly now: () => number;
	readonly token: () => string;
}

interface StagedSpawn {
	readonly agent: AgentRecord;
	readonly lease: AgentGovernorLease;
}

export function validateSpawnRequests(
	requests: readonly AcquireSpawnRequest[],
	defaultPid: number,
	readProcessStartIdentity: (pid: number) => string | undefined,
): ValidatedSpawnRequest[] {
	return requests.map((request) => {
		const logicalAgentId = stableText("logicalAgentId", request.logicalAgentId);
		const pid = positiveInteger("pid", request.pid ?? defaultPid);
		const processStartIdentity = readProcessStartIdentity(pid);
		let validated: ValidatedSpawnRequest = {
			logicalAgentId,
			runtimeRunId: stableText("runtimeRunId", request.runtimeRunId ?? logicalAgentId),
			childIndex: nonNegativeInteger("childIndex", request.childIndex ?? 0),
			pid,
			childLimits: validateLimitInput(request.childLimits ?? {}),
		};
		if (processStartIdentity) validated = { ...validated, processStartIdentity };
		return validated;
	});
}

export function reserveSpawnBatch(
	context: SpawnReservationContext,
): TransactionResult<SessionGovernorBatchAcquireResult> {
	const { ledger, effectiveLimits, requests, ownerAgentPath } = context;
	const duplicate = firstDuplicateLogicalAgentId(requests);
	if (duplicate) {
		return batchAcquireFailure(
			context,
			conflictError(
				"logical_agent_exists",
				duplicate,
				`Logical Agent '${duplicate}' appears more than once in the same spawn reservation.`,
			),
		);
	}

	const existing = requests.find((request) =>
		ledger.agents.some((agent) => agent.logicalAgentId === request.logicalAgentId),
	);
	if (existing) {
		return batchAcquireFailure(
			context,
			conflictError(
				"logical_agent_exists",
				existing.logicalAgentId,
				`Logical Agent '${existing.logicalAgentId}' already exists in this session; use resume instead of spawning it again.`,
			),
		);
	}

	const runtimeAddresses = new Set(ledger.leases.map(runtimeAddressKey));
	const addressConflict = requests.find((request) => {
		const address = runtimeAddressKey(request);
		if (runtimeAddresses.has(address)) return true;
		runtimeAddresses.add(address);
		return false;
	});
	if (addressConflict) {
		return batchAcquireFailure(
			context,
			conflictError(
				"runtime_address_in_use",
				addressConflict.logicalAgentId,
				`Runtime Agent address '${addressConflict.runtimeRunId}:${addressConflict.childIndex}' is already reserved in this session.`,
			),
		);
	}

	const firstRequest = requests[0];
	if (!firstRequest) {
		return {
			value: {
				ok: true,
				leases: Object.freeze([]),
				snapshot: snapshotLedger(ledger, effectiveLimits, ownerAgentPath),
			},
			changed: false,
		};
	}

	const capacityError = spawnCapacityError(ledger, effectiveLimits, ownerAgentPath, requests, firstRequest);
	if (capacityError) return batchAcquireFailure(context, capacityError);

	const staged = stageSpawns(context);
	ledger.total += staged.length;
	ledger.agents.push(...staged.map(({ agent }) => agent));
	ledger.leases.push(...staged.map(({ lease }) => toLeaseRecord(lease)));
	return {
		value: {
			ok: true,
			leases: Object.freeze(staged.map(({ lease }) => lease)),
			snapshot: snapshotLedger(ledger, effectiveLimits, ownerAgentPath),
		},
		changed: staged.length > 0,
	};
}

function spawnCapacityError(
	ledger: GovernorLedger,
	effectiveLimits: SessionGovernorLimits,
	ownerAgentPath: readonly string[],
	requests: readonly ValidatedSpawnRequest[],
	firstRequest: ValidatedSpawnRequest,
): SessionGovernorLimitError | undefined {
	const childDepth = ownerAgentPath.length + 1;
	if (childDepth > effectiveLimits.maxDepth) {
		return limitError(
			"depth_limit",
			firstRequest.logicalAgentId,
			effectiveLimits.maxDepth,
			ownerAgentPath.length,
			childDepth,
		);
	}
	if (ledger.leases.length + requests.length > effectiveLimits.maxRunning) {
		const unavailable = firstUnavailableRequest(requests, effectiveLimits.maxRunning - ledger.leases.length);
		return limitError(
			"running_limit",
			unavailable.logicalAgentId,
			effectiveLimits.maxRunning,
			ledger.leases.length,
			requests.length,
		);
	}
	return undefined;
}

function stageSpawns(context: SpawnReservationContext): StagedSpawn[] {
	const acquiredAtMs = context.now();
	return context.requests.map((request) => {
		const agentPath = [...context.ownerAgentPath, request.logicalAgentId];
		let leaseInput: AgentGovernorLease = {
			sessionId: context.sessionId,
			logicalAgentId: request.logicalAgentId,
			runtimeRunId: request.runtimeRunId,
			childIndex: request.childIndex,
			leaseId: context.token(),
			ownerAgentPath: context.ownerAgentPath,
			agentPath,
			pid: request.pid,
			mode: "spawn",
			acquiredAtMs,
		};
		if (request.processStartIdentity)
			leaseInput = { ...leaseInput, processStartIdentity: request.processStartIdentity };
		if (context.systemBootIdentity) leaseInput = { ...leaseInput, systemBootIdentity: context.systemBootIdentity };
		return {
			lease: createLease(leaseInput),
			agent: {
				logicalAgentId: request.logicalAgentId,
				ownerAgentPath: [...context.ownerAgentPath],
				agentPath,
				limits: tightenSessionGovernorLimits(context.effectiveLimits, request.childLimits),
				createdAtMs: acquiredAtMs,
				workUsage: emptyAgentWorkUsage(),
			},
		};
	});
}

function batchAcquireFailure(
	context: SpawnReservationContext,
	error: SessionGovernorAcquireError,
): TransactionResult<SessionGovernorBatchAcquireResult> {
	return {
		value: {
			ok: false,
			error,
			snapshot: snapshotLedger(context.ledger, context.effectiveLimits, context.ownerAgentPath),
		},
		changed: false,
	};
}

export function firstDuplicateLogicalAgentId(
	entries: readonly { readonly logicalAgentId: string }[],
): string | undefined {
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

export function conflictError(
	code: SessionGovernorConflictCode,
	logicalAgentId: string,
	message: string,
): SessionGovernorConflictError {
	return { kind: "conflict", code, logicalAgentId, message };
}

export function limitError(
	code: SessionGovernorLimitCode,
	logicalAgentId: string,
	limit: number,
	used: number,
	requested: number,
): SessionGovernorLimitError {
	const resource = code === "depth_limit" ? "depth" : "running Agent";
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
