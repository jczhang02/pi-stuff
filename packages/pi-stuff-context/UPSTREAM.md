# Bundled context engine provenance

Pi Stuff integrates an owned fork of Magic Context through this small adapter.

- Upstream: `https://github.com/cortexkit/magic-context`
- Owned fork: `https://github.com/jczhang02/magic-context`
- Upstream release: `v0.33.1`
- Audited source baseline: `dea65a94abf61b698160d14dc8b621b1387f1d2c`
- Pi Stuff fork commit: `fff20435536814cf881a5c8daf4c0fc88e8fe78f`
- Signed fork tag: `pi-stuff-v0.33.1-2`
- Package: `@jczhang02/pi-magic-context@0.33.1-pi-stuff.2`
- Release artifact SHA-256: `0c4cadfb35ad64d90a119eb8cd2bb5dffab43f5ba8096dfb9378b74dcd99bab3`
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
- project identity separates forks while sharing clones of one origin.
