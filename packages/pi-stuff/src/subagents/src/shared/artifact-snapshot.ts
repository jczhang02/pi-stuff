import { dlopen, FFIType, read } from "bun:ffi";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type JsonValue, parseJsonValue } from "../../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import { ARTIFACT_MAINTENANCE_INTERVAL_MS, hasErrorCode } from "./artifact-files.ts";

const SCAN_YIELD_INTERVAL = 32;
const SNAPSHOT_BUFFER_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_SNAPSHOT_RECORD_BYTES = 32 * 1024;
const SNAPSHOT_PARTIAL_SUFFIX = ".partial";
const SNAPSHOT_BUILD_STATE_SUFFIX = ".build.json";
const SNAPSHOT_OVERFLOW_SUFFIX = ".overflow.json";

export function ownedRegularFile(stat: fs.Stats): boolean {
	const currentUid = process.getuid?.();
	return stat.isFile() && !stat.isSymbolicLink() && (currentUid === undefined || stat.uid === currentUid);
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

export interface SnapshotAdvanceResult {
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

export function nameSnapshotControlNames(target: string): string[] {
	return [target, snapshotPartialPath(target), snapshotBuildStatePath(target), snapshotOverflowPath(target)];
}

export async function removeNameSnapshotControl(target: string): Promise<void> {
	for (const candidate of nameSnapshotControlNames(target)) await unlinkOwnedRegularFile(candidate);
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
			parsed["version"] !== 1 ||
			!isRuntimeString(parsed["cookie"]) ||
			!/^\d+$/u.test(parsed["cookie"]) ||
			!isRuntimeNumber(parsed["size"]) ||
			!Number.isSafeInteger(parsed["size"]) ||
			parsed["size"] < 0 ||
			parsed["size"] > MAX_SNAPSHOT_BYTES
		)
			return undefined;
		return { version: 1, cookie: parsed["cookie"], size: parsed["size"] };
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
			isRuntimeNumber(parsed["retryAt"]) &&
			Number.isFinite(parsed["retryAt"]) &&
			parsed["retryAt"] > now
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
			`${JSON.stringify({ version: 1, retryAt: now + ARTIFACT_MAINTENANCE_INTERVAL_MS })}\n`,
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

export async function advanceNameSnapshot(
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

export interface NameSnapshotPage {
	readonly names: string[];
	readonly records: number;
	readonly nextOffset: number;
	readonly complete: boolean;
}

export async function readNameSnapshotPage(filePath: string, offset: number, limit: number): Promise<NameSnapshotPage> {
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

export async function readSnapshotCursor(cursorPath: string, snapshot: string): Promise<number> {
	try {
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > 4_096) return 0;
		const value = parseJsonValue(await fs.promises.readFile(cursorPath, "utf8"));
		const identity = await cleanupSnapshotIdentity(snapshot);
		if (
			!isRuntimeObject(value) ||
			value === null ||
			Array.isArray(value) ||
			value["version"] !== 2 ||
			!sameCleanupSnapshotIdentity(value["snapshot"], identity)
		) {
			return 0;
		}
		if (
			!isRuntimeNumber(value["offset"]) ||
			!Number.isSafeInteger(value["offset"]) ||
			value["offset"] < 0 ||
			value["offset"] > identity.size
		)
			return 0;
		if (value["offset"] > 0) {
			const handle = await fs.promises.open(snapshot, "r");
			try {
				const boundary = Buffer.allocUnsafe(1);
				const { bytesRead } = await handle.read(boundary, 0, 1, value["offset"] - 1);
				if (bytesRead !== 1 || boundary[0] !== 0x0a) return 0;
			} finally {
				await handle.close();
			}
		}
		return value["offset"];
	} catch {
		return 0;
	}
}

export async function writeSnapshotCursor(cursor: string, snapshot: string, offset: number): Promise<void> {
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

function eventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
