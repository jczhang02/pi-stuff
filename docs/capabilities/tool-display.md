# Tool Display

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/tool-display.md)

Tool Display turns Tool execution into compact, inspectable activity without changing the Tool call, result, or
permission flow.

## Quick start

Run several Read, Grep, Find, or List operations in Pi. Continuous retrieval activity collapses into one row in the
transcript.

Press `Ctrl+O` to expand eligible transcript activity, or run:

```text
/tools
```

Select an activity and press Enter for details. Use `/ui` to toggle the running timer.

## Retrieval Groups

Continuous native Read, Grep, Find, and List calls form one Retrieval Group. The row summarizes ordered Search, Read,
and List work and keeps failed, rejected, or cancelled members available for inspection.

A run longer than one display budget becomes ordered bounded segments. `Continued` and `continues` markers identify
adjacent segments without scanning unseen members or claiming a total for the complete run.

A Retrieval Group ends when the conversation reaches work with a different meaning, including:

- Bash, Web, MCP, media, mutation, Agent, Task, Background, or Goal activity;
- a Read of an exact `SKILL.md` resource;
- an unknown or third-party Tool;
- visible prose, Thought content, or another visible conversation boundary.

Grouping is presentation-only. Reload, resume, tree navigation, and compaction rebuild the same view from Session
records without changing model-visible messages.

## Operation Blocks

Standalone operation blocks cover Bash, Write, Edit, Patch, Background output, and outer Code Mode failures that do not
already have a visible owner.

Each block leads with the operation identity and follows with bounded outcome evidence. Examples include command and
exit state for Bash, line count and final content for Write, change counts and diff evidence for Edit, and per-file
statistics for Patch. Source caps apply before splitting, diff projection, wrapping, or highlighting.

Agent delegation uses Agent Lifecycle Rows, with `/agents` as the inspection and control surface. Task bookkeeping and
transparent infrastructure activity stay out of the compact transcript but remain available through `Ctrl+O` and
`/tools`. Agent-related Tools registered through the shared Tool seam use the same bounded rows; `/agents`, child
transcripts, continuation, cancellation, and execution policy remain Agents-owned.

## Activity states

Active rows use present-tense labels and may show elapsed time. Settled rows show explicit success, failure, rejection,
cancellation, or empty-result evidence. Color supplements the icon and state word; it is never the only signal.
A later successful invocation never rewrites an earlier failure; a Retrieval Group containing both remains a warning.

Malformed historical data or a rendering failure falls back to a bounded generic row so Tool history remains
inspectable.

## Bounded display work

Compact, Expanded, Formatted, and Raw views bound arguments, results, object depth, item counts, nested operations,
media, lines, and bytes before presentation callbacks or allocation-heavy formatting run. MCP previews, Code Mode
envelopes, Agent Tool rows, and Operation Blocks use the same rule. Oversized values show a truncation or omission
marker; an exact omitted count appears only when already known without another scan.

These limits change only the display projection. Full Tool arguments, results, Provider context, and canonical Session
records remain unchanged.

## `/tools`

`/tools` takes no arguments. It opens the newest bounded history page and includes `Load older activities…` when more
records exist. Selecting that row loads exactly one older bounded page; ordinary navigation never starts hidden
loading. Repeated loads can reach the earliest Session Tool record while preserving source order.

| Key | Action |
| --- | --- |
| Up / Down | Move between activities or calls |
| PageUp / PageDown | Move by a page |
| Home / End | Jump to the first or last item |
| Enter | Open the selected group or activity |
| `r` | Toggle Formatted and Raw detail |
| Escape | Return or close |

Formatted detail uses semantic sections for everyday reading. Raw detail is the bounded protocol view. Each mode is
capped at 240 lines and 24 KiB.

## Responsiveness contract

On the certified Linux x64 Host, Pi Stuff-owned Tool Display must expose the first Tool UI, input echo, and selection
feedback within 150 ms, and must not leave one visible Vibe Line Spinner frame unchanged for more than 200 ms while a
Tool is active. The shared 500 ms liveness check remains a severe-failure backstop. Host-native and third-party
renderers remain outside this guarantee.

## Running timer

The `Tool running timer` setting in `/ui` is on by default. It adds elapsed time only to long-running active rows and
groups; settled summaries do not keep a timer.

## Native behavior

Tool Display changes rendering only. Pi still owns Tool schemas, execution, permissions, lifecycle, and result data.
Calls without an owned renderer retain Pi's native presentation.

## See also

- [Tool Display Module README](../../packages/pi-stuff/src/tool-display/README.md)
- [Conversation UI](conversation-ui.md)
- [Command reference](../reference/commands.md)
- [DESIGN.md](../../DESIGN.md)
- [Bound Tool Display before projection](../adr/0028-bound-tool-display-before-projection.md)
