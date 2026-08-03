import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyToolsResumePty } from "../scripts/verify-tools-resume-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const AGGREGATE_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");

test("real Pi keeps compact Tool rows and exact active membership across in-process resume", async () => {
	await verifyToolsResumePty({ piBinary: PI_BIN, packagePath: AGGREGATE_PACKAGE });
}, 60_000);
