import { expect, test } from "bun:test";
import { MCP_PRESENTATION } from "../../packages/pi-stuff-mcp/presentation.js";

function grouping(args: Record<string, unknown>): "exploration" | "standalone" | undefined {
	const policy = MCP_PRESENTATION.grouping;
	return typeof policy === "function" ? policy(args) : policy;
}

test("MCP grouping keeps execution and connection modes standalone", () => {
	expect(grouping({ search: "tool", tool: "server.execute" })).toBe("standalone");
	expect(grouping({ connect: "server", describe: "server.execute" })).toBe("standalone");
	expect(grouping({ search: "browser" })).toBe("exploration");
	expect(grouping({ describe: "server.execute" })).toBe("exploration");
	expect(grouping({ action: "status" })).toBe("exploration");
});
