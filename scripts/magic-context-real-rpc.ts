import {
	isJsonInputObject,
	type JsonInputObject,
	type JsonInputValue,
	parseJsonValue,
} from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeBoolean, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { terminateDetachedProcessGroup } from "./detached-process.js";

const TURN_TIMEOUT_MS = 10 * 60_000;

export interface RpcRecord extends JsonInputObject {
	readonly command?: string;
	readonly data?: JsonInputValue;
	readonly id?: string;
	readonly success?: boolean;
	readonly type?: string;
}

export interface RpcTransport {
	readonly records: RpcRecord[];
	readonly stderr: () => string;
	promptAndWait(message: string, timeoutMs?: number): Promise<RpcRecord[]>;
	send(command: JsonInputObject, timeoutMs?: number): Promise<RpcRecord>;
	stop(): Promise<void>;
	waitFor(
		predicate: (record: RpcRecord) => boolean,
		options?: { readonly from?: number; readonly timeoutMs?: number },
	): Promise<RpcRecord>;
}

interface PendingRequest {
	reject(error: Error): void;
	resolve(record: RpcRecord): void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface RpcWaiter extends PendingRequest {
	readonly from: number;
	readonly predicate: (record: RpcRecord) => boolean;
}

interface ReaderState {
	error?: Error;
}

function fail(message: string): never {
	throw new Error(`Magic Context real-provider acceptance failed: ${message}`);
}

export function parseRpcRecord(line: string): RpcRecord {
	const value = parseJsonValue(line);
	if (
		!isJsonInputObject(value) ||
		["command", "id", "type"].some((key) => value[key] !== undefined && !isRuntimeString(value[key])) ||
		(value["success"] !== undefined && !isRuntimeBoolean(value["success"]))
	) {
		throw new Error(`Invalid Pi RPC record: ${line}`);
	}
	return value;
}

function consumeLine(
	line: string,
	records: RpcRecord[],
	pending: Map<string, PendingRequest>,
	waiters: Set<RpcWaiter>,
): void {
	if (!line) return;
	const record = parseRpcRecord(line);
	records.push(record);
	const request = record.id && record.type === "response" ? pending.get(record.id) : undefined;
	if (request && record.id) {
		pending.delete(record.id);
		clearTimeout(request.timeout);
		request.resolve(record);
	}
	for (const waiter of waiters) {
		if (records.length - 1 < waiter.from || !waiter.predicate(record)) continue;
		waiters.delete(waiter);
		clearTimeout(waiter.timeout);
		waiter.resolve(record);
	}
}

function rejectReaders(error: Error, pending: Map<string, PendingRequest>, waiters: Set<RpcWaiter>): void {
	for (const request of [...pending.values(), ...waiters]) {
		clearTimeout(request.timeout);
		request.reject(error);
	}
	pending.clear();
	waiters.clear();
}

async function readRpcOutput(
	stdout: ReadableStream<Uint8Array>,
	records: RpcRecord[],
	pending: Map<string, PendingRequest>,
	waiters: Set<RpcWaiter>,
	state: ReaderState,
): Promise<void> {
	const reader = stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			while (buffer.includes("\n")) {
				const newline = buffer.indexOf("\n");
				consumeLine(buffer.slice(0, newline).replace(/\r$/u, ""), records, pending, waiters);
				buffer = buffer.slice(newline + 1);
			}
			if (!done) continue;
			consumeLine(buffer.replace(/\r$/u, ""), records, pending, waiters);
			return;
		}
	} catch (cause) {
		state.error = cause instanceof Error ? cause : new Error(String(cause));
		rejectReaders(state.error, pending, waiters);
	}
}

export async function createRpcTransport(
	commandLine: readonly string[],
	cwd: string,
	environment: Record<string, string | undefined>,
): Promise<RpcTransport> {
	const child = Bun.spawn([...commandLine], {
		cwd,
		detached: true,
		env: environment,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const records: RpcRecord[] = [];
	const pending = new Map<string, PendingRequest>();
	const waiters = new Set<RpcWaiter>();
	const readerState: ReaderState = {};
	let sequence = 0;
	let stderr = "";
	const stderrReading = new Response(child.stderr).text().then((value) => (stderr = value));
	const reading = readRpcOutput(child.stdout, records, pending, waiters, readerState);

	await Bun.sleep(150);
	if (child.exitCode !== null) {
		await stderrReading;
		fail(`Pi exited during RPC startup: ${stderr.trim() || String(child.exitCode)}`);
	}

	const waitFor: RpcTransport["waitFor"] = async (predicate, options = {}) => {
		const from = options.from ?? 0;
		const existing = records.slice(from).find(predicate);
		if (existing) return existing;
		const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
		return new Promise<RpcRecord>((resolve, reject) => {
			const waiter: RpcWaiter = {
				from,
				predicate,
				reject,
				resolve,
				timeout: setTimeout(() => {
					waiters.delete(waiter);
					reject(new Error(`Timed out waiting for Pi RPC event after ${String(timeoutMs)}ms`));
				}, timeoutMs),
			};
			waiters.add(waiter);
		});
	};

	const send: RpcTransport["send"] = async (command, timeoutMs = 60_000) => {
		if (readerState.error) throw readerState.error;
		if (child.exitCode !== null) fail(`Pi RPC process exited ${String(child.exitCode)}: ${stderr.trim()}`);
		const id = `magic-real-rpc-${String(++sequence)}`;
		const response = new Promise<RpcRecord>((resolve, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Pi RPC request timed out: ${JSON.stringify(command)}`));
			}, timeoutMs);
			pending.set(id, { reject, resolve, timeout });
		});
		child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		await child.stdin.flush();
		const record = await response;
		if (record.success !== true) fail(`Pi RPC request failed: ${JSON.stringify(record)}`);
		return record;
	};

	return {
		records,
		stderr: () => stderr,
		async promptAndWait(message, timeoutMs = TURN_TIMEOUT_MS) {
			const from = records.length;
			await send({ message, type: "prompt" });
			await waitFor((record) => record.type === "agent_settled", { from, timeoutMs });
			return records.slice(from);
		},
		send,
		async stop() {
			await terminateDetachedProcessGroup(child, 10_000);
			await reading;
			await stderrReading;
		},
		waitFor,
	};
}
