import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/agents-execution-matrix-provider.ts");
const PROCESS_TIMEOUT_MS = 30_000;
const BACKGROUND_SETTLE_TIMEOUT_MS = 20_000;

type ScenarioId =
	| "single-fresh-foreground"
	| "single-fork-background"
	| "parallel-fresh-background"
	| "parallel-fork-foreground"
	| "aggregate-fanout-foreground";

interface Scenario {
	readonly id: ScenarioId;
	readonly childCount: 1 | 2;
	readonly context: "fresh" | "fork";
	readonly foreground: boolean;
}

interface LogRecord {
	readonly at?: unknown;
	readonly kind?: unknown;
	readonly result?: unknown;
	readonly baseExtensionMatches?: unknown;
	readonly childBaseExtension?: unknown;
	readonly sawRootMarker?: unknown;
	readonly sawSuiteSurface?: unknown;
	readonly scenario?: unknown;
	readonly task?: unknown;
}

interface ProcessResult {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
	readonly timedOut: boolean;
}

export interface AgentsExecutionMatrixVerificationOptions {
	readonly packagePath: string;
	readonly piBinary: string;
}

const SCENARIOS: readonly Scenario[] = [
	{ id: "single-fresh-foreground", childCount: 1, context: "fresh", foreground: true },
	{ id: "single-fork-background", childCount: 1, context: "fork", foreground: false },
	{ id: "parallel-fresh-background", childCount: 2, context: "fresh", foreground: false },
	{ id: "parallel-fork-foreground", childCount: 2, context: "fork", foreground: true },
	{ id: "aggregate-fanout-foreground", childCount: 2, context: "fresh", foreground: true },
];

function fail(message: string): never {
	throw new Error(`Agents execution matrix verification failed: ${message}`);
}

async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

function verifyHostVersion(piBinary: string): void {
	const result = Bun.spawnSync([piBinary, "--version"], { stdout: "pipe", stderr: "pipe" });
	const version = result.stdout.toString().trim();
	if (result.exitCode !== 0 || version !== CERTIFIED_PI_VERSION) {
		fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version || `exit ${result.exitCode}`}`);
	}
}

async function runProcess(
	command: readonly string[],
	options: { readonly cwd: string; readonly env: Record<string, string | undefined> },
): Promise<ProcessResult> {
	const process = Bun.spawn([...command], {
		cwd: options.cwd,
		env: options.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = new Response(process.stdout).text();
	const stderr = new Response(process.stderr).text();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		process.kill("SIGTERM");
	}, PROCESS_TIMEOUT_MS);
	const exitCode = await process.exited;
	clearTimeout(timer);
	return { exitCode, stdout: await stdout, stderr: await stderr, timedOut };
}

export function parseCompleteLogRecords(contents: string): LogRecord[] {
	const completeEnd = contents.lastIndexOf("\n");
	if (completeEnd < 0) return [];
	return contents
		.slice(0, completeEnd)
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as LogRecord);
}

async function readRecords(logPath: string): Promise<LogRecord[]> {
	const contents = await readFile(logPath, "utf8").catch(() => "");
	return parseCompleteLogRecords(contents);
}

function scenarioRecords(records: readonly LogRecord[], scenario: ScenarioId): LogRecord[] {
	return records.filter((record) => record.scenario === scenario);
}

async function waitForScenario(logPath: string, scenario: Scenario): Promise<LogRecord[]> {
	const deadline = Date.now() + BACKGROUND_SETTLE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const records = scenarioRecords(await readRecords(logPath), scenario.id);
		const finished = records.filter((record) => record.kind === "child-finish").length;
		if (records.some((record) => record.kind === "main-result") && finished >= scenario.childCount) return records;
		await Bun.sleep(50);
	}
	return scenarioRecords(await readRecords(logPath), scenario.id);
}

function recordIndex(records: readonly LogRecord[], kind: string): number {
	return records.findIndex((record) => record.kind === kind);
}

function peakChildConcurrency(records: readonly LogRecord[]): number {
	let active = 0;
	let peak = 0;
	for (const record of records) {
		if (record.kind === "child-start") {
			active += 1;
			peak = Math.max(peak, active);
		} else if (record.kind === "child-finish" || record.kind === "child-abort") {
			active = Math.max(0, active - 1);
		}
	}
	return peak;
}

function verifyScenario(scenario: Scenario, records: readonly LogRecord[], processResult: ProcessResult): void {
	if (processResult.timedOut) fail(`${scenario.id} timed out\n${processResult.stderr}`);
	if (processResult.exitCode !== 0) {
		fail(
			`${scenario.id} exited ${processResult.exitCode}\nstdout:\n${processResult.stdout}\nstderr:\n${processResult.stderr}`,
		);
	}
	if (!processResult.stdout.includes(`MATRIX_MAIN_RESULT:${scenario.id}`)) {
		fail(`${scenario.id} did not complete the real main Pi turn\nstdout:\n${processResult.stdout}`);
	}

	const launches = records.filter((record) => record.kind === "main-launch");
	const mainResults = records.filter((record) => record.kind === "main-result");
	const starts = records.filter((record) => record.kind === "child-start");
	const finishes = records.filter((record) => record.kind === "child-finish");
	if (launches.length !== 1 || mainResults.length !== 1) {
		fail(`${scenario.id} expected one main launch and result, received ${launches.length} and ${mainResults.length}`);
	}
	if (starts.length !== scenario.childCount || finishes.length !== scenario.childCount) {
		fail(
			`${scenario.id} expected ${scenario.childCount} child starts/finishes, received ${starts.length}/${finishes.length}`,
		);
	}
	if (new Set(starts.map((record) => record.task)).size !== scenario.childCount) {
		fail(`${scenario.id} did not execute ${scenario.childCount} distinct direct-child tasks`);
	}

	for (const start of starts) {
		const expectedMarker = scenario.context === "fork";
		if (start.sawRootMarker !== expectedMarker) {
			fail(
				`${scenario.id} ${scenario.context} child observed root marker=${String(start.sawRootMarker)}; expected ${expectedMarker}`,
			);
		}
		if (start.sawSuiteSurface !== true) {
			fail(`${scenario.id} child did not inherit the Suite UI surface`);
		}
		if (start.baseExtensionMatches !== true) {
			fail(
				`${scenario.id} child base extension was ${String(start.childBaseExtension)}; expected the Suite Package entry`,
			);
		}
	}

	const mainResult = mainResults[0]?.result;
	if (typeof mainResult !== "string") fail(`${scenario.id} main Agent did not receive a textual subagent result`);
	if (scenario.foreground) {
		if (mainResult.includes("started in the background") || !mainResult.includes("completed")) {
			fail(`${scenario.id} did not return foreground child summaries to the main Agent: ${mainResult}`);
		}
	} else if (!mainResult.includes("started in the background")) {
		fail(`${scenario.id} did not return a background launch receipt to the main Agent: ${mainResult}`);
	}

	const mainResultIndex = recordIndex(records, "main-result");
	const childFinishIndexes = records
		.map((record, index) => ({ index, record }))
		.filter(({ record }) => record.kind === "child-finish")
		.map(({ index }) => index);
	if (mainResultIndex < 0 || childFinishIndexes.length !== scenario.childCount) {
		fail(`${scenario.id} has incomplete lifecycle ordering evidence`);
	}
	if (scenario.foreground && childFinishIndexes.some((index) => index > mainResultIndex)) {
		fail(`${scenario.id} main Agent continued before foreground children finished`);
	}
	if (!scenario.foreground && childFinishIndexes.some((index) => index < mainResultIndex)) {
		fail(`${scenario.id} background children finished before the main Agent received its launch receipt`);
	}
	if (scenario.childCount === 2 && peakChildConcurrency(records) < 2) {
		fail(
			`${scenario.id} parallel provider peak concurrency was ${peakChildConcurrency(records)}, expected at least 2`,
		);
	}
}

async function runScenario(input: {
	readonly configDirectory: string;
	readonly logPath: string;
	readonly packagePath: string;
	readonly piBinary: string;
	readonly projectDirectory: string;
	readonly scenario: Scenario;
	readonly sessionsDirectory: string;
	readonly temporaryDirectory: string;
}): Promise<void> {
	const marker = `ROOT_CONTEXT_MARKER_${input.scenario.id}_${randomUUID()}`;
	const result = await runProcess(
		[
			input.piBinary,
			"--offline",
			"--approve",
			"--no-extensions",
			"--no-skills",
			"--no-context-files",
			"--extension",
			resolve(input.packagePath),
			"--extension",
			providerExtension,
			"--provider",
			"pi-stuff-agents-execution-matrix",
			"--model",
			"fixture-model",
			"--session-dir",
			input.sessionsDirectory,
			"--session-id",
			`agents-execution-matrix-${input.scenario.id}`,
			"--print",
			`Execute the deterministic ${input.scenario.id} matrix scenario. Private root marker: ${marker}`,
		],
		{
			cwd: input.projectDirectory,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: input.configDirectory,
				PI_SUBAGENT_PI_BINARY: input.piBinary,
				PI_STUFF_AGENTS_EXECUTION_MATRIX_LOG: input.logPath,
				PI_STUFF_AGENTS_EXECUTION_MATRIX_EXPECTED_BASE_EXTENSION: join(resolve(input.packagePath), "index.ts"),
				PI_STUFF_AGENTS_EXECUTION_MATRIX_ROOT_MARKER: marker,
				PI_STUFF_AGENTS_EXECUTION_MATRIX_SCENARIO: input.scenario.id,
				TERM: "xterm-256color",
				TMPDIR: input.temporaryDirectory,
				XDG_STATE_HOME: join(input.temporaryDirectory, "state"),
			},
		},
	);
	const records = await waitForScenario(input.logPath, input.scenario);
	verifyScenario(input.scenario, records, result);
}

export async function verifyAgentsExecutionMatrix(options: AgentsExecutionMatrixVerificationOptions): Promise<void> {
	verifyHostVersion(options.piBinary);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-agents-execution-matrix-"));
	const configDirectory = join(temporaryDirectory, "config");
	const agentsDirectory = join(configDirectory, "agents");
	const projectDirectory = join(temporaryDirectory, "project");
	const sessionsDirectory = join(temporaryDirectory, "sessions");
	const logPath = join(temporaryDirectory, "provider.jsonl");
	await Promise.all([mkdir(agentsDirectory, { recursive: true }), mkdir(projectDirectory), mkdir(sessionsDirectory)]);
	await writeFile(
		join(agentsDirectory, "matrix-agent.md"),
		`---
name: matrix-agent
description: Deterministic real Pi execution-matrix Agent.
model: pi-stuff-agents-execution-matrix/fixture-model
subagentOnlyExtensions: ${providerExtension}
maxSubagentDepth: 2
systemPromptMode: append
inheritProjectContext: false
inheritSkills: false
---
Return the deterministic matrix result without calling tools.
`,
		{ mode: 0o600 },
	);

	try {
		for (const scenario of SCENARIOS) {
			await runScenario({
				configDirectory,
				logPath,
				packagePath: options.packagePath,
				piBinary: options.piBinary,
				projectDirectory,
				scenario,
				sessionsDirectory,
				temporaryDirectory,
			});
		}
	} catch (error) {
		const log = await readFile(logPath, "utf8").catch(() => "(provider log unavailable)");
		throw new Error(`${error instanceof Error ? error.message : String(error)}\nProvider log:\n${log}`, {
			cause: error,
		});
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
		if (await pathExists(temporaryDirectory)) fail("temporary verification directory was not removed");
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyAgentsExecutionMatrix({ piBinary: PI_BIN, packagePath: join(root, "packages/pi-stuff") });
	console.log("Certified Agents single/parallel, fresh/fork, foreground/background execution matrix");
}
