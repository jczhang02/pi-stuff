import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { type JsonValue, parseJsonValue } from "../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { type CodemodeValue, parseForStorage, stringifyForStorage } from "../cloudflare/codec.js";
import { SuiteToolInvocationError } from "../connector.js";
import type {
	ExecutorContext,
	RuntimeResponse,
	RuntimeToolCallPlan,
	RuntimeToolTrace,
	SuiteSandboxTool,
} from "../protocol.js";
import type { DelegateRequestMessage } from "./host-protocol.js";
import { CodeModeTraceStore } from "./trace-store.js";

const MAX_NOTIFICATION_CHARS = 16_384;
const MAX_NOTIFICATIONS_PER_CELL = 100;

type SendMessage = (message: unknown) => void;

function resultFromValue(value: unknown): AgentToolResult<unknown> {
	if (
		isRuntimeObject(value) &&
		value !== null &&
		"content" in value &&
		Array.isArray((value as { content?: unknown }).content)
	) {
		return value as AgentToolResult<unknown>;
	}
	let text: string;
	try {
		text = isRuntimeString(value) ? value : (JSON.stringify(value) ?? String(value));
	} catch {
		try {
			text = String(value);
		} catch {
			text = "[unserializable value]";
		}
	}
	return {
		content: [{ type: "text", text }],
		details: {},
	};
}

function decodeTransportValue(value: unknown): CodemodeValue {
	const serialized = JSON.stringify(value);
	return serialized === undefined ? undefined : parseForStorage(serialized);
}

function encodeTransportValue(value: unknown): JsonValue | undefined {
	try {
		const serialized = stringifyForStorage(value);
		return serialized === undefined ? undefined : parseJsonValue(serialized);
	} catch (error) {
		throw new Error(
			`Failed to serialize nested Tool result: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export class CodeModeDelegateRuntime {
	private readonly cellContexts = new Map<string, ExecutorContext>();
	private readonly cellTools = new Map<string, Map<string, SuiteSandboxTool>>();
	private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly controllers = new Map<number, AbortController>();
	private readonly notifications = new Map<string, string[]>();
	private readonly send: SendMessage;
	private readonly traces = new CodeModeTraceStore();

	constructor(send: SendMessage) {
		this.send = send;
	}

	bindCell(cellId: string, context: ExecutorContext, tools?: Map<string, SuiteSandboxTool>): void {
		this.cellContexts.set(cellId, context);
		if (tools) this.cellTools.set(cellId, tools);
	}

	updateCellContext(cellId: string, context: ExecutorContext): void {
		this.cellContexts.set(cellId, context);
	}

	closeCell(cellId: string): void {
		this.cellContexts.delete(cellId);
		this.cellTools.delete(cellId);
		const previous = this.cleanupTimers.get(cellId);
		if (previous) clearTimeout(previous);
		this.cleanupTimers.set(
			cellId,
			setTimeout(() => {
				this.cleanupTimers.delete(cellId);
				this.notifications.delete(cellId);
				this.traces.delete(cellId);
			}, 1_000),
		);
	}

	cancel(id: number): void {
		const controller = this.controllers.get(id);
		this.controllers.delete(id);
		controller?.abort();
	}

	handleRequest(message: DelegateRequestMessage): void {
		if (this.controllers.has(message.id))
			throw new Error(`Duplicate Code Mode delegate request: ${String(message.id)}`);
		const controller = new AbortController();
		this.controllers.set(message.id, controller);
		void this.invoke(message, controller);
	}

	attach(response: RuntimeResponse): RuntimeResponse {
		const cleanup = this.cleanupTimers.get(response.cellId);
		if (cleanup) clearTimeout(cleanup);
		this.cleanupTimers.delete(response.cellId);
		const notifications = this.notifications.get(response.cellId) ?? [];
		this.notifications.delete(response.cellId);
		const traced = this.traces.attach(response);
		return notifications.length === 0
			? traced
			: {
					...traced,
					contentItems: [
						...notifications.map((text) => ({ type: "input_text" as const, text })),
						...traced.contentItems,
					],
				};
	}

	clear(): void {
		for (const controller of this.controllers.values()) controller.abort();
		this.controllers.clear();
		this.cellContexts.clear();
		this.cellTools.clear();
		this.notifications.clear();
		this.traces.clear();
		for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
		this.cleanupTimers.clear();
	}

	private async invoke(message: DelegateRequestMessage, controller: AbortController): Promise<void> {
		const request = message.request;
		if (request.type === "notification/send") {
			this.handleNotification(message.id, request);
			return;
		}
		const invocation = request.invocation;
		const cellId = invocation.cell_id;
		const name = invocation.tool_name.name;
		const input = decodeTransportValue(invocation.input);
		const context = this.cellContexts.get(cellId);
		const tool = this.cellTools.get(cellId)?.get(name);
		if (!context || !tool) {
			this.respond(message.id, {
				message: !tool ? `Unknown Suite Tool: ${name}` : "Code Mode cell context is unavailable",
				status: "error",
			});
			this.controllers.delete(message.id);
			return;
		}
		let plan: RuntimeToolCallPlan | undefined;
		let trace: RuntimeToolTrace;
		const hidden = tool.presentation === "hidden";
		try {
			plan = tool.ledger === "bypass" ? undefined : context.beginToolCall?.(name, input);
			trace = hidden
				? { id: plan?.id ?? invocation.runtime_tool_call_id, input, name, status: "running" }
				: this.traces.start(cellId, plan?.id ?? invocation.runtime_tool_call_id, name, input, plan);
		} catch (error) {
			this.respond(message.id, {
				message: error instanceof Error ? error.message : String(error),
				status: "error",
			});
			this.controllers.delete(message.id);
			return;
		}
		const nestedContext: ExecutorContext = {
			...context,
			captureResult: (result) => {
				trace.result = result;
				if (!hidden) this.traces.emit(cellId, trace, context);
			},
			onUpdate: (result) => {
				trace.result = result;
				if (!hidden) this.traces.emit(cellId, trace, context);
			},
			toolCallId: trace.id,
		};
		if (!hidden) this.traces.emit(cellId, trace, context);
		if (plan?.pause) {
			trace.result = resultFromValue(plan.pause.message);
			trace.status = "pending";
			if (!hidden) this.traces.emit(cellId, trace, context);
			this.respond(message.id, { message: plan.pause.message, status: "error" });
			this.controllers.delete(message.id);
			return;
		}
		if (plan?.replay) {
			trace.result =
				plan.replay.result ??
				resultFromValue(plan.replay.kind === "result" ? plan.replay.value : plan.replay.message);
			trace.status = plan.replay.kind === "result" ? "done" : "error";
			if (plan.replay.kind === "error") trace.error = plan.replay.message;
			if (!hidden) this.traces.emit(cellId, trace, context);
			this.respond(
				message.id,
				plan.replay.kind === "result"
					? { status: "ok", value: { result: encodeTransportValue(plan.replay.value), type: "tool/result" } }
					: { message: plan.replay.message, status: "error" },
			);
			this.controllers.delete(message.id);
			return;
		}
		let settlementAttempted = false;
		try {
			const value = await tool.invoke(input, nestedContext, controller.signal);
			trace.result ??= resultFromValue(value);
			trace.status = "done";
			if (plan) {
				context.completeToolCall?.(plan, { result: trace.result, status: "success", value });
				settlementAttempted = true;
			}
			if (!hidden) this.traces.emit(cellId, trace, context);
			const serializationError = this.respond(message.id, {
				status: "ok",
				value: { result: encodeTransportValue(value), type: "tool/result" },
			});
			if (serializationError) {
				trace.status = "error";
				trace.error = serializationError.message;
				if (!hidden) this.traces.emit(cellId, trace, context);
			}
		} catch (error) {
			if (error instanceof SuiteToolInvocationError) trace.result = error.result;
			trace.result ??= resultFromValue(error instanceof Error ? error.message : String(error));
			trace.status = controller.signal.aborted ? "cancelled" : "error";
			trace.error = error instanceof Error ? error.message : String(error);
			if (plan && !settlementAttempted) {
				settlementAttempted = true;
				try {
					context.completeToolCall?.(plan, {
						message: trace.error,
						result: trace.result,
						status: "error",
					});
				} catch (ledgerError) {
					trace.error = `${trace.error}; ledger update failed: ${ledgerError instanceof Error ? ledgerError.message : String(ledgerError)}`;
				}
			}
			if (!hidden) this.traces.emit(cellId, trace, context);
			this.respond(message.id, { message: trace.error, status: "error" });
		} finally {
			this.controllers.delete(message.id);
		}
	}

	private handleNotification(
		id: number,
		request: Extract<DelegateRequestMessage["request"], { type: "notification/send" }>,
	): void {
		if (!this.cellContexts.has(request.cellId)) {
			this.respond(id, { message: "Code Mode notification cell is unavailable", status: "error" });
			this.controllers.delete(id);
			return;
		}
		const notifications = this.notifications.get(request.cellId) ?? [];
		notifications.push(request.text.slice(0, MAX_NOTIFICATION_CHARS));
		if (notifications.length > MAX_NOTIFICATIONS_PER_CELL) {
			notifications.splice(0, notifications.length - MAX_NOTIFICATIONS_PER_CELL);
		}
		this.notifications.set(request.cellId, notifications);
		this.respond(id, { status: "ok", value: { type: "notification/delivered" } });
		this.controllers.delete(id);
	}

	private respond(id: number, result: Record<string, unknown>): Error | undefined {
		try {
			this.send({ id, result, type: "delegate/response" });
			return undefined;
		} catch (error) {
			const failure = new Error(
				`Failed to serialize nested Tool result: ${error instanceof Error ? error.message : String(error)}`,
			);
			try {
				this.send({
					id,
					result: { message: failure.message, status: "error" },
					type: "delegate/response",
				});
			} catch {
				// Host teardown rejects the owning operation.
			}
			return failure;
		}
	}
}
