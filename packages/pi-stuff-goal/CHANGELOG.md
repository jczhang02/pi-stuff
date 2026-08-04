# Changelog

## 0.2.0

### Minor Changes

- 563d427: Add the owned Goal Capability with structured evidence gates, active reload recovery, session-persistent continuation,
  provider-error recovery, a non-disableable emergency backstop, and Suite-native presentation.

### Patch Changes

- c7fc358: Resume an active Goal exactly once when Magic Context intentionally bypasses native Pi compaction, while preserving the native `session_compact` path and overflow retry ownership.
- f51759f: Keep Goal control prompts in model context while hiding their internal protocol and ownership markers from the TUI and
  rendered HTML conversation export.
- Updated dependencies [563d427]
- Updated dependencies [f7037f1]
  - @jczhang02/pi-stuff-ui@0.2.0

## 0.1.0

- Fork `@narumitw/pi-goal@0.48.0` into the Pi Stuff Goal Capability.
- Adopt the Suite Command Dialog and native SettingsList presentation.
- Disable the no-progress heuristic by default and remove package-owned status chrome.
- Harden completion and blocker evidence, active reload recovery, provider-error recovery, and runaway protection.
