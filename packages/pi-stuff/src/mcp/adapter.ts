import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";
import { registerSuiteOwnedTool } from "../tool-display/index.js";
import { createMcpStatusView } from "./mcp-dialog.js";
import { MCP_PRESENTATION } from "./presentation.js";
import { createMcpAdapter, MCP_STATUS_EVENT } from "./runtime/index.js";
import { logger } from "./runtime/logger.js";
import { McpStatusStore } from "./status-store.js";

type CapturedTool = ToolDefinition<TSchema, unknown, unknown>;
type CommandSpec = Parameters<ExtensionAPI["registerCommand"]>[1];
type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

interface CapturedCommands {
	mcp?: CommandSpec;
	mcpAuth?: CommandSpec;
}

const MCP_PARAMETERS = Type.Object({
	tool: Type.Optional(Type.String({ maxLength: 256, minLength: 1 })),
	args: Type.Optional(
		Type.Union([Type.String({ maxLength: 64 * 1_024 }), Type.Object({}, { additionalProperties: true })]),
	),
	connect: Type.Optional(Type.String({ maxLength: 200, minLength: 1 })),
	describe: Type.Optional(Type.String({ maxLength: 256, minLength: 1 })),
	search: Type.Optional(Type.String({ maxLength: 500 })),
	includeSchemas: Type.Optional(Type.Boolean()),
	limit: Type.Optional(Type.Integer({ maximum: 20, minimum: 1 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
	server: Type.Optional(Type.String({ maxLength: 200, minLength: 1 })),
});

const MCP_PARAMETER_KEYS = [
	"tool",
	"args",
	"connect",
	"describe",
	"search",
	"includeSchemas",
	"limit",
	"offset",
	"server",
] as const;

function boundedMcpParameters(params: Record<string, unknown>): Record<string, unknown> {
	const bounded: Record<string, unknown> = {};
	for (const key of MCP_PARAMETER_KEYS) {
		if (params[key] !== undefined) bounded[key] = params[key];
	}
	if (typeof bounded["limit"] === "number") bounded["limit"] = Math.min(20, Math.max(1, bounded["limit"]));
	const serverOnly =
		typeof bounded["server"] === "string" &&
		!["tool", "connect", "describe", "search"].some((key) => bounded[key] !== undefined);
	if (serverOnly) {
		bounded["search"] = "";
		bounded["limit"] ??= 12;
	}
	return bounded;
}

function sharedToolFields(upstream: CapturedTool) {
	return {
		...(upstream.constrainedSampling !== undefined ? { constrainedSampling: upstream.constrainedSampling } : {}),
		...(upstream.executionMode !== undefined ? { executionMode: upstream.executionMode } : {}),
		label: upstream.label,
		name: upstream.name,
	};
}

function registerGateway(pi: ExtensionAPI, upstream: CapturedTool): void {
	const tool: ToolDefinition<typeof MCP_PARAMETERS, unknown> = {
		...sharedToolFields(upstream),
		description:
			"Lazy MCP gateway. Search or describe Tools, connect a named server, invoke one Tool, or inspect bounded status. Authentication is user-driven through /mcp-auth.",
		execute: (toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<unknown>> =>
			upstream.execute(toolCallId, boundedMcpParameters(params), signal, onUpdate, ctx),
		parameters: MCP_PARAMETERS,
		promptSnippet: "Discover and call configured MCP servers through one bounded, lazy gateway.",
	};
	registerSuiteOwnedTool(pi, tool, MCP_PRESENTATION);
}

/** Remove only the fork's persistent footer segment while retaining auth progress and notifications. */
export function suppressMcpFooterContext(ctx: ExtensionContext): ExtensionContext {
	const setStatus: ExtensionUIContext["setStatus"] = (key, value) => {
		if (key !== "mcp") ctx.ui.setStatus(key, value);
	};
	const ui = new Proxy(ctx.ui, {
		get(target, property, receiver) {
			if (property === "setStatus") return setStatus;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	return new Proxy(ctx, {
		get(target, property, receiver) {
			if (property === "ui") return ui;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
}

/** Build the narrow host facade supplied to the pinned fork. */
export function createMcpAdapterApi(pi: ExtensionAPI, commands: CapturedCommands): ExtensionAPI {
	const registerTool = ((tool: CapturedTool) => {
		if (tool.name === "mcp") registerGateway(pi, tool);
	}) as ExtensionAPI["registerTool"];
	const registerCommand = ((name: string, spec: CommandSpec) => {
		if (name === "mcp") commands.mcp = spec;
		if (name === "mcp-auth") commands.mcpAuth = spec;
	}) as ExtensionAPI["registerCommand"];
	const on = ((event: string, handler: EventHandler) => {
		const hostOn = pi.on as unknown as (eventName: string, eventHandler: EventHandler) => unknown;
		if (event === "session_start") {
			return hostOn(event, (eventData, ctx) => handler(eventData, suppressMcpFooterContext(ctx)));
		}
		return hostOn(event, handler);
	}) as ExtensionAPI["on"];
	return new Proxy(pi, {
		get(target, property, receiver) {
			if (property === "registerTool") return registerTool;
			if (property === "registerCommand") return registerCommand;
			if (property === "on") return on;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
}

function firstArgument(args: string): string {
	return args.trim().split(/\s+/u)[0] ?? "";
}

function installCommands(pi: ExtensionAPI, commands: CapturedCommands, store: McpStatusStore): void {
	const coordinator = getCommandDialogCoordinator(pi);
	pi.registerCommand("mcp", {
		description: "Show MCP server status",
		getArgumentCompletions: (prefix) => {
			const options = ["status", "reconnect", "logout", "disable", "enable", "tools", "prompts", "setup"];
			const normalized = prefix.trimStart();
			const matches = options
				.filter((option) => option.startsWith(normalized))
				.map((option) => ({ label: option, value: option }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const subcommand = firstArgument(args);
			if (!subcommand || subcommand === "status") {
				if (!ctx.hasUI) return;
				await coordinator.show(ctx, createMcpStatusView(store));
				return;
			}
			if (subcommand === "setup") {
				ctx.ui.notify("Add or edit .mcp.json, then run /reload.", "info");
				return;
			}
			if (subcommand === "tools") {
				ctx.ui.notify("Use the mcp Tool search action for bounded Tool discovery.", "info");
				return;
			}
			if (subcommand === "prompts") {
				ctx.ui.notify("Pi Stuff does not expose MCP prompt slash commands.", "info");
				return;
			}
			if (["reconnect", "logout", "disable", "enable"].includes(subcommand) && commands.mcp) {
				await commands.mcp.handler(args, ctx);
				return;
			}
			ctx.ui.notify(`Unknown /mcp subcommand: ${subcommand}`, "warning");
		},
	});

	pi.registerCommand("mcp-auth", {
		description: "Authenticate with one configured MCP server",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /mcp-auth <server>", "info");
				return;
			}
			if (!commands.mcpAuth) {
				ctx.ui.notify("MCP authentication is unavailable.", "error");
				return;
			}
			await commands.mcpAuth.handler(args, ctx);
		},
	});
}

/** Installation performs local configuration reads only; connection starts on explicit use. */
export function installMcpCapability(pi: ExtensionAPI): void {
	const removeDiagnosticHandler = logger.addHandler((entry) => {
		const context =
			entry.context && Object.keys(entry.context).length > 0 ? JSON.stringify(entry.context) : undefined;
		reportDiagnostic({
			capability: "MCP",
			...(context ? { details: context } : {}),
			...(entry.error ? { error: entry.error } : {}),
			severity: entry.level === "error" ? "error" : entry.level === "warn" ? "warning" : "info",
			summary: entry.message,
		});
	});
	const commands: CapturedCommands = {};
	const store = new McpStatusStore();
	const unsubscribeStatus = pi.events.on(MCP_STATUS_EVENT, (value) => {
		store.set(value);
	});
	const adapter = createMcpAdapter({
		deferStartupConnections: true,
		interactiveProtocolRequests: false,
		interactiveUi: false,
		proxyOnly: true,
	});
	adapter(createMcpAdapterApi(pi, commands));
	installCommands(pi, commands, store);
	pi.on("session_shutdown", () => {
		removeDiagnosticHandler();
		store.clear();
		if (typeof unsubscribeStatus === "function") unsubscribeStatus();
	});
}
