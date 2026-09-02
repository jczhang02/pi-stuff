import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Check } from "typebox/value";
import { isJsonInputObject, parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import {
	balancedArmOrder,
	compareMeasurements,
	comparePairedSamples,
	EFFECT_MAINLINE_THRESHOLDS,
} from "../scripts/effect-mainline-benchmark-core.js";
import { lifecycleComparisonPlan, lifecycleMeasurementsOf } from "../scripts/effect-mainline-lifecycle.js";
import { MAGIC_CONTEXT_SAMPLE_SCHEMA, numericMagicContextMetrics } from "../scripts/magic-context-benchmark-core.js";

const repeatedPairs = (ratio: number) =>
	Array.from({ length: 15 }, (_value, index) => ({
		baseline: 100 + index,
		candidate: (100 + index) * ratio,
	}));

test("classifies paired measurements against the frozen merge thresholds", () => {
	expect(comparePairedSamples(repeatedPairs(0.9)).classification).toBe("improved");
	expect(comparePairedSamples(repeatedPairs(1.05)).classification).toBe("non-inferior");
	expect(comparePairedSamples(repeatedPairs(1.2)).classification).toBe("regressed");
});

test("rejects an unpaired arm instead of comparing unrelated samples", () => {
	const measurements = repeatedPairs(0.9).flatMap((pair, iteration) => [
		{ arm: "baseline" as const, iteration, key: "fresh/prompt", metric: "startup", value: pair.baseline },
		...(iteration === 14
			? []
			: [
					{
						arm: "candidate" as const,
						iteration,
						key: "fresh/prompt",
						metric: "startup",
						value: pair.candidate,
					},
				]),
	]);
	expect(() => compareMeasurements(measurements)).toThrow("missing candidate sample");
});

test("rotates every arm through the first measurement position", () => {
	const arms = ["host", "baseline", "candidate"] as const;
	expect([0, 1, 2].map((run) => balancedArmOrder(arms, run)[0])).toEqual([...arms]);
	expect(balancedArmOrder(arms, 3)).toEqual([...arms]);
});

test("keeps lifecycle coverage complete and precision focused", () => {
	const coverage = lifecycleComparisonPlan("coverage");
	expect(coverage).toMatchObject({
		actions: ["exit", "ctrl-c", "reload", "reload-change", "prompt", "background-exit", "agent-exit"],
		certifiesAbsoluteBudgets: true,
		longSessionToolBytes: 8_192,
		longSessionTools: 6_500,
		scenarios: ["fresh", "resume-short", "resume-long", "degraded"],
	});
	expect(coverage.sizes).toHaveLength(2);
	expect(lifecycleComparisonPlan("precision")).toMatchObject({
		actions: ["exit", "reload", "prompt", "background-exit", "agent-exit"],
		certifiesAbsoluteBudgets: false,
		scenarios: ["fresh", "resume-long", "degraded"],
	});
});

test("compares only measured main and Effect lifecycle metrics", () => {
	const common = {
		action: "prompt" as const,
		columns: 100,
		iteration: 0,
		providerStartMs: 20,
		responseMs: 30,
		rows: 32,
		scenario: "fresh" as const,
		shutdownMs: 4,
		startupMs: 10,
		variant: "suite" as const,
		warmup: false,
	};
	const measurements = lifecycleMeasurementsOf([
		{ ...common, arm: "baseline" },
		{ ...common, arm: "candidate", startupMs: 9 },
		{ ...common, arm: "host", variant: "host" },
		{ ...common, arm: "baseline", iteration: 1, warmup: true },
	]);
	expect(measurements.filter((entry) => entry.metric === "startupMs")).toEqual([
		{ arm: "baseline", iteration: 0, key: "fresh/prompt/100x32", metric: "startupMs", value: 10 },
		{ arm: "candidate", iteration: 0, key: "fresh/prompt/100x32", metric: "startupMs", value: 9 },
	]);
});

test("keeps the executable thresholds aligned with the frozen protocol", async () => {
	const protocol = parseJsonValue(
		await readFile(
			resolve(import.meta.dir, "../docs/research/effect-v4-mainline-comparison-protocol-20260901.json"),
			"utf8",
		),
	);
	if (!isJsonInputObject(protocol) || !isJsonInputObject(protocol["thresholds"])) {
		throw new Error("comparison protocol must declare thresholds");
	}
	expect(protocol["thresholds"]["performanceImprovementRatio"]).toBe(EFFECT_MAINLINE_THRESHOLDS.improvementRatio);
	expect(protocol["thresholds"]["performanceNonInferiorityRatio"]).toBe(
		EFFECT_MAINLINE_THRESHOLDS.nonInferiorityRatio,
	);
});

test("keeps Worker start independent in Magic Context benchmark samples", () => {
	const projection = { firstProjectionMs: 1, fullSnapshotMs: 1, hostEffectMs: null, incrementalLeafMs: 1 };
	const sample = {
		bundleBytes: 1,
		cases: { fresh: projection, long: projection, "malformed-image": projection, short: projection },
		initializeAndTokenizerPreloadMs: 3,
		packageVersion: "fixture",
		queue: { estimatedQueueWaitMs: 1, parallelPairMs: 2, singleCommandMs: 1 },
		workerBuildMs: 4,
		workerStartMs: 2,
	};
	expect(Check(MAGIC_CONTEXT_SAMPLE_SCHEMA, sample)).toBe(true);
	expect(numericMagicContextMetrics(sample).get("workerStartMs")).toBe(2);
	expect(Check(MAGIC_CONTEXT_SAMPLE_SCHEMA, { ...sample, workerStartMs: undefined })).toBe(false);
});

test("profiles fresh imports through the public comparison CLI", async () => {
	const root = resolve(import.meta.dir, "..");
	const commit = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"]).stdout.toString().trim();
	const directory = await mkdtemp(join(tmpdir(), "effect-mainline-benchmark-test-"));
	const output = join(directory, "result.json");
	try {
		const result = Bun.spawnSync(
			[
				process.execPath,
				join(root, "scripts/benchmark-effect-mainline.ts"),
				"--profile",
				"import",
				"--baseline-root",
				root,
				"--candidate-root",
				root,
				"--baseline-commit",
				commit,
				"--candidate-commit",
				commit,
				"--allow-dirty",
				"--samples",
				"3",
				"--warmups",
				"0",
				"--output",
				output,
			],
			{ cwd: root, stderr: "pipe", stdout: "pipe" },
		);
		expect(result.exitCode, result.stderr.toString()).toBe(0);
		const report = parseJsonValue(await readFile(output, "utf8"));
		if (!isJsonInputObject(report)) throw new Error("comparison report must be an object");
		expect(report["schemaVersion"]).toBe(2);
		expect(report["armVerification"]).toEqual({
			allowDirty: true,
			pinned: true,
			stableAcrossRun: true,
		});
		const importProfile = report["importProfile"];
		if (!isJsonInputObject(importProfile)) throw new Error("comparison report must include importProfile");
		expect(importProfile["samplesPerArm"]).toBe(3);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("rejects a comparison arm that moved from its pinned commit", () => {
	const root = resolve(import.meta.dir, "..");
	const result = Bun.spawnSync(
		[
			process.execPath,
			join(root, "scripts/benchmark-effect-mainline.ts"),
			"--baseline-root",
			root,
			"--candidate-root",
			root,
			"--baseline-commit",
			"0000000000000000000000000000000000000000",
			"--candidate-commit",
			"0000000000000000000000000000000000000000",
			"--allow-dirty",
		],
		{ cwd: root, stderr: "pipe", stdout: "pipe" },
	);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("baseline commit changed");
});
