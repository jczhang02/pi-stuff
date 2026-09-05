# Context Management

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/context-management/README.md)

Context projection, retrieval, memory, notes, compaction, and pressure handling for Pi Sessions.

<p align="center">
  <a href="../../../../docs/assets/readme/capabilities/context-management.png">
    <img src="../../../../docs/assets/readme/capabilities/context-management.png" alt="Context status and maintenance actions in Pi" width="100%">
  </a>
  <br>
  <em>Context status and maintenance actions stay visible in one focused dialog.</em>
</p>

## Quick start

```text
/ctx
```

The dialog shows Context usage, compartments, memory, notes, pending maintenance, Historian state, cache, history
tokens, current errors, and whether native-compaction fallback is available.

## Highlights

- Activates recognized configuration before the editor becomes ready.
- Keeps first-use configuration and migration behind direct interactive authority.
- Exposes status and maintenance through `/ctx` and persistent Context Activity.
- Runs the Context engine in a Worker without transferring Pi's input, Agent-turn, or Session lifecycle ownership.
- Sends only the pinned engine's required Tool-event fields across the Worker boundary.
- Projects derived context while Pi Session JSONL remains the raw record.
- Uses Pi's native context and compaction only during startup or degraded operation when the engine is unavailable, and reports degraded continuity when that fallback is disabled.

## Documentation

- [Context Management guide](../../../../docs/capabilities/context-management.md)
- [Command reference](../../../../docs/reference/commands.md#context)
- [Troubleshooting](../../../../docs/troubleshooting.md#context)
- [Architecture](../../../../docs/architecture.md#lifecycle-ownership)
