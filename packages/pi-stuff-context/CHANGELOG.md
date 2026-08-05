# @jczhang02/pi-stuff-context

## 0.1.5

### Patch Changes

- 47f2efd: Replace the retired Pi Stuff-owned Magic Context release with the exact official
  `@cortexkit/pi-magic-context@0.33.1` Package behind the Context Capability. Preserve lazy activation and missed
  `session_start` replay, suppress duplicate UI and Todo surfaces, expose focused diagnostics through the Suite, bootstrap
  a non-destructive first-use configuration, and enforce one compaction owner without stacking a native summary after a
  Magic attempt.
  - @jczhang02/pi-stuff-tools@0.1.5

## 0.1.4

### Patch Changes

- @jczhang02/pi-stuff-tools@0.1.4

## 0.1.3

### Patch Changes

- Polish the real daily-use TUI after installed-model dogfood: keep narrow Welcome and Codex content semantically complete,
  remove Goal state from the ordinary footer, show the persisted Goal completion summary and evidence, prevent wasteful
  nested delegation for small Agent tasks, present Magic-owned manual compaction as a successful recoverable boundary,
  and prevent settled Tool result bodies from being appended twice during synchronous rendering.
- Upgrade the owned Magic Context fork so explicit recall synchronizes the Pi
  JSONL-derived message index and finds hidden early turns after compact and
  cold resume without echoing the visible live tail.
- Updated dependencies
  - @jczhang02/pi-stuff-tools@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [e44dfe7]
  - @jczhang02/pi-stuff-tools@0.1.2

## 0.1.1

### Patch Changes

- c26a3d7: Add the lazy Magic Context capability, route its tools through the shared Tool renderer, and provide bounded
  reference-only context projections to BTW and child Agents while preserving native Pi fail-open behavior.
- c7fc358: Resume an active Goal exactly once when Magic Context intentionally bypasses native Pi compaction, while preserving the native `session_compact` path and overflow retry ownership.
- Updated dependencies [14396c9]
- Updated dependencies [dcc49da]
- Updated dependencies [60ba544]
  - @jczhang02/pi-stuff-tools@0.1.1

## 0.1.0

### Minor Changes

- Add lazy owned Magic Context integration, native-context degradation, and
  bounded reference projections for BTW and Agents.
