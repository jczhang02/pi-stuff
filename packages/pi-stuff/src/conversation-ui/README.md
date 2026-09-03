# Conversation UI

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/conversation-ui/README.md)

The shared Pi Stuff presentation layer for the conversation, editor, Statusline, Welcome header, and focused Command
Dialogs.

<p align="center">
  <a href="../../../../docs/assets/readme/capabilities/conversation-ui.png">
    <img src="../../../../docs/assets/readme/capabilities/conversation-ui.png" alt="Conversation UI settings dialog in Pi" width="100%">
  </a>
  <br>
  <em>The UI dialog configures the Statusline, prompt, Welcome card, highlighting, completion, and timers.</em>
</p>

## Quick start

```text
/ui
```

Use the interactive list to configure the Statusline, latest prompt, Welcome header, input highlighting, inline slash
completion, and Tool running timer.

## Highlights

- Responsive Statusline with stable model, workspace, Context, usage, Goal, and Ponytail groups.
- One-line latest-prompt preview and compact Skill labels.
- Native-editor input highlighting and slash completion.
- Host-owned Thinking with display-only `• thoughts:` and `• thoughts` labels, plus `chart` or `tree` Markdown projections.
- Full-width Command Dialogs that restore the editor draft on close.
- Bounded Suite diagnostics through `/diagnostics`.

## Documentation

- [Conversation UI guide](../../../../docs/capabilities/conversation-ui.md)
- [Settings reference](../../../../docs/reference/settings.md#ui)
- [Command reference](../../../../docs/reference/commands.md#interface-and-inspection)
- [Shared UI contract](../../../../DESIGN.md)
