import * as fs from "node:fs";
import * as path from "node:path";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import {
	assertPrivateDirectory,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshotAsync,
} from "../../shared/private-directory.ts";
import {
	type ProcessIdentityGroupSnapshot,
	readProcessIdentityGroupSnapshot,
	readProcessStartIdentity,
	readProcessStartIdentityAsync,
} from "../../shared/process-identity.ts";

export { readProcessStartIdentity } from "../../shared/process-identity.ts";

const WRITER_PROCESS_REGISTRY_FILE = "writer-processes-live.json";
const MAX_WRITER_PROCESS_REGISTRY_BYTES = 1024 * 1024;

export type WriterRuntimeState =
	| { state: "none" | "spawning" }
	| {
			state: "running";
			pid: number;
			processStartIdentity?: string;
			groupMemberProofFile?: string;
	  };

interface PersistedWriterState {
	state: "none" | "spawning" | "running";
	pid?: number;
	processStartIdentity?: string;
	groupMemberProofFile?: string;
	terminationRequestedAt?: number;
	killRequestedAt?: number;
}

interface WriterProcessRegistry {
	version: 1;
	runId: string;
	runnerPid: number;
	runnerProcessStartIdentity?: string;
	writerStartupGate?: "parent-pipe-v1";
	writerProcessGroup?: "writer-pid-v1";
	updatedAt: number;
	writers: Record<string, PersistedWriterState>;
}

type KillFn = (pid: number, signal?: NodeJS.Signals | 0) => unknown;

export function writerProcessRegistryPath(asyncDir: string): string {
	return path.join(asyncDir, WRITER_PROCESS_REGISTRY_FILE);
}

export function initializeWriterProcessRegistry(
	asyncDir: string,
	runId: string,
	runnerPid: number,
	childCount: number,
	runnerProcessStartIdentity = readProcessStartIdentity(runnerPid),
): void {
	const writers = Object.fromEntries(
		Array.from({ length: childCount }, (_, index) => [String(index), { state: "none" as const }]),
	);
	writePrivateAtomicJson(writerProcessRegistryPath(asyncDir), {
		version: 1,
		runId,
		runnerPid,
		...(runnerProcessStartIdentity ? { runnerProcessStartIdentity } : {}),
		...(process.platform !== "win32"
			? {
					writerStartupGate: "parent-pipe-v1" as const,
					writerProcessGroup: "writer-pid-v1" as const,
				}
			: {}),
		updatedAt: Date.now(),
		writers,
	} satisfies WriterProcessRegistry);
}

export function updateWriterProcessRegistry(asyncDir: string, index: number, state: WriterRuntimeState): void {
	if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("writer process index must be non-negative");
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) throw new Error(`Writer process registry is unavailable for '${asyncDir}'.`);
	const startIdentity =
		state.state === "running" ? (state.processStartIdentity ?? readProcessStartIdentity(state.pid)) : undefined;
	if (state.state === "running" && supportsProcessStartIdentity() && !startIdentity) {
		throw new Error(`Cannot bind writer PID ${state.pid} without a stable process-start identity.`);
	}
	registry.writers[String(index)] =
		state.state === "running"
			? {
					state: "running",
					pid: state.pid,
					...(startIdentity ? { processStartIdentity: startIdentity } : {}),
					...(state.groupMemberProofFile
						? { groupMemberProofFile: safeProofFileName(state.groupMemberProofFile) }
						: {}),
				}
			: { state: state.state };
	registry.updatedAt = Date.now();
	writePrivateAtomicJson(writerProcessRegistryPath(asyncDir), registry);
}

/** `true`/`undefined` retain the governor lease; only explicit `false` permits reclamation. */
export function inspectWriterProcessLiveness(asyncDir: string, kill: KillFn = process.kill): boolean | undefined {
	const registryPath = writerProcessRegistryPath(asyncDir);
	if (!fs.existsSync(registryPath)) return undefined;
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) return undefined;
	let unknown = false;
	for (const writer of Object.values(registry.writers)) {
		if (writer.state === "spawning") {
			// New writers wait on an inherited parent pipe before exec. Once the
			// runner is dead, EOF proves that a PID-less spawning record cannot turn
			// into a Pi writer. Legacy registries retain conservatively.
			if (registry.writerStartupGate !== "parent-pipe-v1") return true;
			continue;
		}
		if (writer.state !== "running" || writer.pid === undefined) continue;
		if (registry.writerProcessGroup === "writer-pid-v1") {
			const groupState = ownedWriterGroupLiveness(asyncDir, writer, kill);
			if (groupState === true) return true;
			if (groupState === undefined) unknown = true;
			continue;
		}
		const state = processLiveness(writer.pid, kill);
		if (state === false) continue;
		if (state === undefined) unknown = true;
		else {
			const identity = readProcessStartIdentity(writer.pid);
			if (writer.processStartIdentity && identity && identity !== writer.processStartIdentity) continue;
			if (!writer.processStartIdentity || !identity) unknown = true;
			else return true;
		}
	}
	return unknown ? undefined : false;
}

/** Host-side liveness inspection without synchronous runtime-file or process-identity reads. */
export async function inspectWriterProcessLivenessAsync(
	asyncDir: string,
	kill: KillFn = process.kill,
): Promise<boolean | undefined> {
	const registry = await readWriterProcessRegistryAsync(asyncDir);
	if (!registry) return undefined;
	let unknown = false;
	for (const writer of Object.values(registry.writers)) {
		if (writer.state === "spawning") {
			if (registry.writerStartupGate !== "parent-pipe-v1") return true;
			continue;
		}
		if (writer.state !== "running" || writer.pid === undefined) continue;
		const alive =
			registry.writerProcessGroup === "writer-pid-v1"
				? processGroupLiveness(writer.pid, kill)
				: processLiveness(writer.pid, kill);
		if (alive === false) continue;
		if (alive === undefined || !writer.processStartIdentity) {
			unknown = true;
			continue;
		}
		const identity = await readProcessStartIdentityAsync(writer.pid);
		if (identity && identity !== writer.processStartIdentity) continue;
		if (!identity) unknown = true;
		else return true;
	}
	return unknown ? undefined : false;
}

/** Liveness proof for one parallel child, used to release terminal siblings independently. */
export function inspectWriterChildProcessLiveness(
	asyncDir: string,
	index: number,
	kill: KillFn = process.kill,
): boolean | undefined {
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) return undefined;
	const writer = registry.writers[String(index)];
	if (!writer || writer.state === "none") return false;
	if (writer.state === "spawning") return registry.writerStartupGate !== "parent-pipe-v1";
	if (writer.pid === undefined) return undefined;
	if (registry.writerProcessGroup === "writer-pid-v1") return ownedWriterGroupLiveness(asyncDir, writer, kill);
	const alive = processLiveness(writer.pid, kill);
	if (alive !== true) return alive;
	const identity = readProcessStartIdentity(writer.pid);
	if (writer.processStartIdentity && identity) return writer.processStartIdentity === identity;
	return undefined;
}

/** Kill writers orphaned by a dead runner. Unknown/unconfirmable writers remain recorded and counted. */
export function terminateOrphanWriterProcesses(
	asyncDir: string,
	kill: KillFn = process.kill,
	now = Date.now(),
): { remaining: number; terminated: number } {
	const registryPath = writerProcessRegistryPath(asyncDir);
	if (!fs.existsSync(registryPath)) return { remaining: 1, terminated: 0 };
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) return { remaining: 1, terminated: 0 };
	let changed = false;
	let remaining = 0;
	let terminated = 0;

	for (const [index, writer] of Object.entries(registry.writers)) {
		if (writer.state === "none") continue;
		if (writer.state === "spawning") {
			if (registry.writerStartupGate === "parent-pipe-v1") {
				registry.writers[index] = { state: "none" };
				changed = true;
			} else {
				// A legacy registry has no exec-gate proof, so an unbound writer PID
				// may already be running and must remain conservative.
				remaining += 1;
			}
			continue;
		}

		if (writer.pid === undefined) {
			remaining += 1;
			continue;
		}
		const groupOwned = registry.writerProcessGroup === "writer-pid-v1";
		const liveness = groupOwned
			? ownedWriterGroupLiveness(asyncDir, writer, kill)
			: ownedLegacyWriterLiveness(writer, kill);
		if (liveness === false) {
			registry.writers[index] = { state: "none" };
			changed = true;
			continue;
		}
		if (liveness === undefined) {
			remaining += 1;
			continue;
		}
		try {
			if (groupOwned) {
				const leaderLiveness = processLiveness(writer.pid, kill);
				const leaderIdentity = readProcessStartIdentity(writer.pid);
				if (leaderLiveness === true) {
					if (!writer.processStartIdentity || leaderIdentity !== writer.processStartIdentity) {
						// A transiently unreadable or mismatched leader identity cannot
						// authorize either a positive or group-wide signal.
						remaining += 1;
						continue;
					}
					const shouldNudge =
						writer.terminationRequestedAt === undefined || now - writer.terminationRequestedAt >= 1_000;
					if (shouldNudge) {
						// Keep the authenticated supervisor/PGID leader alive. It owns the
						// bounded escalation and will not exit until all members are gone.
						kill(writer.pid, "SIGTERM");
						terminated += 1;
						registry.writers[index] = { ...writer, terminationRequestedAt: now };
						changed = true;
					}
					remaining += 1;
					continue;
				}
				if (leaderLiveness === undefined) {
					remaining += 1;
					continue;
				}
			}
			const signalTarget = groupOwned ? -writer.pid : writer.pid;
			const shouldRequestTermination = writer.terminationRequestedAt === undefined;
			const shouldKill =
				writer.terminationRequestedAt !== undefined &&
				writer.killRequestedAt === undefined &&
				now - writer.terminationRequestedAt >= 250;
			if (shouldRequestTermination || shouldKill) {
				kill(signalTarget, shouldKill ? "SIGKILL" : "SIGTERM");
				terminated += 1;
			}
			const finalLiveness = groupOwned
				? ownedWriterGroupLiveness(asyncDir, writer, kill)
				: ownedLegacyWriterLiveness(writer, kill);
			if (finalLiveness === false) {
				registry.writers[index] = { state: "none" };
				changed = true;
			} else {
				registry.writers[index] = {
					...writer,
					...(shouldRequestTermination ? { terminationRequestedAt: now } : {}),
					...(shouldKill ? { killRequestedAt: now } : {}),
				};
				changed ||= shouldRequestTermination || shouldKill;
				// Signal delivery alone is not proof of exit. A later poll revalidates
				// ownership and escalates globally without blocking the Host event loop.
				remaining += 1;
			}
		} catch (error) {
			if (errorCode(error) === "ESRCH") {
				registry.writers[index] = { state: "none" };
				changed = true;
			} else {
				remaining += 1;
			}
		}
	}

	if (changed) {
		registry.updatedAt = Date.now();
		writePrivateAtomicJson(registryPath, registry);
	}
	return { remaining, terminated };
}

/**
 * Event-loop-friendly bounded reaping for runner shutdown. The synchronous
 * primitive above performs one ownership-checked step; this helper provides the
 * later TERM -> KILL -> absence probes that a terminating runner cannot defer to
 * a future Host/session poll.
 */
export async function reapOrphanWriterProcesses(
	asyncDir: string,
	options: {
		readonly kill?: KillFn;
		readonly timeoutMs?: number;
		readonly pollIntervalMs?: number;
	} = {},
): Promise<{ remaining: number; terminated: number }> {
	const kill = options.kill ?? process.kill;
	const timeoutMs = Math.max(250, options.timeoutMs ?? 2_000);
	const pollIntervalMs = Math.max(10, Math.min(options.pollIntervalMs ?? 25, timeoutMs));
	const startedAt = Date.now();
	let terminated = 0;
	let result = terminateOrphanWriterProcesses(asyncDir, kill, startedAt);
	terminated += result.terminated;
	while (result.remaining > 0 && Date.now() - startedAt < timeoutMs) {
		await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
		result = terminateOrphanWriterProcesses(asyncDir, kill);
		terminated += result.terminated;
	}
	return { remaining: result.remaining, terminated };
}

function readWriterProcessRegistry(asyncDir: string): WriterProcessRegistry | undefined {
	try {
		const resolvedDir = path.resolve(asyncDir);
		assertPrivateDirectory(resolvedDir);
		if (fs.realpathSync(resolvedDir) !== resolvedDir) return undefined;
		const registryPath = writerProcessRegistryPath(resolvedDir);
		return parseWriterProcessRegistry(
			JSON.parse(readBoundedOwnedFile(registryPath, MAX_WRITER_PROCESS_REGISTRY_BYTES)),
		);
	} catch {
		return undefined;
	}
}

async function readWriterProcessRegistryAsync(asyncDir: string): Promise<WriterProcessRegistry | undefined> {
	try {
		const resolvedDir = path.resolve(asyncDir);
		const stat = await fs.promises.lstat(resolvedDir);
		const currentUid = process.getuid?.();
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(currentUid !== undefined && stat.uid !== currentUid) ||
			(await fs.promises.realpath(resolvedDir)) !== resolvedDir
		)
			return undefined;
		const snapshot = await readBoundedOwnedFileSnapshotAsync(
			writerProcessRegistryPath(resolvedDir),
			MAX_WRITER_PROCESS_REGISTRY_BYTES,
		);
		return parseWriterProcessRegistry(JSON.parse(snapshot.text));
	} catch {
		return undefined;
	}
}

function parseWriterProcessRegistry(value: unknown): WriterProcessRegistry | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as Partial<WriterProcessRegistry>;
	if (
		candidate.version !== 1 ||
		typeof candidate.runId !== "string" ||
		!positiveInteger(candidate.runnerPid) ||
		(candidate.runnerProcessStartIdentity !== undefined &&
			typeof candidate.runnerProcessStartIdentity !== "string") ||
		(candidate.writerStartupGate !== undefined && candidate.writerStartupGate !== "parent-pipe-v1") ||
		(candidate.writerProcessGroup !== undefined && candidate.writerProcessGroup !== "writer-pid-v1") ||
		typeof candidate.updatedAt !== "number" ||
		!candidate.writers ||
		typeof candidate.writers !== "object" ||
		Array.isArray(candidate.writers)
	)
		return undefined;
	const writers: Record<string, PersistedWriterState> = {};
	for (const [index, writer] of Object.entries(candidate.writers)) {
		if (!/^\d+$/.test(index) || !validWriterState(writer)) return undefined;
		writers[index] = { ...writer };
	}
	return {
		version: 1,
		runId: candidate.runId,
		runnerPid: candidate.runnerPid,
		...(candidate.runnerProcessStartIdentity
			? { runnerProcessStartIdentity: candidate.runnerProcessStartIdentity }
			: {}),
		...(candidate.writerStartupGate ? { writerStartupGate: candidate.writerStartupGate } : {}),
		...(candidate.writerProcessGroup ? { writerProcessGroup: candidate.writerProcessGroup } : {}),
		updatedAt: candidate.updatedAt,
		writers,
	};
}

function validWriterState(value: unknown): value is PersistedWriterState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const writer = value as PersistedWriterState;
	if (writer.state !== "none" && writer.state !== "spawning" && writer.state !== "running") return false;
	if (writer.state === "running") {
		return (
			positiveInteger(writer.pid) &&
			(writer.processStartIdentity === undefined || typeof writer.processStartIdentity === "string") &&
			(writer.groupMemberProofFile === undefined || safeProofFileName(writer.groupMemberProofFile) !== undefined) &&
			(writer.terminationRequestedAt === undefined ||
				(typeof writer.terminationRequestedAt === "number" && Number.isFinite(writer.terminationRequestedAt))) &&
			(writer.killRequestedAt === undefined ||
				(typeof writer.killRequestedAt === "number" && Number.isFinite(writer.killRequestedAt)))
		);
	}
	return (
		writer.pid === undefined &&
		writer.processStartIdentity === undefined &&
		writer.groupMemberProofFile === undefined &&
		writer.terminationRequestedAt === undefined &&
		writer.killRequestedAt === undefined
	);
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function processLiveness(pid: number, kill: KillFn): boolean | undefined {
	try {
		kill(pid, 0);
		return true;
	} catch (error) {
		if (errorCode(error) === "ESRCH") return false;
		return undefined;
	}
}

function processGroupLiveness(leaderPid: number, kill: KillFn): boolean | undefined {
	return processLiveness(-leaderPid, kill);
}

/**
 * Prove that a live process group still belongs to the recorded writer before
 * it can influence lease retention or receive a signal.
 */
function ownedWriterGroupLiveness(asyncDir: string, writer: PersistedWriterState, kill: KillFn): boolean | undefined {
	if (writer.state !== "running" || !writer.pid) return false;
	const groupState = processGroupLiveness(writer.pid, kill);
	if (groupState !== true) return groupState;
	if (!writer.processStartIdentity) return undefined;
	const currentIdentity = readProcessStartIdentity(writer.pid);
	if (currentIdentity) return currentIdentity === writer.processStartIdentity;
	if (readAuthenticatedGroupMember(asyncDir, writer)) return true;
	// Once the leader is absent, a numeric PGID alone cannot prove continuity:
	// the original group may have disappeared and the number may have been
	// reused before this recovery pass. Retain the lease rather than risk
	// signalling an unrelated group.
	return undefined;
}

function ownedLegacyWriterLiveness(writer: PersistedWriterState, kill: KillFn): boolean | undefined {
	if (writer.state !== "running" || !writer.pid) return false;
	const alive = processLiveness(writer.pid, kill);
	if (alive !== true) return alive;
	if (!writer.processStartIdentity) return undefined;
	const currentIdentity = readProcessStartIdentity(writer.pid);
	return currentIdentity ? currentIdentity === writer.processStartIdentity : undefined;
}

function supportsProcessStartIdentity(): boolean {
	return process.platform === "linux" || process.platform === "darwin" || process.platform === "freebsd";
}

export interface WriterGroupMemberProof {
	readonly version: 1;
	readonly groupLeaderPid: number;
	readonly groupLeaderProcessStartIdentity: string;
	readonly memberPid: number;
	readonly memberProcessStartIdentity: string;
}

type ProcessIdentityGroupReader = (pid: number) => ProcessIdentityGroupSnapshot | undefined;

export function readAuthenticatedGroupMember(
	asyncDir: string,
	writer: PersistedWriterState,
	readSnapshot: ProcessIdentityGroupReader = readProcessIdentityGroupSnapshot,
): { readonly pid: number; readonly identity: string } | undefined {
	if (writer.state !== "running" || !writer.pid || !writer.processStartIdentity || !writer.groupMemberProofFile) {
		return undefined;
	}
	try {
		const fileName = safeProofFileName(writer.groupMemberProofFile);
		if (!fileName) return undefined;
		const parsed = JSON.parse(
			readBoundedOwnedFile(path.join(path.resolve(asyncDir), fileName), 16 * 1024),
		) as Partial<WriterGroupMemberProof>;
		if (
			parsed.version !== 1 ||
			parsed.groupLeaderPid !== writer.pid ||
			parsed.groupLeaderProcessStartIdentity !== writer.processStartIdentity ||
			!positiveInteger(parsed.memberPid) ||
			typeof parsed.memberProcessStartIdentity !== "string"
		) {
			return undefined;
		}
		const snapshot = readSnapshot(parsed.memberPid);
		if (
			!snapshot ||
			snapshot.processStartIdentity !== parsed.memberProcessStartIdentity ||
			snapshot.processGroupId !== writer.pid
		) {
			return undefined;
		}
		return { pid: parsed.memberPid, identity: parsed.memberProcessStartIdentity };
	} catch {
		return undefined;
	}
}

function safeProofFileName(value: string): string | undefined {
	return /^[A-Za-z0-9._-]{1,256}$/u.test(value) && value !== "." && value !== ".." ? value : undefined;
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String((error as NodeJS.ErrnoException).code)
		: undefined;
}
