# 高下载量 Pi 子代理包：fork 比较

[English](../../../research/pi-subagent-fork-comparison.md)

## 范围与筛选

核心比较限于 **Pi 官方 package 目录中的五个高下载量包**。候选必须已被目录收录，在固定的 30 日时间窗内至少有 **10,000 次 npm 下载**，并通过 Pi package 提供可复用的子代理运行时，按下载量排序。替代 CLI 分发版、没有通用派发接口的角色/提示词包及固定用途命令不进入本次比较。该门槛是研究选样规则，不是 Pi 认证或质量评分。

目标是用 Pi Stuff 做日常开发：独立上下文调查、独立只读审查、后台委派、status/wait/steer/stop/result，以及显式使用已有任务 worktree 的 cwd。Pi 加载稳定安装，开发在任务 worktree 中进行。目标宿主是 Linux 上由 Bun 编译的 Pi 0.85.1；仓库使用 Bun 1.4.0 和 Effect 4.0.0-rc.112。本次研究不涉及旧版 Pi Stuff 实现。

目录快照读取于 **2026-09-10**。默认排序为 Most downloads；筛查了前 150 个条目，末位月下载为 7,568，已低于纳入门槛。先按包名和描述发现候选，再检查相关运行时源码。下表是这次有界筛查识别出的、下载量最高的五个合格实现。[Pi package 目录](https://pi.dev/packages)。

| 核心候选                                                                                       | Pi 目录月下载快照 |                                                                                          npm 固定 30 日下载 | 主要用途                                   |
| ---------------------------------------------------------------------------------------------- | ----------------: | ----------------------------------------------------------------------------------------------------------: | ------------------------------------------ |
| [pi-subagents](https://pi.dev/packages/pi-subagents)                                           |           412,438 |                         [400,498](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/pi-subagents) | 单代理委派、后台任务、多代理工作流         |
| [pi-background-tasks](https://pi.dev/packages/pi-background-tasks)                             |           107,663 |                   [94,385](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/pi-background-tasks) | 后台进程、只读委派、Fusion 工作流          |
| [@tintinweb/pi-subagents](https://pi.dev/packages/@tintinweb/pi-subagents)                     |            47,744 |           [47,744](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/%40tintinweb%2Fpi-subagents) | 进程内子代理、池、steer、TUI               |
| [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) |            39,555 | [39,555](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/%40quintinshaw%2Fpi-dynamic-workflows) | 脚本化子代理工作流、journal 与 replay      |
| [pi-fabric](https://pi.dev/packages/pi-fabric)                                                 |            22,184 |                             [22,184](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/pi-fabric) | 通用工具/代理运行时、独立 worker、常驻宿主 |

npm 比较时间窗为 **UTC 2026-08-11 至 2026-09-09，含首尾两日**。npm 将 `last-month` 定义为最近 30 个可用日，`last-week` 为最近 7 个可用日。下载请求数统计整个 npm 包，不是独立用户数，也不是其中子代理功能的调用次数。[npm 下载统计文档](https://github.com/npm/registry/blob/main/docs/download-counts.md)。

前两个包的目录值与 npm API 值不同，因此分别保留，不合并成同一快照。刷新时间或统计窗口不同可能解释差异，但原因尚未核实。本文用固定时间窗 npm 数据排序；五个包在两种快照下都超过门槛。

此前的小型候选不符合此门槛：`@ogulcancelik/pi-codex-subagents` 为 [625 次](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/%40ogulcancelik%2Fpi-codex-subagents)，`@everyx/pi-subagent` 为 [1,244 次](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/%40everyx%2Fpi-subagent)，`pi-subagents-j0k3r` 为 [8,888 次](https://api.npmjs.org/downloads/point/2026-08-11:2026-09-09/pi-subagents-j0k3r)，均移出 fork 候选。仅提供 Git 安装的实现与未单独发布为包的 Pi 官方示例，也不能据此证明目录下载资格。

对下载更高的相邻包也检查了用途。`@companion-ai/feynman` 是带自身 Pi 运行时的研究 CLI 分发版；`@akagilnc/pi-workflow-roles` 虽有内部 session，但对外是固定角色 CLI，Pi 扩展注册为空；`pi-simplify` 注册的是审查命令，没有通用子代理接口。它们的下载量不足以使其成为这里需要的可复用 Pi 扩展运行时。[Feynman 包清单](https://registry.npmjs.org/@companion-ai%2Ffeynman)、[workflow-roles 包清单](https://registry.npmjs.org/@akagilnc%2Fpi-workflow-roles)、[pi-simplify 源码](https://github.com/MattDevy/pi-extensions/blob/8fcf9b12b48e7852d19bfa97f20d88fd6977cbc1/packages/pi-simplify/src/index.ts)。

## 源码版本与实现规模

下载量统计时间窗内该包的所有版本。源码检查与行数只针对下列固定提交，不能据此推算某个提交被下载了多少次。

| 候选                              | 源码版本 / 许可 | 固定提交                                                                                                      | 发布物对应关系                                                |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| pi-subagents                      | 0.67.0 / MIT    | [aa75b33](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)           | 源码与 npm 版本一致                                           |
| pi-background-tasks               | 2.5.0 / ISC     | [14aa4ef](https://github.com/ismailsaleekh/pi-background-tasks/tree/14aa4ef382952f073bd4d540f57d6e8e3c2789a2) | 源码与 npm 版本一致；npm 无 gitHead，未证明构建产物逐字节一致 |
| @tintinweb/pi-subagents           | 0.19.0 / MIT    | [e955e29](https://github.com/tintinweb/pi-subagents/tree/e955e29c51b7a6cce37e1108cd2d6c57a77e151c)            | npm 0.19.0 的 gitHead 与研究源码不同                          |
| @quintinshaw/pi-dynamic-workflows | 3.10.1 / MIT    | [1c0f746](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/1c0f7462aa8a007afb8112f073887590a57ea82d)  | 与 npm 发布 gitHead 一致                                      |
| pi-fabric                         | 0.92.4 / MIT    | [469926c](https://github.com/monotykamary/pi-fabric/tree/469926c111bb7cfa419036e6ed86da753671ef53)            | 源码与 npm 版本一致；npm 无 gitHead，未证明构建产物逐字节一致 |

| 候选                              | 代码行 / 物理行 | 实现文件数 | 最大实现文件：代码行                                                                                                                                                    | 测试与支撑代码行 / 文件数 |
| --------------------------------- | --------------: | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------: |
| pi-subagents                      | 90,437 / 99,741 |        283 | [subagent-executor.ts](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/src/runs/foreground/subagent-executor.ts)：6,953        |             107,765 / 298 |
| pi-background-tasks               | 28,349 / 31,437 |         49 | [anthropic-attribution.ts](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/core/anthropic-attribution.ts)：2,851 |               27,749 / 69 |
| @tintinweb/pi-subagents           | 12,217 / 20,929 |         56 | [index.ts](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts)：2,555                                                 |              28,542 / 115 |
| @quintinshaw/pi-dynamic-workflows | 15,430 / 20,745 |         51 | [workflow-ui.ts](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/workflow-ui.ts)：1,968                           |               26,670 / 55 |
| pi-fabric                         | 86,790 / 96,063 |        351 | [manager.ts](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/actors/manager.ts)：2,011                                      |              68,040 / 250 |

代码行去除注释与空行，物理行保留两者。统计使用 cloc 2.00，范围为 Git 跟踪的 TypeScript/JavaScript 实现，包含类型与内嵌字符串。它们反映需要理解和维护的源码量，不等于圈复杂度或已经实测的 fork 工时。nicobailon 计入 `index.ts`、`src/` 和随包提供的四个根目录 `.mjs` 文件；background-tasks、dynamic-workflows 计入 `extensions/` 与 `src/`；tintinweb、fabric 计入 `src/`。

测试/支撑代码计入 `*.test.*`、`*.spec.*` 及 test/testing 目录。两组均排除 fixture、benchmark、开发脚本、示例、生成产物、依赖和 Markdown 资源。nicobailon 测试 fixture 中复制的 Pi 不计入规模。测试没有加入实现总量，测试量也不代表覆盖率或运行通过。

可复现的统计命令为 `cloc --config=/dev/null --quiet --json --by-file --skip-uniqueness --timeout=0 --list-file=<tracked-paths.txt>`，对两组文件分别执行，重复内容的不同文件分别计数。逐文件核对了代码、注释、空行总和与物理行数；此前四个大型测试需要关闭默认过滤超时后才能完成统计。测量过程没有执行候选代码。

## 生命周期比较

| 需求             | pi-subagents                        | pi-background-tasks                    | @tintinweb/pi-subagents                               | @quintinshaw/pi-dynamic-workflows                  | pi-fabric                                             |
| ---------------- | ----------------------------------- | -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| 执行边界         | 前台 SDK session；后台独立 runner   | 父宿主管理的 shell/Pi 子进程           | 宿主进程内 SDK session                                | 宿主进程内 SDK session                             | transport worker；可选独立常驻宿主                    |
| 父代理能继续工作 | 是，async 模式                      | 是                                     | 是，后台池                                            | 是，workflow 默认模式                              | 是，spawn/background API                              |
| 运行中追加指令   | 支持                                | 无通用 prompt 注入 API                 | 支持                                                  | 不支持；提供 pause/resume 与脚本内 thread 连续对话 | 支持，取决于 runner/service 路径                      |
| 停止与等待       | 控制与结果生命周期                  | kill 与终态通知；status/result 为快照  | UI/RPC 可 stop；模型工具提供 result/steer             | control 工具提供 pause/resume/stop，无 live steer  | 取消 wait 与停止 child 分开                           |
| 恢复边界         | 持久文件与独立 runner 状态核对      | 文件持久化；启动时不重新接管 live task | session/transcript 持久化；宿主退出会结束活跃 session | 新执行中回放 journal，不保留原 live SDK session    | worker 文件与常驻宿主；service resume 使用 checkpoint |
| 已有 cwd         | 支持；另有 worktree 功能            | 子进程使用宿主 cwd                     | 支持；可选新 worktree 从 HEAD 开始                    | 支持；可选 worktree 失败可退回共享 cwd             | 解析绝对 realpath 并检查目录                          |
| 只读边界         | 需要受限的 child tool/resource plan | inspect delegate 有实际工具/扩展 guard | 需配置工具；开放 shell 仍可写入                       | 需配置工具；禁止 child 编排工具                    | 工具 allowlist；guest code 隔离是另一个边界           |

矩阵中的事实在下文展开并提供源码链接。OS 进程分离、detached 标志、持久结果文件和独立宿主恢复是不同属性。提示词要求“只读”不能阻止写入；worktree 分离文件，也不会限制 shell 或网络权限。

### pi-subagents：下载量与目标宿主证据最充分

nicobailon 的包在候选中下载量最高。后台路径先由父宿主写入 runner 配置/状态，启动 detached runner 并完成启动握手，再返回控制。runner 写入状态、事件、transcript 和结果；watcher 与持久文件支持后续交付和状态核对。结果完成与观察到进程退出被分别记录。[后台启动](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/src/runs/background/async-execution.ts#L398-L448)、[runner 生命周期](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/src/runs/background/async-execution.ts#L540-L748)。

它已有 fresh/fork context、steering、控制消息及受限派生。对应研究提交的上游运行通过 unit/integration、Bun parity、Pi 0.85.0/0.85.1 smoke 和使用确定性 provider 的 Linux standalone 检查。这是本次与目标宿主最接近的运行证据，但不等于真实 provider 验收，也不是在维护者安装上运行的测试。[观察到的 CI](https://github.com/nicobailon/pi-subagents/actions/runs/34438313918)。

代价是 90,437 行实现代码和 283 个文件，覆盖 missions、scheduler、workflow、external jobs、intercom、worktree 与 TUI。6,953 行的前台 executor 也表明宽范围内仍有代码集中问题。fork 应先保留一套上游生命周期及其测试，再逐项论证缩减范围。reviewer/scout 的受限工具及明确的 base/head/diff 输入仍需宿主验收。

### pi-background-tasks：只读委派边界明确，控制接口不完整

该包提供普通后台 shell 任务、直接 child-Pi 委派及 Fusion 工作流。子进程使用当前宿主 cwd，输出流式写入任务文件。活跃 registry 仍在内存中：文件持久化不代表重启后会自动重新接管任务，扩展 shutdown/reload 也会结束活跃子进程。`bg_status`、`bg_logs` 是快照；终态通知推动后续处理，`bg_result` 读取 delegate/Fusion 答案，没有通用 live steering API。[cwd 与子进程启动](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/core/registry.ts#L780-L905)、[shutdown 契约](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/extension.ts#L54-L60)、[查询与 kill 工具](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/extension.ts#L832-L942)。

inspect delegate 有实际限制：允许 `read`、`grep`、`find`、`ls`、`delegate_read_artifact`，禁止 shell、edit/write 和递归委派。isolated 模式关闭环境扩展、skills、templates 和 context files；显式 ambient-extension 模式会削弱边界。child 有独立 session identity，同时接收冻结并计算哈希的上下文 seed，因此独立身份并不意味着不继承内容。[delegate 策略与启动参数](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/core/delegate/launch.ts#L201-L364)。

child 通过临时写入、fsync、rename 提交 `result.json`，parent 单独记录 outcome；退出码为 0 但未提交结果仍判失败。这样的成功语义比只相信进程退出更明确。[结果提交](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/core/delegate/artifacts.ts#L235-L277)、[终态判定](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/src/delegate-child-extension.ts#L524-L590)。

Pi peer 声明止于 0.84 系列，排除 0.85.1。固定源码对应的 CI **失败**：六个主要 OS/Node 作业均停在 `Type-safety standard`，后续测试和 pack 步骤跳过；两个独立 Windows integration 作业通过。详细诊断日志无法访问，因此尚不清楚具体哪条规则失败。[观察到的失败 CI](https://github.com/ismailsaleekh/pi-background-tasks/actions/runs/33832119776)。这些问题，再加上 steering 与 live task 恢复缺口，使它虽有较高下载量，仍排在首选 fork 候选之后。

### @tintinweb/pi-subagents：规模较小的进程内备选

每个 child 都是在父进程内运行的独立 Pi `AgentSession`。`AgentManager.spawn()` 返回 ID，区分前台/后台池，将超出后台容量的任务排队，并在清理后结束记录。session、transcript、tombstone 支持稍后续跑，但父进程故障会结束活跃 child session。[manager 生命周期](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L430-L705)。

支持 steering；停止通过 UI/RPC 暴露，没有直接的模型 stop 工具。可选 worktree 从 HEAD 开始，会遗漏父目录未提交的改动。审查应使用已有 checkout 或显式传入 patch。[worktree 源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/worktree.ts#L1-L117)。

12,217 行代码使它成为本次候选中规模最小的实现，固定月份仍有 47,744 次下载。它依然包含 workflow、mentions、schedule 和 FleetView。源码开发基线为 Pi 0.84.2，peer >=0.84.0，包含 0.85.1。观察到的 build/floor/latest 兼容作业成功，但 latest 兼容分支设置了 `continue-on-error`。[观察到的 CI](https://github.com/tintinweb/pi-subagents/actions/runs/33753714643)。

### @quintinshaw/pi-dynamic-workflows：可恢复的编排

`workflow` 工具接收脚本或命名 workflow，默认后台执行。manager 先持久化 run 与 lease，再返回 ID；child agent 是同一进程内的 SDK session。控制工具提供 list/status/pause/resume/stop，没有向已运行 child 追加新指令的 API；命名 thread 连续对话属于脚本内部操作。[后台工具](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/workflow-tool.ts#L187-L304)、[manager 启动](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/workflow-manager.ts#L563-L692)。

崩溃后，残留 running 记录会转为 paused。resume 创建新执行，回放未变化的 journal 前缀，再运行其余调用，不会重连丢失的 live session。默认每个 run 允许 1,000 个逻辑 agent、16 个并发 agent；未配置时 token budget 与硬 agent timeout 不设上限。runtime 会等待进行中的调用结束；runner 忽略 abort 且没有有限 timeout 时，可能无限等待。[残留任务核对](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/workflow-manager.ts#L495-L526)、[默认限制](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/config.ts#L1-L18)、[abort/drain 限制](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/workflow.ts#L1435-L1500)。

fresh loader 禁用环境扩展，但保留 skills/context files；工具计划禁止递归调用 `workflow` 和 `workflow_control`。可选 worktree 创建失败时可能退回共享 cwd；如果调用者依赖隔离，就需要明确处理这个回退。[资源加载器](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/agent.ts#L669-L703)、[worktree 回退](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/src/worktree.ts#L1-L75)。

如果产品目标是脚本化 fan-out 与 replay，它是可信的 fork 候选。15,430 行代码明显小于 nicobailon，但它是 workflow runtime，不能直接替代具有 live steer/wait/stop 的 child 控制接口。对应源码的 [CI](https://github.com/QuintinShaw/pi-dynamic-workflows/actions/runs/33803985812) 与 [发布运行](https://github.com/QuintinShaw/pi-dynamic-workflows/actions/runs/33804042174) 通过 Node 检查；目标 compiled Pi 宿主仍未验收。

### pi-fabric：带明确进程与所有权边界的大型运行时

Fabric 通过 transport adapter 启动 worker。`auto` 优先尝试 herdr、localterm、tmux、screen，最后退回 detached process。worker 状态与生命周期事件以文件作为通信边界。agent service 按 direct-child 关系授权操作，限制准入和深度，并区分取消 waiter 与停止 child。[transport 选择](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/agents/manager.ts#L1485-L1498)、[service API](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/agents/service.ts#L29-L116)、[授权与准入](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/agents/service.ts#L326-L395)。

可选 resident host 为持久任务提供独立 owner 及文件请求/响应队列。重启后会把进行中的请求标为 indeterminate，不假定成功。service `resume` 则从 checkpoint 恢复 paused/completed/failed child；两种恢复机制不能混为一谈。durable API 还拒绝完整 session seed 和若干 handoff 字段。[持久请求边界](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/residency/host.ts#L577-L703)、[checkpoint 恢复](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/agents/service.ts#L415-L444)。

launcher 显式处理了 Bun 编译 Pi 的 `process.execPath` 无法解释 worker 脚本的问题，会寻找真正的 Node/Bun 解释器或配置的 binary。这是相关的源码证据，实际宿主上的发现与扩展加载仍需验收。工具 allowlist 与 QuickJS guest code 隔离约束不同边界；编排脚本被隔离，不会让开放 shell 的 agent 自动只读。[脚本运行时解析](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/agents/transports/process-utils.ts#L58-L153)、[工具 allowlist](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/src/core/child-tool-allowlist.ts#L1-L13)。

代价是 86,790 行代码、351 个文件和 15 个直接运行依赖，覆盖 actor、mesh、guest code engine、MCP、memory 和工具所有权，超出首个委派功能的范围。固定源码的 [Test 运行](https://github.com/monotykamary/pi-fabric/actions/runs/34396888943) 成功，但不能据此证明目标机上每种 transport 和 resident host 故障模式都通过验收。

## 依赖与宿主兼容

| 包                                | 额外运行依赖                                                 | Pi 版本声明                         | 主要集成限制                                         |
| --------------------------------- | ------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------- |
| pi-subagents                      | acorn、jiti、yaml、undici、TypeBox、pi-server                | 源码/观察到的 smoke 包含 0.85.1     | 大型 runtime；需保留 standalone bootstrap 与文件契约 |
| pi-background-tasks               | turndown 7.2.4                                               | 0.81–0.84 各 peer 分支              | 排除 0.85.1；观察到的 CI 失败                        |
| @tintinweb/pi-subagents           | @sinclair/typebox、croner、nanoid、typebox                   | peer >=0.84.0；dev 0.84.2           | 进程内生命周期；npm/source gitHead 不同              |
| @quintinshaw/pi-dynamic-workflows | acorn                                                        | coding-agent >=0.80.8，TUI >=0.80.6 | SDK 耦合、abort/replay 语义及可选 worktree 回退      |
| pi-fabric                         | 15 个，含 Pi AI、mcporter、QuickJS、Monty、TypeScript、Shiki | peer >=0.80.6；Pi AI/dev 0.85.1     | 声明 Node >=24，另需解释器发现                       |

包清单证据：[pi-subagents](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/package.json)、[pi-background-tasks](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/package.json)、[@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/package.json)、[@quintinshaw/pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows/blob/1c0f7462aa8a007afb8112f073887590a57ea82d/package.json)、[pi-fabric](https://github.com/monotykamary/pi-fabric/blob/469926c111bb7cfa419036e6ed86da753671ef53/package.json)。依赖数不包含 devDependencies 和 peers。四个候选使用 MIT，background-tasks 使用 ISC，并为导入的 attribution 规则保留单独的 MIT third-party notice。fork 应保留相应声明。[Background-tasks 第三方声明](https://github.com/ismailsaleekh/pi-background-tasks/blob/14aa4ef382952f073bd4d540f57d6e8e3c2789a2/THIRD_PARTY_NOTICES.md#L1-L30)。

没有入选 runtime 已经是可直接接入的 Effect 原生实现。仓库既定的 Effect 4 选择继续适用；工作是保留选中上游的行为，并用严格类型和解码适配实际消费的边界。仅因为包热门而引入整套额外编排或代码执行框架，会扩大首个功能范围。

## Fork 建议与验收

**在高下载量要求下，优先以 nicobailon 的 pi-subagents 作为 fork 验证基线；如果进程内 child 生命周期已经足够，则保留 tintinweb 作为规模更小的备选。** nicobailon 同时具备本次最强的下载量信号、最接近目标的 Pi 0.85.1 standalone 运行证据，以及最完整的 detached 恢复路径。tintinweb 在有较高下载量的同时明显更小，代价是不同的进程生命周期契约，以及缺少直接的模型 stop 工具。

另外三个包各有明确研究用途：background-tasks 的 inspect-only delegate 与结果提交契约；dynamic-workflows 的受限脚本编排和 journal replay；fabric 的 participant 所有权以及解释器/常驻宿主边界。这些有效机制不足以支持把三套运行时组合成首个 Pi Stuff 功能。

采纳 fork 前，应在已有 worktree 中验收一个完整开发流程：启动 fresh scout/reviewer，让父代理继续工作，观察状态、收集有界结果，在支持时追加指令并停止 child。审查需明确 base/head/diff；工具注册应实际排除写入与递归委派；还需覆盖完成过程中的取消，以及 parent reload/exit。先明确恢复是否必须保留 live work，还是只需从保存结果/checkpoint 续跑，再在 Linux Bun 编译的 Pi 0.85.1 上验证这个契约。包下载量、源码检查和上游 CI 是不同证据，均不能替代宿主验收。

## 证据状态

本文使用官方目录、registry、下载端点、固定源码文件及观察到的上游 CI。源码计数与文档检查在本机完成。没有安装或执行候选依赖、扩展、测试、worker 或真实 provider 调用。下载快照会变化，发布物与源码的对应限制已列出，尚未采纳任何生产 fork。
