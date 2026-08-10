# Upstream provenance

This module contains a reduced source snapshot derived from [`pi-background-tasks`](https://github.com/ismailsaleekh/pi-background-tasks), selected from its published `2.0.0` release and exact source commit `db632653682c00852a38c0972a761fb1e9f24dc3`.

- npm archive: `pi-background-tasks-2.0.0.tgz`
- npm integrity: `sha512-LyTFnuPbL2BhzNQaq7l7KN3neV2WyQbH1uEiSTM4cpyAw7489SATqQDoZ9SCqkRIBH/zktP7xvk/VNerpU3QPQ==`
- archive SHA-256: `7b0b1220bacc3fa2516cf9d7cdb1933d90b12b2b3dcd36c56c882ab41e6cfaf0`
- license: ISC, exact upstream notice retained in `LICENSE`
- retained `LICENSE` SHA-256: `5b9bdcc9d1c8ff25c560200695de042b12052573cb1224af4d735fba06d30b65`

Every published file was verified byte-for-byte against the recorded commit. The comparative audit and real Pi/process evidence are recorded in `docs/research/work-background-package-reference.md`.

## Retained lineage

The absorbed source retains the upstream Background Task runtime contract and implementation lineage: a session-owned registry, detached process-group launch, capped output and bounded reads, race-idempotent terminal state, group-first TERM with one KILL escalation, awaited stop/shutdown, compact terminal publication, and focused process-safety tests.

## Deleted upstream product areas

Fusion, delegation, attested Pi runners, Agent telemetry, update checks, footer/dock/status UI, Package-specific settings, and their runtime dependencies do not belong to Pi Stuff Work and are not retained. `pi-stuff-agents` remains the only Agent authority.

## Pi Stuff delta

- Adds leader start identity, stale-run reconciliation after abrupt Host death, and lazy project/session runtime files.
- Adds active-only foreground Bash detachment and one-shot command/log/file/HTTP Monitor conditions.
- Adds compact Suite Tool presentation and the shared full-width `/tasks` Command Dialog.
- Removes Sidebar, floating window, Capability statusline, permission prompt, daemon, and cross-session reattachment surfaces.

`pi-patty-bg-tasks@1.1.6` was inspected only as a behavior reference for conditional Bash detachment and Monitor ergonomics. Its source is not mixed into this module. The absorbed source has no independent Package or release lifecycle.
