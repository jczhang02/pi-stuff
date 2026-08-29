<!-- translation-source: docs/research/pi-latest-markdown-transform-20260820.md; translation-source-sha256: 644ec8373af6241e0260655b6be1ad26bee3cee900d79d5eaf78a960d9d72525 -->
# 截至 2026-08-20 的 Pi Markdown 转换 API

## 问题

当前公开的 Pi Extension API 能否在与开头 Markdown 列表相同的终端行上添加一个 Assistant transcript 标记，同时不添加新行或替换列表自身的标记？

## 检查的版本

- 最新官方发行版是[`v0.84.2`](https://github.com/earendil-works/pi/releases/tag/v0.84.2)，于 2026-08-14 发布，对应 commit [`914cf14`](https://github.com/earendil-works/pi/commit/914cf1472e715297caa30db4b9535d534a9eb718)。
- 2026-08-20 也检查了默认分支。其 commit 历史截至 2026-08-19 已超出该发行版，而 coding-agent package 仍报告版本 `0.84.2`：[main 历史](https://github.com/earendil-works/pi/commits/main)、[main package.json](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json)。

## 发现

### 转换器仍是 source-to-source

`v0.84.2` 和当前 `main` 都将转换器定义为：

```ts
export type MarkdownTransformer = (markdown: string, context: MarkdownTransformContext) => string;
```

上下文只包含 `messageType`、`isStreaming` 和 `availableWidth`。它没有已渲染行前缀、gutter、component、theme 或 decoration 字段。参见[`main 上的 types.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts#L1074-L1105)以及[`v0.84.2` 源码](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/extensions/types.ts#L1059-L1090)。

官方 Extension 指南说明，转换器结果会作为 Markdown 字符串串联，然后传给 Pi 的内置渲染器。它还要求转换保持同步且开销低，因为转换会在流式输出、恢复的回放以及终端调整大小期间运行。参见[`main 上的 extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#piregistermarkdowntransformertransformer)和[`v0.84.2` 指南](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/extensions.md#piregistermarkdowntransformertransformer)。

当前实现确认只接受并返回字符串结果：[`markdown-transform.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/markdown-transform.ts)。

### Pi 仍拥有普通 Assistant 的渲染

`AssistantMessageComponent` 为普通 Assistant 文本构造内置的 `Markdown` component，并将已注册的 source transform 传给它。不存在普通 Assistant renderer override 或渲染后的行 decorator：[`assistant-message.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L83-L106)。

`registerMessageRenderer()` 只作用于 Extension 创建的 `CustomMessage` 记录。`registerEntryRenderer()` 只作用于 Extension 创建的 `CustomEntry` 记录。二者都不能替换或装饰普通 Assistant 消息：[`extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#message-and-entry-rendering)。

### TUI Markdown component 没有通用的行前缀选项

当前 `MarkdownOptions` 暴露 source transformation、列表标记保留、转义保留和 LaTeX 渲染。它没有首行或续行前缀选项。转换发生在词法分析和换行之前：[`packages/tui/src/components/markdown.ts`](https://github.com/earendil-works/pi/blob/main/packages/tui/src/components/markdown.ts#L204-L213)、[`render()`](https://github.com/earendil-works/pi/blob/main/packages/tui/src/components/markdown.ts#L258-L341)。

## 结论

最新发行版和当前默认分支都没有公开的、仅通过 package 即可在渲染后为普通 Assistant Markdown 附加消息级 gutter 的方式。

字符串转换只有通过改变 Markdown 结构才能使标记可见。对于开头列表，现有变通方案都会违反某项要求：

- 添加一个原本为空的外层 item 会创建只有标记的行；
- 替换第一个真实列表标记会混淆消息所有权与列表所有权；
- 转义或扁平化列表会丢失真实的 Markdown 列表结构；
- 修改 Host theme/render 内部实现不是稳定的公开 Extension 方案。

对公开接口进行的窄范围修复，应是扩展现有的 display-projection 契约，加入已渲染行前缀元数据；或者在 Host 所拥有的 Markdown 渲染路径中加入等价的行前缀选项。这样 Pi 就可以在缩减后的内容宽度下渲染原始 Markdown，并将 `"• "` 应用于第一条已渲染行，将 `"  "` 应用于续行。

## 已认证 Host 的 package 变通方案

当修改 Host 超出范围时，Pi Stuff 仍可以通过复用其当前 Assistant marker projection 所使用的、已认证的 Host theme binding 来产生所需布局：

1. 仅将开头为列表的 Assistant display projection 包装在一个合成的 Markdown blockquote 中。blockquote 是内置 Markdown 结构，它会在嵌套 Markdown 被解析并换行后，为每条已渲染行提供前缀。
2. 使用 identity Markdown theme，在 `availableWidth - 2` 下对未改变的 Assistant Markdown 执行一次测量渲染。记录已渲染行数，以及内部 italic、quote-style 和 quote-border 的调用次数。
3. 在实际渲染期间，恰好透传那些测量到的内部调用。仅中和合成外层 quote 的 italic/color 样式，将其第一条 border 绘制为 `"• "`，将其其余 border 绘制为 `"  "`，并在测量所得的最后一条外层行之后同步恢复 Host theme 方法。

这会保持真实的嵌套 quote 不变，并防止临时 theme projection 泄漏到同一 TUI frame 中后续的 Markdown child。针对已认证真实 renderer 的一次性 probe 为扁平、换行、嵌套、有序、task、引用、代码块、rich-inline 和 table 情况产生了所需输出，包括：

```text
• - one
  - two

• 1. one
  2. two

• - one
      - child
  - two
```

代价是受影响的开头列表消息会额外进行一次同步 Markdown 渲染。转换仍仅影响显示；Session 和 model-context Markdown 不变。这不是普遍可移植的公开 Extension 技术，而是针对仓库明确认证的 Host profile 的有界 package 实现，并且不需要修改 Host 源码。
