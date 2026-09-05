# Agents

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/subagents/README.md)

Bounded delegation to named child Agents, with background-by-default execution and one lifecycle view.

<p align="center">
  <a href="../../../../docs/assets/readme/capabilities/subagents.png">
    <img src="../../../../docs/assets/readme/capabilities/subagents.png" alt="Delegated Agents dialog in Pi" width="100%">
  </a>
  <br>
  <em>The Agents dialog keeps delegated work scoped to the current Session.</em>
</p>

## Quick start

Use the `subagent` Tool:

```json
{
  "agent": "general-purpose",
  "description": "Inspect parser",
  "task": "Find the parser boundary and report exact source evidence."
}
```

Continue independent work after launch. Open `/agents` to inspect, steer, stop, resume, or review retained results.

## Highlights

- Discovers fixed, settings-scanned, symlinked, and Package Agent definitions with explicit precedence.
- Supports per-Agent Tool allowlists and exclusions without changing the parent Host.
- Supports one Agent, parallel grouped tasks, and status or lifecycle control calls; `agent` selects a launch
  definition, while `id` identifies an existing Agent Target.
- Runs in the background by default; foreground mode waits for the result.
- Delivers compact completion without starting an unsolicited main Agent turn; retained results preserve acceptance-report
  precedence over later plain assistant text.
- Keeps concurrency and nesting bounds while productive work has no cumulative-launch, default run-time, or implicit Tool timeout.
- Aggregates attempts and resumes in one durable usage total; later automatic expansion pauses at the documented cost
  guard without stopping an in-flight child.
- Returns stable abnormal-outcome classes, bounded partial evidence, and a resumable Agent Target when continuation is
  supported.
- Quarantines unowned versionless legacy runs instead of leaving them indefinitely active or reclaiming an unknown
  process.
- Keeps Session-owned artifacts and preserves changed isolated worktrees for inspection.

## Launch preparation

Planning validates Skills, model candidates, Tool budgets and timeouts, and capability/MCP constraints without creating
execution or recovery records or hashing Agent definitions and task bodies. Final construction resolves the launch
inputs and creates their digests, model metadata, and recovery record once. Planning projections are not cached across
launches or reused as finalized child contracts.

New launches and existing-target controls have separate loading boundaries. A launch loads its selected execution
engine on first use; foreground execution does not load detached-runner launch machinery. Isolated-worktree operations
load only when requested. Session fallback snapshot operations load only when a task has an inherited Session file
and at least two model candidates. Required recovery records, writer ownership, and initial status are still committed
before child execution; fallback snapshots still freeze the Session before the first model attempt.

Current Session governor transactions use asynchronous stable-inode kernel claims. Acquiring a claim does not rewrite
or flush diagnostic owner records; mutual exclusion and process-death release remain kernel-owned. Canonical ledger
commits and legacy lock handling are unchanged.

## Documentation

- [Agents guide](../../../../docs/capabilities/subagents.md)
- [Command reference](../../../../docs/reference/commands.md#work-control)
- [Background Work guide](../../../../docs/capabilities/background-work.md)
- [Tool Display guide](../../../../docs/capabilities/tool-display.md)
- [Upstream references](UPSTREAM.md)
