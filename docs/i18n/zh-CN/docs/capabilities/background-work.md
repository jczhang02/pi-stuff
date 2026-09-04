<!-- translation-source: docs/capabilities/background-work.md; translation-source-sha256: 12e67291626abcfbcbf757f797869f063952d05fce9867d9dc877ac8a6b9b4b6 -->

# Background Work

[English](../../../../../docs/capabilities/background-work.md)

Background Work 让长时间运行的 Shell 命令与一次性 Monitor 在主 Agent 继续有效工作的同时运行。

## 快速开始

Bash call 可以立即分离：

```json
{
  "command": "sleep 2; printf 'READY\\n'",
  "description": "Synthetic background smoke",
  "run_in_background": true
}
```

`run_in_background` 表示独立工作：其结果会被保留，但不会启动后续 Agent turn。当前工作需要 command result
时应省略该字段；稍后发生的 Foreground Handoff 会保留这项责任。

Monitor 等待外部证据，并自动报告最终结果：

```json
{
  "source": "command",
  "target": "printf 'READY\\n'",
  "success_text": "READY",
  "description": "Wait for readiness"
}
```

启动后继续其他工作。使用 `/tasks` 进行实时检查和控制；不要在 conversation 中轮询 Monitor。

## Background Shell

设置 `run_in_background: true` 会启动显式独立的 Bash 命令；命令结束时不会唤醒 Agent。前台 Bash call 也可以
用 `Ctrl+B` 分离；工作持续两分钟后还未结束时，会自动转到后台。该 Foreground Handoff 会在 Shell 成功、失败
或超时时恢复 Agent。

| Bash 字段 | 含义 |
| --- | --- |
| `command` | 要运行的 Shell 命令 |
| `description` | 可选任务标签，最多 160 个字符 |
| `run_in_background` | 独立启动并立即分离 |
| `timeout` | 可选正数运行上限，单位为秒 |

Timeout 或 stop 会终止所属进程树。后台输出保持有界，可以通过 activity ID 检查。不要仅为看守已移交的前台
Shell 而创建 Monitor；该 Shell 自己拥有 terminal wake。

## Monitor

`monitor` Tool 支持四种来源：

| 来源 | Target |
| --- | --- |
| `command` | 检查命令输出 |
| `file` | 检查可读文件内容 |
| `log` | 日志文件，可选从当前末尾开始 |
| `http` | HTTP 或 HTTPS response |

command Monitor 会记住整个输出流中出现的匹配，包括跨块匹配；后续输出保留不会抹去已经观察到的成功或失败条件。

`success_text` 与 `failure_text` 都是精确子串。两者同时匹配时 failure 优先。未配置任一条件时，第一次读到证据
就完成 Monitor。

默认轮询间隔为 2 秒，默认 deadline 为 600 秒。间隔可以是 0.1–60 秒；显式 deadline 可以是任意可表示的正数秒，
并通过安全的 timer 分段调度。
文件或日志不存在时会继续等待其出现；非 2xx HTTP response 会保持 pending，除非匹配 failure text。

## 检查与控制

`background` Tool 接受：

| Action | 必需字段 | 结果 |
| --- | --- | --- |
| `list` | 无 | 当前 Background Shell 与 Monitor |
| `output` | `task_id`；可选 `max_bytes` | 最近的有界输出或 Monitor 证据 |
| `stop` | `task_id` | 幂等停止当前或近期结束的工作 |

`max_bytes` 接受 1,024–51,200 bytes。

`/tasks` 是当前工作管理器。它按启动顺序列出 live Shell 和 Monitor，原位更新各行，打开按类型区分的详情，
跟随有界输出，并停止当前 Session 拥有的工作。最终结果送达后，完成项会离开 live 列表。

## 完成送达

Shell 与 Monitor 结果会自动送达。Monitor 或已移交的前台 Shell 会在非 stopped terminal outcome 后唤醒主
Agent 一次；显式独立的 Background Shell 不会唤醒。主动请求的 stop 会同步确认，不会加入第二个 turn。时间
接近的多个结果会合并。

Foreground Handoff 结束后，Agent 会检查其有界证据、恢复原来已获授权的工作，并仅在没有必需工作剩余时生成
Completion Report。近期结束的 activity 以有界 receipt 保留，供输出查看和幂等 stop 请求使用。

Runtime 保留最新 64 个 receipt，每批最多 16 个结果。Receipt 只用于近期检查，不是长期任务日志。

## 容量与输出

每个 Session 最多同时运行 16 个 Shell 和 Monitor，包括 launch reservation。

Shell 在 20 MiB 保留阈值内保存完整输出。每次滚动保留最新的 10 MiB，为后续追加留出空间，避免每个输出块都重写保留文件。跨过阈值不会终止进程：Background Work 会继续消费输出，保留
最新 64 KiB 和 omitted-byte count，并默认返回 50 KiB 的 model-readable tail。已完成 Bash 的 details 在包含输出
artifact 时，仅当文件仍含完整输出才提供 `fullOutputPath`；滚动后改为提供 `retainedOutputPath` 和
`omittedBytes`。需要完整日志时，
应在命令中重定向输出。Monitor 证据上限为 64 KiB。输出读取会保持有效 UTF-8 边界。

## Shutdown 与恢复

Session shutdown 会停止所属 Shell、取消 Monitor、等待有界终止宽限期，并为仍可能需要清理的进程记录经过认证的
恢复 metadata。工作活动时会刷新运行进程 metadata。

## 相关文档

- [Background Work Module README](../../packages/pi-stuff/src/background-work/README.md)
- [命令参考](../reference/commands.md#工作控制)
- [Tool Display](tool-display.md)
- [Agents](subagents.md)
