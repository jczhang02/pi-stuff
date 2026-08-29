<!-- translation-source: docs/research/work-background-package-reference.md; translation-source-sha256: 04df0d6ec12c1c2bad9da8805fbf94be0eb2d3befb18b99954db3e516f24e0a4 -->
# 后台工作 Package 参考

**审计日期：** 2026-08-05
**检索日期：** 2026-08-05
**认证 Host：** Pi 0.83.0，Linux x64
**决定：** 从 `pi-background-tasks@2.0.0` 的 `db632653682c00852a38c0972a761fb1e9f24dc3` 分叉后台任务运行时；不要使用 `pi-patty-bg-tasks` 或 `@ifi/pi-background-tasks` 作为代码基础。

## 决定

Pi Stuff 应内置一个由 [`pi-background-tasks@2.0.0`](https://registry.npmjs.org/pi-background-tasks/2.0.0) 拥有的分叉版本，来源为精确源代码提交
[`db632653682c00852a38c0972a761fb1e9f24dc3`](https://github.com/ismailsaleekh/pi-background-tasks/tree/db632653682c00852a38c0972a761fb1e9f24dc3)。

这是**运行时内核选择**，并不代表批准上游的产品界面。本地分叉必须保留进程生命周期和有界输出相关工作，然后删除 Fusion、delegation、telemetry、更新检查、上游页脚/dock 以及其他无关行为。Pi Stuff 将围绕保留的内核构建其已接受的 Ctrl+B、Monitor、通知和 `/tasks` 界面。

`pi-patty-bg-tasks` 更接近所需的交互模型，因为它已经覆盖 Bash、支持前台分离，并包含 Monitor Tool。它不是基础代码，因为其进程所有权明显较弱：停止操作只是尽力发送 `SIGTERM`，没有 TERM 到 KILL 的升级或等待进程树结束，按 PID 标识进程，并且明确允许无界的持久 Monitor 日志。这些是核心运行时缺陷，而不是 UI 变更。

## 用于比较的产品契约

已接受的契约记录在 Beads `ps-5cb.11.2.*` 中。具体而言：

1. 后台工作仅属于当前 Pi Session；不存在 daemon 或跨 Session 重新连接。
2. Pi Stuff 拥有完整的进程树，并在请求、超时、重新加载和 Pi 退出时停止它。
3. 停止是幂等的 TERM 到 KILL 升级，PID 重用绝不能向无关进程发送信号。
4. 输出以及每次模型可见的读取都必须有界。
5. Ctrl+B 只分离当前活跃的前台 Pi Stuff Bash 调用。
6. Monitor 在截止时间内只等待一次明确的命令、日志、文件或 HTTP 条件；它不是主对话中的轮询循环。
7. `/tasks` 管理 Background Shell 和 Monitor，并展示运行中的 Subagents，但不从 `/agents` 夺取权威。
8. `/tasks` 使用 Pi Stuff 的全宽、非浮动 Command Dialog。不存在永久任务页脚、statusline、overlay 或权限提示。

没有任何经过审计的上游实现满足全部八项。因此，选择取决于哪个候选提供最安全的深层运行时，以及需要进行的危险重写最少。

## 候选比较

| 候选 | 来源和许可证 | 维护和采用情况 | 运行时正确性 | 契约适配性 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `pi-background-tasks@2.0.0` | 精确 npm payload 与 [`db632653…`](https://github.com/ismailsaleekh/pi-background-tasks/tree/db632653682c00852a38c0972a761fb1e9f24dc3) 匹配；[ISC](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/LICENSE)，版权行 `Copyright (c) 2026` | 发布于 2026-08-04；固定 30 天窗口内 2,263 次下载 | 分离的 POSIX 进程组、优先进程组终止、子进程回退、一次 SIGKILL 升级、等待停止、有界输出/读取、幂等最终化 | 没有 Ctrl+B 分离或 Monitor；必须删除上游 UI 以及无关的 Fusion/delegation | **选择作为后台运行时** |
| `pi-patty-bg-tasks@1.1.6` | 精确 npm payload 与 [`6676db5…`](https://github.com/patty-io/pi-patty-bg-tasks/tree/6676db5b30caafea0431d29400ccfbffa51aa9e9) 匹配；[MIT](https://github.com/patty-io/pi-patty-bg-tasks/blob/6676db5b30caafea0431d29400ccfbffa51aa9e9/LICENSE)，版权 2026 patty.io | 发布于 2026-07-08；固定窗口内 980 次下载；存在一个尚未发布的 2.0.0 提交 | 分离的进程组启动和进程组信号，但没有升级、等待结束、启动身份或有界持久 Monitor 日志 | 最佳 Ctrl+B/Monitor 行为参考；核心安全性需要替换 | 仅作行为参考 |
| `@ifi/pi-background-tasks@0.5.1` | Release [`e9c9d96…`](https://github.com/ifiokjr/oh-pi/tree/e9c9d96e75fd4d2b1748f81d0788f29cc8013ec8/packages/background-tasks)；[MIT](https://github.com/ifiokjr/oh-pi/blob/e9c9d96e75fd4d2b1748f81d0788f29cc8013ec8/LICENSE)，版权 2025 Ifiok Jr. | 发布于 2026-04-28；固定窗口内 154 次下载 | 有界内存尾部和输出模式唤醒，但仅对根 PID 发送 SIGTERM，没有进程组、升级或等待关闭；磁盘日志无上限 | 有用的 matcher 思路，但使用浮动 overlay 和旧 Pi Package 命名空间 | 拒绝 |

采用窗口为 2026-07-06 至 2026-08-04。来源：npm 固定窗口记录 [`pi-background-tasks`](https://api.npmjs.org/downloads/point/2026-07-06:2026-08-04/pi-background-tasks)、[`pi-patty-bg-tasks`](https://api.npmjs.org/downloads/point/2026-07-06:2026-08-04/pi-patty-bg-tasks) 和 [`@ifi/pi-background-tasks`](https://api.npmjs.org/downloads/point/2026-07-06:2026-08-04/%40ifi%2Fpi-background-tasks)。下载量是采用信号，不是用户数或质量评分。

## 所选源的身份

| 事实 | 已验证值 |
| --- | --- |
| Package | `pi-background-tasks` |
| 版本 | `2.0.0` |
| 发布日期 | 2026-08-04 19:39:56 UTC |
| 精确源修订版 | `db632653682c00852a38c0972a761fb1e9f24dc3` |
| 许可证 | ISC；精确通知中没有指定版权持有人 |
| npm archive | `https://registry.npmjs.org/pi-background-tasks/-/pi-background-tasks-2.0.0.tgz` |
| npm integrity | `sha512-LyTFnuPbL2BhzNQaq7l7KN3neV2WyQbH1uEiSTM4cpyAw7489SATqQDoZ9SCqkRIBH/zktP7xvk/VNerpU3QPQ==` |
| 本地观察到的 archive SHA-256 | `7b0b1220bacc3fa2516cf9d7cdb1933d90b12b2b3dcd36c56c882ab41e6cfaf0` |
| npm payload | 99 个文件，压缩后 447.4 KiB，解包后约 1.5 MiB |
| 生产 TypeScript | 整个上游 Package 共 26,055 行 |
| 测试 TypeScript | 48 个测试文件共 26,721 行 |
| 运行时依赖 | `turndown@7.2.4` 和一个 commit-pinned 的 `@ravshansbox/pi-anthropic-sps` archive；两者都属于无关的 Fusion，必须从本地 Capability 中消失 |
| Pi peers | 与 `^0.83.0` 兼容的 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`；`typebox: *` |
| 固定窗口下载量 | 2,263 |

npm 记录没有发布 `gitHead`。为弥补这一来源缺口，已将 2.0.0 npm payload 中的每个文件与记录的提交进行比较；所有已发布文件均逐字节匹配。该提交只包含额外的仓库材料，例如测试、脚本、CI 文件和 lockfile。

主要身份来源：精确的 [npm version record](https://registry.npmjs.org/pi-background-tasks/2.0.0)、[source revision](https://github.com/ismailsaleekh/pi-background-tasks/tree/db632653682c00852a38c0972a761fb1e9f24dc3)、[manifest](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/package.json) 和 [ISC license](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/LICENSE)。

## 为什么这个运行时胜出

所选源代码已经在一个 registry 中实现了 Capability 中最容易出错的部分：

- 子进程在分离的 POSIX 进程组中运行；
- 停止时首先向整个进程组发送 `SIGTERM`，仅当进程组信号发送失败时才回退到子进程句柄，然后在宽限期后恰好安排一次 `SIGKILL`；
- 调用方等待终止状态，并在进程未退出时报告明确失败；
- 同时发生的 error、close、输出上限和 stop 竞争只最终化一次；
- Pi 关闭时等待所有运行中任务停止，而不是仅发出信号；
- 默认情况下子进程输出上限为 20 MiB，模型可见读取上限为 50 KiB；
- 完成元数据、等待者、有界的近期保留和通知状态由同一运行时拥有；
- 运行时文件隔离在 `.pi/tasks/<session-id>-<pid>/` 下，而不是共享一个全局日志命名空间。

相关上游实现是精确的 [`BackgroundTaskRegistry`](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/src/core/registry.ts)，以及它的[运行时契约](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/docs/subsystems/background-task-runtime.md)和[终止测试](https://github.com/ismailsaleekh/pi-background-tasks/blob/db632653682c00852a38c0972a761fb1e9f24dc3/tests/unit/registry.test.ts)。

针对精确源代码进行的本地验证产生了以下结果：

- Bun **1.3.14** 安装和严格 TypeScript 检查：通过；
- 精确的上游 registry 测试文件：**30/30 通过**；
- 真实认证 Pi **0.83.0** RPC Package 加载：通过，无 `extension_error`；
- 使用未修改 registry 的真实 POSIX 进程探针：一个忽略 TERM 的组首进程及其子进程被升级处理，两个 PID 和进程组均已消失；终止状态为 `killed`。

这些检查确立了可信的基础，但并不代表 Pi Stuff 契约已经完成。

## 为什么 Patty 不是基础

[`pi-patty-bg-tasks@1.1.6`](https://registry.npmjs.org/pi-patty-bg-tasks/1.1.6) 更小：4,209 行生产 TypeScript，18 个文件中的 2,662 行测试代码，没有运行时依赖，npm payload 有 35 个文件。其精确发布 archive 与提交 [`6676db5…`](https://github.com/patty-io/pi-patty-bg-tasks/tree/6676db5b30caafea0431d29400ccfbffa51aa9e9) 逐字节匹配。

它有一些值得独立复现的有用行为：

- 一个拥有所有权的 Bash 执行路径，可以转变为后台工作；
- 立即启动后台任务和前台分离；
- Monitor 的 source/session seam；
- 紧凑的作业控制和完成记录。

然而，其核心无法达到已接受的安全标准：

- [`killProcessTree`](https://github.com/patty-io/pi-patty-bg-tasks/blob/6676db5b30caafea0431d29400ccfbffa51aa9e9/src/spawn.ts) 发送一次信号并吞掉失败；没有宽限窗口、SIGKILL 升级或证明后代进程已结束；
- 存活性检查和信号发送使用裸 PID，没有进程启动身份或 PID 重用防护；
- 关闭时发出尽力终止，而不是等待完整进程树结束；
- 日志共享 `/tmp/pi-bg`，并且持久 Monitor 明确禁用输出大小上限；
- 其永久 sidebar/status 输出和 Package 所有的任务面板与 Pi Stuff 的 UI 权威相冲突。

采用 Patty 会保留更多可见行为，但需要替换深层运行时。这是错误的所有权取舍：Pi Stuff 可以更可靠地在安全内核之上实现 Ctrl+B 和 Monitor，而不是在 Patty 现有生命周期下补足进程正确性。

未发布的 Patty `2.0.0` 提交也经过检查，并未推翻该决定。它面向 Pi 0.83，改进了内存中的生命周期结构，但仍然使用裸 PID 信号发送和仅 SIGTERM 的清理。其“background all”快捷方式也与已接受的“仅当前活跃前台 Bash 调用”规则冲突。

## 为什么 @ifi 候选整体不更强

[`@ifi/pi-background-tasks@0.5.1`](https://registry.npmjs.org/@ifi/pi-background-tasks/0.5.1) 是输出触发唤醒方面最强的额外候选：它接受子字符串或正则表达式 matcher，并维护有界的内存输出尾部。其精确 release 源代码是 [`e9c9d96…`](https://github.com/ifiokjr/oh-pi/tree/e9c9d96e75fd4d2b1748f81d0788f29cc8013ec8/packages/background-tasks)。

它不符合运行时基础的要求。Spawn 不会被分离到拥有所有权的进程组；stop 和 shutdown 只调用一次 `process.kill(pid, "SIGTERM")`，不升级、不等待退出，并可能留下仍在运行的后代。日志文件无限增长，写入失败会被忽略，dashboard 是明确的居中 overlay，而已发布 manifest 仍然导入旧版、非 Earendil 的 `@mariozechner/pi-*` Package 身份。它的 matcher 值得理解，但不值得继承其生命周期。

## 所需本地分叉增量

只有当分叉的第一个本地变更明确所有权边界时，该分叉才可接受。

### 保留并深化

- 保留 Session 作用域 registry、分离的进程组启动、有界输出/读取、幂等终止状态、TERM 到 KILL 升级、等待关闭和聚焦的进程测试。
- 保留精确的 ISC 通知，并添加 `UPSTREAM.md`，记录 Package 版本、提交、archive integrity、archive SHA-256、保留路径、删除路径和本地变更。
- 保持一个小型 Runtime interface，用于 start、detach、inspect、stop、subscribe 和 shutdown；进程机制保持私有。

### 发布前删除

- 删除 Fusion、delegation、attested Pi runners、agent telemetry、无关命令及其两个运行时依赖。
- 删除更新检查器以及 import/startup 中的每一个网络调用。
- 删除上游页脚、dock、statusline、更新通知和 Package 专属设置。
- 不要保留上游 Agent 功能；`/agents` 仍然拥有权威。

### 添加或替换

1. **PID 身份：** 除 PID 和进程组 ID 外，记录 leader 的不可变启动身份；每次发送信号前都验证它，确保不会命中重用的 PID。
2. **崩溃清理：** 证明 Pi 突然死亡不会使拥有所有权的进程树存活。仅依靠正常的 `session_shutdown` 不够。
3. **延迟运行时目录：** 上游在 `session_start` 期间创建 `.pi/tasks/...`。Pi Stuff 必须仅在首次由用户触发 Background 或 Monitor 操作时创建它，使启动保持纯净。
4. **前台分离：** 与 Pi Stuff 的 Bash 执行集成，使 Ctrl+B 恰好分离一个活跃的前台 Bash 调用。不要将每个命令都放到后台，也不要在不存在符合条件的 Bash 调用时声称支持 Ctrl+B。
5. **Monitor：** 在同一运行时上构建 command、log、file 和 HTTP 条件。一个 Monitor 只有一个具体的 success/error 谓词、一个截止时间、有界证据、取消操作和恰好一个结果。
6. **`/tasks`：** 使用共享的全宽、非浮动 Command Dialog，并带列表和就地详情。只包括 Background Shell 和 Monitor；不要包括 Todo、Goal、Beads、Agents 和 Tool invocation history。
7. **Transcript 结果：** 交付紧凑、去重的完成/失败/停止记录，不强制确认回合，不设置 task statusline，也不显示永久任务行。
8. **失败门：** 测试 spawn 失败、输出失败/达到上限、超时、忽略 TERM 的进程树、派生的孙进程、PID 重用、同时 stop/finalize、reload、Pi 突然死亡、窄 TUI、调整大小和清理失败。

## 最终选择声明

Pi Stuff 将在 ISC 许可证下，以 **`pi-background-tasks@2.0.0` 的
`db632653682c00852a38c0972a761fb1e9f24dc3` 为后台工作运行时基础进行分叉**。

该选择基于进程正确性，而不是功能广度、下载量或与 Claude Code 的相似性。`pi-patty-bg-tasks@1.1.6`
仍作为前台分离和 Monitor 易用性的行为参考；其源代码不应与所选分叉混用。
`@ifi/pi-background-tasks@0.5.1` 被拒绝作为代码基础。

在删除无关的上游产品，并且 Pi Stuff 在真实 Pi 0.83 TUI 中证明 PID 身份、突然崩溃清理、仅当前活跃项
Ctrl+B、单次 Monitor 和共享 `/tasks` 行为之前，该分叉都不算完成。
