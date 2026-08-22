import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.ts";
import { isServerDisabled, type McpAuthResult, type McpConfig, type ImportKind } from "./types.ts";
import {
  ensureCompatibilityImports,
  getMcpDiscoverySummary,
  getProjectConfigPath,
  type KnownServerPreset,
  previewCompatibilityImports,
  previewSharedServerEntry,
  previewStarterProjectConfig,
  writeSharedServerEntry,
  writeStarterProjectConfig,
} from "./config.ts";
import { markKeepAliveAfterConnect, notifyToolMetadataUpdated, updateMetadataCache, updateStatusBar, getFailureAgeSeconds, getFailureMessage, clearFailure, recordFailure } from "./init.ts";
import { reconstructPromptMetadata } from "./metadata-cache.ts";
import { buildToolMetadata } from "./tool-metadata.ts";
import { supportsOAuth, authenticate, removeAuth, type McpOAuthRuntime } from "./mcp-auth-flow.ts";
import { getAuthStorageOptions } from "./mcp-auth.ts";
import { loadOnboardingState, markSetupCompleted as persistSetupCompleted } from "./onboarding-state.ts";
import { openPath, resolveServerUrl, sanitizeTerminalText } from "./utils.ts";
import { isAbortError } from "./runtime-owner.ts";

export type McpCommandContext = Pick<ExtensionContext, "cwd" | "hasUI" | "signal" | "ui">;

export async function showStatus(state: McpExtensionState, ctx: McpCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  const lines: string[] = ["MCP Server Status:", ""];

  for (const name of Object.keys(state.config.mcpServers)) {
    const definition = state.config.mcpServers[name];
    if (isServerDisabled(definition)) {
      lines.push(`⊘ ${name}: disabled (run /mcp enable ${name}, then /reload)`);
      continue;
    }
    const connection = state.manager.getConnection(name);
    const metadata = state.toolMetadata.get(name);
    const toolCount = metadata?.length ?? 0;
    const failedAgo = getFailureAgeSeconds(state, name);
    let status = "not connected";
    let statusIcon = "○";
    let failed = false;

    if (connection?.status === "connected") {
      status = "connected";
      statusIcon = "✓";
    } else if (connection?.status === "needs-auth") {
      status = "needs auth";
      statusIcon = "⚠";
    } else if (failedAgo !== null) {
      const reason = sanitizeTerminalText(getFailureMessage(state, name) ?? "");
      status = reason ? `failed ${failedAgo}s ago — ${reason}` : `failed ${failedAgo}s ago`;
      statusIcon = "✗";
      failed = true;
    } else if (metadata !== undefined) {
      status = "cached";
    }

    const toolSuffix = failed ? "" : ` (${toolCount} tools${status === "cached" ? ", cached" : ""})`;
    lines.push(`${statusIcon} ${name}: ${status}${toolSuffix}`);
  }

  if (Object.keys(state.config.mcpServers).length === 0) {
    lines.push("No MCP servers configured");
    lines.push("Run /mcp setup to adopt imports or scaffold a starter .mcp.json");
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

export async function showPrompts(state: McpExtensionState, ctx: McpCommandContext): Promise<void> {
  if (!ctx.hasUI) return;
  const allPrompts = [...(state.promptMetadata?.values() ?? [])].flat();
  const failedPromptServers = [...(state.manager.getAllConnections?.() ?? [])]
    .filter(([, connection]) => connection.status === "connected" && connection.promptDiscoveryFailed)
    .map(([serverName]) => serverName)
    .sort();
  if (allPrompts.length === 0) {
    const failureNote = failedPromptServers.length > 0
      ? ` Prompt discovery failed for: ${failedPromptServers.join(", ")}.`
      : "";
    ctx.ui.notify(`No MCP prompts available. Prompts are discovered when servers with the \`prompts\` capability connect.${failureNote}`, "info");
    return;
  }
  const lines = ["MCP Prompts:", ""];
  const grouped = new Map<string, typeof allPrompts>();
  for (const prompt of allPrompts) {
    const list = grouped.get(prompt.serverName) ?? [];
    list.push(prompt);
    grouped.set(prompt.serverName, list);
  }
  for (const [serverName, prompts] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${serverName}:`);
    for (const prompt of prompts.sort((a, b) => a.commandName.localeCompare(b.commandName))) {
      const args = prompt.arguments.map(argument => argument.required ? `<${argument.name}>` : `[${argument.name}]`).join(" ");
      lines.push(`  /${prompt.commandName}${args ? ` ${args}` : ""}`);
      if (prompt.description) lines.push(`      ${prompt.description}`);
    }
    lines.push("");
  }
  lines.push(`Total: ${allPrompts.length} prompt${allPrompts.length === 1 ? "" : "s"}`);
  if (failedPromptServers.length > 0) {
    lines.push(`Prompt discovery failed for: ${failedPromptServers.join(", ")}. Cached prompt metadata may be stale.`);
  }
  ctx.ui.notify(lines.join("\n"), "info");
}

export async function showTools(state: McpExtensionState, ctx: McpCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  const allTools = [...state.toolMetadata.entries()]
    .filter(([serverName]) => !isServerDisabled(state.config.mcpServers[serverName]))
    .flatMap(([, metadata]) => metadata.map(m => m.name));

  if (allTools.length === 0) {
    ctx.ui.notify("No MCP tools available", "info");
    return;
  }

  const lines = [
    "MCP Tools:",
    "",
    ...allTools.map(t => `  ${t}`),
    "",
    `Total: ${allTools.length} tools`,
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

export async function reconnectServer(
  state: McpExtensionState,
	  ctx: McpCommandContext,
  name: string,
): Promise<boolean> {
  const definition = state.config.mcpServers[name];
  const ui = ctx.hasUI ? ctx.ui : undefined;
  const signal = state.owner?.signal;
  if (!definition) {
    if (ui) {
      ui.notify(`Server "${name}" not found in config`, "error");
    }
    return false;
  }
  if (isServerDisabled(definition)) {
    if (ui) ui.notify(`MCP: ${name} is disabled. Run /mcp enable ${name}, then /reload.`, "warning");
    return false;
  }

  try {
    await state.manager.close(name);
    state.owner?.throwIfInactive();
    const connection = signal
      ? await state.manager.connect(name, definition, signal)
      : await state.manager.connect(name, definition);
    state.owner?.throwIfInactive();
    if (connection.status === "needs-auth") {
      if (ui) {
        ui.notify(`MCP: ${name} requires OAuth. Run /mcp auth ${name} first.`, "warning");
      }
      updateStatusBar(state);
      return false;
    }

    const prefix = state.config.settings?.toolPrefix ?? "server";
    const { metadata, failedTools } = buildToolMetadata(connection.tools, connection.resources, definition, name, prefix);
    state.toolMetadata.set(name, metadata);
    if (!connection.promptDiscoveryFailed) {
      state.promptMetadata?.set(name, reconstructPromptMetadata(name, connection.prompts ?? [], prefix, definition));
      state.promptMetadataLive?.add(name);
    }
    if (connection.instructions) {
      state.serverInstructions.set(name, connection.instructions);
    } else {
      state.serverInstructions.delete(name);
    }
    updateMetadataCache(state, name);
    notifyToolMetadataUpdated(state, name, "command-reconnect");
    markKeepAliveAfterConnect(state, name);
    clearFailure(state, name);

    if (ui) {
      ui.notify(
        `MCP: Reconnected to ${name} (${connection.tools.length} tools, ${connection.resources.length} resources)`,
        "info"
      );
      if (failedTools.length > 0) {
        ui.notify(`MCP: ${name} - ${failedTools.length} tools skipped`, "warning");
      }
    }
    updateStatusBar(state);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAbortError(error, signal)) throw error;
    recordFailure(state, name, message);
    if (ui) {
      ui.notify(`MCP: Failed to reconnect to ${name}: ${sanitizeTerminalText(message)}`, "error");
    }
    updateStatusBar(state);
    return false;
  }
}

export async function reconnectServers(
  state: McpExtensionState,
	  ctx: McpCommandContext,
  targetServer?: string
): Promise<boolean> {
  if (targetServer && !state.config.mcpServers[targetServer]) {
    if (ctx.hasUI) {
      ctx.ui.notify(`Server "${targetServer}" not found in config`, "error");
    }
    return false;
  }

  const names = targetServer ? [targetServer] : Object.keys(state.config.mcpServers);
  let succeeded = true;
  for (const name of names) {
    succeeded = await reconnectServer(state, ctx, name) && succeeded;
  }

  updateStatusBar(state);
  return succeeded;
}

export async function authenticateServer(
  serverName: string,
  config: McpConfig,
	  ctx: McpCommandContext,
  signal?: AbortSignal,
  runtime?: McpOAuthRuntime,
): Promise<McpAuthResult> {
  const ui = ctx.hasUI ? ctx.ui : undefined;
  const cwd = ctx.cwd;
  signal ??= ctx.signal;
  if (!ui) return { ok: false, message: "OAuth authentication requires an interactive session." };

  const definition = config.mcpServers[serverName];
  if (!definition) {
    const message = `Server "${serverName}" not found in config`;
    ui.notify(message, "error");
    return { ok: false, message };
  }
  if (isServerDisabled(definition)) {
    const message = `Server "${serverName}" is disabled. Run /mcp enable ${serverName}, then /reload.`;
    ui.notify(message, "warning");
    return { ok: false, message };
  }

  if (!supportsOAuth(definition)) {
    const message = `Server "${serverName}" does not use OAuth authentication. Set "auth": "oauth" or omit auth for auto-detection.`;
    ui.notify(
      `Server "${serverName}" does not use OAuth authentication.\n` +
      `Set "auth": "oauth" or omit auth for auto-detection.`,
      "error"
    );
    return { ok: false, message };
  }

  try {
    const serverUrl = resolveServerUrl(definition);
    if (!serverUrl) {
      const message = `Server "${serverName}" has no URL configured (OAuth requires HTTP transport)`;
      ui.notify(message, "error");
      return { ok: false, message };
    }

	    ui.setStatus("mcp-oauth", `Authenticating ${serverName}...`);
	    const authStorageOptions = getAuthStorageOptions(config.settings?.oauthDir, cwd);
	    const authOptions: Parameters<typeof authenticate>[3] = {
	      onAuthorizationUrl: (authorizationUrl) => {
        ui.notify(
          `Open this URL to authenticate ${serverName}:\n\n${authorizationUrl}\n\n` +
          "After approving, return to Pi; the local callback will complete automatically.",
          "info"
        );
      },
	      signal,
	      runtime,
	    };
	    if (authStorageOptions.baseDir) authOptions.authStorageOptions = authStorageOptions;
	    const status = await authenticate(serverName, serverUrl, definition, authOptions);
    if (signal?.aborted) signal.throwIfAborted();

    if (status === "authenticated") {
      const message = `OAuth authentication successful for "${serverName}".`;
      ui.notify(message, "info");
      return { ok: true, message };
    }

    const message = `OAuth authentication failed for "${serverName}".`;
    ui.notify(message, "error");
    return { ok: false, message };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    ui.notify(`Failed to authenticate "${serverName}": ${message}`, "error");
    return { ok: false, message };
  } finally {
    if (!signal?.aborted) ui.setStatus("mcp-oauth", undefined);
  }
}

export async function logoutServer(
  serverName: string,
  state: McpExtensionState,
	  ctx: McpCommandContext
): Promise<{ ok: boolean; message: string }> {
  const definition = state.config.mcpServers[serverName];
  const ui = ctx.hasUI ? ctx.ui : undefined;
  if (!definition) {
    const message = `Server "${serverName}" not found in config`;
    if (ui) ui.notify(message, "error");
    return { ok: false, message };
  }

  const signal = state.owner?.signal;
  try {
    await removeAuth(serverName, { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime });
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (ui) {
      ui.notify(`Failed to clear OAuth credentials for "${serverName}": ${sanitizeTerminalText(message)}`, "error");
    }
    return { ok: false, message };
  }

  state.owner?.throwIfInactive();
  try {
    await state.manager.close(serverName);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (ui) {
      ui.notify(
        `OAuth credentials were cleared for "${serverName}", but its connection could not be closed: ${sanitizeTerminalText(message)}`,
        "error",
      );
    }
    return { ok: false, message };
  }

  state.owner?.throwIfInactive();
  updateStatusBar(state);

  const message = `OAuth credentials cleared for "${serverName}". Run /mcp auth ${serverName} to authenticate again.`;
  if (ui) ui.notify(message, "info");
  return { ok: true, message };
}

export interface PanelFlowResult {
  configChanged: boolean;
}

export async function openMcpSetup(
  state: McpExtensionState,
  pi: ExtensionAPI,
	  ctx: McpCommandContext,
  configOverridePath?: string,
  mode: "empty" | "setup" = "setup",
): Promise<PanelFlowResult> {
  if (!ctx.hasUI) return { configChanged: false };
  if (state.programmaticConfig) {
    ctx.ui.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
    return { configChanged: false };
  }

  const discovery = getMcpDiscoverySummary(configOverridePath, ctx.cwd);
  const onboardingState = loadOnboardingState();
  const { createMcpSetupPanel } = await import("./mcp-setup-panel.ts");
  let configChanged = false;

  const callbacks = {
    previewImports: (imports: ImportKind[]) => previewCompatibilityImports(imports, configOverridePath),
    previewStarterProject: () => previewStarterProjectConfig(ctx.cwd),
    previewRepoPrompt: () => {
      const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd).repoPrompt;
      if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) return null;
      return previewSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
    },
    previewKnownServer: (preset: KnownServerPreset) => previewSharedServerEntry(getProjectConfigPath(ctx.cwd), preset.id, preset.entry),
    adoptImports: async (imports: ImportKind[]) => {
      const result = await ensureCompatibilityImports(imports, configOverridePath);
      if (result.added.length > 0) configChanged = true;
      return result;
    },
    scaffoldProjectConfig: async () => {
      const path = await writeStarterProjectConfig(ctx.cwd);
      configChanged = true;
      return { path };
    },
    addRepoPrompt: async () => {
      const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd).repoPrompt;
      if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) {
        throw new Error("RepoPrompt is not available to add from this setup screen.");
      }
      const path = await writeSharedServerEntry(repoPrompt.targetPath, repoPrompt.serverName, repoPrompt.entry);
      configChanged = true;
      return { path, serverName: repoPrompt.serverName };
    },
    addKnownServer: async (preset: KnownServerPreset) => {
      const path = await writeSharedServerEntry(getProjectConfigPath(ctx.cwd), preset.id, preset.entry);
      configChanged = true;
      return { path, serverName: preset.name };
    },
    openPath: async (targetPath: string) => {
      await openPath(pi, targetPath);
    },
    markSetupCompleted: () => {
      persistSetupCompleted();
    },
  };

  return new Promise<PanelFlowResult>((resolve) => {
    ctx.ui.custom(
		(tui, theme, keybindings, done) => {
			return createMcpSetupPanel(discovery, callbacks, { mode, onboardingState, keybindings }, tui, theme, () => {
          done(undefined);
          resolve({ configChanged });
        });
      },
    );
  });
}
