import { isRuntimeFunction, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import {
	inspectWriterChildProcessLiveness,
	inspectWriterProcessLiveness,
	terminateOrphanWriterProcesses,
} from "../runs/background/writer-process-registry.ts";
import { readForegroundOwnerExit } from "../runs/foreground/owner-exit.ts";
import { readProcessStartIdentity, readSystemBootIdentity } from "../shared/process-identity.ts";
import { readStatus } from "../shared/utils.ts";
import {
	AgentExecutionGovernor,
	type AgentExecutionReservation,
	type AgentExecutionReservationResult,
	type AgentExecutionSettlement,
	type AgentExecutionSettlementResult,
	type AgentRuntimeCompletionEvent,
	type AgentRuntimeCompletionResult,
	type ReserveAgentResumeInput,
	type ReserveAgentSpawnInput,
} from "./agent-execution-governor.ts";
import {
	type AgentGovernorLease,
	type RebindAgentRuntimeRequest,
	SessionAgentGovernor,
	type SessionGovernorLimitInput,
	type SessionGovernorRebindResult,
	type SessionGovernorSnapshot,
} from "./session-governor.ts";

export interface AgentExecutionGovernorPort {
	reserveSpawn(input: ReserveAgentSpawnInput): Promise<AgentExecutionReservationResult>;
	reserveResume(input: ReserveAgentResumeInput): Promise<AgentExecutionReservationResult>;
	rebindChild(
		reservation: AgentExecutionReservation,
		reservationIndex: number,
		request: RebindAgentRuntimeRequest,
	): Promise<SessionGovernorRebindResult>;
	settle(
		reservation: AgentExecutionReservation,
		settlement: AgentExecutionSettlement,
	): Promise<AgentExecutionSettlementResult>;
	findRuntimeLease(event: AgentRuntimeCompletionEvent): Promise<AgentGovernorLease | undefined>;
	completeRuntime(event: AgentRuntimeCompletionEvent): Promise<AgentRuntimeCompletionResult>;
}

export interface AgentExecutionCoordinatorSession {
	readonly governor: AgentExecutionGovernorPort;
	hasLedger?(): Promise<boolean>;
	inspectExistingSnapshot?(): Promise<SessionGovernorSnapshot | undefined>;
	reconcile(isPidAlive: (pid: number, lease: AgentGovernorLease) => boolean | undefined): Promise<void>;
}

export interface AgentExecutionSessionIdentity {
	readonly sessionId: string;
	readonly ownerAgentPath: readonly string[];
}

export interface GovernedAgentParams {
	readonly action?: "resume" | "status" | "steer" | "stop";
	readonly agent?: unknown;
	readonly id?: string;
	readonly index?: number;
	readonly task?: unknown;
	readonly tasks?: readonly unknown[];
}

export interface GovernedEngineResult {
	readonly isError?: boolean;
	readonly details: {
		readonly asyncId?: string;
		readonly runId?: string;
		readonly results?: readonly unknown[];
		readonly lifecycleBinding?: {
			readonly pid: number;
			readonly processStartIdentity?: string;
			readonly asyncDir: string;
			readonly acknowledgeStart?: () => void;
			readonly abortStart?: () => boolean;
		};
	};
}

export interface AgentExecutionInvocation {
	readonly launchRunId: string;
	readonly reservation: AgentExecutionReservation;
}

export type AgentExecutionPrepareResult =
	| { readonly ok: true; readonly invocation?: AgentExecutionInvocation }
	| { readonly ok: false; readonly message: string };

export interface AgentExecutionCoordinatorPort {
	bindSession(identity: AgentExecutionSessionIdentity): void;
	prepare(input: {
		readonly launchRunId: string;
		readonly params: GovernedAgentParams;
		readonly resumeTargetRunId?: string;
	}): Promise<AgentExecutionPrepareResult>;
	observeAsyncStarted<Event>(event: Event): Promise<void>;
	settle(invocation: AgentExecutionInvocation, result: GovernedEngineResult): Promise<void>;
	fail(invocation: AgentExecutionInvocation): Promise<void>;
	complete<Event>(event: Event): Promise<void>;
	reconcileDead(): Promise<void>;
	reconcileExisting(): Promise<void>;
	inspectExistingRuntimeLeases?(): Promise<readonly AgentGovernorLease[]>;
	dispose(): void;
}

export interface AgentExecutionCoordinatorOptions {
	readonly createSession: (identity: AgentExecutionSessionIdentity) => AgentExecutionCoordinatorSession;
	readonly isPidAlive?: (pid: number) => boolean | undefined;
	readonly readProcessStartIdentity?: (pid: number) => string | undefined;
	readonly readSystemBootIdentity?: () => string | undefined;
}

interface AsyncStart {
	runtimeRunId: string;
	pid?: number;
	processStartIdentity?: string;
	asyncDir?: string;
	acknowledgeStart?: () => void;
	abortStart?: () => boolean;
}

interface AgentRuntimeEventRecord {
	readonly abortStart?: unknown;
	readonly acknowledgeStart?: unknown;
	readonly asyncDir?: unknown;
	readonly code?: unknown;
	readonly detached?: unknown;
	readonly id?: unknown;
	readonly index?: unknown;
	readonly pid?: unknown;
	readonly processStartIdentity?: unknown;
	readonly results?: unknown;
	readonly runId?: unknown;
	readonly taskIndex?: unknown;
}

export class AgentRuntimeBindingRejectedError extends Error {
	readonly code = "agent_runtime_binding_rejected";

	constructor(message: string) {
		super(message);
		this.name = "AgentRuntimeBindingRejectedError";
	}
}

const GOVERNOR_RETRY_DELAYS_MS = [25, 100, 500, 2_000] as const;

interface BoundInvocation {
	readonly invocation: AgentExecutionInvocation;
	readonly session: AgentExecutionCoordinatorSession;
	readonly generation: number;
	readonly starts: Map<string, AsyncStart>;
	settled: boolean;
	pending?: PendingSettlement;
}

interface PendingSettlement {
	readonly owner?: BoundInvocation;
	readonly session: AgentExecutionCoordinatorSession;
	readonly reservation: AgentExecutionReservation;
	readonly runtimeRunId: string;
	readonly start?: AsyncStart;
	readonly bindRuntime: boolean;
	readonly settlement: AgentExecutionSettlement;
	retryIndex: number;
	retryTimer?: ReturnType<typeof setTimeout>;
	inFlight?: Promise<void>;
}

interface PendingSettlementInput {
	readonly owner?: BoundInvocation;
	readonly session: AgentExecutionCoordinatorSession;
	readonly reservation: AgentExecutionReservation;
	readonly runtimeRunId: string;
	start?: AsyncStart;
	readonly bindRuntime: boolean;
	readonly settlement: AgentExecutionSettlement;
}

interface PendingCompletion {
	readonly address: AgentRuntimeCompletionEvent;
	readonly session: AgentExecutionCoordinatorSession;
	readonly generation: number;
	readonly bindingCandidates: Set<BoundInvocation>;
	retryIndex: number;
	retryTimer?: ReturnType<typeof setTimeout>;
	inFlight?: Promise<void>;
}

/** Pure lifecycle coordinator shared by the root extension and fanout children. */
export class AgentExecutionCoordinator implements AgentExecutionCoordinatorPort {
	private readonly active = new Map<string, BoundInvocation>();
	private readonly asyncStarts = new Map<string, AsyncStart>();
	private readonly createSession: AgentExecutionCoordinatorOptions["createSession"];
	private readonly isPidAlive: (pid: number) => boolean | undefined;
	private readonly readProcessStartIdentity: (pid: number) => string | undefined;
	private readonly readSystemBootIdentity: () => string | undefined;
	private systemBootIdentity: string | undefined;
	private systemBootIdentityRead = false;
	private readonly invocationRecords = new WeakMap<AgentExecutionInvocation, BoundInvocation>();
	private readonly pendingCompletions = new Map<string, PendingCompletion>();
	private readonly pendingSettlements = new Set<PendingSettlement>();
	private boundIdentity: AgentExecutionSessionIdentity | undefined;
	private boundSession: AgentExecutionCoordinatorSession | undefined;
	private generation = 0;

	constructor(options: AgentExecutionCoordinatorOptions) {
		this.createSession = options.createSession;
		this.isPidAlive = options.isPidAlive ?? explicitProcessPidState;
		this.readProcessStartIdentity = options.readProcessStartIdentity ?? readProcessStartIdentity;
		this.readSystemBootIdentity = options.readSystemBootIdentity ?? readSystemBootIdentity;
	}

	bindSession(identity: AgentExecutionSessionIdentity): void {
		const sessionId = requiredText("sessionId", identity.sessionId);
		const ownerAgentPath = identity.ownerAgentPath.map((component) => requiredText("ownerAgentPath", component));
		if (this.boundIdentity?.sessionId === sessionId && samePath(this.boundIdentity.ownerAgentPath, ownerAgentPath)) {
			return;
		}
		this.generation += 1;
		this.clearEphemeralState();
		this.boundIdentity = Object.freeze({ sessionId, ownerAgentPath: Object.freeze(ownerAgentPath) });
		this.boundSession = undefined;
	}

	async prepare(input: {
		readonly launchRunId: string;
		readonly params: GovernedAgentParams;
		readonly resumeTargetRunId?: string;
	}): Promise<AgentExecutionPrepareResult> {
		const launchRunId = requiredText("launchRunId", input.launchRunId);
		if (input.params.action && input.params.action !== "resume") return { ok: true };
		const session = this.sessionOrFailure();
		if (isRuntimeString(session)) return { ok: false, message: session };
		const generation = this.generation;
		try {
			// A nested background completion may outlive the fanout Host that
			// launched it. Reclaim only OS-proven dead leases before enforcing the
			// next capacity reservation, so sequential work cannot exhaust running.
			await session.reconcile((pid, lease) => this.runtimeProcessState(pid, lease));
		} catch (error) {
			return {
				ok: false,
				message: `Cannot verify Agent capacity before launch: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
		if (this.generation !== generation) {
			return { ok: false, message: "Agent launch cancelled because the parent session ended or changed." };
		}

		let reserved: AgentExecutionReservationResult;
		if (input.params.action === "resume") {
			const targetRunId = input.resumeTargetRunId?.trim() || input.params.id?.trim();
			if (!targetRunId) return { ok: false, message: "Cannot resume an Agent without its run id." };
			reserved = await session.governor.reserveResume({
				launchRunId,
				targetRunId,
				childIndex: nonNegativeSafeInteger("index", input.params.index ?? 0),
			});
		} else {
			reserved = await session.governor.reserveSpawn({
				launchRunId,
				childCount: input.params.tasks?.length || 1,
			});
		}
		if (!reserved.ok) return { ok: false, message: reserved.message };
		const invocation = Object.freeze({ launchRunId, reservation: reserved.reservation });
		if (this.generation !== generation) {
			const rollback = this.createPendingSettlement({
				session,
				reservation: reserved.reservation,
				runtimeRunId: launchRunId,
				bindRuntime: false,
				settlement: { kind: "start-error" },
			});
			try {
				await this.attemptPendingSettlement(rollback);
			} catch {
				this.scheduleSettlementRetry(rollback);
			}
			return {
				ok: false,
				message: "Agent launch cancelled because the parent session ended or changed during reservation.",
			};
		}
		const bound: BoundInvocation = {
			invocation,
			session,
			generation,
			starts: new Map(),
			settled: false,
		};
		this.active.set(launchRunId, bound);
		this.invocationRecords.set(invocation, bound);
		return { ok: true, invocation };
	}

	async observeAsyncStarted<Event>(event: Event): Promise<void> {
		const value = record(event);
		const runtimeRunId = optionalText(value.id) ?? optionalText(value.runId);
		if (!runtimeRunId) return;
		const pid = optionalPositiveSafeInteger(value.pid);
		const processStartIdentity =
			optionalText(value.processStartIdentity) ??
			(pid === undefined ? undefined : this.readProcessStartIdentity(pid));
		const asyncDir = optionalText(value.asyncDir);
		const acknowledgeStartCandidate = value.acknowledgeStart;
		const rawAcknowledgeStart = isRuntimeFunction(acknowledgeStartCandidate)
			? () => acknowledgeStartCandidate()
			: undefined;
		const abortStartCandidate = value.abortStart;
		const abortStart = isRuntimeFunction(abortStartCandidate) ? () => abortStartCandidate() === true : undefined;
		let startupAcknowledged = false;
		const acknowledgeStart = rawAcknowledgeStart
			? () => {
					if (startupAcknowledged) return;
					rawAcknowledgeStart();
					startupAcknowledged = true;
				}
			: undefined;
		const start: AsyncStart = { runtimeRunId };
		if (pid !== undefined) start.pid = pid;
		if (processStartIdentity !== undefined) start.processStartIdentity = processStartIdentity;
		if (asyncDir !== undefined) start.asyncDir = asyncDir;
		if (acknowledgeStart !== undefined) start.acknowledgeStart = acknowledgeStart;
		if (abortStart !== undefined) start.abortStart = abortStart;
		this.asyncStarts.set(runtimeRunId, start);
		const exact = this.active.get(runtimeRunId);
		const resumeCandidates = exact
			? []
			: [...this.active.values()].filter(
					(candidate) =>
						candidate.generation === this.generation && candidate.invocation.reservation.kind === "resume",
				);
		// A resume runtime id is assigned by the engine. Attach an ambiguous start
		// to every viable resume; only the invocation whose result names this id
		// will consume it during settlement.
		for (const candidate of resumeCandidates) candidate.starts.set(runtimeRunId, start);
		const owner = exact ?? (resumeCandidates.length === 1 ? resumeCandidates[0] : undefined);
		if (!owner) return;
		owner.starts.set(runtimeRunId, start);
		await this.bindReservationRuntime(owner.session, owner.invocation.reservation, runtimeRunId, start);
	}

	async settle(invocation: AgentExecutionInvocation, result: GovernedEngineResult): Promise<void> {
		const owner = this.invocationRecords.get(invocation);
		if (!owner || owner.settled) return;
		if (owner.pending) {
			await this.attemptPendingSettlement(owner.pending);
			return;
		}
		const runtimeRunId =
			optionalText(result.details.asyncId) ?? optionalText(result.details.runId) ?? invocation.launchRunId;
		const lifecycleBinding = result.details.lifecycleBinding;
		let resultStart: AsyncStart | undefined;
		if (lifecycleBinding) {
			resultStart = {
				runtimeRunId,
				pid: lifecycleBinding.pid,
				asyncDir: lifecycleBinding.asyncDir,
			};
			if (lifecycleBinding.processStartIdentity) {
				resultStart.processStartIdentity = lifecycleBinding.processStartIdentity;
			}
			if (lifecycleBinding.acknowledgeStart) resultStart.acknowledgeStart = lifecycleBinding.acknowledgeStart;
			if (lifecycleBinding.abortStart) resultStart.abortStart = lifecycleBinding.abortStart;
		}
		let settlement: AgentExecutionSettlement;
		let bindRuntime = true;
		const start = owner.starts.get(runtimeRunId) ?? this.asyncStarts.get(runtimeRunId) ?? resultStart;
		if (optionalText(result.details.asyncId)) {
			settlement = { kind: "background-started" };
		} else {
			const results = Array.isArray(result.details.results) ? result.details.results : [];
			if (results.length === 0) {
				const startupFailure = classifyStartupFailure(start);
				settlement = startupFailure.settlement;
				bindRuntime = startupFailure.bindRuntime;
			} else {
				const terminalChildIndexes = invocation.reservation.leases
					.map((_, index) => index)
					.filter((index) => record(results[index]).detached !== true);
				settlement = { kind: "foreground", terminalChildIndexes };
				// Fully foreground work is already terminal when the engine returns.
				// Rebinding it creates a completion-before-settle race: the durable
				// completion event may have released the provisional lease first.
				// Only a mixed result with retained detached children needs a runtime
				// mapping before foreground children are released.
				bindRuntime = terminalChildIndexes.length < invocation.reservation.leases.length;
			}
		}
		const pending = this.createPendingSettlement({
			owner,
			session: owner.session,
			reservation: invocation.reservation,
			runtimeRunId,
			start,
			bindRuntime,
			settlement,
		});
		owner.pending = pending;
		try {
			await this.attemptPendingSettlement(pending);
		} catch (error) {
			this.scheduleSettlementRetry(pending);
			throw error;
		}
	}

	async fail(invocation: AgentExecutionInvocation): Promise<void> {
		const owner = this.invocationRecords.get(invocation);
		if (!owner || owner.settled) return;
		if (owner.pending) {
			await this.attemptPendingSettlement(owner.pending);
			return;
		}
		const starts = [...owner.starts.values()];
		const start = owner.starts.get(invocation.launchRunId) ?? (starts.length === 1 ? starts[0] : undefined);
		const startupFailure = classifyStartupFailure(start, starts.length > 0);
		const pendingInput: PendingSettlementInput = {
			owner,
			session: owner.session,
			reservation: invocation.reservation,
			runtimeRunId: start?.runtimeRunId ?? invocation.launchRunId,
			bindRuntime: startupFailure.bindRuntime,
			settlement: startupFailure.settlement,
		};
		if (start) pendingInput.start = start;
		const pending = this.createPendingSettlement(pendingInput);
		owner.pending = pending;
		try {
			await this.attemptPendingSettlement(pending);
		} catch (error) {
			this.scheduleSettlementRetry(pending);
			throw error;
		}
	}

	async complete<Event>(event: Event): Promise<void> {
		if (!this.boundIdentity) return;
		const session = this.session();
		const generation = this.generation;
		let firstError: unknown;
		for (const address of runtimeCompletionAddresses(event)) {
			const pending = this.pendingCompletion(address, session, generation);
			try {
				await this.attemptPendingCompletion(pending);
			} catch (error) {
				firstError ??= error;
				this.scheduleCompletionRetry(pending);
			}
		}
		if (firstError !== undefined) throw firstError;
	}

	async reconcileDead(): Promise<void> {
		if (!this.boundIdentity) return;
		await this.session().reconcile((pid, lease) => this.runtimeProcessState(pid, lease));
	}

	async reconcileExisting(): Promise<void> {
		if (!this.boundIdentity) return;
		const session = this.session();
		if (session.hasLedger && !(await session.hasLedger())) return;
		await session.reconcile((pid, lease) => this.runtimeProcessState(pid, lease));
	}

	async inspectExistingRuntimeLeases(): Promise<readonly AgentGovernorLease[]> {
		if (!this.boundIdentity) return [];
		return (await this.session().inspectExistingSnapshot?.())?.leases ?? [];
	}

	dispose(): void {
		this.generation += 1;
		this.clearEphemeralState();
		this.boundIdentity = undefined;
		this.boundSession = undefined;
	}

	private createPendingSettlement(input: PendingSettlementInput): PendingSettlement {
		const pending: PendingSettlement = { ...input, retryIndex: 0 };
		this.pendingSettlements.add(pending);
		return pending;
	}

	private async attemptPendingSettlement(pending: PendingSettlement): Promise<void> {
		if (!this.pendingSettlements.has(pending)) return;
		if (pending.inFlight) return pending.inFlight;
		const inFlight = (async () => {
			try {
				if (pending.bindRuntime) {
					await this.bindReservationRuntime(
						pending.session,
						pending.reservation,
						pending.runtimeRunId,
						pending.start,
					);
				}
				if (pending.bindRuntime && pending.settlement.kind === "background-started") {
					// A process-terminal event can win the race against runtime binding
					// and inspect only the provisional Pi Host lease. Reconcile once more
					// after the durable pid/directory mapping exists so an already-dead
					// runner is reclaimed without waiting for another launch or reload.
					await pending.session.reconcile((pid, lease) => this.runtimeProcessState(pid, lease));
				}
			} catch (error) {
				if (!(error instanceof AgentRuntimeBindingRejectedError)) throw error;
				let safelyAborted = pending.start === undefined;
				try {
					safelyAborted = pending.start?.abortStart?.() === true;
				} catch {
					safelyAborted = false;
				}
				if (!safelyAborted) {
					// Ownership was rejected, but the runner may still be alive. Keep
					// the lease reserved so reconciliation retains authority to reap it.
					throw error;
				}
				await pending.session.governor.settle(pending.reservation, { kind: "start-error" });
				this.finishPendingSettlement(pending);
				throw error;
			}
			await pending.session.governor.settle(pending.reservation, pending.settlement);
			this.finishPendingSettlement(pending);
		})();
		pending.inFlight = inFlight;
		try {
			await inFlight;
		} finally {
			if (pending.inFlight === inFlight) pending.inFlight = undefined;
		}
	}

	private scheduleSettlementRetry(pending: PendingSettlement): void {
		if (!this.pendingSettlements.has(pending) || pending.retryTimer) return;
		const delay = retryDelay(pending.retryIndex);
		pending.retryIndex += 1;
		pending.retryTimer = setTimeout(() => {
			pending.retryTimer = undefined;
			void this.attemptPendingSettlement(pending).catch(() => this.scheduleSettlementRetry(pending));
		}, delay);
		pending.retryTimer.unref?.();
	}

	private finishPendingSettlement(pending: PendingSettlement): void {
		if (!this.pendingSettlements.delete(pending)) return;
		if (pending.retryTimer) clearTimeout(pending.retryTimer);
		pending.retryTimer = undefined;
		const owner = pending.owner;
		if (owner) {
			owner.settled = true;
			if (owner.pending === pending) owner.pending = undefined;
			if (this.active.get(owner.invocation.launchRunId) === owner) {
				this.active.delete(owner.invocation.launchRunId);
			}
			owner.starts.delete(pending.runtimeRunId);
			if (owner.generation === this.generation) this.asyncStarts.delete(pending.runtimeRunId);
			for (const completion of this.pendingCompletions.values()) {
				if (completion.bindingCandidates.has(owner)) this.scheduleCompletionRetry(completion);
			}
		}
		if (!pending.bindRuntime) {
			for (const completion of Array.from(this.pendingCompletions.values())) {
				if (completion.session === pending.session && completion.address.runtimeRunId === pending.runtimeRunId) {
					this.finishPendingCompletion(completion);
				}
			}
		}
	}

	private async bindReservationRuntime(
		session: AgentExecutionCoordinatorSession,
		reservation: AgentExecutionReservation,
		runtimeRunId: string,
		start?: AsyncStart,
	): Promise<void> {
		for (let reservationIndex = 0; reservationIndex < reservation.leases.length; reservationIndex += 1) {
			const request = {
				runtimeRunId,
				childIndex: reservation.kind === "resume" ? 0 : reservationIndex,
			} satisfies RebindAgentRuntimeRequest;
			if (start?.pid !== undefined) Object.assign(request, { pid: start.pid });
			if (start?.processStartIdentity !== undefined) {
				Object.assign(request, { processStartIdentity: start.processStartIdentity });
			}
			if (start?.asyncDir !== undefined) Object.assign(request, { asyncDir: start.asyncDir });
			const rebound = await session.governor.rebindChild(reservation, reservationIndex, request);
			if (!rebound.rebound) {
				throw new AgentRuntimeBindingRejectedError(
					`Agent runtime binding was rejected for child ${reservationIndex} (${rebound.reason}).`,
				);
			}
		}
		// The detached runner remains behind its startup gate until every child
		// lease durably names the runner and recovery directory.
		start?.acknowledgeStart?.();
		await this.drainPendingCompletions(runtimeRunId, session);
	}

	private pendingCompletion(
		address: AgentRuntimeCompletionEvent,
		session: AgentExecutionCoordinatorSession,
		generation: number,
	): PendingCompletion {
		const key = completionKey(address, generation);
		const existing = this.pendingCompletions.get(key);
		if (existing?.session === session) return existing;
		if (existing) this.finishPendingCompletion(existing);
		const exact = this.active.get(address.runtimeRunId);
		const bindingCandidates = new Set<BoundInvocation>();
		if (exact?.session === session && exact.generation === generation) bindingCandidates.add(exact);
		for (const candidate of this.active.values()) {
			if (
				candidate.session === session &&
				candidate.generation === generation &&
				candidate.invocation.reservation.kind === "resume"
			) {
				bindingCandidates.add(candidate);
			}
		}
		const pending: PendingCompletion = { address, session, generation, bindingCandidates, retryIndex: 0 };
		this.pendingCompletions.set(key, pending);
		return pending;
	}

	private async attemptPendingCompletion(pending: PendingCompletion): Promise<void> {
		const key = completionKey(pending.address, pending.generation);
		if (this.pendingCompletions.get(key) !== pending) return;
		if (pending.inFlight) return pending.inFlight;
		const inFlight = (async () => {
			const lease = await pending.session.governor.findRuntimeLease(pending.address);
			if (lease && this.runtimeProcessState(lease.pid, lease) !== false) {
				// A semantic completion event is not process-terminal proof. Retain
				// the lease and retry until its writer group is absent or safely reaped.
				this.scheduleCompletionRetry(pending);
				return;
			}
			const result = await pending.session.governor.completeRuntime(pending.address);
			if (
				result.released === false &&
				result.reason === "not_found" &&
				this.completionMayNeedRuntimeBinding(pending)
			) {
				return;
			}
			this.finishPendingCompletion(pending);
		})();
		pending.inFlight = inFlight;
		try {
			await inFlight;
		} finally {
			if (pending.inFlight === inFlight) pending.inFlight = undefined;
		}
	}

	private completionMayNeedRuntimeBinding(pending: PendingCompletion): boolean {
		if (
			[...this.pendingSettlements].some(
				(settlement) =>
					settlement.session === pending.session &&
					settlement.bindRuntime &&
					settlement.runtimeRunId === pending.address.runtimeRunId,
			)
		) {
			return true;
		}
		return [...pending.bindingCandidates].some((candidate) => !candidate.settled);
	}

	private scheduleCompletionRetry(pending: PendingCompletion): void {
		const key = completionKey(pending.address, pending.generation);
		if (this.pendingCompletions.get(key) !== pending || pending.retryTimer) return;
		const delay = retryDelay(pending.retryIndex);
		pending.retryIndex += 1;
		pending.retryTimer = setTimeout(() => {
			pending.retryTimer = undefined;
			void this.attemptPendingCompletion(pending).catch(() => this.scheduleCompletionRetry(pending));
		}, delay);
		pending.retryTimer.unref?.();
	}

	private finishPendingCompletion(pending: PendingCompletion): void {
		const key = completionKey(pending.address, pending.generation);
		if (this.pendingCompletions.get(key) !== pending) return;
		this.pendingCompletions.delete(key);
		if (pending.retryTimer) clearTimeout(pending.retryTimer);
		pending.retryTimer = undefined;
	}

	private async drainPendingCompletions(
		runtimeRunId: string,
		session: AgentExecutionCoordinatorSession,
	): Promise<void> {
		const pending = [...this.pendingCompletions.values()].filter(
			(completion) => completion.session === session && completion.address.runtimeRunId === runtimeRunId,
		);
		for (const completion of pending) {
			try {
				await this.attemptPendingCompletion(completion);
			} catch {
				this.scheduleCompletionRetry(completion);
			}
		}
	}

	private session(): AgentExecutionCoordinatorSession {
		if (this.boundSession) return this.boundSession;
		if (!this.boundIdentity) throw new Error("Agent execution governor has no bound parent session.");
		this.boundSession = this.createSession(this.boundIdentity);
		return this.boundSession;
	}

	private sessionOrFailure(): AgentExecutionCoordinatorSession | string {
		if (!this.boundIdentity) {
			return "Cannot start an Agent because the parent Pi session has no stable session id.";
		}
		return this.session();
	}

	private clearEphemeralState(): void {
		this.active.clear();
		this.asyncStarts.clear();
		// Pending settlements and completions retain their original durable
		// session authority. A late engine result after session switch/dispose must
		// still finish that old ledger instead of leaking a running lease.
	}

	private runtimeProcessState(pid: number, lease: AgentGovernorLease): boolean | undefined {
		const systemBootIdentity = lease.systemBootIdentity === undefined ? undefined : this.currentSystemBootIdentity();
		if (
			lease.systemBootIdentity !== undefined &&
			systemBootIdentity !== undefined &&
			lease.systemBootIdentity !== systemBootIdentity
		) {
			return false;
		}
		if (lease.asyncDir && readForegroundOwnerExit(lease.asyncDir, lease.runtimeRunId)) {
			try {
				// A foreground execution frame lives inside the long-running Pi Host.
				// Its durable owner-exit marker supersedes that Host PID: only the
				// exact child writer registry may keep this lease alive now.
				terminateOrphanWriterProcesses(lease.asyncDir);
				return inspectWriterChildProcessLiveness(lease.asyncDir, lease.childIndex);
			} catch {
				return undefined;
			}
		}
		let runnerState = this.isPidAlive(pid);
		if (runnerState === true) {
			const currentIdentity = this.readProcessStartIdentity(pid);
			runnerState =
				lease.processStartIdentity === undefined || currentIdentity === undefined
					? undefined
					: lease.processStartIdentity === currentIdentity;
		}
		if (lease.asyncDir) {
			let status: ReturnType<typeof readStatus>;
			try {
				status = readStatus(lease.asyncDir);
			} catch {
				// Status is semantic evidence, not process-liveness authority. If
				// the runner is OS-proven dead, the authenticated writer registry can
				// still prove that no process remains and release capacity. Unknown
				// runner/writer identity remains fail-closed.
				if (runnerState !== false) return undefined;
				terminateOrphanWriterProcesses(lease.asyncDir);
				return inspectWriterProcessLiveness(lease.asyncDir);
			}
			const step = status?.steps?.[lease.childIndex];
			if (
				status?.runId === lease.runtimeRunId &&
				step &&
				(step.status === "complete" ||
					step.status === "completed" ||
					step.status === "failed" ||
					step.status === "paused" ||
					step.status === "stopped")
			) {
				let writerState = inspectWriterChildProcessLiveness(lease.asyncDir, lease.childIndex);
				if (
					writerState !== false &&
					(runnerState === false ||
						status.state === "complete" ||
						status.state === "failed" ||
						status.state === "paused" ||
						status.state === "stopped")
				) {
					terminateOrphanWriterProcesses(lease.asyncDir);
					writerState = inspectWriterChildProcessLiveness(lease.asyncDir, lease.childIndex);
				}
				return writerState;
			}
		}
		if (runnerState !== false || !lease.asyncDir) return runnerState;
		terminateOrphanWriterProcesses(lease.asyncDir);
		return inspectWriterProcessLiveness(lease.asyncDir);
	}

	private currentSystemBootIdentity(): string | undefined {
		if (!this.systemBootIdentityRead) {
			this.systemBootIdentity = safeReadBootIdentity(this.readSystemBootIdentity);
			this.systemBootIdentityRead = true;
		}
		return this.systemBootIdentity;
	}
}

export interface DurableAgentExecutionCoordinatorOptions {
	readonly rootDir: string;
	readonly limits?: SessionGovernorLimitInput;
	readonly isPidAlive?: (pid: number) => boolean | undefined;
	readonly readProcessStartIdentity?: (pid: number) => string | undefined;
	readonly readSystemBootIdentity?: () => string | undefined;
}

export function createDurableAgentExecutionCoordinator(
	options: DurableAgentExecutionCoordinatorOptions,
): AgentExecutionCoordinator {
	return new AgentExecutionCoordinator({
		isPidAlive: options.isPidAlive,
		readProcessStartIdentity: options.readProcessStartIdentity,
		readSystemBootIdentity: options.readSystemBootIdentity,
		createSession: (identity) => {
			const sessionGovernor = new SessionAgentGovernor({
				rootDir: options.rootDir,
				sessionId: identity.sessionId,
				ownerAgentPath: identity.ownerAgentPath,
				limits: options.limits,
				readSystemBootIdentity: options.readSystemBootIdentity,
			});
			return {
				governor: new AgentExecutionGovernor(sessionGovernor),
				hasLedger: () => sessionGovernor.hasLedger(),
				inspectExistingSnapshot: () => sessionGovernor.inspectExistingSnapshot(),
				reconcile: async (isPidAlive) => {
					await sessionGovernor.reconcile(isPidAlive);
				},
			};
		},
	});
}

function safeReadBootIdentity(readIdentity: () => string | undefined): string | undefined {
	try {
		return readIdentity();
	} catch {
		return undefined;
	}
}

export function runtimeCompletionAddresses<Event>(event: Event): AgentRuntimeCompletionEvent[] {
	const value = record(event);
	const runtimeRunId = optionalText(value.runId) ?? optionalText(value.id);
	if (!runtimeRunId) return [];
	const results = Array.isArray(value.results) ? value.results : undefined;
	const indexes = results?.length
		? results.map((child, fallbackIndex) => completionChildIndex(record(child), fallbackIndex))
		: [completionChildIndex(value, 0)];
	const unique = new Set<number>();
	const addresses: AgentRuntimeCompletionEvent[] = [];
	for (const childIndex of indexes) {
		if (unique.has(childIndex)) continue;
		unique.add(childIndex);
		addresses.push({ runtimeRunId, childIndex });
	}
	return addresses;
}

export function parseAgentOwnerPath(value: string | undefined): string[] {
	if (!value?.trim()) return [];
	return value
		.split("›")
		.map((component) => component.trim())
		.filter((component) => component.length > 0);
}

/** Returns false only for an OS-confirmed missing process; permission and unknown failures remain undecided. */
export function explicitProcessPidState(pid: number): boolean | undefined {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = record(error).code;
		if (code === "ESRCH") return false;
		return undefined;
	}
}

function completionChildIndex(value: AgentRuntimeEventRecord, fallback: number): number {
	const candidate = value.taskIndex ?? value.index;
	return optionalNonNegativeSafeInteger(candidate) ?? fallback;
}

function completionKey(address: AgentRuntimeCompletionEvent, generation: number): string {
	return `${generation}\u0000${address.runtimeRunId}\u0000${address.childIndex}`;
}

function retryDelay(index: number): number {
	return GOVERNOR_RETRY_DELAYS_MS[Math.min(index, GOVERNOR_RETRY_DELAYS_MS.length - 1)] ?? 2_000;
}

interface StartupFailureClassification {
	readonly bindRuntime: boolean;
	readonly settlement: AgentExecutionSettlement;
}

function classifyStartupFailure(
	start: AsyncStart | undefined,
	hasAmbiguousObservedStart = false,
): StartupFailureClassification {
	if (!start && !hasAmbiguousObservedStart) {
		return { bindRuntime: false, settlement: { kind: "start-error" } };
	}
	if (start?.abortStart) {
		try {
			if (start.abortStart() === true) {
				return { bindRuntime: false, settlement: { kind: "start-error" } };
			}
		} catch {
			// An abort callback is only authority to release when it positively
			// proves that no started writer remains. Unknown failure stays retained.
		}
	}
	return {
		bindRuntime: start !== undefined,
		settlement: { kind: "background-started" },
	};
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((component, index) => component === right[index]);
}

function record<Value>(value: Value): AgentRuntimeEventRecord {
	if (!isRuntimeObject(value) || value === null || Array.isArray(value)) return {};
	// SAFETY: lifecycle consumers read only the declared raw fields and validate them before use.
	return value as Value & AgentRuntimeEventRecord;
}

function optionalText<Value>(value: Value): string | undefined {
	return isRuntimeString(value) && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredText(name: string, value: string): string {
	const resolved = optionalText(value);
	if (!resolved) throw new TypeError(`${name} must be a non-empty string.`);
	return resolved;
}

function optionalPositiveSafeInteger<Value>(value: Value): number | undefined {
	return isRuntimeNumber(value) && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function optionalNonNegativeSafeInteger<Value>(value: Value): number | undefined {
	return isRuntimeNumber(value) && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function nonNegativeSafeInteger(name: string, value: number): number {
	const resolved = optionalNonNegativeSafeInteger(value);
	if (resolved === undefined) throw new TypeError(`${name} must be a non-negative safe integer.`);
	return resolved;
}
