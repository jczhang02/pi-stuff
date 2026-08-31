<!-- translation-source: packages/pi-stuff/src/rtk/README.md; translation-source-sha256: b4e76f01594cabdb37a78b4e0b4d22b97af54e35e73787d763290e8637e1e46f -->

# Pi Stuff RTK

RTK 模块通过一个已验证的本地 `rtk` 可执行文件重写受支持 Bash 命令，并且只把紧凑 Bash 与 Grep 结果投影到模型可见上下文。

Host Transcript、Tool Display 和 Session JSONL 保留原始 Tool result content。`read` 输出和源码默认精确，不由该 Capability 处理。

## 行为

- `/rtk` 打开一个共享全宽 Command Dialog，其中同时包含 Runtime identity、两个 Pi 原生 behavior control 与 Session savings。仅打开 Dialog 不会验证可执行文件。
- **Command rewriting** 与 **Model projection** 都显示 configured value 和 effective state。Model projection 不依赖 Runtime availability。
- 启动不执行 subprocess、file write、Hook installation、notice、floating UI 或 Statusline mutation。
- 第一次 Bash call 会在重写前验证 RTK `0.45.0`、可执行路径和已认证的官方 Linux x64 SHA-256。
- RTK 可执行文件缺失、缓慢、被替换或发生其他 drift 时，原始 Bash command 保持不变。
- Projection 使用 Pi `context` event。它绝不返回 `tool_result` patch，也绝不编辑已存储 message。
- 失败 Tool result、non-text block、Read 和未知 Tool 保持精确。

## 命令

```text
/rtk                 检查并配置 RTK
```

RTK 没有 subcommand 或 alias。任何非空参数都会报告
`/rtk takes no subcommands; run /rtk.`，且不会打开其他 surface。

本地 RTK 可执行文件是可选的。缺失或认证失败时，Pi 会正常继续，但不进行 command rewriting。仅面向模型的 output projection 仍可使用，因为它不需要该可执行文件。

## `/rtk` 交互契约

Dialog 在一个界面回答三个问题：可执行文件是否受信、哪些 behavior 已 configured 且实际 effective，以及本 Session 避免了多少 eligible model-visible result text：

```text
RTK

Runtime
○ unchecked
Not verified yet.

Behavior
→ Command rewriting  configured on · effective unchecked
  Model projection    configured on · effective active

Session savings
No eligible result projected yet.

↑/↓ select · Enter/Space toggle · v verify · c clear savings
? keys · Esc close
```

使用 `✓ ready`、`○ unchecked`、`! drifted` 和 `× unavailable`，并始终保留 state word。`Drifted` 表示选中可执行文件 identity 在认证后发生变化；它是 warning，用户按 `v` 重新验证前 rewriting 保持禁用。`Unavailable` 包含有界 `Error` section，但不得暗示 Pi 本身无法继续。

Pi 配置的 Up/Down action 选择 behavior。Enter 或 Space 切换选中项，也是持久化相应 setting 的唯一路径。Command rewriting 的 description 说明只有认证 Runtime ready 时才会重写。Model projection 的 description 说明它独立于 Runtime availability，把 eligible Tool result 投影到 model context；Transcript、Tool result 和 Session JSONL 保持精确。

Session savings 是派生统计，不是 billing 或 token claim。它显示 saved character、占 eligible original result character 的百分比和 result count。在尚无 eligible projection 时，精确显示 `No eligible result projected yet.`。按 `c` 只重置内存中的本 Session statistics，并报告 `Session savings cleared.`。Technique count、Binary 和 SHA 属于次要信息；低高度首先删除它们，并保留 Runtime state、两个 configured/effective behavior row、savings outcome 和 Escape path。`?` 打开完整 key guide；只有配置的 cancel action 会关闭 Dialog。

## 已认证 RTK Runtime

Linux x64 Runtime 固定到官方 [`rtk-ai/rtk` v0.45.0](https://github.com/rtk-ai/rtk/releases/tag/v0.45.0)，source commit `b34be37caf3796b69a50952a28e60e32b5daad43`。只接受下列 release binary：

| Build | SHA-256 |
| --- | --- |
| 官方 `rtk-x86_64-unknown-linux-musl.tar.gz` archive | `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4` |
| 官方 archive 中的 `rtk` binary | `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |

每次 rewrite 都会重新检查 selected path、resolved path、file fingerprint 和实际 binary SHA。任何 identity change 都会禁用 rewriting，直到用户在 `/rtk` 中按 `v` 显式重新认证。

RTK v0.45.0 保留受支持的 `rg` syntax，包括 `--files`、glob 和普通 line-number search。官方 `find` wrapper 仍拒绝 `-not`、`-exec` 等 compound predicate 与 action；`find ... -print0 | xargs ...` 等 pipeline 会保持 native。这是外部 RTK constraint。Pi Stuff 不解析或修复 command；需要不受支持的 `find` form 时，在 `/rtk` 中禁用 Command rewriting，并在后续官方 RTK release 通过认证后删除该 workaround。

## Context composition

`createRtkProjectionAdapter()` 暴露供未来 Context Capability 使用的小型 `ContextProjectionAdapter` seam。调用 `project(messages)` 时，禁用或失败会返回原 array，成功则返回 copy-on-write projection。该 adapter 在一次组合 Pi context pass 中保持 idempotent。

实现派生自 [`MasuRii/pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer)。精确 source、archive、license、integrity 和 local delta 记录见 [UPSTREAM.md](./UPSTREAM.md)。
