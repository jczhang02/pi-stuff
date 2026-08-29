---
status: accepted
---

# Use a closed Operation Block family

## Context

ADR 0022 rejects a universal `Tool(args)` plus child-status block, while Bash and several other evidence-rich Tool
activities still benefit from the same parent-and-child reading shape. Without an explicit boundary, presentation
metadata could gradually turn that local shape into the universal Tool card that ADR 0022 rejected.

At acceptance, Bash is the only implemented Operation Block. Write, Edit, Patch, the `background` Tool's
`action: "output"` activity, and unmatched outer Code Mode issues retain their existing Tool-specific presentation.

## Decision

Pi Stuff adopts a closed eligibility boundary for Operation Blocks. Bash remains the only implemented member at
acceptance. A later implementation may add only Write, Edit, Patch, the `background` Tool's `action: "output"`
activity, or an outer Code Mode error, rejection, or cancellation that no nested Tool or media projection represents.
Each specialization must update its owning Module contract and acceptance evidence when it ships.

A Code Mode specialization would replace the presentation of the same single Envelope Fallback Row; it would not add
a second row or change nested Tool and media ownership. Until a candidate is specialized, its existing semantic shape
remains authoritative. MCP and every other Tool family cannot opt into the family through presentation metadata.

This decision refines standalone Tool presentation without replacing ADR 0022. Native Read, Grep/Find, and List remain
the only Retrieval Group members, and the rejected universal `Tool(args)` plus child-status block remains rejected.

## Consequences

- Operation Blocks can share a restrained parent-and-child grammar without becoming a general Tool abstraction.
- This decision constrains future presentation work without claiming that unimplemented specializations have shipped.
- Extending the family beyond the reserved candidates requires revisiting this boundary rather than adding an opt-in
  metadata flag.
