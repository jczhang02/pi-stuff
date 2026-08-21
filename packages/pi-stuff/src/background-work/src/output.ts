import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const OVERFLOW_MARKER = Buffer.from("\n[Pi Stuff stopped this task: output limit reached.]\n", "utf-8");

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
	const prefix = buffer.length > selected.length ? "…[earlier output omitted]\n" : "";
	return sanitizeTerminalText(`${prefix}${selected.toString("utf-8")}`).trimEnd();
}

export function sanitizeTerminalText(value: string): string {
	let text = "";
	let index = 0;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = value.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index = skipControlSequence(value, index + 2);
				continue;
			}
			if (isStringControl(introducer)) {
				index = skipControlString(value, index + 2);
				continue;
			}
			index += 1;
			while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) {
				index += 1;
			}
			if (index < value.length) index += 1;
			continue;
		}
		if (code === 0x9b) {
			index = skipControlSequence(value, index + 1);
			continue;
		}
		if (isC1StringControl(code)) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (code !== 0x09 && code !== 0x0a && code !== 0x0d && (code < 0x20 || (code >= 0x7f && code <= 0x9f))) {
			index += 1;
			continue;
		}
		const point = value.codePointAt(index);
		if (point === undefined) break;
		text += String.fromCodePoint(point);
		index += point > 0xffff ? 2 : 1;
	}
	return text;
}

function skipControlSequence(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index++);
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x07 || code === 0x9c) return index + 1;
		if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index += 1;
	}
	return index;
}

function isStringControl(code: number): boolean {
	return code === 0x5d || code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f;
}

function isC1StringControl(code: number): boolean {
	return code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f;
}

export class BoundedOutputFile {
	readonly path: string;
	private bytes = 0;
	private closed = false;
	private fd: number | undefined;
	private readonly closeFile: typeof closeSync;
	private readonly maxBytes: number;
	private overflow = false;
	private storageError: string | undefined;
	private tail = Buffer.alloc(0);
	private readonly writeFile: typeof writeSync;

	constructor(
		path: string,
		maxBytes = DEFAULT_ACTIVITY_OUTPUT_LIMIT,
		deps: { readonly closeSync?: typeof closeSync; readonly writeSync?: typeof writeSync } = {},
	) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes <= OVERFLOW_MARKER.length) {
			throw new Error("Background output limit is too small");
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
		return this.storageError === undefined;
	}

	/** Returns false once the hard cap has been reached. */
	append(chunk: Buffer): boolean {
		if (this.closed || this.overflow) return false;
		const contentLimit = this.maxBytes - OVERFLOW_MARKER.length;
		const remaining = Math.max(0, contentLimit - this.bytes);
		const accepted = chunk.subarray(0, remaining);
		if (accepted.length > 0) this.write(accepted);
		if (accepted.length === chunk.length) return true;
		this.overflow = true;
		this.write(OVERFLOW_MARKER);
		return false;
	}

	recentText(maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
		const selected = utf8SafeTail(this.tail, maxBytes);
		const prefix = this.bytes > selected.length ? "…[earlier output omitted]\n" : "";
		return sanitizeTerminalText(`${prefix}${selected.toString("utf-8")}`).trimEnd();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.closeStorage();
	}

	private write(chunk: Buffer): void {
		this.bytes += chunk.length;
		this.remember(chunk);
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
		this.tail = Buffer.from(joined.subarray(Math.max(0, joined.length - MEMORY_TAIL_LIMIT)));
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
		const prefix = size > bytes ? "…[earlier output omitted]\n" : "";
		return sanitizeTerminalText(`${prefix}${selected.toString("utf-8")}`).trimEnd();
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

export function readBoundedTail(path: string, maxBytes = DEFAULT_MODEL_OUTPUT_LIMIT): string {
	return tryReadBoundedTail(path, maxBytes) ?? "(no output yet)";
}
