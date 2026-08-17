---
status: accepted
supersedes: 0002-group-complete-tool-activity-between-narrative-boundaries
---

# Fold continuous retrieval segments

ADR 0002 grouped every controlled non-Bash Tool between Narrative Boundaries. That made compact transcripts dense in
meaning rather than rows, but it also hid the important separation between inspection and consequential work. Pi Stuff
will instead derive one Tool Activity Group for each continuous retrieval segment in a user turn. The individual Tool
calls, results, ordering, model-visible messages, and Session records remain unchanged.

## Eligibility

The planner classifies each invocation through one internal `retrieval`, `transparent`, or `boundary` decision shared
by streaming updates, Session reconstruction, and Code Mode envelope projection.

- Native Read, Grep/Find, and List invocations are retrieval.
- Bash is retrieval only when a conservative parse finds one or more effective commands and every effective command is
  `cat`, `head`, `tail`, `wc`, `jq`, `grep`, `rg`, `find`, `ls`, `tree`, or `du`, or the neutral command `echo`,
  `printf`, `true`, `false`, or `:`. Neutral-only Bash remains a boundary. Consequential `find` actions, unknown
  commands, background execution, output redirection, command substitution, malformed syntax, and any mixed command
  make the complete Bash invocation a boundary.
- `tool_search` and `ctx_reduce` are transparent. They remain recoverable in details but neither create a successful
  compact clause nor split adjacent retrieval.
- Edit, Write, Apply Patch, Web, History, Memory, Task, Agent, Background Work, Goal, Image, ordinary Bash, and unknown
  third-party or MCP Tools are boundaries. They retain their existing independent Tool rows. An MCP Tool may become
  retrieval only when its registered presentation metadata explicitly declares a retrieval category; names are never
  guessed.

One retrieval invocation is enough to form a group. Tool results and Thinking are transparent to its continuity.
Assistant prose, a boundary Tool, unknown visible context, user input, and turn completion close it. A later automatic
continuation starts a new group rather than reopening settled history.

Native Read counts unique canonical paths. Native Search and List count invocations. Bash retrieval counts each Bash
invocation once for every retrieval category it performs. Running summaries use present tense, the latest bounded
target, and the existing 700 ms target hold; settled summaries use past tense and omit the target. Failed, rejected,
and cancelled retrieval stays in its group, adds an explicit issue count, and exposes the first issue reason. This
issue disclosure remains the deliberate safety deviation from Claude Code.

## Detail projections

Pi's global `Ctrl+O` restores every folded member in persisted source order. It uses the Tool's existing title, target,
state, summary, and `presentation.detailLines` when available, otherwise bounded textual result content. It does not
add generic `Call`, `Result`, `Details`, argument, or protocol-ID sections. Retrieval Bash restores as the existing Bash
Operation Block.

`/tools` is the protocol inspection surface. Its list selects a group or independent Tool; its detail view keeps a
five-member selection window and builds content only for the selected invocation. Up/Down changes the member,
PageUp/PageDown scrolls its content, Home/End jumps, `r` toggles formatted and Raw protocol views, and Escape unwinds
Raw, detail, list, then the dialog. Formatted detail hides protocol IDs. Raw detail includes call ID, Tool name,
arguments, result content, and details. Both representations are capped at 240 logical lines and 24 KiB per selected
invocation.

The runtime stores only the derived group plan and small presentation callbacks. It does not cache a global Raw
transcript or duplicate large formatted and Raw bodies in `ToolActivityStore`. No Tool schema, dependency, setting,
compatibility mode, or persistent datum is added.

## Consequences and verification

Consequential work is visible at its original position and splits inspection on both sides. Compact replay and live
streaming use the same invocation policy, so resume, branch reconstruction, compaction, and Code Mode cannot silently
change grouping. The existing 20,000-call planner benchmark remains a release gate; formatted expansion of 1,000 short
results has the same 250 ms median ceiling, and the formatted path rejects Raw protocol headings.

Acceptance requires focused planner, renderer, dialog, reconstruction, Code Mode, and PTY coverage at 100×32 and
64×28, followed by `bun run check:fast` and one final `bun run check`.
