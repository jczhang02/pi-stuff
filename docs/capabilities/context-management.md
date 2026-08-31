# Context Management

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/context-management.md)

Context Management adds retrieval, memory, notes, compaction, and pressure handling to Pi while keeping the Host's
conversation and Session surfaces intact.

## Quick start

Open the Context status dialog:

```text
/ctx
```

Configured Context becomes active during Session startup. Without configuration, `/ctx` shows the available first-use
path when direct interactive input can authorize it.

## Command surface

| Command | Action |
| --- | --- |
| `/ctx` or `/ctx status` | Open status and available actions |
| `/ctx flush` | Apply queued drops with the next message |
| `/ctx wrapup [N]` | Compact older history, keeping 20 messages by default |
| `/ctx recomp [start-end]` | Rebuild compartments for all or part of history |
| `/ctx upgrade` | Upgrade supported legacy Session history and memories |

The status dialog reports Context usage, active and dropped tags, compartments, memory, notes, pending work, Historian
state, cache, history tokens, and current errors.

Maintenance persists as model-invisible Context Activity. `recomp` and `upgrade` continue in the background; switching
or forking a Session detaches the visible update without cancelling the operation.

## Context Tools

When the configured engine exposes them, these deferred Tools become available:

- `ctx_search` for retrieval;
- `ctx_expand` for expanding compacted context;
- `ctx_memory` for memory access;
- `ctx_note` for notes;
- `ctx_reduce` for explicit reduction.

The engine also retains history, memory, note, and Historian behavior used by its projection. Pi Stuff owns the `/ctx`
surface and suppresses duplicate upstream status, dialog, announcement, and Todo UI.

## Startup and first use

Recognized, migration-free configuration activates before the editor becomes ready. Missing or legacy configuration
stays dormant during startup.

The first direct user input, `/ctx` command, or explicit Context projection may authorize configuration creation or a
supported migration. Extension-authored automatic turns cannot create or migrate user configuration.

## Projection

Pi's Session JSONL remains the raw conversation record. Context Management builds a derived projection for model
requests and invalidates it when input, compaction, or tree navigation changes the active branch.

The first bind or a branch discontinuity sends a full Session snapshot to the Context worker. Ordinary projection sends
only the new leaf. If the derived store or worker is unavailable, the current request falls back to Pi's native context.

Prompt contributions follow a stable order: Host context, Context Management, then other registered capability
contributions. Direct-mode guidance is bounded to 8,000 characters.

## Compaction

Pi owns native compaction and its configured threshold. Context Management does not start a second native compaction
for the same foreground lifecycle.

For an idle custom turn that bypasses the ordinary preflight, Context Management can invoke Pi's public compaction
method when native compaction is enabled and its threshold is exceeded. Extreme overflow yields to native compaction
and temporarily degrades active Context to the native projection.

## Worker and recovery

The Context engine runs in one internal Worker so retrieval and compaction work do not block terminal painting.
Fatal Worker failure switches immediately to the native projection. Shutdown joins pending worker work within a bounded
grace period.

## Configuration

Context engine and worker selection are external configuration. Pi Stuff does not define provider-specific fields in
`pi-stuff.json`. After changing the external configuration, restart Pi and inspect `/ctx` and `/diagnostics`.

## See also

- [Context Management Module README](../../packages/pi-stuff/src/context-management/README.md)
- [Command reference](../reference/commands.md#context)
- [Troubleshooting](../troubleshooting.md#context)
- [Architecture](../architecture.md#lifecycle-ownership)

