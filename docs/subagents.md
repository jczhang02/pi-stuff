# Subagents

[简体中文](i18n/zh-CN/subagents.md). English is authoritative.

The development extension delegates work through one `subagent` tool. Independent investigations run in parallel; chains and explicit dependencies pass predecessor reports to later children. The runtime follows arhen's `pi-core-subagent` 1.3.55, with completed-child follow-up, request history and selected extension tools added under the [redevelopment specification](subagents-redevelopment-spec.md).

## Try the source

Install the pinned dependencies using [Contributing](../CONTRIBUTING.md#verify-changes). Start Pi in the project you want children to inspect, passing the absolute path to this checkout:

```bash
pi --no-extensions -e /absolute/path/to/pi-stuff
```

Use your configured model and credentials. A useful first prompt is:

```text
Use subagent to run two read-only investigations in parallel: one checks
cancellation, the other checks saved-session handling. Then have a reviewer
compare both reports using explicit dependencies. Run in the background.
```

Read-only children inspect the selected directory directly, including current files. They do not enumerate ignored dependencies or create a Git snapshot. A child with write tools requires a Git repository and runs in its own worktree. Parent uncommitted changes are not copied into it.

## Inspect and intervene

FleetView appears below the main statusline. At an editor edge, Up/Down enters it when Pi's editing, completion and history have not consumed the key. `/subagents` also opens the list. Selection changes only the circle. Local help appears while that region owns focus; the main row has no description.

| Surface              | Action                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Fleet                | Pi's selection keys move; confirm opens the selected child; `g` opens its dependency graph when it has dependencies. |
| Child detail         | `p` expands Prompt, `a` expands Activity, `t` opens Transcript, `i` opens Info.                                      |
| Working child        | `m` opens a targeted message editor; the exact instruction remains queued until native input consumes it.            |
| Pending question     | Confirm opens Reply for that question. A competing answer cannot retarget the draft.                                 |
| Completed child      | `m` opens Follow-up after the run has settled.                                                                       |
| Failed/stopped child | `m` opens Resume when the saved session and required code state are usable.                                          |
| Stop                 | `x` opens inline confirmation. Confirm requests cancellation; Esc dismisses it.                                      |
| Info                 | `h` opens request history; select an earlier request to inspect its report and metrics.                              |
| Readers              | `[` / `]` page. New output preserves the page being read; `f` follows the latest output.                             |
| Local editor         | Native editing, submit and newline bindings apply. Letters are text. Esc retains the draft without sending.          |
| Back                 | Esc returns to the previous surface, then Fleet, then the main editor with its draft restored.                       |

The displayed selection, confirmation and editor hints follow Pi's configured bindings. Feature letters are local to the inspector. No Alt+A, function keys or dedicated paging keys are required. Details replace the bottom editor/footer region while the main transcript remains above; this does not switch the host session.

## Results and configuration

The parent's tool commands are `dispatch`, `status`, `result`, `wait`, `reply`, `steer`, `resume`, `follow-up` and `cancel`. `status` returns a compact projection; `result` returns recorded evidence. Background completion notifies the parent. An active wait returns the result without a duplicate completion turn; a timed-out wait does not suppress later notification.

Dispatch accepts one agent, `tasks`, or a `chain`; task `needs` names dependency IDs. Batch `tools`, `write`, `prompt`, `model` and `thinking` belong on individual tasks. Defaults are read-only, background execution, concurrency 3 and per-task notifications. The limits are 16 tasks and concurrency 8. `/subagents auto-limit on|off` selects the upstream default runtime ceiling of 1 or 6 hours; a task may set an explicit limit.

Agent files supply role prompts and tool/model settings using upstream discovery rules. Pi's project `APPEND_SYSTEM.md`, or its global fallback, remains part of the child instructions. Selected parent extension sources load in the child; their callable tools are narrowed by the parent's active set and the role. Required-load failures and unsupported interactive child UI calls report errors. Children have `ask_parent`, `notify_parent`, `send_agent_message` and `poll_agent_messages`, with sibling addresses in the messaging tool description. They cannot recursively delegate.

Fleet and detail show the current request's elapsed time and output tokens. Info exposes recorded input/output/cache/cost/turns and cumulative child usage. Missing usage is unavailable. Each accepted resume or follow-up preserves the earlier request and continues the same saved context. It does not rerun dependents.

## Code and retained evidence

A completed model report does not prove that Git saved the changes. Detail and Info distinguish a commit, no changes, finalization in progress and preservation failure. Stopping lasts until execution and finalization finish. Failed preservation retains the workspace and error; successful preservation keeps the branch and permits worktree-directory cleanup. Review and integration remain separate actions.

With multiple write prerequisites, the dependent writer starts from the last eligible dependency branch. It receives all predecessor reports but does not merge all their branches. Shared `node_modules` is not a sandbox; child instructions prohibit modifying dependencies.

Native child sessions retain conversation evidence. New run metadata lives beside the parent session in `.pi-stuff-subagents.json`; records from the previous implementation are neither migrated nor deleted. Reload restores interrupted work as stopped, without executing it automatically. Local drafts survive navigation and resize within the host session, not a process restart.

See the [acceptance record](subagents-redevelopment-acceptance.md) for tested hosts, actual terminal captures and verification limits.
