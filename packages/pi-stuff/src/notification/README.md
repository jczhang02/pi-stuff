# Notification

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/notification/README.md)

Terminal-native completion and failure alerts after substantial user-started Agent work settles.

## Quick start

```text
/notifications
```

Review the active policy and send a test notification. Defaults require 10 seconds of Agent Work Duration followed by
a 2-second quiet grace period.

## Highlights

- Alerts only after direct user work fully settles.
- Excludes time spent waiting for Pi input or permission prompts.
- Cancels a pending alert when terminal activity or new work resumes.
- Selects Kitty OSC 99, Ghostty OSC 777, OSC 9, or BEL delivery.
- Supports tmux passthrough with independently controlled attention BEL.
- Keeps response previews off by default.

## Documentation

- [Notification guide](../../../../docs/capabilities/notification.md)
- [Settings reference](../../../../docs/reference/settings.md#notification)
- [Troubleshooting](../../../../docs/troubleshooting.md#notifications)
- [Command reference](../../../../docs/reference/commands.md#interface-and-inspection)

