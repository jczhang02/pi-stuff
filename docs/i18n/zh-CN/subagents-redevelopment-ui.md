# Subagent UI 重新开发访谈

[English](../../subagents-redevelopment-ui.md). 以英文版为准.

状态: 2026-09-20 开始第 1 部分, 主界面与页面关系. 下方 UIR01-UIR02 为待维护者回答的提案. 沿用 [#97](https://github.com/jczhang02/pi-stuff/issues/97), 属于 [#64](https://github.com/jczhang02/pi-stuff/issues/64). 运行范围已在[重新开发决策](subagents-redevelopment.md)中确定.

按部分逐一讨论 UI, 主要使用真实使用场景的图示. 顺序为主界面与页面关系、FleetView 与任务结构、详情与可观测性、介入操作、完成与历史、键盘与视觉统一. 本轮只讨论第 1 部分. 以先前 UI 为起点, 不整套继承它所依赖的旧运行要求.

## 视觉参考

当前 Ghostty 使用 Catppuccin Latte, 背景 `#eff1f5`, 前景 `#4c4f69`, 字号 12pt、略加粗、禁用连字、2px padding. 字体栈为 JetBrainsMono Nerd Font Mono、Symbols Nerd Font Mono、LXGW WenKai Mono. 配置的默认窗口为 150 列、50 行; Pi 使用同一浅色主题及 fullscreen 模式. 本轮没有可读取的 live Terminal Control 会话.

两图依据该配置及先前真实的 [FleetView](../../assets/subagents/light-fleet-120x36.png)和[详情](../../assets/subagents/light-detail-160x48.png)截图生成. 它们均为 1536x1024 的 ImageGen 概念预览, 任务内容和指标为示例, 不是正在运行的实现截图. 字体栅格、字符几何及键盘行为仍需在 Pi 中验证. 完整提示词和来源保存在 [generation.json](../../assets/subagents-redevelopment-ui/generation.json).

## 状态 1: 主界面与 FleetView

![主对话、保留的草稿、statusline 和 FleetView](../../assets/subagents-redevelopment-ui/01-main.png)

主代理启动 lifecycle 和 packages 两项调查, reviewer 等待它们的报告. 主代理在编辑器上方继续自己的调查. FleetView 位于 statusline 下方, 占满可用宽度. 选中的 lifecycle 仅改变圆圈; main 没有 description, 正常运行不标 Running. 浏览焦点在 FleetView 时, 编辑器保留草稿但隐藏文字光标.

**UIR01. 是否保留这个主界面布局?** 推荐保留主对话、编辑器和 statusline, 将紧凑的 FleetView 紧接在下方. 通过列表查看子代理, 同时保留主输入草稿.

## 状态 2: 打开 lifecycle 详情

![上方主对话与底部 lifecycle 详情](../../assets/subagents-redevelopment-ui/02-detail.png)

打开 lifecycle 后, 上方仍为主对话, 底部整个交互区域替换为该子代理详情. 查看期间不显示主编辑器、主 statusline 和紧凑 FleetView. 这是主会话中的原位查看, 不使用 overlay, 也不切换宿主会话. 详情标题标明正在查看的代理; Prompt 在 Progress 之前, 工具活动以树状呈现.

**UIR02. 是否采用这种底部接管, 返回时恢复主界面?** 推荐沿用图示转换, 将底部空间交给详情, 保留上方可见主对话. 返回后恢复先前 FleetView 选择和主输入草稿. 查看或返回不停止后台工作.

## 图示范围

本轮只决定以上两项布局提案. 图中的分段名称、指标、快捷键提示和大致高度分配用于说明页面关系, 具体内容在对应的后续部分确定. 出图时修正了主编辑器光标, 因为当时焦点在 FleetView. 已目视检查两张最终图的主界面/详情转换、英文内容、选中样式及详情中主控件的移除. 本轮未修改产品代码或进行终端验收.
