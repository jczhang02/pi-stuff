# Upstream provenance

- Project: [`ssdiwu/pi-autoname`](https://github.com/ssdiwu/pi-autoname)
- Absorbed source commit: `73d25caa9ff33dadfaa8187ad3f7d1495a01cec9` (`main`, retrieved 2026-08-24)
- Latest published package at absorption: `pi-autoname@0.6.8`
- Published package Git commit: `6cb20af3fd5a0b766347ba53ab2b015f70ff345b`
- Published package integrity: `sha512-+fEjRKxBGAqhT4WboA7ZjV2KTxDilZPAG4kAJQV2YxgWRCVpq6MwImGYUitO6mZbtUWl5mjz0BfgePJ2pzG1ow==`
- Copyright: Copyright (c) 2025 ssdiwu
- License: MIT; the upstream license is preserved in [`LICENSE`](LICENSE).

Pi Stuff owns this fork as the internal `session-naming` Capability. The source was adapted rather than copied
verbatim: configuration moved into the merged Pi Stuff settings file; model calls use Pi's current public model
registry; automatic runs use the shared direct-user settled lifecycle and exclude Child Agent Sessions; state entries
distinguish forced regeneration from observed manual names; model fallbacks are opt-in; bounded local fallback and
credential redaction were extended; and upstream console/file diagnostics were replaced by Pi Stuff diagnostics and
tests.
