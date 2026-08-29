<!-- translation-source: docs/research/work-todo-ui-reference.md; translation-source-sha256: feb523f113fe2dd2f8e314c23f8062eb1461e1d7d4eaa5ecca82b5d81267b060 -->

# Work Todo UI 参考：Claude Code 与 `rpiv-todo`

**研究日期：** 2026-08-01
**决策范围：** 完整 Work 界面关闭时，会话 Todo 有多少内容显示在普通 Pi 对话中。

## 结论

将三个原生 Pi 方案与已选定的编辑器下方 Agent roster 进行了比较：

1. **有界检查清单——已选定。** 在编辑器上方最多显示五行任务，外加一行溢出提示。这最接近当前 Claude Code，并让计划保持可见且可修正。
2. **单行 Work 条。** 只显示当前任务和总体进度。它保留了对话高度，但会将 Todo 变成状态行，而不是可见计划。
3. **需要关注前保持安静。** 普通运行期间不显示 Todo，仅在需要用户输入时显示一条提醒。它最大化了对话高度，但使 Todo 几乎不可发现。

维护者于 2026-08-01 选定了方案 A。已弃用的比较原型仍保存在 Git 历史中。

## 已确定的产品边界

- Todo 是主会话的当前计划，不是项目待办、子 Agent 待办或第二个 Beads。子任务仍保留在 Agent roster 中。
- 长期存在的问题、决策、验收标准和延期工作仍保留在 Beads 中。
- 自有的 `@juicesharp/rpiv-todo` fork 提供能力基础；不要求保留上游 UI。
- 完整列表的查看和编辑属于已接受的全宽、分隔线引导、非浮动 Work Command Dialog。
- 默认 Agent roster 仍位于编辑器下方。Todo 和 Agent UI 必须结合评估，而不能只看相互隔离的 mockup。
- Todo 工具调用使用通用 Pi Stuff 工具渲染器。不保留上游的 `todo + …` transcript 样式。

## 当前 Claude Code 行为

Anthropic 当前的[交互模式文档](https://code.claude.com/docs/en/interactive-mode#task-list)说明：

- 任务列表是 Claude 的多步骤待办清单，与用于查看运行中 shell 和子代理的 `/tasks` 视图分开；
- `Ctrl+T` 可显示或隐藏任务列表；
- 一次最多显示五个任务；
- 空任务列表不会产生可见的切换效果；
- 用户可以要求 Claude 显示全部任务或清除任务；
- 任务会在上下文压缩后保留。

### 已发布 2.1.220 的黑盒捕获

已捕获真实 Claude Code **2.1.220** Linux x64 发布二进制文件，尺寸为 `100 × 32`。捕获结果验证了已安装二进制文件的确切 SHA-256：

```text
674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863
```

该二进制文件使用隔离的 HOME 和配置运行。本地仅限 localhost 的 Anthropic Messages fixture 提供了七个合成的 `TaskCreate` 条目和确定性的 `TaskUpdate` 转换。未使用用户 Claude 凭据、会话、项目文件或外部模型 API。渲染器、Task 工具、Ctrl+T 行为和生命周期均为真实发布行为；只有任务文本来自 fixture 数据。

直接观察结果：

1. 七任务混合状态会渲染五行任务，随后是 `… +2 pending`。
2. 已完成、进行中和待处理行分别使用勾选符号、实心方块和空心方块。
3. 任务列表紧贴编辑器分隔线之上，并位于活动响应/旋转指示区域之下。
4. Ctrl+T 会将五行检查清单替换为一行 `Next: …`，并将页脚提示从 `hide tasks` 改为 `show tasks`；恢复显示不会改变任务状态。
5. 所有任务完成后，任务行会立即消失，甚至早于最终模型响应稳定下来。已完成的空闲帧同样没有 Ctrl+T 任务提示，而不是留下一个已完成的 dashboard。

已移除的证据 harness 要求在交互上下文中启用 Task 工具。由于 `--bare` 会从本地 API 请求中移除 Task 工具，因此被拒绝；捕获使用了设置 `CLAUDE_CODE_ENABLE_TASKS=true` 的隔离安全模式会话。该 harness 仍保存在 Git 历史中。

## `@juicesharp/rpiv-todo` 2.3.1 行为

该 npm 发布版本声明采用 MIT 许可证，并与提交 [`f28d733`](https://github.com/juicesharp/rpiv-mono/tree/f28d733f96dd587fa286d845b67fc9aea987a0f6/packages/rpiv-todo) 中检查过的 `rpiv-mono` 生产源代码一致。Pi 0.83 兼容性已独立检查：TypeScript 通过，包内全部 224 个测试通过。

### 用户看到的内容

尽管上游名称为 `TodoOverlay`，它并不是浮动窗口。实现使用 Pi 的公共 `setWidget(..., { placement: "aboveEditor" })` 路径（[面板实现](https://github.com/juicesharp/rpiv-mono/blob/f28d733f96dd587fa286d845b67fc9aea987a0f6/packages/rpiv-todo/todo-overlay.ts)）。

- 空会话没有面板。
- 首次成功创建 Todo 后，面板会自动出现。
- 标题显示 `Todos (completed/visible-total)`。
- 每个任务都是一行经过截断的终端行。已完成行会变暗并加删除线；当前行可以包含其活动表单。
- 只要存在任何依赖，所有行都会显示任务 ID，依赖行还会添加阻塞 ID。
- 完整的 `/todos` 命令会向对话发出一条无界通知；它不会打开管理界面。

### 高度和溢出

默认 `maxWidgetLines` 为 12 个内容行，渲染器还会追加一个空白间隔，因此默认面板最多可占用 **13 行**。其[溢出选择器](https://github.com/juicesharp/rpiv-mono/blob/f28d733f96dd587fa286d845b67fc9aea987a0f6/packages/rpiv-todo/state/selectors.ts)会先丢弃已完成项目，然后截断未完成项目的尾部，并保留一行用于摘要。

这证明持久能力路径是可行的，但相对于 Pi Stuff 的编辑器下方 Agent roster，默认高度过大。fork 应保留恢复和可见性语义，而不是保留上游面板密度。

### fork 中需要修正的完成和重放细节

- 已完成项目会在当前 Agent turn 中继续可见，并在下一轮隐藏。
- 已完成行隐藏后，标题分母可能缩小，因此不再表示稳定的历史进度。
- Reload、压缩或 session-tree replay 会重置临时的“已显示”集合，并可能使已完成行再次出现一次。
- `maxWidgetLines` 没有生产环境上限。
- 溢出文本可能将被截断的非完成工作称为 `pending`，即使被截断的任务实际处于进行中。

这些是 fork 测试的行为输入，不是已接受的 Pi Stuff 行为。

## 原生 Pi 0.83 比较

已移除的临时比较使用确定性的会话 fixture 以及 Pi 的公共编辑器上方/下方 widget API。它没有执行模型、Agent、网络、文件或 shell I/O。每个方案的捕获都保持一份 transcript、一份真实输入草稿以及选定的垂直 Agent roster 不变。静态 fixture 仅证明布局，不证明实时变更、分支切换或压缩恢复。这些机制已经存在于 rpiv-todo 能力基础中，必须保留到 fork 中。比较结果仍保存在 Git 历史中。

黄色的 `needs_input` 行是展示 fixture，不是建议向 rpiv-todo 状态机添加 `blocked`。上游状态仍为 `pending`、`in_progress`、`completed` 和 `deleted`；Todo 依赖阻塞由 `blockedBy` 派生，而等待用户决策或权限则是独立的 Work attention 状态。共享 presenter 可以在视觉上合并这些事实，而不改变持久化的 Todo 转换。

### A. 有界检查清单

正常高度：六行——五行任务和一行溢出提示。

优点：

- 当前任务、下一步和计划边界无需其他操作即可保持可见；
- 最接近维护者偏好的 Claude Code 体验；
- Todo 保持为用户可修正的计划，而不是隐藏的模型状态。

风险：

- 编辑器上方的 Todo 和下方的 Agent roster 会在视觉上夹住编辑器；
- `64 × 28` 会留下更小的对话视口；
- 需要用户关注的内容可能在 Todo 行和主 Agent roster 行中重复；
- 必须设置硬性行数上限，以防 dashboard 增长。

### B. 单行 Work 条

正常高度：一行。

优点：

- 与 Agent roster 的高度平衡最佳；
- 当前活动和进度持续可见；
- 需要用户处理的工作会成为清晰的单行警告。

风险：

- 用户无法检查下一步，也无法发现遗漏的计划项目；
- 诸如 `6 pending` 的总体信息几乎没有可操作性；
- 该界面读起来像状态行，而不是 Todo 列表。

### C. 需要关注前保持安静

正常高度：零行；需要输入时高度：一行。

优点：

- 保留最大的对话高度；
- 重要的阻塞工作仍可打断安静状态。

风险：

- 用户无法知道 Agent 是否制定了计划，也无法知道它接下来打算做什么；
- Todo 难以发现和监督；
- 需要用户处理的提醒必须先打开完整 Work 界面，才能明确其上下文。

## 已确认的决策

维护者选定 **A，有界检查清单**作为正常默认方案。它最符合维护者对 Claude Code 的明确偏好，并保留 Todo 面向用户的目的：用户可以看到并修正 Agent 的计划。B 未来可以作为显式折叠状态进行评估，但不属于本次决策。

本次选择仅冻结以下几点：

- 编辑器上方的一份无标题检查清单；
- 最多五行可见任务，外加一行溢出提示；
- 不存在 Todo 时高度为零；
- 完整列表和变更位于非浮动 Work Command Dialog 中；
- Agent roster 仍是编辑器下方唯一的实时会话界面。

以下仍属于实现/细节问题：行选择和排序、已完成行停留时间、需要用户处理行的提升、折叠表示、快捷键、颜色，以及精确的窄终端阈值。

## 来源和复用限制

- `@juicesharp/rpiv-todo` 是明确的自有 fork 候选。vendored 时记录其确切 npm/archive revision 和许可证。
- Claude Code 仅作为可观察的产品证据。不得复制、翻译、移植、机械改编或再分发其代码。
- 检查过的 `tanbiralam/claude-code` 重构快照，仅用于围绕状态排序和源代码行为生成问题。在已发布的 2.1.220 像素结果与当前官方文档存在差异时，以前者和后者为准。
- 已移除的原生 Pi 原型是一次性的证据，不是生产实现；Git 历史是其存档。
