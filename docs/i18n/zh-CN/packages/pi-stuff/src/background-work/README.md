<!-- translation-source: packages/pi-stuff/src/background-work/README.md; translation-source-sha256: afc3a5b8dd633f6d7d5adb606332a1a48be3319e824dd9403e5623941f15e6c1 -->

# Pi Stuff Work

Pi Stuff 当前会话的后台 Shell、一次性 Monitor 和 `/tasks` 管理。

- Bash 接受 `run_in_background: true`，并可用 `Ctrl+B` 把正在运行的前台命令交到后台。
- `Monitor` 等待一个显式命令、日志、文件或 HTTP 条件，不在主对话中轮询。
- `/tasks` 是用于后台 Shell 与 Monitor 的全宽非浮动实时管理器。
- 对当前 Pi 进程最近完成的 64 项自有活动，显式输出和停止查询保持幂等；终态回执是有界内存，不是持久任务历史。
- 输出和通知大小有界。运行时限制与关闭由认证的进程组监督器强制执行；进程所有权不确定时会保留用于恢复，直到明确证明进程不存在。

Todo、Goal、Beads 和 Agent 详情继续由既有权威负责，不在此重复。

`runtime.ts` 仍是注册表、容量、Monitor、持久化、回执、通知和关闭的唯一权威。`effect-owner.ts` 在已初始化的 Session 下拥有一个 Capability Scope。Monitor 轮询、Shell 等待、通知重试与心跳以及对话框刷新都作为该 Scope 中的操作运行；中断会取消这些操作，关闭流程会先请求经过认证的原生停止协议，再关闭 Scope。`shell-activity.ts` 负责一个已认证进程生命周期，`shell-activity-launch.ts` 负责命令前资源准备，`shell-activity-presentation.ts` 负责工具调用等待和结果投影。`process.ts`、`process-supervisor.mjs` 和 `monitor-native.ts` 是狭窄的原生 adapter，`output.ts` 负责有界输出。无状态 `notification-projection.ts` 接缝只在传输前限制并转义已完成批次。

## 已接受的 `/tasks` 可读性目标

**决策更新：** 2026-08-17
**状态：** 已于 2026-08-18 实现。

`/tasks` 是当前实时工作管理器，不是工具调用历史或持久任务历史。它负责后台 Shell 与 Monitor 的检查和停止控制。`/agents` 负责 Agent 生命周期与控制，`/tools` 负责工具调用和协议检查。启动后台工作的工具调用和由此产生的实时任务是不同领域对象，因此 UI 不匹配行并删除表面重复项；每个界面直接读取自己的权威。Transcript 中的 `background` call 只有 `action=output` 时使用 Operation Block；launch 和 control call 保留普通 Tool row。

列表保持启动顺序并原位更新行。它只包含实时工作；终态后台工作继续通过现有有界回执和通知路径。每行依次为 `›` 焦点标记、工作类型、主要身份，再是右对齐生命周期图标和经过时间：

```text
任务 · 当前 2 项

› Shell    构建软件包                           ● 18s
  Monitor  等待 CI 成功                         ● 2m
```

`›` 只表示选择。Shell 与 Monitor 的活跃和停止中状态分别使用 `●` 与 `◐`。窄宽度下，描述先于类型、身份、生命周期图标或经过时间消失。

Pi 配置的上、下操作每次选择一行；Ctrl+P/Ctrl+N 是只读别名。列表溢出时，PageUp/PageDown 和 `b`/Space 每次移动一页，Home/End 跳到第一项或最后一项；窗口前后显示 `… N 项较早` 和 `… N 项较晚`。新工作追加时不抢焦点。`x stop` 只为自有且活跃的 Shell 或 Monitor 显示，停止中则消失。`?` 打开上下文按键帮助。Escape 始终关闭列表。

在 96 列及以上，非空任务列表与其选中详情共享一个固定 18 行对话框。一条连续粗顶线横跨两栏，一条粗 `┃` 分隔线将其分开。固定高度防止用户切换任务时编辑器移动。窄宽度和空状态保持单列。Tab 与 Shift+Tab 切换宽布局列表/详情焦点，不改变对话框高度。

Shell 详情专用于后台命令：

```text
任务 / Shell
构建软件包
● 运行中 · 18s · 任务 bg-ab12

命令
bun run check:fast

输出
……最新有界输出……
```

Monitor 详情专用于正在观察的条件：

```text
任务 / Monitor
等待 CI 成功
● 观察中 · 2m · 任务 mon-ab12

来源
HTTP · https://example.test/build/42

条件
success 包含 "completed"
8 分钟后超时

最新证据
……最新有界响应或日志文字……
```

缺失的条件字段应省略，而不是显示占位符。文件或日志来源不存在时，使用预期的 `Waiting for <source> to appear.` 状态；其他来源读取错误会让 Monitor 失败，而不是显示成普通等待。文件、日志、HTTP 与命令 Monitor 保留真实来源和目标；要暴露它们，实时快照需要携带既有 Monitor 输入元数据，而不是把每个 Monitor 扁平化为通用命令。任务 ID 始终是低优先级详情元数据，绝不进入列表行。

小节标题使用无图标的语义粗体文字。内容保持自然的工具自有命令/输出层级，不再增加一层缩进。只有视口位于底部时，输出或证据才跟随追加内容；向上移动会冻结阅读、报告有界新内容，并在回到底部后恢复跟随。PageUp/PageDown 和 `b`/Space 按页滚动；Home/End 跳到顶部或底部。页脚滚动提示只在溢出时出现；`x stop` 只在选中自有活动可停止时出现；`Esc back` 始终存在且位于最后。

空列表显示 `No background work in this session.`，并在工作出现前只保留按键帮助与关闭提示。实现直接读取后台工作运行时快照，跨更新保持启动顺序与选择，携带真实 Monitor 来源和条件元数据，并限制近期输出。聚焦测试覆盖按类型详情、固定分栏几何、空状态、状态图标、分页别名，以及不含 Agent 投影。
