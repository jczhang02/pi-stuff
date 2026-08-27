import type { AgentToolResult, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { type JsonInputObject, requireJsonInputValue } from "../../shared/json-value.js";
import { abortable, throwIfAborted } from "./abort.ts";
import {
	clearFailure,
	getFailureAgeSeconds,
	lazyConnect,
	markKeepAliveAfterConnect,
	notifyToolMetadataUpdated,
	recordFailure,
	updateMetadataCache,
	updateServerMetadata,
	updateStatusBar,
} from "./init.ts";
import { guardedMcpDetails, guardMcpOutput, resolveMcpOutputGuardOptions } from "./mcp-output-guard.ts";
import {
	type AutoAuthResult,
	attemptAutoAuth,
	disabledResult,
	getAuthRequiredMessage,
	missingServerResult,
	proxyTextResult,
} from "./proxy-modes.ts";
import { combineAbortSignals, isAbortError } from "./runtime-owner.ts";
import { rankSuggestions } from "./search-ranking.ts";
import type { ServerConnection } from "./server-manager.ts";
import { SessionRecoveryAuthRequiredError, type SessionRecoveryDeps, withSessionRecovery } from "./session-recovery.ts";
import type { McpExtensionState } from "./state.ts";
import { ensureToolCallApproved } from "./tool-approval.ts";
import { findToolByName, formatSchema, getToolNames } from "./tool-metadata.ts";
import {
	isImmediateCallToolResult,
	type McpCallToolResponse,
	resolveMcpResultContent,
	transformMcpContent,
} from "./tool-registrar.ts";
import { getServerPrefix, isServerDisabled, type ToolMetadata, type ToolPrefix } from "./types.ts";
import { formatMcpStatus } from "./utils.ts";

type ProxyToolResult = AgentToolResult<JsonInputObject>;
type GuardOptions = ReturnType<typeof resolveMcpOutputGuardOptions>;

function textResult(text: string, details: JsonInputObject): ProxyToolResult {
	return proxyTextResult("call", text, details);
}

function authRequiredResult(message: string, details: JsonInputObject): ProxyToolResult {
	return textResult(message, { error: "auth_required", ...details, message });
}

class McpCall {
	private readonly state: McpExtensionState;
	private readonly toolName: string;
	private readonly args: JsonInputObject | undefined;
	private readonly serverOverride: string | undefined;
	private readonly getPiTools: (() => ToolInfo[]) | undefined;
	private readonly ownedSignal: AbortSignal | undefined;
	private readonly prefixMode: ToolPrefix;
	private serverName: string | undefined;
	private toolMeta: ToolMetadata | undefined;
	private callIdentity: JsonInputObject | undefined;
	private prefixMatchedServer: string | undefined;
	private autoAuthAttempted = false;

	constructor(
		state: McpExtensionState,
		toolName: string,
		args: JsonInputObject | undefined,
		serverOverride: string | undefined,
		getPiTools: (() => ToolInfo[]) | undefined,
		signal: AbortSignal | undefined,
	) {
		this.state = state;
		this.toolName = toolName;
		this.args = args;
		this.serverOverride = serverOverride;
		this.getPiTools = getPiTools;
		this.ownedSignal = combineAbortSignals(state.owner?.signal, signal);
		throwIfAborted(this.ownedSignal);
		this.serverName = serverOverride;
		this.prefixMode = state.config.settings?.toolPrefix ?? "server";
	}

	async run(): Promise<ProxyToolResult> {
		const resolutionError = await this.resolveTarget();
		if (resolutionError) return resolutionError;
		if (!this.serverName || !this.toolMeta) throw new Error("MCP call target was not resolved");
		const { serverName, toolMeta } = this;
		this.callIdentity = toolMeta.resourceUri
			? { server: serverName, resourceUri: toolMeta.resourceUri }
			: { server: serverName, tool: toolMeta.originalName };

		const connectionError = await this.ensureConnection();
		if (connectionError) return connectionError;
		const approvalError = await this.ensureApproval();
		return approvalError ?? this.executeRequest();
	}

	private target() {
		if (!this.serverName || !this.toolMeta || !this.callIdentity) {
			throw new Error("MCP call target was not resolved");
		}
		return { serverName: this.serverName, toolMeta: this.toolMeta, callIdentity: this.callIdentity };
	}

	private disabledResult(serverName: string, metadata?: ToolMetadata): ProxyToolResult {
		return disabledResult(
			"call",
			serverName,
			metadata
				? metadata.resourceUri
					? { resourceUri: metadata.resourceUri }
					: { tool: metadata.originalName }
				: { requestedTool: this.toolName },
		);
	}

	private async resolveTarget(): Promise<ProxyToolResult | undefined> {
		const cachedError = this.resolveCachedTarget();
		if (cachedError) return cachedError;
		const explicitError = await this.resolveExplicitTarget();
		if (explicitError) return explicitError;
		const prefixError = await this.resolvePrefixedTarget();
		if (prefixError) return prefixError;
		if (!this.serverName || !this.toolMeta) return this.unresolvedTargetResult();
	}

	private resolveCachedTarget(): ProxyToolResult | undefined {
		if (this.serverName && !this.state.config.mcpServers[this.serverName]) {
			return missingServerResult("call", this.serverName, {
				error: "server_not_found",
				requestedTool: this.toolName,
			});
		}
		if (this.serverName) {
			this.toolMeta = findToolByName(this.state.toolMetadata.get(this.serverName), this.toolName);
			if (isServerDisabled(this.state.config.mcpServers[this.serverName])) {
				return this.disabledResult(this.serverName, this.toolMeta);
			}
			return;
		}

		let disabledMatch: { serverName: string; toolMeta: ToolMetadata } | undefined;
		for (const [serverName, metadata] of this.state.toolMetadata) {
			const toolMeta = findToolByName(metadata, this.toolName);
			if (!toolMeta) continue;
			if (isServerDisabled(this.state.config.mcpServers[serverName])) {
				disabledMatch ??= { serverName, toolMeta };
				continue;
			}
			this.serverName = serverName;
			this.toolMeta = toolMeta;
			return;
		}
		if (disabledMatch) return this.disabledResult(disabledMatch.serverName, disabledMatch.toolMeta);
	}

	private async resolveExplicitTarget(): Promise<ProxyToolResult | undefined> {
		const serverName = this.serverName;
		if (!serverName || this.toolMeta) return;
		const connected = await lazyConnect(this.state, serverName, this.ownedSignal);
		if (connected) {
			this.toolMeta = findToolByName(this.state.toolMetadata.get(serverName), this.toolName);
			return;
		}

		if (this.state.manager.getConnection(serverName)?.status === "needs-auth") {
			const autoAuth = await this.tryAutoAuth(serverName);
			if (autoAuth?.status === "failed") {
				return authRequiredResult(autoAuth.message, { server: serverName, requestedTool: this.toolName });
			}
			if (autoAuth?.status === "success") {
				await this.state.manager.close(serverName);
				clearFailure(this.state, serverName);
				if (await lazyConnect(this.state, serverName, this.ownedSignal)) {
					this.toolMeta = findToolByName(this.state.toolMetadata.get(serverName), this.toolName);
					if (!this.toolMeta) return this.afterReconnectResult(serverName);
				}
			}
			if (!this.toolMeta && this.state.manager.getConnection(serverName)?.status === "needs-auth") {
				return authRequiredResult(getAuthRequiredMessage(this.state, serverName), {
					server: serverName,
					requestedTool: this.toolName,
				});
			}
		}
		return this.toolMeta
			? undefined
			: this.backoffResult(serverName, { server: serverName, requestedTool: this.toolName });
	}

	private async resolvePrefixedTarget(): Promise<ProxyToolResult | undefined> {
		if (this.serverName || this.toolMeta || this.prefixMode === "none") return;
		const candidates = Object.keys(this.state.config.mcpServers)
			.filter((name) => !isServerDisabled(this.state.config.mcpServers[name]))
			.map((name) => ({ name, prefix: getServerPrefix(name, this.prefixMode) }))
			.filter(({ prefix }) => prefix && this.toolName.startsWith(`${prefix}_`))
			.sort((left, right) => right.prefix.length - left.prefix.length);

		for (const { name: serverName } of candidates) {
			const connection = this.state.manager.getConnection(serverName);
			if (getFailureAgeSeconds(this.state, serverName) !== null && connection?.status !== "needs-auth") continue;

			let connected = await lazyConnect(this.state, serverName, this.ownedSignal);
			if (!connected && this.state.manager.getConnection(serverName)?.status === "needs-auth") {
				const autoAuth = await this.tryAutoAuth(serverName);
				if (autoAuth?.status === "failed") {
					return authRequiredResult(autoAuth.message, { server: serverName, requestedTool: this.toolName });
				}
				if (autoAuth?.status === "success") {
					await this.state.manager.close(serverName);
					clearFailure(this.state, serverName);
					connected = await lazyConnect(this.state, serverName, this.ownedSignal);
				}
			}
			if (!connected) continue;
			this.prefixMatchedServer ??= serverName;
			this.toolMeta = findToolByName(this.state.toolMetadata.get(serverName), this.toolName);
			if (this.toolMeta) {
				this.serverName = serverName;
				return;
			}
		}
	}

	private unresolvedTargetResult(): ProxyToolResult {
		const nativeTool = !this.serverOverride
			? this.getPiTools?.().find((tool) => tool.name === this.toolName && tool.name !== "mcp")
			: undefined;
		if (nativeTool) {
			return textResult(
				`"${this.toolName}" is a native Pi tool. Call ${this.toolName} directly instead of using mcp({ tool: "${this.toolName}" }).`,
				{ error: "native_tool", requestedTool: this.toolName },
			);
		}

		const hintServer = this.serverName ?? this.prefixMatchedServer;
		const available = hintServer ? getToolNames(this.state, hintServer) : [];
		let message = `Tool "${this.toolName}" not found.`;
		message +=
			available.length > 0
				? ` Server "${hintServer}" has: ${available.join(", ")}`
				: ` Use mcp({ search: "..." }) to search.`;
		const suggestions = rankSuggestions(this.state, this.toolName, 5);
		if (suggestions.length > 0) message += ` Did you mean: ${suggestions.join(", ")}`;
		return textResult(message, {
			error: "tool_not_found",
			requestedTool: this.toolName,
			hintServer,
			suggestions,
		});
	}

	private tryAutoAuth(serverName: string): Promise<AutoAuthResult | undefined> {
		if (this.autoAuthAttempted) return Promise.resolve(undefined);
		this.autoAuthAttempted = true;
		return attemptAutoAuth(this.state, serverName, this.ownedSignal);
	}

	private backoffResult(serverName: string, details: JsonInputObject): ProxyToolResult | undefined {
		const failedAgo = getFailureAgeSeconds(this.state, serverName);
		if (failedAgo === null) return;
		return textResult(`Server "${serverName}" not available (last failed ${failedAgo}s ago)`, {
			error: "server_backoff",
			...details,
		});
	}

	private afterReconnectResult(serverName: string, hint?: string): ProxyToolResult {
		const suggestions = rankSuggestions(this.state, this.toolName, 5);
		const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : "";
		return textResult(
			`Tool "${this.toolName}" not found on "${serverName}" after reconnect.${hint ? ` ${hint}` : ""}${suggestionText}`,
			{
				error: "tool_not_found_after_reconnect",
				server: serverName,
				requestedTool: this.toolName,
				suggestions,
			},
		);
	}

	private async ensureConnection(): Promise<ProxyToolResult | undefined> {
		const { callIdentity, serverName } = this.target();
		let connection = this.state.manager.getConnection(serverName);
		if (connection?.status === "needs-auth") {
			const autoAuth = await this.tryAutoAuth(serverName);
			if (autoAuth?.status === "failed") return authRequiredResult(autoAuth.message, callIdentity);
			if (autoAuth?.status === "success") {
				await this.state.manager.close(serverName);
				clearFailure(this.state, serverName);
				connection = this.state.manager.getConnection(serverName);
			}
			if (connection?.status === "needs-auth") {
				return authRequiredResult(getAuthRequiredMessage(this.state, serverName), callIdentity);
			}
		}
		if (connection?.status === "connected") return;
		const backoff = this.backoffResult(serverName, callIdentity);
		if (backoff) return backoff;

		const definition = this.state.config.mcpServers[serverName];
		if (!definition) {
			return textResult(`Server "${serverName}" not connected`, {
				error: "server_not_connected",
				...callIdentity,
			});
		}

		try {
			if (this.state.ui) {
				this.state.ui.setStatus("mcp", formatMcpStatus(this.state.config, `connecting to ${serverName}...`));
			}
			connection = await this.state.manager.connect(serverName, definition, this.ownedSignal);
			if (connection.status === "needs-auth") {
				const autoAuth = await this.tryAutoAuth(serverName);
				if (autoAuth?.status === "failed") return authRequiredResult(autoAuth.message, callIdentity);
				if (autoAuth?.status === "success") {
					await this.state.manager.close(serverName);
					connection = await this.state.manager.connect(serverName, definition, this.ownedSignal);
				}
				if (connection.status === "needs-auth") {
					return authRequiredResult(getAuthRequiredMessage(this.state, serverName), callIdentity);
				}
			}
			clearFailure(this.state, serverName);
			updateServerMetadata(this.state, serverName);
			updateMetadataCache(this.state, serverName);
			notifyToolMetadataUpdated(this.state, serverName, "proxy-call-reconnect");
			markKeepAliveAfterConnect(this.state, serverName);
			updateStatusBar(this.state);
			this.toolMeta = findToolByName(this.state.toolMetadata.get(serverName), this.toolName);
			if (!this.toolMeta) {
				const available = getToolNames(this.state, serverName);
				const hint =
					available.length > 0
						? `Available tools on "${serverName}": ${available.join(", ")}`
						: `Server "${serverName}" has no tools.`;
				return this.afterReconnectResult(serverName, hint);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!isAbortError(error, this.ownedSignal)) recordFailure(this.state, serverName, message);
			updateStatusBar(this.state);
			return textResult(`Failed to connect to "${serverName}": ${message}`, {
				error: isAbortError(error, this.ownedSignal) ? "aborted" : "connect_failed",
				...callIdentity,
				message,
			});
		}
	}

	private async ensureApproval(): Promise<ProxyToolResult | undefined> {
		const { serverName, toolMeta } = this.target();
		if (isServerDisabled(this.state.config.mcpServers[serverName])) {
			return this.disabledResult(serverName, toolMeta);
		}
		const approval = await ensureToolCallApproved(this.state, serverName, toolMeta, this.args, this.ownedSignal);
		if (approval.ok) return;
		const denied = approval.reason === "denied";
		const message = denied
			? `The user declined approval to run MCP tool "${toolMeta.originalName}" on server "${serverName}".`
			: `MCP tool "${toolMeta.originalName}" on server "${serverName}" is approval-gated and requires an interactive session.`;
		return textResult(message, {
			error: denied ? "approval_denied" : "approval_required",
			server: serverName,
			tool: toolMeta.originalName,
		});
	}

	private async recoverAuthConnection(): Promise<ServerConnection | undefined> {
		const { serverName } = this.target();
		const current = this.state.manager.getConnection(serverName);
		if (current?.status === "connected") return current;
		const autoAuth = await this.tryAutoAuth(serverName);
		if (autoAuth?.status === "failed") {
			throw new SessionRecoveryAuthRequiredError(serverName, autoAuth.message);
		}
		if (autoAuth?.status !== "success") return this.state.manager.getConnection(serverName);

		const definition = this.state.config.mcpServers[serverName];
		if (!definition) return;
		const afterAuth = this.state.manager.getConnection(serverName);
		if (afterAuth?.status === "connected") return afterAuth;
		if (afterAuth?.status === "needs-auth") await this.state.manager.close(serverName);
		clearFailure(this.state, serverName);
		return this.state.manager.connect(serverName, definition, this.ownedSignal);
	}

	private async executeRequest(): Promise<ProxyToolResult> {
		const { serverName, toolMeta } = this.target();
		const requestOptions =
			this.state.manager.getRequestOptions?.(serverName, this.ownedSignal) ??
			(this.ownedSignal ? { signal: this.ownedSignal } : undefined);
		const outputGuardOptions = resolveMcpOutputGuardOptions(this.state.config.settings);
		const recoveryDeps: SessionRecoveryDeps = {
			manager: this.state.manager,
			config: this.state.config,
			onNeedsAuth: () => this.recoverAuthConnection(),
		};
		if (this.ownedSignal) recoveryDeps.signal = this.ownedSignal;

		try {
			this.state.manager.touch(serverName);
			this.state.manager.incrementInFlight(serverName);
			return toolMeta.resourceUri
				? await this.readResource(toolMeta.resourceUri, recoveryDeps, requestOptions, outputGuardOptions)
				: await this.callTool(recoveryDeps, requestOptions, outputGuardOptions);
		} catch (error) {
			const aborted = isAbortError(error, this.ownedSignal);
			const failure = error instanceof Error ? error : new Error(String(error));
			return await this.failure(failure, aborted, outputGuardOptions);
		} finally {
			this.state.manager.decrementInFlight(serverName);
			this.state.manager.touch(serverName);
		}
	}

	private async readResource(
		resourceUri: string,
		recoveryDeps: SessionRecoveryDeps,
		requestOptions: RequestOptions | undefined,
		outputGuardOptions: GuardOptions,
	): Promise<ProxyToolResult> {
		const { callIdentity, serverName } = this.target();
		const result = await withSessionRecovery<ReadResourceResult>(recoveryDeps, serverName, (connection) =>
			connection.client.readResource({ uri: resourceUri }, requestOptions),
		);
		const content = (result.contents ?? []).map((item) => ({
			type: "text" as const,
			text:
				"text" in item
					? item.text
					: "blob" in item
						? `[Binary data: ${item.mimeType ?? "unknown"}]`
						: JSON.stringify(item),
		}));
		const guarded = await guardMcpOutput(
			content.length > 0 ? content : [{ type: "text", text: "(empty resource)" }],
			outputGuardOptions,
		);
		return {
			content: guarded.content,
			details: { mode: "call", ...callIdentity, ...guardedMcpDetails(guarded) },
		};
	}

	private async callTool(
		recoveryDeps: SessionRecoveryDeps,
		requestOptions: RequestOptions | undefined,
		outputGuardOptions: GuardOptions,
	): Promise<ProxyToolResult> {
		const { callIdentity, serverName, toolMeta } = this.target();
		const result = await withSessionRecovery<McpCallToolResponse>(recoveryDeps, serverName, (connection) =>
			abortable(
				connection.client.callTool(
					{ name: toolMeta.originalName, arguments: this.args ?? {} },
					undefined,
					requestOptions,
				),
				this.ownedSignal,
			),
		);
		if (!isImmediateCallToolResult(result)) {
			throw new Error("MCP task-based tool results are not supported by the proxy tool");
		}
		const rawMcpResult = requireJsonInputValue(result, "MCP tool result");
		if (result.isError) {
			const content = transformMcpContent(result.content);
			const schemaText = toolMeta.inputSchema
				? `\n\nExpected parameters:\n${formatSchema(toolMeta.inputSchema)}`
				: "";
			const guarded = await guardMcpOutput(
				content.length > 0 ? content : [{ type: "text", text: "(empty result)" }],
				{
					...outputGuardOptions,
					prefix: "Error: ",
					suffix: schemaText,
					emptyTextFallback: "Tool execution failed",
					rawMcpResult,
				},
			);
			return {
				content: guarded.content,
				details: { mode: "call", error: "tool_error", ...callIdentity, ...guardedMcpDetails(guarded) },
			};
		}

		const content = resolveMcpResultContent(result);
		const guarded = await guardMcpOutput(content.length > 0 ? content : [{ type: "text", text: "(empty result)" }], {
			...outputGuardOptions,
			rawMcpResult,
		});
		return {
			content: guarded.content,
			details: { mode: "call", ...guardedMcpDetails(guarded), ...callIdentity },
		};
	}

	private async failure(error: Error, aborted: boolean, guardOptions: GuardOptions): Promise<ProxyToolResult> {
		const { callIdentity, serverName, toolMeta } = this.target();
		if (error instanceof SessionRecoveryAuthRequiredError) {
			const message = error.authMessage ?? getAuthRequiredMessage(this.state, serverName);
			return authRequiredResult(message, { ...callIdentity, autoAuthAttempted: this.autoAuthAttempted });
		}
		const schemaText = toolMeta.inputSchema ? `\n\nExpected parameters:\n${formatSchema(toolMeta.inputSchema)}` : "";
		const guarded = await guardMcpOutput([{ type: "text", text: error.message }], {
			...guardOptions,
			prefix: "Failed to call tool: ",
			suffix: schemaText,
		});
		return {
			content: guarded.content,
			details: {
				mode: "call",
				error: aborted ? "aborted" : "call_failed",
				...callIdentity,
				message: guarded.outputGuard ? "output truncated; see outputGuard.fullOutputPath" : error.message,
				...guardedMcpDetails(guarded),
			},
		};
	}
}

export function executeCall(
	state: McpExtensionState,
	toolName: string,
	args?: JsonInputObject,
	serverOverride?: string,
	getPiTools?: () => ToolInfo[],
	signal?: AbortSignal,
): Promise<ProxyToolResult> {
	return new McpCall(state, toolName, args, serverOverride, getPiTools, signal).run();
}
