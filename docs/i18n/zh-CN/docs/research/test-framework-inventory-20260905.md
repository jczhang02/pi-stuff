<!-- translation-source: docs/research/test-framework-inventory-20260905.md; translation-source-sha256: a47652b31a4b1622c3cb66acb4317f0cbc402aa0a4e8febc1e6d89f9b69ac6e8 -->

# 测试框架概览与全量清单

日期：2026-09-05。源码快照：`2610bd4299ecb76b29094587a28dd5af5f020c27`。
这是[测试设计访谈](../adr/0031-organize-test-evidence-and-release-gates.md)的分类清单，尚未改变执行器策略。
覆盖该快照的全部受跟踪测试入口、独立验收与 benchmark 入口，以及辅助文件。
本次没有运行测试、付费模型评测或耗时测量。

## 框架概览

```text
仓库验证
├── 正确性测试
│   ├── 单元 U：独立规则、转换与算法
│   ├── 组件 C：通过接口验证一个 Module，控制外部协作对象
│   ├── 集成 I：真实 Module、存储、进程、传输或 Host SDK 连接
│   └── 系统 S：通过真实 Pi RPC 或终端入口验证组装后的 Suite
│       ├── 确定性 E2E：可控 Provider / 本地服务 fixture
│       └── 真实服务 E2E：流程所需的真实模型或外部服务
├── Benchmark
│   ├── 内部性能：延迟、CPU、内存、渲染与上下文处理
│   └── 外部任务：与其他 harness 和 Suite 历史结果比较任务效果与成本
├── 静态与产物门槛：格式、lint、类型、依赖、组装、归档内容
└── 辅助设施与证据：fixture、执行器、观察器、清单与历史报告
```

前四项是执行层级。E2E 描述系统流程，不是第五层。Benchmark 的目的、资源使用、执行频率，
以及被测对象是产品、测试设施还是仓库工具，属于另外的属性。
验证 benchmark 统计函数仍是正确性测试，执行它不会启动付费 benchmark。
源码文本断言也收入清单，但不能因为读取了文件，就声称验证了产品集成。

按实际验证的边界分类，不按文件名或偶然导入的依赖分类。`TestTui` 中的真实 TUI 类是组件测试；
模拟子进程可执行文件是进程集成，并非真实 Pi 系统测试。
真实 Pi SDK Session 可以证明集成，但不能认证独立 Host。跨 Module 集成仍然可以控制外部 Host。
仅用于准备输入的临时文件，也不会让每条断言自动变成集成测试。

文件行中的“静态”表示四种行为层级之外的源码或产物断言，不是第五层。一个文件可以同时包含单元行为测试与这种断言。

## 完整性与限度

- 292 个 Bun 测试文件、21 个 Goal Node 测试文件，共 **313 个唯一文件入口**，已与受跟踪路径逐项对齐。
- 还有一个实际执行入口 `test/goal-upstream/goal-runtime-smoke.mjs`，在 Node 文件之后运行。
- 单独映射全部 25 个 `scripts/verify-*.ts` 文件，以及 `smoke-pi.ts`、执行器、质量与 benchmark 命令。
- `test/` 下其余 91 个受跟踪文件属于辅助设施或输入、证据，列于文末。Runtime budget 场景由 smoke 入口调用，
  不另算一套独立测试。
- 分类粒度是文件。`U/I`、`C/S` 表示混合边界。末尾 `?` 表示文件已定位、用途已确认，
  但仍需逐用例确定边界；它不表示已经证明存在混合覆盖。
- **44 个文件带有这一待确认标记**。在移动文件或按本清单路由检查前必须解决；
  不能仅因文件较大、混合或待确认而删除。
- 这里的覆盖指入口覆盖，不是语句、分支覆盖率，不是逐断言价值审查，也不代表当前测试通过。
  不用文本搜索次数推断用例总数或当前耗时。

## 当前执行方式与已确定方向

| 入口 | 当前行为 | 已确定方向，尚未实施 |
| --- | --- | --- |
| `check:fast` | 格式、lint、类型、Knip、生成源码、仓库与契约目录门槛 | 日常开发质量检查 |
| `test:isolated` | 每个文件独立 Bun 进程，全部串行，包含系统测试 | 先按 U/C/I/S 分类，再调整路由和并行 |
| `test:goal` | 编译、运行 21 个 Node 文件，再运行 Goal SDK runtime smoke | 与 Bun 测试采用同一分类 |
| `test`、`test:ci` | 上述两者 | 普通 PR 完整运行 U/C/I；高风险变更增加针对性 E2E |
| `check` | Fast、全部测试、Tool Activity benchmark、打包验证 | 避免强制本地与 CI 重复全量运行 |
| `pack:verify` | 归档、依赖检查，以及许多解压 Package 验收流程 | 开发归档结构检查与完整发布 E2E 分开 |
| 系统 E2E | 很多流程在普通测试与打包验证中分别运行 | 确定性与真实服务两类都保留；低频执行 |
| `benchmark:*` | Tool Activity 自动；其余手动 | 内部与外部 benchmark 均低频、按需执行 |

正式发布候选要求完整确定性 E2E。显式验证或重要外部依赖变化触发相关真实服务流程。
Benchmark 优先使用公开已存结果和 Pi Stuff 历次结果，不要求新增原生 Pi 对照。
具体产物身份、证据复用和最终路由仍属于后续设计。

已查看的历史 CI [33839062989](https://github.com/jczhang02/pi-stuff/actions/runs/33839062989)
中，隔离测试约 18 分 13 秒，打包验证约 9 分 22 秒，Tool Activity benchmark 约 0.9 秒。
这些旧快照数据用于定位成本，不是本次实测，也不是提速结论。

## 按所属区域列出的文件清单

下面每个路径仅一行。区域用于导航，不构成额外层级。全部 `.test.ts` 由 `test:isolated` 发现；
全部 `.node.ts` 由 `test:goal` 发现。设计并行时，仍需保留 Host、进程、文件系统与全局环境的隔离要求。

| 区域 | 文件数 |
| --- | --- |
| `root` | 44 |
| `agents` | 77 |
| `goal-upstream` | 21 |
| `context` | 18 |
| `code-mode` | 21 |
| `mcp` | 18 |
| `web` | 15 |
| `conversation-ui` | 1 |
| `ui` | 21 |
| `tools` | 19 |
| `btw` | 4 |
| `codex` | 6 |
| `notification` | 6 |
| `ponytail` | 6 |
| `rtk` | 6 |
| `session-naming` | 8 |
| `shared` | 5 |
| `todo` | 9 |
| `work` | 8 |

### root

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [agents-execution-matrix.test.ts](../../../../../test/agents-execution-matrix.test.ts) | S | Agent 执行与上下文矩阵 |
| [agents-host.test.ts](../../../../../test/agents-host.test.ts) | C/S | 定义路径与真实 Pi 加载 |
| [agents-pty.test.ts](../../../../../test/agents-pty.test.ts) | S | 后台报告与冷恢复 TUI |
| [anti-slop.integration.test.ts](../../../../../test/anti-slop.integration.test.ts) | I | 真实 Oxlint 规则接入 |
| [btw-host.test.ts](../../../../../test/btw-host.test.ts) | S | BTW Package 加载 |
| [btw-pty.test.ts](../../../../../test/btw-pty.test.ts) | S | BTW 并发对话框与焦点 |
| [bundled-package.test.ts](../../../../../test/bundled-package.test.ts) | I | 归档内容与依赖边界 |
| [check-capability-contract-catalog.test.ts](../../../../../test/check-capability-contract-catalog.test.ts) | I | 契约目录检查器 fixture |
| [check-repository-safety.test.ts](../../../../../test/check-repository-safety.test.ts) | I | 仓库安全检查器与尺寸门槛 |
| [ci-acceptance-scope.test.ts](../../../../../test/ci-acceptance-scope.test.ts) | U | 变更路径分类 |
| [codex-host.test.ts](../../../../../test/codex-host.test.ts) | S | Codex 加载与启动设置边界 |
| [context-pty.test.ts](../../../../../test/context-pty.test.ts) | S | Context 压缩与重试 TUI |
| [detached-process.test.ts](../../../../../test/detached-process.test.ts) | I | 进程组超时与清理 |
| [effect-foundation.test.ts](../../../../../test/effect-foundation.test.ts) | C/I? | Effect owner 与共享 UI 生命周期 |
| [effect-mainline-benchmark.test.ts](../../../../../test/effect-mainline-benchmark.test.ts) | U/I | benchmark 统计与本地 CLI smoke |
| [generate-suite.test.ts](../../../../../test/generate-suite.test.ts) | I | 生成器输出与漂移检测 |
| [goal-pty.test.ts](../../../../../test/goal-pty.test.ts) | S | Goal 对话框与原生设置 |
| [lifecycle-benchmark.test.ts](../../../../../test/lifecycle-benchmark.test.ts) | U/I | 采样、标记与结果判定 |
| [lifecycle-deadline.test.ts](../../../../../test/lifecycle-deadline.test.ts) | U | 截止时间取消 |
| [pi-host-provenance.test.ts](../../../../../test/pi-host-provenance.test.ts) | I | Host 产物身份检查 |
| [pi-host-seams.test.ts](../../../../../test/pi-host-seams.test.ts) | I | JSONL 证据轮询辅助逻辑 |
| [pi-rpc-client.test.ts](../../../../../test/pi-rpc-client.test.ts) | I | 子进程 RPC 退出、超时与信号 |
| [ponytail-pty.test.ts](../../../../../test/ponytail-pty.test.ts) | S | Ponytail 对话框、状态与 prompt 边界 |
| [skill-discovery-benchmark.test.ts](../../../../../test/skill-discovery-benchmark.test.ts) | U/I | 清单、观察器、统计与脱敏 |
| [smoke-pi.test.ts](../../../../../test/smoke-pi.test.ts) | S | 独立 Pi RPC Package smoke |
| [suite-host.test.ts](../../../../../test/suite-host.test.ts) | S | 通过 Pi 验证单 Package 组装 |
| [suite-lifecycle.test.ts](../../../../../test/suite-lifecycle.test.ts) | C | 就绪与退出代际屏障 |
| [suite-loader.test.ts](../../../../../test/suite-loader.test.ts) | I | 物理源码缓存与 reload |
| [theme-pty.test.ts](../../../../../test/theme-pty.test.ts) | S | 主题发现、切换与恢复 |
| [themes.test.ts](../../../../../test/themes.test.ts) | I | 发布主题资源校验 |
| [todo-host.test.ts](../../../../../test/todo-host.test.ts) | C/S | Task 工具注册与 Pi 加载 |
| [tools-grouping-pty.test.ts](../../../../../test/tools-grouping-pty.test.ts) | S | 工具分组与 tmux 继承 |
| [tools-pty.test.ts](../../../../../test/tools-pty.test.ts) | S | 工具详情与 UI 响应 |
| [tools-resume-pty.test.ts](../../../../../test/tools-resume-pty.test.ts) | S | 恢复投影与活跃成员 |
| [typecheck-configuration.test.ts](../../../../../test/typecheck-configuration.test.ts) | I | TypeScript 配置与构建接入 |
| [ui-host.test.ts](../../../../../test/ui-host.test.ts) | S | 统一 UI 设置命令 |
| [ui-pty-evidence.test.ts](../../../../../test/ui-pty-evidence.test.ts) | U | 证据路径脱敏 |
| [ui-pty-owner-watchdog.test.ts](../../../../../test/ui-pty-owner-watchdog.test.ts) | I | 进程身份与 tmux 所有权 |
| [ui-pty.test.ts](../../../../../test/ui-pty.test.ts) | S | 真实终端渲染与恢复 |
| [user-message-pty.test.ts](../../../../../test/user-message-pty.test.ts) | S | 消息展开、resize 与重放 |
| [work-host.test.ts](../../../../../test/work-host.test.ts) | S | Background Work 加载与 Bash 策略 |
| [work-monitor-matrix.test.ts](../../../../../test/work-monitor-matrix.test.ts) | S | Monitor 成功与失败流程 |
| [work-pty.test.ts](../../../../../test/work-pty.test.ts) | S | 转后台、监控、reload 与清理 |
| [xdg-paths.test.ts](../../../../../test/xdg-paths.test.ts) | C/I | 环境回退与状态路径 |

### agents

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [agent-bundle-boundary.test.ts](../../../../../test/agents/agent-bundle-boundary.test.ts) | I | Agent 定义发现边界 |
| [agent-dialog.test.ts](../../../../../test/agents/agent-dialog.test.ts) | C | Agent 对话框状态与布局 |
| [agent-discovery.test.ts](../../../../../test/agents/agent-discovery.test.ts) | I | 目录优先级、符号链接与无效定义 |
| [agent-effect-owner.test.ts](../../../../../test/agents/agent-effect-owner.test.ts) | C | Effect scope 替换与退出 |
| [agent-execution-coordinator-leases.test.ts](../../../../../test/agents/agent-execution-coordinator-leases.test.ts) | C/I? | 协调器 lease 绑定与释放 |
| [agent-execution-coordinator-session.test.ts](../../../../../test/agents/agent-execution-coordinator-session.test.ts) | C/I? | Session ledger 与启动准入 |
| [agent-execution-governor.test.ts](../../../../../test/agents/agent-execution-governor.test.ts) | C/I? | 容量、深度与 lease 重绑定 |
| [agent-roster.test.ts](../../../../../test/agents/agent-roster.test.ts) | C | Roster 排序与可见状态 |
| [agent-transcript.test.ts](../../../../../test/agents/agent-transcript.test.ts) | I | Transcript 写入、配对与清理 |
| [artifacts.test.ts](../../../../../test/agents/artifacts.test.ts) | I | 原子 artifact 发布与生命周期 |
| [atomic-json.test.ts](../../../../../test/agents/atomic-json.test.ts) | U | 写入失败保留原始错误 |
| [background-engine-artifacts.test.ts](../../../../../test/agents/background-engine-artifacts.test.ts) | I | Artifact 轮转与缺失结果恢复 |
| [background-engine-completion.test.ts](../../../../../test/agents/background-engine-completion.test.ts) | I | Fixture 子进程跨 Tool 边界完成 |
| [background-engine-configuration.test.ts](../../../../../test/agents/background-engine-configuration.test.ts) | I | 启动标记与目录所有权 |
| [background-engine-fallback.test.ts](../../../../../test/agents/background-engine-fallback.test.ts) | I | Fallback 与 Session 副本恢复 |
| [background-engine-groups.test.ts](../../../../../test/agents/background-engine-groups.test.ts) | I | 并行组超时、排队取消与清理 |
| [background-engine-lifecycle.test.ts](../../../../../test/agents/background-engine-lifecycle.test.ts) | I | Writer 协议与终态持久化 |
| [background-engine-recovery.test.ts](../../../../../test/agents/background-engine-recovery.test.ts) | I | 持久化进程与嵌套结果恢复 |
| [background-engine-startup.test.ts](../../../../../test/agents/background-engine-startup.test.ts) | I | Fixture 进程启动与输出排空 |
| [background-engine-steering.test.ts](../../../../../test/agents/background-engine-steering.test.ts) | I | Steering 路由与确认重放 |
| [background-engine-terminal.test.ts](../../../../../test/agents/background-engine-terminal.test.ts) | I | 信号与后代进程终止 |
| [child-protocol.test.ts](../../../../../test/agents/child-protocol.test.ts) | U | 子进程协议解析 |
| [child-result-reducer.test.ts](../../../../../test/agents/child-result-reducer.test.ts) | U | 结果归约与最终报告优先级 |
| [config.test.ts](../../../../../test/agents/config.test.ts) | U | 并发与深度常量 |
| [control-channel.test.ts](../../../../../test/agents/control-channel.test.ts) | I | 定向控制原子写入 |
| [current-agents-controls.test.ts](../../../../../test/agents/current-agents-controls.test.ts) | I | 控制日志扫描与去重 |
| [current-agents-lifecycle.test.ts](../../../../../test/agents/current-agents-lifecycle.test.ts) | C/I? | 生命周期持久化与通知 |
| [current-agents-projection.test.ts](../../../../../test/agents/current-agents-projection.test.ts) | C | 当前 Session 的直接子 Agent 投影 |
| [current-agents-recovery.test.ts](../../../../../test/agents/current-agents-recovery.test.ts) | I | 持久化 runtime 恢复 |
| [diagnostics.test.ts](../../../../../test/agents/diagnostics.test.ts) | U | 诊断格式化与归一化 |
| [display-description.test.ts](../../../../../test/agents/display-description.test.ts) | U | 描述截断与回退 |
| [durable-claim.test.ts](../../../../../test/agents/durable-claim.test.ts) | I | 跨进程 claim 与崩溃恢复 |
| [executor-contract.test.ts](../../../../../test/agents/executor-contract.test.ts) | U | 公开 target 解析与校验 |
| [extension-root-composition.test.ts](../../../../../test/agents/extension-root-composition.test.ts) | C/I | 受控 Host 与文件中的 Agents 注册 |
| [extension-root-lifecycle.test.ts](../../../../../test/agents/extension-root-lifecycle.test.ts) | C/I | 受控 Host 与文件中的 Agents 生命周期 |
| [extension-root-recovery.test.ts](../../../../../test/agents/extension-root-recovery.test.ts) | C/I? | 受控 Host 中的 Agents 恢复 |
| [fanout-child.test.ts](../../../../../test/agents/fanout-child.test.ts) | C/I? | Fanout 协调与生命周期 |
| [final-report-scanner.test.ts](../../../../../test/agents/final-report-scanner.test.ts) | U | 最终报告文本扫描 |
| [foreground-engine-admission.test.ts](../../../../../test/agents/foreground-engine-admission.test.ts) | C/I? | Prompt 计数与启动准入 |
| [foreground-engine-context.test.ts](../../../../../test/agents/foreground-engine-context.test.ts) | C/I? | 前台结果与上下文隔离 |
| [foreground-engine-launch.test.ts](../../../../../test/agents/foreground-engine-launch.test.ts) | C/I? | 前台子 Agent 设置与归属 |
| [foreground-engine-recovery.test.ts](../../../../../test/agents/foreground-engine-recovery.test.ts) | I | 持久化前台 runtime 恢复 |
| [foreground-engine-resume.test.ts](../../../../../test/agents/foreground-engine-resume.test.ts) | C/I? | 恢复身份与执行上下文 |
| [fork-context.test.ts](../../../../../test/agents/fork-context.test.ts) | U | Fork 消息清洗 |
| [host-builtins.test.ts](../../../../../test/agents/host-builtins.test.ts) | C | 内建工具注册表与 MCP 策略 |
| [legacy-async-recovery.test.ts](../../../../../test/agents/legacy-async-recovery.test.ts) | I | 旧进程证据恢复 |
| [legacy-surface-cleanup.test.ts](../../../../../test/agents/legacy-surface-cleanup.test.ts) | I | 旧描述文件与元数据清理 |
| [model-fallback.test.ts](../../../../../test/agents/model-fallback.test.ts) | C/I? | Fallback 限制与 Session 恢复 |
| [native-supervisor-channel-delivery.test.ts](../../../../../test/agents/native-supervisor-channel-delivery.test.ts) | I | 通道投递、claim 与扫描 |
| [native-supervisor-channel-ownership.test.ts](../../../../../test/agents/native-supervisor-channel-ownership.test.ts) | I | Owner 崩溃恢复与接管 |
| [nested-events.test.ts](../../../../../test/agents/nested-events.test.ts) | I | 嵌套路由发布与恢复 |
| [pi-spawn.test.ts](../../../../../test/agents/pi-spawn.test.ts) | C/I? | 子进程可执行文件解析与继承 |
| [ponytail-propagation.test.ts](../../../../../test/agents/ponytail-propagation.test.ts) | C | Ponytail 模式启动快照 |
| [process-controls-recovery.test.ts](../../../../../test/agents/process-controls-recovery.test.ts) | I | 进程身份与控制恢复 |
| [product-executor.test.ts](../../../../../test/agents/product-executor.test.ts) | C | 执行器参数与结果映射 |
| [result-watcher-atomic.test.ts](../../../../../test/agents/result-watcher-atomic.test.ts) | I | 原子结果替换与 claim |
| [result-watcher-compatibility.test.ts](../../../../../test/agents/result-watcher-compatibility.test.ts) | I | 旧结果与归属投影 |
| [result-watcher-delivery.test.ts](../../../../../test/agents/result-watcher-delivery.test.ts) | I | 冷投递、重试与 watcher 回退 |
| [run-status.test.ts](../../../../../test/agents/run-status.test.ts) | U | 状态选择与脱敏 |
| [runtime-maintenance.test.ts](../../../../../test/agents/runtime-maintenance.test.ts) | I | 维护公平性与孤儿清理 |
| [session-governor-compatibility.test.ts](../../../../../test/agents/session-governor-compatibility.test.ts) | I | 旧 governor 状态兼容 |
| [session-governor-runtime-address.test.ts](../../../../../test/agents/session-governor-runtime-address.test.ts) | I | 持久 runtime 地址身份 |
| [session-governor-work-usage.test.ts](../../../../../test/agents/session-governor-work-usage.test.ts) | C/I? | Usage ledger 与启动限制 |
| [session-governor.test.ts](../../../../../test/agents/session-governor.test.ts) | I | Governor ledger 与状态目录 |
| [session-identity.test.ts](../../../../../test/agents/session-identity.test.ts) | I | Session 文件身份与命名空间隔离 |
| [session-lease.test.ts](../../../../../test/agents/session-lease.test.ts) | I | Lease 存活与进程证据 |
| [skills.test.ts](../../../../../test/agents/skills.test.ts) | U | 无请求时 Skill 解析短路 |
| [steering-wait.test.ts](../../../../../test/agents/steering-wait.test.ts) | C | 确认轮询与瞬时错误 |
| [terminal-outcome.test.ts](../../../../../test/agents/terminal-outcome.test.ts) | U | 终态分类与 usage 往返 |
| [tool-budget-runtime.test.ts](../../../../../test/agents/tool-budget-runtime.test.ts) | U | Tool budget 状态与协议证据 |
| [tool-presentation-channels.test.ts](../../../../../test/agents/tool-presentation-channels.test.ts) | I | 控制通道与 steering 确认 |
| [tool-presentation-child-runtime.test.ts](../../../../../test/agents/tool-presentation-child-runtime.test.ts) | C/I? | 子 Agent 工具标识与上下文投影 |
| [tool-presentation-host-tools.test.ts](../../../../../test/agents/tool-presentation-host-tools.test.ts) | C/I? | 工具允许列表、环境与注册 |
| [tool-presentation-rendering.test.ts](../../../../../test/agents/tool-presentation-rendering.test.ts) | C | 工具行与终端宽度边界 |
| [tool-timeout.test.ts](../../../../../test/agents/tool-timeout.test.ts) | U | 工具超时选择 |
| [worktree-lifecycle.test.ts](../../../../../test/agents/worktree-lifecycle.test.ts) | I | Git worktree 清理与数据保护 |
| [writer-process-registry.test.ts](../../../../../test/agents/writer-process-registry.test.ts) | I | Writer 身份、信号与陈旧状态 |

### goal-upstream

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [command.node.ts](../../../../../test/goal-upstream/command.node.ts) | U/C? | 命令解析与补全 |
| [goal-accounting.node.ts](../../../../../test/goal-upstream/goal-accounting.node.ts) | U/C? | 预算解析与管理命令 |
| [goal-budget.node.ts](../../../../../test/goal-upstream/goal-budget.node.ts) | C/I? | 暂停、清除与陈旧工具状态 |
| [goal-continuation.node.ts](../../../../../test/goal-upstream/goal-continuation.node.ts) | C/I? | 续跑所有权与消费 |
| [goal-ownership.node.ts](../../../../../test/goal-upstream/goal-ownership.node.ts) | C/I? | 父子所有权与工具隔离 |
| [goal-queue-priority.node.ts](../../../../../test/goal-upstream/goal-queue-priority.node.ts) | C/I? | 队列优先级与运行身份 |
| [goal-queue-recovery.node.ts](../../../../../test/goal-upstream/goal-queue-recovery.node.ts) | C/I? | 队列 reload 与队首恢复 |
| [goal-queue.node.ts](../../../../../test/goal-upstream/goal-queue.node.ts) | C/I? | 队列注册与变更 |
| [goal-recovery.node.ts](../../../../../test/goal-upstream/goal-recovery.node.ts) | U/C? | 恢复分类与事件映射 |
| [goal-resume.node.ts](../../../../../test/goal-upstream/goal-resume.node.ts) | C/I? | 停止状态恢复与身份轮换 |
| [goal-run-protocol.node.ts](../../../../../test/goal-upstream/goal-run-protocol.node.ts) | C/I? | Managed-run 协议生命周期 |
| [goal-run-session.node.ts](../../../../../test/goal-upstream/goal-run-session.node.ts) | C/I? | Run listener 隔离与取消 |
| [goal-safety.node.ts](../../../../../test/goal-upstream/goal-safety.node.ts) | U/C? | 无进展与 blocker audit 分类 |
| [goal-terminal-tools.node.ts](../../../../../test/goal-upstream/goal-terminal-tools.node.ts) | C/I? | 终态工具 guard 与 prompt 路由 |
| [goal-tool-policy.node.ts](../../../../../test/goal-upstream/goal-tool-policy.node.ts) | C/I? | 工具策略与陈旧 turn 中止 |
| [goal.node.ts](../../../../../test/goal-upstream/goal.node.ts) | C/I | Mock Pi 中的 Goal 注册与设置 |
| [menu.node.ts](../../../../../test/goal-upstream/menu.node.ts) | U/C? | 菜单优先级与文本边界 |
| [persistence.node.ts](../../../../../test/goal-upstream/persistence.node.ts) | I | 状态持久化与损坏文件 |
| [queue.node.ts](../../../../../test/goal-upstream/queue.node.ts) | U/C? | 队列结构操作 |
| [settings-ui.node.ts](../../../../../test/goal-upstream/settings-ui.node.ts) | C | 设置输入与限制对话框 |
| [settings.node.ts](../../../../../test/goal-upstream/settings.node.ts) | I | 设置归一化与持久化 |

### context

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [activity.test.ts](../../../../../test/context/activity.test.ts) | U | 活动投影与清洗 |
| [config.test.ts](../../../../../test/context/config.test.ts) | I | 配置首次使用、迁移与权限 |
| [core-activation.test.ts](../../../../../test/context/core-activation.test.ts) | C | 激活、原生压缩与重试 |
| [core-compaction.test.ts](../../../../../test/context/core-compaction.test.ts) | C | 压缩失败、取消与恢复 |
| [core-input-activation.test.ts](../../../../../test/context/core-input-activation.test.ts) | C | 交互输入激活权限 |
| [core-maintenance.test.ts](../../../../../test/context/core-maintenance.test.ts) | C | 维护与 Session 隔离 |
| [core-ordering.test.ts](../../../../../test/context/core-ordering.test.ts) | C | 贡献者与事件顺序 |
| [core-projections.test.ts](../../../../../test/context/core-projections.test.ts) | C | 投影缓存、并发与隔离 |
| [core-provider-boundary.test.ts](../../../../../test/context/core-provider-boundary.test.ts) | C | Provider payload 与恢复边界 |
| [core-runtime.test.ts](../../../../../test/context/core-runtime.test.ts) | C | Runtime 启动、复用与清理 |
| [dialog.test.ts](../../../../../test/context/dialog.test.ts) | C | Context 对话框状态与布局 |
| [duplicate-runtime.test.ts](../../../../../test/context/duplicate-runtime.test.ts) | I | 物理 Module 副本共享 Host 资源 |
| [magic-context-schema.test.ts](../../../../../test/context/magic-context-schema.test.ts) | I | SQLite 存储迁移与版本拒绝 |
| [magic-worker-context.test.ts](../../../../../test/context/magic-worker-context.test.ts) | U/C? | Worker Session mirror 隔离 |
| [magic-worker-transport.test.ts](../../../../../test/context/magic-worker-transport.test.ts) | C/I? | Worker 协议、取消与清理 |
| [magic-worker.test.ts](../../../../../test/context/magic-worker.test.ts) | C/I? | Worker effects 与 Host interpreter 边界 |
| [native-custom-turn-compaction-host-seam.test.ts](../../../../../test/context/native-custom-turn-compaction-host-seam.test.ts) | I | 真实 Pi SDK 压缩与 custom turn |
| [prompt-contributions.test.ts](../../../../../test/context/prompt-contributions.test.ts) | C | Prompt 贡献组合与清理 |

### code-mode

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [cloudflare-codec.test.ts](../../../../../test/code-mode/cloudflare-codec.test.ts) | U | JSON codec 与稳定序列化 |
| [cloudflare-normalize.test.ts](../../../../../test/code-mode/cloudflare-normalize.test.ts) | U | 程序归一化 |
| [cloudflare-search.test.ts](../../../../../test/code-mode/cloudflare-search.test.ts) | U | 精确工具搜索 |
| [connector.test.ts](../../../../../test/code-mode/connector.test.ts) | C | 工具目录与结果、媒体适配 |
| [delegate-lifecycle.test.ts](../../../../../test/code-mode/delegate-lifecycle.test.ts) | C | 委托 scope 取消与隔离 |
| [delegate-runtime.test.ts](../../../../../test/code-mode/delegate-runtime.test.ts) | C | 委托、批准与 trace 结算 |
| [dialog.test.ts](../../../../../test/code-mode/dialog.test.ts) | C | 设置对话框继承与回退 |
| [extension.test.ts](../../../../../test/code-mode/extension.test.ts) | C | Extension 注册、UI 与投影 |
| [host-client.test.ts](../../../../../test/code-mode/host-client.test.ts) | I | 子进程握手、帧与退出 |
| [image-benchmark.test.ts](../../../../../test/code-mode/image-benchmark.test.ts) | U | PNG fixture 与 benchmark 结果统计 |
| [image-content.test.ts](../../../../../test/code-mode/image-content.test.ts) | U | 图片数据校验与边界 |
| [install-host.test.ts](../../../../../test/code-mode/install-host.test.ts) | I | 安装锁与 staging 恢复 |
| [ledger.test.ts](../../../../../test/code-mode/ledger.test.ts) | C/I? | Ledger 重放、批准与持久化失败 |
| [presentation.test.ts](../../../../../test/code-mode/presentation.test.ts) | U | 媒体与工具结果投影 |
| [process-start-identity.test.ts](../../../../../test/code-mode/process-start-identity.test.ts) | U | 注入 reader 的进程身份解析 |
| [runtime.test.ts](../../../../../test/code-mode/runtime.test.ts) | C | 执行重放、取消与媒体 |
| [search-response.test.ts](../../../../../test/code-mode/search-response.test.ts) | C | 发现响应与字符预算 |
| [settings.test.ts](../../../../../test/code-mode/settings.test.ts) | I | 设置层与命名空间持久化 |
| [skill-discovery.test.ts](../../../../../test/code-mode/skill-discovery.test.ts) | C | Skill 目录 prompt 投影 |
| [trace-store.test.ts](../../../../../test/code-mode/trace-store.test.ts) | U | Trace 去重与保留 |
| [v8-real.test.ts](../../../../../test/code-mode/v8-real.test.ts) | I | 真实 V8 executor 与 connector；显式开启 |

### mcp

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [adapter.test.ts](../../../../../test/mcp/adapter.test.ts) | C/I | Gateway 注册、发现与 Code Mode 连接 |
| [auth-flow.test.ts](../../../../../test/mcp/auth-flow.test.ts) | C/I | OAuth 回调与凭据绑定 |
| [command-secret.test.ts](../../../../../test/mcp/command-secret.test.ts) | U/I | 真实 secret command 与错误脱敏 |
| [config-persistence.test.ts](../../../../../test/mcp/config-persistence.test.ts) | I | 配置锁、符号链接与原子合并 |
| [dialog.test.ts](../../../../../test/mcp/dialog.test.ts) | C | MCP 对话框状态与重连操作 |
| [host-seam.test.ts](../../../../../test/mcp/host-seam.test.ts) | C/I? | Manager 隔离与资源预览 |
| [http-transport.test.ts](../../../../../test/mcp/http-transport.test.ts) | I | 原生 HTTP 对本地服务器的 OAuth 重试 |
| [mcp-trace.test.ts](../../../../../test/mcp/mcp-trace.test.ts) | U | Transport trace 身份与委托 |
| [npx-resolver.test.ts](../../../../../test/mcp/npx-resolver.test.ts) | I | NPX 缓存发现与无效条目 |
| [output-guard.test.ts](../../../../../test/mcp/output-guard.test.ts) | U | 嵌套输出字节预算 |
| [presentation.test.ts](../../../../../test/mcp/presentation.test.ts) | U | MCP 活动分类 |
| [probe.test.ts](../../../../../test/mcp/probe.test.ts) | C | Probe 响应边界与取消 |
| [proxy-call.test.ts](../../../../../test/mcp/proxy-call.test.ts) | C | 已解析工具派发与认证要求 |
| [request-timeout.test.ts](../../../../../test/mcp/request-timeout.test.ts) | C | SDK 超时配置 |
| [runtime-owner.test.ts](../../../../../test/mcp/runtime-owner.test.ts) | C | Runtime 取消与 transport 清理 |
| [setup-panel.test.ts](../../../../../test/mcp/setup-panel.test.ts) | C | Setup 导航、写入与错误 |
| [status-store.test.ts](../../../../../test/mcp/status-store.test.ts) | U | 状态快照校验与投影 |
| [xdg-paths.test.ts](../../../../../test/mcp/xdg-paths.test.ts) | I | 配置、缓存、状态路径与 onboarding |

### web

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [activity.test.ts](../../../../../test/web/activity.test.ts) | U | Provider 错误脱敏与活动状态 |
| [adapter.test.ts](../../../../../test/web/adapter.test.ts) | C | 工具 schema、URL 检查与投影 |
| [config.test.ts](../../../../../test/web/config.test.ts) | C/I | 设置迁移、更新与 URL 策略 |
| [credential-source.test.ts](../../../../../test/web/credential-source.test.ts) | C | 受控 command 的凭据引用解析 |
| [extract.test.ts](../../../../../test/web/extract.test.ts) | C | 提取取消、并发与顺序 |
| [fake-ip.test.ts](../../../../../test/web/fake-ip.test.ts) | C | 受控 DNS 检测与请求合并 |
| [gemini-api.test.ts](../../../../../test/web/gemini-api.test.ts) | C/I | 重定向策略与凭据转发 |
| [pdf-extract.test.ts](../../../../../test/web/pdf-extract.test.ts) | I | 本地 PDF 提取与文件 artifact |
| [presentation.test.ts](../../../../../test/web/presentation.test.ts) | U | 搜索、获取失败与续跑投影 |
| [provider-api-redirects.test.ts](../../../../../test/web/provider-api-redirects.test.ts) | —（静态） | 重定向策略的仓库源码断言 |
| [provider-domain-filter.test.ts](../../../../../test/web/provider-domain-filter.test.ts) | U + 静态 | 域名匹配与仓库源码断言 |
| [provider-effects.test.ts](../../../../../test/web/provider-effects.test.ts) | C | 受控 Provider 聚合与取消 |
| [rsc-extract.test.ts](../../../../../test/web/rsc-extract.test.ts) | U | RSC 提取与表格转义 |
| [ssrf-protection.test.ts](../../../../../test/web/ssrf-protection.test.ts) | C | 受控 DNS、重定向与请求取消 |
| [url-policy.test.ts](../../../../../test/web/url-policy.test.ts) | U | 公网 URL 输入校验 |

### conversation-ui

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [ponytail-dialog.test.ts](../../../../../test/conversation-ui/ponytail-dialog.test.ts) | C | Ponytail 对话框导航与关闭 |

### ui

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [agent-run-origin.test.ts](../../../../../test/ui/agent-run-origin.test.ts) | U | 用户运行归属与队列转换 |
| [command-dialog-attribution.test.ts](../../../../../test/ui/command-dialog-attribution.test.ts) | C | 用户与自动运行归属 |
| [command-dialog-ownership.test.ts](../../../../../test/ui/command-dialog-ownership.test.ts) | C | 共享对话框与 footer 所有权 |
| [command-dialog-presentation.test.ts](../../../../../test/ui/command-dialog-presentation.test.ts) | C | 对话框生命周期与投影 |
| [command-dialog-queue.test.ts](../../../../../test/ui/command-dialog-queue.test.ts) | C | 对话框队列与挂载阻塞 |
| [conversation-markdown.test.ts](../../../../../test/ui/conversation-markdown.test.ts) | U/C | Markdown 转换与生命周期适配 |
| [diagnostics.test.ts](../../../../../test/ui/diagnostics.test.ts) | C | 诊断通道与对话框布局 |
| [dialog-layout.test.ts](../../../../../test/ui/dialog-layout.test.ts) | U | 对话框宽度与行预算 |
| [fenced-visualization.test.ts](../../../../../test/ui/fenced-visualization.test.ts) | U | Chart、tree fence 识别与投影 |
| [host-resource.test.ts](../../../../../test/ui/host-resource.test.ts) | C | Host 共享资源发现失败 |
| [input-enhancement.test.ts](../../../../../test/ui/input-enhancement.test.ts) | C | 输入高亮与按键行为 |
| [settings.test.ts](../../../../../test/ui/settings.test.ts) | I | 设置持久化与跨 Worker 锁竞争 |
| [statusline-git.test.ts](../../../../../test/ui/statusline-git.test.ts) | C | 受控 exec 的 Git 刷新 |
| [statusline-history.test.ts](../../../../../test/ui/statusline-history.test.ts) | C | 历史行、顺序与截断 |
| [statusline-rendering.test.ts](../../../../../test/ui/statusline-rendering.test.ts) | C | 受控 Host 上的状态通道渲染 |
| [suite-agent-message.test.ts](../../../../../test/ui/suite-agent-message.test.ts) | C | 跨 facade 消息与 thenable |
| [thinking-line.test.ts](../../../../../test/ui/thinking-line.test.ts) | C | 原生 Markdown Thinking 投影 |
| [ui-settings-dialog.test.ts](../../../../../test/ui/ui-settings-dialog.test.ts) | C | 设置搜索、布局与失败 |
| [user-message-card.test.ts](../../../../../test/ui/user-message-card.test.ts) | C | 消息渲染与展开 |
| [user-message-display.test.ts](../../../../../test/ui/user-message-display.test.ts) | C | 消息插入所有权与释放 |
| [welcome-header.test.ts](../../../../../test/ui/welcome-header.test.ts) | C | 欢迎头部宽度与可见性 |

### tools

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [activity-store.test.ts](../../../../../test/tools/activity-store.test.ts) | U | 不可变快照与转换去重 |
| [activity.test.ts](../../../../../test/tools/activity.test.ts) | U | Retrieval 分组与叙事边界 |
| [builtin-tools.test.ts](../../../../../test/tools/builtin-tools.test.ts) | I | 内建工具注册与真实 Skill 读取 |
| [contract-codemode-lifecycle.test.ts](../../../../../test/tools/contract-codemode-lifecycle.test.ts) | C/I? | 嵌套生命周期、取消与补偿 |
| [contract-codemode-media.test.ts](../../../../../test/tools/contract-codemode-media.test.ts) | I | Code Mode 与 Tool Display 媒体一致性 |
| [contract-codemode-projection.test.ts](../../../../../test/tools/contract-codemode-projection.test.ts) | I | Connector 与 Tool Display 结果投影 |
| [contract-registration.test.ts](../../../../../test/tools/contract-registration.test.ts) | C | 工具注册与重复项 |
| [contract-rendering.test.ts](../../../../../test/tools/contract-rendering.test.ts) | C/I? | 工具装饰、展开与回退 |
| [contract-retrieval-core.test.ts](../../../../../test/tools/contract-retrieval-core.test.ts) | C | Retrieval 状态、计时与边界 |
| [contract-retrieval-outcomes.test.ts](../../../../../test/tools/contract-retrieval-outcomes.test.ts) | C | Retrieval 结果、分页与回退 |
| [contract-timers.test.ts](../../../../../test/tools/contract-timers.test.ts) | C | 共享 ticker 与 reload 交接 |
| [dialog.test.ts](../../../../../test/tools/dialog.test.ts) | C | 工具列表、详情与窄屏布局 |
| [duplicate-runtime.test.ts](../../../../../test/tools/duplicate-runtime.test.ts) | I | 物理 Module 副本共享 runtime |
| [formatted-detail.test.ts](../../../../../test/tools/formatted-detail.test.ts) | C | 格式化证据与原始协议边界 |
| [operation-blocks.test.ts](../../../../../test/tools/operation-blocks.test.ts) | C/I | 跨 Capability 操作注册与渲染 |
| [render.test.ts](../../../../../test/tools/render.test.ts) | C | 工具行、颜色与宽度边界 |
| [resume-handoff.test.ts](../../../../../test/tools/resume-handoff.test.ts) | I | 生命周期交接与 Session 文件 |
| [settings.test.ts](../../../../../test/tools/settings.test.ts) | I | 设置迁移、锁与原子写入 |
| [terminal.test.ts](../../../../../test/tools/terminal.test.ts) | U | 终端文本清理与截断 |

### btw

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [core.test.ts](../../../../../test/btw/core.test.ts) | C | 上下文投影、流式错误与取消 |
| [history.test.ts](../../../../../test/btw/history.test.ts) | C | 历史隔离、淘汰与恢复 |
| [transport.test.ts](../../../../../test/btw/transport.test.ts) | C | 受控 Provider headers 与取消 |
| [ui.test.ts](../../../../../test/btw/ui.test.ts) | C | 对话框渲染、导航与清理 |

### codex

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [dialog.test.ts](../../../../../test/codex/dialog.test.ts) | C | Codex 对话框布局与错误 |
| [image-generation.test.ts](../../../../../test/codex/image-generation.test.ts) | C/I | 图片 MIME、路径、边界与工具结果 |
| [native-tools.test.ts](../../../../../test/codex/native-tools.test.ts) | C/I | 原生工具注册与平台策略 |
| [settings.test.ts](../../../../../test/codex/settings.test.ts) | I | 设置启动、原子写入与锁 |
| [tools.test.ts](../../../../../test/codex/tools.test.ts) | C | 工具注册与模型激活 |
| [usage.test.ts](../../../../../test/codex/usage.test.ts) | C | Usage 归一化、超时与取消 |

### notification

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [dialog.test.ts](../../../../../test/notification/dialog.test.ts) | C | 通知设置对话框 |
| [extension.test.ts](../../../../../test/notification/extension.test.ts) | C | 命令、监听器与清理 |
| [format.test.ts](../../../../../test/notification/format.test.ts) | U | 通知标题与正文格式化 |
| [runtime.test.ts](../../../../../test/notification/runtime.test.ts) | C | 通知状态、宽限期与取消 |
| [settings.test.ts](../../../../../test/notification/settings.test.ts) | I | 设置迁移与并发持久化 |
| [transport.test.ts](../../../../../test/notification/transport.test.ts) | I | 终端通知与真实 tmux transport |

### ponytail

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [behavior-benchmark.test.ts](../../../../../test/ponytail/behavior-benchmark.test.ts) | C/I | Benchmark 输入、快照与统计 |
| [core.test.ts](../../../../../test/ponytail/core.test.ts) | U/I | 模式规则、设置与资源过滤 |
| [prompt-budget.test.ts](../../../../../test/ponytail/prompt-budget.test.ts) | C/I | 真实 Skill 加载与 prompt token 计数 |
| [prompt.test.ts](../../../../../test/ponytail/prompt.test.ts) | U | 模式对应的 prompt 贡献 |
| [runtime.test.ts](../../../../../test/ponytail/runtime.test.ts) | C/I | Session 模式生命周期与设置 |
| [upstream-review.test.ts](../../../../../test/ponytail/upstream-review.test.ts) | I | 资源哈希与上游完整性 |

### rtk

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [dialog.test.ts](../../../../../test/rtk/dialog.test.ts) | C | RTK 对话框路径与布局 |
| [extension.test.ts](../../../../../test/rtk/extension.test.ts) | C/I | Extension 注册与设置目录 |
| [projection.test.ts](../../../../../test/rtk/projection.test.ts) | U | RTK 消息投影 |
| [real-rtk.test.ts](../../../../../test/rtk/real-rtk.test.ts) | I | 已安装 RTK 执行；依赖可用性条件 |
| [runtime.test.ts](../../../../../test/rtk/runtime.test.ts) | C/I | 可执行文件身份、重试与重写 |
| [settings.test.ts](../../../../../test/rtk/settings.test.ts) | I | 设置 schema、并发与写入失败 |

### session-naming

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [controller.test.ts](../../../../../test/session-naming/controller.test.ts) | C | 命名冷却、覆盖与重试 |
| [extension.test.ts](../../../../../test/session-naming/extension.test.ts) | C | 受控模型的命名 Extension 生命周期 |
| [host.test.ts](../../../../../test/session-naming/host.test.ts) | S | 真实 Pi 恢复与 Session 命名 |
| [model.test.ts](../../../../../test/session-naming/model.test.ts) | C | 模型选择、回退与名称校验 |
| [prompt.test.ts](../../../../../test/session-naming/prompt.test.ts) | U | 命名 prompt 与 ASCII 校验 |
| [settings-dialog.test.ts](../../../../../test/session-naming/settings-dialog.test.ts) | C/I? | 测试 settings store 的设置对话框 |
| [settings.test.ts](../../../../../test/session-naming/settings.test.ts) | I | 设置默认值与持久化 |
| [state.test.ts](../../../../../test/session-naming/state.test.ts) | U | 命名状态与消息窗口投影 |

### shared

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [host-proxy.test.ts](../../../../../test/shared/host-proxy.test.ts) | U | Proxy 属性访问与转发 |
| [json-value.test.ts](../../../../../test/shared/json-value.test.ts) | U | JSON 输入 guard 与循环 |
| [runtime-type.test.ts](../../../../../test/shared/runtime-type.test.ts) | U | Runtime 类型 guard |
| [settings-io.test.ts](../../../../../test/shared/settings-io.test.ts) | I | 原子设置合并、锁与迁移 |
| [settings-secret-redaction.test.ts](../../../../../test/shared/settings-secret-redaction.test.ts) | I | 损坏文件错误脱敏 |

### todo

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [activity-presentation.test.ts](../../../../../test/todo/activity-presentation.test.ts) | C/I? | Task 工具活动与嵌套展示 |
| [format.test.ts](../../../../../test/todo/format.test.ts) | U | Task 行与布局格式化 |
| [replay.test.ts](../../../../../test/todo/replay.test.ts) | U | 快照重放、迁移与损坏 |
| [response-envelope.test.ts](../../../../../test/todo/response-envelope.test.ts) | U | Task 响应 envelope |
| [state-reducer.test.ts](../../../../../test/todo/state-reducer.test.ts) | U | Task 变更与状态不变量 |
| [store.test.ts](../../../../../test/todo/store.test.ts) | U | 内存 Task store 与淘汰 |
| [task-graph.test.ts](../../../../../test/todo/task-graph.test.ts) | U | Task 依赖与循环 |
| [todo-overlay.render.test.ts](../../../../../test/todo/todo-overlay.render.test.ts) | C | Overlay 渲染与 widget 生命周期 |
| [todo.integration.test.ts](../../../../../test/todo/todo.integration.test.ts) | C | 受控 Host 中的 Todo Extension |

### work

| 文件 | 层级 | 验证内容 |
| --- | --- | --- |
| [activity-presentation.test.ts](../../../../../test/work/activity-presentation.test.ts) | C/I? | Work 活动与工具展示连接 |
| [host.test.ts](../../../../../test/work/host.test.ts) | C | 受控 Host 渲染与替换 |
| [monitor.test.ts](../../../../../test/work/monitor.test.ts) | C/I? | Monitor 校验与条件结果 |
| [runtime-launch.test.ts](../../../../../test/work/runtime-launch.test.ts) | C/I | 进程启动、持久输出与退出 |
| [runtime-notifications.test.ts](../../../../../test/work/runtime-notifications.test.ts) | C/I | 进程结果与通知投递 |
| [runtime-reconciliation.test.ts](../../../../../test/work/runtime-reconciliation.test.ts) | I | 进程身份与进程组恢复 |
| [runtime-settlement.test.ts](../../../../../test/work/runtime-settlement.test.ts) | C/I | 输出结算、超时与清理 |
| [tasks-dialog.test.ts](../../../../../test/work/tasks-dialog.test.ts) | C | Tasks 对话框与键盘交互 |

## 额外执行与验收入口

B = Bun 文件调用；P = 打包验证调用；M = 手动入口。B + P 表示复用同一验收函数，
并不表示两个调用的场景、宽度和输入完全相同。名称为 `real` 不自动代表真实模型。

| 入口 | 层级 | 当前调用者 | 验证边界 |
| --- | --- | --- | --- |
| [verify-agents-execution-matrix](../../../../../scripts/verify-agents-execution-matrix.ts) | S | B + P | Agent 矩阵；真实 Pi 与 fixture Provider |
| [verify-agents-pty](../../../../../scripts/verify-agents-pty.ts) | S | B + P | Agent PTY 与冷恢复 |
| [verify-btw-pty](../../../../../scripts/verify-btw-pty.ts) | S | B + P | BTW 终端流程 |
| [verify-code-mode-real](../../../../../scripts/verify-code-mode-real.ts) | S | M: acceptance:code-mode:real | 真实 Pi/V8、fixture Provider、文件与 Skill 读取及恢复 |
| [verify-code-mode-tui](../../../../../scripts/verify-code-mode-tui.ts) | S | M: acceptance:code-mode:tui | 真实 Pi/V8 终端媒体与 fixture Provider |
| [verify-context-input-frame-pty](../../../../../scripts/verify-context-input-frame-pty.ts) | S | B: context-pty | 真实 Pi 与本地 Provider 协议 |
| [verify-context-pty](../../../../../scripts/verify-context-pty.ts) | S | B + P | Context 终端压缩与重试 fixture |
| [verify-goal-lifecycle](../../../../../scripts/verify-goal-lifecycle.ts) | S | P | 独立 Pi RPC Goal 生命周期、fixture Provider |
| [verify-goal-pty](../../../../../scripts/verify-goal-pty.ts) | S | B + P | Goal 终端对话框与设置 |
| [verify-magic-context-real](../../../../../scripts/verify-magic-context-real.ts) | S | M: acceptance:magic-context:real | 真实模型记忆、压缩、恢复与隔离 |
| [verify-mcp-pty](../../../../../scripts/verify-mcp-pty.ts) | S | P | 真实 Pi 终端与本地 MCP fixture |
| [verify-notification-pty](../../../../../scripts/verify-notification-pty.ts) | S | P | 真实 Pi 终端通知流程 |
| [verify-package](../../../../../scripts/verify-package.ts) | I/S | check; CI; M: pack:verify | 归档检查加打包验收；B 中另有辅助函数断言 |
| [verify-pi-host-provenance](../../../../../scripts/verify-pi-host-provenance.ts) | I | B; CI; callers | 产物身份辅助检查；不是产品流程 |
| [verify-pi-host-seams](../../../../../scripts/verify-pi-host-seams.ts) | S | P; helper-only B | 真实 Pi 协议边界；B 仅验证 JSONL 轮询辅助逻辑 |
| [verify-ponytail-pty](../../../../../scripts/verify-ponytail-pty.ts) | S | B | Ponytail 终端与 Provider prompt 边界 |
| [verify-rtk-pty](../../../../../scripts/verify-rtk-pty.ts) | S | P | 真实 Pi 与已安装 RTK 终端集成 |
| [verify-session-naming](../../../../../scripts/verify-session-naming.ts) | S | B: session-naming/host | 真实 Pi 命名与恢复、fixture Provider |
| [verify-tools-grouping-pty](../../../../../scripts/verify-tools-grouping-pty.ts) | S | B | 终端 retrieval 分组 |
| [verify-tools-pty](../../../../../scripts/verify-tools-pty.ts) | S | B + P | 工具终端渲染与响应 |
| [verify-tools-resume-pty](../../../../../scripts/verify-tools-resume-pty.ts) | S | B + P | 工具终端恢复 |
| [verify-ui-pty](../../../../../scripts/verify-ui-pty.ts) | S | B + P | UI 流程；Theme 还使用共享 Session 辅助逻辑 |
| [verify-web-integration](../../../../../scripts/verify-web-integration.ts) | C/I | P; M: direct script | 受控 Host；打包执行失败路径；直接运行开启公网搜索与获取 |
| [verify-work-monitor-matrix](../../../../../scripts/verify-work-monitor-matrix.ts) | S | B + P | Fixture Provider 的 Monitor 成功与失败 |
| [verify-work-pty](../../../../../scripts/verify-work-pty.ts) | S | B + P | Background Work 终端流程 |
| [smoke-pi](../../../../../scripts/smoke-pi.ts) | S | B + P | 真实 Pi RPC 与受控 Package、Provider fixture |
| [goal-runtime-smoke](../../../../../test/goal-upstream/goal-runtime-smoke.mjs) | I | test:goal | 真实 Pi SDK Session 与 faux Provider；不是独立 Pi 二进制验收 |

`goal-runtime-budget.mjs` 提供该 smoke 调用的预算场景；`goal-runtime-support.mjs` 提供 SDK harness。

## 两类 benchmark 与现有入口

采用内部性能和外部任务两类。现有三项自建模型实验混合正确性与任务效果，先说明后决定归属；
“归属待决”不是新增第三类。不得用目录位置决定它们的性质。

| 命令 | 归属 | 当前执行 | 内容与成本 |
| --- | --- | --- | --- |
| [benchmark:tool-activity](../../../../../scripts/benchmark-tool-activity.ts) | 内部 | check; CI | 合成分组、流式更新、格式化；无模型 |
| [benchmark:magic-context](../../../../../scripts/benchmark-magic-context.ts) | 内部 | M | Worker 与投影成本；无模型 |
| [benchmark:magic-context:compare](../../../../../scripts/compare-magic-context.ts) | 内部 | M | Magic Context 两版本比较；无模型 |
| [benchmark:lifecycle](../../../../../scripts/benchmark-lifecycle.ts) | 内部 | M | 真实 Pi/PTY 延迟，fixture Provider |
| [benchmark:effect-mainline](../../../../../scripts/benchmark-effect-mainline.ts) | 内部 | M | 导入 CPU、RSS 与可选生命周期；无付费模型 |
| [benchmark:conversation-markdown](../../../../../scripts/benchmark-conversation-markdown.ts) | 内部 | M | 合成输入的 TUI 渲染；无模型 |
| [benchmark:ponytail](../../../../../scripts/benchmark-ponytail.ts) | 归属待决 | M | 18 个真实模型 Session；自建任务 |
| [benchmark:skill-discovery](../../../../../scripts/benchmark-skill-discovery.ts) | 归属待决 | M | 90 个真实模型 Session；发现与任务结果 |
| [benchmark:code-mode-image](../../../../../scripts/benchmark-code-mode-image.ts) | 归属待决 | M | 40 个真实模型案例及可能的恢复调用；传输与识别 |

外部任务入口：FrontierHarness Eval 尚未接入；Terminal-Bench 的执行适配器已在 Git 历史中归档。
当前可以复用公开与仓库历史结果，无须为建立本概览重新评测。见
[FrontierHarness 调查](frontierharness-eval-fit-20260905.md)与
[Terminal-Bench 历史证据](../reports/ps-ps3-capability-contract-and-terminal-bench-observation-2026-08-30.md)。

## 静态门槛与执行设施

- [scripts/run-isolated-tests.ts](../../../../../scripts/run-isolated-tests.ts): Bun 测试发现与串行隔离.
- [scripts/test-goal-upstream.ts](../../../../../scripts/test-goal-upstream.ts): Goal 编译、Node 执行与 SDK smoke.
- [scripts/ci-acceptance-scope.ts](../../../../../scripts/ci-acceptance-scope.ts): 变更路径路由，不是行为验收.
- [scripts/check-repository-safety.ts](../../../../../scripts/check-repository-safety.ts): 仓库安全、源码边界与尺寸检查.
- [scripts/check-capability-contract-catalog.ts](../../../../../scripts/check-capability-contract-catalog.ts): 目录结构；不执行契约.
- [scripts/generate-suite.ts](../../../../../scripts/generate-suite.ts): 组装生成；--check 检测漂移.
- [scripts/check-readme-screenshots.ts](../../../../../scripts/check-readme-screenshots.ts): 文档截图检查，不在默认 package scripts 中.
- [scripts/review-ponytail-upstream.ts](../../../../../scripts/review-ponytail-upstream.ts): 上游资源审查命令.
- [scripts/pi-host-contract.ts](../../../../../scripts/pi-host-contract.ts): 共享 Host 声明与上游监视输入.
- [.github/workflows/ci.yml](../../../../../.github/workflows/ci.yml): Fast 与条件 Acceptance；命令不另算测试套件.
- [.github/workflows/pi-upstream-watch.yml](../../../../../.github/workflows/pi-upstream-watch.yml): 定期上游版本观察；不是兼容性验收.

`format:check`、`lint`、`typecheck`、`knip` 是静态质量门槛。它们自己的 fixture 测试已列入文件清单。
`pack:verify` 同时执行产物检查与动态验收，不能整体称为静态检查。Beads 发布不是测试入口。

## 条件执行与分类修正证据

- [test/code-mode/v8-real.test.ts](../../../../../test/code-mode/v8-real.test.ts): 要求 PI_STUFF_CODE_MODE_REAL=1。真实 V8 与 fixture 工具属于 I，不是真实模型 E2E；CI 未设置该开关。
- [test/rtk/real-rtk.test.ts](../../../../../test/rtk/real-rtk.test.ts): 预期 RTK 可执行文件不可用时跳过；列入清单不代表实际执行。
- [test/code-mode/process-start-identity.test.ts](../../../../../test/code-mode/process-start-identity.test.ts): Reader 与命令 runner 是注入的；看似 OS 路径不代表真实进程集成。
- [test/context/native-custom-turn-compaction-host-seam.test.ts](../../../../../test/context/native-custom-turn-compaction-host-seam.test.ts): 使用真实 SDK 的 createAgentSession 与 faux Provider：I。
- [test/agents/background-engine-fixtures.ts](../../../../../test/agents/background-engine-fixtures.ts): 后台测试以 fixture writer 替代 PI_SUBAGENT_PI_BINARY：真实进程 I。
- [test/agents/extension-root-fixtures.ts](../../../../../test/agents/extension-root-fixtures.ts): 以 createExtensionApi 与受控依赖注册 Agents，不是组装 Suite 的 S。
- [test/goal-upstream/goal.node.ts](../../../../../test/goal-upstream/goal.node.ts): 使用 createMockPi 与 createMockContext；注册不是实际 Host 的 S。
- [test/mcp/http-transport.test.ts](../../../../../test/mcp/http-transport.test.ts): Bun.serve 提供真实本地 HTTP 服务器；transport 属于 I。
- [scripts/verify-web-integration.ts](../../../../../scripts/verify-web-integration.ts): 打包调用不启用 publicNetwork，直接执行会启用；两者均使用受控 Host。

## 辅助文件完整清单

这些路径不是额外独立测试入口。`.sh` runner 和 `.mjs` 场景会被上面的执行入口调用；
JSON、JSONL 文件是输入或历史运行元数据。清单包含它们，以免误删被间接使用的文件。

- [test/agents/agent-effect-owner-fixture.ts](../../../../../test/agents/agent-effect-owner-fixture.ts)
- [test/agents/agent-execution-coordinator-fixtures.ts](../../../../../test/agents/agent-execution-coordinator-fixtures.ts)
- [test/agents/background-engine-fixtures.ts](../../../../../test/agents/background-engine-fixtures.ts)
- [test/agents/current-agents-fixtures.ts](../../../../../test/agents/current-agents-fixtures.ts)
- [test/agents/extension-root-fixtures.ts](../../../../../test/agents/extension-root-fixtures.ts)
- [test/agents/fixtures/context-usage-provider.ts](../../../../../test/agents/fixtures/context-usage-provider.ts)
- [test/agents/fixtures/process-controls-provider.ts](../../../../../test/agents/fixtures/process-controls-provider.ts)
- [test/agents/foreground-engine-fixtures.ts](../../../../../test/agents/foreground-engine-fixtures.ts)
- [test/agents/native-supervisor-channel-fixtures.ts](../../../../../test/agents/native-supervisor-channel-fixtures.ts)
- [test/agents/result-watcher-fixtures.ts](../../../../../test/agents/result-watcher-fixtures.ts)
- [test/agents/tool-presentation-fixtures.ts](../../../../../test/agents/tool-presentation-fixtures.ts)
- [test/code-mode/fixtures.ts](../../../../../test/code-mode/fixtures.ts)
- [test/context/core-fixtures.ts](../../../../../test/context/core-fixtures.ts)
- [test/fixtures/agents-execution-matrix-provider.ts](../../../../../test/fixtures/agents-execution-matrix-provider.ts)
- [test/fixtures/agents-pty-provider.ts](../../../../../test/fixtures/agents-pty-provider.ts)
- [test/fixtures/agents-pty-runner.sh](../../../../../test/fixtures/agents-pty-runner.sh)
- [test/fixtures/assert-codex-tools.ts](../../../../../test/fixtures/assert-codex-tools.ts)
- [test/fixtures/assert-goal-tools.ts](../../../../../test/fixtures/assert-goal-tools.ts)
- [test/fixtures/assert-mcp-tools.ts](../../../../../test/fixtures/assert-mcp-tools.ts)
- [test/fixtures/assert-todo-tools.ts](../../../../../test/fixtures/assert-todo-tools.ts)
- [test/fixtures/assert-web-tools.ts](../../../../../test/fixtures/assert-web-tools.ts)
- [test/fixtures/assert-work-tools.ts](../../../../../test/fixtures/assert-work-tools.ts)
- [test/fixtures/btw-pty-provider.ts](../../../../../test/fixtures/btw-pty-provider.ts)
- [test/fixtures/btw-pty-runner.sh](../../../../../test/fixtures/btw-pty-runner.sh)
- [test/fixtures/code-mode-image-benchmark-observer.ts](../../../../../test/fixtures/code-mode-image-benchmark-observer.ts)
- [test/fixtures/code-mode-provider.ts](../../../../../test/fixtures/code-mode-provider.ts)
- [test/fixtures/context-pty-provider.ts](../../../../../test/fixtures/context-pty-provider.ts)
- [test/fixtures/context-pty-runner.sh](../../../../../test/fixtures/context-pty-runner.sh)
- [test/fixtures/detached-process-parent.mjs](../../../../../test/fixtures/detached-process-parent.mjs)
- [test/fixtures/extension-api.ts](../../../../../test/fixtures/extension-api.ts)
- [test/fixtures/extension-context.ts](../../../../../test/fixtures/extension-context.ts)
- [test/fixtures/faux-provider.ts](../../../../../test/fixtures/faux-provider.ts)
- [test/fixtures/goal-lifecycle-provider.ts](../../../../../test/fixtures/goal-lifecycle-provider.ts)
- [test/fixtures/goal-pty-runner.sh](../../../../../test/fixtures/goal-pty-runner.sh)
- [test/fixtures/magic-context-real-audit.ts](../../../../../test/fixtures/magic-context-real-audit.ts)
- [test/fixtures/mcp-pty-provider.ts](../../../../../test/fixtures/mcp-pty-provider.ts)
- [test/fixtures/mcp-pty-runner.sh](../../../../../test/fixtures/mcp-pty-runner.sh)
- [test/fixtures/mcp/http-server.mjs](../../../../../test/fixtures/mcp/http-server.mjs)
- [test/fixtures/mcp/stdio-server.mjs](../../../../../test/fixtures/mcp/stdio-server.mjs)
- [test/fixtures/notification-pty-provider.ts](../../../../../test/fixtures/notification-pty-provider.ts)
- [test/fixtures/notification-pty-runner.sh](../../../../../test/fixtures/notification-pty-runner.sh)
- [test/fixtures/pi-host-seams-provider.ts](../../../../../test/fixtures/pi-host-seams-provider.ts)
- [test/fixtures/ponytail-benchmark-observer.ts](../../../../../test/fixtures/ponytail-benchmark-observer.ts)
- [test/fixtures/ponytail-pty-provider.ts](../../../../../test/fixtures/ponytail-pty-provider.ts)
- [test/fixtures/ponytail-pty-runner.sh](../../../../../test/fixtures/ponytail-pty-runner.sh)
- [test/fixtures/rtk-pty-provider.ts](../../../../../test/fixtures/rtk-pty-provider.ts)
- [test/fixtures/rtk-pty-runner.sh](../../../../../test/fixtures/rtk-pty-runner.sh)
- [test/fixtures/session-naming-provider.ts](../../../../../test/fixtures/session-naming-provider.ts)
- [test/fixtures/skill-discovery-benchmark-manifest.jsonl](../../../../../test/fixtures/skill-discovery-benchmark-manifest.jsonl)
- [test/fixtures/skill-discovery-benchmark-observer.ts](../../../../../test/fixtures/skill-discovery-benchmark-observer.ts)
- [test/fixtures/skill-discovery-benchmark-run-lock.json](../../../../../test/fixtures/skill-discovery-benchmark-run-lock.json)
- [test/fixtures/skill-discovery-confirmation-manifest.jsonl](../../../../../test/fixtures/skill-discovery-confirmation-manifest.jsonl)
- [test/fixtures/skill-discovery-confirmation-run-lock.json](../../../../../test/fixtures/skill-discovery-confirmation-run-lock.json)
- [test/fixtures/skill-discovery-direct-read-manifest.jsonl](../../../../../test/fixtures/skill-discovery-direct-read-manifest.jsonl)
- [test/fixtures/skill-discovery-direct-read-run-lock.json](../../../../../test/fixtures/skill-discovery-direct-read-run-lock.json)
- [test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl](../../../../../test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl)
- [test/fixtures/skill-discovery-isolated-confirmation-run-lock.json](../../../../../test/fixtures/skill-discovery-isolated-confirmation-run-lock.json)
- [test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl](../../../../../test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl)
- [test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json](../../../../../test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json)
- [test/fixtures/smoke-extension.ts](../../../../../test/fixtures/smoke-extension.ts)
- [test/fixtures/smoke-package/index.ts](../../../../../test/fixtures/smoke-package/index.ts)
- [test/fixtures/smoke-package/package.json](../../../../../test/fixtures/smoke-package/package.json)
- [test/fixtures/terminal.ts](../../../../../test/fixtures/terminal.ts)
- [test/fixtures/test-tui.ts](../../../../../test/fixtures/test-tui.ts)
- [test/fixtures/tool-registration-host.ts](../../../../../test/fixtures/tool-registration-host.ts)
- [test/fixtures/tools-active-parity-runner.sh](../../../../../test/fixtures/tools-active-parity-runner.sh)
- [test/fixtures/tools-grouping-pty-provider.ts](../../../../../test/fixtures/tools-grouping-pty-provider.ts)
- [test/fixtures/tools-grouping-pty-runner.sh](../../../../../test/fixtures/tools-grouping-pty-runner.sh)
- [test/fixtures/tools-pty-provider.ts](../../../../../test/fixtures/tools-pty-provider.ts)
- [test/fixtures/tools-pty-runner.sh](../../../../../test/fixtures/tools-pty-runner.sh)
- [test/fixtures/tools-resume-pty-provider.ts](../../../../../test/fixtures/tools-resume-pty-provider.ts)
- [test/fixtures/tools-resume-pty-runner.sh](../../../../../test/fixtures/tools-resume-pty-runner.sh)
- [test/fixtures/ui-pty-provider.ts](../../../../../test/fixtures/ui-pty-provider.ts)
- [test/fixtures/ui-pty-runner.sh](../../../../../test/fixtures/ui-pty-runner.sh)
- [test/fixtures/ui-pty-watchdog-owner.ts](../../../../../test/fixtures/ui-pty-watchdog-owner.ts)
- [test/fixtures/work-monitor-matrix-provider.ts](../../../../../test/fixtures/work-monitor-matrix-provider.ts)
- [test/fixtures/work-pty-provider.ts](../../../../../test/fixtures/work-pty-provider.ts)
- [test/fixtures/work-pty-runner.sh](../../../../../test/fixtures/work-pty-runner.sh)
- [test/fixtures/work-supervisor-parent.mjs](../../../../../test/fixtures/work-supervisor-parent.mjs)
- [test/goal-upstream/goal-queue-support.ts](../../../../../test/goal-upstream/goal-queue-support.ts)
- [test/goal-upstream/goal-run-support.ts](../../../../../test/goal-upstream/goal-run-support.ts)
- [test/goal-upstream/goal-runtime-budget.mjs](../../../../../test/goal-upstream/goal-runtime-budget.mjs)
- [test/goal-upstream/goal-runtime-support.mjs](../../../../../test/goal-upstream/goal-runtime-support.mjs)
- [test/goal-upstream/goal-test-support.ts](../../../../../test/goal-upstream/goal-test-support.ts)
- [test/goal-upstream/support.ts](../../../../../test/goal-upstream/support.ts)
- [test/goal-upstream/ui-node-shim.ts](../../../../../test/goal-upstream/ui-node-shim.ts)
- [test/tools/contract-fixtures.ts](../../../../../test/tools/contract-fixtures.ts)
- [test/ui/command-dialog-coordinator-fixtures.ts](../../../../../test/ui/command-dialog-coordinator-fixtures.ts)
- [test/ui/settings-lock-race-worker.ts](../../../../../test/ui/settings-lock-race-worker.ts)
- [test/ui/statusline-fixtures.ts](../../../../../test/ui/statusline-fixtures.ts)
- [test/work/runtime-fixtures.ts](../../../../../test/work/runtime-fixtures.ts)

## 下一步审查边界

先解决带 `?` 的文件，并定位混合文件中的具体用例；再针对同一行为建立保留、合并、替换或删除证据。
同时检查只断言源码字符串、固定 sleep、重复源码与打包流程，以及条件依赖被跳过的入口。
本清单不新增测试框架、自动分类器或另一套契约目录，也不改变现行检查。
