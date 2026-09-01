<!-- translation-source: docs/capabilities/rtk.md; translation-source-sha256: 61eb494caaa7489052d1bfcffe597c1e78d8cb70c6e4e14e50e947eaf29f4d9c -->

# RTK

[English](../../../../../docs/capabilities/rtk.md)

RTK 在执行前缩短符合条件的 shell 命令，并把成功 Bash 与 Grep 输出的紧凑投影加入 model context。

## 安装

Pi Stuff 认证官方 RTK `0.45.0` Linux x64 binary：

- archive SHA-256：`c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4`；
- executable SHA-256：`99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535`；
- source commit：`b34be37caf3796b69a50952a28e60e32b5daad43`。

安装官方 binary，并把 `rtk` 放到 `PATH`。Pi Stuff 不下载 RTK。

## 快速开始

启动 Pi Stuff，然后打开：

```text
/rtk
```

Dialog 显示 runtime 状态、Command rewriting、Model projection 和当前 Session savings。`/rtk` 不接受子命令。

## 两项独立行为

| 行为 | 默认值 | 作用 |
| --- | --- | --- |
| Command rewriting | 开 | 在 Pi 执行前，允许 RTK 替换符合条件的 Bash 命令 |
| Model projection | 开 | 为下一个 provider request 压缩成功 Bash 与 Grep 文字 |

Runtime 不可用时会关闭 rewriting，但 Model projection 仍可在本地压缩受支持结果。

## Runtime 验证

启动阶段不执行 RTK 进程工作。第一次符合条件的 Bash rewrite，或 dialog 中的显式验证，会：

1. 解析 `PATH` 中第一个 `rtk`；
2. 解析 real path，并为普通文件生成 fingerprint；
3. 运行 `rtk --version`；
4. 检查已认证版本与 executable SHA-256。

之后每次 rewrite 都会重新检查 path、real path、fingerprint 与 SHA。Binary 发生变化时进入 `drifted` 状态，
显式验证前保持禁用。

Dialog 状态为 `✓ ready`、`○ unchecked`、`! drifted` 与 `× unavailable`。按 `v` 验证，按 `c`
清除 Session savings。

## 命令改写

空命令和已经调用 RTK 的命令保持不变。Rewrite discovery、version 与 rewrite call 的 timeout 分别为
600 ms、1 秒与 2.5 秒。

RTK exit code 1 和 2 表示不改写。Code 0 和 3 可以返回替换命令。其他结果、timeout、不支持的平台、缺少
executable 或认证失败都会保留原命令。

最终 Bash call 仍由 Pi 执行，权限、生命周期与结果也由 Pi 负责。

## Model 投影

投影只处理 Bash 与 Grep 的成功文字结果：

- 移除 ANSI 控制序列；
- 可以压缩 build、test、Git 与 linter 输出；
- 对 Grep 结果分组；
- 投影文字默认最多 12,000 个字符。

失败结果、Read 输出、非文字 block、未知 Tool 和源 message 保持不变。投影通过 copy-on-write 只用于 provider
context；Session JSONL 与 transcript 输出保留原 Tool result。

重复 provider projection 是幂等的，并按 Tool-call ID 复用 cache。

## 设置与 savings

`rtk` 命名空间保存 `rewriteCommands` 与 `outputProjection`，默认都是 `true`。只有在 `/rtk` 中直接修改
才会持久化。

Session savings 比较原始与投影后的字符数。它是进程内呈现指标，不代表 billing 或准确 token 数量。清除 savings
不会改变 Tool result。

## 恢复

如果 rewriting 没有按预期工作，运行 `/rtk` 并验证 runtime。Binary 缺失、移动、过慢或未通过认证时，会安全
使用原命令。见[故障排查](../troubleshooting.md#rtk)。

## 相关文档

- [RTK Module README](../../packages/pi-stuff/src/rtk/README.md)
- [设置参考](../reference/settings.md#rtk)
- [命令参考](../reference/commands.md#codex-与-rtk)
- [上游参考](../../packages/pi-stuff/src/rtk/UPSTREAM.md)

