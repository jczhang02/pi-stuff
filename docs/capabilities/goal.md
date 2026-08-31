# Goal

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/goal.md)

Goal keeps one substantial objective active across Agent turns until the work is complete, paused, cleared, or proven
blocked.

## Quick start

```text
/goal implement and verify the requested change
/goal status
```

Goal adds the objective and completion contract to subsequent Agent turns. Use `/goal pause` when you want to stop
automatic continuation and `/goal resume` when work can continue.

## Lifecycle

An active Goal continues after Pi settles until one of these outcomes:

- the Agent calls `goal_complete` with evidence for every requirement;
- the user pauses or clears the Goal;
- an explicit token budget is exhausted;
- the provider reports an authentication or usage limit;
- the same external blocker passes the three-turn blocker audit.

Ordinary uncertainty, incomplete work, a plan, or a suggested next step is not a terminal outcome.

## Commands

| Command | Action |
| --- | --- |
| `/goal [--tokens 100k] <objective>` | Start or replace the current Goal |
| `/goal` | Open Goal settings |
| `/goal status` | Show current objective, status, budget, and queue |
| `/goal edit [--tokens 100k] <objective>` | Change the active objective or budget |
| `/goal pause` | Pause automatic continuation |
| `/goal resume` | Resume a paused, limited, or interrupted Goal |
| `/goal clear` or `/goal stop` | Clear current Goal state |

Token budgets accept plain integers and `k` or `m` suffixes. An objective is limited to 4,000 characters.

## Completion and blockers

`goal_complete` is available to the Agent while Goal work is active. It requires the exact current `goal_id`, a
substantive summary, and one concrete proof entry for each requirement.

`goal_blocked` records a true impasse. The runtime stops the Goal only after the same blocker is reported on three
consecutive Goal turns with a distinct attempted action and observed failure each time. The first two reports record
progress and continuation proceeds.

This terminal protocol prevents a short answer, repeated claim, or stale Tool call from ending the wrong Goal.

## Continuation and limits

Automatic continuation and no-progress limits are `null` by default: continuation is unlimited and the optional
no-progress guard is off. A non-configurable 10,000-response emergency backstop remains active.

You can set positive limits in the Goal settings dialog:

- **Automatic turns** pauses after the configured number of automatic model responses.
- **No-progress turns** pauses after the configured number of consecutive turns without accepted progress.

Paused and limited Goals remain resumable. A provider usage or authentication stop keeps the Goal for `/goal resume`
after access returns.

## Statusline and Tools

The shared Statusline shows Goal only while current Goal state needs a persistent indicator. It includes status, token
usage and budget when present, and active elapsed time.

`toolVisibility` controls when `goal_complete` and `goal_blocked` appear:

- `always` exposes them from Session startup;
- `after-first-goal` exposes them after the Session first activates Goal work.

## Persistence and compaction

Goal state is stored in the current Session and restored on reload, resume, and branch navigation. A new Session starts
without Goal state.

Pi owns native compaction. Goal preserves its objective, completion guard, and continuation identity across a matching
compaction. If that compaction fails, Goal retries the stale continuation once after the failure settles.

## Experimental queue

Set `goal.experimental.goals` to `true` to enable a queue of up to 64 additional Goals:

- `add` or `push` appends an objective;
- `prioritize` or `unshift` activates a new objective and moves the current Goal to the front of the queue;
- `drop-last` or `pop` removes the queue tail;
- `skip` or `shift` clears the current Goal and activates the queue head.

The queue remains Session-scoped and uses the same lifecycle and evidence rules.

## See also

- [Goal Module README](../../packages/pi-stuff/src/goal/README.md)
- [Command reference](../reference/commands.md#work-control)
- [Settings reference](../reference/settings.md#goal)
- [Architecture](../architecture.md#lifecycle-ownership)

