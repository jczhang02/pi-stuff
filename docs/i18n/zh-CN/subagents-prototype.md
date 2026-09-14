# Subagent 内联树原型

[English](../../subagents-prototype.md).

本实验分支验证 statusline 下方的树能否承载任务查看与明确的任务操作, 同时保留主编辑器. 界面依据维护者在 [#90](https://github.com/jczhang02/pi-stuff/issues/90) 中选择的设计, 行为决策见 [#64](https://github.com/jczhang02/pi-stuff/issues/64) 和 [PR #66](https://github.com/jczhang02/pi-stuff/pull/66).

## 启动

将 `codex/subagent-tree-prototype` 保留在 main 之外. 在该分支的 worktree 中使用 Bun 1.4.0:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run tui run subagent-tree -- bun tools/subagent-prototype.ts collaboration
```

前台命令拥有共享终端. 可从另一个 shell 使用 `bun run tui show subagent-tree` 查看同一会话, 通过 `bun run tui send subagent-tree ...` 操作. 使用 Pi 的普通退出操作离开. 外部停止命令为 `bun run tui stop subagent-tree`, 不要停止其他任务的会话.

启动参数在产品界面外选择场景:

| 参数            | 观察场景                                                                |
| --------------- | ----------------------------------------------------------------------- |
| `collaboration` | 两个调查并行执行, 完成后启动依赖它们的审查. 在调查工具运行时发送 steer. |
| `question`      | 子代理缺少信息, 父代理将问题转交用户, 在树内答复.                       |
| `followup`      | 初次任务快速完成. 给保留的 reviewer 交办新任务, 查看两次结果.           |
| `cancel`        | 取消一个仍有活动下级的父任务, 观察下级工具停止前的取消过程.             |
| `failure`       | 查看失败的调查及无法启动的下游审查.                                     |

使用 `alt+a` 进入树, 保留主编辑器草稿. 方向键选择, 展开和收起节点, Enter 打开选中的操作. 输入框内 Enter 换行, `ctrl+enter` 发送. Escape 返回树, 再按一次返回主编辑器. Page Up/Down 滚动展开记录. 也可以通过 `/agents` 命令进入.

快速试用可启动 `question`, 展开 lifecycle 的 Reply to question, 答复后等待完成, 再选择 New task. 使用 `collaboration` 时, 在前 30 秒发送 steer. 再打开一份 steer 草稿, 等任务完成后发送, 应显示拒绝并保留可见草稿. 在 `cancel` 中, 趁 lifecycle 和 probe 活动时取消 lifecycle, packages 应继续独立执行. 不同场景之间重新启动.

## 实际运行内容

宿主为 Bun 下的 Pi 0.85.1 `InteractiveMode`, 使用原生 `CustomEditor` 和 `FooterComponent`. 树占用 statusline 下方的正常底栏布局空间. 选择子任务不会切换主会话. 每个输入框明确操作和目标, 返回时恢复同一个主编辑器实例.

子代理使用真实 Pi `AgentSession`, 执行本地工具. Steer, 问答, 续聊和取消经过这些会话. 本地确定性 provider 决定后续回复和工具调用. 初始主对话和模型 token 计数属于场景数据, 不代表远程模型的实际消耗. 原型不调用线上模型, 界面中的结论只针对附带的示例文件.

启动器创建隔离临时工作区和 agent 目录. 子代理上下文保存在内存中. 正常退出时停止子代理并删除临时文件. 崩溃或强制终止可能在系统临时目录中留下 `pi-subagent-PROTOTYPE-*` 目录. 重新启动会创建新场景.

这是限定范围的 UI 实验. 它不构成生产级持久化/恢复, 任意依赖图派发, 写入隔离, 权限继承, provider 兼容性或完整 F01-F33 重写的验收.

## 来源和设计取舍

执行适配来自 [@arhen/pi-core-subagent 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent), 固定提交为 `de1c8783c2a39b1cbb0f86b412307193de9774c1`:

- `manager.ts`: 独立子会话创建, 事件观察, 用量与结果收集.
- `child.ts`: 阻塞式 `ask_parent` 和子代理向父代理更新消息.
- `graph.ts`: 依赖校验和上游结果的提示词组合.

保留的 [MIT 声明](../../../src/subagents/LICENSE.arhen) 包括原 fork 归属, 源码注释标明适配来源. 不加载原 widget, overlay, sidecar 持久化和工作树管理器. 整体引入 manager 会带入这些职责及其过早更新 aborted 状态的行为. 较小的适配保留本次要操作的能力, 并区分取消请求与实际停止. 完成后续聊和按任务归属管理下级属于对原包的扩展.

## 终端证据

目标视口为 150 列 50 行, 窄终端为 80 列 25 行. Pi 使用 light 主题, 启动器在隔离终端内设置已检查的 Ghostty 默认前景, 背景和光标颜色. 截图必须显式设置字体栈:

```sh
bun run tui save subagent-tree --format png --out /tmp/subagent-tree.png \
  --font-family "JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono" \
  --padding 2
```

无桌面的 Terminal Control 截图验证终端单元格和按键行为, 不证明 Ghostty 合成器缩放或原生字体栅格化效果. 实际检查和保留截图随交付 PR 记录.

## 结论

选定的树可以在 Pi 正常底栏空间中工作, 任务操作无需 overlay 或替换会话. 在 80 列 25 行下, 长输入框保留 agent, 操作, 目标, 光标和发送/返回提示, 其他树行暂时离开视口. Escape 恢复树导航, 返回 main 后保留草稿和光标. Pi 0.85.1 的失焦编辑器仍绘制软件光标, 小型 MainEditor 适配只在失焦时去除它.

真实终端检查覆盖活动展开, steer 从 pending 到 consumed, 迟到 steer 被拒绝且草稿仍可见, 问题答复, 独立续聊记录, 实际停止前的取消状态, 下游跳过, 失败显示和 16 行窄屏输入. 独立审查还验证了 ask_parent 期间取消或 steer, 以及父模型循环结束但下级仍运行时拒绝 steer. 仓库既有离线测试 55 项通过. 本实验分支不增加永久原型测试套件.

使用上述字体栈生成的真实 Terminal Control 截图:

- [Steer 输入框, 150 列 50 行](../../assets/subagents-prototype/steer.png).
- [问题答复, 150 列 50 行](../../assets/subagents-prototype/reply.png).
- [长续聊草稿, 80 列 25 行](../../assets/subagents-prototype/narrow.png).
