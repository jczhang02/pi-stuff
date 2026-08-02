# Claude Code Transcript Decisions from Source Inspection

**Date:** 2026-08-01  
**Product context:** Pi Stuff, with Pi 0.83.0 as the Host  
**Inspected snapshot:** `tanbiralam/claude-code` at commit `6f6f12b37f529488b10e53928dd5508bb93535c7`

## Provenance and limits

This is product-behavior research, not an implementation reference.

The inspected repository describes itself as a **leaked Claude Code source snapshot from 2026-03-31**. It also says that some original modules are absent and were replaced with stubs. The inspected tree has no `LICENSE` or `COPYING` file. Treat it as unlicensed material: do not copy, port, adapt, or mechanically translate its code into Pi Stuff. [`README.md:1-15`, `README.md:62-65`]

The exact Claude Code product version represented by this tree cannot be established. The reconstruction labels itself `1.0.0`, injects `1.0.0-dev` at build time, and the inspected Git commit was created after the claimed leak date. It is therefore **not evidence that Claude Code 2.1.220 behaves identically**. [`package.json:2-10`]

All source references below point to the inspected commit and are used only to identify observable product decisions. Current public behavior is cross-checked where possible against Anthropic's official [interactive-mode](https://code.claude.com/docs/en/interactive-mode), [fullscreen](https://code.claude.com/docs/en/fullscreen), [keybindings](https://code.claude.com/docs/en/keybindings), and [subagents](https://code.claude.com/docs/en/sub-agents) documentation.

## The central model: three different histories

The strongest source-level finding is that Claude Code does not have one undifferentiated “conversation output.” It has three layers:

1. **Session record:** semantic user, assistant, tool, attachment, and system events needed for recovery and model continuity.
2. **Default conversation:** a compact projection intended for ordinary work.
3. **Detailed transcript:** an inspection projection that reveals information suppressed or summarized in the default conversation.

This distinction explains many otherwise confusing choices. A tool result can be stored but render nothing; progress can be visible while running but never be stored; several stored tool calls can become one summary line; and the detailed transcript can reconstruct more detail without making the default conversation noisy.

## Conversation-content classes

| Class | Default conversation | Detailed transcript | Session persistence |
| --- | --- | --- | --- |
| User input | Visible as the turn anchor | Visible | Yes |
| Assistant prose | Streams, then remains as normal text | Visible | Yes |
| Thinking | Current thinking may be shown; completed thinking is suppressed in the normal projection | A selected/latest thinking block can be shown in detail | Stored as assistant content, but not treated as normal prose |
| Tool operation | One semantic operation row with live state | Same operation with verbose arguments/details | Tool call yes |
| Tool result | Compact, tool-specific result; may render nothing | Verbose tool-specific result | Yes |
| Repeated reads/searches/MCP queries | Aggregated activity summary | Original calls and results | Original events remain stored |
| Subagent work | Bounded progress or completion summary | Prompt, progress, and returned content can be expanded | Main result persists; detailed sidechain work is stored separately rather than as main-conversation progress ticks |
| Todo and similar work state | Lives in a dedicated status/task surface, not as repeated transcript messages | Not promoted into transcript merely because state changed | Underlying tool event may persist; high-frequency state display is separate |
| System feedback | Warnings/errors when actionable; informational noise suppressed | More informational detail | Selected system events persist |
| Progress ticks | Update their owning operation in place | Used to render detail while available | No; explicitly ephemeral |

The table is a product interpretation of the concrete decisions below, not a claim that these are public TypeScript API types.

## Product decisions evidenced in the snapshot

### 1. Persist semantic events; derive the visible transcript

The persistence layer defines user, assistant, attachment, and system records as transcript messages, while explicitly excluding progress records from the persisted parent chain. For external users it also filters most internal attachments before logging. [`src/utils/sessionStorage.ts:128-156`, `src/utils/sessionStorage.ts:4351-4366`, `src/utils/sessionStorage.ts:4450-4460`]

Separately, the UI normalizes, filters, reorders, groups, and collapses those messages immediately before rendering. The collapse is therefore a display projection, not destructive rewriting of the underlying conversation. [`src/components/Messages.tsx:475-529`]

**Decision for Pi Stuff:** define storage and display independently. “Hidden by default” must never implicitly mean “discarded,” and “visible while running” must never implicitly mean “persisted.”

### 2. Render content blocks as meaningful units, not API-response blobs

An assistant or user message containing several content blocks is normalized into separate renderable units with stable derived identities. Text, thinking, tool calls, images, and tool results can therefore receive different presentation rules even when they arrived in one API message. [`src/utils/messages.ts:730-818`]

**Decision for Pi Stuff:** the visible unit should be a meaningful conversation item, not necessarily one provider message. Preserve parent/owner relationships so split items still behave as one operation where appropriate.

### 3. Progress belongs to its operation

Standalone progress messages are removed from the row list, looked up by their owning message/tool call, and passed into that row's renderer. While a tool is streaming, running, or waiting on unresolved hooks, the row remains dynamic; after resolution it becomes stable. [`src/components/Messages.tsx:499-504`, `src/components/MessageRow.tsx:140-167`, `src/components/Messages.tsx:779-830`]

High-frequency Bash, PowerShell, and MCP progress is explicitly described as UI-only state, replaced in place rather than appended, and excluded from JSONL persistence. [`src/utils/sessionStorage.ts:180-190`, `src/screens/REPL.tsx:2608-2627`]

**Decision for Pi Stuff:** elapsed time, line counts, current file, latest action, and spinner frames should update the owning tool/agent item. They should not create new permanent conversation rows.

### 4. Use a shared operation shell with tool-owned semantics

The common tool contract provides a human-facing name, compact activity/summary text, operation rendering, progress rendering, result rendering, truncation detection, and custom error/rejection rendering. A tool can deliberately return no transcript UI when its outcome appears elsewhere. [`src/Tool.ts:524-539`, `src/Tool.ts:561-678`]

The common shell supplies state and hierarchy: queued/running/resolved/error state, the tool label, compact input description, optional progress, and result beneath it. [`src/components/messages/AssistantToolUseMessage.tsx:101-121`, `src/components/messages/AssistantToolUseMessage.tsx:182-275`]

**Decision for Pi Stuff:** standardize the grammar of an operation item, but let each tool decide the most useful short description and result summary. A diff, test run, web fetch, and file read should share structure without being forced into identical content.

### 5. Collapse by human meaning, including across tool names

Tools classify whether an invocation is semantically a search, read, or directory listing. This includes shell commands such as `grep`, `find`, `cat`, and `ls`; the UI does not rely only on literal tool names. [`src/Tool.ts:418-433`]

Consecutive retrieval operations and their results become one derived group. Assistant prose and non-collapsible actions such as edits break the group; thinking, attachments, and system messages do not fragment it. [`src/utils/collapseReadSearch.ts:329-447`, `src/utils/collapseReadSearch.ts:755-780`, `src/utils/collapseReadSearch.ts:782-948`]

The compact form reports semantic counts and changes tense: active work says “Searching,” “Reading,” or “Running,” while completed work says “Searched,” “Read,” or “Ran.” The detailed form restores each original tool use and its result. [`src/components/messages/CollapsedReadSearchContent.tsx:220-258`, `src/components/messages/CollapsedReadSearchContent.tsx:260-292`, `src/components/messages/CollapsedReadSearchContent.tsx:345-412`]

**Decision for Pi Stuff:** collapse exploration noise by activity and turn segment, not merely by adjacency or tool name. Preserve assistant prose and consequential actions as boundaries.

### 6. Protect live summaries from flicker and frozen-looking work

Fast-changing current-action hints are held for at least 700 ms so the user can read them. Long-running shell activity adds elapsed time and output-line count only after two seconds, keeping fast operations clean while reassuring the user when work is slow. [`src/components/messages/CollapsedReadSearchContent.tsx:26-29`, `src/components/messages/CollapsedReadSearchContent.tsx:193-218`, `src/components/messages/CollapsedReadSearchContent.tsx:269-292`]

**Decision for Pi Stuff:** live text needs temporal rules, not just colors and spinners. Prevent one-frame hints, monotonic-count regressions, and rapid wording changes.

### 7. Group parallel work only when the grouping has real meaning

The generic grouping pass applies only to tools that explicitly provide grouped rendering, only when at least two calls of the same tool came from the same assistant response, and only in non-verbose mode. Detailed mode restores individual calls at their original positions. [`src/utils/groupToolUses.ts:19-31`, `src/utils/groupToolUses.ts:48-64`, `src/utils/groupToolUses.ts:83-99`, `src/utils/groupToolUses.ts:119-181`]

In this snapshot, grouped rendering is used for Agent calls, where the summary distinguishes running, finished, and background-launched agents and retains one line per agent beneath the group. [`src/tools/AgentTool/AgentTool.tsx:1380-1386`, `src/tools/AgentTool/UI.tsx:728-758`]

**Decision for Pi Stuff:** do not merge unrelated operations into a generic “activity card.” Group only a parallel/repetitive family that remains understandable as one user-level action.

### 8. Expansion is selective and paired with the compact item

A tool reports whether its compact result is actually truncated. Only collapsed groups and results that reveal more in verbose mode receive click-to-expand behavior. Tool call and tool result share an expansion key, so expanding one operation expands both halves together. [`src/Tool.ts:610-615`, `src/components/Messages.tsx:559-594`, `src/components/Messages.tsx:723-727`]

In non-fullscreen contexts, compact items can advertise the global transcript shortcut; in the virtualized fullscreen viewer that repeated hint is suppressed. [`src/components/CtrlOToExpand.tsx:10-45`]

**Decision for Pi Stuff:** “expand” should appear only when detail exists. Expansion belongs to the operation as a whole, not to disconnected call/result fragments.

### 9. Detailed transcript is an inspection mode, not the default layout

Opening transcript mode supplies `verbose=true`, expands the render projection, adds scroll/search navigation, and keeps a dedicated footer explaining that the user is viewing the detailed transcript. [`src/screens/REPL.tsx:317-337`, `src/screens/REPL.tsx:4392-4403`]

The current official documentation confirms that `Ctrl+O` opens detailed tool usage, expands collapsed MCP calls, and supports transcript search, show-all, native-scrollback dump, and editor export. The official fullscreen documentation also describes `/focus` as a quieter projection containing the last prompt, a one-line tool summary with diff statistics, and the final response. See [interactive mode](https://code.claude.com/docs/en/interactive-mode#transcript-viewer) and [fullscreen rendering](https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation).

**Decision for Pi Stuff:** keep one quiet default projection plus one consistent detailed mode. Do not invent a separate modal or bespoke expansion interaction for every tool.

### 10. Thinking is treated as current-work detail, not normal durable prose

Completed thinking blocks are suppressed in the normal non-verbose projection. In detailed transcript mode, the renderer can show thinking, while a higher-level selector hides older thinking and favors the latest block from the current turn; streaming thinking has a separate short-lived path. [`src/components/Message.tsx:524-558`, `src/components/Messages.tsx:381-419`, `src/components/Messages.tsx:714-719`, `src/screens/REPL.tsx:4401-4403`]

**Decision for Pi Stuff:** never style thinking like an ordinary assistant answer. If exposed, treat it as a live/current diagnostic with explicit detailed-mode access, not as permanent main-conversation clutter.

### 11. Errors stay attached to the failing layer, while retry noise is transient

Tool cancellation, rejection, error, and success are all resolved through the owning tool result. Tool-specific error UI is preferred; the generic fallback shows at most ten lines in compact mode and points to the detailed transcript for the remainder. [`src/components/messages/UserToolResultMessage/UserToolResultMessage.tsx:36-89`, `src/components/messages/UserToolResultMessage/UserToolErrorMessage.tsx:23-101`, `src/components/FallbackToolUseErrorMessage.tsx:11-15`, `src/components/FallbackToolUseErrorMessage.tsx:30-86`]

API retry errors follow a different policy: early retry attempts are hidden, only the last consecutive API error is kept in the current render projection, and API-error rows remain dynamic so recovery can remove them. Informational system messages are also suppressed outside verbose mode. [`src/components/messages/SystemAPIErrorMessage.tsx:21-40`, `src/utils/messages.ts:1001-1025`, `src/components/Messages.tsx:812-817`, `src/components/messages/SystemTextMessage.tsx:200-215`]

**Decision for Pi Stuff:** distinguish operation failure, recoverable transport retry, and informational system state. Operation failure should remain with the operation; successful automatic recovery should not leave a trail of retry rows.

### 12. High-volume subagent work and work-control state do not flood the main conversation

While a foreground subagent runs, only a bounded tail of progress is shown; hidden work is summarized as an additional tool-use count. On completion, the normal conversation keeps a compact “Done” record with tool count, tokens, and duration, while transcript mode can show the delegated prompt, detailed progress, and returned content. Backgrounding instead leaves a management-oriented summary. [`src/tools/AgentTool/UI.tsx:445-569`, `src/tools/AgentTool/UI.tsx:315-409`]

Subagent sidechain messages have a separate transcript-writing path, so detailed worker history need not be copied into the main conversation's progress stream. [`src/utils/sessionStorage.ts:1451-1461`, `src/utils/sessionStorage.ts:4325-4346`]

Todo demonstrates the same separation for work-control state: its transcript renderer is deliberately absent while it updates the task state owned by the surrounding UI. The tool contract explicitly names Todo as an example of a result surfaced elsewhere. [`src/tools/TodoWriteTool/TodoWriteTool.ts:48-70`, `src/tools/TodoWriteTool/TodoWriteTool.ts:88-103`, `src/Tool.ts:561-565`]

`/btw` likewise renders its question and answer inside a dismissible command surface and closes with `display: "skip"`, rather than adding the side answer to the main conversation. [`src/commands/btw/btw.tsx:36-65`, `src/commands/btw/btw.tsx:125-180`, `src/commands/btw/btw.tsx:229-242`]

Anthropic's current official documentation states the same product intent: verbose subagent work stays in the subagent context and only a relevant summary returns to the main conversation. Current `/btw` behavior is newer than the inspected snapshot: side questions remain available in a session-local BTW history and can be reopened, but they still never enter the main conversation history. See [subagents](https://code.claude.com/docs/en/sub-agents#isolate-high-volume-operations) and [interactive mode](https://code.claude.com/docs/en/interactive-mode#side-questions-with-btw).

**Decision for Pi Stuff:** the main conversation records delegation and outcome, not the worker's entire stream. Todo and BTW should remain dedicated work surfaces rather than masquerading as assistant messages.

## Recommended Pi Stuff policy

The source evidence supports this provisional policy for later user confirmation:

1. Keep a semantic session event log separate from every visual projection.
2. Make the default conversation answer three questions: what did the user ask, what consequential work happened, and what did the agent conclude?
3. Attach live progress to its owning operation and do not persist progress ticks.
4. Give tools a common operation grammar but tool-specific compact and detailed renderers.
5. Collapse high-volume exploration by semantic activity; preserve prose and consequential operations as boundaries.
6. Use present tense for active summaries and past tense plus outcome for settled summaries.
7. Make detailed transcript one global inspection mode, supplemented by selective per-operation expansion when useful.
8. Keep errors local to the failing operation; let recovered retry noise disappear.
9. Keep subagent work isolated, returning bounded progress and a durable outcome summary to the main conversation.
10. Keep Todo, BTW, settings, and management state in their dedicated surfaces rather than emitting routine success messages into the conversation.

These are product decisions inferred from the inspected snapshot and official behavior, not code to reproduce. Visual styling, exact line counts, colors, glyphs, and shortcuts remain separate decisions.
