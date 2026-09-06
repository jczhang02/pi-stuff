import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareGoalTests } from "./test-goal-upstream.ts";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;

function discoverTestFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...discoverTestFiles(path));
		else if (
			entry.isFile() &&
			(TEST_FILE_PATTERN.test(entry.name) ||
				entry.name.endsWith(".node.ts") ||
				entry.name === "goal-runtime-smoke.mjs")
		)
			files.push(path);
	}
	return files.sort();
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			help: { type: "boolean", short: "h" },
			list: { type: "boolean" },
			file: { type: "string", multiple: true },
			output: { type: "string" },
		},
	});
	if (values.help) {
		console.log("Usage: bun run test [--file <path-fragment>] [file ...] [--list] [--output <report.json>]");
		console.log("Offline tests, one OS process per file. --list previews without executing tests.");
		return;
	}
	const repositoryRoot = process.cwd();
	const testRoot = resolve(repositoryRoot, "test");
	const filters = [...(values.file ?? []), ...positionals];
	if (filters.some((filter) => filter.length === 0)) throw new Error("File selectors must not be empty");
	const discovered = discoverTestFiles(testRoot).map((path) => relative(repositoryRoot, path));
	for (const filter of filters) {
		if (!discovered.some((path) => path.includes(filter))) throw new Error(`No test files match: ${filter}`);
	}
	const testFiles = discovered.filter(
		(path) => filters.length === 0 || filters.some((filter) => path.includes(filter)),
	);
	if (testFiles.length === 0) {
		console.error("No test files were discovered under test/.");
		process.exitCode = 1;
		return;
	}

	const reportPath = resolve(
		values.output ?? `.artifacts/tests/${new Date().toISOString().replaceAll(":", "-")}.json`,
	);
	console.log(`Profile: offline; credentials and live Providers are not used. Report: ${reportPath}`);
	console.log(`Selected ${testFiles.length} test files, each in its own Bun or Node OS process.`);
	if (values.list) {
		console.log(testFiles.join("\n"));
		return;
	}
	const results: { file: string; exitCode: number; durationMs: number }[] = [];
	const nodeRoot = testFiles.some((path) => path.endsWith(".node.ts"))
		? await prepareGoalTests(repositoryRoot)
		: repositoryRoot;

	for (const [index, testFile] of testFiles.entries()) {
		const title = `[${index + 1}/${testFiles.length}] ${testFile}`;
		const githubGroup = process.env["GITHUB_ACTIONS"] === "true";
		if (githubGroup) console.log(`::group::${title}`);
		else console.log(`\n${title}`);

		const started = performance.now();
		const nodeTest = testFile.endsWith(".node.ts");
		const command = nodeTest
			? ["node", testFile.replace(/\.ts$/u, ".js")]
			: testFile.endsWith(".mjs")
				? [process.execPath, testFile]
				: [process.execPath, "test", "--timeout", "30000", testFile];
		const result = Bun.spawnSync({
			cmd: command,
			cwd: nodeTest ? nodeRoot : repositoryRoot,
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});

		if (githubGroup) console.log("::endgroup::");
		results.push({ file: testFile, exitCode: result.exitCode, durationMs: performance.now() - started });
	}
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify({ profile: "offline", results }, null, 2)}\n`);
	const failures = results.filter((result) => result.exitCode !== 0).map((result) => result.file);

	if (failures.length > 0) {
		console.error(`\n${failures.length} isolated test file(s) failed:`);
		for (const testFile of failures) console.error(`- ${testFile}`);
		process.exitCode = 1;
		return;
	}

	console.log(`\nAll ${testFiles.length} isolated test files passed.`);
}

if (import.meta.main) await main();
