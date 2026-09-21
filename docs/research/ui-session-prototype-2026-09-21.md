# Compact conversation prototype

[简体中文](../i18n/zh-CN/research/ui-session-prototype-2026-09-21.md)

This follow-up to [#99](https://github.com/jczhang02/pi-stuff/issues/99) evaluates the five corrections in [#101](https://github.com/jczhang02/pi-stuff/issues/101). Baseline: `d8ff7be`, product baseline `cd0f174`, Pi 0.85.1, Bun 1.4.0. The separate branch is `codex/ui-session-prototype`. [Run instructions and gallery](../../prototypes/ui-session/README.md).

## Evidence and design choices

The local `pi-stuff-old` snapshot is `21b636eaccc487a08362165ec69ffe364e8730fb`. Its `docs/research/claude-code-tool-grouping-narrative-boundary-20260826.md` records isolated black-box tests against the official Claude Code 2.1.220 binary (SHA256 `674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863`) and Pi 0.84.3. This is retained historical evidence, not a new Claude execution or a guarantee about current releases. The old commit is available locally; its public GitHub page could not be retrieved during this work.

That matrix shows Read/Grep/Glob folding across API responses, with visible assistant prose, user turns and independent tools closing the group. Two reads already fold. Bash, Edit, Write, WebSearch and WebFetch remain separate. Thinking is transparent in the observed client. The older capability prose treats Thinking more strictly; this prototype deliberately keeps its separate visible Thoughts entry as a boundary, preserving chronological display without interleaving a hidden thought inside another row.

The old `packages/pi-stuff/src/tool-display/render.ts`, `operation-block-renderer.ts` and their component tests provide the `• Action(target)` and `⎿ outcome` hierarchy, bounded evidence, syntax coloring and diff gutters. The implementation was inspected locally rather than inferred from screenshots.

[Claude's official interactive-mode documentation](https://code.claude.com/docs/en/interactive-mode#transcript-viewer) documents access to detailed tool transcripts. [Codex's compact execution renderer](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/exec_cell/compact.rs) groups exploration and bounds output. Its [Web history cells](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/history_cell/search.rs) retain semantic search/open/find actions; the [tool output renderer](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/tool_output.rs) retains hidden-output disclosure. These are references, not new dependencies or claims of identical behavior.

Current Pi's installed `tool-execution.js` and `assistant-message.js` were checked for click expansion and plain assistant errors. The prototype uses Pi's MouseRegion, Markdown, Container and real editor. It does not replace production native message components.

## Selected rules for this prototype

| Surface                          | Default                                                                                                 | Expanded / boundary                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Read, Grep, Find, Ls             | Title plus outcome; no raw body                                                                         | Click one tool for full retained body                                                                      |
| Consecutive successful retrieval | Two or more become an Explored summary                                                                  | Click group for chronological compact children; click a child for details                                  |
| Retrieval boundary               | User/assistant text, visible Thoughts, mutation, Bash, Web, failed/running call or a truncation warning | Never group across that boundary; static scenes precompute groups; live retrieval joins only after success |
| Web family                       | WebSearch(query), WebFetch(source), WebRead(source + operation); same title/outcome component           | Search results, page text and paging metadata appear only on expansion; each Web call stays independent    |
| Edit                             | Outcome plus at most three rendered diff rows                                                           | More-lines count; full syntax-highlighted changes and target on expansion                                  |
| Write                            | File and written-line count                                                                             | Syntax-highlighted content on expansion                                                                    |
| Bash                             | Running: latest two output rows. Success: result summary. Failure: cause remains visible                | Full retained output on expansion; upstream truncation and log path remain visible while collapsed         |
| Tool failure                     | Failure on the owning tool's result line                                                                | Detailed cause/output on expansion, without duplicating the short error in the default view                |
| Thoughts                         | `Thoughts for 4s` after settling; `Thinking · Ns` while active                                          | `Thoughts:` followed by the actual sample content; no new icon                                             |
| Assistant failure/interruption   | Plain text, retaining any partial answer                                                                | No tool title, child marker, card or extra action                                                          |

Two logical rows do not promise two physical terminal lines: outcomes wrap when needed. Long collapsed titles use an ellipsis; expansion restores the full target with aligned continuation. Code wraps within its gutter. Color supplements text status. A group header is separate from its inset children. Click changes only that row; Ctrl+O toggles all detail. Input focus remains with Pi's editor.

The exploration threshold and stricter Thoughts boundary are explicit prototype choices. Edit's three-row preview follows the old compact budget; Write is more compact here. The Web labels map to existing `web_search`, `fetch_content` and `get_search_content`; no tools or APIs are renamed. No inspector, Todo, Agents, Goal, background work or notification subsystem is added.

## Session and coverage

The main session fixes duplicated items at a page boundary: inspect directory and code, find tests, check Web guidance, edit the filter, write a test and run it. The four-line original implementation and returned cursor agree across fixtures. Additional launch scenes show errors, no matches, no output, cancellation, upstream truncation, long diffs/paths, image text fallback and assistant interruption. Welcome reuses the previous old-style renderer.

The dynamic replay spends four seconds thinking, then runs a simulated test for four seconds and collapses its output on completion. Esc cancels the active replay and retains the draft. Execution, model name, Web pages and tests are samples, not real provider or shell results. In static scenes, ordinary text submission is intercepted and restored to the editor; this is not an arbitrary coding session. Launch arguments select scenes outside the evaluated UI.

Earlier optional/native display families remain documented in the [previous inventory](conversation-coverage-2026-09-20.md); this artifact focuses on the requested conversation/tool rules rather than inventing replacement UI for every host subsystem.

## Verification boundary

Terminal Control exports actual Pi screens using the repository's Latte/Mocha themes and `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. Retained PNG, ANSI and text files have matching stems. Capture assertions cover expected text, palette and clipped cells. Interaction runs cover group/child disclosure, Thoughts, Web metadata, Write, Ctrl+O, draft preservation and dynamic completion/cancellation. The gallery links those states.

This evidence concerns an isolated offline prototype. It does not certify production replay, real tool execution, image protocols or native window/compositor behavior. No production code, dependencies or persistence format changed. The artifact can be removed without migration. A permanent fixture test suite would duplicate the capture driver, so verification stays in that runnable driver and recorded review evidence.

## Follow-up: terminal side effect and session depth

The initial acceptance was incomplete: static scenes did not test submission-driven conversation progression, and deterministic capture colors leaked into the foreground launcher. The user reported both gaps; #101 was reopened rather than treating screenshot count as acceptance.

A raw outer-PTY run of 2184119 captured `OSC 10;#cdd6f4` and `OSC 11;#1e1e2e`, with no reset on clean exit. [Ghostty's official dynamic-color documentation](https://ghostty.org/docs/vt/osc/1x) defines these as foreground/background setters. [OSC 110/111](https://ghostty.org/docs/vt/osc/11x) reset defaults; they do not restore an arbitrary previous runtime override. Terminal Control [v1.2.1 session.rs](https://github.com/anomalyco/terminal-control/blob/v1.2.1/src/session.rs) mirrors child bytes at lines 761–767 and restores terminal modes, but not palette, at lines 1465–1473. This explains the observed color change without assuming a Ghostty configuration-file edit.

Foreground launch now emits no palette setters or resets. Only headless captures select terminal background/foreground. The launcher reads the concrete Pi theme field before creating its isolated settings; it never copies account settings. Unsupported or automatic themes require an explicit supported `--theme`. This restriction is deliberate: Terminal Control's hosted [shot.rs](https://github.com/anomalyco/terminal-control/blob/v1.2.1/src/shot.rs) answers OSC 10/11 queries with fallback colors (lines 624–641), so Pi auto-detection there does not observe the real outer Ghostty background. No dependency change or external-terminal configuration mutation is needed.

`verify-foreground.ts` runs the real foreground launcher inside an outer private PTY and checks its raw transcript through clean exit: inherited theme, explicit light, explicit dark, and interrupted replay. It rejects palette setters and resets while allowing queries. All four paths passed after the fix. The protocol driver also verifies Kitty-encoded Escape in both live and replay scenes; these two paths passed after replacing raw-byte cancellation checks with Pi matchesKey. This proves the outgoing protocol boundary, not native compositor behavior.

The new default `live` scene has an editable initial request, streamed Thoughts/answers, incremental exploration grouping, a missing file, failed Web retrieval followed by successful retrieval and content continuation, a failing regression test, Edit and successful verification. A second submitted request adds a separate test file, reproduces same-page duplication, edits the filter and passes ten tests across three files. Full output spans the viewport. Esc retains partial output and stops the timer; the next submission retries the interrupted step. An input during execution first interrupts the active response. `live-error` exercises a plain HTTP 503 and retry. Later submissions recap the retained result rather than replaying stale edits.

The script is deterministic and offline. It exercises the actual editor, mouse disclosure, Ctrl+O, transcript navigation and timers, but does not claim arbitrary request interpretation, production provider calls, persistence or a general diff algorithm. Static scenes remain useful for focused visual comparisons. The new interaction driver verifies real submissions, cancellation quiescence, retry and two-turn progression; captures are evidence of those paths, not a completeness metric.

Resize verification initially exposed a false-positive capture: Terminal Control changed frame dimensions before Pi redrew, so a short idle wait retained clipped old-width content. A separate full-Pi probe confirmed actual reflow. The live driver now waits for a specific complete code continuation that only appears at 60 columns, then checks navigation to the beginning and back to the current draft. Frame geometry alone is not a reflow assertion.

Final interaction waits identify the owning tool result (`Added 2 lines, removed 1 line · collapse`) and a changed viewport containing the first test case. A generic `collapse` token could match the footer, and an already-visible output tail could satisfy a scroll assertion before input was rendered. These false-positive waits were corrected and affected captures regenerated.

## Follow-up: preserve native messages and statusline

User feedback removes these surfaces from the redesign. Static and live user rows now instantiate Pi 0.85.1's exported `UserMessageComponent`, retaining its background, padding, Markdown behavior and terminal prompt markers. Surrounding prototype padding applies only to other entries. The extension no longer calls `setFooter`; Pi renders its actual isolated session context and `preview` model instead of a hardcoded branch/model. All retained terminal captures were regenerated. Both live paths still pass disclosure, history navigation and 60-column reflow; all six foreground palette checks pass.
