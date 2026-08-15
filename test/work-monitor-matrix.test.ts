import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyWorkMonitorMatrix } from "../scripts/verify-work-monitor-matrix.js";

const root = resolve(import.meta.dir, "..");

test("real Pi verifies the Background Monitor success and failure matrix", async () => {
	const { PI_BIN: configuredPiBinary } = process.env;
	await verifyWorkMonitorMatrix({
		packagePath: resolve(root, "packages/pi-stuff"),
		piBinary: configuredPiBinary ?? "/opt/pi-coding-agent/pi",
	});
}, 30_000);
