# Subagents module

Current-session foreground and background Agents for Pi Stuff.

The Capability lets the main Pi Agent delegate isolated work and continue while background work runs. Background
completion adds one durable, compact TUI outcome without adding child reports to model context or starting another main
turn. In the full Suite, its Fleetview roster is the tail of Pi Stuff's shared Footer: it always follows both Statusline
rows and is therefore the bottommost visible region. Agent details open in Pi Stuff's shared full-width Command Dialog.

The public `subagent` Tool uses the internal Tool Display contract, so its running and terminal row follows the same
compact grammar as Host Tools. Full Agent inspection and control remains in `/agents`.

## Everyday behavior

- The public tool has three mutually exclusive call shapes: `agent` plus `task` for one launch, `tasks` for parallel
  work, or `action` for current-session control. It rejects mixed shapes instead of guessing which request to run.
- Launches are background by default. Omit `foreground` to continue immediately; set `foreground: true` when the
  findings must inform the current answer. The retired `background` field is not accepted.
- The settled Tool row names the operation that actually occurred: background launches say `launched`, foreground
  executions say `finished`, and resume, steer, stop, or status actions use their own acknowledged verbs. Starting
  background work is never mislabeled as completed.
- Each delegated item carries a short, caller-provided `description` for terminal surfaces and a separate full `task`
  for execution. Existing task-only callers remain compatible through a bounded local fallback; no extra model call is
  made to name legacy work.
- Independent tasks may run concurrently. The session-wide defaults are 20 running Agents, 200 total launches, and a
  maximum nesting depth of three.
- Each Agent has a stable identity, its own transcript, durable acknowledged steering, independent stop, and safe
  resume when its terminal state permits it. Steering recovery is deliberately at-least-once: if a child accepts input
  immediately before a crash prevents its acknowledgement from becoming durable, recovery may replay that request
  instead of silently declaring it delivered.
- Child Agents automatically reuse the exact standalone Pi Host that launched the session; no separate child-binary
  setting is required. Their extension surface is deterministic: ambient discovery is disabled, the owning Pi Stuff
  Package is loaded explicitly, Agent-specific extensions remain opt-in, and the final
  provider-payload guard always runs last.
- A fork clones the native Pi branch only when the complete child launch fits the selected model. Long, multilingual,
  or high-entropy sessions otherwise receive one bounded snapshot projection; the check includes the child task,
  inherited prompt, replacement-prompt context retained by Pi, selected Tool schemas, and conservative reserves for
  child-only extensions. Skill-enabled children always receive and verify the `read` Tool. Each child also checks the
  serialized provider payload after its context, Skills, Tools, and explicit child extensions are assembled; an
  oversized request retries an eligible larger fallback, or stops locally with a durable diagnostic instead of
  surfacing as an unexplained Agent crash.
- Background completion renders a compact `Agent finished/failed/stopped · … · inspect with /agents` session entry.
  The entry survives resume, is excluded from model context, and never triggers an unsolicited main-model turn. Full
  direct and nested reports remain available in `/agents`.
- Foreground work returns bounded direct-child reports through the active Tool call so the main Agent can synthesize
  them once in the current answer.
- The Agent detail transcript associates each child Tool call with its persisted call identity and renders a compact
  `● Tool … · outcome` row beside that Tool's bounded result. Mixed or out-of-order results remain attributable;
  identity-free legacy records are paired only when ownership is unambiguous.
- A user-attributed background Agent completion asks the UI Capability to refresh its bounded Git snapshot. Direct
  user steering permanently promotes an automatically launched Agent to user-attributed work, including after reload;
  otherwise automatic Extension work does not request a refresh. The Agents Capability does not render or own the
  Statusline.
- Per-Agent Git worktree isolation is optional. Changed or uncertain worktrees are preserved; only clean worktrees may
  be removed automatically.
- Suite-owned Agent input, output, metadata, and transcript artifacts live beside the persisted Pi session under Pi's
  Settings-owned session root by default. Ordinary read-only delegation therefore does not create `.pi-subagents` in
  the project. The engine retains an explicit project-directory policy for embedding compatibility, but Pi Stuff does
  not select it by default. Cleanup removes only old, terminal-proven owned groups; active evidence is retained.
  Durable kernel claims, incrementally persisted directory snapshots, identity-bound cursors, and orphan sweeping make
  interrupted or concurrent maintenance safe. Scan and snapshot-processing budgets are independently bounded, fair
  per-directory quotas advance later sessions, and temp artifacts receive an independent pass.

Fleetview reserves one help row above `main`. The row is exactly blank while idle. With an empty editor, press Down to
enter management and replace that same row with `↑/↓ select · Enter view · x stop · Esc return`; at 64 columns and below
it becomes `↑/↓ select · Enter · x stop · Esc`. Use Up or Down to select an Agent, Enter to inspect it, `x` to stop or
dismiss the selected row, and Escape to return. The `/agents` command opens the full current-session view. The
Capability creates no statusline, divider, permanent management hint, floating window, or extra gap between Statusline
and Fleetview.

The below-editor roster keeps terminal rows for 30 seconds, then hides them automatically. Live rows never expire and
`x` may dismiss a terminal row early. Hiding a row from the roster does not remove its bounded Task preview, result, or
transcript from `/agents`. Normal completion uses the semantic marker color and elapsed time without a redundant `done` label;
exceptional states remain explicit. At narrow widths, an unreadable description is omitted as a unit instead of being
joined to the state as an ellipsis fragment.

The Agent Command Dialog uses the Suite's divider and two-cell gutter, with `›` marking the focused custom row.
Action hints wrap instead of dropping the close or back key: Escape closes the Agent list and returns one level from
details or a steer/resume composer. At low terminal heights, the selected Agent or attached error and that Escape path
take priority over surrounding transcript rows.

## Scope

This module owns ordinary subagents inside the current Pi session. It does not provide a cross-session Fleet or
Agent Teams, saved chains, scheduled work, a workflow language, memory, sharing, a private settings surface, a
statusline, watchdog review, LSP integration, or another TUI shell.

See [UPSTREAM.md](./UPSTREAM.md) for the absorbed source snapshot and archive identities.
