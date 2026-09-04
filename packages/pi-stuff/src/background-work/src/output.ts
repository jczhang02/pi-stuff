import {
	closeSync,
	ftruncateSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalWhitespace as sanitizeTerminalText } from "../../shared/terminal-text.js";

export { sanitizeTerminalText };

const DEFAULT_ACTIVITY_OUTPUT_LIMIT = 20 * 1024 * 1024;
export const DEFAULT_MODEL_OUTPUT_LIMIT = 50 * 1024;
const MEMORY_TAIL_LIMIT = 64 * 1024;
const MIN_ROLLING_OUTPUT_LIMIT = 64;
const OMISSION_METADATA_SUFFIX = ".omitted-bytes";

function completeUtf8End(buffer: Buffer): number {
	let end = buffer.length;
	while (end > 0) {
		let start = end - 1;
		while (start > 0 && ((buffer[start] ?? 0) & 0xc0) === 0x80) start -= 1;
		const lead = buffer[start] ?? 0;
		const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : 1;
		if (end - start >= width) return end;
		end = start;
	}
	return 0;
}

export function utf8SafeTail(buffer: Buffer, maxBytes: number): Buffer {
	let start = Math.max(0, buffer.length - Math.max(1, maxBytes));
	while (start < buffer.length && ((buffer[start] ?? 0) & 0xc0) === 0x80) start += 1;
	return buffer.subarray(start, completeUtf8End(buffer));
}

export function utf8SafePrefix(buffer: Buffer): Buffer {
	return buffer.subarray(0, completeUtf8End(buffer));
}

export function boundedTextTail(value: string, maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
	const buffer = Buffer.from(value, "utf-8");
	const selected = utf8SafeTail(buffer, maxBytes);
	return formatTextTail(selected, buffer.length - selected.length);
}

function visibleOmissionMarker(omittedBytes: number): string {
	return omittedBytes > 0 ? `…[${formatSize(omittedBytes)} earlier output bytes omitted]\n` : "";
}

function formatTextTail(selected: Buffer, omittedBytes: number): string {
	return sanitizeTerminalText(`${visibleOmissionMarker(omittedBytes)}${selected.toString("utf-8")}`).trimEnd();
}

function omissionMetadataPath(path: string): string {
	return `${path}${OMISSION_METADATA_SUFFIX}`;
}

function readOmittedBytes(path: string): number | undefined {
	try {
		const raw = readFileSync(omissionMetadataPath(path), "utf8");
		if (!/^\d+$/u.test(raw)) return undefined;
		const bytes = Number(raw);
		return Number.isSafeInteger(bytes) ? bytes : undefined;
	} catch {
		return undefined;
	}
}

export class BoundedOutputFile {
	readonly path: string;
	private bytes = 0;
	private closed = false;
	private fd: number | undefined;
	private readonly closeFile: typeof closeSync;
	private readonly maxBytes: number;
	private metadataFd: number | undefined;
	private omittedTailBytes = 0;
	private overflow = false;
	private storageError: string | undefined;
	private tail = Buffer.alloc(0);
	private readonly truncateFile: typeof ftruncateSync;
	private readonly writeFile: typeof writeSync;

	constructor(
		path: string,
		maxBytes = DEFAULT_ACTIVITY_OUTPUT_LIMIT,
		deps: {
			readonly closeSync?: typeof closeSync;
			readonly ftruncateSync?: typeof ftruncateSync;
			readonly writeSync?: typeof writeSync;
		} = {},
	) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_ROLLING_OUTPUT_LIMIT) {
			throw new Error(
				`Background output retention must be a safe integer of at least ${String(MIN_ROLLING_OUTPUT_LIMIT)} bytes`,
			);
		}
		this.path = path;
		this.maxBytes = maxBytes;
		this.closeFile = deps.closeSync ?? closeSync;
		this.truncateFile = deps.ftruncateSync ?? ftruncateSync;
		this.writeFile = deps.writeSync ?? writeSync;
		mkdirSync(dirname(path), { mode: 0o700, recursive: true });
		this.fd = openSync(path, "wx", 0o600);
		try {
			this.metadataFd = openSync(omissionMetadataPath(path), "wx", 0o600);
			this.writeOmittedBytes(0);
		} catch (error) {
			if (this.metadataFd !== undefined) closeSync(this.metadataFd);
			closeSync(this.fd);
			rmSync(path, { force: true });
			rmSync(omissionMetadataPath(path), { force: true });
			throw error;
		}
	}

	get bytesWritten(): number {
		return this.bytes;
	}

	get overflowed(): boolean {
		return this.overflow;
	}

	get durable(): boolean {
		return this.storageError === undefined;
	}

	append(chunk: Buffer): boolean {
		if (this.closed) return false;
		this.remember(chunk);
		if (this.fd === undefined) return true;
		if (this.bytes + chunk.length <= this.maxBytes) {
			this.write(chunk);
			return true;
		}
		this.overflow = true;
		this.rewriteWithTail();
		return true;
	}

	recentText(maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
		const selected = utf8SafeTail(this.tail, maxBytes);
		return formatTextTail(selected, this.omittedTailBytes + this.tail.length - selected.length);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.closeStorage();
	}

	remove(): void {
		this.close();
		rmSync(this.path, { force: true });
		rmSync(omissionMetadataPath(this.path), { force: true });
	}

	private write(chunk: Buffer): void {
		if (this.fd === undefined) return;
		try {
			this.writeAll(chunk, this.bytes);
			this.bytes += chunk.length;
		} catch (error) {
			this.degradeStorage(error);
		}
	}

	private writeAll(chunk: Buffer, position: number): void {
		if (this.fd === undefined) return;
		let offset = 0;
		while (offset < chunk.length) {
			const written = this.writeFile(this.fd, chunk, offset, chunk.length - offset, position + offset);
			if (written <= 0) throw new Error("Background output write made no progress");
			offset += written;
		}
	}

	private remember(chunk: Buffer): void {
		const joined = Buffer.concat([this.tail, chunk]);
		const start = Math.max(0, joined.length - MEMORY_TAIL_LIMIT);
		this.omittedTailBytes += start;
		this.tail = Buffer.from(joined.subarray(start));
	}

	private rewriteWithTail(): void {
		if (this.fd === undefined) return;
		try {
			const selected = utf8SafeTail(this.tail, this.maxBytes);
			const omittedBytes = this.omittedTailBytes + this.tail.length - selected.length;
			this.truncateFile(this.fd, 0);
			this.writeAll(selected, 0);
			this.writeOmittedBytes(omittedBytes);
			this.bytes = selected.length;
		} catch (error) {
			this.degradeStorage(error);
		}
	}

	private writeOmittedBytes(bytes: number): void {
		if (this.metadataFd === undefined) throw new Error("Background output metadata is unavailable");
		ftruncateSync(this.metadataFd, 0);
		const value = Buffer.from(String(bytes), "utf8");
		let offset = 0;
		while (offset < value.length) {
			const written = writeSync(this.metadataFd, value, offset, value.length - offset, offset);
			if (written <= 0) throw new Error("Background output metadata write made no progress");
			offset += written;
		}
	}

	private degradeStorage(cause: unknown): void {
		if (this.storageError !== undefined) return;
		this.storageError = cause instanceof Error ? cause.message : String(cause);
		this.remember(Buffer.from(`\n[Background output storage failed: ${this.storageError}]\n`, "utf-8"));
		this.closeStorage();
	}

	private closeStorage(): void {
		const fd = this.fd;
		const metadataFd = this.metadataFd;
		this.fd = undefined;
		this.metadataFd = undefined;
		let failure: unknown;
		try {
			if (fd !== undefined) this.closeFile(fd);
		} catch (error) {
			failure = error;
		}
		try {
			if (metadataFd !== undefined) closeSync(metadataFd);
		} catch (error) {
			failure ??= error;
		}
		if (failure !== undefined) this.degradeStorage(failure);
	}
}

export function tryReadBoundedTail(path: string, maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const size = statSync(path).size;
		const bytes = Math.min(size, Math.max(1, maxBytes));
		const buffer = Buffer.alloc(bytes);
		const position = Math.max(0, size - bytes);
		readSync(fd, buffer, 0, bytes, position);
		const selected = utf8SafeTail(buffer, bytes);
		const retainedBytesOmitted = size - selected.length;
		return formatTextTail(selected, (readOmittedBytes(path) ?? 0) + retainedBytesOmitted);
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// Reading output is an observation path. A failed close must not make
				// Background Work or its UI fail after the useful tail was read.
			}
		}
	}
}

export function foregroundOutputSnapshot(outputPath: string | undefined, recentOutput: string | undefined) {
	if (!outputPath) return { text: recentOutput ?? "" };
	let file: Buffer;
	try {
		file = readFileSync(outputPath);
	} catch {
		return { text: recentOutput ?? "" };
	}
	const raw = file.toString("utf8");
	const truncation = truncateTail(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	const retainedBytesOmitted = truncation.truncated ? Buffer.byteLength(raw, "utf8") - truncation.outputBytes : 0;
	const rolledBytesOmitted = readOmittedBytes(outputPath) ?? 0;
	const prefix = rolledBytesOmitted > 0 ? visibleOmissionMarker(rolledBytesOmitted + retainedBytesOmitted) : "";
	if (!truncation.truncated) return { text: `${prefix}${truncation.content}` };
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	const outputLabel = rolledBytesOmitted > 0 ? "Retained output" : "Full output";
	let footer: string;
	if (truncation.lastLinePartial) {
		footer = `Showing last ${formatSize(truncation.outputBytes)} of line ${String(endLine)}. ${outputLabel}: ${outputPath}`;
	} else if (truncation.truncatedBy === "lines") {
		footer = `Showing lines ${String(startLine)}-${String(endLine)} of ${String(truncation.totalLines)}. ${outputLabel}: ${outputPath}`;
	} else {
		footer = `Showing lines ${String(startLine)}-${String(endLine)} of ${String(truncation.totalLines)} (${formatSize(DEFAULT_MAX_BYTES)} limit). ${outputLabel}: ${outputPath}`;
	}
	return {
		details: { fullOutputPath: outputPath, truncation },
		text: `${prefix}${truncation.content}\n\n[${footer}]`,
	};
}
