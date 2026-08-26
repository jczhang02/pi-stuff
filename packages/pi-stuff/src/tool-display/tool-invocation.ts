import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isRuntimeString } from "../shared/runtime-type.js";
import type { ToolArguments } from "./activity.js";
import type { SuiteToolInvocation, SuiteToolInvocationResult } from "./contract.js";
import { isRecordValue, isToolArguments } from "./tool-value.js";

interface CapturedToolHandlerResult {
	readonly block?: boolean;
	readonly content?: AgentToolResult<unknown>["content"];
	readonly details?: unknown;
	readonly isError?: boolean;
	readonly reason?: string;
	readonly terminate?: boolean;
	readonly usage?: AgentToolResult<unknown>["usage"];
}

interface CapturedToolEvent {
	readonly args?: unknown;
	content?: AgentToolResult<unknown>["content"];
	details?: unknown;
	readonly input?: unknown;
	isError?: boolean;
	readonly partialResult?: AgentToolResult<unknown>;
	readonly result?: AgentToolResult<unknown>;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly type: string;
	usage?: AgentToolResult<unknown>["usage"];
}

export type CapturedToolHandler = (
	event: CapturedToolEvent,
	context: ExtensionContext,
) => CapturedToolHandlerResult | undefined | Promise<CapturedToolHandlerResult | undefined>;

const CAPTURED_TOOL_EVENTS = new Set([
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);
const TOOL_CONTROL_OPEN = "<system-reminder>";
const TOOL_CONTROL_CLOSE = "</system-reminder>";

function errorToolResult(cause: unknown): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }],
		details: {},
	};
}

function stripToolControlText(text: string): string {
	if (!text.includes(TOOL_CONTROL_OPEN)) return text;
	let depth = 0;
	let index = 0;
	let stripped = "";
	let removed = false;
	while (index < text.length) {
		if (text.startsWith(TOOL_CONTROL_OPEN, index)) {
			depth += 1;
			removed = true;
			index += TOOL_CONTROL_OPEN.length;
			continue;
		}
		if (text.startsWith(TOOL_CONTROL_CLOSE, index) && depth > 0) {
			depth -= 1;
			index += TOOL_CONTROL_CLOSE.length;
			continue;
		}
		if (depth === 0) stripped += text[index] ?? "";
		index += 1;
	}
	if (!removed || depth !== 0) return text;
	return stripped.trimEnd();
}

export function stripToolControlMetadata<TDetails>(result: AgentToolResult<TDetails>): AgentToolResult<TDetails> {
	let changed = false;
	const content: AgentToolResult<TDetails>["content"] = [];
	for (const item of result.content) {
		if (item.type !== "text") {
			content.push(item);
			continue;
		}
		const text = stripToolControlText(item.text);
		if (text === item.text) {
			content.push(item);
			continue;
		}
		changed = true;
		if (text) content.push({ ...item, text });
	}
	return changed ? { ...result, content } : result;
}

interface ToolExecutionOutcome {
	readonly isError: boolean;
	readonly result: AgentToolResult<unknown>;
}

/** Own the complete nested Tool lifecycle used by Code Mode envelopes. */
export class SuiteToolInvocationRuntime {
	private readonly capturedHandlers = new Map<string, CapturedToolHandler[]>();
	private readonly getActiveTools: () => readonly string[];
	private readonly isActive: (name: string) => boolean;
	private readonly tools: ReadonlyMap<string, ToolDefinition>;

	constructor(
		tools: ReadonlyMap<string, ToolDefinition>,
		isActive: (name: string) => boolean,
		getActiveTools: () => readonly string[],
	) {
		this.tools = tools;
		this.isActive = isActive;
		this.getActiveTools = getActiveTools;
	}

	capture(event: string, handler: CapturedToolHandler): void {
		if (!CAPTURED_TOOL_EVENTS.has(event)) return;
		const handlers = this.capturedHandlers.get(event) ?? [];
		handlers.push(handler);
		this.capturedHandlers.set(event, handlers);
	}

	async invoke(invocation: SuiteToolInvocation): Promise<SuiteToolInvocationResult> {
		const tool = this.tools.get(invocation.name);
		if (!tool) throw new Error(`Unknown Suite Tool: ${invocation.name}`);
		if (!this.isActive(invocation.name)) throw new Error(`Suite Tool is inactive: ${invocation.name}`);
		await this.dispatchInformational(
			"tool_execution_start",
			{
				args: invocation.input,
				toolCallId: invocation.toolCallId,
				toolName: invocation.name,
				type: "tool_execution_start",
			},
			invocation.context,
		);

		let prepared: ToolArguments;
		try {
			prepared = this.prepare(tool, invocation);
		} catch (error) {
			return this.fail(invocation, error);
		}
		const blocked = await this.beforeExecution(invocation, prepared);
		if (blocked) return blocked;

		const executed = await this.execute(tool, invocation, prepared);
		const projected = await this.projectResult(invocation, prepared, executed);
		return this.finish(invocation, projected.result, projected.isError);
	}

	private prepare(tool: ToolDefinition, invocation: SuiteToolInvocation): ToolArguments {
		const rawArguments = tool.prepareArguments ? tool.prepareArguments(invocation.input) : invocation.input;
		// SAFETY: the registry erases each Tool's schema, while validation immediately below restores its runtime contract.
		const validated = validateToolArguments(
			tool as never,
			// SAFETY: the call record matches Pi's ToolCall shape and is consumed only by the selected Tool's schema validator.
			{
				arguments: rawArguments,
				id: invocation.toolCallId,
				name: invocation.name,
				type: "toolCall",
			} as never,
		);
		if (!isToolArguments(validated)) throw new Error(`Suite Tool ${invocation.name} requires object arguments`);
		return validated;
	}

	private async beforeExecution(
		invocation: SuiteToolInvocation,
		prepared: ToolArguments,
	): Promise<SuiteToolInvocationResult | undefined> {
		const event: CapturedToolEvent = {
			input: prepared,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_call",
		};
		try {
			for (const handler of this.capturedHandlers.get("tool_call") ?? []) {
				const decision = await handler.call(undefined, event, invocation.context);
				if (!isRecordValue(decision) || decision["block"] !== true) continue;
				return this.fail(
					invocation,
					isRuntimeString(decision["reason"]) ? decision["reason"] : "Tool execution was blocked",
					decision["terminate"] === true,
				);
			}
		} catch (error) {
			return this.fail(invocation, error);
		}
		return invocation.signal?.aborted ? this.fail(invocation, "Operation aborted") : undefined;
	}

	private async execute(
		tool: ToolDefinition,
		invocation: SuiteToolInvocation,
		prepared: ToolArguments,
	): Promise<ToolExecutionOutcome> {
		let pendingUpdate: AgentToolResult<unknown> | undefined;
		let updateDrain: Promise<void> | undefined;
		let acceptingUpdates = true;
		const activeBefore = this.getActiveTools();
		const drainUpdates = async (): Promise<void> => {
			try {
				while (pendingUpdate) {
					const partialResult = pendingUpdate;
					pendingUpdate = undefined;
					await this.dispatchInformational(
						"tool_execution_update",
						{
							args: prepared,
							partialResult,
							toolCallId: invocation.toolCallId,
							toolName: invocation.name,
							type: "tool_execution_update",
						},
						invocation.context,
					);
				}
			} finally {
				updateDrain = undefined;
			}
		};

		let result: AgentToolResult<unknown>;
		let isError = false;
		try {
			// SAFETY: validation above produced the argument type owned by this registry-selected Tool definition.
			result = await tool.execute(
				invocation.toolCallId,
				prepared as never,
				invocation.signal,
				(partialResult) => {
					if (!acceptingUpdates) return;
					try {
						invocation.onUpdate?.(partialResult);
					} catch {
						// Rendering updates do not change nested Tool execution.
					}
					pendingUpdate = partialResult;
					updateDrain ??= drainUpdates();
				},
				invocation.context,
			);
			const activeAfter = this.getActiveTools();
			if (activeBefore.every((name) => activeAfter.includes(name))) {
				const beforeNames = new Set(activeBefore);
				const addedToolNames = activeAfter.filter((name) => !beforeNames.has(name));
				if (addedToolNames.length > 0) {
					result = {
						...result,
						addedToolNames: [...new Set([...(result.addedToolNames ?? []), ...addedToolNames])],
					};
				}
			}
		} catch (error) {
			result = errorToolResult(error);
			isError = true;
		} finally {
			acceptingUpdates = false;
		}
		await updateDrain;
		return { isError, result };
	}

	private async projectResult(
		invocation: SuiteToolInvocation,
		prepared: ToolArguments,
		executed: ToolExecutionOutcome,
	): Promise<ToolExecutionOutcome> {
		const event: CapturedToolEvent = {
			content: executed.result.content ?? [],
			details: executed.result.details,
			input: prepared,
			isError: executed.isError || ("isError" in executed.result && executed.result.isError === true),
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_result",
		};
		if (executed.result.usage) event.usage = executed.result.usage;
		for (const handler of this.capturedHandlers.get("tool_result") ?? []) {
			try {
				const replacement = await handler.call(undefined, event, invocation.context);
				if (!isRecordValue(replacement)) continue;
				for (const key of ["content", "details", "isError", "usage"] as const) {
					if (replacement[key] !== undefined) {
						Object.defineProperty(event, key, {
							configurable: true,
							enumerable: true,
							value: replacement[key],
							writable: true,
						});
					}
				}
			} catch {
				// Pi reports result-handler failures and keeps the previous result.
			}
		}
		const result: AgentToolResult<unknown> = {
			...executed.result,
			content: event.content ?? [],
			details: event.details,
		};
		if (event.usage !== undefined) Object.assign(result, { usage: event.usage });
		if (event.isError === true) Object.assign(result, { isError: true });
		else Reflect.deleteProperty(result, "isError");
		return { isError: event.isError === true, result: stripToolControlMetadata(result) };
	}

	private async fail(
		invocation: SuiteToolInvocation,
		cause: unknown,
		terminate = false,
	): Promise<SuiteToolInvocationResult> {
		const result = errorToolResult(cause);
		if (terminate) Reflect.set(result, "terminate", true);
		return this.finish(invocation, result, true);
	}

	private async finish(
		invocation: SuiteToolInvocation,
		result: AgentToolResult<unknown>,
		isError: boolean,
	): Promise<SuiteToolInvocationResult> {
		await this.dispatchInformational(
			"tool_execution_end",
			{
				isError,
				result,
				toolCallId: invocation.toolCallId,
				toolName: invocation.name,
				type: "tool_execution_end",
			},
			invocation.context,
		);
		return { isError, result };
	}

	private async dispatchInformational(
		event: "tool_execution_end" | "tool_execution_start" | "tool_execution_update",
		value: CapturedToolEvent,
		context: ExtensionContext,
	): Promise<void> {
		for (const handler of this.capturedHandlers.get(event) ?? []) {
			try {
				await handler.call(undefined, value, context);
			} catch {
				// Pi reports lifecycle handler failures without changing Tool execution.
			}
		}
	}
}
