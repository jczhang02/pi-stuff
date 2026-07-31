# Keep Pi as the Host

Pi Stuff is a normal Pi Package Suite rather than a new coding-agent runtime. The Aggregate Package composes ordered Capability Packages through Pi's Extension interface, while Pi continues to own the CLI, TUI, sessions, settings, package loading, and model interaction. This avoids duplicating Pi internals and lets the Suite follow the certified Pi host contract.

## Consequences

The Suite has no installer or configuration mutation behavior, import and startup stay pure, and failures are exposed instead of producing a silently partial Suite. Installation and Settings Layer changes remain explicit Host or maintainer actions.
