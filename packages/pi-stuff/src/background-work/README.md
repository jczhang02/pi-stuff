# Background Work

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/background-work/README.md)

Background Shells and one-shot Monitors that report completion while the main Agent continues.

## Quick start

Ask the Agent to launch Bash with `run_in_background: true` or to create a `monitor` for command, file, log, or HTTP
evidence. Then open:

```text
/tasks
```

The dialog lists current work, follows bounded output, and stops activities owned by the Session.

## Highlights

- Detaches Bash immediately, through `Ctrl+B`, or after a two-minute foreground handoff.
- Monitors exact success or failure text across four source types.
- Delivers terminal outcomes automatically without conversational polling.
- Keeps the newest 64 bounded completion receipts for recent inspection.
- Limits one Session to 16 simultaneous Shells and Monitors.
- Stops owned process trees and records authenticated recovery metadata at shutdown.

## Documentation

- [Background Work guide](../../../../docs/capabilities/background-work.md)
- [Command reference](../../../../docs/reference/commands.md#work-control)
- [Tool Display guide](../../../../docs/capabilities/tool-display.md)
- [Agents guide](../../../../docs/capabilities/subagents.md)
- [Upstream references](UPSTREAM.md)

