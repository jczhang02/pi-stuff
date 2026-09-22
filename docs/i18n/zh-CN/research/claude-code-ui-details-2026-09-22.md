# Claude Code 展开提示与工具细节

[English](../../../research/claude-code-ui-details-2026-09-22.md) · [UI spec](../ui-spec.md) · [实测截图](../../../../prototypes/ui-session/detail-reference/README.md)

值得借鉴的是按隐藏内容显示展开提示, 以及在 diff 中保留少量上下文. Fullscreen 隐藏失败的做法不适合 Pi. 下文先列显示规则和建议, 最后说明测试方法.

## 展开与收起提示

当前原型追加了 ` · expand` 和 ` · collapse`. 建议去掉常驻的 ` · collapse`, 将泛用的 ` · expand` 换成有条件的隐藏内容摘要, 例如 `… +5 lines`. 如果操作不容易发现, 可在摘要旁保留简短的点击提示. 展开后的内容本身已表达状态, 没有隐藏内容的短结果不需要提示.

[Classic 多行输出截图](../../../../prototypes/ui-session/detail-reference/multiline-classic-100/compact.png)显示前三行, 再显示 `… +5 lines (ctrl+o to expand)`, 短结果没有同类后缀. Fullscreen 使用活动计数和全局详细记录. 这里测试的是 Claude 的键盘交互, 不能当作 Pi 单工具鼠标行为的测试.

Pi 保留单工具点击和现有键盘行为. 去除常驻文字后缀仍是提案, 尚未实施.

## 工具输出与信息密度

### Classic 与 fullscreen

Classic 保留普通 Bash 和 Edit 调用, 只读检索仍可聚合. fullscreen compact 会把完成的 activity 折叠成 `Ran 2 shell commands`, `Read 2 files` 和 `Thought for 1s, read 2 files` 这样的 summary. `Ctrl+O` 切到详细记录, 恢复原始顺序. 这是 Claude Code 的全局 transcript mode, Pi Stuff 可以继续使用已有的逐个 tool 鼠标展开和 `Ctrl+O` 工具行为.

### 空输出与失败

空输出明确显示 `(No output)`. Classic 将 `Error: Exit code 3` 和 stderr 放在同一个连接符下. Fullscreen 收起状态只显示 `Ran 1 shell command`, 失败因此被隐藏. Pi 应保留当前失败可见的做法.

### Edit 摘要与上下文

[Edit 截图](../../../../prototypes/ui-session/detail-reference/edit-classic-100/compact.png)先显示 `Update(a.txt)`, 然后是 `Added 3 lines, removed 2 lines` 和带颜色的改动行. diff 正文不重复 `⎿`. 详细模式恢复前面的 Read 调用, Update 保留同样的结果结构和上下文. Pi 可将操作标题、结果摘要和 diff 放在一起, 只在结果开头显示连接符. 收起预览可保留少量上下文, 如图中未改动的 `gamma` 行.

### 运行中的工具可以优先显示动作描述

[Fullscreen 运行中截图](../../../../prototypes/ui-session/detail-reference/running-fullscreen-100/running.png)用 `Inspecting controlled terminal output` 作标题, 具体命令放在下方. Pi 可在运行时利用工具已有的有效描述, 下方保留命令. 这项建议无需额外生成描述, 也不要求改变完成后的工具名称.

### 思考内容独立显示

[收起摘要](../../../../prototypes/ui-session/detail-reference/thought-classic-100/compact.png)为 `Thought for 1s, read 2 files`. [Classic 详细记录](../../../../prototypes/ui-session/detail-reference/thought-classic-100/expanded.png)将思考正文放在两次 Read 之间, 使用浅色 `∴` 前缀, 不嵌入工具结果, 也不使用 `⎿`. Pi 可保留已选的 `Thoughts:` 前缀, 显示与隐藏继续服从 Pi 设置.

## Esc 中断

Classic 运行时显示工具标题, `⎿` 引出实时输出和耗时, 页脚提示 `esc to interrupt`. 按下 Esc 后, 工具保留, 输出替换为:

```text
⎿  Interrupted · What should Claude do instead?
```

运行指示和 token 计数消失. 中断提示仍属于工具结果. Fullscreen 保留活动计数, 收起与详细记录中均可见中断提示.

Pi 保留原生中断样式, 这是已确认的设计要求. Claude 的工具中断文案只作参考.

## 测试方法与限制

本次使用已安装的官方 Claude Code `2.1.261`, binary SHA256 为 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`. 我在 classic 和 fullscreen 两种模式下各运行了八个确定性 local fixture, 共十六个新的 Terminal Control PTY, 终端尺寸为 100 x 40. 完成状态都在 `Ctrl+O` 前后捕获. running case 还捕获了运行中画面和按下 `Esc` 后的画面.

客户端在临时 project 中真实执行了 `Bash`, `Read` 和 `Edit`. localhost Anthropic-compatible SSE fixture 提供 tool-use blocks 和最终的 `PROBE_COMPLETE` 文本. 这样可以隔离 renderer 和工具执行路径, 但不能证明 live model 的工具选择, account 行为或所有工具集成. 没有使用用户凭据, host settings 或 project 文件.
