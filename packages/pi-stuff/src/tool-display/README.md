# Tool Display module

Compact, presentation-only Tool UI for the Pi Stuff Suite.

The Capability re-registers Pi 0.84.2's seven built-in tools with their original definitions and replaces only their
render slots. Tool schemas, prompt metadata, execution, result content, lifecycle events, and permission checks stay
unchanged. Every Suite-owned Tool must declare Activity metadata through `registerSuiteOwnedTool`; unknown third-party
Tools keep their native renderer and form a display boundary.

## Daily use

- Every continuous phase of controlled non-Bash Tool work is represented by one **Tool Activity Group**. The group
  begins with its first Tool and can span Assistant Tool round-trips and visible Thinking. Assistant prose, user input,
  visible model-context Custom Messages, and Bash calls close it.
- Every Bash call is one standalone `Bash(<command>)` operation block in native order with a bounded `⎿` child preview.
  Multiple calls remain separate; shell composition inside one call remains one block. The command title follows
  Claude Code's two-line/160-code-unit cap. Output shows three lines and then `… +N lines (ctrl+o to expand)`; an active
  call without output shows `Running…`, while a settled empty result shows `(No output)`. Streaming output, stderr,
  exit status, cancellation, rejection, and failure remain explicit. `Ctrl+O` retains the operation block and expands
  its bounded command and output in place, without Pi's generic `Call` / `Result` chrome. Apart from Pi Stuff's accepted
  small transcript bullet and semantic colors supplied by the active Host theme, the operation wording, row count,
  spacing, and child hierarchy are matched against real Claude Code 2.1.220 and Pi Host 0.84.2 captures.
- A group appears immediately, even for one Tool. Running summaries use present-tense semantic language and one short,
  width-safe target hint; settled summaries use past tense and remove raw commands, paths, result text, elapsed time,
  and redundant `done` labels. Files and other domain objects are deduplicated while executions are counted.
- All controlled non-Bash Tool kinds participate: reads and searches, file changes, MCP calls, Agents, Tasks, Goals,
  background handoffs, and failures. Pure infrastructure operations may stay silent when successful. Errors,
  permission rejection, and cancellation remain folded but are called out with counts and the first issue summary.
- The compact transcript hides Tool arguments and textual results. Real media remains visible. Pi's global `Ctrl+O`
  restores every controlled non-Bash Tool row in native transcript order and expands standalone Bash blocks in place;
  `/tools [group-or-member-id]` opens one Activity Group and paginates its complete member list with bounded per-member
  detail.
- `/ui` contains the default-on **Tool running timer** setting. It controls whether long-running standalone/expanded
  Tool rows show live elapsed time. Activity Group completion summaries never retain elapsed time.
- Detail text is capped at 240 lines and 24 KiB. The model-visible Tool result is never truncated or rewritten by this
  Capability.
- Grouping is a deterministic display projection. Session JSONL, model-visible messages, active Tool membership, and
  execution behavior remain unchanged, and groups are rebuilt after reload, restart/resume, tree navigation, and
  compaction.
- In-process `/resume` pre-binds exactly the active built-in renderers before Pi reconstructs history. The first resumed
  frame therefore stays compact without reviving disabled tools; the complete active Tool order is preserved, and new
  calls are rebound to the target session's working directory, trust, and project settings.

## Performance verification

`bun run benchmark:tool-activity` reconstructs one 20,000-call cross-round-trip Activity Group, compares its median
runtime with the former adjacent-Exploration projection, verifies all members survive, and enforces both a 25 ms
maximum regression from that baseline and a conservative 250 ms absolute ceiling. It also measures 200 incremental
stream updates after that 20,000-call history under a 250 ms ceiling. Streaming updates replan only the current
Narrative Boundary tail, while timer frames reconcile only the affected group; neither path rescans the full Session.

See `UPSTREAM.md` for source provenance and the local delta. The accepted interaction contract is recorded in the
repository ADR `docs/adr/0002-group-complete-tool-activity-between-narrative-boundaries.md`.
