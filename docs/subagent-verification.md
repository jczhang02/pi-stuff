# Subagent verification

[简体中文](i18n/zh-CN/subagent-verification.md) · [Usage](subagents.md)

This record captures the production implementation exercised for [#55](https://github.com/jczhang02/pi-stuff/issues/55). It uses normal Pi processes loading `src/pi/index.ts`, independent child SDK sessions, and real tool execution. There is no prototype host or simulated conversation in the screenshots.

## Environment and reproduction

The acceptance host was Linux, Bun-compiled Pi `0.85.1`, Bun `1.4.0`, and tuistory `0.11.0`. Terminal profiles used `TERM=xterm-256color`, `COLORTERM=truecolor`, Pi's light/dark themes, and a Nerd Font. The screenshots use tuistory's terminal renderer with the corresponding terminal foreground/background; those colors are screenshot settings, not source-image edits.

Offline tests isolate the project, Git repository, agent settings, sessions, model server and workers:

```bash
bun run check
bun run test
PI_TEST_HOST=/absolute/path/to/compiled/pi bun test tests/system
```

The default system profile runs the installed Pi CLI under Bun. `PI_TEST_HOST` selects the compiled executable. The deterministic provider replaces the remote HTTP model boundary; production registration, runtime, session files, worktrees, tools and TUI remain in use. Test teardown stops only processes and temporary directories owned by that test.

The live exercise used the already configured `openai-codex/gpt-5.6-luna` with `low` reasoning, an isolated agent directory and a tiny committed TypeScript project. Credentials and full session transcripts are not published. The extracted counters and checks are in [live-results.json](evidence/subagents/live-results.json).

## Live development trace

1. The parent started three parallel children: Explore inspected an incorrect `clamp`, Implement edited an isolated worktree and ran `bun test`, and Clarify called `ask_parent` about invalid bounds. The parent read the project README while the children ran. In this run the parent answered Clarify automatically; direct user replies are checked separately by the offline TUI test.
2. Entering Clarify and sending a second prompt continued its original conversation. Returning to main preserved the parent conversation and background result delivery.
3. After `/reload`, entering Implement restored its earlier tool calls and edit diff. A second prompt requested `RangeError` validation and equal-bound tests. A message sent while it was executing added a negative-bound test; that steering message was present in the same saved child session.
4. A real Bash command printed `CANCEL_SECOND_READY` and then waited. Esc aborted it in approximately 0.2 seconds. The saved tool result contains `Command aborted`; it does not contain the delayed `UNEXPECTED_END` output. The other children remained completed.
5. A continuation after cancellation used the same Implement session and worktree. Its four tests passed again. Independent execution of `bun test` in that worktree also passed: four tests, six assertions. The parent worktree remained clean, and both branches retained the same HEAD commit; the child's edits were not automatically committed.
6. Manual `/compact` first reported that the conversation was too small under the normal retention setting. With `keepRecentTokens=1000` in the isolated test settings, it compacted 4,759 tokens. Paging still showed the old tool calls, and the summary used Pi's native expandable component. A later prompt correctly summarized the changes from the compacted conversation. Counters included the compaction usage.
7. Pi exited gracefully and reopened the saved parent session in a new process using the dark theme. Fleet, child history and the compaction entry were restored. Unknown child commands retained the draft, including after returning to main and reopening the child. The 80-column layout retained aligned names, activity, time and both token counters.

Implement accumulated seven user messages and one compaction in the same child session. The parent received twelve stored subagent notifications; every one had `display: false`. SDK-reported child usage is retained as evidence, not represented as an account billing statement.

## Actual interface

Fleet below the parent statusline, with a selected row:

![Light Fleet](evidence/subagents/fleet-light.png)

A child conversation using Pi message/tool components and its own editor identity:

![Light child](evidence/subagents/child-light.png)

The same restored conversation with the dark theme:

![Dark child](evidence/subagents/child-dark.png)

At 80 columns, activity truncates while statistics remain aligned:

![Narrow child](evidence/subagents/child-narrow.png)

## Scope of the evidence

These results cover the named Linux/Bun/Pi environment and the configured Codex model. They do not establish Windows/macOS, Node-host, arbitrary provider or arbitrary custom-footer compatibility. Pi's public footer API allows one owner; the documented footer composition limitation still applies. The child viewer supports the commands listed in the usage guide; it is not an embedded copy of Pi's entire command dispatcher.

The PR records the final check counts, comparison commits, independent standards/requirements review, fixes and any remaining acceptance limits. A screenshot or successful model response alone does not establish cancellation or recovery correctness.
