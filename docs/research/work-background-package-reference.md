# Background work Package reference

**Audit date:** 2026-08-05
**Retrieval date:** 2026-08-05
**Certified Host:** Pi 0.83.0, Linux x64
**Decision:** Fork the background-task runtime from `pi-background-tasks@2.0.0` at `db632653682c00852a38c0972a761fb1e9f24dc3`; do not use `pi-patty-bg-tasks` or `@ifi/pi-background-tasks` as the code base.

## Decision

Pi Stuff should internalize an owned fork of [`pi-background-tasks@2.0.0`](https://registry.npmjs.org/pi-background-tasks/2.0.0), from exact source commit [`db632653682c00852a38c0972a761fb1e9f24dc3`](https://github.com/ismailsaleekh/pi-background-tasks/tree/db632653682c00852a38c0972a761fb1e9f24dc3).

This is a **runtime-kernel selection**, not approval of the upstream product surface. The local fork must retain the process lifecycle and bounded-output work, then delete Fusion, delegation, telemetry, update checks, the upstream footer/dock, and other unrelated behavior. Pi Stuff will build its accepted Ctrl+B, Monitor, notification, and `/tasks` surfaces around the retained kernel.

`pi-patty-bg-tasks` is closer to the desired interaction model because it already overrides Bash, supports foreground detachment, and includes a Monitor tool. It is not the base because its process ownership is materially weaker: stop is best-effort `SIGTERM`, has no TERM-to-KILL escalation or awaited tree settlement, identifies a process only by PID, and explicitly allows unbounded persistent-monitor logs. Those are core-runtime deficiencies, not UI changes.

## Product contract used for the comparison

The accepted contract is recorded in Beads `ps-5cb.11.2.*`. In concrete terms:

1. Background work belongs only to the current Pi session; there is no daemon or cross-session reattachment.
2. Pi Stuff owns the complete process tree and stops it on request, timeout, reload, and Pi exit.
3. Stop is idempotent TERM-to-KILL escalation, and PID reuse must never signal an unrelated process.
4. Output and every model-visible read are bounded.
5. Ctrl+B detaches only the active foreground Pi Stuff Bash call.
6. Monitor waits once for an explicit command, log, file, or HTTP condition with a deadline; it is not a polling loop in the main conversation.
7. `/tasks` manages Background Shell and Monitor and projects running Subagents without taking authority from `/agents`.
8. `/tasks` uses Pi Stuff's full-width, non-floating Command Dialog. There is no permanent task footer, statusline, overlay, or permission prompt.

No audited upstream satisfies all eight items. Selection therefore turns on which candidate supplies the safest deep runtime with the least dangerous rewrite.

## Candidate comparison

| Candidate | Provenance and license | Maintenance and adoption | Runtime correctness | Contract fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| `pi-background-tasks@2.0.0` | Exact npm payload matches [`db632653…`](https://github.com/ismailsaleekh/pi-background-tasks/tree/db632653682c00852a38c0972a761fb1e9f24dc3); [ISC](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/LICENSE), copyright line `Copyright (c) 2026` | Published 2026-08-04; 2,263 downloads in the fixed 30-day window | Detached POSIX process groups, group-first kill, child fallback, one SIGKILL escalation, awaited stop, bounded output/read, idempotent finalization | No Ctrl+B detach or Monitor; upstream UI and unrelated Fusion/delegation must be removed | **Select the background runtime** |
| `pi-patty-bg-tasks@1.1.6` | Exact npm payload matches [`6676db5…`](https://github.com/patty-io/pi-patty-bg-tasks/tree/6676db5b30caafea0431d29400ccfbffa51aa9e9); [MIT](https://github.com/patty-io/pi-patty-bg-tasks/blob/6676db5b30caafea0431d29400ccfbffa51aa9e9/LICENSE), copyright 2026 patty.io | Published 2026-07-08; 980 downloads in the fixed window; an unreleased 2.0.0 commit exists | Detached group spawn and group signal, but no escalation, awaited settlement, start identity, or bounded persistent-monitor log | Best Ctrl+B/Monitor behavioral reference; core safety would require replacement | Reference behavior only |
| `@ifi/pi-background-tasks@0.5.1` | Release [`e9c9d96…`](https://github.com/ifiokjr/oh-pi/tree/e9c9d96e75fd4d2b1748f81d0788f29cc8013ec8/packages/background-tasks); [MIT](https://github.com/ifiokjr/oh-pi/blob/e9c9d96e75fd4d2b1748f81d0788f29cc8013ec8/LICENSE), copyright 2025 Ifiok Jr. | Published 2026-04-28; 154 downloads in the fixed window | Bounded in-memory tail and output-pattern wakeups, but root-PID-only SIGTERM, no process group, escalation, or awaited shutdown; disk log is uncapped | Useful matcher idea, but floating overlay and old Pi package namespace | Reject |

The adoption window is 2026-07-06 through 2026-08-04. Sources: npm's fixed-window records for [`pi-background-tasks`](https://api.npmjs.org/downloads/point/2026-07-06:2026-08-04/pi-background-tasks), [`pi-patty-bg-tasks`](https://api.npmjs.org/downloads/point/2026-07-06:2026-08-04/pi-patty-bg-tasks), and [`@ifi/pi-background-tasks`](https://api.npmjs.org/downloads/point/2026-07-06:2026-08-04/%40ifi%2Fpi-background-tasks). Downloads are an adoption signal, not a user count or quality score.

## Selected source identity

| Fact | Verified value |
| --- | --- |
| Package | `pi-background-tasks` |
| Version | `2.0.0` |
| Published | 2026-08-04 19:39:56 UTC |
| Exact source revision | `db632653682c00852a38c0972a761fb1e9f24dc3` |
| License | ISC; the exact notice has no named copyright holder |
| npm archive | `https://registry.npmjs.org/pi-background-tasks/-/pi-background-tasks-2.0.0.tgz` |
| npm integrity | `sha512-LyTFnuPbL2BhzNQaq7l7KN3neV2WyQbH1uEiSTM4cpyAw7489SATqQDoZ9SCqkRIBH/zktP7xvk/VNerpU3QPQ==` |
| Locally observed archive SHA-256 | `7b0b1220bacc3fa2516cf9d7cdb1933d90b12b2b3dcd36c56c882ab41e6cfaf0` |
| npm payload | 99 files, 447.4 KiB compressed, about 1.5 MiB unpacked |
| Production TypeScript | 26,055 lines for the whole upstream Package |
| Test TypeScript | 26,721 lines across 48 test files |
| Runtime dependencies | `turndown@7.2.4` and a commit-pinned `@ravshansbox/pi-anthropic-sps` archive; both belong to unrelated Fusion and must disappear from the local Capability |
| Pi peers | `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` compatible with `^0.83.0`; `typebox: *` |
| Fixed-window downloads | 2,263 |

The npm record does not publish a `gitHead`. To close that provenance gap, every file in the 2.0.0 npm payload was compared with the recorded commit; all published files matched byte for byte. The commit contains only additional repository material such as tests, scripts, CI files, and lockfiles.

Primary identity sources: exact [npm version record](https://registry.npmjs.org/pi-background-tasks/2.0.0), [source revision](https://github.com/ismailsaleekh/pi-background-tasks/tree/db632653682c00852a38c0972a761fb1e9f24dc3), [manifest](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/package.json), and [ISC license](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/LICENSE).

## Why this runtime wins

The selected source already implements the most failure-prone part of the Capability in one registry:

- child processes run in detached POSIX process groups;
- stop first signals the whole group with `SIGTERM`, falls back to the child handle only if group signaling fails, then schedules exactly one `SIGKILL` after a grace period;
- the caller waits for terminal settlement and reports a loud failure if the process does not exit;
- simultaneous error, close, output-cap, and stop races finalize once;
- Pi shutdown awaits all running-task stops rather than merely emitting signals;
- child output is capped at 20 MiB by default, and model-visible reads are capped at 50 KiB;
- completion metadata, waiters, bounded recent retention, and notification state are owned by the same runtime;
- runtime files are isolated under `.pi/tasks/<session-id>-<pid>/` instead of sharing one global log namespace.

The relevant upstream implementation is the exact [`BackgroundTaskRegistry`](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/src/core/registry.ts), with its [runtime contract](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/docs/subsystems/background-task-runtime.md) and [termination tests](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/tests/unit/registry.test.ts).

Local verification against the exact source produced:

- Bun **1.3.14** installation and strict TypeScript checking: pass;
- exact upstream registry test file: **30/30 pass**;
- real certified Pi **0.83.0** RPC Package load: pass, no `extension_error`;
- real POSIX process probe using the unmodified registry: a TERM-ignoring group leader plus child was escalated and both PIDs and the process group were gone; terminal status was `killed`.

These checks establish a credible base, not completion of the Pi Stuff contract.

## Why Patty is not the base

[`pi-patty-bg-tasks@1.1.6`](https://registry.npmjs.org/pi-patty-bg-tasks/1.1.6) is smaller: 4,209 production TypeScript lines, 2,662 test lines in 18 files, no runtime dependencies, and a 35-file npm payload. Its exact published archive matched commit [`6676db5…`](https://github.com/patty-io/pi-patty-bg-tasks/tree/6676db5b30caafea0431d29400ccfbffa51aa9e9) byte for byte.

It has useful behavior to reproduce independently:

- an owned Bash execution path that can become background work;
- immediate background launch and foreground detachment;
- a Monitor source/session seam;
- compact job controls and completion records.

Its core, however, fails the accepted safety bar:

- [`killProcessTree`](https://github.com/patty-io/pi-patty-bg-tasks/blob/6676db5b30caafea0431d29400ccfbffa51aa9e9/src/spawn.ts) sends one signal and swallows failure; it has no grace window, SIGKILL escalation, or proof that descendants ended;
- liveness and signaling use a bare PID, with no process-start identity or PID-reuse defense;
- shutdown emits best-effort termination instead of awaiting complete tree settlement;
- logs share `/tmp/pi-bg`, and a persistent Monitor explicitly disables the output-size cap;
- its permanent sidebar/status output and Package-owned task panel contradict Pi Stuff's UI authority.

Adopting Patty would preserve more visible behavior but require replacing the deep runtime. That is the wrong ownership trade: Pi Stuff can implement Ctrl+B and Monitor over a safe kernel more reliably than it can retrofit process correctness under Patty's existing lifecycle.

The unreleased Patty `2.0.0` commit was also inspected and does not reverse the decision. It targets Pi 0.83 and improves in-memory lifecycle structure, but still has bare-PID signaling and SIGTERM-only cleanup. Its “background all” shortcut also conflicts with the accepted “only the active foreground Bash call” rule.

## Why the @ifi candidate is not stronger overall

[`@ifi/pi-background-tasks@0.5.1`](https://registry.npmjs.org/@ifi/pi-background-tasks/0.5.1) is the strongest additional candidate for output-triggered wakeups: it accepts a substring or regular-expression matcher and maintains a bounded in-memory output tail. Its exact release source is [`e9c9d96…`](https://github.com/ifiokjr/oh-pi/tree/e9c9d96e75fd4d2b1748f81d0788f29cc8013ec8/packages/background-tasks).

It does not qualify as a runtime base. Spawn is not detached into an owned process group; stop and shutdown call `process.kill(pid, "SIGTERM")` once, do not escalate, do not await exit, and can leave descendants alive. Log files grow without a file-size cap, write failures are ignored, the dashboard is an explicit centered overlay, and the published manifest still imports the pre-Earendil `@mariozechner/pi-*` package identities. Its matcher is worth understanding, but not worth inheriting its lifecycle.

## Required local fork delta

The fork is acceptable only if its first local change makes the ownership boundary explicit.

### Retain and deepen

- Retain the session-scoped registry, detached process-group launch, bounded output/read, idempotent terminal state, TERM-to-KILL escalation, awaited shutdown, and focused process tests.
- Preserve the exact ISC notice and add `UPSTREAM.md` with Package version, commit, archive integrity, archive SHA-256, retained paths, deleted paths, and local changes.
- Keep one small Runtime interface for start, detach, inspect, stop, subscribe, and shutdown; process mechanics remain private.

### Delete before shipping

- Delete Fusion, delegation, attested Pi runners, agent telemetry, unrelated commands, and their two runtime dependencies.
- Delete the update checker and every network call from import/startup.
- Delete the upstream footer, dock, statusline, update notice, and Package-specific settings.
- Do not retain upstream Agent functionality; `/agents` remains authoritative.

### Add or replace

1. **PID identity:** record the leader's immutable start identity in addition to PID and process-group ID; validate it before every signal so a reused PID is never targeted.
2. **Crash cleanup:** prove abrupt Pi death cannot leave the owned tree alive. Graceful `session_shutdown` alone is insufficient.
3. **Lazy runtime directory:** upstream creates `.pi/tasks/...` during `session_start`. Pi Stuff must create it only on the first user-triggered Background or Monitor action so startup stays pure.
4. **Foreground detachment:** integrate with Pi Stuff's Bash execution so Ctrl+B detaches exactly one active foreground Bash call. Do not background every command and do not claim Ctrl+B when no eligible Bash call exists.
5. **Monitor:** build command, log, file, and HTTP conditions on the same runtime. A Monitor has one concrete success/error predicate, one deadline, bounded evidence, cancellation, and exactly one outcome.
6. **`/tasks`:** use the shared full-width non-floating Command Dialog with list and in-place detail. Include only
   Background Shell and Monitor; keep Todo, Goal, Beads, Agents, and Tool invocation history out.
7. **Transcript outcomes:** deliver compact, deduplicated completion/failure/stop records without a forced acknowledgement turn, task statusline, or permanent task row.
8. **Failure gates:** test spawn failure, output failure/cap, timeout, TERM-ignoring trees, forked grandchildren, PID reuse, simultaneous stop/finalize, reload, abrupt Pi death, narrow TUI, resize, and cleanup failure.

## Final selection statement

Pi Stuff will fork **`pi-background-tasks@2.0.0` at `db632653682c00852a38c0972a761fb1e9f24dc3` under the ISC license** as the Background work runtime base.

The selection is based on process correctness, not breadth, download count, or similarity to Claude Code. `pi-patty-bg-tasks@1.1.6` remains a behavioral reference for foreground detachment and Monitor ergonomics; none of its source should be mixed into the selected fork. `@ifi/pi-background-tasks@0.5.1` is rejected as a code base.

The fork is not complete until the unrelated upstream product is removed and Pi Stuff proves PID identity, abrupt-crash cleanup, active-only Ctrl+B, one-shot Monitor, and shared `/tasks` behavior in the real Pi 0.83 TUI.
