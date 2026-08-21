import { randomUUID } from "node:crypto";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { parseForStorage, stringifyForStorage } from "./cloudflare/codec.js";
import type { Snippet } from "./cloudflare/snippet.js";
import { stableStringify } from "./cloudflare/stable-stringify.js";
import type { RuntimeToolCallPlan, RuntimeToolCallSettlement } from "./protocol.js";

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

type StoredValue = { readonly kind: "undefined" } | { readonly json: unknown; readonly kind: "json" };

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
	args: unknown;
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
	value?: unknown;
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
	readonly input: unknown;
	readonly name: string;
	readonly sequence: number;
	readonly value: unknown;
}

export interface CodeModePendingAction {
	readonly args: unknown;
	readonly connector: "tools";
	readonly executionId: string;
	readonly method: string;
	readonly seq: number;
}

export type CodeModeStepDecision =
	| { readonly kind: "execute"; readonly plan: RuntimeToolCallPlan }
	| { readonly kind: "replay"; readonly result: unknown };

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

function isRecord(value: unknown): value is Record<string, unknown> {
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

function durableValue(what: string, value: unknown): StoredValue {
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
	return { json: JSON.parse(serialized), kind: "json" };
}

function optionalPresentationValue(value: unknown): StoredValue | undefined {
	try {
		return durableValue("The Tool presentation result", value);
	} catch {
		return undefined;
	}
}

function restoreValue(value: StoredValue | undefined): unknown {
	if (!value || value.kind === "undefined") return undefined;
	return parseForStorage(JSON.stringify(value.json));
}

function storedValue(value: unknown): value is StoredValue {
	return (
		isRecord(value) && (value["kind"] === "undefined" || (value["kind"] === "json" && Object.hasOwn(value, "json")))
	);
}

function eventFrom(value: unknown): LedgerEvent | undefined {
	if (!isRecord(value) || value["schemaVersion"] !== SCHEMA_VERSION || !isRuntimeString(value["kind"])) {
		return undefined;
	}
	if (!isRuntimeNumber(value["at"]) || !Number.isFinite(value["at"])) return undefined;
	const executionId = isRuntimeString(value["executionId"]) && value["executionId"].length > 0;
	switch (value["kind"]) {
		case "execution-started":
			return executionId &&
				isRuntimeString(value["code"]) &&
				(value["cwd"] === undefined || isRuntimeString(value["cwd"])) &&
				isRuntimeString(value["outerToolCallId"])
				? (value as unknown as ExecutionStartedEvent)
				: undefined;
		case "call-pending":
		case "call-started":
			return executionId &&
				isRuntimeString(value["argsKey"]) &&
				storedValue(value["args"]) &&
				isRuntimeString(value["callId"]) &&
				isRuntimeString(value["name"]) &&
				(value["replay"] === "never" || value["replay"] === "record" || value["replay"] === "reexecute") &&
				Number.isInteger(value["attempt"]) &&
				Number.isInteger(value["sequence"])
				? (value as unknown as CallPendingEvent | CallStartedEvent)
				: undefined;
		case "call-settled":
			return executionId &&
				isRuntimeString(value["callId"]) &&
				(value["status"] === "error" || value["status"] === "success") &&
				(value["error"] === undefined || isRuntimeString(value["error"])) &&
				(value["result"] === undefined || storedValue(value["result"])) &&
				(value["value"] === undefined || storedValue(value["value"]))
				? (value as unknown as CallSettledEvent)
				: undefined;
		case "call-compensated":
			return executionId && isRuntimeString(value["callId"])
				? (value as unknown as CallCompensatedEvent)
				: undefined;
		case "execution-settled":
			return executionId &&
				Number.isInteger(value["attempt"]) &&
				[
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
				].includes(String(value["status"])) &&
				(value["error"] === undefined || isRuntimeString(value["error"]))
				? (value as unknown as ExecutionSettledEvent)
				: undefined;
		case "execution-pruned":
			return executionId ? (value as unknown as ExecutionPrunedEvent) : undefined;
		case "execution-resumed":
			return executionId && Number.isInteger(value["attempt"])
				? (value as unknown as ExecutionResumedEvent)
				: undefined;
		case "snippet-saved": {
			const snippet = value["snippet"];
			return isRecord(snippet) &&
				isRuntimeString(snippet["name"]) &&
				isRuntimeString(snippet["description"]) &&
				isRuntimeString(snippet["code"]) &&
				isRuntimeNumber(snippet["savedAt"])
				? (value as unknown as SnippetSavedEvent)
				: undefined;
		}
		case "snippet-deleted":
			return isRuntimeString(value["name"]) ? (value as unknown as SnippetDeletedEvent) : undefined;
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
	return state;
}

function applyEvent(state: LedgerSnapshot, event: LedgerEvent): void {
	if (event.kind === "execution-started") {
		state.executions.set(event.executionId, {
			attempt: 0,
			calls: new Map(),
			code: event.code,
			createdAt: event.at,
			...(event.cwd === undefined ? {} : { cwd: event.cwd }),
			executionId: event.executionId,
			outerToolCallId: event.outerToolCallId,
			status: "running",
			toolCalls: 0,
			updatedAt: event.at,
		});
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
	if (event.result) call.result = restoreValue(event.result) as AgentToolResult<unknown>;
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

	beginToolCall = (name: string, input: unknown): RuntimeToolCallPlan => this.planCall(name, input);

	beginStep(name: string): CodeModeStepDecision {
		const plan = this.planCall(`codemode.step:${name}`, undefined, "record");
		if (!plan.replay) return { kind: "execute", plan };
		if (plan.replay.kind === "error") throw new Error(plan.replay.message);
		return { kind: "replay", result: plan.replay.value };
	}

	completeStep(plan: RuntimeToolCallPlan, value: unknown): void {
		if (plan.executionId !== this.execution.executionId)
			throw new Error("Code Mode step belongs to another execution");
		const call = this.execution.calls.get(plan.sequence);
		if (!call?.name.startsWith("codemode.step:")) throw new Error("Code Mode step record has no matching decision");
		this.completeToolCall(plan, { status: "success", value });
	}

	private planCall(name: string, input: unknown, policy?: ReplayPolicy): RuntimeToolCallPlan {
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
				return {
					attempt: this.passAttempt,
					executionId: this.execution.executionId,
					id: callId,
					replay: {
						kind: "error",
						message: existing.error ?? `${name} failed`,
						...(existing.result ? { result: existing.result } : {}),
					},
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
				return {
					attempt: this.passAttempt,
					executionId: this.execution.executionId,
					id: callId,
					replay: {
						kind: "result",
						...(existing.result ? { result: existing.result } : {}),
						value: existing.value,
					},
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
		this.ledger.append(this.scope, this.state, {
			at: Date.now(),
			callId: plan.id,
			...(settlement.message ? { error: settlement.message } : {}),
			executionId: this.execution.executionId,
			kind: "call-settled",
			...(result ? { result } : {}),
			schemaVersion: SCHEMA_VERSION,
			status: settlement.status,
			...(value ? { value } : {}),
		});
	};

	finish(status: CodeModeExecutionStatus, error?: string): void {
		if (this.execution.status === status && this.execution.error === error) return;
		this.ledger.append(this.scope, this.state, {
			at: Date.now(),
			attempt: this.passAttempt,
			...(error ? { error } : {}),
			executionId: this.execution.executionId,
			kind: "execution-settled",
			schemaVersion: SCHEMA_VERSION,
			status,
		});
	}
}
