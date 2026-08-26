import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { type JsonObject, type JsonSourceValue, type JsonValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { type CodemodeValue, parseForStorage, stringifyForStorage } from "./cloudflare/codec.js";
import type { Snippet } from "./cloudflare/snippet.js";
import { unwrapSuiteToolResult } from "./connector.js";
import { isCodeModeToolContent } from "./presentation.js";

const SCHEMA_VERSION = 1;
export const MAX_DURABLE_VALUE_BYTES = 1_000_000;
export const MAX_RETAINED_EXECUTIONS = 50;

const EXECUTION_STATUSES = [
	"abandoned",
	"cancelled",
	"compensated",
	"error",
	"expired",
	"incomplete",
	"paused",
	"rejected",
	"rolled_back",
	"running",
	"success",
] as const;

export type CodeModeExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type ReplayPolicy = "never" | "record" | "reexecute";

type StoredValue = { readonly kind: "undefined" } | { readonly json: JsonValue; readonly kind: "json" };
type Event<Kind extends string> = { readonly at: number; readonly kind: Kind; readonly schemaVersion: 1 };
type ExecutionEvent<Kind extends string> = Event<Kind> & { readonly executionId: string };
type CallEvent<Kind extends string> = ExecutionEvent<Kind> & { readonly callId: string };

export type ExecutionStartedEvent = ExecutionEvent<"execution-started"> & {
	readonly code: string;
	readonly cwd?: string;
	readonly outerToolCallId: string;
};

type CallOpenedEvent<Kind extends "call-pending" | "call-started"> = CallEvent<Kind> & {
	readonly args: StoredValue;
	readonly argsKey: string;
	readonly attempt: number;
	readonly name: string;
	readonly replay: ReplayPolicy;
	readonly sequence: number;
};

export type CallPendingEvent = CallOpenedEvent<"call-pending">;
export type CallStartedEvent = CallOpenedEvent<"call-started"> & { readonly requiresApproval?: boolean };
export type CallSettledEvent = CallEvent<"call-settled"> & {
	readonly error?: string;
	readonly result?: StoredValue;
	readonly status: "error" | "success";
	readonly value?: StoredValue;
};
export type CallCompensatedEvent = CallEvent<"call-compensated">;
export type ExecutionSettledEvent = ExecutionEvent<"execution-settled"> & {
	readonly attempt: number;
	readonly error?: string;
	readonly status: CodeModeExecutionStatus;
};
export type ExecutionPrunedEvent = ExecutionEvent<"execution-pruned">;
export type ExecutionResumedEvent = ExecutionEvent<"execution-resumed"> & { readonly attempt: number };
export type SnippetSavedEvent = Event<"snippet-saved"> & { readonly snippet: Snippet };
export type SnippetDeletedEvent = Event<"snippet-deleted"> & { readonly name: string };

export type LedgerEvent =
	| CallCompensatedEvent
	| CallPendingEvent
	| CallSettledEvent
	| CallStartedEvent
	| ExecutionPrunedEvent
	| ExecutionResumedEvent
	| ExecutionSettledEvent
	| ExecutionStartedEvent
	| SnippetDeletedEvent
	| SnippetSavedEvent;

export interface CallState {
	args: CodemodeValue;
	argsKey: string;
	attempt: number;
	callId: string;
	compensated?: boolean;
	error?: string;
	name: string;
	replay: ReplayPolicy;
	requiresApproval: boolean;
	result?: AgentToolResult<unknown>;
	sequence: number;
	status: "error" | "pending" | "running" | "success";
	value?: CodemodeValue;
	valuePresent?: boolean;
}

export interface CodeModeExecutionHistoryItem {
	readonly code: string;
	readonly createdAt: number;
	readonly error?: string;
	readonly executionId: string;
	readonly outerToolCallId: string;
	readonly status: CodeModeExecutionStatus;
	readonly toolCalls: number;
	readonly tools: readonly string[];
	readonly updatedAt: number;
}

export interface CodeModeCompensationTarget {
	readonly callId: string;
	readonly input: CodemodeValue;
	readonly name: string;
	readonly sequence: number;
	readonly value: CodemodeValue;
}

export interface CodeModePendingAction {
	readonly args: CodemodeValue;
	readonly connector: "tools";
	readonly executionId: string;
	readonly method: string;
	readonly seq: number;
}

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };

export interface ExecutionState extends Omit<Mutable<CodeModeExecutionHistoryItem>, "tools"> {
	attempt: number;
	calls: Map<number, CallState>;
	cwd?: string;
}

export interface LedgerSnapshot {
	executions: Map<string, ExecutionState>;
	physicalBytes: number;
	snippets: Map<string, Snippet>;
	totalExecutions: number;
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function finiteNumber(value: JsonValue | undefined): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) ? value : undefined;
}

function integer(value: JsonValue | undefined): number | undefined {
	return isRuntimeNumber(value) && Number.isInteger(value) ? value : undefined;
}

function nonemptyString(value: JsonValue | undefined): string | undefined {
	return isRuntimeString(value) && value.length > 0 ? value : undefined;
}

function isReplayPolicy(value: JsonValue | undefined): value is ReplayPolicy {
	return value === "never" || value === "record" || value === "reexecute";
}

function isExecutionStatus(value: JsonValue | undefined): value is CodeModeExecutionStatus {
	return EXECUTION_STATUSES.some((status) => status === value);
}

export function durableValue<Value>(what: string, value: Value): StoredValue {
	let serialized: string | undefined;
	try {
		serialized = stringifyForStorage(value);
	} catch (error) {
		throw new Error(
			`${what} could not be recorded durably (not serializable: ${error instanceof Error ? error.message : String(error)}). Only JSON-compatible values, binary, and bigint can cross a replay boundary.`,
		);
	}
	if (serialized === undefined) return { kind: "undefined" };
	const bytes = Buffer.byteLength(serialized);
	if (bytes > MAX_DURABLE_VALUE_BYTES) {
		throw new Error(
			`${what} is too large to record durably (${String(bytes)} bytes > ${String(MAX_DURABLE_VALUE_BYTES)} byte limit). Write large data to a file or workspace and return a small reference such as a path.`,
		);
	}
	return { json: parseJsonValue(serialized), kind: "json" };
}

export function optionalPresentationValue(name: string, value: AgentToolResult<unknown>): StoredValue | undefined {
	try {
		if (!isCodeModeToolContent(value.content)) return undefined;
		unwrapSuiteToolResult(name, value);
		return durableValue("The Tool presentation result", value);
	} catch {
		return undefined;
	}
}

function restoreValue(value: StoredValue | undefined): CodemodeValue {
	return !value || value.kind === "undefined" ? undefined : parseForStorage(JSON.stringify(value.json));
}

function parseStoredValue(value: JsonValue | undefined): StoredValue | undefined {
	if (!value || !isRecord(value)) return undefined;
	if (value["kind"] === "undefined") return { kind: "undefined" };
	const json = value["json"];
	return value["kind"] === "json" && Object.hasOwn(value, "json") && json !== undefined
		? { json, kind: "json" }
		: undefined;
}

function sourceRecord(source: JsonSourceValue): JsonObject | undefined {
	const value = parseJsonValue(JSON.stringify(source));
	return isRecord(value) && value["schemaVersion"] === SCHEMA_VERSION && finiteNumber(value["at"]) !== undefined
		? value
		: undefined;
}

function callOpened(
	value: JsonObject,
	kind: "call-pending" | "call-started",
	at: number,
	executionId: string,
): CallPendingEvent | CallStartedEvent | undefined {
	const args = parseStoredValue(value["args"]);
	const argsKey = value["argsKey"];
	const attempt = integer(value["attempt"]);
	const callId = nonemptyString(value["callId"]);
	const name = nonemptyString(value["name"]);
	const replay = value["replay"];
	const requiresApproval = value["requiresApproval"];
	const sequence = integer(value["sequence"]);
	if (
		!args ||
		!isRuntimeString(argsKey) ||
		attempt === undefined ||
		!callId ||
		!name ||
		!isReplayPolicy(replay) ||
		(requiresApproval !== undefined && !isRuntimeBoolean(requiresApproval)) ||
		sequence === undefined
	)
		return undefined;
	const common = {
		args,
		argsKey,
		at,
		attempt,
		callId,
		executionId,
		name,
		replay,
		schemaVersion: 1 as const,
		sequence,
	};
	if (kind === "call-pending") return { ...common, kind };
	return requiresApproval === undefined ? { ...common, kind } : { ...common, kind, requiresApproval };
}

function callSettled(value: JsonObject, at: number, executionId: string): CallSettledEvent | undefined {
	const callId = nonemptyString(value["callId"]);
	const error = value["error"];
	const result = parseStoredValue(value["result"]);
	const status = value["status"];
	const settledValue = parseStoredValue(value["value"]);
	if (
		!callId ||
		(status !== "error" && status !== "success") ||
		(error !== undefined && !isRuntimeString(error)) ||
		(value["result"] !== undefined && !result) ||
		(value["value"] !== undefined && !settledValue)
	)
		return undefined;
	const event: CallSettledEvent = {
		at,
		callId,
		executionId,
		kind: "call-settled",
		schemaVersion: SCHEMA_VERSION,
		status,
	};
	if (error !== undefined) Object.assign(event, { error });
	if (result !== undefined) Object.assign(event, { result });
	if (settledValue !== undefined) Object.assign(event, { value: settledValue });
	return event;
}

function executionSettled(value: JsonObject, at: number, executionId: string): ExecutionSettledEvent | undefined {
	const attempt = integer(value["attempt"]);
	const error = value["error"];
	const status = value["status"];
	if (attempt === undefined || !isExecutionStatus(status) || (error !== undefined && !isRuntimeString(error)))
		return undefined;
	const event: ExecutionSettledEvent = {
		at,
		attempt,
		executionId,
		kind: "execution-settled",
		schemaVersion: SCHEMA_VERSION,
		status,
	};
	if (error !== undefined) Object.assign(event, { error });
	return event;
}

function snippetSaved(value: JsonObject, at: number): SnippetSavedEvent | undefined {
	const source = value["snippet"];
	if (!isRecord(source)) return undefined;
	const code = source["code"];
	const connectors = source["connectors"];
	const description = source["description"];
	const name = source["name"];
	const savedAt = finiteNumber(source["savedAt"]);
	if (
		!isRuntimeString(code) ||
		(connectors !== undefined && (!Array.isArray(connectors) || !connectors.every(isRuntimeString))) ||
		!isRuntimeString(description) ||
		!isRuntimeString(name) ||
		savedAt === undefined
	)
		return undefined;
	const snippet: Snippet = { code, description, name, savedAt };
	if (connectors !== undefined) snippet.connectors = connectors;
	if (Object.hasOwn(source, "inputSchema")) snippet.inputSchema = source["inputSchema"];
	return { at, kind: "snippet-saved", schemaVersion: SCHEMA_VERSION, snippet };
}

export function eventFrom(source: JsonSourceValue): LedgerEvent | undefined {
	const value = sourceRecord(source);
	if (!value || !isRuntimeString(value["kind"])) return undefined;
	const kind = value["kind"];
	const at = finiteNumber(value["at"]);
	if (at === undefined) return undefined;
	if (kind === "snippet-saved") return snippetSaved(value, at);
	if (kind === "snippet-deleted") {
		const name = value["name"];
		return isRuntimeString(name) ? { at, kind, name, schemaVersion: SCHEMA_VERSION } : undefined;
	}
	const executionId = nonemptyString(value["executionId"]);
	if (!executionId) return undefined;
	switch (kind) {
		case "call-pending":
			return callOpened(value, kind, at, executionId);
		case "call-started":
			return callOpened(value, kind, at, executionId);
		case "call-settled":
			return callSettled(value, at, executionId);
		case "execution-settled":
			return executionSettled(value, at, executionId);
		case "execution-started": {
			const code = value["code"];
			const cwd = value["cwd"];
			const outerToolCallId = value["outerToolCallId"];
			if (
				!isRuntimeString(code) ||
				(cwd !== undefined && !isRuntimeString(cwd)) ||
				!isRuntimeString(outerToolCallId)
			)
				return undefined;
			const event: ExecutionStartedEvent = {
				at,
				code,
				executionId,
				kind: "execution-started",
				outerToolCallId,
				schemaVersion: SCHEMA_VERSION,
			};
			if (cwd !== undefined) Object.assign(event, { cwd });
			return event;
		}
		case "call-compensated": {
			const callId = nonemptyString(value["callId"]);
			return callId
				? { at, callId, executionId, kind: "call-compensated", schemaVersion: SCHEMA_VERSION }
				: undefined;
		}
		case "execution-pruned":
			return { at, executionId, kind, schemaVersion: SCHEMA_VERSION };
		case "execution-resumed": {
			const attempt = integer(value["attempt"]);
			return attempt !== undefined
				? { at, attempt, executionId, kind: "execution-resumed", schemaVersion: SCHEMA_VERSION }
				: undefined;
		}
		default:
			return undefined;
	}
}

export function createLedgerSnapshot(): LedgerSnapshot {
	return { executions: new Map(), physicalBytes: 0, snippets: new Map(), totalExecutions: 0 };
}

function applyOpened(execution: ExecutionState, event: CallPendingEvent | CallStartedEvent): void {
	execution.attempt = Math.max(execution.attempt, event.attempt);
	execution.calls.set(event.sequence, {
		args: restoreValue(event.args),
		argsKey: event.argsKey,
		attempt: event.attempt,
		callId: event.callId,
		name: event.name,
		replay: event.replay,
		requiresApproval: event.kind === "call-pending" || event.requiresApproval === true,
		sequence: event.sequence,
		status: event.kind === "call-pending" ? "pending" : "running",
	});
	if (event.kind === "call-pending") execution.status = "paused";
	execution.toolCalls = Math.max(execution.toolCalls, event.sequence + 1);
}

function restoredToolResult(value: StoredValue | undefined): AgentToolResult<unknown> | undefined {
	const result = restoreValue(value);
	// SAFETY: the runtime object and complete Tool-content checks establish the AgentToolResult members consumed here.
	return isRuntimeObject(result) && result !== null && "content" in result && isCodeModeToolContent(result["content"])
		? (result as CodemodeValue & AgentToolResult<unknown>)
		: undefined;
}

function applySettled(call: CallState, event: CallSettledEvent): void {
	call.status = event.status;
	if (event.error) call.error = event.error;
	const result = restoredToolResult(event.result);
	if (result) call.result = result;
	if (event.value) {
		call.value = restoreValue(event.value);
		call.valuePresent = true;
	} else if (event.status === "success" && result) {
		try {
			call.value = unwrapSuiteToolResult(call.name, result);
			call.valuePresent = true;
		} catch {
			// A malformed historical presentation result remains diagnostic only.
		}
	}
	if (call.status === "success" && result && "isError" in result && result.isError === true) {
		call.status = "error";
		const text = result.content.find((item) => item.type === "text" && item.text.trim());
		call.error ??= text?.type === "text" ? text.text.trim() : `${call.name} failed`;
	}
}

export function applyEvent(state: LedgerSnapshot, event: LedgerEvent): void {
	if (event.kind === "execution-started") {
		if (!state.executions.has(event.executionId)) state.totalExecutions += 1;
		const execution: ExecutionState = {
			attempt: 0,
			calls: new Map(),
			code: event.code,
			createdAt: event.at,
			executionId: event.executionId,
			outerToolCallId: event.outerToolCallId,
			status: "running",
			toolCalls: 0,
			updatedAt: event.at,
		};
		if (event.cwd !== undefined) Object.assign(execution, { cwd: event.cwd });
		state.executions.set(event.executionId, execution);
		return;
	}
	if (event.kind === "execution-pruned") {
		state.executions.delete(event.executionId);
		return;
	}
	if (event.kind === "snippet-saved") {
		state.snippets.set(event.snippet.name, event.snippet);
		return;
	}
	if (event.kind === "snippet-deleted") {
		state.snippets.delete(event.name);
		return;
	}
	const execution = state.executions.get(event.executionId);
	if (!execution) return;
	execution.updatedAt = event.at;
	if (event.kind === "execution-resumed") {
		execution.attempt = event.attempt;
		execution.status = "running";
		delete execution.error;
		return;
	}
	if (event.kind === "execution-settled") {
		execution.attempt = event.attempt;
		execution.status = event.status;
		if (event.error) execution.error = event.error;
		else delete execution.error;
		return;
	}
	if (event.kind === "call-pending" || event.kind === "call-started") {
		applyOpened(execution, event);
		return;
	}
	const call = [...execution.calls.values()].find((candidate) => candidate.callId === event.callId);
	if (!call) return;
	if (event.kind === "call-compensated") {
		call.compensated = true;
		execution.status = "compensated";
		return;
	}
	applySettled(call, event);
}

export function trimTerminalExecutions(state: LedgerSnapshot): void {
	const terminal = [...state.executions.values()]
		.filter((execution) => !["running", "incomplete", "paused"].includes(execution.status))
		.sort((left, right) => right.updatedAt - left.updatedAt);
	for (const execution of terminal.slice(MAX_RETAINED_EXECUTIONS)) state.executions.delete(execution.executionId);
}

export function executionHistory(state: LedgerSnapshot): CodeModeExecutionHistoryItem[] {
	return [...state.executions.values()]
		.sort((left, right) => right.createdAt - left.createdAt)
		.map(({ calls, attempt: _attempt, cwd: _cwd, ...execution }) => ({
			...execution,
			tools: [...new Set([...calls.values()].map((call) => call.name))],
		}));
}
