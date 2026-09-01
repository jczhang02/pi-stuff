import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isJsonInputObject, parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isFiniteRuntimeNumber } from "../packages/pi-stuff/src/shared/runtime-type.js";
import {
	balancedArmOrder,
	compareMeasurements,
	EFFECT_MAINLINE_THRESHOLDS,
	type NamedMeasurement,
} from "./effect-mainline-benchmark-core.js";
import { type LifecycleComparisonPlanName, runLifecycleComparison } from "./effect-mainline-lifecycle.js";

type Arm = "baseline" | "candidate";
type Profile = "import" | "lifecycle";

interface Options {
	readonly baselineRoot: string;
	readonly candidateRoot: string;
	readonly deadlineAt: number;
	readonly lifecyclePlan: LifecycleComparisonPlanName;
	readonly output: string;
	readonly piBinary: string;
	readonly profile: Profile;
	readonly samples: number;
	readonly warmups: number;
}

interface ImportProbe {
	readonly contextSwitches: number;
	readonly cpuMs: number;
	readonly durationMs: number;
	readonly fsRead: number;
	readonly fsWrite: number;
	readonly maxRssKiB: number;
}

interface ImportSample extends ImportProbe {
	readonly arm: Arm;
	readonly iteration: number;
	readonly warmup: boolean;
}

interface ImportProfileRun {
	readonly complete: boolean;
	readonly samples: readonly ImportSample[];
}

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_OUTPUT = join(ROOT, ".artifacts/effect-mainline-comparison/import.json");
const DEFAULT_PI_BINARY = "/opt/pi-coding-agent/pi";
const RATIO_METRICS = ["durationMs", "cpuMs", "maxRssKiB", "contextSwitches"] as const;

function fail(message: string): never {
	throw new Error(`Effect/mainline benchmark failed: ${message}`);
}

function boundedInteger(
	value: string | undefined,
	flag: string,
	fallback: number,
	minimum: number,
	maximum = 100,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		fail(`${flag} must be an integer from ${String(minimum)} through ${String(maximum)}`);
	}
	return parsed;
}

function parseOptions(arguments_: readonly string[]): Options {
	let baselineRoot = process.env["PI_STUFF_BENCHMARK_BASELINE"];
	let candidateRoot = process.cwd();
	let lifecyclePlan: LifecycleComparisonPlanName = "coverage";
	let maxMinutes = 240;
	let output = DEFAULT_OUTPUT;
	let piBinary = process.env["PI_BIN"] ?? DEFAULT_PI_BINARY;
	let profile: Profile = "import";
	let samples = 15;
	let warmups = 3;
	for (let index = 0; index < arguments_.length; index += 1) {
		const flag = arguments_[index];
		const value = arguments_[index + 1];
		switch (flag) {
			case "--baseline-root":
				if (!value) fail("--baseline-root requires a path");
				baselineRoot = value;
				index += 1;
				break;
			case "--candidate-root":
				if (!value) fail("--candidate-root requires a path");
				candidateRoot = value;
				index += 1;
				break;
			case "--output":
				if (!value) fail("--output requires a path");
				output = resolve(value);
				index += 1;
				break;
			case "--lifecycle-plan":
				if (value !== "coverage" && value !== "precision" && value !== "smoke") {
					fail("--lifecycle-plan requires coverage, precision, or smoke");
				}
				lifecyclePlan = value;
				index += 1;
				break;
			case "--max-minutes":
				maxMinutes = boundedInteger(value, flag, maxMinutes, 1, 240);
				index += 1;
				break;
			case "--pi":
				if (!value) fail("--pi requires a path");
				piBinary = resolve(value);
				index += 1;
				break;
			case "--profile":
				if (value !== "import" && value !== "lifecycle") fail("--profile requires import or lifecycle");
				profile = value;
				index += 1;
				break;
			case "--samples":
				samples = boundedInteger(value, flag, samples, 3);
				index += 1;
				break;
			case "--warmups":
				warmups = boundedInteger(value, flag, warmups, 0);
				index += 1;
				break;
			default:
				fail(`unknown argument: ${String(flag)}`);
		}
	}
	if (!baselineRoot) fail("pass --baseline-root or PI_STUFF_BENCHMARK_BASELINE");
	return {
		baselineRoot: resolve(baselineRoot),
		candidateRoot: resolve(candidateRoot),
		deadlineAt: Date.now() + maxMinutes * 60_000,
		lifecyclePlan,
		output,
		piBinary,
		profile,
		samples,
		warmups,
	};
}

function gitText(root: string, arguments_: readonly string[]): string {
	const result = Bun.spawnSync(["git", "-C", root, ...arguments_], { stderr: "pipe", stdout: "pipe" });
	if (result.exitCode !== 0) fail(`git ${arguments_.join(" ")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString().trim();
}

function armIdentity(root: string) {
	return {
		commit: gitText(root, ["rev-parse", "HEAD"]),
		dirty: gitText(root, ["status", "--porcelain"]).length > 0,
	};
}

function parseImportProbe(output: string): ImportProbe {
	const marker = "PS_EFFECT_IMPORT ";
	const lines = output.split("\n");
	let line: string | undefined;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const candidate = lines[index];
		if (candidate?.startsWith(marker)) {
			line = candidate;
			break;
		}
	}
	if (!line) fail("fresh import emitted no resource probe");
	const document = parseJsonValue(line.slice(marker.length));
	if (!isJsonInputObject(document)) fail("fresh import resource probe must be an object");
	const read = (name: keyof ImportProbe): number => {
		const value = document[name];
		if (!isFiniteRuntimeNumber(value) || value < 0) fail(`fresh import resource probe has invalid ${name}`);
		return value;
	};
	return {
		contextSwitches: read("contextSwitches"),
		cpuMs: read("cpuMs"),
		durationMs: read("durationMs"),
		fsRead: read("fsRead"),
		fsWrite: read("fsWrite"),
		maxRssKiB: read("maxRssKiB"),
	};
}

function freshImport(root: string): ImportProbe {
	const moduleUrl = pathToFileURL(join(root, "packages/pi-stuff/src/suite-runtime.ts")).href;
	const source = `
const started = performance.now();
await import(${JSON.stringify(moduleUrl)});
const durationMs = performance.now() - started;
const usage = process.resourceUsage();
process.stdout.write("PS_EFFECT_IMPORT " + JSON.stringify({
  contextSwitches: usage.voluntaryContextSwitches + usage.involuntaryContextSwitches,
  cpuMs: (usage.userCPUTime + usage.systemCPUTime) / 1000,
  durationMs,
  fsRead: usage.fsRead,
  fsWrite: usage.fsWrite,
  maxRssKiB: usage.maxRSS,
}) + "\\n");
`;
	const result = Bun.spawnSync([process.execPath, "-e", source], {
		cwd: root,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) fail(`fresh import failed: ${result.stderr.toString().trim().slice(-2_000)}`);
	return parseImportProbe(result.stdout.toString());
}

function measurementsOf(samples: readonly ImportSample[]): NamedMeasurement[] {
	return samples.flatMap((sample) =>
		sample.warmup
			? []
			: RATIO_METRICS.map((metric) => ({
					arm: sample.arm,
					iteration: sample.iteration,
					key: "fresh-suite-runtime-import",
					metric,
					value: sample[metric],
				})),
	);
}

function runImportProfile(options: Options): ImportProfileRun {
	const roots = { baseline: options.baselineRoot, candidate: options.candidateRoot } as const;
	const samples: ImportSample[] = [];
	for (let run = 0; run < options.warmups + options.samples; run += 1) {
		const warmup = run < options.warmups;
		const iteration = warmup ? run : run - options.warmups;
		const arms = balancedArmOrder(["baseline", "candidate"] as const, run);
		for (const arm of arms) {
			if (Date.now() >= options.deadlineAt) return { complete: false, samples };
			const probe = freshImport(roots[arm]);
			samples.push({ ...probe, arm, iteration, warmup });
			process.stderr.write(
				`${warmup ? "warmup" : "sample"} ${arm} #${String(iteration + 1)} ` +
					`${probe.durationMs.toFixed(2)}ms ${probe.maxRssKiB.toFixed(0)}KiB\n`,
			);
		}
	}
	return { complete: true, samples };
}

async function main(): Promise<void> {
	const options = parseOptions(Bun.argv.slice(2));
	const importRun = options.profile === "import" ? runImportProfile(options) : undefined;
	const lifecycleRun =
		options.profile === "lifecycle"
			? await runLifecycleComparison({
					baselineRoot: options.baselineRoot,
					candidateRoot: options.candidateRoot,
					deadlineAt: options.deadlineAt,
					piBinary: options.piBinary,
					plan: options.lifecyclePlan,
					samples: options.samples,
					warmups: options.warmups,
				})
			: undefined;
	const complete = importRun?.complete ?? lifecycleRun?.complete ?? false;
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		toolchain: { bun: Bun.version, platform: process.platform, architecture: process.arch },
		arms: {
			baseline: armIdentity(options.baselineRoot),
			candidate: armIdentity(options.candidateRoot),
		},
		thresholds: EFFECT_MAINLINE_THRESHOLDS,
		complete,
		importProfile: importRun
			? {
					comparisons: importRun.complete ? compareMeasurements(measurementsOf(importRun.samples)) : [],
					notes: [
						"Every observation starts a fresh repository Bun process and imports suite-runtime.ts once.",
						"Arms rotate through first position; warmups are retained but excluded from paired comparisons.",
						"maxRssKiB and CPU/I/O counters come from process.resourceUsage() on Linux.",
						"Zero-valued fsRead/fsWrite counters remain raw descriptive evidence and are not divided into ratios.",
					],
					samples: importRun.samples,
					samplesPerArm: options.samples,
					warmupsPerArm: options.warmups,
				}
			: undefined,
		lifecycleProfile: lifecycleRun,
	};
	await mkdir(dirname(options.output), { recursive: true });
	const serialized = `${JSON.stringify(report, null, 2)}\n`;
	await writeFile(options.output, serialized);
	process.stdout.write(serialized);
	if (!complete) process.exitCode = 2;
}

if (import.meta.main) await main();
