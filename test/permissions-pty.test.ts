import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyPermissionsPty } from "../scripts/verify-permissions-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi TUI renders and restores the blocking permission dialog at both target sizes", async () => {
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyPermissionsPty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE, columns, rows });
	}
}, 30_000);
