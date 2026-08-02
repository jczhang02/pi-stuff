import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
