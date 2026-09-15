# Claude Code subagent UI research

[简体中文](i18n/zh-CN/claude-subagent-ui-research.md)

Research date: 2026-09-15. Related work: [#93](https://github.com/jczhang02/pi-stuff/issues/93), part of [#64](https://github.com/jczhang02/pi-stuff/issues/64).

The Pi subagent prototype has a bottom agent list, but the interaction after selecting a child remains unsettled. This research examines the Claude Code behavior behind the visual reference. It records observations and possible lessons, without changing the prototype or accepting a new Pi UI design.

The strongest finding is that Claude separates the row receiving keyboard actions from the agent whose conversation is displayed. Its small bottom list works together with a delegation summary, a child conversation, and a task detail view. Copying the list alone would omit most of the interaction.

## Evidence and reading guide

**Observed** means exercised in the official Linux CLI **2.1.261**, with screenshots below. The model responses were supplied by a local scripted fixture; Claude Code itself performed the delegation, file reads, input routing, queueing, cancellation and rendering. This establishes those UI paths, not live Claude model quality or production reliability.

**Documented** means the current official documentation, read on the research date. **Reported** means a first-hand public issue, not a reproduced defect. **Inference** means our interpretation or a possible Pi design direction. Version differences are called out where they change the interaction.

Start with the [selected row](assets/claude-subagent-ui/02-selected.png), [opened child](assets/claude-subagent-ui/03-transcript.png), and [queued message](assets/claude-subagent-ui/04-message.png). They show the central interaction in three steps. All eight retained captures are indexed at the end.

## Which agents and which list?

The [official overview](https://code.claude.com/docs/en/agents) distinguishes these arrangements:

| Arrangement                      | Concrete use                                                           | Relationship to the UI in this report                         |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Ordinary subagent                | Ask a researcher to inspect cancellation code and return findings      | Delegated work inside the current parent session              |
| In-session forked subagent       | Delegate a side investigation with the conversation's existing context | Another way to create an in-session subagent                  |
| Agent team                       | A lead coordinates teammates through messages and shared tasks         | A separate experimental coordination mode                     |
| Background session in Agent View | Independently run a bug fix, a review and an investigation             | A separate full conversation, managed through `claude agents` |

Here, **FleetView** refers to the small current-session list we have been discussing. Official documentation calls it the **subagent panel**. It must not be confused with the full-screen, cross-session **Agent View**. A background session's subagents and teammates are not separate top-level rows in Agent View.

The screenshots also distinguish three names. `Explore` is the built-in agent type. `lifecycle` is the instance name passed when spawning it. `Trace cancellation behavior` is its assignment description. A reusable custom agent definition would be another source of an agent type; these captures did not load custom definitions.

## The main conversation stays readable

**Observed.** One assistant response launched two named background agents. Claude grouped the tool calls into one delegation summary with two branches. It then rendered another main-agent response while both children were still running.

The following is a shortened transcription of the captured screen, with header and empty space omitted:

```text
2 background agents launched (↓ to manage)
├ lifecycle: Trace cancellation behavior
└ packages: Compare package behavior

[main conversation continues]

[prompt input]
[permission mode and keyboard hints]

  ● main
❯ ◯ lifecycle  Trace cancellation behavior            59s · ↓ 1.2k tokens
  ◯ packages   Compare package behavior               59s · ↓ 1.2k tokens
```

![Main transcript with lifecycle focused](assets/claude-subagent-ui/02-selected.png)

The delegation summary answers who was dispatched and why. The bottom list answers which agents are available to inspect. Child file contents do not flood the parent transcript. A separate line above the input can describe the parent's wait for background work.

The observed list has aligned name and description columns, right-aligned statistics, and no repeated `Running` label. `main` has no description. It uses a small left gutter, which holds the focus marker, and no full-row selection background. Names and the viewed row receive stronger text emphasis. These are observations of Claude, not a reason to override our previously chosen spacing.

There are two distinct trees worth keeping apart: the branches in this main transcript summarize one delegation event; a nested-agent navigation tree represents ongoing parent-child relationships. This two-child run proves the first, not the second.

## Selection, viewing and input are separate

**Observed.** Moving to `lifecycle` did not immediately replace the main conversation. The screen still displayed `main`, with `● main`, while `❯` marked the child selected for keyboard actions. Pressing Enter then opened the child's conversation.

| Visible mark            | Meaning in the tested panel                                       | What it does not establish                              |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `❯` before a row        | This row receives list keyboard actions                           | Which agent is running or which transcript is displayed |
| Filled `●`              | This is the currently viewed agent                                | A universal running/done state                          |
| Hollow `◯`              | Another agent in the list                                         | Failure, idleness or lack of selection                  |
| Color and trailing text | Additional execution information, such as stopped, idle or queued | A substitute for identifying the input recipient        |

After Enter, the body showed the original child assignment and its collapsed file read. The input border carried `@lifecycle`, and the placeholder named that same recipient. `main` became hollow; `lifecycle` became filled.

![Child conversation and addressed input](assets/claude-subagent-ui/03-transcript.png)

The important transition is:

```text
main displayed, main input
    ↓ choose lifecycle in the list
main displayed, lifecycle receives list actions
    Enter
lifecycle displayed, input addressed to lifecycle
    Esc while the list has focus
lifecycle still displayed, input receives keyboard focus
```

Viewing a child is therefore an actual transcript and input-routing change in the tested host. It does not prove that a Pi extension can replace Pi's active agent/session. The [documented command boundary](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks) also matters: ordinary messages and skills go to the viewed child, while built-in slash commands still operate on the main session. An attached independent session in Agent View has a different command context.

## Steering uses the addressed input

**Observed.** While the child was working, I returned keyboard focus to its input and sent an additional request about startup races. The request appeared as a user message in the child transcript. The list gained `1 queued` at the right edge.

![Message submitted to the child, with a queue count](assets/claude-subagent-ui/04-message.png)

This gives the user two useful confirmations: the text reached the intended conversation, and it is waiting to be processed. A sent message and an applied correction are different events. The test stopped this child before releasing its held model response, so it did **not** establish when the child consumes the queued message or how well it follows the correction.

**Inference.** This is a better starting point for discussing steer than a dedicated form with model-facing fields. The UI first needs to make the recipient and delivery state clear. Whether Pi uses its normal editor or a separate inline reply area remains open.

## Esc is contextual, and can stop work

**Observed.** Esc while the list had focus removed the row marker and returned focus to the editor. It retained the child transcript and recipient. Another Esc, now at the working child's input, interrupted that child. Its transcript showed an interruption, and the parent later received a stopped-by-user notification.

Returning to main required selecting the `main` row and pressing Enter. A sequence that assumes repeated Esc always navigates upward is unsafe in this interaction.

| Context                           | Action              | Observed result                                       |
| --------------------------------- | ------------------- | ----------------------------------------------------- |
| Main input with background agents | Down, then arrows   | Down entered list focus; arrows moved the focus       |
| Child row focused, main viewed    | Enter               | Open the child transcript and address input to it     |
| List focus                        | Esc                 | Return keyboard focus to input, preserve viewed agent |
| Working child input               | Esc                 | Interrupt the child                                   |
| `main` row focused                | Enter               | Restore the main transcript and input recipient       |
| `/tasks` detail                   | Esc, Enter or Space | Footer advertises closing; not all three keys tested  |
| Detailed transcript               | Ctrl+O              | Return from the detailed transcript display           |

This table covers the exercised path, not every editor mode or cursor position. The initial automation guessed a stop hint that differed from the actual screen, and one capture caught slash-command completion before task detail opened. Those probes were corrected by inspecting fresh terminal state; they are not evidence of Claude bugs.

**Documented.** The [panel keymap](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks) makes `x` contextual too: stop an active selected child, dismiss an ended one, but type normally on main or the currently viewed row. The [global shortcut reference](https://code.claude.com/docs/en/interactive-mode) provides Ctrl+X then Ctrl+K for stopping background agents, with repeated confirmation. These destructive paths were not exercised here.

## Task detail is a separate management surface

**Observed.** `/tasks` was recognized as a built-in command even from a child view. With only `packages` active, it opened that task's detail directly. This capture is **not** a multi-item task list or an expanded FleetView row.

![Task detail showing progress, prompt and available actions](assets/claude-subagent-ui/05-task-detail.png)

The detail showed agent type and assignment, elapsed time, tokens, tool count, model, latest tool activity, and the original delegation prompt. Its own footer exposed close, stop and foreground actions. In the capture, the interrupted `lifecycle` transcript remains above a detail panel for `packages`: the detail's heading is essential for identifying the action target.

Pressing `f` opened the `packages` transcript with an addressed input, as the [foreground capture](assets/claude-subagent-ui/07-foreground.png) shows. The visible transition alone does not prove that the parent became blocked or that the execution scheduling mode changed.

**Observed.** Ctrl+O on the main conversation instead opened a more detailed transcript. It exposed each delegation's prompt and model/timestamp information. That is a reading-density control, distinct from agent selection and task management.

![Expanded main transcript](assets/claude-subagent-ui/10-expanded.png)

## Completion, stopping and retained history

**Observed.** After releasing the second child's fixture response, its final text appeared. While it was being viewed, its row remained with `idle` and its input still addressed `packages`.

![Completed child remains open for inspection](assets/claude-subagent-ui/08-completed.png)

On returning to main, the parent showed the completion notification, the child rows disappeared, and the footer offered `/tasks` as the way to inspect subagents. The fixture's repeated assistant sentence after this notification is scripted text, not evidence that a real model misunderstood completion.

![Parent completion notification and task-history hint](assets/claude-subagent-ui/09-main-completed.png)

**Documented.** Current [subagent lifecycle documentation](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background) describes successful rows disappearing, a 30-second footer/history opportunity through `/tasks`, and failed/stopped rows lingering for 30 seconds with dismissal. A task detail already open stays open. The observed viewed-child `idle` state qualifies any blanket claim that every successful row disappears immediately. This run did not time the 30-second thresholds.

The same page's [resume rules](https://code.claude.com/docs/en/sub-agents#resume-subagents) distinguish a model-stopped child, which can be resumed by a message after stopping, from a user-cancelled child, which refuses automatic revival until the user explicitly resumes it. Completed children can resume with their retained context. This does not establish Pi's chosen independent execution-record format or downstream dependency semantics.

## Other situations that affect the UI

The following cases are **documented, not exercised** by this fixture. The examples describe user situations, not additional acceptance runs.

| Situation                | Example                                                             | Claude behavior relevant to interaction                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreground vs background | A reviewer blocks the next decision, or investigates alongside main | Foreground work blocks the parent; Ctrl+B can background eligible work. In tmux the documented shortcut may require two presses. [Interactive mode](https://code.claude.com/docs/en/interactive-mode#background-bash-commands)                             |
| Permission request       | A child needs approval for a tool                                   | Since 2.1.186, background permission prompts reach main and identify the requesting agent. Esc denies that tool rather than stopping the child. [Changelog](https://code.claude.com/docs/en/changelog)                                                     |
| Question to the user     | A researcher needs a choice between two approaches                  | Non-fork subagents do not receive `AskUserQuestion`; forks inherit the parent's tool pool, subject to permissions. Do not assume every child has the same question dialog. [Tool availability](https://code.claude.com/docs/en/sub-agents#available-tools) |
| API failure              | A review is cut short after producing some findings                 | Partial findings and an error need to remain distinguishable from a completed report. The official error reference describes the incomplete-response and early-termination cases. [Errors](https://code.claude.com/docs/en/errors)                         |
| Nested delegation        | A reviewer delegates two checks beneath itself                      | Current documentation describes a panel tree, descendant counts and navigation through relatives back to main. It is not a dependency DAG viewer. [Nested subagents](https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents)   |
| Forking existing context | Investigate another approach after a long design discussion         | `/subtask` creates an in-session fork; `/fork` normally creates a separate background session when Agent View is enabled. [Commands](https://code.claude.com/docs/en/commands)                                                                             |
| Recovering history       | Reopen the parent tomorrow and revisit a child                      | Child transcripts are separate persisted files, subject to retention. UI row removal and transcript deletion are different events. [Claude directory](https://code.claude.com/docs/en/claude-directory)                                                    |

Do not copy older tutorials' command maps. The [official overview](https://code.claude.com/docs/en/agents#check-on-running-work) says `/agents` stopped opening its definition-management panel in 2.1.198; it directs users to files. `/tasks` manages current-session background work, while shell command `claude agents` opens Agent View. [Interactive-mode help](https://code.claude.com/docs/en/interactive-mode) assigns Ctrl+T to the task checklist in the conversation, not this runtime manager.

The [2.1.232 changelog](https://code.claude.com/docs/en/changelog) also changed interactive fork/background defaults. Our fixture explicitly disabled fork mode and requested named background Explore agents. Its appearance should not be presented as evidence of the default delegation choice in every current installation.

## Teams and cross-session Agent View

**Documented.** [Agent teams](https://code.claude.com/docs/en/agent-teams) offer in-process switching or separate tmux/iTerm2 panes. In-process mode uses teammate selection and direct messaging; split-pane mode gives teammates their own terminal panes. Teams add shared coordination beyond an ordinary delegated result. They are experimental and disabled by default. Their pane controls are not proof that an extension can split Pi's internal conversation renderer.

**Documented.** [Agent View](https://code.claude.com/docs/en/agent-view) groups independent background sessions by attention/state. Space opens a peek for activity, a pending question or a result; Enter attaches the full session; Left on empty input detaches. Subagents are not top-level rows there. This research did not run that mode.

Its [manager controls](https://code.claude.com/docs/en/agent-view#organize-the-list) also include Ctrl+T to pin, Ctrl+S to change grouping, Shift+Up/Down to reorder, and Ctrl+X to stop; a second Ctrl+X within two seconds deletes the entry, with conditional worktree cleanup but retained transcripts. `Ready for review` groups sessions with open PRs, while `Completed` also includes failed and stopped sessions. A group heading therefore does not establish an individual session's exact state.

**Inference.** Its useful idea is that the compact summary changes with the reason for attention: current activity while working, the precise question when blocked, and a result when done. Pi can evaluate that idea without adopting its cross-session manager or peek UI. A user's unanswered question deserves more than a generic waiting label.

## Tokens need an explicit definition

**Observed.** The fixture supplied `input_tokens = 1200` and `output_tokens = 0` at stream start, yet the row showed `↓ 1.2k tokens`. The number cannot safely be described as output-only tokens. This fixture was not designed to distinguish every accumulation rule across multiple requests and states.

Read-only inspection of the same verified 2.1.261 binary found an **Agent tool transcript child-row** helper at byte offset `200176331` that adds input, output, cache-read and cache-creation usage from the latest assistant message. That is a different rendering path: we did not prove that the bottom panel tail reuses it. No extracted implementation is imported into Pi.

The [Monitoring reference](https://code.claude.com/docs/en/monitoring-usage) separately defines cumulative token counters and the final-request footprint in `subagent_completed.total_tokens`. Neither defines the bottom panel's arrow. A [public report about changing token semantics](https://github.com/anthropics/claude-code/issues/15704) reinforces the ambiguity but does not settle the current formula.

**Inference.** Keep usage fields distinct internally and decide what the compact number means before using the arrow as a label. Our preference for the visual `↓ 8.2k tokens` can remain a preference; this research does not supply its Pi data contract.

## Friction reported by users

These reports identify scenarios worth testing. Their existence does not establish that 2.1.261 or the current release still has the defect.

| First-hand report                                                | Reported problem                                                | Test it suggests for Pi                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| [#90492](https://github.com/anthropics/claude-code/issues/90492) | Arrow navigation mixed child selection with main prompt history | List movement must not silently change an editor draft/history |
| [#77655](https://github.com/anthropics/claude-code/issues/77655) | Child view showed main model/effort/identity                    | Every displayed field needs a known owner                      |
| [#58965](https://github.com/anthropics/claude-code/issues/58965) | A session awaiting permission appeared to be working            | Pending input must override an unhelpful activity summary      |
| [#15704](https://github.com/anthropics/claude-code/issues/15704) | Token display changed meaning between running and completion    | The same label should keep a defined metric across states      |

## What this changes in our discussion

These are research recommendations, not accepted UI decisions:

1. Decide whether selection and viewing remain independent. If they do, make both identifiable; that does not require copying Claude's extra arrow.
2. Preserve a compact main conversation and make detailed evidence reachable. The captures show that summaries, live navigation and history serve different jobs.
3. Show the recipient beside any steer/reply input, and distinguish queued delivery from applied direction.
4. Give stop, return and dismiss distinct meanings. Claude's contextual Esc is a concrete interaction cost worth improving, even if its visual style is appealing.
5. Keep completed output reachable after a row leaves the live list. The exact retention and navigation can follow Pi's agreed lifecycle rather than Claude's transient list.

For the next design discussion, the central choice is where the selected child's transcript and reply input live. The existing inline-tree direction can be evaluated with these same actions. This research supplies behavior to compare; it does not reopen the rejected overlay proposal or claim that true host-agent switching is feasible in Pi.

## Capture provenance and limits

The official `linux-x64` release was checked against its [2.1.261 manifest](https://downloads.claude.ai/claude-code-releases/2.1.261/manifest.json): SHA256 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`.

Terminal Control 1.2.1 captured an isolated **122 × 50** terminal. Rendering used the inspected environment's font stack, `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`, light background `#eff1f5`, foreground `#4c4f69`, and 2-pixel capture padding. These are terminal-cell renders, not photographs of a Ghostty window. No responsive-width or native window-compositor claim is made.

The launch used an isolated configuration directory and workspace, `--safe-mode`, empty setting sources, `--permission-mode dontAsk`, allowed `Agent`/`Read` tools, and `CLAUDE_CODE_FORK_SUBAGENT=0`. A localhost SSE fixture supplied two Agent calls, real native Read requests against synthetic files, held responses, then a completion. Safe-mode and permission-mode banners are genuine. The visible model name is the requested model label; no Anthropic account or remote Claude model was used. Durations reflect held test responses and usage values are synthetic, so they are not performance measurements.

Private raw request captures and the fixture service are not published. The owned CLI sessions and server were stopped after capture; the user's Pi prototype terminal was left running. No alleged leaked source was executed or imported. Historical mirror material was insufficient to establish current UI behavior; the report relies on verified release behavior and official sources instead.

The run did not exercise successful queued-message consumption, completed-child resumption, permissions/questions, foreground blocking, nested delegation, forks, teams, Agent View, provider errors or cross-restart recovery. Their discussion above remains documentary. No Pi product source changed.

| Capture                                                              | What to inspect                      | Plain terminal text                                     |
| -------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| [02 Selected](assets/claude-subagent-ui/02-selected.png)             | Main viewed, lifecycle selected      | [Text](assets/claude-subagent-ui/02-selected.txt)       |
| [03 Child](assets/claude-subagent-ui/03-transcript.png)              | Child transcript and addressed input | [Text](assets/claude-subagent-ui/03-transcript.txt)     |
| [04 Message](assets/claude-subagent-ui/04-message.png)               | Submitted message and queue count    | [Text](assets/claude-subagent-ui/04-message.txt)        |
| [05 Detail](assets/claude-subagent-ui/05-task-detail.png)            | `/tasks` single-task detail          | [Text](assets/claude-subagent-ui/05-task-detail.txt)    |
| [07 Foreground action](assets/claude-subagent-ui/07-foreground.png)  | `f` opens packages view              | [Text](assets/claude-subagent-ui/07-foreground.txt)     |
| [08 Child completed](assets/claude-subagent-ui/08-completed.png)     | Viewed child retained as idle        | [Text](assets/claude-subagent-ui/08-completed.txt)      |
| [09 Main completed](assets/claude-subagent-ui/09-main-completed.png) | Parent notification and history hint | [Text](assets/claude-subagent-ui/09-main-completed.txt) |
| [10 Expanded](assets/claude-subagent-ui/10-expanded.png)             | Ctrl+O delegation details            | [Text](assets/claude-subagent-ui/10-expanded.txt)       |
