# Pi subagent fork 选择

[English](../../../research/pi-subagent-fork-decision.md)

## 推荐结论

**推荐 fork `@maxedapps/pi-subagents@0.1.2`，固定到 `maxedapps/pi-subagents` 的提交 `0dc176585f4f6c01a86e244d8c8d0db17a89d7cf`。** 它最接近 Pi Stuff 所需的小型起点：四个模型工具覆盖异步启动、列表／状态／等待、运行中改方向、完成后继续和明确停止。生产范围为 **7 个 TypeScript 文件、1,924 行代码**；包含注释和空行是 2,147 行。它自带小型终端界面，也会向主代理返回当前输出与可读取的日志路径。[^max-tools][^max-runtime]

这是针对“fork 后维护并补强”的推荐。上游较新，完整 30 天窗口内只有 **77 次 npm 下载**，[^max-downloads]不能据此声称拥有大型候选的成熟度。选择它，是用较少的上游使用历史，换取小而直接有用的控制接口。现有生命周期和输出边界需要修复后才能依赖；下文的验收属于计划中的 fork 工作，不是该包已经通过的证据。

本结论替代[早期按下载量筛选的比较](pi-subagent-fork-comparison.md)和[四包比较](pi-selected-subagent-comparison.md)中的较窄推荐。旧报告保留为对应时点的研究。本轮扩大了候选范围，并区分模型工具、内部服务和人类界面。

## 范围与比较方法

快照日期为 **2026-09-12，Asia/Shanghai**。发现渠道包括 Pi 包目录、npm 元数据和发布源码、仓库搜索、此前指定对象及其 fork 谱系。[候选目录](pi-subagent-candidate-catalog.md)记录 **104 个唯一候选名称**：85 个目录可见条目，加 19 个补充对象。目录页头显示 87，翻页去重后得到 85；报告保留这个差异，没有虚构缺少的两项。这是可复查的发现范围，不代表穷尽所有公开或私有实现。[^catalog]

104 项都有处置记录，但审查深度不同。可能直接替换的小型实现和重要既有对象，检查了控制调用路径并统计源码；附加组件、大型套件和外部后端封装做较窄的筛查。另以 Pi 官方 subagent 示例为基线。本轮没有安装或执行候选包，没有运行候选测试，也没有调用模型服务。

必要行为是：原生 Pi 子代理能在现有 cwd 中独立工作，运行中可控制，同一父会话内能对已完成任务继续追加工作，并让主模型和人看到有用进展。进程内 Pi SDK session 与独立 Pi RPC 子进程都符合要求。跨父 Pi 重启存活、自动 Git/worktree、调度、工作流 DSL 和多后端路由不作为选型要求。

下载量统一使用采集时最后一个完整 UTC 30 天窗口：**2026-08-12 至 2026-09-10**。这是下载次数，不是用户数或成功部署数；本轮不设下载门槛。发布版本与所读 Git head 分别注明，不把较新的 Git 代码默认为已经发布到 npm。

LOC 指 TypeScript/JavaScript 的生产**代码行**，排除注释、空行、测试、fixture、锁文件、文档、生成声明／产物以及捆绑的第三方代码。能够确定小型 fork 范围时，计入必需的第一方代码：Everyx 是本体 3,175 行加必需 `pi-ui` 的 944 行；Davis 包含共享 timeout helper。整个套件的数量单独注明，不能当成其中一个工具的独立成本。未计入的外部依赖仍然是成本，不等于零。代码量衡量维护范围，不衡量功能质量。

Maxedapps 的 1,924 行和 Zichuanlan 的 4,409 行均用逐文件 `cloc --timeout 0` 复核。默认 cloc 超时曾把 Zichuanlan 入口文件错误归入注释，得到 3,137 行；本报告纠正为 4,409 行。下载量较高的大型候选也检查了这一统计问题。统计源码不会执行候选代码。

## 推荐对象实际上能做什么

以开发任务为例：主代理给出当前 worktree 路径和一个具体任务，`subagent_start` 启动 Pi RPC 子进程并立即返回 ID。主代理继续自己的工作，需要时用 `subagent_status` 查看或等待。子代理方向偏了，就用 `subagent_send` 改变当前任务的方向；成功完成后，同一个工具可以在仍然打开的子代理里开始下一轮。最后通过 `subagent_stop` 关闭它。[^max-tools][^max-runtime]

| 开发需要         | 已有实现                                                                                                    | 实际限制                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 后台启动         | `subagent_start` 默认异步，也可 `wait:true`                                                                 | 当前 runtime 没有准入／并发上限                           |
| 列表、查看与等待 | `subagent_status`；指定 ID、等待全部结束、等待超时                                                          | 内部使用轮询；取消等待目前会影响指定 ID 之外的任务        |
| 改变运行方向     | `subagent_send`，指定 `behavior: "steer"` 或 `"follow-up"`                                                  | 依赖 Pi RPC 消息语义，不等于随意打断正在执行的 shell 命令 |
| 完成后继续       | 向 `idle` run 发送新 prompt，`generation` 加一                                                              | 要求子进程仍打开；`stop` 会移除该任务                     |
| 停止             | `subagent_stop` 指定 ID，另有父会话生命周期钩子                                                             | 进程树清理和输出读取顺序仍需补强                          |
| 主模型可见性     | JSON 中含 `state`、`generation`、`output`、`partial`、`reason`、`transcriptPath`、`needsStop`、`nextAction` | transcript 是可读活动日志，不是完整 Pi session            |
| 人类可见性       | 编辑区下方 widget 与 `/subagents` 日志 overlay                                                              | Herdr tail pane 只是额外界面；执行不要求 Herdr            |
| 已有 worktree    | 必填 `cwd` 传入子进程；Git 由主代理管理                                                                     | 不创建、提交、rebase 或 merge worktree                    |

日志记录时间、工具开始／结束／错误摘要、steer 和任务结束信息，以及有长度限制的最终答复片段。它并不完整保存工具结果或每个文本增量。状态快照另外提供当前 assistant 文本。这个范围已经能支持基本过程检查，但不能宣传成完整对话记录。[^max-rpc][^max-ui]

子进程使用 `--mode rpc --no-session --no-context-files --system-prompt ...`。上下文保存在仍然打开的子进程里，能够跨任务轮次延续，但不跨父会话重启。普通 extensions、tools、skills 可以加载；profile 中写“只读”不构成强制工具边界。Pi Stuff 仍需明确资源和工具策略，包括项目指令如何进入子代理。[^max-rpc][^max-profiles]

选中包的 1,924 行分布如下。任务／协议核心为 1,115 行，其余用于模型接口、profile 和可见控制。

| 文件                            | 代码行 | 职责                       |
| ------------------------------- | -----: | -------------------------- |
| `src/runtime.ts`                |    583 | 任务状态、轮次、等待和清理 |
| `src/rpc-child.ts`              |    532 | Pi 子进程与 JSONL 协议     |
| `src/ui.ts`                     |    224 | Widget 与日志 overlay      |
| `extensions/subagents/index.ts` |    187 | Pi 注册与生命周期钩子      |
| `src/herdr.ts`                  |    160 | 可选终端查看集成           |
| `src/tools.ts`                  |    136 | 四个模型工具的 schema      |
| `src/profiles.ts`               |    102 | 代理 profile 发现与加载    |

## 最接近的替代方案

| 对象                            | 主要优势                                                                      | 本轮仍选择 Maxedapps 的原因                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Zjie-Wang，1,711 行             | 很小的原生 SDK manager，控制齐全，有强制工具白名单                            | 运行中 status 文本很窄，较丰富的工具／消息放在 UI `details`；缺完整日志／查看器；启动与关闭存在待修复竞态 |
| Zichuanlan lite，4,409 行       | FleetView、实时对话界面、模型 `verbose` 对话查询；删除上游 worktree／调度系统 | 缺模型 stop；wait 忽略 signal；十分钟清理会 dispose 可续跑 session；resume 需要运行状态检查               |
| pi-claude-subagents，3,678 行   | 四类模型操作齐全，已完成任务可持久化续跑，有预算和诊断                        | 包含更多监督、嵌套、fork 策略和可选 worktree 机制；专用实时查看界面较少                                   |
| Everyx 含 pi-ui，4,119 行       | RPC 流限额与进程组清理较好，持久子进程可继续收消息                            | 缺独立模型 status/wait/result 工具；额外 UI 包和准入策略需要适配                                          |
| Ogul，2,703 行                  | spawn/wait/send/interrupt API 清楚，原生 RPC                                  | `read_agent_response` 只返回最终文本；实时详情主要在交互 socket UI；buffer／清理仍需修复                  |
| j0k3r，7,560 行                 | 原生 SDK 控制、SQLite attempts/events/history 较完整，测试较多                | 持久化和任务历史机制超过当前需要，可参考可靠性设计                                                        |
| Ferris，8,330 行                | RPC readiness、重试、超时、进程组清理、保留限额                               | 运行保障较强，需维护的实现范围也明显更大                                                                  |
| claude-style-subagent，3,204 行 | 模型控制、transcript、live dock 丰富                                          | 未确认宽松许可证；修改 Pi prototype 与私有成员，升级耦合更强                                              |

这些是围绕当前范围的工程判断。相比 Zjie，Maxedapps 已有模型可见的状态／日志接口；相比 Zichuanlan，公开控制与 runtime 范围更小。它并没有在每个可靠性或界面指标上都胜出。[^zjie][^zichuan][^pi-claude][^everyx][^ogul][^claude-style]

新增 Narumitw 包有运行中消息和查看能力，但任务进入终态后会撤销子代理控制，不能直接延续已完成子任务。Yishan 的完成后发送主要是人类命令。无 scope 的 `pi-subagents-lite` 在内部／UI 有 continuation，不能等同于完整模型 follow-up API。Danchamorro 则组合了多种终端／后端流程。它们各自的处置与源码身份保存在候选目录。

## 比较对象的源码规模

下表包含 36 个有统计范围的候选及官方示例。其余筛查项列在候选目录，不把粗略 tarball 行数混入可比较的生产 LOC。`Git` 表示所读仓库快照；即使 npm 版本不同，源码结论也以链接的提交为准。

| 对象与源码范围                                                                                                                                                      | 生产代码行 | 文件数 | 与本次目标的关系                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: | -----: | ------------------------------------------------- |
| [Maxedapps 0.1.2](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/runtime.ts)                                           |      1,924 |      7 | 四个模型工具；小型 RPC runtime 与 UI              |
| [Zjie-Wang 0.1.2](https://github.com/ZJie-Wang/pi-extensions/blob/0cc6b349c3e31636f80ceed2f74feb1de8f0fcfa/extensions/subagents/manager.ts)                         |      1,711 |      7 | 控制齐全；模型查看过程和日志需要补强              |
| [Zichuanlan lite 0.2.0](https://github.com/ZiChuanLan/pi-subagents-lite/blob/360d7cfbc0ba583898295bcb17b44fba43908719/src/index.ts)                                 |      4,409 |     21 | 查看器较完整；缺模型 stop，等待和保留逻辑需修复   |
| [pi-claude-subagents 0.3.7](https://github.com/FFatTiger/pi-claude-subagents/tree/f4287a2e196be4819789b8e79d0dec1b150aee38)                                         |      3,678 |      8 | 原生 Pi SDK；含监督、嵌套与可选 worktree          |
| [Everyx 1.3.6 + pi-ui](https://github.com/everyx/pi-extensions/tree/2fd03fdab465e8180a2a9736f1a9c9f18e2c4adb/packages)                                              |      4,119 |     26 | 3,175 runtime + 944 必需 UI；缺模型 inspect/wait  |
| [Ogul 0.3.5](https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents)                               |      2,703 |      3 | RPC；实时详情主要在交互 UI                        |
| [pi-agents-pool 0.2.0](https://github.com/minghinmatthewlam/pi-subagents/tree/c52ab42784e61a3e564f355fdce3fc08cc37939b)                                             |      1,047 |      3 | 小型 RPC pool；模型读取主要是最新答复             |
| [pi-subagents-j0k3r 1.5.15](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/tree/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73)                                      |      7,560 |     59 | SDK 控制与 SQLite 历史较完整；持久化范围更大      |
| [Gotgenes 21.7.0](https://www.npmjs.com/package/@gotgenes/pi-subagents/v/21.7.0)                                                                                    |      6,463 |     68 | 发布源码；缺模型 stop；续跑取消有独立信号限制     |
| [Ferris 4.3.18](https://github.com/MCapricorns/pi-subagents/tree/205daadd0193b3f3bf5fcc269311a7523795ce22)                                                          |      8,330 |     32 | RPC 限额、重试、清理较完整；隔离机制更广          |
| [pi-submarine 0.3.0](https://github.com/dnouri/pi-submarine/tree/97d8715ebce695a618d1775d6d3d4b9072396c77)                                                          |      2,430 |     12 | 前台 SDK 与 resume；缺独立运行中任务控制          |
| [Henry 15.1.4](https://github.com/HenryQW/pi-harness/tree/d7977aa2788fab09f15da5bd29be7d9e48f4e005)                                                                 |      4,049 |     13 | 包内范围；含 flow/Git 自动化及第一方依赖          |
| [Arhen 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1)                                                                |      3,167 |     11 | 仅续跑失败/中止任务；可写任务管理 Git 生命周期    |
| [Davis Git](https://github.com/davis7dotsh/my-pi-setup/tree/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents)                                          |      4,390 |     15 | 含必需 timeout helper；多后端，steer 主要在 UI    |
| [mjakl Git 3.0.3](https://github.com/mjakl/pi-subagent/tree/8e1b40b51440804246e312ef2a27a6399ded3186)                                                               |      3,463 |     11 | 目录另记 npm 3.0.1；前台 RPC session              |
| [Aefree 0.8.1](https://github.com/aefreedman/pi-subagents/tree/dab12e3f13c47d054dd41b6a91c6f315c1215fe2)                                                            |      2,652 |     11 | 前台 chain/parallel；没有完整后台控制器           |
| [pi-sub-agent 0.1.5](https://github.com/HamdiMaz/pi-sub-agent/tree/f1c0ae29f4cf370255530d3d126ec71b0d7a6194)                                                        |      1,593 |      2 | 前台 JSON 子进程封装                              |
| [pi-open-agents 0.1.22](https://github.com/andrea-tomassi/pi-open-agents/tree/9273b556726a5b86cce9159891094f8c4b3ecc8b)                                             |      2,919 |     22 | 前台 Pi/OpenCode 兼容范围                         |
| [pi-herdr-agents 1.7.0](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)                                               |     10,339 |     19 | 依赖外部终端管理器及 worktree                     |
| [goofansu Git](https://github.com/goofansu/pi-subagent/tree/c60b654c9f6f53181181695749f533b34b52a29c)                                                               |     24,118 |    137 | Effect 参考；Pi/Claude 和生命周期范围更广         |
| [pi-subagentura 3.6.2](https://github.com/lmn451/pi-subagentura/tree/b36367eb71e3e66d5f4f2a1ebef05fd03b026aa1)                                                      |     32,664 |     56 | 交互终端、工作流、遥测和状态管理                  |
| [pi-agent-suite 2.10.1](https://github.com/n-r-w/pi-agent-suite/tree/741c2a6b407c97a26e2e27b79fc7e5264c112723)                                                      |     47,254 |    196 | 整个发布 pi-package；不能当成独立 subagent 成本   |
| [fitchmultz Git 0.37.2](https://github.com/fitchmultz/pi-subagents/tree/c3d36cf1f858d5bee57a8240ac40c9208aa3f4d6)                                                   |     33,521 |    115 | 要求修改版 Pi；独立后台 runtime 较大              |
| [Router-for-me lite 1.5.4](https://registry.npmjs.org/@router-for-me%2Fpi-subagents-lite/1.5.4)                                                                     |      7,660 |     47 | 发布源码；UI、模型和 worktree 范围更广            |
| [nested-subagents 0.1.0](https://github.com/kmmuntasir/pi-nested-subagents/tree/50922638163fd21edefd82063f88ffa8d55328f4)                                           |      5,419 |     30 | 增加嵌套、调度、验证、记忆和 worktree             |
| [xz-pi-subagents 0.1.7](https://github.com/Xuzan9396/xz-pi/tree/4b75f772b7cecf9bb0e865a0c46226e09d4cc146/xz-pi-subagents)                                           |        998 |      9 | 固定同步批次；无 steer/resume                     |
| [nano-team 1.0.1](https://github.com/daynin/nano-team/tree/b5c72b3077a33a75e4893213654775af41ea5f35)                                                                |        981 |      7 | 角色列表与 spawn/kill/status；无完成后续跑        |
| [pi-subagents-team 0.3.0](https://registry.npmjs.org/pi-subagents-team/0.3.0)                                                                                       |      2,137 |      3 | 附加组件，要求另一个 subagent runtime             |
| [nicobailon pi-subagents 0.67.0](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)                                          |     90,437 |    283 | 含 runs、watchdog、workflow、mission 与查看平台   |
| [tintinweb Git / npm 0.19.0](https://github.com/tintinweb/pi-subagents/tree/e955e29c51b7a6cce37e1108cd2d6c57a77e151c)                                               |     12,217 |     56 | 当前 Git；缺模型 stop，代理与 UI 策略较广         |
| [pi-background-tasks 2.5.0 / Git](https://github.com/ismailsaleekh/pi-background-tasks/tree/14aa4ef382952f073bd4d540f57d6e8e3c2789a2)                               |     28,349 |     49 | 检查型委派及通用后台任务系统                      |
| [dynamic-workflows 3.10.1 / Git](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/b6f2c631368b627e75ee68518402541c3b83265e)                                 |     15,467 |     51 | 当前 Git；工作流重放，缺交互式子代理 steer        |
| [pi-fabric 0.92.4 / Git](https://github.com/monotykamary/pi-fabric/tree/95c8a89faf9994a109167c9807f25c348dd99bcf)                                                   |     86,803 |    351 | 当前 Git；分布式 worker/MCP 平台                  |
| [Tian Zuo 0.1.2](https://registry.npmjs.org/@tian.zuo%2Fpi-subagents/0.1.2)                                                                                         |      4,527 |     32 | 发布源码；RPC 偏结果报告，实时控制较弱            |
| [claude-style-subagent 0.1.5](https://github.com/nishuzumi/claude-style-subagent/tree/981ec288a29dfcc0e3a0f4dd2afe4a2aba73834d)                                     |      3,204 |      — | 许可证未明确；修改 Pi prototype/private internals |
| [Nilskluewer 0.8.0](https://www.npmjs.com/package/@nilskluewer/pi-subagent/v/0.8.0)                                                                                 |      3,835 |      — | 可恢复 RPC；模型 status/stop 不够直接             |
| [Official Pi 0.85.1 example](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent) |      1,027 |      2 | 额外基线；前台 single/parallel/chain              |

nicobailon 的 90,437 行并不只是实现 spawn/wait：所读版本中，runs 有 48,654 行，UI／inspection／slash 有 11,339 行，agents/profiles 有 7,180 行，workflow 有 4,280 行，watchdog 有 4,315 行，mission 有 1,887 行，其余为其他基础设施。这些代码提供更广的运行平台；以它为起点，Pi Stuff 也要承担保留、理解或删除这些机制的工作。[^nico]

## 为什么固定 0.1.2，而不是当前 Git HEAD

当前上游 HEAD [`646e766b5dbc8be7b6662b3c6b05f5162cfc4a54`](https://github.com/maxedapps/pi-subagents/tree/646e766b5dbc8be7b6662b3c6b05f5162cfc4a54) 的源码版本为 **0.2.0**，本轮也已检查。其生产代码为 **8 个文件、2,681 行**，测试为 **5 个文件、1,302 行**；0.1.2 对应为生产 1,924 行／7 文件、测试 800 行／4 文件。这个 Git 快照与目录记录的 npm 0.1.2 发布物分开评价。

新增内容包括一个 736 物理行的 Pi Office 共存模块、为该集成服务的 open-run registry、截止前催收摘要的 prompt，以及异常结束后自动再运行一次的恢复摘要。[runtime 差异](https://github.com/maxedapps/pi-subagents/compare/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf...646e766b5dbc8be7b6662b3c6b05f5162cfc4a54)把原失败状态与恢复结果分开保留，有实际价值，但也增加了模型运行策略和扩展之间的协调。

**仍以 0.1.2 作为 fork 基线。** 新源码仍有全局 wait-abort stop 路径，也没有解决本报告识别的 JSONL 增长、进程树终止和完整的启动／关闭准入问题。open-run registry 不能替代这些修复；Pi Stuff 当前也不需要 Pi Office 共存或自动恢复轮次。后续的 abort 原因分类修复值得连同测试做定点移植，不必为采用更新版本而引入整套新增策略。这是在检查新源码后的范围取舍，并非假定 npm 已是最新代码。

## Fork 范围与必要修改

保留四个工具、run 与 generation 的区分、cwd 输入、当前输出快照、小型 widget／overlay，以及 `tools.ts`、`runtime.ts`、`rpc-child.ts` 的分工。保留上游 MIT 声明和测试。第一版支持路径可以不包含可选 Herdr 查看方式，无需发展成通用工作流引擎。

采用前需要处理三组具体工作：

1. **输出与准入上限。** 公开快照有文本上限，内存日志保留 2,000 行，但输入 JSONL buffer、assistant 累积流和磁盘日志仍可能无界增长。需要统一字节／行／文件限额，并设定活跃子代理上限。达到限额时，是截断观察数据、拒绝新任务还是停止执行，必须明确，不能静默报告成功。
2. **取消与关闭。** `waitForRuns(ids)` 在 abort 时调用全局 `stopActive`，与工具描述中的指定 ID 范围冲突。停止应作用于明确的目标；还要处理启动未完成时的 stop/shutdown、拒绝关闭开始后的新任务、串行管理 generation 转换、读取完 stdout 后再判定最终退出状态，并在确认进程树终止后报告清理完成。只对直接 child 调用 `kill`，不代表其 shell 后代已经退出。这些是静态源码发现，不是已复现故障。
3. **接入 Pi Stuff 边界。** 按现有 Effect v4 约定处理边界解码、错误和必要 I/O；明确 tools/skills/项目指令，同时保持正常的现有 cwd 用法。如果希望完成时主动唤醒主代理，需要增加通知；上游目前要求明确 status/wait。Bun 编译版宿主如需启动适配，优先复用 Pi 已有的 executable 解析，先验证真实启动路径，再决定修改。[^max-runtime][^max-rpc][^pi-launch]

现有 UI 已提供基本过程可见性。完整 Pi session 记录、父会话重启后的重放、自定义 transcript explorer、自动 Git、多后端都是可选扩展，不是第一版可用 fork 的前提。可读日志仍需明确保留策略，因为上游正常关闭父会话时会删除自己创建的临时日志目录。

## 成熟度、兼容性与验收

选中发布包的 MIT 许可和无额外 runtime dependencies 已确认。Pi/TypeBox 属于宿主 peer dependencies，所以“无 runtime 依赖”不代表独立可执行。README 声明 Node 22.19+、Pi 0.81.1+，peer 使用通配范围；这些声明和其他环境的成功导入，都不能证明它可在 Pi Stuff 的 **Bun 编译版 Pi 0.85.1 / Bun 1.4.0** 上运行。[^max-metadata]

上游测试／CI 与本地运行分开评价。Zjie 的固定 Git 源码包含测试和 smoke 脚本，虽然 npm tarball 没有打包它们；对应提交的 [CI run](https://github.com/ZJie-Wang/pi-extensions/actions/runs/32721992314) 成功。Nico 的发布提交有成功的 [CI run](https://github.com/nicobailon/pi-subagents/actions/runs/34438313918)，包括 Pi 0.85.0/0.85.1 和 Bun standalone 场景。这些项目在已检查环境上具有更强的兼容性证据，但仍不等于本机验收。

npm 0.1.2 的七个生产文件与固定 Git 源码逐字节一致，SHA-256 相同。仓库包含 **4 个测试文件、800 代码行／889 物理行**，覆盖 schema/profile、RPC 分类和任务结束、等待／超时、idle 后追加任务及 UI/viewer。这些测试只做静态阅读，没有运行。选中提交只有四次历史提交，当前 HEAD 为六次，都不构成长时间运行经验。[固定版本测试](https://github.com/maxedapps/pi-subagents/tree/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/tests)。

本轮未建立 Maxedapps 对应提交成功 CI 的证据。选择它是因为源码范围小；使用量和宿主验证是弱项。首次实现验收至少覆盖：

- 现有 worktree 中的 fresh/background 启动，模型和资源正确，不产生额外 Git 操作。
- 主模型能看到实时输出／活动、可读取日志、收取结果，并向同一子代理继续追加任务。
- 区分等待超时与停止，取消仅影响选中 ID，其他并行任务继续工作。
- 启动未完成、工具执行中、控制请求排队期间和成功完成之后的 stop/shutdown。
- 超大／碎片化 UTF-8 JSONL 与输出、provider 错误、意外进程退出，以及需要清理的 shell 后代。
- 清理后的状态准确、stdout 读完后的最终输出、有限的资源保留，以及选定的完成通知行为。

这些是计划中的验收，不是本轮已经运行的测试。最终选择是**一个 fork 起点及明确的修复责任**；实际宿主验证属于另行授权的实现任务。

## 来源

候选目录链接完整发现集合。以下固定源码支持选型及其限制。

[^max-tools]: [Maxedapps, model tool schemas and results](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/tools.ts)。源码快照访问日期：2026-09-12。

[^max-runtime]: [Maxedapps, run/generation/state/wait/shutdown implementation](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/runtime.ts)。源码快照访问日期：2026-09-12。

[^max-rpc]: [Maxedapps, Pi RPC launch, JSONL parsing, transcript and stop](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/rpc-child.ts)。源码快照访问日期：2026-09-12。

[^max-ui]: [Maxedapps, transcript UI](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/ui.ts)。源码快照访问日期：2026-09-12。

[^max-profiles]: [Maxedapps, profile loading](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/src/profiles.ts)。源码快照访问日期：2026-09-12。

[^max-metadata]: [Maxedapps 0.1.2 package metadata and license](https://github.com/maxedapps/pi-subagents/blob/0dc176585f4f6c01a86e244d8c8d0db17a89d7cf/package.json)。源码快照访问日期：2026-09-12。

[^catalog]: [Pi package catalog, queried for subagents](https://pi.dev/packages?name=subagents)。源码快照访问日期：2026-09-12。

[^zjie]: [Zjie-Wang, model-visible content versus UI details](https://github.com/ZJie-Wang/pi-extensions/blob/0cc6b349c3e31636f80ceed2f74feb1de8f0fcfa/extensions/subagents/index.ts)。源码快照访问日期：2026-09-12。

[^zichuan]: [Zichuanlan, controls, resume and verbose conversation](https://github.com/ZiChuanLan/pi-subagents-lite/blob/360d7cfbc0ba583898295bcb17b44fba43908719/src/index.ts)。源码快照访问日期：2026-09-12。

[^pi-claude]: [Pi Claude Subagents, native Pi tools](https://github.com/FFatTiger/pi-claude-subagents/blob/f4287a2e196be4819789b8e79d0dec1b150aee38/src/index.ts)。源码快照访问日期：2026-09-12。

[^everyx]: [Everyx, registered tools](https://github.com/everyx/pi-extensions/blob/2fd03fdab465e8180a2a9736f1a9c9f18e2c4adb/packages/pi-subagent/index.ts)。源码快照访问日期：2026-09-12。

[^ogul]: [Ogul, reviewed package source](https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents)。源码快照访问日期：2026-09-12。

[^claude-style]: [Claude-style Subagent, reviewed source and package metadata](https://github.com/nishuzumi/claude-style-subagent/tree/981ec288a29dfcc0e3a0f4dd2afe4a2aba73834d)。源码快照访问日期：2026-09-12。

[^nico]: [nicobailon, published 0.67.0 source boundary](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463/src)。源码快照访问日期：2026-09-12。

[^pi-launch]: [Pi 0.85.1, official compiled/Node invocation resolution](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent/index.ts#L249-L263)。源码快照访问日期：2026-09-12。

[^max-downloads]: [npm downloads, 2026-08-12 through 2026-09-10](https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40maxedapps%2Fpi-subagents).
