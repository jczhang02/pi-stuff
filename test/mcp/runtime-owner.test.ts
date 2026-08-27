import { describe, expect, test } from "bun:test";
import { connectClientWithAbort } from "../../packages/pi-stuff/src/mcp/runtime/mcp-http-transport.js";
import { createMcpRuntimeOwner } from "../../packages/pi-stuff/src/mcp/runtime/runtime-owner.js";
import type { Transport } from "../../packages/pi-stuff/src/mcp/runtime/types.js";

describe("MCP runtime ownership", () => {
	test("aborts immediately and bounds cleanup that ignores cancellation", async () => {
		const owner = createMcpRuntimeOwner(10);
		owner.addCleanup(async () => new Promise(() => undefined));

		const startedAt = performance.now();
		await owner.stop("test shutdown");

		expect(owner.signal.aborted).toBeTrue();
		expect(performance.now() - startedAt).toBeLessThan(100);
	});

	test("closes an in-progress client transport when its owner aborts", async () => {
		let closeCount = 0;
		const transport: Transport = {
			close: async () => {
				closeCount++;
				transport.onclose?.();
			},
			send: async () => undefined,
			start: async () => undefined,
		};
		const client = { connect: async () => new Promise<void>(() => undefined) };
		const controller = new AbortController();
		const connecting = connectClientWithAbort(client, transport, undefined, controller.signal);

		await Promise.resolve();
		controller.abort(new Error("test abort"));

		await expect(connecting).rejects.toThrow("test abort");
		expect(closeCount).toBe(1);
	});
});
