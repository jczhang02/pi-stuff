# Upstream provenance

This module began from the pinned `pi-subagents` `0.38.0` snapshot by Nico Bailon. The published archive was imported
unchanged in the isolated baseline commit.

- Upstream repository: <https://github.com/nicobailon/pi-subagents>
- Initial source tag: `v0.38.0`
- Initial source commit: `89de10e4bc8895e7948704c38620a5b35ddcd17e`
- Initial npm package: `pi-subagents@0.38.0`
- Initial npm SHA-1: `d7c3ce31cf71c0b96d02f2d48c1a715c07868dd1`
- Initial npm SHA-256: `b44d87afc519f96c627fe56320c7c405e7b48cd22791c7526759b6c10a061b4f`
- Initial npm integrity:
  `sha512-8wGQiX6rkR5J4V+AnWtQg3+LmC+cHnZIM1f/VWTjCTkVmcoKdeLsTAYG6BS2yKAugyEUjNUGj3vE5d9nj9m61A==`

## Reviewed synchronization point

Pi Stuff is semantically synchronized through upstream `v0.63.0` for the retained Agents Capability. This is not a
byte-for-byte re-import: Pi Stuff keeps Pi as the Host and classifies every later upstream change against its own owner
boundaries before adopting it.

- Reviewed source tag: `v0.63.0`
- Reviewed source commit: `4f7eb2b56dc5306416920db8c6e222c7aaad3c81`
- Reviewed npm package: `pi-subagents@0.63.0`
- Reviewed npm archive bytes: `1,209,401`
- Reviewed npm SHA-1: `85098af67e96b8b31f3ea456daef5637c1c3de5b`
- Reviewed npm SHA-256: `de6aff4af2ca27ffcb396578559b515f252b1050a0c7c5ffe388be1599bf485f`
- Reviewed npm integrity:
  `sha512-tS2zpzPnJh/tLODZGMN+XnpElOfN+l+KwDe+PnFcPfqwSd8zbirEjXR3W8uAcNlsaD8BxlDUSLHC//+v4+Ptcg==`
- License: MIT; the preserved `LICENSE` file has SHA-256
  `2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c`.

The complete 30-release, 820-commit review and every disposition category are recorded in the
[v0.63.0 synchronization ledger](../../../../docs/research/pi-subagents-v0.63-synchronization-20260902.md).

Pi Stuff retains the child-Pi process, session, lifecycle, steering, resume, capability-ceiling, recovery, and worktree
foundations, then replaces the public product behavior and UI. Unrelated upstream product surfaces remain excluded.

## Pi Stuff delta

Pi Stuff also keeps background completion out of model context: a durable custom session entry provides the compact
TUI outcome, while `/agents` owns report inspection. Suite-owned artifacts default to Pi's Settings-owned session root
instead of a project-local `.pi-subagents` directory.

Major removed upstream areas include:

- chain and workflow orchestration, scheduled runs, wait/auto-drain flows, and the Fleet control surface;
- Fleet panes, the Agent token statusline, and upstream settings UI;
- watchdog/review automation and LSP diagnostics;
- memory, share, and Teams integrations; and
- the upstream prompt library, all bundled Agent definitions and skills, admin/doctor commands, and profile-management
  surfaces.

`tanbiralam/claude-code`, released Claude Code binaries, and `tintinweb/pi-subagents` were observed only to understand
user-visible behavior. No code from those sources was copied into this module. The maintainer's previous `jczhang02/pi-agent`
configuration was also used only as a capability reference; none of its code was copied.

The source is maintained only inside Pi Stuff and has no independent Package or release lifecycle.
