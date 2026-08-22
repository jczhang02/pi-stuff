import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Markdown } from "@earendil-works/pi-tui";
import {
	getMarkdownTheme,
	initTheme,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const DEFAULT_SAMPLES = 30;
const DEFAULT_WARMUPS = 5;
const BOOTSTRAP_ITERATIONS = 2_000;
const WIDTHS = [64, 100] as const;

interface MarkdownTransformContext {
	readonly availableWidth: number;
	readonly isStreaming: boolean;
	readonly messageType: "assistant" | "assistant-thinking" | "user";
}

type MarkdownTransformer = (markdown: string, context: MarkdownTransformContext) => string;

interface TransformerModule {
	createLiveThoughtTransformer(): MarkdownTransformer;
}

interface Scenario {
	readonly id: string;
	readonly isStreaming: boolean;
	readonly markdown: readonly string[];
	readonly messageType: MarkdownTransformContext["messageType"];
	readonly mode?: "render" | "transform";
	readonly rounds: number;
	readonly widths?: readonly number[];
}

interface TimingSummary {
	readonly maximum: number;
	readonly minimum: number;
	readonly p50: number;
	readonly p95: number;
}

interface ScenarioReport {
	readonly baselineMs: TimingSummary;
	readonly candidateMs: TimingSummary;
	readonly id: string;
	readonly medianRatioConfidence95: readonly [number, number];
	readonly regression: boolean;
}

interface BenchmarkOptions {
	readonly baselineRoot: string;
	readonly candidateRoot: string;
	readonly samples: number;
	readonly warmups: number;
}

interface SamplePair {
	readonly baselineMs: number;
	readonly candidateMs: number;
}

function fail(message: string): never {
	throw new Error(`Conversation Markdown benchmark failed: ${message}`);
}

function positiveInteger(value: string | undefined, flag: string, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 3 || parsed > 1_000) {
		fail(`${flag} must be an integer from 3 through 1000`);
	}
	return parsed;
}

function parseOptions(arguments_: readonly string[]): BenchmarkOptions {
	let baselineRoot = process.env["PI_STUFF_BENCHMARK_BASELINE"];
	let candidateRoot = process.cwd();
	let samples = DEFAULT_SAMPLES;
	let warmups = DEFAULT_WARMUPS;

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
			case "--samples":
				samples = positiveInteger(value, flag, DEFAULT_SAMPLES);
				index += 1;
				break;
			case "--warmups":
				warmups = positiveInteger(value, flag, DEFAULT_WARMUPS);
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
		samples,
		warmups,
	};
}

async function loadTransformer(root: string): Promise<MarkdownTransformer> {
	const moduleUrl = pathToFileURL(resolve(root, "packages/pi-stuff/src/conversation-ui/live-thought.ts")).href;
	// SAFETY: the benchmark loads the repository-owned module at the exact public export exercised by its focused tests.
	const module = (await import(moduleUrl)) as TransformerModule;
	return module.createLiveThoughtTransformer();
}

function textOfLength(seed: string, length: number): string {
	if (length <= seed.length) return seed.slice(0, length);
	return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

function streamingPrefixes(source: string, count: number): readonly string[] {
	return Array.from({ length: count }, (_value, index) =>
		source.slice(0, Math.max(1, Math.floor((source.length * (index + 1)) / count))),
	);
}

function chartSource(points: number): string {
	const rows = Array.from(
		{ length: points },
		(_value, index) => `point-${String(index + 1)} ${String((index % 17) - 8)}`,
	);
	return ["```chart", "type: line", "title: bounded series", "data:", ...rows, "```"].join("\n");
}

function treeSource(nodes: number): string {
	const rows = ["root"];
	for (let index = 1; index < nodes; index += 1) {
		const depth = index % 3 === 1 ? 1 : 2;
		rows.push(`${"  ".repeat(depth)}node-${String(index)}`);
	}
	return ["```tree", ...rows, "```"].join("\n");
}

function scenarios(): readonly Scenario[] {
	const prose = "Inspecting current behavior with CJK 内容 and emoji 🧪 while preserving structured Markdown.\n\n";
	const ordinaryFence = ["```typescript", textOfLength("const value = 42; // chart tree\n", 32_000), "```"].join("\n");
	const candidateWords = textOfLength(
		"chart and tree are ordinary prose here; no fenced visualization exists. ",
		32_000,
	);
	const stream = textOfLength(prose, 32_000);
	return [
		{
			id: "assistant-prose-1k",
			isStreaming: false,
			markdown: [textOfLength(prose, 1_024)],
			messageType: "assistant",
			rounds: 20,
		},
		{
			id: "assistant-prose-32k",
			isStreaming: false,
			markdown: [textOfLength(prose, 32_000)],
			messageType: "assistant",
			rounds: 1,
		},
		{
			id: "assistant-prose-128k",
			isStreaming: false,
			markdown: [textOfLength(prose, 128_000)],
			messageType: "assistant",
			mode: "transform",
			rounds: 1,
			widths: [100],
		},
		{
			id: "assistant-ordinary-fence",
			isStreaming: false,
			markdown: [ordinaryFence],
			messageType: "assistant",
			rounds: 1,
		},
		{
			id: "assistant-candidate-words",
			isStreaming: false,
			markdown: [candidateWords],
			messageType: "assistant",
			rounds: 1,
		},
		{
			id: "user-prose-32k",
			isStreaming: false,
			markdown: [textOfLength(prose, 32_000)],
			messageType: "user",
			rounds: 1,
		},
		{ id: "user-ordinary-fence", isStreaming: false, markdown: [ordinaryFence], messageType: "user", rounds: 1 },
		{
			id: "thinking-32k",
			isStreaming: true,
			markdown: [textOfLength(prose, 32_000)],
			messageType: "assistant-thinking",
			rounds: 1,
		},
		{
			id: "assistant-streaming-8k",
			isStreaming: true,
			markdown: streamingPrefixes(stream.slice(0, 8_000), 12),
			messageType: "assistant",
			rounds: 1,
			widths: [100],
		},
		{ id: "chart-64-points", isStreaming: false, markdown: [chartSource(64)], messageType: "assistant", rounds: 5 },
		{ id: "tree-128-nodes", isStreaming: false, markdown: [treeSource(128)], messageType: "assistant", rounds: 3 },
	];
}

function renderScenario(transformer: MarkdownTransformer, scenario: Scenario): number {
	let checksum = 0;
	for (let round = 0; round < scenario.rounds; round += 1) {
		for (const source of scenario.markdown) {
			for (const width of scenario.widths ?? WIDTHS) {
				if (scenario.mode === "transform") {
					const output = transformer(source, {
						availableWidth: width,
						isStreaming: scenario.isStreaming,
						messageType: scenario.messageType,
					});
					checksum += output.length + (output.codePointAt(0) ?? 0);
					getMarkdownTheme().listBullet("- ");
					continue;
				}
				const markdown = new Markdown(source, 0, 0, getMarkdownTheme(), undefined, {
					transform: (value, availableWidth) =>
						transformer(value, {
							availableWidth,
							isStreaming: scenario.isStreaming,
							messageType: scenario.messageType,
						}),
				});
				const lines = markdown.render(width);
				checksum += lines.length + (lines[0]?.length ?? 0) + (lines.at(-1)?.length ?? 0);
			}
		}
	}
	return checksum;
}

function timedRun(transformer: MarkdownTransformer, scenario: Scenario): number {
	const started = performance.now();
	const checksum = renderScenario(transformer, scenario);
	if (!Number.isSafeInteger(checksum) || checksum <= 0) fail(`${scenario.id} produced no visible output`);
	return performance.now() - started;
}

function percentile(values: readonly number[], quantile: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
	return sorted[index] ?? Number.NaN;
}

function summary(values: readonly number[]): TimingSummary {
	return {
		maximum: percentile(values, 1),
		minimum: percentile(values, 1 / values.length),
		p50: percentile(values, 0.5),
		p95: percentile(values, 0.95),
	};
}

function nextRandom(state: number): number {
	let value = state | 0;
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	return value >>> 0;
}

function bootstrapMedianRatio(pairs: readonly SamplePair[]): readonly [number, number] {
	const medians: number[] = [];
	let randomState = 0x5f3759df;
	for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
		const ratios: number[] = [];
		for (let sample = 0; sample < pairs.length; sample += 1) {
			randomState = nextRandom(randomState);
			const pair = pairs[randomState % pairs.length];
			if (!pair || pair.baselineMs <= 0) fail("invalid benchmark sample");
			ratios.push(pair.candidateMs / pair.baselineMs);
		}
		medians.push(percentile(ratios, 0.5));
	}
	return [percentile(medians, 0.025), percentile(medians, 0.975)];
}

function benchmarkScenario(
	baseline: MarkdownTransformer,
	candidate: MarkdownTransformer,
	scenario: Scenario,
	warmups: number,
	samples: number,
): ScenarioReport {
	for (let index = 0; index < warmups; index += 1) {
		renderScenario(index % 2 === 0 ? baseline : candidate, scenario);
		renderScenario(index % 2 === 0 ? candidate : baseline, scenario);
	}

	const pairs: SamplePair[] = [];
	for (let index = 0; index < samples; index += 1) {
		if (index % 2 === 0) {
			pairs.push({ baselineMs: timedRun(baseline, scenario), candidateMs: timedRun(candidate, scenario) });
		} else {
			const candidateMs = timedRun(candidate, scenario);
			pairs.push({ baselineMs: timedRun(baseline, scenario), candidateMs });
		}
	}
	const baselineMs = summary(pairs.map((pair) => pair.baselineMs));
	const candidateMs = summary(pairs.map((pair) => pair.candidateMs));
	const confidence = bootstrapMedianRatio(pairs);
	return {
		baselineMs,
		candidateMs,
		id: scenario.id,
		medianRatioConfidence95: confidence,
		regression: confidence[0] > 1 && candidateMs.p95 > baselineMs.p95,
	};
}

const options = parseOptions(process.argv.slice(2));
initTheme("dark");
const baseline = await loadTransformer(options.baselineRoot);
const candidate = await loadTransformer(options.candidateRoot);
const selectedScenarios = scenarios();
const reports: ScenarioReport[] = [];
for (const scenario of selectedScenarios) {
	process.stderr.write(`Benchmarking ${scenario.id}...\n`);
	reports.push(benchmarkScenario(baseline, candidate, scenario, options.warmups, options.samples));
}
const confirmations: ScenarioReport[] = [];
for (const report of reports.filter((candidateReport) => candidateReport.regression)) {
	const scenario = selectedScenarios.find((candidateScenario) => candidateScenario.id === report.id);
	if (!scenario) fail(`missing confirmation scenario ${report.id}`);
	process.stderr.write(`Confirming ${scenario.id}...\n`);
	confirmations.push(benchmarkScenario(baseline, candidate, scenario, options.warmups, options.samples));
}
const regressions = confirmations.filter((report) => report.regression);
process.stdout.write(
	`${JSON.stringify(
		{
			bootstrapIterations: BOOTSTRAP_ITERATIONS,
			confirmations,
			regressions: regressions.map((report) => report.id),
			reports,
			samples: options.samples,
			warmups: options.warmups,
		},
		null,
		2,
	)}\n`,
);
if (regressions.length > 0) {
	fail(`confirmed regressions: ${regressions.map((report) => report.id).join(", ")}`);
}
