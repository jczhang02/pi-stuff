export interface PairedSample {
	readonly baseline: number;
	readonly candidate: number;
}

export type ComparisonClassification = "improved" | "inconclusive" | "non-inferior" | "regressed";

export interface PairedComparison {
	readonly classification: ComparisonClassification;
	readonly confidence95: readonly [number, number];
	readonly medianRatio: number;
	readonly samples: number;
}

export interface NamedMeasurement {
	readonly arm: "baseline" | "candidate";
	readonly iteration: number;
	readonly key: string;
	readonly metric: string;
	readonly value: number;
}

export interface NamedComparison extends PairedComparison {
	readonly key: string;
	readonly metric: string;
}

export const EFFECT_MAINLINE_THRESHOLDS = {
	bootstrapReplicates: 20_000,
	bootstrapSeed: 20_260_901,
	improvementRatio: 0.95,
	nonInferiorityRatio: 1.1,
} as const;

export function balancedArmOrder<Arm>(arms: readonly Arm[], run: number): Arm[] {
	if (arms.length === 0) throw new Error("balanced arm order requires at least one arm");
	if (!Number.isSafeInteger(run) || run < 0) throw new Error("balanced arm order requires a non-negative run");
	const offset = run % arms.length;
	return [...arms.slice(offset), ...arms.slice(0, offset)];
}

function percentile(values: readonly number[], fraction: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
	const selected = sorted[index];
	if (selected === undefined) throw new Error("cannot select a percentile without samples");
	return selected;
}

function nextRandom(state: number): number {
	let value = state | 0;
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	return value >>> 0;
}

function ratiosOf(pairs: readonly PairedSample[]): number[] {
	if (pairs.length < 3) throw new Error("paired comparison requires at least three samples");
	return pairs.map(({ baseline, candidate }) => {
		if (!(baseline > 0) || !(candidate > 0) || !Number.isFinite(baseline) || !Number.isFinite(candidate)) {
			throw new Error("paired comparison requires positive finite measurements");
		}
		return candidate / baseline;
	});
}

function bootstrapMedianConfidence95(ratios: readonly number[]): readonly [number, number] {
	const medians: number[] = [];
	let randomState: number = EFFECT_MAINLINE_THRESHOLDS.bootstrapSeed;
	for (let replicate = 0; replicate < EFFECT_MAINLINE_THRESHOLDS.bootstrapReplicates; replicate += 1) {
		const resampled: number[] = [];
		for (let sample = 0; sample < ratios.length; sample += 1) {
			randomState = nextRandom(randomState);
			const selected = ratios[randomState % ratios.length];
			if (selected === undefined) throw new Error("paired bootstrap selected no sample");
			resampled.push(selected);
		}
		medians.push(percentile(resampled, 0.5));
	}
	return [percentile(medians, 0.025), percentile(medians, 0.975)];
}

export function comparePairedSamples(pairs: readonly PairedSample[]): PairedComparison {
	const ratios = ratiosOf(pairs);
	const confidence95 = bootstrapMedianConfidence95(ratios);
	const classification =
		confidence95[1] <= EFFECT_MAINLINE_THRESHOLDS.improvementRatio
			? "improved"
			: confidence95[1] <= EFFECT_MAINLINE_THRESHOLDS.nonInferiorityRatio
				? "non-inferior"
				: confidence95[0] > EFFECT_MAINLINE_THRESHOLDS.nonInferiorityRatio
					? "regressed"
					: "inconclusive";
	return {
		classification,
		confidence95,
		medianRatio: percentile(ratios, 0.5),
		samples: pairs.length,
	};
}

interface MeasurementPair {
	baseline?: number;
	candidate?: number;
}

interface MeasurementGroup {
	readonly key: string;
	readonly metric: string;
	readonly pairs: Map<number, MeasurementPair>;
}

export function compareMeasurements(measurements: readonly NamedMeasurement[]): NamedComparison[] {
	const groups = new Map<string, MeasurementGroup>();
	for (const measurement of measurements) {
		const groupId = `${measurement.key}\0${measurement.metric}`;
		const group = groups.get(groupId) ?? {
			key: measurement.key,
			metric: measurement.metric,
			pairs: new Map<number, MeasurementPair>(),
		};
		const pair = group.pairs.get(measurement.iteration) ?? {};
		if (pair[measurement.arm] !== undefined) {
			throw new Error(`duplicate ${measurement.arm} sample for ${measurement.key}/${measurement.metric}`);
		}
		pair[measurement.arm] = measurement.value;
		group.pairs.set(measurement.iteration, pair);
		groups.set(groupId, group);
	}
	return [...groups.values()]
		.sort((left, right) => `${left.key}/${left.metric}`.localeCompare(`${right.key}/${right.metric}`))
		.map((group) => {
			const pairs = [...group.pairs.entries()]
				.sort(([left], [right]) => left - right)
				.map(([iteration, pair]) => {
					if (pair.baseline === undefined) {
						throw new Error(
							`missing baseline sample for ${group.key}/${group.metric} iteration ${String(iteration)}`,
						);
					}
					if (pair.candidate === undefined) {
						throw new Error(
							`missing candidate sample for ${group.key}/${group.metric} iteration ${String(iteration)}`,
						);
					}
					return { baseline: pair.baseline, candidate: pair.candidate };
				});
			return { ...comparePairedSamples(pairs), key: group.key, metric: group.metric };
		});
}
