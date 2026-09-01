# Background Work

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/background-work.md)

Background Work runs long-lived Shell commands and one-shot Monitors while the main Agent continues useful work.

## Quick start

A Bash call can detach immediately:

```json
{
  "command": "sleep 2; printf 'READY\\n'",
  "description": "Synthetic background smoke",
  "run_in_background": true
}
```

A Monitor waits for external evidence and reports its terminal result automatically:

```json
{
  "source": "command",
  "target": "printf 'READY\\n'",
  "success_text": "READY",
  "description": "Wait for readiness"
}
```

Continue other work after launch. Use `/tasks` for live inspection and control; do not poll a Monitor in the
conversation.

## Background Shells

Set `run_in_background: true` to detach Bash at launch. A foreground Bash call can also be detached with `Ctrl+B`, and
work still running after two minutes moves to the background automatically.

| Bash field | Meaning |
| --- | --- |
| `command` | Shell command to run |
| `description` | Optional task label, up to 160 characters |
| `run_in_background` | Detach immediately |
| `timeout` | Optional runtime limit from 0.1 to 86,400 seconds |

A timeout or stop terminates the owned process tree. Background output remains bounded and can be inspected by activity
ID.

## Monitors

The `monitor` Tool supports four sources:

| Source | Target |
| --- | --- |
| `command` | Command whose output is checked |
| `file` | File whose readable content is checked |
| `log` | Log file, optionally starting at its current end |
| `http` | HTTP or HTTPS response |

`success_text` and `failure_text` are exact substrings. Failure wins when both match. With neither condition, the first
readable evidence completes the Monitor.

The default polling interval is 2 seconds and the default deadline is 600 seconds. Intervals may be 0.1–60 seconds;
deadlines may be 0.1–86,400 seconds. A missing file or log remains pending while it waits to appear, and non-2xx HTTP
responses remain pending unless failure text matches.

## Inspect and control

The `background` Tool accepts:

| Action | Required fields | Result |
| --- | --- | --- |
| `list` | none | Current Background Shells and Monitors |
| `output` | `task_id`; optional `max_bytes` | Recent bounded output or Monitor evidence |
| `stop` | `task_id` | Idempotently stop current or recently finished work |

`max_bytes` accepts 1,024–51,200 bytes.

`/tasks` is the current-work manager. It lists live Shells and Monitors in launch order, updates rows in place, opens
type-specific details, follows bounded output, and allows stopping work owned by the current Session. Finished work
leaves the live list after its terminal result is delivered.

## Completion delivery

Shell and Monitor outcomes are delivered automatically. Non-stopped completion can wake the main Agent once; multiple
nearby outcomes are batched. Recently finished activities remain available as bounded receipts for output and
idempotent stop requests.

The runtime keeps the newest 64 receipts and batches up to 16 outcomes. Receipts support recent inspection and are not a
long-term task log.

## Capacity and output

One Session may have up to 16 simultaneous Shells and Monitors, including launch reservations.

Shell output has a 20 MiB durable cap, a 64 KiB in-memory tail, and a 50 KiB default model-readable tail. Monitor
evidence is capped at 64 KiB. Output reads preserve valid UTF-8 boundaries.

## Shutdown and recovery

Session shutdown stops owned Shells, cancels Monitors, waits for a bounded termination grace, and records authenticated
recovery metadata for processes that may still need cleanup. Running-process metadata is refreshed while work is
active.

## See also

- [Background Work Module README](../../packages/pi-stuff/src/background-work/README.md)
- [Command reference](../reference/commands.md#work-control)
- [Tool Display](tool-display.md)
- [Agents](subagents.md)

