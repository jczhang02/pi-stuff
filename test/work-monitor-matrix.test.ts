import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyWorkMonitorMatrix } from "../scripts/verify-work-monitor-matrix.js";

const root = resolve(import.meta.dir, "..");

test("real Pi verifies the Background Monitor success and failure matrix", async () => {
	await verifyWorkMonitorMatrix({
		packagePath: resolve(root, "packages/pi-stuff"),
		piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
	});
});
