# Subagent UI 重新开发访谈

[English](../../subagents-redevelopment-ui.md). 以英文版为准.

状态: 2026-09-20 已接受 UIR01 和修订后的 UIR02; 2026-09-21 已接受 UIR03 和 UIR04 局部帮助规则. FleetView 只在列表获得键盘焦点时于列表上方显示帮助. 首版 UIR02 图片仍作为被否定的设计历史保留. 沿用 [#97](https://github.com/jczhang02/pi-stuff/issues/97), 属于 [#64](https://github.com/jczhang02/pi-stuff/issues/64). 运行范围已在[重新开发决策](subagents-redevelopment.md)中确定.

按真实使用场景逐一讨论 UI: 主界面与页面关系、FleetView 与任务结构、详情与可观测性、介入操作、完成与历史、键盘与视觉统一. 根据维护者反馈, 本轮同时梳理详情的信息层级. 先前 UI 作为起点, 不整套继承它所依赖的旧运行要求.

## 视觉参考

已核对的 Ghostty 配置使用 Catppuccin Latte, 背景 `#eff1f5`, 前景 `#4c4f69`, 字号 12pt、略加粗、禁用连字、2px padding. 字体栈为 JetBrainsMono Nerd Font Mono、Symbols Nerd Font Mono、LXGW WenKai Mono. 配置默认窗口为 150 列、50 行; Pi 使用同一浅色主题及 fullscreen 模式. 本轮没有可读取的 live Terminal Control 会话.

图片依据该配置及先前真实的 [FleetView](../../assets/subagents/light-fleet-120x36.png)和[详情](../../assets/subagents/light-detail-160x48.png)截图生成. 它们是 1536x1024 的 ImageGen 概念图, 任务内容和指标为示例. 字体栅格、字符几何及键盘行为仍需在 Pi 中验证. 完整提示词和来源保存在 [generation.json](../../assets/subagents-redevelopment-ui/generation.json).

## UIR01: 主布局已接受

![主对话及右侧内容对齐后的 FleetView](../../assets/subagents-redevelopment-ui/03-main-aligned.png)

保留主对话、编辑器和 statusline, 下方紧接占满可用宽度的 FleetView. main 没有 description. 选中仅改变圆圈, 正常运行不标 Running. 焦点在 FleetView 时, 编辑器保留草稿但隐藏文字光标.

维护者还要求 Waiting 等状态与耗时/token 区域对齐. 修订图将各行尾部内容放入同一个右对齐区域. Waiting 的右边缘与 tokens 齐平, 不再单独放在指标前面. 有指标的行共用耗时和 token 列位置; 名称和描述也各自共用列位置.

## 首版详情为何被否定

维护者认为[首版详情图](../../assets/subagents-redevelopment-ui/02-detail.png)信息冗余, 缺少辨别度. Prompt、Progress 和另外五个分类拥有接近的视觉权重, 读者必须在页面中寻找最新的有用信息.

实际观察到的 [Claude Code task detail](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/assets/claude-subagent-ui/05-task-detail.png)将身份/指标、当前活动、prompt 和操作紧凑排列, 完整 transcript 另行阅读. [调研记录](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md)区分了真实 CLI 交互和 fixture 提供的内容.

当前 [Claude Agent View 文档](https://code.claude.com/docs/en/agent-view#peek-and-reply)在预览中优先显示最近输出或待回答的问题. [Cursor 的 review 流程](https://docs.cursor.com/en/agent/review)让用户直接从 agent 回复进入代码成果. 本提案借鉴这些信息顺序. Pi 的底部详情不依赖它们的会话切换、预览容器或 GUI 控件.

## UIR02: 修订详情已接受

打开子代理后接管底部整个交互区域, 上方保留可见主对话. 查看时不显示主编辑器、主 statusline 和 FleetView. 返回恢复先前 FleetView 选择及主输入草稿, 后台工作继续. 维护者已接受修订后的信息层级及沿用的页面关系. 图中按键和确切高度仍作示意.

### 运行中

![突出最新回复和简短工具活动的运行中详情](../../assets/subagents-redevelopment-ui/04-detail-working.png)

标题只出现一次子代理身份和任务描述, 附近显示模型及用量. Prompt 收成可展开的一行. 页面中心是子代理最新的可见回复, 后面是最近的工具活动. 示例回复本身带有强调的发现, UI 无需再调用模型生成摘要. 树形仅用于局部工具活动, 不再作为所有数据分类的目录.

Transcript 进入完整记录. Info 提供配置、工作区、详细用量及历史的入口, 具体组织留到后续部分.

### 完成后

![直接显示报告的已完成详情](../../assets/subagents-redevelopment-ui/05-detail-done.png)

同一区域直接展示最终报告, 无需再打开 Result 分类才能看见结论和依据. 工具证据折叠. 标题显示 Done, 因为调查已成功完成; 报告发现上游问题不等于本次代理执行失败.

运行中和完成后是同一设计的两个状态. 操作提示相应从 message/stop 变为 follow-up. 具体按键和操作行为暂作示意, 在交互部分确定.

**UIR02 已接受.** 运行中先看最新回复和当前活动, 完成后直接看报告, 辅助信息深入一层查看. 完整证据仍可读取, 首屏自身就有用. 明确待答问题和错误仍需单独出图梳理.

## UIR03: FleetView 与任务关系已接受

FleetView 继续使用 UIR01 已接受的紧凑列表, 不因任务存在依赖而改变行布局. 独立任务无需额外关系图. 选中的任务属于依赖流程时, 提供入口, 在底部查看区域打开其真实依赖图. 入口具体按键留到键盘交互部分确定.

### 独立调查

![三个独立调查沿用 FleetView](../../assets/subagents-redevelopment-ui/06-independent-fleet.png)

Lifecycle、packages 和 tests 独立调查, 每行都能打开详情. 不画依赖箭头, 也不构造父子树. 这张历史图底部的 `j/k` 提示由 UIR04 的焦点对比图取代.

### 存在依赖的流程

![两个前置调查汇入 reviewer, 其中一份报告仍未完成](../../assets/subagents-redevelopment-ui/07-dependency-graph.png)

这是另一个场景: reviewer 需要 lifecycle 和 packages 的结果. 图中是从 FleetView 打开关系图之后的画面. Packages 已完成, lifecycle 仍在工作, reviewer 尚未启动. 两条依赖边保留, 选中节点下方明确说明还缺 lifecycle.

显式依赖统一使用有向图, 简单串行链也沿用这一形式. 箭头从前置任务指向使用结果的任务. 选择节点后查看状态, 并进入已接受的详情页; 返回先恢复图中选择, 再回到 FleetView. 上方主对话保持可见, 关系图接管底部交互区域.

已接受紧凑列表与按需关系图的分工, 不提供任意切换 list/tree/graph 的模式菜单. 关系来自已记录的依赖, 不从 prompt 文本或代理名称推断. 图中报告和时间为示例. Waiting 原因适用于这次汇合场景, 不表示所有排队任务都在等待未完成的依赖; 上游按就绪波次调度的运行基线保持不变. 接受范围是关系呈现, 不包括关系图中示意性的按键提示.

**UIR03 已接受.** 保留列表形式的 FleetView, 仅在存在真实依赖时提供关系图入口, 图中节点进入同一个详情页.

## UIR04: 局部帮助已接受

**已确定的修正.** FleetView 可见不等于它获得键盘焦点. 维护者要求列表获得焦点时才显示导航/操作帮助. 在主编辑器输入时隐藏这行帮助, 代理列表仍然保留.

### 参考行为

已检查的 Pi 0.85.1 [选择按键](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/keybindings.ts)默认为上下键、Enter 和 Escape/Ctrl+C. [ExtensionSelector](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/extension-selector.ts)额外接受 `j/k`, 但在列表下方显示 `↑↓ navigate` 及配置中的确认/取消按键. Pi 的其他选择器也有在列表上方显示帮助的例子, 帮助位置并非全局统一.

已记录的 Claude Code 2.1.261 [FleetView 焦点截图](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/assets/claude-subagent-ui/02-selected.txt)将操作帮助放在列表上方. [编辑器焦点截图](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/assets/claude-subagent-ui/04-message.txt)仍保留列表, 但用输入场景提示取代 FleetView 操作帮助. Claude 的行指针和当前会话圆圈含义不同. 我们沿用已接受的仅圆圈选中, 不复制这套双标记, 也不表示切换了宿主会话.

此前的 `j/k select` 页脚是概念稿自行选择的写法, 不是 Pi/Claude 共同的默认方案. 优先沿用 Pi 已配置的选择按键, 提示显示实际键位. 新图使用默认上下键/Enter 文案及 Pi Stuff 固定的 Esc 返回规则.

### 主编辑器获得焦点

![主编辑器有文字光标, FleetView 没有局部帮助和实心选中圆圈](../../assets/subagents-redevelopment-ui/08-editor-focus.png)

草稿显示文字光标. FleetView 所有圆圈空心, 不显示局部帮助. 内部仍记住上次列表选择, 供返回列表时恢复. 编辑器的光标移动、历史和自动补全保持 Pi 行为.

### FleetView 获得焦点

![FleetView 在列表上方显示局部导航帮助, 只填实所选圆圈](../../assets/subagents-redevelopment-ui/09-fleet-focus.png)

草稿保留, 隐藏文字光标. 只有 lifecycle 的选中圆圈填实. statusline 和列表之间出现一行弱化的帮助: `↑↓ navigate · enter view · esc back`. 不增加指针、整行背景或列表下方的帮助. 两张图的行位置相同; 预留空行仅作示意, 不是固定高度要求.

已接受的帮助位置参考 Claude 的局部操作提示, 导航沿用 Pi 的选择按键. 先前已同意用上下键进入 FleetView, 入口须保留编辑器本身的正常处理. 本轮不决定 stop、message 等介入操作的键位.

**UIR04 已接受.** FleetView 局部操作提示放在列表上方、statusline 下方, 随键盘焦点改变. 列表获得焦点时显示 FleetView 操作, 返回编辑器时隐藏这些操作. 维护者明确接受了 Claude 的这条帮助规则. 具体提示文案及图中失焦后圆圈全空心的处理仍作示意; 先前仅通过圆圈表示选中的规则保持不变.

## 验证与下一步

UIR03 和 UIR04 局部帮助规则已接受. 已目视检查焦点概念图的文字光标、帮助位置、圆圈选择和行对齐. 概念图不作为终端运行证据. 本次记录维护者的回答, 不改产品代码或图片. 接下来继续梳理详情可观测性和介入操作场景.
