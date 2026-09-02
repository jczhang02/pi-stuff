import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { SessionFileMeta, SessionHeader } from "./session.js";
import {
	buildHeader,
	newAccumulator,
	processEntry,
	scanTailForSessionInfo,
	type TailSessionInfo,
} from "./session-parser.js";

const READ_CHUNK_SIZE = 16_384;
const TAIL_READ_SIZE = 32_768;
const MAX_LINE_BYTES = 256 * 1024 * 1024;

interface ForwardReadResult {
	readonly consumedBytes: number;
	readonly reachedEof: boolean;
}

function forEachLineForward(
	fd: number,
	size: number,
	onLine: (line: string) => boolean | undefined,
): ForwardReadResult {
	const decoder = new StringDecoder("utf8");
	// #8 — allocUnsafe: readSync fully overwrites [0, bytesRead) before the
	// buffer is read (via decoder.write(subarray(0, bytesRead))), so the
	// zero-fill of Buffer.alloc is wasted work. Skips a 16 KB memset per file.
	const chunk = Buffer.allocUnsafe(READ_CHUNK_SIZE);
	let lineBuf = "";
	let offset = 0;
	let consumedBytes = 0;

	const flushLine = (line: string): boolean | undefined => {
		consumedBytes += Buffer.byteLength(line, "utf8") + 1; // +1 for \n
		return onLine(line);
	};

	while (offset < size) {
		const toRead = Math.min(READ_CHUNK_SIZE, size - offset);
		const bytesRead = readSync(fd, chunk, 0, toRead, offset);
		if (bytesRead <= 0) break;
		offset += bytesRead;

		const text = decoder.write(chunk.subarray(0, bytesRead));
		let start = 0;
		let newline = text.indexOf("\n", start);
		while (newline !== -1) {
			const line = lineBuf + text.slice(start, newline);
			lineBuf = "";
			if (flushLine(line) === false) {
				return { reachedEof: false, consumedBytes };
			}
			start = newline + 1;
			newline = text.indexOf("\n", start);
		}
		lineBuf += text.slice(start);

		// Defensive: bound memory for a single pathological line.
		if (lineBuf.length > MAX_LINE_BYTES) {
			lineBuf = "";
		}
	}
	// Flush decoder + any trailing line without a final newline.
	const tail = decoder.end();
	if (tail) lineBuf += tail;
	if (lineBuf.length > 0) {
		consumedBytes += Buffer.byteLength(lineBuf, "utf8"); // no trailing \n
		onLine(lineBuf);
	}
	return { reachedEof: true, consumedBytes };
}

// Forward-only load: reads complete lines from the start and stops at the
// first user message (which is all the title row needs). This reads exactly as
// many bytes as the first user message requires — a few KB for a normal
// session, ~19KB for a <skill> injection, more for a base64 image — and never
// truncates a line mid-JSON the way a fixed byte window would. So oversized
// first user messages (the cases that used to show "(no messages)") are parsed
// correctly.
//
// No tail read — the returned header's name reflects only session_info entries
// seen within the forward window. For sessions whose latest rename lives past
// the forward stop point (the common case for renamed large sessions), pair
// this with resolveSessionName() run in the background; the name then populates
// in-place without blocking the picker's initial render.
export function loadSessionHeaderForward(meta: SessionFileMeta): SessionHeader | null {
	let fd: number | undefined;
	try {
		fd = openSync(meta.path, "r");
		const acc = newAccumulator();
		const { reachedEof, consumedBytes } = forEachLineForward(fd, meta.size, (line) => {
			processEntry(acc, line);
			if (acc.header && acc.foundFirstUser) return false;
			return true;
		});
		const header = buildHeader(acc, meta.path, meta.mtimeMs, reachedEof);
		if (header) {
			// Carry forward-pass bookkeeping so the deferred rename-name resolver can
			// skip files whose forward pass reached EOF (name already final) and bound
			// its tail read below by the consumed bytes (never re-reads covered bytes).
			header._fwdReachedEof = reachedEof;
			header._fwdConsumedBytes = consumedBytes;
		}
		return header;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

// Resolve the latest session_info (the rename name) from a bounded tail at EOF,
// independent of any forward pass. Returns found:false when no session_info
// lives in the tail region (keep whatever name the forward pass produced);
// found:true means a session_info was seen — its name (or explicit clear)
// overrides the forward name (it is later in file order).
//
// This is the deferred half of loadSessionHeader, exposed so callers can show
// a row immediately with the forward name and resolve the rename name in the
// background. Reading up to TAIL_READ_SIZE bytes from EOF may overlap the
// forward region for small files. Pass `consumedBytesLowerBound` (the forward
// pass's consumedBytes) so the tail starts at/after the bytes the forward pass
// already parsed — avoiding a redundant re-read and re-parse of that range.
// When the bound equals the file size (the forward pass reached EOF) there are
// no bytes left to read and this returns found:false; callers that already
// know the forward pass reached EOF should skip the call entirely (see
// resolveSessionNamesDeferred).
export function resolveSessionName(
	meta: SessionFileMeta,
	options?: { consumedBytesLowerBound?: number },
): TailSessionInfo {
	if (meta.size <= 0) return { found: false, name: undefined };
	// Bound the tail below by the forward pass's consumed bytes so it never
	// re-reads bytes the forward pass already covered. Matches the combined
	// loadSessionHeader path's tail math: tailReadSize = min(TAIL, size - bound),
	// tailOffset = size - tailReadSize (>= bound).
	const lowerBound = Math.max(0, Math.min(options?.consumedBytesLowerBound ?? 0, meta.size));
	const tailReadSize = Math.min(TAIL_READ_SIZE, meta.size - lowerBound);
	if (tailReadSize <= 0) return { found: false, name: undefined };
	let fd: number | undefined;
	try {
		fd = openSync(meta.path, "r");
		// #8 — allocUnsafe: readSync overwrites [0, bytesRead) before use.
		const tailBuf = Buffer.allocUnsafe(tailReadSize);
		const tailOffset = meta.size - tailReadSize;
		const tailBytesRead = readSync(fd, tailBuf, 0, tailReadSize, tailOffset);
		return scanTailForSessionInfo(tailBuf, tailBytesRead);
	} catch {
		return { found: false, name: undefined };
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

// Resolve rename names for a batch of forward-loaded headers, the pure core of
// the picker's cooperative name-resolution drain. Skips headers whose forward
// pass reached EOF (their name is already final — no tail read needed) and
// bounds each remaining tail read below by the forward pass's consumed bytes
// (never re-reads already-covered bytes). Returns only paths whose tail found
// a session_info (name may be undefined for an explicit clear), for the caller
// to apply in-place. Exposed for direct testing and benchmarking.
export function resolveSessionNamesDeferred(
	headers: SessionHeader[],
	metaByPath: Map<string, SessionFileMeta>,
): Map<string, string | undefined> {
	const updates = new Map<string, string | undefined>();
	for (const h of headers) {
		if (h._fwdReachedEof) continue; // forward pass saw every session_info
		const meta = metaByPath.get(h.path);
		if (!meta) continue;
		const tail = resolveSessionName(
			meta,
			h._fwdConsumedBytes === undefined ? {} : { consumedBytesLowerBound: h._fwdConsumedBytes },
		);
		if (tail.found) updates.set(h.path, tail.name);
	}
	return updates;
}

// Load a session header using a streaming forward read plus a bounded tail read
// — forward + tail in one shared fd. Equivalent to loadSessionHeaderForward
// followed by resolveSessionName, but bounds the tail below by the forward stop
// offset so it never re-reads already-covered bytes. Use this when the full
// header (including rename name) is needed synchronously.
export function loadSessionHeader(meta: SessionFileMeta): SessionHeader | null {
	let fd: number | undefined;
	try {
		fd = openSync(meta.path, "r");
		const acc = newAccumulator();

		// Forward pass: read complete lines, stopping at the first user message.
		const { reachedEof: forwardReachedEof, consumedBytes } = forEachLineForward(fd, meta.size, (line) => {
			processEntry(acc, line);
			if (acc.header && acc.foundFirstUser) return false;
			return true;
		});

		// If the forward pass stopped before EOF, recover the latest session_info
		// from a bounded tail at EOF. Bounded below by consumedBytes so it never
		// re-parses already-seen entries; the tail wins over the forward name
		// (later in file order). A failure here falls back to the forward name.
		let tailInfo: TailSessionInfo | undefined;
		if (!forwardReachedEof) {
			try {
				const tailReadSize = Math.min(TAIL_READ_SIZE, meta.size - consumedBytes);
				// #8 — allocUnsafe: readSync overwrites [0, bytesRead) before use.
				const tailBuf = Buffer.allocUnsafe(tailReadSize);
				const tailOffset = meta.size - tailReadSize;
				const tailBytesRead = readSync(fd, tailBuf, 0, tailReadSize, tailOffset);
				tailInfo = scanTailForSessionInfo(tailBuf, tailBytesRead);
			} catch {
				// Tail read failed — fall back to forward-only name
			}
		}

		return buildHeader(acc, meta.path, meta.mtimeMs, forwardReachedEof, tailInfo);
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function loadSessionHeaders(metas: SessionFileMeta[]): SessionHeader[] {
	const results: SessionHeader[] = [];
	for (const meta of metas) {
		const header = loadSessionHeader(meta);
		if (header) results.push(header);
	}
	return results;
}

// Forward-only batch load — see loadSessionHeaderForward. Use for the picker's
// immediate display path: rows appear instantly with the correct firstMessage,
// and rename names resolve in the background via resolveSessionName().
export function loadSessionHeadersForward(metas: SessionFileMeta[]): SessionHeader[] {
	const results: SessionHeader[] = [];
	for (const meta of metas) {
		const header = loadSessionHeaderForward(meta);
		if (header) results.push(header);
	}
	return results;
}
