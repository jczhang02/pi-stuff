# Claude Code 工具折叠与原型修订

[English](../../../research/claude-code-tool-folding-2026-09-21.md)

本轮更新 [#101](https://github.com/jczhang02/pi-stuff/issues/101), 将连续活动聚合与单个工具的输出预览分开讨论. [可运行原型](../../../../prototypes/ui-session/README.md)已实现下方选定规则. 先前的"两次起聚合"和 Thoughts 切断规则被本轮取代.

## 真实客户端证据

实际运行官方 Claude Code 2.1.261, SHA256 为 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`, 使用 Terminal Control 1.2.1. 七组输入分别运行 classic/fullscreen, 共 14 次, 尺寸为 100 列 × 40 行. [28 张截图、工具结果及原始终端流](../../../../prototypes/ui-session/folding-reference/index.html)均已保留. 此前的 [20 次执行研究](claude-code-result-marker-2026-09-21.md)另覆盖输出预览、Edit、运行及中断.

真实 CLI 在隔离临时项目中执行 Read/Bash, 回答来自 localhost 的 Anthropic 兼容 SSE 夹具, 不使用真实模型推理. 独立 HOME/配置、明确批准的假密钥、禁用 MCP 和固定浅色主题避免访问账号或修改宿主配置. `CLAUDE_CODE_NO_FLICKER=0/1` 切换显示模式. 各序列最后发送 `PROBE_COMPLETE` 正文, 先截图收起状态, 再按 Ctrl+O 截图展开状态. ANSI 使用 gzip 原样保存; exchange JSON 格式化但不改变消息值. 启动参数与方法见前一份研究.

| 夹具       | 跨响应执行序列                                            | 两种模式观察结果, 差异另行注明                                                     |
| ---------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| cross      | Read a.txt → Read b.txt                                   | 一个 `Read 2 files`, API 响应边界不切组.                                           |
| prose      | Read a.txt → 可见正文 + Read b.txt                        | 正文前后各一个 `Read 1 file`.                                                      |
| whitespace | Read a.txt → 空白正文 + Read b.txt                        | 仍为一个摘要, 空白透明.                                                            |
| bridge     | Read a.txt → Bash true → Read b.txt                       | classic 中 Bash 独立; fullscreen 显示 `Read 2 files, ran 1 shell command`.         |
| mixed      | Read a.txt → Bash grep alpha a.txt → Bash ls → Read b.txt | 搜索、读取、列目录共用摘要. grep/ls 是真实 Bash 命令被分类, 不是原生 Grep/Ls 调用. |
| readfail   | Read a.txt → Read missing.txt → Read b.txt                | `Read 3 files` 隐藏失败, 展开才显示. 记录中的 `tool_result.is_error` 证实读取失败. |
| thought    | Read a.txt → thinking + Read b.txt                        | `Thought for 1s, read 2 files`; 展开恢复 Read → thinking → Read.                   |

这些结果只适用于该二进制和夹具, 不证明此版本的 Web、MCP、权限、上下文压缩或用户回合规则. 用户回合边界另有 pi-stuff-old 中官方 2.1.220 的历史实测. 前一轮测试中, classic Bash 保留三行预览与隐藏行数, fullscreen 更积极地聚合普通命令. Claude 并不存在一套与模式无关的折叠规则.

## 源码对照

读取的 pi-stuff-old 快照为 `21b636eaccc487a08362165ec69ffe364e8730fb`. `packages/pi-stuff/src/tool-display/retrieval-groups.ts` 根据检索元数据分类 Read/Grep/Find/Ls, 将可见正文、可见 Thinking、用户回合、修改、普通 Bash 和可见自定义消息视为边界. `activity-presentation.ts` 在摘要与原序调用之间切换, 不修改模型消息. `render.ts` 给 Bash 三行紧凑预览. 检索失败可留在旧组内, 透明基础设施调用的失败另行处理. 旧实现只作为本地参考, 没有导入代码.

另读取非官方[源码快照 6f6f12b](https://github.com/tanbiralam/claude-code/tree/6f6f12b37f529488b10e53928dd5508bb93535c7). 其来源及与已安装二进制的关系未获确认, 没有复制实现. [collapseReadSearch.ts](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/collapseReadSearch.ts)提供跨响应聚合、Thinking/空白透明、全屏聚合 shell 的线索. 这些线索与真实执行相符, 但不能据此认证该快照. [groupToolUses.ts](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/utils/groupToolUses.ts)另有同响应、同名工具的合组机制. 原型没有实现这层, 也没有从快照推导通用 MCP 折叠资格.

## 按本轮反馈修改后的方案

用户的四项修正取代最初预览选择. 成功的 Read/Grep/Find/Ls 与 WebSearch/WebFetch/WebRead 共享检索摘要. 失败、取消、警告、可见正文、用户回合、普通 Bash 及写入仍是边界. 展开调用与普通工具左侧对齐, 不增加层级缩进. Web 摘要区分搜索与内容读取次数, 展开后保留真实动作名称及元数据.

Thoughts 独立于检索组. Pi 0.85.1 的原生设置是 `hideThinkingBlock`: true 默认显示 `Thoughts for Ns`, false 默认显示 `Thoughts:` 与正文. 点击只改变当前思考. 原生 Ctrl+T 或 /settings 修改默认值并清除局部覆盖; Ctrl+O 只切换工具. 安装包 `assistant-message.js` 确认了默认显示与单条点击的区别, `interactive-mode.js` 在设置变化时保存配置并清除原生局部覆盖.

前台通过 Pi 导出的 SettingsManager 读取配置, 只将 theme 与 hideThinkingBlock 传入隔离宿主. 扩展使用可清理的监听器观察该宿主设置文件, 由 Pi 自己处理设置写入及快捷键, 不改变用户宿主配置. 截图明确默认隐藏思考, thoughts-visible 则以显示正文启动. 前台场景名称不会覆盖用户设置.

Edit 改为单列行号: 删除使用旧行号, 新增及上下文使用新行号. +/- 标记和语义增删底色共同区分改动, 同时保留代码语法颜色. 旧、新源码分别高亮, 避免混合两个版本导致语法解析失真. 收起保留最多六行渲染后的改动, 展开恢复上下文与完整目标. 换行续行不重复行号或增删标记. 这是统一 diff 预览, 不是左右双栏或新增 diff 算法. Bash 保留三行预览. 组摘要不用结果连接符, 独立工具从属块各保留一个连接符并对齐续行.

folding 场景检查展开后的平齐与独立 Thoughts. Web 截图包含搜索、抓取、内容读取的聚合及展开. 用户消息、页脚和欢迎页不变, 不引入 agents、todo、后台界面或检查器.

## 验证与限制

截图驱动检查鼠标展开组及子项、组内工具平齐、原生 Hide thinking 切换与独立 Thoughts、Ctrl+O、草稿保留、两轮连续会话、中断重试、长历史导航和 60 列重排. 图片来自 Bun 1.4.0 下真实 Pi 0.85.1 终端输出; Pi 原型中的工具执行仍是模拟. 这验证可丢弃原型的交互, 不代表生产持久化、任意模型响应或原生 compositor 验收. 最终命令结果及独立审查见 PR #102.
