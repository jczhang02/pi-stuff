import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyNestedPermissionsPty } from "../scripts/verify-nested-permissions-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("a grandchild destructive bash denial is routed through the root Command Dialog", async () => {
	await verifyNestedPermissionsPty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE });
}, 60_000);
