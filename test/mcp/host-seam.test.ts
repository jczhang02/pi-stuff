import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createMcpStatusSnapshot } from "../../packages/pi-stuff/src/mcp/runtime/mcp-status.js";
import { McpServerManager } from "../../packages/pi-stuff/src/mcp/runtime/server-manager.js";
import {
	formatMcpDirectToolCallLines,
	formatMcpToolResultLines,
} from "../../packages/pi-stuff/src/mcp/runtime/tool-result-renderer.js";
import { isJsonSourceValue } from "../../packages/pi-stuff/src/shared/json-value.js";

test("MCP call and result previews are terminal-cell-safe", () => {
	const call = formatMcpDirectToolCallLines("server/tool", { query: "😀".repeat(31) }, 60);
	const result = formatMcpToolResultLines(
		{ content: [{ type: "text", text: `\u001b[31m${"界".repeat(100)}\u001b[0m` }] },
		false,
		3,
		60,
	);
	for (const line of [...call.slice(1), ...result.lines]) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(60);
		expect(line).not.toContain("\u001b");
	}
	expect(result.truncated).toBeTrue();
});

test("MCP status events omit absent optional server fields", () => {
	const snapshot = createMcpStatusSnapshot({
		config: { mcpServers: { context7: { url: "https://mcp.context7.com/mcp" } } },
		failureMessages: new Map(),
		failureTracker: new Map(),
		manager: new McpServerManager(),
		resourceCounts: new Map(),
		toolMetadata: new Map(),
	});
	expect(isJsonSourceValue(snapshot)).toBeTrue();
	expect(snapshot.servers[0]).not.toHaveProperty("resourceCount");
});
