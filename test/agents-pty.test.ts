import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyAgentsPty } from "../scripts/verify-agents-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi keeps background reports inspectable across cold resume without another main turn or workspace artifacts", async () => {
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyAgentsPty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE, columns, rows });
	}
}, 120_000);
