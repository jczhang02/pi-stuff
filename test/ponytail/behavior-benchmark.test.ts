import { describe, expect, test } from "bun:test";
import {
	type BenchmarkCaseResult,
	evaluatePonytailBenchmark,
	oneSidedSignTestPValue,
	PONYTAIL_BENCHMARK_RUNS,
	PONYTAIL_BENCHMARK_SCENARIOS,
} from "../../scripts/benchmark-ponytail.js";

function cases(valid = true): BenchmarkCaseResult[] {
	return PONYTAIL_BENCHMARK_RUNS.map((run, index) => ({
		...run,
		sequence: index + 1,
		valid,
		durationMs: 1,
		metrics: {
			files: 1,
			nonBlankLines: run.mode === "ultra" ? 4 : 10,
			characters: run.mode === "ultra" ? 80 : 200,
			structuralDeclarations: 0,
		},
	}));
}

describe("Ponytail behavioral benchmark rubric", () => {
	test("freezes three tasks, three repetitions, and eighteen one-shot Sessions", () => {
		expect(PONYTAIL_BENCHMARK_SCENARIOS.map((scenario) => scenario.id)).toEqual([
			"future-channel",
			"request-id",
			"retry",
		]);
		expect(PONYTAIL_BENCHMARK_RUNS).toHaveLength(18);
		for (const scenario of PONYTAIL_BENCHMARK_SCENARIOS) {
			for (let repetition = 1; repetition <= 3; repetition++) {
				const pair = PONYTAIL_BENCHMARK_RUNS.filter(
					(run) => run.scenario === scenario.id && run.repetition === repetition,
				);
				expect(pair.map((run) => run.mode).sort()).toEqual(["off", "ultra"]);
			}
		}
	});

	test("keeps every production, test, and hidden-check fixture syntactically valid", () => {
		const typescript = new Bun.Transpiler({ loader: "ts" });
		const javascript = new Bun.Transpiler({ loader: "js" });
		for (const scenario of PONYTAIL_BENCHMARK_SCENARIOS) {
			for (const [path, source] of Object.entries(scenario.files)) {
				if (path.endsWith(".ts")) expect(() => typescript.transformSync(source)).not.toThrow();
			}
			expect(() =>
				javascript.transformSync(scenario.hiddenCheck.replace("__TARGET__", JSON.stringify("file:///fixture.ts"))),
			).not.toThrow();
		}
	});

	test("uses a one-sided exact sign test", () => {
		expect(oneSidedSignTestPValue(8, 9)).toBeCloseTo(0.01953125, 10);
		expect(oneSidedSignTestPValue(7, 9)).toBeCloseTo(0.08984375, 10);
		expect(() => oneSidedSignTestPValue(10, 9)).toThrow("invalid sign-test counts");
	});

	test("requires paired correctness, nine pairs, six non-ties, and p <= 0.05", () => {
		const strong = evaluatePonytailBenchmark(cases());
		expect(strong.verdict).toMatchObject({
			allCorrect: true,
			pairedCases: 9,
			ultraLower: 9,
			ultraHigher: 0,
			nonTies: 9,
			strongEffect: true,
		});
		const invalid = cases();
		const first = invalid[0];
		if (!first) throw new Error("missing fixture case");
		invalid[0] = { ...first, valid: false };
		expect(evaluatePonytailBenchmark(invalid).verdict).toMatchObject({
			allCorrect: false,
			strongEffect: false,
		});
	});
});
