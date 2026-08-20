# BTW module

Pi Stuff's one-shot `/btw` capability.

`/btw <question>` opens the shared full-width, non-floating Command Dialog and streams one no-tool answer from the
active model while the main Agent keeps running. Closing it restores the editor draft and normal Suite chrome.

Routine side questions never become messages in the main transcript or model context. BTW receives Pi's completed,
compaction-aware context, including text, images, Tool calls, and Tool results; an unfinished assistant partial is
excluded. Every side call has its own abort signal and `tools: []`.

Successful exchanges are stored as invisible, no-context Pi custom entries. They survive process restart and resume,
but are not inherited by `/clear`, a new session, or a forked session. Retention is bounded by the practical session
lifetime, 1,000 exchanges, and 8 MiB. Process-local copies are released when their session shuts down and rebuilt from
those custom entries when that session resumes.

Answered exchanges support history switching, scrolling, copy, clear, and `f`. Promotion waits for the main Agent to
become idle, then opens a new Pi session whose formal user and assistant turns are the selected BTW question and
answer. The original session remains unchanged apart from its invisible display-history entry. Space, Enter, and Esc
dismiss the focused surface; Esc is the advertised close key.

Clearing earlier history is a two-step inline action inside the same Command Dialog: `x` asks for confirmation, `y`
commits it, and Esc cancels. It never opens a floating confirmation window. At low terminal heights the selected
question or error and an Escape hint remain visible before answer history.

The implementation derives from `@juicesharp/rpiv-btw`; see [UPSTREAM.md](./UPSTREAM.md).

Pi does not expose a public transcript-free Host model-call seam. `/btw` therefore uses the active model's registered
provider and Model Registry auth, but it does not run provider lifecycle/context hooks or inherit Host retry and
transport settings.

## `/btw` readability contract

**Decision update:** 2026-08-17  
**Status:** Implemented on 2026-08-18.

This surface follows the observed Claude Code shape within Pi's native Command Dialog lifecycle. One continuous heavy
top rule introduces a single-column reading flow at every width. Up to five recent questions appear as quiet `/btw`
lines, the selected question is emphasized, and its Markdown answer follows directly:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /btw Why did the typecheck fail?

  The generated declaration file was stale, so TypeScript read an old API shape.

  ←/→ switch · ↑/↓ scroll · c copy · f fork
  x clear history · ? keys · Esc close
```

There is no `BTW` title, lifecycle label, `Answer` section, list/detail transition, card, or split pane. Pending work is
shown by the answer loader; a failure appears in the answer flow. A blank successful answer says `(empty answer)`, and
bare `/btw` with no retained exchange says `No previous /btw exchange in this session.`

Left and Right switch retained exchanges. Pi's configured Up and Down actions scroll by three lines, with
Ctrl+P/Ctrl+N as read-only aliases; PageUp/PageDown and `b`/Space scroll one visible page, and Home/End jump to the top
or bottom. Enter and Space no longer close the reading surface. `?` opens contextual key help. A streaming answer
follows its tail only while the reader remains at the bottom. `c` and `f` apply
only to a successful exchange. `x` appears only when earlier history exists and keeps the inline confirmation inside
the same surface.

The transcript-free context projection, no-Tool provider call, per-call abort signal, persisted invisible display
history, bounds, sanitization, original-session preservation, and Session isolation remain unchanged. Focused tests
and the real PTY verifier cover history switching, streaming, clear confirmation, copy/fork controls, page aliases,
low-height fitting, and exact draft/chrome restoration.
