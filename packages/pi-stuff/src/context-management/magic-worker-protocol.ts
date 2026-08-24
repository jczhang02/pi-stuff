import type { ContextUsage, ExtensionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const MAGIC_WORKER_PROTOCOL_VERSION = 1;
export const MAGIC_WORKER_SYNC_BUFFER_BYTES = 64 * 1024;

export interface MagicWorkerModel {
	readonly api?: string;
	readonly contextWindow: number;
	readonly id: string;
	readonly maxTokens: number;
	readonly provider: string;
}

export interface MagicWorkerSessionSnapshot {
	readonly branch: readonly unknown[] | undefined;
	readonly file: string | undefined;
	readonly id: string | undefined;
	readonly leafId: string | undefined;
}

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
	readonly thinkingLevel: string | undefined;
}

export interface MagicWorkerToolDescriptor {
	readonly constrainedSampling: ToolDefinition["constrainedSampling"] | undefined;
	readonly description: string;
	readonly executionMode: ToolDefinition["executionMode"] | undefined;
	readonly label: string;
	readonly name: string;
	readonly parameters: ToolDefinition["parameters"];
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
	readonly parameters: unknown;
	readonly promptGuidelines: readonly string[] | undefined;
	readonly sourceInfo: unknown;
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
	readonly event: ExtensionEvent;
	readonly name: string;
	readonly type: "event";
}

export interface MagicWorkerCommandRequest extends MagicWorkerInvocationBase {
	readonly args: string;
	readonly name: string;
	readonly type: "command";
}

export interface MagicWorkerToolRequest extends MagicWorkerInvocationBase {
	readonly args: unknown;
	readonly name: string;
	readonly toolCallId: string;
	readonly type: "tool";
}

export interface MagicWorkerCancelRequest {
	readonly id: number;
	readonly type: "cancel";
}

export interface MagicWorkerSessionEntryRequest {
	readonly entry: unknown;
	readonly leafId: string;
	readonly sessionId: string;
	readonly type: "session-entry";
}

export type MagicWorkerRequest =
	| MagicWorkerCancelRequest
	| MagicWorkerCommandRequest
	| MagicWorkerEventRequest
	| MagicWorkerInitializeRequest
	| MagicWorkerSessionEntryRequest
	| MagicWorkerToolRequest;

export interface MagicWorkerReadyMessage {
	readonly commands: readonly MagicWorkerCommandDescriptor[];
	readonly events: readonly string[];
	readonly id: number;
	readonly protocolVersion: typeof MAGIC_WORKER_PROTOCOL_VERSION;
	readonly tools: readonly MagicWorkerToolDescriptor[];
	readonly type: "ready";
}

export interface MagicWorkerResultMessage {
	readonly id: number;
	readonly result: unknown;
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
	readonly update: unknown;
}

export type MagicWorkerEffectName = "appendEntry" | "sendMessage" | "sendUserMessage" | "setActiveTools";

export interface MagicWorkerEffectMessage {
	readonly args: readonly unknown[];
	readonly name: MagicWorkerEffectName;
	readonly sessionId: string | undefined;
	readonly type: "effect";
}

export type MagicWorkerSyncEffectName = "appendCompaction";

export interface MagicWorkerSyncEffectMessage {
	readonly args: readonly unknown[];
	readonly buffer: SharedArrayBuffer;
	readonly name: MagicWorkerSyncEffectName;
	readonly sessionId: string | undefined;
	readonly type: "sync-effect";
}

export type MagicWorkerMessage =
	| MagicWorkerEffectMessage
	| MagicWorkerErrorMessage
	| MagicWorkerReadyMessage
	| MagicWorkerResultMessage
	| MagicWorkerSyncEffectMessage
	| MagicWorkerToolUpdateMessage;
