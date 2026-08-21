import { expect, test } from "bun:test";
import { buildProxyDescription } from "../../packages/pi-stuff/src/mcp/runtime/direct-tools.js";

test("MCP proxy description is static", () => {
	const description = buildProxyDescription();

	expect(description).toContain("MCP gateway");
	expect(description).not.toContain("Configured servers:");
	expect(description).not.toContain("cached metadata");
});
