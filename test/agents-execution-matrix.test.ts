import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyAgentsExecutionMatrix } from "../scripts/verify-agents-execution-matrix.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi executes the Agent shape, context, and scheduling matrix with parallel provider overlap", async () => {
	await verifyAgentsExecutionMatrix({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE });
}, 120_000);
