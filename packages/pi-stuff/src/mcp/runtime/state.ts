import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpLifecycleManager } from "./lifecycle.ts";
import type { AuthStorageOptions } from "./mcp-auth.ts";
import type { McpOAuthRuntime } from "./mcp-auth-flow.ts";
import type { McpStatusEventBus } from "./mcp-status.ts";
import type { McpRuntimeOwner } from "./runtime-owner.ts";
import type { McpServerManager } from "./server-manager.ts";
import type { McpConfig, ToolMetadata } from "./types.ts";

export interface McpExtensionState {
	owner: McpRuntimeOwner;
	manager: McpServerManager;
	lifecycle: McpLifecycleManager;
	toolMetadata: Map<string, ToolMetadata[]>;
	/** Resource counts retained separately because tool metadata includes resource tools. */
	resourceCounts: Map<string, number>;
	serverInstructions: Map<string, string>;
	config: McpConfig;
	programmaticConfig?: boolean;
	oauthRuntime: McpOAuthRuntime;
	authStorageOptions: AuthStorageOptions;
	failureTracker: Map<string, number>;
	failureMessages: Map<string, string>;
	/** Session-only approvals keyed by server and original tool name. */
	approvedToolCalls: Map<string, true>;
	ui?: ExtensionContext["ui"];
	onToolMetadataUpdated?: (serverName: string, reason: string) => void | Promise<void>;
	statusEvents?: McpStatusEventBus;
}
