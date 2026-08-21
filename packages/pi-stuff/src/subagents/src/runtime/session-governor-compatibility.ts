import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { isRuntimeObject } from "../../../shared/runtime-type.js";
import { inspectWriterProcessLivenessAsync } from "../runs/background/writer-process-registry.ts";
import { readProcessStartIdentityAsync } from "../shared/process-identity.ts";
import type { SessionGovernorCompatibilityScope } from "../shared/session-identity.ts";
import { LEGACY_SESSION_GOVERNOR_ROOT, SESSION_GOVERNOR_ROOT, TEMP_ROOT_DIR } from "../shared/types.ts";
import { type readStatus, readStatusAsync } from "../shared/utils.ts";
import {
	SessionAgentGovernor,
	type SessionGovernorAgentSnapshot,
	type SessionGovernorHistoricalAgent,
	type SessionGovernorLimitInput,
	type SessionGovernorSnapshot,
} from "./session-governor.ts";

const TERMINAL_STEP_STATES = new Set(["complete", "completed", "failed", "paused", "stopped"]);
const CONSERVATIVE_IMPORTED_LIMITS = Object.freeze({ maxDepth: 1, maxRunning: 1, maxTotal: 1 });

export type SessionGovernorCompatibilityResult =
	| {
			readonly ok: true;
			readonly importedLogicalAgentIds: readonly string[];
			readonly legacyLedgerObserved: boolean;
			/** Held for the root Pi session lifetime so v1 writers cannot reopen the migrated ledger. */
			readonly releaseLegacyBarrier?: () => Promise<void>;
	  }
	| {
			readonly ok: false;
			readonly message: string;
	  };

export interface PrepareSessionGovernorCompatibilityInput {
	readonly scope: SessionGovernorCompatibilityScope;
	readonly limits: SessionGovernorLimitInput;
	readonly currentRootDir?: string;
	readonly legacyRootDir?: string;
	readonly now?: () => number;
	readonly isPidAlive?: (pid: number) => Promise<boolean | undefined> | boolean | undefined;
	readonly inspectWriterLiveness?: (asyncDir: string) => Promise<boolean | undefined> | boolean | undefined;
	readonly readStatus?: (asyncDir: string) => Promise<ReturnType<typeof readStatus>> | ReturnType<typeof readStatus>;
	/** Deterministic seams for stale v1-lock recovery tests. */
	readonly legacyBarrierOptions?: {
		readonly timeoutMs?: number;
		readonly retryMs?: number;
	};
}

/**
 * Migrate only historical records into the v2 ledger. The v1 ledger is never
 * written. Its exact directory-lock protocol is held for the lifetime of this
 * root session so a pre-upgrade process cannot perform a first write after an
 * initially empty compatibility scan.
 */
export async function prepareSessionGovernorCompatibility(
	input: PrepareSessionGovernorCompatibilityInput,
): Promise<SessionGovernorCompatibilityResult> {
	const legacyRootDir = input.legacyRootDir ?? LEGACY_SESSION_GOVERNOR_ROOT;
	const current = new SessionAgentGovernor({
		rootDir: input.currentRootDir ?? SESSION_GOVERNOR_ROOT,
		sessionId: input.scope.governorSessionId,
		limits: input.limits,
	});
	const legacySessionId = input.scope.legacyGovernorSessionId;
	const legacy = legacySessionId
		? new SessionAgentGovernor({
				rootDir: legacyRootDir,
				sessionId: legacySessionId,
				limits: input.limits,
			})
		: undefined;

	let legacySnapshot: SessionGovernorSnapshot | undefined;
	let legacyBarrier: LegacyGovernorBarrier | undefined;
	try {
		if (legacy && legacySessionId) {
			await ensureLegacyGovernorBarrierDirectories(legacyRootDir, legacySessionId);
			legacyBarrier = await acquireLegacyGovernorBarrier(legacyRootDir, legacySessionId, input.legacyBarrierOptions);
			if (!legacyBarrier) {
				const lockDir = path.join(
					legacyRootDir,
					createHash("sha256").update(legacySessionId).digest("hex"),
					"ledger.lock",
				);
				return {
					ok: false,
					message:
						"Agent launches are paused by a pre-upgrade governor lock that may still be live or may be stale after a crash. " +
						`Close every older Pi process using this session; if the lock remains, remove only '${lockDir}', then retry.`,
				};
			}
			// This is the only compatibility read. It happens after the exact v1
			// barrier is held, including when ledger.json did not exist beforehand.
			legacySnapshot = await legacy.inspectExistingSnapshot();
		}
	} catch (error) {
		await legacyBarrier?.release();
		return {
			ok: false,
			message: `Agent launches are paused because the pre-upgrade governor ledger cannot be safely inspected: ${messageOf(error)}`,
		};
	}

	const historical = branchHistoricalAgents(input.scope, input.now?.() ?? Date.now());
	if (legacySnapshot) {
		const classification = await classifyLegacyLeases(legacySnapshot, input);
		if (classification.kind === "quarantine") {
			await legacyBarrier?.release();
			return {
				ok: false,
				message:
					"Agent launches are temporarily paused while pre-upgrade Agents are still running or cannot be safely proven stopped. " +
					"Status, steer, and stop remain available; retry after those Agents finish.",
			};
		}
		if (classification.kind === "current-dead") {
			const connected = connectedLegacyAgents(legacySnapshot.agents, input.scope.declaredLogicalAgentIds);
			if (!legacySnapshot.leases.every((lease) => connected.has(lease.logicalAgentId))) {
				await legacyBarrier?.release();
				return {
					ok: false,
					message:
						"Agent launches are paused because the pre-upgrade governor ledger contains an unproven ownership path.",
				};
			}
			for (const agent of legacySnapshot.agents) {
				if (connected.has(agent.logicalAgentId)) historical.set(agent.logicalAgentId, historicalAgent(agent));
			}
		} else if (classification.kind === "no-leases") {
			// With no physical runtime path, only top-level records explicitly
			// declared by this Pi session are safe to carry across copied files.
			for (const agent of legacySnapshot.agents) {
				if (agent.ownerAgentPath.length === 0 && input.scope.declaredLogicalAgentIds.has(agent.logicalAgentId)) {
					historical.set(
						agent.logicalAgentId,
						conservativeHistoricalAgent(agent.logicalAgentId, agent.createdAtMs),
					);
				}
			}
		}
		if (classification.kind === "foreign") {
			await legacyBarrier?.release();
			legacyBarrier = undefined;
		}
		// `foreign` means a copied same-header session saw another physical
		// session's live v1 ledger. Import only paired branch history in that case.
	}

	try {
		const before = await current.inspectExistingSnapshot();
		const imported = [...historical.values()];
		const after = imported.length > 0 ? await current.importHistoricalAgents(imported) : before;
		const previous = new Set(before?.agents.map(({ logicalAgentId }) => logicalAgentId) ?? []);
		return {
			ok: true,
			importedLogicalAgentIds: Object.freeze(
				(after?.agents ?? []).map(({ logicalAgentId }) => logicalAgentId).filter((id) => !previous.has(id)),
			),
			legacyLedgerObserved: legacySnapshot !== undefined,
			...(legacyBarrier ? { releaseLegacyBarrier: legacyBarrier.release } : {}),
		};
	} catch (error) {
		await legacyBarrier?.release();
		return {
			ok: false,
			message: `Agent launches are paused because governor history could not be migrated safely: ${messageOf(error)}`,
		};
	}
}

interface LegacyGovernorBarrier {
	readonly release: () => Promise<void>;
}

async function ensureLegacyGovernorBarrierDirectories(rootDir: string, sessionId: string): Promise<void> {
	try {
		await fs.promises.mkdir(rootDir, { recursive: true, mode: 0o700 });
	} catch (error) {
		if (messageCode(error) !== "EEXIST") throw error;
	}
	await assertOwnedRealDirectory(rootDir);
	await fs.promises.chmod(rootDir, 0o700);
	const sessionDir = path.join(rootDir, createHash("sha256").update(sessionId).digest("hex"));
	try {
		await fs.promises.mkdir(sessionDir, { mode: 0o700 });
	} catch (error) {
		if (messageCode(error) !== "EEXIST") throw error;
	}
	await assertOwnedRealDirectory(sessionDir);
	await fs.promises.chmod(sessionDir, 0o700);
}

async function acquireLegacyGovernorBarrier(
	rootDir: string,
	sessionId: string,
	options: NonNullable<PrepareSessionGovernorCompatibilityInput["legacyBarrierOptions"]> = {},
): Promise<LegacyGovernorBarrier | undefined> {
	const sessionDir = path.join(rootDir, createHash("sha256").update(sessionId).digest("hex"));
	const lockDir = path.join(sessionDir, "ledger.lock");
	await assertOwnedRealDirectory(rootDir);
	await assertOwnedRealDirectory(sessionDir);
	const token = randomUUID();
	const deadline = Date.now() + (options.timeoutMs ?? 1_000);
	while (Date.now() <= deadline) {
		try {
			await fs.promises.mkdir(lockDir, { mode: 0o700 });
			await fs.promises.chmod(lockDir, 0o700);
			try {
				await fs.promises.writeFile(
					path.join(lockDir, "owner.json"),
					JSON.stringify({
						token,
						pid: process.pid,
						processStartIdentity: (await readProcessStartIdentityAsync(process.pid)) ?? null,
						acquiredAtMs: Date.now(),
					}),
					{ encoding: "utf8", flag: "wx", mode: 0o600 },
				);
			} catch (error) {
				await fs.promises.rm(lockDir, { recursive: true, force: true });
				throw error;
			}
			let released = false;
			return {
				release: async () => {
					if (released) return;
					released = true;
					try {
						const owner = JSON.parse(await fs.promises.readFile(path.join(lockDir, "owner.json"), "utf8")) as {
							token?: unknown;
						};
						if (owner.token === token) await fs.promises.rm(lockDir, { recursive: true, force: true });
					} catch {
						// A missing/replaced owner is no longer ours to remove.
					}
				},
			};
		} catch (error) {
			if (messageCode(error) !== "EEXIST") throw error;
			await new Promise<void>((resolve) => setTimeout(resolve, options.retryMs ?? 10));
		}
	}
	return undefined;
}

async function assertOwnedRealDirectory(directory: string): Promise<void> {
	const stat = await fs.promises.lstat(directory);
	const currentUid = process.getuid?.();
	if (
		stat.isSymbolicLink() ||
		!stat.isDirectory() ||
		(currentUid !== undefined && stat.uid !== currentUid) ||
		(await fs.promises.realpath(directory)) !== path.resolve(directory)
	) {
		throw new Error(`Legacy governor directory '${directory}' is not a safe owned real directory.`);
	}
}

type LegacyClassification =
	| { readonly kind: "no-leases" }
	| { readonly kind: "foreign" }
	| { readonly kind: "current-dead" }
	| { readonly kind: "quarantine" };

async function classifyLegacyLeases(
	snapshot: SessionGovernorSnapshot,
	input: PrepareSessionGovernorCompatibilityInput,
): Promise<LegacyClassification> {
	if (snapshot.leases.length === 0) return { kind: "no-leases" };
	const inspectStatus = input.readStatus ?? readStatusAsync;
	const inspectWriter = input.inspectWriterLiveness ?? inspectWriterProcessLivenessAsync;
	const isPidAlive = input.isPidAlive ?? explicitPidState;
	let foreign = 0;
	let currentDead = 0;
	for (const lease of snapshot.leases) {
		if (!lease.asyncDir || !safeLegacyRuntimeDirectory(lease.asyncDir)) return { kind: "quarantine" };
		let status: ReturnType<typeof readStatus>;
		try {
			status = await inspectStatus(lease.asyncDir);
		} catch {
			return { kind: "quarantine" };
		}
		if (!status || status.runId !== lease.runtimeRunId) return { kind: "quarantine" };
		const physicalMatch =
			status.sessionId === input.scope.sessionId ||
			(Boolean(input.scope.legacyArtifactSessionId) && status.sessionId === input.scope.legacyArtifactSessionId);
		if (!physicalMatch) {
			foreign += 1;
			continue;
		}
		const step = status.steps?.[lease.childIndex];
		if (!step || !TERMINAL_STEP_STATES.has(step.status)) return { kind: "quarantine" };
		if ((await isPidAlive(lease.pid)) !== false || (await inspectWriter(lease.asyncDir)) !== false) {
			return { kind: "quarantine" };
		}
		currentDead += 1;
	}
	if (foreign === snapshot.leases.length) return { kind: "foreign" };
	if (foreign > 0 || currentDead !== snapshot.leases.length) return { kind: "quarantine" };
	return { kind: "current-dead" };
}

function connectedLegacyAgents(
	agents: readonly SessionGovernorAgentSnapshot[],
	declaredTopLevel: ReadonlySet<string>,
): ReadonlySet<string> {
	const byPath = new Map(agents.map((agent) => [pathKey(agent.agentPath), agent]));
	const connected = new Set<string>();
	for (const agent of [...agents].sort((left, right) => left.agentPath.length - right.agentPath.length)) {
		if (agent.ownerAgentPath.length === 0) {
			if (declaredTopLevel.has(agent.logicalAgentId)) connected.add(agent.logicalAgentId);
			continue;
		}
		const owner = byPath.get(pathKey(agent.ownerAgentPath));
		if (owner && connected.has(owner.logicalAgentId)) connected.add(agent.logicalAgentId);
	}
	return connected;
}

function branchHistoricalAgents(
	scope: SessionGovernorCompatibilityScope,
	now: number,
): Map<string, SessionGovernorHistoricalAgent> {
	return new Map(
		[...scope.startedLogicalAgentIds].map((logicalAgentId) => [
			logicalAgentId,
			conservativeHistoricalAgent(logicalAgentId, scope.startedAtMs ?? now),
		]),
	);
}

function conservativeHistoricalAgent(logicalAgentId: string, createdAtMs: number): SessionGovernorHistoricalAgent {
	return {
		logicalAgentId,
		ownerAgentPath: [],
		agentPath: [logicalAgentId],
		limits: CONSERVATIVE_IMPORTED_LIMITS,
		createdAtMs,
	};
}

function historicalAgent(agent: SessionGovernorAgentSnapshot): SessionGovernorHistoricalAgent {
	return {
		logicalAgentId: agent.logicalAgentId,
		ownerAgentPath: [...agent.ownerAgentPath],
		agentPath: [...agent.agentPath],
		limits: { ...agent.limits },
		createdAtMs: agent.createdAtMs,
	};
}

function safeLegacyRuntimeDirectory(directory: string): boolean {
	if (!path.isAbsolute(directory)) return false;
	const resolved = path.resolve(directory);
	for (const rootName of ["async-subagent-runs", "foreground-runs", "nested-subagent-runs"] as const) {
		const root = path.join(TEMP_ROOT_DIR, rootName);
		const relative = path.relative(root, resolved);
		if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
			return true;
		}
	}
	return false;
}

function pathKey(parts: readonly string[]): string {
	return JSON.stringify(parts);
}

function explicitPidState(pid: number): boolean | undefined {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return messageCode(error) === "ESRCH" ? false : undefined;
	}
}

function messageCode(error: unknown): string | undefined {
	return error && isRuntimeObject(error) && "code" in error
		? String((error as NodeJS.ErrnoException).code)
		: undefined;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
