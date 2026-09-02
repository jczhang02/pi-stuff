<!-- translation-source: docs/capabilities/conversation-ui.md; translation-source-sha256: d494cf0faf0c547d3c68771a26ade7e399828fb69040ee5aac1340e4b2aae0d6 -->

# Conversation UI

[English](../../../../../docs/capabilities/conversation-ui.md)

Conversation UI 让 Pi Stuff 的当前状态在 Pi 内保持易读。它负责 Welcome header、响应式 Statusline、输入呈现、
实时 Thought 投影、围栏可视化、共享 Command Dialog 和 Suite 诊断。

## 快速开始

启动 Pi，然后运行：

```text
/ui
```

交互设置列表会立即应用变更，并把用户修改保存到 `<agentDir>/pi-stuff.json` 的 `ui` 或 `tools` 命名空间。

## UI 设置

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| Statusline | 开 | 显示当前 model、工作区、Context、用量和选定能力状态 |
| Statusline density | Auto | 随终端宽度在完整与紧凑内容之间切换 |
| Latest prompt | 开 | 用一行有界文字显示最近提交的 prompt |
| Welcome header | 开 | 显示 Suite 启动概览 |
| Input highlighting | 开 | 高亮已识别的 slash 命令和输入结构 |
| Inline slash autocomplete | 开 | 在原生编辑器中补全命令和 Skill 名称 |
| Tool running timer | 开 | 为长时间运行的活动 Tool 行加入经过时间 |

Tool timer 由 Tool Display 负责，但放在 `/ui` 中，便于集中管理呈现设置。

## Statusline

Statusline 使用一行状态和可选的一行 latest prompt。在空间允许时，状态行保持固定顺序：model 与 Thinking、
Codex Fast mode、工作目录与 Git、Context、cache 或用量、当前 Goal，以及 Ponytail mode。

`auto` 密度会先缩短字段，再移除低优先级组。它不会换行，也不会留下截断的半个字段。Model 与 Context
保留最久。只有当前状态需要持续指示时，Goal 与 Ponytail 才会出现。

Latest-prompt 行只占一个终端行。Skill 调用会缩减为提交任务与紧凑 Skill 标签；展开的 Skill 指令和本地路径
不会显示。

## Welcome header

Welcome header 提供活动 model、项目和 Suite 入口的紧凑启动视图。关闭后不会显示，聚焦 Command Dialog
打开时也会让出界面。`/ui` 是修改该呈现选项的唯一入口。

## 输入呈现

输入高亮和行内补全扩展 Pi 的原生编辑器，不替换其快捷键或草稿处理。Slash 补全覆盖已注册命令，并为 Skill
插入规范的 `/skill:<name>` 形式。

聚焦 dialog 会暂时占用编辑器界面。关闭后恢复完全相同的草稿和普通 Pi chrome。

## 实时 Thought

关闭 Pi 原生 **Hide thinking blocks** 设置后，model 工作时可以在编辑器上方投影当前语义 Thought block。
该投影有界且仅用于显示。完整形式以 `• thoughts:` 开头，窄屏形式保留同一个 `•` Transcript marker，且该
marker 与 Tool Activity 对齐。完成后的 transcript 内容仍是本次运行的记录。

## Chart 与 tree

完整的 `chart` 或 `tree` Markdown fence 可以渲染为终端可视化：

````markdown
```tree
Pi Stuff
  Work
    Goal
    Agents
  Context
    Search
    Compaction
```
````

投影只影响显示。保存的 Markdown 和 provider message 保留原 fence。不完整、格式错误、不安全、嵌套、超限
或终端过窄的可视化仍按普通代码显示。一条 Assistant message 最多投影 16 个可视化 block，每个源文本最多
12,000 个字符。

## Command Dialog

Pi Stuff 命令使用共享的全宽非浮动 Command Dialog。它提供稳定焦点、响应式布局、语义状态行和一条回到编辑器的
Escape 路径。只有 `/tools` 与 `/tasks` 这类宽屏检查工作流使用分栏；其他 dialog 保持单栏。

阻塞式权限或确认工作优先于普通检查，关闭后恢复先前界面。共享布局和交互规则见
[DESIGN.md](../../DESIGN.md)。

## 诊断

`/diagnostics` 列出当前进程中有界、脱敏的问题。存在引导式恢复路径时，每条记录都会标明所属能力和应采取的操作。
打开 dialog 会确认可见 notice；诊断不会成为 conversation message。

## 相关文档

- [Conversation UI Module README](../../packages/pi-stuff/src/conversation-ui/README.md)
- [命令参考](../reference/commands.md)
- [设置参考](../reference/settings.md)
- [故障排查](../troubleshooting.md)
