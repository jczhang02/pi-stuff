import { expect, test } from "bun:test";
import { MCP_PRESENTATION } from "../../packages/pi-stuff-mcp/presentation.js";

function category(args: Record<string, unknown>): string | undefined {
	return MCP_PRESENTATION.activity.classify({ args, state: "running" })[0]?.category;
}

test("MCP activity metadata distinguishes invocation, connection, and catalog retrieval", () => {
	expect(category({ search: "tool", tool: "server.execute" })).toBe("invoke-mcp");
	expect(category({ connect: "server", describe: "server.execute" })).toBe("connect-mcp");
	expect(category({ search: "browser" })).toBe("search-mcp");
	expect(category({ describe: "server.execute" })).toBe("search-mcp");
	expect(category({ action: "status" })).toBe("search-mcp");
});
