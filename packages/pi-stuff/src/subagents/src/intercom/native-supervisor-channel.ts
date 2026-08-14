import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import { withAgentWorkOrigin } from "../../../conversation-ui/agent-run-origin.js";
import { deliverSuiteAgentMessage } from "../../../conversation-ui/index.js";
import { activityKey, registerSuiteOwnedTool, singleActivity } from "../../../tool-display/index.js";
import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV,
	SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV,
	SUBAGENT_ORCHESTRATOR_TARGET_ENV,
	SUBAGENT_RUN_ID_ENV,
	SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV,
	supervisorChannelDir,
} from "../runs/shared/pi-args.ts";
import { writeAtomicJson } from "../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import { type DurableClaim, tryAcquireDurableClaim } from "../shared/durable-claim.ts";
import {
	ensurePrivateDirectory,
	type OwnedFileSnapshot,
	readBoundedOwnedFile,
	readBoundedOwnedFileSnapshot,
	removeOwnedFileSnapshot,
} from "../shared/private-directory.ts";
import { readProcessStartIdentity } from "../shared/process-identity.ts";
import { sessionArtifactMatches } from "../shared/session-identity.ts";
import {
	INTERCOM_DETACH_REQUEST_EVENT,
	type IntercomEventBus,
	POLL_INTERVAL_MS,
	type SubagentState,
	TEMP_ROOT_DIR,
} from "../shared/types.ts";

const SUPERVISOR_CHANNEL_ROOT = path.join(TEMP_ROOT_DIR, "supervisor-channels");
const REQUESTS_DIR = "requests";
const REPLIES_DIR = "replies";
export const NATIVE_SUPERVISOR_TOOL_NAME = "subagent_supervisor";
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000;
const CHANNEL_POLL_MS = Math.min(POLL_INTERVAL_MS, 500);
const MAX_REQUEST_FILES_PER_POLL = 256;
const MAX_CHANNEL_DIRS_PER_POLL = 128;
const DELIVERY_RETRY_GRACE_MS = 5_000;
const MAX_DELIVERY_STATE_BYTES = 8 * 1024;
const MAX_SESSION_DELIVERY_SCAN_BYTES = 32 * 1024 * 1024;
const CHANNEL_METADATA_FILE = "channel.json";
const CHANNEL_LIFECYCLE_CLAIM = "channel-lifecycle";
const MAX_CHANNEL_METADATA_BYTES = 16 * 1024;
const METADATALESS_CHANNEL_GRACE_MS = 60_000;

function requestDeliveryClaimName(requestId: string): string {
	return `request-delivery-${createHash("sha256").update(requestId).digest("hex")}`;
}

type SupervisorReason = "need_decision" | "interview_request" | "progress_update";

interface SupervisorRequest {
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

interface PendingSupervisorRequest extends SupervisorRequest {
	protocolVersion: 1 | 2;
	channelDir: string;
	requestFile: string;
	requestSnapshot: OwnedFileSnapshot;
}

interface SupervisorRequestFileRead {
	readonly request?: PendingSupervisorRequest;
	readonly snapshot: OwnedFileSnapshot;
}

interface SupervisorReply {
	type: "subagent.supervisor.reply";
	requestId: string;
	createdAt: number;
	message: string;
}

interface SupervisorChannelMetadata {
	readonly version: 1;
	readonly physicalSessionId: string;
	readonly runId: string;
	readonly agent: string;
	readonly childIndex: number;
	readonly ownerPid: number;
	readonly ownerProcessStartIdentity?: string;
	readonly updatedAt: number;
}

interface ContactSupervisorParams {
	reason: SupervisorReason;
	message?: string;
	interview?: unknown;
}

interface IntercomParams {
	action: "list" | "send" | "ask" | "reply" | "pending" | "status";
	to?: string;
	message?: string;
	replyTo?: string;
}

const ContactSupervisorParamsSchema = Type.Object(
	{
		reason: Type.String({ enum: ["need_decision", "interview_request", "progress_update"] }),
		message: Type.Optional(Type.String()),
		interview: Type.Optional(Type.Unsafe({ type: "object", additionalProperties: true })),
	},
	{ additionalProperties: false },
);

const IntercomParamsSchema = Type.Object(
	{
		action: Type.String({ enum: ["list", "send", "ask", "reply", "pending", "status"] }),
		to: Type.Optional(Type.String()),
		message: Type.Optional(Type.String()),
		replyTo: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

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

function writeSupervisorChannelMetadata(
	channelDir: string,
	metadata: Omit<SupervisorChannelMetadata, "version" | "ownerPid" | "ownerProcessStartIdentity" | "updatedAt">,
): void {
	const ownerProcessStartIdentity = readProcessStartIdentity(process.pid);
	writeAtomicJson(path.join(channelDir, CHANNEL_METADATA_FILE), {
		version: 1,
		...metadata,
		ownerPid: process.pid,
		...(ownerProcessStartIdentity ? { ownerProcessStartIdentity } : {}),
		updatedAt: Date.now(),
	} satisfies SupervisorChannelMetadata);
}

function readSupervisorChannelMetadata(channelDir: string): SupervisorChannelMetadata | undefined {
	try {
		const value = JSON.parse(
			readBoundedOwnedFile(path.join(channelDir, CHANNEL_METADATA_FILE), MAX_CHANNEL_METADATA_BYTES),
		) as Partial<SupervisorChannelMetadata>;
		if (
			value.version !== 1 ||
			typeof value.physicalSessionId !== "string" ||
			!value.physicalSessionId ||
			typeof value.runId !== "string" ||
			!value.runId ||
			typeof value.agent !== "string" ||
			!value.agent ||
			typeof value.childIndex !== "number" ||
			!Number.isSafeInteger(value.childIndex) ||
			value.childIndex < 0 ||
			!Number.isSafeInteger(value.ownerPid) ||
			(value.ownerPid ?? -1) <= 0 ||
			typeof value.updatedAt !== "number" ||
			!Number.isFinite(value.updatedAt)
		) {
			return undefined;
		}
		if (
			value.ownerProcessStartIdentity !== undefined &&
			(typeof value.ownerProcessStartIdentity !== "string" || !value.ownerProcessStartIdentity)
		) {
			return undefined;
		}
		const expected = resolveSupervisorChannelDir(value.runId, value.agent, value.childIndex, value.physicalSessionId);
		if (path.resolve(expected) !== path.resolve(channelDir)) return undefined;
		return value as SupervisorChannelMetadata;
	} catch {
		return undefined;
	}
}

function requestPath(channelDir: string, requestId: string): string {
	return path.join(channelDir, REQUESTS_DIR, `${safeSegment(requestId)}.json`);
}

function replyPath(channelDir: string, requestId: string): string {
	return path.join(channelDir, REPLIES_DIR, `${safeSegment(requestId)}.json`);
}

function requestDeliveryStatePath(requestFile: string): string {
	return path.join(path.dirname(requestFile), `.${path.basename(requestFile)}.delivery-state`);
}

interface RequestDeliveryState {
	readonly version: 2;
	readonly requestId: string;
	readonly lastAttemptAt: number;
	readonly acceptedAt?: number;
}

function readRequestDeliveryState(requestFile: string, requestId: string): RequestDeliveryState | undefined {
	try {
		const value = JSON.parse(
			readBoundedOwnedFile(requestDeliveryStatePath(requestFile), MAX_DELIVERY_STATE_BYTES),
		) as {
			version?: unknown;
			requestId?: unknown;
			lastAttemptAt?: unknown;
			acceptedAt?: unknown;
		};
		if (
			(value.version !== 1 && value.version !== 2) ||
			(value.requestId === requestId &&
				(typeof value.lastAttemptAt !== "number" || !Number.isFinite(value.lastAttemptAt)))
		)
			return undefined;
		if (value.requestId !== requestId) return undefined;
		const acceptedAt =
			typeof value.acceptedAt === "number" && Number.isFinite(value.acceptedAt) ? value.acceptedAt : undefined;
		return {
			version: 2,
			requestId,
			lastAttemptAt: value.lastAttemptAt as number,
			...(acceptedAt !== undefined ? { acceptedAt } : {}),
		};
	} catch {
		return undefined;
	}
}

function writeRequestDeliveryState(requestFile: string, state: RequestDeliveryState): void {
	writeAtomicJson(requestDeliveryStatePath(requestFile), {
		...state,
	});
}

function removeRequestDeliveryAttempt(requestFile: string): void {
	try {
		fs.unlinkSync(requestDeliveryStatePath(requestFile));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function readTextEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function readChildMetadata():
	| {
			channelDir: string;
			runId: string;
			agent: string;
			childIndex: number;
			orchestratorTarget?: string;
			orchestratorSessionId?: string;
			physicalSessionId: string;
			childTarget?: string;
	  }
	| undefined {
	const channelDir = readTextEnv(SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV);
	const runId = readTextEnv(SUBAGENT_RUN_ID_ENV);
	const agent = readTextEnv(SUBAGENT_CHILD_AGENT_ENV);
	const rawIndex = readTextEnv(SUBAGENT_CHILD_INDEX_ENV);
	const orchestratorSessionId = readTextEnv(SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV);
	const physicalSessionId = readTextEnv(SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV);
	if (
		!channelDir ||
		!runId ||
		!agent ||
		!orchestratorSessionId ||
		!physicalSessionId ||
		rawIndex === undefined ||
		!/^\d+$/.test(rawIndex)
	)
		return undefined;
	const childIndex = Number(rawIndex);
	if (!Number.isSafeInteger(childIndex)) return undefined;
	if (
		path.resolve(channelDir) !==
		path.resolve(resolveSupervisorChannelDir(runId, agent, childIndex, physicalSessionId))
	) {
		return undefined;
	}
	return {
		channelDir,
		runId,
		agent,
		childIndex,
		orchestratorTarget: readTextEnv(SUBAGENT_ORCHESTRATOR_TARGET_ENV),
		orchestratorSessionId,
		physicalSessionId,
		childTarget: readTextEnv("PI_SUBAGENT_INTERCOM_SESSION_NAME"),
	};
}

function reasonHeading(reason: SupervisorReason): string {
	if (reason === "interview_request") return "Subagent requests a structured supervisor interview.";
	if (reason === "progress_update") return "Subagent progress update.";
	return "Subagent needs a supervisor decision.";
}

function formatChildMessage(input: {
	reason: SupervisorReason;
	message?: string;
	interview?: unknown;
	runId: string;
	agent: string;
	childIndex: number;
	childTarget?: string;
}): string {
	const lines = [
		reasonHeading(input.reason),
		`Run: ${input.runId}`,
		`Agent: ${input.agent}`,
		`Child index: ${input.childIndex}`,
	];
	if (input.childTarget) lines.push(`Child intercom target: ${input.childTarget}`);
	lines.push("");
	if (input.message?.trim()) lines.push(input.message.trim());
	if (input.reason === "interview_request") {
		lines.push(
			"",
			"Structured response requested. Reply with JSON, optionally fenced in ```json, matching the requested interview shape.",
		);
		if (input.interview !== undefined) lines.push(JSON.stringify(input.interview, null, "\t"));
	}
	return lines.join("\n").trimEnd();
}

function parseStructuredReply(message: string): { value?: unknown; error?: string } {
	const trimmed = message.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
	try {
		return { value: JSON.parse(fenced ?? trimmed) };
	} catch (error) {
		return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
	}
}

function askTimeoutMs(): number {
	const parsed = Number(process.env.PI_INTERCOM_ASK_TIMEOUT_MS);
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

async function waitForReply(
	channelDir: string,
	requestId: string,
	deadline: number,
	signal?: AbortSignal,
): Promise<SupervisorReply> {
	const file = replyPath(channelDir, requestId);
	while (Date.now() <= deadline) {
		if (signal?.aborted) throw new Error("Supervisor request cancelled.");
		if (fs.existsSync(file)) {
			let parsed: Partial<SupervisorReply> | undefined;
			let snapshot: OwnedFileSnapshot | undefined;
			try {
				snapshot = readBoundedOwnedFileSnapshot(file, MAX_MESSAGE_BYTES);
				parsed = JSON.parse(snapshot.text) as Partial<SupervisorReply>;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (
				parsed.type === "subagent.supervisor.reply" &&
				parsed.requestId === requestId &&
				typeof parsed.createdAt === "number" &&
				Number.isFinite(parsed.createdAt) &&
				typeof parsed.message === "string" &&
				Buffer.byteLength(parsed.message, "utf-8") <= MAX_MESSAGE_BYTES
			) {
				const reply = parsed as SupervisorReply;
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

async function sendSupervisorRequest(
	params: ContactSupervisorParams,
	signal?: AbortSignal,
): Promise<AgentToolResult<Record<string, unknown>>> {
	const metadata = readChildMetadata();
	if (!metadata) throw new Error("Native supervisor channel is not available for this subagent.");
	if (params.reason !== "progress_update" && !params.message?.trim() && params.reason !== "interview_request") {
		throw new Error("message is required for supervisor decisions.");
	}
	const requestId = randomUUID();
	const expectsReply = params.reason !== "progress_update";
	const createdAt = Date.now();
	const replyDeadline = createdAt + askTimeoutMs();
	const expiresAt = replyDeadline;
	const message = formatChildMessage({
		...metadata,
		reason: params.reason,
		message: params.message,
		interview: params.interview,
	});
	const request: SupervisorRequest = {
		type: "subagent.supervisor.request",
		id: requestId,
		createdAt,
		expiresAt,
		reason: params.reason,
		message,
		expectsReply,
		...(metadata.orchestratorTarget ? { orchestratorTarget: metadata.orchestratorTarget } : {}),
		...(metadata.orchestratorSessionId ? { orchestratorSessionId: metadata.orchestratorSessionId } : {}),
		physicalSessionId: metadata.physicalSessionId,
		runId: metadata.runId,
		agent: metadata.agent,
		childIndex: metadata.childIndex,
		...(metadata.childTarget ? { childTarget: metadata.childTarget } : {}),
		...(params.interview !== undefined ? { interview: params.interview } : {}),
	};
	const serialized = JSON.stringify(request, null, "\t");
	if (Buffer.byteLength(serialized, "utf-8") > MAX_MESSAGE_BYTES) throw new Error("Supervisor request is too large.");
	const lifecycleClaim = await acquireChannelLifecycleClaim(signal);
	try {
		ensureSupervisorChannelDir(metadata.channelDir);
		writeSupervisorChannelMetadata(metadata.channelDir, {
			physicalSessionId: metadata.physicalSessionId,
			runId: metadata.runId,
			agent: metadata.agent,
			childIndex: metadata.childIndex,
		});
		writeAtomicJson(requestPath(metadata.channelDir, requestId), request);
	} finally {
		lifecycleClaim.release();
	}

	if (!expectsReply) {
		return {
			content: [{ type: "text", text: "Supervisor progress update queued." }],
			details: { delivered: true, requestId, reason: params.reason },
		};
	}

	try {
		const reply = await waitForReply(metadata.channelDir, requestId, replyDeadline, signal);
		const details: Record<string, unknown> = { requestId, reason: params.reason };
		if (params.reason === "interview_request") {
			const structured = parseStructuredReply(reply.message);
			if (structured.error) details.structuredReplyParseError = structured.error;
			else details.structuredReply = structured.value;
		}
		return {
			content: [{ type: "text", text: `**Reply from supervisor:**\n${reply.message}` }],
			details,
		};
	} catch (error) {
		removeRequestFile(requestPath(metadata.channelDir, requestId));
		throw error;
	}
}

function hasTool(pi: ExtensionAPI, name: string): boolean {
	try {
		return pi.getAllTools?.().some((tool: { name?: unknown }) => tool.name === name) === true;
	} catch {
		return false;
	}
}

function toolResultText(result: AgentToolResult<Record<string, unknown>>): string {
	for (const entry of result.content) {
		if (entry.type !== "text") continue;
		const preview = entry.text.slice(0, 8 * 1024).trim();
		if (preview) return preview;
	}
	return "";
}

function communicationTarget(args: Readonly<Record<string, unknown>>): string {
	const action = typeof args.action === "string" ? args.action : typeof args.reason === "string" ? args.reason : "";
	const destination = typeof args.replyTo === "string" ? args.replyTo : typeof args.to === "string" ? args.to : "";
	return [action, destination].filter(Boolean).join(" · ");
}

function communicationCategory(args: Readonly<Record<string, unknown>>) {
	const action = typeof args.action === "string" ? args.action : "";
	return action === "status" || action === "list" || action === "pending" ? "check-agent" : "message-agent";
}

function registerCommunicationTool<TParams extends TSchema>(
	pi: ExtensionAPI,
	tool: ToolDefinition<TParams, Record<string, unknown>>,
	runningSummary: string,
): void {
	registerSuiteOwnedTool(pi, tool, {
		activity: {
			categories: ["check-agent", "message-agent"],
			classify: ({ args }) =>
				singleActivity(communicationCategory(args), {
					key: activityKey(args.action, args.to, args.replyTo),
					target: communicationTarget(args),
				}),
		},
		runningSummary,
		summarize: (_args, result, state) => toolResultText(result) || (state === "success" ? "done" : "failed"),
		target: communicationTarget,
	});
}

export function registerNativeSupervisorClient(
	pi: ExtensionAPI,
	options: { includeIntercomFallback?: boolean } = {},
): void {
	if (!readChildMetadata()) return;
	const includeIntercomFallback = options.includeIntercomFallback !== false;
	if (!hasTool(pi, "contact_supervisor")) {
		const tool: ToolDefinition<typeof ContactSupervisorParamsSchema, Record<string, unknown>> = {
			name: "contact_supervisor",
			label: "Contact Supervisor",
			description:
				"Contact the parent/supervisor session for a blocking decision, structured interview, or progress update.",
			parameters: ContactSupervisorParamsSchema,
			execute(_id, params, signal) {
				return sendSupervisorRequest(params as ContactSupervisorParams, signal);
			},
		};
		registerCommunicationTool(pi, tool, "contacting");
	}
	if (includeIntercomFallback && !hasTool(pi, "intercom")) {
		const tool: ToolDefinition<typeof IntercomParamsSchema, Record<string, unknown>> = {
			name: "intercom",
			label: "Intercom",
			description:
				"Native supervisor-channel intercom fallback for subagents. Prefer contact_supervisor when available.",
			parameters: IntercomParamsSchema,
			async execute(_id, params, signal) {
				const action = (params as IntercomParams).action;
				if (action === "status")
					return {
						content: [{ type: "text", text: "Native supervisor channel is active." }],
						details: { active: true },
					};
				if (action === "list")
					return {
						content: [{ type: "text", text: "Supervisor session available through contact_supervisor." }],
						details: { sessions: [] },
					};
				if (action === "send")
					return sendSupervisorRequest(
						{ reason: "progress_update", message: (params as IntercomParams).message ?? "" },
						signal,
					);
				if (action === "ask")
					return sendSupervisorRequest(
						{ reason: "need_decision", message: (params as IntercomParams).message ?? "" },
						signal,
					);
				throw new Error(
					"Native child intercom supports status, list, send, and ask. Use parent intercom reply from the supervisor session.",
				);
			},
		};
		registerCommunicationTool(pi, tool, "sending");
	}
}

function parseRequestFile(file: string, channelDir: string): SupervisorRequestFileRead | undefined {
	let snapshot: OwnedFileSnapshot;
	try {
		snapshot = readBoundedOwnedFileSnapshot(file, MAX_MESSAGE_BYTES);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const parsed = JSON.parse(snapshot.text) as Partial<SupervisorRequest>;
		if (parsed.type !== "subagent.supervisor.request") return { snapshot };
		if (typeof parsed.id !== "string" || !parsed.id.trim() || parsed.id.length > 256) return { snapshot };
		if (
			parsed.reason !== "need_decision" &&
			parsed.reason !== "interview_request" &&
			parsed.reason !== "progress_update"
		)
			return { snapshot };
		const physicalSessionId =
			typeof parsed.physicalSessionId === "string" && parsed.physicalSessionId.trim()
				? parsed.physicalSessionId
				: undefined;
		const protocolVersion = physicalSessionId ? 2 : 1;
		if (
			typeof parsed.message !== "string" ||
			!parsed.message ||
			Buffer.byteLength(parsed.message, "utf-8") > MAX_MESSAGE_BYTES
		)
			return { snapshot };
		if (
			typeof parsed.createdAt !== "number" ||
			!Number.isFinite(parsed.createdAt) ||
			parsed.createdAt <= 0 ||
			(parsed.expiresAt !== undefined &&
				(typeof parsed.expiresAt !== "number" ||
					!Number.isFinite(parsed.expiresAt) ||
					parsed.expiresAt < parsed.createdAt)) ||
			(protocolVersion === 2 && (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt))) ||
			typeof parsed.expectsReply !== "boolean" ||
			parsed.expectsReply !== (parsed.reason !== "progress_update") ||
			typeof parsed.orchestratorSessionId !== "string" ||
			!parsed.orchestratorSessionId.trim() ||
			typeof parsed.runId !== "string" ||
			!parsed.runId.trim() ||
			typeof parsed.agent !== "string" ||
			!parsed.agent.trim() ||
			typeof parsed.childIndex !== "number" ||
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
		return {
			snapshot,
			request: {
				...(parsed as SupervisorRequest),
				protocolVersion,
				channelDir,
				requestFile: file,
				requestSnapshot: snapshot,
			},
		};
	} catch {
		return { snapshot };
	}
}

function requestFilesInChannel(channelDir: string, limit: number): string[] {
	try {
		return fs
			.readdirSync(path.join(channelDir, REQUESTS_DIR), { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.sort((left, right) => left.name.localeCompare(right.name))
			.slice(0, limit)
			.map((entry) => path.join(channelDir, REQUESTS_DIR, entry.name));
	} catch {
		return [];
	}
}

function channelOwnerAlive(metadata: SupervisorChannelMetadata): boolean | undefined {
	if (metadata.ownerProcessStartIdentity) {
		const current = readProcessStartIdentity(metadata.ownerPid);
		if (current) return current === metadata.ownerProcessStartIdentity;
	}
	try {
		process.kill(metadata.ownerPid, 0);
		return undefined;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH" ? false : undefined;
	}
}

function channelRunInactive(metadata: SupervisorChannelMetadata, state: SubagentState): boolean {
	return requestRunInactive(
		{
			type: "subagent.supervisor.request",
			id: "channel-lifecycle",
			createdAt: metadata.updatedAt,
			reason: "progress_update",
			message: "channel lifecycle",
			expectsReply: false,
			physicalSessionId: metadata.physicalSessionId,
			runId: metadata.runId,
			agent: metadata.agent,
			childIndex: metadata.childIndex,
		},
		state,
	);
}

function metadataLessChannelSafeToCollect(channelDir: string, now: number): boolean {
	const resolved = path.resolve(channelDir);
	if (path.dirname(resolved) !== path.resolve(SUPERVISOR_CHANNEL_ROOT)) return false;
	try {
		const stat = fs.lstatSync(resolved);
		const currentUid = process.getuid?.();
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(currentUid !== undefined && stat.uid !== currentUid) ||
			now - stat.mtimeMs < METADATALESS_CHANNEL_GRACE_MS ||
			fs.existsSync(path.join(resolved, CHANNEL_METADATA_FILE))
		) {
			return false;
		}
		for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
			if (entry.name !== REQUESTS_DIR && entry.name !== REPLIES_DIR) return false;
			const child = path.join(resolved, entry.name);
			const childStat = fs.lstatSync(child);
			if (
				!entry.isDirectory() ||
				entry.isSymbolicLink() ||
				(currentUid !== undefined && childStat.uid !== currentUid) ||
				fs.readdirSync(child).length > 0
			) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

export function garbageCollectSupervisorChannel(channelDir: string, state: SubagentState, now = Date.now()): boolean {
	const metadata = readSupervisorChannelMetadata(channelDir);
	if (metadata) {
		if (requestFilesInChannel(channelDir, 1).length > 0) return false;
		if (channelOwnerAlive(metadata) !== false && !channelRunInactive(metadata, state)) return false;
	}
	const claim = tryAcquireDurableClaim(SUPERVISOR_CHANNEL_ROOT, CHANNEL_LIFECYCLE_CLAIM);
	if (!claim) return false;
	try {
		const current = readSupervisorChannelMetadata(channelDir);
		if (!current) {
			if (!metadataLessChannelSafeToCollect(channelDir, now)) return false;
		} else {
			if (requestFilesInChannel(channelDir, 1).length > 0) return false;
			if (channelOwnerAlive(current) !== false && !channelRunInactive(current, state)) return false;
		}
		const resolved = path.resolve(channelDir);
		if (path.dirname(resolved) !== path.resolve(SUPERVISOR_CHANNEL_ROOT)) return false;
		const stat = fs.lstatSync(resolved);
		if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
		fs.rmSync(resolved, { recursive: true });
		return true;
	} catch {
		return false;
	} finally {
		claim.release();
	}
}

function requestMatchesContext(
	request: SupervisorRequest,
	state: Pick<SubagentState, "currentSessionId" | "currentSessionScope">,
	ctx: ExtensionContext,
): boolean {
	const scope = state.currentSessionScope;
	if (!scope || !state.currentSessionId) return false;
	if (request.physicalSessionId) {
		const matches = sessionArtifactMatches(scope, request.physicalSessionId, request.runId);
		if (!matches) return false;
		return (
			request.physicalSessionId === scope.sessionId ||
			scope.startedAtMs === undefined ||
			request.createdAt >= scope.startedAtMs
		);
	}
	let logicalSessionId: string | null | undefined;
	try {
		logicalSessionId = ctx.sessionManager.getSessionId();
	} catch {
		return false;
	}
	return (
		Boolean(logicalSessionId) &&
		request.orchestratorSessionId === logicalSessionId &&
		scope.legacyRunIds.has(request.runId) &&
		(scope.startedAtMs === undefined || request.createdAt >= scope.startedAtMs)
	);
}

function addPersistedSupervisorRequestId(entry: unknown, requestIds: Set<string>): void {
	if (!entry || typeof entry !== "object") return;
	const candidate = entry as { type?: unknown; customType?: unknown; details?: unknown };
	if (candidate.type !== "custom_message" || candidate.customType !== "subagent_supervisor_request") return;
	const details = candidate.details;
	if (!details || typeof details !== "object") return;
	const id = (details as { id?: unknown }).id;
	if (typeof id === "string" && id) requestIds.add(id);
}

/** Build one delivery index for the whole poll instead of rescanning the session per request. */
function persistedSupervisorRequestIds(ctx: ExtensionContext): ReadonlySet<string> {
	const requestIds = new Set<string>();
	try {
		for (const entry of ctx.sessionManager.getEntries()) addPersistedSupervisorRequestId(entry, requestIds);
	} catch {
		// The canonical JSONL tail below remains an independent crash-safe source.
	}

	let sessionFile: string | null | undefined;
	try {
		sessionFile = ctx.sessionManager.getSessionFile();
	} catch {
		return requestIds;
	}
	if (!sessionFile || !path.isAbsolute(sessionFile)) return requestIds;
	let descriptor: number | undefined;
	try {
		const noFollow = (fs.constants as typeof fs.constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
		descriptor = fs.openSync(sessionFile, fs.constants.O_RDONLY | noFollow);
		const stat = fs.fstatSync(descriptor);
		const currentUid = process.getuid?.();
		if (!stat.isFile() || (currentUid !== undefined && stat.uid !== currentUid)) return requestIds;
		const length = Math.min(stat.size, MAX_SESSION_DELIVERY_SCAN_BYTES);
		if (length <= 0) return requestIds;
		const buffer = Buffer.allocUnsafe(length);
		const bytesRead = fs.readSync(descriptor, buffer, 0, length, Math.max(0, stat.size - length));
		let text = buffer.subarray(0, bytesRead).toString("utf-8");
		if (stat.size > length) text = text.slice(Math.max(0, text.indexOf("\n") + 1));
		for (const line of text.split("\n")) {
			if (!line.includes("subagent_supervisor_request")) continue;
			try {
				addPersistedSupervisorRequestId(JSON.parse(line), requestIds);
			} catch {
				// Ignore unrelated or partially written JSONL records.
			}
		}
		return requestIds;
	} catch {
		return requestIds;
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
	}
}

function rememberedForegroundChild(request: SupervisorRequest, state: SubagentState) {
	const run = state.foregroundRuns?.get(request.runId);
	const child =
		run?.children.find((candidate) => candidate.index === request.childIndex && candidate.agent === request.agent) ??
		run?.children[request.childIndex];
	return run && child ? { run, child } : undefined;
}

function markForegroundSupervisorAttention(request: SupervisorRequest, state: SubagentState): void {
	const remembered = rememberedForegroundChild(request, state);
	if (remembered?.child.status !== "detached") return;
	const updatedAt = Date.now();
	remembered.run.updatedAt = updatedAt;
	remembered.child.activityState = "needs_attention";
	remembered.child.lastActivityAt = request.createdAt;
	remembered.child.currentTool = "contact_supervisor";
	remembered.child.currentToolStartedAt = request.createdAt;
	remembered.child.updatedAt = updatedAt;
}

function clearForegroundSupervisorAttention(
	request: SupervisorRequest,
	pending: Map<string, PendingSupervisorRequest>,
	state: SubagentState,
): void {
	if (
		[...pending.values()].some(
			(candidate) =>
				candidate.expectsReply &&
				candidate.runId === request.runId &&
				candidate.agent === request.agent &&
				candidate.childIndex === request.childIndex,
		)
	)
		return;
	const remembered = rememberedForegroundChild(request, state);
	if (remembered?.child.status !== "detached" || remembered.child.currentTool !== "contact_supervisor") return;
	const updatedAt = Date.now();
	remembered.run.updatedAt = updatedAt;
	remembered.child.activityState = undefined;
	remembered.child.lastActivityAt = updatedAt;
	remembered.child.currentTool = undefined;
	remembered.child.currentToolStartedAt = undefined;
	remembered.child.updatedAt = updatedAt;
}

function removeRequestFile(file: string, snapshot?: OwnedFileSnapshot): boolean {
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

type SupervisorRequestLifecycle = "pending" | "resolved" | "expired" | "inactive" | "missing" | "wrong-session";

function requestExpiresAt(request: SupervisorRequest, now: number): number {
	const expiresAt = (request as { expiresAt?: unknown }).expiresAt;
	if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) return expiresAt;
	return Number.isFinite(request.createdAt) ? request.createdAt + askTimeoutMs() : now;
}

function requestRunInactive(request: SupervisorRequest, state: SubagentState): boolean {
	if (state.foregroundControls.has(request.runId)) return false;
	const foreground = rememberedForegroundChild(request, state);
	if (foreground) return foreground.child.status !== "detached";

	const asyncJob = state.asyncJobs.get(request.runId) ?? state.recentAgentJobs?.get(request.runId);
	if (!asyncJob) return false;
	if (
		asyncJob.status === "complete" ||
		asyncJob.status === "failed" ||
		asyncJob.status === "paused" ||
		asyncJob.status === "stopped"
	)
		return true;
	const stepStatus = asyncJob.steps?.[request.childIndex]?.status;
	return (
		stepStatus === "complete" ||
		stepStatus === "completed" ||
		stepStatus === "failed" ||
		stepStatus === "paused" ||
		stepStatus === "stopped"
	);
}

function requestLifecycle(
	request: PendingSupervisorRequest,
	state: SubagentState,
	ctx: ExtensionContext | undefined,
	now: number,
): SupervisorRequestLifecycle {
	if (!fs.existsSync(request.requestFile)) return "missing";
	if (request.expectsReply && fs.existsSync(replyPath(request.channelDir, request.id))) return "resolved";
	if (now > requestExpiresAt(request, now)) return "expired";
	if (ctx && !requestMatchesContext(request, state, ctx)) return "wrong-session";
	if (request.expectsReply && requestRunInactive(request, state)) return "inactive";
	return "pending";
}

function cleanupRequestLifecycle(request: PendingSupervisorRequest, lifecycle: SupervisorRequestLifecycle): void {
	if (lifecycle === "resolved" || lifecycle === "expired" || lifecycle === "inactive")
		removeRequestFile(request.requestFile, request.requestSnapshot);
}

function refreshPendingRequests(
	pending: Map<string, PendingSupervisorRequest>,
	state: SubagentState,
	ctx: ExtensionContext | undefined,
): void {
	const now = Date.now();
	for (const request of pending.values()) {
		const lifecycle = requestLifecycle(request, state, ctx, now);
		if (lifecycle === "pending") continue;
		pending.delete(request.id);
		cleanupRequestLifecycle(request, lifecycle);
		clearForegroundSupervisorAttention(request, pending, state);
	}
}

function formatPendingLine(request: PendingSupervisorRequest): string {
	const replyHint = request.expectsReply
		? ` Reply: ${NATIVE_SUPERVISOR_TOOL_NAME}({ action: "reply", replyTo: "${request.id}", message: "..." })`
		: "";
	return `- ${request.id}: ${request.agent} [${request.runId}#${request.childIndex}] ${request.reason}.${replyHint}`;
}

function requestVisibleText(request: PendingSupervisorRequest): string {
	const lines = [request.message];
	if (request.expectsReply) {
		lines.push(
			"",
			`Reply with: ${NATIVE_SUPERVISOR_TOOL_NAME}({ action: "reply", replyTo: "${request.id}", message: "..." })`,
		);
	}
	return lines.join("\n");
}

function writeReply(
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
	if (Buffer.byteLength(JSON.stringify(reply), "utf-8") > MAX_MESSAGE_BYTES) {
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
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	let replySnapshot: OwnedFileSnapshot;
	try {
		replySnapshot = readBoundedOwnedFileSnapshot(outputPath, MAX_MESSAGE_BYTES);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	removeOwnedFileSnapshot(outputPath, replySnapshot);
	throw new Error(`Supervisor request '${request.id}' is no longer pending.`);
}

function resolvePendingRequest(
	pending: Map<string, PendingSupervisorRequest>,
	params: IntercomParams,
): PendingSupervisorRequest {
	if (params.replyTo) {
		const request = pending.get(params.replyTo);
		if (!request) throw new Error(`No pending supervisor request found for replyTo '${params.replyTo}'.`);
		return request;
	}
	const requests = [...pending.values()].filter((request) => request.expectsReply);
	if (params.to) {
		const normalizedTo = params.to.toLowerCase();
		const matches = requests.filter(
			(request) =>
				request.id.toLowerCase().startsWith(normalizedTo) ||
				request.agent.toLowerCase() === normalizedTo ||
				request.childTarget?.toLowerCase() === normalizedTo,
		);
		const match = matches.at(0);
		if (matches.length === 1 && match) return match;
		if (matches.length > 1)
			throw new Error(`Multiple pending supervisor requests match '${params.to}'. Use replyTo.`);
	}
	const request = requests.at(0);
	if (requests.length === 1 && request) return request;
	if (requests.length === 0) throw new Error("No pending supervisor requests need a reply.");
	throw new Error("Multiple pending supervisor requests need replies. Use replyTo.");
}

function publicPendingRequests(pending: Map<string, PendingSupervisorRequest>): Array<Record<string, unknown>> {
	return [...pending.values()].map((request) => ({
		id: request.id,
		runId: request.runId,
		agent: request.agent,
		childIndex: request.childIndex,
		reason: request.reason,
		expectsReply: request.expectsReply,
	}));
}

function buildParentIntercomTool(
	pending: Map<string, PendingSupervisorRequest>,
	state: SubagentState,
	name = "intercom",
	afterReplyPublish?: (replyPath: string) => void,
): ToolDefinition<typeof IntercomParamsSchema, Record<string, unknown>> {
	return {
		name,
		label: name === "intercom" ? "Intercom" : "Subagent Supervisor",
		description:
			name === "intercom"
				? "Native pi-subagents supervisor channel. Use reply/pending/status to answer child subagent requests."
				: "Native pi-subagents supervisor channel. Use reply/pending/status to answer child subagent requests without overriding pi-intercom.",
		parameters: IntercomParamsSchema,
		async execute(_id, params) {
			refreshPendingRequests(pending, state, state.lastUiContext ?? undefined);
			const input = params as IntercomParams;
			if (input.action === "status") {
				return {
					content: [{ type: "text", text: `Native supervisor channel active. Pending replies: ${pending.size}.` }],
					details: { active: true, pending: pending.size, root: SUPERVISOR_CHANNEL_ROOT },
				};
			}
			if (input.action === "pending" || input.action === "list") {
				const lines = [...pending.values()].filter((request) => request.expectsReply).map(formatPendingLine);
				return {
					content: [{ type: "text", text: lines.length ? lines.join("\n") : "No pending supervisor requests." }],
					details: { pending: publicPendingRequests(pending) },
				};
			}
			if (input.action === "reply") {
				const request = resolvePendingRequest(pending, input);
				writeReply(request, input.message ?? "", afterReplyPublish);
				pending.delete(request.id);
				clearForegroundSupervisorAttention(request, pending, state);
				return {
					content: [{ type: "text", text: `Replied to supervisor request ${request.id}.` }],
					details: { replyTo: request.id, runId: request.runId, agent: request.agent },
				};
			}
			if (input.action === "send" || input.action === "ask") {
				throw new Error(
					"Native pi-subagents intercom currently handles supervisor replies. Child agents initiate asks with contact_supervisor.",
				);
			}
			throw new Error(`Unsupported intercom action: ${input.action}`);
		},
	};
}

export function createNativeSupervisorChannel(
	pi: ExtensionAPI,
	state: SubagentState,
	options: {
		acquireDeliveryClaim?: typeof tryAcquireDurableClaim;
		afterReplyPublish?: (replyPath: string) => void;
	} = {},
): { start: () => void; pause: () => void; dispose: () => void; pending: Map<string, PendingSupervisorRequest> } {
	const pending = new Map<string, PendingSupervisorRequest>();
	let poller: ReturnType<typeof setInterval> | undefined;
	let channelScanner: fs.Dir | undefined;
	let lifecycleGeneration = 0;
	const deliveryClaims = new Map<string, DurableClaim>();
	const deliveryClaimFiles = new Map<string, string>();
	const deliveryDispatches = new Map<string, object>();
	const acquireDeliveryClaim = options.acquireDeliveryClaim ?? tryAcquireDurableClaim;
	const releaseDeliveryClaim = (requestId: string): void => {
		try {
			deliveryClaims.get(requestId)?.release();
		} catch (error) {
			reportAgentDiagnostic(`Failed to release supervisor delivery claim '${requestId}':`, error);
		} finally {
			deliveryClaims.delete(requestId);
			deliveryClaimFiles.delete(requestId);
		}
	};
	const releaseAllDeliveryClaims = (): void => {
		for (const requestId of [...deliveryClaims.keys()]) releaseDeliveryClaim(requestId);
	};

	const registerPrimaryParentTool = (): void => {
		if (!hasTool(pi, NATIVE_SUPERVISOR_TOOL_NAME))
			registerCommunicationTool(
				pi,
				buildParentIntercomTool(pending, state, NATIVE_SUPERVISOR_TOOL_NAME, options.afterReplyPublish),
				"checking",
			);
	};
	const registerParentIntercomFallback = (): void => {
		if (!hasTool(pi, "intercom"))
			registerCommunicationTool(
				pi,
				buildParentIntercomTool(pending, state, "intercom", options.afterReplyPublish),
				"checking",
			);
	};
	pi.on("before_agent_start", () => {
		if (poller) registerParentIntercomFallback();
	});

	const closeChannelScanner = (): void => {
		try {
			channelScanner?.closeSync();
		} catch {}
		channelScanner = undefined;
	};
	const scanRequestFiles = (): Array<{ channelDir: string; file: string }> => {
		const files: Array<{ channelDir: string; file: string }> = [];
		let scannedChannels = 0;
		try {
			channelScanner ??= fs.opendirSync(SUPERVISOR_CHANNEL_ROOT);
			while (scannedChannels < MAX_CHANNEL_DIRS_PER_POLL && files.length < MAX_REQUEST_FILES_PER_POLL) {
				const entry = channelScanner.readSync();
				if (!entry) {
					closeChannelScanner();
					break;
				}
				scannedChannels += 1;
				if (!entry.isDirectory()) continue;
				const channelDir = path.join(SUPERVISOR_CHANNEL_ROOT, entry.name);
				const requestFiles = requestFilesInChannel(channelDir, MAX_REQUEST_FILES_PER_POLL - files.length);
				if (requestFiles.length === 0) garbageCollectSupervisorChannel(channelDir, state);
				else files.push(...requestFiles.map((file) => ({ channelDir, file })));
			}
		} catch (error) {
			closeChannelScanner();
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return files;
	};

	const poll = (): void => {
		try {
			const ctx = state.lastUiContext;
			if (!ctx) return;
			refreshPendingRequests(pending, state, ctx);
			for (const requestId of deliveryClaims.keys()) {
				const requestFile = deliveryClaimFiles.get(requestId);
				if (requestFile && fs.existsSync(requestFile)) continue;
				releaseDeliveryClaim(requestId);
			}
			const now = Date.now();
			const requestFiles = scanRequestFiles();
			let persistedRequestIds: ReadonlySet<string> | undefined;
			for (const { channelDir, file } of requestFiles) {
				try {
					let parsedRequest = parseRequestFile(file, channelDir);
					if (!parsedRequest) continue;
					let request = parsedRequest.request;
					if (!request) {
						removeRequestFile(file, parsedRequest.snapshot);
						continue;
					}
					const requestId = request.id;
					if (deliveryDispatches.has(requestId)) continue;
					let claim = deliveryClaims.get(requestId);
					if (!claim) {
						claim = acquireDeliveryClaim(path.dirname(file), requestDeliveryClaimName(requestId));
						if (!claim) continue;
						deliveryClaims.set(requestId, claim);
						deliveryClaimFiles.set(requestId, file);
					}
					// Re-read under the cross-process claim. The request may have been
					// replied to, expired, or replaced since the directory scan.
					parsedRequest = parseRequestFile(file, channelDir);
					request = parsedRequest?.request;
					if (!request) {
						if (parsedRequest) removeRequestFile(file, parsedRequest.snapshot);
						releaseDeliveryClaim(requestId);
						continue;
					}
					const lifecycle = requestLifecycle(request, state, ctx, now);
					if (lifecycle === "wrong-session") {
						releaseDeliveryClaim(request.id);
						continue;
					}
					if (lifecycle !== "pending") {
						cleanupRequestLifecycle(request, lifecycle);
						releaseDeliveryClaim(request.id);
						continue;
					}
					let deliveryState = readRequestDeliveryState(request.requestFile, request.id);
					if (
						deliveryState &&
						deliveryState.acceptedAt === undefined &&
						now - deliveryState.lastAttemptAt < DELIVERY_RETRY_GRACE_MS
					) {
						continue;
					}
					if (deliveryState?.acceptedAt === undefined) {
						persistedRequestIds ??= persistedSupervisorRequestIds(ctx);
					}
					if (persistedRequestIds?.has(request.id) && deliveryState?.acceptedAt === undefined) {
						deliveryState = {
							version: 2,
							requestId: request.id,
							lastAttemptAt: deliveryState?.lastAttemptAt ?? now,
							acceptedAt: now,
						};
						writeRequestDeliveryState(request.requestFile, deliveryState);
					}
					if (deliveryState?.acceptedAt !== undefined) {
						if (request.expectsReply) {
							// The delivery claim is also the durable reply-owner claim. Keep it
							// until this host replies, disposes, or the request expires so a
							// second Pi host cannot become a concurrent responder.
							pending.set(request.id, request);
							markForegroundSupervisorAttention(request, state);
						} else {
							removeRequestFile(request.requestFile, request.requestSnapshot);
							releaseDeliveryClaim(request.id);
						}
						continue;
					}
					// Context preparation introduces an async gap, so hold one in-memory
					// dispatch per durable request. The attempt is still not accepted until
					// the request id appears in the canonical session file or active
					// SessionManager; a Host crash before append therefore remains retryable.
					writeRequestDeliveryState(request.requestFile, {
						version: 2,
						requestId: request.id,
						lastAttemptAt: now,
					});
					const dispatchGeneration = lifecycleGeneration;
					const deliveredRequest = request;
					const dispatchToken = {};
					deliveryDispatches.set(request.id, dispatchToken);
					const acceptDelivery = (): void => {
						if (!deliveredRequest.expectsReply) return;
						pending.set(deliveredRequest.id, deliveredRequest);
						markForegroundSupervisorAttention(deliveredRequest, state);
						try {
							(pi as { events?: IntercomEventBus }).events?.emit(INTERCOM_DETACH_REQUEST_EVENT, {
								requestId: deliveredRequest.id,
								runId: deliveredRequest.runId,
								agent: deliveredRequest.agent,
								childIndex: deliveredRequest.childIndex,
							});
						} catch (error) {
							reportAgentDiagnostic(
								`Supervisor detach observer failed for request '${deliveredRequest.id}':`,
								error,
							);
						}
					};
					void deliverSuiteAgentMessage(
						pi,
						withAgentWorkOrigin(
							{
								customType: "subagent_supervisor_request",
								content: requestVisibleText(request),
								display: true,
								details: {
									id: request.id,
									reason: request.reason,
									expectsReply: request.expectsReply,
									runId: request.runId,
									agent: request.agent,
									childIndex: request.childIndex,
								},
							},
							"automatic",
						),
						{ triggerTurn: true },
						() => lifecycleGeneration === dispatchGeneration && state.lastUiContext === ctx,
						acceptDelivery,
					)
						.then((delivery) => {
							if (delivery !== "convergence-blocked") return;
							if (deliveredRequest.expectsReply) {
								writeReply(
									deliveredRequest,
									"The parent reached its whole-work convergence boundary. Continue independently, avoid further parent requests, and return your best supported result now.",
								);
							} else {
								cleanupRequestLifecycle(deliveredRequest, "resolved");
							}
						})
						.catch((error) => {
							reportAgentDiagnostic(
								`Failed to deliver supervisor request '${file}'; retaining it for retry:`,
								error,
							);
						})
						.finally(() => {
							if (deliveryDispatches.get(deliveredRequest.id) === dispatchToken) {
								deliveryDispatches.delete(deliveredRequest.id);
							}
						});
				} catch (error) {
					reportAgentDiagnostic(`Failed to deliver supervisor request '${file}'; retaining it for retry:`, error);
				}
			}
		} catch (error) {
			reportAgentDiagnostic("Native supervisor channel poll failed; the next interval will retry:", error);
		}
	};

	return {
		start: () => {
			if (poller) return;
			lifecycleGeneration += 1;
			registerPrimaryParentTool();
			poll();
			poller = setInterval(poll, CHANNEL_POLL_MS);
			poller.unref?.();
		},
		pause: () => {
			lifecycleGeneration += 1;
			if (poller) clearInterval(poller);
			poller = undefined;
			deliveryDispatches.clear();
			closeChannelScanner();
			pending.clear();
			// A paused channel no longer represents the active physical session.
			// Retaining reply-owner claims here would strand the child request until
			// this Host exits, preventing another live Host from taking ownership.
			releaseAllDeliveryClaims();
		},
		dispose: () => {
			lifecycleGeneration += 1;
			if (poller) clearInterval(poller);
			poller = undefined;
			deliveryDispatches.clear();
			closeChannelScanner();
			pending.clear();
			releaseAllDeliveryClaims();
		},
		pending,
	};
}
