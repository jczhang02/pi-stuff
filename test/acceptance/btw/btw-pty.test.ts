import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyBtwPty } from "../../../scripts/verify-btw-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../../../packages/pi-stuff");

test("real Pi TUI keeps BTW concurrent, fits oversized history, and remains focus-safe", async () => {
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyBtwPty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE, columns, rows });
	}
}, 120_000);
