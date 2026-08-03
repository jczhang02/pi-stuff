import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyActiveToolParity, verifyToolsPty } from "../scripts/verify-tools-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi renders all seven built-ins and focused Tool details safely", async () => {
	await verifyActiveToolParity({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE });
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyToolsPty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE, columns, rows });
	}
}, 60_000);
