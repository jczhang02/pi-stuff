# Pi Stuff Work

Current-session Background Shell, one-shot Monitor, and `/tasks` management for Pi Stuff.

- Bash accepts `run_in_background: true` and can hand a running foreground command to the background with `Ctrl+B`.
- `Monitor` waits for one explicit command, log, file, or HTTP condition without polling in the main conversation.
- `/tasks` is a full-width, non-floating live manager for Background Shell, Monitor, and read-only running Agent projections.
- Explicit output and stop queries remain idempotent for the 64 most recently finished owned activities in the current Pi
  process; terminal receipts are bounded memory, not durable task history.
- Output and notification size are bounded. Runtime limits and shutdown are enforced by an authenticated process-group
  supervisor, and uncertain process ownership is retained for recovery until absence is positively proven.

Todo, Goal, Beads, and Agent details retain their existing authorities and are not duplicated here.

## Accepted `/tasks` readability target

**Decision update:** 2026-08-17
**Status:** Accepted; implementation pending.

`/tasks` is the live current-work manager, not Tool invocation history or durable task history. It owns Background Shell
and Monitor inspection and stop controls. Agent rows are read-only projections: selecting one opens the owning
`/agents` detail directly instead of showing a second generic Agent detail in `/tasks`. `/tools` continues to own Tool
invocation and protocol inspection.

The list keeps launch order and updates rows in place. It contains live work only; terminal Background Work continues
through its existing bounded receipt and notification paths. A row is the `›` focus marker, work kind, primary identity,
then a right-aligned lifecycle icon and elapsed time:

```text
Tasks · 3 current

› Shell    Build package                         ● 18s
  Monitor  Wait for CI success                   ● 2m
  Agent    reviewer · Review Dialog readability  ! 36s
```

`›` means selection only. Shell and Monitor use `●` active and `◐` stopping. Agent projections preserve their real
Dialog lifecycle: `○` queued, `●` running, `!` waiting, `◐` stopping, and `↻` resuming. An Agent row keeps the configured
Agent name ahead of its optional task description; the projection must not replace the name with the description.
Descriptions disappear before kind, identity, lifecycle icon, or elapsed time at narrow widths.

Up and Down select one row. PageUp/PageDown and Shift+Up/Down move one visible page when the list overflows; show
`… N earlier` and `… N later` around that window. New work appends without stealing focus. `x stop` appears only for an
owned active Shell or Monitor and disappears while stopping. An Agent row instead advertises `Enter open Agent` and
never claims a stop control owned by `/agents`. Escape always closes the list.

Shell detail is specific to a background command:

```text
Tasks / Shell
Build package
● running · 18s · task bg-ab12

│ Command
bun run check:fast

│ Output
...latest bounded output...
```

Monitor detail is specific to the condition being observed:

```text
Tasks / Monitor
Wait for CI success
● watching · 2m · task mon-ab12

│ Source
HTTP · https://example.test/build/42

│ Condition
success contains "completed"
timeout in 8m

│ Latest evidence
...latest bounded response or log text...
```

Omit an absent condition field rather than displaying placeholders. File, log, HTTP, and command Monitors retain their
real source and target; exposing them requires the live snapshot to carry the existing Monitor input metadata instead
of flattening every Monitor into a generic command. A task ID remains low-priority detail metadata and never enters the
list row.

The short `│` mark appears only on section headings. Content keeps its natural Tool-owned command/output hierarchy and
does not gain another indentation level. Output or evidence follows appended content only while the viewport is at the
bottom; upward movement freezes reading, reports bounded newer content, and resumes following at the bottom.
PageUp/PageDown and Shift+Up/Down scroll by a page. Footer scroll hints appear only on overflow; `x stop` appears only
while the selected owned activity is stoppable; `Esc back` is always present and last.

An empty list says `No background work in this session.` The current implementation already has the correct live data
subscriptions, launch-order base, selected-row window, ownership boundary, and bounded recent output. Its remaining
deltas are one color-only circle for every state, no page navigation or overflow counts in the list, a description-first
Agent projection, a redundant `/tasks` Agent detail, generic State/Task/ID rows for every kind, Monitor metadata flattened
into command/output, `x stop` advertised while stopping, and missing Shift+Arrow aliases.
