import { describe, expect, test } from "bun:test";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createMcpAdapterApi } from "../../packages/pi-stuff-mcp/adapter.js";

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

	test("captures fork commands and suppresses only its persistent footer", async () => {
		const fixture = harness();
		const commands: Record<string, unknown> = {};
		const adapter = createMcpAdapterApi(fixture.pi, commands);
		adapter.registerCommand("mcp", { description: "upstream", handler: async () => undefined });
		adapter.registerCommand("mcp-auth", { description: "upstream auth", handler: async () => undefined });
		expect(commands).toHaveProperty("mcp");
		expect(commands).toHaveProperty("mcpAuth");

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
			wrapped.ui.setStatus("mcp-auth", "authenticating");
		});
		await fixture.handlers.get("session_start")?.[0]?.({}, ctx);
		expect(writes).toEqual([["mcp-auth", "authenticating"]]);
	});
});
