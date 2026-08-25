# Ponytail module

Ponytail is Pi Stuff's feature-complete internal fork of
`@dietrichgebert/ponytail@4.9.0`. It keeps the upstream implementation-discipline
rules, Session modes, natural-language deactivation, five command aliases, and
six Skills while adapting presentation and configuration to the Suite. The
upstream package is not a runtime dependency. Reviewed source provenance,
license obligations, and byte-identical resource hashes are recorded in
[UPSTREAM.md](./UPSTREAM.md) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Behavior

The valid runtime modes are `off`, `lite`, `full`, and `ultra`; `full` is the
upstream default. `review` remains a Skill and is never accepted as a mode. A
mode change appends the upstream-compatible model-invisible Session entry
`ponytail-mode` with `{ "mode": "..." }`. Restoration chooses the newest valid
entry on the current branch, then a delegated Agent's launch snapshot, then the
configured default. `stop ponytail` and `normal mode` deactivate Ponytail only
when they are standalone direct user inputs.

Context Management projects Ponytail after the Magic Context contract. Stable
markers make the contribution idempotent on every Provider activation. All six packaged Skills stay available as explicit commands but opt out of the Host's standing catalog. In `lite`,
`full`, and `ultra`, Ponytail projects concise model-visible descriptions before compact mode instructions; in `off`,
it contributes neither catalog nor instructions. The full reviewed upstream rules remain available through
`/skill:ponytail`.

Delegated Agents receive the parent's effective mode as a launch-time snapshot,
including explicit `off`. The snapshot is carried only in the child process
environment and does not mutate global settings.

Ponytail has its own prompt budget rather than increasing Context Management's budget. `off` contributes zero
characters and tokens. The compact active-mode policy plus six-Skill catalog measures 795 o200k tokens in `full`
(`lite`: 796; `ultra`: 802), down from the fork baseline's 2,437-token combined contribution.
`test/ponytail/prompt-budget.test.ts` bounds the policy and catalog independently.

## Commands and UI

Bare `/ponytail` opens the shared Pi Stuff Command Dialog. It controls the
current Session mode, configured default, Statusline visibility, startup
notification, and launches the five specialized Skills without leaving the
Dialog for ordinary setting changes. Parameterized commands remain direct:

```text
/ponytail on|off|lite|full|ultra
/ponytail default off|lite|full|ultra
/ponytail status [show|hide]
/ponytail startup show|quiet
/ponytail-review [focus]
/ponytail-audit [focus]
/ponytail-debt
/ponytail-gain
/ponytail-help
```

The shared Statusline shows only the Nerd Font `󱖿 <mode>` identity and hides it while mode is `off` or
Statusline visibility is disabled. Pi Stuff's Working Row remains the sole
activity authority. The Dialog suppresses shared persistent chrome while open,
restores the editor draft on close, returns from secondary lists with Escape,
and keeps environment overrides visible but read-only.

## Configuration

Ponytail reads configuration in this order:

1. `PONYTAIL_DEFAULT_MODE`, `PONYTAIL_HIDE_STATUS`, and
   `PONYTAIL_QUIET_STARTUP` environment variables;
2. the `ponytail` namespace in `<agentDir>/pi-stuff.json`;
3. read-only legacy `~/.config/ponytail/config.json` (or its XDG/Windows
   equivalent) only when the merged namespace is absent;
4. upstream defaults.

The merged namespace accepts `defaultMode`, `hideStatus`, and `quietStartup`.
Dialog and command writes update only that namespace under the shared settings
lock. They never change environment overrides or the legacy file. Invalid
merged JSON or an invalid `ponytail` namespace fails closed to defaults, emits a
silent Diagnostic Record, and cannot be overwritten through Ponytail.

## Behavioral benchmark

`bun run benchmark:ponytail --output <absolute-path>` runs the fixed real-model acceptance study against the certified
Pi Host and `jcapi/openrouter/stealth/ox-alpha`. It uses three YAGNI-sensitive tasks, three independent paired
`off`/`ultra` repetitions, neutral case paths, unchanged prompts and fixtures, hidden correctness checks, fixed
Tools, and no retry or replacement of failed Sessions. The output omits Session paths and transcripts.

The predeclared strong-effect gate requires all 18 Sessions to pass visible and hidden checks without protected-file or
prompt-boundary violations, all nine pairs to be measurable, at least six non-tied production-LOC pairs, and a one-sided
exact sign-test result of `p <= 0.05` favoring `ultra`. The certified run passed all 18 Sessions: `ultra` used
87 aggregate production LOC versus `off`'s 141 (-38%), won eight of nine pairs, and produced `p = 0.01953125`.
It also reduced structural declarations from six to three and Assistant reply characters from 3,821 to 2,007, while
increasing total tokens from 113,012 to 148,513 (+31%). This is a manual authenticated benchmark, not a CI gate or
a claim about every model and task.

## Upstream review

Run `bun run ponytail:upstream:review` from the repository root to compare the pinned baseline with npm's current
candidate. Pass `--version <version>` to inspect a named release. This verifies both tarballs before extraction,
rechecks the local one-field Skill adaptation and retained license, and emits a sanitized package diff for human
review; it never updates the fork.
