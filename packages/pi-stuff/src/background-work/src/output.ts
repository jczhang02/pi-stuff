import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalWhitespace as sanitizeTerminalText } from "../../shared/terminal-text.js";

export { sanitizeTerminalText };

const DEFAULT_ACTIVITY_OUTPUT_LIMIT = 20 * 1024 * 1024;
export const DEFAULT_MODEL_OUTPUT_LIMIT = 50 * 1024;
const MEMORY_TAIL_LIMIT = 64 * 1024;

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

function formatTextTail(selected: Buffer, omittedBytes: number): string {
	const prefix = omittedBytes > 0 ? `…[${formatSize(omittedBytes)} earlier output bytes omitted]\n` : "";
	return sanitizeTerminalText(`${prefix}${selected.toString("utf-8")}`).trimEnd();
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
	private readonly writeFile: typeof writeSync;

	constructor(
		path: string,
		maxBytes = DEFAULT_ACTIVITY_OUTPUT_LIMIT,
		deps: { readonly closeSync?: typeof closeSync; readonly writeSync?: typeof writeSync } = {},
	) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
			throw new Error("Background output retention must be a positive safe integer");
		}
		this.path = path;
		this.maxBytes = maxBytes;
		this.closeFile = deps.closeSync ?? closeSync;
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
		return !this.overflow && this.storageError === undefined;
	}

	append(chunk: Buffer): boolean {
		if (this.closed) return false;
		this.remember(chunk);
		if (this.overflow || this.fd === undefined) return true;
		const remaining = Math.max(0, this.maxBytes - this.bytes);
		const accepted = chunk.subarray(0, remaining);
		if (accepted.length > 0) this.write(accepted);
		if (accepted.length === chunk.length) return true;
		this.overflow = true;
		this.closeStorage();
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
		this.bytes += chunk.length;
		if (this.fd === undefined) return;
		try {
			let offset = 0;
			while (offset < chunk.length) {
				const written = this.writeFile(this.fd, chunk, offset, chunk.length - offset);
				if (written <= 0) throw new Error("Background output write made no progress");
				offset += written;
			}
		} catch (error) {
			this.degradeStorage(error);
		}
	}

	private remember(chunk: Buffer): void {
		const joined = Buffer.concat([this.tail, chunk]);
		const start = Math.max(0, joined.length - MEMORY_TAIL_LIMIT);
		this.omittedTailBytes += start;
		this.tail = Buffer.from(joined.subarray(start));
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
		readSync(fd, buffer, 0, bytes, Math.max(0, size - bytes));
		const selected = utf8SafeTail(buffer, bytes);
		return formatTextTail(selected, size - selected.length);
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
	let raw: string;
	try {
		raw = readFileSync(outputPath, "utf8");
	} catch {
		return { text: recentOutput ?? "" };
	}
	const truncation = truncateTail(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	if (!truncation.truncated) return { text: truncation.content };
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	let footer: string;
	if (truncation.lastLinePartial) {
		footer = `Showing last ${formatSize(truncation.outputBytes)} of line ${String(endLine)}. Full output: ${outputPath}`;
	} else if (truncation.truncatedBy === "lines") {
		footer = `Showing lines ${String(startLine)}-${String(endLine)} of ${String(truncation.totalLines)}. Full output: ${outputPath}`;
	} else {
		footer = `Showing lines ${String(startLine)}-${String(endLine)} of ${String(truncation.totalLines)} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${outputPath}`;
	}
	return {
		details: { fullOutputPath: outputPath, truncation },
		text: `${truncation.content}\n\n[${footer}]`,
	};
}
