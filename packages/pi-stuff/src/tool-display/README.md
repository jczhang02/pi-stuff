# Tool Display

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/tool-display/README.md)

Compact Tool activity in the transcript, with full details available when needed.

<p align="center">
  <a href="../../../../docs/assets/readme/capabilities/tool-display.png">
    <img src="../../../../docs/assets/readme/capabilities/tool-display.png" alt="Tool Activities list and selected details in Pi" width="100%">
  </a>
  <br>
  <em>Tool Activities provide compact status on the left and selected details on the right.</em>
</p>

## Quick start

Run several Read, Grep, Find, or List operations, then press `Ctrl+O` or open:

```text
/tools
```

Select a Retrieval Group or Tool Activity and press Enter. Press `r` to switch between Formatted and Raw detail.

## Highlights

- Groups continuous retrieval into one ordered summary row.
- Gives Bash, file mutations, Background work, Agents, and failures distinct semantic rows.
- Preserves failed, rejected, cancelled, and empty outcomes for inspection.
- Restores expanded activity in source order with `Ctrl+O`.
- Opens a bounded searchable activity view through `/tools [id]`.
- Shows elapsed time for active long-running Tools when enabled in `/ui`.

## Documentation

- [Tool Display guide](../../../../docs/capabilities/tool-display.md)
- [Conversation UI guide](../../../../docs/capabilities/conversation-ui.md)
- [Command reference](../../../../docs/reference/commands.md#interface-and-inspection)
- [Shared UI contract](../../../../DESIGN.md)
