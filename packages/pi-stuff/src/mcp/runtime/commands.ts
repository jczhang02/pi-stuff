import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
import {
	clearFailure,
	getFailureAgeSeconds,
	getFailureMessage,
	markKeepAliveAfterConnect,
	notifyToolMetadataUpdated,
	recordFailure,
	updateMetadataCache,
	updateStatusBar,
} from "./init.ts";
import { getAuthStorageOptions } from "./mcp-auth.ts";
import { authenticate, type McpOAuthRuntime, removeAuth, supportsOAuth } from "./mcp-auth-flow.ts";
import { loadOnboardingState, markSetupCompleted as persistSetupCompleted } from "./onboarding-state.ts";
import { isAbortError } from "./runtime-owner.ts";
import type { McpExtensionState } from "./state.ts";
import { buildToolMetadata } from "./tool-metadata.ts";
import { type ImportKind, isServerDisabled, type McpAuthResult, type McpConfig } from "./types.ts";
import { openPath, resolveServerUrl, sanitizeTerminalText } from "./utils.ts";

export type McpCommandContext = Pick<ExtensionContext, "cwd" | "hasUI" | "signal"> & {
	ui: ExtensionContext["ui"] | undefined;
};

export async function showStatus(state: McpExtensionState, ctx: McpCommandContext): Promise<void> {
	const ui = ctx.ui;
	if (!ctx.hasUI || !ui) return;

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

	ui.notify(lines.join("\n"), "info");
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
		const { metadata, failedTools } = buildToolMetadata(
			connection.tools,
			connection.resources,
			definition,
			name,
			prefix,
		);
		state.toolMetadata.set(name, metadata);
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
				"info",
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
	targetServer?: string,
): Promise<boolean> {
	if (targetServer && !state.config.mcpServers[targetServer]) {
		if (ctx.hasUI) ctx.ui?.notify(`Server "${targetServer}" not found in config`, "error");
		return false;
	}

	const names = targetServer ? [targetServer] : Object.keys(state.config.mcpServers);
	let succeeded = true;
	for (const name of names) {
		succeeded = (await reconnectServer(state, ctx, name)) && succeeded;
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
			"error",
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
		const authOptions: NonNullable<Parameters<typeof authenticate>[3]> = {
			onAuthorizationUrl: (authorizationUrl) => {
				ui.notify(
					`Open this URL to authenticate ${serverName}:\n\n${authorizationUrl}\n\n` +
						"After approving, return to Pi; the local callback will complete automatically.",
					"info",
				);
			},
		};
		if (signal !== undefined) authOptions.signal = signal;
		if (runtime !== undefined) authOptions.runtime = runtime;
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
	ctx: McpCommandContext,
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
		await removeAuth(serverName, {
			authStorageOptions: state.authStorageOptions,
			signal,
			runtime: state.oauthRuntime,
		});
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
	const ui = ctx.ui;
	if (!ctx.hasUI || !ui) return { configChanged: false };
	if (state.programmaticConfig) {
		ui.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
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
		previewKnownServer: (preset: KnownServerPreset) =>
			previewSharedServerEntry(getProjectConfigPath(ctx.cwd), preset.id, preset.entry),
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
		ui.custom((tui, theme, keybindings, done) => {
			return createMcpSetupPanel(discovery, callbacks, { mode, onboardingState, keybindings }, tui, theme, () => {
				done(undefined);
				resolve({ configChanged });
			});
		});
	});
}
