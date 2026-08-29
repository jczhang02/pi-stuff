<!-- translation-source: packages/pi-stuff/src/rtk/README.md; translation-source-sha256: bcb19b2cd33e5c7adbc2cdb7ce517f90b586d062b1fc8d2e8ed0f1428a878042 -->

# Pi Stuff RTK

RTK 模块通过一个已验证的本地 `rtk` 可执行文件重写受支持 Bash 命令，并且只把紧凑 Bash 与 Grep 结果投影到模型可见上下文。

宿主对话记录、工具显示和会话 JSONL 保留原始工具结果内容。`read` 输出和源码默认精确，不由该能力处理。

## 行为

- `/rtk` 打开共享全宽 Pi Stuff 命令对话框，显示运行时身份和会话节省量。
- `/rtk settings` 打开 Pi 原生设置组件，控制两个持久行为开关：**命令重写** 和 **模型投影**。
- 启动不执行子进程、文件写入、Hook 安装、提示、浮动 UI 或状态栏修改。
- 第一次 Bash 调用会在重写前验证 RTK `0.45.0`、其可执行路径和已验证的官方 Linux x64 SHA-256。
- RTK 可执行文件缺失、缓慢、被替换或以其他方式漂移时，原始 Bash 命令保持不变。
- 投影使用 Pi `context` 事件。它绝不返回 `tool_result` 补丁，也绝不编辑存储消息。
- 失败工具结果、非文本块、Read 和未知工具保持精确。

## 命令

```text
/rtk                 验证并检查 RTK
/rtk status          验证并检查 RTK
/rtk settings        配置 RTK 行为
/rtk verify          显式重新验证当前可执行文件
/rtk stats           检查本会话投影节省量
/rtk clear-stats     清除内存投影统计
/rtk help            显示有界命令摘要
```

本地 RTK 可执行文件是可选的。缺失或验证失败时，Pi 会正常继续但不重写命令。只面向模型的输出投影仍可使用，因为它不需要可执行文件。

## 已接受的 `/rtk` 可读性目标

**决策更新：** 2026-08-17
**状态：** 已于 2026-08-18 实现。

非设置 `/rtk` 界面保持为一个静态检查对话框。它不增加列表/详情模式，也不重复原生 `/rtk settings` 组件。它回答三个问题：可执行文件是否受信、哪些行为已启用，以及本会话避免了多少模型可见结果文字：

```text
RTK
✓ 就绪 · v0.45.0

◆ 运行时
二进制文件  ~/.local/bin/rtk
SHA-256     99e0cff729d52297…

◆ 行为
✓ 命令重写已开启
✓ 模型投影已开启

◆ 会话节省量
12,430 字符 (38%) · 24 个结果
Bash 12 · Grep 12

/rtk settings · Esc 关闭
```

使用 `✓ ready`、`○ unchecked`、`! drifted` 和 `× unavailable`，并始终带状态文字。`Drifted` 表示选中可执行文件身份在验证后发生变化；它是警告，显式 `/rtk verify` 前重写保持禁用。`Unavailable` 在标记为 `Error` 的小节下包含有界错误和下一步 `Run /rtk verify`；不得暗示 Pi 本身无法继续。

行为开关使用 `✓ on` 和 `○ off`，而不是只靠颜色区分的文字。`Model projection` 只表示发送给模型的紧凑副本；对话记录、工具结果和会话 JSONL 保持精确。可见描述或小节文字必须保留这一区别，绝不暗示 RTK 重写存储输出。

会话节省量是派生统计，不是计费或 token 声明。显示节省字符数、占合格原始结果字符的百分比和结果数。技术计数是次要信息；低高度下应先于运行时状态、错误、开关值或总节省行消失。二进制路径和缩短 SHA 是验证证据；空间不足时，在可操作错误后、核心状态与节省量前消失。

`/rtk clear-stats` 报告 `✓ Projection statistics cleared.`。`/rtk help` 显示有界命令形式，未知操作使用 `! Unknown action`，后接同一形式。反馈绝不替换运行时状态或 Escape 路径。Pi 配置的 Up/Down 操作和 Ctrl+P/Ctrl+N 滚动长状态内容；PageUp/PageDown 和 `b`/Space 按页移动；Home/End 跳转；`?` 打开上下文按键帮助。只有配置的取消操作关闭状态界面；Enter 和 `q` 没有隐藏关闭行为。

实现现在为状态和开关配对固定图标，使用 `◆` 小节，解释只面向模型的投影，保持反馈结构化，并缩短页脚。聚焦测试覆盖运行时状态、设置所有权、投影文案、低高度适配和失败行为；真实 PTY 验证器覆盖宿主渲染。

## 已验证 RTK 运行时

Linux x64 运行时固定到官方 [`rtk-ai/rtk` v0.45.0](https://github.com/rtk-ai/rtk/releases/tag/v0.45.0)，源码提交 `b34be37caf3796b69a50952a28e60e32b5daad43`。只接受下列已发布二进制文件：

| 构建 | SHA-256 |
| --- | --- |
| 官方 `rtk-x86_64-unknown-linux-musl.tar.gz` 归档 | `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4` |
| 官方归档中的 `rtk` 二进制文件 | `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |

每次重写都会重新检查选中路径、解析路径、文件指纹和实际二进制 SHA。任何身份变化都会禁用重写，直到 `/rtk verify` 显式重新验证。

RTK v0.45.0 保留受支持的 `rg` 语法，包括 `--files`、Glob 和普通行号搜索。其官方 `find` 包装器仍拒绝 `-not`、`-exec` 等复合谓词与操作；`find ... -print0 | xargs ...` 等管道会保持原生。这是外部 RTK 约束。Pi Stuff 不解析或修复命令；需要不受支持的 `find` 形式时，在 `/rtk settings` 中禁用命令重写，并在后续官方 RTK 版本通过验证后删除该变通方法。

## 上下文组合

`createRtkProjectionAdapter()` 暴露供未来 Context 能力使用的小型 `ContextProjectionAdapter` 接缝。调用 `project(messages)` 时，禁用或失败会返回原数组，成功则返回写时复制投影。该适配器在一次组合 Pi 上下文过程中保持幂等。

实现派生自 [`MasuRii/pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer)。精确源码、归档、许可证、完整性和本地差异记录见 [UPSTREAM.md](./UPSTREAM.md)。
