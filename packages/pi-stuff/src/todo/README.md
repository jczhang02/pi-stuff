# Todo module

A session-scale Todo capability for the Pi Stuff Suite.

The module gives the Agent four incremental Tools—`TaskCreate`, `TaskGet`, `TaskList`, and `TaskUpdate`—backed by one branch-replayable state authority. A bounded checklist appears above the editor only while current work exists.

## Behavior

- Stable string task IDs are never reused within a session authority.
- Dependencies are validated and committed atomically.
- State recovers after reload, compaction, and tree changes from the Pi transcript.
- The normal checklist gives only its `N tasks (D done, O open)` summary the shared one-cell Transcript activity padding;
  at most five task rows plus one overflow row keep their existing two-cell secondary indent.
- An `in_progress` row and collapsed `Next:` row use sanitized non-empty `activeForm`, falling back to `subject`.
  Pending, blocked, completed, and deleted presentation always retains `subject` semantics.
- Runnable pending work uses a muted `□`; blocked pending work keeps the same `□` shape in the warning color, so the distinction survives
  both dark and light themes without depending on faint text alone. Completed work remains deliberately dim.
- Completed work lingers briefly, then the widget disappears without deleting state.
- No floating window, statusline, project backlog, or separate task database is added.
- Successful Task tool calls stay silent in Compact because the checklist already shows their effect. Expanded keeps
  the Tool Activity summary once plus any additional result evidence; errors use the shared Tool row, and every
  operation remains inspectable through `/tools` in the full Suite.

The single Pi Stuff Package installs this module. See [UPSTREAM.md](./UPSTREAM.md) for source provenance and the maintained local delta.
