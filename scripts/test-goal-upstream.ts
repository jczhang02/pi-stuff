import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..");
const outputDirectory = join(repositoryRoot, ".artifacts", "goal-upstream-tests");

await rm(outputDirectory, { recursive: true, force: true });
await run("bunx", ["tsc", "-p", "tsconfig.goal-upstream-run.json"], repositoryRoot);

await writeFile(
	join(outputDirectory, "packages/pi-stuff/src/conversation-ui/index.js"),
	`export * from "../../../../test/goal-upstream/ui-node-shim.js";\n`,
);

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
