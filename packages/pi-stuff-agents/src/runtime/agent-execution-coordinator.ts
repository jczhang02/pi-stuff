import { inspectWriterProcessLiveness } from "../runs/background/writer-process-registry.ts";
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
	completeRuntime(event: AgentRuntimeCompletionEvent): Promise<AgentRuntimeCompletionResult>;
}

export interface AgentExecutionCoordinatorSession {
	readonly governor: AgentExecutionGovernorPort;
	hasLedger?(): Promise<boolean>;
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
	observeAsyncStarted(event: unknown): Promise<void>;
	settle(invocation: AgentExecutionInvocation, result: GovernedEngineResult): Promise<void>;
	fail(invocation: AgentExecutionInvocation): Promise<void>;
	complete(event: unknown): Promise<void>;
	reconcileDead(): Promise<void>;
	reconcileExisting(): Promise<void>;
	dispose(): void;
}

export interface AgentExecutionCoordinatorOptions {
	readonly createSession: (identity: AgentExecutionSessionIdentity) => AgentExecutionCoordinatorSession;
	readonly isPidAlive?: (pid: number) => boolean | undefined;
}

interface AsyncStart {
	readonly runtimeRunId: string;
	readonly pid?: number;
	readonly asyncDir?: string;
}

/** Pure lifecycle coordinator shared by the root extension and fanout children. */
export class AgentExecutionCoordinator implements AgentExecutionCoordinatorPort {
	private readonly active = new Map<string, AgentExecutionInvocation>();
	private readonly asyncStarts = new Map<string, AsyncStart>();
	private readonly createSession: AgentExecutionCoordinatorOptions["createSession"];
	private readonly isPidAlive: (pid: number) => boolean | undefined;
	private readonly pendingCompletions = new Map<string, AgentRuntimeCompletionEvent>();
	private boundIdentity: AgentExecutionSessionIdentity | undefined;
	private boundSession: AgentExecutionCoordinatorSession | undefined;

	constructor(options: AgentExecutionCoordinatorOptions) {
		this.createSession = options.createSession;
		this.isPidAlive = options.isPidAlive ?? explicitProcessPidState;
	}

	bindSession(identity: AgentExecutionSessionIdentity): void {
		const sessionId = requiredText("sessionId", identity.sessionId);
		const ownerAgentPath = identity.ownerAgentPath.map((component) => requiredText("ownerAgentPath", component));
		if (this.boundIdentity?.sessionId === sessionId && samePath(this.boundIdentity.ownerAgentPath, ownerAgentPath)) {
			return;
		}
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
		if (typeof session === "string") return { ok: false, message: session };

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
		this.active.set(launchRunId, invocation);
		return { ok: true, invocation };
	}

	async observeAsyncStarted(event: unknown): Promise<void> {
		const value = record(event);
		const runtimeRunId = optionalText(value.id) ?? optionalText(value.runId);
		if (!runtimeRunId) return;
		const pid = optionalPositiveSafeInteger(value.pid);
		const asyncDir = optionalText(value.asyncDir);
		this.asyncStarts.set(runtimeRunId, {
			runtimeRunId,
			...(pid === undefined ? {} : { pid }),
			...(asyncDir === undefined ? {} : { asyncDir }),
		});
		const invocation = this.active.get(runtimeRunId);
		if (!invocation) return;
		await this.bindRuntime(invocation, runtimeRunId);
	}

	async settle(invocation: AgentExecutionInvocation, result: GovernedEngineResult): Promise<void> {
		if (this.active.get(invocation.launchRunId) !== invocation) return;
		try {
			if (result.isError === true) {
				await this.session().governor.settle(invocation.reservation, { kind: "start-error" });
				return;
			}

			const runtimeRunId =
				optionalText(result.details.asyncId) ?? optionalText(result.details.runId) ?? invocation.launchRunId;
			await this.bindRuntime(invocation, runtimeRunId);
			if (optionalText(result.details.asyncId)) {
				await this.session().governor.settle(invocation.reservation, { kind: "background-started" });
				return;
			}

			const results = Array.isArray(result.details.results) ? result.details.results : [];
			if (results.length === 0) {
				await this.session().governor.settle(invocation.reservation, { kind: "start-error" });
				return;
			}
			const terminalChildIndexes = invocation.reservation.leases
				.map((_, index) => index)
				.filter((index) => record(results[index]).detached !== true);
			await this.session().governor.settle(invocation.reservation, {
				kind: "foreground",
				terminalChildIndexes,
			});
		} finally {
			this.active.delete(invocation.launchRunId);
			const runtimeRunId = optionalText(result.details.asyncId) ?? optionalText(result.details.runId);
			if (runtimeRunId) this.asyncStarts.delete(runtimeRunId);
		}
	}

	async fail(invocation: AgentExecutionInvocation): Promise<void> {
		if (this.active.get(invocation.launchRunId) !== invocation) return;
		try {
			await this.session().governor.settle(invocation.reservation, { kind: "start-error" });
		} finally {
			this.active.delete(invocation.launchRunId);
		}
	}

	async complete(event: unknown): Promise<void> {
		if (!this.boundIdentity) return;
		for (const address of runtimeCompletionAddresses(event)) await this.completeAddress(address);
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

	dispose(): void {
		this.clearEphemeralState();
		this.boundIdentity = undefined;
		this.boundSession = undefined;
	}

	private async bindRuntime(invocation: AgentExecutionInvocation, runtimeRunId: string): Promise<void> {
		const start = this.asyncStarts.get(runtimeRunId);
		for (let reservationIndex = 0; reservationIndex < invocation.reservation.leases.length; reservationIndex += 1) {
			await this.session().governor.rebindChild(invocation.reservation, reservationIndex, {
				runtimeRunId,
				childIndex: invocation.reservation.kind === "resume" ? 0 : reservationIndex,
				...(start?.pid === undefined ? {} : { pid: start.pid }),
				...(start?.asyncDir === undefined ? {} : { asyncDir: start.asyncDir }),
			});
		}
		await this.drainPendingCompletions(runtimeRunId);
	}

	private async completeAddress(address: AgentRuntimeCompletionEvent): Promise<void> {
		const result = await this.session().governor.completeRuntime(address);
		const key = completionKey(address);
		if (
			result.released === false &&
			result.reason === "not_found" &&
			this.active.size > 0 &&
			this.asyncStarts.has(address.runtimeRunId)
		) {
			this.pendingCompletions.set(key, address);
			return;
		}
		this.pendingCompletions.delete(key);
	}

	private async drainPendingCompletions(runtimeRunId: string): Promise<void> {
		const pending = [...this.pendingCompletions.values()].filter((address) => address.runtimeRunId === runtimeRunId);
		for (const address of pending) await this.completeAddress(address);
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
		this.pendingCompletions.clear();
	}

	private runtimeProcessState(pid: number, lease: AgentGovernorLease): boolean | undefined {
		const runnerState = this.isPidAlive(pid);
		if (runnerState !== false || !lease.asyncDir) return runnerState;
		return inspectWriterProcessLiveness(lease.asyncDir);
	}
}

export interface DurableAgentExecutionCoordinatorOptions {
	readonly rootDir: string;
	readonly limits?: SessionGovernorLimitInput;
	readonly isPidAlive?: (pid: number) => boolean | undefined;
}

export function createDurableAgentExecutionCoordinator(
	options: DurableAgentExecutionCoordinatorOptions,
): AgentExecutionCoordinator {
	return new AgentExecutionCoordinator({
		isPidAlive: options.isPidAlive,
		createSession: (identity) => {
			const sessionGovernor = new SessionAgentGovernor({
				rootDir: options.rootDir,
				sessionId: identity.sessionId,
				ownerAgentPath: identity.ownerAgentPath,
				limits: options.limits,
			});
			return {
				governor: new AgentExecutionGovernor(sessionGovernor),
				hasLedger: () => sessionGovernor.hasLedger(),
				reconcile: async (isPidAlive) => {
					await sessionGovernor.reconcile(isPidAlive);
				},
			};
		},
	});
}

export function runtimeCompletionAddresses(event: unknown): AgentRuntimeCompletionEvent[] {
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

function completionChildIndex(value: Record<string, unknown>, fallback: number): number {
	const candidate = value.taskIndex ?? value.index;
	return optionalNonNegativeSafeInteger(candidate) ?? fallback;
}

function completionKey(address: AgentRuntimeCompletionEvent): string {
	return `${address.runtimeRunId}\u0000${address.childIndex}`;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((component, index) => component === right[index]);
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function optionalText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredText(name: string, value: string): string {
	const resolved = optionalText(value);
	if (!resolved) throw new TypeError(`${name} must be a non-empty string.`);
	return resolved;
}

function optionalPositiveSafeInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function optionalNonNegativeSafeInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function nonNegativeSafeInteger(name: string, value: number): number {
	const resolved = optionalNonNegativeSafeInteger(value);
	if (resolved === undefined) throw new TypeError(`${name} must be a non-negative safe integer.`);
	return resolved;
}
