import { validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Guard } from "typebox/guard";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { isRuntimeBoolean, isRuntimeFunction, isRuntimeString } from "../shared/runtime-type.js";
import type { ToolActivityMetadata, ToolArguments } from "./activity.js";
import type {
	SuiteToolCatalogEntry,
	SuiteToolCodeModeContract,
	SuiteToolDefinitionRegistry,
	SuiteToolEnvelopeDecoder,
	SuiteToolEnvelopeDetails,
	SuiteToolEnvelopeFallbackVisibility,
	SuiteToolEnvelopeMediaResolver,
	SuiteToolInvocation,
	SuiteToolInvocationResult,
	SuiteToolRegistrationTracker,
	SuiteToolReplayDefinition,
	SuiteToolSurfaceController,
	SuiteToolTrackerHost,
	ToolUiRuntime,
} from "./contract.js";
import { isRecordValue, isToolArguments } from "./tool-value.js";

export const SUITE_ACTIVITY_RENDERER = Symbol.for("@jczhang02/pi-stuff-tools/activity-renderer.v1");
export const SUITE_TOOL_ENVELOPE = Symbol.for("@jczhang02/pi-stuff-tools/tool-envelope.v1");
export const SUITE_TOOL_ENVELOPE_COMPANION = Symbol.for("@jczhang02/pi-stuff-tools/tool-envelope-companion.v1");
export const SUITE_TOOL_CODE_MODE = Symbol.for("@jczhang02/pi-stuff-tools/code-mode.v1");
export const SUITE_TOOL_REPLAY = Symbol.for("@jczhang02/pi-stuff-tools/replay-definition.v1");

export interface SuiteActivityRendererMarker {
	readonly activity: ToolActivityMetadata<ToolArguments, unknown>;
	readonly resultIsError?: (args: ToolArguments, result: AgentToolResult<unknown>) => boolean;
}

export interface SuiteToolEnvelopeMarker {
	readonly decode: SuiteToolEnvelopeDecoder;
	readonly media?: SuiteToolEnvelopeMediaResolver;
	readonly registry: SuiteToolDefinitionRegistry;
	readonly showFallback?: SuiteToolEnvelopeFallbackVisibility;
}

export interface SuiteToolEnvelopeCompanionMarker {
	readonly owner: string;
}

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
	details?: SuiteToolEnvelopeDetails;
	readonly input?: unknown;
	isError?: boolean;
	readonly partialResult?: AgentToolResult<unknown>;
	readonly result?: AgentToolResult<unknown>;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly type: string;
	usage?: AgentToolResult<unknown>["usage"];
}

type CapturedToolHandler = (
	event: CapturedToolEvent,
	context: ExtensionContext,
) => CapturedToolHandlerResult | undefined | Promise<CapturedToolHandlerResult | undefined>;

type PrepareEnvelopeArguments = (tool: ToolDefinition, args: ToolArguments) => ToolArguments;

const CAPTURED_TOOL_EVENTS = new Set([
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);

const TOOL_CONTROL_OPEN = "<system-reminder>";
const TOOL_CONTROL_CLOSE = "</system-reminder>";

function suiteActivityRendererMarker<Tool>(tool: Tool): SuiteActivityRendererMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	if (!isRuntimeFunction(tool["renderCall"]) || !isRuntimeFunction(tool["renderResult"])) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_ACTIVITY_RENDERER)?.value;
	return isSuiteActivityRendererMarker(marker) ? marker : undefined;
}

function hasSuiteActivityRenderer<Tool>(tool: Tool): boolean {
	return suiteActivityRendererMarker(tool) !== undefined;
}

function isSuiteActivityRendererMarker<Value>(value: Value): value is Value & SuiteActivityRendererMarker {
	if (!isRecordValue(value) || !isRecordValue(value["activity"])) return false;
	const activity = value["activity"];
	return (
		Array.isArray(activity["categories"]) &&
		isRuntimeFunction(activity["classify"]) &&
		(activity["silentSuccess"] === undefined || isRuntimeBoolean(activity["silentSuccess"])) &&
		(activity["summarizeIssue"] === undefined || isRuntimeFunction(activity["summarizeIssue"])) &&
		(value["resultIsError"] === undefined || isRuntimeFunction(value["resultIsError"]))
	);
}

function isSuiteToolCodeModeContract<Value>(value: Value): value is Value & SuiteToolCodeModeContract {
	if (!isRecordValue(value)) return false;
	if (value["replay"] !== "never" && value["replay"] !== "record" && value["replay"] !== "reexecute") {
		return false;
	}
	if (value["compensate"] !== undefined && !isRuntimeFunction(value["compensate"])) return false;
	if (value["requiresApproval"] !== undefined && !isRuntimeBoolean(value["requiresApproval"])) return false;
	if (value["lifecycle"] !== undefined) {
		if (!isRecordValue(value["lifecycle"])) return false;
		if (
			value["lifecycle"]["disposeExecution"] !== undefined &&
			!isRuntimeFunction(value["lifecycle"]["disposeExecution"])
		) {
			return false;
		}
		if (value["lifecycle"]["onPassEnd"] !== undefined && !isRuntimeFunction(value["lifecycle"]["onPassEnd"])) {
			return false;
		}
	}
	return true;
}

function suiteToolCodeModeContract<Tool>(tool: Tool): SuiteToolCodeModeContract | undefined {
	if (!isRecordValue(tool)) return undefined;
	const value = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_CODE_MODE)?.value;
	return isSuiteToolCodeModeContract(value) ? value : undefined;
}

function suiteToolEnvelopeMarker<Tool>(tool: Tool): SuiteToolEnvelopeMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_ENVELOPE)?.value;
	return isSuiteToolEnvelopeMarker(marker) ? marker : undefined;
}

function isSuiteToolEnvelopeMarker<Value>(value: Value): value is Value & SuiteToolEnvelopeMarker {
	if (!isRecordValue(value) || !isRuntimeFunction(value["decode"]) || !isRecordValue(value["registry"])) {
		return false;
	}
	const registry = value["registry"];
	return (
		(value["showFallback"] === undefined || isRuntimeFunction(value["showFallback"])) &&
		(value["media"] === undefined || isRuntimeFunction(value["media"])) &&
		isRuntimeFunction(registry["catalog"]) &&
		isRuntimeFunction(registry["compensate"]) &&
		isRuntimeFunction(registry["get"]) &&
		isRuntimeFunction(registry["invoke"]) &&
		isRuntimeFunction(registry["isActive"]) &&
		isRuntimeFunction(registry["list"])
	);
}

function suiteToolEnvelopeCompanionMarker<Tool>(tool: Tool): SuiteToolEnvelopeCompanionMarker | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_ENVELOPE_COMPANION)?.value;
	return isSuiteToolEnvelopeCompanionMarker(marker) ? marker : undefined;
}

function isSuiteToolEnvelopeCompanionMarker<Value>(value: Value): value is Value & SuiteToolEnvelopeCompanionMarker {
	return isRecordValue(value) && isRuntimeString(value["owner"]);
}

function suiteToolReplayDefinition<Tool>(tool: Tool): SuiteToolReplayDefinition | undefined {
	if (!isRecordValue(tool)) return undefined;
	const marker = Object.getOwnPropertyDescriptor(tool, SUITE_TOOL_REPLAY)?.value;
	return isSuiteToolReplayDefinition(marker) ? marker : undefined;
}

function isSuiteToolReplayDefinition<Value>(value: Value): value is Value & SuiteToolReplayDefinition {
	if (!isRecordValue(value) || !isRecordValue(value["tool"]) || !isRecordValue(value["presentation"])) {
		return false;
	}
	const presentation = value["presentation"];
	const tool = value["tool"];
	return (
		(value["codeMode"] === undefined || isSuiteToolCodeModeContract(value["codeMode"])) &&
		isSuiteActivityRendererMarker({
			activity: presentation["activity"],
			resultIsError: presentation["resultIsError"],
		}) &&
		isRuntimeString(tool["name"]) &&
		isRecordValue(tool["parameters"]) &&
		isRuntimeFunction(tool["execute"])
	);
}

function uniqueToolNames(names: readonly string[]): string[] {
	return [...new Set(names)];
}

function errorToolResult(cause: unknown): AgentToolResult<unknown> {
	return {
		content: [
			{
				type: "text",
				text: cause instanceof Error ? cause.message : String(cause),
			},
		],
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

function isCapturedToolHandler<Value>(value: Value): value is Value & CapturedToolHandler {
	return isRuntimeFunction(value);
}

/** Observe every Tool registered by Suite modules without changing the Host API. */
export function createSuiteToolRegistrationTrackerWithRuntime<Host extends SuiteToolTrackerHost>(
	pi: Host,
	runtime: ToolUiRuntime,
	prepareEnvelopeRenderArguments: PrepareEnvelopeArguments,
): SuiteToolRegistrationTracker<Host> {
	const capturedHandlers = new Map<string, CapturedToolHandler[]>();
	const envelopeCompanions = new Map<string, Set<string>>();
	const envelopeTools = new Set<string>();
	const toolNames = new Set<string>();
	const tools = new Map<string, ToolDefinition>();
	let enabledEnvelope: string | undefined;
	let virtualActiveTools: string[] | undefined;

	const projectActiveTools = (names: readonly string[], envelope: string): string[] => {
		const projected: string[] = [];
		let inserted = false;
		const insertEnvelope = (): void => {
			if (inserted) return;
			projected.push(envelope, ...(envelopeCompanions.get(envelope) ?? []));
			inserted = true;
		};
		for (const name of uniqueToolNames(names)) {
			if (envelopeTools.has(name)) continue;
			if (tools.has(name)) {
				insertEnvelope();
				continue;
			}
			projected.push(name);
		}
		insertEnvelope();
		return projected;
	};
	const applyActiveProjection = (): void => {
		if (!enabledEnvelope || !virtualActiveTools) return;
		pi.setActiveTools(projectActiveTools(virtualActiveTools, enabledEnvelope));
	};
	const getActiveTools: ExtensionAPI["getActiveTools"] = () =>
		enabledEnvelope && virtualActiveTools ? [...virtualActiveTools] : pi.getActiveTools();
	const setActiveTools: ExtensionAPI["setActiveTools"] = (names) => {
		if (!enabledEnvelope) {
			pi.setActiveTools(names);
			return;
		}
		virtualActiveTools = uniqueToolNames(names.filter((name) => !envelopeTools.has(name)));
		applyActiveProjection();
	};
	const on = new Proxy(pi.on, {
		apply(target, _thisArgument, argumentsList) {
			const [event, handler] = argumentsList;
			if (isRuntimeString(event) && CAPTURED_TOOL_EVENTS.has(event) && isCapturedToolHandler(handler)) {
				const handlers = capturedHandlers.get(event) ?? [];
				handlers.push(handler);
				capturedHandlers.set(event, handlers);
			}
			return Function.prototype.apply.call(target, pi, argumentsList);
		},
	});

	const dispatchInformational = async (
		event: "tool_execution_end" | "tool_execution_start" | "tool_execution_update",
		value: CapturedToolEvent,
		context: ExtensionContext,
	): Promise<void> => {
		for (const handler of capturedHandlers.get(event) ?? []) {
			try {
				await handler.call(undefined, value, context);
			} catch {
				// Pi reports lifecycle handler failures without changing Tool execution.
			}
		}
	};
	const invoke = async (invocation: SuiteToolInvocation): Promise<SuiteToolInvocationResult> => {
		const tool = tools.get(invocation.name);
		if (!tool) throw new Error(`Unknown Suite Tool: ${invocation.name}`);
		if (!registry.isActive(invocation.name)) throw new Error(`Suite Tool is inactive: ${invocation.name}`);
		await dispatchInformational(
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
			prepared = validated;
		} catch (error) {
			const result = errorToolResult(error);
			await dispatchInformational(
				"tool_execution_end",
				{
					isError: true,
					result,
					toolCallId: invocation.toolCallId,
					toolName: invocation.name,
					type: "tool_execution_end",
				},
				invocation.context,
			);
			return { isError: true, result };
		}

		const callEvent: CapturedToolEvent = {
			input: prepared,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_call",
		};
		try {
			for (const handler of capturedHandlers.get("tool_call") ?? []) {
				const decision = await handler.call(undefined, callEvent, invocation.context);
				if (!isRecordValue(decision) || decision["block"] !== true) continue;
				const result = errorToolResult(
					isRuntimeString(decision["reason"]) ? decision["reason"] : "Tool execution was blocked",
				);
				if (decision["terminate"] === true) Reflect.set(result, "terminate", true);
				await dispatchInformational(
					"tool_execution_end",
					{
						isError: true,
						result,
						toolCallId: invocation.toolCallId,
						toolName: invocation.name,
						type: "tool_execution_end",
					},
					invocation.context,
				);
				return { isError: true, result };
			}
		} catch (error) {
			const result = errorToolResult(error);
			await dispatchInformational(
				"tool_execution_end",
				{
					isError: true,
					result,
					toolCallId: invocation.toolCallId,
					toolName: invocation.name,
					type: "tool_execution_end",
				},
				invocation.context,
			);
			return { isError: true, result };
		}
		if (invocation.signal?.aborted) {
			const result = errorToolResult("Operation aborted");
			await dispatchInformational(
				"tool_execution_end",
				{
					isError: true,
					result,
					toolCallId: invocation.toolCallId,
					toolName: invocation.name,
					type: "tool_execution_end",
				},
				invocation.context,
			);
			return { isError: true, result };
		}

		let pendingUpdate: AgentToolResult<unknown> | undefined;
		let updateDrain: Promise<void> | undefined;
		let acceptingUpdates = true;
		let result: AgentToolResult<unknown>;
		let isError = false;
		const activeBefore = getActiveTools();
		const drainUpdates = async (): Promise<void> => {
			try {
				while (pendingUpdate) {
					const partialResult = pendingUpdate;
					pendingUpdate = undefined;
					await dispatchInformational(
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
			acceptingUpdates = false;
			const activeAfter = getActiveTools();
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
			acceptingUpdates = false;
			result = errorToolResult(error);
			isError = true;
		} finally {
			acceptingUpdates = false;
		}
		await updateDrain;

		const resultEvent: CapturedToolEvent = {
			content: result.content ?? [],
			details: result.details,
			input: prepared,
			isError,
			toolCallId: invocation.toolCallId,
			toolName: invocation.name,
			type: "tool_result",
		};
		if (result.usage) resultEvent.usage = result.usage;
		for (const handler of capturedHandlers.get("tool_result") ?? []) {
			try {
				const replacement = await handler.call(undefined, resultEvent, invocation.context);
				if (!isRecordValue(replacement)) continue;
				for (const key of ["content", "details", "isError", "usage"] as const) {
					if (replacement[key] !== undefined) {
						Object.defineProperty(resultEvent, key, {
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
		const finalResult = {
			...result,
			content: resultEvent.content ?? [],
			details: resultEvent.details,
		};
		if (resultEvent.usage !== undefined) Object.assign(finalResult, { usage: resultEvent.usage });
		result = stripToolControlMetadata(finalResult);
		isError = resultEvent.isError === true;
		await dispatchInformational(
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
	};
	const registry: SuiteToolDefinitionRegistry = {
		catalog: () =>
			[...tools.values()].map((definition) => {
				const codeMode = suiteToolCodeModeContract(definition);
				const entry: SuiteToolCatalogEntry = { definition };
				if (codeMode) Object.assign(entry, { codeMode });
				return entry;
			}),
		async compensate(invocation) {
			const contract = suiteToolCodeModeContract(tools.get(invocation.name));
			if (!contract?.compensate) return false;
			await contract.compensate(invocation);
			return true;
		},
		get: (name) => tools.get(name),
		invoke,
		isActive: (name) =>
			tools.has(name) &&
			(enabledEnvelope && virtualActiveTools
				? virtualActiveTools.includes(name)
				: pi.getActiveTools().includes(name)),
		list: () => [...tools.values()],
	};
	const surface: SuiteToolSurfaceController = {
		disableEnvelope(name) {
			if (enabledEnvelope === name && virtualActiveTools) {
				const restore = virtualActiveTools;
				enabledEnvelope = undefined;
				virtualActiveTools = undefined;
				pi.setActiveTools(restore);
				return;
			}
			if (!enabledEnvelope && envelopeTools.has(name)) {
				const hidden = new Set([name, ...(envelopeCompanions.get(name) ?? [])]);
				pi.setActiveTools(pi.getActiveTools().filter((toolName) => !hidden.has(toolName)));
			}
		},
		enableEnvelope(name) {
			if (!envelopeTools.has(name)) throw new Error(`Unknown Suite Tool envelope: ${name}`);
			if (enabledEnvelope && enabledEnvelope !== name) {
				throw new Error(`Suite Tool envelope ${enabledEnvelope} is already enabled`);
			}
			if (!enabledEnvelope) {
				virtualActiveTools = uniqueToolNames(
					pi.getActiveTools().filter((toolName) => !envelopeTools.has(toolName)),
				);
				enabledEnvelope = name;
			}
			applyActiveProjection();
		},
		isEnvelopeEnabled: (name) => enabledEnvelope === name,
	};
	const registerTool: ExtensionAPI["registerTool"] = (tool) => {
		const envelope = suiteToolEnvelopeMarker(tool);
		const companion = suiteToolEnvelopeCompanionMarker(tool);
		const replay = suiteToolReplayDefinition(tool);
		pi.registerTool(tool);
		if (replay) runtime.registerReplayToolDefinition(replay);
		if (envelope) {
			envelopeTools.add(tool.name);
			runtime.registerEnvelope(
				tool.name,
				envelope.decode,
				(operation) => {
					const nested = envelope.registry.get(operation.name);
					return nested ? prepareEnvelopeRenderArguments(nested, operation.args) : operation.args;
				},
				envelope.showFallback,
			);
			applyActiveProjection();
			return;
		}
		if (companion) {
			envelopeTools.add(tool.name);
			const names = envelopeCompanions.get(companion.owner) ?? new Set<string>();
			names.add(tool.name);
			envelopeCompanions.set(companion.owner, names);
			applyActiveProjection();
			return;
		}
		toolNames.add(tool.name);
		// SAFETY: this registry preserves each Tool definition intact and erases generics only for name-based lookup.
		tools.set(tool.name, tool as ToolDefinition);
		if (enabledEnvelope && virtualActiveTools && pi.getActiveTools().includes(tool.name)) {
			virtualActiveTools = uniqueToolNames([...virtualActiveTools, tool.name]);
			applyActiveProjection();
		}
		if (hasSuiteActivityRenderer(tool)) runtime.markRendererAttached(tool.name);
		else runtime.markRendererDetached(tool.name);
	};
	const api = new Proxy(pi, {
		get(target, property) {
			if (property === "getActiveTools") return getActiveTools;
			if (property === "on") return on;
			if (property === "registerTool") return registerTool;
			if (property === "setActiveTools") return setActiveTools;
			const value = readHostProxyProperty(target, property);
			return Guard.IsFunction(value) ? value.bind(target) : value;
		},
	});
	return { api, registry, surface, toolNames };
}
