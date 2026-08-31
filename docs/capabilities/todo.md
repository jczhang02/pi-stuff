# Todo

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/todo.md)

Todo gives the Agent a Session-scale checklist with dependencies, status transitions, and a compact view above the
editor.

## Quick start

The Agent uses four Tools:

1. `TaskCreate` to define concrete work;
2. `TaskUpdate` to mark the current item `in_progress` and add dependencies;
3. `TaskList` or `TaskGet` to inspect current state;
4. `TaskUpdate` to complete an item after verification.

Press `Ctrl+Shift+T` to collapse or expand the checklist when it is visible.

## Tool reference

| Tool | Required fields | Optional fields |
| --- | --- | --- |
| `TaskCreate` | `subject`, `description` | `activeForm`, `metadata` |
| `TaskGet` | `taskId` | — |
| `TaskList` | — | — |
| `TaskUpdate` | `taskId` | `subject`, `description`, `activeForm`, `status`, `addBlockedBy`, `addBlocks`, `owner`, `metadata` |

`TaskCreate` rejects blank subjects or descriptions, allocates a monotonic string ID, and starts the task as
`pending`. `TaskUpdate` patches only supplied fields; metadata keys set to `null` are removed.

`TaskGet` returns the complete current record. `TaskList` returns all non-deleted tasks with status, subject, owner, and
unresolved blockers.

## Status transitions

Supported statuses are `pending`, `in_progress`, `completed`, and `deleted`.

- Pending and in-progress tasks can move between each other, complete, or delete.
- Completed tasks can reopen.
- Deleted tasks are terminal and no longer appear in Get or List results.

An update that makes no change succeeds as an idempotent no-op.

## Dependencies

`addBlockedBy` and `addBlocks` add dependency edges. An update rejects unknown, deleted, self-referential, or cyclic
dependencies atomically, leaving the existing checklist unchanged.

Task List marks unresolved blockers. Completing a blocker makes its dependents runnable without rewriting their
records.

## Checklist

The checklist appears above the editor only while work exists. It displays at most five task rows plus an overflow
summary, ordered by:

1. recent completions;
2. in-progress tasks;
3. runnable pending tasks;
4. blocked pending tasks;
5. older completions.

In-progress rows use the sanitized one-line `activeForm` when present, otherwise the subject. Pending uses `□`, active
uses `■`, and completed uses `✓`; the state word and layout remain readable across themes.

After all tasks complete, the checklist lingers for five seconds and then clears. Collapsing changes only the visible
overlay, not task state.

## Session state

Todo state belongs to the current Session branch. Versioned Tool snapshots rebuild it on Session start, compaction, and
tree navigation. IDs remain monotonic after replay.

Session shutdown evicts the in-process copy. The Pi Session transcript remains the replay source; no separate task
database is required.

Compact successful Tool calls rely on the checklist for immediate feedback. Expanded Tool Activity and errors remain
available through `Ctrl+O` and `/tools`.

## See also

- [Todo Module README](../../packages/pi-stuff/src/todo/README.md)
- [Tool Display](tool-display.md)
- [Agents](subagents.md)
- [Shared UI contract](../../DESIGN.md)

