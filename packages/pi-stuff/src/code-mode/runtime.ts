import type { AgentToolResult, AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import type { SuiteToolEnvelopeOperation } from "../tool-display/contract.js";
import { type CodemodeValue, isCodemodeObject, requireCodemodeValue } from "./cloudflare/codec.js";
import type { Snippet } from "./cloudflare/snippet.js";
import {
	buildSuiteSandboxSource,
	INTERNAL_STEP_DECIDE_TOOL,
	INTERNAL_STEP_RECORD_TOOL,
	type SuiteCodeModeConnector,
} from "./connector.js";
import { CodeModeHostLostError } from "./host/host-client.js";
import { codeModeImageFromDataUrl } from "./image-content.js";
import type { CodeModeExecutionController, CodeModePendingAction, CodeModeSessionLedger } from "./ledger.js";
import { captureCodeModeModelContent } from "./presentation.js";
import type {
	CodeModeExecuteOptions,
	CodeModeWaitOptions,
	ExecutorContext,
	RuntimeContentItem,
	RuntimeResponse,
	RuntimeToolCallPlan,
	RuntimeToolTrace,
	SuiteSandboxTool,
} from "./protocol.js";

const AUTO_WAIT_MS = 60_000;
const MAX_OUTPUT_CHARS = 400_000;
const NESTED_CANCELLATION_TEXT = "Operation aborted";
const HOST_RECOVERY_LIMIT = 1;

function isRuntimeToolCallPlan<Value>(value: Value): value is Value & RuntimeToolCallPlan {
	return (
		isRuntimeObject(value) &&
		value !== null &&
		"attempt" in value &&
		isRuntimeNumber(value.attempt) &&
		Number.isSafeInteger(value.attempt) &&
		"executionId" in value &&
		isRuntimeString(value.executionId) &&
		"id" in value &&
		isRuntimeString(value.id) &&
		"sequence" in value &&
		isRuntimeNumber(value.sequence) &&
		Number.isSafeInteger(value.sequence)
	);
}

export interface CodeModeExecutor {
	execute(options: CodeModeExecuteOptions): Promise<RuntimeResponse>;
	shutdown(): Promise<void>;
	wait(cellId: string, options: CodeModeWaitOptions & { readonly yieldTimeMs: number }): Promise<RuntimeResponse>;
}

export interface PiStuffCodeModeDetails {
	readonly attempt?: number;
	readonly cellId?: string;
	readonly droppedOperationCount?: number;
	readonly error?: string;
	readonly executionId?: string;
	readonly kind: "pi-stuff-code-mode";
	/** Normalized provider-facing content retained outside the Host-rendered result. */
	readonly modelContent?: AgentToolResult<unknown>["content"];
	/** Content indexes for each normalized media segment in modelContent. */
	readonly mediaContentIndexes?: readonly (readonly number[])[];
	readonly operations: readonly SuiteToolEnvelopeOperation[];
	readonly pending?: readonly CodeModePendingAction[];
	readonly status: "cancelled" | "error" | "incomplete" | "paused" | "running" | "success";
}

type ControllerSettlement = Pick<PiStuffCodeModeDetails, "error" | "status">;

function approvalMessage(executionId: string, pending: readonly CodeModePendingAction[]): string {
	const action = pending[0];
	return action
		? `Code Mode execution ${executionId} paused before tools.${action.method} at step ${String(action.seq)}. Await explicit user approval; do not repeat the action.`
		: `Code Mode execution ${executionId} paused for user approval.`;
}

function operation(trace: RuntimeToolTrace): SuiteToolEnvelopeOperation {
	let args: Readonly<Record<string, CodemodeValue>> = {};
	if (isCodemodeObject(trace.input)) args = trace.input;
	const value: SuiteToolEnvelopeOperation = {
		args,
		id: trace.id,
		name: trace.name,
		state:
			trace.status === "done"
				? "success"
				: trace.status === "pending"
					? "rejected"
					: trace.status === "error"
						? "error"
						: trace.status === "cancelled"
							? "cancelled"
							: "running",
	};
	if (trace.attempt !== undefined) Object.assign(value, { attempt: trace.attempt });
	if (trace.executionId) Object.assign(value, { executionId: trace.executionId });
	if (trace.replayed) Object.assign(value, { replayed: true });
	if (trace.result) Object.assign(value, { result: trace.result });
	if (trace.sequence !== undefined) Object.assign(value, { sequence: trace.sequence });
	return value;
}

function imageKey(item: AgentToolResult<unknown>["content"][number]): string | undefined {
	return item.type === "image" ? `${item.mimeType}\u0000${item.data}` : undefined;
}

function projectFinalMedia(
	traces: ReadonlyMap<string, RuntimeToolTrace>,
	content: AgentToolResult<unknown>["content"],
) {
	const output = [...content];
	const available = new Map<string, number[]>();
	let imageIndex = 0;
	for (const item of output) {
		const key = imageKey(item);
		if (!key) continue;
		const indexes = available.get(key) ?? [];
		indexes.push(imageIndex);
		available.set(key, indexes);
		imageIndex += 1;
	}
	const operations = [...traces.values()].map((trace) => {
		const projected = operation(trace);
		if (!trace.result) return projected;
		const mediaPlacements: Array<{ readonly afterContentIndex: number; readonly mediaIndex: number }> = [];
		const nonMedia: AgentToolResult<unknown>["content"] = [];
		for (const item of trace.result.content) {
			const key = imageKey(item);
			if (!key) {
				nonMedia.push(item);
				continue;
			}
			const reusable = available.get(key)?.shift();
			if (reusable !== undefined) {
				mediaPlacements.push({ afterContentIndex: nonMedia.length, mediaIndex: reusable });
				continue;
			}
			mediaPlacements.push({ afterContentIndex: nonMedia.length, mediaIndex: imageIndex });
			imageIndex += 1;
			output.push(item);
		}
		return mediaPlacements.length === 0
			? projected
			: {
					...projected,
					mediaPlacements,
					result: { ...trace.result, content: nonMedia },
				};
	});
	return { content: output, operations };
}

function mergeTrace(
	target: Map<string, RuntimeToolTrace>,
	operationIndexes: Map<string, number>,
	operations: SuiteToolEnvelopeOperation[],
	trace: RuntimeToolTrace,
): void {
	target.set(trace.id, trace);
	let index = operationIndexes.get(trace.id);
	if (index === undefined) {
		index = operations.length;
		operationIndexes.set(trace.id, index);
	}
	operations[index] = operation(trace);
}

function mergeTraces(
	target: Map<string, RuntimeToolTrace>,
	operationIndexes: Map<string, number>,
	operations: SuiteToolEnvelopeOperation[],
	traces: readonly RuntimeToolTrace[] | undefined,
): void {
	for (const trace of traces ?? []) mergeTrace(target, operationIndexes, operations, trace);
}

function settleRunningTraces(
	traces: ReadonlyMap<string, RuntimeToolTrace>,
	status: "cancelled" | "error",
	message: string,
): void {
	for (const trace of traces.values()) {
		if (trace.status !== "running") continue;
		trace.status = status;
		trace.error = message;
		trace.result ??= { content: [{ type: "text", text: message }], details: {} };
	}
}

function wasCancelled(cause: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (cause instanceof Error && cause.name === "AbortError");
}

function contentItem(item: RuntimeContentItem): AgentToolResult<unknown>["content"][number] | undefined {
	if (item.type === "input_text" && isRuntimeString(item.text)) return { type: "text", text: item.text };
	if (item.type !== "input_image" || !isRuntimeString(item.image_url)) return undefined;
	return codeModeImageFromDataUrl(item.image_url);
}

function boundedContent(items: readonly RuntimeContentItem[], fallback: string): AgentToolResult<unknown>["content"] {
	let remaining = MAX_OUTPUT_CHARS;
	const output: AgentToolResult<unknown>["content"] = [];
	for (const item of items) {
		const converted = contentItem(item);
		if (!converted) continue;
		if (converted.type !== "text") {
			output.push(converted);
			continue;
		}
		if (remaining <= 0) continue;
		const text = converted.text.slice(0, remaining);
		remaining -= text.length;
		output.push({ type: "text", text: text.length === converted.text.length ? text : `${text}\n[Output truncated]` });
	}
	return output.length > 0 ? output : [{ type: "text", text: fallback }];
}

type ToolUsage = NonNullable<AgentToolResult<unknown>["usage"]>;

function aggregateUsage(results: readonly AgentToolResult<unknown>[]): ToolUsage | undefined {
	const values = results.flatMap((result) => (result.usage ? [result.usage] : []));
	if (values.length === 0) return undefined;
	const optional = (key: "cacheWrite1h" | "reasoning"): number | undefined => {
		const present = values.filter((usage) => usage[key] !== undefined);
		return present.length > 0 ? present.reduce((total, usage) => total + (usage[key] ?? 0), 0) : undefined;
	};
	const cacheWrite1h = optional("cacheWrite1h");
	const reasoning = optional("reasoning");
	const usage: ToolUsage = {
		cacheRead: values.reduce((total, usage) => total + usage.cacheRead, 0),
		cacheWrite: values.reduce((total, usage) => total + usage.cacheWrite, 0),
		cost: {
			cacheRead: values.reduce((total, usage) => total + usage.cost.cacheRead, 0),
			cacheWrite: values.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
			input: values.reduce((total, usage) => total + usage.cost.input, 0),
			output: values.reduce((total, usage) => total + usage.cost.output, 0),
			total: values.reduce((total, usage) => total + usage.cost.total, 0),
		},
		input: values.reduce((total, usage) => total + usage.input, 0),
		output: values.reduce((total, usage) => total + usage.output, 0),
		totalTokens: values.reduce((total, usage) => total + usage.totalTokens, 0),
	};
	if (cacheWrite1h !== undefined) Object.assign(usage, { cacheWrite1h });
	if (reasoning !== undefined) Object.assign(usage, { reasoning });
	return usage;
}

function nestedResultControls(
	traces: ReadonlyMap<string, RuntimeToolTrace>,
): Pick<AgentToolResult<unknown>, "addedToolNames" | "terminate" | "usage"> {
	const results = [...traces.values()].flatMap((trace) => (trace.result ? [trace.result] : []));
	const addedToolNames = [...new Set(results.flatMap((result) => result.addedToolNames ?? []))];
	const usage = aggregateUsage(results);
	const controls: Pick<AgentToolResult<unknown>, "addedToolNames" | "terminate" | "usage"> = {};
	if (addedToolNames.length > 0) Object.assign(controls, { addedToolNames });
	if (results.some((result) => result.terminate === true)) Object.assign(controls, { terminate: true });
	if (usage) Object.assign(controls, { usage });
	return controls;
}

function settleController(
	controller: CodeModeExecutionController | undefined,
	status: PiStuffCodeModeDetails["status"],
	error?: string,
): ControllerSettlement {
	try {
		controller?.finish(status, error);
		return error ? { error, status } : { status };
	} catch (ledgerError) {
		const message = `${error ? `${error}; ` : ""}Code Mode ledger update failed: ${ledgerError instanceof Error ? ledgerError.message : String(ledgerError)}`;
		return { error: message, status: status === "cancelled" ? "cancelled" : "incomplete" };
	}
}

async function settleConnectorLifecycle(
	connector: SuiteCodeModeConnector,
	controller: CodeModeExecutionController | undefined,
	status: PiStuffCodeModeDetails["status"],
): Promise<void> {
	if (!controller) return;
	const passStatus = status === "success" ? "completed" : status === "paused" ? "paused" : "error";
	await connector.onPassEnd(controller.executionId, passStatus);
	if (status === "success") await connector.disposeExecution(controller.executionId, "completed");
	else if (status !== "paused" && status !== "incomplete") {
		await connector.disposeExecution(controller.executionId, "error");
	}
}

function stepTools(controller: CodeModeExecutionController): SuiteSandboxTool[] {
	return [
		{
			description: "Decide whether a durable Code Mode step should execute or replay",
			inputSchema: { properties: { name: { type: "string" } }, required: ["name"], type: "object" },
			invoke: async (input) =>
				requireCodemodeValue(
					controller.beginStep(
						isRuntimeObject(input) && input !== null && "name" in input ? String(input["name"]) : "",
					),
					"Code Mode step decision",
				),
			ledger: "bypass",
			name: INTERNAL_STEP_DECIDE_TOOL,
			presentation: "hidden",
			usage: `${INTERNAL_STEP_DECIDE_TOOL}({ name })`,
		},
		{
			description: "Record one durable Code Mode step result",
			inputSchema: {
				properties: { plan: { type: "object" }, value: {} },
				required: ["plan"],
				type: "object",
			},
			invoke: async (input) => {
				if (!isRuntimeObject(input) || input === null || !("plan" in input)) {
					throw new Error("Code Mode step record is missing its decision");
				}
				const plan = input["plan"];
				if (!isRuntimeToolCallPlan(plan)) throw new Error("Code Mode step record has an invalid decision");
				const value = "value" in input ? requireCodemodeValue(input["value"], "Code Mode step value") : undefined;
				controller.completeStep(plan, value);
				return true;
			},
			ledger: "bypass",
			name: INTERNAL_STEP_RECORD_TOOL,
			presentation: "hidden",
			usage: `${INTERNAL_STEP_RECORD_TOOL}({ plan, value })`,
		},
	];
}

export class CodeModeRuntime {
	readonly connector: SuiteCodeModeConnector;
	readonly executor: CodeModeExecutor;
	readonly ledger: CodeModeSessionLedger | undefined;

	constructor(connector: SuiteCodeModeConnector, executor: CodeModeExecutor, ledger?: CodeModeSessionLedger) {
		this.connector = connector;
		this.executor = executor;
		this.ledger = ledger;
	}

	async execute(
		outerToolCallId: string,
		code: string,
		context: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<PiStuffCodeModeDetails>,
	): Promise<AgentToolResult<PiStuffCodeModeDetails>> {
		let controller: CodeModeExecutionController | undefined;
		const snippets = this.ledger?.snippets(context) ?? [];
		const catalogTools = this.connector.runtimeTools(snippets);
		try {
			controller = this.ledger?.begin(
				context,
				outerToolCallId,
				code,
				new Map(catalogTools.map((tool) => [tool.name, tool.replay ?? "never"])),
				new Set(catalogTools.filter((tool) => tool.requiresApproval).map((tool) => tool.name)),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: message }],
				details: { error: message, kind: "pi-stuff-code-mode", operations: [], status: "error" },
			};
		}
		return this.run(outerToolCallId, code, context, snippets, catalogTools, controller, signal, onUpdate);
	}

	async approve(
		executionId: string,
		context: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<PiStuffCodeModeDetails>,
	): Promise<AgentToolResult<PiStuffCodeModeDetails>> {
		if (!this.ledger) {
			const message = "Code Mode durable approval is unavailable";
			return {
				content: [{ type: "text", text: message }],
				details: { error: message, executionId, kind: "pi-stuff-code-mode", operations: [], status: "error" },
			};
		}
		const snippets = this.ledger.snippets(context);
		const catalogTools = this.connector.runtimeTools(snippets);
		const controller = this.ledger.resume(
			context,
			executionId,
			new Map(catalogTools.map((tool) => [tool.name, tool.replay ?? "never"])),
			new Set(catalogTools.filter((tool) => tool.requiresApproval).map((tool) => tool.name)),
		);
		if (!controller) {
			const message = `Code Mode execution ${executionId} is not paused; refresh pending approvals`;
			return {
				content: [{ type: "text", text: message }],
				details: { error: message, executionId, kind: "pi-stuff-code-mode", operations: [], status: "error" },
			};
		}
		return this.run(
			controller.outerToolCallId,
			controller.code,
			context,
			snippets,
			catalogTools,
			controller,
			signal,
			onUpdate,
		);
	}

	pending(context: ExtensionContext, executionId?: string): readonly CodeModePendingAction[] {
		return this.ledger?.pending(context, executionId) ?? [];
	}

	async reject(executionId: string, sequence: number, context: ExtensionContext): Promise<boolean> {
		if (!this.ledger?.reject(context, executionId, sequence)) return false;
		await this.connector.disposeExecution(executionId, "rejected");
		return true;
	}

	private async run(
		outerToolCallId: string,
		code: string,
		context: ExtensionContext,
		snippets: readonly Snippet[],
		catalogTools: readonly SuiteSandboxTool[],
		controller: CodeModeExecutionController | undefined,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<PiStuffCodeModeDetails>,
	): Promise<AgentToolResult<PiStuffCodeModeDetails>> {
		const traces = new Map<string, RuntimeToolTrace>();
		const operationIndexes = new Map<string, number>();
		const operations: SuiteToolEnvelopeOperation[] = [];
		let droppedOperationCount = 0;
		let cellId: string | undefined;
		let attempt = controller?.attempt ?? 0;
		const tools = controller ? [...catalogTools, ...stepTools(controller)] : catalogTools;
		const details = (
			status: PiStuffCodeModeDetails["status"],
			error?: string,
			projectedOperations: readonly SuiteToolEnvelopeOperation[] = [...operations],
		): PiStuffCodeModeDetails => {
			const pending = controller && this.ledger ? this.ledger.pending(context, controller.executionId) : [];
			const value: PiStuffCodeModeDetails = {
				kind: "pi-stuff-code-mode",
				operations: projectedOperations,
				status,
			};
			if (attempt > 0) Object.assign(value, { attempt });
			if (cellId) Object.assign(value, { cellId });
			if (droppedOperationCount > 0) Object.assign(value, { droppedOperationCount });
			if (error) Object.assign(value, { error });
			if (controller) Object.assign(value, { executionId: controller.executionId });
			if (pending.length > 0) Object.assign(value, { pending });
			return value;
		};
		const publish = (): void => {
			onUpdate?.({ content: [], details: details("running") });
		};
		const executorContext: ExecutorContext = {
			cwd: context.cwd,
			extensionContext: context,
			onTraceUpdate: (update: { cellId: string; droppedTraceCount?: number; trace: RuntimeToolTrace }) => {
				cellId = update.cellId;
				droppedOperationCount = Math.max(droppedOperationCount, update.droppedTraceCount ?? 0);
				mergeTrace(traces, operationIndexes, operations, update.trace);
				publish();
			},
			toolCallId: outerToolCallId,
		};
		if (controller) {
			Object.assign(executorContext, {
				beginToolCall: controller.beginToolCall,
				completeToolCall: controller.completeToolCall,
			});
		}
		try {
			const runPass = async (): Promise<RuntimeResponse> => {
				const executeOptions: CodeModeExecuteOptions = {
					context: executorContext,
					source: buildSuiteSandboxSource(code, this.connector.catalog(), snippets),
					tools,
				};
				if (signal) Object.assign(executeOptions, { signal });
				let response = await this.executor.execute(executeOptions);
				cellId = response.cellId;
				droppedOperationCount = Math.max(droppedOperationCount, response.droppedTraceCount ?? 0);
				mergeTraces(traces, operationIndexes, operations, response.traces);
				publish();
				while (response.kind === "yielded") {
					const waitOptions: CodeModeWaitOptions & { readonly yieldTimeMs: number } = {
						context: executorContext,
						yieldTimeMs: AUTO_WAIT_MS,
					};
					if (signal) Object.assign(waitOptions, { signal });
					response = await this.executor.wait(response.cellId, waitOptions);
					cellId = response.cellId;
					droppedOperationCount = Math.max(droppedOperationCount, response.droppedTraceCount ?? 0);
					mergeTraces(traces, operationIndexes, operations, response.traces);
					publish();
				}
				return response;
			};
			let response: RuntimeResponse;
			for (;;) {
				controller?.beginPass(attempt);
				try {
					response = await runPass();
					break;
				} catch (error) {
					if (error instanceof CodeModeHostLostError && attempt < HOST_RECOVERY_LIMIT && !signal?.aborted) {
						if (controller) await this.connector.onPassEnd(controller.executionId, "error");
						attempt += 1;
						continue;
					}
					throw error;
				}
			}
			const error = response.kind === "result" ? response.errorText : undefined;
			let status: PiStuffCodeModeDetails["status"] = controller?.isPaused
				? "paused"
				: controller?.incompleteError
					? "incomplete"
					: response.kind === "terminated"
						? "cancelled"
						: error
							? "error"
							: "success";
			if (status !== "success" && status !== "paused") {
				settleRunningTraces(
					traces,
					status === "cancelled" ? "cancelled" : "error",
					status === "cancelled" ? NESTED_CANCELLATION_TEXT : (error ?? "Code Mode execution failed"),
				);
			}
			let finalError = status === "paused" ? undefined : (controller?.incompleteError?.message ?? error);
			const pending = controller && this.ledger ? this.ledger.pending(context, controller.executionId) : [];
			const finalContent =
				status === "paused" && controller
					? [{ type: "text" as const, text: approvalMessage(controller.executionId, pending) }]
					: boundedContent(
							response.contentItems,
							finalError ??
								(status === "cancelled"
									? "Code Mode execution was cancelled"
									: "Code completed with no output; use text(...) to return a value"),
						);
			const settled = settleController(controller, status, finalError);
			status = settled.status;
			finalError = settled.error;
			const media = projectFinalMedia(traces, finalContent);
			const finalDetails = details(status, finalError, media.operations);
			captureCodeModeModelContent(finalDetails, media.content);
			await settleConnectorLifecycle(this.connector, controller, status);
			return {
				content: media.content,
				details: finalDetails,
				...nestedResultControls(traces),
			};
		} catch (error) {
			let message = controller?.incompleteError?.message ?? (error instanceof Error ? error.message : String(error));
			let status: PiStuffCodeModeDetails["status"] = controller?.isPaused
				? "paused"
				: controller?.incompleteError
					? "incomplete"
					: wasCancelled(error, signal)
						? "cancelled"
						: "error";
			if (status !== "paused") {
				settleRunningTraces(
					traces,
					status === "cancelled" ? "cancelled" : "error",
					status === "cancelled" ? NESTED_CANCELLATION_TEXT : message,
				);
			}
			const settled = settleController(controller, status, message);
			status = settled.status;
			message = settled.error ?? message;
			const pending = controller && this.ledger ? this.ledger.pending(context, controller.executionId) : [];
			const media = projectFinalMedia(traces, [
				{
					type: "text",
					text: status === "paused" && controller ? approvalMessage(controller.executionId, pending) : message,
				},
			]);
			const finalDetails = details(status, message, media.operations);
			captureCodeModeModelContent(finalDetails, media.content);
			await settleConnectorLifecycle(this.connector, controller, status);
			return {
				content: media.content,
				details: finalDetails,
				...nestedResultControls(traces),
			};
		}
	}

	shutdown(): Promise<void> {
		return this.executor.shutdown();
	}
}
