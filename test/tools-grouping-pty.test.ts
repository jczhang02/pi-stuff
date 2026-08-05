import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyToolsGroupingPty } from "../scripts/verify-tools-grouping-pty.js";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi groups only adjacent successful exploration Tool calls", async () => {
	for (const scenario of ["lifecycle", "compaction", "resume", "tree"] as const) {
		await verifyToolsGroupingPty({
			columns: 100,
			packagePath: AGGREGATE_PACKAGE,
			piBinary: PI_BIN,
			rows: 32,
			scenario,
		});
	}
	await verifyToolsGroupingPty({
		columns: 64,
		packagePath: AGGREGATE_PACKAGE,
		piBinary: PI_BIN,
		rows: 28,
	});
}, 120_000);
