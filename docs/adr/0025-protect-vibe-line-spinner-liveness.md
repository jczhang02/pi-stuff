---
status: accepted
---

# Protect Vibe Line Spinner liveness at Pi Stuff boundaries

## Context

The Host-owned Vibe Line Spinner is the visible liveness signal while Pi processes Agent work. Pi Stuff can freeze
that animation when synchronous projection, subprocess, or filesystem work monopolizes the Host thread, even though
the underlying operation later completes. Hiding the spinner, changing its sampling, or raising the stall threshold
would conceal the blocked Host rather than restore liveness.

## Decision

Within the certified Host profile, a Pi Stuff-owned path must not leave one rendered Vibe Line Spinner frame unchanged
for more than 500 milliseconds while Agent work is active. Acceptance observes the rendered terminal from outside the
Host event loop and also requires the operation to settle and the interface to recover.

A Pi Stuff-owned Host-thread path must not synchronously wait for an external process. The owning Capability instead
uses its asynchronous Effect/native adapter or moves the complete operation to its existing child or Worker boundary,
while preserving cancellation, timeout, failure, and cleanup semantics. This rule does not create a generic Suite
process runtime or move lifecycle authority away from the owning Capability.

Ordinary synchronous computation and bounded filesystem access are not moved merely because they are synchronous.
They require representative real-PTY evidence that the 500-millisecond liveness limit is exceeded; the smallest fix
then belongs at the shared owning seam. A display-only Capability remains only while it can meet the limit without
changing canonical Session or Provider content.

Conversation UI reuses the existing `TRANSCRIPT_MARKER` (`•`) only in fixed Thinking labels. Expanded Host Thinking
runs receive the inline `• thoughts: ` prefix; hidden runs use the Host-owned `• thoughts` label. Both keep the Host
Thinking style and align the marker cell with Tool Activity under Host output padding. Pi Stuff does not inspect,
merge, select, truncate, fit, or separately persist Thinking content.

The hard guarantee currently applies to the certified Linux x64 Host profile. Host-owned cumulative Markdown
transformation and rendering at extreme input sizes remain an explicit upstream limitation; Pi Stuff does not claim
to fix or mask that Host behavior.

## Rejected alternatives

- Hiding, replacing, or slowing the spinner would remove the symptom while the Host remains blocked.
- Moving every synchronous computation or filesystem read to a Worker would add speculative concurrency and lifecycle
  machinery without evidence that those paths violate the liveness contract.
- Claiming end-to-end liveness for Host-owned rendering would cross the Package boundary and misstate Pi Stuff's
  certified behavior.

## Consequences

Each violating Capability keeps its own subprocess, Worker, cancellation, and error semantics while removing the
Host-thread wait at that boundary. The former semantic-block selection and width-fitting projection was removed after
continuous cumulative Thinking showed that it still competed with the Vibe Line Spinner on the synchronous Markdown
path. The remaining fixed labels must match native Thinking in paired rendering benchmarks and pass the certified
real-PTY 500-millisecond gate. Unsupported platforms may receive the same structural fix when it is shared, but are
not certified by this decision.
