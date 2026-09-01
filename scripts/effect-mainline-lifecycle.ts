import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, LifecycleSample, Scenario, TerminalSize } from "./benchmark-lifecycle.js";
import {
	type BenchmarkOptions,
	type CellSummary,
	type LifecycleAcceptanceSelection,
	lifecycleAcceptanceFindings,
	lifecycleConfirmationTargets,
	type SeededSessions,
	type Variant,
} from "./benchmark-lifecycle.js";
import { balancedArmOrder, compareMeasurements, type NamedMeasurement } from "./effect-mainline-benchmark-core.js";
import { prepareFixture } from "./lifecycle-benchmark-fixture.js";
import { runSample, summaries } from "./lifecycle-benchmark-sampling.js";
import { stageCertifiedPiHost } from "./verify-pi-host-provenance.js";

export type LifecycleArm = "baseline" | "candidate" | "host";

export interface ArmLifecycleSample extends LifecycleSample {
	readonly arm: LifecycleArm;
}

export interface LifecycleComparisonOptions {
	readonly baselineRoot: string;
	readonly candidateRoot: string;
	readonly deadlineAt: number;
	readonly piBinary: string;
	readonly plan: LifecycleComparisonPlanName;
	readonly samples: number;
	readonly warmups: number;
}

interface ArmFixture {
	readonly fixturePackage: string;
	readonly root: string;
	readonly seeded: SeededSessions;
}

export type LifecycleComparisonPlanName = "coverage" | "precision" | "smoke";

export interface LifecycleComparisonPlan {
	readonly actions: readonly Action[];
	readonly certifiesAbsoluteBudgets: boolean;
	readonly longSessionToolBytes: number;
	readonly longSessionTools: number;
	readonly scenarios: readonly Scenario[];
	readonly sizes: readonly TerminalSize[];
}

const FULL_ACTIONS = ["exit", "ctrl-c", "reload", "reload-change", "prompt", "background-exit", "agent-exit"] as const;
const FULL_SCENARIOS = ["fresh", "resume-short", "resume-long", "degraded"] as const;
const CERTIFIED_SIZES = [
	{ columns: 100, rows: 32 },
	{ columns: 64, rows: 28 },
] as const;
const LIFECYCLE_METRICS = [
	"acknowledgementMs",
	"interruptMs",
	"providerStartMs",
	"reloadMs",
	"responseMs",
	"shutdownMs",
	"startupMs",
	"steadyAcknowledgementMs",
	"steadyProviderStartMs",
	"steadyResponseMs",
] as const;

export function lifecycleMeasurementsOf(samples: readonly ArmLifecycleSample[]): NamedMeasurement[] {
	return samples.flatMap((sample) => {
		if (sample.warmup || sample.arm === "host") return [];
		const arm = sample.arm;
		const key = `${sample.scenario}/${sample.action}/${String(sample.columns)}x${String(sample.rows)}`;
		return LIFECYCLE_METRICS.flatMap((metric) => {
			const value = sample[metric];
			return value === undefined ? [] : [{ arm, iteration: sample.iteration, key, metric, value }];
		});
	});
}

export function lifecycleComparisonPlan(name: LifecycleComparisonPlanName): LifecycleComparisonPlan {
	if (name === "coverage") {
		return {
			actions: FULL_ACTIONS,
			certifiesAbsoluteBudgets: true,
			longSessionToolBytes: 8_192,
			longSessionTools: 6_500,
			scenarios: FULL_SCENARIOS,
			sizes: CERTIFIED_SIZES,
		};
	}
	if (name === "precision") {
		return {
			actions: ["exit", "reload", "prompt", "background-exit", "agent-exit"],
			certifiesAbsoluteBudgets: false,
			longSessionToolBytes: 8_192,
			longSessionTools: 6_500,
			scenarios: ["fresh", "resume-long", "degraded"],
			sizes: [CERTIFIED_SIZES[0]],
		};
	}
	return {
		actions: ["exit"],
		certifiesAbsoluteBudgets: false,
		longSessionToolBytes: 0,
		longSessionTools: 0,
		scenarios: ["fresh"],
		sizes: [{ columns: 80, rows: 24 }],
	};
}

function requiresCell(action: Action, scenario: Scenario, size: TerminalSize): boolean {
	if (action === "background-exit" || action === "agent-exit") {
		return scenario === "fresh" || scenario === "resume-long";
	}
	if (action === "reload-change") return scenario === "fresh" && size.columns === 100 && size.rows === 32;
	return true;
}

async function prepareArmFixture(
	benchmarkRoot: string,
	arm: LifecycleArm,
	plan: LifecycleComparisonPlan,
): Promise<ArmFixture> {
	const root = join(benchmarkRoot, "arms", arm);
	await Promise.all([
		mkdir(join(root, "project"), { recursive: true }),
		mkdir(join(root, "home"), { recursive: true }),
	]);
	return {
		fixturePackage: join(root, "fixture-package"),
		root,
		seeded: await prepareFixture(root, join(root, "project"), plan.longSessionTools, plan.longSessionToolBytes),
	};
}

function benchmarkOptions(
	options: LifecycleComparisonOptions,
	plan: LifecycleComparisonPlan,
	piBinary: string,
	arm: LifecycleArm,
): BenchmarkOptions {
	const root = arm === "candidate" ? options.candidateRoot : options.baselineRoot;
	return {
		acceptance: plan.certifiesAbsoluteBudgets,
		actions: plan.actions,
		contextEnabled: true,
		longSessionToolBytes: plan.longSessionToolBytes,
		longSessionTools: plan.longSessionTools,
		output: "",
		packagePath: join(root, "packages/pi-stuff"),
		piBinary,
		samples: options.samples,
		scenarios: plan.scenarios,
		sizes: plan.sizes,
		trace: true,
		variants: arm === "host" ? ["host"] : ["suite"],
		warmups: options.warmups,
	};
}

function cellArms(plan: LifecycleComparisonPlan, action: Action): readonly LifecycleArm[] {
	if (
		!plan.certifiesAbsoluteBudgets ||
		action === "background-exit" ||
		action === "agent-exit" ||
		action === "reload-change"
	) {
		return ["baseline", "candidate"];
	}
	return ["host", "baseline", "candidate"];
}

interface MatrixContext {
	readonly deadlineAt: number;
	readonly fixtures: Readonly<Record<LifecycleArm, ArmFixture>>;
	readonly options: Readonly<Record<LifecycleArm, BenchmarkOptions>>;
	readonly plan: LifecycleComparisonPlan;
	readonly samples: number;
	readonly warmups: number;
}

async function runInitialMatrix(context: MatrixContext): Promise<{ complete: boolean; samples: ArmLifecycleSample[] }> {
	const collected: ArmLifecycleSample[] = [];
	matrix: for (const size of context.plan.sizes) {
		for (const scenario of context.plan.scenarios) {
			for (const action of context.plan.actions) {
				if (!requiresCell(action, scenario, size)) continue;
				for (let run = 0; run < context.warmups + context.samples; run += 1) {
					const warmup = run < context.warmups;
					const iteration = warmup ? run : run - context.warmups;
					for (const arm of balancedArmOrder(cellArms(context.plan, action), run)) {
						if (Date.now() >= context.deadlineAt) break matrix;
						const fixture = context.fixtures[arm];
						const variant: Variant = arm === "host" ? "host" : "suite";
						const sample = await runSample(
							context.options[arm],
							fixture.root,
							fixture.fixturePackage,
							fixture.seeded,
							variant,
							scenario,
							action,
							size,
							iteration,
							warmup,
						);
						collected.push({ ...sample, arm });
						process.stderr.write(
							`${warmup ? "warmup" : "sample"} ${arm}/${scenario}/${action}/` +
								`${String(size.columns)}x${String(size.rows)} #${String(iteration + 1)} ` +
								`startup=${sample.startupMs.toFixed(1)}ms shutdown=${sample.shutdownMs.toFixed(1)}ms\n`,
						);
					}
				}
			}
		}
	}
	return { complete: Date.now() < context.deadlineAt, samples: collected };
}

function summariesFor(samples: readonly ArmLifecycleSample[], arm: LifecycleArm): CellSummary[] {
	return summaries(samples.filter((sample) => sample.arm === arm));
}

function selectionOf(context: MatrixContext): LifecycleAcceptanceSelection {
	return {
		actions: context.plan.actions,
		contextEnabled: true,
		longSessionToolBytes: context.plan.longSessionToolBytes,
		longSessionTools: context.plan.longSessionTools,
		samples: context.samples,
		scenarios: context.plan.scenarios,
		sizes: context.plan.sizes,
		trace: true,
		variants: ["host", "suite"],
		warmups: context.warmups,
	};
}

interface ConfirmationTarget {
	readonly arm: "baseline" | "candidate";
	readonly cell: CellSummary;
}

function confirmationTargets(
	host: readonly CellSummary[],
	baseline: readonly CellSummary[],
	candidate: readonly CellSummary[],
): ConfirmationTarget[] {
	return [
		...lifecycleConfirmationTargets([...host, ...baseline]).map((cell) => ({ arm: "baseline" as const, cell })),
		...lifecycleConfirmationTargets([...host, ...candidate]).map((cell) => ({ arm: "candidate" as const, cell })),
	];
}

async function runConfirmations(
	context: MatrixContext,
	targets: readonly ConfirmationTarget[],
): Promise<{ complete: boolean; samples: ArmLifecycleSample[] }> {
	const collected: ArmLifecycleSample[] = [];
	for (const target of targets) {
		for (let run = 0; run < context.warmups + context.samples; run += 1) {
			if (Date.now() >= context.deadlineAt) return { complete: false, samples: collected };
			const warmup = run < context.warmups;
			const iteration = warmup ? run : run - context.warmups;
			const fixture = context.fixtures[target.arm];
			const sample = await runSample(
				context.options[target.arm],
				fixture.root,
				fixture.fixturePackage,
				fixture.seeded,
				"suite",
				target.cell.scenario,
				target.cell.action,
				target.cell,
				iteration,
				warmup,
				"confirmation",
			);
			collected.push({ ...sample, arm: target.arm });
		}
	}
	return { complete: true, samples: collected };
}

export async function runLifecycleComparison(options: LifecycleComparisonOptions) {
	const plan = lifecycleComparisonPlan(options.plan);
	const benchmarkRoot = await mkdtemp(join(tmpdir(), "effect-mainline-lifecycle-"));
	try {
		const provenance = await stageCertifiedPiHost(options.piBinary, benchmarkRoot);
		const neededArms: readonly LifecycleArm[] = plan.certifiesAbsoluteBudgets
			? ["host", "baseline", "candidate"]
			: ["baseline", "candidate"];
		const prepared = await Promise.all(
			neededArms.map(async (arm) => [arm, await prepareArmFixture(benchmarkRoot, arm, plan)] as const),
		);
		const fallback = prepared[0]?.[1];
		if (!fallback) throw new Error("lifecycle comparison prepared no arm fixtures");
		const fixtureMap = new Map<LifecycleArm, ArmFixture>(prepared);
		const baselineFixture = fixtureMap.get("baseline");
		const candidateFixture = fixtureMap.get("candidate");
		if (!baselineFixture || !candidateFixture) throw new Error("lifecycle comparison requires both package arms");
		const context: MatrixContext = {
			deadlineAt: options.deadlineAt,
			fixtures: {
				baseline: baselineFixture,
				candidate: candidateFixture,
				host: fixtureMap.get("host") ?? fallback,
			},
			options: {
				baseline: benchmarkOptions(options, plan, provenance.binaryPath, "baseline"),
				candidate: benchmarkOptions(options, plan, provenance.binaryPath, "candidate"),
				host: benchmarkOptions(options, plan, provenance.binaryPath, "host"),
			},
			plan,
			samples: options.samples,
			warmups: options.warmups,
		};
		const initial = await runInitialMatrix(context);
		const host = summariesFor(initial.samples, "host");
		const baseline = summariesFor(initial.samples, "baseline");
		const candidate = summariesFor(initial.samples, "candidate");
		const targets =
			initial.complete && plan.certifiesAbsoluteBudgets ? confirmationTargets(host, baseline, candidate) : [];
		const confirmations = await runConfirmations(context, targets);
		const complete = initial.complete && confirmations.complete;
		const baselineConfirmations = summariesFor(confirmations.samples, "baseline");
		const candidateConfirmations = summariesFor(confirmations.samples, "candidate");
		const selection = selectionOf(context);
		return {
			acceptance:
				plan.certifiesAbsoluteBudgets && complete
					? {
							baselineFindings: lifecycleAcceptanceFindings(
								selection,
								[...host, ...baseline],
								baselineConfirmations,
							),
							candidateFindings: lifecycleAcceptanceFindings(
								selection,
								[...host, ...candidate],
								candidateConfirmations,
							),
							requested: true,
						}
					: { requested: plan.certifiesAbsoluteBudgets },
			comparisons: complete ? compareMeasurements(lifecycleMeasurementsOf(initial.samples)) : [],
			complete,
			confirmations: {
				samples: confirmations.samples,
				summaries: { baseline: baselineConfirmations, candidate: candidateConfirmations },
			},
			host: { profile: provenance.profile, provenance: provenance.kind },
			plan: options.plan,
			samples: initial.samples,
			selection,
			summaries: { baseline, candidate, host },
		};
	} finally {
		await rm(benchmarkRoot, { recursive: true, force: true });
	}
}
