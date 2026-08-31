# Context Management

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/context-management/README.md)

Context projection, retrieval, memory, notes, compaction, and pressure handling for Pi Sessions.

## Quick start

```text
/ctx
```

The dialog shows Context usage, compartments, memory, notes, pending maintenance, Historian state, cache, history
tokens, and current errors.

## Highlights

- Activates recognized configuration before the editor becomes ready.
- Keeps first-use configuration and migration behind direct interactive authority.
- Exposes status and maintenance through `/ctx` and persistent Context Activity.
- Runs the Context engine in a Worker to keep terminal painting responsive.
- Projects derived context while Pi Session JSONL remains the raw record.
- Falls back to Pi's native context and compaction when the engine is unavailable.

## Documentation

- [Context Management guide](../../../../docs/capabilities/context-management.md)
- [Command reference](../../../../docs/reference/commands.md#context)
- [Troubleshooting](../../../../docs/troubleshooting.md#context)
- [Architecture](../../../../docs/architecture.md#lifecycle-ownership)

