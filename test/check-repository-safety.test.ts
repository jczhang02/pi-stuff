import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditRepositoryFiles } from "../scripts/check-repository-safety.ts";

const TEMPORARY_ROOTS: string[] = [];
const SUITE_CAPABILITIES = [
	"conversation-ui",
	"tool-display",
	"context-management",
	"rtk",
	"codex",
	"goal",
	"web",
	"mcp",
	"background-work",
	"subagents",
	"todo",
	"btw",
	"notification",
	"code-mode",
];

async function createRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-safety-"));
	TEMPORARY_ROOTS.push(root);
	await Bun.$`git init --quiet ${root}`;
	await mkdir(join(root, "packages", "pi-stuff"), { recursive: true });
	await writeFile(
		join(root, "packages", "pi-stuff", "suite.json"),
		`${JSON.stringify({ capabilities: SUITE_CAPABILITIES }, null, "\t")}\n`,
	);
	await mkdir(join(root, "schemas"), { recursive: true });
	await writeFile(
		join(root, "schemas", "suite.schema.json"),
		`${JSON.stringify({ properties: { capabilities: { items: { enum: SUITE_CAPABILITIES } } } }, null, "\t")}\n`,
	);
	await writeFile(join(root, "README.md"), "Repository documentation.\n");
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify(
			{
				name: "fixture-root",
				private: true,
				packageManager: "bun@1.3.14",
				devDependencies: { typescript: "5.9.3" },
				trustedDependencies: [],
				workspaces: ["packages/pi-stuff"],
			},
			null,
			"\t",
		)}\n`,
	);
	await writeLocalPackage(root, {
		name: "@jczhang02/pi-stuff",
		private: true,
		files: ["index.ts", "src", "README.md", "LICENSE"],
		pi: { extensions: ["./index.ts"], themes: ["./themes/*.json"] },
	});
	return root;
}

async function writeLocalPackage(root: string, manifest: Record<string, unknown>): Promise<void> {
	await writeFile(join(root, "packages", "pi-stuff", "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("auditRepositoryFiles", () => {
	test("accepts one private local Pi Package with exact dependencies", async () => {
		const root = await createRepository();
		await writeLocalPackage(root, {
			name: "@jczhang02/pi-stuff",
			private: true,
			files: ["index.ts", "src", "README.md", "LICENSE"],
			pi: { extensions: ["./index.ts"], themes: ["./themes/*.json"] },
			dependencies: { "@cortexkit/pi-magic-context": "0.33.1", typebox: "1.3.10" },
		});

		expect(await auditRepositoryFiles(root)).toEqual([]);
	});

	test("rejects an unpinned source dependency", async () => {
		const root = await createRepository();
		await writeLocalPackage(root, {
			name: "@jczhang02/pi-stuff",
			private: true,
			files: ["index.ts", "src", "README.md", "LICENSE"],
			pi: { extensions: ["./index.ts"], themes: ["./themes/*.json"] },
			dependencies: {
				"@cortexkit/pi-magic-context": "https://github.com/cortexkit/magic-context/archive/refs/heads/main.tgz",
			},
		});

		expect(await auditRepositoryFiles(root)).toContainEqual({
			path: "packages/pi-stuff/package.json",
			rule: "direct-dependency-must-be-exact",
		});
	});

	test("rejects host state, private paths, and Package lifecycle side effects", async () => {
		const root = await createRepository();
		await writeFile(join(root, "auth.json"), "{}\n");
		await writeFile(
			join(root, "README.md"),
			`Local checkout: ${["", "home", "example", "private-suite"].join("/")}\n`,
		);
		await writeLocalPackage(root, {
			name: "@jczhang02/pi-stuff",
			private: true,
			files: ["index.ts", "src", "README.md", "LICENSE", "AGENTS.md"],
			pi: { extensions: ["./index.ts"], themes: ["./themes/*.json"] },
			scripts: { postinstall: "modify-host" },
		});

		expect(await auditRepositoryFiles(root)).toEqual([
			{ path: "README.md", rule: "private-absolute-path" },
			{ path: "auth.json", rule: "forbidden-host-state" },
			{ path: "packages/pi-stuff/package.json", rule: "package-files-allowlist" },
			{ path: "packages/pi-stuff/package.json", rule: "package-lifecycle-script" },
		]);
	});

	test("enforces the single private Package boundary", async () => {
		const root = await createRepository();
		await writeLocalPackage(root, {
			name: "@jczhang02/pi-stuff",
			files: ["index.ts", "../private.txt"],
			pi: { extensions: ["./extension.ts"] },
		});
		await mkdir(join(root, "packages", "pi-stuff", "src", "nested"), { recursive: true });
		await writeFile(join(root, "packages", "pi-stuff", "src", "nested", "package.json"), "{}\n");

		expect(await auditRepositoryFiles(root)).toEqual([
			{ path: "packages/pi-stuff/package.json", rule: "local-package-must-be-private" },
			{ path: "packages/pi-stuff/package.json", rule: "package-files-allowlist" },
			{ path: "packages/pi-stuff/package.json", rule: "package-pi-manifest" },
			{ path: "packages/pi-stuff/src/nested/package.json", rule: "unexpected-package-manifest" },
		]);
	});

	test("rejects ranged development dependencies and extra workspaces", async () => {
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
					workspaces: ["packages/*"],
				},
				null,
				"\t",
			)}\n`,
		);

		expect(await auditRepositoryFiles(root)).toEqual([
			{ path: "package.json", rule: "direct-dependency-must-be-exact" },
			{ path: "package.json", rule: "trusted-dependencies-must-be-empty" },
			{ path: "package.json", rule: "single-package-workspace" },
		]);
	});

	test("enforces the documented internal Module dependency direction", async () => {
		const root = await createRepository();
		await mkdir(join(root, "packages", "pi-stuff", "src", "conversation-ui"), { recursive: true });
		await mkdir(join(root, "packages", "pi-stuff", "src", "goal"), { recursive: true });
		await mkdir(join(root, "packages", "pi-stuff", "src", "subagents"), { recursive: true });
		await mkdir(join(root, "packages", "pi-stuff", "src", "code-mode"), { recursive: true });
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "conversation-ui", "index.ts"),
			'import goal from "../goal/index.js";\nexport default goal;\n',
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "subagents", "index.ts"),
			'import context from "../context-management/index.js";\nexport default context;\n',
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "code-mode", "index.ts"),
			'import type { Contract } from "../tool-display/contract.js";\nexport type Mode = Contract;\n',
		);

		expect(await auditRepositoryFiles(root)).toEqual([
			{
				path: "packages/pi-stuff/src/conversation-ui/index.ts",
				rule: "forbidden-internal-module-dependency:conversation-ui->goal",
			},
		]);
	});

	test("rejects runtime source that bypasses every owned internal Module", async () => {
		const root = await createRepository();
		await mkdir(join(root, "packages", "pi-stuff", "src"), { recursive: true });
		for (const name of ["lifecycle-deadline.ts", "lifecycle-performance.ts", "suite-loader.ts", "suite-runtime.ts"]) {
			await writeFile(join(root, "packages", "pi-stuff", "src", name), "export {};\n");
		}
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "global-coordinator.ts"),
			"export const coordinator = new Map();\n",
		);

		expect(await auditRepositoryFiles(root)).toContainEqual({
			path: "packages/pi-stuff/src/global-coordinator.ts",
			rule: "unowned-internal-source-module",
		});
	});

	test("keeps Suite composition and internal import policy in lockstep", async () => {
		const root = await createRepository();
		await writeFile(
			join(root, "packages", "pi-stuff", "suite.json"),
			`${JSON.stringify({ capabilities: [...SUITE_CAPABILITIES.filter((name) => name !== "code-mode"), "new-mode"] }, null, "\t")}\n`,
		);

		expect(await auditRepositoryFiles(root)).toEqual([
			{
				path: "packages/pi-stuff/suite.json",
				rule: "suite-capability-without-import-policy:new-mode",
			},
			{
				path: "packages/pi-stuff/suite.json",
				rule: "import-policy-module-missing-from-suite:code-mode",
			},
		]);
	});

	test("keeps the Suite schema and internal import policy in lockstep", async () => {
		const root = await createRepository();
		await writeFile(
			join(root, "schemas", "suite.schema.json"),
			`${JSON.stringify(
				{
					properties: {
						capabilities: {
							items: { enum: [...SUITE_CAPABILITIES.filter((name) => name !== "code-mode"), "new-mode"] },
						},
					},
				},
				null,
				"\t",
			)}\n`,
		);

		expect(await auditRepositoryFiles(root)).toEqual([
			{
				path: "schemas/suite.schema.json",
				rule: "suite-schema-capability-without-import-policy:new-mode",
			},
			{
				path: "schemas/suite.schema.json",
				rule: "import-policy-module-missing-from-suite-schema:code-mode",
			},
		]);
	});

	test("rejects raw console output from Host source but permits browser-owned output", async () => {
		const root = await createRepository();
		await mkdir(join(root, "packages", "pi-stuff", "src", "goal"), { recursive: true });
		await mkdir(join(root, "packages", "pi-stuff", "src", "mcp", "runtime"), { recursive: true });
		await mkdir(join(root, "packages", "pi-stuff", "src", "notification"), { recursive: true });
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "goal", "index.ts"),
			'console.warn("this would corrupt the Host TUI");\n',
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "goal", "stream.ts"),
			'process.stderr.write("this would also corrupt the Host TUI\\n");\n',
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "mcp", "runtime", "host-html-template.ts"),
			'export const html = `<script>console.error("browser-only")</script>`;\n',
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "notification", "transport.ts"),
			"export const notify = (bytes: string) => process.stdout.write(bytes);\n",
		);

		expect(await auditRepositoryFiles(root)).toEqual([
			{
				path: "packages/pi-stuff/src/goal/index.ts",
				rule: "raw-host-console-output",
			},
			{
				path: "packages/pi-stuff/src/goal/stream.ts",
				rule: "raw-host-stream-output",
			},
		]);
	});

	test("rejects literal Host colors but permits browser-owned palettes", async () => {
		const root = await createRepository();
		await mkdir(join(root, "packages", "pi-stuff", "src", "goal"), { recursive: true });
		await mkdir(join(root, "packages", "pi-stuff", "src", "web", "runtime"), { recursive: true });
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "goal", "index.ts"),
			'export const color = "38;2;203;166;247";\n',
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "goal", "ansi.ts"),
			`const code = "36";\nexport const fg = (text: string) => \`\\x1b[\${code}m\${text}\\x1b[0m\`;\n`,
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "goal", "style.ts"),
			`export const style = (code: "1" | "3" | "7", text: string) => \`\\x1b[\${code}m\${text}\\x1b[0m\`;\n`,
		);
		await writeFile(
			join(root, "packages", "pi-stuff", "src", "web", "runtime", "curator-page.ts"),
			'export const page = "body { color: #cba6f7; }";\n',
		);

		expect(await auditRepositoryFiles(root)).toEqual([
			{ path: "packages/pi-stuff/src/goal/ansi.ts", rule: "hard-coded-host-color" },
			{ path: "packages/pi-stuff/src/goal/index.ts", rule: "hard-coded-host-color" },
		]);
	});

	test("ignores tracked files deleted from the working tree", async () => {
		const root = await createRepository();
		const deletedPath = join(root, "README.md");
		await writeFile(deletedPath, `private path: ${["", "home", "example", "secret"].join("/")}\n`);
		Bun.spawnSync(["git", "add", "README.md"], { cwd: root });
		await rm(deletedPath);

		expect(await auditRepositoryFiles(root)).toEqual([]);
	});
});
