# Statusline implementation specification

[简体中文](i18n/zh-CN/statusline-spec.md) · English is normative.

## Problem Statement

The accepted statusline is a sample-only prototype. The production footer lacks its compact hierarchy and full Git state; context warnings do not follow the chosen compaction-aware policy.

## Solution

Implement the accepted two-row footer with real native Pi session data and bounded, event-triggered Git reads. Preserve existing extension status messages and provide a global native-footer fallback.

## User Stories

1. As a Pi user, I want the accepted two-row statusline enabled by default, so that I can use the chosen layout without setup.
2. As a user, I want the directory displayed as fully as space permits, so that I can identify the working location.
3. As a user, I want context percentage, capacity, a continuous meter and cache hit grouped after the directory, so that usage is easy to scan.
4. As a developer, I want branch or detached identity and Git counts on the right, so that repository state stays visible.
5. As a user, I want model and thinking effort on the second-row left, so that runtime identity has a stable location.
6. As an extension user, I want existing status segments on the second-row right, so that other extensions remain observable.
7. As a narrow-terminal user, I want complete fields hidden by priority, so that the footer stays at two rows without malformed fragments.
8. As a developer, I want staged, modified, untracked and conflicted file counts, so that pending work is clear.
9. As a developer, I want local ahead/behind counts without automatic fetching, so that the footer does not access the network.
10. As a developer, I want rebase/merge and other active Git operations exposed, so that I do not mistake an intermediate state for ordinary work.
11. As a worktree user, I want the current worktree's Git state, so that another checkout does not contaminate the display.
12. As a user, I want native branch notifications and activity-triggered refresh, so that status updates without continuous polling.
13. As a user, I want Git failure shown as unknown rather than clean, so that errors do not produce false confidence.
14. As a user outside Git, I want Git fields omitted, so that irrelevant errors do not clutter the footer.
15. As a user, I want native context estimation including compaction, so that the display follows Pi's session model.
16. As a user, I want unknown post-compaction usage explicitly marked, so that old usage is not presented as current.
17. As a user, I want context warnings tied to effective compaction settings, so that colors indicate proximity to compaction.
18. As a user with automatic compaction disabled, I want window-based warning colors, so that exhaustion risk remains visible.
19. As a user switching models, I want capacity and thresholds to follow the new model, so that old limits do not persist.
20. As a user, I want cache hit from the current branch's latest valid response, so that the value represents recent work.
21. As a user, I want known zero cache hit distinguished from missing usage, so that zero is not confused with unknown.
22. As an extension user, I want status text, case and colors preserved in stable key order, so that existing extensions need no new protocol.
23. As a user, I want native footer restoration through the global switch and reload, so that opting out is straightforward.
24. As a user, I want theme-aware semantic Git colors with symbols and counts, so that status remains understandable without color alone.
25. As a user, I want responsive input and cleanup during reload/session changes, so that status work cannot block or leak into another session.
26. As a maintainer, I want real-host tests and independent review, so that a convincing prototype becomes a verified implementation.

## Implementation Decisions

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

## Testing Decisions

The confirmed primary seam is the real Pi terminal with the unmodified package loaded, following the existing host fixtures. Observe visible text, colors, layout and lifecycle effects. Use real temporary Git repositories. External provider data may be deterministic; do not mock owned modules. Focused component tests at the footer capability and configuration boundary cover exact thresholds, branch usage and Git failure paths; expected values come from the agreed examples, not implementation-generated snapshots. Run targeted files per slice and the full applicable suite at the end.

Verify the real supported Pi hosts (0.85.1, 0.86.1 and 0.87.1) with isolated settings and deterministic provider data. Exercise normal/detached/unborn branches, dirty/conflicted/ongoing Git operations, worktrees, query failure/recovery and external branch changes. Check 150/100/80/50-column layouts, light/dark themes, native context unknown after compaction, both threshold modes and boundaries, model changes, branch/resume cache-hit selection, native setStatus updates/removal, reload and native-footer restoration. Confirm asynchronous Git work does not block input and releases resources on disposal.

Run applicable repository tests and checks, obtain the required independent full-diff standards/requirements review, and publish actual terminal captures and runtime evidence. Prototype samples are visual references, not production data or acceptance evidence. No new dependency, private-host patch, Pi fork or production persistence format is part of this design beyond the accepted configuration field. Merge and release require separate authorization.

## Out of Scope

New goal/quota providers, a new segment registration API, simultaneous full-footer composition, fixed Git polling, recursive project watchers, project-level statusline settings, per-field settings, new commands/panels, SDK transient settings parity, private host patches, Pi forks, automatic fetching, merge and release.

## Further Notes

Accepted by the maintainer after the design interview. Issue #117 / Beads pi-stuff-wv0, draft PR #118. Prototype #110 / #111 at59589c467215ec7394b36c2f60cea27e522316ad. Dedicated branch codex/statusline-implementation starts at94707f5; production implementation baseline51ccadf. Owner codex:01a0c7d6-a1a0-76d2-9995-08ea5fa365b3. Changing agreed boundaries requires a new decision.
