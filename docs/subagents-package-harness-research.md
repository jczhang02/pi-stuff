# Pi subagent and coding-harness research

[简体中文](i18n/zh-CN/subagents-package-harness-research.md) · [UI decision specification](subagents-ui-decision-spec.md)

Status: research record, 2026-09-22. This document is evidence for review, not an implementation plan and not a package compatibility decision. The companion UI document records the currently accepted UI decisions.

## Executive findings

The packages do not form one feature ladder. They solve different questions:

- The Pi official example, `@pi-plugins/subagent`, and `pi-sub-agent` show the smallest useful boundary: give a child an isolated context, wait for a result, and let the parent combine several results.
- `pi-submarine` separates context continuation from background execution. It is small because it focuses on fresh/fork/resume sessions and leaves scheduling to Pi's native multi-tool calls.
- `@arhen/pi-core-subagent` concentrates more behavior in a small manager: background runs, dependency edges, sibling mailboxes, worktrees, and recovery after failure or interruption.
- `@gotgenes/pi-subagents` is a more composable service core. It exposes typed records, lifecycle events, concurrency control, continuation, steering, parent communication, and a workspace provider. It does not itself provide a general DAG engine or built-in Git worktree isolation.
- `@tintinweb/pi-subagents` is the broadest product-like reference among the small and medium packages: it combines execution, a live widget, conversation viewing, worktrees, and workflow helpers. Its scope is therefore not comparable to a pure runtime core by line count.
- `pi-taskflow`, `@quintinshaw/pi-dynamic-workflows`, and `pi-subagents` are workflow systems. Taskflow and Dynamic Workflows offer step replay or recovery; these are different from continuing a child conversation. The audited `pi-subagents` release does not provide general step replay.
- `pi-harness-delegate` crosses a different boundary. It delegates to Claude Code, Codex, OpenCode, or another external coding agent. Switching a child harness is therefore a process and protocol concern, not merely a model selection.

The most useful design distinction is between four axes that are often called "subagent" together:

```text
execution        foreground wait or background run
context          fresh, inherited/forked, or resumed child conversation
coordination     messages, questions, steering, dependencies, or workflow steps
observation      status, notifications, transcript, metrics, and retained reports
```

An implementation can support one axis without supporting the others. A background job ID does not imply resume. A saved transcript does not imply a resumable child. A dependency graph does not imply a conversation tree. A FleetView does not imply that the host can switch its active agent.

## Evidence and scope

### Package sample

The Pi sample is the 13 published npm packages and one Pi official example collected in the previous audit. It is a useful sample, not a census of the ecosystem. Package behavior below comes from the published source, package documentation, and fixed repository revisions. No model task was run against these packages in that audit, so the tables describe code and documented interfaces rather than performance or reliability.

Package statistics were collected on 2026-09-13.

- Downloads are from the npm official downloads API for 2026-08-14 through 2026-09-12, 30 complete days, and cover all versions of each package. They are not active users, installations, or downloads of the measured version.
- SLOC is `cloc 2.00` code lines in hand-written JavaScript or TypeScript runtime implementation. It excludes blank lines, comments, tests, Markdown prompts, documentation, external dependencies, and duplicate build output.
- Where a package published only a bundle, source-map `sourcesContent` was counted when it matched the cited source revision. The table preserves package-specific caveats.
- SLOC is a scope measurement. It is not a quality score, and it is not a safe estimate of the work required to remove a UI or workflow layer.

### Other sources

- Claude Code UI: the official Linux CLI 2.1.261 was exercised on 2026-09-15 with a local scripted fixture. Claude performed the delegation, routing, file reads, queueing, cancellation, and rendering, but the fixture supplied the model responses. The result establishes UI paths, not live model quality. The full evidence record is preserved at [the fixed research revision](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md), with official documentation links in that record.
- Pi Pico v3: the official [Pico v3 design document](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/pico/pico-v3.md#85-subagents) was read on 2026-09-22. It is explicitly provisional and illustrates a harness model, not a released package API.
- Codex: the public [multi-agent handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents.rs), [tool specifications](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs), and [configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json) were inspected on 2026-09-22. These are moving `main` sources, so claims about the Codex section are date-scoped source observations, not a promise about every released client.
- Historical or mirrored repositories described as leaked source are not used as an official source. If a mirror is encountered, it can at most suggest a search term. No implementation claim or long quotation in this report comes from such a mirror.

The report deliberately does not treat Pi SDK version differences as a selection blocker. Compatibility must be checked when code is actually selected, but it is outside this comparative discussion.

## Package inventory, downloads, and implementation size

| Package and measured version               | Main focus                                 | Runtime boundary                      | 30-day downloads | Runtime SLOC | Files | Fixed source                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------- | ---------------: | -----------: | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi official example `0.85.1`               | Lightweight delegation                     | Separate Pi process                   |              n/a |        1,027 |     2 | [source](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent) |
| `@pi-plugins/subagent@0.3.0`               | Lightweight delegation                     | Separate Pi process                   |              651 |          702 |     5 | [source](https://github.com/k3dom/pi-plugins/tree/67dabc6181304af332363f5cb91a6ed0572104a9/plugins/subagent)                                    |
| `pi-sub-agent@0.1.5`                       | Lightweight delegation                     | Separate Pi process                   |              452 |        1,593 |     2 | [source](https://github.com/HamdiMaz/pi-sub-agent/tree/f1c0ae29f4cf370255530d3d126ec71b0d7a6194)                                                |
| `pi-fast-subagent@0.9.4`                   | Small in-process runner                    | Pi SDK session                        |               96 |        1,876 |    10 | [source](https://github.com/tuansondinh/pi-fast-subagent/tree/559cc175447b25d1a162cf436875f0c60ac569be)                                         |
| `pi-submarine@0.3.0`                       | Resumable sessions                         | Pi SDK session                        |              717 |        2,430 |    12 | [source](https://github.com/dnouri/pi-submarine/tree/97d8715ebce695a618d1775d6d3d4b9072396c77)                                                  |
| `@tintinweb/pi-subagents@0.19.0`           | Product-like execution and workflow        | In-process Pi SDK                     |           46,365 |       12,216 |    56 | [source](https://github.com/tintinweb/pi-subagents/tree/4f572eaa04c09d3dbc16e4a5f13a16b295e84e14)                                               |
| `@gotgenes/pi-subagents@21.7.0`            | Composable runtime service                 | In-process Pi SDK                     |           12,989 |        6,463 |    68 | [source](https://github.com/gotgenes/pi-packages/tree/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents)                           |
| `@narumitw/pi-subagents@3.0.1`             | Runtime communication                      | Separate Pi RPC process               |            5,900 |        2,774 |    13 | [source](https://github.com/narumiruna/pi-extensions/tree/72df85c54149e07fc204539bc1db38c1bba494f3/packages/pi-subagents)                       |
| `@arhen/pi-core-subagent@1.3.54`           | Runtime communication and dependency graph | In-process Pi SDK                     |           16,195 |        3,167 |    11 | [source](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent)                   |
| `pi-herdr-agents@1.7.0`                    | Long-lived specialist sessions             | Separate Pi process / Herdr           |            2,859 |       10,339 |    19 | [source](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)                                          |
| `pi-subagents@0.67.0`                      | Workflow orchestration                     | Foreground SDK plus background runner |          431,253 |       90,362 |   281 | [source](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)                                              |
| `@quintinshaw/pi-dynamic-workflows@3.11.0` | Scripted workflow orchestration            | Script runner plus child sessions     |           40,554 |       13,139 |    46 | [source](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/3a6c259df96558275dcbac7278e0038aefb5dcbd)                                     |
| `pi-taskflow@0.3.0-beta.1.2`               | Declarative task graph                     | Pi adapter plus `taskflow-core`       |            1,229 |       3,876* |     6 | [source](https://github.com/heggria/taskflow/tree/d9652629c46ad15f4898dd458867f8e0460f98b5/packages/pi-taskflow)                                |
| `pi-harness-delegate@0.6.1`                | External coding-agent delegation           | External CLI / ACP                    |            1,960 |        4,955 |    23 | [source](https://github.com/yorch/pi-harness-delegate/tree/bc1718d313a8d131a60aac3950c6193e8e4c6709)                                            |

`*` The `pi-taskflow` number covers only the Pi adapter. The separately published `taskflow-core` measured 25,852 lines across 94 TypeScript files, for 29,728 lines across the adapter and core. The tag was checked against the release, but npm metadata did not expose a `gitHead`, so byte-for-byte identity with the published build is not claimed.

The official example has no package download count. `@pi-plugins/subagent` counts 526 package-local lines plus 176 lines from a bundled internal shared module. `pi-subagents` is large because it includes runs, agents, TUI, watchdogs, workflows, intercom, and inspectors; its number is not the size of a minimal spawn primitive.

## Capability matrix in words

The previous audit checked 57 capability rows for all 13 packages. It resolved 741 cells: 321 direct supports, 58 partial or conditional supports, 362 package-level absences, and zero unresolved cells. "No" means the cited package release did not expose that capability in its reviewed tools and execution boundary. It does not mean an arbitrary external script could not add it.

### Capabilities present across the whole sample

| Capability                          | A real use                                                                                                            | Packages with the capability                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delegate one bounded task           | The parent asks a child to inspect why authentication fails and returns the child report to the parent.               | All 13 npm packages, plus the official example: Pi official example, `@pi-plugins/subagent`, `pi-sub-agent`, `pi-fast-subagent`, `pi-submarine`, `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, `@narumitw/pi-subagents`, `@arhen/pi-core-subagent`, `pi-herdr-agents`, `pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, `pi-taskflow`, and `pi-harness-delegate`. |
| Give the child its own context      | The child reads source files and tool output without mixing every intermediate step into the parent's context window. | All 13 npm packages, plus the official example. The boundary is a separate Pi process, an in-process `AgentSession`, a workflow session, or an external harness process depending on the package.                                                                                                                                                                            |
| Return a final result to the parent | A researcher returns findings and errors; the parent uses them to decide whether to dispatch a fixer.                 | All 13 npm packages, plus the official example. The result shape ranges from final text to a record with status, usage, tool calls, or an external transcript reference.                                                                                                                                                                                                     |
| Combine independent work            | Two investigators inspect cancellation and session persistence concurrently, then a reviewer receives both reports.   | All 13 npm packages, plus the official example, support some form of parallel fan-out and parent aggregation. This is a capability of the call or workflow boundary; it does not imply a persistent background scheduler in every package.                                                                                                                                   |

### Capabilities implemented by fewer packages

The examples use the same scenario so the difference is visible: "ask two investigators for evidence, steer one, wait for both, then continue the reviewer."

| Capability                                      | A real use                                                                                                                                              | Packages with the capability                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Return immediately and observe a background run | Start two investigations, continue the parent conversation, then query one by ID while it runs.                                                         | `pi-fast-subagent`, `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, `@narumitw/pi-subagents`, `@arhen/pi-core-subagent`, `pi-herdr-agents`, `pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, `pi-taskflow`, and `pi-harness-delegate`. The official example, minimal packages, `pi-submarine`, and `pi-sub-agent` are foreground-centered.                                           |
| Continue the same child conversation            | After a reviewer reports a race, ask the same reviewer to recheck the patched code while retaining its prior context.                                   | `pi-submarine`, `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, and `pi-subagents` expose direct support. `pi-herdr-agents`, `@pi-plugins/subagent`, `@quintinshaw/pi-dynamic-workflows`, and `pi-harness-delegate` have conditional paths, such as retained sessions, manual reopening, workflow-local context, or backend-dependent continuation; these are not equivalent guarantees. |
| Steer an active child                           | While the investigator is reading, send "focus on the cancellation path and include file references" and show whether the message is queued or applied. | `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, `@narumitw/pi-subagents`, `@arhen/pi-core-subagent`, `pi-herdr-agents`, and `pi-subagents`. The package-specific operation may be steering, a request broker, or interruption followed by a new turn.                                                                                                                                    |
| Ask the parent a blocking question              | A child finds two plausible interpretations, asks the parent to choose one, and resumes only after the answer.                                          | `@gotgenes/pi-subagents`, `@narumitw/pi-subagents`, `@arhen/pi-core-subagent`, and `pi-herdr-agents`. `pi-subagents` documents intercom-style communication, but its peer/parent semantics need to be read in the exact workflow path before treating them as equivalent.                                                                                                                     |
| Send messages between siblings                  | Two investigators share a discovered file path without routing every message through the parent.                                                        | `@arhen/pi-core-subagent` exposes the clearest sibling mailbox in this sample. Other packages may coordinate through workflow state or parent-mediated calls, which is a different contract.                                                                                                                                                                                                  |
| Express explicit dependency edges               | Reviewer C waits for A and B, receives their reports, and is skipped if a required predecessor fails.                                                   | `@arhen/pi-core-subagent` uses `needs` edges and ready waves. `pi-taskflow` provides a declarative DAG. `pi-subagents` and some workflow packages expose narrower dependency or lane constructs, not all-purpose DAG semantics.                                                                                                                                                               |
| Use worktree isolation for write tasks          | Two implementers modify separate branches, then the parent reviews each Git result before integration.                                                  | `@tintinweb/pi-subagents`, `@arhen/pi-core-subagent`, `pi-herdr-agents`, `pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, and `pi-taskflow`. `@gotgenes/pi-subagents` exposes a `WorkspaceProvider`, while Git worktree isolation is a companion or caller concern rather than a core feature.                                                                                            |
| Run a named scripted workflow                   | Invoke `scout -> planner -> worker`, or run a parallel fan-out followed by a pipeline stage.                                                            | Pi official example and `pi-sub-agent` provide single/parallel/chain patterns. `@tintinweb/pi-subagents`, `pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, and `pi-taskflow` provide richer workflow surfaces. Arhen's `needs` graph is a scheduler primitive, not a general script engine.                                                                                               |
| Use structured output contracts                 | A reviewer must return `{ findings, severity, files }`, and a later step can validate it before proceeding.                                             | `@tintinweb/pi-subagents`, `pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, and `pi-taskflow` expose structured workflow result paths. Other packages return text plus metadata and require the parent to interpret it.                                                                                                                                                                   |
| Delegate to another coding harness              | From Pi, ask Codex or Claude Code to implement a change and retain its external session ID when supported.                                              | `pi-harness-delegate`. This is a harness adapter, not an in-process Pi child conversation.                                                                                                                                                                                                                                                                                                    |

### Distinctive references

| Distinctive capability or design                         | A real use                                                                                                              | Package or harness                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tiny front-end for isolated process delegation           | "Use the scout role to inspect authentication and return a Markdown report."                                            | Pi official example, `@pi-plugins/subagent`, `pi-sub-agent`.                                                                                                                                                          |
| Fresh versus forked session as an explicit choice        | Dispatch a clean researcher, or inherit the parent's discussion up to the dispatch point.                               | `pi-submarine`, `@gotgenes/pi-subagents`, `@tintinweb/pi-subagents`, `pi-herdr-agents`, and `pi-subagents`.                                                                                                           |
| Difference between wait timeout and cancellation         | Stop waiting after 30 seconds but let the child continue; cancel only when the user requests cancellation.              | `@narumitw/pi-subagents` documents this boundary particularly clearly.                                                                                                                                                |
| Dependency edges carrying predecessor output             | Start the reviewer only after two reports finish, and inject those reports into its prompt.                             | `@arhen/pi-core-subagent`.                                                                                                                                                                                            |
| Same-process service with lifecycle events               | Subscribe to `started`, `completed`, `failed`, or `steered` and build a separate inspector without changing the runner. | `@gotgenes/pi-subagents`.                                                                                                                                                                                             |
| Built-in live FleetView and conversation viewer          | Keep a compact list above the editor, select a child, inspect its transcript, and steer it.                             | `@tintinweb/pi-subagents` is the clearest package-level UI reference in this sample.                                                                                                                                  |
| Specialist that can stay alive between assignments       | Keep a database specialist session and send later tasks to it rather than creating a new context every time.            | `pi-herdr-agents`.                                                                                                                                                                                                    |
| Workflow replay or local recomputation                   | Reuse completed workflow calls after changing a later step, while distinguishing replay from chat continuation.         | `@tintinweb/pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, and `pi-taskflow`.                                                                                                                                    |
| Multi-agent tool surface with task names and descendants | Spawn `research-a` and `research-b`, wait for updates, send a follow-up, then close the branch.                         | Codex current multi-agent source. Its tool names include `spawn_agent`, `send_message`/`send_input`, `wait_agent`, `followup_task` or `resume_agent`, and close or interrupt operations depending on backend/version. |
| One tool with command verbs                              | Keep the model-facing surface small while supporting run, spawn, send, status, wait, and stop.                          | Pi Pico v3 design document. This is a design proposal, not a released API.                                                                                                                                            |

## The two strongest Pi runtime references

### Arhen: compact scheduler and communication model

`@arhen/pi-core-subagent@1.3.54` combines a dependency scheduler, sibling mailbox, and built-in worktree handoff in 3,167 counted runtime lines. A task can run in the foreground or background, have `needs` dependencies, use a worktree for writes, exchange messages through sibling or parent communication, and be inspected by run/task ID. Its dependency edges control both readiness and the upstream report passed to a dependent. A ready-wave scheduler prevents a later dependent wave from starting while an earlier wave is still active. Failed or stopped prerequisites can skip descendants while independent siblings continue.

Example: A and B inspect two packages in parallel. C is declared with `needs: [A, B]`. C does not start until both reports are available, and the reports are available as input. If A fails, C is skipped while B's result remains inspectable.

The package also demonstrates a useful separation: "resume" restores failed or interrupted work, but it is not a completed-child follow-up API. Its extension loading is deliberately closed in the audited version. It is therefore a good reference for a compact run manager, dependency graph, mailbox, worktree handoff, and failure recovery boundary, but not for a complete extension-capability policy or completed-session continuation.

The earlier static review recorded three concrete lifecycle limitations in the inspected revision:

1. A cancellation during asynchronous initialization could be followed by a later `starting` or `running` update.
2. Sidecar persistence happened at run completion, so an early process exit could leave no run index for recovery.
3. An explicitly requested model could lose precedence to an agent-file value during resume.

These are source-review findings for the fixed revision, not claims that every release behaves the same way. The research uses them to identify invariants worth preserving: cancellation must own initialization and later transitions, accepted work needs a durable record before external execution, and effective configuration needs an explicit precedence rule.

### Later Arhen audit: version 1.3.55

The later redevelopment audit used [1.3.55 at `676b11e`](https://github.com/arhen/pi-extensions/tree/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent), recorded in the [redevelopment spec](subagents-redevelopment-spec.md). The size table deliberately retains the earlier 1.3.54 measurement; no new SLOC count is implied.

Read-only tasks inspect the selected cwd directly. Writers start from Git HEAD or a selected predecessor branch, not a snapshot of uncommitted parent files. Dependencies pass predecessor reports; multiple writer predecessors do not automatically merge their branches. The runner selects one code base. The wave barrier can also delay a ready dependent until unrelated work in the same wave finishes.

The later audit identified fallback to the source directory after worktree setup failure, steering success without established delivery, and aborted status before finalization/preservation as boundaries needing correction. These are source-review findings and selected repair requirements, not a new independent package E2E claim. Version 1.3.55 added provider/thinking metadata; it did not supply the completed-child continuation or extension-tool policy discussed for our own rewrite.

### Gotgenes: composable lifecycle service

`@gotgenes/pi-subagents@21.7.0` is roughly twice Arhen's counted runtime size, but its additional lines buy a clearer service boundary rather than a ready-made DAG. `SubagentsService.spawn` returns an agent ID, `getRecord` and `listAgents` return snapshots, `resume`, `steer`, `abort`, and `waitForAll` provide lifecycle operations, and lifecycle events allow a caller to build its own view or workflow. The session factory and workspace provider are injectable. The package carries usage into its records instead of making callers reconstruct it from mutable objects.

Example: Start a read-only researcher and a reviewer through the service. Subscribe to completion events, show current activity in a FleetView, then resume the reviewer with a follow-up after a patch. The service gives the caller the handles and state; the caller still decides how A must precede B.

The package's useful infrastructure includes a FIFO concurrency limiter, a session factory, a workspace provider, typed result records, parent-facing `ask_parent` and `notify_parent`, and tool/model selection at session creation. The core does not include a general dependency graph, an all-purpose workflow replay engine, or Git worktree isolation as a built-in guarantee. Its worktree companion and external composition should remain separate in a comparison.

The prior static review identified two cancellation paths that should be treated as review questions if this package is used as a reference:

1. Cancellation during session initialization was not checked again after initialization before the first prompt.
2. `abort(id)` was tied to the initial run controller while `runResume()` used the caller's signal, so aborting a resumed run could mark a record stopped without stopping that resumed execution.

These findings explain why "more infrastructure" is not the same as "already correct." They do not make SDK compatibility a selection blocker, and this report does not select a fork.

### Arhen versus Gotgenes

| Question        | Arhen                                                           | Gotgenes                                                             | What the difference teaches                                                               |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Primary unit    | Run with tasks and `needs` edges                                | Agent record plus service-managed execution                          | Choose whether scheduling or a reusable child service owns the center.                    |
| Background work | Built into the manager, with auto-await and status/result tools | Built into the service, with concurrency limiter and wait operations | Both can be non-blocking; the state and notification ownership differ.                    |
| Continuation    | Recovery of failed/interrupted work                             | Resume and follow-up within retention/lifecycle limits               | Recovery and completed-child continuation must be separate states.                        |
| Communication   | Parent requests, sibling mailbox, notifications                 | Steering, `ask_parent`, `notify_parent`, lifecycle events            | A message API needs delivery timing and question ownership, not just a string field.      |
| Dependencies    | Explicit `needs`, ready waves, output handoff                   | No general DAG in the core                                           | A service can stay small if dependency policy remains a caller-owned layer.               |
| Workspace       | Worktree behavior in the package                                | `WorkspaceProvider`; Git isolation is external/companion             | Workspace policy should be an interface, not hidden inside task state.                    |
| Extensions      | Audited version closes extra extension loading                  | Child session can load and filter selected tools                     | Tool inheritance and process isolation are different boundaries.                          |
| UI              | Compact manager-oriented views                                  | Runtime core with events; UI can be composed                         | A runtime should expose enough state for a view without owning the host's active session. |
| Scope and size  | 3,167 counted runtime lines, 11 files                           | 6,463 counted runtime lines, 68 files                                | Code size reflects the chosen boundary. It is not a direct quality ranking.               |

## Claude Code: useful interaction, host-specific switching

The official Claude CLI research is useful because it was tested in a terminal, but its host architecture matters as much as its appearance.

### What was observed

- The parent transcript stayed readable while a delegation summary listed two background children. The summary explained who was launched; the compact bottom list exposed whom the user could inspect.
- The list separated keyboard selection from the conversation being viewed. A focus marker selected a row for list actions, while a filled marker identified the currently viewed agent. Enter opened the selected child transcript and addressed the input to it. Esc had contextual behavior: it first returned focus from the list to the input, and another Esc could interrupt the working child.
- The child input showed its recipient. A steering message appeared in the child transcript and the list showed a queued count, distinguishing accepted delivery from applied work.
- `/tasks` provided a task detail surface with assignment, elapsed time, tokens, tool count, model, latest activity, prompt, and actions. Ctrl+O expanded delegation records in the main transcript. These surfaces served different jobs: list navigation, child conversation, task management, and evidence expansion.
- The compact row favored aligned name/description and right-aligned metrics. The visible list did not need to repeat `Running` on every row. Main had no description in the accepted reference layout.
- Completion, stopping, failures, pending permission, questions, and cross-session Agent View have distinct documented states. Nested delegation must not be inferred from a visual tree. A row disappearing from a live list was not the same event as deleting its transcript.

### What is portable to Pi

The portable ideas are information hierarchy and focus semantics:

1. Keep the parent conversation compact and make the delegation summary explicit.
2. Show current activity while working, the exact question while blocked, and the latest report after completion.
3. Make the recipient of steering visible, and show queued delivery separately from applied work.
4. Separate selection, viewing, management detail, and full evidence expansion.
5. Keep completed output reachable even if the live list is compact or transient.

### What is constrained by the Claude host

Claude's tested child-view transition is host-owned. The CLI can switch the active transcript and route ordinary input to the viewed child while retaining host commands and task management. A Pi extension can render a child reader and route feature-owned messages, but it cannot assume that replacing a bottom component changes Pi's active `AgentSession`, main editor history, built-in commands, or provider state. The FleetView visual pattern is portable; true host-session switching is a separate host capability and should not be inferred from the screenshot.

The research used a scripted response fixture. It did not claim live Anthropic model quality, and it did not establish every documented path by execution. The official docs remain the source for documented limits and behavior such as subagent nesting restrictions, permission forwarding, retention, and Agent View.

## Codex: native collaboration tools and explicit tree identity

Codex's current public source exposes a first-class collaboration tool surface rather than a single opaque "run child" operation.

- The handler maps model tool calls to local agent control and says spawned agents inherit runtime state such as provider, approval policy, sandbox, and cwd, with optional role-specific configuration layered on top.
- The source registers spawn, send-input, wait, close, and resume handlers. The current tool specification also defines task-oriented `send_message`, `followup_task`, `interrupt_agent`, and `list_agents` operations, depending on multi-agent backend/version.
- The V2 spawn schema asks for a task name and message, returns a canonical task name, and states that a child has the same tools and ability to spawn its own subagents. V1 additionally exposes fork context, model, and reasoning overrides in its schema.
- Wait has an explicit timeout and notification contract. V1 returns final status by agent ID; V2 waits for mailbox updates and returns a summary without the full content. This is a useful separation between observing an event and fetching a result.
- Configuration exposes limits such as maximum concurrent threads and, for V1, maximum nesting depth. The task-path naming convention makes descendants addressable without relying on display names.

Example: spawn `cancellation` and `persistence` under a root task, wait for mailbox updates, send a follow-up to `cancellation`, then close the branch after its final status. The stable task path and separate wait/follow-up operations make the tree inspectable to both the model and the UI.

The Codex source is particularly useful for explicit ownership and addressing: a display nickname can be friendly, but messages and descendants need stable IDs or canonical paths. It also shows why "child can spawn" requires depth and concurrency policy. These are source observations from current `main`, not a claim that Pi should copy Codex's tool names or allow recursive delegation.

## Pico v3: one model-facing tool, conversation-owned state

Pico v3 is a design proposal, not a package. Its subagent section is unusually compact:

```text
subagent.run     foreground child conversation
subagent.spawn   background child conversation
subagent.send    send or queue text to a child
subagent.status  inspect the child's tail and live tasks
subagent.wait    drive the child until a result or timeout
subagent.stop    abort the child
```

The document says "a subagent is a conversation" and deliberately avoids a separate registry. The returned child ID resolves back to a conversation handle. It distinguishes ownership from history forks, foreground from background work, task cancellation from waiting, and a durable task record from a transient process. It also uses a one-writer commit line and explicit recovery states so a restart can recover accepted work without pretending external effects were exactly once.

The design status is provisional. We should treat it as a vocabulary and state-model reference:

- one model-facing entry point can hide several operations without multiplying tool registrations;
- a child conversation is a durable identity, while a task/request is one execution against it;
- `send` can be accepted into a busy child's queue without pretending the child has already applied it;
- `status`, `wait`, and `result` should have distinct payload sizes and wake-up behavior;
- ownership and cancellation reach should be explicit rather than inferred from a display tree.

The document does not settle a Pi extension UI, nor does it supply a released API. Its storage and scheduler sections are design material, not evidence that a production harness already offers these guarantees.

## What to borrow, and what to leave open

### Ideas supported by multiple references

| Idea                                                  | Supporting references                                                                                                                     | Why it is worth keeping in discussion                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| One compact parent-facing delegation boundary         | Pi official example, Pico v3, Claude delegation summary, Codex collaboration tools                                                        | Keeps model-facing orchestration discoverable without hiding the child result.                            |
| Separate execution, conversation, and request records | Arhen run/task model, Gotgenes records, Pico conversation/task/input model, Codex task paths                                              | Prevents completed follow-up, retry, dependency, and notification semantics from overwriting one another. |
| Exact delivery state for steering or questions        | Claude queued count, Gotgenes parent communication, Narumi request IDs, Pico `accept`/queue result, Codex mailbox wait                    | A sent string is not proof that a child consumed it.                                                      |
| Dependency edges separate from context forks          | Arhen `needs`, Taskflow DAG, Pico ownership versus history fork, Claude task relationships                                                | A reviewer can depend on reports without inheriting an unrelated conversation history.                    |
| Public lifecycle events and snapshots                 | Gotgenes service/events, Codex status/wait, Pi SDK event stream, Pico durable task state                                                  | The UI can observe without becoming the scheduler.                                                        |
| Compact summary plus expandable evidence              | Claude collapsed/expanded views, Pi official expanded Markdown result, Codex wait-summary versus content, Pico bounded output constraints | Users can see what needs attention without losing the full report.                                        |
| Cancellation owns actual execution and finalization   | Arhen and Gotgenes static findings, Pico cancellation rules, Claude contextual stop                                                       | "Stopping" should remain visible until the child and its persistence/cleanup work finish.                 |

### Ideas that remain unproven or deliberately out of scope

| Claim or feature                                                    | Why it remains open                                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A package's download count proves quality or maturity               | Downloads include all versions and automation. The date window is historical and not a user count.                                                  |
| A smaller SLOC count means a better fork base                       | Scope differs radically. A 700-line delegate and a 6,000-line service do different jobs.                                                            |
| A package is reliable because its static lifecycle code looks clean | The package audit did not run model tasks or crash/restart tests.                                                                                   |
| A successful result proves code was committed or preserved          | Worktree state, commit outcome, and report text are separate evidence.                                                                              |
| A workflow replay is the same as resuming a child conversation      | Replay reuses step outputs; resume continues a session's context.                                                                                   |
| A saved session automatically provides background scheduling        | Persistence and scheduling are separate capabilities.                                                                                               |
| A FleetView can switch Pi's active host session                     | Claude owns that transition in its host. A Pi extension must work within public extension surfaces unless the host adds a session-switching API.    |
| Recursive delegation is safe by default                             | Codex exposes depth/concurrency controls, while Pico's proposal is explicit about ownership. Limits and cancellation reach need a product decision. |
| Unverified feature cells are negative findings                      | "Unverified" means the cited evidence did not settle the question. It is not equivalent to "unsupported."                                           |
| Current `main` source is a stable release contract                  | Pico and Codex are moving design/source references. Pin a revision before implementation.                                                           |

## Source index

### Package and Pi sources

- [Pi official subagent example](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent)
- [`@pi-plugins/subagent`](https://github.com/k3dom/pi-plugins/tree/67dabc6181304af332363f5cb91a6ed0572104a9/plugins/subagent)
- [`pi-sub-agent`](https://github.com/HamdiMaz/pi-sub-agent/tree/f1c0ae29f4cf370255530d3d126ec71b0d7a6194)
- [`pi-fast-subagent`](https://github.com/tuansondinh/pi-fast-subagent/tree/559cc175447b25d1a162cf436875f0c60ac569be)
- [`pi-submarine`](https://github.com/dnouri/pi-submarine/tree/97d8715ebce695a618d1775d6d3d4b9072396c77)
- [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents/tree/4f572eaa04c09d3dbc16e4a5f13a16b295e84e14)
- [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents)
- [`@narumitw/pi-subagents`](https://github.com/narumiruna/pi-extensions/tree/72df85c54149e07fc204539bc1db38c1bba494f3/packages/pi-subagents)
- [`@arhen/pi-core-subagent`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent)
- [`pi-herdr-agents`](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)
- [`pi-subagents`](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)
- [`@quintinshaw/pi-dynamic-workflows`](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/3a6c259df96558275dcbac7278e0038aefb5dcbd)
- [`pi-taskflow`](https://github.com/heggria/taskflow/tree/d9652629c46ad15f4898dd458867f8e0460f98b5/packages/pi-taskflow)
- [`pi-harness-delegate`](https://github.com/yorch/pi-harness-delegate/tree/bc1718d313a8d131a60aac3950c6193e8e4c6709)
- [npm downloads API](https://api.npmjs.org/)

### Harness references

- [Claude subagent documentation](https://code.claude.com/docs/en/sub-agents)
- [Claude interactive mode](https://code.claude.com/docs/en/interactive-mode)
- [Claude Agent View](https://code.claude.com/docs/en/agent-view)
- [Claude official CLI research revision](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md)
- [Pico v3 design, subagents](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/pico/pico-v3.md#85-subagents)
- [Codex multi-agent handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents.rs)
- [Codex multi-agent tool specifications](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)
- [Codex configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)

The package capability matrix, per-file SLOC evidence, and static audit JSON were generated in the 2026-09-13 research workspace. They are the provenance for the numbers above; the figures are intentionally not presented as current live measurements.
