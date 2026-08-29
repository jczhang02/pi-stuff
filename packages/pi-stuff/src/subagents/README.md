# Subagents module

Current-session foreground and background Agents for Pi Stuff.

The Capability lets the main Pi Agent delegate isolated work and continue while background work runs. Background
completion adds one durable, compact TUI outcome without adding child reports to model context or starting another main
turn. In the full Suite, its Fleetview roster is the bottommost tail of Pi Stuff's shared Footer. While managing, its
controls replace the latest-Prompt row in place instead of moving the roster. Agent details open in Pi Stuff's shared
full-width Command Dialog.

The public `subagent` Tool uses the internal Tool Display contract, so its running and terminal row follows the same
compact grammar as Host Tools. Full Agent inspection and control remains in `/agents`.

`extension/index.ts` is the Host composition root. `extension/public-agent-execution.ts` owns the governed public
launch transaction, `extension/runtime-events.ts` owns current-Session event filtering and teardown, and
`extension/completion-handling.ts` owns durable completion delivery plus historical Session rendering.

Pi Stuff ships no Agent definitions. Launches select an Agent supplied by an installed Pi Package, the user's
`agents` directory, or the current project's `.pi/agents` directory. When names collide, project definitions override
user definitions, and user definitions override Package definitions.

The detached launch composition stays in `async-execution.ts`, with single/parallel runner projection in
`runner-work.ts` and model/Skill/Tool launch-contract resolution in `resolved-task.ts`. `subagent-runner.ts` remains
the child-process and terminal-lifecycle owner; `async-job-tracker.ts` owns live job state and Host event handling,
`async-job-observer.ts` owns file observation and control delivery, and `async-job-recovery.ts` owns compatibility and
restore scans. `fallback-session.ts` only freezes and restores a fork between eligible model attempts.
`shared/acceptance.ts` owns acceptance evidence; `nested-contract.ts`, `run-result.ts`,
`async-contract.ts`, and `process-terminal.ts` own their corresponding cross-process contracts;
`runs/shared/subagent-prompt-runtime.ts` owns child prompt/provider composition, while
`runs/shared/steering-inbox.ts` owns durable steering delivery and acknowledgement state;
`runs/shared/nested-registry.ts` owns nested route resolution, `nested-registry-store.ts` owns bounded registry reads
and caching, and `nested-registry-projection.ts` owns serialized event projection and route settlement;
`runtime/runtime-state.ts` owns in-memory foreground and Extension state. `shared/types.ts` retains common configuration
and the compatibility type facade. Within foreground execution, `executor-contract.ts` defines the private composition
contract. `launch-preparation.ts` owns one launch-admission transaction across inputs, budgets, fork-session selection,
and session-root/nested-route setup; `launch-model-planning.ts` owns model-capacity and projection admission;
`launch-builders.ts` maps the admitted plan to
the existing runner engines. `foreground-run-claim.ts`, `foreground-projection.ts`, and `foreground-lifecycle.ts`
separately own private directory proof, current/nested state projection, and execution settlement.
`runtime/session-governor.ts` owns Agent lifecycle operations plus the stable public facade;
`runtime/session-governor-spawn.ts` owns spawn admission and staging, while `runtime/session-governor-ledger.ts` owns
the lock, codec, and atomic ledger storage. `runtime/session-governor-contracts.ts` owns its durable contracts and
validation. `runtime/agent-runtime-event.ts` validates raw
lifecycle event values; `runtime/agent-runtime-liveness.ts` owns fail-closed process and writer-registry proof.
`shared/artifacts.ts` is the stable artifact facade; `shared/artifact-files.ts` owns paths, writers, and group claims,
`shared/artifact-snapshot.ts` owns bounded crash-resumable native directory scans, and
`shared/artifact-maintenance.ts` owns cleanup discovery and orchestration. Maintenance persists only directory identity
and cookies after successful slices on the certified Linux Host profile and fails closed without deleting artifacts elsewhere.
`intercom/native-supervisor-channel.ts` owns parent delivery orchestration and run lifecycle;
`intercom/native-supervisor-client.ts` owns child communication Tools and request orchestration, while
`intercom/native-supervisor-storage.ts` owns the validated filesystem protocol, delivery records, and channel GC mechanics.
`session/current-agents.ts` owns subscriptions, controls, overrides, and revisions;
`session/current-agents-projection.ts` merges durable and live sources into immutable rows, while
`session/current-agents-projection-normalization.ts` owns bounded raw-value and nested-status normalization.
`ui/agent-dialog.ts` owns interaction and async control/transcript generations; `ui/agent-dialog-renderer.ts` owns the
single-column `/agents` layout, terminal-width fitting, and scroll metrics.

## Everyday behavior

- Each public Tool call has one of three mutually exclusive shapes: `agent` plus `task` for one launch, `tasks` for a
  grouped parallel launch, or `action` for current-session control. It rejects mixed shapes instead of guessing which
  request to run. Pi's native parallel Tool calls are also supported: independent foreground calls emitted in one
  assistant response run concurrently as separate governed launches.
- Launches are background by default. Omit `foreground` to continue immediately; set `foreground: true` when the
  findings must inform the current answer. The retired `background` field is not accepted.
- Before each main Agent run, local discovery refreshes the public Tool contract with every selectable Agent's name,
  purpose, and effective Tool allowlist. Direct provider schemas and Code Mode therefore expose the same current roster;
  the model does not need to guess definition names or inspect Agent files. A launch's optional `cwd` changes where the
  child executes; Agent identity still resolves from this advertised parent-project roster. Agents with direct MCP
  Tools also fail launch preflight if their selectors are unresolved or the target `cwd` would change the advertised
  Tool names, so delegation never silently starts with a different external capability contract. An inherited
  capability ceiling may still explicitly deny every extension, including otherwise valid MCP Tools.
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
- Queued work that never launches records an explicit `pause`, `timeout`, or `stop` pre-start cause. Terminal
  projection uses that cause rather than matching error prose, so a real Agent failure keeps its original state and
  message even when the text happens to contain `before it started`.
- Each Agent has a stable identity, its own transcript, durable acknowledged steering, independent stop, and safe
  resume when its terminal state permits it. Steering recovery is deliberately at-least-once: if a child accepts input
  immediately before a crash prevents its acknowledgement from becoming durable, recovery may replay that request
  instead of silently declaring it delivered.
- Model-visible status exposes each Agent Target as separate `id=<run id>` and `index=<child index>` fields. Pass that
  pair to status, steer, stop, or resume; the roster row key remains internal. A legacy combined key is accepted only
  when it uniquely identifies a current row, while ambiguous or unknown keys act on nothing. The session governor
  keeps every active Target unique and rejects conflicting acquisition or rebinding.
- Child Agents automatically reuse the exact standalone Pi Host that launched the session; no separate child-binary
  setting is required. Their extension surface is deterministic: ambient discovery is disabled, the owning Pi Stuff
  Package is loaded explicitly unless an inherited capability ceiling forbids extensions, Agent-specific extensions
  are additive (including an explicit empty list), and the final provider-payload guard always runs last even under
  that ceiling. A non-fanout child omits `subagent` from the Suite-required Tool inventory as well as its active Tool
  set, so initialization stays warning-free without granting nested-delegation authority. Each launch also snapshots
  the parent's effective Ponytail Mode, including explicit `off`, into the child process environment; no Session or
  global setting is shared or mutated.
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
  bounded failure category and path-scrubbed terminal reason before any stale progress text. Legacy task-derived status
  labels shorten absolute POSIX and Windows path tokens while preserving URLs, relative paths, and slash-delimited prose.
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
  not select it by default. Optional final artifacts publish by atomic rename while holding the group write claim, so
  readers see either the previous complete file or the replacement. Cleanup removes only old, terminal-proven owned
  groups; active evidence is retained.
  Durable kernel claims, incrementally persisted directory snapshots, identity-bound cursors, and orphan sweeping make
  interrupted or concurrent maintenance safe. Scan and snapshot-processing budgets are independently bounded, fair
  per-directory quotas advance later sessions, and temp artifacts receive an independent pass. Undelivered background
  result notifications remain eligible for automatic Session delivery for 30 days. Existing Agent maintenance may
  retire an older inbox file only after its exact run and parent Session binding, terminal process proof, dead writer,
  and complete child Session history are all present; `/agents` history remains inspectable after the notification is
  retired. The same pass removes an old optional delivery-state remnant only when its result is already absent and the
  shared delivery claim is free. Candidate selection advances durably across bounded passes, so an uncertain retained
  result cannot starve later notifications.

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
and errors color only their explicit right-state text. The right side shows the child Agent's current Context percentage
before its lifecycle state when the selected model has known capacity and the Provider has reported usage. The child
Host reports its actual selected model capacity; parent-Host model metadata is only a launch-time fallback. Usage is the
current Provider payload plus bounded trailing-message estimates, not cumulative run tokens. A non-zero value below one
percent renders as `<1%`, while zero remains `0%`. The percentage is withheld during compaction, model fallback, and
unknown-capacity runs until a new authoritative usage record arrives. At narrow widths it is dropped before Agent
identity; an unreadable description is then omitted as a unit instead of being joined to the state as an ellipsis
fragment.

The Agent Command Dialog uses the Suite's divider and two-cell gutter, with `›` marking the focused custom row. It
remains single-column at every width: list and detail are sequential modes, and additional width belongs to the selected
Agent's Task, outcome, and Activity rather than a persistent roster pane. Action hints wrap instead of dropping the
close or back key: Escape closes the Agent list and returns one level from details or a steer/resume composer. At low
terminal heights, the selected Agent or attached error and that Escape path take priority over surrounding transcript
rows. An empty list keeps key-help and close hints but omits selection and detail hints until an Agent exists.

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
