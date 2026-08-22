import { parseJsonObject, type JsonInputObject } from "../../shared/json-value.js";
import { isRuntimeFunction } from "../../shared/runtime-type.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { HOST_SHUTDOWN_GRACE_MS } from "../../lifecycle-deadline.js";
import type { McpExtensionState } from "./state.ts";
import type { DirectToolSpec, McpAdapterOptions, McpConfig, PromptMetadata } from "./types.ts";
import type { McpOAuthRuntime } from "./mcp-auth-flow.ts";
import { type TUnsafe, Type } from "typebox";
import { showStatus, showTools, showPrompts, reconnectServer, reconnectServers, authenticateServer, logoutServer, openMcpSetup, type McpCommandContext } from "./commands.ts";
import {
  cloneMcpConfig,
  loadMcpConfig,
  writeProjectServerDisabledOverride,
  writeProjectServerLifecycleOverride,
} from "./config.ts";
import { buildProxyDescription, createDirectToolExecutor, getMissingConfiguredDirectToolServers, resolveDirectTools } from "./direct-tools.ts";
import { flushMetadataCache, initializeMcp, updateStatusBar, type McpInitializationContext } from "./init.ts";
import { loadMetadataCache, type MetadataCache } from "./metadata-cache.ts";
import { createPromptCommand, registerMcpPromptMessageRenderer, resolveCachedPrompts } from "./prompts.ts";
import { logger } from "./logger.ts";
import { executeAuthComplete, executeAuthStart, executeCall, executeConnect, executeDescribe, executeInstructions, executeList, executeSearch, executeStatus, executeUiMessages } from "./proxy-modes.ts";
import { formatTerminalError, getConfigPathFromArgv, normalizeDirectToolInputSchema, truncateAtWord } from "./utils.ts";
import { createOAuthRuntime, shutdownOAuth } from "./mcp-auth-flow.ts";
import { createMcpDirectToolCallRenderer, renderMcpProxyToolCall, renderMcpToolResult } from "./tool-result-renderer.ts";
import { toolErrorOverride } from "./error-signal.ts";
import { createMcpRuntimeOwner, createOwnedUi, isAbortError, type McpRuntimeOwner } from "./runtime-owner.ts";
import { publishMcpStatusShutdown } from "./mcp-status.ts";
import { runMcpScript } from "./mcp-code.ts";

export type { McpAdapterOptions } from "./types.ts";
export {
  MCP_STATUS_EVENT,
  MCP_STATUS_SNAPSHOT_VERSION,
  type McpServerRuntimeStatus,
  type McpServerStatusSnapshot,
  type McpStatusSnapshot,
} from "./types.ts";

type AdapterCommandSpec = Parameters<ExtensionAPI["registerCommand"]>[1];
type AdapterCommandContext = Parameters<AdapterCommandSpec["handler"]>[1];
export type McpAdapterCommandSpec = Omit<AdapterCommandSpec, "handler"> & {
	handler(args: string, ctx: AdapterCommandContext): boolean | undefined | Promise<boolean | undefined>;
};

export type McpAdapterExtensionAPI = ExtensionAPI & {
	registerCommand(name: string, spec: McpAdapterCommandSpec): void;
};

interface DirectToolSyncResult {
	added: string[];
	deactivated: string[];
	specs: DirectToolSpec[];
	updated: string[];
}

export interface ParsedMcpCommand {
	serverName?: string;
	subcommand: string;
}

const INIT_WAIT_TIMEOUT_MS = 30_000;
const INIT_WAIT_TIMED_OUT: unique symbol = Symbol("init-wait-timed-out");

async function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof INIT_WAIT_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof INIT_WAIT_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(INIT_WAIT_TIMED_OUT), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function installMcpAdapter(pi: McpAdapterExtensionAPI, options: McpAdapterOptions) {
  registerMcpPromptMessageRenderer(pi);
	const sessionConfig = options.config !== undefined ? cloneMcpConfig(options.config) : undefined;
  const programmaticConfig = sessionConfig !== undefined;
  let state: McpExtensionState | null = null;
  let initPromise: Promise<McpExtensionState> | null = null;
  let currentOwner: McpRuntimeOwner | null = null;
  let currentOAuthRuntime: McpOAuthRuntime | null = null;
  let lifecycleGeneration = 0;

  async function shutdownState(currentState: McpExtensionState | null, reason: string): Promise<void> {
    if (!currentState) {
      publishMcpStatusShutdown(pi.events);
      return;
    }

    publishMcpStatusShutdown(currentState.statusEvents);

    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }

    let flushError: Error | undefined;
    try {
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error instanceof Error ? error : new Error(String(error));
    }

    try {
      if (currentState.owner) {
        await currentState.owner.stop(reason);
      } else {
        await currentState.lifecycle.gracefulShutdown();
      }
    } catch (error) {
      if (flushError) {
        logger.error(
          "MCP: graceful shutdown failed after metadata flush error",
          error instanceof Error ? error : new Error(formatTerminalError(error)),
        );
      } else {
        throw error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  const earlyConfigPath = programmaticConfig
    ? undefined
    : options.configPath ?? getConfigPathFromArgv();
  const earlyConfig = programmaticConfig
    ? cloneMcpConfig(sessionConfig)
    : loadMcpConfig(earlyConfigPath);
  const earlyCache = loadMetadataCache();
  const envRaw = options.proxyOnly === true ? "__none__" : process.env.MCP_DIRECT_TOOLS;
  const envDirectToolOverride = envRaw?.split(",").map(s => s.trim()).filter(Boolean);
  const registeredDirectTools = new Map<string, string>();
  const fallbackDeactivatedTools = new Set<string>();
  let proxyToolRegistered = false;
  let proxyToolDescription: string | null = null;
  let directToolsFrozen = false;

	  const toToolParameters = (schema: JsonInputObject): TUnsafe<JsonInputObject> =>
	    Type.Unsafe<JsonInputObject>(schema);

  function directToolFingerprint(spec: DirectToolSpec): string {
    return JSON.stringify({
      serverName: spec.serverName,
      originalName: spec.originalName,
      prefixedName: spec.prefixedName,
      description: spec.description,
      inputSchema: spec.inputSchema,
      resourceUri: spec.resourceUri,
      uiResourceUri: spec.uiResourceUri,
      uiStreamMode: spec.uiStreamMode,
    });
  }

  function registerDirectTool(spec: DirectToolSpec): void {
	    pi.registerTool({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: toToolParameters(normalizeDirectToolInputSchema(spec.inputSchema)),
      execute: createDirectToolExecutor(() => state, () => initPromise, spec),
      renderCall: createMcpDirectToolCallRenderer(spec.prefixedName),
      renderResult: renderMcpToolResult,
    });
  }

  function resolveCurrentDirectTools(config: McpConfig, cache: MetadataCache | null): DirectToolSpec[] {
    if (envRaw === "__none__") return [];
    const prefix = config.settings?.toolPrefix ?? "server";
    return resolveDirectTools(config, cache, prefix, envDirectToolOverride);
  }

  function deactivateTools(toolNames: string[]): string[] {
    if (toolNames.length === 0) return [];
		    const unregisterToolMember = "unregisterTool" in pi ? pi.unregisterTool : undefined;
		    const unregisterTool = isRuntimeFunction(unregisterToolMember)
		      ? (name: string) => unregisterToolMember(name) === true
	      : undefined;
    const unregistered = toolNames.filter((toolName) => unregisterTool?.(toolName) === true);
    const fallbackNames = toolNames.filter((toolName) => !unregistered.includes(toolName));
    const remove = new Set(toolNames);
    const activeTools = pi.getActiveTools?.();
    if (!activeTools || activeTools.length === 0) {
      for (const toolName of fallbackNames) fallbackDeactivatedTools.add(toolName);
      return unregistered;
    }
    const nextActiveTools = activeTools.filter((name) => !remove.has(name));
    if (nextActiveTools.length !== activeTools.length) {
      for (const toolName of fallbackNames) fallbackDeactivatedTools.add(toolName);
      pi.setActiveTools(nextActiveTools);
    }
    return unregistered;
  }

	  function syncDirectTools(config: McpConfig, cache: MetadataCache | null): DirectToolSyncResult {
    const specs = resolveCurrentDirectTools(config, cache);
    const nextNames = new Set(specs.map((spec) => spec.prefixedName));
    const added: string[] = [];
    const updated: string[] = [];
    const deactivated: string[] = [];

    for (const spec of specs) {
      const fingerprint = directToolFingerprint(spec);
      const previous = registeredDirectTools.get(spec.prefixedName);
      if (previous !== fingerprint) {
        registerDirectTool(spec);
        registeredDirectTools.set(spec.prefixedName, fingerprint);
        if (fallbackDeactivatedTools.delete(spec.prefixedName)) {
          const activeTools = pi.getActiveTools?.();
          if (activeTools && !activeTools.includes(spec.prefixedName)) {
            pi.setActiveTools([...activeTools, spec.prefixedName]);
          }
        }
        (previous ? updated : added).push(spec.prefixedName);
      }
    }

	    for (const toolName of registeredDirectTools.keys()) {
      if (nextNames.has(toolName)) continue;
      registeredDirectTools.delete(toolName);
      deactivated.push(toolName);
    }

    deactivateTools(deactivated);
    return { specs, added, updated, deactivated };
  }

	  function syncToolSurface(ctx?: Pick<ExtensionContext, "hasUI" | "ui">): void {
    const config = state?.config ?? earlyConfig;
    const cache = loadMetadataCache();
    const result = syncDirectTools(config, cache);
    syncProxyTool(config, cache, result.specs);
    const changed = result.added.length + result.updated.length + result.deactivated.length;
    if (changed > 0 && ctx?.hasUI) {
      ctx.ui.notify(
        `MCP: direct tools refreshed (+${result.added.length}, ~${result.updated.length}, -${result.deactivated.length})`,
        "info",
      );
    }
  }

  const registeredPromptCommands = new Set<string>();

  function registerPromptCommands(specs: Iterable<PromptMetadata>): void {
    for (const spec of specs) {
      if (registeredPromptCommands.has(spec.commandName)) {
        logger.debug(`MCP: prompt "${spec.originalName}" on ${spec.serverName} skipped; /${spec.commandName} is already registered`);
        continue;
      }
      registeredPromptCommands.add(spec.commandName);
      pi.registerCommand(spec.commandName, createPromptCommand(pi, () => state, spec));
    }
  }

  function syncPromptCommands(): void {
    registerPromptCommands([...(state?.promptMetadata?.values() ?? [])].flat());
  }

  registerPromptCommands(resolveCachedPrompts(earlyConfig));

  const getPiTools = (): ToolInfo[] => pi.getAllTools();

  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string",
  });

	  function startInitialization(ctx: McpInitializationContext, owner: McpRuntimeOwner, oauthRuntime: McpOAuthRuntime, generation: number, staleReason: string): Promise<void> {
	    const initializationOptions: McpAdapterOptions & { oauthRuntime: McpOAuthRuntime; statusEvents: McpExtensionState["statusEvents"] } = {
	      oauthRuntime,
	      statusEvents: pi.events,
	      deferStartupConnections: options.deferStartupConnections,
	      interactiveUi: options.interactiveUi,
	      interactiveProtocolRequests: options.interactiveProtocolRequests,
	    };
	    if (programmaticConfig || options.configPath !== undefined) {
	      initializationOptions.configPath = earlyConfigPath;
	      initializationOptions.config = sessionConfig;
	    }
	    const promise = initializeMcp(pi, ctx, owner, initializationOptions);
    initPromise = promise;

    return promise.then(async (nextState) => {
      if (!owner.isActive() || generation !== lifecycleGeneration || initPromise !== promise) {
        try {
          await shutdownState(nextState, staleReason);
        } catch (error) {
          logger.error(
            "MCP: failed to clean stale initialization state",
            error instanceof Error ? error : new Error(formatTerminalError(error)),
          );
        }
        return;
      }

      state = nextState;
      nextState.onToolMetadataUpdated = (_serverName, _reason) => {
        if (state !== nextState || !owner.isActive()) return;
        syncPromptCommands();
        if (directToolsFrozen) {
          logger.debug(`MCP: metadata update for ${_serverName} (${_reason}) skipped — directTools frozen`);
          return;
        }
        syncToolSurface(ctx);
      };
      syncPromptCommands();
      syncToolSurface(ctx);
      updateStatusBar(nextState);
      initPromise = null;
      if (earlyConfig.settings?.freezeDirectTools === true) {
        directToolsFrozen = true;
        logger.info("MCP: direct tools frozen after initial sync — reconnects won't rebuild the system prompt; use mcp({ connect: \"server\" }) to rediscover");
      }
    }).catch(async err => {
      if (!owner.isActive() || generation !== lifecycleGeneration) {
        return;
      }
      if (initPromise !== promise && initPromise !== null) {
        return;
      }
      logger.error(
        "MCP initialization failed",
        err instanceof Error ? err : new Error(formatTerminalError(err)),
      );
      initPromise = null;
      if (state) return;

      try {
        await Promise.all([
          owner.stop("MCP initialization failed"),
          shutdownOAuth(oauthRuntime),
        ]);
      } catch (error) {
        logger.error(
          "MCP: failed to clean rejected initialization",
          error instanceof Error ? error : new Error(formatTerminalError(error)),
        );
      }
    });
  }

  function startLoadTimeInitialization(): void {
    if (options.deferStartupConnections === true) return;
    const hasStartupServer = Object.values(earlyConfig.mcpServers).some((definition) => {
      if (definition.disabled === true) return false;
      return definition.lifecycle === "eager" || definition.lifecycle === "keep-alive";
    });
    if (!hasStartupServer) return;
    setImmediate(() => {
      if (lifecycleGeneration !== 0 || state || initPromise) return;
      const generation = ++lifecycleGeneration;
      const owner = createMcpRuntimeOwner();
      const oauthRuntime = createOAuthRuntime(owner.signal);
      currentOwner = owner;
      currentOAuthRuntime = oauthRuntime;
	      startInitialization({
	        mode: "print",
	        hasUI: false,
	        cwd: process.cwd(),
	        model: undefined,
	        modelRegistry: undefined,
	        signal: undefined,
	        ui: undefined,
	        isIdle: () => true,
	      }, owner, oauthRuntime, generation, "stale_load_time_initialization");
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    const previousOwner = currentOwner;
    const previousOAuthRuntime = currentOAuthRuntime;
    const owner = createMcpRuntimeOwner();
    const oauthRuntime = createOAuthRuntime(owner.signal);
    currentOwner = owner;
    currentOAuthRuntime = oauthRuntime;
    state = null;
    initPromise = null;

    // Abort synchronously before awaiting cleanup so old callbacks and startup
    // work cannot resume into a stale ExtensionContext.
    const stopPrevious = previousOwner?.stop("MCP extension session restarted") ?? Promise.resolve();
    try {
      const cleanup = await awaitWithTimeout(Promise.all([
        stopPrevious,
        shutdownState(previousState, "session_restart"),
        previousOAuthRuntime ? shutdownOAuth(previousOAuthRuntime) : Promise.resolve(),
      ]), HOST_SHUTDOWN_GRACE_MS);
      if (cleanup === INIT_WAIT_TIMED_OUT) {
        logger.error("MCP: previous session cleanup exceeded its shutdown deadline", new Error("cleanup timed out"));
      }
    } catch (error) {
      logger.error(
        "MCP: failed to shut down previous session state",
        error instanceof Error ? error : new Error(formatTerminalError(error)),
      );
    }

    if (generation !== lifecycleGeneration || !owner.isActive()) return;

    const initialization = startInitialization(ctx, owner, oauthRuntime, generation, "stale_session_start");
    if (envRaw !== undefined && envRaw !== "__none__") {
      const missingEnvDirectTools = getMissingConfiguredDirectToolServers(
        earlyConfig,
        loadMetadataCache(),
        envDirectToolOverride,
      );
      if (missingEnvDirectTools.length > 0) {
        await initialization;
      }
    }
  });

  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const currentState = state;
    const owner = currentOwner;
    const oauthRuntime = currentOAuthRuntime;
    currentOwner = null;
    currentOAuthRuntime = null;
    state = null;
    initPromise = null;

    // Abort before awaiting cleanup so delayed initialization cannot touch stale
    // Pi context after session shutdown.
    const stopOwner = owner?.stop("MCP extension session shutdown") ?? Promise.resolve();
    try {
      const cleanup = await awaitWithTimeout(Promise.all([
        stopOwner,
        shutdownState(currentState, "session_shutdown"),
        oauthRuntime ? shutdownOAuth(oauthRuntime) : Promise.resolve(),
      ]), HOST_SHUTDOWN_GRACE_MS);
      if (cleanup === INIT_WAIT_TIMED_OUT) {
        logger.error("MCP: session cleanup exceeded its shutdown deadline", new Error("cleanup timed out"));
      }
    } catch (error) {
      logger.error(
        "MCP: session shutdown cleanup failed",
        error instanceof Error ? error : new Error(formatTerminalError(error)),
      );
    }
  });

  // Re-flag returned MCP tool failures so pi registers them as errors (see toolErrorOverride).
  pi.on("tool_result", (event) => toolErrorOverride(event.details));

		  pi.registerCommand("mcp", {
    description: "Show MCP server status",
    getArgumentCompletions: (prefix: string) => {
      const normalized = prefix.trimStart();
      const argumentMatch = normalized.match(/^(\S+)\s+(.*)$/);
      if (!argumentMatch) {
        const subcommands = [
          { value: "auth", label: "auth — Authenticate a server" },
          { value: "reconnect", label: "reconnect — Reconnect servers" },
          { value: "tools", label: "tools — List all tools" },
          { value: "prompts", label: "prompts — List all MCP prompts" },
          { value: "setup", label: "setup — Configure MCP servers" },
          { value: "logout", label: "logout — Clear server credentials" },
          { value: "disable", label: "disable — Disable a server" },
          { value: "enable", label: "enable — Enable a server" },
          { value: "auto-connect", label: "auto-connect — Persist automatic connection" },
          { value: "on-demand", label: "on-demand — Persist lazy connection" },
          { value: "status", label: "status — Show server status" },
        ].filter(({ value }) => value.startsWith(normalized));
        return subcommands.length > 0 ? subcommands : null;
      }

      const [, subcommand, argumentPrefix] = argumentMatch;
	      if (!["auth", "reconnect", "logout", "disable", "enable", "auto-connect", "on-demand"].includes(subcommand) || !state) return null;

      const servers = Object.keys(state.config.mcpServers)
        .filter((serverName) => serverName.startsWith(argumentPrefix.trimStart()))
        .map((serverName) => ({ value: `${subcommand} ${serverName}`, label: serverName }));
      return servers.length > 0 ? servers : null;
    },
	    handler: async (args: string, ctx: AdapterCommandContext) => {
      const commandOwner = currentOwner;
      const commandReload = isRuntimeFunction(ctx.reload) ? ctx.reload.bind(ctx) : async () => {};
      const commandHasUI = ctx.hasUI;
	      const commandCtx: McpCommandContext = {
	        hasUI: commandHasUI,
	        ui: commandHasUI ? (commandOwner ? createOwnedUi(ctx.ui, commandOwner) : ctx.ui) : undefined,
	        cwd: ctx.cwd,
	        signal: commandOwner?.signal ?? ctx.signal,
	      };
      if (!state && initPromise) {
        try {
          const initialized = await initPromise;
          commandOwner?.throwIfInactive();
          state = initialized;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (commandCtx.hasUI) commandCtx.ui?.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (commandCtx.hasUI) commandCtx.ui?.notify("MCP not initialized", "error");
        return;
      }

      const { subcommand, serverName } = parseMcpCommand(args);

      switch (subcommand) {
        case "auth": {
          if (!serverName) {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp auth <server>", "error");
            return false;
          }
          commandOwner?.throwIfInactive();
          const result = await authenticateServer(serverName, state.config, commandCtx, commandCtx.signal, state.oauthRuntime);
          if (result.ok) {
            commandOwner?.throwIfInactive();
            await reconnectServer(state, commandCtx, serverName);
          }
          // Stored authentication is authoritative; connection failures remain visible in MCP status.
          return result.ok;
        }
        case "reconnect": {
          commandOwner?.throwIfInactive();
          const succeeded = await reconnectServers(state, commandCtx, serverName);
          if (directToolsFrozen) syncToolSurface(commandCtx);
          return succeeded;
        }
        case "tools":
          await showTools(state, commandCtx);
          break;
        case "prompts":
          await showPrompts(state, commandCtx);
          break;
        case "setup": {
          commandOwner?.throwIfInactive();
          if (programmaticConfig) {
            commandCtx.ui?.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
            break;
          }
          const result = await openMcpSetup(state, pi, commandCtx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            commandOwner?.throwIfInactive();
            await commandReload();
            return;
          }
          break;
        }
        case "logout": {
          if (!serverName) {
            if (commandCtx.hasUI) commandCtx.ui?.notify("Usage: /mcp logout <server>", "error");
            return false;
          }
          commandOwner?.throwIfInactive();
          const result = await logoutServer(serverName, state, commandCtx);
          return result.ok;
        }
        case "disable":
        case "enable": {
          if (programmaticConfig) {
            commandCtx.ui?.notify(`/mcp ${subcommand} is unavailable when config is supplied by createMcpAdapter().`, "info");
            break;
          }
          if (!serverName) {
            commandCtx.ui?.notify(`Usage: /mcp ${subcommand} <server>`, "error");
            break;
          }
          if (!Object.hasOwn(state.config.mcpServers, serverName)) {
            commandCtx.ui?.notify(`Server "${serverName}" not found in effective config`, "error");
            break;
          }
          commandOwner?.throwIfInactive();
          const result = await writeProjectServerDisabledOverride(earlyConfigPath, commandCtx.cwd, serverName, subcommand === "disable");
          if (result.changed) {
            commandCtx.ui?.notify(`${subcommand === "disable" ? "Disabled" : "Enabled"} server "${serverName}" in ${result.path}. Reloading Pi…`, "info");
            await commandReload();
            return;
          } else {
            commandCtx.ui?.notify(`Server "${serverName}" is already ${subcommand === "disable" ? "disabled" : "enabled"}`, "info");
          }
          break;
        }
        case "auto-connect":
        case "on-demand": {
          if (programmaticConfig) {
            commandCtx.ui?.notify(`/mcp ${subcommand} is unavailable when config is supplied by createMcpAdapter().`, "info");
            break;
          }
          if (!serverName) {
            commandCtx.ui?.notify(`Usage: /mcp ${subcommand} <server>`, "error");
            break;
          }
          if (!Object.hasOwn(state.config.mcpServers, serverName)) {
            commandCtx.ui?.notify(`Server "${serverName}" not found in effective config`, "error");
            break;
          }
          commandOwner?.throwIfInactive();
          const autoConnect = subcommand === "auto-connect";
          const result = await writeProjectServerLifecycleOverride(
            commandCtx.cwd,
            serverName,
            autoConnect ? "keep-alive" : "lazy",
          );
          if (result.changed) {
            commandCtx.ui?.notify(
              `${autoConnect ? "Automatic" : "On-demand"} connection saved for "${serverName}" in ${result.path}. Reloading Pi…`,
              "info",
            );
            await commandReload();
            return;
          }
          commandCtx.ui?.notify(
            `Server "${serverName}" already uses ${autoConnect ? "automatic" : "on-demand"} connection`,
            "info",
          );
          break;
        }
        case "status":
        case "":
        default:
          commandOwner?.throwIfInactive();
          if (programmaticConfig && commandCtx.hasUI) {
            commandCtx.ui?.notify("MCP status is shown from the in-memory SDK config; configuration discovery is unavailable.", "info");
          }
          await showStatus(state, commandCtx);
          break;
      }
			},
  });

  if (options.proxyOnly !== true && earlyConfig.settings?.scriptMode !== false) {
	    pi.registerTool({
      name: "mcp_script",
      label: "MCP Script",
      description: "Run trusted JavaScript that makes multiple MCP tool calls in one request — loop, filter, chain, or fan out between calls. For a single MCP call, search, describe, status check, or auth action, use the mcp tool instead. Discover with await tools.search({ query }) — resolves to { items: [{ path, name, server, description? }], total, hasMore, nextOffset }, not an { ok, data } envelope. Inspect with await tools.describe({ path }) — resolves to the tool descriptor with inputTypeScript, or { path, error: { code, message, suggestions } }. Then call tools.call(path, args) — resolves to { ok: true, data } or { ok: false, error: { code, message } } — or use direct flat calls when the name is already known; use emit(value) for user-visible output. Load the mcp-scripting skill for the full workflow guide.",
      promptSnippet: "Batch multiple MCP tool calls in one JavaScript request (loop, filter, chain)",
      parameters: Type.Object({
        code: Type.String({ description: "Trusted JavaScript MCP script. Use tools.<prefixedToolName>(args) and emit(value)." }),
        // Raw JSON schema: host TypeBox shims may omit Type.Number (see index-lifecycle shim test).
	        timeoutMs: Type.Optional({ type: "number", minimum: 1, description: "Execution timeout in milliseconds (default: 30000)" }),
      }),
      renderResult: renderMcpToolResult,
      async execute(_toolCallId, params: { code: string; timeoutMs?: number }, signal) {
        const executeOwner = currentOwner;
        if (!state && initPromise) {
          try {
            const initialized = await awaitWithTimeout(initPromise, INIT_WAIT_TIMEOUT_MS);
            if (initialized === INIT_WAIT_TIMED_OUT) {
              return {
                content: [{ type: "text" as const, text: "MCP initialization is still in progress. Try again shortly." }],
                details: { mode: "script", error: "init_timeout", timeoutMs: INIT_WAIT_TIMEOUT_MS },
              };
            }
            executeOwner?.throwIfInactive();
            state = initialized;
          } catch (error) {
            if (executeOwner && isAbortError(error, executeOwner.signal)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { mode: "script", error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: "MCP not initialized" }],
            details: { mode: "script", error: "not_initialized" },
          };
        }
        executeOwner?.throwIfInactive();
        return runMcpScript(state, params.code, params.timeoutMs, getPiTools, signal);
      },
    });
  }

  function registerProxyTool(description: string): void {
	    pi.registerTool({
      name: "mcp",
      label: "MCP",
      description,
      promptSnippet: "MCP gateway — status, search, describe, auth, and single MCP tool calls",
      renderCall: renderMcpProxyToolCall,
      parameters: Type.Object({
        tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        args: Type.Optional(Type.Union([
          Type.String({ description: "Arguments as a JSON string (e.g., '{\"key\": \"value\"}')" }),
          Type.Object({}, {
            additionalProperties: true,
            description: 'Arguments as a JSON object (e.g., { "key": "value" })',
          }),
        ], { description: "Tool arguments as a JSON object, or as a JSON string encoding one" })),
        connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
        instructions: Type.Optional(Type.String({ description: "Server name to show that server's usage instructions" })),
        search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
        includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        // Raw JSON schema: host TypeBox shims may omit Type.Number (see index-lifecycle shim test).
	        limit: Type.Optional({ type: "number", minimum: 1, description: "Maximum search results to return (default: 12)" }),
	        offset: Type.Optional({ type: "number", minimum: 0, description: "Search result offset (default: 0)" }),
        server: Type.Optional(Type.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type.Optional(Type.String({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" })),
      }),
      renderResult: renderMcpToolResult,
      async execute(_toolCallId, params: {
        tool?: string;
        args?: string | JsonInputObject;
        connect?: string;
        describe?: string;
        instructions?: string;
        search?: string;
        includeSchemas?: boolean;
        limit?: number;
        offset?: number;
        server?: string;
        action?: string;
      }, signal, _onUpdate, _ctx) {
        const executeOwner = currentOwner;
        let parsedArgs: JsonInputObject | undefined;
        if (params.args !== undefined && params.args !== "") {
	          if (isRuntimeString(params.args)) {
	            try {
	              parsedArgs = parseJsonObject(params.args);
	            } catch (error) {
              if (error instanceof SyntaxError) {
                throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
              }
              throw error;
            }
	          } else parsedArgs = params.args;
        }

        if (!state && initPromise) {
          try {
            const initialized = await awaitWithTimeout(initPromise, INIT_WAIT_TIMEOUT_MS);
            if (initialized === INIT_WAIT_TIMED_OUT) {
              return {
                content: [{ type: "text" as const, text: "MCP initialization is still in progress. Try again shortly." }],
                details: { error: "init_timeout", timeoutMs: INIT_WAIT_TIMEOUT_MS },
              };
            }
            executeOwner?.throwIfInactive();
            state = initialized;
          } catch (error) {
            if (executeOwner && isAbortError(error, executeOwner.signal)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: "MCP not initialized" }],
            details: { error: "not_initialized" },
          };
        }
        executeOwner?.throwIfInactive();

        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.action === "auth-start") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-start requires `server`. Example: mcp({ action: \"auth-start\", server: \"linear-server\" })" }],
              details: { mode: "auth-start", error: "missing_server" },
            };
          }
          return signal
            ? executeAuthStart(state, params.server, signal)
            : executeAuthStart(state, params.server);
        }
        if (params.action === "auth-complete") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" },
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (!isRuntimeString(input) || input.trim().length === 0) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" },
            };
          }
          return signal
            ? executeAuthComplete(state, params.server, input, signal)
            : executeAuthComplete(state, params.server, input);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools, signal);
        }
        if (params.connect) {
          const result = await executeConnect(state, params.connect, signal);
	          syncToolSurface(_ctx);
          return result;
        }
        if (params.describe) {
          return executeDescribe(state, params.describe);
        }
        if (params.instructions) {
          return executeInstructions(state, params.instructions);
        }
        if (params.search !== undefined) {
          return executeSearch(state, params.search, false, params.server, params.includeSchemas, params.limit, params.offset);
        }
        if (params.server) {
          return executeList(state, params.server);
        }
        return executeStatus(state);
      },
    });
    proxyToolRegistered = true;
    proxyToolDescription = description;
  }

  function syncProxyTool(config: McpConfig, cache: MetadataCache | null, directSpecs: DirectToolSpec[]): void {
    const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(
      config,
      cache,
      envRaw === undefined || envRaw === "__none__" ? undefined : envDirectToolOverride,
    );
    const shouldRegisterProxyTool =
      config.settings?.disableProxyTool !== true
      || directSpecs.length === 0
      || missingConfiguredDirectToolServers.length > 0;

    if (shouldRegisterProxyTool) {
      const description = buildProxyDescription();
      if (!proxyToolRegistered || proxyToolDescription !== description) {
        registerProxyTool(description);
        return;
      }
      const activeTools = pi.getActiveTools?.();
      if (activeTools && !activeTools.includes("mcp")) {
        pi.setActiveTools([...activeTools, "mcp"]);
      }
      return;
    }

    if (proxyToolRegistered) {
      const unregistered = deactivateTools(["mcp"]);
      if (unregistered.includes("mcp")) {
        proxyToolRegistered = false;
        proxyToolDescription = null;
      }
    }
  }

  const initialDirectTools = syncDirectTools(earlyConfig, earlyCache).specs;
  syncProxyTool(earlyConfig, earlyCache, initialDirectTools);
  startLoadTimeInitialization();
}

export function parseMcpCommand(args: string | undefined): ParsedMcpCommand {
  const match = args?.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/u);
	  const command: ParsedMcpCommand = {
	    subcommand: match?.[1] ?? "",
	  };
	  if (match?.[2]) command.serverName = match[2];
	  return command;
}

export function createMcpAdapter(options: McpAdapterOptions = {}) {
  const factoryConfig = options.config !== undefined ? cloneMcpConfig(options.config) : undefined;
	  return function mcpAdapter(pi: McpAdapterExtensionAPI) {
    installMcpAdapter(pi, {
      configPath: options.configPath,
      config: factoryConfig !== undefined ? cloneMcpConfig(factoryConfig) : undefined,
      deferStartupConnections: options.deferStartupConnections,
      interactiveUi: options.interactiveUi,
      interactiveProtocolRequests: options.interactiveProtocolRequests,
      proxyOnly: options.proxyOnly,
    });
  };
}

export default createMcpAdapter();
