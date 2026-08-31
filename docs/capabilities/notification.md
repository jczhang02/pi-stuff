# Notification

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/notification.md)

Notification sends a terminal-native alert after substantial user-started Agent work settles and Pi remains quiet.

## Quick start

Run Pi in an interactive terminal and open:

```text
/notifications
```

Review the current policy and send a test notification. With the defaults, a real alert requires at least 10 seconds of
Agent Work Duration followed by a 2-second quiet grace period.

## When an alert is sent

A work cycle becomes eligible when:

1. the Agent run came from direct user work;
2. the run fully settles;
3. Agent Work Duration reaches `minimumDurationMs`;
4. Pi remains idle with no pending messages through `gracePeriodMs`;
5. the matching completion or failure alert is enabled.

Time spent waiting for a Pi input, confirmation, or permission prompt is removed from Agent Work Duration. Terminal
input, new work, or pending messages during the grace period cancels the pending alert.

Extension-authored automatic work does not create an alert by itself. An aborted run or a run without a final Assistant
message stays silent. A run with an error becomes a failure alert; other eligible outcomes become completion alerts.

## Settings

`/notifications` controls:

- Notification, completion, and failure enablement;
- minimum Agent Work Duration and quiet grace;
- delivery protocol;
- response preview;
- terminal bell and tmux attention behavior;
- test delivery.

Defaults and exact JSON fields are in [Settings reference](../reference/settings.md#notification).

## Delivery

| Delivery | Use |
| --- | --- |
| `auto` | Detect a supported terminal and select its visual protocol |
| `kitty` | Kitty OSC 99 |
| `osc777` | Ghostty OSC 777 |
| `osc9` | iTerm2 and WezTerm OSC 9 |
| `bell` | BEL |

Automatic detection selects Kitty, Ghostty, iTerm2, or WezTerm from the terminal environment. Outside tmux, an unknown
terminal cannot receive a visual notification and falls back to BEL only where the effective policy allows it.

Delivery runs only in Pi's interactive TUI. Print, JSON, RPC, and headless modes do not write notification sequences.

## tmux

Visual notification sequences inside tmux require:

```tmux
set -g allow-passthrough on
```

Visual protocols are wrapped for tmux passthrough. When `tmuxNotification` is on, Pi Stuff adds one attention BEL.
Turning it off preserves supported visual delivery and suppresses all notification BEL inside tmux, including explicit
`bell` delivery.

tmux owns the marker style and when it clears after focus changes. Notification passthrough does not configure inline
images.

## Privacy and content

`responsePreview` is off by default. Completion notifications therefore use a short generic body. Failure
notifications do not expose the model error.

When preview is enabled, it uses only bounded text from the final Assistant message. Fenced code is skipped, Markdown is
flattened, and control sequences are removed. Titles are bounded to 64 terminal columns and bodies to 160.

Desktop notification history may remain visible after Pi is no longer focused. Keep previews off on shared desktops or
when responses may contain sensitive information.

## Bell behavior

Outside tmux, `terminalBell` can add BEL to a visual notification. The terminal decides whether BEL produces a sound,
visual cue, or no action. Configure the terminal itself when BEL behavior is not what you expect.

## See also

- [Notification Module README](../../packages/pi-stuff/src/notification/README.md)
- [Settings reference](../reference/settings.md#notification)
- [Troubleshooting](../troubleshooting.md#notifications)
- [Command reference](../reference/commands.md)

