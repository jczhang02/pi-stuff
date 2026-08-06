import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateSuite } from "../scripts/generate-suite.ts";
import { runPiRpcSmoke } from "../scripts/smoke-pi.ts";

const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;
const TEMPORARY_ROOTS: string[] = [];

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`);
}

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Pi loads a Capability through the generated Aggregate", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-aggregate-host-"));
	TEMPORARY_ROOTS.push(root);
	const aggregateDirectory = join(root, "packages", "pi-stuff");
	const capabilityDirectory = join(root, "packages", "pi-smoke");

	await writeJson(join(aggregateDirectory, "package.json"), {
		name: "@jczhang02/pi-stuff",
		version: "0.0.0",
		type: "module",
		pi: { extensions: ["./index.ts"] },
		dependencies: {},
		bundledDependencies: [],
	});
	await writeJson(join(aggregateDirectory, "suite.json"), {
		schemaVersion: 1,
		capabilities: ["@jczhang02/pi-smoke"],
		tools: [],
	});
	await writeJson(join(capabilityDirectory, "package.json"), {
		name: "@jczhang02/pi-smoke",
		version: "0.0.1",
		type: "module",
	});
	await writeFile(
		join(capabilityDirectory, "index.ts"),
		`import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function smokeCapability(pi: ExtensionAPI): void {
\tpi.registerCommand("pi-stuff-aggregate-smoke", {
\t\tdescription: "Observe generated Aggregate loading",
\t\thandler: () => {},
\t});
}
`,
	);
	await generateSuite(root, "write");
	const dependencyPath = join(aggregateDirectory, "node_modules", "@jczhang02", "pi-smoke");
	await mkdir(dirname(dependencyPath), { recursive: true });
	await symlink(capabilityDirectory, dependencyPath, "dir");

	const result = await runPiRpcSmoke({ piBinary: PI_BINARY, packages: [aggregateDirectory] });

	expect(result.commandNames).toContain("pi-stuff-aggregate-smoke");
	expect(result.stderr).toBe("");
});
