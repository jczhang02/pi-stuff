import { dlopen, FFIType, read } from "bun:ffi";
import * as fs from "node:fs";

const SCAN_YIELD_INTERVAL = 32;

export interface DirectoryScanCursor {
	readonly cookie: string;
	readonly dev: number;
	readonly ino: number;
}

export interface DirectoryScanResult {
	readonly complete: boolean;
	readonly cursor?: DirectoryScanCursor;
	readonly scanned: number;
}

export function ownedRegularFile(stat: fs.Stats): boolean {
	const currentUid = process.getuid?.();
	return stat.isFile() && !stat.isSymbolicLink() && (currentUid === undefined || stat.uid === currentUid);
}

function safeName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= 4_096 &&
		name !== "." &&
		name !== ".." &&
		!name.includes("/") &&
		!name.includes("\\") &&
		!name.includes("\0")
	);
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

type LinuxDirectoryLibrary = ReturnType<typeof loadLinuxDirectoryLibrary>;
type DirectoryEntryPointer = NonNullable<ReturnType<LinuxDirectoryLibrary["symbols"]["readdir"]>>;
let linuxDirectoryLibrary: LinuxDirectoryLibrary | undefined;

function entryName(entry: DirectoryEntryPointer): string {
	const recordLength = read.u16(entry, 16);
	if (recordLength < 20 || recordLength > 4_096) {
		throw new Error("Invalid Linux directory record while scanning Agent artifacts.");
	}
	const bytes: number[] = [];
	for (let offset = 19; offset < recordLength; offset += 1) {
		const byte = read.u8(entry, offset);
		if (byte === 0) break;
		bytes.push(byte);
	}
	return Buffer.from(bytes).toString("utf8");
}

/**
 * Visit at most `limit` directory entries and return the native cookie needed
 * for the next pass. Callers persist the cookie only after their work succeeds,
 * so a crash repeats an idempotent slice instead of losing it.
 */
export async function scanDirectoryNames(
	directory: string,
	cursor: DirectoryScanCursor | undefined,
	limit: number,
	visit: (name: string, type: number) => boolean | undefined | Promise<boolean | undefined>,
): Promise<DirectoryScanResult> {
	if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
		throw new Error("Artifact maintenance requires the certified Linux Host profile.");
	}
	const stat = await fs.promises.lstat(directory);
	const currentUid = process.getuid?.();
	if (!stat.isDirectory() || stat.isSymbolicLink() || (currentUid !== undefined && stat.uid !== currentUid)) {
		throw new Error("Invalid Agent artifact scan directory.");
	}
	linuxDirectoryLibrary ??= loadLinuxDirectoryLibrary();
	const symbols = linuxDirectoryLibrary.symbols;
	const pointer = symbols.opendir(Buffer.from(`${directory}\0`));
	if (!pointer) throw new Error(`Unable to open Agent artifact directory '${directory}'.`);
	const resumes =
		cursor !== undefined && cursor.dev === stat.dev && cursor.ino === stat.ino && /^\d+$/u.test(cursor.cookie);
	let cookie = resumes ? BigInt(cursor.cookie) : 0n;
	let scanned = 0;
	let complete = false;
	let stopped = false;
	try {
		if (cookie > 0n) symbols.seekdir(pointer, cookie);
		while (scanned < limit) {
			const entry = symbols.readdir(pointer);
			if (!entry) {
				complete = true;
				break;
			}
			const name = entryName(entry);
			cookie = symbols.telldir(pointer);
			if (name === "." || name === "..") continue;
			scanned += 1;
			if (scanned % SCAN_YIELD_INTERVAL === 0) await new Promise<void>((resolve) => setImmediate(resolve));
			if (safeName(name) && (await visit(name, read.u8(entry, 18))) === false) {
				stopped = true;
				break;
			}
		}
		if (!complete && !stopped && scanned >= limit && !symbols.readdir(pointer)) complete = true;
	} finally {
		symbols.closedir(pointer);
	}
	return complete
		? { complete: true, scanned }
		: { complete: false, cursor: { cookie: String(cookie), dev: stat.dev, ino: stat.ino }, scanned };
}
