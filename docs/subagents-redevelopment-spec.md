# Subagent redevelopment specification

[简体中文](i18n/zh-CN/subagents-redevelopment-spec.md). English is authoritative.

Status: formal implementation contract, 2026-09-21. Published under [#97](https://github.com/jczhang02/pi-stuff/issues/97), part of [#64](https://github.com/jczhang02/pi-stuff/issues/64). RQ01-RQ10 and UIR01-UIR09 are accepted. This specification consolidates them and the UI review; it supersedes the previous F01-F33, Q/R and UI01-UI15 implementation contract. It does not claim the redevelopment is implemented or authorize merge or release.

## Problem Statement

The previous independent implementation grew beyond the selected upstream package and failed to start ordinary read-only work in a real project with installed dependencies. Its ignored-file scan exhausted its own Git output limit before calling the model. The maintainer wants arhen's smaller execution model, rewritten to repository standards, with a UI that makes work, questions, results and failures easy to inspect without leaving the main Pi conversation.

The UI decisions now cover the main workflow, but their picture-by-picture history leaves gaps in keyboard ownership, retained-report access and long-content behavior. Those gaps must be settled before another implementation invents its own product.

## Solution

Redevelop from `@arhen/pi-core-subagent` 1.3.55, inspected at `676b11eb415cd46fbede712b5bbb075ff3f043bf`. Preserve its selected behavior and fix demonstrated defects. Consolidate the parent's operations into one `subagent` tool. Add the accepted completed-agent follow-up, per-request records and child extension tools.

Use the accepted full-width FleetView below the main statusline. Open child details, dependency graphs and supporting readers in the bottom interaction region while the main transcript stays above. Reuse Pi's editors, message/tool rendering, theme, keyboard matching and notifications wherever their public interfaces fit. Supply only the missing composition, FleetView, graph and bounded reading behavior. Claude Code informs focus-related help and useful detail ordering; it does not supply a host-switching requirement.

## User Stories

1. As a parent agent, I want one delegation tool, so that I can launch and manage children without learning a separate tool for each operation.
2. As a developer, I want a read-only investigator to read my selected working directory, so that it can inspect current files without a baseline snapshot scan.
3. As a developer, I want independent investigations to run concurrently, so that unrelated work can progress together.
4. As a parent agent, I want a serial chain, so that each worker receives its predecessor's result.
5. As a parent agent, I want explicit dependency edges, so that a reviewer starts with the required reports already in its input.
6. As a developer, I want invalid dependencies rejected before launch, so that malformed workflows do not start partial work.
7. As a developer, I want queued work to explain its actual wait, so that I can distinguish dependencies, a wave barrier and limited concurrency.
8. As a parent agent, I want background dispatch and explicit waiting, so that I can keep working or collect a finished result.
9. As a parent agent, I want status and full results separately, so that checking progress does not repeatedly inject whole transcripts.
10. As a developer, I want task-completion notifications and runtime limits, so that background work remains observable and bounded.
11. As a developer, I want agent-file instructions, models and tools respected, so that existing role definitions remain useful.
12. As a parent agent, I want per-task model, thinking, directory and tool settings, so that I can fit workers to their jobs.
13. As a developer, I want the effective model and any fallback explained, so that the visible configuration matches actual execution.
14. As a developer, I want write-capable children to use their task worktrees, so that parallel changes do not collide in my checkout.
15. As a developer, I want worktree initialization failure to stop launch, so that it never silently turns into source-directory editing.
16. As a parent agent, I want upstream dependency results and branch ancestry reported accurately, so that I can distinguish textual handoff from code availability.
17. As a developer, I want the actual Git result, changed files and branch available, so that I can review work before integrating it.
18. As a developer, I want commit failures to preserve evidence and remain visible, so that Done does not hide unsaved changes.
19. As a child agent, I want to ask or notify my parent, so that I can resolve uncertainty without flooding its context.
20. As a child agent, I want the upstream sibling mailbox, so that independent workers can exchange information explicitly.
21. As a parent agent or user, I want to steer a live child, so that I can correct its direction during work.
22. As a user, I want to see my exact pending instruction, so that queue acceptance is distinguishable from the child's response.
23. As a user, I want to answer a pending child question while reading it, so that I do not lose the question's context.
24. As a user, I want an expired or already-answered question to retain my draft, so that my text is not sent to a different question.
25. As a user, I want to stop one child without stopping independent siblings, so that intervention stays targeted.
26. As a user, I want Stopping until execution and finalization actually finish, so that I know when work has ended.
27. As a user, I want stopped and failed output retained, so that useful evidence is not replaced by an empty result.
28. As a parent agent or user, I want to resume eligible failed or stopped children, so that their saved context remains useful.
29. As a parent agent or user, I want to follow up with a completed child, so that the same reviewer can check a later fix.
30. As a developer, I want a continuing writer to retain its own code branch, so that new requests build on its previous work.
31. As a user, I want each request's report and metrics retained, so that later work does not overwrite earlier evidence.
32. As a developer, I want compatible extension tools in child sessions, so that researchers can use tools such as web search directly.
33. As a developer, I want child extension tools bounded by the parent's active set and the role, so that loading extensions does not widen their callable scope.
34. As a developer, I want unsupported child UI requests and required-tool load failures reported, so that headless operation never looks like a silent success.
35. As a user, I want aligned FleetView names, descriptions and trailing state or metrics, so that I can compare agents at a glance.
36. As a user, I want the latest useful reply, pending question, failure or report first, so that opening detail immediately answers what matters now.
37. As a keyboard user, I want Pi's editing, history and completion to retain priority, so that inspecting agents does not damage ordinary typing.
38. As a keyboard user, I want local help to follow focus and actual bindings, so that I do not have to remember a second keyboard system.
39. As a user, I want to leave detail and recover my main draft and list selection, so that checking a child does not disrupt the main conversation.
40. As a user, I want a real dependency graph only where dependencies exist, so that independent work remains a simple list.
41. As a user, I want full recorded text, tool evidence, configuration and request history reachable, so that a compact display does not conceal important information.
42. As a user, I want long output and new events to preserve my reading position and draft, so that I can inspect evidence while work continues.
43. As a user, I want usable light, dark and narrow-terminal layouts, so that the interface fits my real terminal.
44. As a developer, I want new records separate from the previous implementation's data, so that redeveloping does not destroy or misinterpret old work.
45. As a maintainer, I want public-entrypoint tests and real-project acceptance, so that attractive mockups and tiny fixtures cannot conceal another startup regression.

## Implementation Decisions

### 1. Runtime boundary and ownership

- The arhen behavioral baseline is the reference for matters not explicitly changed here. Rewrite internals to strict TypeScript, pinned Bun and Effect v4 for boundary decoding, typed errors and necessary I/O. Keep pure calculations ordinary functions. Retain upstream license and provenance.
- Keep execution, communication, workspaces and request records owned by the subagent capability. A thin Pi adapter registers the single tool and projects that state into UI. Reading or navigating must not modify task status or trigger model calls.
- Children remain separate in-process Pi AgentSessions. A run groups submitted tasks; a child retains conversation context; a request is one execution of that child. Follow-up and resume append request records. A display name is not a durable address. Internal task/run/request identifiers remain available to tools and records but are not normal UI labels.
- Preserve native child session records and upstream run restoration. A restored nonterminal run is interrupted, not silently restarted. Pending live questions are not durable approvals. New metadata is separate from the previous implementation's format; no migration or deletion is required.

### 2. Single parent tool and upstream coverage

One `subagent` operation discriminator covers dispatch, status, result, wait, reply, steer, resume, follow-up and cancel. Dispatch preserves single, parallel, chain and explicit `needs` inputs. Status is non-blocking; result reads one task or the run; wait supports a timeout and the upstream question wake-up behavior. Steer addresses one live child or the live members of a run; cancel can target one task or the run. No separate parent tool registrations remain. Exact parameter names may be redesigned without importing the old protocol's extra operations.

Preserve per-task role/system prompt, task text, write/tool selection, model, thinking, cwd and runtime limit; run-level concurrency, auto-await and per-task notification selection. Retain upstream defaults: at most 16 submitted tasks, concurrency 3 with maximum 8, background dispatch, per-task notifications on, explicit runtime limit or the auto-limit setting's 1-hour/6-hour ceiling. Keep the simple upstream auto-limit setting and command; do not create a separate settings application.

Agent-file discovery and matching follow the pinned upstream precedence, including project/home lookup and its description matching. Validate model and thinking against Pi's actual registry and report effective values and override/fallback notes. Built-in read/write selection follows upstream; RQ09 additionally caps inherited extension tools at the parent's active extension tools, narrowed by role. Do not silently weaken an explicit required tool request.

### 3. Dependencies and workspaces

- Validate duplicate/unknown IDs, self-dependencies and cycles before any child starts. Serial chains are dependency edges with the upstream previous-output substitution. Edges carry named predecessor output as well as ordering.
- Preserve ready-wave scheduling and its concurrency limit. A later wave does not begin merely because one prerequisite finished while the current wave still runs. Failed or stopped prerequisites cause their dependents to be skipped; independent siblings continue. Follow-up/resume does not automatically rerun any other node.
- Read-only tasks use their selected current directory without a Git snapshot or exhaustive ignored-file scan. Write tasks require a usable task worktree; initialization or required-branch recovery failure fails launch, including inability to provide that worktree. No automatic fallback to source-directory writes.
- Preserve the upstream base rule: HEAD for independent writes; the selected completed dependency branch for stacked writes. With several write dependencies, upstream selects the last eligible dependency branch; it does not merge all branches. Text from all dependencies is not proof that all their code is present. Report actual ancestry.
- Parent uncommitted changes are not automatically imported into write worktrees. Shared `node_modules` remains shared, not sandboxed. Preserve the upstream instruction against dependency installation/deletion from child worktrees. Tool selection is not process isolation.
- Preserve actual commit/diff/changed-file evidence, partial-work preservation and cleanup that retains branches and live work. Failed preservation retains the recoverable directory and reports the error. Never claim saved code from a branch field alone. Parent review and integration remain separate actions.
- A completed report and a commit failure can coexist. Preserve upstream scheduling semantics for this case; do not add a new scheduler terminal state or imply a successful code handoff. The UI and returned result must expose that limitation.

### 4. Communication, continuation and defect repairs

Preserve `ask_parent`, `notify_parent`, sibling send and mailbox polling as child communication tools, including the upstream bounded question wait. The parent delegation tool is not injected into children. This redevelopment does not enable recursive delegation.

Steering must target a live child and confirm actual queue acceptance. Keep the exact instruction pending until the corresponding input enters that child's conversation. Reply must resolve the question opened by the composer; concurrent parent reply, expiry or cancellation must not retarget it. These checks repair receipt correctness without adding an acknowledgement protocol.

Stop requests use the existing cancellation lifecycle. Show Stopping while execution or request finalization remains active. Preserve output and report actual file-preservation outcomes. Resume and completed follow-up require a settled run, no active execution of that child, a usable saved session and required own code state. A writer reuses its remaining worktree or reattaches its own branch; a read-only child reads its current selected directory. Each accepted continuation starts a separate request record, preserving old report, status, time and usage; cumulative child usage remains available.

Reproduce and repair the inspected defects: source-directory fallback, false steering success, early stopped status, confusing empty text with missing session, and missing partial-commit error reporting. Handle provider failures reported by an assistant stop reason as well as thrown exceptions. A failed tool call alone does not fail the whole task. Dispatch rejected before run creation must not fabricate a child or transcript.

Child extensions load and bind in the child's session from selected parent-loaded sources. Fail launch when required loading/binding fails. Tools requiring unsupported interactive UI return an explicit error; do not forward UI automatically or let Pi's empty headless response masquerade as success. Preserve the selected extension ceiling and upstream communication tools.

### 5. Pi-native composition

| Surface                    | Reuse                                                                                          | Feature-owned part                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Main input                 | `CustomEditor`, host history/completion and editing                                            | Editor-edge entry and focus routing                                |
| Local input                | Pi `Editor`, its editing/submit/newline bindings                                               | Recipient, draft target and accepted-send lifecycle                |
| Replies/reports/transcript | Native message/Markdown and tool-execution components where their public inputs fit            | Request selection, bounded viewport, event-to-component projection |
| Lists and help             | Pi selection bindings, key matching, generated key hints; native list component where suitable | Circle-only FleetView rows and graph selection                     |
| Theme and width            | Active semantic theme, native wrapping, truncation and visible-cell width                      | Shared column budgets and responsive priority                      |
| Notifications              | `ctx.ui.notify` and normal main-chat tool results                                              | Accurate operation/outcome text                                    |
| Bottom placement           | Public editor/footer composition hooks                                                         | Switching the bottom region and restoring its state                |

Pi's `belowEditor` widget placement is before the footer, so it cannot by itself put FleetView below the statusline. Use the public footer hook for that placement. `FooterComponent` is exported but needs the live parent AgentSession, which the standard extension footer factory does not supply. Do not cast a partial context into a session or reach into host private fields. Use the documented footer context/provider inputs for the smallest necessary statusline adapter; centralize its formatting and preserve extension statuses. Do not promise direct native-footer reuse where its inputs are unavailable.

Use a small `CustomEditor` extension and public footer composition for bottom-region replacement. Do not rebuild Pi's editor, session switcher or terminal framework. A generic `ui.custom` call does not alone promise to remove the main footer and widgets. Native components are building blocks, not a ready-made subagent inspector. Prefer native `ScrollView` for scrolling where the host slot supports its layout contract, with feature-owned paging/anchor policy rather than another generic scroll engine. Use public `keyText`/`keyHint`/`rawKeyHint`; internal helper exports are not an extension contract. Verify composition in the actual pinned host; do not satisfy the design by reaching into host containers. Here "main statusline" means the cwd/model/usage footer, not Pi's entire status container. Hide the built-in working indicator through `setWorkingVisible(false)` while inspecting and restore it on exit. Other host pending/status rows and unrelated extension widgets remain outside this feature's removal authority; account for their space without mutating host containers. On reload/session teardown, release owned subscriptions/components and resynchronize from the current context. Existing native tool renderers should receive real results and the child's cwd; unavailable renderer data must use Pi's supported fallback rather than synthetic tool output.

Background notifications are agent orchestration messages. Deliver the necessary reports/questions to the parent model, but render a compact event summary in the main conversation, expandable through Pi's native tool-expansion binding. Structured tool results follow the same compact/expanded convention. The parent gives the user-facing answer; avoid asking it to echo every notification or duplicate a UI question. A continuation completion includes only newly executed request reports, not unchanged siblings. Preserve errors, background wake-ups and non-TUI question handling.

### 6. Main, FleetView and graph

Main transcript, editor and statusline keep their order. FleetView follows the statusline and spans available width. Icons align with its left edge; there is no extra gutter. Main has no description. Only the selected circle changes, with no row background or second pointer. Filled means current keyboard selection in FleetView; unfocused rows are hollow while selection is remembered. It never means the active host session.

During a native tool call, show its actual operation and target in the description; otherwise show the assignment. Never invent progress. Keep pending steering visible as a queued count, with its full text in detail. Format elapsed time as seconds, minutes and seconds, or hours and minutes.

Compute name, description and tail columns for the whole visible list using terminal cell widths. Metric rows share elapsed and token columns, displaying `34s · ↓ 8.2k tokens`. Waiting/state text uses the same tail's right edge. Normal work omits a Running label. Long descriptions yield space before essential state; do not align each row independently.

Focused FleetView shows local help above its rows, below the statusline; editor focus hides that action help. Main's confirm action returns to the editor. A child opens detail. Keep the selected child visible as the list scrolls; show a compact visible-range indicator when rows are omitted. Status changes do not reorder the list or steal selection. List the children of the current parent session's retained runs, including restored runs. Done, failed and stopped rows do not disappear automatically; `/subagents` reopens the same retained set so follow-up remains reachable. Reuse upstream run retention across restarts, without introducing a cross-project archive. With no children, omit FleetView and retain the main footer.

Only explicit dependencies offer a graph entry. Independent work remains a list. Arrows run from prerequisite to consumer, including serial chains. Duplicate role names include a concise assignment so their nodes remain distinguishable without task IDs. Node selection opens the same detail and returns to the previous graph selection. Larger graphs use a bounded viewport that keeps the selected node visible and marks connections continuing outside it; do not erase edges or relabel the graph as a tree. Waiting explanations must follow the real scheduler, not merely the drawn edges.

### 7. Detail, Transcript, Info and history

Detail replaces the main editor, main statusline and FleetView within the bottom interaction region. A full-width semantic-theme separator marks the boundary with the main transcript above. Returning restores the originating list/graph selection and the main draft. Closing inspection does not stop explicit background work.

Use one compact identity/description header with current-request time and output tokens. Main content priority is: actionable execution/preservation failure or live pending question, then latest visible reply while working, then the final report on completion. No extra model-generated summary. Prompt is folded above the principal content; expanding it removes the duplicate assignment header. Activity is a short native tool trail below it, folded after completion or while composing. Explicitly opening Activity places it before the long report so it is immediately visible. Reply composition shows the question once, in the composer, while retaining the exact question target and draft. Do not restore the rejected category-directory detail.

- **Transcript:** a read-only chronological reader of retained child messages and tool calls/results. Mark request boundaries with task wording and time, not task numbers. Follow latest only while the reader is already at the live end. Paging away freezes the reading position; show that new output is available. Preserve recorded text access and distinguish display folding, native upstream truncation and missing records. Do not promise hidden reasoning or data never recorded by the provider.
- **Info:** one compact document grouped into effective configuration, workspace/Git outcome and usage. Include role source and override notes, model/provider/thinking, actual tools and cwd, session location, branch/ancestry, changed files/diffstat, full errors, current and cumulative usage. Omit inapplicable rows; unavailable values are explicit. Full shortened paths remain readable through wrapping/pagination. Info is read-only, not a configuration dashboard or merge UI.
- **History:** one entry from Info opens a native-style request list with time, task excerpt and outcome. Selecting it opens that request's report and evidence read-only. Old requests never expose message/resume actions aimed at the current request. Esc restores list selection, then Info, then current detail. No numbered-task labels, tabs or persistent sidebar.

### 8. Keyboard and focus contract

| Focus             | Accepted behavior                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main editor       | Let Pi handle cursor movement, history and completion first. Only an editor up/down binding that leaves text, cursor and history selection unchanged, with no completion menu or competing handled action, enters FleetView. Preserve draft and hide caret. `/subagents` provides a command entry if edge navigation is inconvenient. |
| FleetView         | Configured Pi previous/next and confirm; fixed Esc returns to editor. Confirm Main returns to editor; confirm child opens detail. `g` opens a dependency graph only when present.                                                                                                                                                     |
| Detail            | `p` toggles Prompt; `a` toggles Activity; `t` opens available Transcript; `i` opens Info; `g` opens an existing dependency graph. `m` is the currently eligible Message/Resume/Follow-up action; `x` starts eligible stop confirmation. Confirm opens Reply only for a live pending question.                                         |
| Reading           | `[`/`]` page backward/forward with visible position. Native selection bindings navigate selectable rows, not text input. Esc returns one level. Transcript can return to its live end through a visible `f` follow action.                                                                                                            |
| Info/history      | `h` opens request history from Info. History uses Pi selection/confirm bindings. Esc follows the recorded origin.                                                                                                                                                                                                                     |
| Graph             | Pi selection bindings traverse nodes in stable dependency order; confirm opens detail. The viewport follows selection. Esc returns to the originating surface.                                                                                                                                                                        |
| Composer          | Native submit/newline/editing own input. Letters are text. Esc sends nothing, retains the draft for its exact target and returns to detail. Keep original report/question/reply visible as space permits.                                                                                                                             |
| Stop confirmation | Configured confirm stops the named target; Esc dismisses. Retain the current output and real dependency consequence.                                                                                                                                                                                                                  |

Generate binding hints from the same matcher used for actions. Preserve the fixed Esc-back convention. Literal feature letters are local to non-editing surfaces; no Alt+A, function row, Home/End or PageUp/PageDown requirement. Keep Pi global behavior outside owned focus, and avoid registering a competing global navigation system. Show primary intervention, reading actions and back as visually separate groups; wrap lower-priority help when necessary rather than adding a menu solely to reduce action count.

### 9. Observable states and bounded layout

| Observed condition                                            | Compact display / detail rule                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Queued, dependency incomplete                                 | Waiting in tail; detail/graph names the actual prerequisite                                                      |
| Queued, wave barrier or capacity                              | Queued in tail; detail names the known scheduler reason                                                          |
| Starting / normal execution                                   | Starting when no execution exists yet; while working show time/output usage without Running                      |
| Live parent question                                          | Waiting for main; question takes priority                                                                        |
| Accepted steering still pending                               | Queued count in FleetView and exact instruction in detail; do not replace the child's execution status           |
| Cancellation requested; execution or its finalization pending | Stopping until actual completion; no conflicting mutation actions                                                |
| Completed                                                     | Done and original report; report content is not a UI-issued verification verdict                                 |
| Failed / stopped / skipped                                    | Distinct labels and actual reason; retained output is marked incomplete where appropriate                        |
| Code preservation failed                                      | Commit failed remains visible beside the execution outcome, including Done; metrics yield first in a narrow tail |

Normal completion may still be finalizing its Git outcome. It must not say Stopping without a cancellation request, or claim saved code before confirmation; an accurate Finalizing note may accompany the report without adding a scheduler terminal state.

FleetView, graph and detail compact metrics all describe the selected/current request: elapsed time and output tokens. Freeze elapsed time when that request ends. Info contains input/output/cache/cost/turns where recorded and cumulative child usage. Missing metrics are unavailable, never invented zero. Internal IDs and raw debug traces are not required in the normal UI.

At ordinary sizes, budget up to three quarters of the screen for an opened bottom surface. It may grow to fit native input while leaving at least six rows for the main transcript and separation. Keep identity and local help visible; paginate the body. Text growth never increases the panel indefinitely. For every paged body, including a working detail, leaving the live end preserves the content being read and its anchor; a new reply cannot replace that content until the user explicitly follows the latest output. Show a new-output indication and the local `f` follow action. New events do not shift the composer or steal focus. Keep drafts through Esc, send failure and resize within the current host session; this is not a cross-restart draft-persistence promise.

Verify useful layouts at 150x50, 120x36 and 80x24. Below a useful content budget, show a size notice with Esc instead of clipped controls. Shrink optional context before native input, state or exit help. Long questions and reports remain fully reachable by reading before/reopening composition. Keep product interface copy English. Use native cell-aware wrapping for Chinese content, wide glyphs and ANSI. Respect active light/dark/custom theme values; do not hardcode the concept image palette into the product.

## Testing Decisions

Use the existing real-Pi host seam: the package entrypoint loads into an isolated Pi process, a deterministic local provider emits actual model calls, and Terminal Control drives the visible interface. This already exists for web/RTK/subagent testing. Adapt retained tests to the new contract; old protocol assertions, recursive ownership and ASAP scheduling are not acceptance requirements. Avoid a second test-only command or session implementation.

Test behavior through that seam and real temporary Git repositories. Use focused component tests only where deterministic queue/lifecycle timing or graph/width calculations cannot be asserted reliably at the host seam. Test externally visible outcomes, retained evidence and file effects, not private controller fields or copies of the implementation.

| Acceptance                | Realistic scenario and required evidence                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01: upstream coverage    | Run one reviewer, three independent investigators, a chain and a diamond dependency workflow. Reject invalid graphs before spawning; verify named predecessor text, concurrency and wave barrier. Exercise all parent operations, per-task controls, role discovery, timeouts and notifications.                                                                                             |
| A02: real-project startup | Launch default read-only work in an installed project with a large ignored dependency tree; verify model execution starts without ignored-file enumeration or the old Git output-limit failure.                                                                                                                                                                                              |
| A03: write lifecycle      | Two writers modify independent worktrees; a dependent writer sees its selected base. Verify parent dirty files stay out, shared dependency limits, actual diffs, cleanup and explicit failure when worktree creation/recovery fails. Include multiple write prerequisites so text handoff is not mistaken for merged code.                                                                   |
| A04: communication        | Exercise parent question/reply, notification, sibling mailbox and steering during an active tool. Assert exact pending-input removal, stale-question rejection and preserved drafts; nonexistent live targets cannot claim success.                                                                                                                                                          |
| A05: stop and failures    | Stop one child while its sibling continues; verify Stopping through finalization, actual dependent skip, retained output and partial-work commit failure. Include provider stop-reason error, tool error, empty-text saved session and failure before session creation.                                                                                                                      |
| A06: continuation/history | Resume failed/stopped work and follow up a completed review in the same context. Preserve old report/status/metrics, cumulative usage and own branch; no dependent rerun. Restore interrupted run metadata without automatic execution and leave old implementation records intact.                                                                                                          |
| A07: extensions           | Run an actual compatible extension tool in a child with isolated test settings. Verify effective tool narrowing, no recursive delegation injection, required-load failure and explicit unsupported UI errors.                                                                                                                                                                                |
| A08: UI/focus             | In main, FleetView, detail, graph, Info, history and Transcript, verify the documented keyboard round trip, multiline/history/completion priority, remapped bindings and exact recipient. Letters typed in composers never trigger actions. Main draft/selection survive return. After completion, return to main for a turn, reopen the same child and follow up.                           |
| A09: visual/observability | Verify aligned columns, all displayed states, current/cumulative metrics, report+commit failure, normal versus cancelled finalization, long output, a new reply while reading page two or composing, more rows than fit, graph overflow and resizing at the three target sizes. Capture actual light/dark frames using the documented Ghostty font stack; no fabricated screenshot evidence. |
| A10: supported host       | Repeat the representative parallel-to-review workflow and intervention/continuation on the maintainer's Bun-compiled Pi host with a real model, installed dependencies and tmux/60% keyboard. Record host/model versions, costs if available, exact outcomes and captures. Fixture success does not replace this promised acceptance.                                                        |

Run required static checks and independent standards/requirements full-diff reviews before implementation delivery. Use the mandatory maintainability skill for substantive code. Record failed or missing acceptance explicitly. Report production/test added, deleted and net lines against the recorded pre-implementation baseline when the full specification is delivered.

## Out of Scope

- The old implementation's recursive delegation, parent-history copying, global tree budgets, independent fulfillment protocol, queue management and durable recovery machinery do not return merely because prior tests cover them.
- No overlay, host-agent switching, duplicate main editor in detail, graph/list/tree mode picker, persistent sidebar, category-directory detail, task-number labels or full-row FleetView selection.
- No automatic merge, multi-parent branch integration, dependency rerun, commit retry, rollback or source-directory fallback.
- No new sandbox, automatic permission escalation, extension UI forwarding, dependency/framework change or old-record migration/deletion.
- No model-generated UI summaries, invented Read/Applied receipts, fake test verdicts or telemetry dashboard.

## Further Notes

The [runtime decisions](subagents-redevelopment.md), [accepted visual record](subagents-redevelopment-ui.md) and [UI review](subagents-redevelopment-ui-review.md) preserve rationale and source evidence. This specification is the implementation entrypoint; historical concepts remain illustrative when their keys, spacing or statuses differ from this contract.

The current code and draft [PR #98](https://github.com/jczhang02/pi-stuff/pull/98) still represent the prior implementation. This publication changes documentation and task scope only. Record the exact implementation baseline and imported source before redevelopment. Preserve other worktrees and existing data. The execution owner remains `codex:01a0a0de-06e7-7980-b872-39d57c4dd7c0`, linked to Beads `pi-stuff-tdc.3`.

The maintainer authorized the post-dogfood UX corrections on 2026-09-22: compact expandable orchestration notices, panel separation, useful reading space, native activity/queued steering, duration formatting and removal of duplicated question/prompt content. These refinements supersede the corresponding earlier visual decisions; execution and persistence contracts remain unchanged.
