import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runPiRpcSmoke } from "../scripts/smoke-pi.js";

const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;
const PERMISSIONS_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-permissions");

test("keeps the extension factory separate from the public service seam", async () => {
	const manifest = JSON.parse(await readFile(resolve(PERMISSIONS_PACKAGE, "package.json"), "utf8")) as {
		exports: Record<string, string>;
	};
	const extensionSource = await readFile(resolve(PERMISSIONS_PACKAGE, "src/index.ts"), "utf8");
	const serviceSource = await readFile(resolve(PERMISSIONS_PACKAGE, "src/service.ts"), "utf8");

	expect(manifest.exports).toEqual({ ".": "./src/index.ts", "./service": "./src/service.ts" });
	expect(extensionSource).toContain("export default function piStuffPermissions");
	expect(extensionSource).not.toContain('export * from "./service"');
	expect(serviceSource).toContain("export function getPermissionsService");
});

test("Pi 0.83 loads Pi Stuff Permissions and registers its settings command", async () => {
	const result = await runPiRpcSmoke({
		piBinary: PI_BINARY,
		packages: [PERMISSIONS_PACKAGE],
	});

	expect(result.commandNames).toContain("permissions");
	expect(result.commandNames).not.toContain("permission-system");
	expect(result.createdFiles.filter((path) => path.includes("pi-stuff-permissions"))).toEqual([]);
	expect(result.stderr).toBe("");
});
