import { copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type {
	Action,
	BenchmarkOptions,
	CellSummary,
	LifecycleSample,
	LifecycleTraceEvent,
	MetricSummary,
	Scenario,
	SeededSessions,
	TerminalSize,
	Variant,
} from "./benchmark-lifecycle.js";
import {
	lifecycleExpectProgram,
	parseHostTimings,
	parseMetric,
	verifySessionDurability,
	verifyTerminalState,
} from "./lifecycle-benchmark-fixture.js";

const SUITE_TRACE_SCHEMA = Type.Object(
	{
		events: Type.Array(
			Type.Object(
				{
					atMs: Type.Number(),
					label: Type.String(),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);

interface ExpectMetrics {
	acknowledgementMs?: number;
	interruptMs?: number;
	providerStartMs?: number;
	reloadMs?: number;
	responseMs?: number;
	shutdownMs: number;
	steadyAcknowledgementMs?: number;
	steadyProviderStartMs?: number;
	steadyResponseMs?: number;
	startupMs: number;
}

const OPTIONAL_METRICS = [
	["acknowledgement", "acknowledgementMs"],
	["interrupt", "interruptMs"],
	["providerStart", "providerStartMs"],
	["reload", "reloadMs"],
	["response", "responseMs"],
	["steadyAcknowledgement", "steadyAcknowledgementMs"],
	["steadyProviderStart", "steadyProviderStartMs"],
	["steadyResponse", "steadyResponseMs"],
] as const;

function fail(message: string): never {
	throw new Error(`Lifecycle benchmark failed: ${message}`);
}

export function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) fail("cannot calculate a percentile without samples");
	if (!(fraction >= 0 && fraction <= 1)) fail("percentile fraction must be from zero through one");
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
	const result = sorted[index];
	if (result === undefined) fail("percentile selected no sample");
	return result;
}

const rounded = (value: number): number => Number(value.toFixed(2));

export function summarize(values: readonly number[]): MetricSummary {
	return {
		maximum: rounded(Math.max(...values)),
		minimum: rounded(Math.min(...values)),
		p50: rounded(percentile(values, 0.5)),
		p95: rounded(percentile(values, 0.95)),
		samples: values.length,
	};
}

function isolatedEnvironment(root: string) {
	const path = process.env["PATH"];
	if (!path) fail("PATH is required");
	return {
		HOME: join(root, "home"),
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		PATH: path,
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
		SHELL: "/bin/sh",
		TERM: "xterm-256color",
		XDG_CACHE_HOME: join(root, "cache"),
		XDG_CONFIG_HOME: join(root, "xdg-config"),
		XDG_DATA_HOME: join(root, "data"),
		XDG_STATE_HOME: join(root, "state"),
	};
}

function benchmarkAgentSource(fixtureExtension: string): string {
	return `---
name: general-purpose
description: Deterministic lifecycle benchmark Agent.
model: pi-stuff-lifecycle-benchmark/fixture-model
extensions: ${fixtureExtension}
inheritProjectContext: false
inheritSkills: false
---

Complete the deterministic lifecycle benchmark task.
`;
}

function sampleContextConfig(options: BenchmarkOptions, scenario: Scenario): string {
	if (scenario === "degraded") return "{ invalid lifecycle fixture\n";
	return `${JSON.stringify({
		dreamer: { disable: true },
		embedding: { provider: "off" },
		enabled: options.contextEnabled,
		fail_closed_blocking: false,
		sidekick: { disable: true },
		toast_duration_ms: 0,
		todowrite: { enabled: false, overlay: false },
	})}\n`;
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

async function assertProcessSettles(path: string, timeoutMs: number): Promise<void> {
	const raw = await readFile(path, "utf8");
	const pid = Number(raw.trim());
	if (!Number.isSafeInteger(pid) || pid <= 1) fail(`invalid lifecycle resource pid in ${path}`);
	const deadline = performance.now() + timeoutMs;
	while (processIsAlive(pid) && performance.now() < deadline) await Bun.sleep(25);
	if (processIsAlive(pid))
		fail(`lifecycle resource ${path} process ${String(pid)} remained alive after ${String(timeoutMs)}ms`);
}

async function executeSample(
	options: BenchmarkOptions,
	benchmarkRoot: string,
	runDirectory: string,
	environment: Record<string, string>,
	variant: Variant,
	scenario: Scenario,
	action: Action,
	size: TerminalSize,
	sessionDirectory: string,
	sessionFile: string,
): Promise<string> {
	const result = Bun.spawnSync(
		["expect", "-c", lifecycleExpectProgram(action, options.trace, options.promptRepetitions)],
		{
			cwd: join(benchmarkRoot, "project"),
			env: environment,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
	if (result.exitCode !== 0) {
		const log = await readFile(join(runDirectory, "pty.log"), "utf8").catch(() => "<PTY log unavailable>");
		fail(
			`${variant}/${scenario}/${action}/${String(size.columns)}x${String(size.rows)} exited ${String(result.exitCode)}: ${output.trim()}\nPTY tail:\n${log.slice(-20_000)}`,
		);
	}
	verifyTerminalState(await readFile(join(runDirectory, "tty-state.txt"), "utf8"), size);
	if (action === "background-exit") await assertProcessSettles(join(runDirectory, "background-shell.pid"), 2_000);
	if (action === "agent-exit") {
		await Promise.all(
			["agent-pi.pid", "agent-shell.pid", "agent-descendant.pid"].map((name) =>
				assertProcessSettles(join(runDirectory, name), 8_000),
			),
		);
	}
	await verifySessionDurability(
		sessionDirectory,
		sessionFile,
		action,
		scenario,
		options.longSessionTools,
		options.longSessionToolBytes,
	);
	return output;
}

async function collectSample(
	options: BenchmarkOptions,
	runDirectory: string,
	output: string,
	traceSuite: boolean,
	variant: Variant,
	scenario: Scenario,
	action: Action,
	size: TerminalSize,
	iteration: number,
	warmup: boolean,
): Promise<LifecycleSample> {
	const metrics: ExpectMetrics = {
		shutdownMs: parseMetric(output, "shutdown"),
		startupMs: parseMetric(output, "startup"),
	};
	if (action === "agent-exit") metrics.interruptMs = parseMetric(output, "interrupt");
	if (action === "reload" || action === "reload-change") metrics.reloadMs = parseMetric(output, "reload");
	if (action === "prompt") {
		metrics.acknowledgementMs = parseMetric(output, "acknowledgement");
		metrics.providerStartMs = parseMetric(output, "provider_start");
		metrics.responseMs = parseMetric(output, "response");
		metrics.steadyAcknowledgementMs = parseMetric(output, "steady_acknowledgement");
		metrics.steadyProviderStartMs = parseMetric(output, "steady_provider_start");
		metrics.steadyResponseMs = parseMetric(output, "steady_response");
	}
	const trace = options.trace ? parseHostTimings(output) : [];
	if (options.trace && trace.length === 0) {
		fail(`PI_TIMING produced no parseable Host timings; PTY tail:\n${output.slice(-20_000)}`);
	}
	let suiteTrace: readonly LifecycleTraceEvent[] | undefined;
	if (traceSuite) {
		const document = JSON.parse(await readFile(join(runDirectory, "suite-trace.json"), "utf8"));
		if (!Check(SUITE_TRACE_SCHEMA, document)) fail("Suite lifecycle trace was not persisted");
		suiteTrace = document.events;
	}
	if (action === "reload" && variant === "suite" && suiteTrace) {
		const labels = suiteTrace.map((event) => event.label);
		if (!labels.includes("suite.loader.cache.hit")) fail("unchanged Suite reload did not use the runtime cache");
		if (labels.filter((label) => label === "suite.module-imported").length !== 1) {
			fail("unchanged Suite reload unexpectedly re-evaluated the generated runtime module");
		}
	}
	if (action === "reload-change" && suiteTrace) {
		const moduleImports = suiteTrace.filter((event) => event.label === "suite.module-imported");
		if (moduleImports.length < 2) fail("Suite source change did not re-evaluate the generated runtime module");
		if (!suiteTrace.some((event) => event.label === "suite.source-change.applied")) {
			fail("Suite source change did not re-evaluate the changed nested module");
		}
	}
	const sample: LifecycleSample = {
		action,
		columns: size.columns,
		iteration,
		rows: size.rows,
		scenario,
		shutdownMs: rounded(metrics.shutdownMs),
		startupMs: rounded(metrics.startupMs),
		variant,
		warmup,
	};
	for (const [, name] of OPTIONAL_METRICS) {
		const value = metrics[name];
		if (value !== undefined) Object.assign(sample, { [name]: name === "reloadMs" ? value : rounded(value) });
	}
	if (suiteTrace) Object.assign(sample, { suiteTrace });
	if (trace.length > 0) Object.assign(sample, { trace });
	return sample;
}

export async function runSample(
	options: BenchmarkOptions,
	benchmarkRoot: string,
	fixturePackage: string,
	seeded: SeededSessions,
	variant: Variant,
	scenario: Scenario,
	action: Action,
	size: TerminalSize,
	iteration: number,
	warmup: boolean,
	phase: "initial" | "confirmation" = "initial",
): Promise<LifecycleSample> {
	const phasePrefix = phase === "confirmation" ? "confirmation-" : "";
	const runDirectory = join(
		benchmarkRoot,
		"runs",
		`${phasePrefix}${variant}-${scenario}-${action}-${String(size.columns)}x${String(size.rows)}-${warmup ? "warmup" : "sample"}-${String(iteration)}`,
	);
	const configDirectory = join(runDirectory, "agent");
	const sessionDirectory = join(runDirectory, "sessions");
	const agentDirectory = join(configDirectory, "agents");
	const sourceChangePackage = join(runDirectory, "suite-package");
	const sourceChangeFile = join(sourceChangePackage, "src", "todo", "index.ts");
	const contextConfigDirectory = join(runDirectory, "xdg-config", "cortexkit");
	await Promise.all([
		mkdir(configDirectory, { recursive: true }),
		mkdir(sessionDirectory, { recursive: true }),
		mkdir(agentDirectory, { recursive: true }),
		...(variant === "suite" ? [mkdir(contextConfigDirectory, { recursive: true })] : []),
	]);
	if (action === "reload-change") {
		const dependencyDirectory = join(options.packagePath, "node_modules");
		await cp(options.packagePath, sourceChangePackage, {
			recursive: true,
			filter: (source) => source !== dependencyDirectory,
		});
		await symlink(dependencyDirectory, join(sourceChangePackage, "node_modules"), "dir");
	}
	const samplePackagePath = action === "reload-change" ? sourceChangePackage : options.packagePath;
	await Promise.all([
		writeFile(
			join(configDirectory, "settings.json"),
			`${JSON.stringify({
				defaultProjectTrust: "always",
				packages: variant === "suite" ? [samplePackagePath, fixturePackage] : [fixturePackage],
				quietStartup: true,
				tuiMode: "fullscreen",
			})}\n`,
			{ mode: 0o600 },
		),
		writeFile(
			join(agentDirectory, "general-purpose.md"),
			benchmarkAgentSource(join(fixturePackage, "extension.js")),
			{ mode: 0o600 },
		),
		...(variant === "suite"
			? [
					writeFile(join(contextConfigDirectory, "magic-context.jsonc"), sampleContextConfig(options, scenario), {
						mode: 0o600,
					}),
				]
			: []),
	]);
	const sessionFile =
		scenario === "resume-short" || scenario === "resume-long" ? join(sessionDirectory, `${scenario}.jsonl`) : "";
	if (sessionFile) {
		await copyFile(scenario === "resume-long" ? seeded.long : seeded.short, sessionFile);
	}

	const traceSuite = options.trace || action === "reload-change";
	const environment = {
		...isolatedEnvironment(runDirectory),
		HF_HOME: join(runDirectory, "cache"),
		HF_HUB_OFFLINE: "1",
		PI_CODING_AGENT_DIR: configDirectory,
		PS5BW_COLUMNS: String(size.columns),
		PS5BW_EXPECT_SUITE: variant === "suite" ? "1" : "0",
		PS5BW_BACKGROUND_SHELL_PID: join(runDirectory, "background-shell.pid"),
		PS5BW_AGENT_PI_PID: join(runDirectory, "agent-pi.pid"),
		PS5BW_AGENT_SHELL_PID: join(runDirectory, "agent-shell.pid"),
		PS5BW_AGENT_DESCENDANT_PID: join(runDirectory, "agent-descendant.pid"),
		PS5BW_PI_BIN: options.piBinary,
		PS5BW_PTY_LOG: join(runDirectory, "pty.log"),
		PS5BW_ROWS: String(size.rows),
		PS5BW_RUNNER: join(benchmarkRoot, "runner.sh"),
		PS5BW_SCENARIO: scenario,
		PS5BW_SOURCE_CHANGE_FILE: sourceChangeFile,
		PS5BW_SESSION_DIR: sessionDirectory,
		PS5BW_SESSION_FILE: sessionFile,
		PS5BW_SESSION_ID: `ps5bw-${phasePrefix}${variant}-${scenario}-${action}-${String(iteration)}`,
		PS5BW_TTY_STATE: join(runDirectory, "tty-state.txt"),
		PS5BW_SUITE_TRACE: join(runDirectory, "suite-trace.json"),
		PS5BW_SURFACE_MARKER: `PS5BW_SURFACE_READY_${variant.toUpperCase()}`,
		PS5BW_TRACE_EXTENSION: traceSuite ? seeded.traceExtension : "",
		TRANSFORMERS_OFFLINE: "1",
	};
	const childBunOptions = process.env["PS5BW_CHILD_BUN_OPTIONS"];
	if (childBunOptions) Object.assign(environment, { BUN_OPTIONS: childBunOptions });
	if (options.trace) Object.assign(environment, { PI_TIMING: "1" });
	const output = await executeSample(
		options,
		benchmarkRoot,
		runDirectory,
		environment,
		variant,
		scenario,
		action,
		size,
		sessionDirectory,
		sessionFile,
	);
	return collectSample(options, runDirectory, output, traceSuite, variant, scenario, action, size, iteration, warmup);
}

export function cellKey(sample: LifecycleSample): string {
	return `${sample.variant}/${sample.scenario}/${sample.action}/${String(sample.columns)}x${String(sample.rows)}`;
}

export function summaries(samples: readonly LifecycleSample[]): CellSummary[] {
	const cells = new Map<string, { measured: LifecycleSample[]; warmups: number }>();
	for (const sample of samples) {
		const key = cellKey(sample);
		const cell = cells.get(key) ?? { measured: [], warmups: 0 };
		if (sample.warmup) cell.warmups += 1;
		else cell.measured.push(sample);
		cells.set(key, cell);
	}
	const results: CellSummary[] = [];
	for (const { measured: values, warmups } of cells.values()) {
		const [first] = values;
		if (!first) continue;
		const result = {
			action: first.action,
			columns: first.columns,
			rows: first.rows,
			scenario: first.scenario,
			shutdown: summarize(values.map((sample) => sample.shutdownMs)),
			startup: summarize(values.map((sample) => sample.startupMs)),
			variant: first.variant,
			warmups,
		};
		for (const [summaryName, sampleName] of OPTIONAL_METRICS) {
			const metricValues = values.flatMap((sample) => {
				const value = sample[sampleName];
				return value === undefined ? [] : [value];
			});
			if (metricValues.length > 0) Object.assign(result, { [summaryName]: summarize(metricValues) });
		}
		results.push(result);
	}
	return results;
}
