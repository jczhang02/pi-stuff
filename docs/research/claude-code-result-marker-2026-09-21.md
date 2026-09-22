# Claude Code result-marker execution study

[简体中文](../i18n/zh-CN/research/claude-code-result-marker-2026-09-21.md) · [Actual capture gallery](../../prototypes/ui-session/claude-reference/README.md)

Correction: the [new /tui default study](claude-code-default-tui-2026-09-22.md) reproduces separate output and timeout children in one Bash invocation. This report did not cover that completed state and does not establish a one-connector-per-tool limit.

## Finding

The earlier description, "one marker per tool result", was too narrow. In the tested Claude Code 2.1.261 paths, `⎿` starts visible child content: completed output, live stdout, an active command preview, or an interruption annotation. It does not appear on every output line, nor does every invocation necessarily have a visible marker. Collapsed summaries can have none.

For a displayed multiline result, the first line has one marker and later source lines and wrapped continuations use aligned spaces. Two independent displayed Bash results have two markers. Expanding two grouped Reads restores two independently marked results. Edit has one marker on its change summary; the diff rows do not repeat it.

## Observations

| Case                                 | Classic default                                         | Fullscreen default                                           | Detailed transcript                                                      |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Eight-line `python3 output.py`       | One `⎿`, first three lines, `… +5 lines`                | `Ran 1 shell command`, zero markers                          | Eight output lines under one marker                                      |
| Two independent `printf` calls       | Two Bash blocks, two markers                            | `Ran 2 shell commands`, zero markers                         | Two results, each with one marker                                        |
| `true`                               | One marker before `(No output)`                         | `Ran 1 shell command`, zero markers                          | One marker before `(No output)`                                          |
| Two stderr lines, exit 3             | One marker before `Error: Exit code 3`, stderr indented | `Ran 1 shell command`, zero markers                          | Same one-marker error block                                              |
| Two Read calls in one response       | `Read 2 files`, zero markers                            | `Read 2 files`, zero markers                                 | Two Read blocks, each with one marker                                    |
| `Bash(cat multiline.txt)`            | `Read 1 file`, zero markers                             | `Read 1 file`, zero markers                                  | Actual Bash call and eight output lines, one marker                      |
| Read then successful Edit            | Collapsed Read; Update summary and diff, one marker     | Same marker structure                                        | Read and Update each have one marker; diff rows have none                |
| Long Bash output, 100 and 60 columns | One marker; narrow preview can fold rendered lines      | `Ran 1 shell command`, zero markers                          | Wrapping adds physical rows, not markers                                 |
| Running Bash                         | One marker before live stdout and elapsed details       | One marker before `$ command` under the activity description | Fullscreen sample shows the call header without a child marker or stdout |
| Escape during that Bash              | One marker before interruption annotation               | `Ran 1 shell command` plus one interruption marker           | Interruption stays attached to the tool activity                         |

Counts describe these captured screens, not an API guarantee for every tool or configuration. In particular, the fullscreen Edit exception means it is incorrect to say that fullscreen hides _all_ tool results. Failure folding is reported as observed after the fixture's final response, not recommended for Pi.

The [capture index](../../prototypes/ui-session/claude-reference/manifest.json) links the version, each run and marker counts. Each run retains compact/expanded TXT, ANSI and PNG, a full raw terminal stream, and the fixture's emitted blocks plus actual returned tool results. Running cases instead retain active/cancelled states, with an extra active transcript frame for fullscreen. ANSI streams are gzip-compressed to preserve their exact CR/LF and control bytes without Git text normalization. Temporary absolute paths in those artifacts refer only to generated test files.

## Relationship to the current spec

This study establishes connector semantics and evidence limits. Current group summaries have no ⎿, tool child results have one, and Esc retains native Pi presentation. See the [UI spec](../ui-spec.md); obsolete differences from earlier prototypes are no longer requirements.

## Method and provenance

Executed on 2026-09-21 with the installed official Linux Claude Code release `2.1.261`, SHA256 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`. Terminal Control 1.2.1 launched the release binary in fresh PTYs, with isolated HOME, configuration and working directories. No user Claude credentials, settings, hooks or project files were copied. `--bare`, explicit tool allowlists, `--permission-mode dontAsk` and empty strict MCP configuration bounded the probe. The tested tools were Bash, Read and Edit; no permission bypass was used.

A localhost Anthropic-compatible SSE fixture supplied valid tool-use blocks and a final `PROBE_COMPLETE` text block. Auxiliary requests without tools received a separate text response and did not advance the scenario. Claude Code itself executed shell commands, read files and edited a temporary file. The following client request supplied the actual `tool_result`; these exchanges are retained next to every completed case. The fixture did not supply terminal rows, screenshots or precomputed tool results. This verifies client execution and rendering, not live-model tool selection or model reasoning. The visible model/billing label belongs to the client's dummy API configuration, not a paid model call.

Classic used `CLAUDE_CODE_NO_FLICKER=0`, fullscreen used `1`. Both used Claude's light theme; only the isolated capture PTY received white-background/black-foreground OSC defaults. Screens were 100 x 40 cells, plus 60 x 40 for long-line probes. PNGs were exported directly from captured ANSI with the repository's Nerd Font stack. No native desktop compositor or Ghostty configuration was involved. See the [official renderer switch documentation](https://code.claude.com/docs/en/fullscreen#enable-fullscreen-rendering).

There are 20 scenario/mode/width runs and 43 captured states. Every run sent actual keyboard input; completed cases were captured before and after Ctrl+O. The running classic probe waited for the standalone stdout line `RUN_SECOND`, not the same text inside the command title. Fullscreen does not expose that stdout in the observed active view: its running probe instead captured the command child, entered the detailed transcript, returned and pressed Escape. Live captures are point-in-time frames, not assertions that animation settled. All owned sessions, drivers and fixture servers were stopped.

## Reproduction inputs

Create `a.txt` with `alpha`, `beta`, `gamma` and `b.txt` with `delta`, `epsilon`, each ending in a newline. The multiline Python script prints `RESULT_LINE_1: actual shell output` through `RESULT_LINE_8: actual shell output`. The long-output script prints `LONG_START `, twelve repetitions of `pagination_cursor_`, ` LONG_END`, then `SECOND_LOGICAL_LINE` on the next line. Other exact Bash commands and Edit inputs are in each `exchanges.json`.

Start a fresh interactive release binary with the mode environment variable above, isolated config and a localhost Messages endpoint. Deliver the retained tool-use blocks through the endpoint, let the client execute them, then return the final text after receiving the tool results. Send Ctrl+O for the detailed view. For the running probe, the Python process prints two lines and sleeps twenty seconds; Escape is sent before its last print. No permanently installed harness or dependency is needed.
