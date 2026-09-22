# Pi Stuff UI spec

[简体中文](i18n/zh-CN/ui-spec.md) · [Run the prototype](../prototypes/ui-session/README.md) · [Research](research/README.md)

## Review scope

Use this spec to review the conversation UI in the current prototype on `codex/ui-session-prototype`, product baseline `cd0f174`, Pi 0.85.1 and Bun 1.4.0. Production adoption is pending. One unimplemented proposal appears at the end.

Preserve native user messages, footer, input and session controls. Todo, agents, Goal, background tasks, BTW, notification systems, session naming and a separate tool inspector are excluded. Native compaction/branch/skill/direct-shell output remains in the research inventory; old candidates do not establish new requirements.

[Messages](#conversation-frame-and-messages) · [Tools](#tool-presentation) · [Long sessions](#interaction-and-long-sessions) · [Open decisions](#proposals-awaiting-review-not-implemented)

## Production implementation constraints

Performance and reuse of Pi take priority over pixel-for-pixel prototype fidelity. Preserve native presentation when reproducing a style would require disproportionate work. Acceptance must cover responsive input, scrolling, streaming, disclosure and resizing, plus comparison against the same workload without the new UI for runtime and memory regressions. Long sessions must not accumulate UI overhead without bound. Concrete scenarios and thresholds remain undecided. Prefer existing Pi capabilities and concise code. Production architecture and implementation are still under discussion; prototype approval does not settle them.

The current implementation scope changes Pi Stuff only. Prefer public Pi extension APIs; discuss monkey patches only for concrete problems, without pre-approving or categorically prohibiting a patch. The UI changes presentation only: preserve tool execution, model-visible results and stored session records. Apply the new presentation to old sessions without rewriting history; omit missing fields. Verify the assistant leading dot for list-first Markdown during real E2E after implementation, not through a separate investigation now.

Resolve technical choices from Pi and comparable packages before asking for product trade-offs. Reference: [pi-tool-display 0.5.0 at 91cef758](https://github.com/MasuRii/pi-tool-display/tree/91cef7580078371f8dc49a8607222807ad6a424d). Referencing its implementation does not authorize a new dependency or wholesale port.

Expose useful presentation options as configuration, with defaults matching the accepted prototype. Provide the complete option set in a configuration file and common controls in an interactive settings entry, including preview limits, retrieval grouping, diff presentation and UI feature toggles. Reuse existing Pi settings such as theme and Hide thinking. Configuration is global only, with no project overrides. Exact fields remain undecided.

Use the new presentation for Pi built-in tools and Pi Stuff tools. Preserve existing third-party custom renderers by default. Provide explicit per-tool takeover options; only opted-in tools use the generic presentation.

## Conversation frame and messages

### Welcome, user messages and footer

Welcome uses square corners (┌ ┐ └ ┘), retaining the old Pi Stuff boxed composition and responsive narrow layout. User messages use native UserMessageComponent, including Markdown, background and padding. The editor, scrolling and footer remain Pi-owned; no custom statusline is installed. Welcome inventory and model labels in the fixed fixture are samples, not live product counts.

Welcome, Default, latte, 120 columns

![Welcome, Default, latte, 120 columns](../prototypes/ui-session/captures/welcome-catppuccin-latte-120-main.png)

Welcome, square corners, mocha, 80 columns

![Welcome, square corners, mocha, 80 columns](../prototypes/ui-session/captures/welcome-catppuccin-mocha-80-main.png)

Live session, First turn complete, latte, 120 columns

![Live session, First turn complete, latte, 120 columns](../prototypes/ui-session/captures/live-catppuccin-latte-120-first-complete.png)

### Thoughts: hidden and visible

Both states retain a muted leading dot. Completed hidden form: • Thoughts · 4s. Visible form: • Thoughts: body, with upright muted Markdown on the same line, continuation aligned with message text and elapsed time adjacent to the end. Running form currently uses Thinking · Ns. There is no separate card or heading row. Pi hideThinkingBlock determines the default. Clicking changes one entry; native Ctrl+T or /settings changes the default and clears local overrides. Ctrl+O changes tools only.

Hidden Thoughts, Default, latte, 120 columns

![Hidden Thoughts, Default, latte, 120 columns](../prototypes/ui-session/captures/thoughts-catppuccin-latte-120-main.png)

Visible Thoughts, Default, latte, 120 columns

![Visible Thoughts, Default, latte, 120 columns](../prototypes/ui-session/captures/thoughts-visible-catppuccin-latte-120-main.png)

Visible Thoughts, Default, mocha, 80 columns

![Visible Thoughts, Default, mocha, 80 columns](../prototypes/ui-session/captures/thoughts-visible-catppuccin-mocha-80-main.png)

### Assistant errors and Esc

Assistant failure is plain status text and retains partial content. Esc interruption reuses native AssistantMessageComponent aborted presentation, including Operation aborted, color and padding. Do not create a tool-style assistant error card. The offline script still simulates cancellation; it does not establish production provider/tool abort semantics.

Response error, Default, latte, 120 columns

![Response error, Default, latte, 120 columns](../prototypes/ui-session/captures/response-error-catppuccin-latte-120-main.png)

Native interruption, Default, latte, 120 columns

![Native interruption, Default, latte, 120 columns](../prototypes/ui-session/captures/interrupted-catppuccin-latte-120-main.png)

Live session, Cancelled, latte, 120 columns

![Live session, Cancelled, latte, 120 columns](../prototypes/ui-session/captures/live-catppuccin-latte-120-cancelled.png)

## Tool presentation

### Tool invocation and result block

Use a leading status dot, Action(target), then an outcome introduced by ⎿. One connector begins each visible child-result summary; wrapped summary continuations align with its text, body rows retain their own content inset. One invocation can contain several child blocks: the result, an optional configured timeout, and an upstream truncation/log notice. Absent metadata adds no rows. Web technical metadata remains expansion-only. Independent expanded tools each own their result connector. This is a semantic two-level structure, not a limit of two physical lines. Compact titles wrap onto at most two rows, with an ellipsis only when more title text remains; expansion shows the full target. Code retains syntax highlighting. Success, running, failure and cancellation use semantic colors plus text.

Edit and Write, Default, latte, 120 columns

![Edit and Write, Default, latte, 120 columns](../prototypes/ui-session/captures/changes-catppuccin-latte-120-main.png)

### Retrieval grouping and alignment

Successful Read/Grep/Find/Ls and WebSearch/WebFetch/WebRead form an activity summary starting with the first eligible success. Click the summary to reveal chronological compact tools; click one tool to inspect its body. Expanded tools align with ordinary tool rows, without extra nesting. The summary has a status dot and no ⎿. User turns, visible prose, Thoughts, ordinary Bash, writes, warnings, failure and cancellation separate groups. Running calls stay visible until success. Retain Ls for actual `ls` tool calls, including its existing grouped and expanded presentation. A shell `ls` command invoked through Bash remains Bash.

Retrieval grouping, Default, latte, 120 columns

![Retrieval grouping, Default, latte, 120 columns](../prototypes/ui-session/captures/folding-catppuccin-latte-120-main.png)

Retrieval grouping, Group expanded, latte, 120 columns

![Retrieval grouping, Group expanded, latte, 120 columns](../prototypes/ui-session/captures/folding-catppuccin-latte-120-group-open.png)

Retrieval detail, Read expanded, latte, 120 columns

![Retrieval detail, Read expanded, latte, 120 columns](../prototypes/ui-session/captures/investigate-catppuccin-latte-120-read-open.png)

### Web tools

One tool-family layout covers web_search → WebSearch, fetch_content → WebFetch and get_search_content → WebRead. These are display labels, not API renames. Compact output gives the action and result. Expanded output retains query/URL, returned text, content identifier and paging/find metadata. Successful Web calls join retrieval groups; errors remain visible outside them.

Web tools, Group expanded, latte, 120 columns

![Web tools, Group expanded, latte, 120 columns](../prototypes/ui-session/captures/web-catppuccin-latte-120-group-open.png)

Web tools, WebFetch expanded, latte, 120 columns

![Web tools, WebFetch expanded, latte, 120 columns](../prototypes/ui-session/captures/web-catppuccin-latte-120-fetch-open.png)

### Edit, Write and syntax

Edit uses a unified diff with one line-number gutter: deletions use old numbers, additions/context use new numbers. +/- signs and added/removed backgrounds preserve meaning alongside syntax colors. Old/new source is highlighted separately. Compact Edit shows the first six rendered rows of the available hunk, including unchanged context. The small fixture fits its enclosing function, changes and closing line at wide widths. Expansion restores all remaining rows and the full target. Wrapped rows do not repeat line numbers or signs. Write defaults to path, line count and the first three rendered rows of highlighted content. Short content appears in full; expansion reveals the remaining rows. Diff rows are authored fixture data.

Edit and Write, Ctrl+O expanded, latte, 120 columns

![Edit and Write, Ctrl+O expanded, latte, 120 columns](../prototypes/ui-session/captures/changes-catppuccin-latte-120-keyboard-open.png)

Long diff, Default, mocha, 80 columns

![Long diff, Default, mocha, 80 columns](../prototypes/ui-session/captures/long-diff-catppuccin-mocha-80-main.png)

Long diff, Ctrl+O expanded, mocha, 80 columns

![Long diff, Ctrl+O expanded, mocha, 80 columns](../prototypes/ui-session/captures/long-diff-catppuccin-mocha-80-keyboard-open.png)

### Bash, empty results and truncation

The tool result summary uses deterministic data: Edit counts added/removed source lines, and Write counts written source lines. Bash shows the exit code and available elapsed time; it does not parse test counts or generate semantic summaries. Test results remain in the original output. The prototype uses authored summaries to demonstrate this rule; it does not implement result extraction.

Completed Bash retains three output rows. Running tools show the last two output rows; expansion restores retained detail. No output, no matches, tool failure and cancellation have distinct text. Upstream truncation and the retained log path remain visible even when folded. Expanding cannot restore content that the upstream tool never returned.

Running, Default, latte, 120 columns

![Running, Default, latte, 120 columns](../prototypes/ui-session/captures/running-catppuccin-latte-120-main.png)

Empty results, Default, latte, 120 columns

![Empty results, Default, latte, 120 columns](../prototypes/ui-session/captures/empty-catppuccin-latte-120-main.png)

Truncated output, Default, latte, 120 columns

![Truncated output, Default, latte, 120 columns](../prototypes/ui-session/captures/long-output-catppuccin-latte-120-main.png)

Tool failures, Default, latte, 120 columns

![Tool failures, Default, latte, 120 columns](../prototypes/ui-session/captures/failures-catppuccin-latte-120-main.png)

## Interaction and long sessions

Tools and retrieval groups have no `· expand` or `· collapse` suffix. When compact tool output hides retained rendered rows, show `n more lines` below the preview, separate from the outcome summary. Count only body rows, not title wrapping or metadata. Full output and empty bodies show no count. Native click and Ctrl+O toggling remain available even when both tool views look identical. Retrieval summaries remain clickable without a suffix.

The live script repairs pagination in two submitted turns, with read/search/Web/edit/write/test activity, a failed request, retry and continued history. Esc stops progression and retains the draft; resubmitting resumes the interrupted step. Submitting during execution first interrupts. After both scripted turns, later submissions recap existing results. Native scrolling and resize preserve access to full retained output. Verify at 120/80/60 columns with Latte and Mocha.

Live session, Second turn complete, latte, 120 columns

![Live session, Second turn complete, latte, 120 columns](../prototypes/ui-session/captures/live-catppuccin-latte-120-followup-complete.png)

Live session, Narrow history, latte, 60 columns

![Live session, Narrow history, latte, 60 columns](../prototypes/ui-session/captures/live-catppuccin-latte-60-narrow-scrolled.png)

## Evidence and acceptance boundary

Images are actual Pi terminal exports with offline content/execution. Font stack: JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono. Foreground launch emits no terminal palette setters/resets and does not modify Ghostty. The launcher supports Catppuccin; other/automatic themes require an explicit supported theme. See the [capture appendix](../prototypes/ui-session/captures/README.md) and [run/verification instructions](../prototypes/ui-session/README.md).

## Proposals awaiting review, not implemented

| Proposal                                               | Current prototype                            |
| ------------------------------------------------------ | -------------------------------------------- |
| Lead running tools with an existing action description | Current heading remains tool name and target |

[Remaining proposal source](research/claude-code-ui-details-2026-09-22.md) · [Adopted child-block and disclosure research](research/claude-code-default-tui-2026-09-22.md)
