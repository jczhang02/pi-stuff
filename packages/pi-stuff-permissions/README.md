# @jczhang02/pi-stuff-permissions

Pi Stuff's permission engine: normal coding work stays uninterrupted, while a
small non-relaxable circuit breaker catches destructive shell mistakes.

## What it feels like

- Reads, edits, tests, ordinary shell commands, and concrete deletion inside
  the current project run without a permission prompt.
- A concrete deletion outside the current project opens one blocking
  Claude-Code-style review. Approval applies to that exact call only.
- Deleting a filesystem root, the user's home, the current directory, a Git
  worktree root, or an ancestor containing one is refused.
- Once a deletion/discard shape is identifiable, variables, substitutions,
  globs, wrappers, ambiguous directory changes, and parse failures are refused
  with a direct-command rewrite hint. Unrelated dynamic commands remain quiet.
- Git worktree-discard operations such as `reset --hard`, `clean`,
  `restore`, path checkout, forced switch, and destructive stash operations
  use the same exact-call review.
- A request from any supported Agent depth appears in the root Pi session and
  names its Agent path. If the root broker is unavailable, the destructive
  call is denied quickly instead of waiting invisibly.

The review is a full-width, non-floating Command Dialog shared with the rest of
Pi Stuff. It has only **Allow this exact call once** and **Deny**. Long evidence
scrolls with Page Up/Page Down while the title and decisions remain fixed.
Control characters are rendered visibly rather than interpreted by the
terminal. Custom decision rows use the Suite's two-cell gutter and `›` focus
marker; action hints wrap without hiding Escape. Escape denies from the decision
step and returns one level from reason or scope selection.

## Settings

Run `/permissions` to open Pi's native settings list inside the shared Command
Dialog. The default mode is `unrestricted`. Optional `manual` mode restores
policy prompts for ordinary consequential tools without weakening the
destructive circuit breaker.

The settings surface deliberately retains Pi's native `SettingsList` focus
marker, keymap, descriptions, and Escape-to-close behavior.

User configuration is stored at:

```text
~/.pi/agent/extensions/pi-stuff-permissions/config.json
```

Project policy can tighten ordinary permissions, but runtime authority,
logging, shell-tool enrollment, global denies, and the circuit breaker remain
user-owned.
Review and debug logs are off by default.

## Safety boundary

This is an accident circuit breaker, not an operating-system sandbox. It
certifies common direct shell deletion and Git discard shapes and fails closed
when those shapes become ambiguous. It does not claim to prove the behavior of
arbitrary programs or scripts.

## Fork provenance

This package is an owned fork of `@gotgenes/pi-permission-system@24.0.0`.
See [UPSTREAM.md](./UPSTREAM.md) for the exact source, archive hashes, license,
and the Pi Stuff product delta.
