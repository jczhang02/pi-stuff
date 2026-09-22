# Session naming design

[简体中文](i18n/zh-CN/session-naming-design.md). Design interview for [#104](https://github.com/jczhang02/pi-stuff/issues/104), following the [research](session-naming-research.md). This draft records confirmed choices; the final defaults below and shared-understanding confirmation are pending. It does not authorize implementation.

## Purpose and task identity

Provide a recognizable opening task label with bounded naming work. Automatic titles do not track later phases or goal changes. This deliberately accepts an imperfect opening title; users can request a replacement. Explicit generation describes the current agreed main task, not the latest incidental operation or a catalogue of all past topics.

## Automatic lifecycle

| Situation                                            | Agreed behavior                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Newly created blank main session                     | After its first successful exchange settles, attempt generation at most once |
| Name already exists before generation                | Preserve it; skip generation                                                 |
| First exchange is cancelled or fails                 | Skip generation; do not wait for a later successful exchange                 |
| Naming fails, times out or returns invalid output    | Keep the default display or existing name; do not retry automatically        |
| Later input, task replacement, compaction or reload  | No new automatic generation                                                  |
| Resume, fork (named or unnamed), background subagent | No automatic generation                                                      |
| User explicitly requests generation                  | One requested replacement; never re-enable automatic management              |

Input for the opening request is the first user request and bounded final assistant text. Exclude tool results, process logs and thinking. The user request is authoritative when assistant text misinterprets it. No separate model call decides whether clarification is complete.

The implementation must preserve the at-most-once boundary across reload, resume and navigation. A pending result must not overwrite a later manual name or rename another session/branch. These are acceptance conditions, not a selected persistence schema or concurrency abstraction.

## Manual controls

Keep Pi's `/name <name>` for direct assignment. Add `/autoname [task hint]` for generated replacement. A supplied hint takes priority; without one, provide bounded opening and recent user/assistant dialogue, not the entire history. The command replaces the name once and does not start a recurring process.

Manual naming remains authoritative until the user changes it or explicitly requests a generated replacement. Editing naming configuration does not retroactively rename sessions.

## Model and naming rules

Use the configured naming model when present, otherwise the current session model, through Pi's model registry and authentication. Do not create a separate provider client. A naming failure does not cause automatic retries or a chain of fallback models.

Default style:

- English `type: Action object`, with `research / feat / fix / refactor / docs / chore`.
- Prefer 4-8 description words; complete name at most 80 characters.
- Preserve technical identifier casing. No scope parentheses, dates, progress or completion state.
- Classify the whole task, not its current research/test/commit phase.

Users can replace the naming-style prompt in configuration. `maxLength` is a separate setting, defaulting to 80. Basic output validation remains: nonempty, single-line text within the configured length, without control characters. Do not enforce the default type enumeration or English when the style prompt was replaced. A custom prompt does not alter input selection, request eligibility or retry behavior.

## Host facts that constrain implementation

Pi 0.85.1 emits `agent_settled` without a success field. Check the preceding persisted assistant state, not settlement alone; preflight failures may occur before a settled event. `session_start` can mean startup, reload, new, resume or fork, and startup can open an existing session. A fork copies the path to the selected leaf, including only names on that path. The name itself is read across the session's entries, so branch-local naming ownership alone is insufficient. Sources: [events](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts), [lifecycle](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts), [session manager](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts).

## Final defaults to confirm

The following are proposals, not confirmed decisions:

- Enable automatic opening naming by default; a configuration switch disables automatic naming while keeping `/autoname` available.
- Bound conversation text to 2,000 characters automatically and 4,000 for explicit generation. Custom style instructions and request framing add input beyond these conversation budgets. Use deterministic selection, not a second summarization request.
- Use a 15-second request deadline and a small output budget. Disable client-side retries where supported and request no extra reasoning where the provider supports it. Exact output accounting depends on the provider; do not equate an 80-character title with an 80-token bill.

These numbers are conservative design starting points, not measured optimal values. Configuration field names and the persistence representation remain implementation work, subject to the agreed behavior and repository review requirements.
