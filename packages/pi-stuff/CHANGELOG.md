# @jczhang02/pi-stuff

## 0.3.1

### Patch Changes

- Updated dependencies [16bbd08]
  - @jczhang02/pi-stuff-ui@0.2.5
  - @jczhang02/pi-stuff-agents@1.0.1
  - @jczhang02/pi-stuff-btw@0.1.6
  - @jczhang02/pi-stuff-codex@0.1.5
  - @jczhang02/pi-stuff-goal@0.2.5
  - @jczhang02/pi-stuff-mcp@0.2.5
  - @jczhang02/pi-stuff-rtk@0.2.5
  - @jczhang02/pi-stuff-todo@0.1.6
  - @jczhang02/pi-stuff-tools@0.1.6
  - @jczhang02/pi-stuff-work@0.2.1
  - @jczhang02/pi-stuff-context@0.1.6
  - @jczhang02/pi-stuff-web@0.2.5

## 0.3.0

### Minor Changes

- e56bba8: Add session-owned Background Shell and one-shot Monitor tools, the full-width `/tasks` activity dialog, conditional
  Ctrl+B foreground handoff, bounded output and process-tree cleanup, plus a read-only running-Agent projection.

### Patch Changes

- dd7bcb6: Internalize the required Web and MCP fork snapshots in the Pi Stuff monorepo, remove self-owned GitHub Release
  dependencies, and preserve the certified narrow adapters, provenance, bundled runtime closure, and degraded behavior.
- 47f2efd: Replace the retired Pi Stuff-owned Magic Context release with the exact official
  `@cortexkit/pi-magic-context@0.33.1` Package behind the Context Capability. Preserve lazy activation and missed
  `session_start` replay, suppress duplicate UI and Todo surfaces, expose focused diagnostics through the Suite, bootstrap
  a non-destructive first-use configuration, and enforce one compaction owner without stacking a native summary after a
  Magic attempt.
- Updated dependencies [e56bba8]
- Updated dependencies [dd7bcb6]
- Updated dependencies [47f2efd]
- Updated dependencies [8d42a58]
  - @jczhang02/pi-stuff-work@0.2.0
  - @jczhang02/pi-stuff-agents@1.0.0
  - @jczhang02/pi-stuff-web@0.2.4
  - @jczhang02/pi-stuff-mcp@0.2.4
  - @jczhang02/pi-stuff-context@0.1.5
  - @jczhang02/pi-stuff-ui@0.2.4
  - @jczhang02/pi-stuff-btw@0.1.5
  - @jczhang02/pi-stuff-codex@0.1.4
  - @jczhang02/pi-stuff-goal@0.2.4
  - @jczhang02/pi-stuff-rtk@0.2.4
  - @jczhang02/pi-stuff-todo@0.1.5
  - @jczhang02/pi-stuff-tools@0.1.5

## 0.2.3

### Patch Changes

- Updated dependencies [bd6ae2d]
- Updated dependencies [2377f24]
- Updated dependencies [9da041a]
  - @jczhang02/pi-stuff-ui@0.2.3
  - @jczhang02/pi-stuff-rtk@0.2.3
  - @jczhang02/pi-stuff-todo@0.1.4
  - @jczhang02/pi-stuff-agents@0.2.3
  - @jczhang02/pi-stuff-btw@0.1.4
  - @jczhang02/pi-stuff-codex@0.1.3
  - @jczhang02/pi-stuff-goal@0.2.3
  - @jczhang02/pi-stuff-mcp@0.2.3
  - @jczhang02/pi-stuff-tools@0.1.4
  - @jczhang02/pi-stuff-context@0.1.4
  - @jczhang02/pi-stuff-web@0.2.3

## 0.2.2

### Patch Changes

- Polish the real daily-use TUI after installed-model dogfood: keep narrow Welcome and Codex content semantically complete,
  remove Goal state from the ordinary footer, show the persisted Goal completion summary and evidence, prevent wasteful
  nested delegation for small Agent tasks, present Magic-owned manual compaction as a successful recoverable boundary,
  and prevent settled Tool result bodies from being appended twice during synchronous rendering.
- Restore exact early-history recall after Magic Context compaction and cold
  resume while keeping Pi JSONL authoritative and the visible live tail out of
  duplicate search results.
- Updated dependencies
  - @jczhang02/pi-stuff-agents@0.2.2
  - @jczhang02/pi-stuff-codex@0.1.2
  - @jczhang02/pi-stuff-context@0.1.3
  - @jczhang02/pi-stuff-goal@0.2.2
  - @jczhang02/pi-stuff-tools@0.1.3
  - @jczhang02/pi-stuff-ui@0.2.2
  - @jczhang02/pi-stuff-btw@0.1.3
  - @jczhang02/pi-stuff-mcp@0.2.2
  - @jczhang02/pi-stuff-todo@0.1.3
  - @jczhang02/pi-stuff-web@0.2.2
  - @jczhang02/pi-stuff-rtk@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [e44dfe7]
- Updated dependencies [9f26a85]
  - @jczhang02/pi-stuff-agents@0.2.1
  - @jczhang02/pi-stuff-goal@0.2.1
  - @jczhang02/pi-stuff-todo@0.1.2
  - @jczhang02/pi-stuff-tools@0.1.2
  - @jczhang02/pi-stuff-ui@0.2.1
  - @jczhang02/pi-stuff-web@0.2.1
  - @jczhang02/pi-stuff-codex@0.1.1
  - @jczhang02/pi-stuff-context@0.1.2
  - @jczhang02/pi-stuff-mcp@0.2.1
  - @jczhang02/pi-stuff-btw@0.1.2
  - @jczhang02/pi-stuff-rtk@0.2.1

## 0.2.0

### Minor Changes

- 563d427: Add the owned Goal Capability with structured evidence gates, active reload recovery, session-persistent continuation,
  provider-error recovery, a non-disableable emergency backstop, and Suite-native presentation.
- c26a3d7: Add the lazy Magic Context capability, route its tools through the shared Tool renderer, and provide bounded
  reference-only context projections to BTW and child Agents while preserving native Pi fail-open behavior.
- 34af590: Add fail-open RTK command rewriting and model-only Tool output projection as an owned Pi Stuff Capability.
- 14396c9: Add bounded Web reading/search and a lazy proxy-only MCP gateway to the default Suite, including shared Tool rendering, non-floating status UI, owned immutable forks, and real Pi 0.83 transport verification.
- dcc49da: Add the owned Codex Capability with one non-floating control surface, real Fast request state, subscription usage,
  and shared-rendered apply patch, image viewing, and confirmed GPT Image 2 generation Tools.
- 60ba544: Remove the Permissions Capability and all child-Agent injection, approval forwarding, runtime dependencies, and release artifacts. Pi Stuff now adds no permission or command-interception layer.
- f7037f1: Align the bounded Todo summary with conversation output, replace cache-read token counts with active-branch cache hit
  rate, and add the shared observation-only Codex weekly/Fast Statusline channel.

### Patch Changes

- f51759f: Keep Goal control prompts in model context while hiding their internal protocol and ownership markers from the TUI and
  rendered HTML conversation export.
- 24de36a: Keep background Agent completions out of model turns and store Agent artifacts beside Pi sessions by default.
- Updated dependencies [563d427]
- Updated dependencies [c26a3d7]
- Updated dependencies [34af590]
- Updated dependencies [14396c9]
- Updated dependencies [dcc49da]
- Updated dependencies [c7fc358]
- Updated dependencies [f51759f]
- Updated dependencies [24de36a]
- Updated dependencies [60ba544]
- Updated dependencies [3705d7a]
- Updated dependencies [f7037f1]
  - @jczhang02/pi-stuff-goal@0.2.0
  - @jczhang02/pi-stuff-ui@0.2.0
  - @jczhang02/pi-stuff-agents@0.2.0
  - @jczhang02/pi-stuff-btw@0.1.1
  - @jczhang02/pi-stuff-context@0.1.1
  - @jczhang02/pi-stuff-rtk@0.2.0
  - @jczhang02/pi-stuff-web@0.2.0
  - @jczhang02/pi-stuff-mcp@0.2.0
  - @jczhang02/pi-stuff-tools@0.1.1
  - @jczhang02/pi-stuff-codex@0.1.0
  - @jczhang02/pi-stuff-todo@0.1.1

## 0.1.0

### Minor Changes

- a921d13: Add current-session foreground and background Agents with compact Claude-style lifecycle UI, bounded session-wide execution, and all-depth root-routed destructive-command protection.
- a60a399: Add the owned one-shot BTW capability and the shared non-floating Command Dialog coordinator, including Todo chrome coordination and blocking-surface preemption.
- 02dca12: Add the owned session Todo capability with four Task tools, branch replay, and a bounded above-editor checklist.
- 9b5aa96: Add the owned compact Tool UI for all seven Pi built-ins, focused `/tools` details, and the shared presentation contract used by Agent and Todo tools.
- 4978806: Add the normal Host footer with deterministic narrow-width priority compression, plus exact Suite-owned footer and working-row restoration across Command Dialog lifecycle paths without forced transcript replays.
- e1ec84f: Add the owned permission enforcement capability to the default Pi Stuff Suite, including all-depth Agent routing with fast unavailable-root denial.
- 6241af8: Persist BTW history with session ownership and bounded storage, add history navigation, copy and clear controls, and allow a selected exchange to be promoted into a new main session.
- 9b5aa96: Add the confirmed Welcome, live Thought, responsive Statusline, editor-enhancement, and unified `/ui` experience; expose bounded density, prompt, and icon controls; and move the Tool running timer into that shared native settings surface.

### Patch Changes

- 4fa6265: Clarify the Agent tool's mutually exclusive single, parallel, and control call shapes, and reject mixed or retired launch fields before execution.
- Include each Package changelog in its published archive.
- 394fffb: Reuse the running standalone Pi Host for child Agents and keep accepted late steering input alive through terminal-output drain.
- Updated dependencies [a921d13]
- Updated dependencies [a60a399]
- Updated dependencies [02dca12]
- Updated dependencies [9b5aa96]
- Updated dependencies [4fa6265]
- Updated dependencies [4978806]
- Updated dependencies [e1ec84f]
- Updated dependencies
- Updated dependencies [6241af8]
- Updated dependencies [9b5aa96]
- Updated dependencies [394fffb]
  - @jczhang02/pi-stuff-agents@0.1.0
  - @jczhang02/pi-stuff-btw@0.1.0
  - @jczhang02/pi-stuff-todo@0.1.0
  - @jczhang02/pi-stuff-ui@0.1.0
  - @jczhang02/pi-stuff-tools@0.1.0
  - @jczhang02/pi-stuff-permissions@0.1.0
