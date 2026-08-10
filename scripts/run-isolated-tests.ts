import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;

function discoverTestFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...discoverTestFiles(path));
		else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) files.push(path);
	}
	return files.sort();
}

function main(): void {
	const repositoryRoot = process.cwd();
	const testRoot = resolve(repositoryRoot, "test");
	const testFiles = discoverTestFiles(testRoot).map((path) => relative(repositoryRoot, path));
	if (testFiles.length === 0) {
		console.error("No test files were discovered under test/.");
		process.exitCode = 1;
		return;
	}

	const failures: string[] = [];
	console.log(`Running ${testFiles.length} test files in isolated Bun processes.`);

	for (const [index, testFile] of testFiles.entries()) {
		const title = `[${index + 1}/${testFiles.length}] ${testFile}`;
		const githubGroup = process.env["GITHUB_ACTIONS"] === "true";
		if (githubGroup) console.log(`::group::${title}`);
		else console.log(`\n${title}`);

		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", "--timeout", "30000", testFile],
			cwd: repositoryRoot,
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});

		if (githubGroup) console.log("::endgroup::");
		if (result.exitCode !== 0) failures.push(testFile);
	}

	if (failures.length > 0) {
		console.error(`\n${failures.length} isolated test file(s) failed:`);
		for (const testFile of failures) console.error(`- ${testFile}`);
		process.exitCode = 1;
		return;
	}

	console.log(`\nAll ${testFiles.length} isolated test files passed.`);
}

if (import.meta.main) main();
