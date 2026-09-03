<!-- translation-source: docs/capabilities/code-mode.md; translation-source-sha256: 76624b446b920e8fdad1eac7221304e660a1f562c59da6f537086ea35a2863ef -->

# Code Mode

[English](../../../../../docs/capabilities/code-mode.md)

Code Mode 让 model 在隔离 V8 host 中用 JavaScript 组合活动 Pi Stuff Tool。

## 启用 Code Mode

Code Mode 默认关闭。在受信项目中运行：

```text
/codemode on
```

`/codemode` 打开交互控制界面。`/codemode off` 关闭当前项目选择，`/codemode global on|off` 修改全局默认值。

有效设置按以下顺序解析：

1. child Agent launch 时冻结的值；
2. 受信项目 `.pi/code-mode.json`；
3. `<agentDir>/pi-stuff.json` 中的全局 `codeMode.enabled`；
4. `PI_STUFF_CODE_MODE_DEFAULT`；
5. `off`。

不受信项目不能持久化项目设置。

## 快速开始

Model 可以发现并调用本地 catalog：

```js
await codemode.search("read file");
const pkg = await tools.read({ path: "package.json" });
text(pkg);
```

每个 `tools.*` call 都必须 await。显式 Tool error 会 reject call；可以用普通 JavaScript `try/catch` 处理。

## Catalog 与输出

Code Mode 开启后，活动 Package-owned Tool 会移到 `codemode({ code })` 之后。单独安装的 Tool 保持 top-level。

`codemode.search(query)` 与 `codemode.describe(path)` 检查本地 catalog，不把整个 catalog 放进 model history。
Top-level `tool_search` Tool 读取同一个 ranked catalog。其 response 不超过 4,000 个字符：完整定义放不下时，
只保留一次排名第一的 Tool description，并附上紧凑的结构类型；两者仍放不下时，明确要求调用
`codemode.describe(path)`，而不是给出不完整的可调用契约。如果连一条 result path 都放不下，则要求 model
缩小搜索范围。Context compaction 后如果看不到确切输入字段，应重新 describe method，不能猜字段名。

可用输出 helper 包括 `text`、`image`、`generatedImage`、`audio`、`store`、`load` 与 `notify`。
直接返回完整的图像 Tool result，可以保留其原生图像路径。

对于带 deadline 的一个可观察 command、file、log 或 HTTP condition，调用一次 `tools.monitor(...)`，然后继续
有效工作。不要用 Bash、sleep、status call 或重复 turn 轮询。

## Sandbox

JavaScript 不能直接访问 Node、Bun、filesystem、process、network、module、credential 或 `console`。
I/O 只能通过 Tool catalog 与 Host 输出 helper。

Child Agent 现有 Tool allowlist 与 capability ceiling 仍限制其 catalog。Parent 后续切换不会改变已经运行的 child。

一次 execution 最多发出 768 个 nested Tool call。超过上限会明确失败。

## Tool 行为与 UI

Nested Tool 保留原有 argument preparation、validation、permission、lifecycle hook、cancellation、streaming、
renderer、media behavior 与 Tool Activity identity。

Nested Tool 或 media 已经呈现结果时，Code Mode 不增加 outer row。没有 nested activity 的纯 JavaScript
text-only success 不进入可见 transcript。未被其他界面呈现的 outer failure 会得到一个 fallback row。

Session JSONL 保存 outer result、nested call、media presentation data 与 ledger entry，reload 后可以重建同一视图。

## Replay 与恢复

每个 execution 和 nested call 都在当前 Session append-only ledger 中获得稳定 ID。

| Replay policy | 恢复行为 |
| --- | --- |
| `never` | 拒绝重复不明确的未完成 effect；默认值 |
| `record` | 只复用已经结算的记录结果 |
| `reexecute` | 有意重新执行 operation |

未完成的 `never` 或 `record` call 会成为 `incomplete`。无法识别活动 Session branch 时，恢复命令会失败，
不会把 history 当成空。

Ledger 最多保留 50 个 terminal execution；单个 source program 上限为 1,000,000 bytes；一个 Session 的全部
Code Mode ledger entry 上限为 16 MiB。

## 持久 approval

标记 `requiresApproval` 的 Tool 会在 effect 前暂停。使用：

```text
/codemode pending
/codemode approve <execution-id>
/codemode reject <execution-id> <sequence>
```

Approval 会用原工作目录与活动 Tool 定义恢复一次。Reject 是幂等的，不执行 Tool effect。Approval 不能与
`reexecute` 组合。

## History、rollback 与 snippet

| 命令 | 操作 |
| --- | --- |
| `/codemode history` | 显示保留的 execution history |
| `/codemode abandon <id>` | 放弃未完成 execution |
| `/codemode rollback <id>` | 按逆序运行声明的 inverse operation |
| `/codemode expire` | 让 stale unfinished state 失效 |
| `/codemode save <id> <name> [description]` | 保存成功 program |
| `/codemode snippets` | 列出已保存 program |
| `/codemode delete <name>` | 删除已保存 program |

`/codemode compensate <id>` 是 rollback 的别名。Partial rollback 可以重试，且不会删除 ledger history。

Program 可以用 `codemode.step(name, fn)` 创建持久命名 checkpoint，用 `codemode.run(name, input)`
运行保存的 snippet。

## Native host

V8 helper 只在第一次显式 execution 时准备。Pi Stuff 下载当前平台的 pinned OpenAI Codex
`rust-v0.145.0` asset，遵守标准 proxy 环境变量，验证 SHA-256，并通过 lock 与 atomic staging 安装到
Pi Agent cache。

Download 上限为 120 秒；startup 与 handshake 上限为 10 秒。把 `PI_STUFF_CODE_MODE_HOST` 设为已有的绝对
helper 路径，可以使用预安装 binary。

支持 Linux 与 macOS x64/arm64，以及 Windows x64/arm64 host asset。非 Windows archive 安装需要 `tar`。

## 相关文档

- [Code Mode Module README](../../packages/pi-stuff/src/code-mode/README.md)
- [命令参考](../reference/commands.md#code-mode)
- [设置参考](../reference/settings.md#codemode)
- [故障排查](../troubleshooting.md#codex-与-code-mode)
- [上游参考](../../packages/pi-stuff/src/code-mode/UPSTREAM.md)

