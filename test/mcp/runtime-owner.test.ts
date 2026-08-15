import { describe, expect, test } from "bun:test";
import { createMcpRuntimeOwner } from "../../packages/pi-stuff/src/mcp/runtime/runtime-owner.js";

describe("MCP runtime ownership", () => {
	test("aborts immediately and bounds cleanup that ignores cancellation", async () => {
		const owner = createMcpRuntimeOwner(10);
		owner.addCleanup(async () => new Promise(() => undefined));

		const startedAt = performance.now();
		await owner.stop("test shutdown");

		expect(owner.signal.aborted).toBeTrue();
		expect(performance.now() - startedAt).toBeLessThan(100);
	});
});
