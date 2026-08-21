import type { JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import type { RuntimeContentItem, RuntimeResponse, SuiteSandboxTool } from "../protocol.js";

export const DEFAULT_EXEC_YIELD_MS = 60_000;
export const MAX_OUTPUT_TOKENS = 100_000;

interface WireToolDefinition {
	readonly description: string;
	readonly input_schema: SuiteSandboxTool["inputSchema"];
	readonly kind: "function";
	readonly name: string;
	readonly output_schema: null;
	readonly tool_name: { readonly name: string; readonly namespace: null };
}

export function toWireToolDefinition(tool: SuiteSandboxTool): WireToolDefinition {
	return {
		description: [`Usage: ${tool.usage}`, tool.description].filter(Boolean).join("\n"),
		input_schema: tool.inputSchema,
		kind: "function",
		name: tool.name,
		output_schema: null,
		tool_name: { name: tool.name, namespace: null },
	};
}

export function parseRuntimeResponse(value: unknown): RuntimeResponse {
	if (!isRecord(value)) throw new Error("Code Mode host returned an invalid runtime response");
	const kind = isRecord(value["Yielded"])
		? "yielded"
		: isRecord(value["Terminated"])
			? "terminated"
			: isRecord(value["Result"])
				? "result"
				: undefined;
	if (!kind) throw new Error("Code Mode host returned an invalid runtime response");
	const body = value[kind === "yielded" ? "Yielded" : kind === "terminated" ? "Terminated" : "Result"];
	if (!isRecord(body) || !isRuntimeString(body["cell_id"])) {
		throw new Error("Code Mode host returned an invalid runtime response");
	}
	return {
		cellId: body["cell_id"],
		contentItems: parseContentItems(body["content_items"]),
		kind,
		...(kind === "result" && isRuntimeString(body["error_text"]) ? { errorText: body["error_text"] } : {}),
	};
}

function parseContentItems(value: unknown): RuntimeContentItem[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("Code Mode host returned invalid content items");
	return value.map((item) => {
		if (!isRecord(item)) throw new Error("Code Mode host returned an invalid content item");
		if (item["type"] === "input_text" && isRuntimeString(item["text"])) {
			return { type: "input_text", text: item["text"] };
		}
		if (item["type"] === "input_image" && isRuntimeString(item["image_url"]) && isImageDetail(item["detail"])) {
			return {
				type: "input_image",
				image_url: item["image_url"],
				...(item["detail"] === undefined ? {} : { detail: item["detail"] }),
			};
		}
		if (item["type"] === "input_audio") throw new Error("Code Mode audio output is not supported by Pi Stuff");
		throw new Error("Code Mode host returned an invalid content item");
	});
}

function isImageDetail(value: unknown): value is "auto" | "high" | "low" | "original" | null | undefined {
	return (
		value === undefined ||
		value === null ||
		value === "auto" ||
		value === "low" ||
		value === "high" ||
		value === "original"
	);
}

export type HostMessage =
	| { readonly capabilities: string[]; readonly selectedVersion: 1; readonly type: "connection/ready" }
	| { readonly reason: JsonInputValue; readonly type: "connection/rejected" }
	| { readonly id: number; readonly result: HostResult; readonly type: "operation/response" }
	| { readonly id: number; readonly result: HostResult; readonly type: "execute/initialResponse" }
	| ({ readonly type: "delegate/request" } & DelegateRequestMessage)
	| { readonly id: number; readonly type: "delegate/cancel" }
	| { readonly cellId: string; readonly type: "cell/closed" };

export interface DelegateRequestMessage {
	readonly id: number;
	readonly request:
		| { readonly cellId: string; readonly text: string; readonly type: "notification/send" }
		| {
				readonly invocation: {
					readonly cell_id: string;
					readonly input?: JsonInputValue;
					readonly runtime_tool_call_id: string;
					readonly tool_name: { readonly name: string };
				};
				readonly type: "tool/invoke";
		  };
}

type HostResult =
	| { readonly status: "error"; readonly message: string }
	| { readonly status: "ok"; readonly value: JsonInputValue };

export function parseHostMessage(value: unknown): HostMessage {
	if (!isRecord(value) || !isRuntimeString(value["type"])) {
		throw new Error("Code Mode host returned an invalid message");
	}
	const type = value["type"];
	if (type === "connection/ready") {
		if (value["selectedVersion"] !== 1 || !isStringArray(value["capabilities"])) {
			throw new Error("Code Mode host negotiated an invalid protocol");
		}
		return { capabilities: value["capabilities"], selectedVersion: 1, type };
	}
	if (type === "connection/rejected") {
		// SAFETY: host messages arrive from JSON.parse, so every field is recursively a JSON value or absent.
		return { reason: value["reason"] as JsonInputValue, type };
	}
	if (type === "operation/response" || type === "execute/initialResponse") {
		return { id: parseMessageId(value["id"]), result: parseHostResult(value["result"]), type };
	}
	if (type === "delegate/cancel") return { id: parseMessageId(value["id"]), type };
	if (type === "cell/closed") {
		if (!isRuntimeString(value["cellId"])) throw new Error("Code Mode host returned an invalid cell closure");
		return { cellId: value["cellId"], type };
	}
	if (type === "delegate/request") return { type, ...parseDelegateRequest(value) };
	throw new Error(`Code Mode host returned an unsupported message: ${type}`);
}

export function executionCellId(value: unknown): string | undefined {
	return isRecord(value) && value["type"] === "execution/started" && isRuntimeString(value["cellId"])
		? value["cellId"]
		: undefined;
}

export function runtimeOutcome(value: unknown): JsonInputValue {
	if (!isRecord(value) || !isRecord(value["outcome"])) return undefined;
	// SAFETY: runtime outcomes are fields of a message produced by JSON.parse.
	return (value["outcome"]["LiveCell"] ?? value["outcome"]["MissingCell"]) as JsonInputValue;
}

function parseDelegateRequest(value: Record<string, unknown>): DelegateRequestMessage {
	const id = parseMessageId(value["id"]);
	const request = value["request"];
	if (!isRecord(request) || !isRuntimeString(request["type"])) {
		throw new Error("Code Mode host returned an invalid delegate request");
	}
	if (request["type"] === "notification/send") {
		if (!isRuntimeString(request["cellId"]) || !isRuntimeString(request["text"])) {
			throw new Error("Code Mode host returned an invalid notification");
		}
		return { id, request: { cellId: request["cellId"], text: request["text"], type: "notification/send" } };
	}
	if (request["type"] !== "tool/invoke" || !isRecord(request["invocation"])) {
		throw new Error("Code Mode host returned an invalid tool invocation");
	}
	const invocation = request["invocation"];
	const toolName = invocation["tool_name"];
	if (
		!isRuntimeString(invocation["cell_id"]) ||
		!isRuntimeString(invocation["runtime_tool_call_id"]) ||
		!isRecord(toolName) ||
		!isRuntimeString(toolName["name"])
	) {
		throw new Error("Code Mode host returned an invalid tool invocation");
	}
	return {
		id,
		request: {
			invocation: {
				cell_id: invocation["cell_id"],
				runtime_tool_call_id: invocation["runtime_tool_call_id"],
				tool_name: { name: toolName["name"] },
				...(invocation["input"] === undefined
					? {}
					: {
							// SAFETY: delegate requests are parsed JSON messages.
							input: invocation["input"] as JsonInputValue,
						}),
			},
			type: "tool/invoke",
		},
	};
}

function parseHostResult(value: unknown): HostResult {
	if (!isRecord(value)) throw new Error("Code Mode host returned an invalid operation result");
	if (value["status"] === "ok") {
		// SAFETY: operation results are parsed JSON messages.
		return { status: "ok", value: value["value"] as JsonInputValue };
	}
	if (value["status"] === "error" && isRuntimeString(value["message"])) {
		return { message: value["message"], status: "error" };
	}
	throw new Error("Code Mode host returned an invalid operation result");
}

function parseMessageId(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error("Code Mode host returned an invalid message id");
	return Number(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => isRuntimeString(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}
