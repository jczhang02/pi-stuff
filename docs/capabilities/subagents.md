# Agents

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/subagents.md)

Agents delegates bounded work to named child Agents and keeps their lifecycle available through one Tool and the
`/agents` dialog.

## Prerequisites

Agent definitions are discovered from:

1. the current project's `.pi/agents` directory;
2. the user's Pi `agents` directory;
3. installed Pi Packages.

When names collide, project definitions take precedence over user definitions, which take precedence over Package
definitions. The `subagent` Tool description lists the effective roster and each Agent's purpose before a main run.
Agent frontmatter may declare `tools` and `excludeTools`; exclusions always win for that child.

## Quick start

Launch one Agent in the background:

```json
{
  "agent": "general-purpose",
  "description": "Inspect parser",
  "task": "Find the parser boundary and report exact source evidence."
}
```

Background is the default. Continue independent work after launch; completion is delivered automatically. Set
`"foreground": true` only when the result is required before the current Tool call can return.

## Tool shapes

Each `subagent` call uses exactly one shape.

### One Agent

`agent` and `task` are required. Optional fields select a short `description`, working directory, model, Skill,
an explicit Tool budget or per-Tool timeout, context mode, isolation, and foreground execution.

### Parallel Agents

```json
{
  "tasks": [
    {
      "agent": "general-purpose",
      "description": "Inspect API",
      "task": "Report the public API with source references."
    },
    {
      "agent": "reviewer",
      "description": "Check behavior",
      "task": "Independently verify the documented behavior."
    }
  ]
}
```

Grouped tasks run concurrently within the current capacity. Independent native `subagent` Tool calls emitted in one
Assistant response can also run concurrently.

### Control

```json
{ "action": "status" }
{ "action": "steer", "id": "agent-id", "message": "Check the fallback path too." }
{ "action": "stop", "id": "agent-id" }
{ "action": "resume", "id": "agent-id" }
```

`status` may omit `id` for a one-shot overview. `steer`, `stop`, and `resume` require `id`; grouped runs can also select
a child by `index`. Use `/agents` for regular inspection and control.

## Background and foreground

Background launches return after admission and start. A terminal outcome creates a compact durable TUI result and does
not start an unsolicited main Agent turn. Full reports remain available in `/agents`.

Foreground launches block until the result is ready and return it to the current Tool call. Nested fanout remains
owned by the launching child and cannot detach beyond that owner.

## `/agents`

`/agents` shows current-Session Agent lifecycle, retained outcomes, Result, Activity, and bounded child transcript.

| Key | Action |
| --- | --- |
| Up / Down | Select an Agent |
| Enter | Open details |
| `x` | Stop a live Agent or dismiss a terminal entry |
| `t` | Expand eligible Tool output in details |
| Escape | Return or close |

The footer roster is the compact lifecycle view. Opening Agent management replaces the latest-prompt row so one surface
owns control at a time.

## Context, models, and Tools

A launch can request fresh or forked context, an explicit model, one Skill, and an explicit Tool budget. Capacity,
authentication, and model availability are checked before child execution. Ordinary delegated work has no fixed turn
cutoff, so a productive Agent is not terminated merely because it has continued working.

`toolTimeoutMs` sets a hard timeout for each non-waiting Tool call. A task-level value overrides the launch value,
which overrides Agent frontmatter and `PI_SUBAGENT_TOOL_TIMEOUT_MS`. Known-fast built-in Tools use a five-minute
default; supervisor and intercom Tools that legitimately wait remain exempt.

`excludeTools` subtracts names from ambient, explicit, MCP, and Suite-injected child Tools. Excluding `subagent`
disables nested fanout for that Agent. Excluding `read` is rejected when the Agent needs it for lazy Skill loading.

Each child uses the same Pi Host binary with the owning Package loaded and ambient discovery disabled. Non-fanout
children do not receive the `subagent` Tool.

## Limits

Default governor limits are:

- 20 concurrently running Agents;
- 200 total launches per parent Session;
- nesting depth 3;
- 30 minutes per run.

Ordinary launches have no turn or Tool-call budget. An explicit `toolBudget` can limit Tool calls, `toolTimeoutMs` can
bound one Tool call, and `timeoutMs` can tighten the default run deadline.

## Artifacts and isolation

Agent artifacts live beside the persisted Pi Session under the Settings-owned Session root. Ordinary delegation does
not create a project `.pi-subagents` directory.

Optional per-Agent worktree isolation keeps changed or uncertain worktrees for inspection. Only clean owned worktrees
may be removed automatically.

Changing or ending the parent Session cancels an in-flight launch safely and records its terminal state.

## See also

- [Agents Module README](../../packages/pi-stuff/src/subagents/README.md)
- [Command reference](../reference/commands.md#work-control)
- [Background Work](background-work.md)
- [Tool Display](tool-display.md)
