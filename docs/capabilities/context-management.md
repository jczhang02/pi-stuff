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
state, cache, history tokens, current errors, and degraded continuity when Pi's native-compaction fallback is disabled.

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
only the new leaf. Startup and degraded-engine paths may fall back to Pi's native context; an active Host-managed
foreground `before_provider_request` fails closed unless the final JSON-serialized Provider payload has a finite token
estimate no greater than 95% of the model Context window. Missing window, serialization, measurement, nonfinite, and
over-bound cases locally abort with an error and unknown estimate. Direct calls bypassing that hook are excluded.

Only a prior Provider-boundary-validated result may be reused when every ordered raw message object and Provider, model
id, and Context window are identical; changed inputs rerun validation. Pi owns existing retry, continuation, and
compaction behavior, with no new budgets. Normal status reports the validated percentage, recovery reports `recovering`,
and failure reports `unknown` with local abort; successful assistant or Session lifecycle clears recovery state.

Prompt contributions follow a stable order: Host context, Context Management, then other registered capability
contributions. Direct-mode guidance is bounded to 8,000 characters.

## Compaction

Pi owns native compaction and its configured threshold. Context Management does not start a second native compaction
for the same foreground lifecycle.

For an idle custom turn that bypasses the ordinary preflight, Context Management can invoke Pi's public compaction
method when native compaction is enabled and its threshold is exceeded. Extreme overflow yields to native compaction
and temporarily degrades active Context to the native projection. If Magic Context is active while Pi native
auto-compaction is disabled, `/ctx` keeps Magic active but reports degraded continuity and directs the user to enable
auto-compaction through `/settings`; Pi Stuff does not change the setting itself.

## Worker and recovery

The Context engine runs in one internal Worker so retrieval and compaction work do not block terminal painting. The
Worker is an execution boundary, not a lifecycle owner: after Pi accepts a prompt, interrupting its Agent turn does not
cancel the engine's lifecycle events or rebuild a healthy Worker. The input callback does not await deferred activation,
and Agent interruption cannot make the next accepted prompt wait for a spurious recovery. Tool and augmentation
cancellation remain owned by their invocations.

Fatal Worker failure switches immediately to the native projection. Recovery belongs to the current Session rather
than the interrupted Agent turn. Shutdown joins pending worker work within a bounded grace period.

## Configuration

Context engine and worker selection are external configuration. Pi Stuff does not define provider-specific fields in
`pi-stuff.json`. After changing the external configuration, restart Pi and inspect `/ctx` and `/diagnostics`.

## See also

- [Context Management Module README](../../packages/pi-stuff/src/context-management/README.md)
- [Command reference](../reference/commands.md#context)
- [Troubleshooting](../troubleshooting.md#context)
- [Architecture](../architecture.md#lifecycle-ownership)
