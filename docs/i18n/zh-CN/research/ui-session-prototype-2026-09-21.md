# 紧凑会话原型

[English](../../../research/ui-session-prototype-2026-09-21.md)

本轮承接 [#99](https://github.com/jczhang02/pi-stuff/issues/99), 验证 [#101](https://github.com/jczhang02/pi-stuff/issues/101) 的五项修正. 起点 `d8ff7be`, 产品基线 `cd0f174`, Pi 0.85.1, Bun 1.4.0. 独立分支为 `codex/ui-session-prototype`. [启动说明与画廊](../../../../prototypes/ui-session/README.md).

## 证据与设计选择

本地 `pi-stuff-old` 快照为 `21b636eaccc487a08362165ec69ffe364e8730fb`. 其中 `docs/research/claude-code-tool-grouping-narrative-boundary-20260826.md` 记录了官方 Claude Code 2.1.220 二进制 (SHA256 `674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863`) 与 Pi 0.84.3 的隔离黑盒验证. 这是历史证据, 本轮未重新运行 Claude, 也不保证新版本完全相同. 旧提交可在本地读取, 本轮未能获取对应 GitHub 公共页面.

该矩阵显示, Read/Grep/Glob 能跨 API 响应聚合, 可见 assistant 正文、用户回合和独立工具会结束聚合. 两次 Read 已可合并. Bash、Edit、Write、WebSearch、WebFetch 各自独立. 被观察的客户端不把 Thinking 当作边界. 旧能力文档对此更严格; 本原型明确把单独可见的 Thoughts 当作边界, 保持时间顺序, 不把它夹进另一个隐藏条目.

旧版 `packages/pi-stuff/src/tool-display/render.ts`、`operation-block-renderer.ts` 及组件测试提供了 `• Action(target)` 与 `⎿ outcome` 层级、有限预览、语法颜色和 diff 行号参考. 本轮读取了本地实现, 不只依据截图猜测.

[Claude 官方交互文档](https://code.claude.com/docs/en/interactive-mode#transcript-viewer)说明了详细工具记录入口. [Codex 紧凑执行 renderer](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/exec_cell/compact.rs)聚合探索并限制输出. [Web 消息](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/history_cell/search.rs)保留搜索、打开、查找的动作含义; [工具输出 renderer](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/tool_output.rs)保留隐藏输出的查看入口. 这些是参考, 不作为新增依赖, 也不宣称完全复刻.

已核对当前 Pi 安装包的 `tool-execution.js`、`assistant-message.js`, 确认点击展开和普通 assistant 错误的路径. 原型使用 Pi 的 MouseRegion、Markdown、Container 和真实输入框, 未替换生产原生消息组件.

## 本原型采用的规则

| 展示                 | 默认                                                                               | 展开与边界                                              |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Read、Grep、Find、Ls | 标题加结果, 不展示原始正文                                                         | 单击查看完整保留内容                                    |
| 连续成功检索         | 两次起聚合为 Explored                                                              | 点击组显示按时间排序的紧凑子项, 再点子项看详情          |
| 检索边界             | 用户/assistant 正文、可见 Thoughts、修改、Bash、Web、失败/运行中调用、截断警告     | 不跨边界聚合; 本轮按静态会话输入计算                    |
| Web 家族             | WebSearch(query)、WebFetch(source)、WebRead(source + operation), 共用标题/结果组件 | 展开才显示搜索结果、正文和分页元数据; 每次 Web 调用独立 |
| Edit                 | 结果加最多三行渲染后的 diff                                                        | 显示隐藏行数, 展开显示完整高亮改动和目标                |
| Write                | 文件与写入行数                                                                     | 展开查看高亮内容                                        |
| Bash                 | 运行中显示最后两行; 成功显示结果摘要; 失败原因始终可见                             | 展开查看保留输出; 上游截断与日志路径收起时仍可见        |
| 工具失败             | 原工具的结果行保留失败                                                             | 展开看详情, 默认不重复错误正文                          |
| Thoughts             | 完成后 `Thoughts for 4s`, 运行中 `Thinking · Ns`                                   | `Thoughts:` 后跟实际样例正文, 不引入新图标              |
| 回答失败/中断        | 普通文字, 保留已收到的回答                                                         | 无工具标题、结果枝线、卡片或额外动作                    |

双行是两个逻辑层级, 不保证窄终端只有两行物理文本. 结果可换行. 收起时长标题用省略号, 展开恢复完整目标并对齐续行. 代码在行号内换行. 状态同时用文字和颜色表达. 子工具相对组标题缩进. 点击只改变当前条目, Ctrl+O 切换所有详情, 焦点留在 Pi 输入框.

两次聚合阈值和更严格的 Thoughts 边界是明确的原型选择. Edit 三行预览沿用旧紧凑预算, Write 在本轮更收敛. Web 标签分别对应现有 `web_search`、`fetch_content`、`get_search_content`, 没有重命名工具 API. 未加入检查器、Todo、Agents、Goal、后台任务或通知系统.

## 会话与覆盖

主会话修复分页边界的重复结果: 查看目录和代码、找到测试、核对 Web 文档、修改过滤逻辑、写测试并运行. 四行旧实现与返回游标在各样例中一致. 其他启动场景展示失败、无匹配、无输出、取消、上游截断、长 diff/路径、图片文本回退和回答中断. 欢迎页复用上一轮的旧版样式.

动态回放先思考四秒, 再模拟四秒测试, 完成后收起输出. Esc 中断回放并保留草稿. 执行、模型名、网页和测试均为样例, 不是真实 provider 或 shell 结果. 普通文本提交会被截获并放回输入框, 不支持任意编码对话. 场景通过启动参数切换, 控件不占产品界面.

此前其他可选/原生展示仍见[上一轮清单](conversation-coverage-2026-09-20.md). 本轮聚焦用户要求的会话和工具规则, 不为所有宿主子系统增加新界面.

## 验证边界

Terminal Control 导出真实 Pi 屏幕, 使用仓库 Latte/Mocha 主题及 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono` 字体栈. PNG、ANSI、文本按相同文件名保留. 截图断言覆盖预期文字、配色和字符裁切. 交互检查覆盖组/子项、Thoughts、Web 元数据、Write、Ctrl+O、草稿保留及动态完成/取消, 画廊链接各状态.

这些证据验证隔离离线原型, 不代表生产重放、真实工具执行、图片协议或原生窗口/compositor 验收. 无生产代码、依赖或持久格式变更, 移除原型无需迁移. 永久样例测试会重复截图驱动, 因此检查保留在可运行驱动和审查记录中.
