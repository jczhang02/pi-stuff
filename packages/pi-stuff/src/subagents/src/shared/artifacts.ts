import { dlopen, FFIType, read } from "bun:ffi";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type JsonValue, parseJsonValue } from "../../../shared/json-value.js";
import { isRuntimeFunction, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import { shardedDurableClaimName, tryAcquireDurableClaim, tryAcquireKernelClaim } from "./durable-claim.ts";
import { type ArtifactDirPreference, type ArtifactPaths, TEMP_ARTIFACTS_DIR } from "./types.ts";
import { getAgentSessionsDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const CLEANUP_CURSOR_FILE = ".cleanup-cursor";
const CLEANUP_SNAPSHOT_FILE = ".cleanup-snapshot.jsonl";
const CLEANUP_CONTROL_SWEEP_CURSOR_FILE = ".control-sweep-cursor";
const CLEANUP_CONTROL_SWEEP_SNAPSHOT_FILE = ".control-sweep-snapshot.jsonl";
const CLEANUP_CONTROL_DIRECTORY = ".artifact-cleanup-control";
const DISCOVERY_CURSOR_FILE = ".artifact-cleanup-frontier";
const DISCOVERY_SNAPSHOT_DIRECTORY = ".artifact-cleanup-snapshots";
const DISCOVERY_SWEEP_CURSOR_FILE = ".orphan-sweep-cursor";
const DISCOVERY_SWEEP_SNAPSHOT_FILE = ".orphan-sweep-snapshot.jsonl";
const PROJECT_ARTIFACT_ROOT = ".pi-subagents";
const ARTIFACT_DIRECTORY_NAME = "subagent-artifacts";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_ARTIFACT_DIRECTORIES_PER_PASS = 5_000;
const MAX_ARTIFACT_ENTRIES_PER_PASS = 50_000;
const SCAN_YIELD_INTERVAL = 32;
const MAX_DISCOVERY_CURSOR_BYTES = 1024 * 1024;
const SNAPSHOT_BUFFER_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_SNAPSHOT_RECORD_BYTES = 32 * 1024;
const SNAPSHOT_PARTIAL_SUFFIX = ".partial";
const SNAPSHOT_BUILD_STATE_SUFFIX = ".build.json";
const SNAPSHOT_OVERFLOW_SUFFIX = ".overflow.json";
const SNAPSHOT_ORPHAN_GRACE_MS = 60 * 60 * 1_000;
const MAX_CONTROL_ENTRIES_PER_PASS = 4_096;
const MAX_CONTROL_TEMPORARIES_PER_PASS = 256;
const ARTIFACT_WRITE_CLAIM_ATTEMPTS = 100;
const ARTIFACT_WRITE_CLAIM_WAIT_MS = 5;
const ARTIFACT_SUFFIXES = ["_input.md", "_output.md", "_transcript.jsonl", "_meta.json", ".jsonl"] as const;
const cachedArtifactClaims = new Map<
	string,
	{
		claim: NonNullable<ReturnType<typeof tryAcquireKernelClaim>>;
		users: number;
	}
>();

function hasErrorCode<Cause>(cause: Cause, code: string): boolean {
	return isRuntimeObject(cause) && cause !== null && "code" in cause && cause.code === code;
}

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

export function getProjectSubagentsDir(cwd: string): string {
	return path.join(cwd, PROJECT_ARTIFACT_ROOT);
}

export function getProjectArtifactsDir(cwd: string): string {
	return path.join(getProjectSubagentsDir(cwd), "artifacts");
}

export function getArtifactsDir(
	sessionFile: string | null,
	projectCwd?: string,
	dirPreference: ArtifactDirPreference = "session",
): string {
	switch (dirPreference) {
		case "session":
			if (sessionFile) {
				const sessionDir = path.dirname(sessionFile);
				return path.join(sessionDir, "subagent-artifacts");
			}
			return TEMP_ARTIFACTS_DIR;
		case "temp":
			return TEMP_ARTIFACTS_DIR;
		case "project":
			if (projectCwd) return getProjectArtifactsDir(projectCwd);
			if (sessionFile) {
				const sessionDir = path.dirname(sessionFile);
				return path.join(sessionDir, "subagent-artifacts");
			}
			return TEMP_ARTIFACTS_DIR;
		default:
			throw new Error(
				`Unsupported artifactDir ${JSON.stringify(dirPreference)}; expected "project", "session", or "temp".`,
			);
	}
}

export function getArtifactPaths(artifactsDir: string, runId: string, agent: string, index?: number): ArtifactPaths {
	const suffix = index !== undefined ? `_${index}` : "";
	const safeAgent = agent.replace(/[^\w.-]/g, "_");
	const base = `${runId}_${safeAgent}${suffix}`;
	return {
		inputPath: path.join(artifactsDir, `${base}_input.md`),
		outputPath: path.join(artifactsDir, `${base}_output.md`),
		jsonlPath: path.join(artifactsDir, `${base}.jsonl`),
		transcriptPath: path.join(artifactsDir, `${base}_transcript.jsonl`),
		metadataPath: path.join(artifactsDir, `${base}_meta.json`),
	};
}

export function formatOutputArtifactContent(input: {
	output: string;
	error?: string;
	transcriptPath?: string;
	metadataPath?: string;
}): string {
	if (input.output.trim() || !input.error) return input.output;
	const lines = ["Subagent run failed before producing output.", "", "Error:", input.error];
	if (input.transcriptPath) lines.push("", `Transcript: ${input.transcriptPath}`);
	if (input.metadataPath) lines.push(`Metadata: ${input.metadataPath}`);
	return lines.join("\n");
}

export function appendJsonl(filePath: string, line: string): void {
	fs.appendFileSync(filePath, `${line}\n`);
}

export function appendArtifactJsonl(filePath: string, line: string): void {
	withArtifactGroupWriteClaim(filePath, () => fs.appendFileSync(filePath, `${line}\n`));
}

function artifactBaseName(fileName: string): string | undefined {
	for (const suffix of ARTIFACT_SUFFIXES) {
		if (fileName.endsWith(suffix) && fileName.length > suffix.length) return fileName.slice(0, -suffix.length);
	}
	return undefined;
}

function artifactGroupNames(base: string): string[] {
	return ARTIFACT_SUFFIXES.map((suffix) => `${base}${suffix}`);
}

function ensureArtifactCleanupControlDirectorySync(directory: string): string {
	const parent = fs.lstatSync(directory);
	const currentUid = process.getuid?.();
	if (parent.isSymbolicLink() || !parent.isDirectory() || (currentUid !== undefined && parent.uid !== currentUid)) {
		throw new Error("Invalid artifact directory.");
	}
	const control = path.join(directory, CLEANUP_CONTROL_DIRECTORY);
	try {
		fs.mkdirSync(control, { mode: 0o700 });
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
	}
	const stat = fs.lstatSync(control);
	if (stat.isSymbolicLink() || !stat.isDirectory() || (currentUid !== undefined && stat.uid !== currentUid)) {
		throw new Error("Invalid artifact cleanup control directory.");
	}
	fs.chmodSync(control, 0o700);
	return control;
}

function pauseForArtifactClaim(): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ARTIFACT_WRITE_CLAIM_WAIT_MS);
}

function acquireArtifactGroupWriteClaim(control: string, claimName: string): () => void {
	const controlStat = fs.lstatSync(control);
	const cacheKey = `${String(controlStat.dev)}:${String(controlStat.ino)}:${claimName}`;
	let cached = cachedArtifactClaims.get(cacheKey);
	if (cached) {
		cached.users += 1;
	} else {
		let claim: ReturnType<typeof tryAcquireKernelClaim>;
		for (let attempt = 0; attempt < ARTIFACT_WRITE_CLAIM_ATTEMPTS; attempt += 1) {
			claim = tryAcquireKernelClaim(control, claimName);
			if (claim) break;
			pauseForArtifactClaim();
		}
		if (!claim) throw new Error("Timed out waiting for the Agent artifact group writer claim.");
		cached = { claim, users: 1 };
		cachedArtifactClaims.set(cacheKey, cached);
	}
	const acquired = cached;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		acquired.users -= 1;
		if (acquired.users > 0) return;
		if (cachedArtifactClaims.get(cacheKey) === acquired) cachedArtifactClaims.delete(cacheKey);
		acquired.claim.release();
	};
}

/** Coordinate optional artifact writers with age-based cleanup of the same group. */
export function withArtifactGroupWriteClaim<T>(filePath: string, operation: () => T): T {
	const base = artifactBaseName(path.basename(filePath));
	if (!base) throw new Error(`Unknown Agent artifact path '${filePath}'.`);
	const control = ensureArtifactCleanupControlDirectorySync(path.dirname(filePath));
	const claimName = shardedDurableClaimName("artifact-group", base);
	const release = acquireArtifactGroupWriteClaim(control, claimName);
	let releaseSynchronously = true;
	try {
		const result = operation();
		if (
			result !== null &&
			(isRuntimeObject(result) || isRuntimeFunction(result)) &&
			"then" in result &&
			isRuntimeFunction(result.then)
		) {
			releaseSynchronously = false;
			// SAFETY: the runtime thenable check proves this branch preserves the operation's asynchronous T contract.
			return Promise.resolve(result).finally(release) as T;
		}
		return result;
	} finally {
		if (releaseSynchronously) release();
	}
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

function ownedRegularFile(stat: fs.Stats): boolean {
	const currentUid = process.getuid?.();
	return stat.isFile() && !stat.isSymbolicLink() && (currentUid === undefined || stat.uid === currentUid);
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
			now - marker.mtimeMs < CLEANUP_INTERVAL_MS
		);
	} catch {
		return false;
	}
}

async function writeCleanupMarker(directory: string, now: number): Promise<void> {
	const marker = path.join(directory, CLEANUP_MARKER_FILE);
	const temporary = path.join(directory, `.${CLEANUP_MARKER_FILE}.${randomUUID()}.tmp`);
	try {
		await fs.promises.writeFile(temporary, `${String(now)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		await fs.promises.rename(temporary, marker);
	} finally {
		try {
			await fs.promises.unlink(temporary);
		} catch {
			// Atomic rename already consumed the temporary, or best-effort cleanup failed.
		}
	}
}

interface ArtifactCleanupBudget {
	entries: number;
	records: number;
	readonly maxEntries: number;
}

function safeSnapshotName<Value>(value: Value): value is Value & string {
	return (
		isRuntimeString(value) &&
		value.length > 0 &&
		value.length <= 4_096 &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}

interface SnapshotBuildState {
	readonly version: 1;
	readonly cookie: string;
	readonly size: number;
}

interface SnapshotAdvanceResult {
	readonly complete: boolean;
	readonly scanned: number;
}

function snapshotPartialPath(target: string): string {
	return `${target}${SNAPSHOT_PARTIAL_SUFFIX}`;
}

function snapshotBuildStatePath(target: string): string {
	return `${target}${SNAPSHOT_BUILD_STATE_SUFFIX}`;
}

function snapshotOverflowPath(target: string): string {
	return `${target}${SNAPSHOT_OVERFLOW_SUFFIX}`;
}

async function unlinkOwnedRegularFile(filePath: string): Promise<void> {
	try {
		const stat = await fs.promises.lstat(filePath);
		if (ownedRegularFile(stat)) await fs.promises.unlink(filePath);
	} catch {
		// Missing or invalid control files fail closed and are retried later.
	}
}

async function removeNameSnapshotControl(target: string): Promise<void> {
	for (const candidate of [
		target,
		snapshotPartialPath(target),
		snapshotBuildStatePath(target),
		snapshotOverflowPath(target),
	]) {
		await unlinkOwnedRegularFile(candidate);
	}
}

async function readSnapshotBuildState(target: string): Promise<SnapshotBuildState | undefined> {
	try {
		const statePath = snapshotBuildStatePath(target);
		const stat = await fs.promises.lstat(statePath);
		if (!ownedRegularFile(stat) || stat.size > 4_096) return undefined;
		const parsed = parseJsonValue(await fs.promises.readFile(statePath, "utf8"));
		if (
			!isRuntimeObject(parsed) ||
			parsed === null ||
			Array.isArray(parsed) ||
			parsed.version !== 1 ||
			!isRuntimeString(parsed.cookie) ||
			!/^\d+$/u.test(parsed.cookie) ||
			!isRuntimeNumber(parsed.size) ||
			!Number.isSafeInteger(parsed.size) ||
			parsed.size < 0 ||
			parsed.size > MAX_SNAPSHOT_BYTES
		)
			return undefined;
		return { version: 1, cookie: parsed.cookie, size: parsed.size };
	} catch {
		return undefined;
	}
}

async function writeSnapshotBuildState(target: string, state: SnapshotBuildState): Promise<void> {
	const statePath = snapshotBuildStatePath(target);
	const temporary = `${statePath}.${randomUUID()}.tmp`;
	try {
		await fs.promises.writeFile(temporary, `${JSON.stringify(state)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await fs.promises.rename(temporary, statePath);
	} finally {
		await fs.promises.unlink(temporary).catch(() => undefined);
	}
}

async function snapshotOverflowIsDeferred(target: string, now: number): Promise<boolean> {
	const overflow = snapshotOverflowPath(target);
	try {
		const stat = await fs.promises.lstat(overflow);
		if (!ownedRegularFile(stat)) return true;
		if (stat.size > 4_096) {
			await fs.promises.unlink(overflow);
			return false;
		}
		let parsed: JsonValue;
		try {
			parsed = parseJsonValue(await fs.promises.readFile(overflow, "utf8"));
		} catch {
			// This is an owned bounded control file, so malformed crash debris can be
			// discarded safely instead of disabling maintenance forever.
			await fs.promises.unlink(overflow);
			return false;
		}
		if (
			isRuntimeObject(parsed) &&
			parsed !== null &&
			!Array.isArray(parsed) &&
			isRuntimeNumber(parsed.retryAt) &&
			Number.isFinite(parsed.retryAt) &&
			parsed.retryAt > now
		) {
			return true;
		}
		await fs.promises.unlink(overflow);
		return false;
	} catch (error) {
		return !hasErrorCode(error, "ENOENT");
	}
}

async function deferOversizedSnapshot(target: string, now: number): Promise<void> {
	await unlinkOwnedRegularFile(snapshotPartialPath(target));
	await unlinkOwnedRegularFile(snapshotBuildStatePath(target));
	const overflow = snapshotOverflowPath(target);
	const temporary = `${overflow}.${randomUUID()}.tmp`;
	try {
		await fs.promises.writeFile(
			temporary,
			`${JSON.stringify({ version: 1, retryAt: now + CLEANUP_INTERVAL_MS })}\n`,
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
		await fs.promises.rename(temporary, overflow);
	} finally {
		await fs.promises.unlink(temporary).catch(() => undefined);
	}
}

function loadLinuxDirectoryLibrary() {
	return dlopen("libc.so.6", {
		opendir: { args: [FFIType.cstring], returns: FFIType.ptr },
		readdir: { args: [FFIType.ptr], returns: FFIType.ptr },
		telldir: { args: [FFIType.ptr], returns: FFIType.i64 },
		seekdir: { args: [FFIType.ptr, FFIType.i64], returns: FFIType.void },
		closedir: { args: [FFIType.ptr], returns: FFIType.i32 },
	});
}

let linuxDirectoryLibrary: ReturnType<typeof loadLinuxDirectoryLibrary> | undefined;

async function advanceLinuxNameSnapshot(
	directory: string,
	target: string,
	accept: (name: string, type: number) => boolean,
	limit: number,
	now: number,
): Promise<SnapshotAdvanceResult> {
	if (await snapshotOverflowIsDeferred(target, now)) return { complete: false, scanned: 0 };
	try {
		const finalStat = await fs.promises.lstat(target);
		if (!ownedRegularFile(finalStat) || finalStat.size > MAX_SNAPSHOT_BYTES) {
			throw new Error("Invalid artifact maintenance snapshot.");
		}
		await unlinkOwnedRegularFile(snapshotPartialPath(target));
		await unlinkOwnedRegularFile(snapshotBuildStatePath(target));
		return { complete: true, scanned: 0 };
	} catch (error) {
		if (!hasErrorCode(error, "ENOENT")) throw error;
	}

	const partial = snapshotPartialPath(target);
	let state = await readSnapshotBuildState(target);
	if (!state) {
		await unlinkOwnedRegularFile(partial);
		await unlinkOwnedRegularFile(snapshotBuildStatePath(target));
		const handle = await fs.promises.open(partial, "wx", 0o600);
		await handle.close();
		state = { version: 1, cookie: "0", size: 0 };
		await writeSnapshotBuildState(target, state);
	}
	const partialStat = await fs.promises.lstat(partial);
	if (!ownedRegularFile(partialStat) || partialStat.size < state.size || partialStat.size > MAX_SNAPSHOT_BYTES) {
		throw new Error("Invalid partial artifact maintenance snapshot.");
	}
	if (partialStat.size > state.size) await fs.promises.truncate(partial, state.size);
	if (limit <= 0) return { complete: false, scanned: 0 };

	linuxDirectoryLibrary ??= loadLinuxDirectoryLibrary();
	const symbols = linuxDirectoryLibrary.symbols;
	const directoryPointer = symbols.opendir(Buffer.from(`${directory}\0`));
	if (!directoryPointer) throw new Error(`Unable to open artifact maintenance directory '${directory}'.`);
	let scanned = 0;
	let complete = false;
	let cookie = BigInt(state.cookie);
	let buffered = "";
	try {
		if (cookie > 0n) symbols.seekdir(directoryPointer, cookie);
		while (scanned < limit) {
			const entryPointer = symbols.readdir(directoryPointer);
			if (!entryPointer) {
				complete = true;
				break;
			}
			const recordLength = read.u16(entryPointer, 16);
			if (recordLength < 20 || recordLength > 4_096) {
				throw new Error("Invalid Linux directory record while building an artifact snapshot.");
			}
			const nameBytes: number[] = [];
			for (let offset = 19; offset < recordLength; offset += 1) {
				const byte = read.u8(entryPointer, offset);
				if (byte === 0) break;
				nameBytes.push(byte);
			}
			const name = Buffer.from(nameBytes).toString("utf8");
			cookie = symbols.telldir(directoryPointer);
			if (name === "." || name === "..") continue;
			scanned += 1;
			if (scanned % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
			if (!safeSnapshotName(name)) continue;
			const type = read.u8(entryPointer, 18);
			if (accept(name, type)) {
				buffered += `${JSON.stringify(name)}\n`;
			}
		}
		// readdir has no separate EOF flag. A single non-accounted look-ahead lets
		// an exact-limit directory finish now; a real next entry remains reachable
		// from the persisted cookie when the directory is reopened.
		if (!complete && scanned >= limit && !symbols.readdir(directoryPointer)) complete = true;
	} finally {
		symbols.closedir(directoryPointer);
	}

	const appended = Buffer.from(buffered, "utf8");
	const nextSize = state.size + appended.length;
	if (nextSize > MAX_SNAPSHOT_BYTES) {
		await deferOversizedSnapshot(target, now);
		return { complete: false, scanned };
	}
	const handle = await fs.promises.open(partial, "r+");
	try {
		if (appended.length > 0) await handle.write(appended, 0, appended.length, state.size);
		await handle.sync();
	} finally {
		await handle.close();
	}
	if (complete) {
		await fs.promises.rename(partial, target);
		await unlinkOwnedRegularFile(snapshotBuildStatePath(target));
	} else {
		await writeSnapshotBuildState(target, { version: 1, cookie: String(cookie), size: nextSize });
	}
	return { complete, scanned };
}

async function buildPortableNameSnapshot(
	directory: string,
	target: string,
	accept: (name: string, type: number) => boolean,
	limit: number,
	now: number,
): Promise<SnapshotAdvanceResult> {
	if (await snapshotOverflowIsDeferred(target, now)) return { complete: false, scanned: 0 };
	if (limit <= 0) return { complete: false, scanned: 0 };
	const temporary = `${target}.${randomUUID()}.tmp`;
	let handle: fs.promises.FileHandle | undefined;
	let entries: fs.Dir | undefined;
	let scanned = 0;
	try {
		handle = await fs.promises.open(temporary, "wx", 0o600);
		let buffered = "";
		let bufferedBytes = 0;
		let snapshotBytes = 0;
		const flush = async (): Promise<void> => {
			if (!buffered) return;
			await handle?.write(buffered);
			buffered = "";
			bufferedBytes = 0;
		};
		entries = await fs.promises.opendir(directory);
		let complete = false;
		while (scanned < limit) {
			const entry = await entries.read();
			if (!entry) {
				complete = true;
				break;
			}
			scanned += 1;
			if (scanned % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
			const type = entry.isDirectory() ? 4 : entry.isSymbolicLink() ? 10 : 0;
			if (!accept(entry.name, type)) continue;
			const line = `${JSON.stringify(entry.name)}\n`;
			const lineBytes = Buffer.byteLength(line, "utf8");
			snapshotBytes += lineBytes;
			if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw new Error("Artifact maintenance snapshot exceeded its bound.");
			buffered += line;
			bufferedBytes += lineBytes;
			if (bufferedBytes >= SNAPSHOT_BUFFER_BYTES) await flush();
		}
		if (!complete && scanned >= limit && !(await entries.read())) complete = true;
		if (!complete) {
			// Node/Bun does not expose a durable directory cookie on every platform.
			// Fail closed for an over-budget directory instead of hiding an unbounded
			// readdir behind the maintenance API; the normal 50k limit handles the
			// overwhelmingly common case in one pass.
			await deferOversizedSnapshot(target, now);
			return { complete: false, scanned };
		}
		await flush();
		await handle.close();
		handle = undefined;
		await fs.promises.rename(temporary, target);
		return { complete: true, scanned };
	} finally {
		await entries?.close().catch(() => undefined);
		await handle?.close().catch(() => undefined);
		await fs.promises.unlink(temporary).catch(() => undefined);
	}
}

async function advanceNameSnapshot(
	directory: string,
	target: string,
	accept: (name: string, type: number) => boolean,
	limit: number,
	now: number,
): Promise<SnapshotAdvanceResult> {
	if (process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64")) {
		try {
			return await advanceLinuxNameSnapshot(directory, target, accept, limit, now);
		} catch {
			// Minimal Linux images can lack the expected libc soname. The portable
			// path remains bounded and fail-closed rather than disabling the Agent.
			await removeNameSnapshotControl(target);
		}
	}
	try {
		const stat = await fs.promises.lstat(target);
		if (!ownedRegularFile(stat) || stat.size > MAX_SNAPSHOT_BYTES)
			throw new Error("Invalid artifact maintenance snapshot.");
		return { complete: true, scanned: 0 };
	} catch (error) {
		if (!hasErrorCode(error, "ENOENT")) throw error;
	}
	return buildPortableNameSnapshot(directory, target, accept, limit, now);
}

interface NameSnapshotPage {
	readonly names: string[];
	readonly records: number;
	readonly nextOffset: number;
	readonly complete: boolean;
}

async function readNameSnapshotPage(filePath: string, offset: number, limit: number): Promise<NameSnapshotPage> {
	const stat = await fs.promises.lstat(filePath);
	if (!ownedRegularFile(stat) || stat.size > MAX_SNAPSHOT_BYTES)
		throw new Error("Invalid artifact maintenance snapshot.");
	if (limit <= 0 || offset >= stat.size) {
		return { names: [], records: 0, nextOffset: Math.min(offset, stat.size), complete: offset >= stat.size };
	}
	const handle = await fs.promises.open(filePath, "r");
	try {
		const names: string[] = [];
		let records = 0;
		let readPosition = Math.max(0, offset);
		let nextOffset = readPosition;
		let carry = Buffer.alloc(0);
		let discardingOversizedRecord = false;
		while (records < limit && readPosition < stat.size) {
			const chunk = Buffer.allocUnsafe(Math.min(SNAPSHOT_BUFFER_BYTES, stat.size - readPosition));
			const { bytesRead } = await handle.read(chunk, 0, chunk.length, readPosition);
			if (bytesRead <= 0) break;
			const combined =
				carry.length && !discardingOversizedRecord
					? Buffer.concat([carry, chunk.subarray(0, bytesRead)])
					: chunk.subarray(0, bytesRead);
			const combinedStart = readPosition - (discardingOversizedRecord ? 0 : carry.length);
			let lineStart = 0;
			for (let index = 0; index < combined.length && records < limit; index += 1) {
				if (combined[index] !== 0x0a) continue;
				records += 1;
				nextOffset = combinedStart + index + 1;
				if (!discardingOversizedRecord && index - lineStart <= MAX_SNAPSHOT_RECORD_BYTES) {
					const raw = combined.subarray(lineStart, index).toString("utf8");
					try {
						const parsed = JSON.parse(raw);
						if (safeSnapshotName(parsed)) names.push(parsed);
					} catch {
						// A malformed owned snapshot record is skipped without broadening deletion.
					}
				}
				discardingOversizedRecord = false;
				lineStart = index + 1;
			}
			readPosition += bytesRead;
			if (records >= limit) {
				carry = Buffer.alloc(0);
			} else {
				const tail = combined.subarray(lineStart);
				if (discardingOversizedRecord || tail.length > MAX_SNAPSHOT_RECORD_BYTES) {
					carry = Buffer.alloc(0);
					discardingOversizedRecord = true;
				} else {
					carry = Buffer.from(tail);
				}
			}
		}
		if (records < limit && readPosition >= stat.size) nextOffset = stat.size;
		return { names, records, nextOffset, complete: nextOffset >= stat.size };
	} finally {
		await handle.close();
	}
}

interface CleanupSnapshotIdentity {
	readonly dev: number;
	readonly ino: number;
	readonly mtimeMs: number;
	readonly size: number;
}

async function cleanupSnapshotIdentity(snapshot: string): Promise<CleanupSnapshotIdentity> {
	const stat = await fs.promises.lstat(snapshot);
	if (!ownedRegularFile(stat) || stat.size > MAX_SNAPSHOT_BYTES) {
		throw new Error("Invalid artifact cleanup snapshot.");
	}
	return { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
}

function sameCleanupSnapshotIdentity<Left>(left: Left, right: CleanupSnapshotIdentity): boolean {
	if (!left || !isRuntimeObject(left) || Array.isArray(left)) return false;
	return (
		"dev" in left &&
		left.dev === right.dev &&
		"ino" in left &&
		left.ino === right.ino &&
		"mtimeMs" in left &&
		left.mtimeMs === right.mtimeMs &&
		"size" in left &&
		left.size === right.size
	);
}

async function readSnapshotCursor(cursorPath: string, snapshot: string): Promise<number> {
	try {
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > 4_096) return 0;
		const value = parseJsonValue(await fs.promises.readFile(cursorPath, "utf8"));
		const identity = await cleanupSnapshotIdentity(snapshot);
		if (
			!isRuntimeObject(value) ||
			value === null ||
			Array.isArray(value) ||
			value.version !== 2 ||
			!sameCleanupSnapshotIdentity(value.snapshot, identity)
		) {
			return 0;
		}
		if (
			!isRuntimeNumber(value.offset) ||
			!Number.isSafeInteger(value.offset) ||
			value.offset < 0 ||
			value.offset > identity.size
		)
			return 0;
		if (value.offset > 0) {
			const handle = await fs.promises.open(snapshot, "r");
			try {
				const boundary = Buffer.allocUnsafe(1);
				const { bytesRead } = await handle.read(boundary, 0, 1, value.offset - 1);
				if (bytesRead !== 1 || boundary[0] !== 0x0a) return 0;
			} finally {
				await handle.close();
			}
		}
		return value.offset;
	} catch {
		return 0;
	}
}

async function writeSnapshotCursor(cursor: string, snapshot: string, offset: number): Promise<void> {
	const temporary = path.join(path.dirname(cursor), `.${path.basename(cursor)}.${randomUUID()}.tmp`);
	try {
		await fs.promises.writeFile(
			temporary,
			`${JSON.stringify({ version: 2, offset, snapshot: await cleanupSnapshotIdentity(snapshot) })}\n`,
			{
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			},
		);
		await fs.promises.rename(temporary, cursor);
	} finally {
		try {
			await fs.promises.unlink(temporary);
		} catch {
			// Atomic rename already consumed the temporary, or best-effort cleanup failed.
		}
	}
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
	const control = path.join(directory, CLEANUP_CONTROL_DIRECTORY);
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
		name === CLEANUP_SNAPSHOT_FILE ||
		name === `${CLEANUP_SNAPSHOT_FILE}${SNAPSHOT_PARTIAL_SUFFIX}` ||
		name === `${CLEANUP_SNAPSHOT_FILE}${SNAPSHOT_BUILD_STATE_SUFFIX}` ||
		name === `${CLEANUP_SNAPSHOT_FILE}${SNAPSHOT_OVERFLOW_SUFFIX}` ||
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

async function sweepCleanupControlTemporaries(controlDirectory: string, now: number): Promise<boolean> {
	const snapshot = path.join(controlDirectory, CLEANUP_CONTROL_SWEEP_SNAPSHOT_FILE);
	const cursor = path.join(controlDirectory, CLEANUP_CONTROL_SWEEP_CURSOR_FILE);
	try {
		const advanced = await advanceNameSnapshot(
			controlDirectory,
			snapshot,
			(name, type) => type !== 10 && cleanupControlTemporaryName(name),
			MAX_CONTROL_ENTRIES_PER_PASS,
			now,
		);
		if (!advanced.complete) return false;
		const offset = await readSnapshotCursor(cursor, snapshot);
		const page = await readNameSnapshotPage(snapshot, offset, MAX_CONTROL_TEMPORARIES_PER_PASS);
		for (const name of page.names) {
			const candidate = path.join(controlDirectory, name);
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
		if (!(await sweepCleanupControlTemporaries(controlDirectory, now))) {
			return { filesRemoved, bytesReclaimed, complete: false };
		}
		const remaining = Math.max(0, budget.maxEntries - budget.entries);
		const advanced = await advanceNameSnapshot(
			directory,
			snapshot,
			(name, type) =>
				type !== 10 &&
				name !== CLEANUP_CONTROL_DIRECTORY &&
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
		pending.flatMap((frame) => {
			if (!frame.snapshot) return [];
			return [
				frame.snapshot,
				`${frame.snapshot}${SNAPSHOT_PARTIAL_SUFFIX}`,
				`${frame.snapshot}${SNAPSHOT_BUILD_STATE_SUFFIX}`,
				`${frame.snapshot}${SNAPSHOT_OVERFLOW_SUFFIX}`,
			];
		}),
	);
	const snapshot = path.join(snapshotDirectory, DISCOVERY_SWEEP_SNAPSHOT_FILE);
	const cursor = path.join(snapshotDirectory, DISCOVERY_SWEEP_CURSOR_FILE);
	try {
		const advanced = await advanceNameSnapshot(
			snapshotDirectory,
			snapshot,
			(name, type) => type !== 10 && (discoverySnapshotControlName(name) || discoverySweepTemporaryName(name)),
			maximum,
			now,
		);
		if (!advanced.complete) return false;
		const offset = await readSnapshotCursor(cursor, snapshot);
		const page = await readNameSnapshotPage(snapshot, offset, MAX_CONTROL_TEMPORARIES_PER_PASS);
		for (const name of page.names) {
			if (retained.has(name)) continue;
			const candidate = path.join(snapshotDirectory, name);
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
			parsed.version !== 3 ||
			!Array.isArray(parsed.pending) ||
			parsed.pending.length > MAX_ARTIFACT_ENTRIES_PER_PASS
		)
			return undefined;
		const pending: DiscoveryFrame[] = [];
		for (const frame of parsed.pending) {
			if (!frame || !isRuntimeObject(frame) || Array.isArray(frame)) return undefined;
			if (!safeDiscoveryDirectory(frame.directory)) return undefined;
			if (frame.snapshot !== undefined && !safeDiscoverySnapshot(frame.snapshot)) return undefined;
			if (
				frame.offset !== undefined &&
				(!isRuntimeNumber(frame.offset) || !Number.isSafeInteger(frame.offset) || frame.offset < 0)
			)
				return undefined;
			if (frame.artifact !== undefined && frame.artifact !== true) return undefined;
			if (frame.building !== undefined && frame.building !== true) return undefined;
			if (frame.artifact && (frame.snapshot !== undefined || frame.offset !== undefined)) return undefined;
			if (frame.offset !== undefined && frame.snapshot === undefined) return undefined;
			if (frame.building && frame.snapshot === undefined) return undefined;
			if (frame.building && frame.offset !== undefined) return undefined;
			let candidate: DiscoveryFrame = { directory: frame.directory };
			if (isRuntimeString(frame.snapshot)) candidate = { ...candidate, snapshot: frame.snapshot };
			if (isRuntimeNumber(frame.offset)) candidate = { ...candidate, offset: frame.offset };
			if (frame.building === true) candidate = { ...candidate, building: true };
			if (frame.artifact === true) candidate = { ...candidate, artifact: true };
			pending.push(candidate);
		}
		return pending;
	} catch {
		return undefined;
	}
}

async function writeDiscoveryFrontier(root: string, pending: readonly DiscoveryFrame[]): Promise<void> {
	const cursor = path.join(root, DISCOVERY_CURSOR_FILE);
	const temporary = path.join(root, `.${DISCOVERY_CURSOR_FILE}.${randomUUID()}.tmp`);
	try {
		const serialized = `${JSON.stringify({ version: 3, pending })}\n`;
		if (Buffer.byteLength(serialized, "utf8") > MAX_DISCOVERY_CURSOR_BYTES) {
			throw new Error("Artifact discovery frontier exceeded its persistence bound.");
		}
		await fs.promises.writeFile(temporary, serialized, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await fs.promises.rename(temporary, cursor);
	} finally {
		await fs.promises.unlink(temporary).catch(() => undefined);
	}
}

function resolveDiscoveryFrame(root: string, frame: DiscoveryFrame): string | undefined {
	const candidate = path.resolve(root, frame.directory);
	const relative = path.relative(root, candidate);
	if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
	return candidate;
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
				const childFrames: DiscoveryFrame[] = [];
				for (const name of page.names) {
					const candidate = path.join(directory, name);
					if (!(await ownedDirectory(candidate))) continue;
					const relative = path.relative(root, candidate);
					if (!safeDiscoveryDirectory(relative)) continue;
					childFrames.push(
						name === ARTIFACT_DIRECTORY_NAME ? { directory: relative, artifact: true } : { directory: relative },
					);
				}
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

function eventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
