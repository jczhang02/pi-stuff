# Pi Stuff RTK

The RTK module rewrites supported Bash commands through one certified local `rtk` executable and projects compact Bash and Grep results only into model-visible context.

The Host transcript, Tool display, and session JSONL keep their original Tool result content. `read` output and source code are exact by default and are not handled by this Capability.

## Behavior

- `/rtk` opens one shared full-width Command Dialog containing runtime identity, two Pi-native behavior controls, and
  Session savings. It does not verify the executable merely because the Dialog opened.
- **Command rewriting** and **Model projection** show both their configured value and effective state. Model projection
  remains independent of Runtime availability.
- Startup performs no subprocess, file write, hook installation, notice, floating UI, or Statusline mutation.
- The first Bash call verifies RTK `0.45.0`, its executable path, and the certified official Linux x64 SHA-256 before
  rewriting.
- Missing, slow, replaced, or otherwise drifting RTK executables leave the original Bash command unchanged.
- Projection uses Pi's `context` event. It never returns a `tool_result` patch and never edits stored messages.
- Failed Tool results, non-text blocks, Reads, and unknown tools remain exact.

## Commands

```text
/rtk                 Inspect and configure RTK
```

RTK has no subcommands or aliases. Any non-empty argument reports
`/rtk takes no subcommands; run /rtk.` and does not open another surface.

The local RTK executable is optional. When it is absent or fails certification, Pi continues normally without command rewriting. Model-only output projection remains available because it does not require the executable.

## `/rtk` interaction contract

The Dialog answers three questions in one place: whether the executable is trusted, what behavior is configured and
effective, and how much eligible model-visible result text this Session avoided:

```text
RTK

Runtime
○ unchecked
Not verified yet.

Behavior
→ Command rewriting  configured on · effective unchecked
  Model projection    configured on · effective active

Session savings
No eligible result projected yet.

↑/↓ select · Enter/Space toggle · v verify · c clear savings
? keys · Esc close
```

Use `✓ ready`, `○ unchecked`, `! drifted`, and `× unavailable`, always with the state word. `Drifted` means the selected
executable identity changed after certification; it is a warning and rewriting remains disabled until the user presses
`v` to verify again. `Unavailable` includes a bounded `Error` section and must not imply that Pi itself cannot continue.

Pi's configured Up/Down actions select a behavior. Enter or Space toggles it and is the only path that persists the
corresponding setting. The Command rewriting description says that rewriting occurs only when the certified Runtime is
ready. The Model projection description says that it projects eligible Tool results into model context independently
of Runtime availability; the transcript, Tool result, and Session JSONL remain exact.

Session savings are derived statistics, not a billing or token claim. Show saved characters, percentage of eligible
original result characters, and result count. Before any eligible projection, show exactly
`No eligible result projected yet.` Pressing `c` resets only the in-memory Session statistics and reports
`Session savings cleared.` Technique counts, Binary, and SHA are secondary; low-height rendering removes them first and
retains Runtime state, both configured/effective behavior rows, the savings outcome, and the Escape path. `?` opens the
complete key guide, and only the configured cancel action closes the Dialog.

## Certified RTK runtime

The Linux x64 runtime is pinned to the official [`rtk-ai/rtk` v0.45.0](https://github.com/rtk-ai/rtk/releases/tag/v0.45.0),
source commit `b34be37caf3796b69a50952a28e60e32b5daad43`. Only the released binary below is accepted:

| Build | SHA-256 |
| --- | --- |
| Official `rtk-x86_64-unknown-linux-musl.tar.gz` archive | `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4` |
| Official archive's `rtk` binary | `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |

Every rewrite rechecks the selected path, resolved path, file fingerprint, and actual binary SHA. Any identity change
disables rewriting until `v` in `/rtk` explicitly re-certifies it.

RTK v0.45.0 preserves supported `rg` syntax, including `--files`, globs, and ordinary line-number searches. Its
official `find` wrapper still rejects compound predicates and actions such as `-not` and `-exec`; pipelines such as
`find ... -print0 | xargs ...` are left native. This is an external RTK constraint. Pi Stuff does not parse or repair
commands; disable Command rewriting in `/rtk` when an unsupported `find` form is required, then remove that
workaround after a later official RTK release is certified.

## Context composition

`createRtkProjectionAdapter()` exposes the small `ContextProjectionAdapter` seam used by the future Context Capability. Calling `project(messages)` returns the original array on disablement or failure and a copy-on-write projection on success. The adapter is idempotent within a composed Pi context pass.

The implementation derives from [`MasuRii/pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer). See [UPSTREAM.md](./UPSTREAM.md) for exact source, archive, license, integrity, and local-delta records.
