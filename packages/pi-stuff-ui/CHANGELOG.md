# @jczhang02/pi-stuff-ui

## 0.2.5

### Patch Changes

- 16bbd08: Align the previous-Prompt text origin with the model identity for Latin, CJK, and emoji input.

## 0.2.4

### Patch Changes

- 8d42a58: Render the accepted icon-led one-row Statusline and bounded previous-prompt row, use the official full and compact Pi
  Welcome marks, and compose Fleetview beneath the Statusline through one shared Footer with a blank idle help slot.

## 0.2.3

### Patch Changes

- bd6ae2d: Reproduce the Claude Code welcome-card geometry and restore Fast to its former Statusline position.

## 0.2.2

### Patch Changes

- Polish the real daily-use TUI after installed-model dogfood: keep narrow Welcome and Codex content semantically complete,
  remove Goal state from the ordinary footer, show the persisted Goal completion summary and evidence, prevent wasteful
  nested delegation for small Agent tasks, present Magic-owned manual compaction as a successful recoverable boundary,
  and prevent settled Tool result bodies from being appended twice during synchronous rendering.

## 0.2.1

### Patch Changes

- e44dfe7: Keep Agent and TaskList lifecycle rows semantically useful at narrow widths, make `/ui` hints responsive without mid-phrase clipping, render Goal terminal tools through the shared Tool contract, and accept concrete multilingual completion evidence.

## 0.2.0

### Minor Changes

- 563d427: Add the owned Goal Capability with structured evidence gates, active reload recovery, session-persistent continuation,
  provider-error recovery, a non-disableable emergency backstop, and Suite-native presentation.
- f7037f1: Align the bounded Todo summary with conversation output, replace cache-read token counts with active-branch cache hit
  rate, and add the shared observation-only Codex weekly/Fast Statusline channel.

## 0.1.0

### Minor Changes

- a60a399: Add the owned one-shot BTW capability and the shared non-floating Command Dialog coordinator, including Todo chrome coordination and blocking-surface preemption.
- 4978806: Add the normal Host footer with deterministic narrow-width priority compression, plus exact Suite-owned footer and working-row restoration across Command Dialog lifecycle paths without forced transcript replays.
- 9b5aa96: Add the confirmed Welcome, live Thought, responsive Statusline, editor-enhancement, and unified `/ui` experience; expose bounded density, prompt, and icon controls; and move the Tool running timer into that shared native settings surface.

### Patch Changes

- Include each Package changelog in its published archive.
