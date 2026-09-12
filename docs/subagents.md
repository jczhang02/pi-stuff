# Subagents

[简体中文](i18n/zh-CN/subagents.md)

Pi Stuff includes an observable subagent fleet for delegating development work
from a normal Pi session. The production entrypoint is `src/pi/index.ts`; it
installs the runtime in `src/subagent/`, registers the parent tools, and adds
the Fleet view to Pi's TUI.

## Load the production entrypoint

Use a normal Pi process with the reviewed extension source. From the checkout,
install the pinned dependencies and load `src/pi/index.ts`:

```bash
bun install --frozen-lockfile --ignore-scripts
pi -e /absolute/path/to/pi-stuff/src/pi/index.ts
```

Replace the absolute path with the checkout. This guide targets Linux,
Bun-compiled Pi `0.85.1`, and Bun `1.4.0`. Load only one extension that
registers the same tool names.

## Delegate work from the parent session

The parent model calls the `subagent` tool in its own conversation. The call
returns immediately by default; child completion, questions, and explicit
notifications wake the parent through hidden messages. Those messages use the
follow-up delivery path internally, but `display: false` keeps them out of the
visible Follow-up queue. Set `autoAwait` when the parent needs to wait inside
the same tool call; it waits for at most 60 seconds and returns early when a
child asks a question. Ordinary delegation should let the parent continue
working.

The three dispatch forms are mutually exclusive:

```json
{
  "agent": "reviewer",
  "task": "Review the cancellation path and report concrete findings.",
  "write": false
}
```

```json
{
  "tasks": [
    {
      "id": "inspect",
      "agent": "inspector",
      "task": "Inspect the runtime entrypoints and summarize the call flow."
    },
    {
      "id": "tests",
      "agent": "tester",
      "task": "Design focused checks after reading the inspector's output.",
      "needs": ["inspect"]
    }
  ],
  "concurrency": 2
}
```

```json
{
  "chain": [
    {
      "id": "plan",
      "agent": "planner",
      "task": "Outline the smallest safe implementation."
    },
    {
      "id": "apply",
      "agent": "implementer",
      "task": "Implement the plan below, then report what remains: {previous}",
      "write": true
    }
  ]
}
```

Single mode takes `agent` and `task`. `tasks` starts a parallel batch and may
use `needs` edges. `chain` makes each item wait for the previous item and
replaces `{previous}` with that item's output. For any dependency graph, the
upstream output is also prepended to the dependent prompt. A failed upstream
task aborts tasks that depend on it. Passing output text between tasks does not
share files from one task's worktree with another task.

Each task can set its own `prompt`, `model`, `thinking`, `cwd`, `tools`,
`write`, and `maxRuntimeMs` in a batch. A single task can set those fields at
the top level. `concurrency` defaults to 3 and is limited to 8. A task's
default runtime limit is one hour; the accepted range is 10 ms through six
hours. The parent may set `notifyPerTask` to `false` to receive one run-level
completion notice instead of one notice per task.

The inspection and control tools are:

| Tool              | Use                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `subagent_status` | Read live state, activity, usage, and session/worktree paths without waiting.                        |
| `subagent_result` | Read a run summary or one task's final text and diagnostics.                                         |
| `await_subagent`  | Wait up to 60 seconds for completion or a child message. Cancellation stops the wait, not the child. |
| `reply_subagent`  | Answer one pending `ask_parent` question by `runId` and `taskId`.                                    |
| `steer_subagent`  | Send a message to one streaming child or all streaming children in a run.                            |
| `resume_subagent` | Continue a completed, failed, or aborted child in its saved conversation.                            |
| `subagent_cancel` | Stop one task, or every nonterminal task in a run when `taskId` is omitted.                          |

Completed edits remain available for review after cancellation. A continuation
does not restart sibling tasks and bypasses the dependency gate for the
selected task while retaining the graph in the run record. A task that never
opened a session is retried with a new session; a saved task continues in its
existing conversation. The optional `model` on `resume_subagent` changes only
that child.

## Use the Fleet in Pi

The parent editor remains the parent editor. While there are no child tasks,
Pi's built-in footer stays in place. When the first child task appears, Pi
Stuff takes over one footer and renders the public parent status fields first,
with the Fleet directly below them. Every row uses the same columns for name
and current activity; child rows also show input/output tokens and elapsed
time. The main session has an explicit `main` row; there is no current-agent
asterisk. Selecting a row changes its highlight only.

When the parent editor is empty, press Down to focus the Fleet (the current
handler also accepts Left). Use the configured Up and Down selection keys to
move through the `main` and child rows.
Enter opens the selected child, or returns to the main editor when `main` is
selected. Press `x` while a child row is selected to request cancellation. Esc
leaves Fleet focus and returns to the input. `/subagents` and
`Ctrl+Shift+A` open the first available child conversation.

The child viewer keeps the selected child visible while siblings continue in
the background. It uses Pi's native user, assistant, tool, compaction-summary,
and branch-summary components for the complete saved conversation. `Ctrl+O`
toggles expanded tool details, and Page Up/Page Down scroll the transcript.
`Ctrl+C` returns to the main editor.
Esc cancels an active child (or an active compaction); once the child is
terminal, Esc closes the viewer and returns to the main editor.

Text entered in a child viewer is routed by the selected child's state:

- `awaiting_parent`: it is a targeted reply to the pending `ask_parent` call.
- `running` or `starting`: it is targeted steering. The runtime accepts it
  only while the child session is streaming; otherwise the input is retained
  for another attempt.
- `completed`, `failed`, or `aborted`: it starts a targeted continuation with
  `resume_subagent` semantics.

The viewer recognizes `/help`, `/stats`, and `/compact`. `/help` shows the
child controls. `/stats` shows message-role counts for that child; the footer
and Fleet counters show usage. `/compact` runs only when the child is not
streaming, compacting, or submitting, and leaves the conversation available
for browsing afterward.

The editor border labels the input target (`main` or the child name and task),
and a blank child editor uses a `Message @agent…` placeholder. This makes the
recipient visible without replacing the parent session or changing Pi's
normal editor bindings.

## Read the counters and icons

The counters are accumulated from real Pi session entries and SDK events. The
parent statusline displays the parent session's input, output, cache-read,
cache-write, cost, context usage, and model. Each child accumulates its usage
fields across its session and any later continuations. Child Fleet rows
display input (including cache reads and writes), output, and elapsed time;
the main Fleet row displays only its name and activity. Expanded run results
also include tool calls, turns, and cost. These are cumulative values, not
estimated progress bars.

Fleet status and navigation glyphs use Nerd Font / Font Awesome code points.
The semantic mapping is:

| Glyph role       | Code point | Meaning                              |
| ---------------- | ---------- | ------------------------------------ |
| Selection arrow  | `U+F105`   | Current Fleet selection.             |
| Main circle      | `U+F111`   | The parent `main` row.               |
| Clock            | `U+F017`   | Queued task.                         |
| Spinner          | `U+F110`   | Task is starting.                    |
| Hollow circle    | `U+F10C`   | Task is running.                     |
| Question mark    | `U+F059`   | Task is waiting for a parent answer. |
| Check mark       | `U+F00C`   | Completed task.                      |
| Exclamation mark | `U+F06A`   | Failed task.                         |
| Stop square      | `U+F04D`   | Aborted or canceled task.            |
| Up arrow         | `U+F062`   | Input-token count.                   |
| Down arrow       | `U+F063`   | Output-token count.                  |

The exact glyphs are kept in `src/subagent/ui/rows.ts`. A compatible Nerd Font
is required to display these private-use glyphs correctly.

## Understand isolation and child capabilities

Children are independent Pi SDK sessions. The manager never calls Pi's
`switchSession` for the parent, so opening a child does not replace the main
conversation. Sibling tasks keep their own execution, history, draft, tool
output, and session file while another child is being viewed.

By default a child receives `read`, `grep`, `find`, and `ls`, plus the bounded
communication tools `ask_parent`, `notify_parent`, `send_agent_message`, and
`poll_agent_messages`. `write: true` selects the write toolset when no explicit
allowlist is supplied. An explicit allowlist controls the actual tools; an
allowlist containing `bash`, `edit`, or `write` also makes the task
write-capable and triggers worktree isolation. Child resource loading sets
`noExtensions`, `noSkills`, `noPromptTemplates`, and `noThemes`, so a child
does not recursively load Pi Stuff or other extensions. A child also cannot
invent extra tools outside the allowed toolset and the communication tools.

The read-only setting is a tool policy, not a security sandbox. Child
processes still run under the user's account and host permissions. Treat
prompts, child output, and repository content as data to review. Give a child
write access only when the task needs it.

Write-capable tasks require a Git repository with a commit. Pi Stuff creates a
branch named `subagents/<run-id>/<task-id>` and a worktree at
`<git-common-dir>/subagents/<run-id>/<task-id>`, based on the parent repository
`HEAD`. The parent's uncommitted changes are not copied into that starting
point. If the task's `cwd` is a project subdirectory, the child keeps the same
relative subdirectory inside its worktree. The branch, worktree, uncommitted
changes, and untracked files are retained for review. Pi Stuff does not
automatically commit, merge, or remove them. A task that cannot create or
restore its isolated worktree fails closed; it does not fall back to writing in
the parent checkout.

Child communication is bounded and explicit. `ask_parent` waits for a reply,
cancellation, or a ten-minute timeout. `notify_parent` sends a short
nonblocking notice. `send_agent_message` targets a sibling task id or `leader`
for the parent; `poll_agent_messages` reads and clears a sibling mailbox. A
mailbox holds at most 32 messages and each message is limited to 4,000
characters.

## Persistence, reload, and limits

Run metadata is stored beside the parent session file as
`<parent-session-file>.pi-stuff-subagents.json`. Writes use a temporary file,
mode `0600`, and an atomic rename. Child conversation files live below the
parent session's `pi-stuff-subagents/` directory. On reload, nonterminal tasks
are normalized to `aborted` with an interruption error; the runtime does not
pretend that an in-flight process survived a Pi restart. Saved terminal child
sessions can be opened and continued after restoration.

This runtime reads its own validated sidecar schema. It is not compatible with
the older Arhen sidecar format. Keep the sidecar with its parent session and
do not rename an Arhen sidecar into the Pi Stuff filename expecting migration.
Malformed or unsafe sidecars are rejected and reported without being executed.

The current hard limits are:

| Limit                          | Value                                           |
| ------------------------------ | ----------------------------------------------- |
| Retained runs per parent       | 50                                              |
| Tasks in one run               | 16                                              |
| Parallel concurrency           | 1–8, default 3                                  |
| Default task runtime           | 1 hour                                          |
| Maximum task runtime           | 6 hours                                         |
| Parent wait (`await_subagent`) | At most 60 seconds per call                     |
| Pending parent question        | At most one per child, with a 10-minute timeout |

Session shutdown cancels the manager's active executions, aborts child shell
work owned by those sessions, disposes the child sessions, and flushes the
sidecar. Cancellation does not undo edits already made in a retained
worktree.

## Footer compatibility on Pi 0.85.1

The extension uses Pi's public `setFooter` API as one footer owner after a
child task exists; with no child tasks it leaves the built-in footer in place.
Its custom footer reconstructs the main fields that Pi normally
shows—working directory, branch and session name, usage/cache/cost, context
usage, model and reasoning level—from the public footer data and session APIs,
then places the Fleet rows below. The current model is read through Pi's
public `ctx.model` getter. It also reads public `setStatus` entries through the
footer data provider, so extension status text remains visible.

Pi `0.85.1` exposes no public getter for another extension's custom footer.
Two independent `setFooter` extensions therefore cannot both be preserved by
this integration. If another footer is required, one shared footer owner must
compose both features and call `setFooter` once.

## Source provenance

The runtime boundary, scheduling, communication, session, and worktree code is
forked from `@arhen/pi-core-subagent` `1.3.54`, source snapshot
[`de1c8783c2a39b1cbb0f86b412307193de9774c1`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent).
The retained upstream license and attribution are in
[`src/subagent/runtime/LICENSE.arhen`](../src/subagent/runtime/LICENSE.arhen).

The editor border-label idea was checked against
[`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff/tree/122e2994adddb113c04764c5697217dae120fcc6)
at commit `122e2994adddb113c04764c5697217dae120fcc6`. Only its public editor
API shape was used as a reference; its source was not copied.
