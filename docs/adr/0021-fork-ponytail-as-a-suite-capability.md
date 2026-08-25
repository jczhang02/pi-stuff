# ADR 0021: Fork Ponytail as a Suite Capability

- Status: Accepted
- Date: 2026-08-25

## Context

`@dietrichgebert/ponytail@4.9.0` supplies persistent KISS/YAGNI implementation
discipline through four modes, mode-filtered instructions, Session state, and
six Skills. Its behavior is useful as one coherent Capability, but its upstream
Extension owns a separate configuration file, status indicator, startup UI,
and Agent assumptions that conflict with Pi Stuff's single Package, merged
settings, shared Statusline, Context prompt composition, and delegated-Agent
lifecycle.

A reduced reimplementation would lose upstream-visible behavior. A runtime npm
dependency would retain conflicting UI and lifecycle ownership and make prompt
composition and child inheritance indirect. Copying upstream without recording
provenance would also fail its MIT notice obligation.

## Decision

Pi Stuff carries a manually reviewed feature-complete fork of Ponytail 4.9.0 as
the internal `ponytail` Capability Module. The upstream package is not a runtime
dependency. Canonical Skill bodies, frontmatter, and license resources retain the reviewed upstream bytes except for Pi's
`disable-model-invocation: true` field on each Skill. The field keeps native discovery explicit-only so Ponytail can
make model visibility follow the current Session mode. A committed hash manifest covers the unadapted upstream
baseline, and tests prove the field is the only resource delta.
Pi Stuff-owned adapters may change implementation defects without changing the
public behavior: `review` is a Skill rather than a runtime mode, reload and
resume registration is idempotent, invalid merged configuration is preserved,
and delegated Agents receive the parent mode.

Ponytail owns modes, commands, settings, raw instructions, Skills, and Session
entries. Context Management owns ordered prompt projection and Provider-request
fallback. Conversation UI owns the Command Dialog and shared Statusline
rendering. Agents copy the effective parent mode into each child launch.

Prompt order is Host/base context, Magic Context contract, the active-mode compact Ponytail Skill catalog, then
compact current-mode instructions. Native Skill discovery keeps all six commands available but model-hidden; Ponytail
projects concise descriptions for the Host-filtered Skills only in `lite`, `full`, or `ultra`. `off` contributes neither
catalog nor instructions. Context wraps the contribution in stable markers and reconciles it on both
`before_agent_start` and supported Provider payloads, so a request receives it at most once.

Mode persistence keeps the upstream-compatible custom entry
`ponytail-mode` / `{ mode }`. Valid values are `off`, `lite`, `full`, and
`ultra`. Restoration precedence is newest valid branch entry, child launch
snapshot, configured default. The default is `full`.

Configuration precedence is `PONYTAIL_*`, merged `pi-stuff.json` `ponytail`,
read-only legacy Ponytail config when the namespace is absent, then defaults.
Only merged settings are writable. Invalid merged settings fail closed and are
never rewritten by Ponytail.

Bare `/ponytail` opens the shared Command Dialog; parameterized mode and setting
commands remain direct. The five upstream command aliases launch their packaged
Skills using Pi's native Skill expansion. The shared Statusline shows the
Pi Stuff-styled `♞ <mode>` only. It does not own Agent activity; the Working Row
remains the single activity authority.

## Consequences

- Ponytail retains the complete upstream Skill content for explicit invocation while its standing projection is a
  compact behavioral policy. Active modes keep all six Skills model-visible through Ponytail's catalog; `off` is a
  zero-contribution hard boundary.
- Context Management now exposes a generic ordered prompt-contribution seam and
  supports known Anthropic, OpenAI, Google, Bedrock, and Mistral payload shapes.
  Unknown payload shapes fail open with a Diagnostic Record.
- The Package declares `src/ponytail/skills` as Pi Runtime Resources.
- Upstream updates require a manual diff, license review, resource hash refresh,
  behavior tests, prompt-budget measurement, and real-Host acceptance.
- The Capability adds no independent package, runtime, status footer, settings
  file, or installation lifecycle.
