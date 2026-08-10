import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface SandboxToolExecutionContext {
	readonly captureResult?: (result: AgentToolResult<unknown>) => void;
	readonly cwd: string;
	readonly extensionContext?: ExtensionContext;
	readonly onUpdate?: (result: AgentToolResult<unknown>) => void;
	readonly toolCallId?: string;
}

export interface SuiteSandboxTool {
	readonly description: string;
	readonly inputSchema: unknown;
	readonly name: string;
	readonly usage: string;
	invoke(input: unknown, context: SandboxToolExecutionContext, signal: AbortSignal): Promise<unknown>;
}

export interface RuntimeContentItem {
	readonly detail?: "auto" | "high" | "low" | "original" | null;
	readonly image_url?: string;
	readonly text?: string;
	readonly type: "input_image" | "input_text";
}

type RuntimeToolTraceStatus = "cancelled" | "done" | "error" | "running";

export interface RuntimeToolTrace {
	error?: string;
	readonly id: string;
	readonly input: unknown;
	readonly name: string;
	result?: AgentToolResult<unknown>;
	status: RuntimeToolTraceStatus;
}

export type RuntimeResponse = (
	| { readonly kind: "result"; readonly errorText?: string }
	| { readonly kind: "terminated" }
	| { readonly kind: "yielded" }
) & {
	readonly cellId: string;
	readonly contentItems: readonly RuntimeContentItem[];
	readonly droppedTraceCount?: number;
	readonly traces?: readonly RuntimeToolTrace[];
};

export interface RuntimeTraceUpdate {
	readonly cellId: string;
	readonly droppedTraceCount?: number;
	readonly traces: readonly RuntimeToolTrace[];
}

export interface ExecutorContext extends SandboxToolExecutionContext {
	readonly onTraceUpdate?: (update: RuntimeTraceUpdate) => void;
}

export interface CodeModeExecuteOptions {
	readonly context: ExecutorContext;
	readonly signal?: AbortSignal;
	readonly source: string;
	readonly tools: readonly SuiteSandboxTool[];
}

export interface CodeModeWaitOptions {
	readonly context: ExecutorContext;
	readonly signal?: AbortSignal;
}
