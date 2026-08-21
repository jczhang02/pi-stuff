import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { isRuntimeNumber, isRuntimeString } from "../../../shared/runtime-type.js";
import { inspectWriterProcessLivenessAsync } from "../runs/background/writer-process-registry.ts";
import { readBoundedOwnedFileSnapshotAsync } from "../shared/private-directory.ts";
import { readProcessStartIdentityAsync } from "../shared/process-identity.ts";
import { type AsyncStatus, TEMP_ROOT_DIR } from "../shared/types.ts";
import { readStatusAsync } from "../shared/utils.ts";

const DIAGNOSTIC_TAIL_BYTES = 256 * 1024;
const MAX_RUN_DIRECTORIES_PER_PASS = 5_000;
const DIAGNOSTIC_TRIM_GRACE_MS = 60 * 60 * 1_000;
const SCAN_YIELD_INTERVAL = 32;

type RuntimeRunKind = "foreground" | "async" | "nested";

interface RuntimeRunDirectory {
	readonly directory: string;
	readonly kind: RuntimeRunKind;
	readonly mtimeMs: number;
	readonly diagnosticBytes: number;
}

export interface RuntimeMaintenanceReport {
	readonly inspected: number;
	readonly trimmed: number;
	readonly bytesReclaimed: number;
	readonly abandonedPreparationsReclaimed: number;
}

interface PreparationMarker {
	readonly version: 2;
	readonly token: string;
	readonly pid: number;
	readonly processStartIdentity: string;
	readonly createdAt: number;
	readonly device: number;
	readonly inode: number;
}

function terminal(status: AsyncStatus): boolean {
	return (
		status.state === "complete" ||
		status.state === "failed" ||
		status.state === "paused" ||
		status.state === "stopped"
	);
}

async function directorySnapshot(directory: string, kind: RuntimeRunKind): Promise<RuntimeRunDirectory | undefined> {
	try {
		const stat = await fs.promises.lstat(directory);
		const currentUid = process.getuid?.();
		if (!stat.isDirectory() || stat.isSymbolicLink() || (currentUid !== undefined && stat.uid !== currentUid)) {
			return undefined;
		}
		let diagnosticBytes = 0;
		try {
			const events = await fs.promises.lstat(path.join(directory, "events.jsonl"));
			if (events.isFile() && !events.isSymbolicLink() && (currentUid === undefined || events.uid === currentUid)) {
				diagnosticBytes = events.size;
			}
		} catch {
			// A run without optional diagnostics can still be considered for old-run GC.
		}
		return { directory, kind, mtimeMs: stat.mtimeMs, diagnosticBytes };
	} catch {
		return undefined;
	}
}

async function runDirectories(root: string, depth: 1 | 2, kind: RuntimeRunKind): Promise<RuntimeRunDirectory[]> {
	const oversized: RuntimeRunDirectory[] = [];
	const oldest: RuntimeRunDirectory[] = [];
	let observed = 0;
	const retain = (snapshot: RuntimeRunDirectory | undefined): void => {
		if (!snapshot) return;
		oldest.push(snapshot);
		if (snapshot.diagnosticBytes > DIAGNOSTIC_TAIL_BYTES) oversized.push(snapshot);
		if (oldest.length > MAX_RUN_DIRECTORIES_PER_PASS * 2) {
			oldest.sort((left, right) => left.mtimeMs - right.mtimeMs);
			oldest.length = MAX_RUN_DIRECTORIES_PER_PASS;
		}
		if (oversized.length > MAX_RUN_DIRECTORIES_PER_PASS * 2) {
			oversized.sort((left, right) => right.diagnosticBytes - left.diagnosticBytes);
			oversized.length = MAX_RUN_DIRECTORIES_PER_PASS;
		}
	};
	try {
		const first = await fs.promises.opendir(root);
		for await (const entry of first) {
			if (!entry.isDirectory() || !safeSegment(entry.name)) continue;
			const candidate = path.join(root, entry.name);
			if (depth === 1) {
				retain(await directorySnapshot(candidate, kind));
				observed += 1;
			} else {
				try {
					const parent = await directorySnapshot(candidate, kind);
					if (!parent) continue;
					const nested = await fs.promises.opendir(candidate);
					for await (const child of nested) {
						if (!child.isDirectory() || !safeSegment(child.name)) continue;
						retain(await directorySnapshot(path.join(candidate, child.name), kind));
						observed += 1;
						if (observed % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
					}
				} catch {
					continue;
				}
			}
			if (observed % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
		}
	} catch {
		return [];
	}
	oversized.sort((left, right) => right.diagnosticBytes - left.diagnosticBytes);
	oversized.length = Math.min(oversized.length, MAX_RUN_DIRECTORIES_PER_PASS);
	oldest.sort((left, right) => left.mtimeMs - right.mtimeMs);
	oldest.length = Math.min(oldest.length, MAX_RUN_DIRECTORIES_PER_PASS);
	const byPath = new Map<string, RuntimeRunDirectory>();
	for (const snapshot of [...oversized, ...oldest]) byPath.set(snapshot.directory, snapshot);
	return [...byPath.values()];
}

async function safeToTrim(directory: string, status: AsyncStatus, kind: RuntimeRunKind): Promise<boolean> {
	if (!terminal(status)) return false;
	// Foreground work executes in the Host and has no detached runner process to
	// observe. Async and nested v3 runs must retain diagnostics until the
	// supervisor has durably observed their runner terminal state.
	if (kind !== "foreground" && status.lifecycleArtifactVersion === 3 && status.processTerminal?.state !== "observed") {
		return false;
	}
	return (await inspectWriterProcessLivenessAsync(directory)) === false;
}

function interleave(groups: readonly RuntimeRunDirectory[][], maximum: number): RuntimeRunDirectory[] {
	const result: RuntimeRunDirectory[] = [];
	let index = 0;
	while (result.length < maximum) {
		let added = false;
		for (const group of groups) {
			const candidate = group[index];
			if (!candidate) continue;
			result.push(candidate);
			added = true;
			if (result.length >= maximum) break;
		}
		if (!added) break;
		index += 1;
	}
	return result;
}

function candidateDirectories(groups: readonly RuntimeRunDirectory[][]): RuntimeRunDirectory[] {
	const oversized = groups.map((group) =>
		group
			.filter(({ diagnosticBytes }) => diagnosticBytes > DIAGNOSTIC_TAIL_BYTES)
			.sort((left, right) => right.diagnosticBytes - left.diagnosticBytes),
	);
	const selected = interleave(oversized, MAX_RUN_DIRECTORIES_PER_PASS);
	if (selected.length >= MAX_RUN_DIRECTORIES_PER_PASS) return selected;
	const selectedPaths = new Set(selected.map(({ directory }) => directory));
	const oldest = groups.map((group) =>
		group
			.filter(({ directory }) => !selectedPaths.has(directory))
			.sort((left, right) => left.mtimeMs - right.mtimeMs),
	);
	return [...selected, ...interleave(oldest, MAX_RUN_DIRECTORIES_PER_PASS - selected.length)];
}

async function trimDiagnosticTail(filePath: string): Promise<number> {
	let handle: fs.promises.FileHandle | undefined;
	let temporary: string | undefined;
	try {
		const noFollow = (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
		handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
		const stat = await handle.stat();
		const currentUid = process.getuid?.();
		if (!stat.isFile() || (currentUid !== undefined && stat.uid !== currentUid) || stat.size <= DIAGNOSTIC_TAIL_BYTES)
			return 0;
		const buffer = Buffer.allocUnsafe(DIAGNOSTIC_TAIL_BYTES);
		const { bytesRead } = await handle.read(
			buffer,
			0,
			DIAGNOSTIC_TAIL_BYTES,
			Math.max(0, stat.size - DIAGNOSTIC_TAIL_BYTES),
		);
		let tail = buffer.subarray(0, bytesRead).toString("utf-8");
		const newline = tail.indexOf("\n");
		if (newline >= 0) tail = tail.slice(newline + 1);
		temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.trim`);
		await fs.promises.writeFile(temporary, tail, { mode: 0o600, flag: "wx" });
		await fs.promises.rename(temporary, filePath);
		temporary = undefined;
		return Math.max(0, stat.size - Buffer.byteLength(tail, "utf-8"));
	} catch {
		return 0;
	} finally {
		await handle?.close();
		if (temporary) {
			try {
				await fs.promises.unlink(temporary);
			} catch {
				// A failed optional trim must not leave another cleanup obligation.
			}
		}
	}
}

async function readPreparationMarker(directory: string, kind: RuntimeRunKind): Promise<PreparationMarker | undefined> {
	const markerName =
		kind === "foreground" ? ".foreground-preparation-owner.json" : ".background-preparation-owner.json";
	try {
		const value = JSON.parse(
			(await readBoundedOwnedFileSnapshotAsync(path.join(directory, markerName), 4 * 1024)).text,
		) as Partial<PreparationMarker>;
		if (
			value.version !== 2 ||
			!isRuntimeString(value.token) ||
			!/^[0-9a-f-]{16,64}$/iu.test(value.token) ||
			!Number.isSafeInteger(value.pid) ||
			(value.pid ?? 0) <= 0 ||
			!isRuntimeString(value.processStartIdentity) ||
			value.processStartIdentity.length === 0 ||
			!isRuntimeNumber(value.createdAt) ||
			!Number.isFinite(value.createdAt) ||
			!isRuntimeNumber(value.device) ||
			!Number.isFinite(value.device) ||
			!isRuntimeNumber(value.inode) ||
			!Number.isFinite(value.inode)
		) {
			return undefined;
		}
		return value as PreparationMarker;
	} catch {
		return undefined;
	}
}

async function preparationOwnerIsDead(marker: PreparationMarker): Promise<boolean> {
	const currentIdentity = await readProcessStartIdentityAsync(marker.pid);
	if (currentIdentity) return currentIdentity !== marker.processStartIdentity;
	try {
		process.kill(marker.pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

async function reclaimAbandonedPreparation(directory: string, kind: RuntimeRunKind): Promise<boolean> {
	const marker = await readPreparationMarker(directory, kind);
	if (!marker || !(await preparationOwnerIsDead(marker))) return false;
	for (const file of ["status.json", "completion.json"]) {
		try {
			await fs.promises.access(path.join(directory, file));
			return false;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
		}
	}
	if ((await inspectWriterProcessLivenessAsync(directory)) === true) return false;
	let current: fs.Stats;
	try {
		current = await fs.promises.lstat(directory);
	} catch {
		return false;
	}
	if (
		!current.isDirectory() ||
		current.isSymbolicLink() ||
		current.dev !== marker.device ||
		current.ino !== marker.inode
	) {
		return false;
	}
	const abandoned = `${directory}.abandoned-${marker.token}`;
	try {
		await fs.promises.rename(directory, abandoned);
		const moved = await fs.promises.lstat(abandoned);
		if (!moved.isDirectory() || moved.dev !== marker.device || moved.ino !== marker.inode) return false;
		await fs.promises.rm(abandoned, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

/** Compact optional diagnostics only after durable lifecycle and writer proof say the run is over. */
export async function maintainAgentRuntime(rootDirectory = TEMP_ROOT_DIR): Promise<RuntimeMaintenanceReport> {
	const groups = await Promise.all([
		runDirectories(path.join(rootDirectory, "foreground-runs"), 1, "foreground"),
		runDirectories(path.join(rootDirectory, "async-subagent-runs"), 1, "async"),
		runDirectories(path.join(rootDirectory, "nested-subagent-runs"), 2, "nested"),
	]);
	const directories = candidateDirectories(groups);
	let inspected = 0;
	let trimmed = 0;
	let bytesReclaimed = 0;
	let abandonedPreparationsReclaimed = 0;
	for (const candidate of directories) {
		if (await reclaimAbandonedPreparation(candidate.directory, candidate.kind)) {
			abandonedPreparationsReclaimed += 1;
			continue;
		}
		if (Date.now() - candidate.mtimeMs < DIAGNOSTIC_TRIM_GRACE_MS) continue;
		const { directory } = candidate;
		let status: AsyncStatus | null;
		try {
			status = await readStatusAsync(directory);
		} catch {
			continue;
		}
		if (!status || status.runId !== path.basename(directory)) continue;
		inspected += 1;
		if (await safeToTrim(directory, status, candidate.kind)) {
			const reclaimed = await trimDiagnosticTail(path.join(directory, "events.jsonl"));
			if (reclaimed > 0) {
				trimmed += 1;
				bytesReclaimed += reclaimed;
			}
		}
		if (inspected % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
	}
	return { inspected, trimmed, bytesReclaimed, abandonedPreparationsReclaimed };
}

function safeSegment(value: string): boolean {
	return /^[A-Za-z0-9._-]{1,256}$/u.test(value) && value !== "." && value !== "..";
}

function eventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
