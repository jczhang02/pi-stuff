<!-- translation-source: docs/research/work-btw-ui-reference.md; translation-source-sha256: c210ab4dd5bf28e5e1b2929524116da7bfd7144cc37914060bbf6a0a415e9900 -->
# Work BTW UI 参考：Claude Code 与 Pi Package

**研究日期：** 2026-08-01
**决策范围：** 当主 Agent 仍在工作时，用户提出侧边问题，屏幕上会发生什么。

## 底线

有意义的选择不是颜色或快捷键，而是 BTW 的形态：

1. **单次快速交流——维护者于 2026-08-01 选定。** 问题打开一个临时 BTW Command Dialog，并产生一个回答。Dialog 保持打开以供阅读；用户关闭它后返回主 prompt。较早的交流只能在 session-local BTW history 中浏览。
2. **临时侧边线程。** 同一个临时 surface 保持打开并带有自己的 composer，因此用户可以提出后续问题，也可以选择将上下文带入主编辑器。
3. **分离的邮箱。** 提交问题后立即恢复主 prompt；稍后重新打开 BTW 阅读回答。在已经确认的零 transcript、零 statusline 规则下，这保留了焦点，但不会提供终端内的就绪信号。

三种形态在 BTW 关闭时都占用零行，将普通 BTW 交流排除在主 transcript 和模型上下文之外，并使用已接受的、分隔线引导、全宽、非浮动的 Command Dialog。只有显式执行 Bring 后再由用户提交，才可以向主对话添加选定内容。一个提议的多线程 shelf 在原型设计前被否决，因为它会在 Todo 和 Agent roster 旁边添加另一个普通屏幕 widget，违背既定的 BTW surface 规则。

维护者选择了 A，遵循 Claude Code 生命周期。A、B、C 的已丢弃视觉比较仍可从 Git history 中恢复。

## 自有 fork 选择

Pi Stuff 将使用 [`@juicesharp/rpiv-btw@2.3.1`](https://registry.npmjs.org/@juicesharp/rpiv-btw/2.3.1) 的自有 fork，源提交为 `75823a68024a0a649cc28087976074be791ca554`。在选定单次无工具交流后，这个更小的 Package 成为比早先的 `@narumitw/pi-btw` 候选更好的语义基础：它已经拥有父上下文转换和预算、独立取消、一次命令/一个回答、`tools: []` 以及不带多回合 composer 或额外运行时依赖的 transcript 隔离。精确的决策、archive 身份、比较、所需 fork 差异和 Pi 0.83 验证记录在 [Work BTW Package reference](./work-btw-package-reference.md) 中。

## 已建立的产品边界

- BTW 回答一个侧边问题，但不会停止主 Agent 回合。
- BTW 位于自己的 Command Dialog 中，可以保留 session-local BTW history，但普通 BTW 问题和回答永远不会成为主对话消息。
- Dialog 激活时替代编辑器区域，隐藏普通 statusline，并在打开 Dialog 时恢复仍存在的任何主编辑器草稿。`/btw ...` 命令文本本身已经被消费，因此不属于这种草稿。
- Pi Stuff 不使用浮动窗口或居中覆盖层。
- Todo 仍然是主 session 在编辑器上方的计划。编辑器下方的垂直 Agent roster 仍是唯一的实时 child-session surface。
- 需要新文件读取、命令、web research、编辑或扩展性独立调查的问题，属于 child Agent，而不是 BTW。

## 当前 Claude Code 行为

Anthropic 当前的 [interactive-mode 文档](https://code.claude.com/docs/en/interactive-mode#side-questions-with-btw)将 `/btw` 定义为 subagent 的反面：

- 它可以看到当前父对话，但没有工具；
- 它在主回合继续时独立运行；
- 每次调用产生一个响应，BTW surface 中没有后续回合；
- 问题和回答永远不会进入主对话历史；
- 较早的交流保留在独立的 session-local BTW history 中，直到被清除；
- 裸 `/btw` 重新打开最近的交流；
- 完成的回答可以关闭、滚动、复制、浏览较早回答、清除，或 fork 到独立 session。

### 发布版 2.1.220 黑盒观察

真实的 Claude Code **2.1.220** Linux x64 binary 在隔离的 `100 × 32` PTY 中使用 localhost-only Messages fixture 进行了测试。未使用用户凭据、session、项目数据或外部模型请求。fixture 提供确定性的散文；release binary 负责渲染、命令处理、BTW history、键盘行为和主回合并发。

观察到的序列是：

1. 长主回合显示其普通实时行。
2. 提交 `/btw <question>` 后，该实时行被内联、无边框的 BTW focus surface 替换，而普通 editor shell 仍位于下方。
3. BTW 回答在原位流式输出。主回合继续运行，但其实时行暂时隐藏。
4. 关闭 BTW 后，主实时行恢复，而 fixture 尚未交付主响应。该捕获证明 BTW 没有取消进行中的主回合；但不包含之后主回合完成的 frame。
5. 关闭后，可见的主对话包含主请求而没有 BTW 交流；fixture 的主回答仍在等待。
6. 第二次调用 BTW 时，较早的问题以暗色显示，支持左右历史浏览，也支持清除较早交流。

Pi Stuff 应保留这一信息层级和生命周期，但将官方覆盖层机制转换为 Suite 已选定的非浮动 Command Dialog。

## 当前 Pi Package 证据

### `@narumitw/pi-btw` 0.42.1

该 npm release 采用 MIT，声明精确的 Pi `0.83.0` development dependencies，运行时依赖 `@narumitw/pi-tui-kit`，并标识 repository revision `387d48c3724557492658846259832f4570720e0e`。上个月 npm API 报告 2026-07-02 至 2026-07-31 下载量为 **7,640**。当前 Package 行为见其 [Pi Package 页面](https://pi.dev/packages/%40narumitw/pi-btw)和[上游仓库](https://github.com/narumiruna/pi-extensions/tree/387d48c3724557492658846259832f4570720e0e/extensions/pi-btw)。

0.42.1 版本不再是 Claude BTW 的单次克隆。它打开一个带滚动能力的临时侧边线程工作区，拥有自己的 composer，支持多次连续 follow-up，并可将选定的 BTW 上下文加载到主编辑器而不发送。主 Agent 和 BTW 模型请求可以并发计算，但交互是串行的：近乎全高的 BTW 工作区在用户关闭它之前拥有编辑器区域。

它在打开时对当前分支做快照，将构造出的上下文限制在大约 40,000 个字符，并直接发起无工具模型调用。快照主要保留用户和 assistant 内容，因此即使“为什么这个测试失败？”是最自然的侧边问题，最近的工具结果也可能缺失。Follow-up 是串行的，只继承成功的 BTW 回合。每次调用只有一个临时线程，而不是多个并行 BTW slot。关闭 surface、重新加载 Pi 或切换 session 都会丢弃线程；进行中的请求不会恢复。

取消生成只中止 BTW，不中止主 Agent，但上游会关闭整个侧边线程并丢弃任何晚到结果。Provider failure 会显示为 error turn，并重新打开 composer；失败的回合不会进入后续 BTW 模型上下文，也不会出现在 Bring-to-main 选择中。

生产源代码约 2.1 千行 TypeScript，其中很大一部分用于分页、文本选择、预览和 bring-to-main 菜单。其有用的能力 seam 更窄：父上下文快照、独立模型/auth/thinking 选择、无工具流式输出、取消，以及严格排除于主对话之外。它仍是有价值的行为证据，但后续 fork 审计选择了更小的 `@juicesharp/rpiv-btw` 基础，因为这个 Package 的多回合工作区大部分都需要被移除。

### 其他已建立的 Package

- [`pi-btw` 0.4.1](https://pi.dev/packages/pi-btw) 报告 **8,391 上月下载量**。它提供持续的、支持工具的 Pi sub-session、聚焦 modal shell、主/BTW 焦点切换和 answer injection。它能力很强，但与已经选定的 multi-Agent kernel 重叠，并使用 Pi Stuff 已拒绝的上游浮动/modal 展现。
- [`@nguyenquangthai/pi-btw` 1.1.2](https://pi.dev/packages/%40nguyenquangthai/pi-btw) 报告 **757 上月下载量**。它提供九个并行 slot、持久化、流式输出和 injection。其产品形态最接近被拒绝的多线程 shelf，并在 Agents 旁边创建另一个工作管理系统。

下载量是采用信号，不是代码质量证明。最终 Package 仍必须是自有、固定版本的 fork，保留 MIT provenance 和本地变更记录。

## A. 单次快速交流

具体使用：

1. 主 Agent 仍在实现，用户提交 `/btw Why is this cache request-scoped?`。
2. 一个分隔线引导的 BTW Command Dialog 临时接管编辑器区域。它显示问题、一个流式回答，以及主任务仍在计算的事实。
3. 完成后的回答保持打开，直到用户关闭。关闭后恢复打开 Dialog 时捕获的草稿、Todo、Agent roster 和最新主进度。
4. 裸 `/btw` 可以重新打开 session-local 的较早交流；这些交流仍不会进入主 transcript。
5. 如果问题需要工具或持续调查，则提升到 child session，而不是把 BTW 变成第二个聊天。

这是最小的心智模型，也是最接近 Claude 的方案。代价是澄清需要另一次 BTW 交流或 promotion，而不是内联 follow-up。主任务和 BTW 可以并发计算，但用户交互仍然是串行的：BTW 拥有编辑器区域时，用户不能提交另一个主 prompt。Todo、Agent roster 和普通 statusline 会临时让位；较长的 BTW 回答也会减少可见的主 transcript。如果主任务请求许可或用户输入，则更高优先级的 surface 必须抢占 BTW，而不是让主任务在 BTW 后方静默暂停。

## B. 临时侧边线程

具体使用：

1. 同一个 `/btw` 命令打开一个非浮动的侧边工作区。
2. 第一个回答后，BTW 专用 composer 仍然存在，因此用户可以澄清或提出另一个相关问题。
3. 整个临时线程可滚动。选定内容可以加载到主编辑器，但永远不会自动发送；只有用户随后提交，它才会进入主对话。
4. 关闭工作区后恢复主草稿，并丢弃侧边线程。

当第一个回答不完整时，这种方案更宽容，也直接映射成熟的 `@narumitw/pi-btw` 行为。代价是概念上的：BTW 变成用户可以长时间停留的第二个对话，模糊了它与 Agent/session 系统之间的边界。

## C. 分离的邮箱

具体使用：

1. 用户提交 `/btw <question>`，立即返回主 prompt，同时独立请求运行。
2. 普通屏幕不显示 BTW 行、通知、transcript 记录或 statusline 条目。
3. 用户稍后运行裸 `/btw`，在 Command Dialog 中打开回答和本地历史。

这最大化了主对话的可用性。然而，在已确认的无 widget、无 statusline、无 transcript 政策下，用户无法在重新打开 BTW 前知道回答是否准备好。因此它以反馈和可发现性为代价换取安静。

## 已确认方向

Pi Stuff 使用 **A，单次快速交流**。它将 BTW 保持为边界清晰的工作控制功能，而不是第二个 Agent 或第二个对话，并遵循维护者选定的 Claude Code 生命周期。`@juicesharp/rpiv-btw` 的自有 fork 提供无工具/上下文隔离核心，而不继承完整的侧边线程工作区。该决策接受 Dialog 打开时用户焦点串行；“主任务继续”意味着计算并发，而不是同时在两个 surface 中输入。

已确认的大结构冻结以下要点：

- 一个无工具侧边问题产生一个回答；
- 主 Agent 并发继续；
- BTW 使用通用的非浮动 Command Dialog，关闭时占用零个普通屏幕行；
- 普通问题和回答留在主 transcript 和主模型上下文之外；
- session-local BTW history 可以重新打开并清除；
- 取消 BTW 永远不会取消主 Agent；
- 关闭后恢复打开 Dialog 时捕获的主编辑器草稿，以及 Todo 和 Agent roster；
- 需要工具或持续工作的内容提升到现有 Agent/session 系统。

实现决策现已固定。BTW 使用当前主模型；surface 遵循 Pi theme tokens 和原生 Answering loader；复制为 `c`，清除为 `x`，历史为 Left/Right，滚动为 Up/Down，promotion 为 `f`，Space/Enter/Esc 关闭。`f` 等待主 Agent 变为空闲，然后打开一个新 session，将选定的问题和回答作为正式回合放入其中。历史以原始 session 所拥有的不可见 no-context 状态在恢复后保留，不被新/forked session 继承，并且只有在 1,000 次交流或 8 MiB 的异常 guard 下才淘汰最旧条目。真实 Pi 0.83 gate 同时覆盖 `100 × 32` 和 `64 × 28`。独立调用仍会重新发送上下文并产生 provider 成本。

## 可行性边界

Pi 0.83 可以在不 fork Host 的情况下实现三种方案，尽管 C 比 A 或 B 需要更多 extension-owned 生命周期状态：

- 即使主 Agent 正在流式输出，extension command 也会立即执行；
- `ctx.ui.custom()` 提供非浮动的聚焦 surface；
- `getBranch()` 和 Pi 的 LLM conversion utilities 可以形成调用时的父上下文快照；
- extension-owned model request 可以使用单独的 abort signal 且不带工具；
- 可以围绕 Dialog 捕获并恢复当前编辑器草稿。

C 还需要 extension-owned background-request registry、session identity 和 generation checks、reload/session-switch cancellation，以及防止将晚到回答交付到不同 session 的保护。Pi 没有原生 BTW job supervisor，也无法在 reload 后恢复进行中的模型请求；请求会变为 interrupted。静态布局 fixture 无法证明这一生命周期。

困难场景在并发，而不在布局：BTW surface 不得将 `Esc` 发送到主 abort path；主 permission request 必须获得焦点优先权；BTW 打开时主回合可能完成；provider 可能限制并发请求；进行中的主 assistant partial 可能尚未出现在稳定的分支快照中。Todo、BTW 和 Agent roster 也需要一个小型共享 work-surface ownership protocol，使扩展的 Dialog 能让其他 Suite-owned surface 让位并恢复，而无需 fork Pi。这些内容需要在实现所选方向时增加生产测试。

## Provenance 与复用限制

- Claude Code 仅作为可观察的产品证据。不要复制、翻译、移植、机械改编或重新分发其代码。
- 真实 release capture 使用合成 fixture prose 和真实 release rendering；它是证据，不是实现依赖。
- `@juicesharp/rpiv-btw@2.3.1` 是所选自有 fork base，而不是直接依赖。保留其 MIT license、精确 npm archive 和源修订，以及可见的本地变更记录。`@narumitw/pi-btw` 仅作为比较证据。
- 原生 Pi comparison fixture 是一次性的布局证据。它们不能证明实时模型并发、reload 行为或 provider 正确性。
