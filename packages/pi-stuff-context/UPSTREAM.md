# Bundled context engine provenance

Pi Stuff integrates an owned fork of Magic Context through this small adapter.

- Upstream: `https://github.com/cortexkit/magic-context`
- Owned fork: `https://github.com/jczhang02/magic-context`
- Upstream release: `v0.33.1`
- Audited source baseline: `dea65a94abf61b698160d14dc8b621b1387f1d2c`
- Pi Stuff fork commit: `1414363e946915802a7d16ffc91999c63dd40744`
- Signed fork tag: `pi-stuff-v0.33.1-3`
- Package: `@jczhang02/pi-magic-context@0.33.1-pi-stuff.3`
- Release artifact SHA-256: `5f93130518910291d29d6c8b98d042e0d757bd7edc2d07c03a195d93c872cdbd`
- Upstream npm integrity: `sha512-mybLPirFtUqVb+7cTS2Bpg/h33NbSSQvUOSfeP1C5QrxMVptQjGeNnSTLLrkfH5i5BUVY3D/r3OGE3PhzWsX0A==`
- License: MIT; the fork package preserves the upstream notice.

## Pi Stuff delta

- lazy first-input activation with automatic-turn fallback;
- native Pi fail-open behavior;
- one bounded status/projection seam for BTW and Agents;
- no competing Todo, statusline, command dialogs, notifications, Dreamer, or
  Sidekick UI;
- optional local embedding runtime with one-time lexical FTS fallback when the
  embedding runtime is unavailable;
- immediate JSONL-derived message-index reconciliation for explicit recall and
  compact-and-resume search boundaries that exclude the still-visible live tail;
- project identity separates forks while sharing clones of one origin.
