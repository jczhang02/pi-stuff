<!-- translation-source: packages/pi-stuff/src/subagents/README.md; translation-source-sha256: f56317d60d6335e65bc646460edcc049a8d6513bd1578572b041c1844bc58fec -->

# Subagents 模块

Pi Stuff 当前会话的前台与后台 Agents。

该能力允许主 Pi Agent 委派隔离工作，并在后台工作运行时继续。后台完成会添加一条持久、紧凑的 TUI 结果，不把子 Agent 报告加入模型上下文，也不启动另一个主轮次。在完整套件中，其 Fleetview 名册是 Pi Stuff 共享页脚最底部的尾部。管理期间，控制会原位替换最新提示词行，而不是移动名册。Agent 详情在 Pi Stuff 共享全宽命令对话框中打开。

公开 `subagent` Tool 通过内部 Tool Display contract 使用 Agent Lifecycle Row，绝不采用 Operation Block 的 `Tool(identity)` 加 `⎿` grammar。完整 live Agent 检查与控制仍位于 `/agents`。

`extension/index.ts` 是宿主组合根。`extension/public-agent-execution.ts` 负责受治理的公开启动事务，`extension/runtime-events.ts` 负责当前会话事件过滤与拆卸，`extension/completion-handling.ts` 负责持久完成传输和历史会话渲染。

工具与命令注册、会话事件所有权、恢复和拆卸仍然立即建立。前台与后台执行模块图只在首次公开 Agent 请求时加载一次，因此空闲会话不承担这部分导入成本，同时 Pi 仍会在启动就绪前获得完整 Agent 约定。

Pi Stuff 不交付 Agent 定义。启动会选择已安装 Pi 软件包、用户 `agents` 目录或当前项目 `.pi/agents` 目录提供的 Agent。同名时，项目定义覆盖用户定义，用户定义覆盖软件包定义。

分离启动组合位于 `async-execution.ts`，单个/并行 Runner 投影位于 `runner-work.ts`，模型/Skill/工具启动约定解析位于 `resolved-task.ts`。`subagent-runner.ts` 仍负责子进程和终态生命周期；`async-job-tracker.ts` 负责实时 Job 状态与宿主事件，`async-job-observer.ts` 负责文件观察与控制传输，`async-job-recovery.ts` 负责兼容和恢复扫描。`fallback-session.ts` 只在合格模型尝试之间冻结并恢复分叉。

`shared/acceptance.ts` 负责验收证据；`nested-contract.ts`、`run-result.ts`、`async-contract.ts` 和 `process-terminal.ts` 分别负责对应跨进程约定；`runs/shared/subagent-prompt-runtime.ts` 负责子提示词/Provider 组合，`runs/shared/steering-inbox.ts` 负责持久引导传输与确认状态；`runs/shared/nested-registry.ts` 负责嵌套路由解析，`nested-registry-store.ts` 负责有界注册表读取与缓存，`nested-registry-projection.ts` 负责序列化事件投影与路由稳定；`runtime/runtime-state.ts` 负责内存前台和扩展状态。`shared/types.ts` 保留共享配置与兼容类型外观。

在前台执行中，`executor-contract.ts` 定义私有组合约定。`launch-preparation.ts` 负责从输入、预算、分叉会话选择到会话根/嵌套路由设置的一次启动准入事务；`launch-model-planning.ts` 负责模型容量与投影准入；`launch-builders.ts` 把已准入计划映射到现有 Runner 引擎。`foreground-run-claim.ts`、`foreground-projection.ts` 和 `foreground-lifecycle.ts` 分别负责私有目录证明、当前/嵌套状态投影和执行稳定。

`runtime/session-governor.ts` 负责 Agent 生命周期操作和稳定公开外观；`runtime/session-governor-spawn.ts` 负责 Spawn 准入与暂存，`runtime/session-governor-ledger.ts` 负责锁、编解码器和原子账本存储。`runtime/session-governor-contracts.ts` 负责持久约定与校验。`runtime/agent-effect-owner.ts` 拥有协调器操作和持久稳定重试所使用的 Session Capability Scope。Session 替换会中断并在新 Scope 下重新调度保留的重试工作；不存在脱离该所有者的重试 Fiber。`runtime/agent-runtime-event.ts` 校验原始生命周期事件值；`runtime/agent-runtime-liveness.ts` 负责安全关闭的进程与 Writer 注册表证明。

`shared/artifacts.ts` 是稳定产物外观；`shared/artifact-files.ts` 负责路径、写入器和组声明，`shared/artifact-snapshot.ts` 负责有界、崩溃可恢复的原生目录扫描，`shared/artifact-maintenance.ts` 负责清理发现与编排。维护只会在已验证 Linux 宿主配置上成功完成分片后持久化目录身份和 Cookie；其他位置安全关闭，不删除产物。

`intercom/native-supervisor-channel.ts` 负责父级传输编排与运行生命周期；`intercom/native-supervisor-client.ts` 负责子通信工具和请求编排，`intercom/native-supervisor-storage.ts` 负责经过校验的文件系统协议、传输记录和通道 GC 机制。`session/current-agents.ts` 负责订阅、控制、覆盖和修订；`session/current-agents-projection.ts` 把持久与实时来源合并成不可变行，`session/current-agents-projection-normalization.ts` 负责有界原始值和嵌套状态规范化。`ui/agent-dialog.ts` 负责交互与异步控制/对话记录代际；`ui/agent-dialog-renderer.ts` 负责单列 `/agents` 布局、终端宽度适配和滚动指标。

## 日常行为

- 每次公开工具调用有且只有三种互斥形态之一：`agent` 加 `task` 用于单次启动，`tasks` 用于分组并行启动，`action` 用于当前会话控制。混合形态会被拒绝，不猜测要运行哪一种请求。Pi 原生并行工具调用也受支持：同一个 Assistant 响应发出的独立前台调用会作为分离的受治理启动并发运行。
- 启动默认在后台。省略 `foreground` 可立即继续；当发现必须用于当前回答时设置 `foreground: true`。已废弃的 `background` 字段不接受。
- 每次主 Agent 运行前，本地发现会用每个可选 Agent 的名称、用途和有效工具许可列表刷新公开工具约定。因此直接 Provider Schema 与代码模式暴露相同当前名册；模型无需猜定义名称或检查 Agent 文件。启动的可选 `cwd` 改变子进程执行位置；Agent 身份仍从公布的父项目名册解析。使用直接 MCP 工具的 Agent 如果选择器未解析，或目标 `cwd` 会改变公布工具名，也会在启动预检失败，确保委派绝不会在不同外部能力约定下静默开始。继承能力上限仍可显式拒绝所有扩展，包括其他情况下有效的 MCP 工具。
- Tool row 描述实际发生的操作：后台启动写 `launched`，前台执行写 `finished`，恢复、引导、停止和状态操作使用各自已确认动词。Foreground identity 是 `Agent <name> · <task> · <state>`，从一秒起显示有意义的 duration；Expanded 列出每个 member，并为 foreground work 增加有界 result evidence。开始后台工作绝不会误标为已完成。
- 每个委派项携带调用方提供的简短 `description` 用于终端界面，并有独立完整 `task` 用于执行。现有仅 task 调用方通过有界本地回退保持兼容；不会额外调用模型为旧版工作命名。
- 独立任务可以并发运行。会话级默认值为 20 个运行中 Agent、总计 200 次启动，最大嵌套深度为三层。
- 当前版本会从未锁定的 v2 前调度器账本导入已证明历史，但不持有其易崩溃目录锁。不支持 v2 前与当前 Pi Stuff 进程针对同一个 Pi 会话并发运行；存在 v2 前锁时，新启动暂停到旧进程退出。紧邻前一当前版本写入的死亡屏障，只有具备进程代际证明时才回收。
- `turnBudget`、`toolBudget` 和 `timeoutMs` 是可选逐 Agent 覆盖。普通启动使用产品后备限制：64 个 Assistant 轮次加两个收尾轮次、96/128 个软/硬工具调用（硬限制后阻止所有工具）和 30 分钟。任务覆盖优先于启动覆盖，启动覆盖优先于 Agent 定义和产品默认值。Agents 负责强制、停止、恢复和终态；上下文管理不施加第二个汇总限制。
- 从未启动的排队工作会记录显式 `pause`、`timeout` 或 `stop` 启动前原因。终态投影使用该原因，而不是匹配错误说明文字，因此真实 Agent 失败即使文字碰巧包含 `before it started`，仍保持原状态与消息。
- 每个 Agent 有稳定身份、自己的对话记录、持久已确认引导、独立停止，以及终态允许时的安全恢复。引导恢复有意至少一次：如果子 Agent 在崩溃导致确认无法持久化前刚接受输入，恢复可能重放该请求，而不是静默宣称已传输。
- 模型可见状态把每个 Agent Target 暴露为独立 `id=<run id>` 和 `index=<child index>` 字段。把该二元组传给状态、引导、停止或恢复；名册行键保持内部。只有唯一标识当前行时，才接受旧版组合键；含糊或未知键不操作任何内容。会话调度器保持每个活跃 Target 唯一，并拒绝冲突获取或重新绑定。
- 子 Agent 自动复用启动该会话的精确独立 Pi 宿主；无需单独子二进制设置。其扩展界面具有确定性：禁用环境发现；除非继承能力上限禁止扩展，否则显式加载所属 Pi Stuff 软件包；Agent 特定扩展为附加项（包括显式空列表）；最终 Provider 载荷防护即使受该上限约束也始终最后运行。非扇出子 Agent 会从套件必需工具清单和活跃工具集合中同时省略 `subagent`，使初始化无警告且不授予嵌套委派权限。每次启动还会把父级有效 Ponytail 模式（包括显式 `off`）快照到子进程环境；不共享或修改会话/全局设置。
- 只有完整子启动适合选中模型时，分叉才克隆原生 Pi 分支。长、多语言或高熵会话否则接收一份有界快照投影；检查包括子任务、继承提示词、Pi 保留的替换提示词上下文、选中工具 Schema，以及子专用扩展的保守预留。全新或分叉执行期间，每次继续都使用同一个安全模型输入预算。最终防护可能停止增长中的子 Agent 前，运行时会限制旧工具结果和 Assistant 工作文字，同时保留委派任务、最新用户引导、工具调用/结果身份和最近工具批次。极端历史回退到这些受保护权威和近期证据消息；完整原始对话记录继续持久，可供检查。启用 Skill 的子 Agent 始终接收并验证 `read` 工具。每个子 Agent 还会在上下文、Skill、工具和显式子扩展组合后检查序列化 Provider 载荷；超大启动会重试合格的更大回退模型，不可约简的启动或继续则在本地停止并写入阶段特定持久诊断，而不是表现为无法解释的 Agent 崩溃。
- Pi 合法隐藏自定义消息，包括 Magic Context 维护提示，可以作为有界子对话记录证据接受。观察到的上限提示也会作为一条有界生命周期事实显示给父级。自定义消息绝不会成为 Agent 最终报告；异常或不受支持协议封装仍安全关闭并写入持久诊断。
- 后台完成渲染一条紧凑 `Agent finished/failed/stopped · … · inspect with /agents` 会话条目。该条目可跨恢复保留、排除在模型上下文之外，且绝不触发未经请求的主模型轮次。完整直接与嵌套报告仍可在 `/agents` 查看。失败直接子 Agent 的模型可见状态会在任何过期进度文字前，显示有界失败类别和已清理路径的终态原因。旧版任务派生状态标签会缩短绝对 POSIX 与 Windows 路径 token，同时保留 URL、相对路径和斜杠分隔说明文字。
- 前台工作通过活跃工具调用返回有界直接子报告，使主 Agent 在当前回答中只综合一次。长报告保留开头证据与结论，标识被省略的中间部分，并指向持久输出产物供模型完整检索。并行投影把同一边界分配给每个子 Agent，而不是丢弃后续结果。
- Agent 详情对话记录按持久调用身份关联每个子工具调用。它渲染紧凑生命周期图标、操作和目标，成功结果在按 `t` 前保持折叠，失败原因保持可见。混合或乱序结果仍可归属；无身份旧版记录只有所有权明确时才配对。
- 归属于用户的后台 Agent 完成会请求 UI 能力刷新其有界 Git 快照。直接用户引导会永久把自动启动的 Agent 提升为用户归属工作，包括重载后；否则自动扩展工作不请求刷新。Agents 能力不渲染或负责状态栏。
- 逐 Agent Git 工作树隔离是可选的。变更或不确定工作树会保留；只有干净工作树可以自动删除。
- 套件负责的 Agent 输入、输出、元数据和对话记录产物默认放在 Pi 设置负责的会话根目录下，位于持久 Pi 会话旁。普通只读委派因此不会在项目中创建 `.pi-subagents`。引擎为嵌入兼容保留显式项目目录政策，但 Pi Stuff 默认不选择。可选最终产物会在持有组写入声明时通过原子重命名发布，因此读者要么看到先前完整文件，要么看到替换文件。清理只删除旧且终态已证明的自有组；活跃证据保留。
- 持久内核声明、增量持久目录快照、身份绑定游标和孤儿清扫使中断或并发维护安全。扫描与快照处理预算分别有界，公平的逐目录配额会推进到后续会话，临时产物有独立处理轮次。未传输的后台结果通知在 30 天内仍可自动向会话传输。只有精确运行与父会话绑定、终态进程证明、死亡 Writer 和完整子会话历史全部存在时，现有 Agent 维护才可清退较旧 Inbox 文件；通知清退后 `/agents` 历史仍可检查。只有结果已经不存在且共享传输声明空闲时，同一处理轮次才删除旧可选传输状态残留。候选选择会跨有界轮次持久前进，因此不确定且保留的结果不能饿死后续通知。

没有子 Agent 时，Fleetview 不渲染行，空闲时也不保留空帮助行。编辑器为空时，按 Down 进入管理：上下文控制在存在时替换页脚第二行，退出后精确恢复最新提示词。`main` 没有 `x` 操作；选中实时子 Agent 显示 `x stop`，终态子 Agent 显示 `x dismiss`。64 列及以下时，提示删除 `select`、`view` 和 `return` 单词。标记、控制和溢出从终端第 1 单元开始；每个标记后一个空格，因此 Agent 文字从第 3 单元开始。使用 Up/Down 选择、Enter 检查、`x` 控制选中子 Agent、Escape 返回。`/agents` 命令打开完整当前会话视图。该能力不创建状态栏、分隔线、永久管理提示、浮动窗口或额外间隙。

编辑器下方名册保留终态行 30 秒，再自动隐藏。实时行绝不过期，`x` 可提前关闭终态行。把行从名册隐藏不会从 `/agents` 删除其有界任务预览、结果或对话记录。只有选中标记使用强调色；常规状态和完成使用柔和色，等待与错误只为显式右侧状态文字着色。选中模型容量已知且 Provider 已报告用量时，右侧会在生命周期状态前显示子 Agent 当前 Context 百分比。子宿主报告其实际选中模型容量；父宿主模型元数据只作为启动时回退。用量是当前 Provider 载荷加有界尾随消息估算，不是累计运行 tokens。非零且低于百分之一显示 `<1%`，零仍显示 `0%`。压缩、模型回退和容量未知运行期间隐藏百分比，直到新权威用量记录到达。窄宽度下它先于 Agent 身份删除；无法读取的描述随后作为一个整体省略，而不是用省略号碎片连接到状态。

Agent 命令对话框使用套件分隔线和两个单元边距，`›` 标记聚焦自定义行。它在所有宽度下保持单列：列表与详情是顺序模式；额外宽度留给选中 Agent 的任务、结果和 Activity，而不是持久名册栏。操作提示会换行，不会删除关闭或返回键：Escape 关闭 Agent 列表，并从详情或引导/恢复编辑器返回一级。终端高度较小时，选中 Agent 或附加错误和 Escape 路径优先于周边对话记录行。空列表保留按键帮助与关闭提示，但在 Agent 存在前省略选择和详情提示。

已接受的 Agent 命令对话框重新设计记录在 [Agent Activity UI 参考](../../../../docs/research/agent-activity-ui-reference.md#f-accepted-agent-command-dialog-redesign)，并已于 2026-08-18 实现。`/agents` 在所有宽度下保持单列，以 Agent 名称作为主要身份。详情使用无图标的 `Task`、可选 outcome section 与 `Activity` semantic heading，内容不嵌套缩进。Agent 消息与保留结果复用 Pi Markdown 组件；工具输出保持字面终端文字。Activity 在限制展开工具预览和报告省略行的同时保留相关事件顺序。生命周期图标、Pi 配置的选择操作、Ctrl+P/Ctrl+N 与 `b`/Space 只读别名、Home/End、上下文 `?` 帮助、稳定启动顺序、低高度优先级和完整 Escape/控制路径，均由聚焦测试与真实 PTY 验证器覆盖。

## 范围

本模块负责当前 Pi 会话内的普通 Subagent。它不提供跨会话 Fleet 或 Agent Teams、已保存 Chain、计划工作、工作流语言、Memory、共享、私有设置界面、状态栏、Watchdog 审查、LSP 集成或另一个 TUI 外壳。

吸收源码快照和归档身份见 [UPSTREAM.md](./UPSTREAM.md)。
