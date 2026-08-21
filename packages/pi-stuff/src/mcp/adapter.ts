import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import {
	type CommandDialogKeybindings,
	type CommandDialogView,
	getCommandDialogCoordinator,
} from "../conversation-ui/index.js";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { isRuntimeFunction, isRuntimeNumber, isRuntimeString } from "../shared/runtime-type.js";
import { registerSuiteOwnedTool, type SuiteToolRegistrationHost } from "../tool-display/index.js";
import { createMcpControlView } from "./mcp-dialog.js";
import { MCP_PRESENTATION } from "./presentation.js";
import { createMcpAdapter, MCP_STATUS_EVENT } from "./runtime/index.js";
import { logger } from "./runtime/logger.js";
import { McpStatusStore } from "./status-store.js";

type CapturedTool = ToolDefinition<TSchema, unknown, unknown>;
export type McpAdapterHost = SuiteToolRegistrationHost & Pick<ExtensionAPI, "registerCommand">;
type CommandSpec = Parameters<ExtensionAPI["registerCommand"]>[1];
type CommandContext = Parameters<CommandSpec["handler"]>[1];
type CapturedCommandSpec = Omit<CommandSpec, "handler"> & {
	handler(args: string, ctx: CommandContext): unknown | Promise<unknown>;
};
type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type McpCustomFactory = Parameters<ExtensionUIContext["custom"]>[0];
type McpCustomKeybindings = Parameters<McpCustomFactory>[2];

interface McpCustomUiContext {
	readonly ui: Pick<ExtensionUIContext, "custom">;
}

interface McpCustomUiCoordinator<Context> {
	show<Result>(ctx: Context, view: CommandDialogView<Result>): Promise<Result | undefined>;
}

function isMcpCustomKeybindings(value: CommandDialogKeybindings): value is McpCustomKeybindings {
	return (
		"reload" in value &&
		isRuntimeFunction(value.reload) &&
		"getEffectiveConfig" in value &&
		isRuntimeFunction(value.getEffectiveConfig)
	);
}

interface CapturedCommands {
	mcp?: CapturedCommandSpec;
}

const MCP_GATEWAY_DESCRIPTION =
	"MCP gateway for configured servers. List or search first, then pass one returned prefixed Tool name with its args. Connect a server when cached metadata is unavailable. Authentication is user-driven through /mcp.";

const MCP_PARAMETERS = Type.Object({
	tool: Type.Optional(
		Type.String({
			description: "Prefixed MCP Tool name returned by list, search, or describe",
			maxLength: 256,
			minLength: 1,
		}),
	),
	args: Type.Optional(
		Type.Union([Type.String({ maxLength: 64 * 1_024 }), Type.Object({}, { additionalProperties: true })], {
			description: "Arguments for the selected MCP Tool as an object or JSON string",
		}),
	),
	connect: Type.Optional(
		Type.String({ description: "Configured server name to connect and refresh", maxLength: 200, minLength: 1 }),
	),
	describe: Type.Optional(
		Type.String({
			description: "Prefixed MCP Tool name whose parameters should be shown",
			maxLength: 256,
			minLength: 1,
		}),
	),
	search: Type.Optional(
		Type.String({ description: "Search cached MCP Tools by name or description", maxLength: 500 }),
	),
	includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results" })),
	limit: Type.Optional(Type.Integer({ description: "Maximum search results", maximum: 20, minimum: 1 })),
	offset: Type.Optional(Type.Integer({ description: "Search result offset", minimum: 0 })),
	server: Type.Optional(
		Type.String({ description: "Configured server to list or filter MCP Tools", maxLength: 200, minLength: 1 }),
	),
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
	if (isRuntimeNumber(bounded["limit"])) bounded["limit"] = Math.min(20, Math.max(1, bounded["limit"]));
	const serverOnly =
		isRuntimeString(bounded["server"]) &&
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

function registerGateway(pi: SuiteToolRegistrationHost, upstream: CapturedTool): void {
	const tool: ToolDefinition<typeof MCP_PARAMETERS, unknown> = {
		...sharedToolFields(upstream),
		description: MCP_GATEWAY_DESCRIPTION,
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
			return readHostProxyProperty(target, property, receiver);
		},
	});
	return new Proxy(ctx, {
		get(target, property, receiver) {
			if (property === "ui") return ui;
			return readHostProxyProperty(target, property, receiver);
		},
	});
}

/** Keep retained MCP custom components inside the Suite-owned focused surface. */
export function routeMcpCustomUiThroughCommandDialog<Context extends McpCustomUiContext>(
	ctx: Context,
	coordinator: McpCustomUiCoordinator<Context>,
): Context {
	const custom = (async (factory: McpCustomFactory) => {
		const result = await coordinator.show<unknown>(ctx, {
			priority: "normal",
			create: (context) => {
				if (!isMcpCustomKeybindings(context.keybindings)) {
					throw new Error("MCP custom UI requires Pi application keybindings");
				}
				const component = factory(context.tui, context.theme, context.keybindings, (value: unknown) =>
					context.close(value),
				);
				if (component instanceof Promise) {
					throw new Error("Async MCP custom component factories are unsupported");
				}
				return component;
			},
		});
		return result;
	}) as ExtensionUIContext["custom"];
	const ui = new Proxy(ctx.ui, {
		get(target, property, receiver) {
			if (property === "custom") return custom;
			return readHostProxyProperty(target, property, receiver);
		},
	});
	return new Proxy(ctx, {
		get(target, property, receiver) {
			if (property === "ui") return ui;
			return readHostProxyProperty(target, property, receiver);
		},
	}) as Context;
}

/** Build the narrow host facade supplied to the pinned fork. */
export function createMcpAdapterApi<Host extends McpAdapterHost>(pi: Host, commands: CapturedCommands): Host {
	const registerTool = ((tool: CapturedTool) => {
		if (tool.name === "mcp") registerGateway(pi, tool);
	}) as ExtensionAPI["registerTool"];
	const registerCommand = ((name: string, spec: CommandSpec) => {
		if (name === "mcp") commands.mcp = spec as CapturedCommandSpec;
	}) as ExtensionAPI["registerCommand"];
	const on = ((event: string, handler: EventHandler) => {
		const hostOn = pi.on as (eventName: string, eventHandler: EventHandler) => unknown;
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
			return readHostProxyProperty(target, property, receiver);
		},
	});
}

function firstArgument(args: string): string {
	return args.trim().split(/\s+/u)[0] ?? "";
}

function installCommands(pi: ExtensionAPI, commands: CapturedCommands, store: McpStatusStore): void {
	const coordinator = getCommandDialogCoordinator(pi);
	const invoke = async (
		command: CapturedCommandSpec | undefined,
		args: string,
		ctx: CommandContext,
	): Promise<unknown> => {
		if (!command) throw new Error("MCP command is unavailable");
		return command.handler(args, ctx);
	};
	const invokeAction = async (args: string, ctx: CommandContext): Promise<boolean> =>
		(await invoke(commands.mcp, args, ctx)) === true;
	pi.registerCommand("mcp", {
		description: "Manage MCP servers",
		getArgumentCompletions: (prefix) => {
			const options = [
				"auth",
				"status",
				"reconnect",
				"logout",
				"disable",
				"enable",
				"auto-connect",
				"on-demand",
				"tools",
				"prompts",
				"setup",
			];
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
				const result = await coordinator.show(
					ctx,
					createMcpControlView(store, {
						authenticate: (server) => invokeAction(`auth ${server}`, ctx),
						logout: (server) => invokeAction(`logout ${server}`, ctx),
						reconnect: (server) => invokeAction(`reconnect ${server}`, ctx),
					}),
				);
				if (result?.action === "setup") {
					await invoke(
						commands.mcp,
						"setup",
						routeMcpCustomUiThroughCommandDialog<CommandContext>(ctx, coordinator),
					);
				} else if (result?.action === "set-disabled") {
					await invoke(commands.mcp, `${result.disabled ? "disable" : "enable"} ${result.server}`, ctx);
				} else if (result?.action === "set-auto-connect") {
					await invoke(commands.mcp, `${result.enabled ? "auto-connect" : "on-demand"} ${result.server}`, ctx);
				}
				return;
			}
			if (subcommand === "setup") {
				await invoke(commands.mcp, args, routeMcpCustomUiThroughCommandDialog<CommandContext>(ctx, coordinator));
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
			if (
				["auth", "reconnect", "logout", "disable", "enable", "auto-connect", "on-demand"].includes(subcommand) &&
				commands.mcp
			) {
				await commands.mcp.handler(args, ctx);
				return;
			}
			ctx.ui.notify(`Unknown /mcp subcommand: ${subcommand}`, "warning");
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
		if (isRuntimeFunction(unsubscribeStatus)) unsubscribeStatus();
	});
}
