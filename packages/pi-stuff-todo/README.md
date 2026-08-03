# `@jczhang02/pi-stuff-todo`

A session-scale Todo capability for the Pi Stuff Suite.

The Package gives the Agent four incremental tools—`TaskCreate`, `TaskGet`, `TaskList`, and `TaskUpdate`—backed by one branch-replayable state authority. A bounded checklist appears above the editor only while current work exists.

## Behavior

- Stable string task IDs are never reused within a session authority.
- Dependencies are validated and committed atomically.
- State recovers after reload, compaction, and tree changes from the Pi transcript.
- The normal checklist has no heading and shows at most five tasks plus one overflow row.
- Completed work lingers briefly, then the widget disappears without deleting state.
- No floating window, statusline, project backlog, or separate task database is added.
- Successful Task tool calls stay silent in the transcript because the checklist already shows their effect; errors
  use the shared Tool row, and every operation remains inspectable through `/tools` in the full Suite.

The full Suite installs this Capability through `@jczhang02/pi-stuff`. See [UPSTREAM.md](./UPSTREAM.md) for fork provenance and the maintained local delta.
