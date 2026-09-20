# Subagents

[简体中文](i18n/zh-CN/subagents.md) · English is normative.

Pi Stuff exposes one `subagent` tool for delegated work and `/agents` for human inspection. The accepted product scope is recorded in [#64](https://github.com/jczhang02/pi-stuff/issues/64); implementation and acceptance evidence are tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97). This is development source, not a published package release.

## Start a delegation

Load the checkout through Pi's `-e /absolute/path/to/pi-stuff` option. Keep `subagent` in the host's active tool selection; when using `--tools`, include it explicitly. The parent also needs every tool it intends to grant a child.

Ask the main agent to delegate work, or use these arguments for its `subagent` call:

```json
{
  "command": "dispatch",
  "tasks": [
    {
      "key": "lifecycle",
      "name": "lifecycle",
      "prompt": "Trace cancellation and identify writes that can continue after cancellation."
    },
    {
      "key": "packages",
      "name": "packages",
      "prompt": "Compare the existing packages' cancellation behavior."
    },
    {
      "name": "reviewer",
      "prompt": "Compare both reports and identify unresolved risks.",
      "needs": ["lifecycle", "packages"]
    }
  ]
}
```

The first two agents can run together. The reviewer starts when both prerequisites have settled with an explicit fulfilled result and saved evidence. An unrelated slow agent does not impose a batch barrier. Returned `agentId`, `taskId` and `dispatchId` values identify actual records; names and local `key` values are not management identities.

Each agent retains its identity, context and workspace. Each assignment has a separate task record. A follow-up to a completed reviewer therefore keeps its earlier report available:

```json
{
  "command": "followup",
  "agentId": "<returned agentId>",
  "text": "Recheck the revised cancellation design."
}
```

Use `recovery: true` for an agent whose abnormal result held its queue. Recovery creates a new record; it never rewrites the failed result or reruns its old consumers. `queue` with `queueAction: "continue"` or `"cancel"` explicitly resolves the remaining queue.

## Read and control work

| Command         | Purpose                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `inspect`       | Current or historical records, usage, pending notices and result previews.                                     |
| `wait`          | Bounded event-driven waiting. Expiry returns control without cancelling children.                              |
| `read`          | Page through a full `report`, `transcript` or fixed `diff`, using `offset` and `length`.                       |
| `message`       | Store ordinary information for a task. Receipt and model consumption are separate.                             |
| `steer`         | Correct active work at its next safe model boundary. An ended task rejects steering.                           |
| `ask` / `reply` | Associate a child's question with its direct parent and a reply. Late replies retain the original association. |
| `report`        | A child sends an interim finding without declaring completion.                                                 |
| `finish`        | A child declares `fulfilled` or `unable`, with a report and intended `files`/`checks`.                         |
| `cancel`        | Stop an owned task branch or a whole dispatch. Existing files and records remain.                              |
| `restrict`      | Narrow tools for an owned branch. Affected active tools must stop before settlement.                           |
| `accept`        | Record main-agent acceptance separately from the child's fulfillment claim.                                    |
| `release`       | Explicitly release an idle agent workspace after preservation checks.                                          |
| `roles`         | Discover available named roles.                                                                                |
| `acknowledge`   | Acknowledge a particular durable notice.                                                                       |

The exact argument contract is [protocol.ts](../src/subagent/protocol.ts). Target a returned task identity for communication and inspection. The main agent manages the whole tree; a child cannot cancel or steer an unrelated task. Messages may cross levels within the same dispatch. The main agent relays information between dispatches, or supplies saved fulfilled task IDs in a new assignment's `inputs`.

A normal final answer does not declare fulfillment. A parent must also join the assignments it owns and consume their outcomes. Execution ending, fulfillment, evidence being saved and main acceptance are distinct facts. A claimed fulfilled result may still fail review.

Cancellation follows current task ownership. Reusing an old descendant in a new main-owned assignment does not make the old parent its controller. Cancelling remains visible until active work actually stops; it does not undo external effects. Background tasks continue while the main agent answers or while an inspection page is closed.

## Inspect with a 60% keyboard

FleetView sits below the normal statusline. Main has no description. Child rows align name, description, state and metrics; normal execution has no redundant Running label. Selection changes the circle icon, without a full-row highlight. At most six child rows are shown, with offscreen activity and attention counts.

`/agents` opens the overview; `/agents fleet` focuses FleetView. The default inspection shortcut is `Ctrl+R`, subject to effective host/extension conflict detection. Remap it through `subagent.inspectShortcut` if Pi reports a conflict. The active shortcut preserves the main editor's draft, cursor and undo state, including while the main agent is busy.

| Context               | Keys                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| Browse                | `j/k`, Enter, `q` or Esc, `?` for local help.                             |
| Content tree or graph | `h/l` to collapse/expand or pan.                                          |
| Longer content        | `u/d` for half-page movement, `g/G` for first/last.                       |
| Available actions     | `a`, then select the named action.                                        |
| Full reader           | `/` search, `n/N` next/previous match, `f` explicitly follow live output. |
| Regions               | Tab.                                                                      |

Arrow keys are optional aliases. Text editors use native Pi editing and submission; browsing letters never trigger actions inside input. Back retains a targeted draft instead of sending it. A failed send leaves its draft and recipient visible. Stop requires confirmation.

Bottom inspection replaces the main editor, statusline and FleetView while leaving the main transcript above it. It is neither an overlay nor a switch of the host's active agent. Prompt appears before Progress. Details remain pinned to the opened assignment as new follow-ups arrive. Full reports, logs and diffs are reachable from the content tree.

Tab moves focus between the overview's structure and summary. Each region scrolls independently. Selection brings the chosen node or detail heading into view; manual panning remains until another selection or resize. Long Actions, Help and Stop previews use the same `u/d` and `g/G` controls. Stop's preview includes descendants admitted while it is open.

Configuration detail records the rules and available skills actually loaded for the assignment, admission limits and later tool restrictions. Per-task usage and dispatch aggregates are labelled separately; aggregates include each descendant and follow-up once and identify unmeasured tasks. A paused reader retains its current content and shows new activity until following is explicitly resumed.

In Detail, `/` opens the selected section in the full reader and searches it. Missing matches produce an explicit notice and preserve the current position. The reader header identifies the agent and section.

The overview uses a list for independent work and a graph for actual result dependencies. Ownership drilldown and saved-input references remain distinct from dependency arrows. This prevents a graph arrow from being mistaken for cancellation authority.

## Configuration and roles

User settings live in the Pi agent directory's `pi-stuff.json`. Project defaults and roles are discovered from the nearest ancestor containing `.pi/pi-stuff.json` or `.pi/agents`. Example:

```json
{
  "subagent": {
    "concurrency": 8,
    "tasksPerDispatch": 64,
    "maxDepth": 3,
    "resultWaitMs": 60000,
    "answerWaitMs": 600000,
    "inspectShortcut": "ctrl+r",
    "defaults": {"thinking": "medium"}
  }
}
```

These concurrency/count/depth values are trial defaults, not measured capacity recommendations. All dispatches in a main session share execution slots. A retained agent's follow-ups consume its original dispatch's cumulative allowance. Explicit waiting releases a slot only when the task's other execution is quiescent. No cumulative execution deadline applies unless `executionTimeoutMs` is configured. It excludes queue and explicit waiting time; Fleet elapsed time includes post-start waiting.

New assignments resolve values in call, explicit role, project, user, parent order, within the parent's current ceilings. Fresh context and a read-only Git snapshot are the defaults. Set `copyHistory: true` at initial dispatch to copy completed visible history and existing compaction summaries at a valid fork boundary. Subsequent parent messages are not copied automatically.

A role file is Markdown with frontmatter:

```markdown
---
name: reviewer
description: Review correctness and failure handling
tools: read, grep, find, ls, subagent
thinking: high
workspace: snapshot
---

Read the changed code and its tests. Report concrete failures with evidence.
```

Roles are read from the agent directory's `agents`, the project's `.pi/agents`, and configured `rolePaths`. Select an exact name through `role`; prompt words do not select roles. A follow-up uses saved configuration plus supported `overrides`. Editing a role file does not silently change retained work. Current tool restrictions still apply.

Models use `provider/model` syntax and the host's configured authentication. Child model registrations are separate; no credential values belong in task prompts. Built-in tools and the verified `pi-stuff:web` extension are supported. To grant Web tools, include `extensions: ["pi-stuff:web"]` and the desired tools, alongside `subagent`. Initialization creates a child-owned Web cache/lifetime, then exposure is filtered. Unsupported extensions fail explicitly; separate factories cannot guarantee arbitrary third-party global-state isolation.

## Code, persistence and recovery

| Workspace  | Behavior                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `snapshot` | Default read-only Git snapshot, including tracked dirty changes. Explicit `include` selects untracked inputs. |
| `write`    | Independent retained Git worktree with writer tools. Scoped declared files become fixed code artifacts.       |
| `live`     | Explicit read-only access to the current source, including a non-Git directory.                               |
| `direct`   | Explicit writing in the selected directory, including non-Git projects.                                       |

Isolation setup failure never falls back to the parent's directory. Source index and worktree remain unchanged during snapshot capture. A follow-up reuses its workspace unless an explicit baseline change is accepted. Consumers receive fixed commits, not moving branch tips. Multiple code inputs need an explicit integration baseline; applying artifacts to the main checkout remains a main-agent decision.

Records live under `<Pi agent directory>/pi-stuff/subagents/<parent session ID>/`, alongside child contexts, copied-history records and workspaces. A local executor owns writes. A second opener observes rather than starting duplicate work. After a crash, unresolved tasks require explicit recovery; saved work is not replayed. Missing or corrupt required context, code or executor evidence blocks continuation rather than silently substituting fresh state.

If an isolated worktree is missing but its saved commit and child context remain available, explicit continuation restores that saved baseline and records the restoration. It cannot recover unsaved files from a deleted directory and reports that gap. Missing saved commits or child context still block continuation.

Actual session departure stops and saves children first. Core save errors block successful departure and remain visible. Optional event-listener failures do not convert a fulfilled task to failed. The `pi-stuff:subagent` event carries the current revision and task records for observers.

Release refuses unsaved tracked, untracked or ignored content and active or queued assignments. For an ended assignment, it reserves the agent against new admission and waits for notification/session cleanup before checking and releasing the workspace. A save failure detected before deletion stops release. Failure to save the final release record is reported even if the workspace directory has already been removed; saved artifacts and context remain available. Keep partial work until it has been preserved. Linux process identities and tracked shell process groups provide cancellation/recovery evidence; tool allowlists and worktree paths are not an OS sandbox, and deliberately detached external daemons need external reconciliation.

Reverting the extension code does not migrate or erase these records. Stop the owning Pi session successfully and retain the record directory before changing implementation versions. Do not manually delete an executor lock to force a second writer.

## Implementation reference

The [implementation and acceptance record](subagents-implementation.md) maps the accepted features to regression sources, actual terminal captures and review boundaries.

The fork reference is [`@arhen/pi-core-subagent` 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). Its [MIT notice](../src/subagent/LICENSE.arhen), including the earlier fork attribution, is retained. Pi Stuff implements the accepted lifecycle, persistence and UI contract in `src/subagent`; the upstream UI is not used.

An isolated workspace keeps its Git root separate from the child's effective working directory. For a request from `api/` in a linked checkout, snapshot capture uses that checkout's dirty state and the child runs in the new worktree's `api/`. Declared artifact paths resolve from that effective directory. A child that has already committed its changes still produces a fixed artifact measured against the assignment's original baseline.
