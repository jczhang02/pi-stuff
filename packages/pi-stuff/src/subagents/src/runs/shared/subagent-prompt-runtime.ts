import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextEvent, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { isRuntimeFunction, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";
import { activityKey, registerSuiteOwnedTool, singleActivity } from "../../../../tool-display/index.js";
import { registerNativeSupervisorClient } from "../../intercom/native-supervisor-channel.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
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
	childContextHasOwnContinuation,
	type ProviderPayloadModel,
	projectChildContinuationContext,
	validateChildProviderPayload,
} from "./continuation-context.ts";
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

type SubagentContextMessage = ContextEvent["messages"][number];

export function validateFinalProviderPayload(
	payload: unknown,
	model: ProviderPayloadModel | undefined,
): { ok: true } | { ok: false; message: string } {
	return validateChildProviderPayload(payload, model);
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
	if (!Array.isArray(required) || required.some((name) => !isRuntimeString(name) || !name)) {
		throw new Error(`Invalid ${REQUIRED_CHILD_TOOLS_ENV} payload.`);
	}
	return required;
}

function readMcpDirectChildTools(): string[] | undefined {
	const encoded = process.env[MCP_DIRECT_CHILD_TOOLS_ENV]?.trim();
	if (!encoded) return undefined;
	try {
		const tools = JSON.parse(encoded) as unknown;
		if (!Array.isArray(tools) || tools.some((name) => !isRuntimeString(name) || !name)) return undefined;
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

export function rewriteSubagentPrompt(prompt: string, options: { fanoutChild?: boolean }): string {
	const boundary = options.fanoutChild ? CHILD_FANOUT_BOUNDARY_INSTRUCTIONS : CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS;
	const structured = process.env[STRUCTURED_OUTPUT_CAPTURE_ENV] ? `\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}` : "";
	// Pi concatenates custom prompts and Runtime Resources without an escaped
	// structural boundary. Treat the resulting prompt as opaque: child capability
	// ceilings and resolved Skill selection enforce orchestration policy without
	// deleting user-authored text that happens to resemble a Host resource block.
	return `${boundary}${structured}\n\n${prompt}`;
}

function isParentOnlySubagentMessage(message: SubagentContextMessage): boolean {
	if (message.role !== "custom" || !isRuntimeString(message.customType)) return false;
	return PARENT_ONLY_CUSTOM_MESSAGE_TYPES.has(message.customType);
}

function isSubagentToolResultMessage(message: SubagentContextMessage): boolean {
	return message.role === "toolResult" && message.toolName === "subagent";
}

function stripAssistantSubagentToolCallBlocks(message: SubagentContextMessage): SubagentContextMessage | undefined {
	if (message.role !== "assistant") return message;
	const filteredContent = message.content.filter((block) => block.type !== "toolCall" || block.name !== "subagent");
	if (filteredContent.length === message.content.length) return message;
	if (filteredContent.length === 0) return undefined;
	return { ...message, content: filteredContent };
}

export function stripParentOnlySubagentMessages(messages: SubagentContextMessage[]): SubagentContextMessage[] {
	const preserveCurrentFanoutToolHistory = process.env[SUBAGENT_FANOUT_CHILD_ENV] === "1";
	let changed = false;
	const filtered: SubagentContextMessage[] = [];
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
	const sendUserMessage = (
		pi as {
			sendUserMessage?: (content: string, options: { deliverAs: "steer" }) => PromiseLike<void> | void;
		}
	).sendUserMessage;
	type ToolBudgetEventResult = { readonly block: true; readonly reason: string } | undefined;
	const onRuntimeEvent = pi.on as (
		event: string,
		handler: (event: { toolName?: string }) => ToolBudgetEventResult,
	) => void;
	onRuntimeEvent("tool_call", (event) => {
		const toolName = isRuntimeString(event.toolName) ? event.toolName : "tool";
		toolCount++;
		if (budget.soft !== undefined && toolCount >= budget.soft && !softNudged) {
			softNudged = true;
			try {
				const dispatched = sendUserMessage?.(toolBudgetSoftNudge(budget, toolCount), { deliverAs: "steer" });
				if (dispatched) {
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
	const sendUserMessage = (
		pi as {
			sendUserMessage?: (content: string, options: { deliverAs: "steer" }) => PromiseLike<void> | void;
		}
	).sendUserMessage;
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
	let ready = false;
	const canSteer = isRuntimeFunction(sendUserMessage);
	let watcher: fs.FSWatcher | undefined;
	let interval: NodeJS.Timeout | undefined;
	let lastRuntimeError = "";
	let lastRuntimeErrorAt = 0;
	const reportRuntimeError = (context: string, cause: unknown): void => {
		const message = `${context}: ${cause instanceof Error ? cause.message : String(cause)}`;
		const now = Date.now();
		if (message === lastRuntimeError && now - lastRuntimeErrorAt < 30_000) return;
		lastRuntimeError = message;
		lastRuntimeErrorAt = now;
		reportAgentDiagnostic(`[pi-stuff-agents] ${message}`);
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
		for (const { request, state, message, complete } of Array.from(pendingAcks.values()))
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
		if (disposed || flushing || !ready) return;
		flushing = true;
		try {
			retryAcknowledgements();
			processSteerRequestsFromDir(steerInbox, (request, complete) => {
				if (existingAcknowledgement(request)) {
					complete();
					return "retain";
				}
				if (pendingById.has(request.id) || pendingAcks.has(request.id)) return "retain";
				if (!canSteer || !isRuntimeFunction(sendUserMessage)) {
					acknowledge(request, "failed", "Child Pi session does not support sendUserMessage steering.", complete);
					return "retain";
				}
				const formatted = formatSteerMessage(request);
				const delivery: PendingDelivery = { request, complete };
				pendingById.set(request.id, delivery);
				try {
					const dispatched = sendUserMessage(formatted, { deliverAs: "steer" });
					if (dispatched) {
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
		if (disposed || !event || !isRuntimeObject(event)) return undefined;
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
		const text = isRuntimeString(input.text)
			? input.text
			: isRuntimeString(input.content)
				? input.content
				: undefined;
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
	const markReady = (): undefined => {
		start();
		if (!ready) {
			ready = true;
			publishCapability();
		}
		safeFlush();
		return undefined;
	};

	const onRuntimeEvent = pi.on as (event: string, handler: (event: unknown) => void) => void;
	// Register input before the watcher so an accepted extension input cannot race request dispatch.
	onRuntimeEvent("input", onInput);
	onRuntimeEvent("session_start", activate);
	onRuntimeEvent("agent_start", markReady);
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
	let completedTurns = 0;
	let resumedSession = false;
	let continuationHistoryObserved = false;
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
	pi.on("session_start", (event) => {
		resumedSession = event.reason === "resume" || event.reason === "reload";
		registerNativeSupervisorClientOnce();
	});
	pi.on("agent_start", () => {
		refreshChildToolDiagnostic(pi);
	});
	pi.on("turn_end", () => {
		completedTurns += 1;
	});
	pi.on("before_provider_request", (event, ctx) => {
		const result = validateChildProviderPayload(
			event.payload,
			ctx.model,
			completedTurns > 0 || resumedSession || continuationHistoryObserved ? "continuation" : "launch",
		);
		if (result.ok) return;
		const diagnosticPath = process.env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV]?.trim();
		if (diagnosticPath) {
			try {
				writeChildLaunchDiagnostic(diagnosticPath, result.message);
			} catch (error) {
				reportAgentDiagnostic("Failed to persist the child launch budget diagnostic:", error);
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
		} as ToolDefinition<TSchema, Record<string, unknown>>;
		registerSuiteOwnedTool(pi, structuredOutputTool, {
			activity: {
				categories: ["record-result"],
				classify: ({ result }) =>
					singleActivity("record-result", {
						key: activityKey(result?.details.path ?? structuredOutputPath),
						target: "final output",
					}),
			},
			runningSummary: "validating",
			summarize: () => "captured",
			target: () => "final output",
		});
	}

	pi.on("context", (event, ctx) => {
		const messages = stripParentOnlySubagentMessages(event.messages);
		continuationHistoryObserved ||= childContextHasOwnContinuation(messages as typeof event.messages);
		const projected = projectChildContinuationContext(messages as typeof event.messages, pi, ctx);
		if (messages === event.messages && !projected.changed) return undefined;
		return { messages: projected.messages as typeof event.messages };
	});

	pi.on("before_agent_start", async (event) => {
		if (readRequiredChildTools()?.includes("intercom")) registerNativeSupervisorFallbackOnce();
		const intercomSessionName = process.env[SUBAGENT_INTERCOM_SESSION_NAME_ENV]?.trim();
		if (intercomSessionName && isRuntimeFunction(pi.setSessionName)) {
			pi.setSessionName(intercomSessionName);
		}

		const inheritProjectContext = readBooleanEnv(SUBAGENT_INHERIT_PROJECT_CONTEXT_ENV);
		const inheritSkills = readBooleanEnv(SUBAGENT_INHERIT_SKILLS_ENV);
		const fanoutChild = readBooleanEnv(SUBAGENT_FANOUT_CHILD_ENV);
		let rewritten = event.systemPrompt;
		if (inheritProjectContext !== undefined || inheritSkills !== undefined || fanoutChild !== undefined) {
			rewritten = rewriteSubagentPrompt(event.systemPrompt, {
				fanoutChild: fanoutChild === true,
			});
		}
		if (rewritten === event.systemPrompt) return;
		return { systemPrompt: rewritten };
	});
}
