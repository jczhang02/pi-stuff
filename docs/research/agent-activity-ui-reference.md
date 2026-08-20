# Agent activity UI reference: Claude Code and `pi-subagents`

**Research date:** 2026-08-01  
**Decision update:** 2026-08-17
**Scope:** What a user sees in the main coding conversation when one or more agents are queued, running, completed, failed, stopped, or waiting for input. Management screens are covered only to keep them separate from transcript records.

## Bottom line

The current Pi Stuff direction combines a Claude-like roster with a deliberately smaller lifecycle:

- Keep **Pi Stuff's accepted transcript lifecycle**: one compact launch record, one settled grouped result, and detail on demand. Claude Code supports the compact launch/notification grammar, but the captured background completion uses one notification per Agent rather than Pi Stuff's grouped result.
- Use **Claude Code's below-editor roster grammar**: `main` plus one line per child, a solid-circle selection marker, and keyboard entry only from an empty editor.
- Keep **Tintinweb's honest lifecycle states** as capability input, but do not reproduce its above-editor activity widget, Agent statusline, or centered conversation viewer.
- Do **not** inherit Tintinweb's three simultaneous live-status projections or its centered conversation overlay. A durable launch/tool record may coexist with one live roster because they answer different questions; the same changing detail must not be repeated above the editor, below it, and in a statusline.
- Keep a strict distinction between (1) durable conversation records, (2) transient live activity, and (3) an explicit, non-floating management/detail view.

This yields a concrete rule: **the conversation says what happened; a single live roster says what is happening; a Command Dialog shows everything else.**

## Current roster decision and native-Pi evidence

The earlier bounded above-editor synthesis is superseded. Pi Stuff now keeps its lifecycle semantics but puts the only live roster **below the editor**, following the Claude Code interaction model. The [Agent roster comparison report](../prototypes/tui/agent-roster-comparison-report.html) compares three native Pi projections:

1. **Vertical sessions — selected:** one line each for `main` and every Agent; task on the left, shortest state on the right.
2. **Grouped batches:** adds ownership headers but repeats batch context already present in the transcript and consumes more height.
3. **Horizontal rail:** minimizes height but hides simultaneous child tasks and states until selection.

The throwaway Extension proves this can be implemented without forking Pi: it uses public `setWidget(..., { placement: "belowEditor" })`, `onTerminalInput`, and non-overlay `ctx.ui.custom()`. The capture exercises real Down/Up selection and Enter-to-detail input inside Pi `0.83.0`; only the Agent lifecycle data is a deterministic fixture. The vertical variant also passes a `64 × 28` basic-layout smoke frame with four short tasks and right-side states intact. This does not yet prove live Agent integration, completion linger duration, actual truncation under long labels, or high-agent-count overflow behavior.

## Provenance and reuse limits

### Claude Code

Behavior was checked against Anthropic's current documentation and official changelog through Claude Code **2.1.220**. The local CLI inspected also reported `2.1.220`. Current documentation is the authority for behavior such as default background execution, permission prompts, `/tasks`, and team controls ([subagents documentation](https://code.claude.com/docs/en/sub-agents), [agent teams documentation](https://code.claude.com/docs/en/agent-teams), [official changelog at v2.1.220](https://github.com/anthropics/claude-code/blob/v2.1.220/CHANGELOG.md)).

Exact visual evidence for the parallel lifecycle now comes from the genuine Claude Code **2.1.197** Linux x64 npm release binary (SHA-256 `f54e69cbc89b2da61a415700af7ff52a147e862517d4f1b0eecf768448cf7f83`). It was driven as a black box in an isolated `100 × 32` PTY. A localhost-only Anthropic Messages fixture emitted two concurrent Agent calls and delayed their tool-free results for 12 seconds. No user Claude configuration, credential, session, source code, or external model API was used. The renderer, keyboard path, foreground-to-background transition, and completion notifications are therefore real release behavior; the task prose is deterministic fixture data. Reproduction lives in [`claude-2.1.197-agent-activity-capture.sh`](../prototypes/tui/claude-2.1.197-agent-activity-capture.sh) and [`claude-2.1.197-agent-activity-mock.ts`](../prototypes/tui/claude-2.1.197-agent-activity-mock.ts).

Some layout decisions were inspected in `tanbiralam/claude-code` at commit [`6f6f12b`](https://github.com/tanbiralam/claude-code/tree/6f6f12b37f529488b10e53928dd5508bb93535c7). That repository is not Anthropic's official source release, contains reconstructed/minified material, cannot be tied reliably to a public Claude Code version, and had no license file at the inspected commit. It is therefore **product evidence only**: do not copy, translate, adapt, or port its code or component structure.

### Tintinweb `pi-subagents`

Source behavior was checked at current `master` commit [`2966cd5`](https://github.com/tintinweb/pi-subagents/tree/2966cd5a33c0640de9698b56a39c11f83207a835). The package declares MIT and still identifies itself as `0.14.3` ([package manifest](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/package.json#L1-L10)), but this commit contains entries under `Unreleased`. The actual npm `0.14.3` release reports git head `c10b1836256e760da75296ccd4e57a77ada1325e` ([registry record](https://registry.npmjs.org/@tintinweb%2Fpi-subagents/0.14.3)). A future fork must choose and record one exact base; the two are not interchangeable.

## The four surfaces must not be conflated

| Surface | Lifetime | Purpose | Claude Code | Tintinweb | Pi Stuff direction |
|---|---|---|---|---|---|
| Agent tool record | Durable conversation history | Show the call and settled outcome | Compact Agent record; parallel calls can share one tree | One Pi tool result per call | Claude-like grouped record |
| Live activity | Only while work is active, with brief terminal linger | Answer “which sessions exist and what state are they in?” | Compact below-editor Agent roster | Above-editor widget plus FleetView and statusline | One below-editor vertical roster, no statusline |
| Completion notification | Durable once inserted into conversation | Tell the parent and user a background result arrived | One colored dot and summary | Styled block with stats and preview; group delivery supported | Compact result row; expand for preview |
| Management/detail UI | Opened explicitly; not transcript | Browse, steer, stop, read full conversation | `/tasks`, agent panel, and separate `claude agents` view | `/agents`; Enter from FleetView opens a centered conversation viewer | Non-floating Command Dialog using the common Pi Stuff panel pattern |

This distinction matters because the old Claude Code `/agents` wizard is no longer the normal agent activity UI. The official v2.1.198 changelog removed that wizard; current `/agents` reports agent locations. The full-screen `claude agents` product is also a separate surface, not a transcript component ([current agents documentation](https://code.claude.com/docs/en/agents), [agent view documentation](https://code.claude.com/docs/en/agent-view)).

## Claude Code: concrete main-conversation behavior

### Directly observed parallel lifecycle in 2.1.197

The released binary establishes eight details that the earlier source study could not:

1. Foreground parallel work simultaneously has a durable conversation group and a selectable Agent roster below the editor. The roster is not a statusline or overlay: it has a `main` row and one row per child.
2. The compact group starts as `Running 2 agents… (ctrl+o to expand)`. Each child initially shows its configured type, task description, tool-use count, and `Initializing…`.
3. Pressing `Ctrl+B` backgrounds the unresolved group. The transcript projection contracts to `2 background agents launched (↓ to manage)`, the main Agent continues, and the bottom roster persists.
4. Foreground completion mutates the group to `2 agents finished` with `Done` children. Background completion instead inserts one green notification per child and adds elapsed/token statistics to the roster.
5. `Ctrl+O` is global detailed-transcript mode. It replaces the compact group with separate Prompt, Response, tool-use, token, and duration blocks, then displays `Showing detailed transcript · ctrl+o to toggle` at the bottom.
6. With the editor empty, Down enters roster management and changes the hint to `↑/↓ to select · Enter to view`; the solid circle initially marks `main`.
7. A second Down selects the first child and exposes view/stop controls. Selection is expressed by moving the solid circle, not by drawing a boxed row.
8. Enter on a child opens that child session in the main work area while the roster keeps the child selected.

These observations supersede any earlier wording that called a source-derived layout a “Claude screenshot.” Lifecycle frames are preserved in the historical [Agent activity comparison report](../prototypes/tui/agent-activity-comparison-report.html); the verified roster-management frames are embedded in the current [Agent roster comparison report](../prototypes/tui/agent-roster-comparison-report.html).

### One foreground agent

While running, the Agent tool record keeps only a small moving window of activity. The inspected snapshot uses at most three recent progress messages, shows an initializing state before activity exists, and replaces the body with a one-line progress summary when the terminal is too short ([Agent UI source](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L33-L33), [progress rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L444-L569)). Hidden work is represented as a count rather than more rows.

Behavioral sketch, not copied source:

```text
● Explore  Find authentication path
  ⎿ Reading middleware.ts
  ⎿ Searching for session checks
  +7 earlier tool calls  (ctrl+o for detail)
```

On completion, moving activity is replaced by a stable terminal summary containing tool-use count, token count, and duration. Expanded transcript mode can reveal the prompt, full progress transcript, and response ([completion rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L315-L409)). This is progressive disclosure inside the existing record, not a new card.

### Parallel agents

Claude Code groups two or more Agent calls only when they came from the **same assistant response** and are the same group-capable tool. Verbose/transcript mode restores the individual records ([grouping rule](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/groupToolUses.ts#L48-L64), [group construction](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/groupToolUses.ts#L83-L181)). It is not a global grouping of every agent in the session.

The compact group has one parent headline and one tree child per agent. Each active child gets its own short task label, statistics, and latest action. Completed foreground children become `Done`; background launches suppress misleading completion statistics and say that they continue in the background ([grouped Agent rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L649-L758), [child-row component](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/AgentProgressLine.tsx)).

Behavioral sketch:

```text
● Running 3 agents…
  ├─ Explore  Trace authentication
  │  ⎿ Searching route guards
  ├─ Explore  Check tests
  │  ⎿ Reading auth.integration.test.ts
  └─ Reviewer  Inspect failure paths
     ⎿ Waiting for first result
```

The valuable idea is the **single parent event with independently changing children**. It lets one parallel model call occupy one visual place without hiding which child is stuck or failed.

### Background launch and completion

A background launch settles the original tool row into a short “backgrounded” state with management and expansion hints. Its result later arrives as a separate task notification. The inspected renderer deliberately reduces that notification to a status-colored dot plus summary; it does not dump the result into the conversation ([launch rendering](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/UI.tsx#L341-L363), [notification renderer](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/messages/UserAgentNotificationMessage.tsx#L11-L82)). Pending notifications near the prompt are capped at three lines, with overflow aggregated ([queued notification cap](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/components/PromptInput/PromptInputQueuedCommands.tsx#L29-L69)).

Current Claude Code behavior adds important lifecycle details that the snapshot cannot establish:

- Since v2.1.198, subagents run in the background by default unless their result is immediately needed. Claude waits for the real completion notification before reporting the result ([official subagent docs](https://code.claude.com/docs/en/sub-agents)).
- A permission request from a background subagent is surfaced in the main session and names the requesting agent. Approval continues it; rejection denies that tool without necessarily killing the agent ([official subagent docs](https://code.claude.com/docs/en/sub-agents)). This is the closest current equivalent to **needs input**.
- Completed background tasks remain visible in `/tasks`, while failed or stopped tasks leave that list. This is management-state behavior, not a durable transcript-row rule ([official subagent docs](https://code.claude.com/docs/en/sub-agents)).
- In team mode, the agent panel supports selection, transcript viewing/messaging, interruption, idle-row collapsing, and timed hiding. Those controls belong to the live roster or management surface, not every conversation record ([official agent teams docs](https://code.claude.com/docs/en/agent-teams)).

## Tintinweb: concrete behavior and what it contributes

### Inline Agent result

Tintinweb registers one normal Pi `Agent` tool. The call line contains role and short description. During a foreground run its result streams a spinner, turn/tool/token statistics, and a derived activity label. Completion, steered completion, stopped, error, and hard-aborted states each have distinct terminal treatment. Collapsed completion says only that the run is done; expanded mode shows up to 50 output lines and then points to the retrieval tool ([inline renderer](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L964-L1046)).

Its state model is honest and useful: `queued`, `running`, `completed`, `steered`, `aborted`, `stopped`, and `error` are distinct. It has **no `needs-input` state** ([record type](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/types.ts#L86-L100)).

One limitation is visible in the inline launch record: the tool result sent to the model distinguishes “queued” from “started,” but the compact visual renderer uses the same generic background-running label for both ([background result text](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L1303-L1312), [visual branch](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L999-L1002)). Pi Stuff should not repeat that ambiguity.

### Background widget

Tintinweb's above-editor widget remains useful evidence for which facts exist, but its placement and density are no longer a Pi Stuff candidate. It gives each running agent two lines:

1. role, concrete task, turns, tool calls, tokens/context pressure, and elapsed time;
2. one plain-language latest activity line.

Queued agents are compressed into one aggregate count. The widget has a 12-line cap, prioritizes running rows over queue and recently finished rows, and summarizes overflow ([widget renderer](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/agent-widget.ts#L349-L478)). Finished successes linger for one subsequent turn and errors for two; this is a sound transient-lifecycle idea ([linger policy](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/agent-widget.ts#L274-L343)).

However, the implementation also sets a statusline string and registers the widget above the editor ([status and placement](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/agent-widget.ts#L481-L545)). Pi Stuff may reuse lifecycle facts in the explicit detail view, but it will not reuse either placement.

### Completion notifications and grouping

Each background completion becomes a themed message containing status, task, statistics, a one-line preview when collapsed, up to 30 lines when expanded, and an optional transcript path. Multiple completions can be delivered in one custom message while retaining one block per agent ([notification renderer](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L232-L279), [delivery grouping](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/index.ts#L318-L370)).

The group-join behavior is operational rather than visual: hold results until all agents finish, or release a partial batch 30 seconds after the first completion and re-batch stragglers on a 15-second timer ([group join](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/group-join.ts#L23-L27), [delivery lifecycle](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/group-join.ts#L59-L117)). This reduces notification spam, but it does not create Claude Code's live grouped Agent tool record.

### FleetView and conversation viewer

FleetView is a separate below-editor roster. At an empty prompt, arrow keys enter it; Enter opens a selected agent; recently finished agents linger briefly. Pending queued agents without a session are hidden until they can actually be opened ([FleetView roster](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/fleet-list.ts#L144-L200), [keyboard behavior](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/fleet-list.ts#L209-L259)).

The selected conversation opens with `overlay: true`, centered at 90% width, and owns steering and stop controls ([viewer implementation](https://github.com/tintinweb/pi-subagents/blob/2966cd5a33c0640de9698b56a39c11f83207a835/src/ui/fleet-list.ts#L281-L319)). This is precisely the floating-window pattern already rejected for Pi Stuff. Its capabilities remain relevant; its container does not.

## State-by-state comparison

| State | Claude Code evidence | Tintinweb evidence | Pi Stuff preview rule |
|---|---|---|---|
| Queued | Not evidenced as a distinct durable transcript row; activity/management surfaces own most scheduling state | Real state; widget aggregates count, but compact launch row obscures the distinction | Keep the queued child visible when it has a session row; show position on the right; aggregate only after the roster hits its height cap |
| Running | Latest activity plus bounded history; parallel children update independently | Rich two-line row with role, task, stats, activity | One roster line: Agent name, task, and short elapsed state; tool activity belongs to explicit detail |
| Completed | Replace movement with stable `Done` summary; background completion becomes a later compact notification | Distinct success row and expandable result preview | Durable grouped transcript outcome; keep the terminal roster row until the next main-session user submission, or dismiss it earlier with `x` |
| Failed | Error color/state; current `/tasks` retention differs from success | Distinct error with partial result available | Durable failed child with the shortest reason and partial-result marker; the roster follows the same deterministic next-submission cleanup |
| Stopped | Panel/task controls can interrupt; notification status supports killed | Separate stopped state | Durable stopped child with any partial-output marker; the roster follows the same deterministic next-submission cleanup |
| Needs input | A background permission prompt appears in the main session and names the agent | No state | Permission temporarily owns the Command Dialog; a genuine human question instead becomes a persistent attention row and does not steal a non-empty editor |
| Steered | Team controls can message selected agent | First-class `steered` terminal state and mid-run messages | Steering stays in detail panel; transcript records only a small “direction updated” event if user-visible context changed |
| Many completions | Prompt-area notification list is capped/aggregated | Group join consolidates completion messages | One grouped notification with per-agent status; no burst of nearly identical cards |

## Current preview specification

The selected layout has three state owners. These sketches describe behavior and information, not copied pixels.

### A. Durable launch record in the transcript

```text
● Started 4 background agents · 3 running · 1 queued · ↓ manage
```

### B. Default below-editor roster

```text
  ↓ to manage
  ● main
  ○ explorer    Inspect Claude activity UI                 14s
  ○ reviewer    Inspect tintin activity UI                 11s
  ○ pi-reviewer Check Pi interaction constraints     queued #1
  ○ test-runner Verify narrow terminal layout               6s
```

The task is left-aligned and expendable under width pressure; the short state is right-aligned and preserved. Do not add latest tool activity, group headers, or statusline counts here.

### C. Selected roster

```text
  ↑/↓ to select · Enter to view · Esc to return
  ○ main
  ● explorer    Inspect Claude activity UI                 14s
```

Selection moves the solid circle. It does not create a card, full-row background, border, or floating focus surface.

### D. Settled transcript record and deterministic roster cleanup

```text
✓ 4 agents finished · 19 tool uses · 18s
  ├ Inspect Claude activity UI · Transcript and roster have different jobs.
  ├ Inspect tintin activity UI · One roster is enough.
  └ +2 more

  completed just now · ↓ to review
  ○ explorer    Inspect Claude activity UI      done · 18s · 24k
```

The transcript record is durable. A terminal roster row remains available while the user reviews the current main response, then disappears on the next main-session user submission. `x` dismisses a terminal row earlier. This event boundary is deterministic, avoids timer-driven movement, and leaves full result/error/partial-output evidence in the transcript and Agent Command Dialog.

### E. Permission versus human-required input

```text
● Reviewer needs permission
  ⎿ Run integration tests with network access?
    Enter allow · Esc deny this action
```

A permission request is modal because the tool cannot continue without a decision. It names the Agent and action, temporarily replaces the editor and other Pi Stuff-owned chrome, and restores the exact prior main or BTW surface afterward. `Esc` denies only that tool call; it does not stop the Agent.

```text
● Reviewer needs your answer · Choose migration target

  ◯ reviewer    Choose migration target                    waiting
```

An internal child-to-supervisor question is not automatically a user interruption: the main Agent first tries to answer it through the fork's supervisor channel. Only when the main Agent decides that a human choice is required does Pi Stuff show the persistent attention row above Todo. It marks the roster row `waiting` but does not steal focus, modify the draft, consume keystrokes, or copy the question into Todo. Down and Enter open the Agent Command Dialog to reply.

### F. Accepted Agent Command Dialog redesign

**Status:** Accepted on 2026-08-17; implementation pending.

Enter on a child temporarily hides the roster and opens the accepted full-width Command Dialog below its divider. It
owns full conversation, steer, stop, resume, and local details. Do not draw a centered bordered overlay over the
transcript. This decision covers the Agent Command Dialog only: it does not change the Conversation Transcript marker,
Fleetview, or another Capability's Dialog.

The following sketch is the layout authority. It deliberately has no content-level indentation; every first glyph in
the section bodies and Activity starts at the same Dialog content column.

```text
Agents / reviewer
✓ completed · 18s

◆ Task
Review the /agents dialog for readability at 64 and 32 columns.

◆ Result
The Agent name needs priority. Section labels should be stronger,
and Activity should keep every event while shortening large Tool output.

◆ Activity
reviewer
I'll inspect the current list and detail layout.

✓ Read agent-dialog.ts · completed
⎿ 24 lines shown · … 186 lines omitted

✓ Search renderListRow · completed
⎿ 3 matches

reviewer
The name currently receives at most 38% of the available width.

↑/↓ scroll · Shift+↑/↓ page · r resume · Esc back
```

#### Agent list

- A Dialog list row is `selection marker`, Agent name, optional task description, then a right-aligned lifecycle icon
  with elapsed time or queue position. `›` means focus only; it never replaces the lifecycle icon.
- Keep the Agent name immediately after the selection marker and give it priority over the description. The task
  description disappears as one unit at narrow widths; do not cap the name to a fixed percentage while preserving
  lower-priority description text.
- Compact rows replace lifecycle words with their fixed icons: for example, `● 12s`, `✓ 12s`, and `○ #1`. The detail
  Header retains the full state word.
- Keep rows in launch order for the life of the Dialog. State changes and newly discovered Activity update the row in
  place; they do not re-sort the list or move the focused Agent. New Agents append in launch order.
- When the list exceeds its visible window, keep the focused row visible and use `… N earlier` and `… N later` rather
  than a scrollbar or a second pagination mode. Up and Down move one Agent; PageUp/PageDown and Shift+Up/Down move one
  visible page. Show the page hint only while the list overflows.
- The list owns navigation, inspect, and one direct control: `x stop` for queued, running, waiting, or resuming Agents.
  Do not show it for `stopping` or terminal states. Steer, reply, resume, and child-Agent navigation belong to detail.
- `/agents` is the complete current-session list and does not provide `x dismiss`. Dismiss remains an independent
  behavior of the temporary below-editor roster.
- Do not flatten descendants into one list with `d1`, `d2`, or `d3` labels. A parent detail exposes `n child agents`;
  that action opens only its direct children with the same row grammar. A child with descendants repeats the same
  navigation one level deeper, and Escape returns exactly one level.

#### Stable structure across states

- The configured Agent name is the primary visual anchor. The breadcrumb is quieter, and optional description text
  yields before the name at narrow widths.
- Every state uses the same page skeleton: Header, Task, one optional outcome slot, Activity, and Footer.
- Header shows the Agent name followed by one status icon, the complete state word, and elapsed time when known. State
  does not receive a separate section.
- Task is always present and shows the full delegated task once.
- The outcome slot is named `Result`, `Error`, or `Partial result` according to its real content. It is omitted instead
  of displaying an empty placeholder, and it never repeats content already owned by Task or Activity.
- A completed Agent uses `Result`. A failed or crashed Agent uses `Error`; when it also retained useful partial output,
  `Partial result` is a secondary label inside that same outcome slot rather than a second marked section. A stopped or
  cancelled Agent uses `Partial result` only when such content exists. Queued, running, and waiting Agents have no
  outcome slot.
- Outcome content is the sanitized result actually retained for the Agent. The Dialog does not generate a replacement
  summary. A terminal Agent initially opens at its outcome; a non-terminal Agent initially opens at its newest Activity.
- Activity is always present. Footer actions remain state-dependent, while Escape retains the shared back/close
  behavior.

#### Section and spacing grammar

- Keep the Suite's full-width top divider and Footer boundary. Do not add a horizontal rule, card, frame, or floating
  container around an individual section.
- Section headings are `◆ Task`, `◆ Result`, `◆ Error`, `◆ Partial result`, and `◆ Activity`. The semantic-theme
  diamond exists only on the heading row and never represents lifecycle state, focus, or a Transcript event.
- Beyond the Command Dialog's one outer content gutter, do not add hierarchy indentation. Section bodies, Agent names,
  Agent messages, Tool rows, `⎿` result rows, and wrapped continuation lines share one left edge with the section icon.
- Blank lines, heading weight, and semantic text colors separate sections and events. The Agent name remains stronger
  than every section heading.

#### Activity content

- Activity preserves the complete relevant event order: Agent messages, user-visible steer or resume messages, every
  Tool call, its target, outcome, and a bounded result preview.
- Agent messages render the configured Agent name on its own line followed by the message. User guidance renders `You`
  in the same speaker position; it does not borrow the `›` selection marker.
- A Tool event is one item: lifecycle icon, operation, and target on the first line, followed by a bounded `⎿` result
  preview when useful. A running Tool updates that item in place from `●` to `✓` or `×`; completion does not append a
  second copy of the call.
- Large Tool output is shortened in place and reports the omitted line count explicitly. The Dialog never silently
  drops earlier or later Activity.
- Internal/system records, raw protocol JSON, the delegated Task, and a duplicate final Result do not appear in
  Activity.
- Agent messages use the configured Agent name rather than a generic `Agent` label. Tool rows use their actual outcome
  icon rather than one universal circle.

#### Live Activity

- Activity must refresh while the selected Agent runs; a one-time transcript read on detail entry is insufficient.
- While the viewport is at the newest event, append and follow new Activity automatically. The first upward line or
  page movement pauses following and preserves the exact reading position.
- While following is paused, append without moving the viewport and show `↓ N new events`. Reaching the bottom with
  Down, PageDown, or Shift+Down clears the notice and resumes following. No separate follow toggle is needed.
- A lifecycle change, including completion or failure, updates the Header without moving a user who is reading older
  Activity. Reopening a terminal Agent still begins at its outcome.

#### Footer actions by Agent state

| Visible state | State-specific actions |
|---|---|
| queued, running | `s steer`, `x stop` |
| waiting | `s reply`, `x stop` |
| stopping | none |
| resuming | `x stop` |
| completed, failed, crashed, stopped | `r resume` |
| cancelled | none |

`Steer` means adding guidance to a live Agent. The waiting state reuses that input path but labels it `reply` because
the user is answering an Agent. Add scroll and page hints only when content overflows, add `n child agents` only when
children exist, and keep `Esc back` present and last in every detail state. Never advertise an action that validation
will reject.

#### Empty and degraded states

- An empty list says `No Agents in the current session.` and retains `Esc close`.
- An Agent with no events yet says `No Activity yet.` Loading says `Loading Activity…`; an unavailable source says
  `Activity unavailable.` and includes one sanitized reason when known.
- Loading or read failure is Activity-source feedback, not an Agent lifecycle state. It must not replace the Header's
  real lifecycle icon or word, steal focus, or remove the Escape path.

#### Dialog-only icon language

- The Conversation Transcript's small U+2022 `•` marker remains unchanged and does not determine Dialog status icons.
  Dialog and transcript share one-cell-safe glyphs, semantic colors, state names, and restrained density, not the same
  row marker.
- `›` means the focused selectable row and never means lifecycle state.
- Agent lifecycle icons are fixed: `○ queued`, `● running`, `! waiting`, `◐ stopping`, `↻ resuming`, `✓ completed`,
  `× failed` or `crashed`, and `■ stopped` or `cancelled`.
- Compact lists may lead with the icon; detail status always retains the full state word so color and icon recognition
  are never the only evidence. Tool events in Activity reuse the same success, running, and failure meanings.

#### Navigation and adaptation

- Up and Down scroll by one line in scrollable detail. PageUp and PageDown remain available; Shift+Up and Shift+Down
  are equivalent page-scroll aliases for compact keyboards.
- The Footer advertises `Shift+↑/↓ page` when page scrolling is available. Hints wrap rather than displacing the Agent
  name, selected state, attached error, or Escape path.
- At narrow widths, preserve the Agent name, section heading, state, and action before optional descriptions, targets,
  previews, or metadata. Content wraps without adding indentation or repeating the section icon on continuation lines.

The current implementation still renders `Task`, `State`, and `Transcript`; sorts list rows by lifecycle state; limits
the Agent name to 38 percent of available content width; often replaces the compact lifecycle indication with elapsed
time alone; flattens descendants behind `d1`/`d2`/`d3`; reads transcript content only on entry; advertises `x stop`
while stopping; hard-codes a filled circle in projected child Tool rows; and lacks Shift+Arrow page aliases. Those are
implementation deltas, not alternate accepted designs.

## Decisions supported by this research

1. **Group concurrent Agent outcomes at the originating conversation event.** This is implementable: grouping is keyed to one assistant response/tool batch, not to global history.
2. **Use a one-line vertical roster below the editor.** `main` and each child share the same simple row grammar; task is left, shortest state is right. The maintainer selected this direction after reviewing all three native Pi variants.
3. **Provide a contextual local-detail action.** Down enters the roster only when the editor is empty; Enter opens the selected child in a non-floating Command Dialog. `Ctrl+O` remains Pi's global transcript expansion and is not repurposed for local Agent detail.
4. **Use one active roster plus the durable conversation record.** Claude 2.1.197 proves those two surfaces can coexist when their jobs differ. Do not repeat the same live detail above the editor, below it, and in the statusline.
5. **Keep queue information concrete until the roster hits its cap.** A visible queued child shows its position; overflow becomes `+N more` only when necessary.
6. **Distinguish permission from a human question.** Permission temporarily owns the Command Dialog. A human-required question remains visible and actionable but preserves a non-empty editor; internal supervisor coordination stays silent unless the main Agent escalates it.
7. **Keep terminal outcomes durable.** Live rows may disappear after a short linger, but the conversation record must retain completed, failed, stopped, and partial outcomes.
8. **Keep the selected capability fork separate from the UI references.** Pi Stuff will fork `nicobailon/pi-subagents` for multi-Agent capability. Tintinweb and Claude Code remain observable UI references only; neither reference code is adopted, copied, translated, or ported into the final UI.
9. **Use the accepted Agent Command Dialog contract above for detailed inspection.** Its state-stable sections,
   Dialog-only icon language, flush-left content, bounded complete Activity, and compact-keyboard paging are product
   decisions rather than claims about exact Claude Code pixels.

## Facts the main agent must personally verify before freezing the preview or fork base

1. **Remaining Claude states:** parallel foreground running/completed, global expansion, background running/completed, roster navigation, child selection, and Enter-to-child are captured from `2.1.197`. A background permission request is separately captured from genuine `2.1.220` and documented in [Work background notification UI](./work-background-notification-ui-reference.md). Single-Agent, failed, and stopped pixels remain uncaptured; do not infer their exact layout from the Pi prototype.
2. **`/agents` versus `claude agents`:** confirm the current CLI still treats `/agents` as a locations report and that the separate Agent View is launched with `claude agents`; do not label an old wizard screenshot as current UI.
3. **Tintinweb reference revision:** record whether a UI decision was observed in published npm `0.14.3` (`c10b183…`) or current `master` (`2966cd5…`, with unreleased changes). This is provenance for behavior evidence, not a Tintinweb fork decision.
4. **Overlay rejection scope:** FleetView itself is the below-editor roster, not an overlay. Verify that every path from it to Tintinweb's `ConversationViewer` is replaced or disabled, because that viewer explicitly requests a centered overlay.
5. **Needs-input implementation boundary:** Tintinweb's record model has no needs-input state. The selected `pi-subagents` fork can route an internal supervisor request to the main Agent, but that is not itself a human question. The native Pi lifecycle spike proves UI ownership only; a universal allow/ask/deny tool policy remains a separate Package decision.
