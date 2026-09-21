# Claude Code tool folding and prototype revision

[简体中文](../i18n/zh-CN/research/claude-code-tool-folding-2026-09-21.md)

This study updates [#101](https://github.com/jczhang02/pi-stuff/issues/101). It separates activity grouping from the output preview inside one tool. The [runnable prototype](../../prototypes/ui-session/README.md) now implements the selected rules below. Earlier prototype claims about a two-call threshold and Thoughts boundaries are superseded.

## Direct client evidence

We ran the installed official Claude Code 2.1.261 binary, SHA256 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`, under Terminal Control 1.2.1. Fourteen runs cover seven inputs in classic and fullscreen modes, at 100 columns and 40 rows. [All 28 screens, tool results and raw terminal streams](../../prototypes/ui-session/folding-reference/index.html) are retained. The earlier [20-run study](claude-code-result-marker-2026-09-21.md) covers output previews, Edit, running and cancellation.

The real CLI executed local Read and Bash tools in an isolated temporary project. Responses came from a localhost Anthropic-compatible SSE fixture, not a live model. Separate HOME/config, an explicitly approved dummy key, no MCP servers, and a fixed light theme avoided account access and host configuration changes. `CLAUDE_CODE_NO_FLICKER=0/1` selected the two display modes. Each input sequence below ended with a `PROBE_COMPLETE` text response. Compact capture preceded Ctrl+O and expanded capture. ANSI is gzip-compressed without byte normalization; formatted exchange JSON preserves message values. The method and invocation flags are documented in the earlier study.

| Fixture    | Actual sequence across responses                          | Observed compact behavior in both modes, except where stated                                                       |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| cross      | Read a.txt → Read b.txt                                   | One `Read 2 files` summary. API response boundaries do not split it.                                               |
| prose      | Read a.txt → visible text + Read b.txt                    | Two `Read 1 file` summaries separated by the text.                                                                 |
| whitespace | Read a.txt → whitespace text + Read b.txt                 | One summary. Whitespace is transparent.                                                                            |
| bridge     | Read a.txt → Bash true → Read b.txt                       | Classic keeps Bash separate; fullscreen says `Read 2 files, ran 1 shell command`.                                  |
| mixed      | Read a.txt → Bash grep alpha a.txt → Bash ls → Read b.txt | Search/read/list share a summary. These are real Bash calls classified by their command, not native Grep/Ls calls. |
| readfail   | Read a.txt → Read missing.txt → Read b.txt                | `Read 3 files` hides the failure until expansion. Recorded `tool_result.is_error` proves the missing read failed.  |
| thought    | Read a.txt → thinking block + Read b.txt                  | `Thought for 1s, read 2 files`. Expansion restores Read → thinking → Read.                                         |

These are observations of this binary and fixture. They do not establish Web, MCP, permission, compaction or user-turn behavior in this version. The earlier official 2.1.220 investigation in pi-stuff-old covers user-turn boundaries. Classic Bash output previously showed three preview lines and a hidden-line count; fullscreen folded ordinary shell calls more aggressively. There is no single universal Claude folding policy.

## Source comparison

The inspected pi-stuff-old snapshot is `21b636eaccc487a08362165ec69ffe364e8730fb`. Its `packages/pi-stuff/src/tool-display/retrieval-groups.ts` classifies Read/Grep/Find/Ls using retrieval metadata and treats visible text, visible Thinking, user turns, mutations, ordinary Bash and visible custom messages as boundaries. `activity-presentation.ts` projects a collapsed leader or the original ordered calls without changing model-visible messages. `render.ts` gives Bash a three-line compact preview. Retrieval failures can remain inside the old group; transparent infrastructure failures are handled separately. The old implementation is a local source reference, not newly imported code.

We also inspected the unofficial [source snapshot at 6f6f12b](https://github.com/tanbiralam/claude-code/tree/6f6f12b37f529488b10e53928dd5508bb93535c7). Its provenance and relationship to the installed binary are not established. No implementation was copied. [collapseReadSearch.ts](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/collapseReadSearch.ts) suggests cross-response retrieval grouping, transparent thinking/whitespace, and fullscreen shell grouping. Those hypotheses agree with the direct probes above; that agreement does not authenticate the snapshot. [groupToolUses.ts](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/groupToolUses.ts) describes a separate same-response/same-tool grouping layer. We did not implement that layer or infer general MCP eligibility from the snapshot.

## Selected prototype behavior

| Layer            | Rule                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity summary | One successful Read/Grep/Find/Ls already becomes a one-line summary. Adjacent eligible calls increment counts. Counts represent calls, not unique paths or returned matches. No `⎿` on this summary.                                                                  |
| Thoughts         | Completed Thoughts can join an adjacent retrieval group; elapsed seconds appear in the summary. Expanded children preserve original order and individual disclosure. Standalone Thoughts keep `Thoughts for Ns`. Running Thinking remains visible.                    |
| Boundaries       | Visible assistant text, user input, statuses, Bash, Edit, Write, Web, failure, cancellation and truncation warnings end the group. Whitespace assistant entries are omitted by the static projection. Running tools remain outside until they succeed.                |
| Group disclosure | Click the summary to reveal compact children, then click one child for detail. Ctrl+O expands or collapses all. Existing child state survives group growth. This two-stage interaction uses Pi's mouse support, not a new inspector.                                  |
| Tool output      | Bash retains the first three rendered output rows; running tools retain the last two. Edit retains three changed rows with syntax highlighting. Write/Web/retrieval bodies otherwise open on demand. Hidden rendered-row counts and upstream truncation are distinct. |
| Errors           | A failed tool retains its own title and cause. Failed Bash also retains three evidence rows. Assistant failure/interruption remains plain text.                                                                                                                       |

The explicit differences are deliberate: Thinking continuity follows current Claude rather than the old Pi boundary. Ordinary Bash stays separate, including shell commands such as cat/grep; no shell classifier is added to this prototype. Failed retrieval stays visible rather than disappearing into a successful-looking count. These are preview choices, not a production contract or a claim of exact Claude parity. User messages, statusline and welcome remain as previously agreed; no Agents, Todo or background UI is introduced.

The `folding` scene demonstrates Read → Thoughts → Grep, a prose boundary, Find → failed Read → successful Read, then Bash. `live` now includes thinking between retrieval calls. Static `tools` uses the same grouping policy as the conversation. A single tool's child block keeps one `⎿` with aligned continuation, while separate expanded tools each own a connector.

## Verification and limits

The capture driver exercises mouse group/child disclosure, the chronological position of grouped Thoughts, Ctrl+O, retained drafts, two-turn live progression, cancellation/retry, long-history navigation and 60-column reflow. Captures are real Pi 0.85.1 terminal output using Bun 1.4.0; tool execution inside the Pi prototype remains simulated. This verifies the throwaway interaction, not production persistence, arbitrary model responses or native compositor rendering. See PR #102 for the final command results and independent review.
