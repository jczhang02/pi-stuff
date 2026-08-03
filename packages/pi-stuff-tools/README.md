# `@jczhang02/pi-stuff-tools`

Compact, presentation-only Tool UI for the Pi Stuff Suite.

The Capability re-registers Pi 0.83's seven built-in tools with their original definitions and replaces only their
render slots. Tool schemas, prompt metadata, execution, result content, lifecycle events, and permission checks stay
unchanged. Suite-owned tools can opt into the same renderer contract through `registerSuiteOwnedTool`.

## Daily use

- Running and settled operations occupy one compact semantic row.
- Success is quiet; errors, permission rejection, and cancellation remain explicit.
- `/tools` opens the recent-operation list in the shared full-width non-floating Command Dialog. Enter opens one
  bounded detail view and Esc returns without expanding the transcript.
- Pi's global `Ctrl+O` state does not expand Suite compact rows; use `/tools` to inspect one bounded result without
  expanding every prior operation.
- `/ui` contains the default-on **Tool running timer** setting alongside the Suite's other presentation settings. It
  controls whether long-running tools show live elapsed time; the former `/tool-settings` command is removed.
- Detail text is capped at 240 lines and 24 KiB. The model-visible tool result is never truncated or rewritten by
  this Capability.

Pi 0.83 does not expose a public adjacent-transcript transformation seam. Consequently, this release does not hide
or regroup historical rows and does not claim semantic cross-call density grouping. It favors a truthful compact row
per operation until such grouping can be implemented without hiding failures or consequential work.

See `UPSTREAM.md` for the owned-fork provenance and local delta.
