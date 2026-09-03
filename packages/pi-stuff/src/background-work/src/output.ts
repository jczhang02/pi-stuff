import { closeSync, ftruncateSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalWhitespace as sanitizeTerminalText } from "../../shared/terminal-text.js";

export { sanitizeTerminalText };

const DEFAULT_ACTIVITY_OUTPUT_LIMIT = 20 * 1024 * 1024;
export const DEFAULT_MODEL_OUTPUT_LIMIT = 50 * 1024;
const MEMORY_TAIL_LIMIT = 64 * 1024;
const MIN_ROLLING_OUTPUT_LIMIT = 64;
const ROLLING_OMISSION_PREFIX = "…[";
const ROLLING_OMISSION_SUFFIX = " earlier output bytes omitted]\n";

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

function rollingOmissionMarker(omittedBytes: number): Buffer {
	return Buffer.from(`${ROLLING_OMISSION_PREFIX}${String(omittedBytes)}${ROLLING_OMISSION_SUFFIX}`, "utf-8");
}

function parseRollingOmissionMarker(buffer: Buffer): { bytes: number; length: number } | undefined {
	const newline = buffer.indexOf(0x0a);
	if (newline < 0) return undefined;
	const line = buffer.subarray(0, newline + 1).toString("utf-8");
	if (!line.startsWith(ROLLING_OMISSION_PREFIX) || !line.endsWith(ROLLING_OMISSION_SUFFIX)) return undefined;
	const raw = line.slice(ROLLING_OMISSION_PREFIX.length, -ROLLING_OMISSION_SUFFIX.length);
	if (!/^\d+$/u.test(raw)) return undefined;
	const bytes = Number(raw);
	return Number.isSafeInteger(bytes) ? { bytes, length: Buffer.byteLength(line, "utf-8") } : undefined;
}

export class BoundedOutputFile {
	readonly path: string;
	private bytes = 0;
	private closed = false;
	private fd: number | undefined;
	private readonly closeFile: typeof closeSync;
	private readonly maxBytes: number;
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
			const snapshot = this.rollingSnapshot();
			this.truncateFile(this.fd, 0);
			this.writeAll(snapshot, 0);
			this.bytes = snapshot.length;
		} catch (error) {
			this.degradeStorage(error);
		}
	}

	private rollingSnapshot(): Buffer {
		let selected = utf8SafeTail(this.tail, this.maxBytes);
		for (;;) {
			const omittedBytes = this.omittedTailBytes + this.tail.length - selected.length;
			const marker = rollingOmissionMarker(omittedBytes);
			const next = utf8SafeTail(this.tail, this.maxBytes - marker.length);
			if (next.length === selected.length) return Buffer.concat([marker, selected]);
			selected = next;
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
		this.fd = undefined;
		if (fd === undefined) return;
		try {
			this.closeFile(fd);
		} catch (error) {
			this.degradeStorage(error);
		}
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
		const markerBuffer = Buffer.alloc(Math.min(size, 128));
		readSync(fd, markerBuffer, 0, markerBuffer.length, 0);
		const marker = parseRollingOmissionMarker(markerBuffer);
		if (!marker) return formatTextTail(selected, size - selected.length);
		const selectedPosition = size - selected.length;
		const retainedBytesOmitted = Math.max(0, selectedPosition - marker.length);
		const payload = selected.subarray(Math.max(0, marker.length - selectedPosition));
		return formatTextTail(payload, marker.bytes + retainedBytesOmitted);
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
	const marker = parseRollingOmissionMarker(file.subarray(0, 128));
	const raw = file.subarray(marker?.length ?? 0).toString("utf8");
	const truncation = truncateTail(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	const retainedBytesOmitted = truncation.truncated ? Buffer.byteLength(raw, "utf8") - truncation.outputBytes : 0;
	const prefix = marker ? visibleOmissionMarker(marker.bytes + retainedBytesOmitted) : "";
	if (!truncation.truncated) return { text: `${prefix}${truncation.content}` };
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	const outputLabel = marker ? "Retained output" : "Full output";
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
