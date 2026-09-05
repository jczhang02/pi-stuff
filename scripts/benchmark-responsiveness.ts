import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readlinkSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_RELEASE_BINARY_SHA256 } from "./pi-host-contract.js";
import { type PtyObservation, summarizePtyObservations } from "./pty-observation.js";
import { armUiPtyOwnerWatchdog, disarmUiPtyOwnerWatchdog, type UiPtyOwnerWatchdog } from "./ui-pty-owner-watchdog.js";
import { stageCertifiedPiHost } from "./verify-pi-host-provenance.js";

const root = resolve(import.meta.dir, "..");
const provider = join(root, "test/fixtures/responsiveness-provider.ts");
const { values } = parseArgs({
	options: {
		pi: { type: "string", default: process.env["PI_BIN"] ?? "/opt/bin/pi" },
		suite: { type: "boolean", default: false },
		"code-mode": { type: "boolean", default: false },
		ledger: { type: "boolean", default: false },
		snippet: { type: "boolean", default: false },
		"repeat-tool": { type: "boolean", default: false },
		columns: { type: "string", default: "120" },
		rows: { type: "string", default: "40" },
		"block-ms": { type: "string", default: "0" },
		"block-phase": { type: "string", default: "pre-tool" },
		"cpu-profile": { type: "boolean", default: false },
		gates: { type: "string" },
	},
	strict: true,
	allowPositionals: false,
});
const columns = Number(values.columns);
const rows = Number(values.rows);
const blockMs = Number(values["block-ms"]);
const blockPhase = values["block-phase"];
const usage = values.suite;
const codeMode = values["code-mode"];
const profileCpu = values["cpu-profile"];
assert(Number.isSafeInteger(columns) && columns >= 40 && columns <= 240, "Invalid terminal width");
assert(Number.isSafeInteger(rows) && rows >= 20 && rows <= 80, "Invalid terminal height");
assert(Number.isFinite(blockMs) && blockMs >= 0 && blockMs <= 1_000, "Invalid negative-control duration");
assert(["startup", "pre-tool", "settlement"].includes(blockPhase), "Invalid negative-control phase");
assert(!codeMode || usage, "Code Mode requires the Suite");
assert(!values.snippet || values.ledger, "Saved snippet requires a synthetic Ledger");
assert(!profileCpu || !values.gates, "A CPU profile is diagnostic, not a responsiveness acceptance sample");

const LIMITS_SCHEMA = Type.Object({
	hostBinarySha256: Type.Literal(CERTIFIED_PI_RELEASE_BINARY_SHA256),
	maximumObservationGapMs: Type.Number({ minimum: 0 }),
	maximumActiveSpinnerAbsenceMs: Type.Number({ minimum: 0 }),
	spinnerMs: Type.Number({ minimum: 0 }),
	startupInputMs: Type.Number({ minimum: 0 }),
	steadyInputMs: Type.Number({ minimum: 0 }),
	selectionMs: Type.Number({ minimum: 0 }),
});
let limits: Static<typeof LIMITS_SCHEMA> | undefined;
if (values.gates) {
	const loaded = parseJsonValue(await readFile(values.gates, "utf8"));
	assert(Check(LIMITS_SCHEMA, loaded), "Invalid gates or wrong certified Host");
	limits = loaded;
}
const PROVIDER_LOG_SCHEMA = Type.Array(
	Type.Object({
		type: Type.String(),
		completedTools: Type.Optional(Type.Integer()),
		name: Type.Optional(Type.String()),
	}),
);
const directory = await mkdtemp(join(tmpdir(), "pi-stuff-responsiveness-"));
const { binaryPath: piBinary } = await stageCertifiedPiHost(values.pi, directory);
await Promise.all(["home", "agent", "project", "sessions"].map((name) => mkdir(join(directory, name))));
await writeFile(
	join(directory, "agent/settings.json"),
	JSON.stringify({
		quietStartup: true,
		tuiMode: "fullscreen",
		defaultProjectTrust: "always",
	}),
);
let codeModeHostSha256: string | undefined;
if (codeMode) {
	const helper = process.env["PI_STUFF_CODE_MODE_HOST"];
	assert(helper, "Set PI_STUFF_CODE_MODE_HOST to the prepared certified helper");
	assert((await stat(helper)).isFile(), "Code Mode helper must be a regular file");
	await copyFile(helper, join(directory, "codex-code-mode-host"));
	codeModeHostSha256 = createHash("sha256")
		.update(await readFile(join(directory, "codex-code-mode-host")))
		.digest("hex");
	await writeFile(join(directory, "agent/pi-stuff.json"), JSON.stringify({ codeMode: { enabled: true } }));
}
const providerLogPath = join(directory, "provider.jsonl");
const env: NodeJS.ProcessEnv = {
	PATH: process.env["PATH"],
	HOME: join(directory, "home"),
	PI_CODING_AGENT_DIR: join(directory, "agent"),
	XDG_CONFIG_HOME: join(directory, "config"),
	XDG_CACHE_HOME: join(directory, "cache"),
	XDG_DATA_HOME: join(directory, "data"),
	XDG_STATE_HOME: join(directory, "state"),
	LANG: "C.UTF-8",
	LC_ALL: "C.UTF-8",
	TERM: "xterm-256color",
	SHELL: "/bin/sh",
	PI_OFFLINE: usage ? "0" : "1",
	PI_TELEMETRY: "0",
	PSYON_NEGATIVE_BLOCK_MS: String(blockMs),
	PSYON_NEGATIVE_BLOCK_PHASE: blockPhase,
	PSYON_TOOL_MODE: codeMode ? "codemode" : "bash",
	PSYON_REPEAT_TOOL: values["repeat-tool"] ? "1" : "0",
	PSYON_PROVIDER_LOG: providerLogPath,
	PSYON_USAGE_URL: "",
};
if (codeMode) env["PI_STUFF_CODE_MODE_HOST"] = join(directory, "codex-code-mode-host");
if (profileCpu) env["BUN_OPTIONS"] = `--cpu-prof --cpu-prof-dir=${directory}`;
const baseCommand = [
	piBinary,
	"--approve",
	"--no-extensions",
	"--no-context-files",
	"--no-skills",
	"--no-prompt-templates",
	"--no-themes",
];
let seedSession: string | undefined;
if (values.ledger) {
	const seed = Bun.spawn(
		[
			...baseCommand,
			"--offline",
			"--extension",
			provider,
			"--provider",
			"psyon-cadence",
			"--model",
			"cadence-model",
			"--session-dir",
			join(directory, "sessions"),
			"--print",
			"seed synthetic Ledger",
		],
		{
			cwd: join(directory, "project"),
			stdout: "pipe",
			stderr: "pipe",
			timeout: 30_000,
			killSignal: "SIGKILL",
			env: {
				...env,
				PI_OFFLINE: "1",
				PSYON_USAGE_URL: "",
				PSYON_SEED_LEDGER: "1",
				PSYON_LEDGER_SNIPPET: values.snippet ? "1" : "0",
				PSYON_NEGATIVE_BLOCK_MS: "0",
				BUN_OPTIONS: "",
			},
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		seed.exited,
		new Response(seed.stdout).text(),
		new Response(seed.stderr).text(),
	]);
	assert.equal(exitCode, 0, stderr);
	assert(stdout.includes("PSYON_SEEDED"), "Synthetic native Ledger was not persisted");
	const files = (await readdir(join(directory, "sessions"))).filter((name) => name.endsWith(".jsonl"));
	assert.equal(files.length, 1, "Expected one synthetic native Session");
	const file = files[0];
	assert(file);
	seedSession = join(directory, "sessions", file);
}
await writeFile(providerLogPath, "");
const usageRequests: { path: string; at: number }[] = [];
let server: ReturnType<typeof Bun.serve> | undefined;
const git = (...args: string[]): string => {
	const result = Bun.spawnSync(["git", ...args], { cwd: root });
	assert.equal(result.exitCode, 0, result.stderr.toString());
	return result.stdout.toString();
};
const source = {
	commit: git("rev-parse", "HEAD").trim(),
	diff: git("diff", "HEAD"),
	snapshots: await Promise.all(
		[
			"scripts/benchmark-responsiveness.ts",
			"scripts/pty-observation.ts",
			"test/fixtures/responsiveness-provider.ts",
			"test/fixtures/faux-provider.ts",
		].map(async (file) => {
			const content = await readFile(join(root, file), "utf8");
			return { file, sha256: createHash("sha256").update(content).digest("hex"), content };
		}),
	),
};
const socket = join(directory, "tmux.sock");
const tmux = (...args: string[]): string => {
	const child = Bun.spawnSync(["tmux", "-S", socket, ...args], {
		env,
		cwd: join(directory, "project"),
		stdout: "pipe",
		stderr: "pipe",
	});
	assert.equal(child.exitCode, 0, child.stderr.toString());
	return child.stdout.toString();
};
const command = [
	...baseCommand,
	...(usage ? [] : ["--offline"]),
	"--tui-mode",
	"fullscreen",
	...(usage ? ["--extension", join(root, "packages/pi-stuff")] : []),
	// Register observation markers after every Suite lifecycle handler.
	"--extension",
	provider,
	"--provider",
	usage ? "openai-codex" : "psyon-cadence",
	"--model",
	"cadence-model",
	"--session-dir",
	join(directory, "sessions"),
	...(seedSession ? ["--session", seedSession] : []),
];
const shellCommand = command.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ");
let watchdog: UiPtyOwnerWatchdog | undefined;
const observations: (PtyObservation & { frame: string })[] = [];
const actions: { kind: string; phase: string; startedMs: number; visibleMs: number }[] = [];
const selected = (frame: string) => /^\s*→\s+(psyon-[\w-]+)/mu.exec(frame)?.[1];
const send = (...keys: string[]) => tmux("send-keys", "-t", "cadence:0.0", ...keys);
let pending: { kind: string; phase: string; startedMs: number; visible: (frame: string) => boolean } | undefined;
let firstActive = -1;
let lastActive = -1;
let readySeenMs: number | undefined;
let firstEditorMs: number | undefined;
let promptSentMs: number | undefined;
let agentEndIndex = -1;
let settledSeenMs: number | undefined;
let completedAt: number | undefined;
let responseSeen = false;
let nextActionMs = Infinity;
let nextAction = 0;
let lastFrame = "";
let summary: object | undefined;
const phase = () =>
	completedAt !== undefined ? "idle" : agentEndIndex >= 0 ? "settlement" : firstActive >= 0 ? "active" : "startup";
try {
	if (usage) {
		const parentNamespace = process.env["PSYON_PARENT_NETNS"];
		assert(parentNamespace?.startsWith("net:["), "Parent network namespace identity is required");
		assert.notEqual(
			readlinkSync("/proc/self/ns/net"),
			parentNamespace,
			"Suite probe requires an isolated network namespace",
		);
		assert.equal(Bun.spawnSync(["ip", "link", "set", "lo", "up"]).exitCode, 0);
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const path = new URL(request.url).pathname;
				assert.equal(path, "/backend-api/wham/usage");
				assert.equal(request.headers.get("authorization"), "Bearer synthetic-fixture-token");
				assert.equal(request.headers.get("chatgpt-account-id"), "synthetic-fixture-account");
				usageRequests.push({ path, at: performance.now() });
				return Response.json({
					plan_type: "fixture",
					rate_limit: { secondary: { used_percent: 10, window_minutes: 10_080 } },
				});
			},
		});
		env["PSYON_USAGE_URL"] = `http://127.0.0.1:${String(server.port)}/backend-api`;
	}
	watchdog = await armUiPtyOwnerWatchdog(socket);
	const start = performance.now();
	const observerCpu = process.cpuUsage();
	tmux(
		"-f",
		"/dev/null",
		"new-session",
		"-d",
		"-s",
		"cadence",
		"-x",
		String(columns),
		"-y",
		String(rows),
		shellCommand,
	);
	while (performance.now() - start < 30_000) {
		const captureStartedMs = performance.now();
		const frame = tmux("capture-pane", "-p", "-N", "-t", "cadence:0.0");
		const capturedMs = performance.now();
		lastFrame = frame;
		const spinner = /([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])\s+Working/u.exec(frame)?.[1];
		const observation: PtyObservation & { frame: string } = { captureStartedMs, capturedMs, frame };
		observations.push(spinner ? { ...observation, spinner } : observation);
		if (readySeenMs === undefined && frame.includes("PSYON_READY")) {
			readySeenMs = capturedMs;
		}
		// Pi accepts text before session_start handlers finish. Do not wait for PSYON_READY to probe it.
		if (firstEditorMs === undefined && frame.includes("cadence-model") && /─{20,}/u.test(frame)) {
			firstEditorMs = capturedMs;
			nextActionMs = capturedMs;
		}
		if (spinner) {
			lastActive = observations.length - 1;
			if (firstActive < 0) firstActive = lastActive;
		}
		if (agentEndIndex < 0 && frame.includes("PSYON_AGENT_END")) agentEndIndex = observations.length - 1;
		if (settledSeenMs === undefined && frame.includes("PSYON_SETTLED")) settledSeenMs = capturedMs;
		responseSeen ||= frame.includes("PSYON_CADENCE_DONE");
		if (pending?.visible(frame)) {
			actions.push({
				kind: pending.kind,
				phase: pending.phase,
				startedMs: pending.startedMs,
				visibleMs: capturedMs - pending.startedMs,
			});
			if (pending.kind === "selection-setup") {
				const before = selected(frame);
				const startedMs = performance.now();
				send("Down");
				pending = {
					kind: "selection",
					phase: phase(),
					startedMs,
					visible: (next) => selected(next) !== undefined && selected(next) !== before,
				};
			} else {
				send("C-u");
				pending = undefined;
				nextActionMs = capturedMs + 250;
			}
		}
		if (settledSeenMs !== undefined && completedAt === undefined) {
			if (
				!usage ||
				(usageRequests.length > 0 && (await readFile(providerLogPath, "utf8")).includes('"name-persisted"'))
			)
				completedAt = capturedMs;
		}
		const completedMs = completedAt;
		if (
			completedMs !== undefined &&
			!pending &&
			["input", "selection"].every((kind) =>
				actions.some((action) => action.kind === kind && action.startedMs >= completedMs),
			)
		)
			break;
		if (
			promptSentMs === undefined &&
			readySeenMs !== undefined &&
			!pending &&
			["input", "selection"].every((kind) => actions.some((action) => action.kind === kind))
		) {
			promptSentMs = performance.now();
			send("-l", "--", "PSYON_MEASURE");
			send("Enter");
		}
		if (!pending && capturedMs >= nextActionMs) {
			const startedMs = performance.now();
			if (nextAction % 2 === 0 || readySeenMs === undefined) {
				const marker = `PSYON_INPUT_${nextAction}`;
				send("-l", "--", marker);
				pending = { kind: "input", phase: phase(), startedMs, visible: (next) => next.includes(marker) };
			} else {
				send("-l", "--", "/psyon-");
				pending = {
					kind: "selection-setup",
					phase: phase(),
					startedMs,
					visible: (next) => selected(next) !== undefined,
				};
			}
			nextAction++;
		}
		await Bun.sleep(10);
	}
	const completedMs = completedAt;
	assert(
		responseSeen &&
			completedMs !== undefined &&
			firstActive >= 0 &&
			lastActive > firstActive &&
			agentEndIndex > firstActive,
		`Observation incomplete: ${lastFrame}`,
	);
	assert(
		actions.some((action) => action.kind === "input") && actions.some((action) => action.kind === "selection"),
		"Input/selection evidence missing",
	);
	assert(
		!pending &&
			["input", "selection"].every((kind) =>
				actions.some((action) => action.kind === kind && action.startedMs >= completedMs),
			),
		"Post-settlement interaction did not complete",
	);
	const providerLog = (await readFile(providerLogPath, "utf8")).trim().split("\n").map(parseJsonValue);
	assert(Check(PROVIDER_LOG_SCHEMA, providerLog), "Invalid fixture Provider evidence");
	assert.deepEqual(
		providerLog.filter((entry) => entry.type === "agent-request").map((entry) => entry.completedTools),
		values["repeat-tool"] ? [0, 1, 2] : [0, 1],
	);
	if (usage) {
		assert.equal(usageRequests.length, 1, "Exactly one automatic usage refresh is expected");
		assert.equal(providerLog.filter((entry) => entry.type === "naming-request").length, 1);
		assert(providerLog.some((entry) => entry.type === "name-persisted" && entry.name === "Cadence Resource Fixture"));
	}
	const active = summarizePtyObservations(observations.slice(firstActive, agentEndIndex));
	const firstSpinner = observations[firstActive];
	const finalObservation = observations.at(-1);
	const firstInput = actions.find((action) => action.kind === "input");
	assert(
		firstSpinner &&
			finalObservation &&
			firstInput &&
			readySeenMs !== undefined &&
			firstEditorMs !== undefined &&
			promptSentMs !== undefined &&
			settledSeenMs !== undefined,
		"Required timing evidence missing",
	);
	summary = {
		purpose: profileCpu ? "cpu-diagnosis" : "observer-validation",
		certification: false,
		profile: CERTIFIED_PI_HOST_PROFILE,
		seededSession: Boolean(seedSession),
		codeMode,
		codeModeHostSha256,
		requestedToolCount: values["repeat-tool"] ? 2 : 1,
		negativeBlockMs: blockMs,
		negativeBlockPhase: blockPhase,
		automaticUsageRefreshes: usageRequests.length,
		suite: usage,
		columns,
		rows,
		...summarizePtyObservations(observations),
		// Spinner absence is valid before an Agent run and after agent_end; capture gaps and held frames are measured over the entire trace.
		maximumSpinnerAbsenceMs: active.maximumSpinnerAbsenceMs,
		activeDurationMs: active.durationMs,
		activeCaptureCount: active.captureCount,
		firstSpinnerMs: firstSpinner.capturedMs - start,
		firstReadyMs: readySeenMs - start,
		firstEditorMs: firstEditorMs - start,
		promptToSpinnerMs: firstSpinner.capturedMs - promptSentMs,
		startupInputMs: firstInput.startedMs + firstInput.visibleMs - start,
		settledMs: settledSeenMs - start,
		postSettlementObservationMs: finalObservation.capturedMs - settledSeenMs,
		observerCpu: process.cpuUsage(observerCpu),
		maximumInputMs: Math.max(
			...actions.filter((action) => action.kind !== "selection").map((action) => action.visibleMs),
		),
		maximumStartupInputMs: Math.max(
			...actions
				.filter((action) => action.kind !== "selection" && action.phase === "startup")
				.map((action) => action.visibleMs),
		),
		maximumSteadyInputMs: Math.max(
			...actions
				.filter((action) => action.kind !== "selection" && action.phase !== "startup")
				.map((action) => action.visibleMs),
		),
		maximumSelectionMs: Math.max(
			...actions.filter((action) => action.kind === "selection").map((action) => action.visibleMs),
		),
		maximumSelectionSetupMs: Math.max(
			...actions.filter((action) => action.kind === "selection-setup").map((action) => action.visibleMs),
		),
		actionCount: actions.length,
		directory,
	};
	console.log(JSON.stringify(summary));
} finally {
	try {
		await writeFile(
			join(directory, "evidence.json"),
			JSON.stringify({ summary, observations, actions, limits, source }, null, 2),
		);
		if (profileCpu) {
			send("C-u");
			send("C-d");
			await Bun.sleep(2_000);
		}
	} finally {
		try {
			Bun.spawnSync(["tmux", "-S", socket, "kill-server"], { stdout: "ignore", stderr: "ignore" });
		} finally {
			server?.stop(true);
			disarmUiPtyOwnerWatchdog(watchdog);
		}
	}
}

assert(summary, "Observation did not produce a complete summary");
const SUMMARY_SCHEMA = Type.Object({
	maximumObservationGapMs: Type.Number(),
	maximumSpinnerAbsenceMs: Type.Number(),
	maximumSpinnerFrameMs: Type.Number(),
	maximumStartupInputMs: Type.Number(),
	maximumSteadyInputMs: Type.Number(),
	maximumSelectionMs: Type.Number(),
	activeDurationMs: Type.Number(),
	activeCaptureCount: Type.Integer(),
});
assert(Check(SUMMARY_SCHEMA, summary), "Invalid observation summary");
assert(
	summary.activeDurationMs >= 9_000 && summary.activeCaptureCount >= 600,
	"Insufficient continuous active coverage",
);
assert(
	summary.maximumObservationGapMs <= 40 && summary.maximumSpinnerAbsenceMs === 0,
	"Missing or delayed observations; sample is inconclusive",
);
if (limits) {
	const checks = [
		["maximumObservationGapMs", "maximumObservationGapMs"],
		["maximumSpinnerAbsenceMs", "maximumActiveSpinnerAbsenceMs"],
		["maximumSpinnerFrameMs", "spinnerMs"],
		["maximumStartupInputMs", "startupInputMs"],
		["maximumSteadyInputMs", "steadyInputMs"],
		["maximumSelectionMs", "selectionMs"],
	] as const;
	const breaches = checks.filter(([metric, gate]) => summary[metric] > limits[gate]);
	assert.equal(
		breaches.length,
		0,
		breaches.map(([metric, gate]) => `${metric}: ${String(summary[metric])} > ${String(limits[gate])} ms`).join("\n"),
	);
}
