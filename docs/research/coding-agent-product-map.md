# Coding-Agent Product Map

**Date:** 2026-07-31  
**Product context:** Pi Stuff, with Pi 0.83.0 as the Host  
**Reference product:** Claude Code

## Product direction

The useful question is not “which individual Claude Code features must be copied?” It is:

> Which large product areas make a coding agent feel complete, and which of them should Pi Stuff turn into an opinionated Suite?

A practical map has four blocks:

1. **Agent system** — who performs the work and how work is delegated.
2. **Interaction flow** — how the user steers long-running work through small daily features.
3. **Interface system** — how agent state, output, tasks, and settings are presented.
4. **Supporting platform** — memory, integrations, reusable workflows, and automation.

Pi already owns the model loop, core tools, terminal shell, sessions, settings, and Runtime Resource loading. Pi Stuff should improve the experience inside that Host rather than reproduce it.

## 1. Agent system

This is the largest standalone product area.

### Main features

- Define specialized subagents such as scout, planner, worker, and reviewer.
- Delegate one task to one subagent.
- Run independent tasks in parallel or in the background.
- Chain agents into workflows, for example scout → implement → review.
- Control each agent's model, tools, instructions, and working scope.
- Cancel, resume, retry, or redirect running agents.
- Isolate concurrent write work with branches or worktrees when needed.
- Return compact results to the main conversation without flooding its context.

### Required experience

The user should always be able to answer:

- Which agents are running?
- What is each agent doing?
- Which tasks are finished, blocked, or waiting?
- What did each agent produce?
- Can I stop it or talk to it?

Claude Code's subagents, background agents, worktrees, and experimental agent teams all belong to this block. Pi's upstream subagent example proves the Extension seam is capable, but it is still an example rather than a cohesive product experience.

Reference: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) and [Pi Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

## 2. Interaction flow

This block contains the many “small” features that determine whether the agent feels pleasant during real work.

### Task and progress

- Todo or task list with pending, in-progress, blocked, and completed states.
- Dependencies between tasks where useful.
- Persistent progress across long turns and context compaction.
- A concise end-of-task recap.

### Conversation while work continues

- BTW or side questions that do not derail the main task.
- Steering messages that redirect current work.
- Follow-up messages queued for after current work.
- Background shell commands and background agents.
- Notifications when work finishes or needs user input.

### Control and recovery

- Plan mode and an explicit transition from planning to execution.
- Pause, cancel, retry, or continue.
- Checkpoints and rewind.
- Session naming, resume, fork, and handoff.
- A few understandable execution modes exposed as normal interaction controls.

These features should feel like one interaction layer, even if several independent Capability Packages implement them. Todo and BTW should not become isolated gimmicks; together they make the main conversation remain responsive while work is organized elsewhere.

Reference: [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode), [checkpointing](https://code.claude.com/docs/en/checkpointing), and [sessions](https://code.claude.com/docs/en/sessions).

## 3. Interface system

UI is not a separate graphical application. It is how the Pi Host makes agent work legible.

### Agent output UI

- Visually distinguish main-agent output from subagent output.
- Show a compact live agent card: role, task, state, elapsed time, and latest action.
- Collapse noisy tool output while keeping it expandable.
- Render common results appropriately: file reads, edits, diffs, tests, errors, and reviews.
- Show parallel-agent progress without interleaving unreadable streams.
- Make completion, failure, cancellation, and waiting-for-user states unmistakable.

### Work navigation UI

- Task list or task drawer.
- Agent list and agent-detail view.
- Command palette and discoverable shortcuts.
- Session picker and branch/fork navigation.
- Diff, plan, and checkpoint review surfaces.

### Persistent status UI

- Current model and reasoning level.
- Main task and current phase.
- Running/background agent count.
- Context usage and compaction state.
- Current interaction or execution mode.
- Notifications that need attention.

### Settings UI

- Model and reasoning presets.
- Enable or disable Pi Stuff Capability Packages.
- Configure subagent definitions and defaults.
- Configure task, background-work, and notification behavior.
- Configure output density, expansion, theme, and shortcuts.
- Inspect Skills, hooks, integrations, and loaded resources.
- Configure execution controls without making them the product's central idea.

The Suite should use Pi's existing dialogs, widgets, status area, renderers, overlays, and settings patterns. It should not build another TUI shell.

Reference: [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode), [status line](https://code.claude.com/docs/en/statusline), [Desktop UI](https://code.claude.com/docs/en/desktop), and [Pi's existing interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md).

## 4. Supporting platform

These capabilities make the first three blocks more powerful, but they do not need to lead the product.

### Context and memory

- Human/team instructions and conventions through Pi's native `AGENTS.md` / `CLAUDE.md` hierarchy.
- Separate local, repository-scoped Agent memory that is visible, editable, deletable, and treated as fallible context rather than policy.
- Context inspection and compaction.
- Session resume, fork, summary, and handoff.

The selected storage/mutation base is an owned fork of `pi-hermes-memory@0.9.2`; its periodic transcript mining, shutdown extraction, failure diary, skills/session archive, and upstream UI are excluded. The fresh-install write policy—quiet in-band auto memory or explicit-only—remains the next maintainer decision. See [Context and cross-session memory capability reference](./context-memory-capability-reference.md).

### Reusable capabilities

- Skills and prompt workflows.
- Lifecycle hooks.
- Custom agent definitions.
- Packaged presets for common development workflows.

### Integrations and automation

- MCP and external tools.
- GitHub, issue tracker, and pull-request workflows.
- Headless or CI execution.
- Scheduled or event-triggered work.
- IDE or external UI integration through Pi's public protocols.

Pi already supplies much of the foundation for this block. Pi Stuff should add opinionated integrations only when they support a concrete workflow from the first three blocks.

Reference: [Claude Code extension overview](https://code.claude.com/docs/en/features-overview) and [Pi Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#pi-packages).

## Recommended product shape

The first product story can be expressed in one sentence:

> Turn Pi from a single conversational worker into a responsive personal coding-agent workbench where work can be delegated, tracked, inspected, and controlled without leaving the main conversation.

That suggests three primary workstreams:

| Workstream | Product outcome | Representative features |
| --- | --- | --- |
| Agent system | Pi can delegate meaningful work | subagents, parallel/background work, roles, cancellation, compact returns |
| Interaction flow | The main conversation stays responsive | Todo/tasks, BTW, steering, follow-up queue, plan, notifications, rewind |
| Interface system | All of that work remains understandable | agent cards, task view, output renderers, status, settings UI |

The supporting platform remains a later or demand-driven workstream.

## Possible delivery sequence

This is not yet an implementation plan. It is a way to test the product shape through visible vertical slices.

1. **One subagent, clearly shown** — launch one specialized agent, display its live state, cancel it, and return a compact result.
2. **Work without blocking conversation** — add background execution, a small task list, and BTW/steering behavior.
3. **Several agents, one coherent view** — parallel agents, progress aggregation, failure handling, and isolation where writing occurs.
4. **Make it configurable** — settings UI, agent presets, output density, notifications, and feature toggles.
5. **Add supporting integrations only when demanded** — memory, MCP, hooks, GitHub automation, or IDE surfaces.

## Questions that should shape the first slice

- Should subagents be the center of the Suite, or merely one tool among many?
- Is the desired experience closer to a quiet terminal assistant or an active multi-agent workbench?
- Should BTW be a true isolated side conversation, or simply a queued lightweight question?
- Should Todo be controlled mainly by the agent, mainly by the user, or both?
- How much live subagent output should be visible by default?
- Should settings be a single Suite-wide screen or separate screens owned by each Capability?

These product questions are more important now than choosing exact command names, policy syntax, or Package boundaries.
