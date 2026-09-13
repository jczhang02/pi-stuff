# Subagent rewrite design

[简体中文](i18n/zh-CN/subagents-design.md) · English is normative.

Status: design discussion in [#64](https://github.com/jczhang02/pi-stuff/issues/64). This document records accepted decisions and the upstream capability inventory separately. Capability selection identifies the required features; inventory descriptions do not establish the rewrite's detailed runtime rules or implementation status.

## Accepted decisions

- Use @arhen/pi-core-subagent as the source for a fork and rewrite. Design the UI independently, without adopting upstream's UI design.
- Work in this order: establish core behavior, explore UI scenarios and prototypes, then settle implementation interfaces and structure. UI exploration may expose core behavior that needs revisiting.
- Decide capabilities individually. Tool names, parameters and configuration may be redesigned; upstream compatibility is not a requirement imposed on this design.
- Every supported capability needs acceptance in a real usage scenario. Parallel, serial and other supported execution modes each need their own acceptance coverage; one primary scenario cannot stand in for the full feature set.

The maintainer requested a plain feature inventory before capability selection. Domain vocabulary and detailed lifecycle rules remain unsettled. No glossary definitions or architectural trade-offs have been inferred from the inventory.

## Capability selection

Q3 confirmed F01-F05 as required: single-task delegation with separate context, parallel execution, serial execution, dependency-graph execution and automatic delivery of upstream results. Each execution mode and result delivery need real-scenario acceptance coverage.

F06-F29 remain undecided. Retaining a capability does not accept upstream parameter names, default values or known defects. Scheduling details, failure propagation and the form of result delivery will be decided separately.

## Upstream capability inventory

Source: @arhen/pi-core-subagent 1.3.54 at [de1c878](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). These descriptions come from static source inspection. They describe available behavior, not evidence that upstream passed scenario acceptance. Identifiers F01-F29 let subsequent decisions refer to a stable entry.

| ID  | Feature                                     | Existing behavior or usage example                                                                                                                                  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Single-task delegation and separate context | Give a child an investigation task. Its intermediate messages stay in its own Pi session; the parent receives its result.                                           |
| F02 | Parallel tasks                              | Run API and database investigations concurrently in one batch.                                                                                                      |
| F03 | Serial chain                                | Run investigation, implementation and review in order.                                                                                                              |
| F04 | Dependency graph                            | Declare task IDs in `needs`. Run ready tasks in waves, reject invalid graphs and skip dependents whose upstream tasks failed or were aborted.                       |
| F05 | Automatic upstream result delivery          | Prepend dependency outputs to the next task's prompt; substitute `{previous}` for the first upstream output.                                                        |
| F06 | Background execution and foreground waiting | Return a run ID immediately, or use `autoAwait` to wait for results. A child's question can end the wait so the parent can answer.                                  |
| F07 | Status and result queries                   | Retrieve a batch snapshot, child session paths, or the result of one task.                                                                                          |
| F08 | Bounded waiting                             | Stop waiting after a timeout while child execution continues. Child messages can also wake a wait.                                                                  |
| F09 | Completion and failure notifications        | Inform the parent when tasks or the batch finish, with failure notifications delivered promptly.                                                                    |
| F10 | Cancellation                                | Cancel a batch through a public tool. Single-task cancellation also exists in the manager, currently invoked by the upstream UI.                                    |
| F11 | Continue a failed or aborted task           | Reopen a saved child session and reattach its branch where available. Requires a settled batch and a task that created a session.                                   |
| F12 | Steering                                    | Send an additional instruction to one running child or the running children in a batch.                                                                             |
| F13 | Child-to-parent questions                   | A child blocks in `ask_parent`; the parent answers through `reply_subagent`. An unanswered question has a ten-minute cap.                                           |
| F14 | Child-to-parent updates                     | A child reports a finding and continues without waiting for an answer.                                                                                              |
| F15 | Sibling mailbox                             | Children in the same batch send short messages to each other and poll their mailboxes.                                                                              |
| F16 | Inline role definition                      | Supply a task-specific agent name and system prompt without creating a role file first.                                                                             |
| F17 | Role files                                  | Discover Markdown agent files in project/user directories. Upstream selects a matching file by description overlap with the task goal.                              |
| F18 | Model and thinking selection                | Configure the child's model and thinking level; role-file defaults can affect resolution.                                                                           |
| F19 | Tool selection                              | Choose the read-only/write toolset or an explicit built-in tool allowlist. Child communication tools are also installed.                                            |
| F20 | Working-directory selection                 | Run a task in a specified repository or subdirectory.                                                                                                               |
| F21 | Project rules and skills                    | Load AGENTS.md and configured skills through Pi's resource loader for the child's working directory. This is not an arbitrary extension-tool loader.                |
| F22 | Concurrency and batch-size limits           | Limit concurrent tasks within a batch; upstream accepts at most sixteen tasks in one batch.                                                                         |
| F23 | Execution-time limit                        | Configure `maxRuntimeMs`; the prompt execution stage enters timeout handling when its time limit expires.                                                           |
| F24 | Provider retry through Pi                   | Use Pi's configured retry behavior for retryable provider/network failures. This does not rerun arbitrary failed tasks or failed tests.                             |
| F25 | Usage accounting                            | Record input/output/cache tokens, cost and turns, with batch totals. No hard token or monetary budget is enforced.                                                  |
| F26 | Worktree and change management              | Create worktrees for write tasks, commit changes, report branches and diffs, preserve partial work and clean up eligible worktrees.                                 |
| F27 | Upstream branch inheritance                 | Start a dependent write task from one completed upstream branch, so it sees that task's code changes.                                                               |
| F28 | Task records and transcripts                | Persist batch/task snapshots and session/branch references in a sidecar, and keep child session transcripts. Saved records can be restored on parent session start. |
| F29 | Lifecycle events                            | Publish lifecycle events through Pi's event bus for other extensions to observe.                                                                                    |

The source groups behind this inventory are [public tools and lifecycle wiring](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/index.ts), [task schemas](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/schemas.ts), [graph scheduling](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/graph.ts), [child communication](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/child.ts), [role resolution](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/agentfile.ts), [execution manager](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts), and [worktree operations](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts).

## Boundaries requiring decisions

- F10 has a known initialization-time cancellation gap: a later state update can overwrite cancellation and allow execution to continue. A dedicated pause operation is absent; cancellation followed by F11 is only a partial substitute.
- F11 accepts failed/aborted tasks, not completed-task follow-ups. An explicit replacement model can also be overridden again by a matching role file.
- F21 disables extensions in the child loader. Loading project rules/skills does not establish extension-tool inheritance.
- F26 can fall back to editing the original directory when worktree creation fails. Dependencies in node_modules are shared through a symlink rather than isolated. Commits are saved for parent review; automatic merge is not a runtime feature.
- F27 selects one completed upstream branch, not a merge of all upstream branches.
- F28 writes the sidecar at whole-run settlement. It is not continuous crash-safe checkpointing, and restoring records does not automatically replay the workflow.

Upstream does not provide completed-session follow-ups, parent-history fork, child-created subagents, runtime graph mutation, saved workflow templates, conditional loops, automatic acceptance gates, human approval nodes, model-output schemas, hard usage budgets, cross-run role memory, external-agent backends or periodic scheduling. These are possible additions to discuss, not accepted additions.
