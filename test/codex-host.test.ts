import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { runPiRpcSmoke } from "../scripts/smoke-pi.js";

const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
const CODEX_PACKAGE = join(REPOSITORY_ROOT, "packages", "pi-stuff-codex");
const AGGREGATE_PACKAGE = join(REPOSITORY_ROOT, "packages", "pi-stuff");
const INSPECTOR = join(REPOSITORY_ROOT, "test", "fixtures", "assert-codex-tools.ts");
const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;

test("the certified Pi Host loads only the deliberate Codex command and leaves no startup settings", async () => {
	const result = await runPiRpcSmoke({
		extensions: [INSPECTOR],
		packages: [CODEX_PACKAGE],
		piBinary: PI_BINARY,
	});
	expect(result.stderr).toBe("");
	expect(result.commandNames).toContain("codex");
	expect(result.commandNames).toContain("codex-tools-registered-certified");
	for (const excluded of ["compact", "image-generation", "status", "voice", "web"]) {
		expect(result.commandNames).not.toContain(excluded);
	}
	expect(result.createdFiles).not.toContain("agent/pi-stuff-codex.json");
});

test("the Aggregate exposes Codex controls without legacy conversion commands", async () => {
	const result = await runPiRpcSmoke({ packages: [AGGREGATE_PACKAGE], piBinary: PI_BINARY });
	expect(result.stderr).toBe("");
	expect(result.commandNames).toContain("codex");
	expect(result.commandNames).not.toContain("image-generation");
	expect(result.commandNames).not.toContain("codex-settings");
});
