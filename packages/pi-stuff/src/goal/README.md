# Goal module

The Goal Capability keeps one objective active in the current Pi session until the model proves completion with
`goal_complete`, the user pauses or clears it, an explicit provider authentication/usage limit or optional token budget
stops work, or a genuine
external blocker passes the strict three-turn `goal_blocked` audit.

## Daily use

```text
/goal implement and verify the requested change
/goal --tokens 100k complete the migration
/goal status
/goal pause
/goal resume
/goal edit finish the smaller compatible migration
/goal clear
```

Bare `/goal` opens the Suite's full-width Command Dialog. It uses Pi's native SettingsList interaction and never creates
a floating window or package-owned Statusline. The current Goal contributes one conditional segment to the shared
Conversation UI Statusline; with no Goal it is absent. Active state renders ` goal used/budget elapsed` and refreshes
elapsed active time while visible. Paused, blocked or limit-stopped, and complete states retain their distinct Nerd Font
``, ``, and `` semantics. Started, replaced, resumed, and updated TUI notices use the ordinary Conversation
Transcript `•` record marker with an emphasized action label; RPC and headless notices remain plain text. Goal work continues only from
Pi's fully settled idle boundary, so retries, compaction, steering, and queued user work settle before the next automatic
turn.

Automatic continuation is unlimited for ordinary use by default. A non-disableable emergency backstop pauses only
after 10,000 automatic model responses, preventing catastrophic runaway even when the user-facing limit is Unlimited.
The no-progress heuristic is off by default: phase boundaries, ordinary tool failures, compaction, and short responses
cannot end a Goal. A user may opt into lower limits in Goal settings. Provider-reported usage and an optional token
budget remain authoritative.

Goal state is appended to Pi's session JSONL and restored on reload, resume, and compaction. Reload automatically
continues an active idle Goal from a fresh guarded continuation; a new session does not inherit another session's Goal.
Explicit clear also removes this project's obsolete pre-Session state under the shared Settings lock and an atomic
replace. Invalid legacy JSON is left untouched and reported instead of being discarded.
When Magic Context or another Extension cancels native Pi compaction, Pi 0.84.3 emits `session_compact_failed`. Goal
accepts that native failure only for the matching compaction it observed at `session_before_compact`, then replaces its
stale continuation exactly once. A successful `session_compact` remains the only success boundary.
The full objective, completion guard, and continuation protocol are delivered as non-rendered Pi custom messages: the
model receives them and the session retains them, while the TUI and HTML conversation export stay focused on the
user's command, Tool outcome, and final response.

Internally, `goal.ts` is the single Pi lifecycle composition root: event order and per-factory closures remain together.
The generation-guarded state machine stays in `runtime.ts`, pure state and formatting policy in `policy.ts`, command
registration and transitions in `commands.ts`, compaction retry coordination in `compaction.ts`, automatic-run
coordination in `run-protocol.ts`, terminal Tool execution in `terminal-tools.ts`, and its stateless schemas and
presentation in `tool-contract.ts`. Splitting lifecycle handlers by event would duplicate continuation, stale-turn,
persistence, and safety invariants.

## Terminal tools

- `goal_complete({ goal_id, summary, evidence })` accepts only the current guarded Goal id, a substantive completion
  summary, and concrete requirement-by-requirement proof entries.
- `goal_blocked({ goal_id, reason, attempt, evidence, repeated_turns })` accepts only a true impasse after the same
  blocker has recurred with three distinct concrete failed actions on consecutive Goal turns. Punctuation or attempt
  numbering cannot make the same action distinct. Resume starts a fresh audit.

The module contributes no Skills.

## Provenance

This implementation derives from the mature `@narumitw/pi-goal` project. See [UPSTREAM.md](./UPSTREAM.md) for the exact
source commit, absorbed snapshot, license, and npm integrity record. Pi Stuff retains the state machine and rewrites
the presentation seam for the shared Suite UI.
