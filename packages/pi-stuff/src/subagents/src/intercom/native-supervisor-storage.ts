import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonValue } from "../../../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import { supervisorChannelDir } from "../runs/shared/pi-args.ts";
import { writeAtomicJson } from "../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import { type DurableClaim, tryAcquireDurableClaim, tryAcquireKernelClaimAsync } from "../shared/durable-claim.ts";
import {
	ensurePrivateDirectory,
	type OwnedFileSnapshot,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshot,
	readBoundedOwnedFileSnapshotAsync,
	removeOwnedFileSnapshot,
} from "../shared/private-directory.ts";
import { readProcessStartIdentity, readProcessStartIdentityAsync } from "../shared/process-identity.ts";
import { TEMP_ROOT_DIR } from "../shared/types.ts";

export const SUPERVISOR_CHANNEL_ROOT = path.join(TEMP_ROOT_DIR, "supervisor-channels");
export const MAX_SUPERVISOR_MESSAGE_BYTES = 64 * 1024;
const REQUESTS_DIR = "requests";
const REPLIES_DIR = "replies";
const DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_DELIVERY_STATE_BYTES = 8 * 1024;
const CHANNEL_METADATA_FILE = "channel.json";
const CHANNEL_LIFECYCLE_CLAIM = "channel-lifecycle";
const MAX_CHANNEL_METADATA_BYTES = 16 * 1024;
const METADATALESS_CHANNEL_GRACE_MS = 60_000;

export function requestDeliveryClaimName(requestId: string): string {
	return `request-delivery-${createHash("sha256").update(requestId).digest("hex")}`;
}

export type SupervisorReason = "need_decision" | "interview_request" | "progress_update";

export interface SupervisorRequest {
	type: "subagent.supervisor.request";
	id: string;
	createdAt: number;
	expiresAt?: number;
	reason: SupervisorReason;
	message: string;
	expectsReply: boolean;
	orchestratorTarget?: string;
	orchestratorSessionId?: string;
	physicalSessionId?: string;
	runId: string;
	agent: string;
	childIndex: number;
	childTarget?: string;
	interview?: unknown;
}

export interface PendingSupervisorRequest extends SupervisorRequest {
	protocolVersion: 1 | 2;
	channelDir: string;
	requestFile: string;
	requestSnapshot: OwnedFileSnapshot;
}

export interface SupervisorRequestFileRead {
	readonly request?: PendingSupervisorRequest;
	readonly snapshot: OwnedFileSnapshot;
}

export interface SupervisorReply {
	type: "subagent.supervisor.reply";
	requestId: string;
	createdAt: number;
	message: string;
}

export interface SupervisorChannelMetadata {
	readonly version: 1;
	readonly physicalSessionId: string;
	readonly runId: string;
	readonly agent: string;
	readonly childIndex: number;
	readonly ownerPid: number;
	readonly ownerProcessStartIdentity?: string;
	readonly updatedAt: number;
}

export type SupervisorChannelIdentity = Pick<
	SupervisorChannelMetadata,
	"physicalSessionId" | "runId" | "agent" | "childIndex"
>;

export interface SupervisorChannelRecord {
	readonly acceptedAt?: unknown;
	readonly agent?: unknown;
	readonly childIndex?: unknown;
	readonly childTarget?: unknown;
	readonly createdAt?: unknown;
	readonly customType?: unknown;
	readonly details?: unknown;
	readonly expectsReply?: unknown;
	readonly expiresAt?: unknown;
	readonly id?: unknown;
	readonly interview?: unknown;
	readonly lastAttemptAt?: unknown;
	readonly message?: unknown;
	readonly orchestratorSessionId?: unknown;
	readonly orchestratorTarget?: unknown;
	readonly ownerPid?: unknown;
	readonly ownerProcessStartIdentity?: unknown;
	readonly physicalSessionId?: unknown;
	readonly reason?: unknown;
	readonly requestId?: unknown;
	readonly runId?: unknown;
	readonly type?: unknown;
	readonly updatedAt?: unknown;
	readonly version?: unknown;
}

export function supervisorChannelRecord<Value>(value: Value): SupervisorChannelRecord {
	if (!isRuntimeObject(value) || value === null || Array.isArray(value)) return {};
	// SAFETY: consumers read only the declared raw fields and validate them before use.
	return value as Value & SupervisorChannelRecord;
}

export function errorCode<Value>(cause: Value): string | undefined {
	return isRuntimeObject(cause) && cause !== null && "code" in cause ? String(cause.code) : undefined;
}

function safeSegment(value: string): string {
	return (
		value
			.trim()
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown"
	);
}

export function resolveSupervisorChannelDir(
	runId: string,
	agent: string,
	childIndex: number,
	physicalSessionId = "legacy-test-session",
): string {
	return supervisorChannelDir(physicalSessionId, runId, agent, childIndex);
}

function resolveLegacySupervisorChannelDir(runId: string, agent: string, childIndex: number): string {
	return path.join(SUPERVISOR_CHANNEL_ROOT, `${safeSegment(runId)}-${safeSegment(agent)}-${childIndex}`);
}

export function ensureSupervisorChannelDir(channelDir: string): void {
	const resolved = path.resolve(channelDir);
	const root = path.resolve(SUPERVISOR_CHANNEL_ROOT);
	if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
		throw new Error(`Supervisor channel '${channelDir}' is outside the private channel root.`);
	}
	ensurePrivateDirectory(TEMP_ROOT_DIR);
	ensurePrivateDirectory(SUPERVISOR_CHANNEL_ROOT);
	ensurePrivateDirectory(resolved);
	ensurePrivateDirectory(path.join(resolved, REQUESTS_DIR));
	ensurePrivateDirectory(path.join(resolved, REPLIES_DIR));
}

export async function supervisorChannelDirsAsync(): Promise<string[]> {
	try {
		return (await fs.promises.readdir(SUPERVISOR_CHANNEL_ROOT, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => path.join(SUPERVISOR_CHANNEL_ROOT, entry.name));
	} catch (error) {
		if (errorCode(error) === "ENOENT") return [];
		throw error;
	}
}

function writeSupervisorChannelMetadata(channelDir: string, metadata: SupervisorChannelIdentity): void {
	const ownerProcessStartIdentity = readProcessStartIdentity(process.pid);
	const record: SupervisorChannelMetadata = {
		version: 1,
		...metadata,
		ownerPid: process.pid,
		updatedAt: Date.now(),
	};
	writeAtomicJson(
		path.join(channelDir, CHANNEL_METADATA_FILE),
		ownerProcessStartIdentity ? { ...record, ownerProcessStartIdentity } : record,
	);
}

function requestPath(channelDir: string, requestId: string): string {
	return path.join(channelDir, REQUESTS_DIR, `${safeSegment(requestId)}.json`);
}

export function replyPath(channelDir: string, requestId: string): string {
	return path.join(channelDir, REPLIES_DIR, `${safeSegment(requestId)}.json`);
}

function requestDeliveryStatePath(requestFile: string): string {
	return path.join(path.dirname(requestFile), `.${path.basename(requestFile)}.delivery-state`);
}

export interface RequestDeliveryState {
	readonly version: 2;
	readonly requestId: string;
	readonly lastAttemptAt: number;
	readonly acceptedAt?: number;
}

export function readRequestDeliveryState(requestFile: string, requestId: string): RequestDeliveryState | undefined {
	try {
		const value = supervisorChannelRecord(
			parseJsonValue(readBoundedOwnedFile(requestDeliveryStatePath(requestFile), MAX_DELIVERY_STATE_BYTES)),
		);
		if (
			(value.version !== 1 && value.version !== 2) ||
			value.requestId !== requestId ||
			!isRuntimeNumber(value.lastAttemptAt) ||
			!Number.isFinite(value.lastAttemptAt)
		)
			return undefined;
		const acceptedAt =
			isRuntimeNumber(value.acceptedAt) && Number.isFinite(value.acceptedAt) ? value.acceptedAt : undefined;
		const state: RequestDeliveryState = {
			version: 2,
			requestId,
			lastAttemptAt: value.lastAttemptAt,
		};
		return acceptedAt === undefined ? state : { ...state, acceptedAt };
	} catch {
		return undefined;
	}
}

export function writeRequestDeliveryState(requestFile: string, state: RequestDeliveryState): void {
	writeAtomicJson(requestDeliveryStatePath(requestFile), {
		...state,
	});
}

export function removeRequestDeliveryAttempt(requestFile: string): void {
	try {
		fs.unlinkSync(requestDeliveryStatePath(requestFile));
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

export function askTimeoutMs(): number {
	const parsed = Number(process.env["PI_INTERCOM_ASK_TIMEOUT_MS"]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASK_TIMEOUT_MS;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Supervisor request cancelled."));
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(new Error("Supervisor request cancelled."));
		};
		timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function acquireChannelLifecycleClaim(signal?: AbortSignal): Promise<DurableClaim> {
	ensurePrivateDirectory(TEMP_ROOT_DIR);
	ensurePrivateDirectory(SUPERVISOR_CHANNEL_ROOT);
	const deadline = Date.now() + 3_000;
	for (;;) {
		const claim = tryAcquireDurableClaim(SUPERVISOR_CHANNEL_ROOT, CHANNEL_LIFECYCLE_CLAIM);
		if (claim) return claim;
		if (Date.now() >= deadline) throw new Error("Supervisor channel lifecycle is busy; retry the request.");
		await delay(20, signal);
	}
}

export async function publishSupervisorRequest(
	channelDir: string,
	identity: SupervisorChannelIdentity,
	request: SupervisorRequest,
	signal?: AbortSignal,
): Promise<void> {
	if (Buffer.byteLength(JSON.stringify(request, null, "\t"), "utf-8") > MAX_SUPERVISOR_MESSAGE_BYTES) {
		throw new Error("Supervisor request is too large.");
	}
	const lifecycleClaim = await acquireChannelLifecycleClaim(signal);
	try {
		ensureSupervisorChannelDir(channelDir);
		writeSupervisorChannelMetadata(channelDir, identity);
		writeAtomicJson(requestPath(channelDir, request.id), request);
	} finally {
		lifecycleClaim.release();
	}
}

export async function waitForSupervisorReply(
	channelDir: string,
	requestId: string,
	deadline: number,
	signal?: AbortSignal,
): Promise<SupervisorReply> {
	const file = replyPath(channelDir, requestId);
	while (Date.now() <= deadline) {
		if (signal?.aborted) throw new Error("Supervisor request cancelled.");
		if (fs.existsSync(file)) {
			let parsed: SupervisorChannelRecord | undefined;
			let snapshot: OwnedFileSnapshot | undefined;
			try {
				snapshot = readBoundedOwnedFileSnapshot(file, MAX_SUPERVISOR_MESSAGE_BYTES);
				parsed = supervisorChannelRecord(parseJsonValue(snapshot.text));
			} catch (error) {
				if (errorCode(error) === "ENOENT") continue;
				throw error;
			}
			if (
				parsed.type === "subagent.supervisor.reply" &&
				parsed.requestId === requestId &&
				isRuntimeNumber(parsed.createdAt) &&
				Number.isFinite(parsed.createdAt) &&
				isRuntimeString(parsed.message) &&
				Buffer.byteLength(parsed.message, "utf-8") <= MAX_SUPERVISOR_MESSAGE_BYTES
			) {
				const reply: SupervisorReply = {
					type: "subagent.supervisor.reply",
					requestId,
					createdAt: parsed.createdAt,
					message: parsed.message,
				};
				try {
					if (!snapshot || removeOwnedFileSnapshot(file, snapshot) !== "removed") continue;
				} catch (error) {
					reportAgentDiagnostic(`Failed to remove consumed supervisor reply '${file}':`, error);
				}
				removeRequestFile(requestPath(channelDir, requestId));
				return reply;
			}
		}
		await delay(250, signal);
	}
	throw new Error("Timed out waiting for supervisor reply.");
}

export function parseRequestFile(file: string, channelDir: string): SupervisorRequestFileRead | undefined {
	let snapshot: OwnedFileSnapshot;
	try {
		snapshot = readBoundedOwnedFileSnapshot(file, MAX_SUPERVISOR_MESSAGE_BYTES);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
	try {
		const parsed = supervisorChannelRecord(parseJsonValue(snapshot.text));
		if (parsed.type !== "subagent.supervisor.request") return { snapshot };
		if (!isRuntimeString(parsed.id) || !parsed.id.trim() || parsed.id.length > 256) return { snapshot };
		if (
			parsed.reason !== "need_decision" &&
			parsed.reason !== "interview_request" &&
			parsed.reason !== "progress_update"
		)
			return { snapshot };
		const physicalSessionId =
			isRuntimeString(parsed.physicalSessionId) && parsed.physicalSessionId.trim()
				? parsed.physicalSessionId
				: undefined;
		const protocolVersion = physicalSessionId ? 2 : 1;
		if (
			!isRuntimeString(parsed.message) ||
			!parsed.message ||
			Buffer.byteLength(parsed.message, "utf-8") > MAX_SUPERVISOR_MESSAGE_BYTES
		)
			return { snapshot };
		if (
			!isRuntimeNumber(parsed.createdAt) ||
			!Number.isFinite(parsed.createdAt) ||
			parsed.createdAt <= 0 ||
			(parsed.expiresAt !== undefined &&
				(!isRuntimeNumber(parsed.expiresAt) ||
					!Number.isFinite(parsed.expiresAt) ||
					parsed.expiresAt < parsed.createdAt)) ||
			(protocolVersion === 2 && (!isRuntimeNumber(parsed.expiresAt) || !Number.isFinite(parsed.expiresAt))) ||
			!isRuntimeBoolean(parsed.expectsReply) ||
			parsed.expectsReply !== (parsed.reason !== "progress_update") ||
			!isRuntimeString(parsed.orchestratorSessionId) ||
			!parsed.orchestratorSessionId.trim() ||
			!isRuntimeString(parsed.runId) ||
			!parsed.runId.trim() ||
			!isRuntimeString(parsed.agent) ||
			!parsed.agent.trim() ||
			!isRuntimeNumber(parsed.childIndex) ||
			!Number.isSafeInteger(parsed.childIndex) ||
			(parsed.childIndex ?? -1) < 0
		)
			return { snapshot };
		if (path.basename(file) !== `${safeSegment(parsed.id)}.json`) return { snapshot };
		const expectedChannel = physicalSessionId
			? resolveSupervisorChannelDir(parsed.runId, parsed.agent, parsed.childIndex, physicalSessionId)
			: resolveLegacySupervisorChannelDir(parsed.runId, parsed.agent, parsed.childIndex);
		if (path.resolve(channelDir) !== path.resolve(expectedChannel)) {
			return { snapshot };
		}
		const request: PendingSupervisorRequest = {
			type: "subagent.supervisor.request",
			id: parsed.id,
			createdAt: parsed.createdAt,
			reason: parsed.reason,
			message: parsed.message,
			expectsReply: parsed.expectsReply,
			orchestratorSessionId: parsed.orchestratorSessionId,
			runId: parsed.runId,
			agent: parsed.agent,
			childIndex: parsed.childIndex,
			protocolVersion,
			channelDir,
			requestFile: file,
			requestSnapshot: snapshot,
		};
		if (isRuntimeNumber(parsed.expiresAt)) request.expiresAt = parsed.expiresAt;
		if (physicalSessionId) request.physicalSessionId = physicalSessionId;
		if (isRuntimeString(parsed.orchestratorTarget)) request.orchestratorTarget = parsed.orchestratorTarget;
		if (isRuntimeString(parsed.childTarget)) request.childTarget = parsed.childTarget;
		if (parsed.interview !== undefined) request.interview = parsed.interview;
		return { snapshot, request };
	} catch {
		return { snapshot };
	}
}

export async function requestFilesInChannelAsync(channelDir: string, limit: number): Promise<string[]> {
	try {
		return (await fs.promises.readdir(path.join(channelDir, REQUESTS_DIR), { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.sort((left, right) => left.name.localeCompare(right.name))
			.slice(0, limit)
			.map((entry) => path.join(channelDir, REQUESTS_DIR, entry.name));
	} catch {
		return [];
	}
}

async function channelOwnerAlive(metadata: SupervisorChannelMetadata): Promise<boolean | undefined> {
	if (metadata.ownerProcessStartIdentity) {
		const current = await readProcessStartIdentityAsync(metadata.ownerPid);
		if (current) return current === metadata.ownerProcessStartIdentity;
	}
	try {
		process.kill(metadata.ownerPid, 0);
		return undefined;
	} catch (error) {
		return errorCode(error) === "ESRCH" ? false : undefined;
	}
}

async function metadataLessChannelSafeToCollect(channelDir: string, now: number): Promise<boolean> {
	const resolved = path.resolve(channelDir);
	if (path.dirname(resolved) !== path.resolve(SUPERVISOR_CHANNEL_ROOT)) return false;
	try {
		const stat = await fs.promises.lstat(resolved);
		const currentUid = process.getuid?.();
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(currentUid !== undefined && stat.uid !== currentUid) ||
			now - stat.mtimeMs < METADATALESS_CHANNEL_GRACE_MS
		) {
			return false;
		}
		try {
			await fs.promises.lstat(path.join(resolved, CHANNEL_METADATA_FILE));
			return false;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") return false;
		}
		for (const entry of await fs.promises.readdir(resolved, { withFileTypes: true })) {
			if (entry.name !== REQUESTS_DIR && entry.name !== REPLIES_DIR) return false;
			const child = path.join(resolved, entry.name);
			const childStat = await fs.promises.lstat(child);
			if (
				!entry.isDirectory() ||
				entry.isSymbolicLink() ||
				(currentUid !== undefined && childStat.uid !== currentUid) ||
				(await fs.promises.readdir(child)).length > 0
			) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

async function readSupervisorChannelMetadataAsync(channelDir: string): Promise<SupervisorChannelMetadata | undefined> {
	try {
		const value = supervisorChannelRecord(
			parseJsonValue(
				(
					await readBoundedOwnedFileSnapshotAsync(
						path.join(channelDir, CHANNEL_METADATA_FILE),
						MAX_CHANNEL_METADATA_BYTES,
					)
				).text,
			),
		);
		if (
			value.version !== 1 ||
			!isRuntimeString(value.physicalSessionId) ||
			!value.physicalSessionId ||
			!isRuntimeString(value.runId) ||
			!value.runId ||
			!isRuntimeString(value.agent) ||
			!value.agent ||
			!isRuntimeNumber(value.childIndex) ||
			!Number.isSafeInteger(value.childIndex) ||
			value.childIndex < 0 ||
			!isRuntimeNumber(value.ownerPid) ||
			!Number.isSafeInteger(value.ownerPid) ||
			value.ownerPid <= 0 ||
			!isRuntimeNumber(value.updatedAt) ||
			!Number.isFinite(value.updatedAt) ||
			(value.ownerProcessStartIdentity !== undefined &&
				(!isRuntimeString(value.ownerProcessStartIdentity) || !value.ownerProcessStartIdentity))
		) {
			return undefined;
		}
		const expected = resolveSupervisorChannelDir(value.runId, value.agent, value.childIndex, value.physicalSessionId);
		if (path.resolve(expected) !== path.resolve(channelDir)) return undefined;
		const metadata: SupervisorChannelMetadata = {
			version: 1,
			physicalSessionId: value.physicalSessionId,
			runId: value.runId,
			agent: value.agent,
			childIndex: value.childIndex,
			ownerPid: value.ownerPid,
			updatedAt: value.updatedAt,
		};
		return value.ownerProcessStartIdentity === undefined
			? metadata
			: { ...metadata, ownerProcessStartIdentity: value.ownerProcessStartIdentity };
	} catch {
		return undefined;
	}
}

export async function collectSupervisorChannel(
	channelDir: string,
	runInactive: (metadata: SupervisorChannelMetadata) => boolean,
	now = Date.now(),
): Promise<boolean> {
	const metadata = await readSupervisorChannelMetadataAsync(channelDir);
	if (metadata) {
		if ((await requestFilesInChannelAsync(channelDir, 1)).length > 0) return false;
		if ((await channelOwnerAlive(metadata)) !== false && !runInactive(metadata)) return false;
	}
	const claim = await tryAcquireKernelClaimAsync(SUPERVISOR_CHANNEL_ROOT, CHANNEL_LIFECYCLE_CLAIM);
	if (!claim) return false;
	try {
		const current = await readSupervisorChannelMetadataAsync(channelDir);
		if (!current) {
			if (!(await metadataLessChannelSafeToCollect(channelDir, now))) return false;
		} else {
			if ((await requestFilesInChannelAsync(channelDir, 1)).length > 0) return false;
			if ((await channelOwnerAlive(current)) !== false && !runInactive(current)) return false;
		}
		const resolved = path.resolve(channelDir);
		if (path.dirname(resolved) !== path.resolve(SUPERVISOR_CHANNEL_ROOT)) return false;
		const stat = await fs.promises.lstat(resolved);
		if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
		await fs.promises.rm(resolved, { recursive: true });
		return true;
	} catch {
		return false;
	} finally {
		await claim.release();
	}
}

export function removeRequestFile(file: string, snapshot?: OwnedFileSnapshot): boolean {
	try {
		if (snapshot) {
			const outcome = removeOwnedFileSnapshot(file, snapshot);
			if (outcome !== "removed") return false;
		}
		if (!snapshot) fs.rmSync(file, { force: true });
		removeRequestDeliveryAttempt(file);
		return true;
	} catch {
		// Request cleanup is best-effort; reply files and timeout errors remain authoritative.
		return false;
	}
}

export function discardSupervisorRequest(channelDir: string, requestId: string): boolean {
	return removeRequestFile(requestPath(channelDir, requestId));
}

export function publishSupervisorReply(
	request: PendingSupervisorRequest,
	message: string,
	afterPublish?: (replyPath: string) => void,
): void {
	if (!message.trim()) throw new Error("message is required for supervisor replies.");
	const reply: SupervisorReply = {
		type: "subagent.supervisor.reply",
		requestId: request.id,
		createdAt: Date.now(),
		message: message.trim(),
	};
	if (Buffer.byteLength(JSON.stringify(reply), "utf-8") > MAX_SUPERVISOR_MESSAGE_BYTES) {
		throw new Error("Supervisor reply is too large.");
	}
	const outputPath = replyPath(request.channelDir, request.id);
	writeAtomicJson(outputPath, reply);
	afterPublish?.(outputPath);
	if (removeRequestFile(request.requestFile, request.requestSnapshot)) return;

	// The child consumes the reply before removing its request. Either file can
	// therefore disappear between publication and parent cleanup. Missing reply
	// or request is positive consumption evidence, not a failed delivery.
	try {
		fs.lstatSync(request.requestFile);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return;
		throw error;
	}
	let replySnapshot: OwnedFileSnapshot;
	try {
		replySnapshot = readBoundedOwnedFileSnapshot(outputPath, MAX_SUPERVISOR_MESSAGE_BYTES);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return;
		throw error;
	}
	removeOwnedFileSnapshot(outputPath, replySnapshot);
	throw new Error(`Supervisor request '${request.id}' is no longer pending.`);
}
