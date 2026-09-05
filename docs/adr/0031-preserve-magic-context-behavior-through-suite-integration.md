---
status: proposed
---

# Preserve Magic Context behavior through Suite integration

This proposal records the restarted design interview after the Context retry investigation. The principles below
are confirmed; the recovery design remains open and is not authorization to implement it. Earlier interview choices
about fixed deadlines, retry counts, or a custom-compaction implementation are not inherited.

## Confirmed principles

When Magic is enabled, it owns all context compaction. Pi Stuff must not substitute raw Session history or Pi native
summarization when Magic fails. Pi remains the Host and owns foreground execution and Session persistence. Recoverable
failures should continue automatically without duplicate user input or replay of completed Tools; unrecoverable
failures must preserve the Session and current input, explain the cause, and stop without infinite retries.

Suite integration must preserve message identity, compression semantics, cancellation, and Session ownership across
the Worker seam. Direct Magic execution provides a comparison baseline, not a requirement to reproduce known Magic
bugs. Required Suite-specific differences must be explicit and verified. This proposal does not merge the adapters or
change WebSocket/SSE selection.

## Confirmed trade-offs

- Internal optimizations may be removed when they undermine correctness. Existing user-visible capabilities remain
  unless their specific removal and consequences are separately agreed. Simplification is not blanket permission to
  remove BTW, Agents, or other Suite behavior.
- Automatic recovery is limited to ordinary or emergency Magic compaction and safely retryable transient failures.
  Full history recomposition equivalent to `/ctx recomp` remains an explicit operation because its cost and scope
  exceed ordinary recovery. The recovery mechanisms and retry limits still need feasibility validation and design.
- An unexplained difference that can affect messages, compaction results, cancellation, or preservation of work blocks
  completion of the overall repair. Independently verified fixes may be committed separately, but do not certify the
  whole integration. Differential acceptance must distinguish intended Suite behavior from unintended differences.

## Open decisions

The interview still needs to settle recoverable Worker failures, interrupted compaction with uncertain completion,
progress and exhaustion rules, cancellation and queued input behavior, and recovery presentation. These decisions
must be checked against actual Pi and Magic capabilities before implementation is accepted.

This proposal would replace incompatible fallback and estimate-only rejection policies in
[ADR 0026](0026-bound-context-managed-provider-requests.md). Until the design is accepted and implemented, current
behavior remains documented separately; this draft is not a claim that Magic-only recovery has shipped.
