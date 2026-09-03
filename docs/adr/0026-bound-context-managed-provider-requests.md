---
status: proposed
---

# Bound Context-managed Provider requests

## Context

Magic Context normally sends a derived projection rather than Pi's complete Session history. A transport failure can
discard Provider continuation state and cause Pi to assemble another request while the statusline and Context scheduler
still reflect the previous successful request. Existing fail-open behavior can then replace a small projection with a
much larger native context without a final capacity check.

## Decision

Every Provider request made while Context is active must carry a Bounded Context Projection. Context Management validates
the final serialized Provider payload against 95% of the selected model's configured Context window; it does not subtract
the model's maximum output because the Provider request does not reserve that output. If the model has no reliable
configured Context window or the payload cannot be measured, the request stops locally because its bound cannot be
established.

An automatic transport retry with unchanged raw input reuses the same validated projection. If the projection changes,
fails, or exceeds the bound, Context Management requests one Magic emergency projection and validates again. If that does
not converge, Pi may perform one Host-owned native compaction and continuation only when native compaction is already
enabled. Otherwise the request stops locally with an explicit explanation; Context Management never silently sends an
unbounded native fallback and never overrides the user's compaction setting.

The recovery budget is fixed: one transport retry, one Magic emergency retry, and at most one enabled native-compaction
retry. Recovery state replaces the stale context percentage in the Statusline; outside recovery, the Statusline reports
the most recently validated outgoing estimate until authoritative Provider usage arrives. That estimate is process-local,
is not written to the Session, and resets to unknown after a reload or branch switch until the next validated request. Pi
retains ownership of the Agent and Provider-request lifecycle.

## Rejected alternatives

- Retrying indefinitely cannot reduce a deterministically oversized payload and can create cost and rate-limit loops.
- Guarding only WebSocket close code 1006 leaves the same unsafe transition available to other transport and Worker
  failures.
- Dynamic growth from observed Provider acceptance makes the local safety promise depend on unstable remote behavior.
- Changing only the pinned Magic Context package cannot validate the final Provider payload assembled by Pi.
- Reporting this policy upstream is outside the chosen delivery scope; Pi Stuff owns its local adapter guarantee.

## Consequences

Pi Stuff may stop a request that its conservative local bound rejects even when a Provider could accept it. In return,
transport recovery cannot silently replace a validated projection with the complete raw Session. Acceptance must cover a
focused unit regression and a real Pi Host PTY scenario with long raw history, a deterministic post-stream transport
failure, recovery without another user input, every sent payload below the bound, no retry beyond the fixed budget, and a
clear terminal failure when recovery is exhausted. This ADR remains proposed until the implementation and that acceptance
evidence are complete.
