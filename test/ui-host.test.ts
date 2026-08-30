import { expect, test } from "bun:test";
import { join } from "node:path";
import { runPiRpcSmoke } from "../scripts/smoke-pi.js";

const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;

test("the Suite exposes one unified UI settings command", async () => {
	const result = await runPiRpcSmoke({
		packages: [join(import.meta.dir, "..", "packages", "pi-stuff")],
		piBinary: PI_BINARY,
	});

	expect(result.commandNames).toContain("ui");
	expect(result.commandNames).not.toContain("tool-settings");
	expect(result.stderr).toBe("");
}, 30_000);
