# Bundled context engine provenance

Pi Stuff integrates the official Magic Context Package through this adapter. It
does not vendor or patch Magic Context Core.

- Upstream: `https://github.com/cortexkit/magic-context`
- Upstream release: `v0.33.1`
- Published source commit (`gitHead`): `075e21f77c671781b25de9440c1a727f5fa4413d`
- Package: `@cortexkit/pi-magic-context@0.33.1`
- npm integrity: `sha512-mybLPirFtUqVb+7cTS2Bpg/h33NbSSQvUOSfeP1C5QrxMVptQjGeNnSTLLrkfH5i5BUVY3D/r3OGE3PhzWsX0A==`
- npm tarball SHA-1: `b0792c428cb1238ba33302403f6e13be3c865d77`
- Audited tarball SHA-256: `106a276b631bbff324d17091ceb82959779678945596d17fd75d3b23abb6f261`
- License: MIT, as declared by the official Package manifest and upstream repository.

The Package declares Pi peers `^0.80.2`, which does not include the Suite's
certified Pi 0.84.2 Host. Pi Stuff therefore does not infer compatibility from
the peer range: its real-Host PTY gate separately certifies this exact artifact
against the pinned Pi 0.84.2 source profile.

## Pi Stuff adapter policy

- lazy direct-input activation, with automatic-turn activation only when a recognized CortexKit config exists and no
  legacy user/project configuration is awaiting the official factory's migration;
- native Pi fail-open behavior;
- one bounded status/projection seam for BTW and Agents;
- exact official Package behind a replaceable Capability seam;
- no competing Todo, statusline, announcement, Dreamer, or Sidekick UI;
- only the five Context tools plus focused status, flush, recomposition,
  wrap-up, and session-upgrade commands are exposed;
- one explicit compaction authority: native fallback is allowed before Magic
  takeover, never stacked after an active Magic attempt;
- bounded reference-only projections for BTW and Agents;
- a first-use configuration bootstrap that mirrors upstream's absolute-XDG and JSON/JSONC path rules, ignores custom
  Pi agent directories that upstream does not read, and creates a user config only when no recognized user or project
  config exists;
- a lexical-only first-use search profile. The official 0.33.1 local embedding
  loader cannot resolve its Transformers dynamic import from the certified
  single-file Host; disabling that optional path prevents repeated load errors
  without patching Core. Explicit user embedding configuration is preserved.
