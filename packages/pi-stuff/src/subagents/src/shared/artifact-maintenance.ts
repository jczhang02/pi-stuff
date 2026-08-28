import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonValue } from "../../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import {
	ARTIFACT_CLEANUP_CONTROL_DIRECTORY,
	ARTIFACT_MAINTENANCE_INTERVAL_MS,
	artifactBaseName,
	artifactGroupNames,
	hasErrorCode,
} from "./artifact-files.ts";
import {
	advanceNameSnapshot,
	nameSnapshotControlNames,
	ownedRegularFile,
	readNameSnapshotPage,
	readSnapshotCursor,
	removeNameSnapshotControl,
	writeSnapshotCursor,
} from "./artifact-snapshot.ts";
import { writePrivateAtomicTextAsync } from "./atomic-json.ts";
import { shardedDurableClaimName, tryAcquireDurableClaim } from "./durable-claim.ts";
import { TEMP_ARTIFACTS_DIR } from "./types.ts";
import { getAgentSessionsDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const CLEANUP_CURSOR_FILE = ".cleanup-cursor";
const CLEANUP_SNAPSHOT_FILE = ".cleanup-snapshot.jsonl";
const CLEANUP_CONTROL_SWEEP_CURSOR_FILE = ".control-sweep-cursor";
const CLEANUP_CONTROL_SWEEP_SNAPSHOT_FILE = ".control-sweep-snapshot.jsonl";
const DISCOVERY_CURSOR_FILE = ".artifact-cleanup-frontier";
const DISCOVERY_SNAPSHOT_DIRECTORY = ".artifact-cleanup-snapshots";
const DISCOVERY_SWEEP_CURSOR_FILE = ".orphan-sweep-cursor";
const DISCOVERY_SWEEP_SNAPSHOT_FILE = ".orphan-sweep-snapshot.jsonl";
const ARTIFACT_DIRECTORY_NAME = "subagent-artifacts";
const MAX_ARTIFACT_DIRECTORIES_PER_PASS = 5_000;
const MAX_ARTIFACT_ENTRIES_PER_PASS = 50_000;
const SCAN_YIELD_INTERVAL = 32;
const MAX_DISCOVERY_CURSOR_BYTES = 1024 * 1024;
const SNAPSHOT_ORPHAN_GRACE_MS = 60 * 60 * 1_000;
const MAX_CONTROL_ENTRIES_PER_PASS = 4_096;
const MAX_CONTROL_TEMPORARIES_PER_PASS = 256;

export interface ArtifactMaintenanceReport {
	readonly directoriesInspected: number;
	readonly filesRemoved: number;
	readonly bytesReclaimed: number;
	readonly scanComplete: boolean;
}

export interface ArtifactMaintenanceOptions {
	readonly sessionsRoot?: string;
	readonly tempArtifactsDir?: string;
	readonly now?: number;
	readonly maxDirectories?: number;
	readonly maxEntries?: number;
}

function orderedArtifactGroupNames(base: string): string[] {
	return artifactGroupNames(base).sort((left, right) => {
		const terminalProofOrder = Number(left.endsWith("_meta.json")) - Number(right.endsWith("_meta.json"));
		return terminalProofOrder || left.localeCompare(right);
	});
}

function isTerminalArtifactMetadata<Value>(value: Value): boolean {
	if (!value || !isRuntimeObject(value) || value === null || Array.isArray(value)) return false;
	const state = "state" in value ? value.state : undefined;
	if (state === "running" || state === "queued") return false;
	if (["complete", "failed", "stopped"].includes(String(state))) return true;
	// Metadata written before lifecycle state was added is terminal because this
	// file was emitted only after the child process had settled.
	const exitCode = "exitCode" in value ? value.exitCode : undefined;
	return isRuntimeNumber(exitCode) && Number.isFinite(exitCode);
}

async function ownedDirectory(directory: string): Promise<boolean> {
	try {
		const stat = await fs.promises.lstat(directory);
		const currentUid = process.getuid?.();
		return stat.isDirectory() && !stat.isSymbolicLink() && (currentUid === undefined || stat.uid === currentUid);
	} catch {
		return false;
	}
}

async function cleanupMarkerIsFresh(directory: string, now: number): Promise<boolean> {
	try {
		const marker = await fs.promises.lstat(path.join(directory, CLEANUP_MARKER_FILE));
		const currentUid = process.getuid?.();
		return (
			marker.isFile() &&
			!marker.isSymbolicLink() &&
			(currentUid === undefined || marker.uid === currentUid) &&
			now - marker.mtimeMs < ARTIFACT_MAINTENANCE_INTERVAL_MS
		);
	} catch {
		return false;
	}
}

async function writeCleanupMarker(directory: string, now: number): Promise<void> {
	await writePrivateAtomicTextAsync(path.join(directory, CLEANUP_MARKER_FILE), `${String(now)}\n`);
}

interface ArtifactCleanupBudget {
	entries: number;
	records: number;
	readonly maxEntries: number;
}

function terminalArtifactGroup(directory: string, base: string, cutoff: number): boolean {
	try {
		const metadataPath = path.join(directory, `${base}_meta.json`);
		const metadataStat = fs.lstatSync(metadataPath);
		if (!ownedRegularFile(metadataStat) || metadataStat.mtimeMs >= cutoff || metadataStat.size > 64 * 1024)
			return false;
		const metadata = parseJsonValue(fs.readFileSync(metadataPath, "utf8"));
		if (!isTerminalArtifactMetadata(metadata)) return false;
		for (const name of artifactGroupNames(base)) {
			try {
				const stat = fs.lstatSync(path.join(directory, name));
				if (!ownedRegularFile(stat) || stat.mtimeMs >= cutoff) return false;
			} catch (error) {
				if (!hasErrorCode(error, "ENOENT")) return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

async function removeTerminalArtifactGroup(
	directory: string,
	base: string,
	cutoff: number,
): Promise<{ filesRemoved: number; bytesReclaimed: number }> {
	let claim: ReturnType<typeof tryAcquireDurableClaim>;
	try {
		const control = await ensureArtifactCleanupControlDirectory(directory);
		claim = tryAcquireDurableClaim(control, shardedDurableClaimName("artifact-group", base));
	} catch {
		return { filesRemoved: 0, bytesReclaimed: 0 };
	}
	if (!claim) return { filesRemoved: 0, bytesReclaimed: 0 };
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	try {
		if (!terminalArtifactGroup(directory, base, cutoff)) return { filesRemoved, bytesReclaimed };
		// Metadata is the terminal proof, so remove it last. The group claim excludes
		// every Suite-owned writer for the full validation-and-unlink sequence.
		const names = orderedArtifactGroupNames(base);
		for (const name of names) {
			const candidate = path.join(directory, name);
			try {
				const stat = fs.lstatSync(candidate);
				if (!ownedRegularFile(stat) || stat.mtimeMs >= cutoff) return { filesRemoved, bytesReclaimed };
				fs.unlinkSync(candidate);
				filesRemoved += 1;
				bytesReclaimed += stat.size;
			} catch (error) {
				// Missing siblings are valid for disabled artifact kinds; other failures
				// leave the remaining group intact for a later safe pass.
				if (!hasErrorCode(error, "ENOENT")) return { filesRemoved, bytesReclaimed };
			}
		}
		return { filesRemoved, bytesReclaimed };
	} finally {
		claim.release();
	}
}

async function ensureArtifactCleanupControlDirectory(directory: string): Promise<string> {
	const control = path.join(directory, ARTIFACT_CLEANUP_CONTROL_DIRECTORY);
	try {
		await fs.promises.mkdir(control, { mode: 0o700 });
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
	}
	if (!(await ownedDirectory(control))) throw new Error("Invalid artifact cleanup control directory.");
	await fs.promises.chmod(control, 0o700);
	return control;
}

function legacyCleanupTemporaryName(name: string): boolean {
	return (
		name === CLEANUP_CURSOR_FILE ||
		nameSnapshotControlNames(CLEANUP_SNAPSHOT_FILE).includes(name) ||
		/^\.cleanup-snapshot\.jsonl\.[0-9a-f-]{36}\.tmp$/u.test(name) ||
		/^\.\.cleanup-cursor\.[0-9a-f-]{36}\.tmp$/u.test(name) ||
		/^\.\.last-cleanup\.[0-9a-f-]{36}\.tmp$/u.test(name)
	);
}

function cleanupControlTemporaryName(name: string): boolean {
	return (
		/^\.cleanup-snapshot\.jsonl(?:\.(?:build|overflow)\.json)?\.[0-9a-f-]{36}\.tmp$/u.test(name) ||
		/^\.\.cleanup-cursor\.[0-9a-f-]{36}\.tmp$/u.test(name) ||
		/^\.control-sweep-snapshot\.jsonl(?:\.(?:build|overflow)\.json)?\.[0-9a-f-]{36}\.tmp$/u.test(name) ||
		/^\.\.control-sweep-cursor\.[0-9a-f-]{36}\.tmp$/u.test(name)
	);
}

async function sweepStaleSnapshotFiles(
	directory: string,
	snapshotName: string,
	cursorName: string,
	accept: (name: string, type: number) => boolean,
	now: number,
	maximum: number,
	retained?: ReadonlySet<string>,
): Promise<boolean> {
	const snapshot = path.join(directory, snapshotName);
	const cursor = path.join(directory, cursorName);
	try {
		const advanced = await advanceNameSnapshot(directory, snapshot, accept, maximum, now);
		if (!advanced.complete) return false;
		const offset = await readSnapshotCursor(cursor, snapshot);
		const page = await readNameSnapshotPage(snapshot, offset, MAX_CONTROL_TEMPORARIES_PER_PASS);
		for (const name of page.names) {
			if (retained?.has(name)) continue;
			const candidate = path.join(directory, name);
			try {
				const stat = await fs.promises.lstat(candidate);
				if (!ownedRegularFile(stat) || now - stat.mtimeMs < SNAPSHOT_ORPHAN_GRACE_MS) continue;
				await fs.promises.unlink(candidate);
			} catch {
				// A concurrent disappearance is already clean; unsafe entries fail closed.
			}
		}
		if (!page.complete) {
			await writeSnapshotCursor(cursor, snapshot, page.nextOffset);
			return false;
		}
		await fs.promises.unlink(cursor).catch(() => undefined);
		await removeNameSnapshotControl(snapshot);
		return true;
	} catch {
		await fs.promises.unlink(cursor).catch(() => undefined);
		await removeNameSnapshotControl(snapshot);
		return false;
	}
}

async function removeOldCleanupTemporary(directory: string, name: string, now: number): Promise<boolean> {
	if (!legacyCleanupTemporaryName(name)) return false;
	try {
		const candidate = path.join(directory, name);
		const stat = await fs.promises.lstat(candidate);
		if (!ownedRegularFile(stat) || now - stat.mtimeMs < SNAPSHOT_ORPHAN_GRACE_MS) return false;
		await fs.promises.unlink(candidate);
		return true;
	} catch {
		return false;
	}
}

async function cleanArtifactDirectory(
	directory: string,
	cutoff: number,
	now: number,
	budget: ArtifactCleanupBudget,
): Promise<{ filesRemoved: number; bytesReclaimed: number; complete: boolean }> {
	if (!(await ownedDirectory(directory)) || (await cleanupMarkerIsFresh(directory, now))) {
		return { filesRemoved: 0, bytesReclaimed: 0, complete: true };
	}
	let controlDirectory: string;
	let claim: ReturnType<typeof tryAcquireDurableClaim>;
	try {
		controlDirectory = await ensureArtifactCleanupControlDirectory(directory);
		claim = tryAcquireDurableClaim(controlDirectory, "maintenance");
	} catch {
		return { filesRemoved: 0, bytesReclaimed: 0, complete: false };
	}
	if (!claim) return { filesRemoved: 0, bytesReclaimed: 0, complete: false };
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	let complete = false;
	const snapshot = path.join(controlDirectory, CLEANUP_SNAPSHOT_FILE);
	try {
		if (
			!(await sweepStaleSnapshotFiles(
				controlDirectory,
				CLEANUP_CONTROL_SWEEP_SNAPSHOT_FILE,
				CLEANUP_CONTROL_SWEEP_CURSOR_FILE,
				(name, type) => type !== 10 && cleanupControlTemporaryName(name),
				now,
				MAX_CONTROL_ENTRIES_PER_PASS,
			))
		) {
			return { filesRemoved, bytesReclaimed, complete: false };
		}
		const remaining = Math.max(0, budget.maxEntries - budget.entries);
		const advanced = await advanceNameSnapshot(
			directory,
			snapshot,
			(name, type) =>
				type !== 10 &&
				name !== ARTIFACT_CLEANUP_CONTROL_DIRECTORY &&
				name !== CLEANUP_MARKER_FILE &&
				((name.endsWith("_meta.json") && artifactBaseName(name) !== undefined) || legacyCleanupTemporaryName(name)),
			remaining,
			now,
		);
		budget.entries += advanced.scanned;
		if (!advanced.complete) {
			return { filesRemoved, bytesReclaimed, complete: false };
		}
		const cursor = await readSnapshotCursor(path.join(controlDirectory, CLEANUP_CURSOR_FILE), snapshot);
		const page = await readNameSnapshotPage(snapshot, cursor, Math.max(0, budget.maxEntries - budget.records));
		budget.records += page.records;
		for (const name of page.names) {
			if (await removeOldCleanupTemporary(directory, name, now)) {
				filesRemoved += 1;
				continue;
			}
			const base = artifactBaseName(name);
			if (base) {
				const removed = await removeTerminalArtifactGroup(directory, base, cutoff);
				filesRemoved += removed.filesRemoved;
				bytesReclaimed += removed.bytesReclaimed;
			}
		}
		complete = page.complete;
		if (!complete) {
			await writeSnapshotCursor(path.join(controlDirectory, CLEANUP_CURSOR_FILE), snapshot, page.nextOffset);
		} else {
			try {
				await fs.promises.unlink(path.join(controlDirectory, CLEANUP_CURSOR_FILE)).catch(() => undefined);
				await removeNameSnapshotControl(snapshot);
				await writeCleanupMarker(directory, now);
			} catch {
				// A failed throttle marker only makes a later pass repeat safe cleanup.
			}
		}
	} catch {
		await removeNameSnapshotControl(snapshot);
		await fs.promises.unlink(path.join(controlDirectory, CLEANUP_CURSOR_FILE)).catch(() => undefined);
		return { filesRemoved, bytesReclaimed, complete: false };
	} finally {
		claim.release();
	}
	return { filesRemoved, bytesReclaimed, complete };
}

interface DiscoveryFrame {
	readonly directory: string;
	readonly snapshot?: string;
	readonly offset?: number;
	readonly building?: true;
	readonly artifact?: true;
}

function safeDiscoveryDirectory<Value>(value: Value): value is Value & string {
	if (!isRuntimeString(value) || value.length === 0 || value.length > 4_096 || path.isAbsolute(value)) return false;
	return !value.split(/[\\/]+/u).some((part) => part === ".." || part.includes("\0"));
}

function safeDiscoverySnapshot<Value>(value: Value): value is Value & string {
	return isRuntimeString(value) && /^[0-9a-f-]{36}\.jsonl$/u.test(value);
}

async function ensureDiscoverySnapshotDirectory(root: string): Promise<string> {
	const directory = path.join(root, DISCOVERY_SNAPSHOT_DIRECTORY);
	try {
		await fs.promises.mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
	}
	if (!(await ownedDirectory(directory))) throw new Error("Invalid artifact discovery snapshot directory.");
	await fs.promises.chmod(directory, 0o700);
	return directory;
}

function resolveDiscoverySnapshot(snapshotDirectory: string, snapshot: string): string | undefined {
	if (!safeDiscoverySnapshot(snapshot)) return undefined;
	const resolvedDirectory = path.resolve(snapshotDirectory);
	const candidate = path.resolve(resolvedDirectory, snapshot);
	return path.dirname(candidate) === resolvedDirectory ? candidate : undefined;
}

async function removeDiscoverySnapshot(snapshotDirectory: string, snapshot: string | undefined): Promise<void> {
	if (!snapshot) return;
	const candidate = resolveDiscoverySnapshot(snapshotDirectory, snapshot);
	if (!candidate) return;
	await removeNameSnapshotControl(candidate);
}

function discoverySnapshotControlName(name: string): boolean {
	return /^[0-9a-f-]{36}\.jsonl(?:\.(?:partial|build\.json|overflow\.json)(?:\.[0-9a-f-]{36}\.tmp)?|\.[0-9a-f-]{36}\.tmp)?$/u.test(
		name,
	);
}

function discoverySweepTemporaryName(name: string): boolean {
	return (
		/^\.orphan-sweep-snapshot\.jsonl(?:\.(?:build|overflow)\.json)?\.[0-9a-f-]{36}\.tmp$/u.test(name) ||
		/^\.\.orphan-sweep-cursor\.[0-9a-f-]{36}\.tmp$/u.test(name)
	);
}

async function sweepDiscoverySnapshots(
	snapshotDirectory: string,
	pending: readonly DiscoveryFrame[],
	now: number,
	maximum = MAX_CONTROL_ENTRIES_PER_PASS,
): Promise<boolean> {
	const retained = new Set(
		pending.flatMap((frame) => (frame.snapshot ? nameSnapshotControlNames(frame.snapshot) : [])),
	);
	return sweepStaleSnapshotFiles(
		snapshotDirectory,
		DISCOVERY_SWEEP_SNAPSHOT_FILE,
		DISCOVERY_SWEEP_CURSOR_FILE,
		(name, type) => type !== 10 && (discoverySnapshotControlName(name) || discoverySweepTemporaryName(name)),
		now,
		maximum,
		retained,
	);
}

async function readDiscoveryFrontier(root: string): Promise<DiscoveryFrame[] | undefined> {
	try {
		const cursorPath = path.join(root, DISCOVERY_CURSOR_FILE);
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > MAX_DISCOVERY_CURSOR_BYTES) return undefined;
		const parsed = parseJsonValue(await fs.promises.readFile(cursorPath, "utf8"));
		if (
			!isRuntimeObject(parsed) ||
			parsed === null ||
			Array.isArray(parsed) ||
			parsed["version"] !== 3 ||
			!Array.isArray(parsed["pending"]) ||
			parsed["pending"].length > MAX_ARTIFACT_ENTRIES_PER_PASS
		)
			return undefined;
		const pending: DiscoveryFrame[] = [];
		for (const frame of parsed["pending"]) {
			if (!frame || !isRuntimeObject(frame) || Array.isArray(frame)) return undefined;
			if (!safeDiscoveryDirectory(frame["directory"])) return undefined;
			if (frame["snapshot"] !== undefined && !safeDiscoverySnapshot(frame["snapshot"])) return undefined;
			if (
				frame["offset"] !== undefined &&
				(!isRuntimeNumber(frame["offset"]) || !Number.isSafeInteger(frame["offset"]) || frame["offset"] < 0)
			)
				return undefined;
			if (frame["artifact"] !== undefined && frame["artifact"] !== true) return undefined;
			if (frame["building"] !== undefined && frame["building"] !== true) return undefined;
			if (frame["artifact"] && (frame["snapshot"] !== undefined || frame["offset"] !== undefined)) return undefined;
			if (frame["offset"] !== undefined && frame["snapshot"] === undefined) return undefined;
			if (frame["building"] && frame["snapshot"] === undefined) return undefined;
			if (frame["building"] && frame["offset"] !== undefined) return undefined;
			let candidate: DiscoveryFrame = { directory: frame["directory"] };
			if (isRuntimeString(frame["snapshot"])) candidate = { ...candidate, snapshot: frame["snapshot"] };
			if (isRuntimeNumber(frame["offset"])) candidate = { ...candidate, offset: frame["offset"] };
			if (frame["building"] === true) candidate = { ...candidate, building: true };
			if (frame["artifact"] === true) candidate = { ...candidate, artifact: true };
			pending.push(candidate);
		}
		return pending;
	} catch {
		return undefined;
	}
}

async function writeDiscoveryFrontier(root: string, pending: readonly DiscoveryFrame[]): Promise<void> {
	const cursor = path.join(root, DISCOVERY_CURSOR_FILE);
	const serialized = `${JSON.stringify({ version: 3, pending })}\n`;
	if (Buffer.byteLength(serialized, "utf8") > MAX_DISCOVERY_CURSOR_BYTES) {
		throw new Error("Artifact discovery frontier exceeded its persistence bound.");
	}
	await writePrivateAtomicTextAsync(cursor, serialized);
}

function resolveDiscoveryFrame(root: string, frame: DiscoveryFrame): string | undefined {
	const candidate = path.resolve(root, frame.directory);
	const relative = path.relative(root, candidate);
	if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
	return candidate;
}

async function discoveryChildFrames(
	root: string,
	directory: string,
	names: readonly string[],
): Promise<DiscoveryFrame[]> {
	const frames: DiscoveryFrame[] = [];
	for (const name of names) {
		const candidate = path.join(directory, name);
		if (!(await ownedDirectory(candidate))) continue;
		const relative = path.relative(root, candidate);
		if (!safeDiscoveryDirectory(relative)) continue;
		frames.push(name === ARTIFACT_DIRECTORY_NAME ? { directory: relative, artifact: true } : { directory: relative });
	}
	return frames;
}

async function findSessionArtifactDirectories(
	root: string,
	maximum: number,
	now: number,
	budget: ArtifactCleanupBudget,
): Promise<{ directories: string[]; complete: boolean }> {
	if (!(await ownedDirectory(root))) return { directories: [], complete: true };
	let snapshotDirectory: string;
	try {
		snapshotDirectory = await ensureDiscoverySnapshotDirectory(root);
	} catch {
		return { directories: [], complete: false };
	}
	const claim = tryAcquireDurableClaim(snapshotDirectory, "discovery-maintenance");
	if (!claim) return { directories: [], complete: false };
	const pending = (await readDiscoveryFrontier(root)) ?? [{ directory: "." }];
	const directories: string[] = [];
	const retryArtifacts: DiscoveryFrame[] = [];
	try {
		await sweepDiscoverySnapshots(snapshotDirectory, pending, now);
		while (
			pending.length > 0 &&
			directories.length < maximum &&
			(budget.entries < budget.maxEntries || budget.records < budget.maxEntries)
		) {
			const frame = pending.pop();
			if (!frame) break;
			const directory = resolveDiscoveryFrame(root, frame);
			if (!directory || !(await ownedDirectory(directory))) {
				await removeDiscoverySnapshot(snapshotDirectory, frame.snapshot);
				continue;
			}
			if (frame.artifact) {
				if (!(await cleanupMarkerIsFresh(directory, now))) {
					directories.push(directory);
					retryArtifacts.push(frame);
				}
				continue;
			}
			let activeFrame = frame;
			let snapshot = activeFrame.snapshot;
			if (!snapshot) {
				snapshot = `${randomUUID()}.jsonl`;
				activeFrame = { directory: frame.directory, snapshot, building: true };
			}
			const snapshotPath = resolveDiscoverySnapshot(snapshotDirectory, snapshot);
			if (!snapshotPath) {
				pending.push({ directory: frame.directory });
				break;
			}
			try {
				if (activeFrame.building) {
					if (budget.entries >= budget.maxEntries) {
						pending.push(activeFrame);
						break;
					}
					const advanced = await advanceNameSnapshot(
						directory,
						snapshotPath,
						(name, type) => name !== DISCOVERY_SNAPSHOT_DIRECTORY && type !== 10 && (type === 0 || type === 4),
						Math.max(0, budget.maxEntries - budget.entries),
						now,
					);
					budget.entries += advanced.scanned;
					if (!advanced.complete) {
						pending.push(activeFrame);
						break;
					}
					activeFrame = { directory: frame.directory, snapshot, offset: 0 };
				}
				if (budget.records >= budget.maxEntries) {
					pending.push(activeFrame);
					break;
				}
				const page = await readNameSnapshotPage(
					snapshotPath,
					activeFrame.offset ?? 0,
					Math.min(SCAN_YIELD_INTERVAL, Math.max(0, budget.maxEntries - budget.records)),
				);
				budget.records += page.records;
				const childFrames = await discoveryChildFrames(root, directory, page.names);
				if (!page.complete) pending.push({ directory: frame.directory, snapshot, offset: page.nextOffset });
				else await removeDiscoverySnapshot(snapshotDirectory, snapshot);
				// The frontier is a depth-first stack. Snapshot pages keep both memory and
				// persisted state bounded by width × depth without rescanning a directory.
				for (let index = childFrames.length - 1; index >= 0; index -= 1) {
					const child = childFrames[index];
					if (child) pending.push(child);
				}
			} catch {
				await removeDiscoverySnapshot(snapshotDirectory, snapshot);
				pending.push({ directory: frame.directory });
				break;
			}
		}
		const complete = pending.length === 0;
		// A stale artifact directory remains at the top of the next frontier until
		// its cleanup marker is written. Bounded cleanup therefore advances every
		// turn instead of paying for a fresh session-tree discovery between chunks.
		pending.push(...retryArtifacts);
		try {
			if (pending.length === 0)
				await fs.promises.unlink(path.join(root, DISCOVERY_CURSOR_FILE)).catch(() => undefined);
			else await writeDiscoveryFrontier(root, pending);
		} catch {
			// Losing a best-effort frontier repeats safe discovery but never broadens deletion.
		}
		const sweepComplete = await sweepDiscoverySnapshots(snapshotDirectory, pending, now);
		return { directories, complete: complete && sweepComplete };
	} finally {
		claim.release();
	}
}

/**
 * Reclaim old default Agent artifacts after an explicit Agent interaction.
 * The bounded, yielding walk never follows symlinks and intentionally leaves
 * directories in place so session layout and in-flight writers stay intact.
 */
export async function maintainAgentArtifacts(
	maxAgeDays: number,
	options: ArtifactMaintenanceOptions = {},
): Promise<ArtifactMaintenanceReport> {
	const now = options.now ?? Date.now();
	const cutoff = now - Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1_000;
	const maxEntries = Math.max(1, options.maxEntries ?? MAX_ARTIFACT_ENTRIES_PER_PASS);
	const maxDirectories = Math.min(
		Math.max(0, options.maxDirectories ?? MAX_ARTIFACT_DIRECTORIES_PER_PASS),
		maxEntries,
	);
	const discoveryBudget: ArtifactCleanupBudget = {
		entries: 0,
		records: 0,
		maxEntries,
	};
	const sessionsRoot = options.sessionsRoot ?? getAgentSessionsDir();
	const discovered = await findSessionArtifactDirectories(sessionsRoot, maxDirectories, now, discoveryBudget);
	const tempArtifactsDir = options.tempArtifactsDir ?? TEMP_ARTIFACTS_DIR;
	let directoriesInspected = 0;
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	let scanComplete = discovered.complete;
	let sessionEntriesRemaining = maxEntries;
	for (let index = 0; index < discovered.directories.length; index += 1) {
		const directory = discovered.directories[index];
		if (!directory) continue;
		if (!(await ownedDirectory(directory))) continue;
		directoriesInspected += 1;
		const directoriesRemaining = discovered.directories.length - index;
		const quota = Math.max(1, Math.floor(sessionEntriesRemaining / directoriesRemaining));
		const localBudget: ArtifactCleanupBudget = { entries: 0, records: 0, maxEntries: quota };
		const cleaned = await cleanArtifactDirectory(directory, cutoff, now, localBudget);
		sessionEntriesRemaining = Math.max(
			0,
			sessionEntriesRemaining - Math.max(localBudget.entries, localBudget.records),
		);
		filesRemoved += cleaned.filesRemoved;
		bytesReclaimed += cleaned.bytesReclaimed;
		if (!cleaned.complete) scanComplete = false;
	}
	// Temp artifacts receive an independent bounded pass. A large or retained
	// session directory therefore cannot starve terminal temp artifacts forever.
	if (await ownedDirectory(tempArtifactsDir)) {
		directoriesInspected += 1;
		const tempBudget: ArtifactCleanupBudget = { entries: 0, records: 0, maxEntries };
		const cleaned = await cleanArtifactDirectory(tempArtifactsDir, cutoff, now, tempBudget);
		filesRemoved += cleaned.filesRemoved;
		bytesReclaimed += cleaned.bytesReclaimed;
		if (!cleaned.complete) scanComplete = false;
	}
	return { directoriesInspected, filesRemoved, bytesReclaimed, scanComplete };
}
