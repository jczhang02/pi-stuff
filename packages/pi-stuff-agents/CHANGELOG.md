# @jczhang02/pi-stuff-agents

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
