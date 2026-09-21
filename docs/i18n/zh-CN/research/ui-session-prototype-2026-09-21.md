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
| 检索边界             | 用户/assistant 正文、可见 Thoughts、修改、Bash、Web、失败/运行中调用、截断警告     | 不跨边界聚合; 静态场景预先分组; 连续检索成功后才加入组  |
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

动态回放先思考四秒, 再模拟四秒测试, 完成后收起输出. Esc 中断回放并保留草稿. 执行、模型名、网页和测试均为样例, 不是真实 provider 或 shell 结果. 静态场景中普通文本提交会被截获并放回输入框, 不支持任意编码对话. 场景通过启动参数切换, 控件不占产品界面.

此前其他可选/原生展示仍见[上一轮清单](conversation-coverage-2026-09-20.md). 本轮聚焦用户要求的会话和工具规则, 不为所有宿主子系统增加新界面.

## 验证边界

Terminal Control 导出真实 Pi 屏幕, 使用仓库 Latte/Mocha 主题及 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono` 字体栈. PNG、ANSI、文本按相同文件名保留. 截图断言覆盖预期文字、配色和字符裁切. 交互检查覆盖组/子项、Thoughts、Web 元数据、Write、Ctrl+O、草稿保留及动态完成/取消, 画廊链接各状态.

这些证据验证隔离离线原型, 不代表生产重放、真实工具执行、图片协议或原生窗口/compositor 验收. 无生产代码、依赖或持久格式变更, 移除原型无需迁移. 永久样例测试会重复截图驱动, 因此检查保留在可运行驱动和审查记录中.

## 后续修订: 终端副作用与会话深度

上一轮验收不完整: 静态场景没有检验提交请求后的连续会话, 固定截图颜色也泄漏到了前台启动器. 用户指出这两个问题后, #101 已重新打开, 不再把截图数量作为验收依据.

对 2184119 的外层 PTY 原始输出检查捕获到 `OSC 10;#cdd6f4` 和 `OSC 11;#1e1e2e`, 正常退出没有重置. [Ghostty 动态颜色文档](https://ghostty.org/docs/vt/osc/1x) 明确这两条指令设置前景色和背景色. [OSC 110/111](https://ghostty.org/docs/vt/osc/11x) 重置默认颜色, 并非恢复任意先前的动态覆盖值. Terminal Control [v1.2.1 session.rs](https://github.com/anomalyco/terminal-control/blob/v1.2.1/src/session.rs) 第 761–767 行转发子进程字节, 第 1465–1473 行退出清理只恢复终端模式, 没有恢复配色. 这解释了颜色变化, 无需假设 Ghostty 配置文件被改写.

现在前台启动不发送颜色设置或重置指令, 仅无头截图设置固定背景与前景. 启动器在隔离配置创建前只读取 Pi 的具体 theme 字段, 不复制账号设置. 其他主题及自动主题对需要显式指定支持的 `--theme`. 这一限制有依据: Terminal Control 的 [shot.rs](https://github.com/anomalyco/terminal-control/blob/v1.2.1/src/shot.rs) 第 624–641 行用固定颜色回答 OSC 10/11 查询, 在该宿主中运行 Pi 自动探测无法得到真实外层 Ghostty 背景. 无需改动依赖或外部终端配置.

`verify-foreground.ts` 在外层私有 PTY 中运行真实前台启动器, 检查直到正常退出的原始输出. 继承主题、显式浅色、显式深色、中断 replay 四种路径均通过, 禁止颜色设置及重置, 允许查询. 驱动还在 live 与 replay 中验证 Kitty 编码的 Escape; 将原始字节判断改成 Pi matchesKey 后, 这两条路径也通过. 这是输出协议边界验证, 不代表原生 compositor 验证.

新的默认 `live` 场景包含可编辑初始请求、流式思考与回答、增量探索分组、缺失文件、Web 请求失败后恢复和内容续读、回归测试失败、Edit 及验证通过. 第二次提交在独立文件补测试, 复现页内重复, 修改过滤逻辑, 最后在三个文件中通过十项测试. 完整输出超过单屏. Esc 保留部分输出并停止计时, 再提交会重试被中断的步骤; 运行中提交先中断当前回答. `live-error` 展示普通 HTTP 503 和重试. 两轮完成后继续提交只回顾现有结果, 不重放过期修改.

该流程仍是确定性的离线脚本. 编辑器、鼠标展开、Ctrl+O、历史滚动和计时实际工作, 不代表任意请求理解、生产提供方调用、持久化或通用 diff 算法. 静态场景继续用于局部对照. 新交互驱动验证实际提交、中断后停止、重试和两轮执行; 截图用于证明这些路径, 不作为完整度指标.

缩放验证发现了截图误判: Terminal Control 先更新画面尺寸, Pi 随后才重绘; 仅短暂等待空闲会保留旧宽度被裁切的内容. 独立完整 Pi 检查确认实际能够重排. 连续会话驱动现在等待仅在 60 列出现的完整代码续行, 再检查滚动到开头并返回当前草稿. 画面尺寸本身不能证明重新排版.

最终交互等待使用对应工具的结果行 (`Added 2 lines, removed 1 line · collapse`), 以及画面确实变化且包含首个测试的滚动视口. 通用的 `collapse` 会误匹配页脚, 已在屏内的输出尾部也可能让滚动检查在输入生效前通过. 这两处错误等待已修正, 受影响截图已重拍.

## 后续修订: 保留原生用户消息与状态栏

用户明确将这两部分移出改版范围. 静态和连续会话的用户消息直接创建 Pi 0.85.1 导出的 `UserMessageComponent`, 保留背景、留白、Markdown 行为和终端提示区标记. 原型额外边距只用于其他条目. 扩展不再调用 `setFooter`, 由 Pi 展示隔离会话的实际上下文与 `preview` 模型, 不再写死分支和模型. 所有保留的终端截图均已重拍. 两条连续会话路径的展开、历史导航及 60 列重排仍通过, 六条前台配色协议检查也通过.

## 结果枝线与命名

本原型中, 每个结果摘要开头使用一个 `⎿`; 摘要换行后用空格对齐, 不重复符号. 展开的正文保持缩进. 独立工具结果各有自己的标记, 所以展开探索组后可以看到多个. 单个结果有多行, 不等于有多个结果块. 保留的 `investigate` group-open/read-open 截图展示了这个区别.

精确续行规则来自本地旧快照 `21b636e`: `packages/pi-stuff/src/tool-display/operation-block-renderer.ts` 的 `renderEvidence` 只在第一条源文本的第一个换行片段使用子项前缀. `render.ts` 和组件集成测试也区分首行前缀与续行空格. 旧项目 `docs/research/pi-stuff-operation-block-dialog-study-20260829.md` 将该单元称为 **Operation Block**, 明确属于项目工作术语.

Claude Code 2.1.220 历史 PTY 报告能证明独立调用与聚合的区别, 但标准化后的文字省略了部分装饰符号. 更早的 agent 活动示意也不是精确截图, 不能据此声称当前 Claude 的所有工具都使用固定数量的枝线. [当前全屏文档](https://code.claude.com/docs/en/fullscreen#use-the-mouse)确认工具调用和结果一起展开, 没有规定这个字符的排版. 最初文档调研没有重新运行当前 Claude 的提供方夹具; 下方补充的直接执行研究已更新这一证据边界. 因而原型采用的是已核对的旧 Pi 续行规则, 不宣称是所有 Claude renderer 的统一契约.

在已查阅的 Claude 文档中未找到该布局的官方专名. 可称为 **工具调用/结果块 (tool invocation/result block)**, 项目内部可沿用 **Operation Block**. [Anthropic 工具文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#how-tool-use-works)将协议块称为 `tool_use` 和 `tool_result`, 没有定义视觉上的双行组件. 悬挂缩进描述续行对齐, 渐进式披露描述按需展开详情; 两者都不要求固定两行物理文本.

字符本身是 U+23BF, [Unicode 名称为 Dentistry Symbol Light Vertical and Bottom Right](https://www.unicode.org/charts/nameslist/n_2300.html). 这是字形名称, 不是工具 UI 的学名.

## 直接运行 Claude 的后续验证

[Claude Code 2.1.261 实测](claude-code-result-marker-2026-09-21.md)记录了 20 次真实客户端执行和 43 张终端截图, 直接验证本轮标记规则, 区分 classic/fullscreen、收起/展开、运行和中断. 该符号也会引出命令预览或中断提示, 因而 "从属内容连接符" 比单纯的已完成结果标记更准确. 原型继续保留已选定的旧 Pi/classic 风格, 并明确与 Claude 不同的地方.
