# Pi Stuff RTK

The RTK module rewrites supported Bash commands through one certified local `rtk` executable and projects compact Bash and Grep results only into model-visible context.

The Host transcript, Tool display, and session JSONL keep their original Tool result content. `read` output and source code are exact by default and are not handled by this Capability.

## Behavior

- `/rtk` opens the shared full-width Pi Stuff Command Dialog with runtime identity and session savings.
- `/rtk settings` opens Pi's native settings component for the two persistent behavior switches: **Command rewriting**
  and **Model projection**.
- Startup performs no subprocess, file write, hook installation, notice, floating UI, or Statusline mutation.
- The first Bash call verifies RTK `0.42.4`, its executable path, and one certified Linux x64 SHA-256 before rewriting.
- Missing, slow, replaced, or otherwise drifting RTK executables leave the original Bash command unchanged.
- Projection uses Pi's `context` event. It never returns a `tool_result` patch and never edits stored messages.
- Failed Tool results, non-text blocks, Reads, and unknown tools remain exact.

## Commands

```text
/rtk                 Verify and inspect RTK
/rtk status          Verify and inspect RTK
/rtk settings        Configure RTK behavior
/rtk verify          Re-certify the current executable explicitly
/rtk stats           Inspect this session's projection savings
/rtk clear-stats     Clear in-memory projection statistics
/rtk help            Show the bounded command summary
```

The local RTK executable is optional. When it is absent or fails certification, Pi continues normally without command rewriting. Model-only output projection remains available because it does not require the executable.

## Accepted `/rtk` readability target

**Decision update:** 2026-08-17
**Status:** Implemented on 2026-08-18.

The non-settings `/rtk` surface remains one static inspection Dialog. It does not add list/detail modes or duplicate
the native `/rtk settings` component. Its three questions are whether the executable is trusted, which behaviors are
enabled, and how much model-visible result text this session avoided:

```text
RTK
✓ ready · v0.42.4

◆ Runtime
Binary  ~/.local/bin/rtk
SHA-256  1d8bf5f1861f5ce3…

◆ Behavior
✓ Command rewriting on
✓ Model projection on

◆ Session savings
12,430 chars (38%) · 24 results
Bash 12 · Grep 12

/rtk settings · Esc close
```

Use `✓ ready`, `○ unchecked`, `! drifted`, and `× unavailable`, always with the state word. `Drifted` means the selected
executable identity changed after certification; it is a warning and rewriting remains disabled until explicit
`/rtk verify`. `Unavailable` includes a bounded error under a marked `Error` section and the next step
`Run /rtk verify`; it must not imply that Pi itself cannot continue.

Behavior switches use `✓ on` and `○ off` rather than color-only words. `Model projection` means only the compact copy
sent to the model; the transcript, Tool result, and Session JSONL remain exact. Keep this distinction in the visible
description or section copy and never imply that RTK rewrites stored output.

Session savings are derived statistics, not a billing or token claim. Show saved characters, percentage of eligible
original result characters, and result count. Technique counts are secondary and disappear before runtime state,
error, switch values, or the total savings line at low height. Binary path and shortened SHA are verification evidence;
they disappear after an actionable error but before core state and savings when space is scarce.

`/rtk clear-stats` reports `✓ Projection statistics cleared.` `/rtk help` shows the bounded command form, and an unknown
action uses `! Unknown action` followed by that same form. Feedback never replaces the runtime state or Escape path.
Enter and `q` may retain their current close behavior without Footer space; Escape remains the advertised close key.

The implementation now pairs states and switches with fixed icons, uses `◆` sections, explains model-only projection,
keeps feedback structured, and shortens the Footer. Focused tests cover runtime states, settings ownership, projection
wording, low-height fitting, and failure behavior; the real PTY verifier covers Host rendering.

## Certified RTK runtime

The Linux x64 runtime is pinned to [`rtk-ai/rtk` v0.42.4](https://github.com/rtk-ai/rtk/releases/tag/v0.42.4), source commit `8a7dd7e5570d7744d4b6508479a3674fe8c49286`. Two immutable builds of that exact source are accepted:

| Build | SHA-256 |
| --- | --- |
| Official `rtk-x86_64-unknown-linux-musl.tar.gz` archive | `34975116da11e09e502501daf758143e0b22ed3a42a10eb67fb693a6270d9e36` |
| Official archive's `rtk` binary | `1d8bf5f1861f5ce33236400b1d93b967aec30b6a456e9a0b43b1584c5200119a` |
| Certified local source build used by the maintainer | `5a5b40cd6807cec980af2e3caa2cdff1fc17d101befb287d9c207a1bfbc9d250` |

Every rewrite rechecks the selected path, resolved path, file fingerprint, and actual binary SHA. A switch between accepted binaries still counts as identity drift until `/rtk verify` explicitly re-certifies it.

## Context composition

`createRtkProjectionAdapter()` exposes the small `ContextProjectionAdapter` seam used by the future Context Capability. Calling `project(messages)` returns the original array on disablement or failure and a copy-on-write projection on success. The adapter is idempotent within a composed Pi context pass.

The implementation derives from [`MasuRii/pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer). See [UPSTREAM.md](./UPSTREAM.md) for exact source, archive, license, integrity, and local-delta records.
