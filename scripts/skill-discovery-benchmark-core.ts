import { createHash } from "node:crypto";

export const ARMS = ["raw", "off", "on"] as const;
export const BOOTSTRAP_ITERATIONS = 20_000;
export const SKILL_DISCOVERY_BENCHMARK_SEED = 20_260_831;

export type SkillDiscoveryArm = (typeof ARMS)[number];
export type SkillDiscoveryFamily = "instruction" | "metadata" | "relative-resource";
export type SkillDiscoveryFailureClass =
	| "answer"
	| "catalog"
	| "detour"
	| "instrumentation"
	| "none"
	| "process"
	| "provider"
	| "read"
	| "resource"
	| "safety"
	| "selection"
	| "timeout";

export interface SkillDiscoveryManifestFile {
	readonly content: string;
	readonly kind: "decoy-skill" | "resource" | "target-skill";
	readonly path: string;
	readonly sha256: string;
}

export interface SkillDiscoveryManifestSkill {
	readonly description: string;
	readonly name: string;
	readonly skillPath: string;
}

export interface SkillDiscoveryManifestTask {
	readonly armOrder: readonly [SkillDiscoveryArm, SkillDiscoveryArm, SkillDiscoveryArm];
	readonly decoys: readonly [SkillDiscoveryManifestSkill, SkillDiscoveryManifestSkill];
	readonly expectedToken: string;
	readonly family: SkillDiscoveryFamily;
	readonly files: readonly SkillDiscoveryManifestFile[];
	readonly fixtureHash: string;
	readonly id: string;
	readonly prompt: string;
	readonly resourcePath?: string;
	readonly target: SkillDiscoveryManifestSkill;
}

export interface SkillDiscoveryManifest {
	readonly schemaVersion: 1;
	readonly seed: number;
	readonly tasks: readonly SkillDiscoveryManifestTask[];
}

export interface SkillDiscoveryObservation {
	readonly answerExact: boolean;
	readonly arm: SkillDiscoveryArm;
	readonly automaticSelection: boolean;
	readonly catalogExact: boolean;
	readonly detourFree: boolean;
	readonly durationMs: number;
	readonly failureClass: SkillDiscoveryFailureClass;
	readonly family: SkillDiscoveryFamily;
	readonly instrumentationViolation: boolean;
	readonly nestedOperations: number;
	readonly primarySuccess: boolean;
	readonly processFailure: boolean;
	readonly promptBoundaryViolation: boolean;
	readonly protectedFileViolation: boolean;
	readonly providerRequests: number;
	readonly providerToolNames: readonly string[];
	readonly providerToolsExact: boolean;
	readonly readExact: boolean;
	readonly resourceReadExact: boolean;
	readonly safetyViolation: boolean;
	readonly sequence: number;
	readonly skillHashExact: boolean;
	readonly taskId: string;
	readonly timedOut: boolean;
	readonly tokenTotal: number;
	readonly toolCalls: number;
}

export interface SkillDiscoveryEvaluationInvariants {
	readonly armSchedule: boolean;
	readonly host: boolean;
	readonly manifest: boolean;
	readonly providerConfiguration: boolean;
	readonly reportPrivacyViolations: number;
	readonly source: boolean;
}

interface PairedOutcome {
	readonly baseline: boolean;
	readonly candidate: boolean;
	readonly id?: string;
}

export interface BootstrapDifference {
	readonly difference: number;
	readonly interval95: readonly [number, number];
	readonly iterations: number;
	readonly seed: number;
}

export interface McNemarResult {
	readonly bothFailed: number;
	readonly bothSucceeded: number;
	readonly favorable: number;
	readonly pValue: number;
	readonly unfavorable: number;
}

const FAMILIES = ["metadata", "instruction", "relative-resource"] as const satisfies readonly SkillDiscoveryFamily[];

const ARM_PERMUTATIONS = [
	["raw", "off", "on"],
	["raw", "on", "off"],
	["off", "raw", "on"],
	["off", "on", "raw"],
	["on", "raw", "off"],
	["on", "off", "raw"],
] as const satisfies readonly (readonly [SkillDiscoveryArm, SkillDiscoveryArm, SkillDiscoveryArm])[];

const SUBJECTS = {
	metadata: [
		"bronze inclinometer service ledger",
		"carmine dosimeter service ledger",
		"ebony flowmeter service ledger",
		"flax tachometer service ledger",
		"garnet voltmeter service ledger",
		"hazel manometer service ledger",
		"linen pyrometer service ledger",
		"maroon luxmeter service ledger",
		"nickel salinometer service ledger",
		"topaz ammeter service ledger",
	],
	instruction: [
		"azure coupler routing",
		"brass inverter routing",
		"crimson feeder routing",
		"dune actuator routing",
		"emerald chiller routing",
		"graphite mixer routing",
		"honey pump routing",
		"ink compressor routing",
		"juniper solenoid routing",
		"khaki hoist routing",
	],
	"relative-resource": [
		"autumn sonar registry",
		"basalt modem registry",
		"cloud spindle registry",
		"dusk repeater registry",
		"ember rudder registry",
		"fern oscillator registry",
		"glacier switchboard registry",
		"hemlock antenna registry",
		"iris gearbox registry",
		"jasper probe registry",
	],
} as const satisfies Readonly<Record<SkillDiscoveryFamily, readonly string[]>>;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function slug(value: string): string {
	return value.replaceAll(" ", "-");
}

function skillFile(name: string, description: string, body: string, token?: string): string {
	const tokenLine = token ? `verification-token: ${token}\n` : "";
	return `---\nname: ${name}\ndescription: ${description}\n${tokenLine}---\n\n${body}\n`;
}

function manifestFile(
	path: string,
	content: string,
	kind: SkillDiscoveryManifestFile["kind"],
): SkillDiscoveryManifestFile {
	return { content, kind, path, sha256: sha256(content) };
}

function taskPrompt(family: SkillDiscoveryFamily, subject: string): string {
	if (family === "metadata")
		return `Return the current verification token for the ${subject}. Reply with only the token.`;
	if (family === "instruction")
		return `Apply the current transformation for the ${subject}. Reply with only the transformed code.`;
	return `Return the current reference answer for the ${subject}. Reply with only the answer.`;
}

function targetDescription(family: SkillDiscoveryFamily, subject: string): string {
	if (family === "metadata") return `Use when asked for the current verification token for the ${subject}.`;
	if (family === "instruction") return `Use when asked to apply the current transformation for the ${subject}.`;
	return `Use when asked for the current reference answer for the ${subject}.`;
}

function targetBody(family: SkillDiscoveryFamily, index: number): string {
	if (family === "metadata")
		return "Reply with the frontmatter verification-token exactly, with no explanation or formatting.";
	if (family === "instruction") {
		const serial = String(index + 1).padStart(2, "0");
		return `Join the fragments \`INST\`, \`CONFIRM\`, and \`${serial}\` with underscores, preserving order and capitalization. Reply with only the result.`;
	}
	return "Read `references/answer.txt` relative to this directory and reply with its trimmed contents only.";
}

function decoySkill(name: string, description: string, variant: "archived" | "draft"): SkillDiscoveryManifestSkill {
	const decoyName = `${name}-${variant}`;
	return {
		description: description.replace("current", variant),
		name: decoyName,
		skillPath: `skills/${decoyName}/SKILL.md`,
	};
}

function makeTask(family: SkillDiscoveryFamily, subject: string, index: number): SkillDiscoveryManifestTask {
	const serial = String(index + 1).padStart(2, "0");
	const familyPrefix = family === "metadata" ? "meta" : family === "instruction" ? "inst" : "resource";
	const id = `confirm-${familyPrefix}-${serial}`;
	const name = `sd-confirm-${familyPrefix}-${slug(subject)}`;
	const description = targetDescription(family, subject);
	const expectedToken =
		family === "metadata"
			? `META_CONFIRM_${serial}`
			: family === "instruction"
				? `INST_CONFIRM_${serial}`
				: `RESOURCE_CONFIRM_${serial}`;
	const target: SkillDiscoveryManifestSkill = {
		description,
		name,
		skillPath: `skills/${name}/SKILL.md`,
	};
	const decoys = [decoySkill(name, description, "archived"), decoySkill(name, description, "draft")] as const;
	const files: SkillDiscoveryManifestFile[] = [
		manifestFile(
			target.skillPath,
			skillFile(name, description, targetBody(family, index), family === "metadata" ? expectedToken : undefined),
			"target-skill",
		),
		...decoys.map((decoy, decoyIndex) =>
			manifestFile(
				decoy.skillPath,
				skillFile(
					decoy.name,
					decoy.description,
					`This neighboring record is not current. Reply only with DECOY_${familyPrefix.toUpperCase()}_${serial}_${String(decoyIndex + 1)}.`,
				),
				"decoy-skill",
			),
		),
	];
	const resourcePath = family === "relative-resource" ? `skills/${name}/references/answer.txt` : undefined;
	if (resourcePath) files.push(manifestFile(resourcePath, `${expectedToken}\n`, "resource"));
	const fixtureIdentity = files
		.map((file) => `${file.path}\0${file.sha256}`)
		.sort()
		.join("\n");
	const task = {
		armOrder: ARM_PERMUTATIONS[0],
		decoys,
		expectedToken,
		family,
		files,
		fixtureHash: sha256(fixtureIdentity),
		id,
		prompt: taskPrompt(family, subject),
		target,
	} satisfies SkillDiscoveryManifestTask;
	return resourcePath ? { ...task, resourcePath } : task;
}

function nextRandom(state: number): number {
	let value = state | 0;
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	return value >>> 0;
}

function shuffled<Value>(values: readonly Value[], seed: number): Value[] {
	const output = [...values];
	let state = seed;
	for (let index = output.length - 1; index > 0; index -= 1) {
		state = nextRandom(state);
		const target = state % (index + 1);
		const currentValue = output[index];
		const targetValue = output[target];
		if (currentValue === undefined || targetValue === undefined) throw new Error("invalid manifest shuffle index");
		output[index] = targetValue;
		output[target] = currentValue;
	}
	return output;
}

export function createSkillDiscoveryManifest(): SkillDiscoveryManifest {
	const generated = FAMILIES.flatMap((family) =>
		SUBJECTS[family].map((subject, index) => makeTask(family, subject, index)),
	);
	const tasks = shuffled(generated, SKILL_DISCOVERY_BENCHMARK_SEED).map((task, index) => {
		const armOrder = ARM_PERMUTATIONS[index % ARM_PERMUTATIONS.length];
		if (!armOrder) throw new Error("invalid manifest arm-order index");
		return { ...task, armOrder };
	});
	return { schemaVersion: 1, seed: SKILL_DISCOVERY_BENCHMARK_SEED, tasks };
}

export function serializeSkillDiscoveryManifest(): string {
	const manifest = createSkillDiscoveryManifest();
	const records = [{ schemaVersion: manifest.schemaVersion, seed: manifest.seed }, ...manifest.tasks];
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function parseSkillDiscoveryManifest(text: string): SkillDiscoveryManifest {
	let actual: unknown;
	try {
		actual = JSON.parse(`[${text.trim().split("\n").join(",")}]`);
	} catch {
		throw new Error("Skill Discovery manifest is not valid JSON Lines");
	}
	const expected = createSkillDiscoveryManifest();
	const expectedRecords = [{ schemaVersion: expected.schemaVersion, seed: expected.seed }, ...expected.tasks];
	if (JSON.stringify(actual) !== JSON.stringify(expectedRecords))
		throw new Error("Skill Discovery manifest does not match the deterministic generator");
	return expected;
}

export function wilsonInterval95(successes: number, total: number): readonly [number, number] {
	if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || successes < 0 || successes > total)
		throw new Error("invalid Wilson interval counts");
	if (total === 0) return [0, 1];
	const z = 1.959963984540054;
	const proportion = successes / total;
	const denominator = 1 + (z * z) / total;
	const center = (proportion + (z * z) / (2 * total)) / denominator;
	const margin =
		(z / denominator) * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total));
	return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function percentile(values: readonly number[], quantile: number): number {
	if (values.length === 0 || quantile < 0 || quantile > 1) throw new Error("invalid percentile input");
	const sorted = [...values].sort((left, right) => left - right);
	const value = sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
	if (value === undefined) throw new Error("percentile selection failed");
	return value;
}

export function pairedBootstrapDifference(
	pairs: readonly PairedOutcome[],
	iterations = BOOTSTRAP_ITERATIONS,
	seed = SKILL_DISCOVERY_BENCHMARK_SEED,
): BootstrapDifference {
	if (pairs.length === 0 || !Number.isSafeInteger(iterations) || iterations <= 0)
		throw new Error("invalid paired bootstrap input");
	const differences: number[] = [];
	let randomState = seed;
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		let sum = 0;
		for (let sample = 0; sample < pairs.length; sample += 1) {
			randomState = nextRandom(randomState);
			const pair = pairs[randomState % pairs.length];
			if (!pair) throw new Error("paired bootstrap selection failed");
			sum += Number(pair.candidate) - Number(pair.baseline);
		}
		differences.push(sum / pairs.length);
	}
	const difference =
		pairs.reduce((sum, pair) => sum + Number(pair.candidate) - Number(pair.baseline), 0) / pairs.length;
	return {
		difference,
		interval95: [percentile(differences, 0.025), percentile(differences, 0.975)],
		iterations,
		seed,
	};
}

function binomialLowerTail(successes: number, trials: number): number {
	let combination = 1;
	let sum = 0;
	for (let index = 0; index <= successes; index += 1) {
		if (index > 0) combination = (combination * (trials - index + 1)) / index;
		sum += combination;
	}
	return sum / 2 ** trials;
}

export function exactMcNemar(pairs: readonly PairedOutcome[]): McNemarResult {
	let bothFailed = 0;
	let bothSucceeded = 0;
	let favorable = 0;
	let unfavorable = 0;
	for (const pair of pairs) {
		if (pair.baseline && pair.candidate) bothSucceeded += 1;
		else if (!pair.baseline && !pair.candidate) bothFailed += 1;
		else if (pair.candidate) favorable += 1;
		else unfavorable += 1;
	}
	const discordant = favorable + unfavorable;
	const pValue =
		discordant === 0 ? 1 : Math.min(1, 2 * binomialLowerTail(Math.min(favorable, unfavorable), discordant));
	return { bothFailed, bothSucceeded, favorable, pValue, unfavorable };
}

function armMetric(observations: readonly SkillDiscoveryObservation[], arm: SkillDiscoveryArm) {
	const cases = observations.filter((observation) => observation.arm === arm);
	const successes = cases.filter((observation) => observation.primarySuccess).length;
	return { interval95: wilsonInterval95(successes, cases.length), successes, total: cases.length };
}

function pairedOutcomes(
	observations: readonly SkillDiscoveryObservation[],
	baseline: SkillDiscoveryArm,
	candidate: SkillDiscoveryArm,
): PairedOutcome[] {
	const tasks = new Map<string, Partial<Record<SkillDiscoveryArm, boolean>>>();
	for (const observation of observations) {
		const arms = tasks.get(observation.taskId) ?? {};
		if (arms[observation.arm] !== undefined) throw new Error("duplicate Skill Discovery benchmark observation");
		arms[observation.arm] = observation.primarySuccess;
		tasks.set(observation.taskId, arms);
	}
	return [...tasks].map(([id, outcomes]) => {
		if (outcomes[baseline] === undefined || outcomes[candidate] === undefined)
			throw new Error("incomplete Skill Discovery benchmark triad");
		return { baseline: outcomes[baseline], candidate: outcomes[candidate], id };
	});
}

export function evaluateSkillDiscoveryBenchmark(
	observations: readonly SkillDiscoveryObservation[],
	invariants: SkillDiscoveryEvaluationInvariants,
) {
	const arms = {
		raw: armMetric(observations, "raw"),
		off: armMetric(observations, "off"),
		on: armMetric(observations, "on"),
	};
	const suitePairs = pairedOutcomes(observations, "raw", "off");
	const codePairs = pairedOutcomes(observations, "off", "on");
	const comparisons = {
		suite: { bootstrap: pairedBootstrapDifference(suitePairs), mcnemar: exactMcNemar(suitePairs) },
		code: { bootstrap: pairedBootstrapDifference(codePairs), mcnemar: exactMcNemar(codePairs) },
	};
	const violations = {
		instrumentation: observations.filter((item) => item.instrumentationViolation).length,
		promptBoundary: observations.filter((item) => item.promptBoundaryViolation).length,
		protectedFile: observations.filter((item) => item.protectedFileViolation).length,
		reportPrivacy: invariants.reportPrivacyViolations,
		safety: observations.filter((item) => item.safetyViolation).length,
	};
	const hardInvariants = {
		armSchedule: invariants.armSchedule,
		host: invariants.host,
		manifest: invariants.manifest,
		providerConfiguration: invariants.providerConfiguration,
		providerTools: observations.every((item) => item.providerToolsExact),
		source: invariants.source,
	};
	const passed =
		observations.length === 90 &&
		arms.raw.total === 30 &&
		arms.off.total === 30 &&
		arms.on.total === 30 &&
		arms.raw.successes <= arms.off.successes &&
		arms.off.successes <= arms.on.successes &&
		comparisons.suite.bootstrap.interval95[0] > -0.1 &&
		comparisons.code.bootstrap.interval95[0] > -0.1 &&
		violations.instrumentation === 0 &&
		violations.promptBoundary === 0 &&
		violations.protectedFile === 0 &&
		violations.reportPrivacy === 0 &&
		Object.values(hardInvariants).every(Boolean);
	const improved = [comparisons.suite.mcnemar, comparisons.code.mcnemar].some(
		(result) => result.favorable > result.unfavorable && result.pValue <= 0.05,
	);
	return {
		arms,
		comparisons,
		hardInvariants,
		verdict: {
			claim: passed
				? improved
					? "improved-under-preregistered-gate"
					: "non-inferior-under-preregistered-gate"
				: "failed",
			passed,
		},
		violations,
	};
}
