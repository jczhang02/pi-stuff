import { describe, expect, test } from "bun:test";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createWebAdapterApi } from "../../packages/pi-stuff/src/web/adapter.js";

const Parameters = Type.Object({}, { additionalProperties: true });
type Tool = ToolDefinition<typeof Parameters, unknown>;

function harness() {
	const tools = new Map<string, ToolDefinition>();
	let commandCount = 0;
	let shortcutCount = 0;
	const pi = {
		events: {},
		on: () => undefined,
		registerCommand: () => {
			commandCount += 1;
		},
		registerShortcut: () => {
			shortcutCount += 1;
		},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
	} as unknown as ExtensionAPI;
	return {
		get commandCount() {
			return commandCount;
		},
		pi,
		get shortcutCount() {
			return shortcutCount;
		},
		tools,
	};
}

function upstreamTool(
	name: string,
	label: string,
	execute: Tool["execute"] = async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
): Tool {
	return { description: label, execute, label, name, parameters: Parameters };
}

describe("Pi Stuff Web fork boundary", () => {
	test("retains only search, HTTP(S) fetch, and continuation Tools", () => {
		const fixture = harness();
		const adapter = createWebAdapterApi(fixture.pi);
		adapter.registerTool(upstreamTool("web_search", "Web Search"));
		adapter.registerTool(upstreamTool("source_check", "Source Check"));
		adapter.registerTool(upstreamTool("fetch_content", "Fetch Content"));
		adapter.registerTool(upstreamTool("get_search_content", "Get Search Content"));
		adapter.registerCommand("websearch", { description: "floating", handler: async () => undefined });
		adapter.registerShortcut("ctrl+shift+w", { description: "widget", handler: async () => undefined });

		expect([...fixture.tools.keys()]).toEqual(["web_search", "fetch_content", "get_search_content"]);
		expect(fixture.commandCount).toBe(0);
		expect(fixture.shortcutCount).toBe(0);
		for (const tool of fixture.tools.values()) expect(tool.renderShell).toBe("self");
	});

	test("forces non-browser search without background page fan-out", async () => {
		const fixture = harness();
		let received: unknown;
		const execute: Tool["execute"] = async (_id, params): Promise<AgentToolResult<unknown>> => {
			received = params;
			return { content: [{ type: "text", text: "cited" }], details: { totalResults: 3 } };
		};
		createWebAdapterApi(fixture.pi).registerTool(upstreamTool("web_search", "Web Search", execute));
		const tool = fixture.tools.get("web_search");
		if (!tool) throw new Error("web_search was not registered");
		await tool.execute("search-1", { query: "Pi 0.83" }, undefined, undefined, {} as never);

		expect(received).toEqual({ includeContent: false, query: "Pi 0.83", workflow: "none" });
		const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
		expect(properties).not.toHaveProperty("workflow");
		expect(properties).not.toHaveProperty("includeContent");
	});

	test("blocks local fetches before calling the owned fork", async () => {
		const fixture = harness();
		let calls = 0;
		const execute: Tool["execute"] = async () => {
			calls += 1;
			return { content: [{ type: "text", text: "unexpected" }], details: {} };
		};
		createWebAdapterApi(fixture.pi).registerTool(upstreamTool("fetch_content", "Fetch Content", execute));
		const tool = fixture.tools.get("fetch_content");
		if (!tool) throw new Error("fetch_content was not registered");
		const result = await tool.execute(
			"fetch-1",
			{ url: "http://127.0.0.1/private" },
			undefined,
			undefined,
			{} as never,
		);

		expect(calls).toBe(0);
		expect((result.details as { error?: string }).error).toContain("Local and private");
	});

	test("bounds continuation selectors and returned slices", () => {
		const fixture = harness();
		createWebAdapterApi(fixture.pi).registerTool(upstreamTool("get_search_content", "Get Search Content"));
		const tool = fixture.tools.get("get_search_content");
		if (!tool) throw new Error("get_search_content was not registered");
		const properties = (tool.parameters as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};

		expect(properties["responseId"]?.["maxLength"]).toBe(256);
		expect(properties["limit"]?.["maximum"]).toBe(30_000);
		expect(properties["offset"]?.["minimum"]).toBe(0);
		expect(tool.renderShell).toBe("self");
	});
});
