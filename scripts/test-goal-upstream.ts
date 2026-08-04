import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..");
const outputDirectory = join(repositoryRoot, ".artifacts", "goal-upstream-tests");

await rm(outputDirectory, { recursive: true, force: true });
await run("bunx", ["tsc", "-p", "tsconfig.goal-upstream-run.json"], repositoryRoot);

const compiledWorkspaceScope = join(outputDirectory, "packages", "pi-stuff-goal", "node_modules", "@jczhang02");
await mkdir(compiledWorkspaceScope, { recursive: true });
const compiledToolsPackage = join(outputDirectory, "packages", "pi-stuff-tools");
await writeFile(
	join(compiledToolsPackage, "package.json"),
	`${JSON.stringify({ name: "@jczhang02/pi-stuff-tools", type: "module", exports: { ".": "./index.js", "./contract": "./contract.js" } })}\n`,
	"utf8",
);
await symlink(compiledToolsPackage, join(compiledWorkspaceScope, "pi-stuff-tools"), "dir");
const compiledUiPackage = join(outputDirectory, "test", "goal-upstream");
await writeFile(
	join(compiledUiPackage, "package.json"),
	`${JSON.stringify({ name: "@jczhang02/pi-stuff-ui", type: "module", exports: "./ui-node-shim.js" })}\n`,
	"utf8",
);
await symlink(compiledUiPackage, join(compiledWorkspaceScope, "pi-stuff-ui"), "dir");

const compiledTests = [...new Bun.Glob("test/goal-upstream/*.node.js").scanSync(outputDirectory)].sort();
if (compiledTests.length === 0) throw new Error("Goal upstream test compilation produced no Node test files");

for (const relativeTestPath of compiledTests) {
	await run("node", [relativeTestPath], outputDirectory);
}

await run("bun", ["test/goal-upstream/goal-runtime-smoke.mjs"], repositoryRoot);

async function run(command: string, arguments_: string[], cwd: string) {
	const process = Bun.spawn([command, ...arguments_], {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(`${command} ${arguments_.join(" ")} exited with status ${exitCode}`);
	}
}
