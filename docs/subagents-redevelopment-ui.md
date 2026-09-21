# Subagent UI redevelopment decisions

[简体中文](i18n/zh-CN/subagents-redevelopment-ui.md). English is authoritative.

Status: UIR01 and revised UIR02 accepted on 2026-09-20; UIR03-UIR09 accepted on 2026-09-21. The [formal specification](subagents-redevelopment-spec.md) settles the remaining native-component, keyboard and reading details after the [UI review](subagents-redevelopment-ui-review.md). FleetView help appears above its rows only while the list has keyboard focus. The first UIR02 image remains rejected design history. Tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97), under [#64](https://github.com/jczhang02/pi-stuff/issues/64). Runtime scope is settled in the [redevelopment decisions](subagents-redevelopment.md).

This record preserves the completed visual discussion through real usage scenarios: main layout and transitions; FleetView and task structure; details and observability; interventions; completion and history; keyboard and visual consistency. The maintainer's feedback brings detail hierarchy into this round. The previous UI is a starting point, not a wholesale adoption of its old runtime requirements.

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

Transcript opens full recorded output. Info provides access to supporting configuration, workspace, usage and history. Their final organization is defined in the formal specification.

### After completion

![Completed investigation with its report immediately visible](assets/subagents-redevelopment-ui/05-detail-done.png)

The same central area shows the final report directly. Its conclusion and supporting observations are readable without opening a Result section. Tool evidence is folded. The header says Done because the investigation completed successfully, even though its report identifies an upstream problem.

The working and completed images are states of one design. The local action hints change from message/stop to follow-up as appropriate. Key assignments and action behavior are illustrative until the interaction round.

**Accepted UIR02.** Show the latest reply and current activity while working, then the report on completion, with supporting information one step deeper. Preserve access to full evidence while making the first screen useful on its own. UIR06 covers pending questions; UIR08 covers failed-task details.

## UIR03: FleetView and task relationships accepted

FleetView remains the compact list accepted in UIR01. Its row layout does not change when a task has dependencies. Independent work needs no extra relationship diagram. When the selected task belongs to a dependency workflow, provide an entry to its actual dependency graph in the bottom inspection area. The formal specification assigns the local `g` entry.

### Independent investigations

![Three independent investigations in the usual FleetView](assets/subagents-redevelopment-ui/06-independent-fleet.png)

Lifecycle, packages and tests investigate independently. Each row can open its detail. There are no dependency arrows or an invented parent-child tree. The historical image's bottom `j/k` hint is superseded by the focus comparison in UIR04.

### A workflow with dependencies

![Two prerequisites feeding a reviewer, with one report still pending](assets/subagents-redevelopment-ui/07-dependency-graph.png)

This is a separate scenario: reviewer requires the results of lifecycle and packages. The image shows the graph after opening it from FleetView. Packages is done, lifecycle is still working, and reviewer has not started. Both dependency edges remain visible; the selected-node line explains that lifecycle is the outstanding prerequisite.

Use one directed graph form for explicit dependencies, including a simple serial chain. Connect prerequisites to consumers. Select a node to inspect its state and open the accepted detail view; Back returns to the graph selection, then to FleetView. The upper main conversation stays visible, while the graph takes the bottom interaction region.

This accepted division uses a compact list and an on-demand relationship view, without a menu of interchangeable list/tree/graph renderers. Graphs come from recorded dependencies, not inferred relationships between prompt text or agent names. The sample reports and timings are illustrative. Its Waiting reason is truthful for this particular join; it is not a claim that every queued task is waiting on an unfinished dependency. Upstream's ready-wave scheduling remains the runtime baseline. Acceptance covers the relationship presentation, not the graph image's illustrative key hints.

**Accepted UIR03.** Keep FleetView as a list and offer an on-demand graph only for actual dependencies, with nodes opening the same detail view.

## UIR04: local help accepted

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

The accepted help position follows Claude's local action placement. Navigation follows Pi's selection bindings. Earlier approval of arrows to enter FleetView remains; the entry must preserve normal editor handling. This round does not define stop, message or other intervention shortcuts.

**Accepted UIR04.** Place FleetView's local action help above its rows, below the statusline, and change it with keyboard focus. Show FleetView actions when the list is focused; hide those actions when focus returns to the editor. The maintainer explicitly accepted this Claude-style help behavior. Exact hint wording and the images' hollow-circle treatment outside list focus remain illustrative; the earlier circle-only selection rule still applies.

## UIR05: sending an instruction from detail accepted

Scenario: lifecycle is investigating worktree recovery. The user wants it to focus on the missing-branch path and leave files unchanged. The following three images show successive states of that interaction.

### What upstream supports

Arhen's [steering tool](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/index.ts#L351-L377) calls the running child's session with `streamingBehavior: "steer"`. Pi [queues that input](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts) while streaming and removes it from the pending steering list when its user-message event starts. It does not immediately abort an executing tool or prove that the model understood the instruction.

This is distinct from sibling mailboxes, which recipients poll, and from replying to a child blocked on `ask_parent`. This round covers steering a working child. Completed-agent follow-up is already in RQ05; UIR09 proposes its UI. UIR06 covers the pending-question UI.

Source inspection also exposes a false-positive path in [steerTask](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1434-L1441): a specified ID can return success without a live child, and the session call is fire-and-forget. The redevelopment must validate the actual target and queue acceptance before displaying success. This is a source finding to reproduce and repair under the existing bug-fix scope, not an executed regression test or a new receipt protocol.

### 1. Compose while keeping the finding visible

![A local message editor beneath the child's latest finding](assets/subagents-redevelopment-ui/10-message-compose.png)

The detail's Message action opens a temporary local editor below the latest reply. Identity, assignment and current finding remain visible; the activity trail folds to make room. The composer names lifecycle as its recipient. It does not restore the main editor, statusline or FleetView, and does not switch the host session.

The illustrated keys are `m` to open Message, Enter to send, Shift+Enter for a newline and Esc to return to detail. Use Pi's configured submit/newline bindings and the fixed Esc-back rule. While typing, only composer help is shown; letters such as `m` and `x` are text, not detail actions. Esc sends nothing and preserves the local draft when reopening it for the same child.

### 2. Show the queued instruction

![The composer closes and the accepted instruction remains visible as queued](assets/subagents-redevelopment-ui/11-message-queued.png)

After queue acceptance, close the composer and restore detail. Keep the exact instruction visible with `Queued` while it remains pending. In this scene, a tool is still working, so the explanation says it is waiting for the current step to finish. Derive that explanation from actual activity; do not display it for every possible delay.

A submission error leaves the draft available and explains why the instruction was not queued. Do not show success from the upstream manager's boolean alone. Never label queue acceptance as Read, Applied or Acknowledged.

### 3. Let the child's reply show what happened

![The child produces a new reply and the user's message folds into the record](assets/subagents-redevelopment-ui/12-message-response.png)

Once this instruction actually enters the conversation, remove its pending indication. An unrelated child event is not enough. The example then shows a new child reply: it will trace the missing-branch fallback without editing files. That text is illustrative model output, not a UI-generated acknowledgement or an enforced wording requirement.

The user's message folds to one line and remains available in the transcript. The latest child reply and current activity again take priority. There is no separate messaging dashboard or extra model call to summarize compliance.

**Accepted UIR05.** Use a temporary editor inside child detail, close it after actual queue acceptance, and show pending input followed by the child's actual response in the same detail. Preserve the draft on Esc or submission failure. It keeps the recipient and current work visible throughout the interaction without inventing a read or compliance receipt.

## UIR06: a child asks its parent a question, accepted

Scenario: lifecycle has found the worktree fallback and asks whether to reproduce it or continue tracing the source. These two images show the pending question and an optional human reply.

### What upstream supports

Arhen's [ask_parent](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/child.ts#L18-L34) takes one plain-text question. It blocks the child and asks the parent agent, not the human directly. The [manager](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L572-L600) marks the child awaiting_parent and routes the question through the parent's pending wait result or a follow-up message.

The parent answers through [reply_subagent](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/index.ts#L331-L350), which resolves the blocked call. This is different from steering a working child. Upstream [peek](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/peek.ts#L136-L191) can inspect or cancel but has no human reply composer. The accepted design adds that UI entry to the same reply operation, within the agreed single-tool design.

The [task snapshot](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/types.ts#L18-L51) records the waiting state but not the question text. The UI must obtain the original text from the existing question event or child transcript and associate it with the live pending question. Do not infer a question from the latest reply or show an old question as still pending. This proposal does not add a durable question protocol or change recovery behavior.

Upstream has a [10-minute reply timeout](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L622-L650); after that, it returns a fallback instruction to the child. The UI follows the actual pending state. No countdown or human-approval gate is introduced.

### 1. Make the pending question the primary content

![A question for main takes priority in the child's detail](assets/subagents-redevelopment-ui/13-question-pending.png)

The header says Waiting for main, so it does not imply that the human must answer. The question replaces Latest update as the central content. The example's explanation is part of the child's question text, not a UI-generated summary. Prior tool activity folds below it; no live tool is depicted while this child is blocked.

The parent remains free to answer through its normal flow. Opening detail does not reserve the question for the human or interrupt the parent. The main transcript stays above, and the accepted bottom-detail layout remains.

### 2. Reply while keeping the question visible

![A temporary reply editor beneath the original pending question](assets/subagents-redevelopment-ui/14-question-reply.png)

Enter opens a local editor labelled Reply to lifecycle. It uses the UIR05 composer pattern and Pi's configured submit/newline bindings, with Esc returning without sending. The original question stays visible. Typing uses composer bindings rather than detail shortcuts.

Submit answers this pending question through the reply operation; it does not enqueue a steering message. Close the composer only after the reply is accepted. The UI may briefly show Answer sent, but returns to normal working detail only when the child actually resumes. Its later reply and activity show the result; do not invent Read, Applied or Acknowledged.

Bind submission to the question that was opened. If it has already been answered, expired or cancelled, preserve the draft and refresh detail with a concise explanation. Do not send that draft to a later question or silently turn it into steering. A delivery failure also preserves the draft. These are correctness requirements for the reply entry, not additional runtime features.

**Accepted UIR06.** Give a pending question priority in child detail and allow an optional human reply through the same local composer. The parent can still answer normally. Preserve the question while composing and retain the draft if submission fails or that question is no longer pending.

## UIR07: stopping a child and retaining its work, accepted

Scenario: the user stops lifecycle before it finishes its investigation. Its latest finding remains useful. Packages is independent; reviewer needs lifecycle's completed result. The three images are consecutive states of the same detail.

### What upstream supports

Arhen [wires peek's stop action](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/index.ts#L23-L52) to the selected task. Its [inline confirmation](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/peek.ts#L183-L191) uses x then y. The separate run-level cancellation operation stops the run's nonterminal tasks. This detail action targets lifecycle, not every agent.

The [single-task cancellation path](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1443-L1457) does not cancel unrelated siblings. The [scheduler](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1201-L1249) skips a dependent whose prerequisite did not complete. In this scenario, packages can finish and reviewer will be skipped. This is a dependency consequence, not recursive cancellation.

Upstream [retains the session and last output](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1014-L1056). For a write task it tries to commit partial work to the task branch, removing the worktree directory after successful preservation; a commit failure leaves the directory for inspection. Stop does not roll back completed edits. Show actual available output and workspace evidence; do not equate stopping with a successful save.

### 1. Confirm within the existing detail

![An inline confirmation names lifecycle and explains the effect on reviewer](assets/subagents-redevelopment-ui/15-stop-confirm.png)

The x action temporarily replaces the detail footer with Stop lifecycle?, a short preservation statement and the known dependency consequence. Enter confirms and Esc dismisses the confirmation. The child keeps working until confirmation. Keep the current finding and activity visible, without a modal or dimming. Use Pi's configured confirmation binding and the fixed Esc-back rule.

The reviewer notice comes from this workflow's actual dependency. Do not display it for independent tasks. The preservation statement describes the operation's intent, not a completed-save receipt; any preservation failure must remain visible under the shared error rules.

### 2. Distinguish a stop request from a stopped child

![Stopping remains visible until execution and request finalization have ended](assets/subagents-redevelopment-ui/16-stopping.png)

After confirmation, display Stopping and retain the last output. Reading the transcript and returning remain available. Do not offer another stop, message or resume while stopping is in progress. Esc returns to FleetView; it does not undo the stop request.

There is a source-level timing issue to reproduce: upstream marks the task aborted before the underlying child abort and finalization have completed, without awaiting them in cancelTask. That status alone cannot justify this UI's Stopped label. The rewrite must observe actual completion of the stop and request finalization before displaying it, using the existing execution lifecycle. This is a pending correctness repair under the agreed fix scope, not evidence that upstream already provides a stop-completion event or a new durable recovery system.

### 3. Keep the incomplete work readable

![Stopped detail retains the last finding, incomplete-report notice and resume entry](assets/subagents-redevelopment-ui/17-stopped.png)

Stopped is distinct from Done and Failed. The last child reply and tool evidence stay available, and the page says that the report was not finished. Do not generate a replacement report. This read-only example has no file changes. Reviewer is shown as skipped only after the scheduler records that outcome.

In this last image, packages has also finished, reviewer has been skipped and the run has settled. A retained session is available, so m resume can open the same local composer pattern used in UIR05. It keeps the last output visible while the user specifies how to continue. A successful resume starts a new request in the retained child context, preserving the stopped request under RQ07 and its own workspace under RQ08.

Upstream [resume prerequisites](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1352) require the run to settle and a retained session to exist. If those conditions are not met, explain the actual reason instead of offering an action that cannot run. Resume [executes only this child](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1394-L1411); it does not automatically restart reviewer. Completed-agent follow-up remains separately accepted in RQ05. This round adds no automatic retry, rollback or workflow restart.

**Accepted UIR07.** Confirm stop within the current detail, show Stopping until execution and request finalization have ended, then retain the incomplete output and actual dependency consequences. Offer the local resume composer when the existing resume conditions are satisfied. Keep the stopped request and do not automatically restart its dependents.

## UIR08: failed-task details, accepted

Use the same detail layout for both examples below. Put the failed operation, actual cause and useful next step first, followed by any retained output. These are different scenarios, not consecutive states or separate viewing modes.

### What upstream supports

Arhen [handles assistant failure stop reasons](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L652-L710) as well as [exceptions from execution](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1004-L1030). A provider failure can arrive in the final assistant message rather than as a rejected prompt call. Existing text, usage and the session remain available when they were produced; the UI must not discard them or mistake the earlier text for a completed report.

Resume uses the actual [retained-session and settled-run prerequisites](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1352). Upstream's [format helper](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/format.ts#L223-L244) treats missing final text as a startup failure, but a child can have a resumable session before producing any text. This is a source finding to reproduce and correct: output emptiness does not determine whether a session exists.

A single tool error can return to the model while the task continues. It belongs in the tool activity and transcript; do not mark the whole task Failed merely because a read or command failed. Likewise, an invalid model [rejected before run creation](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1125-L1139) is a dispatch error in main, not a reason to fabricate a child row or transcript.

### 1. Execution failed after producing useful output

![Model failure shows the cause first and preserves the earlier finding](assets/subagents-redevelopment-ui/18-model-failed.png)

Lifecycle has made two read calls and found a possible fallback problem. Its later model request fails. The settled failure is now the primary content: Model request, the illustrative Connection error, and a suggestion to check the connection before resuming. Show the actual reported cause; do not use a model call to invent a diagnosis.

The prior finding stays visible under Last update, with full evidence available through Transcript. Reviewer is shown as skipped because its prerequisite failed. In this example the run has settled and the saved session is usable, so m resume opens the same local composer accepted in UIR07. Resume continues the retained context; it is not a generic retry that silently starts a different agent.

The native error notice remains in the main chat, following the shared notification rules. The detail provides the context and available actions when opened; it does not replace that notice with a disappearing toast.

### 2. Worktree setup failed before the child started

![Startup failure shows the underlying cause and omits unavailable resume and transcript actions](assets/subagents-redevelopment-ui/19-launch-failed.png)

This separate example concerns implementer, a write-capable task. Creating its worktree directory fails with a permission error. It uses the parent's current model and has made no model request. No child session or project-file edits exist, so the detail shows the startup cause and directs the user to fix the permissions before asking main to launch again.

There is no Last update placeholder, child transcript link or resume action. Info still exposes the available task configuration and full launch error. The error path, elapsed time and zero-token count are illustrative known facts of this example; implementation must not substitute zero for unavailable usage.

This image depicts the accepted RQ03 repair. Pinned arhen currently [catches worktree initialization errors and continues in the source directory](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L768-L817). That behavior must be reproduced and fixed before this image can become runtime evidence. The proposal adds no automatic relaunch or new Retry operation.

### Preserve the distinction between execution and code preservation

A finished model task can still have a [worktree commit error](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L957-L1001). Upstream's failed/aborted [partial-commit path](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1041-L1052) also leaves the directory when preservation fails without recording that error in worktreeError. Record this source finding for reproduction and repair; a branch name alone is not proof that edits were saved. UIR09 proposes the completed-work presentation, including a commit failure alongside an existing report.

**Accepted UIR08.** Give the cause and next step priority in failed-task detail, retain useful output, and show Resume and Transcript only when their actual prerequisites hold. The same layout covers interrupted work and launch failures before model execution.

## UIR09: completed work and follow-up accepted

Scenario: implementer fixes missing-branch recovery in its own worktree. The first two images show completion followed by an unsent follow-up. The third is an alternative outcome in which the same report finishes but Git cannot commit the edits.

### What upstream supports

Arhen [records the report and completed status before committing worktree changes](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L950-L1003). A successful commit preserves the branch and permits worktree-directory cleanup. A commit error keeps the task completed, records worktreeError and retains the directory. The UI must distinguish the model's result from the Git outcome and wait for actual finalization before claiming that edits were committed.

The [commit helper](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/worktree.ts#L128-L159) distinguishes committed changes from an empty staging area. Show the actual result; do not infer a new commit from a branch name or from the child's prose. Upstream's [result text](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/format.ts#L174-L198) leaves review and merge to the parent. Saved child work does not mean that the parent workspace has received it.

Completed follow-up is the accepted RQ05 addition. Upstream [rejects completed-task resume and resets the previous report when resuming other terminal tasks](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts#L1333-L1411). RQ07 requires separate request records; RQ08 requires continuation from the child's own code. These images depict the agreed additions, not current upstream support.

### 1. Read the result directly

![Completed report with a concise code-preservation result and follow-up action](assets/subagents-redevelopment-ui/20-completed-work.png)

The report is immediately readable, with Activity folded beneath it. The header shows this request's elapsed time and output tokens. Detailed and cumulative usage remain in Info. A single workspace line confirms that the edits were saved on the task branch and have not been applied to main in this example; full branch and diff information is available in Info. Read-only tasks do not acquire a fictitious saved-branch line.

The report and its test claim are illustrative child output. Render the real report without an extra model-generated summary or a UI-invented test verdict. Long reports follow the shared bounded reading and pagination rules.

### 2. Continue while keeping the report visible

![A follow-up draft beneath the completed report](assets/subagents-redevelopment-ui/21-follow-up-compose.png)

The m follow-up action opens the same local composer used by UIR05. Its label names implementer, and the earlier report remains visible. The draft asks for the underlying Git error to be included in the failure message. Until submission, Done and the header metrics still belong to the finished request.

Use Pi's configured submit/newline bindings and Esc to return without sending. Preserve the draft on Esc or submission failure. While typing, letters belong to the editor and only composer help is shown. Once the new request is accepted, show its actual starting/working detail. Keep the earlier report, status, elapsed time and usage in history under RQ07; do not overwrite them or leave an old report labelled as the new request's output. The formal specification defines the Info and history reading path.

Offer follow-up when the run has settled, the child is no longer executing, and its saved session and required code state are usable. If a prerequisite fails, explain it and retain the draft. Continue the same context and own branch under RQ05-RQ08. No automatic rerun of prerequisites or downstream tasks follows from this action.

### 3. Keep a commit failure visible beside the completed report

![A completed report remains readable while an actual Git commit failure takes priority](assets/subagents-redevelopment-ui/22-commit-failed.png)

Here Git reports a full disk. The header says Done and Commit failed together, with the error emphasized. The main chat retains its native error notice. Detail explains that the edits remain uncommitted in the worktree, then displays the completed report unchanged. Info exposes the full error and retained workspace location. There is no successful-save line.

The example assumes finalization has ended and the session and own worktree remain usable, so follow-up is available after the user addresses the disk problem. This does not introduce a commit retry button or promise automatic repair. The displayed Git error and retained-files statement must follow observed results, not merely the presence of a branch field.

Upstream still schedules from completed status after a commit failure. A downstream worktree may therefore lack those uncommitted edits. This source finding limits what Done can claim; the UI must not imply successful code handoff. This round does not change dependency scheduling or add a new runtime terminal state. The header presents the existing execution and preservation outcomes together.

**Accepted UIR09.** Keep the completed report visible during follow-up, and show code-preservation errors prominently without discarding that report. Reuse the accepted detail and composer, retain each request's record, and make the actual Git outcome visible.

## Review and formal specification

UIR01-UIR09 are accepted. The [UI review](subagents-redevelopment-ui-review.md) retains the visual direction and closes the remaining contract gaps through the [formal specification](subagents-redevelopment-spec.md): Pi-native composition, focus priority, complete Transcript/Info/history paths, bounded layouts and shared state/metric semantics. Historical key hints, exact picture geometry and proposal language above are design history, not unresolved decisions.

The concepts were visually inspected, and Pi/arhen source and harness references were checked. No redevelopment completion, follow-up, recovery, commit-failure or terminal interaction test has run. Reports, test claims, errors and metrics remain illustrative. ImageGen concepts are not terminal acceptance evidence.
