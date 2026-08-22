# Subagents module

Current-session foreground and background Agents for Pi Stuff.

The Capability lets the main Pi Agent delegate isolated work and continue while background work runs. Background
completion adds one durable, compact TUI outcome without adding child reports to model context or starting another main
turn. In the full Suite, its Fleetview roster is the bottommost tail of Pi Stuff's shared Footer. While managing, its
controls replace the latest-Prompt row in place instead of moving the roster. Agent details open in Pi Stuff's shared
full-width Command Dialog.

The public `subagent` Tool uses the internal Tool Display contract, so its running and terminal row follows the same
compact grammar as Host Tools. Full Agent inspection and control remains in `/agents`.

Pi Stuff ships no Agent definitions. Launches select an Agent supplied by an installed Pi Package, the user's
`agents` directory, or the current project's `.pi/agents` directory. When names collide, project definitions override
user definitions, and user definitions override Package definitions.

## Everyday behavior

- The public tool has three mutually exclusive call shapes: `agent` plus `task` for one launch, `tasks` for parallel
  work, or `action` for current-session control. It rejects mixed shapes instead of guessing which request to run.
- Launches are background by default. Omit `foreground` to continue immediately; set `foreground: true` when the
  findings must inform the current answer. The retired `background` field is not accepted.
- Before each main Agent run, local discovery refreshes the public Tool contract with every selectable Agent's name,
  purpose, and effective Tool allowlist. Direct provider schemas and Code Mode therefore expose the same current roster;
  the model does not need to guess definition names or inspect Agent files. A launch's optional `cwd` changes where the
  child executes; Agent identity still resolves from this advertised parent-project roster.
- The settled Tool row names the operation that actually occurred: background launches say `launched`, foreground
  executions say `finished`, and resume, steer, stop, or status actions use their own acknowledged verbs. Starting
  background work is never mislabeled as completed.
- Each delegated item carries a short, caller-provided `description` for terminal surfaces and a separate full `task`
  for execution. Existing task-only callers remain compatible through a bounded local fallback; no extra model call is
  made to name legacy work.
- Independent tasks may run concurrently. The session-wide defaults are 20 running Agents, 200 total launches, and a
  maximum nesting depth of three.
- Current releases import proven history from an unlocked pre-v2 governor ledger but do not hold its crash-prone
  directory lock. Running pre-v2 and current Pi Stuff processes against the same Pi Session is unsupported; a present
  pre-v2 lock pauses new launches until the older process exits. A dead barrier written by the immediately preceding
  current release is reclaimed only from process-generation proof.
- `turnBudget`, `toolBudget`, and `timeoutMs` are optional per-Agent overrides. Ordinary launches use product backstops
  of 64 assistant turns plus two wrap-up turns, 96/128 soft/hard Tool calls with every Tool blocked after the hard
  limit, and 30 minutes. Task overrides win over launch overrides, which win over Agent definitions and the product
  defaults. Agents owns enforcement, stop, resume, and terminal state; Context Management does not impose a second
  aggregate limit.
- Each Agent has a stable identity, its own transcript, durable acknowledged steering, independent stop, and safe
  resume when its terminal state permits it. Steering recovery is deliberately at-least-once: if a child accepts input
  immediately before a crash prevents its acknowledgement from becoming durable, recovery may replay that request
  instead of silently declaring it delivered.
- Child Agents automatically reuse the exact standalone Pi Host that launched the session; no separate child-binary
  setting is required. Their extension surface is deterministic: ambient discovery is disabled, the owning Pi Stuff
  Package is loaded explicitly unless an inherited capability ceiling forbids extensions, Agent-specific extensions
  are additive (including an explicit empty list), and the final provider-payload guard always runs last even under
  that ceiling. A non-fanout child omits `subagent` from the Suite-required Tool inventory as well as its active Tool
  set, so initialization stays warning-free without granting nested-delegation authority.
- A fork clones the native Pi branch only when the complete child launch fits the selected model. Long, multilingual,
  or high-entropy sessions otherwise receive one bounded snapshot projection; the check includes the child task,
  inherited prompt, replacement-prompt context retained by Pi, selected Tool schemas, and conservative reserves for
  child-only extensions. During either fresh or fork execution, every continuation uses the same safe model-input
  budget. Before the final guard can stop a growing child, the runtime bounds old Tool results and assistant working
  text while preserving the delegated task, latest user steering, Tool call/result identity, and the most recent Tool
  batch. Extreme histories fall back to those protected authority and recent-evidence messages; the complete original
  transcript remains durable for inspection. Skill-enabled children always receive and verify the `read` Tool. Each
  child also checks the serialized provider payload after its context, Skills, Tools, and explicit child extensions
  are assembled; an oversized launch retries an eligible larger fallback, while an irreducible launch or continuation
  stops locally with a phase-specific durable diagnostic instead of surfacing as an unexplained Agent crash.
- Pi-legal hidden custom messages, including Magic Context housekeeping nudges, are accepted as bounded child
  transcript evidence. An observed ceiling nudge is also surfaced to the parent as one bounded lifecycle fact. Custom
  messages never become the Agent's final report; malformed or unsupported protocol envelopes still fail closed with
  a durable diagnostic.
- Background completion renders a compact `Agent finished/failed/stopped · … · inspect with /agents` session entry.
  The entry survives resume, is excluded from model context, and never triggers an unsolicited main-model turn. Full
  direct and nested reports remain available in `/agents`. Model-visible status for a failed direct child presents a
  bounded failure category and path-scrubbed terminal reason before any stale progress text.
- Foreground work returns bounded direct-child reports through the active Tool call so the main Agent can synthesize
  them once in the current answer. Long reports preserve both their opening evidence and conclusion, identify the
  omitted middle, and point to the durable output artifact for full model retrieval. Parallel projection divides the
  same bound across every child instead of dropping later results.
- The Agent detail transcript associates each child Tool call with its persisted call identity. It renders a compact
  lifecycle icon, operation, and target, keeps successful results collapsed until `t` is pressed, and leaves failure
  reasons visible. Mixed or out-of-order results remain attributable; identity-free legacy records are paired only
  when ownership is unambiguous.
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

Fleetview renders no rows without a child Agent and reserves no blank help row while idle. With an empty editor, press
Down to enter management: the contextual controls replace Footer row 2 when present, then restore the exact latest
Prompt on exit. `main` has no `x` action; a selected live child says `x stop`, and a terminal child says `x dismiss`.
At 64 columns and below the hint drops the `select`, `view`, and `return` words. Markers, controls, and overflow begin at
terminal cell 1; one space follows each marker, so Agent text begins at cell 3. Use Up or Down to select, Enter to
inspect, `x` to control the selected child, and Escape to return. The `/agents` command opens the full current-session
view. The Capability creates no statusline, divider, permanent management hint, floating window, or extra gap.

The below-editor roster keeps terminal rows for 30 seconds, then hides them automatically. Live rows never expire and
`x` may dismiss a terminal row early. Hiding a row from the roster does not remove its bounded Task preview, result, or
transcript from `/agents`. Only the selected marker uses accent; routine states and completion are muted, while waiting
and errors color only their explicit right-state text. At narrow widths, an unreadable description is omitted as a unit
instead of being joined to the state as an ellipsis fragment.

The Agent Command Dialog uses the Suite's divider and two-cell gutter, with `›` marking the focused custom row. It
remains single-column at every width: list and detail are sequential modes, and additional width belongs to the selected
Agent's Task, outcome, and Activity rather than a persistent roster pane. Action hints wrap instead of dropping the
close or back key: Escape closes the Agent list and returns one level from details or a steer/resume composer. At low
terminal heights, the selected Agent or attached error and that Escape path take priority over surrounding transcript
rows.

The accepted Agent Command Dialog redesign is recorded in the
[Agent activity UI reference](../../../../docs/research/agent-activity-ui-reference.md#f-accepted-agent-command-dialog-redesign).
It was implemented on 2026-08-18. `/agents` remains single-column at every width and keeps the Agent name as its primary
identity. Detail uses `◆ Task`, an optional outcome section, and `◆ Activity` without nested content indentation.
Agent messages and retained outcomes reuse Pi's Markdown component; Tool output remains literal terminal text.
Activity preserves relevant event order while bounding expanded Tool previews and reporting omitted lines. Lifecycle
icons, Pi-configured selection actions, Ctrl+P/Ctrl+N and `b`/Space read-only aliases, Home/End, contextual `?` help,
stable launch order, low-height priority, and the complete Escape/control paths are covered by focused tests and the
real PTY verifier.

## Scope

This module owns ordinary subagents inside the current Pi session. It does not provide a cross-session Fleet or
Agent Teams, saved chains, scheduled work, a workflow language, memory, sharing, a private settings surface, a
statusline, watchdog review, LSP integration, or another TUI shell.

See [UPSTREAM.md](./UPSTREAM.md) for the absorbed source snapshot and archive identities.
