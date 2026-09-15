# Subagent 内联树原型

[English](../../subagents-prototype.md).

本实验分支验证 statusline 下方的树能否承载任务查看与明确的任务操作, 同时保留主编辑器. 界面依据维护者在 [#90](https://github.com/jczhang02/pi-stuff/issues/90) 中选择的设计, 行为决策见 [#64](https://github.com/jczhang02/pi-stuff/issues/64) 和 [PR #66](https://github.com/jczhang02/pi-stuff/pull/66).

## 启动

将 `codex/subagent-tree-prototype` 保留在 main 之外. 在该分支的 worktree 中使用 Bun 1.4.0:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run tui run subagent-tree -- bun tools/subagent-prototype.ts
```

前台命令拥有共享终端. 可从另一个 shell 使用 `bun run tui show subagent-tree` 查看同一会话, 通过 `bun run tui send subagent-tree ...` 操作. 使用 Pi 的普通退出操作离开. 外部停止命令为 `bun run tui stop subagent-tree`, 不要停止其他任务的会话.

默认 `live` 模式读取 Pi 已配置的模型并复用现有认证, 启动真实的主代理和子代理调用. 也可追加 `live provider/model` 明确指定已配置的模型, 例如:

```sh
bun run tui run subagent-tree -- bun tools/subagent-prototype.ts live openai-codex/gpt-6-astra
```

模型不存在或认证失败时显示错误, live 不回退到预设回复. 主代理仍可使用 Pi 原生模型操作; 新创建的子代理采用主代理当时的模型和 thinking level. 已有子代理续聊时保留原模型.

启动参数在产品界面外选择场景:

| 参数            | 观察场景                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `live` (默认)   | 真实主代理和子代理检查附带的示例文件, 结果, 耗时和 token 计数来自实际执行. |
| `collaboration` | 两个调查并行执行, 完成后启动依赖它们的审查. 在调查工具运行时发送 steer.    |
| `question`      | 子代理缺少信息, 父代理将问题转交用户, 在树内答复.                          |
| `followup`      | 初次任务快速完成. 给保留的 reviewer 交办新任务, 查看两次结果.              |
| `cancel`        | 取消一个仍有活动下级的父任务, 观察下级工具停止前的取消过程.                |
| `failure`       | 查看失败的调查及无法启动的下游审查.                                        |

在主编辑器的导航边界按上下键进入 FleetView. 原生光标移动, 自动折行, 历史导航和补全优先. 例如在单行草稿末尾按 Down 进入树; Up 先移动到行首或浏览已有历史. 进入和返回保留同一份草稿及光标. 不再注册 Alt+A.

进入 FleetView 时恢复选中行, 不自动展开详情. 任务编号仅用于内部寻址, 人看的界面使用 agent 名称和任务描述. Agent 选中效果只改变 icon. 当前任务排在旧记录之前; 从树中提交续聊后打开新记录, 后台更新不抢走当前阅读焦点.

| 按键                             | 操作                                                   |
| -------------------------------- | ------------------------------------------------------ |
| Up / Down                        | 选择前后可见节点. 在 main 上按 Up 返回主编辑器.        |
| Tab / Shift+Tab                  | 跨过展开记录, 在 agent 之间跳转.                       |
| Right                            | 展开当前节点; 已展开时进入第一个子节点.                |
| Left                             | 收起当前节点, 或回到父节点.                            |
| Enter                            | 打开记录或操作; 在 main 上返回主编辑器.                |
| `r` / `s` / `f`                  | 对当前 agent 答复, steer 或续聊, 仅在该操作可用时生效. |
| Escape                           | 保留草稿并离开输入框, 再按一次离开 FleetView.          |
| `[` / `]` 或 Ctrl+Page Up / Down | 滚动 FleetView 记录. 普通 Page Up / Down 仍滚动主对话. |

输入框使用 Pi 的原生规则: Enter 发送, Shift+Enter 或 Ctrl+J 换行, 粘贴的多行文本保持完整. Ctrl+Enter 仍可发送. 操作已过期或无效时, 保留草稿并显示原因. 也可通过 `/agents` 命令进入.

树导航同时接受 Pi 的选择键配置和显示的方向键. 输入框提示显示实际配置的提交与换行键.

快速试用可启动 `question`, 选中 lifecycle 后按 `r`, 用 Enter 答复, 完成后按 `f` 续聊. 使用 `collaboration` 时, 在前 30 秒发送 steer. 再打开一份 steer 草稿, 等任务完成后发送, 应显示拒绝并保留可见草稿. 在 `cancel` 中, 趁 lifecycle 和 probe 活动时取消 lifecycle, packages 应继续独立执行. 不同场景之间重新启动.

## 实际运行内容

宿主为 Bun 下的 Pi 0.85.1 `InteractiveMode`, 使用原生 `CustomEditor` 和 `FooterComponent`. 树占用 statusline 下方的正常底栏布局空间. 选择子任务不会切换主会话. 每个输入框明确操作和目标, 返回时恢复同一个主编辑器实例.

子代理使用真实 Pi `AgentSession`, 执行本地工具. Steer, 问答, 续聊和取消经过这些会话. live 主代理通过一个 `subagent` 工具查看结果并调用相同的任务操作. 主代理和子代理共享 Pi 原生模型运行时及内存设置, 结果与用量来自选定的远程模型. 本次限定范围的实验关闭重试和自动压缩, 结论只针对附带的示例文件.

明确指定的五种离线场景使用本地确定性 provider. 回复, 初始主对话和模型计数属于场景数据, 不代表远程用量. 固定时序便于测试任务完成前的 steer 或等待中的问答.

启动器创建隔离临时工作区和 agent 目录. live 读取已有 Pi 模型配置并通过原 agent 目录使用原生认证, 不向临时工作区复制凭据. 原生 OAuth 刷新可能更新 Pi 已有认证存储. 扩展, skills, context files 和内置工作区工具均关闭. 子代理可检查三份附带文件, 向父代理提问和发送更新. 上下文保存在内存中. 正常退出时停止子代理并删除临时文件. 崩溃或强制终止可能在系统临时目录中留下 `pi-subagent-PROTOTYPE-*` 目录. 重新启动会创建新场景.

这是限定范围的 UI 实验. 它不构成生产级持久化/恢复, 任意依赖图派发, 写入隔离, 权限继承, provider 兼容性或完整 F01-F33 重写的验收.

## 来源和设计取舍

执行适配来自 [@arhen/pi-core-subagent 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent), 固定提交为 `de1c8783c2a39b1cbb0f86b412307193de9774c1`:

- `manager.ts`: 独立子会话创建, 事件观察, 用量与结果收集.
- `child.ts`: 阻塞式 `ask_parent` 和子代理向父代理更新消息.
- `graph.ts`: 依赖校验和上游结果的提示词组合.

保留的 [MIT 声明](../../../src/subagents/LICENSE.arhen) 包括原 fork 归属, 源码注释标明适配来源. 不加载原 widget, overlay, sidecar 持久化和工作树管理器. 整体引入 manager 会带入这些职责及其过早更新 aborted 状态的行为. 较小的适配保留本次要操作的能力, 并区分取消请求与实际停止. 完成后续聊和按任务归属管理下级属于对原包的扩展.

任务状态和可用操作来自同一份 runtime 快照. `Needs reply` 与 `Waiting dependencies` 分开显示, 尚未开始的任务没有执行时长. 完成显示 `Done`, 失败, 跳过和取消都有明确状态. 展开任务可见当前操作, 实际模型, 简短的公开文本进展及问答记录. Activity 使用最近的工具, Steering 区分 pending, consumed 和 unprocessed. Token 计数在 Pi 提供完整消息用量时更新.

FleetView 根据整份快照计算列宽, 包括保留的旧任务. Agent 名称和描述各自从同一列开始, 状态文字靠左对齐, 耗时和 token 数值靠右对齐. 向下箭头和 `tokens` 后缀也分别对齐. 描述前保留固定的展开标记位置, 进入或展开树时描述不会移动. 长名称最多占终端宽度的四分之一, 描述根据统计列剩余空间截断. Main 仍只有 icon 和名称.

树导航使用一份按节点 key 索引的展开集合和一个子节点构造入口. 单一 composer 状态持有已绑定的操作, 编辑器和返回位置. 无状态的任务展示放在 `prototype-task-view.ts`, 负责紧凑行和展开行的格式, 不管理导航或执行. 这消除了审查中发现的重复展开和编辑器状态路径.

## 终端证据

实际检查的用户终端为 122 列 74 行, 另验证 150 列 50 行及 80 列 25 行的窄终端. Pi 使用 light 主题, 启动器在隔离终端内设置已检查的 Ghostty 默认前景, 背景和光标颜色. 截图必须显式设置字体栈:

```sh
bun run tui save subagent-tree --format png --out /tmp/subagent-tree.png \
  --font-family "JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono" \
  --padding 2
```

无桌面的 Terminal Control 截图验证终端单元格和按键行为, 不证明 Ghostty 合成器缩放或原生字体栅格化效果. 实际检查和保留截图随交付 PR 记录.

## 结论

选定的树可以在 Pi 正常底栏空间中工作, 任务操作无需 overlay 或替换会话. 在 80 列 25 行下, 长输入框保留 agent, 操作, 目标, 光标和发送/返回提示, 其他树行暂时离开视口. Escape 恢复树导航, 返回 main 后保留草稿和光标. Pi 0.85.1 的失焦编辑器仍绘制软件光标, 小型 MainEditor 适配只在失焦时去除它.

本轮 UI 修订在 122 列 74 行, 150 列 50 行和 80 列 25 行中验证, 覆盖折叠入口, 直接答复/steer/续聊, agent 跳转, 父子节点导航, 原生提交与换行, 草稿保留和问答记录. 检查发现普通 Page Up 会被 Pi 的全屏主对话滚动器消费, 已使用 `[` 和 `]` 滚动树内记录.

真实终端检查覆盖活动展开, steer 从 pending 到 consumed, 迟到 steer 被拒绝且草稿仍可见, 问题答复, 独立续聊记录, 实际停止前的取消状态, 下游跳过, 失败显示和 16 行窄屏输入. 独立审查还验证了 ask_parent 期间取消或 steer, 以及父模型循环结束但下级仍运行时拒绝 steer. 仓库既有离线测试 55 项通过. 本实验分支不增加永久原型测试套件.

live 修订使用已认证的 `openai-codex/gpt-6-astra` 验收: 两个调查完成, 实际报告交给依赖它们的 reviewer, 主代理再通过工具读取建议. 树内续聊保留旧报告, 提出真实模型生成的问题, 接收答复, 消费 steer 并交付新结果. 独立本地 provider 检查复现并验证了模型临时错误后的恢复, 重试耗尽, 顺序提问和等待期间取消. Activity 标签改为反映实际工具参数.

独立私有 tmux 3.6a 会话通过了方向键入口, 多行/折行移动, 历史, 补全和光标恢复验证. 在 `extended-keys always` 和 `extended-keys-format csi-u` 下, Ctrl+Enter 成功答复子代理问题并完成任务. 当前修订还在关闭 extended keys 的私有 tmux 中通过 Ctrl+J 和反斜杠+Enter 换行验证, 再开启 extended keys 验证 Ctrl+Enter. 指定不存在的 live 模型会明确报错退出, 不回退到固定场景. 验证后已停止所有自建会话和私有 tmux server.

列对齐修复在真实 Pi 配合本地 provider 的 122 列 74 行, 150 列 50 行和 80 列 25 行终端中检查. 终端单元格断言验证了 agent 与旧任务行的描述起点, 状态起点, 箭头位置和右边缘, 包含待答复/等待依赖/已完成混合状态. 独立渲染检查覆盖长名称, CJK 名称, 秒/分钟, 不同量级 token 及紧凑/展开列位置稳定性. 上述已认证模型和 tmux 检查继续作为未改动执行与输入路径的证据; 本轮布局修复没有重复远程模型调用.

使用上述字体栈生成的当前列对齐截图:

- [紧凑 FleetView, 122 列 74 行](../../assets/subagents-prototype/alignment.png).
- [当前与旧任务, 150 列 50 行](../../assets/subagents-prototype/alignment-tree.png).
- [窄终端混合状态, 80 列 25 行](../../assets/subagents-prototype/alignment-narrow.png).

以下交互截图来自列对齐修复之前:

- [真实模型主对话与方向键入口, 150 列 50 行](../../assets/subagents-prototype/live.png).
- [内联展开真实子代理结果, 150 列 50 行](../../assets/subagents-prototype/live-tree.png).
- [Steer 输入框, 150 列 50 行](../../assets/subagents-prototype/steer.png).
- [问题答复, 122 列 74 行](../../assets/subagents-prototype/reply.png).
- [长续聊草稿, 80 列 25 行](../../assets/subagents-prototype/narrow.png).
