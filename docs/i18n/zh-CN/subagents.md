# 子代理

[English](../../subagents.md)

Pi Stuff 提供可观察的子代理 Fleet，让你在正常 Pi 会话中分派开发工作。
正式入口是 `src/pi/index.ts`；它加载 `src/subagent/` 运行时、注册主会话工具，
并把 Fleet 加到 Pi 的 TUI 中。

## 加载正式入口

使用审查过的扩展源码启动正常 Pi。在检出目录安装固定依赖，然后加载
`src/pi/index.ts`：

```bash
bun install --frozen-lockfile --ignore-scripts
pi -e /absolute/path/to/pi-stuff/src/pi/index.ts
```

将绝对路径替换为实际检出目录。本指南面向 Linux、Bun 编译版 Pi `0.85.1` 和
Bun `1.4.0`。若有其他扩展注册相同工具名，只加载其中一个。

## 在主会话中分派工作

主模型在自己的对话中调用 `subagent` 工具。默认情况下调用立即返回；子代理完成、
提问或主动通知时，会通过隐藏消息唤醒主代理。这些消息内部使用 follow-up 投递路径，
但 `display: false` 会让它们留在可见 Follow-up 队列之外。主代理需要在同一次工具调用
中等待时可以设置 `autoAwait`；它最多等待 60 秒，子代理提问时会提前返回。普通分派应
让主代理继续工作。

三种分派形式只能选一种：

```json
{
  "agent": "reviewer",
  "task": "Review the cancellation path and report concrete findings.",
  "write": false
}
```

```json
{
  "tasks": [
    {
      "id": "inspect",
      "agent": "inspector",
      "task": "Inspect the runtime entrypoints and summarize the call flow."
    },
    {
      "id": "tests",
      "agent": "tester",
      "task": "Design focused checks after reading the inspector's output.",
      "needs": ["inspect"]
    }
  ],
  "concurrency": 2
}
```

```json
{
  "chain": [
    {
      "id": "plan",
      "agent": "planner",
      "task": "Outline the smallest safe implementation."
    },
    {
      "id": "apply",
      "agent": "implementer",
      "task": "Implement the plan below, then report what remains: {previous}",
      "write": true
    }
  ]
}
```

单任务模式需要 `agent` 和 `task`。`tasks` 启动并行批次，可以用 `needs` 声明依赖；
`chain` 让每一项等待前一项，并将前一项输出替换到 `{previous}`。对于一般依赖图，
上游输出也会加到下游提示词前面。上游任务失败时，依赖它的任务会中止。任务之间传递的
是输出文本，不会自动共享某个任务工作树中的文件。

批次中的每项任务都可以设置自己的 `prompt`、`model`、`thinking`、`cwd`、`tools`、
`write` 和 `maxRuntimeMs`；单任务模式在顶层设置这些字段。`concurrency` 默认是 3，
上限为 8。任务默认运行时限为 1 小时，可设置范围为 10 毫秒到 6 小时。将
`notifyPerTask` 设为 `false` 后，每个任务完成不会单独通知，只发送一次运行级完成通知。

用于查看和控制的工具如下：

| 工具              | 用途                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `subagent_status` | 不等待地读取实时状态、活动、用量和会话/工作树路径。                      |
| `subagent_result` | 读取运行摘要，或读取某项任务的最终文本和诊断。                           |
| `await_subagent`  | 最多等待 60 秒，直到完成或收到子代理消息。取消只停止等待，不停止子代理。 |
| `reply_subagent`  | 根据 `runId` 和 `taskId` 回答一个待处理的 `ask_parent` 问题。            |
| `steer_subagent`  | 向一个正在流式运行的子代理，或运行中的所有流式子代理发送消息。           |
| `resume_subagent` | 在保存的会话中继续一个已完成、失败或中止的子代理。                       |
| `subagent_cancel` | 停止一项任务；省略 `taskId` 时停止运行中的全部任务。                     |

取消后已经产生的编辑仍保留，供检查。继续执行不会重启兄弟任务；它会保留运行记录
中的依赖图，但让选中的任务绕过依赖门槛直接继续。尚未打开会话的任务会用新会话重试；
已经保存会话的任务沿用原对话。`resume_subagent` 的可选 `model` 只改变该子代理。

## 在 Pi 中使用 Fleet

主编辑器仍然是主编辑器。没有子任务时，Pi 内置 footer 保持不变。出现第一个子任务后，
Pi Stuff 接管一个 footer，先渲染公开的主会话状态字段，再在其正下方渲染 Fleet。每行都
使用统一的名称和当前活动列；子代理行还显示输入/输出 token 和耗时。主会话使用明确的
`main` 行，不显示当前代理星号。选择行只改变高亮。

主编辑器为空时，按 Down 聚焦 Fleet（当前处理器也接受 Left）；用配置的 Up/Down 选择键
在 `main` 和各子代理行之间移动。Enter 进入选中的子代理；选中 `main` 时回到主编辑器。
选中子代理行后按 `x` 请求取消。Esc 退出 Fleet 聚焦并回到输入框。`/subagents` 和
`Ctrl+Shift+A` 会打开第一个可用的子代理会话。

子代理 viewer 会保持当前子代理可见，兄弟任务继续在后台运行。它使用 Pi 原生的用户、
助手、工具、压缩摘要和分支摘要组件显示完整保存会话。`Ctrl+O` 展开或收起工具详情，
Page Up/Page Down 滚动对话，`Ctrl+C` 返回主编辑器。子代理运行中按 Esc 会请求取消（正在
压缩上下文时则中止压缩）；子代理已结束后按 Esc 关闭 viewer 并回到主编辑器。

在子代理 viewer 中输入文字时，目标由当前状态决定：

- `awaiting_parent`：定向回复待处理的 `ask_parent`。
- `running` 或 `starting`：定向 steering。只有子会话正在流式输出时运行时才接受；否则
  输入会保留，方便再次尝试。
- `completed`、`failed` 或 `aborted`：按 `resume_subagent` 语义定向继续。

当前 viewer 识别 `/help`、`/stats` 和 `/compact`。`/help` 显示子代理操作，`/stats`
显示该子代理按消息角色统计的数量；token 用量仍看 footer 和 Fleet 计数。`/compact` 只
在子代理没有流式输出、压缩或提交输入时执行，完成后仍可翻阅对话。

手动压缩占用运行时执行槽位，沿用该子代理的运行时限，Fleet 显示其活动和耗时。
Esc、Fleet 中的 `x`、`subagent_cancel` 和主会话退出都可以取消压缩。压缩结束前
拒绝续聊并保留草稿；压缩不会改写任务此前的完成／失败状态与最终结果。

编辑器边框会标出输入目标（`main`，或子代理名称和任务），空的子代理编辑器使用
`Message @agent…` 占位文字。这样能在不替换主会话、也不改变 Pi 默认编辑器绑定的情况下
显示收件人。

## 读取统计与图标

统计来自真实的 Pi 会话条目和 SDK 事件。主状态行显示主会话累计的输入、输出、缓存读取、
缓存写入、费用、上下文用量和模型。每个子代理在自己的会话及后续继续执行中累计用量字段。
子代理 Fleet 行显示输入（包括缓存读写）、输出和耗时；`main` Fleet 行只显示名称和活动。
展开运行结果还会显示工具调用、轮次和费用。这些是累计值，不是估算的进度条。

Fleet 状态和导航 glyph 使用 Nerd Font / Font Awesome 私有区码点，语义对应如下：

| 图标语义   | 私有区码点 | 含义                   |
| ---------- | ---------- | ---------------------- |
| 选择箭头   | `U+F105`   | 当前 Fleet 选择。      |
| 主行圆点   | `U+F111`   | 主会话 `main` 行。     |
| 时钟       | `U+F017`   | 排队中的任务。         |
| 旋转指示   | `U+F110`   | 正在启动的任务。       |
| 空心圆     | `U+F10C`   | 正在运行的任务。       |
| 问号       | `U+F059`   | 等待主代理回答的任务。 |
| 对勾       | `U+F00C`   | 已完成任务。           |
| 感叹号     | `U+F06A`   | 失败任务。             |
| 方形停止符 | `U+F04D`   | 已中止或取消的任务。   |
| 向上箭头   | `U+F062`   | 输入 token 数。        |
| 向下箭头   | `U+F063`   | 输出 token 数。        |

准确 glyph 集中在 `src/subagent/ui/rows.ts`。需要兼容 Nerd Font 才能正确显示这些私有区
字符。

## 隔离方式与子代理能力

每个子代理都是独立的 Pi SDK 会话。管理器不会对主会话调用 Pi 的 `switchSession`，
因此打开子代理不会替换主对话。查看某个子代理时，兄弟任务仍各自执行，并保留自己的
历史、草稿、工具输出和会话文件。

默认情况下，子代理获得 `read`、`grep`、`find`、`ls`，以及有界通信工具 `ask_parent`、
`notify_parent`、`send_agent_message`、`poll_agent_messages`。没有显式 allowlist 时，
`write: true` 会选择写入工具集；显式 allowlist 决定实际工具，其中包含 `bash`、`edit` 或
`write` 时也会让任务具备写权限并触发工作树隔离。子代理资源加载设置了 `noExtensions`、
`noSkills`、`noPromptTemplates` 和 `noThemes`，所以不会递归加载 Pi Stuff 或其他扩展。除
通信工具外，子代理也不能自行增加允许列表之外的工具。

只读设置是工具策略，不是安全沙箱。子代理进程仍使用用户账号和宿主权限运行。应把
提示词、子代理输出和仓库内容当作需要检查的数据；只有在任务确实需要时才给予写入权限。

可写任务要求当前目录位于有提交记录的 Git 仓库中。Pi Stuff 会创建
`subagents/<run-id>/<task-id>` 分支，并在基于主仓库 `HEAD` 的
`<git-common-dir>/subagents/<run-id>/<task-id>` 工作树中启动子代理。主工作树中的未提交
修改不会复制到起点。如果任务的 `cwd` 是项目子目录，子代理会在工作树中保留相同的相对
子目录。分支、工作树、未提交修改和未跟踪文件都会保留供检查。Pi Stuff 不会自动提交、
合并或删除它们。若无法创建或恢复隔离工作树，任务会安全失败，不会退回到主 checkout
写入。

子代理通信有界且显式。`ask_parent` 会等待回复、取消或十分钟超时；`notify_parent` 发送
不等待的短通知；`send_agent_message` 可以定位兄弟任务 id，或以 `leader` 发送给主代理；
`poll_agent_messages` 读取并清空兄弟 mailbox。一个 mailbox 最多保存 32 条消息，每条最多
4,000 字符。

## 持久化、reload 与限制

运行元数据保存在主会话文件旁边：`<parent-session-file>.pi-stuff-subagents.json`。
写入使用临时文件、`0600` 权限和原子 rename。子代理对话文件位于主会话的
`pi-stuff-subagents/` 目录下。reload 时，非终态任务会被规范化为 `aborted` 并记录中断
错误；运行中的进程不会被假定能跨 Pi 重启存活。已保存的终态子代理会话可以恢复、打开并
继续。

当前运行时只读取自己验证过的 sidecar schema，与旧版 Arhen sidecar 格式不兼容。请将
sidecar 与主会话放在一起；把 Arhen sidecar 改名为 Pi Stuff 文件名也不会触发迁移。畸形或
不安全 sidecar 会被拒绝并报告，不会被执行。

当前硬限制如下：

| 限制                      | 数值                           |
| ------------------------- | ------------------------------ |
| 每个主会话保留的运行数    | 50                             |
| 单次运行任务数            | 16                             |
| 并行度                    | 1–8，默认 3                    |
| 任务默认运行时限          | 1 小时                         |
| 任务最大运行时限          | 6 小时                         |
| `await_subagent` 单次等待 | 最多 60 秒                     |
| 待回答问题                | 每个子代理最多一个，十分钟超时 |

会话退出时，运行时会取消自己管理的活动执行，终止这些会话拥有的子进程工作，释放子
会话并刷新 sidecar。取消不会撤销保留工作树中已经产生的编辑。

## Pi 0.85.1 的 footer 兼容性

出现子任务后，扩展把 Pi 的公开 `setFooter` API 作为唯一 footer owner；没有子任务时保留
Pi 内置 footer。自定义 footer 通过公开 footer 数据和会话 API 重建 Pi 原本显示的主字段：
工作目录、分支和会话名、用量/缓存/费用、上下文用量、模型与思考级别，然后在下面追加
Fleet。当前模型通过 Pi 公开的 `ctx.model` getter 读取。它也通过 footer data provider
读取公开 `setStatus` 条目，因此扩展状态文字仍可显示。

Pi `0.85.1` 没有公开的另一扩展 footer getter。因此两个独立调用 `setFooter` 的扩展无法
由本集成同时保留。若还需要其他 footer，必须由同一个 footer owner 组合两个功能，只调用
一次 `setFooter`。

## 来源说明

运行时边界、调度、通信、会话和工作树适配 fork 自 `@arhen/pi-core-subagent` `1.3.54`，
源码快照为
[`de1c8783c2a39b1cbb0f86b412307193de9774c1`](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent)。
保留的上游许可与署名见
[`src/subagent/runtime/LICENSE.arhen`](../../../src/subagent/runtime/LICENSE.arhen)。

编辑器边框标签的思路参考了
[`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff/tree/122e2994adddb113c04764c5697217dae120fcc6)
的 `122e2994adddb113c04764c5697217dae120fcc6` 提交。这里只参考公开 editor API 形状，
没有复制其源码。
