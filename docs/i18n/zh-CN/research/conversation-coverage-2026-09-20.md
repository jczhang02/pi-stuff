# Conversation 覆盖与语法高亮 diff 方案

[English](../../../research/conversation-coverage-2026-09-20.md)

盘点基线产品中会进入会话的内容, 并保留 diff 布局的来源比较. 当前显示规则见 [UI spec](../ui-spec.md).

## 基线与范围

当时检查的产品基线为 `cd0f174`, 与预览分支的产品基线一致. 本地 Pi 为 0.85.1, Bun 为 1.4.0. `index.ts` 注册 Web 和 RTK. 用户、assistant、工具及会话摘要的大部分展示由 Pi 提供. 旧 Pi Stuff 和外部包提供参考, 不代表它们的功能已进入当前 Pi Stuff.

Todo、subagents、Goal、后台任务、BTW 和会话命名继续排除在设计工作外. 当前会话内已有的错误和诊断提示仍需列出, 这不等于新增通知系统. 不恢复独立工具检查器, 生产详情入口继续复用 Pi 原生单工具点击展开.

## 当前输出的证据边界

目录按渲染路径和有意义的状态组织, 不枚举每种工具与每种错误的所有组合. Read、Write、Edit、Bash、Grep、Find、Ls 分别配图. Powershell 共用 Shell renderer, 不是 Linux 下另一个默认工具. Web 三个工具使用通用工具卡; RTK 改写 Bash 参数/结果, 错误提示走宿主会话提示路径. 两个扩展目前都没有自定义 conversation renderer.

宿主还会显示用户和 assistant Markdown、thinking、回答终止状态、直接 `!`/`!!` Shell 输出、skill 调用、压缩/分支摘要和命令状态/错误文本. 扩展 custom message/entry 及有条件出现的宿主公告属于可用参考能力, 不代表当前 Pi Stuff 已注册这些功能. 会话摘要列入输出盘点, 不表示重新设计会话命名或管理.

图片向原生组件传入固定数据. 对没有公开组件的宿主内部文本组合, 必要时使用相同 Pi Text/Markdown 基础组件复现, 并在映射表和参考附录中注明. 图片验证给定状态的外观, 不代表真实 provider、流式事件顺序、鼠标展开、历史回放或各种终端图片协议均已验收. 图片均为真实终端导出, 消息及执行结果为样例.

当前源码: [产品入口](https://github.com/jczhang02/pi-stuff/blob/cd0f174f65bdbacdca265646b4e191943063d0ac/index.ts), [Web 工具](https://github.com/jczhang02/pi-stuff/blob/cd0f174f65bdbacdca265646b4e191943063d0ac/src/web/tools.ts), [RTK 注册](https://github.com/jczhang02/pi-stuff/blob/cd0f174f65bdbacdca265646b4e191943063d0ac/src/rtk/register.ts), [Pi 会话分发](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts), [原生 renderer 映射](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/tools/renderers/index.ts).

旧 Pi Stuff 按 `21b636eaccc487a08362165ec69ffe364e8730fb` 核对. 其欢迎框、消息前缀和工具层次用于候选区. 旧版检索分组、apply_patch、Goal/Todo/subagent/后台任务和检查器属于历史参考, 不计入当前输出覆盖. 外部 Pi package 只提供 diff 技法参考, 不扩展当前产品清单.

此版本不会把用户 ImageContent 直接画在 transcript 中: `getUserMessageText` 只提取文本块. 粘贴图片时, 编辑器插入临时图片路径, 该路径之后可能作为普通用户文本显示. 工具结果的图片退路是另一条渲染路径, 不能据此虚构用户图片卡片.

Web 样例向 Pi 传入当前 createWebTools 的真实工具定义, 不调用 execute. 已注册工具的默认视图折叠时显示十行结果, 与缺失定义的历史回退路径不同. 扩展错误图通过隔离临时扩展触发真实宿主错误处理, 错误消息和堆栈是样例. 活动提示使用暂停的 Loader 样例, 不作为真实会话位置的证据.

<!-- catalog-table -->

## 展示与图片逐项对应

每行链接一张完整终端图. 有条件出现或扩展可选的内容在画廊中单独标注. 这里统计展示状态, 不把图片数量当成功能数量.

| Display / 展示                                                                                                                                                   | Group / 分组              | Renderer evidence / 渲染依据                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| [Collapsed read, skill read and generic output](../../../../prototypes/ui-session/native-reference/catalog-tool-preview-states-catppuccin-latte-120x40-main.png) | built-in tools            | Pi 0.85.1 native renderer; static tool data, Web page data via current Content formatter         |
| [Empty retrieval, missing file and edit failure](../../../../prototypes/ui-session/native-reference/catalog-tool-empty-errors-catppuccin-latte-120x40-main.png)  | built-in tools            | Pi 0.85.1 native renderer; static tool data, Web page data via current Content formatter         |
| [Bash preview, truncation and timeout](../../../../prototypes/ui-session/native-reference/catalog-tool-bash-truncated-catppuccin-latte-120x40-main.png)          | built-in tools            | Pi 0.85.1 native renderer; static tool data, Web page data via current Content formatter         |
| [Shell cancelled, nonzero exit and truncation](../../../../prototypes/ui-session/native-reference/catalog-shell-interrupted-catppuccin-latte-120x40-main.png)    | shell                     | Pi 0.85.1 native renderer; static tool data, Web page data via current Content formatter         |
| [Retained Web content paging](../../../../prototypes/ui-session/native-reference/catalog-web-page-catppuccin-latte-120x40-main.png)                              | Web                       | Pi 0.85.1 native renderer; static tool data, Web page data via current Content formatter         |
| [Web batch item error and unavailable content](../../../../prototypes/ui-session/native-reference/catalog-web-errors-catppuccin-latte-120x40-main.png)           | Web                       | Pi 0.85.1 native renderer; static tool data, Web page data via current Content formatter         |
| [User message with Markdown and code](../../../../prototypes/ui-session/native-reference/catalog-user-markdown-catppuccin-latte-120x40-main.png)                 | conversation              | Pi 0.85.1 UserMessageComponent                                                                   |
| [Assistant Markdown and code](../../../../prototypes/ui-session/native-reference/catalog-assistant-markdown-catppuccin-latte-120x40-main.png)                    | conversation              | Pi 0.85.1 AssistantMessageComponent                                                              |
| [Assistant thinking collapsed](../../../../prototypes/ui-session/native-reference/catalog-assistant-thinking-collapsed-catppuccin-latte-120x40-main.png)         | conversation              | Pi 0.85.1 AssistantMessageComponent                                                              |
| [Assistant thinking expanded](../../../../prototypes/ui-session/native-reference/catalog-assistant-thinking-expanded-catppuccin-latte-120x40-main.png)           | conversation              | Pi 0.85.1 AssistantMessageComponent                                                              |
| [Assistant provider error](../../../../prototypes/ui-session/native-reference/catalog-assistant-error-catppuccin-latte-120x40-main.png)                          | conversation              | Pi 0.85.1 AssistantMessageComponent                                                              |
| [Assistant response aborted](../../../../prototypes/ui-session/native-reference/catalog-assistant-aborted-catppuccin-latte-120x40-main.png)                      | conversation              | Pi 0.85.1 AssistantMessageComponent                                                              |
| [Assistant response truncated](../../../../prototypes/ui-session/native-reference/catalog-assistant-truncated-catppuccin-latte-120x40-main.png)                  | conversation              | Pi 0.85.1 AssistantMessageComponent                                                              |
| [Custom message native fallback](../../../../prototypes/ui-session/native-reference/catalog-custom-message-fallback-catppuccin-latte-120x40-main.png)            | optional extension output | Pi 0.85.1 CustomMessageComponent default renderer                                                |
| [Built-in read tool](../../../../prototypes/ui-session/native-reference/catalog-tool-read-catppuccin-latte-120x40-main.png)                                      | built-in tools            | Pi 0.85.1 createReadToolDefinition + ToolExecutionComponent                                      |
| [Built-in write tool](../../../../prototypes/ui-session/native-reference/catalog-tool-write-catppuccin-latte-120x40-main.png)                                    | built-in tools            | Pi 0.85.1 createWriteToolDefinition + ToolExecutionComponent                                     |
| [Built-in edit diff](../../../../prototypes/ui-session/native-reference/catalog-tool-edit-catppuccin-latte-120x40-main.png)                                      | built-in tools            | Pi 0.85.1 createEditToolDefinition + ToolExecutionComponent                                      |
| [Built-in Bash running, complete and failed](../../../../prototypes/ui-session/native-reference/catalog-tool-bash-states-catppuccin-latte-120x40-main.png)       | built-in tools            | Pi 0.85.1 createBashToolDefinition + ToolExecutionComponent                                      |
| [Built-in grep tool](../../../../prototypes/ui-session/native-reference/catalog-tool-grep-catppuccin-latte-120x40-main.png)                                      | built-in tools            | Pi 0.85.1 createGrepToolDefinition + ToolExecutionComponent                                      |
| [Built-in find tool](../../../../prototypes/ui-session/native-reference/catalog-tool-find-catppuccin-latte-120x40-main.png)                                      | built-in tools            | Pi 0.85.1 createFindToolDefinition + ToolExecutionComponent                                      |
| [Built-in ls tool](../../../../prototypes/ui-session/native-reference/catalog-tool-ls-catppuccin-latte-120x40-main.png)                                          | built-in tools            | Pi 0.85.1 createLsToolDefinition + ToolExecutionComponent                                        |
| [Generic Web search output](../../../../prototypes/ui-session/native-reference/catalog-web-search-catppuccin-latte-120x40-main.png)                              | Web                       | Pi Stuff src/web/tools.ts formatter + Pi 0.85.1 generic ToolExecutionComponent                   |
| [Generic Web fetch content output](../../../../prototypes/ui-session/native-reference/catalog-web-content-catppuccin-latte-120x40-main.png)                      | Web                       | Pi Stuff src/web/tools.ts/content.ts formatter + Pi 0.85.1 generic ToolExecutionComponent        |
| [Generic Web retained content find output](../../../../prototypes/ui-session/native-reference/catalog-web-page-find-catppuccin-latte-120x40-main.png)            | Web                       | Pi Stuff src/web/content.ts formatter + Pi 0.85.1 generic ToolExecutionComponent                 |
| [RTK rewrite Bash and failure notice](../../../../prototypes/ui-session/native-reference/catalog-rtk-rewrite-failure-catppuccin-latte-120x40-main.png)           | RTK                       | Pi Stuff src/rtk/register.ts failureNotice + Pi 0.85.1 Bash renderer/ctx.ui.notify(error)        |
| [RTK rewritten Bash command success](../../../../prototypes/ui-session/native-reference/catalog-rtk-rewrite-success-catppuccin-latte-120x40-main.png)            | RTK                       | Static offline reconstruction of Pi Stuff RTK rewrite + Pi 0.85.1 Bash renderer                  |
| [Shell ! and !! output](../../../../prototypes/ui-session/native-reference/catalog-shell-modes-catppuccin-latte-120x40-main.png)                                 | shell                     | Pi 0.85.1 BashExecutionComponent                                                                 |
| [Compaction summary collapsed](../../../../prototypes/ui-session/native-reference/catalog-compaction-collapsed-catppuccin-latte-120x40-main.png)                 | session summaries         | Pi 0.85.1 CompactionSummaryMessageComponent                                                      |
| [Compaction summary expanded](../../../../prototypes/ui-session/native-reference/catalog-compaction-expanded-catppuccin-latte-120x40-main.png)                   | session summaries         | Pi 0.85.1 CompactionSummaryMessageComponent                                                      |
| [Branch summary collapsed](../../../../prototypes/ui-session/native-reference/catalog-branch-collapsed-catppuccin-latte-120x40-main.png)                         | session summaries         | Pi 0.85.1 BranchSummaryMessageComponent                                                          |
| [Branch summary expanded](../../../../prototypes/ui-session/native-reference/catalog-branch-expanded-catppuccin-latte-120x40-main.png)                           | session summaries         | Pi 0.85.1 BranchSummaryMessageComponent                                                          |
| [Skill invocation collapsed](../../../../prototypes/ui-session/native-reference/catalog-skill-collapsed-catppuccin-latte-120x40-main.png)                        | session summaries         | Pi 0.85.1 SkillInvocationMessageComponent                                                        |
| [Skill invocation expanded](../../../../prototypes/ui-session/native-reference/catalog-skill-expanded-catppuccin-latte-120x40-main.png)                          | session summaries         | Pi 0.85.1 SkillInvocationMessageComponent                                                        |
| [Info notice](../../../../prototypes/ui-session/native-reference/catalog-notice-info-catppuccin-latte-120x40-main.png)                                           | notices                   | Pi 0.85.1 ctx.ui.notify(info)                                                                    |
| [Warning notice](../../../../prototypes/ui-session/native-reference/catalog-notice-warning-catppuccin-latte-120x40-main.png)                                     | notices                   | Pi 0.85.1 ctx.ui.notify(warning)                                                                 |
| [Error notice with retry](../../../../prototypes/ui-session/native-reference/catalog-notice-error-catppuccin-latte-120x40-main.png)                              | notices                   | Pi 0.85.1 ctx.ui.notify(error)                                                                   |
| [Extension handler error with reload retry hint](../../../../prototypes/ui-session/native-reference/catalog-extension-error-catppuccin-latte-120x40-main.png)    | notices                   | Pi 0.85.1 ExtensionRunner onError + InteractiveMode.showExtensionError                           |
| [Tool image output with text fallback](../../../../prototypes/ui-session/native-reference/catalog-tool-image-fallback-catppuccin-latte-120x40-main.png)          | media                     | Pi 0.85.1 ToolExecutionComponent image content                                                   |
| [Command text output](../../../../prototypes/ui-session/native-reference/catalog-host-command-info-catppuccin-latte-120x40-main.png)                             | conditional host output   | Pi handleSessionCommand Text composition, reconstructed fixture                                  |
| [Command Markdown and startup changelog](../../../../prototypes/ui-session/native-reference/catalog-host-command-markdown-catppuccin-latte-120x40-main.png)      | conditional host output   | Pi handleChangelogCommand / handleHotkeysCommand composition, reconstructed fixture              |
| [Version and package update notices](../../../../prototypes/ui-session/native-reference/catalog-host-updates-catppuccin-latte-120x40-main.png)                   | conditional host output   | Pi showNewVersionNotification / showPackageUpdateNotification composition, reconstructed fixture |
| [Working, retry and compaction indicators](../../../../prototypes/ui-session/native-reference/catalog-host-activity-catppuccin-latte-120x40-main.png)            | adjacent live activity    | Pi StatusIndicator uses Loader; frozen Loader samples, not transcript placement                  |
| [Custom entry renderer and failure fallback](../../../../prototypes/ui-session/native-reference/catalog-host-custom-entry-catppuccin-latte-120x40-main.png)      | optional extension output | Pi registerEntryRenderer + appendEntry, actual host fallback                                     |
| [Conditional Earendil announcement](../../../../prototypes/ui-session/native-reference/catalog-host-earendil-catppuccin-latte-120x40-main.png)                   | conditional appendix      | Pi /dementedelves command, actual host component                                                 |
| [Conditional Armin animation](../../../../prototypes/ui-session/native-reference/catalog-host-armin-catppuccin-latte-120x40-main.png)                            | conditional appendix      | Pi /arminsayshi command, actual host component                                                   |
| [Conditional OpenCode / Kimi announcement](../../../../prototypes/ui-session/native-reference/catalog-host-daxnuts-catppuccin-latte-120x40-main.png)             | conditional appendix      | Pi opencode + kimi-k2.5 model selection condition, actual host component                         |

## 三种 diff 方案

三种方案使用完全相同的代码: 五行函数变为七行, 一行替换成三行, `+3 −1`. 先保留页内去重, 再过滤上一页已出现的 ID. 文件路径、用户请求、解释和测试状态保持一致. 每种方案均有 120 列明暗主题与 80 列浅色图, 见[画廊](../../../../prototypes/ui-session/native-reference/README.md).

| 候选          | 结构                                            | 适合                   | 代价                     |
| ------------- | ----------------------------------------------- | ---------------------- | ------------------------ |
| A: 统一 diff  | 旧/新双行号、增删符号、语法颜色, 新逻辑加下划线 | 连续阅读与窄终端       | 替换行需要上下对照       |
| B: 左右对照   | 旧/新列对齐换行, 小于 110 列回退统一 diff       | 相邻字段、类型签名比较 | 需要宽度, 对齐时产生空行 |
| C: 前后代码块 | 完整旧块后接完整新块, 仅变化行标增删            | 阅读修改后的完整函数   | 重复上下文, 占用更多高度 |

A 更适合作为会话密度的起点. B、C 保留为备选, 不自动成为功能要求. 最终按图片讨论.

预览对完整前后代码块调用 Pi `highlightCode`, 换行时保留 ANSI 语法颜色. 增删由行号栏和符号表达, 不再用整行红绿覆盖语法颜色. 下划线范围按样例中的新逻辑指定, 不代表已实现通用 diff 解析器、自动词级匹配或大文件性能保障. 保留的候选会话里, Read 代码片段也加入语法高亮.

## 参考来源的作用

Pi 当前 `renderDiff` 对增删整行着色, 仅一删一增时使用词级反色强调, `filePath` 参数未使用. 已导出的语法高亮和 ANSI 宽度工具足以支撑本次原型, 无需新依赖.

Codex 和 Gemini 将行号、语法颜色与换行组合使用. OpenCode 根据宽度切换 split/unified, 已查源码的阈值是大于 120 列; 本原型单独试验 110 列回退. pi-tidy-tools 提供紧凑会话块和宽度适配参考, 但其 diff 着色本身没有语法高亮. C 的完整前后分块是本地提案, 不是上游默认界面的复刻.

| 来源                      | 一手依据                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi 0.85.1                 | [diff renderer](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/components/diff.ts), [syntax highlighting](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/theme/theme.ts), [width utilities](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/src/utils.ts) |
| Codex                     | [diff_render.rs](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/tui/src/diff_render.rs)                                                                                                                                                                                                                                        |
| Gemini CLI                | [DiffRenderer.tsx](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/cli/src/ui/components/messages/DiffRenderer.tsx)                                                                                                                                                                                                 |
| OpenCode                  | [permission.tsx](https://github.com/anomalyco/opencode/blob/ebb7b76eca82342642c78645109e865614533827/packages/tui/src/routes/session/permission.tsx)                                                                                                                                                                                                                   |
| pi-tidy-tools             | [block-render.ts](https://github.com/mikeyobrien/pi-tidy-tools/blob/da148ac7f33371d9855632ea62f288ba929357d0/packages/pi-tidy-tools/block-render.ts)                                                                                                                                                                                                                   |
| pi-diff 0.9.1             | [syntax, row and word layers](https://github.com/buddingnewinsights/pi-diff/blob/79b00a7bd7c85405f7fbbab047c00457a51f44a9/src/index.ts)                                                                                                                                                                                                                                |
| pi-tool-display 0.5.0     | [Pi highlighter and ANSI span overlay](https://github.com/MasuRii/pi-tool-display/blob/91cef7580078371f8dc49a8607222807ad6a424d/src/diff-renderer.ts), [adaptive presentation](https://github.com/MasuRii/pi-tool-display/blob/91cef7580078371f8dc49a8607222807ad6a424d/src/diff-presentation.ts)                                                                      |
| @pi-archimedes/diff 2.7.3 | [split](https://github.com/danielcherubini/pi-archimedes/blob/2a1519b65883f866bc52f835879028e23771ae90/packages/diff/src/render/split.ts), [unified](https://github.com/danielcherubini/pi-archimedes/blob/2a1519b65883f866bc52f835879028e23771ae90/packages/diff/src/render/unified.ts)                                                                               |

pi-diff 分开处理语法前景色、变更行背景和词级强调. pi-tool-display 直接使用 Pi highlightCode, 按可见列叠加强调并保留 ANSI 颜色. 两者都有会话内 split/unified 布局, pi-archimedes 提供第三份语法高亮参考. pi-diff 和 pi-archimedes 所需的 Shiki 依赖未安装; pi-tool-display 的 peer 范围只声明到 Pi 0.80.x. 这里只参考源码, 不声称它们可直接接入 Pi 0.85.1, 也没有新增依赖.
