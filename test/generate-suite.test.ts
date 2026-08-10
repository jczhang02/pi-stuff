import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSuite } from "../scripts/generate-suite.ts";

const TEMPORARY_ROOTS: string[] = [];

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

async function createRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-generator-"));
	TEMPORARY_ROOTS.push(root);
	await mkdir(join(root, "packages", "pi-stuff"), { recursive: true });
	await writeJson(join(root, "packages", "pi-stuff", "package.json"), {
		name: "@jczhang02/pi-stuff",
		private: true,
		dependencies: { typebox: "1.3.10" },
	});
	await writeJson(join(root, "packages", "pi-stuff", "suite.json"), {
		schemaVersion: 2,
		capabilities: ["conversation-ui", "subagents", "btw"],
		tools: [],
	});
	return root;
}

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generateSuite", () => {
	test("writes one ordered Extension from internal Capability Modules", async () => {
		const root = await createRepository();
		const manifestPath = join(root, "packages", "pi-stuff", "package.json");
		const originalManifest = await readFile(manifestPath, "utf8");

		const result = await generateSuite(root, "write");
		const generated = await readFile(join(root, "packages", "pi-stuff", "index.ts"), "utf8");

		expect(result.changedFiles).toEqual(["packages/pi-stuff/index.ts"]);
		expect(generated).toContain('import conversationUi from "./src/conversation-ui/index.js";');
		expect(generated).toContain('import subagents from "./src/subagents/index.js";');
		expect(generated).toContain('import btw from "./src/btw/index.js";');
		expect(generated).toContain("return subagents(pi, { childBaseExtensionPath: CHILD_BASE_EXTENSION_PATH });");
		expect(generated).toContain(
			"const CAPABILITIES: readonly CapabilityFactory[] = [conversationUi, registerSuiteSubagents, btw];",
		);
		expect(await readFile(manifestPath, "utf8")).toBe(originalManifest);
	});

	test("generates a fail-fast Activity coverage gate for declared Suite Tools", async () => {
		const root = await createRepository();
		await writeJson(join(root, "packages", "pi-stuff", "suite.json"), {
			schemaVersion: 2,
			capabilities: ["conversation-ui", "tool-display"],
			tools: ["read", "write"],
			deferredTools: ["ctx_search"],
			optionalTools: ["intercom"],
		});

		await generateSuite(root, "write");
		const generated = await readFile(join(root, "packages", "pi-stuff", "index.ts"), "utf8");
		expect(generated).toContain("import toolDisplay, {");
		expect(generated).toContain("\tassertSuiteToolActivityCoverage,");
		expect(generated).toContain("\tcreateSuiteToolRegistrationTracker,");
		expect(generated).toContain('const SUITE_TOOL_NAMES = ["read", "write"] as const;');
		expect(generated).toContain('const DEFERRED_SUITE_TOOL_NAMES = ["ctx_search"] as const;');
		expect(generated).toContain('const OPTIONAL_SUITE_TOOL_NAMES = ["intercom"] as const;');
		expect(generated).toContain("await capability(registrations.api);");
		expect(generated).toContain("assertSuiteToolActivityCoverage(");
	});

	test("rejects unknown Modules and overlapping Tool inventories", async () => {
		const root = await createRepository();
		await writeJson(join(root, "packages", "pi-stuff", "suite.json"), {
			schemaVersion: 2,
			capabilities: ["separate-package"],
			tools: [],
		});
		await expect(generateSuite(root, "write")).rejects.toThrow("Unknown Capability Module: separate-package");

		await writeJson(join(root, "packages", "pi-stuff", "suite.json"), {
			schemaVersion: 2,
			capabilities: ["tool-display"],
			tools: ["read"],
			optionalTools: ["read"],
		});
		await expect(generateSuite(root, "write")).rejects.toThrow("Suite Tool inventories overlap at read");
	});

	test("wires Code Mode after ordinary capabilities with the shared Tool registry", async () => {
		const root = await createRepository();
		await writeJson(join(root, "packages", "pi-stuff", "suite.json"), {
			schemaVersion: 2,
			capabilities: ["tool-display", "code-mode"],
			tools: ["read"],
		});

		await generateSuite(root, "write");
		const generated = await readFile(join(root, "packages", "pi-stuff", "index.ts"), "utf8");
		expect(generated).toContain(
			'import codeMode, { registerCodeModeContextProjection } from "./src/code-mode/index.js";',
		);
		expect(generated).toContain("const CAPABILITIES: readonly CapabilityFactory[] = [toolDisplay];");
		expect(generated).toContain("\tregisterCodeModeContextProjection(pi);");
		expect(generated).toContain(`\tcodeMode(registrations.api, {
\t\tregistry: registrations.registry,
\t\tsurface: registrations.surface,
\t});`);
		expect(generated.indexOf("await capability(registrations.api)")).toBeLessThan(
			generated.indexOf("codeMode(registrations.api"),
		);
		expect(generated.indexOf("registerCodeModeContextProjection(pi)")).toBeLessThan(
			generated.indexOf("await capability(registrations.api)"),
		);
	});

	test("reports generated drift without rewriting the working tree", async () => {
		const root = await createRepository();
		const indexPath = join(root, "packages", "pi-stuff", "index.ts");
		await generateSuite(root, "write");
		await writeFile(indexPath, "stale\n");

		await expect(generateSuite(root, "check")).rejects.toThrow(
			"Generated Suite files are stale: packages/pi-stuff/index.ts",
		);
		expect(await readFile(indexPath, "utf8")).toBe("stale\n");
	});
});
