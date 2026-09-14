# Subagent inline-tree prototype

[简体中文](i18n/zh-CN/subagents-prototype.md).

This throwaway branch answers whether a tree below Pi's statusline can support task inspection and explicit task controls while preserving the main editor. It implements the selected UI from the maintainer's discussion in [#90](https://github.com/jczhang02/pi-stuff/issues/90), following the behavior design in [#64](https://github.com/jczhang02/pi-stuff/issues/64) and [PR #66](https://github.com/jczhang02/pi-stuff/pull/66).

## Run

Retain branch `codex/subagent-tree-prototype` outside main. From its worktree, with Bun 1.4.0:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run tui run subagent-tree -- bun tools/subagent-prototype.ts
```

The foreground command owns the shared terminal. Inspect or drive that same session from another shell with `bun run tui show subagent-tree` and `bun run tui send subagent-tree ...`. Exit Pi with its normal quit control. Use `bun run tui stop subagent-tree` to stop the named session externally. Do not stop another task's session.

The default `live` mode uses the model configured in Pi, including its existing authentication. It starts actual main and child model calls. To choose a configured model explicitly, append `live provider/model`, for example:

```sh
bun run tui run subagent-tree -- bun tools/subagent-prototype.ts live openai-codex/gpt-6-astra
```

An unknown model or authentication failure is reported as an error. Live mode does not fall back to scripted replies. Pi's normal model controls remain available for the main session; newly created children use its current model and thinking level. A retained child keeps its original model across follow-up tasks.

The launch argument chooses a scenario outside the product UI:

| Argument         | Situation to inspect                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `live` (default) | Real main and child models inspect the supplied sample files. Results, timing and token counters come from their execution.           |
| `collaboration`  | Two investigations execute in parallel, followed by a dependent review. Send steering while an investigation's tool is still running. |
| `question`       | A child lacks information and the parent relays its question to the user. Answer in the tree.                                         |
| `followup`       | Initial work finishes quickly. Give the retained reviewer another assignment and inspect both results.                                |
| `cancel`         | Cancel a parent task with an active child. Observe cancellation until the child tool stops.                                           |
| `failure`        | A failed inspection remains visible, and its dependent review cannot start.                                                           |

Use Up/Down at the main editor's navigation boundary to enter FleetView. Native cursor movement, wrapped lines, history and autocomplete take precedence. For example, Down at the end of a one-line draft enters the tree; Up first moves to the line start or browses available history. Entry and return preserve the same draft and cursor. Alt+A is not registered.

Inside the tree, arrows select, expand and collapse nodes; Enter opens a selected action. Up from the main row or Enter on that row returns to the main editor. Inside a composer, Enter inserts a newline and `ctrl+enter` sends. Escape returns to the tree, then to the main editor. Page Up/Down scroll expanded records. The `/agents` command is an alternative entry point.

For a quick walkthrough, start `question`, expand lifecycle's Reply to question node, answer, then select New task after completion. Use `collaboration` to send a steer during the first 30 seconds. Leave another steer draft open until the task completes and submit it: the rejection must leave the draft visible. In `cancel`, cancel lifecycle while it and probe are active; packages continues independently. Restart between scenarios.

## What runs

The host is Pi 0.85.1 `InteractiveMode` under Bun, using native `CustomEditor` and `FooterComponent`. The tree occupies normal footer layout space below the statusline. Selecting a task does not switch the active main session. Each composer identifies its operation and target; returning restores the same main editor instance.

Children use real Pi `AgentSession` instances and execute local tools. Steering, question delivery, follow-up and cancellation go through those sessions. In live mode, the main agent uses one `subagent` tool to inspect results and exercise those same controls. Main and child sessions share Pi's native model runtime and an in-memory settings manager. Results and usage come from the selected remote model. Retry and automatic compaction are disabled for this bounded experiment. Findings concern only the supplied sample files.

The five explicitly named offline scenarios use local deterministic providers. Their replies, initial main conversation and model counters are scenario data, not remote usage. They retain predictable timing for testing a steer before completion or answering a pending question.

The launcher creates an isolated temporary workspace and agent directory. Live mode reads the existing Pi model configuration and uses native authentication from the original agent directory; it does not copy credentials into the scratch workspace. Native OAuth refresh may update Pi's existing authentication store. Extensions, skills, context files and built-in workspace tools are disabled. Children can inspect three supplied files, ask their parent and send updates. Contexts live in memory. Normal exit stops the children and removes the scratch files. A crash or forced kill can leave a directory named `pi-subagent-PROTOTYPE-*` in the operating system's temporary directory. Restarting the launcher creates a fresh scenario.

This is a focused UI experiment. It does not establish production persistence/recovery, arbitrary graph dispatch, write isolation, permission inheritance, provider compatibility or acceptance of the complete F01-F33 rewrite.

## Source and design choices

The execution adaptation comes from [@arhen/pi-core-subagent 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent), fixed at `de1c8783c2a39b1cbb0f86b412307193de9774c1`:

- `manager.ts`: independent child creation, event observation and usage/result collection.
- `child.ts`: blocking `ask_parent` and child-to-parent updates.
- `graph.ts`: dependency validation and predecessor-result prompt composition.

The retained [MIT notice](../src/subagents/LICENSE.arhen) includes the upstream fork attribution. Source comments identify adapted files. The original widget, overlays, sidecar persistence and worktree manager are not loaded. Importing the entire manager would also import those responsibilities and its early aborted-state update. The smaller adaptation keeps the exercised behavior in the prototype while distinguishing cancellation requests from stopped execution. Completed-agent follow-up and task-owned descendants extend the original package.

## Terminal evidence

The intended viewport is 150 columns by 50 rows, with an 80 by 25 narrow case. Pi uses its light theme, and the launcher sets the inspected Ghostty default foreground/background/cursor colors in the isolated terminal. Capture exports must use:

```sh
bun run tui save subagent-tree --format png --out /tmp/subagent-tree.png \
  --font-family "JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono" \
  --padding 2
```

Headless Terminal Control captures verify rendered cells and keyboard behavior. They do not prove Ghostty compositor scaling or native font rasterization. Executed checks and retained screenshots are recorded with the prototype's delivery PR.

## Findings

The selected tree works in normal Pi footer space. Task controls do not need an overlay or session replacement. At 80 by 25, an active long composer keeps the agent, operation, target, caret and send/return hints visible while other tree rows leave the viewport. Escape restores tree navigation, and returning to main retains its draft and cursor. Pi 0.85.1's inactive editor still paints a software cursor; the small MainEditor adapter removes that cursor only while unfocused.

Real terminal checks covered activity expansion, steering pending then consumed, rejected late steering with a visible retained draft, question replies, separate follow-up records, cancellation before actual stop, dependent skipping, failure display and a 16-line narrow composer. Independent reviews also exercised cancellation during ask_parent, steering during that wait, and rejection after the parent's model loop ends while descendants continue. The repository's existing offline suite passed 55 tests. This throwaway branch adds no permanent prototype test suite.

The live revision was exercised with authenticated `openai-codex/gpt-6-astra`: both investigations completed, their actual reports reached the dependent reviewer, and the main agent read its recommendation through the tool. A tree follow-up kept the earlier report, asked a real model-generated question, received a reply, consumed a steering message and delivered a new result. Independent local-provider checks reproduced and verified recovery after a transient model error, retry exhaustion, sequential questions and cancellation while waiting. Activity labels now reflect actual tool arguments.

Independent tests in private tmux 3.6a sessions passed arrow entry, wrapped/multiline movement, history, autocomplete and cursor restoration. With `extended-keys always` and `extended-keys-format csi-u`, Ctrl+Enter answered a child question and the task completed. An unknown live model exited with an explicit error and no fixture fallback. All owned sessions and private tmux servers were stopped after verification.

Actual Terminal Control captures, using the font stack above:

- [Live main conversation and arrow entry, 150 by 50](assets/subagents-prototype/live.png).
- [Live child result expanded inline, 150 by 50](assets/subagents-prototype/live-tree.png).
- [Steer composer, 150 by 50](assets/subagents-prototype/steer.png).
- [Question reply, 150 by 50](assets/subagents-prototype/reply.png).
- [Long follow-up draft, 80 by 25](assets/subagents-prototype/narrow.png).
