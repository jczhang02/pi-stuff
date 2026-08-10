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
