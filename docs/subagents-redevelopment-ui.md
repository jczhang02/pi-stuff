# Subagent UI redevelopment interview

[简体中文](i18n/zh-CN/subagents-redevelopment-ui.md). English is authoritative.

Status: UIR01 and revised UIR02 accepted on 2026-09-20; UIR03 accepted on 2026-09-21. FleetView help must appear only while FleetView has keyboard focus. UIR04 below proposes its placement and focus markers. The first UIR02 image remains rejected design history. Tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97), under [#64](https://github.com/jczhang02/pi-stuff/issues/64). Runtime scope is settled in the [redevelopment decisions](subagents-redevelopment.md).

Discuss the UI one part at a time through real usage scenarios: main layout and transitions; FleetView and task structure; details and observability; interventions; completion and history; keyboard and visual consistency. The maintainer's feedback brings detail hierarchy into this round. The previous UI is a starting point, not a wholesale adoption of its old runtime requirements.

## Visual reference

The inspected Ghostty configuration uses Catppuccin Latte, background `#eff1f5`, foreground `#4c4f69`, a 12pt slightly thickened font, disabled ligatures and 2px padding. The font stack is JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono and LXGW WenKai Mono. The configured default is 150 columns by 50 rows; Pi uses the same light theme and fullscreen mode. There was no live Terminal Control session to inspect.

The images use that configuration and the earlier actual [FleetView](assets/subagents/light-fleet-120x36.png) and [detail](assets/subagents/light-detail-160x48.png) captures. They are 1536x1024 ImageGen concepts with illustrative task content and metrics. Font rasterization, cell geometry and keyboard behavior still need verification in Pi. Exact prompts and provenance are retained in [generation.json](assets/subagents-redevelopment-ui/generation.json).

## UIR01: main layout accepted

![Main conversation and FleetView with aligned trailing content](assets/subagents-redevelopment-ui/03-main-aligned.png)

Keep the main conversation, editor and statusline, followed immediately by full-width FleetView. Main has no description. Selection changes only the circle; normal execution has no Running label. The editor retains its draft and hides its caret while focus is in FleetView.

The maintainer also required Waiting and similar state text to align with the elapsed/token area. The revised image places every row's trailing content in the same right-aligned region. Waiting ends at the same right edge as tokens, rather than occupying a separate position before the metrics. Metric rows share elapsed and token column positions; names and descriptions retain their own shared columns.

## Why the first detail design was rejected

The maintainer found the [first detail image](assets/subagents-redevelopment-ui/02-detail.png) redundant and hard to scan. Prompt, Progress and five additional categories had similar visual weight. A reader had to search the page for the latest useful information.

The observed [Claude Code task detail](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/assets/claude-subagent-ui/05-task-detail.png) uses a compact identity/metrics header, current activity, prompt and local actions. Its complete transcript is a separate reading surface. The [research record](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md) distinguishes real CLI interaction from fixture-generated content.

Current [Claude Agent View documentation](https://code.claude.com/docs/en/agent-view#peek-and-reply) prioritizes recent output or a pending question in its peek. [Cursor's review workflow](https://docs.cursor.com/en/agent/review) makes the produced changes directly accessible from an agent response. These inform the proposal's information order. Their session switching, peek containers and GUI controls are not prerequisites for Pi's inline detail.

## UIR02: revised detail accepted

Opening a child replaces the entire bottom interaction area, with the visible main conversation above. Main editor, main statusline and FleetView are absent while inspecting. Returning restores the previous FleetView selection and main draft; background work continues. The maintainer accepted this revised hierarchy and its retained page relationship. The sample keys and exact height remain illustrative.

### While working

![Working child with a prominent latest reply and a short tool trail](assets/subagents-redevelopment-ui/04-detail-working.png)

The header identifies the child and assignment once, with model and usage nearby. Prompt is a compact expandable line. The central content is the child's latest visible reply, followed by recent tool activity. The sample reply includes its own emphasized finding; the UI does not need another model call to invent a summary. The tool tree serves local activity, not a directory of every data category.

Transcript opens full recorded output. Info provides access to supporting configuration, workspace, usage and history. Their exact organization belongs to later rounds.

### After completion

![Completed investigation with its report immediately visible](assets/subagents-redevelopment-ui/05-detail-done.png)

The same central area shows the final report directly. Its conclusion and supporting observations are readable without opening a Result section. Tool evidence is folded. The header says Done because the investigation completed successfully, even though its report identifies an upstream problem.

The working and completed images are states of one design. The local action hints change from message/stop to follow-up as appropriate. Key assignments and action behavior are illustrative until the interaction round.

**Accepted UIR02.** Show the latest reply and current activity while working, then the report on completion, with supporting information one step deeper. Preserve access to full evidence while making the first screen useful on its own. Concrete pending questions and errors still need their own design pass.

## UIR03: FleetView and task relationships accepted

FleetView remains the compact list accepted in UIR01. Its row layout does not change when a task has dependencies. Independent work needs no extra relationship diagram. When the selected task belongs to a dependency workflow, provide an entry to its actual dependency graph in the bottom inspection area. The exact entry key will be decided with keyboard interaction.

### Independent investigations

![Three independent investigations in the usual FleetView](assets/subagents-redevelopment-ui/06-independent-fleet.png)

Lifecycle, packages and tests investigate independently. Each row can open its detail. There are no dependency arrows or an invented parent-child tree. The historical image's bottom `j/k` hint is superseded by the focus comparison in UIR04.

### A workflow with dependencies

![Two prerequisites feeding a reviewer, with one report still pending](assets/subagents-redevelopment-ui/07-dependency-graph.png)

This is a separate scenario: reviewer requires the results of lifecycle and packages. The image shows the graph after opening it from FleetView. Packages is done, lifecycle is still working, and reviewer has not started. Both dependency edges remain visible; the selected-node line explains that lifecycle is the outstanding prerequisite.

Use one directed graph form for explicit dependencies, including a simple serial chain. Connect prerequisites to consumers. Select a node to inspect its state and open the accepted detail view; Back returns to the graph selection, then to FleetView. The upper main conversation stays visible, while the graph takes the bottom interaction region.

This accepted division uses a compact list and an on-demand relationship view, without a menu of interchangeable list/tree/graph renderers. Graphs come from recorded dependencies, not inferred relationships between prompt text or agent names. The sample reports and timings are illustrative. Its Waiting reason is truthful for this particular join; it is not a claim that every queued task is waiting on an unfinished dependency. Upstream's ready-wave scheduling remains the runtime baseline. Acceptance covers the relationship presentation, not the graph image's illustrative key hints.

**Accepted UIR03.** Keep FleetView as a list and offer an on-demand graph only for actual dependencies, with nodes opening the same detail view.

## UIR04: focus and local help proposal

**Required correction.** FleetView being visible does not mean it has keyboard focus. The maintainer requires FleetView navigation/action help to appear only while focus is in that list. Typing in the main editor hides that help while retaining the agent rows.

### Reference behavior

The inspected Pi 0.85.1 [selection bindings](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/keybindings.ts) default to up/down, Enter and Escape/Ctrl+C. Its [ExtensionSelector](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/extension-selector.ts) additionally accepts `j/k`, but displays `↑↓ navigate` and configured confirm/cancel hints below the list. Other Pi selectors place help above the list; there is no single Pi-wide help position.

The recorded Claude Code 2.1.261 [focused FleetView](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/assets/claude-subagent-ui/02-selected.txt) places action help above its rows. In the [editor-focused capture](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/assets/claude-subagent-ui/04-message.txt), the rows remain but FleetView action help is replaced by editor-context help. Claude's separate row pointer and active-session circle have different meanings. Our accepted circle-only selection does not copy that two-marker scheme or imply host session switching.

The earlier `j/k select` footer was a concept choice, not a shared Pi/Claude default. Prefer Pi's configured selection bindings and show their actual keys. The new images use default arrow/Enter labels and Pi Stuff's fixed Esc-back rule.

### Main editor focused

![Main editor has the caret; FleetView has no local help or selected circle](assets/subagents-redevelopment-ui/08-editor-focus.png)

The draft has a visible text caret. All FleetView circles are hollow and local help is absent. The previous list selection is retained internally for returning to the list. Editor cursor movement, history and autocomplete keep their Pi behavior.

### FleetView focused

![FleetView shows local navigation help above its rows and fills only the selected circle](assets/subagents-redevelopment-ui/09-fleet-focus.png)

The draft remains, without its caret. Only the selected lifecycle circle is filled. One muted help line sits between statusline and rows: `↑↓ navigate · enter view · esc back`. There is no extra pointer, selected-row background or help below the list. The two concepts retain the same row positions; the spare line is illustrative, not a fixed-height requirement.

The proposed help position follows Claude's local action placement. Navigation follows Pi's selection bindings. Earlier approval of arrows to enter FleetView remains; the entry must preserve normal editor handling. This round does not define stop, message or other intervention shortcuts.

**UIR04 question. Put focused FleetView help above its rows, use Pi selection-key labels, and show the filled selection circle only while the list is focused?** Recommendation: yes. The caret and circle make the keyboard target visible without adding a row highlight.

## Verification and next step

UIR03 and focus-dependent help visibility are accepted. The two new concepts were visually inspected for caret visibility, help placement, circle selection and aligned rows. Concept images do not establish terminal behavior. This round changes documentation and images only. Await the UIR04 answer before advancing the interview.
