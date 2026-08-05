# Changelog

## 0.2.4

### Patch Changes

- Updated dependencies [8d42a58]
  - @jczhang02/pi-stuff-ui@0.2.4
  - @jczhang02/pi-stuff-tools@0.1.5

## 0.2.3

### Patch Changes

- Updated dependencies [bd6ae2d]
  - @jczhang02/pi-stuff-ui@0.2.3
  - @jczhang02/pi-stuff-tools@0.1.4

## 0.2.2

### Patch Changes

- Polish the real daily-use TUI after installed-model dogfood: keep narrow Welcome and Codex content semantically complete,
  remove Goal state from the ordinary footer, show the persisted Goal completion summary and evidence, prevent wasteful
  nested delegation for small Agent tasks, present Magic-owned manual compaction as a successful recoverable boundary,
  and prevent settled Tool result bodies from being appended twice during synchronous rendering.
- Updated dependencies
  - @jczhang02/pi-stuff-tools@0.1.3
  - @jczhang02/pi-stuff-ui@0.2.2

## 0.2.1

### Patch Changes

- e44dfe7: Keep Agent and TaskList lifecycle rows semantically useful at narrow widths, make `/ui` hints responsive without mid-phrase clipping, render Goal terminal tools through the shared Tool contract, and accept concrete multilingual completion evidence.
- Updated dependencies [e44dfe7]
  - @jczhang02/pi-stuff-tools@0.1.2
  - @jczhang02/pi-stuff-ui@0.2.1

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
