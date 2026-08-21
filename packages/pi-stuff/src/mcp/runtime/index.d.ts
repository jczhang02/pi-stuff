import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MCP_STATUS_EVENT: "pi-mcp-adapter/status/v1";
export const MCP_STATUS_SNAPSHOT_VERSION: 1;

export type McpServerRuntimeStatus =
  | "connected"
  | "cached"
  | "failed"
  | "needs-auth"
  | "not-connected"
  | "disabled";

export interface McpServerStatusSnapshot {
  readonly name: string;
  readonly status: McpServerRuntimeStatus;
  readonly toolCount: number;
  readonly resourceCount?: number;
  readonly failedAgoSeconds?: number;
  readonly failureDetail?: string;
  readonly disabled: boolean;
  readonly oauth?: boolean;
  readonly autoConnect?: boolean;
}

export interface McpStatusSnapshot {
  readonly version: typeof MCP_STATUS_SNAPSHOT_VERSION;
  readonly servers: ReadonlyArray<McpServerStatusSnapshot>;
  readonly totalTools: number;
  readonly totalResources: number;
  readonly connectedCount: number;
  readonly disabledCount: number;
}

export interface McpAdapterOptions {
  config?: unknown;
  configPath?: string;
  deferStartupConnections?: boolean;
  interactiveUi?: boolean;
  interactiveProtocolRequests?: boolean;
  proxyOnly?: boolean;
}

export type McpAdapter = (pi: ExtensionAPI) => void;

export function createMcpAdapter(options?: McpAdapterOptions): McpAdapter;

declare const mcpAdapter: McpAdapter;
export default mcpAdapter;
