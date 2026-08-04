# Pi Stuff RTK

`@jczhang02/pi-stuff-rtk` is the RTK Capability for the Pi Stuff Suite. It rewrites supported Bash commands through one certified local `rtk` executable and projects compact Bash and Grep results only into model-visible context.

The Host transcript, Tool display, and session JSONL keep their original Tool result content. `read` output and source code are exact by default and are not handled by this Capability.

## Behavior

- `/rtk` opens the shared full-width Pi Stuff Command Dialog with runtime identity and session savings.
- `/ui` owns the two persistent switches: **RTK command rewriting** and **RTK output projection**.
- Startup performs no subprocess, file write, hook installation, notice, floating UI, or Statusline mutation.
- The first Bash call verifies RTK `0.42.4`, its executable path, and one certified Linux x64 SHA-256 before rewriting.
- Missing, slow, replaced, or otherwise drifting RTK executables leave the original Bash command unchanged.
- Projection uses Pi's `context` event. It never returns a `tool_result` patch and never edits stored messages.
- Failed Tool results, non-text blocks, Reads, and unknown tools remain exact.

## Commands

```text
/rtk                 Verify and inspect RTK
/rtk status          Verify and inspect RTK
/rtk verify          Re-certify the current executable explicitly
/rtk stats           Inspect this session's projection savings
/rtk clear-stats     Clear in-memory projection statistics
/rtk help            Show the bounded command summary
```

The local RTK executable is optional. When it is absent or fails certification, Pi continues normally without command rewriting. Model-only output projection remains available because it does not require the executable.

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

This Package is an owned fork based on [`MasuRii/pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer). See [UPSTREAM.md](./UPSTREAM.md) for exact source, archive, license, integrity, and local-delta records.
