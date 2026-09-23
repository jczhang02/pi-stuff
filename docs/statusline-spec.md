# Statusline implementation decisions

[简体中文](i18n/zh-CN/statusline-spec.md) · English is normative.

Final design summary awaiting the maintainer's shared-understanding confirmation. Production implementation has not started.

## Accepted

- Follow the two-row prototype at `59589c467215ec7394b36c2f60cea27e522316ad`: directory/context/cache-hit on the first-row left, Git on the right; model/thinking on the second-row left. Other status segments belong on the second-row right, yielding to required Git reflow.
- Enable the custom statusline by default. Use global pi-stuff.json statusline.enabled (default true), applied on /reload. False restores the native footer. No new command, settings panel, project override or per-field configuration in the first version.
- Reuse native Git branch-change notifications. Refresh the additional Git snapshot at initialization, Pi tool completion, session changes and /reload. Do not add a fixed status poll or recursive project watcher. Ordinary external working-tree edits while Pi is idle may remain stale until the next refresh trigger. Never fetch remotes automatically.
- Outside a Git repository, hide Git fields. On a Git query failure or timeout, retain only trustworthy identity, show muted `git ?`, and hide stale counts. Recover on a later successful refresh; do not repeatedly notify.
- Git includes branch or detached HEAD identity, staged/modified/untracked/conflict file counts, ahead/behind commit counts, and ongoing operations such as rebase and merge. Required identity, operation and conflict information outranks optional context metrics when narrow.
- Context percentage remains used tokens divided by model window capacity. With automatic compaction enabled, let T be window capacity minus the effective reserveTokens for the current model: below 0.9T use accent, from 0.9T use warning, and from T use error. With automatic compaction disabled, use warning from 80% of window capacity and error from 90%. Apply the same color to the percentage and filled meter; changing model or effective compaction settings updates the thresholds.
- Use native Pi context usage. When unknown, show `ctx ?/272k` with the actual capacity, no meter and no warning color; never substitute zero or pre-compaction usage.
- Cache hit means the current session branch's latest valid model response: cacheRead / (input + cacheRead + cacheWrite). Show 0% for known input with no cache hit; hide hit without valid statistics.
- Read third-party segments from existing setStatus entries, sort by key, preserve text case and colors, and join with `·` on row-two right. Hide whole segments from the end when narrow. No new registration protocol or per-segment settings.
- Pi has one custom footer slot. Support third-party status segments, not simultaneous composition with another full footer replacement. Do not reclaim the slot repeatedly; users choose a footer. The off switch restores the native footer.
- Prefer native host capabilities throughout. Read persisted compaction settings through the current Pi version's settings reader, preserving its global/project/default precedence and model overrides where supported. Re-read on /reload and model changes. Do not reach into private live host objects or promise SDK-only transient override parity.
- Reuse native configuration defaults and error handling. If compaction settings cannot be determined reliably, do not invent pressure thresholds: retain known context numbers in neutral text. A known nonpositive T means the trigger boundary is already reached, so show error for known usage. Missing model/window data remains unknown, never zero.
- Preserve two rows, normal spaces and dot separators, original value case and lowercase authored labels. Hide optional segments whole; preserve directory/Git identities as far as the viewport permits, truncating only when an identity itself cannot fit.
- Do not implement new goal or account-quota providers.

## Verification and implementation boundary

Verify the real supported Pi hosts (0.85.1, 0.86.1 and 0.87.1) with isolated settings and deterministic provider data. Exercise normal/detached/unborn branches, dirty/conflicted/ongoing Git operations, worktrees, query failure/recovery and external branch changes. Check 150/100/80/50-column layouts, light/dark themes, native context unknown after compaction, both threshold modes and boundaries, model changes, branch/resume cache-hit selection, native setStatus updates/removal, reload and native-footer restoration. Confirm asynchronous Git work does not block input and releases resources on disposal.

Run applicable repository tests and checks, obtain the required independent full-diff standards/requirements review, and publish actual terminal captures and runtime evidence. Prototype samples are visual references, not production data or acceptance evidence. No new dependency, private-host patch, Pi fork or production persistence format is part of this design beyond the accepted configuration field. Merge and release require separate authorization.

## Tracking

[Implementation issue #117](https://github.com/jczhang02/pi-stuff/issues/117), Beads `pi-stuff-wv0`. [Prototype #110](https://github.com/jczhang02/pi-stuff/issues/110) and [draft PR #111](https://github.com/jczhang02/pi-stuff/pull/111) remain separate. No production implementation or merge is recorded here.
