# Pi Stuff UI spec

[English](../../ui-spec.md) · [运行原型](../../../prototypes/ui-session/README.md) · [研究依据](research/README.md)

## 审阅范围

本文用于审阅会话 UI. 当前规则对应 `codex/ui-session-prototype` 分支的原型, 产品基线为 `cd0f174`, 使用 Pi 0.85.1 和 Bun 1.4.0. 生产实现尚未采纳, 待讨论的三项建议列在文末.

用户消息、状态栏、原生输入与会话控制保留现状. Todo、agents、Goal、后台任务、BTW、通知系统、会话命名和独立工具检查器不纳入. 原生上下文摘要、分支摘要、Skill 和直接 shell 输出见研究盘点.

[会话与消息](#会话框架与消息) · [工具](#工具展示) · [长会话](#交互与长会话) · [待定项](#待审阅建议-尚未实施)

## 会话框架与消息

### 欢迎页、用户消息与状态栏

欢迎页使用直角边框 (┌ ┐ └ ┘), 保留 pi-stuff-old 的盒式结构及窄屏布局. 用户消息复用原生 UserMessageComponent, 保留 Markdown、背景和边距. 输入框、滚动和状态栏由 Pi 管理, 不安装自定义 footer. 欢迎页的模型和加载数量是固定样例, 不代表实时产品清单.

欢迎页, 默认状态, 浅色 120 列

![欢迎页, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/welcome-catppuccin-latte-120-main.png)

欢迎页, 直角边框, 深色 80 列

![欢迎页, 直角边框, 深色 80 列](../../../prototypes/ui-session/captures/welcome-catppuccin-mocha-80-main.png)

连续会话, 第一轮完成, 浅色 120 列

![连续会话, 第一轮完成, 浅色 120 列](../../../prototypes/ui-session/captures/live-catppuccin-latte-120-first-complete.png)

### Thoughts 的显示与隐藏

两种状态均保留灰色前导点. 完成后 hidden 显示 • Thoughts · 4s. no hidden 显示 • Thoughts: 正文, 前缀与低对比度的正体 Markdown 同行, 续行与消息正文对齐, 耗时紧随末尾. 运行中当前使用 Thinking · Ns. 不增加独立卡片或标题行. 默认服从 Pi hideThinkingBlock. 点击改变单条, 原生 Ctrl+T 或 /settings 改变默认并清除局部覆盖, Ctrl+O 只改变工具.

思考收起, 默认状态, 浅色 120 列

![思考收起, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/thoughts-catppuccin-latte-120-main.png)

思考正文, 默认状态, 浅色 120 列

![思考正文, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/thoughts-visible-catppuccin-latte-120-main.png)

思考正文, 默认状态, 深色 80 列

![思考正文, 默认状态, 深色 80 列](../../../prototypes/ui-session/captures/thoughts-visible-catppuccin-mocha-80-main.png)

### 回答失败与 Esc

回答失败保持普通状态文字, 保留已有正文. Esc 中断复用原生 AssistantMessageComponent 的 aborted 展示, 包括 Operation aborted 文案、颜色和边距. 不将 assistant 错误改为工具卡片. 离线脚本仍模拟取消, 不证明生产提供方或工具的中断语义.

回答失败, 默认状态, 浅色 120 列

![回答失败, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/response-error-catppuccin-latte-120-main.png)

原生中断, 默认状态, 浅色 120 列

![原生中断, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/interrupted-catppuccin-latte-120-main.png)

连续会话, Esc 中断, 浅色 120 列

![连续会话, Esc 中断, 浅色 120 列](../../../prototypes/ui-session/captures/live-catppuccin-latte-120-cancelled.png)

## 工具展示

### 工具调用与结果块

工具使用状态点、Action(target), 下一层以 ⎿ 引出结果. 每个可见子结果摘要一个连接符, 摘要续行与摘要正文对齐, 结果正文保留自己的内容缩进. 展开的独立工具各有连接符. 这是两层语义结构, 不限制为两行终端文字. 完整目标展开后换行, 代码保留语法高亮. 成功、运行、失败、取消同时使用语义颜色和文字.

Edit 与 Write, 默认状态, 浅色 120 列

![Edit 与 Write, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/changes-catppuccin-latte-120-main.png)

### 检索聚合与对齐

成功的 Read/Grep/Find/Ls 与 WebSearch/WebFetch/WebRead 从第一个符合条件的成功调用起形成活动摘要. 点击摘要显示按时间排列的紧凑工具, 再点击工具查看正文. 展开后与普通工具左侧平齐, 不额外缩进. 组摘要有状态点, 没有 ⎿. 用户回合、可见正文、Thoughts、普通 Bash、写入、警告、失败和取消切断分组. 正在运行的调用保持可见, 成功后才可加入摘要. 保留实际 `ls` 工具调用的 Ls 展示及既有聚合、展开方式. 通过 Bash 执行的 shell `ls` 命令仍显示为 Bash.

检索分组, 默认状态, 浅色 120 列

![检索分组, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/folding-catppuccin-latte-120-main.png)

检索分组, 展开检索组, 浅色 120 列

![检索分组, 展开检索组, 浅色 120 列](../../../prototypes/ui-session/captures/folding-catppuccin-latte-120-group-open.png)

检索详情, 展开 Read, 浅色 120 列

![检索详情, 展开 Read, 浅色 120 列](../../../prototypes/ui-session/captures/investigate-catppuccin-latte-120-read-open.png)

### Web 工具

web_search → WebSearch、fetch_content → WebFetch、get_search_content → WebRead 使用相同的工具布局. 这些是显示名称, 不修改 API. 收起显示动作与结果, 展开保留查询/URL、返回正文、内容标识及分页/查找元数据. 成功 Web 调用加入检索组, 错误独立可见.

Web 工具, 展开检索组, 浅色 120 列

![Web 工具, 展开检索组, 浅色 120 列](../../../prototypes/ui-session/captures/web-catppuccin-latte-120-group-open.png)

Web 工具, 展开 WebFetch, 浅色 120 列

![Web 工具, 展开 WebFetch, 浅色 120 列](../../../prototypes/ui-session/captures/web-catppuccin-latte-120-fetch-open.png)

### Edit、Write 与语法高亮

Edit 使用统一 diff 与单列行号: 删除用旧行号, 新增及上下文用新行号. +/- 标记和增删底色与语法颜色共同表达改动. 新旧源码分别高亮. 收起最多显示六行渲染后的改动行, 展开恢复上下文与完整目标. 折行不重复行号或增删符号. Write 默认显示路径、写入行数与前三行渲染后的高亮正文. 短内容完整显示, 展开后显示其余内容. Diff 行由样例指定.

Edit 与 Write, Ctrl+O 展开, 浅色 120 列

![Edit 与 Write, Ctrl+O 展开, 浅色 120 列](../../../prototypes/ui-session/captures/changes-catppuccin-latte-120-keyboard-open.png)

长 diff, 默认状态, 深色 80 列

![长 diff, 默认状态, 深色 80 列](../../../prototypes/ui-session/captures/long-diff-catppuccin-mocha-80-main.png)

长 diff, Ctrl+O 展开, 深色 80 列

![长 diff, Ctrl+O 展开, 深色 80 列](../../../prototypes/ui-session/captures/long-diff-catppuccin-mocha-80-keyboard-open.png)

### Bash、空结果与截断

工具结果摘要使用确定性数据: Edit 统计增删源码行, Write 统计写入源码行. Bash 显示退出码和可用耗时, 不解析测试数量, 不生成语义摘要. 测试结果保留在原始输出中. 原型仍以手写摘要展示这条规则, 尚未实现结果提取.

完成的 Bash 保留三行输出, 运行中工具显示末尾两行, 展开恢复已保留的详情. 无输出、无匹配、工具失败、取消使用不同文案. 上游截断和保留日志路径在收起时仍可见. 展开无法恢复上游未返回的内容.

运行中, 默认状态, 浅色 120 列

![运行中, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/running-catppuccin-latte-120-main.png)

空结果, 默认状态, 浅色 120 列

![空结果, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/empty-catppuccin-latte-120-main.png)

输出截断, 默认状态, 浅色 120 列

![输出截断, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/long-output-catppuccin-latte-120-main.png)

工具失败, 默认状态, 浅色 120 列

![工具失败, 默认状态, 浅色 120 列](../../../prototypes/ui-session/captures/failures-catppuccin-latte-120-main.png)

## 交互与长会话

live 脚本通过两轮提交修复分页, 包含读取、搜索、Web、编辑、写入、测试、失败和重试. Esc 停止推进并保留草稿, 再提交可恢复被中断步骤; 运行中提交先中断. 两轮完成后, 后续提交回顾既有结果. 完整输出可通过原生滚动查看, 缩放后重新排版. 验证覆盖 120/80/60 列与 Latte/Mocha.

连续会话, 第二轮完成, 浅色 120 列

![连续会话, 第二轮完成, 浅色 120 列](../../../prototypes/ui-session/captures/live-catppuccin-latte-120-followup-complete.png)

连续会话, 窄屏滚动, 浅色 60 列

![连续会话, 窄屏滚动, 浅色 60 列](../../../prototypes/ui-session/captures/live-catppuccin-latte-60-narrow-scrolled.png)

## 证据与验收边界

图为真实 Pi 终端导出, 内容与执行为离线样例, 字体为 JetBrainsMono Nerd Font Mono、Symbols Nerd Font Mono、LXGW WenKai Mono. 前台启动不发送终端配色设置或重置指令, 不修改 Ghostty. 当前启动器支持 Catppuccin, 其他/自动主题须显式指定受支持主题. 完整状态见[截图附录](../../../prototypes/ui-session/captures/README.md), 运行和验证方法见[原型说明](../../../prototypes/ui-session/README.md).

## 待审阅建议, 尚未实施

| 建议                                             | 当前原型                                 |
| ------------------------------------------------ | ---------------------------------------- |
| 去除常驻 collapse, 用隐藏内容摘要替代泛用 expand | 工具与检索摘要仍保留现有文字后缀         |
| 收起 diff 保留少量上下文                         | 当前仅预览最多六行改动, 展开才恢复上下文 |
| 运行中优先显示已有动作描述                       | 当前仍以工具名称和目标作标题             |

[建议依据: Claude 实测](research/claude-code-ui-details-2026-09-22.md)
