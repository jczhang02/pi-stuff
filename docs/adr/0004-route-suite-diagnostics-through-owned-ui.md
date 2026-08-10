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

## Consequences

- Internal recovery warnings no longer appear as raw text inside the editor.
- The main conversation stays quiet unless a problem requires a user action.
- `/diagnostics` provides one predictable place to inspect recent Suite failures without changing model context.
- A Host restart intentionally clears diagnostic history; durable operational state remains owned by each Capability.
- Capability and diagnostic observers cannot turn presentation failures into Host failures.
