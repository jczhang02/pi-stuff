# Subagent UI decision review

[简体中文](i18n/zh-CN/subagents-redevelopment-ui-review.md). English is authoritative.

Method: dual-agent (A: `/root/ui_spec_design_review` · B: `/root/ui_spec_native_review`). Date: 2026-09-21. Target: the accepted UIR01-UIR09 decision record at `8520e4e303f46b0caa3ebcf9ca8db5788882e93c`, including the maintainer's subsequent acceptance of UIR09. This is an Impeccable review of decisions and static concepts, followed by source verification; it is not acceptance of a running redevelopment.

## Judgment

Keep the visual direction. It is specific to Pi: the main transcript remains, the bottom region serves inspection, and the user can read useful content before opening supporting evidence. Claude's focus-related help and detail ordering are useful references. A second host session, overlay framework or category dashboard would add complexity without serving the accepted workflow.

The largest gaps are implementation contracts, not visual styling. Close them in the [formal specification](subagents-redevelopment-spec.md), then verify the resulting product through Pi's real host.

## Design health before clarification

| Heuristic                    | Score / 4 | Finding                                                           |
| ---------------------------- | --------: | ----------------------------------------------------------------- |
| Status visibility            |         3 | Detail is clear; compact state projection needs a shared rule     |
| Match to the user's task     |         4 | Findings, questions and results have the right priority           |
| Control and freedom          |         3 | Drafts and exits are preserved; entry priority was incomplete     |
| Consistency and standards    |         3 | Native bindings are intended; component boundaries need precision |
| Error prevention             |         3 | Target checks and stop confirmation are defined, not yet executed |
| Recognition over recall      |         2 | Info/history/transcript paths were unfinished                     |
| Flexibility and efficiency   |         3 | Short keyboard paths; complete focus map still needed             |
| Minimalist presentation      |         3 | Clear primary content; action hints need grouping                 |
| Error diagnosis and recovery |         3 | Causes, retained work and eligible actions are distinguished      |
| Help and documentation       |         3 | Focus-related help is good; secondary readers lacked a contract   |
| Total                        |     30/40 | Good foundation; not a runtime quality score                      |

No post-edit score is claimed. Writing a better specification does not demonstrate that the UI works.

## Strengths and cognitive load

- One detail surface shows the latest useful reply, question, failure or report. The discarded category directory does not return.
- Message, Reply, Resume and Follow-up share local input while retaining recipient and relevant evidence. Queue acceptance is not presented as understanding or compliance.
- Done and Commit failed can coexist. The model's finished report, Git preservation and parent integration remain separate facts.

Cognitive load is moderate in the action hint row: some concepts show five peers. Group intervention, reading and back by order and spacing; adding another action menu merely to meet a count would make the common workflow slower. The emotional weak point was continuation: a new request could appear to replace old work without a clear history route. The formal reading contract fixes that gap.

## Priority findings and disposition

| Priority | Problem and effect                                                                                                       | Resolution in the formal specification                                                                                                        | Relevant skill action  |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| P1       | Editor/FleetView entry and fold actions have ambiguous ownership; history or completion could be stolen                  | Native input first, unconsumed edge entry, explicit focus table, local Prompt/Activity actions, fixed Esc and actual-binding hints            | `$impeccable clarify`  |
| P1       | Info, Transcript and request history are promises without an end-to-end route; earlier reports could become inaccessible | One Info document, one native-style history list, read-only historical reports, chronological transcript and origin-preserving back           | `$impeccable clarify`  |
| P1       | Fixed concept geometry does not protect input/help when output, questions or graphs grow                                 | Bounded bottom region, fixed identity/help, paged body, stable reading anchors, selection-visible overflow and real resize acceptance         | `$impeccable harden`   |
| P1       | "Reuse native" can incorrectly promise a native footer or inspector that the public extension inputs do not provide      | Reuse public editor/rendering/key/theme pieces; isolate the necessary footer adapter; prohibit fake AgentSession and private-container access | `$impeccable document` |
| P2       | Compact state and usage semantics differ across surfaces; Waiting can hide its cause and Done can hide commit failure    | Shared state mapping, current-request output metrics, unavailable rather than fake zero, errors before optional metrics                       | `$impeccable clarify`  |

These are closed as specification gaps, not implemented fixes. A separate read-only pass on the formal English/Chinese draft also found three P2 ambiguities: normal Git finalization must not say Stopping; paging a working detail must protect its content from replacement; terminal children must remain reopenable. The specification now distinguishes normal/stop finalization, preserves all paged reading anchors, and retains terminal rows in the current parent's retained run set. The acceptance table contains the corresponding traces. Final product polish remains part of implementation verification.

## Pi-native reuse and its limits

The pinned Pi 0.85.1 public exports include `CustomEditor`, `Editor` through Pi TUI, native user/assistant/tool components, Markdown, semantic themes and cell-width utilities. Reuse these in their intended role. The feature still owns recipient binding, current-request selection, bounded readers, FleetView and graph layout. Native exports do not supply those product semantics automatically.

Two limits matter:

1. `belowEditor` widgets are before the footer. FleetView below the statusline requires footer composition.
2. Exported `FooterComponent` needs a live AgentSession. The extension footer factory supplies TUI, theme and a read-only footer provider, not that session. The documented context supplies usage entries, context usage and model data. A small adapter using these values is legitimate; pretending a partial context is the full session is not.

A generic custom-component call does not by itself guarantee removal of all main bottom components. Use public editor/footer hooks and verify their real host behavior. The main statusline contract means the cwd/model/usage footer. Pi's other pending/status rows and unrelated extension widgets remain outside feature ownership; `setWorkingVisible(false)` controls only its working indicator. The specification now says so explicitly and budgets their space. No private-field mutation, copied editor engine or fake host agent switch is justified by the pictures. Existing extension statuses, editor history and autocomplete must survive composition.

Sources: [Pi extension contracts](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts), [public component exports](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/index.ts), [footer](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/footer.ts), [host composition](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/interactive-mode.ts), [keybindings](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/keybindings.ts).

## Harness references

- **Claude Code FleetView:** use the recorded CLI's help above focused rows and distinguish keyboard focus from active session identity. Adopt the placement, not its separate pointer/session markers. Evidence: [pinned CLI research and captures](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md).
- **Claude Agent View:** recent output or a pending question makes a useful peek. This supports the accepted detail order. Agent View manages independent background sessions and can attach to them; it is not the same surface as subagent FleetView. Do not import its host attach mechanism. Evidence: [official peek/reply documentation](https://code.claude.com/docs/en/agent-view#peek-and-reply), rechecked 2026-09-21.
- **arhen:** retain actual dependency edges and real task outcomes. Independent work stays flat; serial and DAG work use a graph. The same source supplies the communication, stop, failure and Git distinctions behind the UI. Evidence: [graph](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/graph.ts), [manager](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts).

- **Codex:** shared row columns, omission of secondary metadata at narrow widths, keeping selection visible, and hints generated from the configured keymap are useful implementation patterns. Adopt those rules, not its full-row highlight, sidebar or host task switching. Evidence at `4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646`: [row layout](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/app/agent_center/rows.rs), [contextual hints](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/app/agent_center/hints.rs), [detail priority](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/app/agents_overview_details.rs).

The earlier Cursor review URL now redirects to its documentation index. It is historical inspiration, not precise current evidence; no specification requirement depends on that link.

## Persona checks and smaller observations

- **Alex, keyboard expert:** editor arrows, history and completion must resolve before FleetView entry. Fold actions and the selected target must be discoverable from local help.
- **Sam, keyboard/low-vision user:** shape and wording provide non-color cues, but pale concept-image help is not contrast proof. Verify actual Pi light/dark/custom themes and terminal glyphs.
- **Riley, interruption/edge-case user:** test parent reply racing a human draft, new output during page-two reading, and follow-up after a commit failure. The UI must retain the right text and target rather than silently succeed elsewhere.

Use Activity consistently for the tool trail and follow-up consistently for continuation. Keep interface copy English. Update UIR09's accepted status while preserving original image-generation prompts as historical inputs.

## Evidence limits

Assessment A read the agreed documents, ten representative generated concepts and two older real Pi captures without detector findings. Assessment B ran the bundled detector separately and verified public exports with a Bun import probe. Native `ScrollView` can supply scroll mechanics; the feature still owns reading anchors and request boundaries. Public key helpers are `keyText`, `keyHint` and `rawKeyHint`, not the internal `keyDisplayText`. The installed detector engine reported 4.0.0 while the skill file reported 4.2.2; neither was changed for this review. Its result was exit 0 with `[]`: zero rules fired on a Markdown decision target. That cannot certify terminal layout, keyboard interaction or accessibility. A completed before B findings entered the parent synthesis.

There is no running redevelopment DOM surface to inspect or inject. No browser overlay or live detector server was started. Static image inspection, installed Pi declarations/source and pinned harness evidence are the fallback; actual host interaction and new screenshots remain A08-A10 implementation acceptance. This report does not repeat old implementation tests as proof of the redevelopment.

Both independent reviewers rechecked the final document changes and found no remaining publication blockers. Actual host composition, remapped bindings, resizing and concurrent updates remain implementation acceptance, not completed work.

Questions skipped: the maintainer approved all recommendations and requested direct specification synthesis without another interview.
