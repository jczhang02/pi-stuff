# Pi Stuff RTK

`@jczhang02/pi-stuff-rtk` is the RTK Capability for the Pi Stuff Suite. It rewrites supported Bash commands through one certified local `rtk` executable and projects compact Bash and Grep results only into model-visible context.

The Host transcript, Tool display, and session JSONL keep their original Tool result content. `read` output and source code are exact by default and are not handled by this Capability.

## Behavior

- `/rtk` opens the shared full-width Pi Stuff Command Dialog with runtime identity and session savings.
- `/ui` owns the two persistent switches: **RTK command rewriting** and **RTK output projection**.
- Startup performs no subprocess, file write, hook installation, notice, floating UI, or Statusline mutation.
- The first Bash call verifies RTK `0.42.4`, its executable path, and the certified Linux x64 SHA-256 before rewriting.
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

## Context composition

`createRtkProjectionAdapter()` exposes the small `ContextProjectionAdapter` seam used by the future Context Capability. Calling `project(messages)` returns the original array on disablement or failure and a copy-on-write projection on success. The adapter is idempotent within a composed Pi context pass.

This Package is an owned fork based on [`MasuRii/pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer). See [UPSTREAM.md](./UPSTREAM.md) for exact source, archive, license, integrity, and local-delta records.
