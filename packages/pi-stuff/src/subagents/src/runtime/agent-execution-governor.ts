import { isRuntimeString } from "../../../shared/runtime-type.js";
import type {
	AcquireAgentRequest,
	AcquireSpawnRequest,
	AgentGovernorLease,
	RebindAgentRuntimeRequest,
	SessionGovernorAcquireError,
	SessionGovernorAcquireResult,
	SessionGovernorBatchAcquireResult,
	SessionGovernorBatchReleaseResult,
	SessionGovernorLimitInput,
	SessionGovernorRebindResult,
	SessionGovernorReleaseResult,
} from "./session-governor.ts";

/** The durable governor operations needed by an execution host. */
export interface AgentExecutionGovernorBackend {
	acquireSpawnBatch(requests: readonly AcquireSpawnRequest[]): Promise<SessionGovernorBatchAcquireResult>;
	acquireResume(request: AcquireAgentRequest): Promise<SessionGovernorAcquireResult>;
	rebindRuntime(lease: AgentGovernorLease, request: RebindAgentRuntimeRequest): Promise<SessionGovernorRebindResult>;
	findRuntimeLease(runtimeRunId: string, childIndex: number): Promise<AgentGovernorLease | undefined>;
	abortSpawnBatch(leases: readonly AgentGovernorLease[]): Promise<SessionGovernorBatchReleaseResult>;
	release(lease: AgentGovernorLease): Promise<SessionGovernorReleaseResult>;
}

export interface AgentExecutionReservation {
	readonly kind: "spawn" | "resume";
	/** Stable identity allocated before the execution implementation chooses its runtime ID. */
	readonly launchRunId: string;
	/** Prefix used for durable child identities. A resume keeps the target run's prefix. */
	readonly logicalRunId: string;
	readonly leases: readonly AgentGovernorLease[];
}

export type AgentExecutionReservationResult =
	| {
			readonly ok: true;
			readonly reservation: AgentExecutionReservation;
	  }
	| {
			readonly ok: false;
			readonly error: SessionGovernorAcquireError;
			readonly message: string;
	  };

export interface ReserveAgentSpawnInput {
	readonly launchRunId: string;
	readonly childCount: number;
	readonly childLimits?: SessionGovernorLimitInput;
	readonly pid?: number;
}

export interface ReserveAgentResumeInput {
	readonly launchRunId: string;
	readonly targetRunId: string;
	readonly childIndex: number;
	readonly pid?: number;
}

export type AgentExecutionSettlement =
	| {
			readonly kind: "foreground";
			/** Reservation indexes whose children reached a durable terminal state. */
			readonly terminalChildIndexes: readonly number[];
	  }
	| { readonly kind: "detached" }
	| { readonly kind: "background-started" }
	| { readonly kind: "start-error" };

export interface AgentExecutionSettlementResult {
	readonly releasedCount: number;
	readonly alreadyReleasedCount: number;
	readonly retainedCount: number;
}

export type AgentRuntimeCompletionResult =
	| {
			readonly released: true;
			readonly logicalAgentId: string;
	  }
	| {
			readonly released: false;
			readonly reason: "not_found" | "already_released" | "ownership_changed";
	  };

export interface AgentRuntimeCompletionEvent {
	readonly runtimeRunId: string;
	readonly childIndex: number;
}

/**
 * Converts execution lifecycle boundaries into durable session-governor operations.
 * It intentionally knows nothing about Pi tool calls, renderers, or host result types.
 */
export class AgentExecutionGovernor {
	constructor(private readonly backend: AgentExecutionGovernorBackend) {}

	/** Reserve an entire launch in one backend transaction. */
	async reserveSpawn(input: ReserveAgentSpawnInput): Promise<AgentExecutionReservationResult> {
		const launchRunId = requiredText("launchRunId", input.launchRunId);
		const childCount = positiveSafeInteger("childCount", input.childCount);
		const requests = Array.from({ length: childCount }, (_, childIndex): AcquireSpawnRequest => {
			const request: AcquireSpawnRequest = {
				logicalAgentId: agentExecutionLogicalId(launchRunId, childIndex),
				runtimeRunId: launchRunId,
				childIndex,
			};
			if (input.childLimits) Object.assign(request, { childLimits: input.childLimits });
			if (input.pid !== undefined) Object.assign(request, { pid: input.pid });
			return request;
		});
		const acquired = await this.backend.acquireSpawnBatch(requests);
		if (!acquired.ok) return reservationFailure(acquired.error, "start", childCount);
		return {
			ok: true,
			reservation: createReservation("spawn", launchRunId, launchRunId, acquired.leases),
		};
	}

	/** Resume one durable child while giving this execution attempt its own launch identity. */
	async reserveResume(input: ReserveAgentResumeInput): Promise<AgentExecutionReservationResult> {
		const launchRunId = requiredText("launchRunId", input.launchRunId);
		const targetRunId = requiredText("targetRunId", input.targetRunId);
		const childIndex = nonNegativeSafeInteger("childIndex", input.childIndex);
		const request: AcquireAgentRequest = {
			logicalAgentId: agentExecutionLogicalId(targetRunId, childIndex),
			runtimeRunId: launchRunId,
			childIndex,
		};
		if (input.pid !== undefined) Object.assign(request, { pid: input.pid });
		const acquired = await this.backend.acquireResume(request);
		if (!acquired.ok) return reservationFailure(acquired.error, "resume", 1);
		return {
			ok: true,
			reservation: createReservation("resume", launchRunId, targetRunId, [acquired.lease]),
		};
	}

	/** Replace a provisional launch mapping after the execution layer publishes its real runtime identity. */
	async rebindChild(
		reservation: AgentExecutionReservation,
		reservationIndex: number,
		request: RebindAgentRuntimeRequest,
	): Promise<SessionGovernorRebindResult> {
		const lease = reservationLease(reservation, reservationIndex);
		return this.backend.rebindRuntime(lease, request);
	}

	/**
	 * Apply the host's launch outcome. Detached/background work keeps its lease; a foreground
	 * return releases only children known to be terminal; a failed start releases every reservation.
	 */
	async settle(
		reservation: AgentExecutionReservation,
		settlement: AgentExecutionSettlement,
	): Promise<AgentExecutionSettlementResult> {
		if (settlement.kind === "detached" || settlement.kind === "background-started") {
			return {
				releasedCount: 0,
				alreadyReleasedCount: 0,
				retainedCount: reservation.leases.length,
			};
		}

		if (settlement.kind === "start-error" && reservation.kind === "spawn") {
			const aborted = await this.backend.abortSpawnBatch(reservation.leases);
			return {
				releasedCount: aborted.released ? aborted.releasedCount : 0,
				alreadyReleasedCount: aborted.released ? 0 : reservation.leases.length,
				retainedCount: 0,
			};
		}

		const selectedIndexes =
			settlement.kind === "start-error"
				? reservation.leases.map((_, index) => index)
				: uniqueReservationIndexes(reservation, settlement.terminalChildIndexes);
		let releasedCount = 0;
		let alreadyReleasedCount = 0;
		for (const index of selectedIndexes) {
			const released = await this.backend.release(reservationLease(reservation, index));
			if (released.released) releasedCount += 1;
			else alreadyReleasedCount += 1;
		}

		return {
			releasedCount,
			alreadyReleasedCount,
			retainedCount: reservation.leases.length - selectedIndexes.length,
		};
	}

	async findRuntimeLease(event: AgentRuntimeCompletionEvent): Promise<AgentGovernorLease | undefined> {
		return this.backend.findRuntimeLease(
			requiredText("runtimeRunId", event.runtimeRunId),
			nonNegativeSafeInteger("childIndex", event.childIndex),
		);
	}

	/** Release the lease addressed by a durable runtime completion event. Duplicate events are harmless. */
	async completeRuntime(event: AgentRuntimeCompletionEvent): Promise<AgentRuntimeCompletionResult> {
		const runtimeRunId = requiredText("runtimeRunId", event.runtimeRunId);
		const childIndex = nonNegativeSafeInteger("childIndex", event.childIndex);
		const lease = await this.backend.findRuntimeLease(runtimeRunId, childIndex);
		if (!lease) return { released: false, reason: "not_found" };
		const result = await this.backend.release(lease);
		if (result.released) return { released: true, logicalAgentId: lease.logicalAgentId };
		return { released: false, reason: result.reason ?? "already_released" };
	}
}

export function agentExecutionLogicalId(runId: string, childIndex: number): string {
	return `${requiredText("runId", runId)}:${nonNegativeSafeInteger("childIndex", childIndex)}`;
}

export function formatAgentExecutionGovernorError(
	error: SessionGovernorAcquireError,
	action: "start" | "resume",
	requestedAgents: number,
): string {
	const requested = positiveSafeInteger("requestedAgents", requestedAgents);
	if (error.kind === "limit") {
		if (error.code === "depth_limit") {
			return (
				`Cannot ${action} ${agentCount(requested)}: this session allows Agents to nest only ` +
				`${error.limit} levels deep. Finish this work in the current Agent instead.`
			);
		}
		if (error.code === "running_limit") {
			return (
				`Cannot ${action} ${agentCount(requested)}: ${error.used} ${plural(error.used, "Agent is", "Agents are")} ` +
				`already running in this session and only ${error.limit} may run at once. ` +
				"Wait for a running Agent to finish or stop one, then try again."
			);
		}
		return (
			`Cannot ${action} ${agentCount(requested)}: this session has already created ${error.used} of its ` +
			`${error.limit} Agent limit. Start a new Pi session to create more Agents.`
		);
	}

	if (error.code === "logical_agent_exists") {
		return `Cannot start Agent '${error.logicalAgentId}' because that child is already recorded. Resume it instead.`;
	}
	if (error.code === "logical_agent_running") {
		return `Cannot resume Agent '${error.logicalAgentId}' because it is still running. Check its status or stop it first.`;
	}
	if (error.code === "logical_agent_unknown") {
		return `Cannot resume Agent '${error.logicalAgentId}' because this session has no saved record for that child.`;
	}
	return (
		`Cannot resume Agent '${error.logicalAgentId}' from here because it belongs to a different parent Agent. ` +
		"Resume it from the Agent that created it."
	);
}

function reservationFailure(
	error: SessionGovernorAcquireError,
	action: "start" | "resume",
	requestedAgents: number,
): AgentExecutionReservationResult {
	return {
		ok: false,
		error,
		message: formatAgentExecutionGovernorError(error, action, requestedAgents),
	};
}

function createReservation(
	kind: AgentExecutionReservation["kind"],
	launchRunId: string,
	logicalRunId: string,
	leases: readonly AgentGovernorLease[],
): AgentExecutionReservation {
	return Object.freeze({
		kind,
		launchRunId,
		logicalRunId,
		leases: Object.freeze([...leases]),
	});
}

function reservationLease(reservation: AgentExecutionReservation, reservationIndex: number): AgentGovernorLease {
	const index = nonNegativeSafeInteger("reservationIndex", reservationIndex);
	const lease = reservation.leases[index];
	if (!lease) {
		throw new RangeError(
			`Agent reservation has ${reservation.leases.length} ${plural(reservation.leases.length, "child", "children")}; ` +
				`index ${index} is out of range.`,
		);
	}
	return lease;
}

function uniqueReservationIndexes(
	reservation: AgentExecutionReservation,
	indexes: readonly number[],
): readonly number[] {
	const unique = new Set<number>();
	for (const rawIndex of indexes) {
		const index = nonNegativeSafeInteger("terminalChildIndex", rawIndex);
		reservationLease(reservation, index);
		unique.add(index);
	}
	return [...unique];
}

function requiredText(name: string, value: string): string {
	if (!isRuntimeString(value) || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value.trim();
}

function positiveSafeInteger(name: string, value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
	return value;
}

function nonNegativeSafeInteger(name: string, value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer.`);
	return value;
}

function agentCount(count: number): string {
	return `${count} ${plural(count, "Agent", "Agents")}`;
}

function plural<T>(count: number, singular: T, pluralValue: T): T {
	return count === 1 ? singular : pluralValue;
}
