# `@jczhang02/pi-stuff-tools`

Compact, presentation-only Tool UI for the Pi Stuff Suite.

The Capability re-registers Pi 0.83's seven built-in tools with their original definitions and replaces only their
render slots. Tool schemas, prompt metadata, execution, result content, lifecycle events, and permission checks stay
unchanged. Suite-owned tools can opt into the same renderer contract through `registerSuiteOwnedTool`.

## Daily use

- Running and settled operations occupy one compact semantic row with one fixed-width `●` state slot. A visible
  running row blinks between the dot and a blank slot every 600 ms without moving its label; settled and replayed rows
  remain static.
- Success uses the success color. Errors, permission rejection, and cancellation use the error color and remain
  explicit.
- Narrow rows keep the result/state tail and shorten the optional target only at a useful semantic boundary. A target
  fragment is omitted instead of ending in an orphaned shell operator, one-letter Latin stub, or otherwise meaningless
  ellipsis such as `| s…`.
- `/tools` opens the recent-operation list in the shared full-width non-floating Command Dialog. Enter opens one
  bounded detail view and Esc returns without expanding the transcript. At low heights it preserves the selected
  operation or attached error and the Escape/back footer before allocating result lines.
- Pi's global `Ctrl+O` state does not expand Suite compact rows; use `/tools` to inspect one bounded result without
  expanding every prior operation.
- `/ui` contains the default-on **Tool running timer** setting alongside the Suite's other presentation settings. It
  controls whether long-running tools show live elapsed time; the former `/tool-settings` command is removed.
- Detail text is capped at 240 lines and 24 KiB. The model-visible tool result is never truncated or rewritten by
  this Capability.
- Consecutive successful exploration calls in one assistant batch share one **Explore** row with at most two Tool
  labels plus an overflow count. Reads, searches, listings, retrievals, and conservatively parsed read-only shell
  commands may opt in; writes, state changes, tests/builds, ambiguous or backgrounded shell, and every failed call
  stay standalone.
  Grouping is display-only: `/tools` retains every operation, session JSONL and model-visible results are unchanged,
  and the grouping is rebuilt after reload, restart/resume, tree navigation, and compaction.
- In-process `/resume` pre-binds exactly the active built-in renderers before Pi reconstructs history. The first resumed
  frame therefore stays compact without reviving disabled tools; the complete active Tool order is preserved, and new
  calls are rebound to the target session's working directory, trust, and project settings.

See `UPSTREAM.md` for the owned-fork provenance and local delta.
