import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	balancedArmOrder,
	comparePairedSamples,
	EFFECT_MAINLINE_THRESHOLDS,
} from "./effect-mainline-benchmark-core.js";

type Arm = "baseline" | "candidate";

interface ArmSample {
	readonly packageVersion: string;
	readonly values: Record<string, number>;
}

function integer(raw: string | undefined, fallback: number, name: string, minimum: number): number {
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`${name} must be an integer of at least ${String(minimum)}.`);
	}
	return value;
}

function flattenNumbers(value: unknown, prefix = "", output: Record<string, number> = {}): Record<string, number> {
	if (typeof value === "number") {
		if (!(value > 0) || !Number.isFinite(value))
			throw new Error(`Benchmark metric ${prefix} is not positive and finite.`);
		output[prefix] = value;
		return output;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return output;
	for (const [key, child] of Object.entries(value)) {
		flattenNumbers(child, prefix ? `${prefix}.${key}` : key, output);
	}
	return output;
}

async function readArmSample(path: string): Promise<ArmSample> {
	const report: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!report || typeof report !== "object" || !("packageVersion" in report) || !("raw" in report)) {
		throw new Error(`Magic Context arm report ${path} has an invalid shape.`);
	}
	const packageVersion = report.packageVersion;
	const raw = report.raw;
	if (typeof packageVersion !== "string" || !Array.isArray(raw) || raw.length !== 1 || !raw[0]) {
		throw new Error(`Magic Context arm report ${path} must contain exactly one sample.`);
	}
	return { packageVersion, values: flattenNumbers(raw[0]) };
}

async function runArm(root: string, arm: Arm, iteration: number, directory: string): Promise<ArmSample> {
	const output = join(directory, `${String(iteration)}-${arm}.json`);
	const child = Bun.spawnSync(
		[
			process.execPath,
			join(root, "scripts", "benchmark-magic-context.ts"),
			"--samples",
			"1",
			"--warmups",
			"0",
			"--output",
			output,
		],
		{ cwd: root, stderr: "pipe", stdout: "pipe" },
	);
	if (child.exitCode !== 0) {
		throw new Error(
			`${arm} Magic Context sample ${String(iteration)} failed:\n${child.stdout.toString()}\n${child.stderr.toString()}`,
		);
	}
	return readArmSample(output);
}

function compareArms(samples: Record<Arm, readonly ArmSample[]>) {
	const baseline = samples.baseline;
	const candidate = samples.candidate;
	if (baseline.length !== candidate.length || baseline.length < 3) {
		throw new Error("Magic Context comparison requires at least three complete sample pairs.");
	}
	const names = Object.keys(baseline[0]?.values ?? {}).sort();
	return Object.fromEntries(
		names.map((name) => {
			const pairs = baseline.map((sample, index) => {
				const baselineValue = sample.values[name];
				const candidateValue = candidate[index]?.values[name];
				if (baselineValue === undefined || candidateValue === undefined) {
					throw new Error(`Magic Context comparison is missing ${name} pair ${String(index)}.`);
				}
				return { baseline: baselineValue, candidate: candidateValue };
			});
			return [name, comparePairedSamples(pairs)];
		}),
	);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			baseline: { type: "string" },
			candidate: { type: "string" },
			output: { type: "string" },
			samples: { type: "string" },
			warmups: { type: "string" },
		},
		strict: true,
	});
	if (!values.baseline || !values.candidate)
		throw new Error("--baseline and --candidate worktree roots are required.");
	const roots: Record<Arm, string> = {
		baseline: resolve(values.baseline),
		candidate: resolve(values.candidate),
	};
	const measuredCount = integer(values.samples, 10, "--samples", 3);
	const warmupCount = integer(values.warmups, 3, "--warmups", 0);
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-magic-context-comparison-"));
	try {
		const measured: Record<Arm, ArmSample[]> = { baseline: [], candidate: [] };
		for (let iteration = 0; iteration < measuredCount + warmupCount; iteration += 1) {
			for (const arm of balancedArmOrder<Arm>(["baseline", "candidate"], iteration)) {
				const sample = await runArm(roots[arm], arm, iteration, directory);
				if (iteration >= warmupCount) measured[arm].push(sample);
			}
		}
		const report = `${JSON.stringify(
			{
				arms: {
					baseline: { packageVersion: measured.baseline[0]?.packageVersion, root: roots.baseline },
					candidate: { packageVersion: measured.candidate[0]?.packageVersion, root: roots.candidate },
				},
				comparisons: compareArms(measured),
				raw: measured,
				samples: measuredCount,
				thresholds: EFFECT_MAINLINE_THRESHOLDS,
				warmups: warmupCount,
			},
			null,
			2,
		)}\n`;
		if (values.output) {
			await mkdir(dirname(resolve(values.output)), { recursive: true });
			await writeFile(resolve(values.output), report);
		}
		process.stdout.write(report);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

await main();
