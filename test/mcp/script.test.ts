import { expect, test } from "bun:test";
import { runMcpScript } from "../../packages/pi-stuff/src/mcp/runtime/mcp-code.js";
import { createMcpRuntimeOwner } from "../../packages/pi-stuff/src/mcp/runtime/runtime-owner.js";
import type { McpExtensionState } from "../../packages/pi-stuff/src/mcp/runtime/state.js";

test("MCP Script settles omitted call, search, and describe arguments", async () => {
	const owner = createMcpRuntimeOwner();
	// SAFETY: the no-argument paths under test read only owner, config, and Tool metadata from this state fixture.
	const state = {
		config: { mcpServers: {} },
		owner,
		toolMetadata: new Map(),
	} as McpExtensionState;
	try {
		const result = await runMcpScript(
			state,
			"return { call: await tools.missing(), search: await tools.search(), describe: await tools.describe() };",
			1_000,
		);
		expect(result.details).not.toHaveProperty("error");
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(result.details).toMatchObject({
			calls: [{ operation: "call" }, { operation: "search" }, { operation: "describe" }],
		});
	} finally {
		await owner.stop();
	}
});
