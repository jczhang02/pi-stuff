---
status: accepted
---

# Keep Pi as the Host

Pi Stuff is one normal Pi Package rather than a new coding-agent runtime. Its entry point composes ordered internal
Capability Modules through Pi's Extension interface, while Pi continues to own the CLI, TUI, sessions, settings,
Package loading, and model interaction. This avoids duplicating Pi internals and lets the Suite follow the certified
Pi Host contract.

## Consequences

The Suite has no installer or implicit Settings Layer mutation behavior, import stays pure, and failures are exposed instead of producing a silently partial Suite. Installation and Settings Layer changes remain explicit Host or maintainer actions. ADR 0007 permits configured Context startup to initialize rebuildable derived state before editor readiness while preserving the no-configuration-mutation boundary.
