import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerSuiteOwnedTool } from "@jczhang02/pi-stuff-tools";
import type { TSchema } from "typebox";
import { registerNativeSupervisorClient } from "../../intercom/native-supervisor-channel.ts";
import type { JsonSchemaObject, ResolvedToolBudget } from "../../shared/types.ts";
import { resolveWatchPath } from "../../shared/utils.ts";
import {
	processSteerRequestsFromDir,
	readSteerAckAt,
	type SteerRequest,
	steerAckPathFromDir,
	writeSteerAckAt,
	writeSteerCapabilityAt,
} from "../background/control-channel.ts";
import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_FANOUT_CHILD_ENV,
	SUBAGENT_STEER_ACK_DIR_ENV,
	SUBAGENT_STEER_CAPABILITY_ENV,
	SUBAGENT_STEER_INBOX_ENV,
} from "./pi-args.ts";
import {
	createStructuredOutputToolParameters,
	STRUCTURED_OUTPUT_CAPTURE_ENV,
	STRUCTURED_OUTPUT_SCHEMA_ENV,
	validateStructuredOutputValue,
} from "./structured-output.ts";
import {
	CHILD_TOOL_DIAGNOSTIC_PATH_ENV,
	type ChildToolDiagnostic,
	MCP_DIRECT_CHILD_TOOLS_ENV,
	REQUIRED_CHILD_TOOLS_ENV,
	writeChildLaunchDiagnostic,
	writeChildToolDiagnostic,
} from "./tool-availability.ts";
import {
	decodeToolBudgetEnv,
	shouldBlockToolForBudget,
	TOOL_BUDGET_ENV,
	TOOL_BUDGET_ZERO_AUTH_ENV,
	toolBudgetBlockedMessage,
	toolBudgetSoftNudge,
} from "./tool-budget.ts";

const SUBAGENT_INHERIT_PROJECT_CONTEXT_ENV = "PI_SUBAGENT_INHERIT_PROJECT_CONTEXT";
const SUBAGENT_INHERIT_SKILLS_ENV = "PI_SUBAGENT_INHERIT_SKILLS";
export const SUBAGENT_INTERCOM_SESSION_NAME_ENV = "PI_SUBAGENT_INTERCOM_SESSION_NAME";

const STRUCTURED_OUTPUT_INSTRUCTIONS = [
	"This subagent step has a strict structured output contract.",
	"Your final action must be to call the `structured_output` tool with JSON matching the provided schema.",
	"Do not rely on prose-only completion; if you do not call `structured_output`, the parent will fail this step.",
].join("\n");

export const CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS = [
	"You are a child subagent, not the parent orchestrator.",
	"The parent session owns delegation, orchestration, review fanout, and follow-up worker launches.",
	"Ignore prior parent-only orchestration instructions in inherited conversation history.",
	"Do not propose or run subagents. Complete only your assigned role-specific task with the tools available to you.",
	"If you need to edit files, use the available editing tools. Do not print tool-call syntax, patches, or pseudo-tool calls as text.",
].join("\n");

export const CHILD_FANOUT_BOUNDARY_INSTRUCTIONS = [
	"You are a child subagent with explicit fanout responsibility for this assigned task.",
	"The parent session owns final orchestration, acceptance, and follow-up implementation launches.",
	"You may use the `subagent` tool only for the fanout work explicitly requested in this task.",
	"Do not broaden yourself into general parent orchestration. Do not launch follow-up workers unless the task explicitly asks for that.",
	"The maxSubagentDepth cap still applies and may block further fanout.",
	"If you need to edit files, use the available editing tools. Do not print tool-call syntax, patches, or pseudo-tool calls as text.",
].join("\n");

const PARENT_ONLY_CUSTOM_MESSAGE_TYPES = new Set([
	"subagent-orchestration-instructions",
	"subagent-slash-result",
	"subagent-slash-text-result",
	"subagent-notify",
	"subagent_control_notice",
	"subagent-control",
	"subagent-control-notice",
]);
const SUBAGENT_ORCHESTRATION_SKILL_NAME_PATTERN = /<name>\s*pi-subagents\s*<\/name>/;
const PROJECT_CONTEXT_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";
const PROJECT_CONTEXT_XML_START = "\n\n<project_context>";
const PROJECT_CONTEXT_XML_END = "</project_context>";
const SKILLS_HEADER = "The following skills provide specialized instructions for specific tasks.";
const DATE_HEADER = "\nCurrent date:";
const WORKING_DIRECTORY_HEADER = "\nCurrent working directory:";
const CHILD_FINAL_PAYLOAD_RESERVE_RATIO = 0.25;

function finalProviderPayloadCapacity(ctx: {
	model?: { contextWindow?: number; maxTokens?: number };
}): number | undefined {
	const contextWindow = ctx.model?.contextWindow;
	const maxTokens = ctx.model?.maxTokens;
	if (
		typeof contextWindow !== "number" ||
		!Number.isFinite(contextWindow) ||
		contextWindow <= 0 ||
		typeof maxTokens !== "number" ||
		!Number.isFinite(maxTokens) ||
		maxTokens <= 0
	)
		return undefined;
	return Math.max(0, Math.floor(contextWindow - maxTokens - contextWindow * CHILD_FINAL_PAYLOAD_RESERVE_RATIO));
}

export function validateFinalProviderPayload(
	payload: unknown,
	model: { contextWindow?: number; maxTokens?: number } | undefined,
): { ok: true } | { ok: false; message: string } {
	const capacity = finalProviderPayloadCapacity({ model });
	if (capacity === undefined) return { ok: true };
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(payload);
	} catch {
		// A provider request that cannot be measured must not bypass the final gate.
	}
	if (serialized === undefined) {
		return {
			ok: false,
			message:
				"Agent launch stopped before the provider request because the final child payload could not be measured safely.",
		};
	}
	const bytes = Buffer.byteLength(serialized, "utf8");
	if (bytes <= capacity) return { ok: true };
	return {
		ok: false,
		message: `Agent launch stopped before the provider request: the final child payload is ${bytes.toLocaleString(
			"en-US",
		)} UTF-8 bytes, above the safe ${capacity.toLocaleString(
			"en-US",
		)}-byte input bound for this model. Reduce the delegated context, Tools, or child extensions, or choose a model with a larger context window.`,
	};
}

function readBooleanEnv(name: string): boolean | undefined {
	const value = process.env[name];
	if (value === undefined) return undefined;
	return value !== "0";
}

function readRequiredChildTools(): string[] | undefined {
	const encoded = process.env[REQUIRED_CHILD_TOOLS_ENV]?.trim();
	if (!encoded) return undefined;
	const required = JSON.parse(encoded) as unknown;
	if (!Array.isArray(required) || required.some((name) => typeof name !== "string" || !name)) {
		throw new Error(`Invalid ${REQUIRED_CHILD_TOOLS_ENV} payload.`);
	}
	return required;
}

function readMcpDirectChildTools(): string[] | undefined {
	const encoded = process.env[MCP_DIRECT_CHILD_TOOLS_ENV]?.trim();
	if (!encoded) return undefined;
	try {
		const tools = JSON.parse(encoded) as unknown;
		if (!Array.isArray(tools) || tools.some((name) => typeof name !== "string" || !name)) return undefined;
		return tools;
	} catch {
		return undefined;
	}
}

function refreshChildToolDiagnostic(pi: ExtensionAPI): ChildToolDiagnostic | undefined {
	const filePath = process.env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV]?.trim();
	const required = readRequiredChildTools();
	if (!filePath || !required) return undefined;
	const available = pi.getAllTools().map((tool) => tool.name);
	return writeChildToolDiagnostic(
		filePath,
		required,
		available,
		process.env[SUBAGENT_CHILD_AGENT_ENV]?.trim(),
		readMcpDirectChildTools(),
	);
}

function findSectionEnd(prompt: string, startIndex: number, nextHeaders: string[]): number {
	let endIndex = prompt.length;
	for (const header of nextHeaders) {
		const index = prompt.indexOf(header, startIndex);
		if (index !== -1 && index < endIndex) {
			endIndex = index;
		}
	}
	return endIndex;
}

function removePromptSection(prompt: string, startIndex: number, endIndex: number): string {
	const before = prompt.slice(0, startIndex).trimEnd();
	const after = prompt.slice(endIndex).trimStart();
	if (!before) return after;
	if (!after) return before;
	return `${before}\n${after}`;
}

export function stripProjectContext(prompt: string): string {
	let rewritten = prompt;
	const xmlStart = rewritten.lastIndexOf(PROJECT_CONTEXT_XML_START);
	if (xmlStart !== -1) {
		// Project instruction files are embedded verbatim and may themselves contain
		// the closing tag. The Host-owned wrapper is necessarily the final closing
		// tag because it is appended after every embedded file.
		const closing = rewritten.lastIndexOf(PROJECT_CONTEXT_XML_END);
		if (closing !== -1) {
			let end = closing + PROJECT_CONTEXT_XML_END.length;
			if (rewritten[end] === "\r") end += 1;
			if (rewritten[end] === "\n") end += 1;
			rewritten = removePromptSection(rewritten, xmlStart, end);
		}
	}
	const legacyStart = rewritten.lastIndexOf(PROJECT_CONTEXT_HEADER);
	if (legacyStart === -1) return rewritten;
	const legacyEnd = findSectionEnd(rewritten, legacyStart + PROJECT_CONTEXT_HEADER.length, [
		SKILLS_HEADER,
		DATE_HEADER,
		WORKING_DIRECTORY_HEADER,
	]);
	return removePromptSection(rewritten, legacyStart, legacyEnd);
}

export function stripInheritedSkills(prompt: string): string {
	const availableSkillsEnd = prompt.lastIndexOf("</available_skills>");
	if (availableSkillsEnd === -1) return prompt;
	const availableSkillsStart = prompt.lastIndexOf("<available_skills>", availableSkillsEnd);
	if (availableSkillsStart === -1) return prompt;
	const headerIndex = prompt.lastIndexOf(SKILLS_HEADER, availableSkillsStart);
	if (headerIndex === -1) return prompt;
	let startIndex = headerIndex;
	while (startIndex > 0 && (prompt[startIndex - 1] === "\n" || prompt[startIndex - 1] === "\r")) startIndex -= 1;
	let endIndex = availableSkillsEnd + "</available_skills>".length;
	if (prompt[endIndex] === "\r") endIndex += 1;
	if (prompt[endIndex] === "\n") endIndex += 1;
	return removePromptSection(prompt, startIndex, endIndex);
}

export function stripSubagentOrchestrationSkill(prompt: string): string {
	return prompt
		.replace(/\n{0,2}<skill\s+name=["']pi-subagents["'][^>]*>[\s\S]*?<\/skill>\n{0,2}/g, "\n\n")
		.replace(/[ \t]*<skill>\s*[\s\S]*?<\/skill>\s*/g, (block) =>
			SUBAGENT_ORCHESTRATION_SKILL_NAME_PATTERN.test(block) ? "" : block,
		);
}

function stripChildBoundaryInstructions(prompt: string): string {
	let rewritten = prompt;
	for (const boundary of [CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS, CHILD_FANOUT_BOUNDARY_INSTRUCTIONS]) {
		rewritten = rewritten.split(boundary).join("");
	}
	return rewritten.replace(/^(?:[ \t]*\r?\n)+/, "");
}

export function rewriteSubagentPrompt(
	prompt: string,
	options: { inheritProjectContext: boolean; inheritSkills: boolean; fanoutChild?: boolean },
): string {
	let rewritten = prompt;
	if (!options.inheritProjectContext) {
		rewritten = stripProjectContext(rewritten);
	}
	if (!options.inheritSkills) {
		rewritten = stripInheritedSkills(rewritten);
	}
	rewritten = stripSubagentOrchestrationSkill(rewritten);
	rewritten = stripChildBoundaryInstructions(rewritten);
	const boundary = options.fanoutChild ? CHILD_FANOUT_BOUNDARY_INSTRUCTIONS : CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS;
	const structured = process.env[STRUCTURED_OUTPUT_CAPTURE_ENV] ? `\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}` : "";
	return `${boundary}${structured}\n\n${rewritten}`;
}

function isParentOnlySubagentMessage(message: unknown): boolean {
	const m = message as { role?: string; customType?: string };
	if (m?.role !== "custom" || typeof m.customType !== "string") return false;
	return PARENT_ONLY_CUSTOM_MESSAGE_TYPES.has(m.customType);
}

function isSubagentToolResultMessage(message: unknown): boolean {
	const m = message as { role?: string; toolName?: string };
	return m?.role === "toolResult" && m.toolName === "subagent";
}

function isSubagentToolCallBlock(block: unknown): boolean {
	const b = block as { type?: string; name?: string };
	return b?.type === "toolCall" && b.name === "subagent";
}

function stripAssistantSubagentToolCallBlocks(message: unknown): unknown | undefined {
	const m = message as { role?: string; content?: unknown };
	if (m?.role !== "assistant" || !Array.isArray(m.content)) return message;
	const filteredContent = m.content.filter((block) => !isSubagentToolCallBlock(block));
	if (filteredContent.length === m.content.length) return message;
	if (filteredContent.length === 0) return undefined;
	return { ...m, content: filteredContent };
}

export function stripParentOnlySubagentMessages(messages: unknown[]): unknown[] {
	const preserveCurrentFanoutToolHistory = process.env[SUBAGENT_FANOUT_CHILD_ENV] === "1";
	let changed = false;
	const filtered: unknown[] = [];
	for (const message of messages) {
		if (
			isParentOnlySubagentMessage(message) ||
			(!preserveCurrentFanoutToolHistory && isSubagentToolResultMessage(message))
		) {
			changed = true;
			continue;
		}
		const stripped = preserveCurrentFanoutToolHistory ? message : stripAssistantSubagentToolCallBlocks(message);
		if (stripped === undefined) {
			changed = true;
			continue;
		}
		if (stripped !== message) changed = true;
		filtered.push(stripped);
	}
	return changed ? filtered : messages;
}

export function formatSteerMessage(request: SteerRequest): string {
	const marker = Buffer.from(request.id, "utf-8").toString("base64url");
	return [
		`<pi-stuff-steer request="${marker}">`,
		"Mid-run steering from the parent orchestrator:",
		"",
		request.message,
		"",
		"Incorporate this guidance at the next safe point. Do not restart the task unless the guidance explicitly asks you to.",
		"</pi-stuff-steer>",
	].join("\n");
}

function steerRequestIdFromInput(text: string): string | undefined {
	const encoded = /<pi-stuff-steer request="([A-Za-z0-9_-]{1,342})">/u.exec(text)?.[1];
	if (!encoded) return undefined;
	try {
		const requestId = Buffer.from(encoded, "base64url").toString("utf-8");
		return /^\S{1,256}$/u.test(requestId) ? requestId : undefined;
	} catch {
		return undefined;
	}
}

export function registerToolBudget(pi: ExtensionAPI, budget: ResolvedToolBudget | undefined): void {
	if (!budget) return;
	let toolCount = 0;
	let softNudged = false;
	const sendUserMessage = (pi as { sendUserMessage?: (content: string, options: { deliverAs: "steer" }) => unknown })
		.sendUserMessage;
	const onRuntimeEvent = pi.on as unknown as (
		event: string,
		handler: (event: { toolName?: string }) => unknown,
	) => void;
	onRuntimeEvent("tool_call", (event) => {
		const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
		toolCount++;
		if (budget.soft !== undefined && toolCount >= budget.soft && !softNudged) {
			softNudged = true;
			try {
				const dispatched = sendUserMessage?.(toolBudgetSoftNudge(budget, toolCount), { deliverAs: "steer" });
				if (dispatched && typeof (dispatched as PromiseLike<unknown>).then === "function") {
					void Promise.resolve(dispatched).catch(() => {
						// Budget nudges are advisory; blocking below remains authoritative.
					});
				}
			} catch {
				// Budget nudges are advisory; blocking below remains authoritative.
			}
		}
		if (!shouldBlockToolForBudget(budget, toolName, toolCount)) return undefined;
		return { block: true, reason: toolBudgetBlockedMessage(budget, toolName, toolCount) };
	});
}

export function registerSteeringInbox(
	pi: ExtensionAPI,
	deps: { watch?: typeof fs.watch; nativeRealpath?: (filePath: string) => string } = {},
): void {
	const steerInbox = process.env[SUBAGENT_STEER_INBOX_ENV]?.trim();
	if (!steerInbox) return;
	const capabilityPath = process.env[SUBAGENT_STEER_CAPABILITY_ENV]?.trim();
	const ackDir = process.env[SUBAGENT_STEER_ACK_DIR_ENV]?.trim();
	const sendUserMessage = (pi as { sendUserMessage?: (content: string, options: { deliverAs: "steer" }) => unknown })
		.sendUserMessage;
	const childIndex = Number(process.env[SUBAGENT_CHILD_INDEX_ENV]);
	type PendingDelivery = { request: SteerRequest; complete: () => boolean };
	type PendingAck = {
		request: SteerRequest;
		state: "delivered" | "failed";
		message: string;
		complete: () => boolean;
	};
	const pendingById = new Map<string, PendingDelivery>();
	const pendingAcks = new Map<string, PendingAck>();
	let disposed = false;
	let flushing = false;
	let started = false;
	const canSteer = typeof sendUserMessage === "function";
	let watcher: fs.FSWatcher | undefined;
	let interval: NodeJS.Timeout | undefined;
	let lastRuntimeError = "";
	let lastRuntimeErrorAt = 0;
	const reportRuntimeError = (context: string, error: unknown): void => {
		const message = `${context}: ${error instanceof Error ? error.message : String(error)}`;
		const now = Date.now();
		if (message === lastRuntimeError && now - lastRuntimeErrorAt < 30_000) return;
		lastRuntimeError = message;
		lastRuntimeErrorAt = now;
		console.error(`[pi-stuff-agents] ${message}`);
	};
	const acknowledge = (
		request: SteerRequest,
		state: "delivered" | "failed",
		message: string,
		complete: () => boolean,
	): boolean => {
		if (!ackDir || !Number.isInteger(childIndex) || childIndex < 0) {
			pendingAcks.delete(request.id);
			complete();
			return true;
		}
		try {
			writeSteerAckAt(steerAckPathFromDir(ackDir, request.id), {
				requestId: request.id,
				index: childIndex,
				ts: Date.now(),
				state,
				message,
			});
			pendingAcks.delete(request.id);
			complete();
			return true;
		} catch (error) {
			pendingAcks.set(request.id, { request, state, message, complete });
			reportRuntimeError(`Failed to persist steering acknowledgement '${request.id}'`, error);
			return false;
		}
	};
	const retryAcknowledgements = (): void => {
		for (const { request, state, message, complete } of [...pendingAcks.values()])
			acknowledge(request, state, message, complete);
	};
	const forgetPendingDelivery = (delivery: PendingDelivery): void => {
		pendingById.delete(delivery.request.id);
	};
	const existingAcknowledgement = (request: SteerRequest): boolean => {
		if (!ackDir || !Number.isInteger(childIndex) || childIndex < 0) return false;
		const ack = readSteerAckAt(steerAckPathFromDir(ackDir, request.id));
		return ack?.requestId === request.id && ack.index === childIndex;
	};
	const publishCapability = (): void => {
		if (!capabilityPath || !Number.isInteger(childIndex) || childIndex < 0) return;
		writeSteerCapabilityAt(capabilityPath, {
			index: childIndex,
			pid: process.pid,
			readyAt: Date.now(),
			supported: canSteer,
		});
	};
	const flush = (): void => {
		if (disposed || flushing) return;
		flushing = true;
		try {
			retryAcknowledgements();
			processSteerRequestsFromDir(steerInbox, (request, complete) => {
				if (existingAcknowledgement(request)) {
					complete();
					return "retain";
				}
				if (pendingById.has(request.id) || pendingAcks.has(request.id)) return "retain";
				if (!canSteer || typeof sendUserMessage !== "function") {
					acknowledge(request, "failed", "Child Pi session does not support sendUserMessage steering.", complete);
					return "retain";
				}
				const formatted = formatSteerMessage(request);
				const delivery: PendingDelivery = { request, complete };
				pendingById.set(request.id, delivery);
				try {
					const dispatched = sendUserMessage(formatted, { deliverAs: "steer" });
					if (dispatched && typeof (dispatched as PromiseLike<unknown>).then === "function") {
						void Promise.resolve(dispatched).catch((error) => {
							if (pendingById.get(request.id) !== delivery) return;
							forgetPendingDelivery(delivery);
							acknowledge(request, "failed", error instanceof Error ? error.message : String(error), complete);
						});
					}
				} catch (error) {
					forgetPendingDelivery(delivery);
					acknowledge(request, "failed", error instanceof Error ? error.message : String(error), complete);
				}
				return "retain";
			});
		} finally {
			flushing = false;
		}
	};
	const safeFlush = (): void => {
		try {
			flush();
		} catch (error) {
			reportRuntimeError("Failed to process child steering inbox", error);
		}
	};
	const onInput = (event: unknown): undefined => {
		if (disposed || !event || typeof event !== "object") return undefined;
		const input = event as { source?: unknown; streamingBehavior?: unknown; text?: unknown; content?: unknown };
		// Pi reports `steer` only when the Agent is still streaming. If the same
		// accepted extension message arrives just after the stream ends, it starts a
		// normal turn and the field is undefined. Exact pending-text correlation makes
		// both forms authoritative while still rejecting queued follow-ups.
		if (
			input.source !== "extension" ||
			(input.streamingBehavior !== undefined && input.streamingBehavior !== "steer")
		)
			return undefined;
		const text =
			typeof input.text === "string" ? input.text : typeof input.content === "string" ? input.content : undefined;
		if (!text) return undefined;
		const requestId = steerRequestIdFromInput(text);
		const delivery = requestId ? pendingById.get(requestId) : undefined;
		if (!delivery) return undefined;
		forgetPendingDelivery(delivery);
		acknowledge(delivery.request, "delivered", "Pi accepted the correlated steering input.", delivery.complete);
		return undefined;
	};
	const start = (): void => {
		if (started || disposed) return;
		try {
			fs.mkdirSync(steerInbox, { recursive: true });
			publishCapability();
		} catch {
			return;
		}
		started = true;
		try {
			watcher = (deps.watch ?? fs.watch)(resolveWatchPath(steerInbox, deps.nativeRealpath), safeFlush);
			watcher.on("error", () => {});
		} catch {
			watcher = undefined;
		}
		interval = setInterval(safeFlush, 250);
		interval.unref?.();
	};
	const activate = (): undefined => {
		start();
		safeFlush();
		return undefined;
	};

	const onRuntimeEvent = pi.on as unknown as (event: string, handler: (event: unknown) => unknown) => void;
	// Register input before the watcher so an accepted extension input cannot race request dispatch.
	onRuntimeEvent("input", onInput);
	onRuntimeEvent("session_start", activate);
	for (const eventName of [
		"message_start",
		"message_update",
		"message_end",
		"tool_execution_start",
		"tool_execution_end",
		"turn_end",
	] as const) {
		onRuntimeEvent(eventName, activate);
	}
	onRuntimeEvent("session_shutdown", () => {
		// A correlated input may be accepted immediately before shutdown. Give any
		// acknowledgement whose first durable write failed one final synchronous
		// retry before disabling the inbox timer.
		retryAcknowledgements();
		disposed = true;
		try {
			watcher?.close();
		} catch {}
		if (interval) clearInterval(interval);
	});
}

export default function registerSubagentPromptRuntime(pi: ExtensionAPI): void {
	registerSteeringInbox(pi);
	registerToolBudget(
		pi,
		decodeToolBudgetEnv(process.env[TOOL_BUDGET_ENV], { allowZero: process.env[TOOL_BUDGET_ZERO_AUTH_ENV] === "1" }),
	);
	let nativeSupervisorClientRegistered = false;
	let nativeSupervisorFallbackRegistered = false;
	const registerNativeSupervisorClientOnce = (): void => {
		if (nativeSupervisorClientRegistered) return;
		nativeSupervisorClientRegistered = true;
		registerNativeSupervisorClient(pi, { includeIntercomFallback: false });
	};
	const registerNativeSupervisorFallbackOnce = (): void => {
		registerNativeSupervisorClientOnce();
		if (nativeSupervisorFallbackRegistered) return;
		nativeSupervisorFallbackRegistered = true;
		registerNativeSupervisorClient(pi);
	};
	pi.on("session_start", () => {
		registerNativeSupervisorClientOnce();
	});
	pi.on("agent_start", () => {
		refreshChildToolDiagnostic(pi);
	});
	pi.on("before_provider_request", (event, ctx) => {
		const result = validateFinalProviderPayload(event.payload, ctx.model);
		if (result.ok) return;
		const diagnosticPath = process.env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV]?.trim();
		if (diagnosticPath) {
			try {
				writeChildLaunchDiagnostic(diagnosticPath, result.message);
			} catch (error) {
				console.error("Failed to persist the child launch budget diagnostic:", error);
			}
		}
		ctx.abort();
	});
	const structuredOutputPath = process.env[STRUCTURED_OUTPUT_CAPTURE_ENV];
	const structuredSchemaPath = process.env[STRUCTURED_OUTPUT_SCHEMA_ENV];
	if (structuredOutputPath && structuredSchemaPath) {
		const schema = JSON.parse(fs.readFileSync(structuredSchemaPath, "utf-8")) as JsonSchemaObject;
		const parameters = createStructuredOutputToolParameters(schema);
		const structuredOutputTool = {
			name: "structured_output",
			label: "Structured Output",
			description: "Submit the required final structured output for this subagent step. This terminates the step.",
			parameters: parameters as never,
			async execute(_id: string, params: { value: unknown }) {
				const validation = await validateStructuredOutputValue(schema, params.value);
				if (validation.status === "invalid") {
					throw new Error(`Structured output validation failed: ${validation.message}`);
				}
				fs.mkdirSync(path.dirname(structuredOutputPath), { recursive: true });
				fs.writeFileSync(structuredOutputPath, JSON.stringify(params.value), { mode: 0o600 });
				return {
					content: [{ type: "text", text: "Structured output captured." }],
					details: { path: structuredOutputPath },
					terminate: true,
				};
			},
		} as unknown as ToolDefinition<TSchema, Record<string, unknown>>;
		registerSuiteOwnedTool(pi, structuredOutputTool, {
			runningSummary: "validating",
			summarize: () => "captured",
			target: () => "final output",
		});
	}

	pi.on("context", (event) => {
		const messages = stripParentOnlySubagentMessages(event.messages);
		if (messages === event.messages) return undefined;
		return { messages: messages as typeof event.messages };
	});

	pi.on("before_agent_start", async (event) => {
		if (readRequiredChildTools()?.includes("intercom")) registerNativeSupervisorFallbackOnce();
		const intercomSessionName = process.env[SUBAGENT_INTERCOM_SESSION_NAME_ENV]?.trim();
		if (intercomSessionName && typeof pi.setSessionName === "function") {
			pi.setSessionName(intercomSessionName);
		}

		const inheritProjectContext = readBooleanEnv(SUBAGENT_INHERIT_PROJECT_CONTEXT_ENV);
		const inheritSkills = readBooleanEnv(SUBAGENT_INHERIT_SKILLS_ENV);
		const fanoutChild = readBooleanEnv(SUBAGENT_FANOUT_CHILD_ENV);
		let rewritten = event.systemPrompt;
		if (inheritProjectContext !== undefined || inheritSkills !== undefined || fanoutChild !== undefined) {
			rewritten = rewriteSubagentPrompt(event.systemPrompt, {
				inheritProjectContext: inheritProjectContext ?? true,
				inheritSkills: inheritSkills ?? true,
				fanoutChild: fanoutChild === true,
			});
		}
		if (rewritten === event.systemPrompt) return;
		return { systemPrompt: rewritten };
	});
}
