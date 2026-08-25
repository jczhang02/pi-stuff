import type {
	AgentEndEvent,
	AgentToolResult,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionBeforeCompactEvent,
	SessionBeforeSwitchEvent,
	SessionCompactEvent,
	SessionEntry,
	SessionManager,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolDefinition,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolInfo,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import type { JsonInputValue, JsonObject } from "../shared/json-value.js";

export const MAGIC_WORKER_PROTOCOL_VERSION = 3;
export const MAGIC_WORKER_SYNC_BUFFER_BYTES = 64 * 1024;

export interface MagicWorkerModel {
	readonly api?: string;
	readonly contextWindow: number;
	readonly id: string;
	readonly maxTokens: number;
	readonly provider: string;
}

export interface MagicWorkerSessionSnapshot {
	readonly file: string | undefined;
	readonly id: string | undefined;
	readonly leafId: string | undefined;
}

export type MagicWorkerEvent =
	| Pick<AgentEndEvent, "messages" | "type">
	| Pick<BeforeAgentStartEvent, "systemPrompt" | "type">
	| Pick<ContextEvent, "messages" | "type">
	| Pick<MessageEndEvent, "message" | "type">
	| Pick<SessionBeforeCompactEvent, "type">
	| Pick<SessionBeforeSwitchEvent, "type">
	| Pick<SessionCompactEvent, "type">
	| Pick<SessionShutdownEvent, "type">
	| Pick<SessionStartEvent, "previousSessionFile" | "reason" | "type">
	| Pick<ToolExecutionEndEvent, "toolName" | "type">
	| Pick<ToolExecutionStartEvent, "args" | "toolCallId" | "toolName" | "type">
	| Pick<ToolResultEvent, "content" | "toolName" | "type">;

export type MagicWorkerEventName = MagicWorkerEvent["type"];

export interface MagicWorkerContextSnapshot {
	readonly contextUsage: ContextUsage | undefined;
	readonly cwd: string;
	readonly hasUI: boolean;
	readonly idle: boolean;
	readonly mode: "json" | "print" | "rpc" | "tui";
	readonly model: MagicWorkerModel | undefined;
	readonly pendingMessages: boolean;
	readonly projectTrusted: boolean;
	readonly session: MagicWorkerSessionSnapshot;
	readonly systemPrompt: string;
	readonly thinkingLevel: ExtensionContext["thinkingLevel"];
}

export interface MagicWorkerToolDescriptor {
	readonly constrainedSampling: ToolDefinition["constrainedSampling"] | undefined;
	readonly description: string;
	readonly executionMode: ToolDefinition["executionMode"] | undefined;
	readonly label: string;
	readonly name: string;
	readonly parameters: JsonObject;
	readonly promptGuidelines: readonly string[] | undefined;
	readonly promptSnippet: string | undefined;
	readonly renderShell: ToolDefinition["renderShell"] | undefined;
}

export interface MagicWorkerCommandDescriptor {
	readonly description: string | undefined;
	readonly name: string;
}

export interface MagicWorkerHostTool {
	readonly description: string;
	readonly name: string;
	readonly parameters: JsonObject;
	readonly promptGuidelines: string[] | undefined;
	readonly sourceInfo: ToolInfo["sourceInfo"];
}

export interface MagicWorkerInitializeRequest {
	readonly activeTools: readonly string[];
	readonly hostTools: readonly MagicWorkerHostTool[];
	readonly id: number;
	readonly protocolVersion: typeof MAGIC_WORKER_PROTOCOL_VERSION;
	readonly type: "initialize";
}

interface MagicWorkerInvocationBase {
	readonly context: MagicWorkerContextSnapshot;
	readonly id: number;
}

export interface MagicWorkerEventRequest extends MagicWorkerInvocationBase {
	readonly event: MagicWorkerEvent;
	readonly type: "event";
}

export interface MagicWorkerCommandRequest extends MagicWorkerInvocationBase {
	readonly args: string;
	readonly name: string;
	readonly type: "command";
}

export interface MagicWorkerToolRequest extends MagicWorkerInvocationBase {
	readonly args: JsonInputValue;
	readonly name: string;
	readonly toolCallId: string;
	readonly type: "tool";
}

export interface MagicWorkerCancelRequest {
	readonly id: number;
	readonly type: "cancel";
}

export interface MagicWorkerSessionEntryRequest {
	readonly entry: SessionEntry;
	readonly leafId: string;
	readonly sessionId: string;
	readonly type: "session-entry";
}

export interface MagicWorkerSessionSnapshotRequest {
	readonly branch: readonly SessionEntry[];
	readonly leafId: string | undefined;
	readonly sessionId: string;
	readonly type: "session-snapshot";
}

export type MagicWorkerRequest =
	| MagicWorkerCancelRequest
	| MagicWorkerCommandRequest
	| MagicWorkerEventRequest
	| MagicWorkerInitializeRequest
	| MagicWorkerSessionEntryRequest
	| MagicWorkerSessionSnapshotRequest
	| MagicWorkerToolRequest;

export interface MagicWorkerReadyMessage {
	readonly commands: readonly MagicWorkerCommandDescriptor[];
	readonly events: readonly MagicWorkerEventName[];
	readonly id: number;
	readonly protocolVersion: typeof MAGIC_WORKER_PROTOCOL_VERSION;
	readonly tools: readonly MagicWorkerToolDescriptor[];
	readonly type: "ready";
}

export interface MagicWorkerResultMessage {
	readonly id: number;
	readonly result: MagicWorkerInvocationResult;
	readonly type: "result";
}

export interface MagicWorkerErrorMessage {
	readonly error: string;
	readonly id: number;
	readonly stack: string | undefined;
	readonly type: "error";
}

export interface MagicWorkerToolUpdateMessage {
	readonly id: number;
	readonly type: "tool-update";
	readonly update: AgentToolResult<unknown>;
}

export type MagicWorkerEffect =
	| {
			readonly args: Parameters<ExtensionAPI["appendEntry"]>;
			readonly name: "appendEntry";
	  }
	| {
			readonly args: Parameters<ExtensionAPI["sendMessage"]>;
			readonly name: "sendMessage";
	  }
	| {
			readonly args: Parameters<ExtensionAPI["sendUserMessage"]>;
			readonly name: "sendUserMessage";
	  }
	| {
			readonly args: Parameters<ExtensionAPI["setActiveTools"]>;
			readonly name: "setActiveTools";
	  };

export type MagicWorkerEffectMessage = MagicWorkerEffect & {
	readonly sessionId: string | undefined;
	readonly type: "effect";
};

export interface MagicWorkerSyncEffectMessage {
	readonly args: Parameters<SessionManager["appendCompaction"]>;
	readonly buffer: SharedArrayBuffer;
	readonly name: "appendCompaction";
	readonly sessionId: string | undefined;
	readonly type: "sync-effect";
}

export type MagicWorkerInvocationResult =
	| AgentToolResult<unknown>
	| BeforeAgentStartEventResult
	| JsonInputValue
	| { readonly cancel?: boolean }
	| { readonly content?: Extract<MagicWorkerEvent, { readonly type: "tool_result" }>["content"] }
	| { readonly message?: Extract<MagicWorkerEvent, { readonly type: "message_end" }>["message"] }
	| { readonly messages?: Extract<MagicWorkerEvent, { readonly type: "context" }>["messages"] };

export type MagicWorkerMessage =
	| MagicWorkerEffectMessage
	| MagicWorkerErrorMessage
	| MagicWorkerReadyMessage
	| MagicWorkerResultMessage
	| MagicWorkerSyncEffectMessage
	| MagicWorkerToolUpdateMessage;
