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

`run_in_background` denotes independent work: its outcome is retained but does not start a later Agent turn. Omit it
when the command result is required for the current work; a later Foreground Handoff preserves that responsibility.

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

Set `run_in_background: true` to launch an explicitly independent Bash command that does not wake the Agent when it
settles. A foreground Bash call can also be detached with `Ctrl+B`, and work still running after two minutes moves to
the background automatically. That Foreground Handoff resumes the Agent when the Shell succeeds, fails, or times out.

| Bash field | Meaning |
| --- | --- |
| `command` | Shell command to run |
| `description` | Optional task label, up to 160 characters |
| `run_in_background` | Launch independently and detach immediately |
| `timeout` | Optional runtime limit from 0.1 to 86,400 seconds |

A timeout or stop terminates the owned process tree. Background output remains bounded and can be inspected by activity
ID. Do not create a Monitor merely to watch a handed-off foreground Shell; that Shell owns its terminal wake.

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

Shell and Monitor outcomes are delivered automatically. A Monitor or handed-off foreground Shell wakes the main Agent
once after a non-stopped terminal outcome; an explicitly independent Background Shell does not. A requested stop is
acknowledged synchronously and does not enqueue a second turn. Multiple nearby outcomes are batched.

After a Foreground Handoff settles, the Agent inspects its bounded evidence, resumes the original authorized work, and
produces a Completion Report only when no required work remains. Recently finished activities remain available as
bounded receipts for output and idempotent stop requests.

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
