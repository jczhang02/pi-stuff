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

### Accepted `/tools` readability update

**Decision update:** 2026-08-17
**Status:** Implemented on 2026-08-18.

This update applies only to the `/tools` Command Dialog. It does not change the compact Conversation Transcript, its
small `•` marker, global `Ctrl+O` expansion, Tool-owned result renderers, model-visible results, or persisted protocol
data.

The list is an activity inspector, so the human-readable Activity summary is its primary label. A row is the `›`
selection marker, summary, then a right-aligned lifecycle icon with an optional invocation count. Use `●` running, `✓`
success, `×` error, `!` rejected, and `■` cancelled. `›` remains selection only. Say `N calls`, not `N tools`, because
the number counts invocations. Drop the count before the summary or lifecycle icon at narrow widths.

Keep the newest Activity first and retain each Activity's position while it changes state. Up and Down select one row;
PageUp/PageDown and Shift+Up/Down move one visible page. Use the existing `… N newer` and `… N older` window instead of
a scrollbar or a second pagination mode. The Footer advertises page movement only when the list overflows.

At 96 columns and wider, a non-empty Activity list and selected detail share one fixed 18-row Dialog. One continuous
heavy top rule spans the complete surface and one heavy `┃` divider separates the panes. Switching Activities keeps
the outer geometry fixed. Empty and narrow states remain single-column.

The detail Header uses the selected Activity summary as its visual anchor and retains the full lifecycle word and call
count. A grouped Activity has two sections:

```text
Tools / Read 4 files and searched 2 patterns
✓ success · 6 calls

◆ Calls
› ✓ Read · packages/pi-stuff/src/tool-display/tool-dialog.ts
  ✓ Search · toolStateGlyph

◆ Detail · formatted
Read
Target: packages/pi-stuff/src/tool-display/tool-dialog.ts
Summary: 58 lines returned
```

`Calls` uses Up and Down to select an invocation. A singleton Activity omits that section and opens its Detail
directly. The compact `◆` exists only on a section heading; member rows keep the native `›` selection grammar,
and Tool-owned formatted content keeps its own meaningful hierarchy rather than being forced into a generic table.

Formatted Detail uses the selected Tool's existing title, target, summary, and bounded Tool-owned detail lines. Bash,
Read, Search, media, and other Tool families therefore remain visibly different where their content differs. Raw mode
is explicitly titled `Raw protocol` and retains the accepted call ID, Tool name, arguments, result, and details. `r`
toggles formatted and Raw; Escape from Raw returns to formatted before the next Escape returns to the list.

PageUp/PageDown and Shift+Up/Down scroll selected-call content; Home and End remain supported without requiring Footer
space. A running Detail follows appended content only while its viewport is at the bottom. Upward movement freezes the
reading position, displays a bounded newer-content notice, and resumes following when the viewport returns to the
bottom.

The implementation now uses the readable Activity summary as the Header, removes duplicate State/Summary fields,
renders distinct lifecycle icons, says `calls`, omits the singleton Calls list, and routes PageUp/PageDown plus
Shift+Arrow through one paging path. Focused tests cover fixed split geometry, the empty single-column state, lazy
formatted/Raw detail, overflow, live follow behavior, and the Escape chain; the real PTY verifier covers Host rendering.

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
