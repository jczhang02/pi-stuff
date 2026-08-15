import { describe, expect, test } from "bun:test";
import { resolveCommandSecret } from "../../packages/pi-stuff/src/mcp/runtime/utils.ts";

describe("MCP command secrets", () => {
	test("does not block the Host event loop while the command runs", async () => {
		let timerRan = false;
		const timer = setTimeout(() => {
			timerRan = true;
		}, 5);

		const secret = await resolveCommandSecret("!sleep 0.05; printf secret", "test secret");

		clearTimeout(timer);
		expect(secret).toBe("secret");
		expect(timerRan).toBe(true);
	});
});
