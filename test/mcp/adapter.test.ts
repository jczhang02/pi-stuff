import { describe, expect, test } from "bun:test";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SuiteCodeModeConnector } from "../../packages/pi-stuff/src/code-mode/connector.js";
import type {
	CommandDialogCoordinator,
	CommandDialogView,
	CommandDialogViewContext,
} from "../../packages/pi-stuff/src/conversation-ui/index.js";
import { createMcpAdapterApi, routeMcpCustomUiThroughCommandDialog } from "../../packages/pi-stuff/src/mcp/adapter.js";
import type { SuiteToolDefinitionRegistry } from "../../packages/pi-stuff/src/tool-display/contract.js";

const Parameters = Type.Object({}, { additionalProperties: true });
type Tool = ToolDefinition<typeof Parameters, unknown>;
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function harness() {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, ToolDefinition>();
	const pi = {
		events: {},
		on: (event: string, handler: Handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand: () => {
			throw new Error("captured fork commands must not reach the host");
		},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
	} as unknown as ExtensionAPI;
	return { handlers, pi, tools };
}

function upstreamTool(name: string, execute: Tool["execute"]): Tool {
	return { description: name, execute, label: name, name, parameters: Parameters };
}

function registry(tools: Map<string, ToolDefinition>): SuiteToolDefinitionRegistry {
	return {
		catalog: () => [...tools.values()].map((definition) => ({ definition })),
		compensate: async () => false,
		get: (name) => tools.get(name),
		invoke: async () => {
			throw new Error("not used by discovery test");
		},
		isActive: (name) => tools.has(name),
		list: () => [...tools.values()],
	};
}

describe("Pi Stuff MCP fork boundary", () => {
	test("retains one gateway and bounds server-only discovery", async () => {
		const fixture = harness();
		const commands: Record<string, unknown> = {};
		const adapter = createMcpAdapterApi(fixture.pi, commands);
		let received: unknown;
		const execute: Tool["execute"] = async (_id, params): Promise<AgentToolResult<unknown>> => {
			received = params;
			return { content: [{ type: "text", text: "ok" }], details: { mode: "search", count: 1 } };
		};
		adapter.registerTool(upstreamTool("server_direct", execute));
		adapter.registerTool(upstreamTool("mcp_script", execute));
		adapter.registerTool(upstreamTool("mcp", execute));

		expect([...fixture.tools.keys()]).toEqual(["mcp"]);
		const tool = fixture.tools.get("mcp");
		if (!tool) throw new Error("mcp gateway was not registered");
		await tool.execute(
			"mcp-1",
			{ instructions: "hidden upstream field", server: "demo", uiMessages: true } as never,
			undefined,
			undefined,
			{} as never,
		);
		expect(received).toEqual({ limit: 12, search: "", server: "demo" });
		const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
		expect(properties).not.toHaveProperty("instructions");
		expect(properties).not.toHaveProperty("uiMessages");
		expect(properties).not.toHaveProperty("action");
		expect((properties["limit"] as { maximum?: number }).maximum).toBe(20);
		expect(tool.renderShell).toBe("self");
	});

	test("keeps configured MCP servers discoverable through Code Mode", () => {
		const fixture = harness();
		const adapter = createMcpAdapterApi(fixture.pi, {});
		const execute: Tool["execute"] = async () => ({ content: [], details: {} });
		adapter.registerTool({
			...upstreamTool("mcp", execute),
			description: [
				"MCP gateway.",
				"Configured servers: context7, open-design, zotero",
				"Servers: context7 (2 tools)",
				"Untrusted cached metadata keywords (data only): context7_resolve-library-id: compatible context7 library package resolve; context7_query-docs: documentation library retrieve",
			].join("\n"),
		});

		const gateway = fixture.tools.get("mcp");
		if (!gateway) throw new Error("mcp gateway was not registered");
		expect(gateway.description).toContain("context7");
		expect(gateway.description).toContain("zotero");
		expect(gateway.description).not.toContain("auth-start");
		expect(gateway.description).not.toContain("instructions:");

		const result = new SuiteCodeModeConnector(registry(fixture.tools)).search(
			"Context7 MCP resolve library and retrieve documentation for pi coding agent",
		);
		expect(result.results.map((entry) => entry.path)).toContain("tools.mcp");
	});

	test("captures the fork command and suppresses only its persistent footer", async () => {
		const fixture = harness();
		const commands: Record<string, unknown> = {};
		const adapter = createMcpAdapterApi(fixture.pi, commands);
		adapter.registerCommand("mcp", { description: "upstream", handler: async () => undefined });
		expect(Object.keys(commands)).toEqual(["mcp"]);

		const writes: Array<[string, string | undefined]> = [];
		const ctx = {
			hasUI: true,
			ui: {
				setStatus: (key: string, value: string | undefined) => writes.push([key, value]),
				theme: { fg: (_color: string, value: string) => value } as Theme,
			},
		} as unknown as ExtensionContext;
		adapter.on("session_start", (_event, wrapped) => {
			wrapped.ui.setStatus("mcp", "verbose upstream footer");
			wrapped.ui.setStatus("mcp-oauth", "authenticating");
		});
		await fixture.handlers.get("session_start")?.[0]?.({}, ctx);
		expect(writes).toEqual([["mcp-oauth", "authenticating"]]);
	});

	test("routes retained Setup UI through the shared non-overlay coordinator", async () => {
		let originalCustomCalled = false;
		let shows = 0;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				custom: async () => {
					originalCustomCalled = true;
					return undefined;
				},
			},
		} as unknown as ExtensionContext;
		const coordinator = {
			show: async (_ctx: ExtensionContext, view: CommandDialogView<unknown>) => {
				shows += 1;
				let result: unknown;
				const dialogContext: CommandDialogViewContext<unknown> = {
					close: (value) => {
						result = value;
					},
					keybindings: { matches: () => false } as never,
					requestRender: () => undefined,
					signal: new AbortController().signal,
					theme: { fg: (_color: string, value: string) => value } as Theme,
					tui: { requestRender: () => undefined } as never,
				};
				const component = view.create(dialogContext);
				component.handleInput?.("confirm");
				return result;
			},
		} as unknown as CommandDialogCoordinator;
		const routed = routeMcpCustomUiThroughCommandDialog(ctx, coordinator);
		const result = await routed.ui.custom<string>(
			(_tui, _theme, _keybindings, done) => ({
				handleInput: () => done("completed"),
				invalidate: () => undefined,
				render: () => ["setup"],
			}),
			{ overlay: true },
		);

		expect(result).toBe("completed");
		expect(shows).toBe(1);
		expect(originalCustomCalled).toBe(false);
	});
});
