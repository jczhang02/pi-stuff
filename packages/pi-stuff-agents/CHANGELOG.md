# @jczhang02/pi-stuff-agents

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
