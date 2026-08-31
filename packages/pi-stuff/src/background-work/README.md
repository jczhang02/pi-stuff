# Pi Stuff Work

Current-session Background Shell, one-shot Monitor, and `/tasks` management for Pi Stuff.

- Bash accepts `run_in_background: true` and can hand a running foreground command to the background with `Ctrl+B`.
- `Monitor` waits for one explicit command, log, file, or HTTP condition without polling in the main conversation.
- `/tasks` is a full-width, non-floating live manager for Background Shell and Monitor.
- Explicit output and stop queries remain idempotent for the 64 most recently finished owned activities in the current Pi
  process; terminal receipts are bounded memory, not durable task history.
- Output and notification size are bounded. Runtime limits and shutdown are enforced by an authenticated process-group
  supervisor, and uncertain process ownership is retained for recovery until absence is positively proven.

Todo, Goal, Beads, and Agent details retain their existing authorities and are not duplicated here.

`runtime.ts` remains the sole registry, capacity, Monitor, persistence, receipt, notification, and shutdown authority.
Its `effect-owner.ts` owns one Capability Scope beneath the initialized Session. Monitor polling, Shell waiting,
notification retry and heartbeat, and Dialog refresh run as operations in that Scope; interruption cancels them, and
shutdown requests the authenticated native stop protocol before closing the Scope. `shell-activity.ts` owns one
authenticated process lifecycle, `shell-activity-launch.ts` owns pre-command resource preparation, and
`shell-activity-presentation.ts` owns Tool-call waiting and result projection. `process.ts`, `process-supervisor.mjs`,
and `monitor-native.ts` are the narrow native adapters, while `output.ts` owns bounded output. The stateless
`notification-projection.ts` seam only bounds and escapes a completed batch before delivery.

## Accepted `/tasks` readability target

**Decision update:** 2026-08-17
**Status:** Implemented on 2026-08-18.

`/tasks` is the live current-work manager, not Tool invocation history or durable task history. It owns Background Shell
and Monitor inspection and stop controls. `/agents` owns Agent lifecycle and control, while `/tools` owns Tool invocation
and protocol inspection. A Tool invocation that launched Background Work and the resulting live task are different
domain objects, so the UI does not match rows and delete apparent duplicates; each surface reads directly from its
own authority. A Transcript `background` call uses an Operation Block only for `action=output`; launch and control calls
retain their ordinary Tool rows.

The list keeps launch order and updates rows in place. It contains live work only; terminal Background Work continues
through its existing bounded receipt and notification paths. A row is the `›` focus marker, work kind, primary identity,
then a right-aligned lifecycle icon and elapsed time:

```text
Tasks · 2 current

› Shell    Build package                         ● 18s
  Monitor  Wait for CI success                   ● 2m
```

`›` means selection only. Shell and Monitor use `●` active and `◐` stopping. Descriptions disappear before kind,
identity, lifecycle icon, or elapsed time at narrow widths.

Pi's configured Up and Down actions select one row; Ctrl+P/Ctrl+N are read-only aliases. PageUp/PageDown and
`b`/Space move one visible page when the list overflows, while Home/End jump to the first or last task; show
`… N earlier` and `… N later` around that window. New work appends without stealing focus. `x stop` appears only for an
owned active Shell or Monitor and disappears while stopping. `?` opens contextual key help. Escape always closes the
list.

At 96 columns and wider, a non-empty task list and its selected detail share one fixed 18-row Dialog. One continuous
heavy top rule spans both panes and one heavy `┃` divider separates them. The fixed height prevents the editor from
moving while the user switches tasks. Narrow and empty states remain single-column.
Tab and Shift+Tab switch the wide list/detail focus without changing the Dialog height.

Shell detail is specific to a background command:

```text
Tasks / Shell
Build package
● running · 18s · task bg-ab12

Command
bun run check:fast

Output
...latest bounded output...
```

Monitor detail is specific to the condition being observed:

```text
Tasks / Monitor
Wait for CI success
● watching · 2m · task mon-ab12

Source
HTTP · https://example.test/build/42

Condition
success contains "completed"
timeout in 8m

Latest evidence
...latest bounded response or log text...
```

Omit an absent condition field rather than displaying placeholders. A missing file or log source is the expected
`Waiting for <source> to appear.` state; other source read errors fail the Monitor instead of being presented as
ordinary waiting. File, log, HTTP, and command Monitors retain their
real source and target; exposing them requires the live snapshot to carry the existing Monitor input metadata instead
of flattening every Monitor into a generic command. A task ID remains low-priority detail metadata and never enters the
list row.

Section headings use bold semantic text without icons. Content keeps its natural Tool-owned command/output hierarchy
and does not gain another indentation level. Output or evidence follows appended content only while the viewport is at the
bottom; upward movement freezes reading, reports bounded newer content, and resumes following at the bottom.
PageUp/PageDown and `b`/Space scroll by a page; Home/End jump to the top or bottom. Footer scroll hints appear only on overflow; `x stop` appears only
while the selected owned activity is stoppable; `Esc back` is always present and last.

An empty list says `No background work in this session.` and keeps only key-help and close hints until work exists. The implementation reads the Background Work runtime snapshot
directly, preserves launch order and selection across updates, carries real Monitor source and condition metadata, and
keeps recent output bounded. Focused tests cover the type-specific details, fixed split geometry, empty state, status
icons, page aliases, and the absence of Agent projections.
