import type { JsonInputValue } from "../../shared/json-value.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConsentManager } from "./consent-manager.ts";
import type { McpLifecycleManager } from "./lifecycle.ts";
import type { McpServerManager } from "./server-manager.ts";
import type { AuthStorageOptions } from "./mcp-auth.ts";
import type { ToolMetadata, PromptMetadata, McpConfig, UiSessionMessages, UiStreamSummary } from "./types.ts";
import type { UiResourceHandler } from "./ui-resource-handler.ts";
import type { UiServerHandle } from "./ui-server.ts";
import type { McpRuntimeOwner } from "./runtime-owner.ts";
import type { McpOAuthRuntime } from "./mcp-auth-flow.ts";
import type { McpStatusEventBus } from "./mcp-status.ts";

export interface CompletedUiSession {
  serverName: string;
  toolName: string;
  completedAt: Date;
  reason: string;
  messages: UiSessionMessages;
  stream?: UiStreamSummary;
}

export type SendMessageFn = (
  message: {
    customType: string;
    content: Array<{ type: "text"; text: string }>;
    display?: string;
    details?: JsonInputValue;
  },
  options?: { deliverAs?: "steer" | "followUp" | "nextTurn"; triggerTurn?: boolean }
) => void | Promise<boolean>;

export interface McpExtensionState {
  owner: McpRuntimeOwner;
  manager: McpServerManager;
  lifecycle: McpLifecycleManager;
  toolMetadata: Map<string, ToolMetadata[]>;
  /** Resource counts retained separately because tool metadata includes resource tools. */
  resourceCounts: Map<string, number>;
  promptMetadata: Map<string, PromptMetadata[]>;
  /** Servers whose prompt inventory came from successful live discovery. */
  promptMetadataLive: Set<string>;
  serverInstructions: Map<string, string>;
  config: McpConfig;
  programmaticConfig?: boolean;
  oauthRuntime: McpOAuthRuntime;
  authStorageOptions: AuthStorageOptions;
  failureTracker: Map<string, number>;
  failureMessages: Map<string, string>;
  /** Session-only approvals keyed by server and original tool name. */
  approvedToolCalls: Map<string, true>;
  uiResourceHandler: UiResourceHandler;
  consentManager: ConsentManager;
  uiServer: UiServerHandle | null;
  completedUiSessions: CompletedUiSession[];
  /** Whether MCP Apps may open browser/native interactive windows. */
  interactiveUiEnabled?: boolean;
  openBrowser: (url: string) => Promise<void>;
  ui?: ExtensionContext["ui"];
  sendMessage?: SendMessageFn;
  /** Read the live Host delivery mode immediately before an MCP UI action. */
  isAgentIdle?: () => boolean;
  /** Promote an explicit MCP UI steer after its Host message is accepted. */
  promoteActiveAgentWorkToUser?: () => void;
  onToolMetadataUpdated?: (serverName: string, reason: string) => void | Promise<void>;
  statusEvents?: McpStatusEventBus;
}
