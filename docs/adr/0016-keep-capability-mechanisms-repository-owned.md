---
status: accepted
---

# Keep Capability mechanisms repository-owned

Pi Stuff will not pursue upstream `core` or factory seams as a code-volume strategy for Agents, Goal, Background Work,
RTK, Web, MCP, or another Capability Module. Their mechanism implementations remain repository-owned inside the one
Pi Stuff Package. Upstream changes may be reviewed and incorporated selectively, but Pi Stuff does not depend on
upstream projects exposing or maintaining decomposition seams for its architecture.

This preserves fork ownership, lifecycle authority, visible behavior, and certification in one repository. Repository
line count alone is not a reason to transfer mechanism ownership or add upstream Package dependencies.

## Consequences

- The previously proposed 39,000–48,000-line target based on upstream mechanism externalization is retired.
- Behavior-preserving reduction stays repository-local: delete behavior that is no longer needed, deepen internal
  Modules, reuse Pi public interfaces and native or standard-library mechanisms, and selectively incorporate upstream
  fixes.
- Architecture reviews and plans must not reopen upstream `core` or factory externalization unless the maintainer
  explicitly chooses to supersede this ADR.
- Adopting Effect or another runtime library would not change this ownership decision.
