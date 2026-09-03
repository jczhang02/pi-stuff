<!-- translation-source: docs/research/live-only-thoughts-feasibility-20260813.md; translation-source-sha256: 86cbc24021e5706244560bad671b5d4327299645fa2590b8fc72dd03fe446bd4 -->

# Pi 0.84.1 上仅实时 Thoughts 的可行性

日期：2026-08-13

## 问题

Pi Stuff 能否在不修改 Pi 的情况下实现以下 transcript contract？

- Assistant 消息流式传输时显示一个当前 Thought。
- 当前语义块变化时，在原位置替换该行。
- Assistant 消息稳定或开始执行 Tool 时，完全移除该行。
- resize、reload 或 resume 后不重放已稳定的 Thoughts。
- 不留下空白或其他不可见的 transcript 行。
- 保持 Session 数据和 model context 中原始 Thinking blocks 不变。
- 使用受支持的公开 Extension seam，而不是修补 Host 内部实现。

## 结论

**不能。完整 contract 无法通过 Pi 0.84.1 的公开 Extension API 实现。**

Pi Stuff 可以通过 `registerMarkdownTransformer()` 投影实时文本，也可以改为将实时摘要放入 Working Row 或 extension widget。这些 API 都无法从 `AssistantMessageComponent` 中结构性地省略内置 Thinking block。返回空 Markdown 字符串只能隐藏字符，却会留下 Host 所有的 `Spacer` 行。将隐藏的 Thinking label 设为空字符串会留下更多空白行。

唯一能让已稳定的内置组件变为零高度的公开 hook，是移除 Thinking blocks 后通过 `message_end` 替换消息。该 hook 会修改 Agent state 和 Session persistence 中的 canonical finalized Assistant message，因此违反仅显示和上下文保留要求。之后通过 `context` 重建 Thinking 会创建 Pi Stuff 所有的 shadow transcript，并且仍会改变 Session 数据、后续生命周期事件，以及 Package 缺失时的行为。

运行时 monkey patch `AssistantMessageComponent` 在技术上可以在不编辑 Pi 文件的情况下改变结果，但它会通过私有实现细节改变 Host 行为。这不是受支持的 Extension 方案，等同于在进程中携带一个与版本绑定的 Pi patch。

## 已认证范围

Pi Stuff 认证的是上游 commit `53fa77ccd8a279eb87e92294ef3687b03ff80112` 上的 Pi `0.84.1`，Bun 版本为 `1.3.14`；参见 [`docs/compatibility.md`](../compatibility.md#certified-host)。Pi `v0.84.1` 也是本说明检查时的当前版本。

下面相关的上游源代码引用均固定到该 commit，而非移动中的 branch。

## 为什么 Markdown transformer 无法移除该行

Pi 在每次 Assistant `message_start` 时创建一个 `AssistantMessageComponent`，将其追加到 `chatContainer`，在流式传输期间更新同一个组件，并在 `message_end` 时使其稳定。随后它只丢弃 `streamingComponent` 引用，并不会从 transcript 中移除已稳定的组件。恢复的消息各自还会得到另一个 `AssistantMessageComponent`。

来源：

- [`interactive-mode.ts` lines 3121–3216](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3121-L3216)
- [`interactive-mode.ts` lines 3453–3550](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3453-L3550)

在 `AssistantMessageComponent.updateContent()` 内，Pi 根据 **Markdown transformation 之前的原始消息内容** 做垂直布局决策：

1. 任意非空原始文本或 Thinking block 都会设置 `hasVisibleContent`。
2. `hasVisibleContent` 无条件插入一个前导 `Spacer(1)`。
3. Thinking block 根据原始后续 blocks 计算 `hasVisibleContentAfter`。
4. 如果后面还有另一个原始 text 或 Thinking block，Pi 会在 Thinking block 后再插入一个 `Spacer(1)`。
5. 只有嵌套的 `Markdown` component 会接收 Extension transformer。

来源：[`assistant-message.ts` lines 89–168](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L89-L168)。

因此，以下看似自然的修改并不充分：

```ts
if (context.messageType === "assistant-thinking" && !context.isStreaming) {
  return "";
}
```

它会让嵌套 Markdown 变为零高度，但无法撤回父组件已经创建的前导 spacer 或块间 spacer。

这是 seam 的限制，而不是 Pi Stuff 当前 semantic-block parser 的限制。Host 将 `registerMarkdownTransformer()` 文档化为同步的、仅用于显示的 **string-to-string** transform，并没有暴露 omit/suppress 结果：

- [`extensions/types.ts` lines 1147–1153](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L1147-L1153)
- [`docs/extensions.md` lines 1566–1591](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/docs/extensions.md#L1566-L1591)

Pi Stuff 当前正是使用这个公开、仅显示的 seam。其 transformer 接收 `isStreaming`，但当前实现有意以相同方式投影实时和已稳定 blocks：

- [`live-thought.ts` lines 34–51](https://github.com/jczhang02/pi-stuff/blob/add4468b5525e06acaae866f60c31a24534a829a/packages/pi-stuff/src/conversation-ui/live-thought.ts#L34-L51)
- [`conversation-ui/README.md` lines 92–102](../../packages/pi-stuff/src/conversation-ui/README.md#L92-L102)

## 已认证的组件探针

一个直接探针实例化了 Pi 0.84.1 的真实 `AssistantMessageComponent`，调用 `updateContent(message, false)`，并在 80 列下渲染。看起来为空白的终端行被规范化为 `<blank>`。

| Finalized Assistant content | Attempt | Rendered lines |
| --- | --- | --- |
| Thinking + Tool call | settled Thinking transforms to `""` | `1`: `<blank>` |
| Tool call only | Thinking semantically removed | `0`: none |
| Thinking + final text | settled Thinking transforms to `""` | `3`: `<blank>`, `<blank>`, ` Done.` |
| Final text only | Thinking semantically removed | `2`: `<blank>`, ` Done.` |
| Thinking + Tool call | native hide mode and empty hidden label | `2`: `<blank>`, `<blank>` |
| Thinking + final text | native hide mode and empty hidden label | `4`: three `<blank>` rows, then ` Done.` |

重要比较如下：

- Tool-calling message 在保留 Thinking 但将其转换为空时，从零行变为一行空白。
- Final text message 相对于移除 Thinking 的相同消息多出一行空白。
- `setHiddenThinkingLabel("")` 更糟糕，因为除了结构性 spacer 外，Pi 还会为每个隐藏 Thinking run 创建一个带样式的 `Text` component。

该探针使用仓库认证的 Pi `0.84.1` 依赖和 Bun `1.3.14`。观察到的计数直接遵循上面引用的父布局逻辑。

## 每个公开候选方案的评估

| Candidate | Live one-row projection | Settled zero-height | Session/context unchanged | Decision |
| --- | ---: | ---: | ---: | --- |
| `registerMarkdownTransformer()` | 是 | **否**；父 spacer 仍存在 | 是 | 当前安全 seam，但不充分 |
| `hideThinkingBlock` + `setHiddenThinkingLabel("")` | 无有用的实时投影 | **否**；探针中有两个或更多空白行 | 是 | 拒绝 |
| Working Row (`setWorkingMessage`) | 是 | Working Row 自身是 | 是 | 无法抑制原生 transcript block |
| Extension widget (`setWidget`) | 是 | widget 自身是 | 是 | 无法抑制原生 transcript block |
| `registerMessageRenderer()` | 否 | 否 | 是 | 只接受 `CustomMessage`，不接受内置 Assistant messages |
| `message_end` replacement | 是，有独立 live surface | 是 | **否** | 只有通过改变 canonical data 才能在视觉上工作 |
| Thinking level `off` | 没有可投影的 Thinking | 是 | Model behavior changes | 不是 UI 方案 |
| Runtime prototype/Host-tree monkey patch | 技术上可以 | 技术上可以 | 可能 | 不受支持的私有 Host 修改；拒绝 |
| ANSI cursor movement/erasure | 表面上可以 | 结构上不能 | 可能 | 会破坏 TUI 布局/scrollback；拒绝 |

### 原生隐藏 Thinking 模式

公开 UI API 只能通过 `setHiddenThinkingLabel()` 改变折叠 label；它没有暴露 `setHideThinkingBlock`、`ThinkingVisibility` 或独立的实时/历史 transcript 模式。Pi 0.84.1 的 `ExtensionUIContext` 包含 Working Row、hidden-label 和 widget setters，但没有结构性 Thinking-visibility setter：

- [`extensions/types.ts` lines 140–176](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L140-L176)
- [`interactive-mode.ts` lines 2093–2104](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2093-L2104)

Host 的原生 hide mode 意味着“渲染一个折叠 label”，而不是“省略该 block”；参见 [`assistant-message.ts` lines 139–166](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L139-L166)。

### Working Row 或 widget

Working Row 或 widget 是临时实时摘要的有效位置，并且可以消失而不保留自身的行。然而，这些 setters 作用于独立的 Host containers，对现有 `AssistantMessageComponent` children 没有权限。因此，将实时文本移到这些位置并不能解决稳定 transcript 的抑制问题。

来源：

- [`extensions/types.ts` lines 148–176](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L148-L176)
- [`interactive-mode.ts` lines 2066–2081](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2066-L2081)

### Custom message renderer

`registerMessageRenderer()` 的类型和文档只针对 extension-owned `CustomMessage` values。它无法替换内置 Assistant renderer：

- [`extensions/types.ts` lines 1159–1163 and 1288–1289](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L1159-L1163)
- [`docs/extensions.md` lines 1562–1564](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/docs/extensions.md#L1562-L1564)

### `message_end` replacement

这是唯一能让内置 component 在结构上为空的受支持 hook：返回不含 Thinking blocks 的 finalized Assistant message。Pi 先运行 Extension handlers，然后通知 TUI，最后持久化同一条消息。其 replacement helper 会明确地原地修改 Agent-state object，因此后续事件和 Session persistence 都会看到该 replacement。

来源：

- [`extensions/types.ts` lines 1097–1100](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L1097-L1100)
- [`agent-session.ts` lines 610–660](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts#L610-L660)
- [`agent-session.ts` lines 710–780](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts#L710-L780)

这是 message transformation，而不是 display transformation。它会在 Tool continuation 之前从 canonical Assistant message 中移除或重新定位 provider Thinking data，影响其他 extensions 和后续 lifecycle events，改变 resumed sessions，并使正确重建依赖 Pi Stuff 持续安装。`context` handler 可以维护第二份私有副本并在请求前重新插入，但这会创建新的 shadow Session/context layer，而且仍然无法满足“原始 Session data unchanged”这一 contract。Pi Stuff 不应走这条路。

## 缺失的 Host capability

可接受的最小 Host capability 必须是结构性的，而非装饰性的。Pi 必须允许 Extension 在 `hasVisibleContent`、`hasVisibleContentAfter` 和 spacer 构造之前抑制 Thinking block，同时保持原始 message 不变。

一种可能的 contract 是带 `isStreaming` 感知的 visibility decision，具有三种结果：

- `show`：渲染完整的 transformed Thinking；
- `collapse`：渲染一个 label；
- `omit`：不为该 block 创建 child，也不创建任何 spacing。

对于 Live-only Thoughts，Pi Stuff 会在流式传输期间请求 `show`，在稳定后和历史重建期间请求 `omit`。Host 仍然是 message components 和 spacing 的 authority。

上游 issue [#3203, “Zen mode in pi”](https://github.com/earendil-works/pi/issues/3203) 提议了相关的 `ThinkingVisibility`/transcript-mode capability，但在成为 Pi 0.84.1 的一部分之前已关闭。上游 issue [#3629](https://github.com/earendil-works/pi/issues/3629) 也确认目前没有暴露 per-block hidden-Thinking renderer；维护者拒绝了这个更宽泛的 renderer hook。这两个 issue 都没有改变上面描述的认证 API。

## 上游 issue 和 PR 搜索

2026-08-13 的搜索覆盖了 Pi GitHub Issues 和 pull requests，使用了 `thinking`、`hide`、`history`、`live transcript`、`renderer`、`blank line`、`zero height` 以及相关 API 名称的组合。搜索还扫描了当时全部 277 个 GitHub Discussions 的标题和正文。没有开放项目提供这一 capability，也没有已合并的修改能让稳定的 transformed Thinking block 在结构上变为零高度。

最接近的记录如下：

| Record | Match to this problem | Outcome |
| --- | --- | --- |
| [#4031, “Allow hidden thinking blocks to render as no visible chat row”](https://github.com/earendil-works/pi/issues/4031) | 几乎完全匹配。它要求仅 TUI omission、回收 spacer rows，以及保持 Session/model context 不变。 | 自动关闭，之后标记为 `no-action` 并以 `not planned` 关闭；没有维护者解释。 |
| [#3203, “Zen mode in pi”](https://github.com/earendil-works/pi/issues/3203) | 提议独立的实时和历史 transcript modes，并使用 `thinking: "show" | "collapse" | "hide"`。该 surface 可以表达 live-show/historical-hide，但提案还涉及 Tools 和 Working Row。 | 自动关闭，之后标记为 `no-action` 并以 `not planned` 关闭；未合并。 |
| [#1954](https://github.com/earendil-works/pi/issues/1954) 和 [PR #1955](https://github.com/earendil-works/pi/pull/1955) | 第一个请求对于原生 hidden mode 是精确的：“fully hide, no label, no space.” 这个四项新增/六项删除的 PR 将 hidden Thinking 从 `hasVisibleContent` 中排除，并跳过其行。 | PR 在 contribution gate 下未合并而关闭；维护者以“No.”关闭配对 issue。该 issue 还捆绑了隐藏 intermediate Assistant prose 的独立请求，因此这一字回复没有提供更窄范围的理由。 |
| [#3629, “Add per-block renderer hook for thinking”](https://github.com/earendil-works/pi/issues/3629) | 更宽泛的 Extension renderer hook 可以实现 omission。 | 维护者明确拒绝暴露它：“we already expose too many things”，并表示 server rewrite 后可能重新考虑。 |
| [#2673, “Add setHiddenThinkingLabel API”](https://github.com/earendil-works/pi/issues/2673) | 相关的已接受 customization，但只能改变折叠 label。 | 实现为 `ctx.ui.setHiddenThinkingLabel()`；它不会抑制 row 或 spacer。 |
| [#6747](https://github.com/earendil-works/pi/issues/6747) 和已合并的 [PR #7231](https://github.com/earendil-works/pi/pull/7231) | 建立了受支持的仅显示 Markdown-transform seam，并提供 `isStreaming`。 | 已合并，但其返回类型只有 `string`；父布局仍在应用 transform 前使用原始 content。 |
| [#6524, “Hide GPT-5.6 reasoning-summary empty placeholders”](https://github.com/earendil-works/pi/issues/6524) | 可见症状不同，但直接讨论了相同的数据/渲染边界。 | 维护者表示必须在 `AssistantMessageComponent` 中修复，而不能从 Assistant message 中过滤，因为那可能破坏 signature。该 issue 在 provider 修复了具体 placeholder 后关闭。 |

当前 `main` branch 仍然在 nested Markdown transformation 之前计算 `hasVisibleContent` 并插入 `Spacer(1)`，暴露 `setHiddenThinkingLabel()`，但没有 `setLiveTranscriptMode()`/`setHistoricalTranscriptMode()`，也没有内置 Assistant/Thinking renderer hook。因此这些记录确认了本地发现的两部分：所需行为过去曾被请求过，而上游目前没有已接受的结构性、仅显示解决方案。

## 建议

**不要**在 Pi Stuff 中实现 `!isStreaming ? "" : thought`。它会通过纯 transformer 测试，却在真实 Host contract 下因保留空白行而失败。

**不要**在 `message_end` 中剥离 Thinking，不要维护 shadow copy，不要 patch `AssistantMessageComponent.prototype`，也不要发出 cursor-control tricks。每个选项要么改变 canonical semantics，要么依赖私有 Host behavior。

在 Pi 暴露零高度 Thinking suppression 之前，保留现有的紧凑已稳定 Thought projection；或者在用户接受行为变化时明确关闭 model Thinking。所请求的 Live-only、zero-residue UI 应被记录为受限于一个狭窄上游 Host seam，而不是作为 Pi Stuff-only fix 实现。

## Host seam 可用后的验收标准

未来实现必须通过真实 Host behavior 认证，而不只是纯 transformer：

1. 在一个流式 Assistant message 期间，恰好有一个 Thought row 原位更新。
2. Thought + Tool-call Assistant message 稳定后，在 Tool row 之前 Assistant component 渲染零行。
3. Thought + final-text message 与等价的 text-only message 具有完全相同的 spacing。
4. 多次 Tool round-trips 不留下历史 Thought text，也不留下额外空行。
5. Resize、theme invalidation、reload、resume、tree navigation 和 compaction 都不会重新唤起已稳定的 Thoughts。
6. Session JSON 和下一个 provider context 保留字节等价的原始 Thinking blocks。
7. Pi 原生 Thinking toggle 对当前 live row 具有确定语义。
