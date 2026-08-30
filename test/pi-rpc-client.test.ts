import { expect, test } from "bun:test";
import { PiRpcClient } from "../scripts/pi-rpc-client.js";

test("RPC close accepts an intentional signal exit", async () => {
	const rpc = new PiRpcClient({
		arguments: ["-e", "setInterval(() => {}, 1_000)"],
		commandTimeoutMs: 1_000,
		cwd: process.cwd(),
		environment: process.env,
		executable: process.execPath,
		failurePrefix: "RPC close test",
		settleTimeoutMs: 1_000,
	});
	await expect(rpc.close()).resolves.toBeUndefined();
}, 7_000);
