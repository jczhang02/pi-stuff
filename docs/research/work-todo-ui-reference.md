# Work Todo UI reference: Claude Code and `rpiv-todo`

**Research date:** 2026-08-01  
**Decision scope:** How much of the session Todo is visible in the normal Pi conversation when the full Work surface is closed.

## Bottom line

Three native Pi variants were compared with the already-selected below-editor Agent roster:

1. **Bounded checklist — selected.** Show at most five task rows plus one overflow row above the editor. This is closest to current Claude Code and keeps the plan visible and correctable.
2. **One-line Work strip.** Show only the current task and aggregate progress. It preserves conversation height but turns Todo into a status line rather than a visible plan.
3. **Quiet until attention.** Show no Todo during normal running and one alert when user input is required. It maximizes conversation height but makes Todo nearly undiscoverable.

The visual comparison is in the [Work Todo report](../prototypes/tui/work-todo-comparison-report.html). The maintainer selected variant A on 2026-08-01.

## Product boundary already established

- Todo is the main session's current plan, not a project backlog, child-Agent backlog, or second Beads. Child work remains in the Agent roster.
- Long-lived issues, decisions, acceptance criteria, and deferred work remain in Beads.
- The owned fork of `@juicesharp/rpiv-todo` supplies the capability basis; upstream UI has no preservation requirement.
- Full list viewing and editing belongs in the accepted full-width, divider-led, non-floating Work Command Dialog.
- The default Agent roster remains below the editor. Todo and Agent UI must be judged together rather than in isolated mockups.
- Todo tool calls use the common Pi Stuff tool renderer. Upstream `todo + …` transcript styling is not retained.

## Current Claude Code behavior

Anthropic's current [interactive-mode documentation](https://code.claude.com/docs/en/interactive-mode#task-list) states that:

- the task list is Claude's multi-step to-do checklist, separate from the `/tasks` view for running shells and subagents;
- `Ctrl+T` shows or hides it;
- it shows at most five tasks at once;
- an empty task list has no visible toggle effect;
- users ask Claude to show all tasks or clear them;
- tasks persist across context compaction.

### Released 2.1.220 black-box capture

The genuine Claude Code **2.1.220** Linux x64 release binary was captured at `100 × 32`. The capture verifies the exact installed binary SHA-256:

```text
674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863
```

The binary ran with an isolated HOME and configuration. A localhost-only Anthropic Messages fixture supplied seven synthetic `TaskCreate` entries and deterministic `TaskUpdate` transitions. No user Claude credential, session, project file, or external model API was used. The renderer, Task tools, Ctrl+T behavior, and lifecycle are genuine release behavior; only task prose is fixture data.

Direct observations:

1. A seven-task mixed state renders five task rows followed by `… +2 pending`.
2. Completed, in-progress, and pending rows use a check, filled square, and empty square respectively.
3. The task list is immediately above the editor divider and below the active response/spinner area.
4. Ctrl+T replaces the five-row checklist with one `Next: …` line and changes the footer hint from `hide tasks` to `show tasks`; restoring does not alter task state.
5. As soon as all tasks complete, the task rows disappear even before the final model response settles. The completed idle frame also has no Ctrl+T task hint, rather than leaving a completed dashboard.

Reproduction:

```bash
CLAUDE_21220_BIN=/path/to/claude-code-2.1.220 \
FREEZE_BIN=/tmp/pi-proto-bin/freeze \
  ./docs/prototypes/tui/claude-2.1.220-task-list-capture.sh
```

The fixture requires the Task tools to be enabled in the interactive context. `--bare` was rejected for the final evidence path because it removed the Task tools from the local API request. The reproducible script instead uses an isolated safe-mode session with `CLAUDE_CODE_ENABLE_TASKS=true`.

## `@juicesharp/rpiv-todo` 2.3.1 behavior

The npm release declares MIT and matches the inspected `rpiv-mono` production source at commit [`f28d733`](https://github.com/juicesharp/rpiv-mono/tree/f28d733f96dd587fa286d845b67fc9aea987a0f6/packages/rpiv-todo). Pi 0.83 compatibility was checked independently: TypeScript passed and all 224 package tests passed.

### What the user sees

Despite the upstream name `TodoOverlay`, it is not a floating window. The implementation uses Pi's public `setWidget(..., { placement: "aboveEditor" })` path ([panel implementation](https://github.com/juicesharp/rpiv-mono/blob/f28d733f96dd587fa286d845b67fc9aea987a0f6/packages/rpiv-todo/todo-overlay.ts)).

- An empty session has no panel.
- The first successful Todo create makes the panel appear automatically.
- The heading shows `Todos (completed/visible-total)`.
- Every task is one truncated terminal row. Completed rows dim and strike through; the current row can include its active form.
- Any dependency causes all rows to show task IDs, and dependent rows add blocker IDs.
- The full `/todos` command emits an unbounded notification into the conversation; it does not open a management surface.

### Height and overflow

The default `maxWidgetLines` is 12 content rows, and the renderer appends one blank spacer, so the default panel can occupy **13 rows**. Its [overflow selector](https://github.com/juicesharp/rpiv-mono/blob/f28d733f96dd587fa286d845b67fc9aea987a0f6/packages/rpiv-todo/state/selectors.ts) drops completed items first and then truncates the unfinished tail, reserving one row for a summary.

This proves the persistent-capability path is feasible, but the default height is too large beside Pi Stuff's below-editor Agent roster. The fork should preserve recovery and visibility semantics, not the upstream panel density.

### Completion and replay details to correct in the fork

- Completed items remain visible through the current Agent turn and hide on the next turn.
- When completed rows hide, the heading denominator can shrink, so it stops representing stable historical progress.
- Reload, compaction, or session-tree replay resets the ephemeral “already displayed” set and can make completed rows reappear once.
- `maxWidgetLines` has no production ceiling.
- The overflow text can call truncated non-completed work `pending` even when an in-progress task was truncated.

These are behavior inputs for fork tests, not accepted Pi Stuff behavior.

## Native Pi 0.83 comparison

The throwaway [`work-todo-comparison.ts`](../prototypes/tui/work-todo-comparison.ts) reads a deterministic session fixture and uses Pi's public above/below-editor widget APIs. It performs no model, Agent, network, file, or shell I/O. The capture keeps one transcript, one real input draft, and the selected vertical Agent roster constant across every variant. The static fixture proves layout only; it does not prove live mutation, branch switching, or compaction recovery. Those mechanisms are already present in the rpiv-todo capability base and must be retained in the fork.

The yellow `needs_input` row is a presentation fixture, not a proposal to add `blocked` to rpiv-todo's state machine. Upstream states remain `pending`, `in_progress`, `completed`, and `deleted`; Todo dependency blocking is derived from `blockedBy`, while waiting for a user decision or permission is an independent Work attention state. A shared presenter may merge those facts visually without changing persisted Todo transitions.

Reproduce the nine frames:

```bash
FREEZE_BIN=/tmp/pi-proto-bin/freeze \
  ./docs/prototypes/tui/work-todo-comparison-capture.sh
```

### A. Bounded checklist

Normal height: six rows — five task rows and one overflow row.

Strengths:

- current task, next steps, and plan boundary remain visible without another action;
- closest to the maintainer's preferred Claude Code experience;
- Todo remains a user-correctable plan rather than hidden model state.

Risks:

- Todo above and Agent roster below visibly bracket the editor;
- `64 × 28` leaves a smaller conversation viewport;
- needs-user attention can repeat in the Todo row and main Agent roster row;
- a hard row cap is necessary to prevent dashboard growth.

### B. One-line Work strip

Normal height: one row.

Strengths:

- best height balance with the Agent roster;
- current activity and progress remain continuously visible;
- needs-user work becomes a clear one-line warning.

Risks:

- the user cannot inspect next steps or detect a missing plan item;
- an aggregate such as `6 pending` carries little actionable information;
- the surface reads as a status line, not a Todo list.

### C. Quiet until attention

Normal height: zero rows; needs-input height: one row.

Strengths:

- preserves maximum conversation height;
- important blocking work can still interrupt the quiet state.

Risks:

- the user cannot tell whether the Agent made a plan or what it intends to do next;
- Todo becomes hard to discover and supervise;
- the needs-user alert must open the full Work surface before its context is clear.

## Confirmed decision

The maintainer selected **A, bounded checklist**, as the normal default. It best matches the maintainer's explicit preference for Claude Code and preserves Todo's user-facing purpose: the user can see and correct the Agent's plan. B may later be evaluated as an explicit collapsed state, but that is not part of this decision.

The selection freezes only these points:

- one unheaded checklist above the editor;
- no more than five visible task rows plus one overflow row;
- zero height when no Todo exists;
- the full list and mutations live in the non-floating Work Command Dialog;
- the Agent roster remains the only live session surface below the editor.

The following remain implementation/detail questions: row selection and ordering, completed-row linger, needs-user-row promotion, collapsed representation, shortcut, colors, and exact narrow-terminal thresholds.

## Provenance and reuse limits

- `@juicesharp/rpiv-todo` is the explicit owned-fork candidate. Record its exact npm/archive revision and license when vendored.
- Claude Code is observable product evidence only. Do not copy, translate, port, mechanically adapt, or redistribute its code.
- A reconstructed `tanbiralam/claude-code` snapshot was inspected only to generate questions about state ordering and source behavior. Released 2.1.220 pixels and current official documentation are authoritative wherever they differ.
- The native Pi prototype is disposable evidence, not production implementation.
