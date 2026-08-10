import type { RuntimeContentItem, RuntimeResponse, SuiteSandboxTool } from "../protocol.js";

export const DEFAULT_EXEC_YIELD_MS = 60_000;
export const MAX_OUTPUT_TOKENS = 100_000;

export function toWireToolDefinition(tool: SuiteSandboxTool): Record<string, unknown> {
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
	if (!isRecord(body) || typeof body["cell_id"] !== "string") {
		throw new Error("Code Mode host returned an invalid runtime response");
	}
	return {
		cellId: body["cell_id"],
		contentItems: parseContentItems(body["content_items"]),
		kind,
		...(kind === "result" && typeof body["error_text"] === "string" ? { errorText: body["error_text"] } : {}),
	};
}

function parseContentItems(value: unknown): RuntimeContentItem[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("Code Mode host returned invalid content items");
	return value.map((item) => {
		if (!isRecord(item)) throw new Error("Code Mode host returned an invalid content item");
		if (item["type"] === "input_text" && typeof item["text"] === "string") {
			return { type: "input_text", text: item["text"] };
		}
		if (item["type"] === "input_image" && typeof item["image_url"] === "string" && isImageDetail(item["detail"])) {
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
	| { readonly reason: unknown; readonly type: "connection/rejected" }
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
					readonly input?: unknown;
					readonly runtime_tool_call_id: string;
					readonly tool_name: { readonly name: string };
				};
				readonly type: "tool/invoke";
		  };
}

type HostResult =
	| { readonly status: "error"; readonly message: string }
	| { readonly status: "ok"; readonly value: unknown };

export function parseHostMessage(value: unknown): HostMessage {
	if (!isRecord(value) || typeof value["type"] !== "string") {
		throw new Error("Code Mode host returned an invalid message");
	}
	const type = value["type"];
	if (type === "connection/ready") {
		if (value["selectedVersion"] !== 1 || !isStringArray(value["capabilities"])) {
			throw new Error("Code Mode host negotiated an invalid protocol");
		}
		return { capabilities: value["capabilities"], selectedVersion: 1, type };
	}
	if (type === "connection/rejected") return { reason: value["reason"], type };
	if (type === "operation/response" || type === "execute/initialResponse") {
		return { id: parseMessageId(value["id"]), result: parseHostResult(value["result"]), type };
	}
	if (type === "delegate/cancel") return { id: parseMessageId(value["id"]), type };
	if (type === "cell/closed") {
		if (typeof value["cellId"] !== "string") throw new Error("Code Mode host returned an invalid cell closure");
		return { cellId: value["cellId"], type };
	}
	if (type === "delegate/request") return { type, ...parseDelegateRequest(value) };
	throw new Error(`Code Mode host returned an unsupported message: ${type}`);
}

export function executionCellId(value: unknown): string | undefined {
	return isRecord(value) && value["type"] === "execution/started" && typeof value["cellId"] === "string"
		? value["cellId"]
		: undefined;
}

export function runtimeOutcome(value: unknown): unknown {
	if (!isRecord(value) || !isRecord(value["outcome"])) return undefined;
	return value["outcome"]["LiveCell"] ?? value["outcome"]["MissingCell"];
}

function parseDelegateRequest(value: Record<string, unknown>): DelegateRequestMessage {
	const id = parseMessageId(value["id"]);
	const request = value["request"];
	if (!isRecord(request) || typeof request["type"] !== "string") {
		throw new Error("Code Mode host returned an invalid delegate request");
	}
	if (request["type"] === "notification/send") {
		if (typeof request["cellId"] !== "string" || typeof request["text"] !== "string") {
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
		typeof invocation["cell_id"] !== "string" ||
		typeof invocation["runtime_tool_call_id"] !== "string" ||
		!isRecord(toolName) ||
		typeof toolName["name"] !== "string"
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
				...(invocation["input"] === undefined ? {} : { input: invocation["input"] }),
			},
			type: "tool/invoke",
		},
	};
}

function parseHostResult(value: unknown): HostResult {
	if (!isRecord(value)) throw new Error("Code Mode host returned an invalid operation result");
	if (value["status"] === "ok") return { status: "ok", value: value["value"] };
	if (value["status"] === "error" && typeof value["message"] === "string") {
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
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
