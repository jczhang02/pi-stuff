import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const TEMPORARY_ROOTS: string[] = [];

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
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
	await mkdir(output);

	run(["bun", "install", "--ignore-scripts"], root);
	run(["bun", "pm", "pack", "--ignore-scripts", "--destination", output, "--quiet"], aggregate);
	const [archive] = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
	if (!archive) {
		throw new Error("Bun did not create an Aggregate Package archive");
	}
	const archiveFiles = run(["tar", "-tzf", join(output, archive)], root)
		.trim()
		.split("\n")
		.sort();

	expect(archiveFiles).toEqual([
		"package/index.ts",
		"package/node_modules/@jczhang02/pi-smoke/index.ts",
		"package/node_modules/@jczhang02/pi-smoke/package.json",
		"package/package.json",
	]);
});
