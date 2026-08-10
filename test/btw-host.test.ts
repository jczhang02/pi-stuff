import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runPiRpcSmoke } from "../scripts/smoke-pi.ts";

const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;
const BTW_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-btw");

test("the certified Pi Host loads the owned BTW Capability without Extension errors", async () => {
	const result = await runPiRpcSmoke({ piBinary: PI_BINARY, packages: [BTW_PACKAGE] });
	expect(result.commandNames).toContain("btw");
	expect(result.stderr).toBe("");
});
