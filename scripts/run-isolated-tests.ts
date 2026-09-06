import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { preflightTests, requirementsForTest, type TestProfile } from "./test-environment.ts";
import { prepareGoalTests } from "./test-goal-upstream.ts";
import { discoverTestFiles } from "./test-inventory.ts";

const LEVELS = new Set(["unit", "component-integration", "system", "system-integration", "acceptance"]);
type VerificationPlan = {
	version: number;
	profile: "offline";
	base: string | null;
	head: string | null;
	mode: "all" | "selected" | "none";
	reason: string;
	changedFiles: string[];
	files: string[];
};
function readPlan(path: string, root: string): VerificationPlan {
	const plan = JSON.parse(readFileSync(resolve(root, path), "utf8")) as Partial<VerificationPlan>;
	if (plan.version !== 1 || plan.profile !== "offline" || !["all", "selected", "none"].includes(plan.mode ?? ""))
		throw new Error("Invalid verification plan");
	if (!Array.isArray(plan.files) || !Array.isArray(plan.changedFiles) || typeof plan.reason !== "string")
		throw new Error("Invalid verification plan fields");
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	if (plan.head && plan.head !== head)
		throw new Error(`Verification plan is stale: expected ${plan.head}, found ${head}`);
	const known = new Set(discoverTestFiles(join(root, "test")).map((file) => relative(root, file)));
	for (const file of plan.files)
		if (typeof file !== "string" || !known.has(file) || file.endsWith("-live.test.ts"))
			throw new Error(`Verification plan contains unknown or live test: ${file}`);
	if (plan.mode === "none" && plan.files.length !== 0) throw new Error("A none verification plan must have no files");
	if (plan.mode === "none" && !/metadata-only|no tests|explicit/iu.test(plan.reason))
		throw new Error("A none verification plan requires an explicit no-tests reason");
	if (plan.mode !== "none" && plan.files.length === 0) throw new Error("A selected/all plan must contain files");
	return plan as VerificationPlan;
}

function runTestFiles(
	testFiles: readonly string[],
	options: {
		nodeRoot: string;
		repositoryRoot: string;
		nativeDirectory: string;
		names: readonly string[];
		profile: TestProfile;
	},
) {
	const { nodeRoot, repositoryRoot, nativeDirectory, names, profile } = options;
	const results: { file: string; exitCode: number; durationMs: number; executed: number; skipped: number }[] = [];
	for (const [index, testFile] of testFiles.entries()) {
		const title = `[${index + 1}/${testFiles.length}] ${testFile}`;
		const githubGroup = process.env["GITHUB_ACTIONS"] === "true";
		if (githubGroup) console.log(`::group::${title}`);
		else console.log(`\n${title}`);

		const started = performance.now();
		const nodeTest = testFile.endsWith(".node.ts");
		const nameArgs = names.length > 0 ? ["--test-name-pattern", `(?:${names.join(")|(?:")})`] : [];
		const nativeReport = join(nativeDirectory, `${index}.junit.xml`);
		rmSync(nativeReport, { force: true });
		const command = nodeTest
			? [
					"node",
					...nameArgs,
					"--test-reporter=spec",
					"--test-reporter-destination=stdout",
					"--test-reporter=junit",
					`--test-reporter-destination=${nativeReport}`,
					testFile.replace(/\.ts$/u, ".js"),
				]
			: [
					process.execPath,
					"test",
					"--timeout",
					"30000",
					...(names.length ? ["--pass-with-no-tests"] : []),
					"--reporter=junit",
					`--reporter-outfile=${nativeReport}`,
					...nameArgs,
					`./${testFile}`,
				];
		const result = Bun.spawnSync({
			cmd: command,
			cwd: nodeTest ? nodeRoot : repositoryRoot,
			env: {
				...process.env,
				PI_BIN: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
				PI_STUFF_TEST_PROFILE: profile,
			},
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});

		if (githubGroup) console.log("::endgroup::");
		const nativeOutput = existsSync(nativeReport) ? readFileSync(nativeReport, "utf8") : "";
		const skipped = (nativeOutput.match(/<skipped\b/gu) ?? []).length;
		const executed = Math.max(0, (nativeOutput.match(/<testcase\b/gu) ?? []).length - skipped);
		results.push({
			file: testFile,
			exitCode: result.exitCode || (!nativeOutput || (names.length === 0 && executed === 0) ? 1 : 0),
			durationMs: performance.now() - started,
			executed,
			skipped,
		});
	}
	return results;
}

function parseTestArguments(args: string[]) {
	return parseArgs({
		args,
		allowPositionals: true,
		options: {
			help: { type: "boolean", short: "h" },
			list: { type: "boolean" },
			file: { type: "string", multiple: true },
			level: { type: "string", multiple: true },
			capability: { type: "string", multiple: true },
			name: { type: "string", multiple: true },
			output: { type: "string" },
			profile: { type: "string" },
			plan: { type: "string" },
		},
	});
}

async function main(): Promise<void> {
	const { values, positionals } = parseTestArguments(process.argv.slice(2));
	if (values.help) {
		console.log(
			"Usage: bun run test [--level <level>] [--capability <name>] [--name <pattern>] [--file <path-fragment>] [file ...] [--list] [--profile offline|live] [--output <report.json>]",
		);
		console.log("Offline tests, one OS process per file. --list previews without executing tests.");
		return;
	}
	const profile = values.profile ?? "offline";
	if (profile !== "offline" && profile !== "live") throw new Error(`Unknown test profile: ${profile}`);
	const repositoryRoot = process.cwd();
	const testRoot = resolve(repositoryRoot, "test");
	const filters = [...(values.file ?? []), ...positionals];
	const levels = values.level ?? [];
	const capabilities = values.capability ?? [];
	const names = values.name ?? [];
	const plan = values.plan ? readPlan(values.plan, repositoryRoot) : undefined;
	if (plan && ([...filters, ...levels, ...capabilities, ...names].length > 0 || values.profile))
		throw new Error("--plan cannot be combined with test selectors or --profile");
	for (const level of levels) if (!LEVELS.has(level)) throw new Error(`Unknown test level: ${level}`);
	if ([...filters, ...capabilities, ...names].some((filter) => filter.length === 0))
		throw new Error("Test selectors must not be empty");
	const discovered = (plan ? plan.files.map((file) => resolve(repositoryRoot, file)) : discoverTestFiles(testRoot))
		.map((path) => relative(repositoryRoot, path))
		.filter((path) => (profile === "live" ? path.endsWith("-live.test.ts") : !path.endsWith("-live.test.ts")));
	for (const filter of filters) {
		if (!discovered.some((path) => path.includes(filter))) throw new Error(`No test files match: ${filter}`);
	}
	for (const capability of capabilities) {
		if (!discovered.some((path) => path.split("/")[2] === capability))
			throw new Error(`No test files match capability: ${capability}`);
	}
	for (const name of names) {
		try {
			new RegExp(name, "u");
		} catch {
			throw new Error(`Invalid test name pattern: ${name}`);
		}
	}
	const testFiles = discovered.filter((path) => {
		const parts = path.split("/");
		return (
			(filters.length === 0 || filters.some((filter) => path.includes(filter))) &&
			(levels.length === 0 || levels.includes(parts[1] ?? "")) &&
			(capabilities.length === 0 || capabilities.includes(parts[2] ?? ""))
		);
	});
	if (testFiles.length === 0) {
		if (plan?.mode === "none") {
			console.log(`Plan selected no tests: ${plan.reason}`);
			return;
		}
		console.error("No test files were discovered under test/.");
		process.exitCode = 1;
		return;
	}

	const reportPath = resolve(
		values.output ?? `.artifacts/tests/${new Date().toISOString().replaceAll(":", "-")}.json`,
	);
	console.log(
		`Profile: ${profile}; ${profile === "offline" ? "no live Providers" : "live Provider calls"}. Report: ${reportPath}`,
	);
	console.log(`Selected ${testFiles.length} test files, each in its own Bun or Node OS process.`);
	if (values.list) {
		console.log(testFiles.map((file) => `${file} [${requirementsForTest(file).join(", ")}]`).join("\n"));
		if (names.length)
			console.log(
				`Name patterns ${JSON.stringify(names)} are applied by the native runner; listed files are candidates.`,
			);
		return;
	}
	mkdirSync(dirname(reportPath), { recursive: true });
	try {
		await preflightTests(testFiles, profile);
	} catch (error) {
		writeFileSync(
			reportPath,
			`${JSON.stringify({ profile, status: "preflight-failed", files: testFiles, error: String(error), results: [] }, null, 2)}\n`,
		);
		throw error;
	}
	const setupStarted = performance.now();
	const nativeDirectory = `${reportPath}.native`;
	mkdirSync(nativeDirectory, { recursive: true });
	const nodeRoot = testFiles.some((path) => path.endsWith(".node.ts"))
		? await prepareGoalTests(repositoryRoot)
		: repositoryRoot;

	const setupDurationMs = performance.now() - setupStarted;
	const results = runTestFiles(testFiles, { nodeRoot, repositoryRoot, nativeDirectory, names, profile });
	writeFileSync(
		reportPath,
		`${JSON.stringify(
			{
				profile,
				setupDurationMs,
				scope: { levels, capabilities, names, files: testFiles },
				results,
				totals: {
					nativeExecuted: results.reduce((sum, result) => sum + result.executed, 0),
					skipped: results.reduce((sum, result) => sum + result.skipped, 0),
					durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
				},
			},
			null,
			2,
		)}\n`,
	);
	const failures = results.filter((result) => result.exitCode !== 0).map((result) => result.file);

	if (failures.length > 0) {
		console.error(`\n${failures.length} isolated test file(s) failed:`);
		for (const testFile of failures) console.error(`- ${testFile}`);
		process.exitCode = 1;
		return;
	}
	if (names.length > 0 && results.every((result) => result.executed === 0)) {
		console.error("No tests matched the requested name pattern(s).");
		process.exitCode = 1;
		return;
	}

	console.log(`\nAll ${testFiles.length} isolated test files passed.`);
}

if (import.meta.main) await main();
