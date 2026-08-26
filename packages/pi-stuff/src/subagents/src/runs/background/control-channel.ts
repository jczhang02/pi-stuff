/**
 * Cross-OS control channel for async subagent runs.
 *
 * Background runs are detached OS processes. The original control path delivered
 * an interrupt with `process.kill(pid, SIGUSR2|SIGBREAK)`, but Windows cannot
 * deliver those signals cross-process via `process.kill` and throws `ENOSYS`,
 * which left async runs uninterruptible (no stop, no live steer) on Windows.
 *
 * This module adds a portable, file-based control inbox inside the run directory.
 * The parent drops an interrupt request file; the runner watches the inbox and
 * routes the request into its existing graceful `interruptRunner()` (pause +
 * resumable), identically on every platform. The OS signal is kept only as an
 * opportunistic fast-path; its failure is non-fatal because the file inbox is
 * authoritative.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentWorkOrigin } from "../../../../conversation-ui/agent-run-origin.js";
import { type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import {
	assertPrivateDirectory,
	ensurePrivateDirectory,
	ensurePrivateDirectoryWithin,
	type OwnedFileSnapshot,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshot,
	removeOwnedFileSnapshot,
} from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import { POLL_INTERVAL_MS } from "../../shared/types.ts";
import { resolveWatchPath } from "../../shared/utils.ts";
import { MAX_BACKGROUND_TASKS } from "../shared/parallel-utils.ts";

/**
 * Opportunistic fast-path interrupt signal. On Unix `SIGUSR2` is trapped by the
 * runner; on Windows `process.kill(pid, "SIGBREAK")` is not deliverable
 * cross-process and throws `ENOSYS`, so the file inbox below is the real channel.
 */
export const INTERRUPT_SIGNAL: NodeJS.Signals = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";
const MAX_CONTROL_RECORD_BYTES = 64 * 1024;
const CONTROL_INFLIGHT_SEPARATOR = ".pi-stuff-inflight.";
const activeControlConsumers = new Set<string>();

export type ControlChannelFs = Pick<
	typeof fs,
	"mkdirSync" | "existsSync" | "rmSync" | "watch" | "readdirSync" | "readFileSync" | "realpathSync"
>;
export type ControlChannelTimers = { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
type KillFn = (pid: number, signal?: NodeJS.Signals | 0) => boolean;

export interface InterruptRequest {
	type: "interrupt";
	ts?: number;
	source?: string;
	reason?: string;
}

export interface TimeoutRequest {
	type: "timeout";
	ts?: number;
	source?: string;
	reason?: string;
}

export interface StopRequest {
	type: "stop";
	id?: string;
	ts?: number;
	source?: string;
	reason?: string;
	targetIndex?: number;
}

export interface SteerRequest {
	type: "steer";
	id: string;
	ts: number;
	message: string;
	/** Monotonic user takeover attribution for the owning background run. */
	parentRunOrigin?: AgentWorkOrigin;
	targetIndex?: number;
	targetIndexes?: number[];
	source?: string;
}

export interface SteerCapability {
	type: "steer-capability";
	protocolVersion: 1;
	index: number;
	pid: number;
	readyAt: number;
	supported: boolean;
}

export interface SteerAck {
	type: "steer-ack";
	protocolVersion: 1;
	requestId: string;
	index: number;
	ts: number;
	state: "delivered" | "failed";
	message: string;
}

const STEER_REQUESTS_DIR = "steer-requests";
const STOP_REQUESTS_DIR = "stop-requests";
const STEER_TARGETS_DIR = "steer-targets";
const STEER_CAPABILITIES_DIR = "steer-capabilities";
const STEER_ACKS_DIR = "steer-acks";
const STEER_INBOX_CLOSED_FILE = "steer-inbox-closed.json";
const MAX_STEER_MESSAGE_BYTES = 128 * 1024;
const MAX_STEER_REQUEST_ID_LENGTH = 256;

/** Control inbox directory inside an async run dir. */
export function controlInboxDir(asyncDir: string): string {
	return path.join(asyncDir, "control");
}

/** Path of the portable interrupt request file. */
export function interruptRequestPath(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), "interrupt.json");
}

/** Path of the portable timeout request file. */
export function timeoutRequestPath(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), "timeout.json");
}

/** Path of the portable manual stop request file. */
export function stopRequestPath(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), "stop.json");
}

/** Directory of queued manual stop requests. `stop.json` remains read-only legacy compatibility. */
export function stopRequestsDir(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), STOP_REQUESTS_DIR);
}

/** Directory of parent-to-runner steering requests. */
export function steerRequestsDir(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), STEER_REQUESTS_DIR);
}

export function steerInboxClosedPath(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), STEER_INBOX_CLOSED_FILE);
}

export function closeSteerInbox(asyncDir: string, state: string): void {
	prepareControlDirectory(asyncDir, controlInboxDir(asyncDir));
	writePrivateAtomicJson(steerInboxClosedPath(asyncDir), { version: 1, closedAt: Date.now(), state });
}

/** Per-child inbox consumed by the child prompt runtime inside the Pi process. */
export function stepSteerInboxDir(asyncDir: string, index: number): string {
	assertChildIndex(index);
	return path.join(controlInboxDir(asyncDir), STEER_TARGETS_DIR, String(index));
}

export function steerCapabilitiesDir(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), STEER_CAPABILITIES_DIR);
}

export function steerCapabilityPath(asyncDir: string, index: number): string {
	assertChildIndex(index);
	return path.join(steerCapabilitiesDir(asyncDir), `${index}.json`);
}

export function steerAcksDir(asyncDir: string, index: number): string {
	assertChildIndex(index);
	return path.join(controlInboxDir(asyncDir), STEER_ACKS_DIR, String(index));
}

function steerAckFileName(requestId: string): string {
	return `${Buffer.from(requestId).toString("base64url")}.json`;
}

export function steerAckPathFromDir(dir: string, requestId: string): string {
	if (!/^[^\s]+$/.test(requestId) || requestId.length > 256)
		throw new Error("steer acknowledgment requestId is invalid.");
	return path.join(dir, steerAckFileName(requestId));
}

function assertChildIndex(index: number): void {
	if (!Number.isInteger(index) || index < 0 || index > 1_000_000)
		throw new Error("steer child index must be a non-negative integer.");
}

function steerRequestFileName(request: SteerRequest): string {
	return `${String(request.ts).padStart(13, "0")}-${Buffer.from(request.id).toString("base64url")}.json`;
}

function validSteerRequest(request: Partial<SteerRequest>): request is SteerRequest {
	return (
		request.type === "steer" &&
		isRuntimeString(request.id) &&
		/^[^\s]+$/.test(request.id) &&
		request.id.length <= MAX_STEER_REQUEST_ID_LENGTH &&
		isRuntimeNumber(request.ts) &&
		Number.isFinite(request.ts) &&
		request.ts > 0 &&
		isRuntimeString(request.message) &&
		Boolean(request.message.trim()) &&
		Buffer.byteLength(request.message, "utf8") <= MAX_STEER_MESSAGE_BYTES &&
		(request.targetIndex === undefined ||
			(Number.isInteger(request.targetIndex) && request.targetIndex >= 0 && request.targetIndex <= 1_000_000)) &&
		(request.targetIndexes === undefined ||
			(request.targetIndex === undefined &&
				Array.isArray(request.targetIndexes) &&
				request.targetIndexes.length > 0 &&
				request.targetIndexes.length <= MAX_BACKGROUND_TASKS &&
				request.targetIndexes.every((index) => Number.isInteger(index) && index >= 0 && index <= 1_000_000) &&
				new Set(request.targetIndexes).size === request.targetIndexes.length)) &&
		(request.parentRunOrigin === undefined ||
			request.parentRunOrigin === "automatic" ||
			request.parentRunOrigin === "user") &&
		(request.source === undefined ||
			(isRuntimeString(request.source) && Boolean(request.source.trim()) && request.source.length <= 256))
	);
}

export function writeSteerRequestToDir(dir: string, request: SteerRequest): string {
	if (!validSteerRequest(request)) throw new Error("steer request is malformed or exceeds transport limits.");
	ensurePrivateDirectory(dir);
	const requestPath = path.join(dir, steerRequestFileName(request));
	writePrivateAtomicJson(requestPath, request);
	return requestPath;
}

export function writeSteerCapabilityAt(
	filePath: string,
	capability: Omit<SteerCapability, "type" | "protocolVersion">,
): string {
	assertChildIndex(capability.index);
	if (!Number.isInteger(capability.pid) || capability.pid <= 0)
		throw new Error("steer capability pid must be a positive integer.");
	if (!Number.isFinite(capability.readyAt) || capability.readyAt <= 0)
		throw new Error("steer capability readyAt must be a finite timestamp.");
	const record: SteerCapability = { type: "steer-capability", protocolVersion: 1, ...capability };
	ensurePrivateDirectory(path.dirname(filePath));
	writePrivateAtomicJson(filePath, record);
	return filePath;
}

export function writeSteerCapability(
	asyncDir: string,
	capability: Omit<SteerCapability, "type" | "protocolVersion">,
): string {
	prepareControlDirectory(asyncDir, steerCapabilitiesDir(asyncDir));
	return writeSteerCapabilityAt(steerCapabilityPath(asyncDir, capability.index), capability);
}

export function writeSteerAckAt(filePath: string, ack: Omit<SteerAck, "type" | "protocolVersion">): string {
	assertChildIndex(ack.index);
	if (!/^[^\s]+$/.test(ack.requestId) || ack.requestId.length > 256)
		throw new Error("steer acknowledgment requestId is invalid.");
	if (!Number.isFinite(ack.ts) || ack.ts <= 0) throw new Error("steer acknowledgment ts must be a finite timestamp.");
	if (!ack.message.trim() || ack.message.length > 1000) throw new Error("steer acknowledgment message is invalid.");
	const record: SteerAck = { type: "steer-ack", protocolVersion: 1, ...ack, message: ack.message.trim() };
	ensurePrivateDirectory(path.dirname(filePath));
	writePrivateAtomicJson(filePath, record);
	return filePath;
}

export function writeSteerAck(asyncDir: string, ack: Omit<SteerAck, "type" | "protocolVersion">): string {
	prepareControlDirectory(asyncDir, steerAcksDir(asyncDir, ack.index));
	return writeSteerAckAt(path.join(steerAcksDir(asyncDir, ack.index), steerAckFileName(ack.requestId)), ack);
}

function prepareControlDirectory(asyncDir: string, directory: string): void {
	assertPrivateDirectory(asyncDir);
	ensurePrivateDirectoryWithin(asyncDir, directory);
}

/**
 * Parent side: drop a portable interrupt request the runner's inbox watcher will
 * pick up regardless of OS. Written atomically (temp + rename), dir auto-created.
 */
export function requestAsyncInterrupt(
	asyncDir: string,
	payload: Omit<InterruptRequest, "type"> = {},
	deps: { now?: () => number } = {},
): string {
	prepareControlDirectory(asyncDir, controlInboxDir(asyncDir));
	const requestPath = interruptRequestPath(asyncDir);
	const request: InterruptRequest = { ...payload, ts: payload.ts ?? deps.now?.() ?? Date.now(), type: "interrupt" };
	writePrivateAtomicJson(requestPath, request);
	return requestPath;
}

export function requestAsyncTimeout(
	asyncDir: string,
	payload: Omit<TimeoutRequest, "type"> = {},
	deps: { now?: () => number } = {},
): string {
	prepareControlDirectory(asyncDir, controlInboxDir(asyncDir));
	const requestPath = timeoutRequestPath(asyncDir);
	const request: TimeoutRequest = { ...payload, ts: payload.ts ?? deps.now?.() ?? Date.now(), type: "timeout" };
	writePrivateAtomicJson(requestPath, request);
	return requestPath;
}

export function requestAsyncStop(
	asyncDir: string,
	payload: Omit<StopRequest, "type" | "id"> = {},
	deps: { now?: () => number; randomId?: () => string } = {},
): string {
	if (
		payload.targetIndex !== undefined &&
		(!Number.isInteger(payload.targetIndex) || payload.targetIndex < 0 || payload.targetIndex > 1_000_000)
	) {
		throw new Error("stop targetIndex must be an integer between 0 and 1000000.");
	}
	const ts = payload.ts ?? deps.now?.() ?? Date.now();
	const id = deps.randomId?.() || randomUUID();
	if (!/^\S+$/.test(id) || id.length > MAX_STEER_REQUEST_ID_LENGTH) {
		throw new Error("stop request id is invalid.");
	}
	if (!Number.isFinite(ts) || ts <= 0) throw new Error("stop request timestamp must be positive and finite.");
	const requestPath = path.join(
		stopRequestsDir(asyncDir),
		`${String(ts).padStart(13, "0")}-${Buffer.from(id).toString("base64url")}.json`,
	);
	prepareControlDirectory(asyncDir, stopRequestsDir(asyncDir));
	const request: StopRequest = { ...payload, id, ts, type: "stop" };
	writePrivateAtomicJson(requestPath, request);
	return requestPath;
}

export function requestAsyncSteer(
	asyncDir: string,
	payload: {
		message: string;
		parentRunOrigin?: AgentWorkOrigin;
		targetIndex?: number;
		targetIndexes?: number[];
		source?: string;
		id?: string;
		ts?: number;
	},
	deps: { now?: () => number; randomId?: () => string } = {},
): string {
	prepareControlDirectory(asyncDir, steerRequestsDir(asyncDir));
	const message = payload.message.trim();
	if (!message) throw new Error("steer message must not be empty.");
	if (Buffer.byteLength(message, "utf8") > MAX_STEER_MESSAGE_BYTES)
		throw new Error(`steer message exceeds ${MAX_STEER_MESSAGE_BYTES} UTF-8 bytes.`);
	if (
		payload.targetIndex !== undefined &&
		(!Number.isInteger(payload.targetIndex) || payload.targetIndex < 0 || payload.targetIndex > 1_000_000)
	) {
		throw new Error("steer targetIndex must be an integer between 0 and 1000000.");
	}
	if (
		payload.targetIndexes !== undefined &&
		(!Array.isArray(payload.targetIndexes) ||
			payload.targetIndex !== undefined ||
			payload.targetIndexes.length === 0 ||
			payload.targetIndexes.length > MAX_BACKGROUND_TASKS ||
			payload.targetIndexes.some((index) => !Number.isInteger(index) || index < 0 || index > 1_000_000) ||
			new Set(payload.targetIndexes).size !== payload.targetIndexes.length)
	) {
		throw new Error(
			`steer targetIndexes must contain 1-${String(MAX_BACKGROUND_TASKS)} unique non-negative integers and cannot be combined with targetIndex.`,
		);
	}
	const closedPath = steerInboxClosedPath(asyncDir);
	if (fs.existsSync(closedPath)) throw new Error("Async run no longer accepts steering requests.");
	const request: SteerRequest = {
		type: "steer",
		id: payload.id ?? deps.randomId?.() ?? randomUUID(),
		ts: payload.ts ?? deps.now?.() ?? Date.now(),
		message,
	};
	if (payload.parentRunOrigin) request.parentRunOrigin = payload.parentRunOrigin;
	if (payload.targetIndex !== undefined) request.targetIndex = payload.targetIndex;
	if (payload.targetIndexes !== undefined) request.targetIndexes = [...payload.targetIndexes];
	if (payload.source) request.source = payload.source;
	const requestPath = writeSteerRequestToDir(steerRequestsDir(asyncDir), request);
	if (fs.existsSync(closedPath)) {
		fs.rmSync(requestPath, { force: true });
		throw new Error("Async run stopped accepting steering before the request was committed.");
	}
	return requestPath;
}

export function enqueueStepSteer(asyncDir: string, index: number, request: SteerRequest): string {
	assertChildIndex(index);
	prepareControlDirectory(asyncDir, stepSteerInboxDir(asyncDir, index));
	const { targetIndexes: _targetIndexes, ...singleTargetRequest } = request;
	return writeSteerRequestToDir(stepSteerInboxDir(asyncDir, index), {
		...singleTargetRequest,
		targetIndex: index,
		type: "steer",
	});
}

function parseSteerCapability(raw: JsonValue): SteerCapability | undefined {
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) return undefined;
	// SAFETY: the JSON object check establishes the field container; every protocol field is validated below.
	const input = raw as Partial<SteerCapability>;
	if (input.type !== "steer-capability" || input.protocolVersion !== 1) return undefined;
	const { index, pid, readyAt } = input;
	if (!isRuntimeNumber(index) || !Number.isInteger(index) || index < 0 || index > 1_000_000) return undefined;
	if (!isRuntimeNumber(pid) || !Number.isInteger(pid) || pid <= 0) return undefined;
	if (!isRuntimeNumber(readyAt) || !Number.isFinite(readyAt) || readyAt <= 0 || !isRuntimeBoolean(input.supported))
		return undefined;
	return { type: "steer-capability", protocolVersion: 1, index, pid, readyAt, supported: input.supported };
}

function parseSteerAck(raw: JsonValue): SteerAck | undefined {
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) return undefined;
	// SAFETY: the JSON object check establishes the field container; every protocol field is validated below.
	const input = raw as Partial<SteerAck>;
	if (
		input.type !== "steer-ack" ||
		input.protocolVersion !== 1 ||
		!isRuntimeString(input.requestId) ||
		!/^[^\s]+$/.test(input.requestId) ||
		input.requestId.length > 256
	)
		return undefined;
	const { index, ts } = input;
	if (!isRuntimeNumber(index) || !Number.isInteger(index) || index < 0 || index > 1_000_000) return undefined;
	if (!isRuntimeNumber(ts) || !Number.isFinite(ts) || ts <= 0) return undefined;
	if (input.state !== "delivered" && input.state !== "failed") return undefined;
	if (!isRuntimeString(input.message) || !input.message.trim() || input.message.length > 1000) return undefined;
	return {
		type: "steer-ack",
		protocolVersion: 1,
		requestId: input.requestId,
		index,
		ts,
		state: input.state,
		message: input.message.trim(),
	};
}

export function readSteerAckAt(filePath: string): SteerAck | undefined {
	try {
		return parseSteerAck(parseJsonValue(readBoundedOwnedFile(filePath, MAX_CONTROL_RECORD_BYTES)));
	} catch {
		return undefined;
	}
}

export function readSteerCapability(asyncDir: string, index: number): SteerCapability | undefined {
	try {
		return parseSteerCapability(
			parseJsonValue(readBoundedOwnedFile(steerCapabilityPath(asyncDir, index), MAX_CONTROL_RECORD_BYTES)),
		);
	} catch {
		return undefined;
	}
}

export function consumeSteerCapabilities(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "readdirSync" | "readFileSync"> = fs,
): SteerCapability[] {
	const dir = steerCapabilitiesDir(asyncDir);
	if (!fsImpl.existsSync(dir)) return [];
	const capabilities: SteerCapability[] = [];
	for (const entry of fsImpl
		.readdirSync(dir)
		.filter((name) => /^\d+\.json$/.test(name))
		.sort()) {
		try {
			const target = path.join(dir, entry);
			const text =
				fsImpl === fs
					? readBoundedOwnedFile(target, MAX_CONTROL_RECORD_BYTES)
					: fsImpl.readFileSync(target, "utf-8");
			const capability = parseSteerCapability(parseJsonValue(text));
			if (capability) capabilities.push(capability);
		} catch {
			// A partially written or malformed capability is ignored until a valid one arrives.
		}
	}
	return capabilities;
}

/**
 * Read a durable inbox record, then use a non-forcing unlink as the ownership
 * claim. A transient read/unlink failure leaves the record for a later poll;
 * concurrent consumers can both read it, but only the one whose unlink succeeds
 * is allowed to invoke the callback.
 */
function consumeJsonRecord<T>(
	target: string,
	parse: (raw: JsonValue) => T | undefined,
	fsImpl: Pick<typeof fs, "readFileSync" | "rmSync">,
): T | undefined {
	if (fsImpl === fs) {
		try {
			const snapshot = readBoundedOwnedFileSnapshot(target, MAX_CONTROL_RECORD_BYTES);
			let parsed: T | undefined;
			try {
				parsed = parse(parseJsonValue(snapshot.text));
			} catch {
				parsed = undefined;
			}
			return removeOwnedFileSnapshot(target, snapshot) === "removed" ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	let text: string;
	try {
		text = fsImpl.readFileSync(target, "utf-8");
	} catch {
		return undefined;
	}
	let parsed: T | undefined;
	try {
		parsed = parse(parseJsonValue(text));
	} catch {
		parsed = undefined;
	}
	try {
		fsImpl.rmSync(target);
	} catch {
		return undefined;
	}
	return parsed;
}

interface ClaimedControlRecord {
	readonly claimedPath: string;
	readonly originalName: string;
}

function parseClaimedControlRecord(
	directory: string,
	entry: string,
):
	| (ClaimedControlRecord & {
			readonly ownerPid: number;
			readonly ownerIdentity: string;
			readonly consumerId: string;
	  })
	| undefined {
	const separator = entry.lastIndexOf(CONTROL_INFLIGHT_SEPARATOR);
	if (separator <= 0) return undefined;
	const originalName = entry.slice(0, separator);
	const metadata = entry.slice(separator + CONTROL_INFLIGHT_SEPARATOR.length).split(".");
	if (metadata.length !== 3 || !/^\d+$/u.test(metadata[0] ?? "") || !/^[A-Za-z0-9_-]+$/u.test(metadata[1] ?? "")) {
		return undefined;
	}
	let ownerIdentity: string;
	try {
		ownerIdentity = Buffer.from(metadata[1] ?? "", "base64url").toString("utf8");
	} catch {
		return undefined;
	}
	const ownerPid = Number(metadata[0]);
	const consumerId = metadata[2] ?? "";
	if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || !ownerIdentity || !/^[a-f0-9-]{36}$/u.test(consumerId)) {
		return undefined;
	}
	return { claimedPath: path.join(directory, entry), originalName, ownerPid, ownerIdentity, consumerId };
}

function hasErrorCode<ErrorValue>(error: ErrorValue, code: string): boolean {
	return isRuntimeObject(error) && error !== null && "code" in error && error.code === code;
}

function controlClaimRecoverable(claim: ReturnType<typeof parseClaimedControlRecord>): boolean {
	if (!claim || activeControlConsumers.has(claim.consumerId)) return false;
	if (claim.ownerPid === process.pid && claim.ownerIdentity === "pid-only") return true;
	const currentIdentity = readProcessStartIdentity(claim.ownerPid);
	if (currentIdentity) return currentIdentity !== claim.ownerIdentity || claim.ownerPid === process.pid;
	try {
		process.kill(claim.ownerPid, 0);
		return false;
	} catch (error) {
		return hasErrorCode(error, "ESRCH");
	}
}

function claimControlRecord(target: string, consumerId: string): ClaimedControlRecord | undefined {
	const ownerIdentity = readProcessStartIdentity(process.pid) ?? "pid-only";
	const originalName = path.basename(target);
	const claimedPath = `${target}${CONTROL_INFLIGHT_SEPARATOR}${process.pid}.${Buffer.from(ownerIdentity).toString(
		"base64url",
	)}.${consumerId}`;
	try {
		fs.renameSync(target, claimedPath);
		return { claimedPath, originalName };
	} catch {
		return undefined;
	}
}

function processDurableControlRecords<T>(input: {
	readonly directories: Array<{ readonly path: string; readonly accepts: (name: string) => boolean }>;
	readonly parse: (raw: JsonValue) => T | undefined;
	readonly callback: (value: T, complete: () => boolean) => undefined | "retain";
	readonly kind: "interrupt" | "timeout" | "stop" | "steer" | "steer-ack";
	readonly afterClaim?: ((kind: string, claimedPath: string) => void) | undefined;
}): void {
	const consumerId = randomUUID();
	activeControlConsumers.add(consumerId);
	try {
		const candidates: ClaimedControlRecord[] = [];
		for (const directory of input.directories) {
			let entries: string[];
			try {
				entries = fs.readdirSync(directory.path).sort();
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (directory.accepts(entry)) {
					const claimed = claimControlRecord(path.join(directory.path, entry), consumerId);
					if (claimed) candidates.push(claimed);
					continue;
				}
				const claimed = parseClaimedControlRecord(directory.path, entry);
				if (claimed && directory.accepts(claimed.originalName) && controlClaimRecoverable(claimed)) {
					candidates.push(claimed);
				}
			}
		}
		candidates.sort(
			(left, right) =>
				left.originalName.localeCompare(right.originalName) || left.claimedPath.localeCompare(right.claimedPath),
		);
		for (const candidate of candidates) {
			let snapshot: OwnedFileSnapshot;
			try {
				snapshot = readBoundedOwnedFileSnapshot(candidate.claimedPath, MAX_CONTROL_RECORD_BYTES);
			} catch {
				continue;
			}
			let parsed: T | undefined;
			try {
				parsed = input.parse(parseJsonValue(snapshot.text));
			} catch {
				parsed = undefined;
			}
			if (parsed === undefined) {
				removeOwnedFileSnapshot(candidate.claimedPath, snapshot);
				continue;
			}
			try {
				input.afterClaim?.(input.kind, candidate.claimedPath);
				const complete = (): boolean => removeOwnedFileSnapshot(candidate.claimedPath, snapshot) === "removed";
				const disposition = input.callback(parsed, complete);
				if (disposition !== "retain") complete();
			} catch {
				// The in-flight record remains durable. A later poll or replacement
				// runner replays the idempotent request instead of silently losing it.
			}
		}
	} finally {
		activeControlConsumers.delete(consumerId);
	}
}

function parseInterruptRequest(raw: JsonValue): InterruptRequest | undefined {
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) return undefined;
	// SAFETY: the JSON object check establishes the legacy request container; the discriminator is checked next.
	const request = raw as Partial<InterruptRequest>;
	return request.type === "interrupt" ? { ...request, type: "interrupt" } : undefined;
}

function parseTimeoutRequest(raw: JsonValue): TimeoutRequest | undefined {
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) return undefined;
	// SAFETY: the JSON object check establishes the legacy request container; the discriminator is checked next.
	const request = raw as Partial<TimeoutRequest>;
	return request.type === "timeout" ? { ...request, type: "timeout" } : undefined;
}

export function processSteerRequestsFromDir(
	dir: string,
	callback: (request: SteerRequest, complete: () => boolean) => undefined | "retain",
	afterClaim?: (kind: string, claimedPath: string) => void,
): void {
	processDurableControlRecords({
		directories: [{ path: dir, accepts: (name) => name.endsWith(".json") }],
		parse: parseSteerRequest,
		callback,
		kind: "steer",
		afterClaim,
	});
}

export function processSteerAcks(
	asyncDir: string,
	callback: (ack: SteerAck) => undefined | "retain",
	afterClaim?: (kind: string, claimedPath: string) => void,
): void {
	const root = path.join(controlInboxDir(asyncDir), STEER_ACKS_DIR);
	let indexes: string[] = [];
	try {
		indexes = fs.readdirSync(root).filter((entry) => /^\d+$/u.test(entry));
	} catch {
		return;
	}
	processDurableControlRecords({
		directories: indexes.map((index) => ({
			path: path.join(root, index),
			accepts: (name: string) => name.endsWith(".json"),
		})),
		parse: parseSteerAck,
		callback,
		kind: "steer-ack",
		afterClaim,
	});
}

export function consumeSteerAcks(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "readdirSync" | "readFileSync" | "rmSync"> = fs,
): SteerAck[] {
	const root = path.join(controlInboxDir(asyncDir), STEER_ACKS_DIR);
	if (!fsImpl.existsSync(root)) return [];
	const acks: SteerAck[] = [];
	let indexNames: string[];
	try {
		indexNames = fsImpl.readdirSync(root).filter((name) => /^\d+$/.test(name));
	} catch {
		return [];
	}
	for (const indexName of indexNames) {
		const dir = path.join(root, indexName);
		let entries: string[];
		try {
			entries = fsImpl
				.readdirSync(dir)
				.filter((name) => name.endsWith(".json"))
				.sort();
		} catch {
			continue;
		}
		for (const entry of entries) {
			const target = path.join(dir, entry);
			const ack = consumeJsonRecord(target, parseSteerAck, fsImpl);
			if (ack) acks.push(ack);
		}
	}
	return acks;
}

function parseSteerRequest(raw: JsonValue): SteerRequest | undefined {
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) return undefined;
	// SAFETY: the JSON object check establishes the field container; validSteerRequest validates the full protocol.
	const input = raw as Partial<SteerRequest>;
	if (!validSteerRequest(input)) return undefined;
	const request: SteerRequest = {
		type: "steer",
		id: input.id.trim(),
		ts: input.ts,
		message: input.message.trim(),
	};
	if (input.parentRunOrigin) request.parentRunOrigin = input.parentRunOrigin;
	if (input.targetIndex !== undefined) request.targetIndex = input.targetIndex;
	if (input.targetIndexes !== undefined) request.targetIndexes = [...input.targetIndexes];
	if (isRuntimeString(input.source) && input.source.trim()) request.source = input.source;
	return request;
}

export function consumeSteerRequestsFromDir(
	dir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "rmSync" | "readdirSync" | "readFileSync"> = fs,
): SteerRequest[] {
	if (!fsImpl.existsSync(dir)) return [];
	let entries: string[];
	try {
		entries = fsImpl
			.readdirSync(dir)
			.filter((name) => name.endsWith(".json"))
			.sort();
	} catch {
		// Leave requests in place so the periodic poll can retry the scan.
		return [];
	}
	const requests: SteerRequest[] = [];
	for (const entry of entries) {
		const requestPath = path.join(dir, entry);
		const parsed = consumeJsonRecord(requestPath, parseSteerRequest, fsImpl);
		if (parsed) requests.push(parsed);
	}
	return requests.sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id));
}

export function consumeSteerRequests(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "rmSync" | "readdirSync" | "readFileSync"> = fs,
): SteerRequest[] {
	return consumeSteerRequestsFromDir(steerRequestsDir(asyncDir), fsImpl);
}

/**
 * Runner side: consume a pending interrupt request. Idempotent — removes the file
 * so each distinct request fires exactly once. Returns whether one was pending.
 */
export function consumeInterruptRequest(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "rmSync"> = fs,
): boolean {
	const requestPath = interruptRequestPath(asyncDir);
	if (!fsImpl.existsSync(requestPath)) return false;
	try {
		fsImpl.rmSync(requestPath);
	} catch {
		// A concurrent consumer or transient I/O failure owns the retry.
		return false;
	}
	return true;
}

export function consumeTimeoutRequest(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "rmSync"> = fs,
): boolean {
	const requestPath = timeoutRequestPath(asyncDir);
	if (!fsImpl.existsSync(requestPath)) return false;
	try {
		fsImpl.rmSync(requestPath);
	} catch {
		return false;
	}
	return true;
}

function parseStopRequest(raw: JsonValue): StopRequest | undefined {
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) return undefined;
	// SAFETY: the JSON object check establishes the field container; every optional protocol field is validated below.
	const parsed = raw as Partial<StopRequest>;
	if (
		parsed.type !== "stop" ||
		(parsed.id !== undefined && (!/^\S+$/.test(parsed.id) || parsed.id.length > MAX_STEER_REQUEST_ID_LENGTH)) ||
		(parsed.ts !== undefined && (!Number.isFinite(parsed.ts) || parsed.ts <= 0)) ||
		(parsed.source !== undefined && !isRuntimeString(parsed.source)) ||
		(parsed.reason !== undefined && !isRuntimeString(parsed.reason)) ||
		(parsed.targetIndex !== undefined &&
			(!Number.isInteger(parsed.targetIndex) || parsed.targetIndex < 0 || parsed.targetIndex > 1_000_000))
	) {
		return undefined;
	}
	const request: StopRequest = { type: "stop" };
	if (parsed.id !== undefined) request.id = parsed.id;
	if (parsed.ts !== undefined) request.ts = parsed.ts;
	if (parsed.source !== undefined) request.source = parsed.source;
	if (parsed.reason !== undefined) request.reason = parsed.reason;
	if (parsed.targetIndex !== undefined) request.targetIndex = parsed.targetIndex;
	return request;
}

function consumeStopFile(
	requestPath: string,
	fsImpl: Pick<typeof fs, "existsSync" | "readFileSync" | "rmSync">,
): StopRequest | undefined {
	if (!fsImpl.existsSync(requestPath)) return undefined;
	return consumeJsonRecord(requestPath, parseStopRequest, fsImpl);
}

/** Drain queued stop requests plus a valid legacy `stop.json`, ignoring malformed input. */
export function consumeStopRequests(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "readFileSync" | "rmSync" | "readdirSync"> = fs,
): StopRequest[] {
	const requests: StopRequest[] = [];
	const queuedDir = stopRequestsDir(asyncDir);
	if (fsImpl.existsSync(queuedDir)) {
		let entries: string[] = [];
		try {
			entries = fsImpl
				.readdirSync(queuedDir)
				.filter((entry) => entry.endsWith(".json"))
				.sort();
		} catch {
			entries = [];
		}
		for (const entry of entries) {
			const request = consumeStopFile(path.join(queuedDir, entry), fsImpl);
			if (request) requests.push(request);
		}
	}
	const legacy = consumeStopFile(stopRequestPath(asyncDir), fsImpl);
	if (legacy) requests.push(legacy);
	return requests.sort(
		(left, right) => (left.ts ?? 0) - (right.ts ?? 0) || (left.id ?? "").localeCompare(right.id ?? ""),
	);
}

function processStopRequests(
	asyncDir: string,
	callback: (request: StopRequest) => void,
	afterClaim?: (kind: string, claimedPath: string) => void,
): void {
	processDurableControlRecords({
		directories: [
			{ path: stopRequestsDir(asyncDir), accepts: (name) => name.endsWith(".json") },
			{ path: controlInboxDir(asyncDir), accepts: (name) => name === path.basename(stopRequestPath(asyncDir)) },
		],
		parse: parseStopRequest,
		callback: (request) => {
			callback(request);
			return undefined;
		},
		kind: "stop",
		afterClaim,
	});
}

function processSingletonRequest<T>(input: {
	readonly target: string;
	readonly parse: (raw: JsonValue) => T | undefined;
	readonly callback: (request: T) => void;
	readonly kind: "interrupt" | "timeout";
	readonly afterClaim?: ((kind: string, claimedPath: string) => void) | undefined;
}): void {
	const name = path.basename(input.target);
	processDurableControlRecords({
		directories: [{ path: path.dirname(input.target), accepts: (entry) => entry === name }],
		parse: input.parse,
		callback: (request) => {
			input.callback(request);
			return undefined;
		},
		kind: input.kind,
		afterClaim: input.afterClaim,
	});
}

/**
 * Parent side: portable interrupt = authoritative file request + best-effort OS
 * signal. The signal is only a latency optimization on Unix; ENOSYS on Windows
 * is swallowed because the file inbox is authoritative there. Other signal
 * failures are surfaced because they usually mean the runner is not alive to
 * consume the request.
 */
export function deliverInterruptRequest(input: {
	asyncDir: string;
	pid?: number;
	kill?: KillFn;
	signal?: NodeJS.Signals;
	now?: () => number;
	source?: string;
}): void {
	const timing = input.now === undefined ? {} : { now: input.now };
	const requestPath = requestAsyncInterrupt(input.asyncDir, input.source ? { source: input.source } : {}, timing);
	if (isRuntimeNumber(input.pid) && input.pid > 0) {
		try {
			(input.kill ?? process.kill)(input.pid, input.signal ?? INTERRUPT_SIGNAL);
		} catch (error) {
			if (hasErrorCode(error, "ENOSYS")) {
				// File inbox is authoritative when custom cross-process signals are unavailable.
				return;
			}
			try {
				fs.rmSync(requestPath, { force: true });
			} catch {
				// Best effort cleanup; the caller still gets the signal failure.
			}
			throw error;
		}
	}
}

export function deliverTimeoutRequest(input: {
	asyncDir: string;
	pid?: number;
	kill?: KillFn;
	signal?: NodeJS.Signals;
	now?: () => number;
	source?: string;
}): void {
	requestAsyncTimeout(
		input.asyncDir,
		input.source ? { source: input.source } : {},
		input.now === undefined ? {} : { now: input.now },
	);
}

export function deliverStopRequest(input: {
	asyncDir: string;
	pid?: number;
	kill?: KillFn;
	signal?: NodeJS.Signals;
	now?: () => number;
	source?: string;
	targetIndex?: number;
}): void {
	const request: Omit<StopRequest, "type" | "id"> = {};
	if (input.source) request.source = input.source;
	if (input.targetIndex !== undefined) request.targetIndex = input.targetIndex;
	requestAsyncStop(input.asyncDir, request, input.now === undefined ? {} : { now: input.now });
}

/**
 * Runner side: watch the control inbox and route interrupt requests into
 * `onInterrupt`. Uses `fs.watch` when available plus an interval poll as a
 * portable safety net (covers filesystems/platforms where `fs.watch` is
 * unreliable). Fires once per distinct request. Returns a disposer.
 */
export function watchAsyncControlInbox(
	asyncDir: string,
	opts: {
		onInterrupt: () => void;
		onTimeout?: () => void;
		onStop?: (request: StopRequest) => void;
		onSteer?: (request: SteerRequest) => void;
		onSteerCapability?: (capability: SteerCapability) => void;
		onSteerAck?: (ack: SteerAck) => undefined | "retain";
		pollIntervalMs?: number;
		fs?: ControlChannelFs;
		timers?: ControlChannelTimers;
		/** Deterministic crash-window seam used by process-level recovery tests. */
		afterControlClaim?: (kind: string, claimedPath: string) => void;
	},
): () => void {
	const fsImpl = opts.fs ?? fs;
	const timers = opts.timers ?? { setInterval, clearInterval };
	const dir = controlInboxDir(asyncDir);
	try {
		fsImpl.mkdirSync(dir, { recursive: true });
	} catch {
		// Best effort — the poll/watch below tolerates a missing dir.
	}

	let disposed = false;
	const invoke = <T>(callback: ((value: T) => void) | undefined, value: T): void => {
		try {
			callback?.(value);
		} catch {
			// One control observer must not prevent later durable requests from being consumed.
		}
	};
	const invokeNoArg = (callback: (() => void) | undefined): void => {
		try {
			callback?.();
		} catch {
			// Continue draining the remaining durable control requests.
		}
	};
	const check = (): void => {
		if (disposed) return;
		try {
			if (fsImpl === fs) {
				processStopRequests(asyncDir, (stop) => opts.onStop?.(stop), opts.afterControlClaim);
				processSingletonRequest({
					target: timeoutRequestPath(asyncDir),
					parse: parseTimeoutRequest,
					callback: () => opts.onTimeout?.(),
					kind: "timeout",
					afterClaim: opts.afterControlClaim,
				});
				processSingletonRequest({
					target: interruptRequestPath(asyncDir),
					parse: parseInterruptRequest,
					callback: () => opts.onInterrupt(),
					kind: "interrupt",
					afterClaim: opts.afterControlClaim,
				});
				processSteerRequestsFromDir(
					steerRequestsDir(asyncDir),
					(request) => {
						opts.onSteer?.(request);
						return undefined;
					},
					opts.afterControlClaim,
				);
			} else {
				for (const stop of consumeStopRequests(asyncDir, fsImpl)) invoke(opts.onStop, stop);
				if (consumeTimeoutRequest(asyncDir, fsImpl)) invokeNoArg(opts.onTimeout);
				if (consumeInterruptRequest(asyncDir, fsImpl)) invokeNoArg(opts.onInterrupt);
				for (const request of consumeSteerRequests(asyncDir, fsImpl)) invoke(opts.onSteer, request);
			}
			for (const capability of consumeSteerCapabilities(asyncDir, fsImpl)) {
				invoke(opts.onSteerCapability, capability);
			}
			if (fsImpl === fs) processSteerAcks(asyncDir, (ack) => opts.onSteerAck?.(ack), opts.afterControlClaim);
			else for (const ack of consumeSteerAcks(asyncDir, fsImpl)) invoke(opts.onSteerAck, ack);
		} catch {
			// Never let inbox errors crash the runner.
		}
	};

	// Handle a request that may have arrived before the watcher started.
	check();

	let watcher: fs.FSWatcher | undefined;
	try {
		watcher = fsImpl.watch(resolveWatchPath(dir, fsImpl.realpathSync.native), () => check());
		watcher.on?.("error", () => {
			// fs.watch can emit on transient FS errors; the interval poll keeps us live.
		});
	} catch {
		watcher = undefined;
	}

	const interval = timers.setInterval(check, opts.pollIntervalMs ?? POLL_INTERVAL_MS);
	interval.unref?.();

	return () => {
		if (disposed) return;
		disposed = true;
		try {
			watcher?.close();
		} catch {
			// ignore
		}
		timers.clearInterval(interval);
	};
}
