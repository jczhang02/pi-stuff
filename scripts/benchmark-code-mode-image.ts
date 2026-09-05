import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { codeModeHostBinaryPath } from "../packages/pi-stuff/src/code-mode/host/binary.js";
import { assertDecodableSupportedCodeModeImages } from "../packages/pi-stuff/src/code-mode/image-content.js";
import { type JsonValue, parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import {
	type Arm,
	analyzeSession,
	IMAGE_BENCHMARK_CODES as CODES,
	createChallengePng,
	evaluateImageBenchmark,
	failBenchmark as fail,
	type ImageBenchmarkCase,
	type ProviderObservation,
	parseProviderObservation,
	REQUIRED_HARD_SUCCESSES,
	REQUIRED_TOOL_SUCCESSES,
	type SessionAnalysis,
	sanitizeBenchmarkSearchQuery,
} from "./code-mode-image-benchmark-core.js";
import { waitForDetachedProcess } from "./detached-process.js";
import { CERTIFIED_PI_HOST_PROFILE } from "./pi-host-contract.js";
import { verifyPiHostVersion } from "./verify-pi-host-provenance.js";

const root = resolve(import.meta.dir, "..");
const observerExtension = join(root, "test/fixtures/code-mode-image-benchmark-observer.ts");
const PI_BINARY = process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi";
const PROVIDER = "openai-codex";
const MODEL = "gpt-5.6-luna";
const BASELINE_COMMIT = "65b6764";
const CANDIDATE_COMMIT = "59742b3";
const CASE_TIMEOUT_MS = 12 * 60_000;
const SESSIONS_PER_ARM = CODES.baseline.length;
interface CasePaths {
	readonly cache: string;
	readonly config: string;
	readonly data: string;
	readonly log: string;
	readonly project: string;
	readonly runtime: string;
	readonly sessions: string;
	readonly state: string;
	readonly tmp: string;
}
interface PackageIdentity {
	readonly commit: string;
	readonly tree: string;
}
interface BenchmarkArguments {
	readonly baselineRoot: string;
	readonly output: string;
}
interface ProcessResult {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly timedOut: boolean;
}
function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}
function git(rootPath: string, spec: string): string {
	const result = spawnSync("git", ["-C", rootPath, "rev-parse", spec], { encoding: "utf8" });
	if (result.status !== 0) fail(`cannot resolve ${spec}`);
	return result.stdout.trim();
}
function packageTree(rootPath: string, commit: string): PackageIdentity {
	const resolvedCommit = git(rootPath, commit);
	const expectedTree = git(rootPath, `${resolvedCommit}:packages/pi-stuff`);
	const currentTree = git(rootPath, "HEAD:packages/pi-stuff");
	if (currentTree !== expectedTree) fail(`package tree does not match preregistered commit ${resolvedCommit}`);
	return { commit: resolvedCommit, tree: currentTree };
}
async function verifyPackageImport(rootPath: string, label: string): Promise<void> {
	try {
		await import(join(rootPath, "packages/pi-stuff/index.ts"));
	} catch (cause) {
		fail(`${label} Package import preflight failed: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
async function files(directory: string): Promise<string[]> {
	const output: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) output.push(...(await files(path)));
		else output.push(path);
	}
	return output;
}
async function runPi(
	arguments_: readonly string[],
	cwd: string,
	environment: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
	const child = Bun.spawn([PI_BINARY, ...arguments_], {
		cwd,
		detached: true,
		env: environment,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [status, stdout] = await Promise.all([
		waitForDetachedProcess(child, CASE_TIMEOUT_MS),
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode: status.exitCode, timedOut: status.timedOut, stdout };
}
function cleanEnvironment(base: NodeJS.ProcessEnv, paths: CasePaths, phase: "image" | "resume"): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {
		...base,
		PI_OFFLINE: "1",
		PI_STUFF_CODE_MODE_DEFAULT: "on",
		PI_STUFF_CODE_MODE_HOST: codeModeHostBinaryPath(),
		PI_STUFF_CODE_MODE_IMAGE_BENCHMARK_LOG: paths["log"],
		PI_STUFF_CODE_MODE_IMAGE_BENCHMARK_PHASE: phase,
		PI_TELEMETRY: "0",
		PONYTAIL_DEFAULT_MODE: "off",
		PONYTAIL_QUIET_STARTUP: "1",
		TMPDIR: paths.tmp,
		XDG_CACHE_HOME: paths.cache,
		XDG_CONFIG_HOME: paths["config"],
		XDG_DATA_HOME: paths.data,
		XDG_RUNTIME_DIR: paths.runtime,
		XDG_STATE_HOME: paths.state,
	};
	for (const key of Object.keys(environment)) {
		if (
			key.startsWith("PI_SUBAGENT_PARENT_") ||
			key === "PI_STUFF_CODE_MODE_FROZEN" ||
			key === "PI_STUFF_PONYTAIL_MODE"
		)
			delete environment[key];
	}
	return environment;
}
function commonArguments(packageRoot: string, sessions: string, name: string): string[] {
	return [
		"--print",
		"--approve",
		"--offline",
		"--no-extensions",
		"--no-context-files",
		"--no-prompt-templates",
		"--no-skills",
		"--no-themes",
		"--extension",
		join(packageRoot, "packages/pi-stuff"),
		"--extension",
		observerExtension,
		"--provider",
		PROVIDER,
		"--model",
		MODEL,
		"--thinking",
		"medium",
		"--session-dir",
		sessions,
		"--name",
		name,
	];
}
async function observations(path: string): Promise<ProviderObservation[]> {
	const contents = await readFile(path, "utf8");
	return contents.split("\n").filter(Boolean).map(parseProviderObservation);
}
async function sessionEntries(sessionDirectory: string): Promise<JsonValue[]> {
	const sessionPaths = (await files(sessionDirectory)).filter((path) => path.endsWith(".jsonl"));
	if (sessionPaths.length !== 1 || !sessionPaths[0]) fail("case did not create exactly one Session");
	return (await readFile(sessionPaths[0], "utf8")).split("\n").filter(Boolean).map(parseJsonValue);
}
function lastLine(value: string): string {
	return (
		value
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.at(-1) ?? ""
	);
}
function safeAnswer(value: string): string {
	return /^[0-9A-Z_]{1,32}$/u.test(value) ? value : "<nonconforming>";
}

async function completedCase(
	arm: Arm,
	code: string,
	repetition: number,
	paths: CasePaths,
	expectedHash: string,
	first: ProcessResult,
	resumed: ProcessResult,
	analysis: SessionAnalysis,
): Promise<ImageBenchmarkCase> {
	const observed = await observations(paths.log);
	const imagePhase = observed.filter((item) => item.phase === "image");
	const resumePhase = observed.filter((item) => item.phase === "resume");
	const expectedToolSurface = (item: ProviderObservation) =>
		JSON.stringify(item.toolNames) === JSON.stringify(["codemode", "tool_search"]);
	const imageProviderEvidence = imagePhase.flatMap((item) => item.images);
	const resumeProviderEvidence = resumePhase.flatMap((item) => item.images);
	const transferExact =
		imageProviderEvidence.some((item) => item.valid && item.sha256 === expectedHash) &&
		imageProviderEvidence.every((item) => item.valid);
	const persistedHashes = analysis.imageBlocks.map((item) => sha256(Buffer.from(item.data, "base64")));
	const imagePersistedOnce =
		analysis.imageBlocks.length === 1 &&
		persistedHashes[0] === expectedHash &&
		analysis.imageBlocks[0]?.mimeType === "image/png";
	await assertDecodableSupportedCodeModeImages(
		analysis.imageBlocks.map((item) => ({ type: "image" as const, data: item.data, mimeType: item.mimeType })),
	);
	const toolChoice =
		analysis.nestedTools.includes("view_image") &&
		!analysis.nestedTools.includes("read") &&
		!analysis.nestedTools.includes("bash") &&
		!analysis.explicitImageHelper;
	const rawAnswer = lastLine(first.stdout);
	const understood = first.exitCode === 0 && !first.timedOut && rawAnswer === code;
	const sessionSafe =
		imagePersistedOnce &&
		resumed.exitCode === 0 &&
		!resumed.timedOut &&
		lastLine(resumed.stdout) === "SESSION_SAFE" &&
		resumeProviderEvidence.some((item) => item.valid && item.sha256 === expectedHash) &&
		resumeProviderEvidence.every((item) => item.valid);
	const instrumentationValid =
		imagePhase.length >= 2 &&
		resumePhase.length >= 1 &&
		observed.every((item) => item.nodes > 0 && item.payloadSha256.length === 64 && expectedToolSurface(item)) &&
		imagePhase.every((item) => item.codeModeDefinitionCharacters > 0) &&
		resumePhase.every((item) => item.codeModeDefinitionCharacters > 0);
	const providerToolDefinitionCharacters = Math.max(
		0,
		...observed.map((item) => item.providerToolDefinitionCharacters),
	);
	const endToEnd =
		instrumentationValid && toolChoice && transferExact && understood && sessionSafe && analysis.codeModeErrors === 0;
	return {
		answer: safeAnswer(rawAnswer),
		arm,
		code,
		codeModeErrors: analysis.codeModeErrors,
		endToEnd,
		explicitImageHelper: analysis.explicitImageHelper,
		firstExit: first.exitCode,
		imagePersistedOnce,
		instrumentationValid,
		nestedTools: analysis.nestedTools,
		providerEvidence: observed,
		providerRequests: observed.length,
		providerToolDefinitionCharacters,
		repetition,
		resumeExit: resumed.exitCode,
		searchQueries: analysis.searchQueries.map((query) => sanitizeBenchmarkSearchQuery(query, paths.project)),
		sessionImageCount: analysis.imageBlocks.length,
		sessionSafe,
		timedOut: first.timedOut || resumed.timedOut,
		toolChoice,
		transferExact,
		understood,
	};
}

async function runCase(
	benchmarkRoot: string,
	arm: Arm,
	code: string,
	repetition: number,
	sequence: number,
	packageRoot: string,
): Promise<ImageBenchmarkCase> {
	const caseRoot = join(benchmarkRoot, `case-${String(sequence).padStart(2, "0")}`);
	const paths = {
		cache: join(caseRoot, "cache"),
		config: join(caseRoot, "config"),
		data: join(caseRoot, "data"),
		log: join(caseRoot, "provider.jsonl"),
		project: join(caseRoot, "project"),
		runtime: join(caseRoot, "runtime"),
		sessions: join(caseRoot, "sessions"),
		state: join(caseRoot, "state"),
		tmp: join(caseRoot, "tmp"),
	};
	await Promise.all(
		[paths.cache, paths.config, paths.data, paths.project, paths.runtime, paths.sessions, paths.state, paths.tmp].map(
			(path) => mkdir(path, { recursive: true, mode: 0o700 }),
		),
	);
	await mkdir(join(paths["config"], "cortexkit"), { recursive: true, mode: 0o700 });
	await mkdir(join(paths["project"], ".pi"), { recursive: true, mode: 0o700 });
	const image = createChallengePng(code);
	const expectedHash = sha256(image);
	await assertDecodableSupportedCodeModeImages([
		{ type: "image", data: image.toString("base64"), mimeType: "image/png" },
	]);
	await Promise.all([
		writeFile(paths["log"], "", { mode: 0o600 }),
		writeFile(join(paths["project"], "challenge.png"), image, { mode: 0o600 }),
		writeFile(join(paths["project"], ".pi/code-mode.json"), '{"enabled":true}\n', { mode: 0o600 }),
		writeFile(
			join(paths["config"], "cortexkit/magic-context.jsonc"),
			'{"dreamer":{"disable":true},"embedding":{"provider":"off"},"fail_closed_blocking":false,"sidekick":{"disable":true}}\n',
			{ mode: 0o600 },
		),
	]);
	const name = `code-image-${arm}-${String(repetition).padStart(2, "0")}`;
	const sessionId = `019fdc10-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
	const shared = commonArguments(packageRoot, paths["sessions"], name);
	const prompt =
		"Inspect challenge.png with the available image Tool. Reply with exactly the six digits shown and nothing else. Do not use shell commands or encode the file as text.";
	let first: ProcessResult = { exitCode: null, stdout: "", timedOut: true };
	let resumed: ProcessResult = { exitCode: null, stdout: "", timedOut: true };
	try {
		first = await runPi(
			[...shared, "--session-id", sessionId, "--", prompt],
			paths["project"],
			cleanEnvironment(process.env, paths, "image"),
		);
		const entriesBeforeResume = await sessionEntries(paths["sessions"]);
		const analysis = analyzeSession(entriesBeforeResume);
		if (first.exitCode === 0 && !first.timedOut) {
			resumed = await runPi(
				[...shared, "--session", sessionId, "--", "Reply exactly SESSION_SAFE"],
				paths["project"],
				cleanEnvironment(process.env, paths, "resume"),
			);
		}
		return await completedCase(arm, code, repetition, paths, expectedHash, first, resumed, analysis);
	} catch {
		const observed = await observations(paths.log).catch(() => []);
		return {
			answer: safeAnswer(lastLine(first.stdout)),
			arm,
			code,
			codeModeErrors: 1,
			endToEnd: false,
			explicitImageHelper: false,
			firstExit: first.exitCode,
			imagePersistedOnce: false,
			instrumentationValid: false,
			nestedTools: [],
			providerEvidence: observed,
			providerRequests: observed.length,
			providerToolDefinitionCharacters: Math.max(
				0,
				...observed.map((item) => item.providerToolDefinitionCharacters),
			),
			repetition,
			resumeExit: resumed.exitCode,
			searchQueries: [],
			sessionImageCount: 0,
			sessionSafe: false,
			timedOut: first.timedOut || resumed.timedOut,
			toolChoice: false,
			transferExact: false,
			understood: false,
		};
	}
}
function parseArguments(arguments_: readonly string[]): BenchmarkArguments {
	let baselineRoot: string | undefined;
	let output: string | undefined;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		const value = arguments_[index + 1];
		if ((argument === "--baseline-root" || argument === "--output") && value) {
			if (argument === "--baseline-root") baselineRoot = value;
			else output = value;
			index += 1;
			continue;
		}
		fail("usage: bun run benchmark:code-mode-image --baseline-root <absolute-path> --output <absolute-path>");
	}
	if (!baselineRoot || !output || !isAbsolute(baselineRoot) || !isAbsolute(output))
		fail("baseline root and output must be absolute paths");
	return { baselineRoot, output };
}

if (import.meta.main) {
	const options = parseArguments(process.argv.slice(2));
	await verifyPiHostVersion(PI_BINARY);
	const baselinePackage = packageTree(options.baselineRoot, BASELINE_COMMIT);
	const candidatePackage = packageTree(root, CANDIDATE_COMMIT);
	await verifyPackageImport(options.baselineRoot, "baseline");
	await verifyPackageImport(root, "candidate");
	const benchmarkRoot = await mkdtemp(join(process.env["XDG_RUNTIME_DIR"] ?? tmpdir(), "pi-stuff-code-image-"));
	const cases: ImageBenchmarkCase[] = [];
	try {
		let sequence = 0;
		for (let index = 0; index < SESSIONS_PER_ARM; index += 1) {
			const arms: readonly Arm[] = index % 2 === 0 ? ["candidate", "baseline"] : ["baseline", "candidate"];
			for (const arm of arms) {
				const code = CODES[arm][index];
				if (!code) fail(`missing ${arm} challenge ${String(index + 1)}`);
				sequence += 1;
				process.stderr.write(
					`Code Mode image benchmark ${String(sequence)}/${String(SESSIONS_PER_ARM * 2)}: ${arm} ${String(index + 1)}\n`,
				);
				cases.push(
					await runCase(
						benchmarkRoot,
						arm,
						code,
						index + 1,
						sequence,
						arm === "baseline" ? options.baselineRoot : root,
					),
				);
			}
		}
		const evaluation = evaluateImageBenchmark(cases);
		const report = {
			completedAt: new Date().toISOString(),
			host: CERTIFIED_PI_HOST_PROFILE,
			model: `${PROVIDER}/${MODEL}`,
			packages: { baseline: baselinePackage, candidate: candidatePackage },
			preregistration: {
				codes: CODES,
				confidenceInterval: "Wilson score 95%",
				minimumEndToEnd: REQUIRED_TOOL_SUCCESSES,
				minimumHardGate: REQUIRED_HARD_SUCCESSES,
				minimumToolChoice: REQUIRED_TOOL_SUCCESSES,
				noExclusions: true,
				noRetries: true,
				sessionsPerArm: SESSIONS_PER_ARM,
			},
			cases,
			evaluation,
		};
		await mkdir(resolve(options.output, ".."), { recursive: true, mode: 0o700 });
		await writeFile(options.output, `${JSON.stringify(report, null, "\t")}\n`, { mode: 0o600 });
		console.log(JSON.stringify(report, null, "\t"));
		if (!evaluation.candidatePass) process.exitCode = 1;
	} finally {
		await rm(benchmarkRoot, { recursive: true, force: true });
	}
}
