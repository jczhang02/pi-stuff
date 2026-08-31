# Todo

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/todo/README.md)

A Session-scale Agent checklist with dependencies and a compact view above the editor.

## Quick start

The Agent creates and updates tasks with `TaskCreate`, `TaskGet`, `TaskList`, and `TaskUpdate`. Press
`Ctrl+Shift+T` to collapse or expand the visible checklist.

## Highlights

- Allocates stable monotonic task IDs in the current Session branch.
- Supports pending, in-progress, completed, reopened, and terminal deleted state.
- Rejects missing, self-referential, or cyclic dependencies atomically.
- Shows up to five ordered task rows plus overflow above the editor.
- Keeps active forms, owners, blockers, and metadata with each task.
- Rebuilds state on Session start, compaction, and tree navigation.

## Documentation

- [Todo guide](../../../../docs/capabilities/todo.md)
- [Tool Display guide](../../../../docs/capabilities/tool-display.md)
- [Agents guide](../../../../docs/capabilities/subagents.md)
- [Shared UI contract](../../../../DESIGN.md)
- [Upstream references](UPSTREAM.md)

