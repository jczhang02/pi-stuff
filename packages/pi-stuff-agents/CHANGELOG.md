# @jczhang02/pi-stuff-agents

## 1.0.0

### Minor Changes

- e56bba8: Add session-owned Background Shell and one-shot Monitor tools, the full-width `/tasks` activity dialog, conditional
  Ctrl+B foreground handoff, bounded output and process-tree cleanup, plus a read-only running-Agent projection.

### Patch Changes

- 8d42a58: Render the accepted icon-led one-row Statusline and bounded previous-prompt row, use the official full and compact Pi
  Welcome marks, and compose Fleetview beneath the Statusline through one shared Footer with a blank idle help slot.
- Updated dependencies [e56bba8]
- Updated dependencies [47f2efd]
- Updated dependencies [8d42a58]
  - @jczhang02/pi-stuff-work@0.2.0
  - @jczhang02/pi-stuff-context@0.1.5
  - @jczhang02/pi-stuff-ui@0.2.4
  - @jczhang02/pi-stuff-tools@0.1.5

## 0.2.3

### Patch Changes

- Updated dependencies [bd6ae2d]
  - @jczhang02/pi-stuff-ui@0.2.3
  - @jczhang02/pi-stuff-tools@0.1.4
  - @jczhang02/pi-stuff-context@0.1.4

## 0.2.2

### Patch Changes

- Polish the real daily-use TUI after installed-model dogfood: keep narrow Welcome and Codex content semantically complete,
  remove Goal state from the ordinary footer, show the persisted Goal completion summary and evidence, prevent wasteful
  nested delegation for small Agent tasks, present Magic-owned manual compaction as a successful recoverable boundary,
  and prevent settled Tool result bodies from being appended twice during synchronous rendering.
- Updated dependencies
  - @jczhang02/pi-stuff-context@0.1.3
  - @jczhang02/pi-stuff-tools@0.1.3
  - @jczhang02/pi-stuff-ui@0.2.2

## 0.2.1

### Patch Changes

- e44dfe7: Keep Agent and TaskList lifecycle rows semantically useful at narrow widths, make `/ui` hints responsive without mid-phrase clipping, render Goal terminal tools through the shared Tool contract, and accept concrete multilingual completion evidence.
- Updated dependencies [e44dfe7]
  - @jczhang02/pi-stuff-tools@0.1.2
  - @jczhang02/pi-stuff-ui@0.2.1
  - @jczhang02/pi-stuff-context@0.1.2

## 0.2.0

### Minor Changes

- 60ba544: Remove the Permissions Capability and all child-Agent injection, approval forwarding, runtime dependencies, and release artifacts. Pi Stuff now adds no permission or command-interception layer.

### Patch Changes

- c26a3d7: Add the lazy Magic Context capability, route its tools through the shared Tool renderer, and provide bounded
  reference-only context projections to BTW and child Agents while preserving native Pi fail-open behavior.
- 24de36a: Keep background Agent completions out of model turns and store Agent artifacts beside Pi sessions by default.
- Updated dependencies [563d427]
- Updated dependencies [c26a3d7]
- Updated dependencies [14396c9]
- Updated dependencies [dcc49da]
- Updated dependencies [c7fc358]
- Updated dependencies [60ba544]
- Updated dependencies [f7037f1]
  - @jczhang02/pi-stuff-ui@0.2.0
  - @jczhang02/pi-stuff-context@0.1.1
  - @jczhang02/pi-stuff-tools@0.1.1

## 0.1.0

### Minor Changes

- a921d13: Add current-session foreground and background Agents with compact Claude-style lifecycle UI, bounded session-wide execution, and all-depth root-routed destructive-command protection.

### Patch Changes

- 9b5aa96: Add the owned compact Tool UI for all seven Pi built-ins, focused `/tools` details, and the shared presentation contract used by Agent and Todo tools.
- 4fa6265: Clarify the Agent tool's mutually exclusive single, parallel, and control call shapes, and reject mixed or retired launch fields before execution.
- Include each Package changelog in its published archive.
- 394fffb: Reuse the running standalone Pi Host for child Agents and keep accepted late steering input alive through terminal-output drain.
- Updated dependencies [a60a399]
- Updated dependencies [9b5aa96]
- Updated dependencies [4978806]
- Updated dependencies [e1ec84f]
- Updated dependencies
- Updated dependencies [9b5aa96]
  - @jczhang02/pi-stuff-ui@0.1.0
  - @jczhang02/pi-stuff-tools@0.1.0
  - @jczhang02/pi-stuff-permissions@0.1.0
