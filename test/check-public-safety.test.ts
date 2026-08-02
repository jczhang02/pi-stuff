import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPublicFiles } from "../scripts/check-public-safety.ts";

const TEMPORARY_ROOTS: string[] = [];

async function createRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-safety-"));
	TEMPORARY_ROOTS.push(root);
	await Bun.$`git init --quiet ${root}`;
	await mkdir(join(root, "packages", "pi-stuff"), { recursive: true });
	await writeFile(join(root, "README.md"), "Public documentation.\n");
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify(
			{
				name: "fixture-root",
				private: true,
				packageManager: "bun@1.3.14",
				devDependencies: { typescript: "5.9.3" },
				trustedDependencies: [],
			},
			null,
			"\t",
		)}\n`,
	);
	await writeFile(
		join(root, "packages", "pi-stuff", "package.json"),
		`${JSON.stringify(
			{
				files: ["index.ts", "README.md", "LICENSE"],
				pi: { extensions: ["./index.ts"] },
			},
			null,
			"\t",
		)}\n`,
	);
	return root;
}

async function writeCapabilityManifest(root: string, manifest: Record<string, unknown>): Promise<void> {
	await mkdir(join(root, "packages", "pi-example"), { recursive: true });
	await writeFile(join(root, "packages", "pi-example", "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("auditPublicFiles", () => {
	test("accepts public files and the minimal Aggregate Package allowlist", async () => {
		const root = await createRepository();
		await writeCapabilityManifest(root, {
			name: "@jczhang02/pi-example",
			version: "0.0.1",
			files: ["index.ts", "README.md", "LICENSE"],
			pi: { extensions: ["./index.ts"] },
			dependencies: { typebox: "1.1.24" },
		});

		expect(await auditPublicFiles(root)).toEqual([]);
	});

	test("rejects host state, private absolute paths, and Package lifecycle side effects", async () => {
		const root = await createRepository();
		await writeFile(join(root, "auth.json"), "{}\n");
		const privatePath = ["", "home", "example", "private-suite"].join("/");
		await writeFile(join(root, "README.md"), `Local checkout: ${privatePath}\n`);
		await writeFile(
			join(root, "packages", "pi-stuff", "package.json"),
			`${JSON.stringify(
				{
					files: ["index.ts", "README.md", "LICENSE", "AGENTS.md"],
					pi: { extensions: ["./index.ts"] },
					scripts: { postinstall: "modify-host" },
				},
				null,
				"\t",
			)}\n`,
		);

		expect(await auditPublicFiles(root)).toEqual([
			{ path: "README.md", rule: "private-absolute-path" },
			{ path: "auth.json", rule: "forbidden-host-state" },
			{ path: "packages/pi-stuff/package.json", rule: "package-files-allowlist" },
			{ path: "packages/pi-stuff/package.json", rule: "package-lifecycle-script" },
		]);
	});

	test("rejects ranged direct dependencies and trusted lifecycle packages", async () => {
		const root = await createRepository();
		await writeFile(
			join(root, "package.json"),
			`${JSON.stringify(
				{
					name: "fixture-root",
					private: true,
					packageManager: "bun@1.3.14",
					devDependencies: { typescript: "^5.9.3" },
					trustedDependencies: ["typescript"],
				},
				null,
				"\t",
			)}\n`,
		);

		expect(await auditPublicFiles(root)).toEqual([
			{ path: "package.json", rule: "direct-dependency-must-be-exact" },
			{ path: "package.json", rule: "trusted-dependencies-must-be-empty" },
		]);
	});

	test("applies the publishable Package contract to Capability workspaces", async () => {
		const root = await createRepository();
		await writeCapabilityManifest(root, {
			name: "@jczhang02/pi-example",
			version: "0.0.1",
			files: ["index.ts", "../private.txt"],
			pi: { extensions: ["./extension.ts"] },
			scripts: { prepare: "generate-package" },
			dependencies: { typebox: "^1.1.24" },
		});

		expect(await auditPublicFiles(root)).toEqual([
			{ path: "packages/pi-example/package.json", rule: "direct-dependency-must-be-exact" },
			{ path: "packages/pi-example/package.json", rule: "package-files-allowlist" },
			{ path: "packages/pi-example/package.json", rule: "package-pi-manifest" },
			{ path: "packages/pi-example/package.json", rule: "package-lifecycle-script" },
		]);
	});

	test("ignores tracked files deleted from the working tree", async () => {
		const root = await createRepository();
		const deletedPath = join(root, "README.md");
		const privatePath = ["", "home", "example", "secret"].join("/");
		await writeFile(deletedPath, `private path: ${privatePath}\n`);
		Bun.spawnSync(["git", "add", "README.md"], { cwd: root });
		await rm(deletedPath);

		expect(await auditPublicFiles(root)).toEqual([]);
	});
});
