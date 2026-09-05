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

## Confirmed recovery boundaries

A failed Worker may restart automatically and reconstruct its state from the persisted Pi Session and Magic store.
Recovery must verify Session ownership, the current input, and committed compaction results. This is state recovery,
not full history recomposition, and must not become a restart loop. Restart limits belong to the shared recovery budget.

If compaction acknowledgement is lost, inspect durable completion evidence before retrying. Reuse a confirmed result;
retry only when the operation is confirmed incomplete and safe to repeat. If completion remains uncertain, preserve
work and stop with an explanation rather than treating missing acknowledgement as proof that no mutation occurred.

Before Pi's automatic post-compaction Provider retry, Magic may perform multiple internal compression steps only while
each step makes measurable progress and compressible history remains. All steps share one finite recovery budget.
No progress ends recovery. If the subsequent Provider retry also overflows, preserve work and stop; do not add another
foreground retry loop or bypass Pi's consecutive-overflow guard.

## Confirmed recovery budget and input behavior

One recovery phase has a ten-minute total deadline and permits at most one automatic Worker restart. Compression
steps, transient-failure retries, backoff, and completion verification consume that same deadline; no step resets it.
Lack of progress stops recovery earlier. The deadline excludes the normal Provider response after recovery succeeds.
The phase boundaries and cancellation behavior must be validated at the real Host seam.

Ordinary input submitted during recovery follows Pi's existing compaction queue behavior rather than automatically
interrupting recovery. Explicit cancellation stops recovery. Pi retains responsibility for subsequent queue delivery;
Pi Stuff must neither clear queued input on recovery failure nor duplicate or automatically resubmit it to restart the
failed work. Persisted completed work and accepted input remain intact.

## Confirmed request admission and presentation

Local token estimates guide proactive Magic compaction but are not, by themselves, grounds to abort a request. A high
or unavailable estimate does not prove Provider overflow. A valid Magic projection covering the current input and
completed Tool results may be sent; an actual Provider overflow enters recovery. Failure to obtain a correct projection
requires recovery or an explained stop, never substitution of raw history.

Use the existing Context display authority for concise recovery state and the current phase. Successful recovery
returns to ordinary display without appending a message for every step. Failure explains the cause once and states
that input is preserved. Technical details belong in `/diagnostics`, outside model context.

## No proactive interruption

Pi Stuff must not introduce proactive actions that interrupt an otherwise viable Agent run. Estimate thresholds,
cache maintenance, optimization, and background maintenance do not authorize foreground cancellation. Optional
maintenance failure alone is not proof that the active projection or foreground run has failed. Ordinary Magic
compaction must preserve continuation rather than terminate work and require resubmission.

The ten-minute deadline applies only to an actual fault-recovery phase. It is not a timer for normal Agent execution,
ordinary proactive compaction, or a normal Provider response. A retry or maintenance operation must not reset, replace,
or cancel the foreground run merely to simplify adapter implementation.

## Open decisions

The remaining policy clarification is how the prohibition on proactive interruption relates to the previously
confirmed stops for actual unrecoverable failures. Progress measurement and detailed cancellation propagation remain
engineering validation work, not assumed capabilities. The design still awaits final shared-understanding confirmation.

This proposal would replace incompatible fallback and estimate-only rejection policies in
[ADR 0026](0026-bound-context-managed-provider-requests.md). Until the design is accepted and implemented, current
behavior remains documented separately; this draft is not a claim that Magic-only recovery has shipped.
