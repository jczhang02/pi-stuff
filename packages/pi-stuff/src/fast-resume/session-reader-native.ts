import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionFileMeta } from "./scanner-native.js";
import {
	buildHeader,
	newAccumulator,
	processEntry,
	type SessionNameMetadata,
	scanSessionNameMetadata,
} from "./session-parser.js";

const READ_CHUNK_SIZE = 16_384;
const MAX_FORWARD_READ_SIZE = 1024 * 1024;
const SESSION_INFO_MARKER_TEXT = '"type":"session_info"';
const GREP_OUTPUT_LIMIT = 8 * 1024 * 1024;
const NO_SESSION_INFO: SessionNameMetadata = { found: false, name: undefined };

interface ForwardReadResult {
	readonly reachedEof: boolean;
}

function forEachLineForward(
	fd: number,
	size: number,
	onLine: (line: string) => boolean | undefined,
): ForwardReadResult {
	const decoder = new StringDecoder("utf8");
	const chunk = Buffer.allocUnsafe(READ_CHUNK_SIZE);
	let lineBuffer = "";
	let offset = 0;

	const forwardSize = Math.min(size, MAX_FORWARD_READ_SIZE);
	while (offset < forwardSize) {
		const bytesRead = readSync(fd, chunk, 0, Math.min(READ_CHUNK_SIZE, forwardSize - offset), offset);
		if (bytesRead <= 0) break;
		offset += bytesRead;
		const text = decoder.write(chunk.subarray(0, bytesRead));
		let start = 0;
		let newline = text.indexOf("\n");
		while (newline !== -1) {
			const line = lineBuffer + text.slice(start, newline);
			lineBuffer = "";
			if (onLine(line) === false) return { reachedEof: false };
			start = newline + 1;
			newline = text.indexOf("\n", start);
		}
		lineBuffer += text.slice(start);
	}
	if (offset < size) return { reachedEof: false };
	lineBuffer += decoder.end();
	if (lineBuffer.length > 0) onLine(lineBuffer);
	return { reachedEof: true };
}

function parseGrepSessionInfo(output: Buffer): Map<string, SessionNameMetadata> | undefined {
	const result = new Map<string, SessionNameMetadata>();
	let offset = 0;
	while (offset < output.length) {
		const separator = output.indexOf(0, offset);
		if (separator === -1) return undefined;
		const newline = output.indexOf(0x0a, separator + 1);
		const end = newline === -1 ? output.length : newline;
		const info = scanSessionNameMetadata(output.subarray(separator + 1, end));
		if (info.found) result.set(output.toString("utf8", offset, separator), info);
		offset = end + 1;
	}
	return result;
}

export function scanSessionInfoNames(metas: readonly SessionFileMeta[]): Map<string, SessionNameMetadata> {
	const oversized = metas.filter((meta) => meta.size > MAX_FORWARD_READ_SIZE);
	if (oversized.length === 0) return new Map();
	const result = spawnSync(
		"/usr/bin/grep",
		["-a", "-H", "-Z", "-F", SESSION_INFO_MARKER_TEXT, "--", ...oversized.map((meta) => meta.path)],
		{ env: { ...process.env, LC_ALL: "C" }, maxBuffer: GREP_OUTPUT_LIMIT },
	);
	if (result.error || (result.status !== 0 && result.status !== 1)) {
		throw new Error("Could not scan Session names.");
	}
	const parsed = parseGrepSessionInfo(result.stdout);
	if (!parsed) throw new Error("Could not parse Session names.");
	return parsed;
}

function loadSessionHeader(meta: SessionFileMeta, scannedInfo: SessionNameMetadata): SessionInfo | null {
	let descriptor: number | undefined;
	try {
		descriptor = openSync(meta.path, "r");
		const accumulator = newAccumulator();
		const forward = forEachLineForward(descriptor, meta.size, (line) => {
			processEntry(accumulator, line);
			return meta.size <= MAX_FORWARD_READ_SIZE || !(accumulator.header && accumulator.foundFirstUser);
		});
		return buildHeader(accumulator, meta.path, meta.mtimeMs, forward.reachedEof, scannedInfo);
	} catch {
		return null;
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

export function loadSessionHeaders(
	metas: readonly SessionFileMeta[],
	scannedNames: ReadonlyMap<string, SessionNameMetadata>,
): SessionInfo[] {
	return metas.flatMap((meta) => {
		const header = loadSessionHeader(meta, scannedNames.get(meta.path) ?? NO_SESSION_INFO);
		return header ? [header] : [];
	});
}
