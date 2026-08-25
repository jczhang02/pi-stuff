# Notification Capability

Notification sends a delayed terminal-native completion or failure alert only after user-started Agent work settles,
the configured minimum duration has elapsed, and Pi remains quiet through the grace period. User or terminal input
cancels a pending alert. Extension-authored automatic work does not create one.

`/notifications` opens the shared full-width Command Dialog for enabling alerts, choosing `auto`, Kitty OSC 99,
OSC 9, Ghostty OSC 777, or BEL delivery, controlling response previews and terminal BEL, and sending a test alert.
Response previews are disabled by default because desktop notification history may be visible outside Pi.
Inside tmux, every visual delivery preserves its system-notification protocol and adds one raw BEL so tmux can mark
the window for attention when `Tmux notification` is on. Turning it off preserves the system notification without BEL;
tmux continues to own the marker's appearance and focus-time clearing.

Settings live under the `notification` namespace in `<agentDir>/pi-stuff.json`. Loading is read-only; the legacy
`pi-stuff-notification.json` file is lifted only through the documented one-time migration. Delivery is observational:
unsupported terminals or write failures report a bounded diagnostic and never fail Agent work.
