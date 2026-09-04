---
status: accepted
amends: 0025-protect-vibe-line-spinner-liveness
---

# Bound Tool Display before projection

## Context

Tool Display once derived failure-recovery identities by recursively sorting and hashing complete Tool arguments. A
certified Pi 0.84.4 PTY reproduction with 100,000 object fields blocked the Host thread for 568–681 ms before the Tool
row appeared; input and the Vibe Line Spinner stopped during the same interval. Disabling only that display calculation
reduced first-UI latency to about 90 ms. Other Tool Display paths could likewise traverse complete arguments, results,
nested operations, media, or Session history before applying a visible cap.

ADR 0025 made 500 ms the cross-Capability severe-stall threshold. Tool interaction needs a stricter contract because a
pause immediately before a Tool row makes a healthy run look hung.

## Decision

Every Pi Stuff-owned Tool Display path must bound arbitrary data before presentation callbacks, serialization, parsing,
diff projection, wrapping, highlighting, or other allocation-heavy work. Compact, Expanded, Formatted, Raw, MCP,
Operation Block, Code Mode envelope, Agent Tool row, replay, resume, and `/tools` projections share fixed internal item,
key, depth, operation, media, line, byte, and history budgets. Oversized data receives truthful omission evidence; an
exact omitted count is used only when it is already available without a full scan. Canonical Tool arguments, results,
Provider context, and Session records stay complete.

Tool Activity failure recovery is removed rather than cached or deferred. Each failure remains historical after a
later success, and mixed Retrieval Groups remain warnings. This decision does not change retries or Agent recovery.

`/tools` accepts no arguments and materializes only the newest bounded page. `Load older activities…` loads one older
page on explicit selection. Continuous retrieval that crosses a member or page budget becomes ordered continuation
segments, and a visible boundary prevents a continuation claim. Internal Tool IDs remain for projection and selection.

The stricter certified targets are 150 ms from Tool start to first Tool UI, input echo, and selection feedback, plus no
unchanged visible Vibe Line Spinner frame beyond 200 ms. ADR 0025's 500 ms assertion remains a separate severe-failure
backstop. The guarantee includes Suite-owned Agent-related Tool rows but excludes `/agents`, delegated execution policy,
Host-native renderers, and third-party Extension renderers.

Supporting Suite surfaces must not turn a Tool repaint into a full Context scan. While the Host is busy, the Statusline
keeps its last settled context-usage value and refreshes it after the Host becomes idle. The Context Engine Worker omits
context-usage reads from Tool lifecycle and Session-only synchronization paths where the pinned engine consumes only
Session metadata or Assistant usage.

## Rejected alternatives

- Caching, deferring, or simplifying the recovery hash retains a display feature whose value does not justify its work.
- Applying a final slice after stringification, parsing, sorting, or rendering caps output but not Host-thread work.
- A background full-detail builder adds lifecycle and cache ownership while still encouraging unbounded display data.
- Treating 500 ms as ordinary Tool responsiveness preserves a visible freeze even when the severe backstop passes.

## Consequences

Normal-sized Tool content retains semantic presentation, while object-shaped MCP arguments may show an explicit
omitted-preview marker because JavaScript cannot enumerate only a bounded prefix of arbitrary object keys. Long Sessions
open on recent activity and retain early records through explicit paging. Code Mode execution and media for Provider
context, Agent lifecycle, Tool permissions, and Session persistence keep their existing owners and data.
During active work, the Statusline may show the preceding settled usage value until Pi reaches its next idle repaint.
