import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type PackageArchiveManifest,
	verifyInstalledRuntimeDependencies,
	verifyPackageArchive,
} from "../scripts/verify-package.ts";

const TEMPORARY_ROOTS: string[] = [];
const packageDirectory = resolve(import.meta.dir, "../packages/pi-stuff");

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString();
}

async function realArchive(): Promise<{ files: string[]; manifest: PackageArchiveManifest }> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-single-package-"));
	TEMPORARY_ROOTS.push(root);
	const output = join(root, "output");
	await mkdir(output);
	run([process.execPath, "pm", "pack", "--ignore-scripts", "--destination", output, "--quiet"], packageDirectory);
	const [archive] = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
	if (!archive) throw new Error("Bun did not create the local Pi Package archive");
	const path = join(output, archive);
	return {
		files: run(["tar", "-tzf", path], root).trim().split("\n").filter(Boolean).sort(),
		// SAFETY: this test controls the serialized JSON fixture and exercises only the asserted fields.
		manifest: JSON.parse(run(["tar", "-xOzf", path, "package/package.json"], root)) as PackageArchiveManifest,
	};
}

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Bun packs the complete local Pi Package without nested Packages", async () => {
	const archive = await realArchive();
	verifyPackageArchive(archive.manifest, archive.files);
	expect(archive.files.some((path) => path.startsWith("package/node_modules/"))).toBe(false);
	expect(archive.files.filter((path) => path.endsWith("/package.json"))).toEqual(["package/package.json"]);
	expect(archive.files.some((path) => path.startsWith("package/src/subagents/agents/"))).toBe(false);
});

test("every exact runtime dependency is installed at its declared identity", async () => {
	await verifyInstalledRuntimeDependencies(packageDirectory);
});

test("Package archive verification rejects publication and nested Package boundaries", async () => {
	const archive = await realArchive();
	expect(() => verifyPackageArchive({ ...archive.manifest, private: false }, archive.files)).toThrow(
		"must remain a private local Package",
	);
	expect(() =>
		verifyPackageArchive(archive.manifest, [...archive.files, "package/src/web/runtime/package.json"]),
	).toThrow("Archive contains forbidden files");
	expect(() => verifyPackageArchive({ ...archive.manifest, bundledDependencies: ["typebox"] }, archive.files)).toThrow(
		"must not use bundledDependencies",
	);
});

test("Package archive verification rejects development files and bundled Agent definitions", async () => {
	const archive = await realArchive();
	expect(() => verifyPackageArchive(archive.manifest, [...archive.files, "package/src/example.test.ts"])).toThrow(
		"Archive contains forbidden files",
	);
	expect(() =>
		verifyPackageArchive(archive.manifest, [...archive.files, "package/src/subagents/agents/general-purpose.md"]),
	).toThrow("Archive contains forbidden files");
});
