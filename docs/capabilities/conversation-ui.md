# Conversation UI

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/conversation-ui.md)

Conversation UI keeps Pi Stuff's current state readable inside Pi. It owns the Welcome header, responsive Statusline,
input presentation, live Thought projection, fenced visualizations, shared Command Dialog, and Suite diagnostics.

## Quick start

Start Pi, then run:

```text
/ui
```

The interactive settings list applies changes immediately and stores user changes in the `ui` or `tools` namespace of
`<agentDir>/pi-stuff.json`.

## UI settings

| Setting | Default | Effect |
| --- | --- | --- |
| Statusline | On | Shows the current model, workspace, Context, usage, and selected capability state |
| Statusline density | Auto | Switches between full and compact content as terminal width changes |
| Latest prompt | On | Shows one bounded line for the most recent submitted prompt |
| Welcome header | On | Shows the Suite's startup overview |
| Input highlighting | On | Highlights recognized slash commands and input structure |
| Inline slash autocomplete | On | Completes command and Skill names in the native editor |
| Tool running timer | On | Adds elapsed time to long-running active Tool rows |

The Tool timer is owned by Tool Display but appears in `/ui` so presentation settings stay together.

## Statusline

The Statusline uses one status row and an optional latest-prompt row. The status row keeps a stable order as space
allows: model and Thinking, Codex Fast mode, working directory and Git, Context, cache or usage, current Goal, and
Ponytail mode.

`auto` density first shortens fields and then removes lower-priority groups. It does not wrap or leave partial fields.
The model and Context remain visible longest. Goal and Ponytail appear only when their current state calls for a
persistent indicator.

The latest-prompt row is one terminal line. Skill invocations are reduced to the submitted task and compact Skill
labels; expanded Skill instructions and local paths are not shown.

## Welcome header

The Welcome header gives a compact startup view of the active model, project, and Suite entry points. It disappears
when disabled and yields to focused Command Dialogs. `/ui` is the only place that changes this presentation choice.

## Input presentation

Input highlighting and inline completion extend Pi's native editor without replacing its keybindings or draft
handling. Slash completion covers registered commands and inserts the canonical `/skill:<name>` form for Skills.

Focused dialogs temporarily take the editor surface. Closing a dialog restores the exact draft and normal Pi chrome.

## Live Thoughts

When Pi's native **Hide thinking blocks** setting is disabled, the current semantic Thought block can be projected
above the editor while the model works. The projection is bounded, display-only, and prefixed with `∗ thoughts:`.
Completed transcript content remains the record of the run.

## Charts and trees

Complete Markdown fences tagged `chart` or `tree` can render as terminal visualizations:

````markdown
```tree
Pi Stuff
  Work
    Goal
    Agents
  Context
    Search
    Compaction
```
````

Projection is display-only. Stored Markdown and provider messages keep the original fence. Incomplete, malformed,
unsafe, nested, oversized, or too-narrow visualizations remain ordinary code. One Assistant message may project up to
16 visualization blocks, each with at most 12,000 source characters.

## Command Dialogs

Pi Stuff commands use a shared full-width, non-floating Command Dialog. It provides stable focus, responsive layout,
semantic state rows, and one Escape route back to the editor. Only wide inspection workflows such as `/tools` and
`/tasks` use split panes; other dialogs remain single-column.

Blocking permission or confirmation work takes precedence over ordinary inspection and restores the previous view
after it closes. Shared geometry and interaction rules are defined in [DESIGN.md](../../DESIGN.md).

## Diagnostics

`/diagnostics` lists bounded, redacted problems from the current process. Each entry identifies the owning capability
and the action to take when a guided recovery path exists. Opening the dialog acknowledges visible notices; diagnostics
do not become conversation messages.

## See also

- [Conversation UI Module README](../../packages/pi-stuff/src/conversation-ui/README.md)
- [Command reference](../reference/commands.md)
- [Settings reference](../reference/settings.md)
- [Troubleshooting](../troubleshooting.md)
