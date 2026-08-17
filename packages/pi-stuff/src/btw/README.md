# BTW module

Pi Stuff's one-shot `/btw` capability.

`/btw <question>` opens the shared full-width, non-floating Command Dialog and
streams one no-tool answer from the active model while the main Agent keeps
running. The surface contains only the `/btw` question, Markdown answer, and
the controls available in its current state. Closing it restores the editor
draft and normal Suite chrome.

Routine side questions never become messages in the main transcript or model
context. BTW receives Pi's completed, compaction-aware context, including text,
images, tool calls, and tool results; an unfinished assistant partial is
excluded. Every side call has its own abort signal and `tools: []`.

Run bare `/btw` to reopen successful history for the current session. History
is stored as invisible, no-context Pi custom entries, survives process restart
and resume, and is not inherited by `/clear`, a new session, or a forked
session. It is retained for the practical session lifetime, with only abnormal
guards of 1,000 exchanges or 8 MiB evicting the oldest records; an individual
exchange larger than the entire byte budget is not retained. Process-local
copies are released when their session shuts down and rebuilt from those
custom entries when that session is resumed.

Answered exchanges support history navigation, scrolling, copy, clear, and
`f`. Promotion waits for the main Agent to become idle, then opens a new Pi
session whose formal user and assistant turns are the selected BTW question
and answer. The original session remains unchanged apart from its invisible
display-history entry. Space, Enter, and Esc dismiss the focused surface; Esc
is the advertised close/cancel key.

Clearing earlier history is a two-step inline action inside the same Command
Dialog: `x` asks for confirmation, `y` commits it, and Esc cancels. It never
opens a floating confirmation window. At low terminal heights the current
question or error and an Escape hint remain visible before answer history.

The implementation derives from `@juicesharp/rpiv-btw`; see [UPSTREAM.md](./UPSTREAM.md).

Pi does not expose a public transcript-free Host model-call seam. `/btw`
therefore uses the active model's registered provider and Model Registry auth,
but it does not run provider lifecycle/context hooks or inherit Host retry and
transport settings.

## Accepted `/btw` readability target

**Decision update:** 2026-08-17
**Status:** Accepted; implementation pending.

The question is the primary identity of a BTW exchange. `/btw <question>` opens that exchange directly and gives the
answer the available body height. It does not keep up to five unrelated history questions above a streaming answer.
Bare `/btw` has a different job and opens a compact successful-history list first:

```text
BTW history · 4 exchanges

› Why did the typecheck fail?                          2m
  What does Context wrapup preserve?                 18m
  How does Tool grouping work?                        1h

↑/↓ select · Enter open · x clear earlier · Esc close
```

The history list keeps newest first, preserves focus while records update, and uses `… N newer`/`… N older` when it
overflows. Up and Down move one exchange; PageUp/PageDown and Shift+Up/Down move one visible page. History contains
successful exchanges only, so a repeated success icon would add no information and is omitted.

Exchange detail uses the selected question as its visual anchor:

```text
BTW · 3 of 4
Why did the typecheck fail?
✓ answered

│ Answer
...Markdown answer...

←/→ history · Shift+↑/↓ page · c copy · f new session · x clear earlier · Esc close
```

Use `● answering`, `✓ answered`, and `× failed`; when a failed call retained text, add `partial answer` to the full
state line. The short `│` mark appears only on `Answer`. Markdown retains its own meaningful list, quote, and code-block
hierarchy. A blank successful answer says `(empty answer)`; bare `/btw` with no history is an empty state, not a failed
exchange.

While streaming, follow appended answer content only at the bottom. Up, PageUp, or Shift+Up pauses following and shows
a bounded newer-content notice; reaching the bottom resumes following. Up and Down scroll by one step;
PageUp/PageDown and Shift+Up/Down scroll by one page. Left and Right switch successful history and reset the selected
answer to its beginning. They do not affect the current streaming exchange.

`c copy` and `f new session` appear only for a successful exchange. The latter is the existing fork operation, but the
visible label describes its outcome: it waits for the main Agent to become idle and then opens a new Pi session seeded
with the selected question and answer. `x clear earlier` keeps the existing inline `y` confirmation and retains the
selected or active exchange. Feedback stays above the Escape path and never replaces the question or a partial error.

The history list uses Enter to open. In exchange detail, Enter and Space may close only a settled answer; a pending
answer advertises and accepts Escape as its cancellation path so an ordinary confirm key cannot silently cancel a
stream. Escape from detail closes the focused BTW surface and restores the exact editor draft and Suite chrome.

The transcript-free context projection, no-Tool provider call, per-call abort signal, persisted invisible display
history, bounds, sanitization, original-session preservation, and Session isolation remain unchanged. The current UI's
remaining deltas are the always-visible five-question history strip, no dedicated bare-history list, no state icon or
Answer section, `f fork` implementation wording, no explicit newer-content notice, hidden pending Enter/Space
cancellation, and missing PageUp/PageDown plus Shift+Arrow page aliases.
