---
status: accepted
supersedes: 0010-fold-continuous-retrieval-segments
---

# Restrict compact folding to native retrieval

## Context

ADR 0010 folds continuous retrieval and also permits conservatively classified read-only Bash, future metadata-opted
MCP Tools, and retrieval across visible Thinking. Real Claude Code 2.1.220 testing instead showed a narrower default
shape for ordinary Tools: Read/Search/List fold, while Bash, edits, Web, and Agents remain independent. Claude also
folds across Thinking and some direct MCP calls, but those choices conflict with Pi Stuff's desired visible reasoning
boundaries and its inability to prove a gateway MCP invocation harmless at the display seam.

The former name **Tool Activity Group** also suggests that arbitrary Tool activity may be combined. The intended
product rule is narrower: compact only repetitive native inspection while preserving the identity of every other Tool
family.

## Decision

Use **Tool Activity** for the display projection of either one independent invocation or one folded aggregate. Call
the aggregate a **Retrieval Group**.

Only native Read, Grep/Find, and List invocations join a Retrieval Group. The eligibility set is closed: Bash remains
independent even when read-only, and MCP, Web, Image, Agent, Task, edit/write/patch, Background Work, Goal, media,
unknown, and third-party Tools cannot opt in through presentation metadata. One eligible invocation is sufficient to
form a group.

Assistant prose, user input, visible model-context Custom Messages, independent Tool Activities, turn completion, and
automatic continuation close the current Retrieval Group. A newly visible **Logical Thinking Run** after Tool activity
also closes it; streaming updates within the same run do not. This deliberately differs from Claude Code, which was
observed folding retrieval across multiple detailed Thinking runs.

Failed, rejected, and cancelled native retrieval remains in its group. The compact summary exposes the issue count and
first bounded reason, while Ctrl+O restores the owning invocation. Silent infrastructure calls such as `tool_search`
and `ctx_reduce` remain transparent to continuity and recoverable in details when successful. An infrastructure issue
becomes an independent Tool Activity and closes retrieval on both sides.

Successful Task calls remain absent from the default Transcript because Todo owns their visible state. Ctrl+O and
`/tools` retain the individual calls. A Task error, rejection, or cancellation becomes an independent Tool Activity.
A successful text-only Code Mode execution with no nested Tool or media row is absent from both the Conversation
Transcript and ordinary `/tools`; its Session, ledger, and model-visible result stay unchanged. Standalone media from
Code Mode remains Host-rendered without a textual Code Mode row. Nested Tools and media remain their own visible
authority, and an otherwise unrepresented outer error, rejection, or cancellation retains one Envelope Fallback Row.

Standalone Tool renderers keep their existing Tool-specific shapes. Pi Stuff will not introduce the considered
universal Claude-style two-line `Tool(args)` plus child-status block.

### Compact Retrieval Group projection

A settled successful Retrieval Group occupies exactly one physical terminal row. Its semantic clauses use the fixed
order Search, Read, then List. Read counts unique canonical paths; Search and List count invocations. The row keeps the
existing small Transcript marker and displays `(ctrl+o to expand)` only when it fits without wrapping. At narrower
widths the expansion hint disappears before the semantic summary is truncated.

An active group uses present tense and may append the latest bounded target on the same row after the existing 700 ms
hold. It also occupies exactly one physical row and omits the expansion hint. When the Tool running timer is enabled,
elapsed time appears inline after its existing threshold. Width priority is semantic summary, explicitly enabled
elapsed time, then target; optional fields disappear before the row can wrap. Target and elapsed time are absent after
settlement.

A group with retrieval issues is the only two-row exception: the first row keeps the semantic clauses plus
state-specific issue counts, and one child row shows the first bounded reason. Issue state and reason survive before
retrieval counts at narrow widths; expansion hints, target, elapsed time, and then semantic clauses yield first. All
remaining reasons stay available through Ctrl+O.

### Output ownership and inspection

Code Mode output keeps one visible authority. Standalone media remains Host-rendered without a Code Mode row;
accompanying text remains model-visible for the Assistant to explain. A visible Custom Message produced by notification
keeps its existing surface and creates the ordinary Narrative Boundary. Pi Stuff does not add a media-caption
projection. An error, rejection, or cancellation uses one Envelope Fallback Row only when no nested Tool or media
activity already owns that outcome.

A successful isolated infrastructure call remains absent from the compact Transcript but is recoverable through both
Ctrl+O and `/tools`. Ctrl+O remains the global detailed Transcript: it restores Retrieval Group members, successful
Task and infrastructure calls, and existing Tool-specific renderers in original source order alongside Logical
Thinking Runs. It does not restore a deliberately hidden successful pure-JavaScript Code Mode envelope or replace
formatted details with protocol dumps.

`/tools` keeps Tool Activity as its first-level unit. A Retrieval Group opens its ordered `Calls` members; independent
Web, Bash, edit, media, Agent, Task-issue, and infrastructure-issue activities remain singleton entries. Successful
Task and isolated infrastructure calls remain inspectable there even when compact-silent. Successful pure-JavaScript
Code Mode envelopes remain absent.

### Projection lifecycle

The new projection is rebuilt from existing Session events during live updates, load, resume, branch navigation, and
compaction. It applies to old and new Sessions without rewriting JSONL or persisting a projection version. It directly
replaces ADR 0010 behavior with no feature flag, `/ui` setting, per-Session compatibility mode, or second grouping
implementation.

## Consequences

- Compact grouping is predictable from the native Tool family alone; command parsing and MCP metadata cannot change a
  Transcript's grouping.
- Bash, Web, MCP, media, consequential work, and delegated execution retain independent identity and causality.
- A new visible reasoning phase separates inspection before and after it, even though Claude Code does not make that
  split.
- Successful retrieval remains one row at every width; only an actionable issue may add one bounded child row.
- Settled history is not reopened by Goal, Context, or another automatic continuation.
- Live rendering, replay, Ctrl+O, and `/tools` must derive the same Tool Activities without changing Session records or
  model-visible Tool results.
- Existing Sessions adopt the new derived projection on their next render; no migration or compatibility state is
  introduced.
