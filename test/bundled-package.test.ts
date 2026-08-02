import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createVerifiedReleaseSnapshot, type ReleaseManifest } from "../scripts/release-artifacts.ts";
import { verifyPackageArchive } from "../scripts/verify-package.ts";

const TEMPORARY_ROOTS: string[] = [];

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env): string {
	const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`${command[0]} failed: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString();
}

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Bun packs exact Capability dependencies into an Aggregate Package", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-bundle-"));
	TEMPORARY_ROOTS.push(root);
	const aggregate = join(root, "packages", "pi-stuff");
	const capability = join(root, "packages", "pi-smoke");
	const output = join(root, "output");
	const bunTemporaryDirectory = join(root, ".bun-tmp");
	const bunInstallDirectory = join(root, ".bun-install");
	const bunCacheDirectory = join(root, ".bun-cache");

	await writeJson(join(root, "package.json"), {
		name: "fixture-root",
		private: true,
		workspaces: ["packages/*"],
	});
	await writeJson(join(capability, "package.json"), {
		name: "@jczhang02/pi-smoke",
		version: "0.0.1",
		type: "module",
		files: ["index.ts"],
	});
	await writeFile(join(capability, "index.ts"), "export default function smoke(): void {}\n");
	await writeJson(join(aggregate, "package.json"), {
		name: "@jczhang02/pi-stuff",
		version: "0.0.0",
		type: "module",
		files: ["index.ts"],
		dependencies: { "@jczhang02/pi-smoke": "0.0.1" },
		bundledDependencies: ["@jczhang02/pi-smoke"],
	});
	await writeFile(join(aggregate, "index.ts"), 'export { default } from "@jczhang02/pi-smoke";\n');
	await Promise.all([
		mkdir(output),
		mkdir(bunTemporaryDirectory),
		mkdir(bunInstallDirectory),
		mkdir(bunCacheDirectory),
	]);
	const bunEnvironment = {
		...process.env,
		BUN_INSTALL: bunInstallDirectory,
		BUN_INSTALL_CACHE_DIR: bunCacheDirectory,
		BUN_TMPDIR: bunTemporaryDirectory,
		TEMP: bunTemporaryDirectory,
		TMP: bunTemporaryDirectory,
		TMPDIR: bunTemporaryDirectory,
	};

	run(["bun", "install", "--ignore-scripts", "--offline"], root, bunEnvironment);
	run(["bun", "pm", "pack", "--ignore-scripts", "--destination", output, "--quiet"], aggregate, bunEnvironment);
	const [archive] = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
	if (!archive) {
		throw new Error("Bun did not create an Aggregate Package archive");
	}
	const archiveFiles = run(["tar", "-tzf", join(output, archive)], root)
		.trim()
		.split("\n")
		.sort();

	verifyPackageArchive(
		{
			files: ["index.ts"],
			bundledDependencies: ["@jczhang02/pi-smoke"],
		},
		archiveFiles,
	);
	expect(archiveFiles).toEqual([
		"package/index.ts",
		"package/node_modules/@jczhang02/pi-smoke/index.ts",
		"package/node_modules/@jczhang02/pi-smoke/package.json",
		"package/package.json",
	]);
});

test("Package archive verification rejects files outside the manifest", () => {
	expect(() =>
		verifyPackageArchive({ files: ["index.ts"], bundledDependencies: ["@jczhang02/pi-smoke"] }, [
			"package/index.ts",
			"package/node_modules/@jczhang02/pi-smoke/index.ts",
			"package/node_modules/@jczhang02/pi-smoke/package.json",
			"package/package.json",
			"package/private.txt",
		]),
	).toThrow("Unexpected Package archive files:\npackage/private.txt");
});

test("Package archive verification rejects bundled development files", () => {
	expect(() =>
		verifyPackageArchive({ files: ["index.ts"], bundledDependencies: ["@jczhang02/pi-smoke"] }, [
			"package/index.ts",
			"package/node_modules/@jczhang02/pi-smoke/index.ts",
			"package/node_modules/@jczhang02/pi-smoke/index.test.ts",
			"package/node_modules/@jczhang02/pi-smoke/package.json",
			"package/package.json",
		]),
	).toThrow("Bundled Package contains development-only files");
});

test("Package archive verification rejects traversal inside a bundled dependency", () => {
	expect(() =>
		verifyPackageArchive({ files: ["index.ts"], bundledDependencies: ["@jczhang02/pi-smoke"] }, [
			"package/index.ts",
			"package/node_modules/@jczhang02/pi-smoke/../../../escaped.txt",
			"package/node_modules/@jczhang02/pi-smoke/package.json",
			"package/package.json",
		]),
	).toThrow("Unsafe release archive path");
});

test("Publication snapshots preserve the exact verified artifact bytes", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-publish-snapshot-test-"));
	TEMPORARY_ROOTS.push(root);
	const archive = "jczhang02-pi-stuff-ui-1.0.0.tgz";
	const archivePath = join(root, archive);
	const certifiedBytes = Buffer.from("certified release bytes");
	await writeFile(archivePath, certifiedBytes);
	const manifest: ReleaseManifest = {
		artifacts: [
			{
				archive,
				integrity: `sha512-${createHash("sha512").update(certifiedBytes).digest("base64")}`,
				name: "@jczhang02/pi-stuff-ui",
				sha256: createHash("sha256").update(certifiedBytes).digest("hex"),
				version: "1.0.0",
			},
		],
		bunVersion: Bun.version,
		packer: "bun pm pack",
		schemaVersion: 1,
	};

	const snapshot = await createVerifiedReleaseSnapshot(root, manifest);
	TEMPORARY_ROOTS.push(snapshot.directory);
	await writeFile(archivePath, "mutated source bytes");

	expect(await readFile(snapshot.archivePaths[0] as string, "utf8")).toBe(certifiedBytes.toString());
	expect((await stat(snapshot.archivePaths[0] as string)).mode & 0o222).toBe(0);
});
