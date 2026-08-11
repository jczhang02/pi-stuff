import { chmod, copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CERTIFIED_PI_BUN_VERSION } from "./pi-host-contract.js";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.js";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_PI_BINARY = "/opt/pi-coding-agent/pi";
const DEFAULT_PACKAGE = join(ROOT, "packages/pi-stuff");
const READY_MARKER = "PS5BW_EDITOR_READY";
const SHORT_SESSION_TURNS = 6;
const LONG_SESSION_TURNS = 240;
const DEFAULT_SAMPLES = 3;
const DEFAULT_WARMUPS = 1;
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_OUTPUT = join(ROOT, ".artifacts/lifecycle-benchmark/latest.json");
const VARIANTS = ["host", "suite"] as const;
const SCENARIOS = ["fresh", "resume-short", "resume-long", "degraded"] as const;
const ACTIONS = ["exit", "ctrl-c", "reload", "reload-change", "prompt", "background-exit", "agent-exit"] as const;
const DEFAULT_ACTIONS = ACTIONS;
const DEFAULT_SIZES = [
	{ columns: 100, rows: 32 },
	{ columns: 64, rows: 28 },
] as const;

export type Variant = (typeof VARIANTS)[number];
export type Scenario = (typeof SCENARIOS)[number];
export type Action = (typeof ACTIONS)[number];

export interface TerminalSize {
	readonly columns: number;
	readonly rows: number;
}

export interface LifecycleAcceptanceSelection {
	readonly actions: readonly Action[];
	readonly samples: number;
	readonly scenarios: readonly Scenario[];
	readonly sizes: readonly TerminalSize[];
	readonly trace: boolean;
	readonly variants: readonly Variant[];
	readonly warmups: number;
}

interface BenchmarkOptions extends LifecycleAcceptanceSelection {
	readonly acceptance: boolean;
	readonly output: string;
	readonly packagePath: string;
	readonly piBinary: string;
}

export interface LifecycleSample {
	readonly action: Action;
	readonly acknowledgementMs?: number;
	readonly columns: number;
	readonly iteration: number;
	readonly reloadMs?: number;
	readonly responseMs?: number;
	readonly rows: number;
	readonly scenario: Scenario;
	readonly shutdownMs: number;
	readonly startupMs: number;
	readonly suiteTrace?: readonly LifecycleTraceEvent[];
	readonly trace?: readonly HostTiming[];
	readonly variant: Variant;
	readonly warmup: boolean;
}

export interface MetricSummary {
	readonly maximum: number;
	readonly minimum: number;
	readonly p50: number;
	readonly p95: number;
	readonly samples: number;
}

export interface CellSummary {
	readonly acknowledgement?: MetricSummary;
	readonly action: Action;
	readonly columns: number;
	readonly reload?: MetricSummary;
	readonly response?: MetricSummary;
	readonly rows: number;
	readonly scenario: Scenario;
	readonly shutdown: MetricSummary;
	readonly startup: MetricSummary;
	readonly variant: Variant;
	readonly warmups: number;
}

interface ExpectMetrics {
	readonly acknowledgementMs?: number;
	readonly reloadMs?: number;
	readonly responseMs?: number;
	readonly shutdownMs: number;
	readonly startupMs: number;
}

export interface HostTiming {
	readonly label: string;
	readonly milliseconds: number;
	readonly namespace: string;
}

export interface LifecycleTraceEvent {
	readonly atMs: number;
	readonly label: string;
}

interface SeededSessions {
	readonly long: string;
	readonly short: string;
	readonly traceExtension: string;
}

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function fail(message: string): never {
	throw new Error(`Lifecycle benchmark failed: ${message}`);
}

function boundedInteger(value: string | undefined, flag: string, minimum: number, maximum: number): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		fail(`${flag} must be an integer from ${String(minimum)} through ${String(maximum)}`);
	}
	return parsed;
}

function listValue<T extends string>(value: string | undefined, flag: string, allowed: readonly T[]): readonly T[] {
	if (!value) fail(`${flag} requires a comma-separated value`);
	const values = [
		...new Set(
			value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
	if (values.length === 0 || values.some((entry) => !allowed.includes(entry as T))) {
		fail(`${flag} must contain only: ${allowed.join(", ")}`);
	}
	return values as T[];
}

function terminalSizes(value: string | undefined): readonly TerminalSize[] {
	if (!value) fail("--sizes requires comma-separated COLUMNSxROWS values");
	return value.split(",").map((entry) => {
		const match = /^(\d+)x(\d+)$/.exec(entry.trim());
		if (!match) fail(`invalid terminal size: ${entry}`);
		return {
			columns: boundedInteger(match[1], "columns", 40, 400),
			rows: boundedInteger(match[2], "rows", 12, 200),
		};
	});
}

function parseOptions(arguments_: readonly string[]): BenchmarkOptions {
	let acceptance = false;
	let actions: readonly Action[] = DEFAULT_ACTIONS;
	let output = DEFAULT_OUTPUT;
	let packagePath = DEFAULT_PACKAGE;
	let piBinary = process.env["PI_BIN"] ?? DEFAULT_PI_BINARY;
	let samples = DEFAULT_SAMPLES;
	let scenarios: readonly Scenario[] = SCENARIOS;
	let sizes: readonly TerminalSize[] = DEFAULT_SIZES;
	let trace = false;
	let variants: readonly Variant[] = VARIANTS;
	let warmups = DEFAULT_WARMUPS;

	for (let index = 0; index < arguments_.length; index += 1) {
		const flag = arguments_[index];
		const value = arguments_[index + 1];
		switch (flag) {
			case "--acceptance":
				acceptance = true;
				break;
			case "--actions":
				actions = listValue(value, flag, ACTIONS);
				index += 1;
				break;
			case "--output":
				if (!value) fail("--output requires a path");
				output = resolve(value);
				index += 1;
				break;
			case "--package":
				if (!value) fail("--package requires a path");
				packagePath = resolve(value);
				index += 1;
				break;
			case "--pi":
				if (!value) fail("--pi requires a path");
				piBinary = resolve(value);
				index += 1;
				break;
			case "--samples":
				samples = boundedInteger(value, flag, 1, 100);
				index += 1;
				break;
			case "--scenarios":
				scenarios = listValue(value, flag, SCENARIOS);
				index += 1;
				break;
			case "--sizes":
				sizes = terminalSizes(value);
				index += 1;
				break;
			case "--trace":
				trace = true;
				break;
			case "--variants":
				variants = listValue(value, flag, VARIANTS);
				index += 1;
				break;
			case "--warmups":
				warmups = boundedInteger(value, flag, 0, 20);
				index += 1;
				break;
			default:
				fail(`unknown argument: ${String(flag)}`);
		}
	}
	return { acceptance, actions, output, packagePath, piBinary, samples, scenarios, sizes, trace, variants, warmups };
}

export function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) fail("cannot calculate a percentile without samples");
	if (!(fraction >= 0 && fraction <= 1)) fail("percentile fraction must be from zero through one");
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
	return sorted[index] as number;
}

function rounded(value: number): number {
	return Number(value.toFixed(2));
}

export function summarize(values: readonly number[]): MetricSummary {
	return {
		maximum: rounded(Math.max(...values)),
		minimum: rounded(Math.min(...values)),
		p50: rounded(percentile(values, 0.5)),
		p95: rounded(percentile(values, 0.95)),
		samples: values.length,
	};
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function serializedIncludes(value: unknown, marker: string): boolean {
	try {
		return JSON.stringify(value).includes(marker);
	} catch {
		return false;
	}
}

export function lifecycleSessionFindings(entries: readonly unknown[], action: Action, scenario: Scenario): string[] {
	const findings: string[] = [];
	const header = objectValue(entries[0]);
	if (header?.["type"] !== "session" || header["version"] !== 3) {
		findings.push("Session JSONL is missing its certified version 3 header");
	}
	if (
		!entries.some((entry) => {
			const record = objectValue(entry);
			return (
				record?.["type"] === "model_change" &&
				record["provider"] === "pi-stuff-lifecycle-benchmark" &&
				record["modelId"] === "fixture-model"
			);
		})
	) {
		findings.push("Session JSONL lost its deterministic model selection");
	}
	const messages = entries.flatMap((entry) => {
		const message = objectValue(entry)?.["message"];
		return objectValue(message) ? [message as Record<string, unknown>] : [];
	});
	const requireMarker = (marker: string): void => {
		if (!messages.some((message) => serializedIncludes(message, marker))) {
			findings.push(`Session JSONL lost marker ${marker}`);
		}
	};
	if (scenario === "resume-short") requireMarker("PS5BW_SESSION_TAIL_short");
	if (scenario === "resume-long") requireMarker("PS5BW_SESSION_TAIL_long");
	if (action === "prompt") {
		requireMarker("PS5BW_FIRST_PROMPT");
		requireMarker("PS5BW_PROMPT_DONE");
	}
	if (action === "reload" || action === "reload-change") {
		requireMarker("PS5BW_RELOAD_PROMPT");
		requireMarker("PS5BW_PROMPT_DONE");
	}
	const receipt =
		action === "background-exit"
			? { prompt: "PS5BW_BACKGROUND_PROMPT", ready: "PS5BW_BACKGROUND_READY", toolCallId: "ps5bw-background-launch" }
			: action === "agent-exit"
				? { prompt: "PS5BW_AGENT_PROMPT", ready: "PS5BW_AGENT_READY", toolCallId: "ps5bw-agent-launch" }
				: undefined;
	if (receipt) {
		requireMarker(receipt.prompt);
		requireMarker(receipt.ready);
		const hasToolCall = messages.some((message) => {
			if (message["role"] !== "assistant" || !Array.isArray(message["content"])) return false;
			return message["content"].some((part) => objectValue(part)?.["id"] === receipt.toolCallId);
		});
		if (!hasToolCall) findings.push(`Session JSONL lost Tool call receipt ${receipt.toolCallId}`);
		const hasToolResult = messages.some(
			(message) => message["role"] === "toolResult" && message["toolCallId"] === receipt.toolCallId,
		);
		if (!hasToolResult) findings.push(`Session JSONL lost Tool result receipt ${receipt.toolCallId}`);
	}
	return findings;
}

async function verifySessionDurability(
	sessionDirectory: string,
	knownSessionFile: string,
	action: Action,
	scenario: Scenario,
): Promise<void> {
	const paths = knownSessionFile
		? [knownSessionFile]
		: (await readdir(sessionDirectory))
				.filter((name) => name.endsWith(".jsonl"))
				.sort()
				.map((name) => join(sessionDirectory, name));
	if (paths.length === 0 && !knownSessionFile && (action === "exit" || action === "ctrl-c")) return;
	if (paths.length !== 1) fail(`expected one durable Session JSONL, found ${String(paths.length)}`);
	const path = paths[0] as string;
	const raw = await readFile(path, "utf8");
	const entries: unknown[] = [];
	for (const [index, line] of raw.split("\n").entries()) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line));
		} catch (error) {
			fail(
				`Session JSONL ${path} line ${String(index + 1)} is invalid: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const findings = lifecycleSessionFindings(entries, action, scenario);
	if (findings.length > 0) fail(`${action}/${scenario} durability failed:\n- ${findings.join("\n- ")}`);
}

function fixtureExtensionSource(): string {
	return `
import { writeFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const PROVIDER = "pi-stuff-lifecycle-benchmark";
const MODEL = "fixture-model";
const READY = ${JSON.stringify(READY_MARKER)};
const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(content, stopReason) {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: PROVIDER,
    model: MODEL,
    usage: ZERO_USAGE,
    stopReason,
    timestamp: Date.now(),
  };
}

function textStream(text) {
  const stream = createAssistantMessageEventStream();
  const pending = message([], "pending");
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "text_start", contentIndex: 0, partial: pending });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
  stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
  return stream;
}

function toolStream(name, id, arguments_) {
  const stream = createAssistantMessageEventStream();
  const pending = message([], "pending");
  const toolCall = { arguments: arguments_, id, name, type: "toolCall" };
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
  stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
  stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
  return stream;
}

function hasToolResult(context, id) {
  return (context.messages ?? []).some((entry) => entry.role === "toolResult" && entry.toolCallId === id);
}

function responseStream(context) {
  const transcript = JSON.stringify(context.messages ?? []);
  if (process.env.PI_SUBAGENT_CHILD === "1") {
    const pidPath = process.env.PS5BW_AGENT_PI_PID;
    if (pidPath) writeFileSync(pidPath, String(process.pid));
    if (!hasToolResult(context, "ps5bw-agent-child-sleep")) {
      return toolStream("bash", "ps5bw-agent-child-sleep", {
        command: "echo $$ > $PS5BW_AGENT_SHELL_PID; sleep 3",
        description: "Lifecycle Agent child",
      });
    }
    return textStream("PS5BW_AGENT_CHILD_DONE");
  }
  if (transcript.includes("PS5BW_AGENT_PROMPT")) {
    if (!hasToolResult(context, "ps5bw-agent-launch")) {
      return toolStream("subagent", "ps5bw-agent-launch", {
        agent: "general-purpose",
        task: "PS5BW_AGENT_CHILD_PROMPT",
      });
    }
    return textStream("PS5BW_AGENT_READY");
  }
  if (transcript.includes("PS5BW_BACKGROUND_PROMPT")) {
    if (!hasToolResult(context, "ps5bw-background-launch")) {
      return toolStream("bash", "ps5bw-background-launch", {
        command: "echo $$ > $PS5BW_BACKGROUND_SHELL_PID; sleep 30",
        description: "Lifecycle background shell",
        run_in_background: true,
      });
    }
    return textStream("PS5BW_BACKGROUND_READY");
  }
  return textStream("PS5BW_PROMPT_DONE");
}

export default function lifecycleBenchmarkFixture(pi) {
  pi.registerProvider(PROVIDER, {
    name: "Pi Stuff lifecycle benchmark fixture",
    baseUrl: "https://fixture.invalid",
    apiKey: "fixture",
    api: "openai-completions",
    models: [{
      id: MODEL,
      name: "Pi Stuff lifecycle benchmark fixture",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    }],
    streamSimple: (_model, context) => responseStream(context),
  });
  pi.on("session_start", (_event, ctx) => {
    setTimeout(() => ctx.ui.setEditorText(READY), 0);
  });
  pi.on("input", async (_event, ctx) => {
	const requiredSuiteTools = ["TaskList", "background", "goal_complete", "mcp", "subagent"];
	const registered = new Set(pi.getAllTools().map((tool) => tool.name));
	const missing = process.env.PS5BW_EXPECT_SUITE === "1"
	  ? requiredSuiteTools.filter((name) => !registered.has(name))
	  : [];
	if (missing.length > 0) {
	  process.stderr.write("PS5BW_SURFACE_MISSING " + missing.join(",") + "\\n");
	} else {
	  process.stderr.write((process.env.PS5BW_SURFACE_MARKER ?? "PS5BW_SURFACE_READY") + "\\n");
	}
    // The Suite owns the Footer and Pi hides the Editor while a turn is active,
    // so neither surface is a reliable observation point. This benchmark-only
    // PTY marker proves the Host reached the input handler without network I/O.
    process.stderr.write("PS5BW_INPUT_ACK\\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
`;
}

function runnerSource(): string {
	return `#!/bin/sh
set -u

stty rows "$PS5BW_ROWS" columns "$PS5BW_COLUMNS"

set -- \
  "$PS5BW_PI_BIN" \
  --offline \
  --approve \
  --tui-mode fullscreen \
  --no-skills \
  --no-prompt-templates \
  --no-context-files \
  --no-themes \
  --provider pi-stuff-lifecycle-benchmark \
  --model fixture-model \
  --session-dir "$PS5BW_SESSION_DIR"

if [ -n "$PS5BW_TRACE_EXTENSION" ]; then
  set -- "$@" --extension "$PS5BW_TRACE_EXTENSION"
fi

case "$PS5BW_SCENARIO" in
  resume-short|resume-long)
    set -- "$@" --session "$PS5BW_SESSION_FILE"
    ;;
  *)
    set -- "$@" --session-id "$PS5BW_SESSION_ID"
    ;;
esac

"$@"
status=$?
stty -a > "$PS5BW_TTY_STATE"
exit "$status"
`;
}

function traceExtensionSource(): string {
	return `
const KEY = "@jczhang02/pi-stuff/lifecycle-performance";

export default function lifecycleTraceFixture(pi) {
  const key = Symbol.for(KEY);
  const existing = globalThis[key];
  const state = existing && typeof existing.origin === "number" && Array.isArray(existing.events)
    ? existing
    : { origin: performance.now(), events: [] };
  globalThis[key] = state;
  pi.on("session_shutdown", async () => {
    const path = process.env.PS5BW_SUITE_TRACE;
    if (path) await Bun.write(path, JSON.stringify(state));
  });
}
`;
}

function expectProgram(action: Action, trace: boolean): string {
	let actionProgram: string;
	switch (action) {
		case "prompt":
			actionProgram = `
send -- "\\003"
after 60
set response_started [clock microseconds]
send -- "PS5BW_FIRST_PROMPT\\r"
must_expect "PS5BW_INPUT_ACK"
set acknowledgement_finished [clock microseconds]
puts "PS5BW_METRIC acknowledgement_us [expr {$acknowledgement_finished - $response_started}]"
must_expect "PS5BW_PROMPT_DONE"
set response_finished [clock microseconds]
puts "PS5BW_METRIC response_us [expr {$response_finished - $response_started}]"
after 80
set shutdown_started [clock microseconds]
send -- "\\004"
`;
			break;
		case "background-exit":
			actionProgram = `
send -- "\\003"
after 60
send -- "PS5BW_BACKGROUND_PROMPT\\r"
must_expect "PS5BW_BACKGROUND_READY"
must_file $env(PS5BW_BACKGROUND_SHELL_PID)
after 80
set shutdown_started [clock microseconds]
send -- "\\004"
`;
			break;
		case "agent-exit":
			actionProgram = `
send -- "\\003"
after 60
send -- "PS5BW_AGENT_PROMPT\\r"
must_expect "PS5BW_AGENT_READY"
must_file $env(PS5BW_AGENT_PI_PID)
must_file $env(PS5BW_AGENT_SHELL_PID)
after 80
set shutdown_started [clock microseconds]
send -- "\\004"
`;
			break;
		case "reload":
		case "reload-change":
			actionProgram = `
send -- "\\003"
after 60
${
	action === "reload-change"
		? `set source_file [open $env(PS5BW_SOURCE_CHANGE_FILE) "a"]
puts $source_file {import { markLifecyclePhase as markSourceChange } from "../lifecycle-performance.js";}
puts $source_file {markSourceChange("suite.source-change.applied");}
close $source_file`
		: ""
}
set action_started [clock microseconds]
send -- "/reload\\r"
must_expect "Reloaded keybindings, extensions"
set action_finished [clock microseconds]
puts "PS5BW_METRIC reload_us [expr {$action_finished - $action_started}]"
after 60
send -- "PS5BW_RELOAD_PROMPT\\r"
must_expect $env(PS5BW_SURFACE_MARKER)
must_expect "PS5BW_INPUT_ACK"
must_expect "PS5BW_PROMPT_DONE"
send -- "\\003"
after 60
set shutdown_started [clock microseconds]
send -- "\\004"
`;
			break;
		case "ctrl-c":
			actionProgram = `
send -- "\\003"
after 60
set shutdown_started [clock microseconds]
send -- "\\003"
`;
			break;
		case "exit":
			actionProgram = `
send -- "\\003"
after 60
set shutdown_started [clock microseconds]
send -- "\\004"
`;
			break;
	}

	return `
set timeout ${String(DEFAULT_TIMEOUT_SECONDS)}
log_user ${trace ? "1" : "0"}
log_file -noappend $env(PS5BW_PTY_LOG)

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout { puts stderr "Timed out waiting for: $pattern"; exit 2 }
        eof { puts stderr "Reached EOF while waiting for: $pattern"; exit 3 }
    }
}

proc must_file {path} {
    set deadline [expr {[clock milliseconds] + ${String(DEFAULT_TIMEOUT_SECONDS * 1_000)}}]
    while {[clock milliseconds] < $deadline} {
        if {[file exists $path]} { return }
        after 20
    }
    puts stderr "Timed out waiting for file: $path"
    exit 5
}

set startup_started [clock microseconds]
spawn -noecho script -qefc $env(PS5BW_RUNNER) /dev/null
must_expect "${READY_MARKER}"
set startup_finished [clock microseconds]
puts "PS5BW_METRIC startup_us [expr {$startup_finished - $startup_started}]"
${actionProgram}
expect {
    eof {}
    timeout { puts stderr "Timed out waiting for Pi to exit"; exit 4 }
}
set shutdown_finished [clock microseconds]
puts "PS5BW_METRIC shutdown_us [expr {$shutdown_finished - $shutdown_started}]"
`;
}

function parseMetric(output: string, name: string): number {
	const match = new RegExp(`PS5BW_METRIC ${name}_us (\\d+)`).exec(output);
	if (!match) fail(`Expect did not report ${name}_us: ${output.trim() || "<empty>"}`);
	return Number(match[1]) / 1_000;
}

function stripTerminalControls(output: string): string {
	let visible = "";
	for (let index = 0; index < output.length; index += 1) {
		const code = output.charCodeAt(index);
		if (code !== 27) {
			visible += output[index];
			continue;
		}
		const introducer = output[index + 1];
		if (introducer === "[") {
			index += 2;
			while (index < output.length) {
				const finalCode = output.charCodeAt(index);
				if (finalCode >= 0x40 && finalCode <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		if (introducer === "]") {
			index += 2;
			while (index < output.length) {
				if (output.charCodeAt(index) === 7) break;
				if (output.charCodeAt(index) === 27 && output[index + 1] === "\\") {
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (introducer !== undefined) index += 1;
	}
	return visible;
}

function parseHostTimings(output: string): HostTiming[] {
	const normalized = stripTerminalControls(output).replace(/\r/g, "");
	const timings: HostTiming[] = [];
	for (const section of normalized.matchAll(/--- Startup Timings: ([^-\n]+) ---\n([\s\S]*?)\n-+/g)) {
		const namespace = section[1]?.trim();
		const body = section[2];
		if (!namespace || !body) continue;
		for (const line of body.split("\n")) {
			const match = /^\s{2}(.+): (\d+)ms$/.exec(line);
			if (!match || match[1] === "TOTAL") continue;
			timings.push({ label: match[1] as string, milliseconds: Number(match[2]), namespace });
		}
	}
	return timings;
}

function verifyTerminalState(value: string, size: TerminalSize): void {
	const normalized = value.replace(/\s+/g, " ");
	if (!new RegExp(`rows ${String(size.rows)}; columns ${String(size.columns)};`).test(normalized)) {
		fail(`terminal size was not restored: ${normalized}`);
	}
	for (const flag of ["icanon", "echo"]) {
		if (!new RegExp(`(?:^|[ ;])${flag}(?:[ ;]|$)`).test(normalized)) {
			fail(`terminal flag ${flag} was not restored: ${normalized}`);
		}
	}
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "pi-stuff-lifecycle-benchmark",
		model: "fixture-model",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function seedSession(directory: string, cwd: string, id: string, turns: number): string {
	const manager = SessionManager.create(cwd, directory, { id });
	manager.appendModelChange("pi-stuff-lifecycle-benchmark", "fixture-model");
	for (let index = 0; index < turns; index += 1) {
		manager.appendMessage({
			role: "user",
			content: `Lifecycle history ${String(index)} ${"context ".repeat(18)}`,
			timestamp: Date.now(),
		} satisfies UserMessage);
		manager.appendMessage(
			assistantMessage(
				index === turns - 1
					? `PS5BW_SESSION_TAIL_${id}`
					: `Lifecycle response ${String(index)} ${"evidence ".repeat(18)}`,
			),
		);
	}
	const path = manager.getSessionFile();
	if (!path) fail(`failed to seed ${id}`);
	return path;
}

async function prepareFixture(root: string, projectDirectory: string): Promise<SeededSessions> {
	const packageDirectory = join(root, "fixture-package");
	const seedDirectory = join(root, "seed-sessions");
	const runner = join(root, "runner.sh");
	const traceExtension = join(root, "trace-extension.js");
	await Promise.all([mkdir(packageDirectory, { recursive: true }), mkdir(seedDirectory, { recursive: true })]);
	await Promise.all([
		writeFile(
			join(packageDirectory, "package.json"),
			`${JSON.stringify(
				{
					name: "pi-stuff-lifecycle-benchmark-fixture",
					private: true,
					type: "module",
					pi: { extensions: ["./extension.js"] },
				},
				null,
				2,
			)}\n`,
		),
		writeFile(join(packageDirectory, "extension.js"), fixtureExtensionSource()),
		writeFile(runner, runnerSource(), { mode: 0o755 }),
		writeFile(traceExtension, traceExtensionSource()),
	]);
	await chmod(runner, 0o755);
	return {
		long: seedSession(seedDirectory, projectDirectory, "long", LONG_SESSION_TURNS),
		short: seedSession(seedDirectory, projectDirectory, "short", SHORT_SESSION_TURNS),
		traceExtension,
	};
}

function isolatedEnvironment(root: string): Record<string, string> {
	const path = process.env["PATH"];
	if (!path) fail("PATH is required");
	return {
		HOME: join(root, "home"),
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		PATH: path,
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
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

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function assertProcessSettles(path: string, timeoutMs: number): Promise<void> {
	const raw = await readFile(path, "utf8");
	const pid = Number(raw.trim());
	if (!Number.isSafeInteger(pid) || pid <= 1) fail(`invalid lifecycle resource pid in ${path}`);
	const deadline = performance.now() + timeoutMs;
	while (processIsAlive(pid) && performance.now() < deadline) await Bun.sleep(25);
	if (processIsAlive(pid))
		fail(`lifecycle resource process ${String(pid)} remained alive after ${String(timeoutMs)}ms`);
}

async function runSample(
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
	const ttyState = join(runDirectory, "tty-state.txt");
	const ptyLog = join(runDirectory, "pty.log");
	const suiteTracePath = join(runDirectory, "suite-trace.json");
	const backgroundShellPid = join(runDirectory, "background-shell.pid");
	const agentPiPid = join(runDirectory, "agent-pi.pid");
	const agentShellPid = join(runDirectory, "agent-shell.pid");
	const agentDirectory = join(configDirectory, "agents");
	const degradedConfigDirectory = join(runDirectory, "xdg-config", "cortexkit");
	const sourceChangePackage = join(runDirectory, "suite-package");
	const sourceChangeFile = join(sourceChangePackage, "src", "todo", "index.ts");
	await Promise.all([
		mkdir(configDirectory, { recursive: true }),
		mkdir(sessionDirectory, { recursive: true }),
		mkdir(agentDirectory, { recursive: true }),
		...(scenario === "degraded" ? [mkdir(degradedConfigDirectory, { recursive: true })] : []),
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
			`${JSON.stringify(
				{
					defaultProjectTrust: "always",
					packages: variant === "suite" ? [samplePackagePath, fixturePackage] : [fixturePackage],
					quietStartup: true,
					tuiMode: "fullscreen",
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		),
		writeFile(
			join(agentDirectory, "general-purpose.md"),
			benchmarkAgentSource(join(fixturePackage, "extension.js")),
			{ mode: 0o600 },
		),
		...(scenario === "degraded"
			? [
					writeFile(join(degradedConfigDirectory, "magic-context.jsonc"), "{ invalid lifecycle fixture\n", {
						mode: 0o600,
					}),
				]
			: []),
	]);
	let sessionFile = "";
	if (scenario === "resume-short" || scenario === "resume-long") {
		sessionFile = join(sessionDirectory, `${scenario}.jsonl`);
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
		PS5BW_BACKGROUND_SHELL_PID: backgroundShellPid,
		PS5BW_AGENT_PI_PID: agentPiPid,
		PS5BW_AGENT_SHELL_PID: agentShellPid,
		PS5BW_PI_BIN: options.piBinary,
		PS5BW_PTY_LOG: ptyLog,
		PS5BW_ROWS: String(size.rows),
		PS5BW_RUNNER: join(benchmarkRoot, "runner.sh"),
		PS5BW_SCENARIO: scenario,
		PS5BW_SOURCE_CHANGE_FILE: sourceChangeFile,
		PS5BW_SESSION_DIR: sessionDirectory,
		PS5BW_SESSION_FILE: sessionFile,
		PS5BW_SESSION_ID: `ps5bw-${phasePrefix}${variant}-${scenario}-${action}-${String(iteration)}`,
		PS5BW_TTY_STATE: ttyState,
		PS5BW_SUITE_TRACE: suiteTracePath,
		PS5BW_SURFACE_MARKER: `PS5BW_SURFACE_READY_${variant.toUpperCase()}`,
		PS5BW_TRACE_EXTENSION: traceSuite ? seeded.traceExtension : "",
		...(options.trace ? { PI_TIMING: "1" } : {}),
		TRANSFORMERS_OFFLINE: "1",
	};
	const result = Bun.spawnSync(["expect", "-c", expectProgram(action, options.trace)], {
		cwd: join(benchmarkRoot, "project"),
		env: environment,
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
	if (result.exitCode !== 0) {
		const log = await readFile(ptyLog, "utf8").catch(() => "<PTY log unavailable>");
		fail(
			`${variant}/${scenario}/${action}/${String(size.columns)}x${String(size.rows)} exited ${String(result.exitCode)}: ${output.trim()}\nPTY tail:\n${log.slice(-20_000)}`,
		);
	}
	verifyTerminalState(await readFile(ttyState, "utf8"), size);
	if (action === "background-exit") await assertProcessSettles(backgroundShellPid, 2_000);
	if (action === "agent-exit") {
		await Promise.all([assertProcessSettles(agentPiPid, 8_000), assertProcessSettles(agentShellPid, 8_000)]);
	}
	await verifySessionDurability(sessionDirectory, sessionFile, action, scenario);
	const metrics: ExpectMetrics = {
		startupMs: parseMetric(output, "startup"),
		shutdownMs: parseMetric(output, "shutdown"),
		...(action === "reload" || action === "reload-change" ? { reloadMs: parseMetric(output, "reload") } : {}),
		...(action === "prompt"
			? {
					acknowledgementMs: parseMetric(output, "acknowledgement"),
					responseMs: parseMetric(output, "response"),
				}
			: {}),
	};
	const rawPtyLog = options.trace ? output : "";
	const trace = options.trace ? parseHostTimings(rawPtyLog) : [];
	if (options.trace && trace.length === 0) {
		fail(`PI_TIMING produced no parseable Host timings; PTY tail:\n${rawPtyLog.slice(-20_000)}`);
	}
	const suiteTrace = traceSuite
		? (JSON.parse(await readFile(suiteTracePath, "utf8")) as { readonly events?: unknown }).events
		: undefined;
	if (traceSuite && !Array.isArray(suiteTrace)) fail("Suite lifecycle trace was not persisted");
	if (action === "reload" && variant === "suite" && Array.isArray(suiteTrace)) {
		const labels = suiteTrace.map((event) => (event as Partial<LifecycleTraceEvent>).label);
		if (!labels.includes("suite.loader.cache.hit")) fail("unchanged Suite reload did not use the runtime cache");
		if (labels.filter((label) => label === "suite.module-imported").length !== 1) {
			fail("unchanged Suite reload unexpectedly re-evaluated the generated runtime module");
		}
	}
	if (action === "reload-change" && Array.isArray(suiteTrace)) {
		const moduleImports = suiteTrace.filter(
			(event) => (event as Partial<LifecycleTraceEvent>).label === "suite.module-imported",
		);
		if (moduleImports.length < 2) fail("Suite source change did not re-evaluate the generated runtime module");
		if (
			!suiteTrace.some((event) => (event as Partial<LifecycleTraceEvent>).label === "suite.source-change.applied")
		) {
			fail("Suite source change did not re-evaluate the changed nested module");
		}
	}
	return {
		action,
		...(metrics.acknowledgementMs === undefined ? {} : { acknowledgementMs: rounded(metrics.acknowledgementMs) }),
		columns: size.columns,
		iteration,
		...(metrics.reloadMs === undefined ? {} : { reloadMs: metrics.reloadMs }),
		...(metrics.responseMs === undefined ? {} : { responseMs: rounded(metrics.responseMs) }),
		rows: size.rows,
		scenario,
		shutdownMs: rounded(metrics.shutdownMs),
		startupMs: rounded(metrics.startupMs),
		...(Array.isArray(suiteTrace) ? { suiteTrace: suiteTrace as LifecycleTraceEvent[] } : {}),
		...(trace.length === 0 ? {} : { trace }),
		variant,
		warmup,
	};
}

function cellKey(sample: LifecycleSample): string {
	return [sample.variant, sample.scenario, sample.action, `${String(sample.columns)}x${String(sample.rows)}`].join(
		"/",
	);
}

function summaries(samples: readonly LifecycleSample[]): CellSummary[] {
	const cells = new Map<string, { measured: LifecycleSample[]; warmups: number }>();
	for (const sample of samples) {
		const key = cellKey(sample);
		const cell = cells.get(key) ?? { measured: [], warmups: 0 };
		if (sample.warmup) cell.warmups += 1;
		else cell.measured.push(sample);
		cells.set(key, cell);
	}
	return [...cells.values()].flatMap(({ measured: values, warmups }) => {
		if (values.length === 0) return [];
		const first = values[0] as LifecycleSample;
		const acknowledgementValues = values.flatMap((sample) =>
			sample.acknowledgementMs === undefined ? [] : [sample.acknowledgementMs],
		);
		const reloadValues = values.flatMap((sample) => (sample.reloadMs === undefined ? [] : [sample.reloadMs]));
		const responseValues = values.flatMap((sample) => (sample.responseMs === undefined ? [] : [sample.responseMs]));
		return [
			{
				action: first.action,
				...(acknowledgementValues.length > 0 ? { acknowledgement: summarize(acknowledgementValues) } : {}),
				columns: first.columns,
				...(reloadValues.length > 0 ? { reload: summarize(reloadValues) } : {}),
				...(responseValues.length > 0 ? { response: summarize(responseValues) } : {}),
				rows: first.rows,
				scenario: first.scenario,
				shutdown: summarize(values.map((sample) => sample.shutdownMs)),
				startup: summarize(values.map((sample) => sample.startupMs)),
				variant: first.variant,
				warmups,
			},
		];
	});
}

const ACCEPTANCE_MINIMUM_SAMPLES = 3;

type BudgetedMetric = "acknowledgement" | "reload" | "response" | "shutdown" | "startup";

interface BudgetRule {
	readonly budget: number;
	readonly metric: BudgetedMetric;
}

function sameSize(left: TerminalSize, right: TerminalSize): boolean {
	return left.columns === right.columns && left.rows === right.rows;
}

function acceptanceCellKey(variant: Variant, scenario: Scenario, action: Action, size: TerminalSize): string {
	return [variant, scenario, action, `${String(size.columns)}x${String(size.rows)}`].join("/");
}

function acceptanceRequiresCell(action: Action, scenario: Scenario, size: TerminalSize): boolean {
	if (action === "background-exit" || action === "agent-exit") {
		return scenario === "fresh" || scenario === "resume-long";
	}
	if (action === "reload-change") return scenario === "fresh" && sameSize(size, DEFAULT_SIZES[0]);
	return true;
}

function budgetRules(cell: CellSummary): readonly BudgetRule[] {
	if (cell.variant !== "suite") return [];
	const longSession = cell.scenario === "resume-long";
	const rules: BudgetRule[] = [];
	if (cell.action !== "reload-change") {
		rules.push({ budget: longSession ? 1_800 : 1_600, metric: "startup" });
	}
	if (cell.action === "prompt") {
		rules.push({ budget: 50, metric: "acknowledgement" }, { budget: 1_100, metric: "response" });
	}
	if (cell.action === "exit" || cell.action === "ctrl-c") {
		rules.push({ budget: longSession ? 350 : 150, metric: "shutdown" });
	}
	if (cell.action === "background-exit" || cell.action === "agent-exit") {
		rules.push({ budget: longSession ? 375 : 250, metric: "shutdown" });
	}
	if (cell.action === "reload") rules.push({ budget: longSession ? 550 : 200, metric: "reload" });
	if (cell.action === "reload-change") rules.push({ budget: 6_000, metric: "reload" });
	return rules;
}

function requiredMetrics(cell: CellSummary): readonly BudgetedMetric[] {
	return [
		"startup",
		"shutdown",
		...(cell.action === "reload" || cell.action === "reload-change" ? (["reload"] as const) : []),
		...(cell.action === "prompt" ? (["acknowledgement", "response"] as const) : []),
	];
}

export function lifecycleConfirmationTargets(cells: readonly CellSummary[]): CellSummary[] {
	return cells.filter((cell) =>
		budgetRules(cell).some(({ budget, metric }) => {
			const summary = cell[metric];
			return summary !== undefined && summary.p95 > budget;
		}),
	);
}

export function lifecycleAcceptanceFindings(
	selection: LifecycleAcceptanceSelection,
	cells: readonly CellSummary[],
	confirmationCells: readonly CellSummary[] = [],
): string[] {
	const findings: string[] = [];
	if (selection.samples < ACCEPTANCE_MINIMUM_SAMPLES) {
		findings.push(`coverage requires at least ${String(ACCEPTANCE_MINIMUM_SAMPLES)} measured samples per cell`);
	}
	if (selection.warmups < 1) findings.push("coverage requires at least one warmup per cell");
	if (!selection.trace) findings.push("coverage requires Host and Suite lifecycle tracing");
	for (const action of ACTIONS) {
		if (!selection.actions.includes(action)) findings.push(`coverage is missing action ${action}`);
	}
	for (const scenario of SCENARIOS) {
		if (!selection.scenarios.includes(scenario)) findings.push(`coverage is missing scenario ${scenario}`);
	}
	for (const variant of VARIANTS) {
		if (!selection.variants.includes(variant)) findings.push(`coverage is missing variant ${variant}`);
	}
	for (const size of DEFAULT_SIZES) {
		if (!selection.sizes.some((candidate) => sameSize(candidate, size))) {
			findings.push(`coverage is missing terminal ${String(size.columns)}x${String(size.rows)}`);
		}
	}

	const cellsByKey = new Map(
		cells.map((cell) => [acceptanceCellKey(cell.variant, cell.scenario, cell.action, cell), cell]),
	);
	const confirmationsByKey = new Map(
		confirmationCells.map((cell) => [acceptanceCellKey(cell.variant, cell.scenario, cell.action, cell), cell]),
	);
	for (const target of lifecycleConfirmationTargets(cells)) {
		const key = acceptanceCellKey(target.variant, target.scenario, target.action, target);
		const confirmation = confirmationsByKey.get(key);
		if (confirmation && confirmation.warmups < selection.warmups) {
			findings.push(`${key} confirmation has only ${String(confirmation.warmups)} warmups`);
		}
	}
	const enforceBudget = (
		cell: CellSummary,
		metric: BudgetedMetric,
		summary: MetricSummary | undefined,
		budget: number,
	): void => {
		const key = acceptanceCellKey(cell.variant, cell.scenario, cell.action, cell);
		if (!summary) {
			findings.push(`${key} is missing ${metric}`);
			return;
		}
		if (summary.p95 > budget) {
			const confirmationCell = confirmationsByKey.get(key);
			const confirmation = confirmationCell?.[metric];
			if (
				confirmation &&
				confirmation.samples >= ACCEPTANCE_MINIMUM_SAMPLES &&
				confirmationCell.warmups >= selection.warmups &&
				confirmation.p95 <= budget
			) {
				return;
			}
			findings.push(`${key} ${metric} p95 ${summary.p95.toFixed(2)}ms exceeds ${String(budget)}ms`);
			if (confirmation && confirmation.samples < ACCEPTANCE_MINIMUM_SAMPLES) {
				findings.push(`${key} ${metric} confirmation has only ${String(confirmation.samples)} measured samples`);
			} else if (
				confirmation &&
				confirmationCell &&
				confirmationCell.warmups >= selection.warmups &&
				confirmation.p95 > budget
			) {
				findings.push(
					`${key} ${metric} confirmation p95 ${confirmation.p95.toFixed(2)}ms also exceeds ${String(budget)}ms`,
				);
			}
		}
	};

	for (const size of DEFAULT_SIZES) {
		for (const scenario of SCENARIOS) {
			for (const action of ACTIONS) {
				if (!acceptanceRequiresCell(action, scenario, size)) continue;
				const applicableVariants: readonly Variant[] =
					action === "background-exit" || action === "agent-exit" || action === "reload-change"
						? ["suite"]
						: VARIANTS;
				for (const variant of applicableVariants) {
					const key = acceptanceCellKey(variant, scenario, action, size);
					const cell = cellsByKey.get(key);
					if (!cell) {
						findings.push(`coverage has no measured cell ${key}`);
						continue;
					}
					if (cell.warmups < selection.warmups) {
						findings.push(`${key} has only ${String(cell.warmups)} warmups`);
					}
					for (const metric of requiredMetrics(cell)) {
						const summary = cell[metric];
						if (summary && summary.samples < ACCEPTANCE_MINIMUM_SAMPLES) {
							findings.push(`${key} ${metric} has only ${String(summary.samples)} measured samples`);
						}
					}
					for (const { budget, metric } of budgetRules(cell)) {
						enforceBudget(cell, metric, cell[metric], budget);
					}
				}
			}
		}
	}
	return findings;
}

function progress(sample: LifecycleSample, phase: "initial" | "confirmation" = "initial"): void {
	const suffix = [
		sample.reloadMs === undefined ? "" : ` reload=${sample.reloadMs.toFixed(1)}ms`,
		sample.acknowledgementMs === undefined ? "" : ` ack=${sample.acknowledgementMs.toFixed(1)}ms`,
		sample.responseMs === undefined ? "" : ` response=${sample.responseMs.toFixed(1)}ms`,
	].join("");
	console.error(
		`${phase === "confirmation" ? "confirmation " : ""}${sample.warmup ? "warmup" : "sample"} ${cellKey(sample)} #${String(sample.iteration + 1)} ` +
			`startup=${sample.startupMs.toFixed(1)}ms shutdown=${sample.shutdownMs.toFixed(1)}ms${suffix}`,
	);
}

async function main(): Promise<void> {
	const options = parseOptions(Bun.argv.slice(2));
	if (
		options.actions.some(
			(action) => action === "background-exit" || action === "agent-exit" || action === "reload-change",
		) &&
		!options.variants.includes("suite")
	) {
		fail("background-exit, agent-exit, and reload-change require the suite variant");
	}
	if (Bun.version !== CERTIFIED_PI_BUN_VERSION) {
		fail(`Bun ${CERTIFIED_PI_BUN_VERSION} is required; received ${Bun.version}`);
	}
	const provenance = await verifyPiHostProvenance(options.piBinary);
	const benchmarkRoot = await mkdtemp(join(tmpdir(), "pi-stuff-lifecycle-benchmark-"));
	const projectDirectory = join(benchmarkRoot, "project");
	const fixturePackage = join(benchmarkRoot, "fixture-package");
	await Promise.all([
		mkdir(projectDirectory, { recursive: true }),
		mkdir(join(benchmarkRoot, "home"), { recursive: true }),
	]);
	const seeded = await prepareFixture(benchmarkRoot, projectDirectory);
	const samples: LifecycleSample[] = [];

	try {
		for (const size of options.sizes) {
			for (const scenario of options.scenarios) {
				for (const action of options.actions) {
					if (options.acceptance && !acceptanceRequiresCell(action, scenario, size)) continue;
					for (let iteration = 0; iteration < options.warmups + options.samples; iteration += 1) {
						const warmup = iteration < options.warmups;
						const sampleIndex = warmup ? iteration : iteration - options.warmups;
						const applicableVariants =
							action === "background-exit" || action === "agent-exit" || action === "reload-change"
								? options.variants.filter((variant) => variant === "suite")
								: options.variants;
						const orderedVariants = iteration % 2 === 0 ? applicableVariants : [...applicableVariants].reverse();
						for (const variant of orderedVariants) {
							const sample = await runSample(
								options,
								benchmarkRoot,
								fixturePackage,
								seeded,
								variant,
								scenario,
								action,
								size,
								sampleIndex,
								warmup,
							);
							samples.push(sample);
							progress(sample);
						}
					}
				}
			}
		}
		const cellSummaries = summaries(samples);
		const confirmationSamples: LifecycleSample[] = [];
		const confirmationTargets = options.acceptance ? lifecycleConfirmationTargets(cellSummaries) : [];
		for (const target of confirmationTargets) {
			for (let iteration = 0; iteration < options.warmups + options.samples; iteration += 1) {
				const warmup = iteration < options.warmups;
				const sampleIndex = warmup ? iteration : iteration - options.warmups;
				const sample = await runSample(
					options,
					benchmarkRoot,
					fixturePackage,
					seeded,
					target.variant,
					target.scenario,
					target.action,
					target,
					sampleIndex,
					warmup,
					"confirmation",
				);
				confirmationSamples.push(sample);
				progress(sample, "confirmation");
			}
		}
		const confirmationSummaries = summaries(confirmationSamples);
		const acceptanceFindings = options.acceptance
			? lifecycleAcceptanceFindings(options, cellSummaries, confirmationSummaries)
			: [];
		const report = {
			schemaVersion: 4,
			generatedAt: new Date().toISOString(),
			host: { profile: provenance.profile, provenance: provenance.kind },
			toolchain: { bun: Bun.version },
			startupModel: {
				processState: "Every sample starts a new Pi process with a cold process-local Suite module cache.",
				systemCacheState:
					"Each measured cell follows one retained preconditioning run and therefore measures a warm executable/filesystem-cache start without dropping global caches.",
			},
			options: {
				acceptance: options.acceptance,
				actions: options.actions,
				packagePath: options.packagePath,
				samples: options.samples,
				scenarios: options.scenarios,
				sizes: options.sizes,
				trace: options.trace,
				variants: options.variants,
				warmups: options.warmups,
			},
			acceptance: options.acceptance
				? {
						confirmationCells: confirmationTargets.map((cell) =>
							acceptanceCellKey(cell.variant, cell.scenario, cell.action, cell),
						),
						findings: acceptanceFindings,
						passed: acceptanceFindings.length === 0,
						requested: true,
					}
				: { requested: false },
			confirmations: {
				samples: confirmationSamples,
				summaries: confirmationSummaries,
			},
			notes: [
				"Every measurement uses a fresh Pi process and isolated Settings Layer.",
				"Warmups heat executable and filesystem caches; the benchmark does not mutate global kernel page-cache state.",
				"The host control loads only the deterministic fixture Package; the suite variant adds the Pi Stuff Package before it.",
				"All model responses are deterministic in-process fixtures; no credential or network call is used.",
				"Resource actions verify the tracked shell or Agent child settles after the measured parent shutdown.",
				"Every exit parses the resulting Session JSONL; completed prompts and Background/Agent Tool call-result receipts must remain durable.",
				"An initially over-budget cell receives one independent complete confirmation batch; only a repeated violation fails acceptance, and both batches remain in the report.",
			],
			samples,
			summaries: cellSummaries,
		};
		await mkdir(dirname(options.output), { recursive: true });
		await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
		console.log(JSON.stringify(report, null, 2));
		if (acceptanceFindings.length > 0) {
			fail(`acceptance did not pass:\n- ${acceptanceFindings.join("\n- ")}`);
		}
	} finally {
		await rm(benchmarkRoot, { recursive: true, force: true });
	}
}

if (import.meta.main) await main();
