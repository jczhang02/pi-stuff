---
status: accepted
---

# Route Suite diagnostics through owned UI

Pi Stuff runs inside Pi's terminal renderer. Writing maintenance warnings directly to stdout or stderr bypasses that
renderer, can insert text into the editor area, and gives internal housekeeping the same visual weight as the user's
work. Capability Modules therefore report structured Diagnostic Records to `conversation-ui` instead of using Host-side
console output.

Presentation follows ownership. A Capability's normal state stays on its existing surface, such as Fleetview,
Background Work, Todo, or a Tool result. Non-actionable cleanup and retry information is silent in the main UI but
remains available in a bounded, current-process `/diagnostics` history. A failure that needs the user may raise one
deduplicated row above the editor. That row is focus-neutral, clears when acknowledged or when the next prompt begins,
and points to `/diagnostics`. The details view uses the existing full-width, non-floating Command Dialog.

Diagnostic Records are display state only. They are not appended to Session history, sent to the model, copied into the
Statusline, or persisted to an independent database or log. Details are bounded, terminal controls are removed, and
common credential forms are redacted. Repeated reports with the same Capability, key, and severity coalesce while
retaining their count and latest details.

Browser-owned consoles and detached child-process logs remain explicit exceptions because they do not write into Pi's
Host TUI. Repository safety checks reject any new Host-side console call outside that narrow allowlist.

## Accepted `/diagnostics` readability update

**Decision update:** 2026-08-17
**Status:** Implemented on 2026-08-18.

This update changes only the existing current-process Command Dialog. Record ownership, notice acknowledgement,
deduplication, bounds, redaction, non-persistence, and the separation from Session, model context, transcript, and
Statusline remain unchanged. `/diagnostics` uses a sequential list/detail flow and remains single-column at every
terminal width; it never introduces a split pane for this troubleshooting path.

The list's primary information is what happened. Capability is the source, not the headline. A compact row is the `›`
focus marker, severity icon, Capability, summary, then repeat count and latest age:

```text
Diagnostics · 3 records

› × Agents          Failed to read Agent transcript       ×3 · 2m
  ! Background Work Could not confirm process ownership         5m
  i Context         Retried a stale derived-state refresh      now
```

Use `i` for information, `!` for warning, and `×` for error. Do not use the Dialog lifecycle `●` running icon for an
informational record. `›` remains selection only. At narrow widths preserve icon, Capability, and a useful part of the
summary before age; preserve a repeat count ahead of age when the record is deduplicated.

Records remain ordered by their most recent report or update, newest first. An update moves its deduplicated record to
the front but does not change the focused record. When the list exceeds its visible window, show `… N newer` and
`… N older`; Up and Down move one record, and PageUp/PageDown plus Shift+Up/Down move one visible page. The page hint
appears only on overflow. `c clear` keeps its current immediate, current-process-only behavior; this history is bounded,
ephemeral display state rather than durable user data.

Detail uses the Capability as breadcrumb, the summary as its visual anchor, and full severity text in Header metadata:

```text
Diagnostics / Agents
× error · 3 occurrences · latest 2m ago

Failed to read Agent transcript

◆ Action
Run /agents again after the session file becomes readable.

◆ Details
...latest bounded and redacted diagnostic detail...
```

Omit `Action` when no user action was recorded. `Details` shows the latest bounded record content; when none exists it
says `No additional details were recorded.` without inventing an explanation. The compact `◆` appears only on the
section heading. PageUp/PageDown and Shift+Up/Down scroll by a page; Up and Down scroll by one line. A live update to the
selected deduplicated record refreshes its count, age, action, and latest details without moving a user to another
record or resetting a valid reading position.

At low height preserve the Header, severity and summary, selected row or first detail line, and Escape path before age,
counts, optional action, or surrounding records. Sanitization, credential redaction, record/detail bounds, and observer
isolation remain mandatory and are never reduced for visual simplicity.

The implementation now uses `i` for informational severity, gives the problem summary priority, provides list overflow
and page navigation, removes generic Severity/Occurred/Summary detail rows, and renders `◆` sections. Focused tests
cover the single-column contract, status icons, update-stable selection, detail bounds, page aliases, and low-height
fitting; the real PTY verifier covers Host rendering.

## Consequences

- Internal recovery warnings no longer appear as raw text inside the editor.
- The main conversation stays quiet unless a problem requires a user action.
- `/diagnostics` provides one predictable place to inspect recent Suite failures without changing model context.
- A Host restart intentionally clears diagnostic history; durable operational state remains owned by each Capability.
- Capability and diagnostic observers cannot turn presentation failures into Host failures.
