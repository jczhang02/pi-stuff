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

Conversation UI reuses the existing `TRANSCRIPT_MARKER` (`•`) only in fixed Thinking labels. A visible Host
Thinking run renders through the Host's native Markdown component once, then keeps only its last terminal row after the
inline `• thoughts: ` prefix; a hidden run uses the Host-owned `• thoughts` label. The prefix keeps the Host Thinking
style and aligns with Tool Activity under Host output padding. If the combined row exceeds the viewport, the bounded
post-render projection keeps its content tail. Pi Stuff does not parse Thinking source, merge runs, classify models, run
a refresh timer, or separately persist display state.

Pi currently has no public post-render Thinking seam. Conversation UI therefore installs one guarded, version-bound
adapter around `AssistantMessageComponent.updateContent()` and replaces Host-created Thinking Markdown children. The
same adapter restores the Host's missing spacer only when Assistant prose directly precedes a Thinking run inside one
Assistant message; existing leading and Thinking-to-prose spacing remains unchanged. The public MIT Package
`@99percentpeople/pi-thinking-fold@0.1.9` established that post-render row selection is viable; Pi Stuff retains only
that rendering order, without copying its source or adopting its timer, keybinding, settings, Working Row, or
model-specific behavior. The adapter validates the certified component layout and fails clearly when it is unavailable.
It must be removed when the Host exposes an equivalent public seam.

The hard guarantee currently applies to the certified Linux x64 Host profile. Host-owned cumulative Markdown
transformation and rendering at extreme input sizes remain an explicit upstream limitation; Pi Stuff does not claim
to fix or mask that Host behavior. Pi Stuff's added work is bounded by the number of message components and terminal
columns rather than cumulative Thinking length.

## Rejected alternatives

- Hiding, replacing, or slowing the spinner would remove the symptom while the Host remains blocked.
- Moving every synchronous computation or filesystem read to a Worker would add speculative concurrency and lifecycle
  machinery without evidence that those paths violate the liveness contract.
- Claiming end-to-end liveness for Host-owned rendering would cross the Package boundary and misstate Pi Stuff's
  certified behavior.
- Parsing a bounded source tail cannot identify the last terminal row after native Markdown wrapping, while parsing
  semantic blocks restores the removed full-source heuristics.
- A periodic refresh timer adds work without new Provider deltas and competes with the Host-owned Vibe Line Spinner.

## Consequences

Each violating Capability keeps its own subprocess, Worker, cancellation, and error semantics while removing the
Host-thread wait at that boundary. The former semantic-block selection and width-fitting source projection was removed
after continuous cumulative Thinking showed that it still competed with the Vibe Line Spinner on the synchronous
Markdown path. The latest-row adapter must match an otherwise identical unadapted Host under paired real-Host Vibe
Line sampling and pass the certified real-PTY 500-millisecond gate. Component microbenchmarks report its incremental
cost but do not replace liveness evidence. Unsupported platforms may receive the same structural fix when it is shared,
but are not certified by this decision.
