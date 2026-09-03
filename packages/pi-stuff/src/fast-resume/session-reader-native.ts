import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionFileMeta } from "./scanner-native.js";
import {
	buildHeader,
	newAccumulator,
	processEntry,
	scanTailForSessionInfo,
	type TailSessionInfo,
} from "./session-parser.js";

const READ_CHUNK_SIZE = 16_384;
const MAX_FORWARD_READ_SIZE = 1024 * 1024;
const TAIL_READ_SIZE = 32_768;

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
	const chunk = Buffer.allocUnsafe(READ_CHUNK_SIZE);
	let lineBuffer = "";
	let offset = 0;
	let consumedBytes = 0;

	const flushLine = (line: string): boolean | undefined => {
		consumedBytes += Buffer.byteLength(line, "utf8") + 1;
		return onLine(line);
	};

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
			if (flushLine(line) === false) return { consumedBytes, reachedEof: false };
			start = newline + 1;
			newline = text.indexOf("\n", start);
		}
		lineBuffer += text.slice(start);
	}
	if (offset < size) return { consumedBytes, reachedEof: false };
	lineBuffer += decoder.end();
	if (lineBuffer.length > 0) {
		consumedBytes += Buffer.byteLength(lineBuffer, "utf8");
		onLine(lineBuffer);
	}
	return { consumedBytes, reachedEof: true };
}

export function loadSessionHeader(meta: SessionFileMeta): SessionInfo | null {
	let descriptor: number | undefined;
	try {
		descriptor = openSync(meta.path, "r");
		const accumulator = newAccumulator();
		const forward = forEachLineForward(descriptor, meta.size, (line) => {
			processEntry(accumulator, line);
			return meta.size <= MAX_FORWARD_READ_SIZE || !(accumulator.header && accumulator.foundFirstUser);
		});
		let tailInfo: TailSessionInfo | undefined;
		if (!forward.reachedEof) {
			const tailSize = Math.min(TAIL_READ_SIZE, meta.size - forward.consumedBytes);
			const tail = Buffer.allocUnsafe(tailSize);
			const bytesRead = readSync(descriptor, tail, 0, tailSize, meta.size - tailSize);
			tailInfo = scanTailForSessionInfo(tail, bytesRead);
		}
		return buildHeader(accumulator, meta.path, meta.mtimeMs, forward.reachedEof, tailInfo);
	} catch {
		return null;
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

export function loadSessionHeaders(metas: readonly SessionFileMeta[]): SessionInfo[] {
	return metas.flatMap((meta) => {
		const header = loadSessionHeader(meta);
		return header ? [header] : [];
	});
}
