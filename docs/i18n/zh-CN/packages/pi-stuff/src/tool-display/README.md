<!-- translation-source: packages/pi-stuff/src/tool-display/README.md; translation-source-sha256: 76edee87afa215bc786ed6d76316224e8ed2e47cd7ce50a2b9b995a4aafab2eb -->

# Tool Display 模块

Pi Stuff 套件紧凑、只负责呈现的工具 UI。

该能力使用原始定义重新注册七个 Pi 0.84.4 内置工具，只替换其渲染位置。工具 Schema、提示词元数据、执行、结果内容、生命周期事件和权限检查保持不变。Pi 0.84.4 的 PowerShell 工具完全由宿主渲染；Pi Stuff 只为重载/恢复成员关系识别其 `powershell` 名称。每个套件负责的工具必须通过 `registerSuiteOwnedTool` 声明 Activity 元数据；未知第三方工具保留原生渲染器并形成显示边界。

`registration.ts` 负责套件工具装饰、Activity 覆盖和历史重放绑定；`index.ts` 负责有序宿主事件投影生命周期；`registration-tracker.ts` 负责工具注册表与活跃界面投影；`envelope-projection.ts` 负责嵌套工具解码和普通协议投影；`group-projection.ts` 负责对话记录分组与结果关联；`activity-presentation.ts` 负责实时行协调，`activity-query-projection.ts` 负责摘要与工具详情，`bash-operation-presentation.ts` 负责 Bash 行；`registered-tool-renderer.ts` 负责行/详情发布；`activity-clock.ts` 负责运行标记。`ToolUiRuntime` 仍是唯一公开实时投影外观。

`activity-model.ts` 负责 Activity 词汇，`activity.ts` 保留公开外观与 Bash 分类，`retrieval-groups.ts` 规划对话记录成员关系，`activity-summary-format.ts` 负责纯摘要措辞。

同一宿主事件总线上的每个 Pi facade 都会同步发现同一个 `ToolUiRuntime` 与 Effect foundation。每个 Session 都在一个 Capability Scope 中获取可移除的工具运行计时器设置注册与设置订阅；Session 替换会在下一次注册前释放上一代资源，最终关闭只释放一次。由于宿主无法注销 Pi 命令与事件注册，它们仍由安装生命周期负责；其既有 runtime 与 generation fence 会阻止陈旧投影工作。

## 日常使用

- 每一段连续原生 Read、Grep/Find 或 List 都是一个 **检索组**，从第一个合格调用开始。合格集合是封闭的：Bash、Web、MCP、媒体、修改、Agent、Task、后台工作、Goal、未知和第三方工具都是独立工具活动，并关闭检索。
- Assistant 说明文字、用户输入、模型上下文可见自定义消息、轮次完成、自动继续，以及工具活动后新出现的可见逻辑 Thinking 运行都会关闭当前检索组。同一个逻辑 Thinking 运行内的流式更新、工具结果、隐藏状态、分支或压缩元数据不会关闭。
- 成功稳定或活跃的检索组恰好占一行物理终端。Search、Read、List 分句固定按该顺序排列；Read 统计唯一规范路径，Search 与 List 统计调用次数。活跃行使用现在时、省略展开提示，并可行内增加已启用的经过时间与稳定目标。宽度变窄时，先删除目标，再删除经过时间，之后才截断语义摘要。稳定行省略目标和经过时间，只有不换行即可容纳时才显示 `(ctrl+o to expand)`。
- 失败、被拒绝和已取消的原生检索留在其检索组。唯一两行紧凑例外会在第一行保留状态特定问题计数，并在一行子项显示第一个有界原因；其余原因可通过展开查看。
- 每次 Bash 调用都按源码顺序成为独立 `Bash(<command>)` 操作块，包括只读命令。命令采用 Claude Code 的两行/160 代码单元上限；输出显示三行，再显示有界 `… +N lines` 提示；运行中、空输出、stderr、退出、取消、拒绝和失败状态都保持明确。`Ctrl+O` 在同一块展开有界命令和输出，不增加通用协议框架。
- 成功 Task 调用保持紧凑静默，因为 Todo 负责其可见状态。成功 `tool_search` 和 `ctx_reduce` 调用静默且对检索连续性透明。全部调用仍可通过 `Ctrl+O` 与 `/tools` 检查；其中任何问题都会成为独立工具活动，并关闭两侧检索。
- Pi 全局 `Ctrl+O` 按持久源码顺序恢复合格调用、现有工具特定渲染器、成功 Task 与基础设施调用，以及逻辑 Thinking 运行。`/tools [group-or-member-id]` 保持以工具活动为第一级单元：检索组暴露有序 `Calls`，独立活动保持单项。Up/Down 选择成员，PageUp/PageDown 滚动，Home/End 跳转，`r` 切换格式化与 Raw 视图，Escape 逐层退出对话框。
- 工具渲染是全函数：历史工具定义缺失、可选元数据异常或呈现 Hook 抛错时，在源码位置提供一条有界通用行。嵌套封装工具和媒体保留其所属渲染器。只有未被其他界面表示的外层错误、拒绝或取消才得到一行封装回退；没有嵌套工具或媒体行的成功纯 JavaScript 代码模式保持不显示。
- 封装重放为 Raw 详情保留原始参数，并在 Activity 分类、语义详情和渲染前应用工具当前 `prepareArguments` 兼容垫片。历史结果可能省略 `details`；可选异常元数据会被忽略，不会丢弃操作。嵌套结果 Hook 添加的仅控制 `<system-reminder>` 块不会成为代码模式业务输出；所属外层宿主结果仍是控制消息传输边界。嵌套流式输出立即到达调用方；信息更新 Hook 逐个运行，Hook 落后时只保留最新待处理更新，而最终工具结果仍是权威。
- `/ui` 包含默认开启的 **工具运行计时器** 设置。它控制长时间运行的独立行和活跃检索组是否在现有阈值后显示经过时间。稳定摘要绝不保留该时间。
- 空 `/tools` 对话框保留按键帮助与关闭提示，但在行存在前省略选择和详情提示。
- 每个选中调用的格式化与 Raw 详情文字限制为 240 行和 24 KiB。Raw 包含调用 ID、工具名称、参数、结果内容和详情。默认 `Result` 小节显示无标签目标，再显示工具自有详情，不注入重复的工具、`Target:` 或 `Summary:` 字段；Raw 明确以 `Raw` 为标题。如果通用摘要由第一行结果自动派生，格式化 `Ctrl+O` 和 `/tools` 详情会省略同一行；单行结果不增加填充。自定义摘要、非空工具自有详情和 Raw 保持不变。紧凑模式既不预计算，也不缓存全局 Raw 对话记录。工具自有业务结果绝不会被该能力截断或重写。
- 分组是确定性显示投影。会话 JSONL、模型可见消息、活跃工具成员关系和执行行为保持不变；工具活动会在实时更新、重载、重启/恢复、树导航和压缩后重建，无需迁移或兼容模式。
- 进程内 `/resume` 会在 Pi 重建历史前，精确预绑定活跃且由套件渲染的内置工具，并保留宿主原生 PowerShell 成员关系而不增加渲染器。因此第一帧恢复画面保持紧凑，不会复活已禁用工具；完整活跃工具顺序保留，新调用重新绑定到目标会话的工作目录、信任和项目设置。

## 性能验证

`bun run benchmark:tool-activity` 重建一个跨往返、包含 20,000 次调用的检索组，将其中位运行时间与此前相邻 Exploration 投影比较，验证所有成员都保留，并强制满足相对基线最多回归 25 毫秒与保守的 250 毫秒绝对上限。它还会在 20,000 次调用历史后测量 200 次增量流式更新，以及在 250 毫秒上限内格式化展开 1,000 个短结果。格式化基准也会拒绝 Raw 协议标题。流式更新只重新规划当前叙事边界尾部，计时器帧只协调受影响组；两条路径都不会重新扫描完整会话。

源码来源和本地差异见 `UPSTREAM.md`。当前交互约定记录在仓库 ADR `docs/adr/0022-restrict-folding-to-native-retrieval.md`；原 ADR 0010 只能从 Git 历史中获取。2026-08-17 的 `/tools` 可读性更新已于 2026-08-18 实现，包括生命周期图标、`◆` 小节、紧凑键盘分页、单项详情、格式化/Raw 导航和固定宽分栏。聚焦测试和真实 PTY 验证器覆盖已交付对话框，包括通过真实宿主发送的 Space 翻页序列和 Tab 栏位切换。
