---
status: accepted
amends: 0009-align-code-mode-with-openai-and-cloudflare
---

# Add a global Code Mode default to the project-scoped opt-in

## Context

ADR 0009 made Code Mode opt-in **project-scoped and durable**: a trusted project stores its explicit choice as the
boolean `enabled` field in `<project>/.pi/code-mode.json`, and that value overrides the process fallback
`PI_STUFF_CODE_MODE_DEFAULT`. That contract keeps one project from forcing Code Mode on every other project, and it
remains correct.

The friction it leaves is the empty middle: a user who wants Code Mode on for *most* projects must either export
`PI_STUFF_CODE_MODE_DEFAULT=on` in a shell profile (process-wide, invisible to Pi's settings surface, and applied even
to untrusted projects) or run `/codemode on` in each trusted project one at a time. There is no persisted, Pi-visible
default that sits between "process environment" and "per-project override".

## Decision

Add a **global** Code Mode default as one namespace (`codeMode.enabled`) inside the single merged Pi Stuff settings
file at `<agentDir>/pi-stuff.json`. The effective precedence becomes:

1. `PI_STUFF_CODE_MODE_FROZEN` — a child Agent's frozen launch value (unchanged, highest).
2. `<project>/.pi/code-mode.json` `enabled` — the project override (unchanged).
3. `pi-stuff.json` `codeMode.enabled` — the new global default.
4. `PI_STUFF_CODE_MODE_DEFAULT` — the process fallback (unchanged).
5. `false` — built-in default (unchanged).

`/codemode on` and `/codemode off` continue to write the **project** file, so a per-project choice is still the
explicit override and project isolation is preserved. `/codemode global on` and `/codemode global off` write the new
global namespace. This is the "global default, project stores only the difference" shape: the project file exists only
when a project diverges from the global default, exactly as before for projects that diverged from the process default.

## Consequences

- A user can set one global default and stop repeating `/codemode on` per project, while any project can still force
  `off` (or `on`) with its own `.pi/code-mode.json`.
- The global value lives in the merged settings file alongside every other Pi Stuff namespace, so it shares that
  file's lock and atomic write. It does not introduce a new per-Capability file.
- Untrusted projects are unaffected: they never read or write the project file, and the global default applies to
  them only through the same fallback path as the process default. A user who does not want Code Mode in untrusted
  projects keeps the global default `off` and opts in per trusted project.
- ADR 0009's "project-scoped and durable opt-in" claim is amended, not reversed: the project file remains the
  override authority; the global namespace is a new default layer beneath it.

## References

- ADR 0009 — the original project-scoped opt-in contract this amends.
- ADR 0012 — single merged Pi Stuff settings file (this global namespace is one occupant of it).
