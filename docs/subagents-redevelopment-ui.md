# Subagent UI redevelopment interview

[简体中文](i18n/zh-CN/subagents-redevelopment-ui.md). English is authoritative.

Status: part 1, main layout and page transitions, updated on 2026-09-20. UIR01 is accepted with a trailing-column alignment correction. The first UIR02 detail design was rejected; the revised proposal below awaits an answer. Tracked in [#97](https://github.com/jczhang02/pi-stuff/issues/97), under [#64](https://github.com/jczhang02/pi-stuff/issues/64). Runtime scope is settled in the [redevelopment decisions](subagents-redevelopment.md).

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

## UIR02: revised detail proposal

Opening a child still proposes replacing the entire bottom interaction area, with the visible main conversation above. Main editor, main statusline and FleetView are absent while inspecting. Returning restores the previous FleetView selection and main draft; background work continues. This page transition and the revised hierarchy remain pending together.

### While working

![Working child with a prominent latest reply and a short tool trail](assets/subagents-redevelopment-ui/04-detail-working.png)

The header identifies the child and assignment once, with model and usage nearby. Prompt is a compact expandable line. The central content is the child's latest visible reply, followed by recent tool activity. The sample reply includes its own emphasized finding; the UI does not need another model call to invent a summary. The tool tree serves local activity, not a directory of every data category.

Transcript opens full recorded output. Info provides access to supporting configuration, workspace, usage and history. Their exact organization belongs to later rounds.

### After completion

![Completed investigation with its report immediately visible](assets/subagents-redevelopment-ui/05-detail-done.png)

The same central area shows the final report directly. Its conclusion and supporting observations are readable without opening a Result section. Tool evidence is folded. The header says Done because the investigation completed successfully, even though its report identifies an upstream problem.

The working and completed images are states of one design. The local action hints change from message/stop to follow-up as appropriate. Key assignments and action behavior are illustrative until the interaction round.

**UIR02 question. Continue with this detail hierarchy: latest reply and current activity while working, report on completion, with supporting information one step deeper?** Recommendation: yes. Preserve access to full evidence while making the first screen useful on its own. A concrete pending question or error should take priority when present; those states still need their own design pass.

## Verification and next step

The three revised images were visually inspected for the aligned FleetView tail, main/detail separation, English text and readable working/completed hierarchy. Both earlier images remain as design history. This round changes documentation and concept art only; no runtime implementation or terminal acceptance was performed. Await the maintainer's answer to revised UIR02 before advancing the interview.
