import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { codeModeHostBinaryPath } from "../packages/pi-stuff/src/code-mode/host/binary.js";
import { requireJsonInputValue } from "../packages/pi-stuff/src/shared/json-value.js";
import {
	CERTIFIED_PI_HOST_PROFILE,
	CERTIFIED_PI_RELEASE_BINARY_SHA256,
	CERTIFIED_PI_RELEASE_BINARY_SIZE,
	CERTIFIED_PI_VERSION,
} from "./pi-host-contract.js";
import {
	evaluateSkillDiscoveryBenchmark,
	parseSkillDiscoveryManifest,
	type SkillDiscoveryManifest,
	type SkillDiscoveryObservation,
	serializeSkillDiscoveryManifest,
} from "./skill-discovery-benchmark-core.js";
import { assertSanitizedSkillDiscoveryReport } from "./skill-discovery-benchmark-report.js";
import { runSkillDiscoverySession } from "./skill-discovery-benchmark-session.js";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.js";

const ROOT = resolve(import.meta.dir, "..");
const PROVIDER = "openai-codex";
const MODEL = "gpt-5.6-sol";
const REASONING = "xhigh";
const MANIFEST_PATH = "test/fixtures/skill-discovery-benchmark-manifest.jsonl";
const OBSERVER_PATH = "test/fixtures/skill-discovery-benchmark-observer.ts";
const LOCK_PATH = "test/fixtures/skill-discovery-benchmark-run-lock.json";
const REPORT_PATH = "docs/reports/skill-discovery-benchmark-20260830.json";
const PACKAGE_EXTENSION = "packages/pi-stuff/index.ts";
const RUNNER_SOURCES = [
	"scripts/benchmark-skill-discovery.ts",
	"scripts/pi-rpc-client.ts",
	"scripts/skill-discovery-benchmark-core.ts",
	"scripts/skill-discovery-benchmark-evidence.ts",
	"scripts/skill-discovery-benchmark-report.ts",
	"scripts/skill-discovery-benchmark-session.ts",
] as const;
const execFileAsync = promisify(execFile);

const LOCKED_SOURCE_SCHEMA = Type.Object({
	path: Type.String(),
	sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});
const RUN_LOCK_SCHEMA = Type.Object({
	candidateCommit: Type.String({ pattern: "^[0-9a-f]{40}$" }),
	candidatePackageTree: Type.String({ pattern: "^[0-9a-f]{40}$" }),
	host: Type.Object({
		binarySha256: Type.String(),
		binarySize: Type.Number(),
		profile: Type.String(),
		version: Type.String(),
	}),
	manifest: LOCKED_SOURCE_SCHEMA,
	model: Type.String(),
	observer: LOCKED_SOURCE_SCHEMA,
	provider: Type.String(),
	reasoning: Type.String(),
	reportPath: Type.String(),
	runnerSources: Type.Array(LOCKED_SOURCE_SCHEMA),
	schemaVersion: Type.Literal(1),
});
const AUTH_CHECK_SCHEMA = Type.Object(
	{ provider: Type.String(), status: Type.String() },
	{ additionalProperties: true },
);
const ERROR_CODE_SCHEMA = Type.Object({ code: Type.Optional(Type.String()) }, { additionalProperties: true });

type SkillDiscoveryRunLock = Static<typeof RUN_LOCK_SCHEMA>;

interface CliOptions {
	readonly auth?: string;
	readonly prepareManifest: boolean;
}

function fail(message: string): never {
	throw new Error(`Skill Discovery benchmark failed: ${message}`);
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

async function fileSha256(path: string): Promise<string> {
	return sha256(await readFile(path));
}

function parseRunLock(text: string): SkillDiscoveryRunLock {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		fail("Run Lock is not valid JSON");
	}
	if (!Check(RUN_LOCK_SCHEMA, value)) fail("Run Lock is incomplete or malformed");
	return value;
}

function git(...arguments_: string[]): string {
	const result = Bun.spawnSync(["git", ...arguments_], { cwd: ROOT, stderr: "pipe", stdout: "pipe" });
	if (result.exitCode !== 0) fail("Git provenance check failed");
	return result.stdout.toString("utf8").trim();
}

async function verifyLockedSources(lock: SkillDiscoveryRunLock): Promise<void> {
	if (JSON.stringify(lock.runnerSources.map((source) => source.path)) !== JSON.stringify(RUNNER_SOURCES))
		fail("Run Lock runner source list does not match the executable harness");
	for (const source of lock.runnerSources) {
		if ((await fileSha256(join(ROOT, source.path))) !== source.sha256)
			fail(`Run Lock source hash mismatch: ${source.path}`);
	}
	if (lock.observer.path !== OBSERVER_PATH || (await fileSha256(join(ROOT, OBSERVER_PATH))) !== lock.observer.sha256)
		fail("Run Lock observer mismatch");
	if (lock.manifest.path !== MANIFEST_PATH || (await fileSha256(join(ROOT, MANIFEST_PATH))) !== lock.manifest.sha256)
		fail("Run Lock manifest mismatch");
}

async function verifyAuthentication(piBinary: string, authFile: string): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-skill-discovery-auth-"));
	try {
		const agent = join(root, "agent");
		await mkdir(agent, { recursive: true, mode: 0o700 });
		await copyFile(authFile, join(agent, "auth.json"));
		await chmod(join(agent, "auth.json"), 0o600);
		const { stdout } = await execFileAsync(
			piBinary,
			["auth", "check", "--provider", PROVIDER, "--json", "--no-refresh"],
			{
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: agent,
					XDG_CACHE_HOME: join(root, "cache"),
					XDG_CONFIG_HOME: join(root, "config"),
					XDG_DATA_HOME: join(root, "data"),
					XDG_STATE_HOME: join(root, "state"),
				},
				timeout: 30_000,
			},
		);
		const result: unknown = JSON.parse(stdout);
		if (!Check(AUTH_CHECK_SCHEMA, result) || result.status !== "ready" || result.provider !== PROVIDER)
			fail("authentication is not ready for the locked Provider");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Skill Discovery benchmark failed:")) throw error;
		fail("authentication preflight failed");
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

async function preflight(
	authFile: string,
	piBinary: string,
): Promise<{
	readonly codeModeHost: string;
	readonly lock: SkillDiscoveryRunLock;
	readonly manifest: SkillDiscoveryManifest;
}> {
	await verifyPiHostProvenance(piBinary);
	if (!isAbsolute(authFile) || !(await lstat(authFile)).isFile()) fail("--auth must name an absolute regular file");
	const lock = parseRunLock(await readFile(join(ROOT, LOCK_PATH), "utf8"));
	if (
		lock.provider !== PROVIDER ||
		lock.model !== MODEL ||
		lock.reasoning !== REASONING ||
		lock.reportPath !== REPORT_PATH ||
		lock.host.version !== CERTIFIED_PI_VERSION ||
		lock.host.profile !== CERTIFIED_PI_HOST_PROFILE ||
		lock.host.binarySha256 !== CERTIFIED_PI_RELEASE_BINARY_SHA256 ||
		lock.host.binarySize !== CERTIFIED_PI_RELEASE_BINARY_SIZE
	)
		fail("Run Lock does not match the preregistered Host/model/report configuration");
	if (git("status", "--porcelain=v1", "--untracked-files=all")) fail("candidate worktree is dirty");
	const currentPackageTree = git("rev-parse", "HEAD:packages/pi-stuff");
	const lockedCommitTree = git("rev-parse", `${lock.candidateCommit}:packages/pi-stuff`);
	if (currentPackageTree !== lock.candidatePackageTree || lockedCommitTree !== lock.candidatePackageTree)
		fail("candidate Package tree does not match the Run Lock");
	await verifyLockedSources(lock);
	const manifest = parseSkillDiscoveryManifest(await readFile(join(ROOT, MANIFEST_PATH), "utf8"));
	try {
		await access(join(ROOT, REPORT_PATH));
		fail("sanitized report destination already exists");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Skill Discovery benchmark failed:")) throw error;
		if (!Check(ERROR_CODE_SCHEMA, error) || error.code !== "ENOENT")
			fail("cannot verify the sanitized report destination");
	}
	const codeModeHost = codeModeHostBinaryPath();
	if (!(await lstat(codeModeHost)).isFile()) fail("the pinned Code Mode host is not installed");
	await verifyAuthentication(piBinary, authFile);
	return { codeModeHost, lock, manifest };
}

function failedObservation(
	task: SkillDiscoveryManifest["tasks"][number],
	arm: SkillDiscoveryObservation["arm"],
	sequence: number,
	durationMs: number,
): SkillDiscoveryObservation {
	return {
		answerExact: false,
		arm,
		automaticSelection: false,
		catalogExact: false,
		detourFree: false,
		durationMs,
		failureClass: "process",
		family: task.family,
		instrumentationViolation: true,
		nestedOperations: 0,
		primarySuccess: false,
		processFailure: true,
		promptBoundaryViolation: true,
		protectedFileViolation: false,
		providerRequests: 0,
		providerToolNames: [],
		providerToolsExact: false,
		readExact: false,
		resourceReadExact: false,
		safetyViolation: false,
		sequence,
		skillHashExact: false,
		taskId: task.id,
		timedOut: false,
		tokenTotal: 0,
		toolCalls: 0,
	};
}

async function writeReport(
	manifest: SkillDiscoveryManifest,
	lock: SkillDiscoveryRunLock,
	observations: readonly SkillDiscoveryObservation[],
	benchmarkRoot: string,
): Promise<string> {
	const armOrdersExact = manifest.tasks.every(
		(task) => task.armOrder.length === 3 && new Set(task.armOrder).size === 3,
	);
	const evaluation = evaluateSkillDiscoveryBenchmark(observations, {
		armSchedule: armOrdersExact,
		host: true,
		manifest: true,
		providerConfiguration: true,
		reportPrivacyViolations: 0,
		source: true,
	});
	const report = {
		completedAt: new Date().toISOString(),
		evaluation,
		fixtures: manifest.tasks.map((task) => ({ family: task.family, fixtureHash: task.fixtureHash, taskId: task.id })),
		identities: {
			candidateCommit: lock.candidateCommit,
			candidatePackageTree: lock.candidatePackageTree,
			host: lock.host,
			manifestSha256: lock.manifest.sha256,
			model: MODEL,
			observerSha256: lock.observer.sha256,
			provider: PROVIDER,
			reasoning: REASONING,
			runnerSources: lock.runnerSources,
		},
		observations,
		plan: { bootstrapIterations: 20_000, seed: manifest.seed, sessions: 90, tasks: 30 },
		schemaVersion: 1,
		study: "skill-discovery-real-model-benchmark",
	};
	const reportValue = requireJsonInputValue(report, "Skill Discovery benchmark report");
	assertSanitizedSkillDiscoveryReport(reportValue, manifest, [benchmarkRoot]);
	const serialized = `${JSON.stringify(reportValue, null, 2)}\n`;
	const destination = join(ROOT, REPORT_PATH);
	await writeFile(destination, serialized, { flag: "wx", mode: 0o600 });
	const written = requireJsonInputValue(
		JSON.parse(await readFile(destination, "utf8")),
		"Skill Discovery benchmark report",
	);
	assertSanitizedSkillDiscoveryReport(written, manifest, [benchmarkRoot]);
	return sha256(serialized);
}

async function runBenchmark(authFile: string): Promise<void> {
	const piBinary = process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi";
	const { codeModeHost, lock, manifest } = await preflight(authFile, piBinary);
	const benchmarkRoot = await mkdtemp(join(tmpdir(), "pi-stuff-skill-discovery-benchmark-"));
	await chmod(benchmarkRoot, 0o700);
	const benchmarkAuth = join(benchmarkRoot, "auth.json");
	await copyFile(authFile, benchmarkAuth);
	await chmod(benchmarkAuth, 0o600);
	const observations: SkillDiscoveryObservation[] = [];
	try {
		let sequence = 0;
		for (const task of manifest.tasks) {
			for (const arm of task.armOrder) {
				sequence += 1;
				const startedAt = Date.now();
				let observation: SkillDiscoveryObservation;
				try {
					observation = await runSkillDiscoverySession({
						arm,
						authFile: benchmarkAuth,
						caseRoot: join(benchmarkRoot, `case-${String(sequence).padStart(2, "0")}`),
						codeModeHost,
						model: MODEL,
						observerExtension: join(ROOT, OBSERVER_PATH),
						packageExtension: join(ROOT, PACKAGE_EXTENSION),
						piBinary,
						provider: PROVIDER,
						reasoning: REASONING,
						sequence,
						task,
					});
				} catch {
					observation = failedObservation(task, arm, sequence, Date.now() - startedAt);
				}
				try {
					if (!observation.safetyViolation) {
						await copyFile(
							join(benchmarkRoot, `case-${String(sequence).padStart(2, "0")}`, "agent", "auth.json"),
							benchmarkAuth,
						);
						await chmod(benchmarkAuth, 0o600);
					}
				} catch {
					observation = {
						...observation,
						failureClass: "instrumentation",
						instrumentationViolation: true,
						primarySuccess: false,
					};
				}
				observations.push(observation);
				process.stderr.write(
					`[${String(sequence)}/90] ${task.id} ${arm}: ${observation.primarySuccess ? "success" : observation.failureClass}\n`,
				);
			}
		}
		const reportSha256 = await writeReport(manifest, lock, observations, benchmarkRoot);
		process.stdout.write(`Skill Discovery benchmark report ${reportSha256}\n`);
	} finally {
		await rm(benchmarkRoot, { force: true, recursive: true });
	}
}

function cli(arguments_: readonly string[]): CliOptions {
	if (arguments_.length === 1 && arguments_[0] === "--prepare-manifest") return { prepareManifest: true };
	if (arguments_.length === 2 && arguments_[0] === "--auth" && arguments_[1])
		return { auth: arguments_[1], prepareManifest: false };
	fail("usage: bun run benchmark:skill-discovery --prepare-manifest | --auth <absolute-auth-file>");
}

export async function prepareSkillDiscoveryManifest(): Promise<string> {
	const serialized = serializeSkillDiscoveryManifest();
	await writeFile(join(ROOT, MANIFEST_PATH), serialized, { mode: 0o644 });
	return sha256(serialized);
}

if (import.meta.main) {
	const options = cli(process.argv.slice(2));
	if (options.prepareManifest) process.stdout.write(`${await prepareSkillDiscoveryManifest()}\n`);
	else if (options.auth) await runBenchmark(options.auth);
}
