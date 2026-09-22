# Pi Stuff UI spec

[简体中文](i18n/zh-CN/ui-spec.md) · [Run the prototype](../prototypes/ui-session/README.md) · [Research](research/README.md)

## Review scope

Use this spec to review the conversation UI in the current prototype on `codex/ui-session-prototype`, product baseline `cd0f174`, Pi 0.85.1 and Bun 1.4.0. Production adoption is pending. Three unimplemented proposals appear at the end.

Preserve native user messages, footer, input and session controls. Todo, agents, Goal, background tasks, BTW, notification systems, session naming and a separate tool inspector are excluded. Native compaction/branch/skill/direct-shell output remains in the research inventory; old candidates do not establish new requirements.

[Messages](#conversation-frame-and-messages) · [Tools](#tool-presentation) · [Long sessions](#interaction-and-long-sessions) · [Open decisions](#proposals-awaiting-review-not-implemented)

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

Use a leading status dot, Action(target), then an outcome introduced by ⎿. One connector begins each visible child-result summary; wrapped summary continuations align with its text, body rows retain their own content inset. Independent expanded tools each own a connector. This is a semantic two-level structure, not a limit of two physical lines. Long expanded targets wrap; code retains syntax highlighting. Success, running, failure and cancellation use semantic colors plus text.

Edit and Write, Default, latte, 120 columns

![Edit and Write, Default, latte, 120 columns](../prototypes/ui-session/captures/changes-catppuccin-latte-120-main.png)

### Retrieval grouping and alignment

Successful Read/Grep/Find/Ls and WebSearch/WebFetch/WebRead form an activity summary starting with the first eligible success. Click the summary to reveal chronological compact tools; click one tool to inspect its body. Expanded tools align with ordinary tool rows, without extra nesting. The summary has a status dot and no ⎿. User turns, visible prose, Thoughts, ordinary Bash, writes, warnings, failure and cancellation separate groups. Running calls stay visible until success.

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

Edit uses a unified diff with one line-number gutter: deletions use old numbers, additions/context use new numbers. +/- signs and added/removed backgrounds preserve meaning alongside syntax colors. Old/new source is highlighted separately. Compact Edit shows at most six rendered changed rows; expanded Edit restores context and the full target. Wrapped rows do not repeat line numbers or signs. Write defaults to path, line count and the first three rendered rows of highlighted content. Short content appears in full; expansion reveals the remaining rows. Diff rows are authored fixture data.

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

The live script repairs pagination in two submitted turns, with read/search/Web/edit/write/test activity, a failed request, retry and continued history. Esc stops progression and retains the draft; resubmitting resumes the interrupted step. Submitting during execution first interrupts. After both scripted turns, later submissions recap existing results. Native scrolling and resize preserve access to full retained output. Verify at 120/80/60 columns with Latte and Mocha.

Live session, Second turn complete, latte, 120 columns

![Live session, Second turn complete, latte, 120 columns](../prototypes/ui-session/captures/live-catppuccin-latte-120-followup-complete.png)

Live session, Narrow history, latte, 60 columns

![Live session, Narrow history, latte, 60 columns](../prototypes/ui-session/captures/live-catppuccin-latte-60-narrow-scrolled.png)

## Evidence and acceptance boundary

Images are actual Pi terminal exports with offline content/execution. Font stack: JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono. Foreground launch emits no terminal palette setters/resets and does not modify Ghostty. The launcher supports Catppuccin; other/automatic themes require an explicit supported theme. See the [capture appendix](../prototypes/ui-session/captures/README.md) and [run/verification instructions](../prototypes/ui-session/README.md).

## Proposals awaiting review, not implemented

| Proposal                                                                        | Current prototype                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Remove permanent collapse, replace generic expand with hidden-content summaries | Existing tool/group text suffixes remain             |
| Retain some context in compact diffs                                            | Up to six changed rows; context appears on expansion |
| Lead running tools with an existing action description                          | Current heading remains tool name and target         |

[建议依据: Claude 实测](research/claude-code-ui-details-2026-09-22.md)
