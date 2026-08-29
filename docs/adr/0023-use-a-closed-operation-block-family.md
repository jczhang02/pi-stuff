---
status: accepted
---

# Use a closed Operation Block family

## Context

Tool UI has two separate surfaces. The Transcript has Compact and Expanded forms; `/tools` has List and Detail, with
Formatted and Raw representations inside Detail. The former generic standalone Tool row did not preserve enough
evidence for file mutations, while applying a Bash-like shape to every Tool would erase useful domain distinctions.

ADR 0022 already restricts grouping to native retrieval. This decision concerns only independent Tool Activities and
does not change Retrieval Group membership.

## Decision

Pi Stuff uses an **Operation Block** only for Bash, Write, Edit, Patch, `background` with `action=output`, and an outer
Code Mode error, rejection, or cancellation that no nested Tool or media projection represents. The Transcript grammar
is a required `Tool(operation identity)` parent followed by indented `⎿ outcome evidence`. Parentheses are part of the
grammar. No presentation metadata may opt another Tool into this closed family.

Write uses `Write(path)`, reports `N lines written`, and shows the syntax-highlighted final content rather than a diff.
Compact shows ten lines and an exact omitted-line expansion hint; Expanded is capped at 240 lines and 24 KiB. Edit uses
`Edit(path)` and shows exact `+A/-D` statistics with a syntax-highlighted old/new-line diff. Patch uses `Patch(path)` for
one file and `Patch(N files)` for multiple files, then total and per-file `M/A/D/R` statistics plus bounded changed-line
evidence. Compact diff evidence is capped at 2 KiB and ten changed lines, with at most four changed lines per Patch file
plus adjacent context; Expanded diff evidence is capped at 240 lines and 24 KiB. Every cap reports the exact omitted
amount. A pure rename reports `+0/-0` and `renamed without content changes`. When content evidence exists, generic
mutation-success prose is omitted. Error, rejection, cancellation, partial-write, and unavailable-evidence states keep
their explicit state and never infer successful evidence from unverified arguments.

Successful pure JavaScript Code Mode has no outer row: nested Tools and media are its visible authority. Only an outer
issue unmatched by those projections receives a fallback Operation Block.

The `subagent` Tool instead uses an **Agent Lifecycle Row**. Foreground work identifies Agent, Task, state, and useful
duration; Expanded lists each member and bounded foreground result evidence. A background launch and its later
model-invisible completion row remain separate chronological events. `/agents` stays the sole live control and complete
evidence authority.

Operation Block grammar belongs only to the Transcript. `/tools` List rows expose identity, operation, outcome, and
explicit state. Formatted Detail uses Tool-specific semantic sections; Raw remains the complete bounded protocol
inspection authority. Formatted and Raw are two representations of one selected call, not separate Dialog modes.

## Consequences

Native Read, Grep/Find, and List remain the only Retrieval Group members. MCP, Web, media, Agent, Task, Goal, Context,
and infrastructure Tools retain their domain-specific rows. File changes are inspectable directly in Compact and
Expanded Transcript UI, while `/tools` retains readable semantic detail and exact protocol evidence without duplicating
the Transcript's `⎿` shape.
