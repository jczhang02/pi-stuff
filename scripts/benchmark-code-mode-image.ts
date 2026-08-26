import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { codeModeHostBinaryPath } from "../packages/pi-stuff/src/code-mode/host/binary.js";
import { assertDecodableSupportedCodeModeImages } from "../packages/pi-stuff/src/code-mode/image-content.js";
import { type JsonObject, type JsonValue, parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { waitForDetachedProcess } from "./detached-process.js";
import { CERTIFIED_PI_HOST_PROFILE } from "./pi-host-contract.js";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.js";

const root = resolve(import.meta.dir, "..");
const observerExtension = join(root, "test/fixtures/code-mode-image-benchmark-observer.ts");
const PI_BINARY = process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi";
const PROVIDER = "openai-codex";
const MODEL = "gpt-5.6-sol";
const BASELINE_COMMIT = "65b6764";
const CANDIDATE_COMMIT = "4487a06";
const CASE_TIMEOUT_MS = 12 * 60_000;
const REQUIRED_TOOL_SUCCESSES = 18;
const REQUIRED_HARD_SUCCESSES = 20;
const CODES = [
	"731905",
	"284167",
	"609352",
	"418730",
	"952641",
	"367824",
	"805219",
	"146593",
	"573086",
	"920475",
	"238761",
	"694028",
	"351972",
	"782436",
	"469105",
	"817354",
	"205687",
	"936412",
	"542809",
	"173648",
] as const;
const DIGITS = [
	["11111", "10001", "10011", "10101", "11001", "10001", "11111"],
	["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
	["11111", "00001", "00001", "11111", "10000", "10000", "11111"],
	["11111", "00001", "00001", "01111", "00001", "00001", "11111"],
	["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
	["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
	["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
	["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
	["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
	["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
] as const;

type Arm = "baseline" | "candidate";

const IMAGE_OBSERVATION_SCHEMA = Type.Object({
	bytes: Type.Number(),
	mimeType: Type.String(),
	sha256: Type.String(),
	valid: Type.Boolean(),
});
const PROVIDER_OBSERVATION_SCHEMA = Type.Object({
	codeModeDefinitionCharacters: Type.Number(),
	imageCount: Type.Number(),
	images: Type.Array(IMAGE_OBSERVATION_SCHEMA),
	nodes: Type.Number(),
	payloadBytes: Type.Number(),
	payloadSha256: Type.String(),
	phase: Type.Union([Type.Literal("image"), Type.Literal("resume")]),
	providerToolDefinitionCharacters: Type.Number(),
	toolNames: Type.Array(Type.String()),
});
type ProviderObservation = Static<typeof PROVIDER_OBSERVATION_SCHEMA>;
export interface ImageBenchmarkCase {
	readonly answer: string;
	readonly arm: Arm;
	readonly code: string;
	readonly codeModeErrors: number;
	readonly endToEnd: boolean;
	readonly explicitImageHelper: boolean;
	readonly firstExit: number | null;
	readonly imagePersistedOnce: boolean;
	readonly instrumentationValid: boolean;
	readonly nestedTools: readonly string[];
	readonly providerEvidence: readonly ProviderObservation[];
	readonly providerRequests: number;
	readonly providerToolDefinitionCharacters: number;
	readonly repetition: number;
	readonly resumeExit: number | null;
	readonly searchQueries: readonly string[];
	readonly sessionSafe: boolean;
	readonly timedOut: boolean;
	readonly toolChoice: boolean;
	readonly transferExact: boolean;
	readonly understood: boolean;
}
interface ArmMetrics {
	readonly endToEnd: Metric;
	readonly sessionSafe: Metric;
	readonly toolChoice: Metric;
	readonly transferExact: Metric;
	readonly understood: Metric;
}
interface Metric {
	readonly interval95: readonly [number, number];
	readonly successes: number;
	readonly total: number;
}
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
interface SessionAnalysis {
	readonly codeModeErrors: number;
	readonly explicitImageHelper: boolean;
	readonly imageBlocks: readonly { readonly data: string; readonly mimeType: string }[];
	readonly nestedTools: readonly string[];
	readonly searchQueries: readonly string[];
}

function fail(message: string): never {
	throw new Error(`Code Mode image benchmark failed: ${message}`);
}
function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}
function crc32(value: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of value) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
	const name = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
	return Buffer.concat([length, name, data, checksum]);
}
export function createChallengePng(code: string): Buffer {
	if (!/^\d{6}$/u.test(code)) fail("challenge code must contain exactly six digits");
	const scale = 8;
	const margin = 12;
	const gap = 8;
	const width = margin * 2 + code.length * 5 * scale + (code.length - 1) * gap;
	const height = margin * 2 + 7 * scale;
	const rows = Buffer.alloc((width + 1) * height, 255);
	for (let y = 0; y < height; y += 1) rows[y * (width + 1)] = 0;
	for (const [digitIndex, digit] of [...code].entries()) {
		const glyph = DIGITS[Number(digit)];
		if (!glyph) fail(`missing glyph ${digit}`);
		for (const [rowIndex, row] of glyph.entries()) {
			for (const [columnIndex, pixel] of [...row].entries()) {
				if (pixel !== "1") continue;
				for (let dy = 0; dy < scale; dy += 1) {
					const y = margin + rowIndex * scale + dy;
					for (let dx = 0; dx < scale; dx += 1) {
						const x = margin + digitIndex * (5 * scale + gap) + columnIndex * scale + dx;
						rows[y * (width + 1) + x + 1] = 0;
					}
				}
			}
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 0, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(rows)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
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
function jsonObject(value: JsonValue | undefined): JsonObject | undefined {
	if (value === null || Array.isArray(value) || !isRuntimeObject(value)) return undefined;
	return value;
}
function analyzeSession(entries: readonly JsonValue[]): SessionAnalysis {
	const imageBlocks: { data: string; mimeType: string }[] = [];
	const nestedTools: string[] = [];
	const searchQueries: string[] = [];
	let codeModeErrors = 0;
	let explicitImageHelper = false;
	function visit(value: JsonValue): void {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const record = jsonObject(value);
		if (!record) return;
		if (record["type"] === "image" && isRuntimeString(record["data"]) && isRuntimeString(record["mimeType"])) {
			imageBlocks.push({ data: record["data"], mimeType: record["mimeType"] });
		}
		if (record["kind"] === "pi-stuff-code-mode") {
			if (record["status"] !== "success") codeModeErrors += 1;
			const operations = record["operations"];
			if (Array.isArray(operations)) {
				for (const operation of operations) {
					const operationRecord = jsonObject(operation);
					if (operationRecord && isRuntimeString(operationRecord["name"]))
						nestedTools.push(operationRecord["name"]);
				}
			}
		}
		const arguments_ = jsonObject(record["arguments"]);
		if (record["type"] === "toolCall" && record["name"] === "codemode" && arguments_) {
			const source = arguments_["code"];
			if (isRuntimeString(source) && /\bimage\s*\(/u.test(source)) explicitImageHelper = true;
		}
		if (record["type"] === "toolCall" && record["name"] === "tool_search" && arguments_) {
			const query = arguments_["query"];
			if (isRuntimeString(query)) searchQueries.push(query);
		}
		for (const item of Object.values(record)) visit(item);
	}
	for (const entry of entries) visit(entry);
	return {
		codeModeErrors,
		explicitImageHelper,
		imageBlocks,
		nestedTools: [...new Set(nestedTools)],
		searchQueries: [...new Set(searchQueries)],
	};
}
function observation(line: string): ProviderObservation {
	const value: unknown = JSON.parse(line);
	if (!Check(PROVIDER_OBSERVATION_SCHEMA, value)) fail("observer emitted malformed JSON");
	return value;
}
async function observations(path: string): Promise<ProviderObservation[]> {
	const contents = await readFile(path, "utf8");
	return contents.split("\n").filter(Boolean).map(observation);
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
		const observed = await observations(paths["log"]);
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
			instrumentationValid &&
			toolChoice &&
			transferExact &&
			understood &&
			sessionSafe &&
			analysis.codeModeErrors === 0;
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
			searchQueries: analysis.searchQueries,
			sessionSafe,
			timedOut: first.timedOut || resumed.timedOut,
			toolChoice,
			transferExact,
			understood,
		};
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
			sessionSafe: false,
			timedOut: first.timedOut || resumed.timedOut,
			toolChoice: false,
			transferExact: false,
			understood: false,
		};
	}
}
function interval95(successes: number, total: number): readonly [number, number] {
	if (total === 0) return [0, 1];
	const z = 1.959963984540054;
	const proportion = successes / total;
	const denominator = 1 + (z * z) / total;
	const center = (proportion + (z * z) / (2 * total)) / denominator;
	const margin =
		(z / denominator) * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total));
	return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
function metric(
	cases: readonly ImageBenchmarkCase[],
	key: keyof Pick<ImageBenchmarkCase, "endToEnd" | "sessionSafe" | "toolChoice" | "transferExact" | "understood">,
): Metric {
	const successes = cases.filter((item) => item[key]).length;
	return { successes, total: cases.length, interval95: interval95(successes, cases.length) };
}
function armMetrics(cases: readonly ImageBenchmarkCase[]): ArmMetrics {
	return {
		endToEnd: metric(cases, "endToEnd"),
		sessionSafe: metric(cases, "sessionSafe"),
		toolChoice: metric(cases, "toolChoice"),
		transferExact: metric(cases, "transferExact"),
		understood: metric(cases, "understood"),
	};
}
export function evaluateImageBenchmark(cases: readonly ImageBenchmarkCase[]) {
	const baselineCases = cases.filter((item) => item.arm === "baseline");
	const candidateCases = cases.filter((item) => item.arm === "candidate");
	const baseline = armMetrics(baselineCases);
	const candidate = armMetrics(candidateCases);
	const baselineDefinitions = baselineCases
		.map((item) => item.providerToolDefinitionCharacters)
		.filter((value) => value > 0);
	const candidateDefinitions = candidateCases
		.map((item) => item.providerToolDefinitionCharacters)
		.filter((value) => value > 0);
	const standingContextNoIncrease =
		baselineDefinitions.length === CODES.length &&
		candidateDefinitions.length === CODES.length &&
		Math.max(...candidateDefinitions) <= Math.min(...baselineDefinitions);
	return {
		baseline,
		candidate,
		standingContextNoIncrease,
		candidatePass:
			candidateCases.length === CODES.length &&
			candidateCases.every(
				(item) => item.instrumentationValid && item.imagePersistedOnce && item.codeModeErrors === 0,
			) &&
			candidate.transferExact.successes >= REQUIRED_HARD_SUCCESSES &&
			candidate.sessionSafe.successes >= REQUIRED_HARD_SUCCESSES &&
			candidate.toolChoice.successes >= REQUIRED_TOOL_SUCCESSES &&
			candidate.understood.successes >= REQUIRED_TOOL_SUCCESSES &&
			candidate.endToEnd.successes >= REQUIRED_TOOL_SUCCESSES &&
			standingContextNoIncrease,
	};
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
	await verifyPiHostProvenance(PI_BINARY);
	const baselinePackage = packageTree(options.baselineRoot, BASELINE_COMMIT);
	const candidatePackage = packageTree(root, CANDIDATE_COMMIT);
	const benchmarkRoot = await mkdtemp(join(process.env["XDG_RUNTIME_DIR"] ?? tmpdir(), "pi-stuff-code-image-"));
	const cases: ImageBenchmarkCase[] = [];
	try {
		let sequence = 0;
		for (const [index, code] of CODES.entries()) {
			const arms: readonly Arm[] = index % 2 === 0 ? ["candidate", "baseline"] : ["baseline", "candidate"];
			for (const arm of arms) {
				sequence += 1;
				process.stderr.write(
					"Code Mode image benchmark " +
						String(sequence) +
						"/" +
						String(CODES.length * 2) +
						": " +
						arm +
						" " +
						String(index + 1) +
						"\n",
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
				sessionsPerArm: CODES.length,
			},
			cases,
			evaluation,
		};
		await mkdir(resolve(options.output, ".."), { recursive: true, mode: 0o700 });
		await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
		console.log(JSON.stringify(report, null, 2));
		if (!evaluation.candidatePass) process.exitCode = 1;
	} finally {
		await rm(benchmarkRoot, { recursive: true, force: true });
	}
}
