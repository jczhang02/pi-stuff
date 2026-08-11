---
status: accepted
---

# Group complete Tool activity between Narrative Boundaries

Pi Stuff will evolve from grouping only adjacent successful exploration calls to building one display-only Tool Activity Group for every continuous execution phase. Every participating Tool call and result between adjacent Narrative Boundaries belongs to that group regardless of Tool kind or terminal state. Assistant prose, user input, and visible model-context Custom Messages close the group; Thinking remains visible but neither enters nor splits it. Hidden state and branch/compaction metadata do not create boundaries. This removes per-Tool transcript repetition across model Tool round-trips without changing Tool protocol events, model-visible results, or session history.

## Consequences

The group summary must represent consequential work, failures, cancellation, and background handoffs honestly rather than presenting every group as successful exploration. Claude Code 2.1.220 behavior and the pinned non-official source snapshot are the default presentation reference; every deviation must be explicit rather than invented ad hoc. The accepted baseline is:

- Every Tool type participates, including consequential, Agent, backgrounded, failed, rejected, and cancelled calls.
- Pure infrastructure operations such as context reduction and internal discovery/wrapper coordination remain members but contribute no successful summary clause. Their failures still contribute to issue state. Memory, Note, Task, Goal, and Agent coordination are user-meaningful and are not silent.
- One Tool is enough to create a group, and no count or elapsed-time limit splits a group.
- Running summaries use present-tense semantic clauses; settled summaries use past tense. Outcome-bearing work precedes execution, retrieval, and memory clauses.
- Object-oriented actions count unique targets: files for Read/Edit/Write; Task, Note, and Memory identities; search patterns or queries; and fetched pages. Execution-oriented actions count invocations: Bash and MCP calls, actual Agent launches, and terminal issue states. Parallel Agent calls count their launched children. Clauses are not capped or replaced with `+N more`; one logical summary may wrap naturally at the terminal width.
- Settled groups occupy one logical summary. Running, failed, or backgrounded groups may use one additional indented status row.
- The primary summary contains semantic verbs and counts, never a raw command, full path, or trailing `done` label. A running group may show one Tool-supplied short activity description on the indented row; it remains stable for at least 700 ms and is capped at two physical terminal rows or about 160 display cells. Paths preserve the basename and nearest useful directory while eliding the middle. An unavailable short description falls back to the semantic action name, never raw Bash or arbitrary full arguments. The hint disappears when the group settles.
- Failure, rejection, or cancellation keeps the group folded and reports each state separately. The indented row shows the first failure as the likely root cause plus a remaining-issue count. This is a deliberate safety deviation from Claude Code.
- The group appears at its first Tool call and remains anchored there. Later Thinking stays visible at its native Host position while the same group continues to aggregate subsequent Tools. This deliberately differs from Claude Code's deferred-Thinking projection: Pi exposes no supported native Assistant-message renderer or reorder seam, and the compact row must not jump between Tool batches.
- A group is active from its first Tool while any member is running or the Agent is still loading with no later narrative content. Counts are monotonic across streaming windows; parallel calls use Assistant source order. A Bash call running longer than two seconds may add elapsed time and output-line count to the active hint, but settled summaries omit duration.
- A background launch settles in its originating group as `Launched N background tasks`. Later completion is a separate Narrative Boundary; successful consecutive Background Shell completions may aggregate, while failed or stopped completions remain individually visible. Historical groups are never reopened.
- The main transcript reports only aggregate Agent activity. `/agents` remains the sole authority for per-Agent progress, completion, and result inspection.
- Tool chrome around a real media result collapses, but the media body remains visible below the group as product output.
- Participation is opt-in through the shared presentation contract, matching Claude Code's classifier contract. Unsupported third-party Tool rows remain standalone and act as compatibility boundaries rather than being unsafely overridden or double-counted.
- Host `Ctrl+O` restores every controlled member in the global transcript in the native persisted branch order, including Tool batches interleaved with later Thinking. `/tools` opens with the Activity Group selected; Enter reveals every member locally. A Group's member list is complete: it is rebuilt lazily from the public current-branch Session entries rather than silently inheriting the 768-operation process-cache limit. Individual text previews may remain bounded.
- Every compact Group carries a dim `ctrl+o to expand` hint. Active Groups use the animated Tool marker. Settled Groups color that marker by effective outcome: success or deterministic recovery is green, unresolved mixed work is yellow, and only work with no meaningful successful effect is red. Rejection or cancellation alone is yellow; issue counts remain explicit.
- Assistant prose, compact Activity Groups, and expanded transcript Tool rows use U+2022 followed by one space. Same-level wraps retain that two-cell marker slot. Fleetview, Command Dialog, and other controls keep their own glyph and gutter semantics.
- Stable structured Tool outcomes and Claude-style conservative Git outcomes (commit, push, merge/rebase, and PR identity) lead the summary. Generic stdout is never interpreted as test, build, or deploy success.
- Groups remain derived projections, not durable session entities. Reload, resume, tree changes, and compaction deterministically recompute the current visible branch without writing group IDs or summaries to JSONL.
- Complete Tool Activity Grouping directly replaces Exploration Grouping. There is no legacy mode, experiment flag, or permanent settings fork.

## Semantic taxonomy

The Pi Stuff Package currently exposes 28 root Tool names plus the conditional `subagent_supervisor` and `intercom` parent-channel aliases, all registered through the shared presentation contract. Their registration paths, inputs, result contracts, count identities, and current gaps are mapped in [the Tool activity taxonomy](../research/pi-stuff-tool-activity-taxonomy-20260806.md). Compact summaries use a smaller semantic vocabulary rather than exposing those implementation names. Within a group, clauses appear in this fixed order:

1. **Explicit outcomes:** completing a goal, reporting a goal blocker, conservative Git commit/push/merge/rebase/PR outcomes, and generated images.
2. **Content and state changes:** changed files (the unique union of Write, Edit, and Apply Patch targets), updated Tasks, updated Memories, and saved Notes.
3. **Delegation and background work:** foreground Agents, Agent management, background Agent launches, detached commands, Monitors, and background inspection or stopping.
4. **Execution and external calls:** foreground commands, MCP Tool invocations, and MCP server connections.
5. **Retrieval:** local patterns, web queries, pages, cached passages, files, directories, viewed images, Context history queries/ranges, Task inspection, and Memory or Note reads.
6. **Terminal issue suffix:** failed, rejected, and cancelled call counts.

Representative settled clauses are `Completed goal`, `Reported goal blocker`, `Committed cf12251`, `Pushed to main`, `Created PR #42`, `Generated 2 images`, `Changed 4 files`, `Updated 3 tasks`, `Ran 2 agents`, `Launched 3 background tasks`, `Ran 4 commands`, `Invoked 2 MCP tools`, `Searched 3 patterns`, `Searched 2 web queries`, `Fetched 4 pages`, `Read 5 files`, `Listed 2 directories`, `Viewed 1 image`, `Searched history`, `Reviewed 2 history ranges`, and `Checked 6 tasks`. Present-tense forms replace them while active. Singular/plural grammar and clause capitalization follow Claude Code's sentence style.

`ctx_reduce` and equivalent pure infrastructure wrappers contribute no successful clause. A successful group containing only silent infrastructure has no compact row at all, but global expansion still restores it. An issue in such a group produces an explicit `Internal operation failed` row.

## Compact and expanded projections

Compact mode hides every member's raw arguments and textual result body. It retains only the semantic summary, one active or issue hint when applicable, interactive permission UI, and real media bodies. This includes hiding Bash stdout, Web result text, Agent return summaries, Goal evidence, and Task, Memory, or Note result text. `/agents` remains the detailed Agent authority.

Real media returned by Read, MCP, View Image, Image Generation, or a future contracted Tool remains visible beneath the Activity Group. The implementation must bridge media through the shared contract rather than preserving only the Codex Tools that already expose `resultBody`.

`Ctrl+O` restores the original controlled Tool rows and their bounded result renderers globally. `/tools` restores one selected group's complete member list and bounded per-member text. Neither detail path changes model-visible Tool results or persisted session entries.

## Contract enforcement

Every Tool registered by the Pi Stuff Package must declare structured Activity metadata: semantic contribution, count identity, bounded active target, terminal-state interpretation, optional structured outcome extraction, silent-success policy, and media projection. A generated or registration-level coverage test enumerates the Suite Tool set and fails CI when any owned Tool lacks metadata. There is no generic `Used N tools` or raw-argument fallback for owned Tools.

Unsupported third-party Tools remain standalone compatibility boundaries. Child-only Agent communication surfaces use the same Agent coordination vocabulary when they are present.

## Acceptance criteria

Implementation is complete only when all of the following are verified:

1. One Tool and arbitrarily many Tools across multiple Assistant Tool round-trips form one Activity Group until visible Assistant prose, user input, or a visible model-context Custom Message creates a Narrative Boundary. Thinking and hidden branch/compaction state do not split the group.
2. Every current Suite Tool is covered by structured Activity metadata, and CI rejects an uncovered future owned Tool. `ctx_reduce` succeeds silently but contributes issue state on failure.
3. Compact mode contains no raw command, full path, Tool name list, trailing `done`, member argument block, or textual member result. Semantic clauses, issue disclosure, interactive permission UI, and real media are preserved.
4. Running presentation starts with the first Tool, stays active between Tool batches while the Agent is loading, updates monotonically, uses source order for parallel calls, holds targets for at least 700 ms, and caps the active hint at two rows or about 160 display cells. Long Bash progress appears only after two seconds; settled summaries omit duration and target.
5. Success, failure, rejection, cancellation, permission wait, Agent foreground/background, detached command, Monitor, media, and unsupported-third-party scenarios use the accepted lifecycle and status grammar. The first failure is visible with a remaining-issue count.
6. Later Thinking remains at Pi Host's native position while the group stays anchored at its first Tool. No Host patch, native Assistant renderer override, or stateful Markdown-reordering workaround is introduced.
7. Background launches settle in their originating group. Later completion notifications never reopen history; consecutive successful Background Shell completions may aggregate, while failed or stopped completions remain visible.
8. `Ctrl+O` restores all controlled rows in native persisted branch order. `/tools` reconstructs every member of the selected group from the current Session branch without the process-cache item cap silently dropping members; text previews remain bounded.
9. Reload, resume, tree navigation, branch changes, compaction, settled replay, and post-compaction turns deterministically rebuild the same projection from public read-only Session APIs without writing group metadata to JSONL.
10. Real Pi PTYs at 100×32 and 64×28 cover CJK, natural summary wrapping, resize, streaming, permissions, mixed Tool families, issue states, background completion, Agent activity, media, `Ctrl+O`, and `/tools`. Model-visible results, Tool schemas, active membership, session JSONL, and execution behavior are byte-for-byte or structurally unchanged as appropriate.
11. Long-session reconstruction and streaming invalidation remain bounded and are benchmarked against the shipped Exploration Grouping baseline. No per-frame full-session scan or unbounded timer, row, media, or detail cache is introduced.
12. Complete Tool Activity Grouping directly replaces Exploration Grouping with no legacy mode, experiment flag, or permanent settings fork.
