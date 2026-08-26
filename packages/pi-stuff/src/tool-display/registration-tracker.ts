import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Guard } from "typebox/guard";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { isRuntimeBoolean, isRuntimeFunction, isRuntimeString } from "../shared/runtime-type.js";
import type { ToolActivityMetadata, ToolArguments } from "./activity.js";
import type {
	SuiteToolCatalogEntry,
	SuiteToolCodeModeContract,
	SuiteToolDefinitionRegistry,
	SuiteToolEnvelopeDecoder,
	SuiteToolEnvelopeFallbackVisibility,
	SuiteToolEnvelopeMediaResolver,
	SuiteToolRegistrationTracker,
	SuiteToolReplayDefinition,
	SuiteToolSurfaceController,
	SuiteToolTrackerHost,
	ToolUiRuntime,
} from "./contract.js";
import { type CapturedToolHandler, SuiteToolInvocationRuntime } from "./tool-invocation.js";
import { isRecordValue } from "./tool-value.js";

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

type PrepareEnvelopeArguments = (tool: ToolDefinition, args: ToolArguments) => ToolArguments;

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

/** Observe every Tool registered by Suite modules without changing the Host API. */
export function createSuiteToolRegistrationTrackerWithRuntime<Host extends SuiteToolTrackerHost>(
	pi: Host,
	runtime: ToolUiRuntime,
	prepareEnvelopeRenderArguments: PrepareEnvelopeArguments,
): SuiteToolRegistrationTracker<Host> {
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
	const isActive = (name: string): boolean =>
		tools.has(name) &&
		(enabledEnvelope && virtualActiveTools ? virtualActiveTools.includes(name) : pi.getActiveTools().includes(name));
	const invocations = new SuiteToolInvocationRuntime(tools, isActive, getActiveTools);
	const on = new Proxy(pi.on, {
		apply(target, _thisArgument, argumentsList) {
			const [event, handler] = argumentsList;
			if (isRuntimeString(event) && isRuntimeFunction(handler)) {
				// SAFETY: the Host event boundary supplies Tool lifecycle handlers; capture further restricts the event name.
				invocations.capture(event, handler as CapturedToolHandler);
			}
			return Function.prototype.apply.call(target, pi, argumentsList);
		},
	});

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
		invoke: (invocation) => invocations.invoke(invocation),
		isActive,
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
