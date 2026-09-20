# UI 方向研究与终端预览

[English](../../../research/ui-direction-2026-09-20.md)

本次研究覆盖 Pi Stuff 的整个 UI. 旧界面是参考基础, 用户没有要求推翻重做. 单行工具展示和 diff 不易阅读, 是整体体验中的具体问题. 这次先提供改动清单、多源研究和一组完整界面, 再讨论细节.

**状态:** 讨论提案, 尚未批准为生产规格. 研究日期: 2026-09-20. 任务: [#99](https://github.com/jczhang02/pi-stuff/issues/99), Beads `pi-stuff-cgl.1`. 基线: `cd0f174`. Pi 宿主: `0.85.1`; Bun: `1.4.0`.

## 已有内容与需要处理的地方

当前 Pi Stuff 在 `index.ts` 注册 Web 和 RTK; `/rtk` 是现有自定义面板, 主题也已经实现. 本基线还没有会话 UI、工具展示层、会话命名、Goal、Todo、subagents、后台工作、BTW、通知或共享诊断. 原生 Pi 仍提供会话、输入框、模型/会话选择器及自己的工具展示. 因此下表区分旧能力恢复和当前能力改进.

| 区域                     | 旧版参考                                                                        | 本轮方向                                                               | 边界 / 待讨论                                                             |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 欢迎页与会话身份         | 带框 Pi logo、模型、目录、加载清单; 会话命名                                    | 保留身份与实用提示. 预览采用较短的 logo 区域, 留出输入空间.            | 密度是候选项, 不代表决定删除旧欢迎页. 会话命名仍是独立能力.               |
| 用户与 assistant 消息    | 用户卡片、Markdown、文件/代码/skill 样式                                        | 保留会话阅读顺序和 Markdown, 统一正文与工具之间的间距.                 | 优先使用原生渲染; 原生用户消息没有与自定义消息相同的任意替换接口.         |
| Thinking 与当前活动      | 紧凑 thinking 行、工作状态                                                      | 简短操作状态和面向用户的解释分别呈现; 保留宿主支持的展开能力.          | 不编造进度百分比. 旧 thinking 样式修改了宿主内部实现.                     |
| 输入与补全               | 文件/skill 引用、语法提示、草稿恢复                                             | 保留真实 Pi 编辑器与原生按键. 关闭临时面板后恢复草稿与焦点.            | 不仅为外观另造一个编辑器.                                                 |
| 状态栏与最新请求         | 按优先级保留模型、thinking、路径、Git、上下文、费用/用量、扩展状态; 最新 prompt | 模型/项目/上下文保持在底部, 结合实际宽度比较紧凑与完整密度.            | 预览使用较克制的两行样例, 没有决定删除哪些真实指标. 未知用量不能显示为零. |
| 检索工具                 | Read/search/文件树摘要及操作分组                                                | 展示动作、目标、关键结果和有用片段, 保留全部返回文本的查看入口.        | 很短的结果仍可用一行; 不再强制所有工具只有一行.                           |
| Bash 与长操作            | 命令、计时、进度/输出、退出状态                                                 | 保留命令与退出状态, 预览有用输出并支持展开.                            | 运行、失败、取消、完成必须区分; 完成不等于成功.                           |
| Write/Edit/Patch 与 diff | 文件操作块与改动计数                                                            | 路径、计数、上下文放在一起, 在完整会话中预览 unified hunk.             | 只是一个候选, 不声称是最好的 diff UI. 大型/多个 hunk 后续单独比较.        |
| 工具历史与详情           | `/tools`、检索分组、详情页                                                      | 原生全宽逐级进入的详情页, 有界输出和 `[ ]` 导航.                       | 完整路径/内容必须可查, 截断限制需要可见. 不增加持久侧栏.                  |
| 图片、附件与可视输出     | 图片/媒体和 fenced visualization                                                | 内容留在所属消息中, 保留文字/路径退路.                                 | 终端图片协议与截图导出需要单独用真实媒体验证.                             |
| 提示、错误与恢复         | 保留的诊断和通知展示                                                            | 会话中说明失败操作、原因、实际结果和下一步.                            | 测试失败不表示修改已回滚. 需要处理的错误不定时消失.                       |
| 共享设置与命令面板       | `/ui` 及共同的 focused-dialog 控制器                                            | 复用 SettingsList/SelectList、固定 Esc、草稿/焦点恢复和有界报告.       | 旧翻页别名不覆盖当前 60% 键盘规则. 不采用顶部横向 tabs 或持久侧边导航.    |
| Goal                     | 状态、预算、时长与目标菜单                                                      | 目标状态和任务清单保持区分, 简短状态配合需要时打开的详情.              | 目标语义属于后续功能, UI 预览不能定义完成/取消保证.                       |
| Todo                     | 输入框上方清单和 TaskGet/TaskList 工具详情                                      | 基本参考旧清单, 预览完整列表和紧凑当前步骤.                            | 仅样例; 当前基线没有 Todo 组件或执行契约.                                 |
| Subagents 与后台工作     | Agent roster 和 `/agents` 详情, 独立 `/tasks` 后台运行时/面板                   | 基本参考旧 agent 行, 显示角色、当前工作和完成状态; 后台任务保持可区分. | #64/#93/#97 保留原所有者. 本次不确定停止语义和 transcript 路由.           |
| BTW 与通知               | 独立侧问会话、通知设置                                                          | 临时会话保留主输入草稿, 通知绑定有意义的结果.                          | 发送渠道、隐私和历史保留仍是功能决策, 本研究不授予新权限.                 |

可以依次讨论共享外框与设置、会话与工具、Goal/Todo/agents/后台/BTW 接入. 这是讨论顺序, 不承诺实现依赖关系, 也不表示所有组件已经存在.

## 本地依据

旧版参考 `pi-stuff-old` 的 `21b636ea` 快照. 以下路径均在 `packages/pi-stuff/src/` 下:

- `suite-runtime.ts`: 会话 UI 先建立共享展示, 再接入其他能力.
- `conversation-ui/welcome-header.ts`, `statusline-render.ts`, `statusline-session.ts`: 欢迎清单、按优先级收缩的状态栏和最新 prompt.
- `conversation-ui/input-enhancement.ts`, `input-highlighting.ts`, `command-dialog.ts`, `dialog-layout.ts`: 编辑器行为与 focused-dialog 生命周期.
- `conversation-ui/thinking-line.ts`, `user-message-display.ts`: 对宿主内部的适配. 这是迁移风险, 不应据此直接复制补丁.
- `tool-display/retrieval-groups.ts`, `activity-presentation.ts`, `tool-dialog.ts`, `bash-operation-presentation.ts`, `file-operation-presentation.ts`, `operation-block-renderer.ts`: 紧凑、分组、详情展示.
- `todo/todo-overlay.ts`, `subagents/src/ui/agent-roster.ts`, `agent-dialog.ts`, `agent-transcript.ts`, `background-work/src/tasks-dialog.ts`: Todo、agent、后台工作的独立区域.
- `goal/src/menu.ts`, `goal/src/terminal-tools.ts`, `btw/btw-ui.ts`, `notification/notification-settings-dialog.ts`, `notification/runtime.ts`: 其余面板与生命周期结果.
- `conversation-ui/diagnostics.ts`, `diagnostic-notice.ts`, `todo/index.ts`, `background-work/index.ts`: 进程内诊断、Todo 工具和后台事件所有权.

已经查看旧 README 截图作为设计参考, 它们不能证明当前行为. 当前 `src/rtk/panel.ts` 已示范 SelectList/SettingsList、固定 Esc、小窗口提示和有界报告. 旧行为与当前规范不同时, 以当前 `design.md` 为准.

## 其他 harness 的贡献

以下内容区分上游观察事实和本次预览的设计判断. 它们不是新的 Pi Stuff 要求. 源码固定到已检查的 revision, 在线文档按研究日期访问.

| 来源                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 观察到的行为                                                                                     | 本次预览的判断                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode) 与 [fullscreen](https://code.claude.com/docs/en/fullscreen)                                                                                                                                                                                                                                                                                                                                                                          | Composer 始终可用, transcript 和 task 可以单独查看. Fullscreen diff 可以脱离普通消息流单独检查.  | 保留 Pi 的输入 dock 和显式详情视图. 不复制 Claude 的按键映射, 也不采用持久 diff 侧栏.                     |
| [Claude statusline](https://code.claude.com/docs/en/statusline)                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Statusline 脚本接收结构化的模型, workspace, 用量和上下文字段.                                    | 将状态数据与渲染分开. 旧 Pi Stuff 的按优先级排列 footer 已是有用参考. 缺失数据不应被看似合理的计数器替代. |
| [Codex activity widget](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/status_indicator_widget.rs)                                                                                                                                                                                                                                                                                                                                                                    | Composer 附近有有界的忙碌状态行, 包含 elapsed time 和中断提示; 额外详情有高度预算.               | 当前活动需要稳定位置. 它的密度必须和 Todo, agent 行一起评估. 样例不宣称已经存在真实的中断生命周期.        |
| [Codex tool cells](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/history_cell/dynamic.rs) 与 [plans](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/history_cell/plans.rs)                                                                                                                                                                                                                                           | Tool 状态/时长和短输出并存; plan 行显示 completed/total 和条目状态.                              | 采用保留详情的有用摘要, 同时为 Todo 显示计数和当前项. 上游的具体行数限制不构成 Pi 的要求.                 |
| [Codex follow control](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/transcript_view/follow_control.rs) 与 [approval outcomes](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/history_cell/approvals.rs)                                                                                                                                                                                                             | 历史位置有明确的回到底部控制. Approval outcome 区分 denied, expired, aborted 和 accepted scopes. | 保留历史阅读控制和清晰 outcome. 这些有状态交互在采用前需要由宿主支持的独立验证.                           |
| [OpenCode TUI](https://opencode.ai/docs/tui/) 与 [autocomplete source](https://github.com/anomalyco/opencode/blob/ebb7b76eca82342642c78645109e865614533827/packages/tui/src/component/prompt/autocomplete.tsx)                                                                                                                                                                                                                                                                                                        | 文件引用, shell mode 和 commands 共用 prompt; completion 使用有界的可选列表.                     | 复用 Pi 的原生 completion grammar. 不为复刻另一产品的外观而替换能正常工作的编辑器.                        |
| [OpenCode permission view](https://github.com/anomalyco/opencode/blob/ebb7b76eca82342642c78645109e865614533827/packages/tui/src/routes/session/permission.tsx)                                                                                                                                                                                                                                                                                                                                                        | 宽窄布局使用不同的 diff 展示, requested scope 和 decision 放在一起.                              | 响应式内容有用. 当前 Pi Stuff 设计规则排除了在其他产品中出现的 tabs 和持久侧边导航.                       |
| [Gemini status row](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/StatusRow.tsx) 与 [configuration](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/docs/reference/configuration.md)                                                                                                                                                                                                             | Activity, mode 和 context 有各自位置; tool density, thinking 和 footer visibility 可配置.        | 在 `/ui` 中试验密度控制. 可配置字段更多不等于默认设置更好.                                                |
| [Gemini tool grouping](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/messages/ToolGroupMessage.tsx), [checklist](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/Checklist.tsx), [subagent status](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/messages/SubagentProgressDisplay.tsx) | Compact/standard tool groups, checklist counts 和明确的 agent lifecycle states 是不同视图.       | 保留 tool family 的差异和旧 Todo/agent 样式, 统一它们的间距和状态语言. 单一的通用 log 行会丢失有用语义.   |

共同点中最值得采用的是: 默认显示简短且有用的内容, 同时可靠地进入详情. 我建议把这个原则用于各类 tool, 保留旧的整体外框. 如果真实长会话显示 excerpt 本身已经压垮 transcript, 这个判断会改变; 解决方向应是选择性分组和密度控制, 而不是隐藏所有结果.

本次检查的源码 revision 是 Codex `5c5308fc9a9ee789049d646ef11e5400384b9c6f`, OpenCode `ebb7b76eca82342642c78645109e865614533827`, Gemini CLI `cfbcaa8df13ea4610bb379b377b56d62980c0032`. OpenCode v1/v2 文档描述的是不同表面; 这里只沿用上面链接所支持的事实. 本次比较没有安装或执行任何外部 harness.

## Pi 包与公开实现接缝

这些快照来自原始源码, 不是已采用的依赖. "采用"表示预览中可以直接参考的模式, "改造"表示先按 Pi 0.85.1 核对后再借鉴, "拒绝"表示它与用户要求的旧界面参考或 surface 边界冲突.

宿主证据来自项目 `node_modules` 中的 Pi 0.85.1, 运行时是 Bun 1.4.0. 全局 Pi 0.86.0 是另一套安装, 不用于本次 capture.

| 包和固定源码                                                                                                                             | 已验证事实                                                                                                                                                                                                  | 预览判断                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [pi-tidy-tools 0.4.2, `da148ac`](https://github.com/mikeyobrien/pi-tidy-tools/tree/da148ac7f33371d9855632ea62f288ba929357d0)             | 重新注册七个内置工具, 委托原执行逻辑, 用宽度感知的展开状态渲染紧凑的调用和结果卡片. default/reasoning 模式加入必填 `reasoning` 字段; result 模式保留原生 schema.                                            | 改造其 renderer 和截断模式. 对纯视觉预览拒绝必填 reasoning 字段.                                                       |
| [pi-powerline 0.10.0, `14dae45`](https://github.com/jwu/pi-powerline/tree/14dae450efd86b841e463b433e988c35326ede6d)                      | 组合 custom editor, editor 上方 breadcrumb widget, custom footer, custom header 和项目设置. Peer 范围声明 Pi `>=0.84.0`.                                                                                    | 改造其 surface 清单和窄屏优先级. 不采用其 footer/editor 单一所有权或硬编码 glyph/color 选择.                           |
| [pi-powerline-footer 0.17.1, `d271772`](https://github.com/nicobailon/pi-powerline-footer/tree/d2717726637f8f664b83bf1188fd3ff909d9a779) | 拥有 powerline footer/editor, live status, stash/queue 状态以及 welcome/quote overlay, 同时把 transcript scrolling 留给 Pi.                                                                                 | 改造其 native-layout 和异步刷新思路. 本预览拒绝其 overlay, 大量快捷键和竞争性的 footer/editor owner.                   |
| [narumiruna/pi-extensions, `022eccd`](https://github.com/narumiruna/pi-extensions/tree/022eccdf9719c27fb40c732702ebdcb6c713382f)         | `pi-tui-kit` 0.65.0 提供 typed vertical menu, detail/review 流程, cancellation 和 disposal. `pi-statusline` 0.50.2 拥有 `setFooter`, 并记录了与其他 footer owner 的冲突. 该 monorepo 当前以 Pi 0.86.0 开发. | 在 0.85.1 核对后改造 menu lifecycle 和 Esc-as-back 语义. 在确认 zero-major API 与 host version 前, 拒绝直接采用该依赖. |
| [pi-subagents 2.2.3, `de24dbb`](https://github.com/jwu/pi-subagents/tree/de24dbb5f4f3b6b4bac3dc7ad239a34fb85b430f)                       | 使用公开的 `renderCall`/`renderResult` 渲染折叠和展开的 subagent 卡片, 有界 tool log 以及 usage/context summary.                                                                                            | 改造卡片层级和阈值. 对纯显示预览拒绝引入其 subagent runtime 或 tool ownership.                                         |
| [pi-messenger 0.15.2, `09937ed`](https://github.com/nicobailon/pi-messenger/tree/09937ed647a1b07a3b595bf75943feacb80ff123)               | 使用 additive `setStatus`, custom message rendering 和 `tool_call`/`tool_result` lifecycle 更新, 但主 UI 是可自动打开的 tabbed overlay.                                                                     | 改造 status 和 lifecycle observation. 拒绝其 tabs, 类 sidebar 的 crew view, auto-open 和 file-coordination domain.     |
| [tmustier/pi-extensions, `09706a7`](https://github.com/tmustier/pi-extensions/tree/09706a7448d1715796d4d849e75ae2abe9be1f86)             | `files-widget` 0.2.0 把 `setWidget` 和 non-overlay `ctx.ui.custom` 组合成文件浏览, review, search 和 comment 流程. 它需要 `bat`, `delta` 和 `glow`.                                                         | 改造 focused review 流程和 `[ ]` 导航. 外部 CLI 工具保持可选, 不把 file browser 加到默认 shell.                        |
| [pi-footer-display 0.2.1, `86d65c2`](https://github.com/10ego/pi-footer-display/tree/86d65c2f4bbd0d8be6bbc54f99d0ac562998a5bf)           | 只发布 `ctx.ui.setStatus("pr-footer", text)`, 保留 Pi 原生 model, token 和 footer 渲染, 同时异步跟踪 Git/PR 状态.                                                                                           | 采用这种 additive status ownership 模式. 它是保留旧 footer 的最干净参考.                                               |

### 公开接缝边界

Pi 0.85.1 的 [extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts) 公开了 `setStatus`, keyed `setWidget`, `setHeader`, `setFooter`, `setEditorComponent`, `registerMessageRenderer`, `registerEntryRenderer` 以及每个工具的 `renderCall`/`renderResult`. Custom message fixture 只能证明该 custom type 的 renderer. 它不会替换普通 assistant text, thinking 或原生 `read`/`bash` card.

原生 built-in card 有公开路径: 注册相同的 tool name, 委托 Pi 的 `create*Tool` 实现, 保留精确的 result/details shape, 只覆盖需要的 render slot. Pi 在 [built-in override guide](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md) 中记录了 per-slot renderer inheritance, 因此这是一条有文档依据的原生工具实现路径. 普通 assistant 和 thinking component 没有等价的公开 renderer hook. `registerMarkdownTransformer` 可以看到 `assistant-thinking`, 但只能在 Pi 渲染前转换 Markdown, theme colors 和 hidden label 仍是受支持的控制点.

`setStatus` 是 additive. `setFooter` 和 `setHeader` 替换 Pi 拥有的 surface, `setEditorComponent` 替换 editor, 所以每一个都需要明确的 owner 和 restore path. 本次隔离预览由 Pi Stuff 单独拥有 header/footer. 生产中如何与其他包共存仍待确定; 已有 footer owner 时, additive status 是更稳妥的接入方式. 旧 custom UI 仍是参考, 上述包的研究不会自动产生新要求.

实际 sample preview 只使用 fixture messages 和静态状态. 它没有执行 live provider, agent turn, tool call, test command 或 repository mutation, 因此截图不能证明 native runtime behavior.

## 整套预览的方向

预览保留滚动会话和 Pi 的输入区. 欢迎页、正文、工具、任务行和 footer 使用同一活动主题. 工具块按动作/目标、结果、内容排列, 高度由有用内容决定, 不强制单行.

需要判断的是完整工作过程: 用户能否看到 agent 刚刚解释了什么、现在做什么、是否需要介入, 同时还能输入. 如果任务或状态指标挤占这些内容, 单独把 diff 做漂亮也不能解决问题.

样例围绕同一任务: 去掉跨页重复搜索结果, 保留顺序和游标. 每个场景是选取的阶段, 不是一次真实编码过程的录像. 测试数量、模型、费用、时长、agent 结果和加载清单都是示例数据. 扩展不调用 provider、真实 agent、测试命令, 也不修改仓库.

完整证据见[可运行原型](../../../../prototypes/ui-direction/README.md)和截图画廊. 工具密度、footer 字段、欢迎页密度、大 diff 导航仍待结合图片讨论. 生产入口不加载此原型.
