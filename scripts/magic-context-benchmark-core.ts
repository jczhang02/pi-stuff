import { type Static, Type } from "typebox";

export const MAGIC_CONTEXT_BENCHMARK_CASES = ["fresh", "short", "long", "malformed-image"] as const;
export type MagicContextBenchmarkCase = (typeof MAGIC_CONTEXT_BENCHMARK_CASES)[number];

const POSITIVE_NUMBER = Type.Number({ exclusiveMinimum: 0 });
const CASE_METRICS_SCHEMA = Type.Object({
	firstProjectionMs: POSITIVE_NUMBER,
	fullSnapshotMs: POSITIVE_NUMBER,
	hostEffectMs: Type.Union([POSITIVE_NUMBER, Type.Null()]),
	incrementalLeafMs: POSITIVE_NUMBER,
});

export const MAGIC_CONTEXT_SAMPLE_SCHEMA = Type.Object({
	bundleBytes: Type.Integer({ minimum: 1 }),
	cases: Type.Object({
		fresh: CASE_METRICS_SCHEMA,
		long: CASE_METRICS_SCHEMA,
		"malformed-image": CASE_METRICS_SCHEMA,
		short: CASE_METRICS_SCHEMA,
	}),
	initializeAndTokenizerPreloadMs: POSITIVE_NUMBER,
	packageVersion: Type.String({ minLength: 1 }),
	queue: Type.Object({
		estimatedQueueWaitMs: Type.Number({ minimum: 0 }),
		parallelPairMs: POSITIVE_NUMBER,
		singleCommandMs: POSITIVE_NUMBER,
	}),
	workerBuildMs: POSITIVE_NUMBER,
	workerStartMs: POSITIVE_NUMBER,
});

export const MAGIC_CONTEXT_BENCHMARK_REPORT_SCHEMA = Type.Object({
	packageVersion: Type.String({ minLength: 1 }),
	raw: Type.Array(MAGIC_CONTEXT_SAMPLE_SCHEMA),
});

export type MagicContextSample = Static<typeof MAGIC_CONTEXT_SAMPLE_SCHEMA>;

export function numericMagicContextMetrics(sample: MagicContextSample): Map<string, number> {
	const metrics = new Map<string, number>([
		["bundleBytes", sample.bundleBytes],
		["initializeAndTokenizerPreloadMs", sample.initializeAndTokenizerPreloadMs],
		["queue.estimatedQueueWaitMs", sample.queue.estimatedQueueWaitMs],
		["queue.parallelPairMs", sample.queue.parallelPairMs],
		["queue.singleCommandMs", sample.queue.singleCommandMs],
		["workerBuildMs", sample.workerBuildMs],
		["workerStartMs", sample.workerStartMs],
	]);
	for (const name of MAGIC_CONTEXT_BENCHMARK_CASES) {
		const current = sample.cases[name];
		metrics.set(`cases.${name}.firstProjectionMs`, current.firstProjectionMs);
		metrics.set(`cases.${name}.fullSnapshotMs`, current.fullSnapshotMs);
		metrics.set(`cases.${name}.incrementalLeafMs`, current.incrementalLeafMs);
		if (current.hostEffectMs !== null) metrics.set(`cases.${name}.hostEffectMs`, current.hostEffectMs);
	}
	return metrics;
}
