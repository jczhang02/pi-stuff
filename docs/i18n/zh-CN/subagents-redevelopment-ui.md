# Subagent UI 重新开发访谈

[English](../../subagents-redevelopment-ui.md). 以英文版为准.

状态: 2026-09-20 更新第 1 部分, 主界面与页面关系. UIR01 已接受, 并要求修正右侧列对齐. 首版 UIR02 详情设计被否定, 下方修订提案仍待回答. 沿用 [#97](https://github.com/jczhang02/pi-stuff/issues/97), 属于 [#64](https://github.com/jczhang02/pi-stuff/issues/64). 运行范围已在[重新开发决策](subagents-redevelopment.md)中确定.

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

## UIR02: 修订详情提案

仍提议打开子代理后接管底部整个交互区域, 上方保留可见主对话. 查看时不显示主编辑器、主 statusline 和 FleetView. 返回恢复先前 FleetView 选择及主输入草稿, 后台工作继续. 这一页面关系和修订后的信息层级一起等待确认.

### 运行中

![突出最新回复和简短工具活动的运行中详情](../../assets/subagents-redevelopment-ui/04-detail-working.png)

标题只出现一次子代理身份和任务描述, 附近显示模型及用量. Prompt 收成可展开的一行. 页面中心是子代理最新的可见回复, 后面是最近的工具活动. 示例回复本身带有强调的发现, UI 无需再调用模型生成摘要. 树形仅用于局部工具活动, 不再作为所有数据分类的目录.

Transcript 进入完整记录. Info 提供配置、工作区、详细用量及历史的入口, 具体组织留到后续部分.

### 完成后

![直接显示报告的已完成详情](../../assets/subagents-redevelopment-ui/05-detail-done.png)

同一区域直接展示最终报告, 无需再打开 Result 分类才能看见结论和依据. 工具证据折叠. 标题显示 Done, 因为调查已成功完成; 报告发现上游问题不等于本次代理执行失败.

运行中和完成后是同一设计的两个状态. 操作提示相应从 message/stop 变为 follow-up. 具体按键和操作行为暂作示意, 在交互部分确定.

**UIR02 问题. 是否沿此详情层级继续: 运行中先看最新回复和当前活动, 完成后直接看报告, 辅助信息深入一层查看?** 推荐采用. 完整证据仍可读取, 首屏自身就有用. 存在明确待答问题或错误时应优先显示, 这些状态仍需单独出图梳理.

## 验证与下一步

已目视检查三张修订图的 FleetView 尾列对齐、主界面/详情分离、英文内容及运行中/已完成的信息层级. 两张首版图保留为设计历史. 本轮仅更新文档和概念图, 未实现运行代码或进行终端验收. 等待维护者回答修订后的 UIR02, 再推进访谈.
