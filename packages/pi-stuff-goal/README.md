# `@jczhang02/pi-stuff-goal`

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

Bare `/goal` opens the Suite's full-width Command Dialog. It uses Pi's native SettingsList interaction, never a floating
window or a package-owned Statusline. Goal work continues only from Pi's fully settled idle boundary, so retries,
compaction, steering, and queued user work settle before the next automatic turn.

Automatic continuation is unlimited for ordinary use by default. A non-disableable emergency backstop pauses only
after 10,000 automatic model responses, preventing catastrophic runaway even when the user-facing limit is Unlimited.
The no-progress heuristic is off by default: phase boundaries, ordinary tool failures, compaction, and short responses
cannot end a Goal. A user may opt into lower limits in Goal settings. Provider-reported usage and an optional token
budget remain authoritative.

Goal state is appended to Pi's session JSONL and restored on reload, resume, and compaction. Reload automatically
continues an active idle Goal from a fresh guarded continuation; a new session does not inherit another session's Goal.

## Terminal tools

- `goal_complete({ goal_id, summary, evidence })` accepts only the current guarded Goal id, a substantive completion
  summary, and concrete requirement-by-requirement proof entries.
- `goal_blocked({ goal_id, reason, attempt, evidence, repeated_turns })` accepts only a true impasse after the same
  blocker has recurred with three distinct concrete failed actions on consecutive Goal turns. Punctuation or attempt
  numbering cannot make the same action distinct. Resume starts a fresh audit.

The Package contributes no Skills.

## Provenance

This is a complete owned fork of the mature `@narumitw/pi-goal` implementation. See [UPSTREAM.md](./UPSTREAM.md) for the
exact source commit, owned-fork reference, license, and npm integrity record. Pi Stuff retains the state machine and
rewrites the presentation seam for the shared Suite UI.
