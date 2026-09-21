# Claude Code 工具折叠与原型修订

[English](../../../research/claude-code-tool-folding-2026-09-21.md)

本轮更新 [#101](https://github.com/jczhang02/pi-stuff/issues/101), 将连续活动聚合与单个工具的输出预览分开讨论. [可运行原型](../../../../prototypes/ui-session/README.md)已实现下方选定规则. 先前的“两次起聚合”和 Thoughts 切断规则被本轮取代.

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

## 原型采用的方案

| 层级     | 规则                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 活动摘要 | 成功 Read/Grep/Find/Ls 从一次起显示一行摘要, 后续相邻调用累计. 计数是调用数, 不是去重路径或匹配条数. 摘要不使用 `⎿`.                                            |
| Thoughts | 已完成 Thoughts 可加入相邻检索组, 摘要显示累计耗时. 展开后保留原始顺序和独立展开状态. 单独思考仍是 `Thoughts for Ns`, 运行中 Thinking 保持可见.                 |
| 边界     | 可见 assistant 正文、用户输入、状态、Bash、Edit、Write、Web、失败、取消及截断警告结束当前组. 静态投影忽略空白 assistant 条目. 运行中工具独立显示, 成功后才入组. |
| 组展开   | 点击摘要恢复紧凑子项, 再点一项看详情; Ctrl+O 切换全部. 新调用入组保留已有子项状态. 复用 Pi 鼠标支持, 不新增检查器.                                              |
| 工具正文 | Bash 保留前三行渲染输出; 运行中保留最后两行. Edit 保留三行带高亮的改动. Write/Web/检索正文按需展开. UI 隐藏行数与上游截断分别表达.                              |
| 错误     | 失败工具保留自身标题及原因, 失败 Bash 还保留三行证据. 回答失败或中断仍是普通文字.                                                                               |

这里有明确的设计取舍: Thinking 连续性参考当前 Claude, 不沿用旧 Pi 边界; 普通 Bash 继续独立, 包括 cat/grep 等命令, 原型不新增 shell 分类器; 失败检索不会藏进看似成功的计数. 这些是供讨论的预览选择, 不是生产契约, 也不宣称完全复刻 Claude. 用户消息、statusline、欢迎页维持已约定范围, 不引入 Agents、Todo 或后台界面.

`folding` 场景展示 Read → Thoughts → Grep、正文边界、Find → 失败 Read → 成功 Read, 然后运行 Bash. `live` 新增检索之间的思考. `tools` 静态页也采用相同聚合规则. 单个工具从属块仍只使用一个 `⎿`, 后续行对齐; 展开的独立工具各有自己的连接符.

## 验证与限制

截图驱动检查鼠标展开组及子项、组内 Thoughts 的时间顺序、Ctrl+O、草稿保留、两轮连续会话、中断重试、长历史导航和 60 列重排. 图片来自 Bun 1.4.0 下真实 Pi 0.85.1 终端输出; Pi 原型中的工具执行仍是模拟. 这验证可丢弃原型的交互, 不代表生产持久化、任意模型响应或原生 compositor 验收. 最终命令结果及独立审查见 PR #102.
