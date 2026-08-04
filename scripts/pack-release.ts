import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createReleaseArtifacts } from "./release-artifacts.ts";
import { certifyReleaseArtifacts } from "./verify-package.ts";

const root = resolve(import.meta.dir, "..");
const destination = resolve(process.argv[2] ?? resolve(root, ".artifacts/release"));
if (process.argv.length > 3) throw new Error("Usage: bun scripts/pack-release.ts [destination]");

const pendingChangesets = (await readdir(join(root, ".changeset"))).filter(
	(entry) => entry.endsWith(".md") && entry !== "README.md",
);
if (pendingChangesets.length > 0) {
	throw new Error(`Run bun run release:version before packing; pending Changesets: ${pendingChangesets.join(", ")}`);
}
for (const packagePath of [
	"pi-stuff-ui",
	"pi-stuff-tools",
	"pi-stuff-context",
	"pi-stuff-agents",
	"pi-stuff-todo",
	"pi-stuff-btw",
	"pi-stuff",
]) {
	const manifest = JSON.parse(await readFile(join(root, "packages", packagePath, "package.json"), "utf8")) as {
		version?: unknown;
	};
	if (typeof manifest.version !== "string" || manifest.version === "0.0.0") {
		throw new Error(`Refusing to pack unreleased version ${String(manifest.version)} for ${packagePath}`);
	}
}

const check = Bun.spawnSync([process.execPath, "run", "check"], { cwd: root, stderr: "inherit", stdout: "inherit" });
if (check.exitCode !== 0) throw new Error("Release packing refused because bun run check failed");

const manifest = await createReleaseArtifacts(destination);
const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
await certifyReleaseArtifacts(destination, PI_BIN);
console.log(`Packed and certified ${manifest.artifacts.length} immutable release artifacts in ${destination}`);
