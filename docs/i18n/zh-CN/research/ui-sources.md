# UI source research / UI 来源研究

[English](../../../research/ui-sources.md)

2026-09-20 的来源记录, 基于 pi-stuff-old 21b636ea、产品 cd0f174 与 Pi 0.85.1. 下方包和 harness 比较保留原研究判断, 不代表现行需求. 当前规则统一见 [UI spec](../ui-spec.md).

## 本地依据

旧版参考 `pi-stuff-old` 的 `21b636ea` 快照. 以下路径均在 `packages/pi-stuff/src/` 下:

- `suite-runtime.ts`: 会话 UI 先建立共享展示, 再接入其他能力.
- `conversation-ui/welcome-header.ts`, `statusline-render.ts`, `statusline-session.ts`: 欢迎清单、按优先级收缩的状态栏和最新 prompt.
- `conversation-ui/input-enhancement.ts`, `input-highlighting.ts`, `command-dialog.ts`, `dialog-layout.ts`: 编辑器行为与 focused-dialog 生命周期.
- `conversation-ui/thinking-line.ts`, `user-message-display.ts`: 对宿主内部的适配. 这是迁移风险, 不应据此直接复制补丁.
- `tool-display/retrieval-groups.ts`, `activity-presentation.ts`, `tool-dialog.ts`, `bash-operation-presentation.ts`, `file-operation-presentation.ts`, `operation-block-renderer.ts`: 紧凑、分组、详情展示.
- `conversation-ui/diagnostics.ts`, `diagnostic-notice.ts`: 进程内诊断和保留的提示.

已经查看旧 README 截图作为设计参考, 它们不能证明当前行为. 当前 `src/rtk/panel.ts` 已示范 SelectList/SettingsList、固定 Esc、小窗口提示和有界报告. 旧行为与当前规范不同时, 以当前 `design.md` 为准.

## 其他 harness 的贡献

以下内容区分上游观察事实和本次预览的设计判断. 它们不是新的 Pi Stuff 要求. 源码固定到已检查的 revision, 在线文档按研究日期访问.

| 来源                                                                                                                                                                                                                                                                                                      | 观察到的行为                                                                                     | 本次预览的判断                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode) 与 [fullscreen](https://code.claude.com/docs/en/fullscreen)                                                                                                                                                              | Composer 始终可用, transcript 和 task 可以单独查看. Fullscreen diff 可以脱离普通消息流单独检查.  | 保留 Pi 的输入 dock 和显式详情视图. 不复制 Claude 的按键映射, 也不采用持久 diff 侧栏.                     |
| [Claude statusline](https://code.claude.com/docs/en/statusline)                                                                                                                                                                                                                                           | Statusline 脚本接收结构化的模型, workspace, 用量和上下文字段.                                    | 将状态数据与渲染分开. 旧 Pi Stuff 的按优先级排列 footer 已是有用参考. 缺失数据不应被看似合理的计数器替代. |
| [Codex activity widget](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/status_indicator_widget.rs)                                                                                                                                                        | Composer 附近有有界的忙碌状态行, 包含 elapsed time 和中断提示; 额外详情有高度预算.               | 当前活动需要稳定位置. 密度需要宿主支持的验证. 样例不宣称已经存在真实的中断生命周期.                       |
| [Codex tool cells](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/history_cell/dynamic.rs)                                                                                                                                                                | Tool 状态/时长和短输出并存.                                                                      | 采用保留详情的有用摘要. 上游的具体行数限制不构成 Pi 的要求.                                               |
| [Codex follow control](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/transcript_view/follow_control.rs) 与 [approval outcomes](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/history_cell/approvals.rs) | 历史位置有明确的回到底部控制. Approval outcome 区分 denied, expired, aborted 和 accepted scopes. | 保留历史阅读控制和清晰 outcome. 这些有状态交互在采用前需要由宿主支持的独立验证.                           |
| [OpenCode TUI](https://opencode.ai/docs/tui/) 与 [autocomplete source](https://github.com/anomalyco/opencode/blob/ebb7b76eca82342642c78645109e865614533827/packages/tui/src/component/prompt/autocomplete.tsx)                                                                                            | 文件引用, shell mode 和 commands 共用 prompt; completion 使用有界的可选列表.                     | 复用 Pi 的原生 completion grammar. 不为复刻另一产品的外观而替换能正常工作的编辑器.                        |
| [OpenCode permission view](https://github.com/anomalyco/opencode/blob/ebb7b76eca82342642c78645109e865614533827/packages/tui/src/routes/session/permission.tsx)                                                                                                                                            | 宽窄布局使用不同的 diff 展示, requested scope 和 decision 放在一起.                              | 响应式内容有用. 当前 Pi Stuff 设计规则排除了在其他产品中出现的 tabs 和持久侧边导航.                       |
| [Gemini status row](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/StatusRow.tsx) 与 [configuration](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/docs/reference/configuration.md) | Activity, mode 和 context 有各自位置; tool density, thinking 和 footer visibility 可配置.        | 在 `/ui` 中试验密度控制. 可配置字段更多不等于默认设置更好.                                                |
| [Gemini tool grouping](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/messages/ToolGroupMessage.tsx)                                                                                                                            | Compact 和 standard tool groups 是不同视图.                                                      | 保留 tool family 的差异并统一间距和状态语言. 单一的通用 log 行会丢失有用语义.                             |

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
| [pi-subagents 2.2.3, `de24dbb`](https://github.com/jwu/pi-subagents/tree/de24dbb5f4f3b6b4bac3dc7ad239a34fb85b430f)                       | 使用公开的 `renderCall`/`renderResult` 渲染折叠和展开的 subagent 卡片, 有界 tool log 以及 usage/context summary.                                                                                            | 仅作来源记录. Subagents 不在本轮范围内, 不提出实现建议.                                                                |
| [pi-messenger 0.15.2, `09937ed`](https://github.com/nicobailon/pi-messenger/tree/09937ed647a1b07a3b595bf75943feacb80ff123)               | 使用 additive `setStatus`, custom message rendering 和 `tool_call`/`tool_result` lifecycle 更新, 但主 UI 是可自动打开的 tabbed overlay.                                                                     | 仅作来源记录. BTW、后台工作和通知不在本轮范围内, 不提出实现建议.                                                       |
| [tmustier/pi-extensions, `09706a7`](https://github.com/tmustier/pi-extensions/tree/09706a7448d1715796d4d849e75ae2abe9be1f86)             | `files-widget` 0.2.0 把 `setWidget` 和 non-overlay `ctx.ui.custom` 组合成文件浏览, review, search 和 comment 流程. 它需要 `bat`, `delta` 和 `glow`.                                                         | 改造 focused review 流程和 `[ ]` 导航. 外部 CLI 工具保持可选, 不把 file browser 加到默认 shell.                        |
| [pi-footer-display 0.2.1, `86d65c2`](https://github.com/10ego/pi-footer-display/tree/86d65c2f4bbd0d8be6bbc54f99d0ac562998a5bf)           | 只发布 `ctx.ui.setStatus("pr-footer", text)`, 保留 Pi 原生 model, token 和 footer 渲染, 同时异步跟踪 Git/PR 状态.                                                                                           | 采用这种 additive status ownership 模式. 它是保留旧 footer 的最干净参考.                                               |

### 公开接缝边界

Pi 0.85.1 的 [extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/extensions/types.ts) 公开了 `setStatus`, keyed `setWidget`, `setHeader`, `setFooter`, `setEditorComponent`, `registerMessageRenderer`, `registerEntryRenderer` 以及每个工具的 `renderCall`/`renderResult`. Custom message fixture 只能证明该 custom type 的 renderer. 它不会替换普通 assistant text, thinking 或原生 `read`/`bash` card.

原生 built-in card 有公开路径: 注册相同的 tool name, 委托 Pi 的 `create*Tool` 实现, 保留精确的 result/details shape, 只覆盖需要的 render slot. Pi 在 [built-in override guide](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md) 中记录了 per-slot renderer inheritance, 因此这是一条有文档依据的原生工具实现路径. 普通 assistant 和 thinking component 没有等价的公开 renderer hook. `registerMarkdownTransformer` 可以看到 `assistant-thinking`, 但只能在 Pi 渲染前转换 Markdown, theme colors 和 hidden label 仍是受支持的控制点.

`setStatus` 是 additive. `setFooter` 和 `setHeader` 替换 Pi 拥有的 surface, `setEditorComponent` 替换 editor, 所以每一个都需要明确的 owner 和 restore path. 早期候选替换 header/footer. 当前原型仅替换 header, footer 保持 Pi 原生. 生产中如何与其他包共存仍待确定; 已有 footer owner 时, additive status 是更稳妥的接入方式. 旧 custom UI 仍是参考, 上述包的研究不会自动产生新要求.

实际 sample preview 只使用 fixture messages 和静态状态. 它没有执行 live provider, agent turn, tool call, test command 或 repository mutation, 因此截图不能证明 native runtime behavior.

## 终端配色问题的依据

初版前台启动器 2184119 将 OSC 10/11 配色设置发往外层终端. 当前启动器既不设置也不重置配色, 只有隔离截图 PTY 设置确定颜色. [Ghostty 动态颜色](https://ghostty.org/docs/vt/osc/1x)与[重置语义](https://ghostty.org/docs/vt/osc/11x)说明重置不能恢复任意先前覆盖值. Terminal Control [v1.2.1 session.rs](https://github.com/anomalyco/terminal-control/blob/v1.2.1/src/session.rs)会转发子进程字节. [shot.rs](https://github.com/anomalyco/terminal-control/blob/v1.2.1/src/shot.rs)以回退颜色回答查询, 因此宿主自动探测不能确定外层 Ghostty 配色. 保留的前台验证器检查继承/显式主题、普通 Esc 和 Kitty Esc 共六条路径, 不代表原生窗口或 compositor 验收.
