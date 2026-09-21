# Claude Code 详细 UI 观察

这份报告回答 Pi Stuff conversation UI 的两个问题: `Esc` 中断后应该怎么显示, 以及是否需要单独的 collapse/expand 标识. 对应截图, 文本捕获, 压缩 ANSI 和 fixture exchange 保存在[捕获画廊](../../../../prototypes/ui-session/detail-reference/index.html). [English](../../../research/claude-code-ui-details-2026-09-22.md)

## 范围和方法

本次使用已安装的官方 Claude Code `2.1.261`, binary SHA256 为 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`. 我在 classic 和 fullscreen 两种模式下各运行了八个确定性 local fixture, 共十六个新的 Terminal Control PTY, 终端尺寸为 100 x 40. 完成状态都在 `Ctrl+O` 前后捕获. running case 还捕获了运行中画面和按下 `Esc` 后的画面.

客户端在临时 project 中真实执行了 `Bash`, `Read` 和 `Edit`. localhost Anthropic-compatible SSE fixture 提供 tool-use blocks 和最终的 `PROBE_COMPLETE` 文本. 这样可以隔离 renderer 和工具执行路径, 但不能证明 live model 的工具选择, account 行为或所有工具集成. 没有使用用户凭据, host settings 或 project 文件.

## 1. `Esc` 中断应保留 Pi 原生行为

classic 的运行中画面显示普通 tool header, live output 前的一个 `⎿` 子结果连接符, elapsed output, 以及 footer 中的 `esc to interrupt`. 按下 `Esc` 后, Claude Code 保留原来的 tool, 并将 live child content 替换为:

```text
⎿  Interrupted · What should Claude do instead?
```

运行中的 spinner 和 token counter 消失. 中断仍然附着在 tool result 上, 没有单独变成 assistant error message. fullscreen 会保留 activity count, 收起的 cancelled 画面和详细 transcript 中都能看到中断子结果.

因此 Pi Stuff 的决定很简单: 保留 Pi 原生的 `Esc` 中断样式. tool display 不应该新增 failure card, 不应该把中断改成 assistant error, 也不应该替换现有原生文案. Claude 的[运行中截图](../../../../prototypes/ui-session/detail-reference/running-classic-100/running.png)和[中断后截图](../../../../prototypes/ui-session/detail-reference/running-classic-100/cancelled.png)可以说明中断应该属于哪里, 但不能授权改变用户明确要求的 Pi 原生行为.

## 2. 不需要常驻的 expand/collapse 文字

当前原型追加了 ` · expand` 和 ` · collapse`. 建议去掉常驻的 ` · collapse`, 将泛用的 ` · expand` 换成有条件的隐藏内容摘要, 例如 `… +5 lines`. 如果操作不容易发现, 可在摘要旁保留简短的点击提示. 展开后的内容本身已表达状态, 没有隐藏内容的短结果不需要提示.

[Classic 多行输出截图](../../../../prototypes/ui-session/detail-reference/multiline-classic-100/compact.png)显示 `… +5 lines (ctrl+o to expand)`, 短结果没有同类后缀. Fullscreen 使用活动计数和全局详细 transcript. 这里测试的是 Claude 的键盘交互, 不能当作 Pi 单工具鼠标行为的测试.

保留现有工具点击区域, 通用键盘说明放在帮助中. Thoughts 已用 `• Thoughts for 4s` 和 `• Thoughts: ...` 区分两种状态, 无需常驻操作后缀. 以上是建议, 本轮没有修改展开提示.

`⎿` 仍是结果连接符, 与展开状态分开. [两个结果的截图](../../../../prototypes/ui-session/detail-reference/two-classic-100/compact.png)中各结果一个连接符, 续行与结果正文对齐.

## 3. 新截图显示的细节

### classic 和 fullscreen 使用不同的信息密度

Classic 保留普通 Bash 和 Edit 调用, 只读检索仍可聚合. fullscreen compact 会把完成的 activity 折叠成 `Ran 2 shell commands`, `Read 2 files` 和 `Thought for 1s, read 2 files` 这样的 summary. `Ctrl+O` 切到详细 transcript, 恢复原始顺序. 这是 Claude Code 的全局 transcript mode, Pi Stuff 可以继续使用已有的逐个 tool 鼠标展开和 `Ctrl+O` 工具行为.

### hidden-lines 提示是有条件的

classic 的[multiline Bash result](../../../../prototypes/ui-session/detail-reference/multiline-classic-100/compact.png)显示前三行, 然后显示 `… +5 lines (ctrl+o to expand)`. 两行结果没有隐藏内容, 因而没有提示. 空输出仍然明确显示 `(No output)`. 失败命令的 `Error: Exit code 3` 和 stderr 保留在一个连接符下. 这个提示应该只属于确实隐藏了内容的情况, 不应该出现在每次 tool invocation 中. fullscreen 的 failed compact capture 会把 error 隐藏在 `Ran 1 shell command` 后面, 这是观察到的 density rule, Pi 不应该照搬, 因为 failure 必须保持可见.

### Edit 使用 result-first diff preview

Edit fixture 的[截图](../../../../prototypes/ui-session/detail-reference/edit-classic-100/compact.png)显示 `Update(a.txt)`, 接着是 `Added 3 lines, removed 2 lines`, 再接带颜色的 changed rows. diff rows 不重复 `⎿`. 详细模式会恢复前面的 Read call, 同时保持同一个 Update result 结构并保留 context line. 对 Pi 有用的设计线索是: operation header, result summary 和 contextual diff 应该作为一个 visual block, 连接符只在结果开始处出现一次. Pi 当前 changes-only preview 可以考虑保留一个小的 context budget, 例如这里的未改变 `gamma` 行.

### 运行中的工具可以优先显示动作描述

[Fullscreen 运行中截图](../../../../prototypes/ui-session/detail-reference/running-fullscreen-100/running.png)用 `Inspecting controlled terminal output` 作标题, 具体命令放在下方. Pi 可在运行时利用工具已有的有效描述, 下方保留命令. 这项建议无需额外生成描述, 也不要求改变完成后的工具名称.

### thinking 是独立的 activity line

compact summary 是[这张截图](../../../../prototypes/ui-session/detail-reference/thought-classic-100/compact.png)中的 `Thought for 1s, read 2 files`. [detailed classic](../../../../prototypes/ui-session/detail-reference/thought-classic-100/expanded.png)中, thinking content 作为一行弱化的 standalone text 出现在两个 Read 之间, 前面带浅色 `∴`. 它不嵌套在 tool result 下, 也不使用 `⎿`. Pi 已选择的 `Thoughts:` 前缀可以保留这种语义分离, 同时继续服从 Pi 的 hidden/visible thinking 设置.

## 这份证据支持的 Pi Stuff 修改

对当前 Pi Stuff prototype, 证据支持四个范围很窄的修改:

- 保留 Pi 原生的 abort 和 interruption rendering.
- 删除常驻的 ` · collapse`, 将泛用 ` · expand` 换成有条件的隐藏内容摘要.
- summary 只在确实隐藏内容时显示 conditional hint, 展开后保持安静.
- 每个可见 child result 保留一个结果连接符, Thoughts 保持在 tool-result 缩进之外.

这些截图不足以支持把 Claude Code 的 fullscreen mode, global transcript footer, model statusline 或 interruption wording 复制进 Pi Stuff. 那些是客户端自己的 surface. 真正可迁移的灵感是 conditional hint, connector 与 disclosure 的分离, result-first diff block, 以及 summary/detail 之间的信息密度切换.
