import { randomUUID } from "node:crypto";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isJsonSourceValue, type JsonObject, type JsonValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { type CodemodeValue, parseForStorage, stringifyForStorage } from "./cloudflare/codec.js";
import type { Snippet } from "./cloudflare/snippet.js";
import { stableStringify } from "./cloudflare/stable-stringify.js";
import type { RuntimeToolCallPlan, RuntimeToolCallSettlement, RuntimeToolReplay } from "./protocol.js";

export const CODE_MODE_LEDGER_ENTRY_TYPE = "pi-stuff-code-mode-ledger";
const SCHEMA_VERSION = 1;
const MAX_DURABLE_VALUE_BYTES = 1_000_000;
const MAX_EXECUTIONS = 50;
const PAUSED_TTL_MS = 24 * 60 * 60 * 1_000;

export type CodeModeExecutionStatus =
	| "abandoned"
	| "cancelled"
	| "compensated"
	| "error"
	| "expired"
	| "incomplete"
	| "paused"
	| "rejected"
	| "rolled_back"
	| "running"
	| "success";

type ReplayPolicy = "never" | "record" | "reexecute";

type StoredValue = { readonly kind: "undefined" } | { readonly json: JsonValue; readonly kind: "json" };

interface ExecutionStartedEvent {
	readonly at: number;
	readonly code: string;
	readonly cwd?: string;
	readonly executionId: string;
	readonly kind: "execution-started";
	readonly outerToolCallId: string;
	readonly schemaVersion: 1;
}

interface CallStartedEvent {
	readonly args: StoredValue;
	readonly argsKey: string;
	readonly at: number;
	readonly attempt: number;
	readonly callId: string;
	readonly executionId: string;
	readonly kind: "call-started";
	readonly name: string;
	readonly replay: ReplayPolicy;
	readonly requiresApproval?: boolean;
	readonly schemaVersion: 1;
	readonly sequence: number;
}

interface CallPendingEvent {
	readonly args: StoredValue;
	readonly argsKey: string;
	readonly at: number;
	readonly attempt: number;
	readonly callId: string;
	readonly executionId: string;
	readonly kind: "call-pending";
	readonly name: string;
	readonly replay: ReplayPolicy;
	readonly schemaVersion: 1;
	readonly sequence: number;
}

interface CallSettledEvent {
	readonly at: number;
	readonly callId: string;
	readonly error?: string;
	readonly executionId: string;
	readonly kind: "call-settled";
	readonly result?: StoredValue;
	readonly schemaVersion: 1;
	readonly status: "error" | "success";
	readonly value?: StoredValue;
}

interface CallCompensatedEvent {
	readonly at: number;
	readonly callId: string;
	readonly executionId: string;
	readonly kind: "call-compensated";
	readonly schemaVersion: 1;
}

interface ExecutionSettledEvent {
	readonly at: number;
	readonly attempt: number;
	readonly error?: string;
	readonly executionId: string;
	readonly kind: "execution-settled";
	readonly schemaVersion: 1;
	readonly status: CodeModeExecutionStatus;
}

interface ExecutionPrunedEvent {
	readonly at: number;
	readonly executionId: string;
	readonly kind: "execution-pruned";
	readonly schemaVersion: 1;
}

interface ExecutionResumedEvent {
	readonly at: number;
	readonly attempt: number;
	readonly executionId: string;
	readonly kind: "execution-resumed";
	readonly schemaVersion: 1;
}

interface SnippetSavedEvent {
	readonly at: number;
	readonly kind: "snippet-saved";
	readonly schemaVersion: 1;
	readonly snippet: Snippet;
}

interface SnippetDeletedEvent {
	readonly at: number;
	readonly kind: "snippet-deleted";
	readonly name: string;
	readonly schemaVersion: 1;
}

type LedgerEvent =
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

interface CallState {
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
	code: string;
	createdAt: number;
	error?: string;
	executionId: string;
	outerToolCallId: string;
	status: CodeModeExecutionStatus;
	toolCalls: number;
	updatedAt: number;
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

export type CodeModeStepDecision =
	| { readonly kind: "execute"; readonly plan: RuntimeToolCallPlan }
	| { readonly kind: "replay"; readonly result: CodemodeValue };

interface ExecutionState extends CodeModeExecutionHistoryItem {
	attempt: number;
	calls: Map<number, CallState>;
	cwd?: string;
	status: CodeModeExecutionStatus;
	updatedAt: number;
}

interface LedgerSnapshot {
	executions: Map<string, ExecutionState>;
	snippets: Map<string, Snippet>;
}

interface SessionEntry {
	readonly customType?: string;
	readonly data?: unknown;
	readonly type?: string;
}

interface SessionScope {
	readonly context: ExtensionContext;
	readonly sessionId?: string;
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function sessionId(context: ExtensionContext): string | undefined {
	try {
		return context.sessionManager.getSessionId();
	} catch {
		return undefined;
	}
}

function sessionEntries(context: ExtensionContext): readonly SessionEntry[] {
	try {
		return context.sessionManager.getBranch?.() ?? context.sessionManager.getEntries();
	} catch {
		return [];
	}
}

function sessionScope(context: ExtensionContext): SessionScope {
	const id = sessionId(context);
	return id ? { context, sessionId: id } : { context };
}

function durableValue<Value>(what: string, value: Value): StoredValue {
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

function optionalPresentationValue(value: AgentToolResult<unknown>): StoredValue | undefined {
	try {
		return durableValue("The Tool presentation result", value);
	} catch {
		return undefined;
	}
}

function restoreValue(value: StoredValue | undefined): CodemodeValue {
	if (!value || value.kind === "undefined") return undefined;
	return parseForStorage(JSON.stringify(value.json));
}

function parseStoredValue(value: JsonValue | undefined): StoredValue | undefined {
	if (!value || !isRecord(value)) return undefined;
	if (value["kind"] === "undefined") return { kind: "undefined" };
	const json = value["json"];
	return value["kind"] === "json" && Object.hasOwn(value, "json") && json !== undefined
		? { json, kind: "json" }
		: undefined;
}

function eventFrom(source: SessionEntry["data"]): LedgerEvent | undefined {
	if (!isJsonSourceValue(source)) return undefined;
	const value = parseJsonValue(JSON.stringify(source));
	if (!isRecord(value) || value["schemaVersion"] !== SCHEMA_VERSION || !isRuntimeString(value["kind"])) {
		return undefined;
	}
	if (!isRuntimeNumber(value["at"]) || !Number.isFinite(value["at"])) return undefined;
	const at = value["at"];
	const executionId =
		isRuntimeString(value["executionId"]) && value["executionId"].length > 0 ? value["executionId"] : undefined;
	switch (value["kind"]) {
		case "execution-started": {
			const code = value["code"];
			const cwd = value["cwd"];
			const outerToolCallId = value["outerToolCallId"];
			if (
				!executionId ||
				!isRuntimeString(code) ||
				(cwd !== undefined && !isRuntimeString(cwd)) ||
				!isRuntimeString(outerToolCallId)
			) {
				return undefined;
			}
			const event: ExecutionStartedEvent = {
				at,
				code,
				executionId,
				kind: "execution-started",
				outerToolCallId,
				schemaVersion: SCHEMA_VERSION,
			};
			return cwd === undefined ? event : { ...event, cwd };
		}
		case "call-pending":
		case "call-started": {
			const args = parseStoredValue(value["args"]);
			const argsKey = value["argsKey"];
			const attempt = value["attempt"];
			const callId = value["callId"];
			const name = value["name"];
			const replay = value["replay"];
			const requiresApproval = value["requiresApproval"];
			const sequence = value["sequence"];
			if (
				!executionId ||
				!args ||
				!isRuntimeString(argsKey) ||
				!isRuntimeNumber(attempt) ||
				!Number.isInteger(attempt) ||
				!isRuntimeString(callId) ||
				!isRuntimeString(name) ||
				(replay !== "never" && replay !== "record" && replay !== "reexecute") ||
				(requiresApproval !== undefined && !isRuntimeBoolean(requiresApproval)) ||
				!isRuntimeNumber(sequence) ||
				!Number.isInteger(sequence)
			) {
				return undefined;
			}
			const common: Omit<CallPendingEvent, "kind"> = {
				args,
				argsKey,
				at,
				attempt,
				callId,
				executionId,
				name,
				replay,
				schemaVersion: SCHEMA_VERSION,
				sequence,
			};
			if (value["kind"] === "call-pending") return { ...common, kind: "call-pending" };
			const event: CallStartedEvent = { ...common, kind: "call-started" };
			return requiresApproval === undefined ? event : { ...event, requiresApproval };
		}
		case "call-settled": {
			const callId = value["callId"];
			const error = value["error"];
			const result = parseStoredValue(value["result"]);
			const status = value["status"];
			const settledValue = parseStoredValue(value["value"]);
			if (
				!executionId ||
				!isRuntimeString(callId) ||
				(status !== "error" && status !== "success") ||
				(error !== undefined && !isRuntimeString(error)) ||
				(value["result"] !== undefined && !result) ||
				(value["value"] !== undefined && !settledValue)
			) {
				return undefined;
			}
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
		case "call-compensated": {
			const callId = value["callId"];
			return executionId && isRuntimeString(callId)
				? { at, callId, executionId, kind: "call-compensated", schemaVersion: SCHEMA_VERSION }
				: undefined;
		}
		case "execution-settled": {
			const attempt = value["attempt"];
			const error = value["error"];
			const status = value["status"];
			if (
				!executionId ||
				!isRuntimeNumber(attempt) ||
				!Number.isInteger(attempt) ||
				(status !== "abandoned" &&
					status !== "cancelled" &&
					status !== "compensated" &&
					status !== "error" &&
					status !== "expired" &&
					status !== "incomplete" &&
					status !== "paused" &&
					status !== "rejected" &&
					status !== "rolled_back" &&
					status !== "running" &&
					status !== "success") ||
				(error !== undefined && !isRuntimeString(error))
			) {
				return undefined;
			}
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
		case "execution-pruned":
			return executionId ? { at, executionId, kind: "execution-pruned", schemaVersion: SCHEMA_VERSION } : undefined;
		case "execution-resumed": {
			const attempt = value["attempt"];
			return executionId && isRuntimeNumber(attempt) && Number.isInteger(attempt)
				? { at, attempt, executionId, kind: "execution-resumed", schemaVersion: SCHEMA_VERSION }
				: undefined;
		}
		case "snippet-saved": {
			const snippet = value["snippet"];
			if (!isRecord(snippet)) return undefined;
			const code = snippet["code"];
			const connectors = snippet["connectors"];
			const description = snippet["description"];
			const name = snippet["name"];
			const savedAt = snippet["savedAt"];
			if (
				!isRuntimeString(code) ||
				(connectors !== undefined &&
					(!Array.isArray(connectors) || !connectors.every((connector) => isRuntimeString(connector)))) ||
				!isRuntimeString(description) ||
				!isRuntimeString(name) ||
				!isRuntimeNumber(savedAt) ||
				!Number.isFinite(savedAt)
			) {
				return undefined;
			}
			const parsed: Snippet = { code, description, name, savedAt };
			if (connectors !== undefined) parsed.connectors = connectors;
			if (Object.hasOwn(snippet, "inputSchema")) parsed.inputSchema = snippet["inputSchema"];
			return { at, kind: "snippet-saved", schemaVersion: SCHEMA_VERSION, snippet: parsed };
		}
		case "snippet-deleted": {
			const name = value["name"];
			return isRuntimeString(name)
				? { at, kind: "snippet-deleted", name, schemaVersion: SCHEMA_VERSION }
				: undefined;
		}
		default:
			return undefined;
	}
}

function effectiveEvents(context: ExtensionContext): LedgerEvent[] {
	return sessionEntries(context)
		.filter((entry) => entry.type === "custom" && entry.customType === CODE_MODE_LEDGER_ENTRY_TYPE)
		.flatMap((entry) => {
			const event = eventFrom(entry.data);
			return event ? [event] : [];
		});
}

function snapshot(context: ExtensionContext): LedgerSnapshot {
	const state: LedgerSnapshot = { executions: new Map(), snippets: new Map() };
	for (const event of effectiveEvents(context)) applyEvent(state, event);
	normalizeHistoricalToolErrors(state);
	return state;
}

function normalizeHistoricalToolErrors(state: LedgerSnapshot): void {
	for (const execution of state.executions.values()) {
		for (const call of execution.calls.values()) {
			const result = call.result;
			if (call.status !== "success" || !result || !("isError" in result) || result.isError !== true) continue;
			call.status = "error";
			const text = result.content.find((item) => item.type === "text" && item.text.trim());
			call.error ??= text?.type === "text" ? text.text.trim() : `${call.name} failed`;
		}
	}
}

function isStoredToolContent(value: CodemodeValue): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(item) =>
				isRuntimeObject(item) &&
				item !== null &&
				isRuntimeString(item["type"]) &&
				(item["type"] !== "text" || isRuntimeString(item["text"])),
		)
	);
}

function applyEvent(state: LedgerSnapshot, event: LedgerEvent): void {
	if (event.kind === "execution-started") {
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
		if (event.cwd !== undefined) execution.cwd = event.cwd;
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
		return;
	}
	const call = [...execution.calls.values()].find((candidate) => candidate.callId === event.callId);
	if (!call) return;
	if (event.kind === "call-compensated") {
		call.compensated = true;
		return;
	}
	call.status = event.status;
	if (event.error) call.error = event.error;
	if (event.value) {
		call.value = restoreValue(event.value);
		call.valuePresent = true;
	}
	if (event.result) {
		const result = restoreValue(event.result);
		if (isRuntimeObject(result) && result !== null && "content" in result && isStoredToolContent(result["content"])) {
			// SAFETY: call-settled events persist AgentToolResult through the lossless storage codec.
			call.result = result as CodemodeValue & AgentToolResult<unknown>;
		}
	}
}

export class CodeModeIncompleteExecutionError extends Error {
	readonly executionId: string;

	constructor(executionId: string, message: string) {
		super(message);
		this.name = "CodeModeIncompleteExecutionError";
		this.executionId = executionId;
	}
}

export class CodeModeSessionLedger {
	private readonly pi: Pick<ExtensionAPI, "appendEntry">;

	constructor(pi: Pick<ExtensionAPI, "appendEntry">) {
		this.pi = pi;
	}

	begin(
		context: ExtensionContext,
		outerToolCallId: string,
		code: string,
		policies: ReadonlyMap<string, ReplayPolicy>,
		requiresApproval: ReadonlySet<string> = new Set(),
	): CodeModeExecutionController {
		const codeBytes = Buffer.byteLength(code);
		if (codeBytes > MAX_DURABLE_VALUE_BYTES) {
			throw new Error(
				`Code Mode source is too large to record durably (${String(codeBytes)} bytes > ${String(MAX_DURABLE_VALUE_BYTES)} byte limit). Move large data out of the program and keep the source small.`,
			);
		}
		const scope = sessionScope(context);
		const state = snapshot(context);
		this.maintain(scope, state);
		const executionId = `cm_${randomUUID()}`;
		const event: ExecutionStartedEvent = {
			at: Date.now(),
			code,
			cwd: context.cwd,
			executionId,
			kind: "execution-started",
			outerToolCallId,
			schemaVersion: SCHEMA_VERSION,
		};
		this.append(scope, state, event);
		const execution = state.executions.get(executionId);
		if (!execution) throw new Error("Code Mode execution ledger failed to initialize");
		return new CodeModeExecutionController(this, scope, state, execution, policies, requiresApproval);
	}

	pending(context: ExtensionContext, executionId?: string): readonly CodeModePendingAction[] {
		return [...snapshot(context).executions.values()]
			.filter(
				(execution) => execution.status === "paused" && (!executionId || execution.executionId === executionId),
			)
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.flatMap((execution) =>
				[...execution.calls.values()]
					.filter((call) => call.status === "pending")
					.sort((left, right) => left.sequence - right.sequence)
					.map((call) => ({
						args: call.args,
						connector: "tools" as const,
						executionId: execution.executionId,
						method: call.name,
						seq: call.sequence,
					})),
			);
	}

	resume(
		context: ExtensionContext,
		executionId: string,
		policies: ReadonlyMap<string, ReplayPolicy>,
		requiresApproval: ReadonlySet<string> = new Set(),
	): CodeModeExecutionController | undefined {
		const scope = sessionScope(context);
		const state = snapshot(context);
		const execution = state.executions.get(executionId);
		const pending = execution ? [...execution.calls.values()].filter((call) => call.status === "pending") : [];
		if (execution?.status !== "paused" || pending.length === 0) {
			return undefined;
		}
		if (execution.cwd !== undefined && execution.cwd !== context.cwd) {
			throw new Error(
				`Code Mode execution started in ${JSON.stringify(execution.cwd)}; current working directory is ${JSON.stringify(context.cwd)}. Return to the original directory before approving it.`,
			);
		}
		const missing = pending.find((call) => !policies.has(call.name));
		if (missing) {
			throw new Error(
				`Code Mode pending Tool ${JSON.stringify(missing.name)} is no longer active. Restore it before approving the execution.`,
			);
		}
		this.append(scope, state, {
			at: Date.now(),
			attempt: execution.attempt + 1,
			executionId,
			kind: "execution-resumed",
			schemaVersion: SCHEMA_VERSION,
		});
		return new CodeModeExecutionController(this, scope, state, execution, policies, requiresApproval);
	}

	reject(context: ExtensionContext, executionId: string, sequence: number): boolean {
		const scope = sessionScope(context);
		const state = snapshot(context);
		const execution = state.executions.get(executionId);
		if (execution?.status !== "paused" || execution.calls.get(sequence)?.status !== "pending") return false;
		this.append(scope, state, {
			at: Date.now(),
			attempt: execution.attempt,
			error: `Rejected by the user before ${execution.calls.get(sequence)?.name ?? "pending Tool"}`,
			executionId,
			kind: "execution-settled",
			schemaVersion: SCHEMA_VERSION,
			status: "rejected",
		});
		return true;
	}

	history(context: ExtensionContext, limit = 20): readonly CodeModeExecutionHistoryItem[] {
		return [...snapshot(context).executions.values()]
			.sort((left, right) => right.createdAt - left.createdAt)
			.slice(0, Math.max(0, limit))
			.map(({ calls: _calls, attempt: _attempt, cwd: _cwd, ...execution }) => execution);
	}

	snippets(context: ExtensionContext): readonly Snippet[] {
		return [...snapshot(context).snippets.values()].sort((left, right) => left.name.localeCompare(right.name));
	}

	saveSnippet(context: ExtensionContext, executionId: string, name: string, description = ""): Snippet {
		const normalizedName = name.trim();
		if (!normalizedName || normalizedName.length > 120) {
			throw new Error("Code Mode snippet name must be 1-120 characters");
		}
		const scope = sessionScope(context);
		const state = snapshot(context);
		const execution = state.executions.get(executionId);
		if (!execution) throw new Error(`No Code Mode execution ${JSON.stringify(executionId)} exists in this Session`);
		if (execution.status !== "success") throw new Error("Only a successful Code Mode execution can become a snippet");
		const snippet: Snippet = {
			code: execution.code,
			connectors: ["tools"],
			description,
			name: normalizedName,
			savedAt: Date.now(),
		};
		this.append(scope, state, { at: snippet.savedAt, kind: "snippet-saved", schemaVersion: SCHEMA_VERSION, snippet });
		return snippet;
	}

	deleteSnippet(context: ExtensionContext, name: string): boolean {
		const scope = sessionScope(context);
		const state = snapshot(context);
		if (!state.snippets.has(name)) return false;
		this.append(scope, state, { at: Date.now(), kind: "snippet-deleted", name, schemaVersion: SCHEMA_VERSION });
		return true;
	}

	expire(context: ExtensionContext, maxAgeMs = PAUSED_TTL_MS): readonly string[] {
		if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)
			throw new Error("Code Mode expiry age must be a non-negative number");
		const scope = sessionScope(context);
		const state = snapshot(context);
		return this.expireState(scope, state, Date.now(), maxAgeMs);
	}

	abandon(context: ExtensionContext, executionId: string): boolean {
		const scope = sessionScope(context);
		const state = snapshot(context);
		const execution = state.executions.get(executionId);
		if (!execution || (execution.status !== "running" && execution.status !== "incomplete")) return false;
		this.append(scope, state, {
			at: Date.now(),
			attempt: execution.attempt,
			error: "Abandoned by explicit user decision",
			executionId,
			kind: "execution-settled",
			schemaVersion: SCHEMA_VERSION,
			status: "abandoned",
		});
		return true;
	}

	compensationTargets(context: ExtensionContext, executionId: string): readonly CodeModeCompensationTarget[] {
		const execution = snapshot(context).executions.get(executionId);
		if (!execution) throw new Error(`No Code Mode execution ${JSON.stringify(executionId)} exists in this Session`);
		return [...execution.calls.values()]
			.filter((call) => call.status === "success" && call.valuePresent && !call.compensated)
			.sort((left, right) => right.sequence - left.sequence)
			.map((call) => ({
				callId: call.callId,
				input: call.args,
				name: call.name,
				sequence: call.sequence,
				value: call.value,
			}));
	}

	markCompensated(context: ExtensionContext, executionId: string, callId: string): void {
		const scope = sessionScope(context);
		const state = snapshot(context);
		const execution = state.executions.get(executionId);
		const call = execution
			? [...execution.calls.values()].find((candidate) => candidate.callId === callId)
			: undefined;
		if (call?.status !== "success") {
			throw new Error(`No applied Code Mode call ${JSON.stringify(callId)} exists in execution ${executionId}`);
		}
		if (call.compensated) return;
		this.append(scope, state, {
			at: Date.now(),
			callId,
			executionId,
			kind: "call-compensated",
			schemaVersion: SCHEMA_VERSION,
		});
	}

	markCompensationComplete(context: ExtensionContext, executionId: string): void {
		const scope = sessionScope(context);
		const state = snapshot(context);
		const execution = state.executions.get(executionId);
		if (!execution) throw new Error(`No Code Mode execution ${JSON.stringify(executionId)} exists in this Session`);
		this.append(scope, state, {
			at: Date.now(),
			attempt: execution.attempt,
			executionId,
			kind: "execution-settled",
			schemaVersion: SCHEMA_VERSION,
			status: "rolled_back",
		});
	}

	append(scope: SessionScope, state: LedgerSnapshot, event: LedgerEvent): void {
		if (scope.sessionId) {
			if (sessionId(scope.context) !== scope.sessionId) {
				throw new Error("Code Mode Session changed before its execution ledger could be updated");
			}
		}
		this.pi.appendEntry(CODE_MODE_LEDGER_ENTRY_TYPE, event);
		applyEvent(state, event);
	}

	private maintain(scope: SessionScope, state: LedgerSnapshot): void {
		const now = Date.now();
		this.expireState(scope, state, now, PAUSED_TTL_MS);
		const terminal = [...state.executions.values()]
			.filter(
				(execution) =>
					execution.status !== "running" && execution.status !== "incomplete" && execution.status !== "paused",
			)
			.sort((left, right) => right.updatedAt - left.updatedAt);
		for (const execution of terminal.slice(MAX_EXECUTIONS)) {
			this.append(scope, state, {
				at: now,
				executionId: execution.executionId,
				kind: "execution-pruned",
				schemaVersion: SCHEMA_VERSION,
			});
		}
	}

	private expireState(scope: SessionScope, state: LedgerSnapshot, now: number, maxAgeMs: number): string[] {
		const expired: string[] = [];
		for (const execution of state.executions.values()) {
			if (
				(execution.status === "running" || execution.status === "incomplete" || execution.status === "paused") &&
				now - execution.updatedAt >= maxAgeMs
			) {
				const paused = execution.status === "paused";
				this.append(scope, state, {
					at: now,
					attempt: execution.attempt,
					error: paused
						? "Code Mode approval expired after 24 hours"
						: "Code Mode execution expired after 24 hours",
					executionId: execution.executionId,
					kind: "execution-settled",
					schemaVersion: SCHEMA_VERSION,
					status: paused ? "rejected" : "expired",
				});
				expired.push(execution.executionId);
			}
		}
		return expired;
	}
}

export class CodeModeExecutionController {
	private passAttempt = 0;
	private cursor = 0;
	private readonly execution: ExecutionState;
	private readonly ledger: CodeModeSessionLedger;
	private readonly policies: ReadonlyMap<string, ReplayPolicy>;
	private readonly requiresApproval: ReadonlySet<string>;
	private readonly scope: SessionScope;
	private readonly state: LedgerSnapshot;
	incompleteError?: CodeModeIncompleteExecutionError;

	constructor(
		ledger: CodeModeSessionLedger,
		scope: SessionScope,
		state: LedgerSnapshot,
		execution: ExecutionState,
		policies: ReadonlyMap<string, ReplayPolicy>,
		requiresApproval: ReadonlySet<string>,
	) {
		this.ledger = ledger;
		this.scope = scope;
		this.state = state;
		this.execution = execution;
		this.policies = policies;
		this.requiresApproval = requiresApproval;
	}

	get executionId(): string {
		return this.execution.executionId;
	}

	get attempt(): number {
		return this.execution.attempt;
	}

	get code(): string {
		return this.execution.code;
	}

	get outerToolCallId(): string {
		return this.execution.outerToolCallId;
	}

	get isPaused(): boolean {
		return this.execution.status === "paused";
	}

	beginPass(attempt: number): void {
		this.passAttempt = attempt;
		this.cursor = 0;
	}

	beginToolCall = (name: string, input: CodemodeValue): RuntimeToolCallPlan => this.planCall(name, input);

	beginStep(name: string): CodeModeStepDecision {
		const plan = this.planCall(`codemode.step:${name}`, undefined, "record");
		if (!plan.replay) return { kind: "execute", plan };
		if (plan.replay.kind === "error") throw new Error(plan.replay.message);
		return { kind: "replay", result: plan.replay.value };
	}

	completeStep(plan: RuntimeToolCallPlan, value: CodemodeValue): void {
		if (plan.executionId !== this.execution.executionId)
			throw new Error("Code Mode step belongs to another execution");
		const call = this.execution.calls.get(plan.sequence);
		if (!call?.name.startsWith("codemode.step:")) throw new Error("Code Mode step record has no matching decision");
		this.completeToolCall(plan, { status: "success", value });
	}

	private planCall(name: string, input: CodemodeValue, policy?: ReplayPolicy): RuntimeToolCallPlan {
		const sequence = this.cursor++;
		const callId = `${this.execution.executionId}:${String(sequence)}`;
		if (this.execution.status !== "running") {
			return {
				attempt: this.passAttempt,
				executionId: this.execution.executionId,
				id: callId,
				pause: { message: `Code Mode execution ${this.execution.executionId} is paused for user approval` },
				sequence,
			};
		}
		const replay = policy ?? this.policies.get(name) ?? "never";
		const args = durableValue(`Arguments to ${name}`, input);
		const serializedArgs = stableStringify(input);
		if (serializedArgs === undefined && input !== undefined) {
			throw new Error(`Code Mode Tool ${JSON.stringify(name)} received non-serializable input`);
		}
		const argsKey = serializedArgs ?? "undefined";
		const existing = this.execution.calls.get(sequence);
		if (existing) {
			if (existing.name !== name || existing.argsKey !== argsKey) {
				const message = `Code Mode replay divergence at step ${String(sequence)}: expected ${existing.name} with the recorded arguments, received ${name}.`;
				this.finish("error", message);
				throw new Error(message);
			}
			if (existing.status === "error") {
				const replayResult: RuntimeToolReplay = {
					kind: "error",
					message: existing.error ?? `${name} failed`,
				};
				if (existing.result) Object.assign(replayResult, { result: existing.result });
				return {
					attempt: this.passAttempt,
					executionId: this.execution.executionId,
					id: callId,
					replay: replayResult,
					sequence,
				};
			}
			if (existing.status === "pending") {
				this.ledger.append(this.scope, this.state, {
					args,
					argsKey,
					at: Date.now(),
					attempt: this.passAttempt,
					callId,
					executionId: this.execution.executionId,
					kind: "call-started",
					name,
					replay: existing.replay,
					requiresApproval: true,
					schemaVersion: SCHEMA_VERSION,
					sequence,
				});
				return { attempt: this.passAttempt, executionId: this.execution.executionId, id: callId, sequence };
			}
			if (existing.status === "success" && replay !== "reexecute" && existing.valuePresent) {
				const replayResult: RuntimeToolReplay = {
					kind: "result",
					value: existing.value,
				};
				if (existing.result) Object.assign(replayResult, { result: existing.result });
				return {
					attempt: this.passAttempt,
					executionId: this.execution.executionId,
					id: callId,
					replay: replayResult,
					sequence,
				};
			}
			if (replay !== "reexecute") {
				const message = `Code Mode execution ${this.execution.executionId} stopped after Runtime loss at unsettled Tool ${JSON.stringify(name)} with replay policy ${JSON.stringify(replay)}. The external effect may have happened; inspect it and explicitly decide whether to repeat or abandon the work.`;
				this.incompleteError = new CodeModeIncompleteExecutionError(this.execution.executionId, message);
				this.finish("incomplete", message);
				throw this.incompleteError;
			}
		}
		if (this.requiresApproval.has(name)) {
			if (replay === "reexecute") {
				throw new Error(
					`Code Mode Tool ${JSON.stringify(name)} cannot combine requiresApproval with replay: reexecute`,
				);
			}
			const message = `Code Mode execution ${this.execution.executionId} paused before ${name}; user approval is required`;
			this.ledger.append(this.scope, this.state, {
				args,
				argsKey,
				at: Date.now(),
				attempt: this.passAttempt,
				callId,
				executionId: this.execution.executionId,
				kind: "call-pending",
				name,
				replay,
				schemaVersion: SCHEMA_VERSION,
				sequence,
			});
			return {
				attempt: this.passAttempt,
				executionId: this.execution.executionId,
				id: callId,
				pause: { message },
				sequence,
			};
		}
		this.ledger.append(this.scope, this.state, {
			args,
			argsKey,
			at: Date.now(),
			attempt: this.passAttempt,
			callId,
			executionId: this.execution.executionId,
			kind: "call-started",
			name,
			replay,
			requiresApproval: false,
			schemaVersion: SCHEMA_VERSION,
			sequence,
		});
		return { attempt: this.passAttempt, executionId: this.execution.executionId, id: callId, sequence };
	}

	completeToolCall = (plan: RuntimeToolCallPlan, settlement: RuntimeToolCallSettlement): void => {
		const call = this.execution.calls.get(plan.sequence);
		if (
			plan.executionId !== this.execution.executionId ||
			!call ||
			call.callId !== plan.id ||
			call.status !== "running"
		) {
			throw new Error("Code Mode Tool result has no matching running ledger call");
		}
		const value =
			settlement.status === "success" ? durableValue(`The result of ${call.name}`, settlement.value) : undefined;
		const result = settlement.result ? optionalPresentationValue(settlement.result) : undefined;
		const event: CallSettledEvent = {
			at: Date.now(),
			callId: plan.id,
			executionId: this.execution.executionId,
			kind: "call-settled",
			schemaVersion: SCHEMA_VERSION,
			status: settlement.status,
		};
		if (settlement.message) Object.assign(event, { error: settlement.message });
		if (result) Object.assign(event, { result });
		if (value) Object.assign(event, { value });
		this.ledger.append(this.scope, this.state, event);
	};

	finish(status: CodeModeExecutionStatus, error?: string): void {
		if (this.execution.status === status && this.execution.error === error) return;
		const event: ExecutionSettledEvent = {
			at: Date.now(),
			attempt: this.passAttempt,
			executionId: this.execution.executionId,
			kind: "execution-settled",
			schemaVersion: SCHEMA_VERSION,
			status,
		};
		if (error) Object.assign(event, { error });
		this.ledger.append(this.scope, this.state, event);
	}
}
