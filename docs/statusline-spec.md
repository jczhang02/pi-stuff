# Statusline implementation decisions

[简体中文](i18n/zh-CN/statusline-spec.md) · English is normative.

Design interview in progress. This records accepted decisions, not a completed implementation contract. Production changes wait for the maintainer's confirmation of shared understanding.

## Accepted

- Follow the two-row prototype at `59589c467215ec7394b36c2f60cea27e522316ad`: directory/context/cache-hit on the first-row left, Git on the right; model/thinking on the second-row left. Other status segments belong on the second-row right, yielding to required Git reflow.
- Enable the custom statusline by default. A switch restores the native footer. Do not add per-field configuration in the first version.
- Git includes branch or detached HEAD identity, staged/modified/untracked/conflict file counts, ahead/behind commit counts, and ongoing operations such as rebase and merge. Required identity, operation and conflict information outranks optional context metrics when narrow.
- Context percentage remains used tokens divided by model window capacity. With automatic compaction enabled, let T be window capacity minus the effective reserveTokens for the current model: below 0.9T use accent, from 0.9T use warning, and from T use error. With automatic compaction disabled, use warning from 80% of window capacity and error from 90%. Apply the same color to the percentage and filled meter; changing model or effective compaction settings updates the thresholds.
- Do not implement new goal or account-quota providers.

## Open decisions

Context/cache-hit measurement; invalid or unavailable compaction configuration; missing/stale data; Git refresh and failure states; third-party segment compatibility and footer ownership; configuration and acceptance details.

## Tracking

[Implementation issue #117](https://github.com/jczhang02/pi-stuff/issues/117), Beads `pi-stuff-wv0`. [Prototype #110](https://github.com/jczhang02/pi-stuff/issues/110) and [draft PR #111](https://github.com/jczhang02/pi-stuff/pull/111) remain separate. No production implementation or merge is recorded here.
