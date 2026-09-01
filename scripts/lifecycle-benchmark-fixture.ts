import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	isJsonInputObject,
	isJsonInputValue,
	type JsonInputObject,
	type JsonInputValue,
	parseJsonValue,
} from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import type { Action, HostTiming, Scenario, SeededSessions, TerminalSize } from "./benchmark-lifecycle.js";
import { stripTerminalControls } from "./terminal-controls.js";

const READY_MARKER = "PS5BW_EDITOR_READY";
const SHORT_SESSION_TURNS = 6;
const LONG_SESSION_TURNS = 240;
const DEFAULT_TIMEOUT_SECONDS = 30;
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

function objectValue(value: JsonInputValue): JsonInputObject | undefined {
	return isJsonInputObject(value) ? value : undefined;
}

function serializedIncludes(value: JsonInputValue, marker: string): boolean {
	return JSON.stringify(value)?.includes(marker) ?? false;
}

export function lifecycleSessionFindings(
	entries: readonly unknown[],
	action: Action,
	scenario: Scenario,
	expectedLongSessionTools = 0,
	expectedLongToolBytes = 0,
): string[] {
	const findings: string[] = [];
	const parsedEntries = entries.filter(isJsonInputValue);
	if (parsedEntries.length !== entries.length) findings.push("Session JSONL contains a non-JSON value");
	const header = objectValue(parsedEntries[0]);
	if (header?.["type"] !== "session" || header["version"] !== 3) {
		findings.push("Session JSONL is missing its certified version 3 header");
	}
	if (
		!parsedEntries.some((entry) => {
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
	const messages = parsedEntries.flatMap((entry) => {
		const message = objectValue(entry)?.["message"];
		const object = objectValue(message);
		return object ? [object] : [];
	});
	const requireMarker = (marker: string): void => {
		if (!messages.some((message) => serializedIncludes(message, marker))) {
			findings.push(`Session JSONL lost marker ${marker}`);
		}
	};
	if (scenario === "resume-short") requireMarker("PS5BW_SESSION_TAIL_short");
	if (scenario === "resume-long") {
		requireMarker("PS5BW_SESSION_TAIL_long");
		const historicalToolResults = messages.filter(
			(message) =>
				message["role"] === "toolResult" &&
				isRuntimeString(message["toolCallId"]) &&
				message["toolCallId"].startsWith("ps5bw-history-tool-"),
		).length;
		if (historicalToolResults < expectedLongSessionTools) {
			findings.push(
				`Session JSONL retained only ${String(historicalToolResults)} of ${String(expectedLongSessionTools)} historical Tool results`,
			);
		}
		if (expectedLongSessionTools > 0 && expectedLongToolBytes > 0) {
			for (const index of [0, Math.floor(expectedLongSessionTools / 2), expectedLongSessionTools - 1]) {
				const toolCallId = `ps5bw-history-tool-${String(index)}`;
				const result = messages.find(
					(message) => message["role"] === "toolResult" && message["toolCallId"] === toolCallId,
				);
				const content = Array.isArray(result?.["content"]) ? result["content"] : [];
				const text = content
					.map((part) => objectValue(part)?.["text"])
					.filter((value): value is string => isRuntimeString(value))
					.join("");
				if (!text.includes(`PS5BW_HISTORY_PAYLOAD_${String(index)}`)) {
					findings.push(`Session JSONL lost historical Tool payload marker ${String(index)}`);
				} else if (Buffer.byteLength(text, "utf8") !== expectedLongToolBytes) {
					findings.push(
						`Session JSONL historical Tool ${String(index)} has ${String(Buffer.byteLength(text, "utf8"))} bytes instead of ${String(expectedLongToolBytes)}`,
					);
				}
			}
		}
	}
	if (action === "prompt") {
		requireMarker("PS5BW_FIRST_PROMPT");
		requireMarker("PS5BW_SECOND_PROMPT");
		requireMarker("PS5BW_FIRST_PROMPT_DONE");
		requireMarker("PS5BW_SECOND_PROMPT_DONE");
	}
	if (action === "reload" || action === "reload-change") {
		requireMarker("PS5BW_RELOAD_PROMPT");
		requireMarker("PS5BW_PROMPT_DONE");
	}
	const receipt =
		action === "background-exit"
			? { prompt: "PS5BW_BACKGROUND_PROMPT", ready: "PS5BW_BACKGROUND_READY", toolCallId: "ps5bw-background-launch" }
			: action === "agent-exit"
				? { prompt: "PS5BW_AGENT_PROMPT", toolCallId: "ps5bw-agent-launch" }
				: undefined;
	if (receipt) {
		requireMarker(receipt.prompt);
		if ("ready" in receipt) requireMarker(receipt.ready);
		const hasToolCall = messages.some((message) => {
			if (message["role"] !== "assistant" || !Array.isArray(message["content"])) return false;
			return message["content"].some((part) => objectValue(part)?.["id"] === receipt.toolCallId);
		});
		if (!hasToolCall) findings.push(`Session JSONL lost Tool call receipt ${receipt.toolCallId}`);
		if (action !== "agent-exit") {
			const hasToolResult = messages.some(
				(message) => message["role"] === "toolResult" && message["toolCallId"] === receipt.toolCallId,
			);
			if (!hasToolResult) findings.push(`Session JSONL lost Tool result receipt ${receipt.toolCallId}`);
		}
	}
	return findings;
}

export async function verifySessionDurability(
	sessionDirectory: string,
	knownSessionFile: string,
	action: Action,
	scenario: Scenario,
	expectedLongSessionTools: number,
	expectedLongToolBytes: number,
): Promise<void> {
	const paths = knownSessionFile
		? [knownSessionFile]
		: (await readdir(sessionDirectory))
				.filter((name) => name.endsWith(".jsonl"))
				.sort()
				.map((name) => join(sessionDirectory, name));
	if (paths.length === 0 && !knownSessionFile && (action === "exit" || action === "ctrl-c")) return;
	if (paths.length !== 1) fail(`expected one durable Session JSONL, found ${String(paths.length)}`);
	const [path] = paths;
	if (!path) fail("durable Session JSONL was not found");
	const raw = await readFile(path, "utf8");
	const entries: JsonInputValue[] = [];
	for (const [index, line] of raw.split("\n").entries()) {
		if (!line.trim()) continue;
		try {
			entries.push(parseJsonValue(line));
		} catch (error) {
			fail(
				`Session JSONL ${path} line ${String(index + 1)} is invalid: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const findings = lifecycleSessionFindings(
		entries,
		action,
		scenario,
		expectedLongSessionTools,
		expectedLongToolBytes,
	);
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
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function providerPromptMarker(context) {
	const messages = context.messages ?? [];
	for (let index = messages.length - 1; index >= Math.max(0, messages.length - 32); index -= 1) {
		const text = JSON.stringify(messages[index]);
		const steady = /PS5BW_STEADY_PROMPT_\\d+/.exec(text)?.[0];
		if (steady) return steady.replace("PS5BW_STEADY_PROMPT_", "STEADY_");
		if (text.includes("PS5BW_SECOND_PROMPT")) return "SECOND";
		if (text.includes("PS5BW_FIRST_PROMPT")) return "FIRST";
	}
	return "OTHER";
}

function message(content, stopReason) {
  return {
    role: "assistant", content, api: "openai-completions", provider: PROVIDER,
    model: MODEL, usage: ZERO_USAGE, stopReason, timestamp: Date.now(),
  };
}

function textStream(text) {
  const stream = createAssistantMessageEventStream();
  const pending = message([], "pending");
  stream.push({ type: "start", partial: pending }); stream.push({ type: "text_start", contentIndex: 0, partial: pending });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending }); stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
  stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
  return stream;
}

function toolStream(name, id, arguments_) {
  const stream = createAssistantMessageEventStream();
  const pending = message([], "pending");
  const toolCall = { arguments: arguments_, id, name, type: "toolCall" };
  stream.push({ type: "start", partial: pending }); pending.content.push(toolCall);
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending }); stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
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
      return toolStream("bash", "ps5bw-agent-child-sleep", { command: "echo $$ > $PS5BW_AGENT_SHELL_PID; sleep 30 & child=$!; echo $child > $PS5BW_AGENT_DESCENDANT_PID; wait $child", description: "Lifecycle Agent child" });
    }
    return textStream("PS5BW_AGENT_CHILD_DONE");
  }
  if (transcript.includes("PS5BW_AGENT_PROMPT")) {
    if (!hasToolResult(context, "ps5bw-agent-launch")) {
      return toolStream("subagent", "ps5bw-agent-launch", { agent: "general-purpose", foreground: true, task: "PS5BW_AGENT_CHILD_PROMPT" });
    }
    return textStream("PS5BW_AGENT_READY");
  }
  if (transcript.includes("PS5BW_BACKGROUND_PROMPT")) {
    if (!hasToolResult(context, "ps5bw-background-launch")) {
      return toolStream("bash", "ps5bw-background-launch", { command: "echo $$ > $PS5BW_BACKGROUND_SHELL_PID; sleep 30", description: "Lifecycle background shell", run_in_background: true });
    }
    return textStream("PS5BW_BACKGROUND_READY");
  }
  const steady = [...transcript.matchAll(/PS5BW_STEADY_PROMPT_\\d+/g)].at(-1)?.[0];
  if (steady) return textStream(steady + "_DONE");
  if (transcript.includes("PS5BW_SECOND_PROMPT")) return textStream("PS5BW_SECOND_PROMPT_DONE");
  if (transcript.includes("PS5BW_FIRST_PROMPT")) return textStream("PS5BW_FIRST_PROMPT_DONE");
  return textStream("PS5BW_PROMPT_DONE");
}

export default function lifecycleBenchmarkFixture(pi) {
  pi.registerProvider(PROVIDER, {
    name: "Pi Stuff lifecycle benchmark fixture", baseUrl: "https://fixture.invalid",
    apiKey: "fixture", api: "openai-completions",
    models: [{
      id: MODEL, name: "Pi Stuff lifecycle benchmark fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000, maxTokens: 4096,
    }],
	streamSimple: (_model, context) => {
		process.stderr.write("PS5BW_PROVIDER_START_" + providerPromptMarker(context) + "\\n");
		return responseStream(context);
	},
  });
	pi.registerCommand("ps5bw-ready", { handler: async (_args, ctx) => ctx.ui.setEditorText(READY) });
	pi.on("input", (event, ctx) => {
	const requiredSuiteTools = ["TaskList", "background", "goal_complete", "mcp", "subagent"];
	const registered = new Set(pi.getAllTools().map((tool) => tool.name));
	const missing = process.env.PS5BW_EXPECT_SUITE === "1"
	  ? requiredSuiteTools.filter((name) => !registered.has(name))
	  : [];
	process.stderr.write(missing.length > 0 ? "PS5BW_SURFACE_MISSING " + missing.join(",") + "\\n" : (process.env.PS5BW_SURFACE_MARKER ?? "PS5BW_SURFACE_READY") + "\\n");
    // The Suite owns the Footer and Pi hides the Editor while a turn is active,
    // so neither surface is a reliable observation point. This benchmark-only
    // PTY marker proves the Host reached the input handler without network I/O.
	process.stderr.write("PS5BW_INPUT_ACK_" + encodeURIComponent(event.text) + "\\n");
	queueMicrotask(() => {
	  const state = ctx.ui.getEditorText() === "" ? "CLEARED" : "STALE";
	  process.stderr.write("PS5BW_EDITOR_" + state + "_" + encodeURIComponent(event.text) + "\\n");
	});
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

function promptActionProgram(promptRepetitions: number): string {
	const steadyProgram =
		promptRepetitions === 1
			? `must_editor_ready "PS5BW_STEADY_EDITOR_READY"
set steady_response_started [clock microseconds]
send -- "PS5BW_SECOND_PROMPT\\r"
must_expect "PS5BW_INPUT_ACK_PS5BW_SECOND_PROMPT"
set steady_acknowledged [clock microseconds]
set second_ready [must_expect_prompt_ready "PS5BW_EDITOR_CLEARED_PS5BW_SECOND_PROMPT" "PS5BW_PROVIDER_START_SECOND"]
report_metric steady_acknowledgement $steady_response_started $steady_acknowledged
report_metric steady_provider_start $steady_response_started [lindex $second_ready 1]
must_expect "PS5BW_SECOND_PROMPT_DONE"
report_metric steady_response $steady_response_started [clock microseconds]`
			: `proc nearest_rank_p50 {values} {
    set ordered [lsort -integer $values]
    return [lindex $ordered [expr {([llength $ordered] - 1) / 2}]]
}
proc measure_steady_prompt {prompt ready_marker provider_marker done_marker} {
    must_editor_ready $ready_marker
    set started [clock microseconds]
    send -- "$prompt\\r"
    must_expect "PS5BW_INPUT_ACK_$prompt"
    set acknowledged [clock microseconds]
    set ready [must_expect_prompt_ready "PS5BW_EDITOR_CLEARED_$prompt" $provider_marker]
    must_expect $done_marker
    return [list [expr {$acknowledged - $started}] [expr {[lindex $ready 1] - $started}] [expr {[clock microseconds] - $started}]]
}
set steady_acknowledgements {}
set steady_provider_starts {}
set steady_responses {}
for {set steady_iteration 0} {$steady_iteration < ${String(promptRepetitions)}} {incr steady_iteration} {
    if {$steady_iteration == 0} {
        set steady_prompt "PS5BW_SECOND_PROMPT"
        set steady_provider_marker "PS5BW_PROVIDER_START_SECOND"
        set steady_done_marker "PS5BW_SECOND_PROMPT_DONE"
    } else {
        set steady_prompt "PS5BW_STEADY_PROMPT_$steady_iteration"
        set steady_provider_marker "PS5BW_PROVIDER_START_STEADY_$steady_iteration"
        set steady_done_marker "[set steady_prompt]_DONE"
    }
    lassign [measure_steady_prompt $steady_prompt "PS5BW_STEADY_EDITOR_READY_$steady_iteration" $steady_provider_marker $steady_done_marker] steady_acknowledgement steady_provider_start steady_response
    lappend steady_acknowledgements $steady_acknowledgement
    lappend steady_provider_starts $steady_provider_start
    lappend steady_responses $steady_response
}
report_metric steady_acknowledgement 0 [nearest_rank_p50 $steady_acknowledgements]
report_metric steady_provider_start 0 [nearest_rank_p50 $steady_provider_starts]
report_metric steady_response 0 [nearest_rank_p50 $steady_responses]`;
	return `
set response_started [clock microseconds]
send -- "PS5BW_FIRST_PROMPT\\r"
must_expect "PS5BW_INPUT_ACK_PS5BW_FIRST_PROMPT"
set first_acknowledged [clock microseconds]
set first_ready [must_expect_prompt_ready "PS5BW_EDITOR_CLEARED_PS5BW_FIRST_PROMPT" "PS5BW_PROVIDER_START_FIRST"]
report_metric acknowledgement $response_started $first_acknowledged
report_metric provider_start $response_started [lindex $first_ready 1]
must_expect "PS5BW_FIRST_PROMPT_DONE"
report_metric response $response_started [clock microseconds]
${steadyProgram}
must_editor_ready "PS5BW_SHUTDOWN_EDITOR_READY"
set shutdown_started [clock microseconds]
send -- "\\004"
`;
}

function lifecycleActionProgram(action: Action, promptRepetitions: number): string {
	switch (action) {
		case "prompt":
			return promptActionProgram(promptRepetitions);
		case "background-exit":
			return `
send -- "PS5BW_BACKGROUND_PROMPT\\r"
must_expect "PS5BW_INPUT_ACK_PS5BW_BACKGROUND_PROMPT"
must_expect "PS5BW_EDITOR_CLEARED_PS5BW_BACKGROUND_PROMPT"
must_expect "PS5BW_BACKGROUND_READY"
must_file $env(PS5BW_BACKGROUND_SHELL_PID)
must_editor_ready "PS5BW_BACKGROUND_EXIT_EDITOR_READY"
set shutdown_started [clock microseconds]
send -- "\\004"
`;
		case "agent-exit":
			return `
send -- "PS5BW_AGENT_PROMPT\\r"
must_expect "PS5BW_INPUT_ACK_PS5BW_AGENT_PROMPT"
must_expect "PS5BW_EDITOR_CLEARED_PS5BW_AGENT_PROMPT"
must_file $env(PS5BW_AGENT_PI_PID)
must_file $env(PS5BW_AGENT_SHELL_PID)
must_file $env(PS5BW_AGENT_DESCENDANT_PID)
set interrupt_started [clock microseconds]
send -- "\\003"
must_editor_ready "PS5BW_AGENT_EXIT_EDITOR_READY"
report_metric interrupt $interrupt_started [clock microseconds]
set shutdown_started [clock microseconds]
send -- "\\004"
`;
		case "reload":
		case "reload-change":
			return `
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
report_metric reload $action_started [clock microseconds]
must_editor_ready "PS5BW_RELOAD_EDITOR_READY"
send -- "PS5BW_RELOAD_PROMPT\\r"
must_expect $env(PS5BW_SURFACE_MARKER)
must_expect "PS5BW_INPUT_ACK_PS5BW_RELOAD_PROMPT"
must_expect "PS5BW_EDITOR_CLEARED_PS5BW_RELOAD_PROMPT"
must_expect "PS5BW_PROMPT_DONE"
must_editor_ready "PS5BW_RELOAD_EXIT_EDITOR_READY"
set shutdown_started [clock microseconds]
send -- "\\004"
`;
		case "ctrl-c":
			return `
set shutdown_started [clock microseconds]
send -- "\\003"
after 100
send -- "\\003"
`;
		case "exit":
			return `
set shutdown_started [clock microseconds]
send -- "\\004"
`;
	}
	return fail(`unsupported lifecycle action: ${action}`);
}

export function lifecycleExpectProgram(action: Action, trace: boolean, promptRepetitions = 1): string {
	if (!Number.isSafeInteger(promptRepetitions) || promptRepetitions < 1 || promptRepetitions > 100) {
		fail("prompt repetitions must be an integer from 1 through 100");
	}
	const actionProgram = lifecycleActionProgram(action, promptRepetitions);
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

proc report_metric {name started finished} {
    puts "PS5BW_METRIC \${name}_us [expr {$finished - $started}]"
}

proc must_expect_prompt_ready {editor_pattern provider_pattern} {
	set deadline [expr {[clock milliseconds] + ${String(DEFAULT_TIMEOUT_SECONDS * 1_000)}}]
    set editor_at 0
    set provider_at 0
    while {[clock milliseconds] < $deadline && ($editor_at == 0 || $provider_at == 0)} {
        set timeout 1
        expect {
            -exact $editor_pattern { if {$editor_at == 0} { set editor_at [clock microseconds] } }
            -exact $provider_pattern { if {$provider_at == 0} { set provider_at [clock microseconds] } }
            eof { puts stderr "Reached EOF while waiting for prompt readiness"; exit 3 }
            timeout {}
        }
    }
    if {$editor_at == 0 || $provider_at == 0} {
        puts stderr "Timed out waiting for prompt readiness"
        exit 8
    }
    return [list $editor_at $provider_at]
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

proc must_editor_ready {marker} {
    set deadline [expr {[clock milliseconds] + ${String(DEFAULT_TIMEOUT_SECONDS * 1_000)}}]
    while {[clock milliseconds] < $deadline} {
        send -- "\\025"
        send -- $marker
        after 20
        set timeout 0
        expect {
            -exact $marker {
                send -- "\\025"
                after 20
                return
            }
            eof { puts stderr "Reached EOF while waiting for Editor input: $marker"; exit 3 }
            timeout {}
        }
    }
    puts stderr "Timed out waiting for Editor input: $marker"
    exit 7
}

proc wait_for_initial_editor {} {
    set deadline [expr {[clock milliseconds] + ${String(DEFAULT_TIMEOUT_SECONDS * 1_000)}}]
    while {[clock milliseconds] < $deadline} {
        send -- "\\025"
        send -- "/ps5bw-ready\\r"
        after 20
        set timeout 0
        expect {
            -exact "${READY_MARKER}" {
                must_editor_ready "PS5BW_INITIAL_EDITOR_ACCEPTS_INPUT"
                return
            }
            -exact "Startup is still in progress" {}
            eof { puts stderr "Reached EOF while waiting for the initial Editor"; exit 3 }
            timeout {}
        }
    }
    puts stderr "Timed out waiting for the initial Editor"
    exit 6
}

set startup_started [clock microseconds]
spawn -noecho script -qefc $env(PS5BW_RUNNER) /dev/null
must_expect "fixture-model"
wait_for_initial_editor
report_metric startup $startup_started [clock microseconds]
${actionProgram}
expect {
    eof {}
    timeout { puts stderr "Timed out waiting for Pi to exit"; exit 4 }
}
report_metric shutdown $shutdown_started [clock microseconds]
`;
}

export function parseMetric(output: string, name: string): number {
	const match = new RegExp(`PS5BW_METRIC ${name}_us (\\d+)`).exec(output);
	if (!match) fail(`Expect did not report ${name}_us: ${output.trim() || "<empty>"}`);
	return Number(match[1]) / 1_000;
}

export function parseHostTimings(output: string): HostTiming[] {
	const normalized = stripTerminalControls(output).replace(/\r/g, "");
	const timings: HostTiming[] = [];
	for (const section of normalized.matchAll(/--- Startup Timings: ([^-\n]+) ---\n([\s\S]*?)\n-+/g)) {
		const namespace = section[1]?.trim();
		const body = section[2];
		if (!namespace || !body) continue;
		for (const line of body.split("\n")) {
			const match = /^\s{2}(.+): (\d+)ms$/.exec(line);
			const label = match?.[1];
			if (!label || label === "TOTAL") continue;
			timings.push({ label, milliseconds: Number(match?.[2]), namespace });
		}
	}
	return timings;
}

export function verifyTerminalState(value: string, size: TerminalSize): void {
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

function historicalToolText(index: number, toolName: "bash" | "read", bytes: number): string {
	if (bytes <= 0) return toolName === "bash" ? `tool-${String(index)}` : `history line ${String(index)}`;
	const marker = `PS5BW_HISTORY_PAYLOAD_${String(index)}\n`;
	const line = `${toolName} history ${String(index)} ${"evidence ".repeat(12)}\n`;
	const repeats = Math.ceil((bytes - marker.length) / line.length);
	const text = (marker + line.repeat(Math.max(0, repeats))).slice(0, bytes);
	if (Buffer.byteLength(text, "utf8") !== bytes) fail("historical Tool payload must use exact ASCII byte sizing");
	return text;
}

function seedSession(directory: string, cwd: string, id: string, turns: number, toolCount = 0, toolBytes = 0): string {
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
	for (let index = 0; index < toolCount; index += 1) {
		const bash = index % 13 < 6;
		const toolCallId = `ps5bw-history-tool-${String(index)}`;
		const toolName = bash ? "bash" : "read";
		manager.appendMessage({
			...assistantMessage(""),
			content: [
				bash
					? {
							type: "toolCall",
							id: toolCallId,
							name: toolName,
							arguments: { command: `printf tool-${String(index)}` },
						}
					: {
							type: "toolCall",
							id: toolCallId,
							name: toolName,
							arguments: { path: `history-${String(index)}.txt` },
						},
			],
			stopReason: "toolUse",
		} satisfies AssistantMessage);
		manager.appendMessage({
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text: historicalToolText(index, toolName, toolBytes) }],
			isError: false,
			timestamp: Date.now(),
		} satisfies ToolResultMessage);
	}
	const path = manager.getSessionFile();
	if (!path) fail(`failed to seed ${id}`);
	return path;
}

export async function prepareFixture(
	root: string,
	projectDirectory: string,
	longSessionTools: number,
	longSessionToolBytes: number,
): Promise<SeededSessions> {
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
		long: seedSession(
			seedDirectory,
			projectDirectory,
			"long",
			LONG_SESSION_TURNS,
			longSessionTools,
			longSessionToolBytes,
		),
		short: seedSession(seedDirectory, projectDirectory, "short", SHORT_SESSION_TURNS),
		traceExtension,
	};
}
