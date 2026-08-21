# Pi Stuff UI 审查与修整报告

> **历史 UI 验收记录。** 本文中的 Package、Host、路径和测试数量属于 2026-08-05 快照；当前认证以
> [`docs/compatibility.md`](../compatibility.md) 为准。

日期：2026-08-05

验收版本：`@jczhang02/pi-stuff@0.3.2`

Pi Host：`0.83.0`

## 结论

这一轮已把当前 Pi Stuff 的所有主要 TUI 表面完整审查一遍，并修掉五项有实际使用影响的问题。整体 UI 继续采用已经确认的方向：对话优先、Claude Code 风格、全宽非浮动面板、Pi 原生设置组件、少装饰、状态只由一个地方负责。

当前版本可以直接日常使用。没有发现新的阻断性 UI 问题，也没有为了“看起来更丰富”加入新的面板、边框或常驻状态。

## 已修复

1. Agent 后台启动不再显示误导性的 `done`。后台任务显示 `launched`，前台完成显示 `finished`，resume、steer、stop、status 使用各自真实动作结果。
2. `/agents`、`/btw`、`/codex`、`/goal`、`/mcp`、`/rtk`、`/tasks`、`/tools`、`/ui` 共用同一套低高度规则。终端很矮时优先保留标题、当前选择或错误，以及 Esc/back 提示。
3. 必须读到的身份和状态不再使用过暗的 `dim`。Todo 的阻塞项改用 `⊘`，即使没有颜色也能与普通待办区分。
4. Tool 目标在临界宽度下不再留下 `s…`、孤立管道符或纯标点；无法保留可识别内容时会完整省略目标，优先留下 Tool 名和最终结果。
5. BTW 历史清除改为原面板内确认：`x` 进入确认，`y` 执行，Esc 或 `n` 取消，不使用浮动弹窗。
6. Statusline 第二行的上次输入文字与第一行 model 文字保持同一视觉起点；Latin、中文和 emoji 均按终端单元格对齐。

## 明确保留的设计

- Fleetview 静止时的帮助槽继续留空，不恢复突兀的 `to manage`。
- Welcome 是主要界面中唯一允许使用边框的表面。
- Command Dialog 继续全宽显示，不使用浮动窗口。
- `/ui` 只管理统一的视觉设置，不收纳所有 Pi Stuff 功能设置。
- 不把 `/tasks` 改名，也不为了凑分组而给菜单增加额外层级；这两项暂时没有足够的真实使用证据。

## 真实验收

- 全仓检查：558 项通过，0 项失败；1 项依赖本机 RTK 0.42.4 的既有可选测试跳过。
- Goal 独立协议、队列、恢复和真实运行 smoke 全部通过。
- 发布包：13 个不可变归档全部通过内容、安全、真实 Pi 加载和 TUI 认证。
- 暗色真实 Pi：Welcome、Statusline、Thought、Todo、`/ui`、`/codex` 覆盖 `100×32`、`64×28`、`48×22`、`32×18`、`24×16`。
- 亮色真实 Pi：同一尺寸矩阵通过；必要信息使用 Pi 语义色，阻塞、运行、失败和完成都不只依赖颜色。
- Tool：七个内置 Tool、running/done/error/rejected/cancelled、详情、长路径、CJK、窄屏和 resume 全部通过。
- Agent/Fleetview：100 和 64 列下的启动、运行、完成、管理、详情、冷恢复和底部顺序通过。
- BTW：100 和 64 列下的并发回答、历史、清除确认/取消、fork、resume 和输入草稿恢复通过。
- 当前安装版重新运行上述 UI、Tool、Agent 和 BTW TUI 后全部通过；安装版 ANSI 帧与已视觉检查的源码版帧逐字节一致。

## 当前安装

- 稳定入口：`~/.pi/agent/packages/pi-stuff-current`
- 不可变目录：`~/.pi/agent/packages/pi-stuff-releases/0.3.2-9d241d0c4fd3/package`
- Aggregate 归档 SHA-256：`9d241d0c4fd324a4d76ec39196a537b074a1db0b5ae221417d37e7ad60b4c061`
- 安装前 settings 备份：`~/.pi/agent/.pi-stuff-backups/settings-2026-08-05T15-40-14-691Z.json`

## 证据

- 审查结论：`.impeccable/critique/2026-08-05T13-42-36Z__packages-pi-stuff-suite-json.md`
- 暗色、亮色与安装版 TUI 帧：`.artifacts/ui-final-2026-08-05/`
- 认证 release：`.artifacts/release-0.3.2/`
