# Upstream provenance

`@jczhang02/pi-stuff-agents` is an owned fork of `pi-subagents` `0.38.0` by Nico Bailon.

- Upstream repository: <https://github.com/nicobailon/pi-subagents>
- Source tag: `v0.38.0`
- Source commit: `89de10e4bc8895e7948704c38620a5b35ddcd17e`
- npm package: `pi-subagents@0.38.0`
- npm SHA-1: `d7c3ce31cf71c0b96d02f2d48c1a715c07868dd1`
- npm SHA-256: `b44d87afc519f96c627fe56320c7c405e7b48cd22791c7526759b6c10a061b4f`
- npm integrity:
  `sha512-8wGQiX6rkR5J4V+AnWtQg3+LmC+cHnZIM1f/VWTjCTkVmcoKdeLsTAYG6BS2yKAugyEUjNUGj3vE5d9nj9m61A==`
- License: MIT; the preserved `LICENSE` file has SHA-256
  `2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c`.

The published archive was imported unchanged in the isolated baseline commit. Pi Stuff retains the child-Pi process,
session, lifecycle, steering, resume, capability-ceiling, recovery, and worktree foundations, then replaces the public
product behavior and UI. Unrelated upstream product surfaces were excluded from this fork.

Major removed upstream areas include:

- chain and workflow orchestration, scheduled runs, wait/auto-drain flows, and the Fleet control surface;
- Fleet panes, the Agent token statusline, and upstream settings UI;
- watchdog/review automation and LSP diagnostics;
- memory, share, and Teams integrations; and
- the upstream prompt library, bundled skills, admin/doctor commands, and profile-management surfaces.

`tanbiralam/claude-code`, released Claude Code binaries, and `tintinweb/pi-subagents` were observed only to understand
user-visible behavior. No code from those sources was copied into this fork. The maintainer's previous `jczhang02/pi-agent`
configuration was also used only as a capability reference; none of its code was copied.
