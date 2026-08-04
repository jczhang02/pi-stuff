# @jczhang02/pi-stuff-context

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
