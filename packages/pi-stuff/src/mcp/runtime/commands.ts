import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Cause, Effect, Exit } from "effect";
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
import { mcpNativePromise, runMcpEffect } from "./mcp-effect-runner.ts";
import { loadOnboardingState, markSetupCompleted as persistSetupCompleted } from "./onboarding-state.ts";
import { isAbortError } from "./runtime-owner.ts";
import type { McpExtensionState } from "./state.ts";
import { buildToolMetadata } from "./tool-metadata.ts";
import { type ImportKind, isServerDisabled, type McpAuthResult, type McpConfig } from "./types.ts";
import { openPath, resolveServerUrl, sanitizeTerminalText } from "./utils.ts";

export type McpCommandContext = Pick<ExtensionContext, "cwd" | "hasUI" | "signal"> & {
	ui: ExtensionContext["ui"] | undefined;
};

export function showStatus(state: McpExtensionState, ctx: McpCommandContext): void {
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

export function reconnectServer(
	state: McpExtensionState,
	ctx: McpCommandContext,
	name: string,
): Effect.Effect<boolean, Error> {
	return Effect.gen(function* () {
		const definition = state.config.mcpServers[name];
		const ui = ctx.hasUI ? ctx.ui : undefined;
		const signal = state.owner?.signal;
		if (!definition) {
			ui?.notify(`Server "${name}" not found in config`, "error");
			return false;
		}
		if (isServerDisabled(definition)) {
			ui?.notify(`MCP: ${name} is disabled. Run /mcp enable ${name}, then /reload.`, "warning");
			return false;
		}

		yield* state.manager.closeEffect(name);
		state.owner?.throwIfInactive();
		const connection = yield* state.manager.connectEffect(name, definition, signal);
		state.owner?.throwIfInactive();
		if (connection.status === "needs-auth") {
			ui?.notify(`MCP: ${name} requires OAuth. Run /mcp auth ${name} first.`, "warning");
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
		if (connection.instructions) state.serverInstructions.set(name, connection.instructions);
		else state.serverInstructions.delete(name);
		updateMetadataCache(state, name);
		notifyToolMetadataUpdated(state, name, "command-reconnect");
		markKeepAliveAfterConnect(state, name);
		clearFailure(state, name);

		if (ui) {
			ui.notify(
				`MCP: Reconnected to ${name} (${connection.tools.length} tools, ${connection.resources.length} resources)`,
				"info",
			);
			if (failedTools.length > 0) ui.notify(`MCP: ${name} - ${failedTools.length} tools skipped`, "warning");
		}
		updateStatusBar(state);
		return true;
	}).pipe(
		Effect.catch((error) => {
			const signal = state.owner?.signal;
			if (isAbortError(error, signal)) return Effect.fail(error);
			return Effect.sync(() => {
				const message = error instanceof Error ? error.message : String(error);
				recordFailure(state, name, message);
				if (ctx.hasUI) {
					ctx.ui?.notify(`MCP: Failed to reconnect to ${name}: ${sanitizeTerminalText(message)}`, "error");
				}
				updateStatusBar(state);
				return false;
			});
		}),
	);
}

export function reconnectServers(
	state: McpExtensionState,
	ctx: McpCommandContext,
	targetServer?: string,
): Effect.Effect<boolean, Error> {
	return Effect.gen(function* () {
		if (targetServer && !state.config.mcpServers[targetServer]) {
			if (ctx.hasUI) ctx.ui?.notify(`Server "${targetServer}" not found in config`, "error");
			return false;
		}

		const names = targetServer ? [targetServer] : Object.keys(state.config.mcpServers);
		let succeeded = true;
		for (const name of names) succeeded = (yield* reconnectServer(state, ctx, name)) && succeeded;

		updateStatusBar(state);
		return succeeded;
	});
}

export function authenticateServer(
	serverName: string,
	config: McpConfig,
	ctx: McpCommandContext,
	signal?: AbortSignal,
	runtime?: McpOAuthRuntime,
): Effect.Effect<McpAuthResult, Error> {
	const ui = ctx.hasUI ? ctx.ui : undefined;
	const cwd = ctx.cwd;
	const ownedSignal = signal ?? ctx.signal;
	return Effect.gen(function* () {
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

		const serverUrl = resolveServerUrl(definition);
		if (!serverUrl) {
			const message = `Server "${serverName}" has no URL configured (OAuth requires HTTP transport)`;
			ui.notify(message, "error");
			return { ok: false, message };
		}

		ui.setStatus("mcp-oauth", `Authenticating ${serverName}...`);
		const authStorageOptions = getAuthStorageOptions(config.settings?.oauthDir, cwd);
		const status = yield* mcpNativePromise((effectSignal) => {
			const authOptions: NonNullable<Parameters<typeof authenticate>[3]> = {
				onAuthorizationUrl: (authorizationUrl) => {
					ui.notify(
						`Open this URL to authenticate ${serverName}:\n\n${authorizationUrl}\n\n` +
							"After approving, return to Pi; the local callback will complete automatically.",
						"info",
					);
				},
				signal: effectSignal,
			};
			if (runtime !== undefined) authOptions.runtime = runtime;
			if (authStorageOptions.baseDir) authOptions.authStorageOptions = authStorageOptions;
			return authenticate(serverName, serverUrl, definition, authOptions);
		}, ownedSignal);

		if (status === "authenticated") {
			const message = `OAuth authentication successful for "${serverName}".`;
			ui.notify(message, "info");
			return { ok: true, message };
		}
		const message = `OAuth authentication failed for "${serverName}".`;
		ui.notify(message, "error");
		return { ok: false, message };
	}).pipe(
		Effect.catch((error) => {
			if (ownedSignal?.aborted) return Effect.fail(error);
			return Effect.sync(() => {
				const message = error instanceof Error ? error.message : String(error);
				ui?.notify(`Failed to authenticate "${serverName}": ${message}`, "error");
				return { ok: false, message };
			});
		}),
		Effect.ensuring(Effect.sync(() => (!ownedSignal?.aborted ? ui?.setStatus("mcp-oauth", undefined) : undefined))),
	);
}

export function logoutServer(
	serverName: string,
	state: McpExtensionState,
	ctx: McpCommandContext,
): Effect.Effect<{ ok: boolean; message: string }, Error> {
	return Effect.gen(function* () {
		const definition = state.config.mcpServers[serverName];
		const ui = ctx.hasUI ? ctx.ui : undefined;
		if (!definition) {
			const message = `Server "${serverName}" not found in config`;
			ui?.notify(message, "error");
			return { ok: false, message };
		}

		const signal = state.owner?.signal;
		const removed = yield* Effect.exit(
			mcpNativePromise(
				(effectSignal) =>
					removeAuth(serverName, {
						authStorageOptions: state.authStorageOptions,
						signal: effectSignal,
						runtime: state.oauthRuntime,
					}),
				signal,
			),
		);
		if (Exit.isFailure(removed)) {
			const error = Cause.squash(removed.cause);
			if (isAbortError(error, signal)) {
				return yield* Effect.fail(error instanceof Error ? error : new Error(String(error)));
			}
			const message = error instanceof Error ? error.message : String(error);
			ui?.notify(`Failed to clear OAuth credentials for "${serverName}": ${sanitizeTerminalText(message)}`, "error");
			return { ok: false, message };
		}

		state.owner?.throwIfInactive();
		const closed = yield* Effect.exit(state.manager.closeEffect(serverName));
		if (Exit.isFailure(closed)) {
			const error = Cause.squash(closed.cause);
			if (isAbortError(error, signal)) {
				return yield* Effect.fail(error instanceof Error ? error : new Error(String(error)));
			}
			const message = error instanceof Error ? error.message : String(error);
			ui?.notify(
				`OAuth credentials were cleared for "${serverName}", but its connection could not be closed: ${sanitizeTerminalText(message)}`,
				"error",
			);
			return { ok: false, message };
		}

		state.owner?.throwIfInactive();
		updateStatusBar(state);
		const message = `OAuth credentials cleared for "${serverName}". Run /mcp auth ${serverName} to authenticate again.`;
		ui?.notify(message, "info");
		return { ok: true, message };
	});
}

export interface PanelFlowResult {
	configChanged: boolean;
}

export function openMcpSetup(
	state: McpExtensionState,
	pi: ExtensionAPI,
	ctx: McpCommandContext,
	configOverridePath?: string,
	mode: "empty" | "setup" = "setup",
): Effect.Effect<PanelFlowResult, Error> {
	return Effect.gen(function* () {
		const ui = ctx.ui;
		if (!ctx.hasUI || !ui) return { configChanged: false };
		if (state.programmaticConfig) {
			ui.notify("MCP setup is unavailable when config is supplied by createMcpAdapter().", "info");
			return { configChanged: false };
		}

		const load = <Value>(read: () => Value) =>
			Effect.try({ try: read, catch: (error) => (error instanceof Error ? error : new Error(String(error))) });
		const discovery = yield* load(() => getMcpDiscoverySummary(configOverridePath, ctx.cwd));
		const onboardingState = yield* load(loadOnboardingState);
		const { createMcpSetupPanel } = yield* mcpNativePromise(() => import("./mcp-setup-panel.ts"), state.owner.signal);
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
			adoptImports: (imports: ImportKind[]) =>
				runMcpEffect(
					Effect.tap(ensureCompatibilityImports(imports, configOverridePath), (result) =>
						Effect.sync(() => {
							if (result.added.length > 0) configChanged = true;
						}),
					),
					state.owner.signal,
				),
			scaffoldProjectConfig: () =>
				runMcpEffect(
					Effect.map(writeStarterProjectConfig(ctx.cwd), (path) => {
						configChanged = true;
						return { path };
					}),
					state.owner.signal,
				),
			addRepoPrompt: () => {
				const repoPrompt = getMcpDiscoverySummary(configOverridePath, ctx.cwd).repoPrompt;
				if (!repoPrompt.entry || !repoPrompt.targetPath || !repoPrompt.serverName) {
					return runMcpEffect(
						Effect.fail(new Error("RepoPrompt is not available to add from this setup screen.")),
						state.owner.signal,
					);
				}
				const { entry, serverName, targetPath } = repoPrompt;
				return runMcpEffect(
					Effect.map(writeSharedServerEntry(targetPath, serverName, entry), (path) => {
						configChanged = true;
						return { path, serverName };
					}),
					state.owner.signal,
				);
			},
			addKnownServer: (preset: KnownServerPreset) =>
				runMcpEffect(
					Effect.map(writeSharedServerEntry(getProjectConfigPath(ctx.cwd), preset.id, preset.entry), (path) => {
						configChanged = true;
						return { path, serverName: preset.name };
					}),
					state.owner.signal,
				),
			openPath: (targetPath: string) =>
				runMcpEffect(
					mcpNativePromise(() => openPath(pi, targetPath), state.owner.signal),
					state.owner.signal,
				),
			markSetupCompleted: () =>
				runMcpEffect(
					load(() => {
						persistSetupCompleted();
					}),
					state.owner.signal,
				),
		};

		yield* mcpNativePromise(
			() =>
				ui.custom((tui, theme, keybindings, done) =>
					createMcpSetupPanel(discovery, callbacks, { mode, onboardingState, keybindings }, tui, theme, () =>
						done(undefined),
					),
				),
			state.owner.signal,
		);
		return { configChanged };
	});
}
