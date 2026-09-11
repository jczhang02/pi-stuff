# Pi subagent 候选目录

[English](../../../research/pi-subagent-candidate-catalog.md)

本附录记录 2026-09-12 的发现与源码筛查范围。104 个唯一候选名称来自 30 个既有／补充对象及两组各 37 个目录条目。它们对应 85 个目录可见名称和 19 个额外名称；目录页头显示 87，但翻页去重得到 85，差异保留。来源是 [Pi 包目录](https://pi.dev/packages?name=subagents)、下表的版本化 npm 元数据及 Git 源码。

这是 104 项筛查目录，不是 104 项同深度代码审计。分类说明所见执行范围；候选未被深入核实的能力不记为已具备。单一 fork 推荐、详细比较、生产代码量和未解决边界见[选型报告](pi-subagent-fork-decision.md)。没有安装或执行候选。

下载量为 UTC 2026-08-12 至 2026-09-10 的完整 30 天总量，不是用户数。第一组中 Git-only 的三项不适用；A 组四个来源中为零但未确认的值标作“未确认”。npm 元数据链接固定发布版本，Git-only 链接固定所读提交。

## 既有与补充候选（30）

| 名称                                         | 版本   | 30 天下载 | 来源                                                                                                                 | 筛查处置                                              |
| -------------------------------------------- | ------ | --------: | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| pi-subagents                                 | 0.67.0 |   425,940 | [npm](https://registry.npmjs.org/pi-subagents/0.67.0)                                                                | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @tintinweb/pi-subagents                      | 0.19.0 |    47,015 | [npm](https://registry.npmjs.org/@tintinweb%2Fpi-subagents/0.19.0)                                                   | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @ogulcancelik/pi-codex-subagents             | 0.3.5  |       633 | [npm](https://registry.npmjs.org/@ogulcancelik%2Fpi-codex-subagents/0.3.5)                                           | Pi RPC，并非 Codex CLI；模型读最终文本，人类看实时 UI |
| @everyx/pi-subagent                          | 1.3.6  |     1,251 | [npm](https://registry.npmjs.org/@everyx%2Fpi-subagent/1.3.6)                                                        | 持久 RPC 与 UI；缺独立模型 inspect/wait               |
| pi-subagents-j0k3r                           | 1.5.15 |     8,895 | [npm](https://registry.npmjs.org/pi-subagents-j0k3r/1.5.15)                                                          | 控制齐全，含 SQLite 历史；fork 范围较大               |
| goofansu/pi-subagent                         | —      |    不适用 | [Git](https://github.com/goofansu/pi-subagent/tree/c60b654c9f6f53181181695749f533b34b52a29c)                         | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @mjakl/pi-subagent                           | 3.0.1  |     1,061 | [npm](https://registry.npmjs.org/@mjakl%2Fpi-subagent/3.0.1)                                                         | 前台／批次原生 runner；独立后台控制不完整             |
| @aefree/pi-subagents                         | 0.8.1  |        94 | [npm](https://registry.npmjs.org/@aefree%2Fpi-subagents/0.8.1)                                                       | 前台／批次原生 runner；独立后台控制不完整             |
| pi-sub-agent                                 | 0.1.5  |       416 | [npm](https://registry.npmjs.org/pi-sub-agent/0.1.5)                                                                 | 前台／批次原生 runner；独立后台控制不完整             |
| pi-open-agents                               | 0.1.22 |     1,879 | [npm](https://registry.npmjs.org/pi-open-agents/0.1.22)                                                              | 前台／批次原生 runner；独立后台控制不完整             |
| pi-herdr-agents                              | 1.7.0  |     3,032 | [npm](https://registry.npmjs.org/pi-herdr-agents/1.7.0)                                                              | 执行依赖外部后端／终端管理器                          |
| pi-submarine                                 | 0.3.0  |       707 | [npm](https://registry.npmjs.org/pi-submarine/0.3.0)                                                                 | 前台 SDK 与保存会话续跑；缺实时控制注册表             |
| pi-subagentura                               | 3.6.2  |     1,766 | [npm](https://registry.npmjs.org/pi-subagentura/3.6.2)                                                               | 原生 runtime，工作流、持久化或 UI 范围较广            |
| pi-agent-suite                               | 2.10.1 |     3,204 | [npm](https://registry.npmjs.org/pi-agent-suite/2.10.1)                                                              | 原生 runtime，工作流、持久化或 UI 范围较广            |
| fitchmultz/pi-subagents                      | —      |    不适用 | [Git](https://github.com/fitchmultz/pi-subagents/tree/c3d36cf1f858d5bee57a8240ac40c9208aa3f4d6)                      | 原生 runtime，但要求修改版 Pi                         |
| pi-claude-subagents                          | 0.3.7  |       288 | [npm](https://registry.npmjs.org/pi-claude-subagents/0.3.7)                                                          | 原生 Pi SDK，并非 Claude CLI；含监督／嵌套            |
| @gotgenes/pi-subagents                       | 21.7.0 |    12,977 | [npm](https://registry.npmjs.org/@gotgenes%2Fpi-subagents/21.7.0)                                                    | 缺模型 stop；服务层 abort/resume 是另一接口           |
| @zjie-wang/pi-subagents                      | 0.1.2  |       451 | [npm](https://registry.npmjs.org/@zjie-wang%2Fpi-subagents/0.1.2)                                                    | 命名任务；控制齐全，模型可见的实时内容较少            |
| xz-pi-subagents                              | 0.1.7  |       848 | [npm](https://registry.npmjs.org/xz-pi-subagents/0.1.7)                                                              | 前台／批次原生 runner；独立后台控制不完整             |
| pi-subagents-team                            | 0.3.0  |       484 | [npm](https://registry.npmjs.org/pi-subagents-team/0.3.0)                                                            | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @router-for-me/pi-subagents-lite             | 1.5.4  |       201 | [npm](https://registry.npmjs.org/@router-for-me%2Fpi-subagents-lite/1.5.4)                                           | 接近目标的原生候选；已深入比较控制调用路径            |
| pi-agents-pool                               | 0.2.0  |        37 | [npm](https://registry.npmjs.org/pi-agents-pool/0.2.0)                                                               | 小型 RPC pool；结果读取以最新答复为主                 |
| nano-team                                    | 1.0.1  |        23 | [npm](https://registry.npmjs.org/nano-team/1.0.1)                                                                    | 角色 spawn/kill/status；缺 steer/wait／完成后继续     |
| @kmmuntasir/pi-nested-subagents              | 0.1.0  |        24 | [npm](https://registry.npmjs.org/@kmmuntasir%2Fpi-nested-subagents/0.1.0)                                            | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @henryqw/pi-subagent                         | 15.1.4 |    13,442 | [npm](https://registry.npmjs.org/@henryqw%2Fpi-subagent/15.1.4)                                                      | 一次性委派，加自动验证／Git 集成流程                  |
| @arhen/pi-core-subagent                      | 1.3.54 |    15,990 | [npm](https://registry.npmjs.org/@arhen%2Fpi-core-subagent/1.3.54)                                                   | 仅恢复失败／中止；管理可写 worktree                   |
| davis7dotsh/my-pi-setup extensions/subagents | —      |    不适用 | [Git](https://github.com/davis7dotsh/my-pi-setup/tree/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents) | 原生 runtime，工作流、持久化或 UI 范围较广            |
| pi-background-tasks                          | 2.5.0  |    85,945 | [npm](https://registry.npmjs.org/pi-background-tasks/2.5.0)                                                          | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @quintinshaw/pi-dynamic-workflows            | 3.10.1 |    39,524 | [npm](https://registry.npmjs.org/@quintinshaw%2Fpi-dynamic-workflows/3.10.1)                                         | 原生 runtime，工作流、持久化或 UI 范围较广            |
| pi-fabric                                    | 0.92.4 |    21,043 | [npm](https://registry.npmjs.org/pi-fabric/0.92.4)                                                                   | 原生 runtime，工作流、持久化或 UI 范围较广            |

## 补充目录条目 A（37）

| 名称                                | 版本        | 30 天下载 | 来源                                                                          | 筛查处置                                              |
| ----------------------------------- | ----------- | --------: | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| @agwab/pi-workflow                  | 0.13.8      |     4,008 | [npm](https://registry.npmjs.org/@agwab%2Fpi-workflow/0.13.8)                 | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @alexeiled/pi-fusion                | 0.9.0       |       565 | [npm](https://registry.npmjs.org/@alexeiled%2Fpi-fusion/0.9.0)                | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @alexeiled/pi-subagents-bridge      | 0.3.0       |       384 | [npm](https://registry.npmjs.org/@alexeiled%2Fpi-subagents-bridge/0.3.0)      | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @ashebanow/pi-gotgenes-subagent     | 18.2.0      |       110 | [npm](https://registry.npmjs.org/@ashebanow%2Fpi-gotgenes-subagent/18.2.0)    | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @bumaociyuan/pi-herd-mirror-adapter | 0.1.1       |       335 | [npm](https://registry.npmjs.org/@bumaociyuan%2Fpi-herd-mirror-adapter/0.1.1) | 执行依赖外部后端／终端管理器                          |
| @catvec/pi-subagents                | 0.1.1       |       331 | [npm](https://registry.npmjs.org/@catvec%2Fpi-subagents/0.1.1)                | 原生候选已筛查；未建立完整模型控制证据                |
| @clanker-code/pi-subagents          | 0.15.1      |       102 | [npm](https://registry.npmjs.org/@clanker-code%2Fpi-subagents/0.15.1)         | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @davecodes/pi-subagents             | 0.34.0-bg.3 |       287 | [npm](https://registry.npmjs.org/@davecodes%2Fpi-subagents/0.34.0-bg.3)       | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @esso0428/pi-subagents              | 0.15.6      |       640 | [npm](https://registry.npmjs.org/@esso0428%2Fpi-subagents/0.15.6)             | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @ferris1225/pi-subagents            | 4.3.18      |     8,900 | [npm](https://registry.npmjs.org/@ferris1225%2Fpi-subagents/4.3.18)           | RPC readiness／重试／清理；可靠性实现范围较大         |
| @fyeeme/pi-review                   | 2.0.1       |       684 | [npm](https://registry.npmjs.org/@fyeeme%2Fpi-review/2.0.1)                   | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @gotgenes/pi-subagents-worktrees    | 0.3.3       |       761 | [npm](https://registry.npmjs.org/@gotgenes%2Fpi-subagents-worktrees/0.3.3)    | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @herbertgao/pi-subagents            | 0.17.1      |     1,157 | [npm](https://registry.npmjs.org/@herbertgao%2Fpi-subagents/0.17.1)           | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @ifi/pi-extension-subagents         | 0.5.1       |       170 | [npm](https://registry.npmjs.org/@ifi%2Fpi-extension-subagents/0.5.1)         | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @iiwate/pi-subagents-lite           | 2.2.0       |       284 | [npm](https://registry.npmjs.org/@iiwate%2Fpi-subagents-lite/2.2.0)           | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @johnnywu/pi-subagents              | 2.2.2       |       483 | [npm](https://registry.npmjs.org/@johnnywu%2Fpi-subagents/2.2.2)              | 原生候选已筛查；未建立完整模型控制证据                |
| @ladbabynpm/picc-subagents          | 0.1.1       |       131 | [npm](https://registry.npmjs.org/@ladbabynpm%2Fpicc-subagents/0.1.1)          | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @madticstudio/pi-subagents          | 0.21.0      |       260 | [npm](https://registry.npmjs.org/@madticstudio%2Fpi-subagents/0.21.0)         | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @mjfuertesf/pi-ask-pi               | 0.1.6       |    未确认 | [npm](https://registry.npmjs.org/@mjfuertesf%2Fpi-ask-pi/0.1.6)               | 原生候选已筛查；未建立完整模型控制证据                |
| @nicknisi/pi-agent-urls             | 0.1.3       |       247 | [npm](https://registry.npmjs.org/@nicknisi%2Fpi-agent-urls/0.1.3)             | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @nicknisi/pi-subagents              | 0.4.1       |     1,027 | [npm](https://registry.npmjs.org/@nicknisi%2Fpi-subagents/0.4.1)              | 原生候选已筛查；未建立完整模型控制证据                |
| @pi-stef/flow                       | 0.11.3      |    未确认 | [npm](https://registry.npmjs.org/@pi-stef%2Fflow/0.11.3)                      | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @qianweiyang/pi-tmux                | 0.1.4       |    未确认 | [npm](https://registry.npmjs.org/@qianweiyang%2Fpi-tmux/0.1.4)                | 执行依赖外部后端／终端管理器                          |
| @rohaquinlop/pi-subagents           | 0.6.1       |    未确认 | [npm](https://registry.npmjs.org/@rohaquinlop%2Fpi-subagents/0.6.1)           | 原生候选已筛查；未建立完整模型控制证据                |
| @shog-lab/pi-subagent               | 0.2.1       |        59 | [npm](https://registry.npmjs.org/@shog-lab%2Fpi-subagent/0.2.1)               | 前台／批次原生 runner；独立后台控制不完整             |
| @signalridge/pi-workflows           | 1.7.2       |     1,604 | [npm](https://registry.npmjs.org/@signalridge%2Fpi-workflows/1.7.2)           | 附加组件或专用流程；不是独立通用子代理 runtime        |
| @tian.zuo/pi-subagents              | 0.1.2       |       426 | [npm](https://registry.npmjs.org/@tian.zuo%2Fpi-subagents/0.1.2)              | 紧凑结果报告型 RPC；公开实时控制较弱                  |
| @xzzpig/pi-subagents                | 0.12.0      |     2,314 | [npm](https://registry.npmjs.org/@xzzpig%2Fpi-subagents/0.12.0)               | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @yandy0725/pi-subagents             | 0.5.1       |        80 | [npm](https://registry.npmjs.org/@yandy0725%2Fpi-subagents/0.5.1)             | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @zhushanwen/pi-subagents            | 0.1.3       |        69 | [npm](https://registry.npmjs.org/@zhushanwen%2Fpi-subagents/0.1.3)            | 原生 runtime，工作流、持久化或 UI 范围较广            |
| @zichuanlan/pi-subagents-lite       | 0.2.0       |        73 | [npm](https://registry.npmjs.org/@zichuanlan%2Fpi-subagents-lite/0.2.0)       | 实时查看／verbose 读取；缺模型 stop，并需生命周期修复 |
| oira666_pi-subagent                 | 0.4.3       |     1,428 | [npm](https://registry.npmjs.org/oira666_pi-subagent/0.4.3)                   | 原生候选已筛查；未建立完整模型控制证据                |
| pi-cursor-cloud-api                 | 0.1.0       |       169 | [npm](https://registry.npmjs.org/pi-cursor-cloud-api/0.1.0)                   | 执行依赖外部后端／终端管理器                          |
| pi-daddy                            | 0.24.0      |     1,848 | [npm](https://registry.npmjs.org/pi-daddy/0.24.0)                             | 附加组件或专用流程；不是独立通用子代理 runtime        |
| pi-dynamic-workflow                 | 0.1.2       |        91 | [npm](https://registry.npmjs.org/pi-dynamic-workflow/0.1.2)                   | 附加组件或专用流程；不是独立通用子代理 runtime        |
| pi-subagents-workflows              | 0.2.1       |       254 | [npm](https://registry.npmjs.org/pi-subagents-workflows/0.2.1)                | 附加组件或专用流程；不是独立通用子代理 runtime        |
| wj-pi-subagents                     | 0.5.0       |     5,456 | [npm](https://registry.npmjs.org/wj-pi-subagents/0.5.0)                       | 原生 runtime，工作流、持久化或 UI 范围较广            |

## 补充目录条目 B（37）

| 名称                          | 版本             | 30 天下载 | 来源                                                                       | 筛查处置                                                    |
| ----------------------------- | ---------------- | --------: | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| @narumitw/pi-subagents        | 3.0.1            |     6,248 | [npm](https://registry.npmjs.org/@narumitw%2Fpi-subagents/3.0.1)           | 运行中消息／控制；终态子代理不能继续                        |
| pi-zense                      | 0.31.0           |     5,118 | [npm](https://registry.npmjs.org/pi-zense/0.31.0)                          | 附加组件或专用流程；不是独立通用子代理 runtime              |
| pi-subagents-lite             | 1.13.1           |     1,472 | [npm](https://registry.npmjs.org/pi-subagents-lite/1.13.1)                 | 内部／UI 有续跑；未建立模型 follow-up 证据                  |
| @signalridge/pi-subagents     | 1.10.1           |     2,133 | [npm](https://registry.npmjs.org/@signalridge%2Fpi-subagents/1.10.1)       | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| @yishan-io/pi-subagents       | 0.2.6            |     1,155 | [npm](https://registry.npmjs.org/@yishan-io%2Fpi-subagents/0.2.6)          | 完成后发送主要是人类命令；模型续跑不完整                    |
| @lpb-work/pi-subagents        | 1.1.3            |     1,403 | [npm](https://registry.npmjs.org/@lpb-work%2Fpi-subagents/1.1.3)           | 原生候选已筛查；未建立完整模型控制证据                      |
| @duarteocarmo/pi-subagents    | 0.1.8            |     1,422 | [npm](https://registry.npmjs.org/@duarteocarmo%2Fpi-subagents/0.1.8)       | 前台／批次原生 runner；独立后台控制不完整                   |
| @nklisch/pi-subagents         | 18.2.0-nklisch.2 |     1,175 | [npm](https://registry.npmjs.org/@nklisch%2Fpi-subagents/18.2.0-nklisch.2) | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| @minhduydev/pi-subagents      | 0.13.0           |       356 | [npm](https://registry.npmjs.org/@minhduydev%2Fpi-subagents/0.13.0)        | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| @mdgchamomile/pi-subagent     | 0.2.6            |       841 | [npm](https://registry.npmjs.org/@mdgchamomile%2Fpi-subagent/0.2.6)        | 原生候选已筛查；未建立完整模型控制证据                      |
| @yusukeshib/pi-babysit        | 0.6.4            |       609 | [npm](https://registry.npmjs.org/@yusukeshib%2Fpi-babysit/0.6.4)           | 执行依赖外部后端／终端管理器                                |
| @yofriadi/pi-subagent-herdr   | 0.5.0            |       288 | [npm](https://registry.npmjs.org/@yofriadi%2Fpi-subagent-herdr/0.5.0)      | 执行依赖外部后端／终端管理器                                |
| @williamcr01/pi-subagents     | 0.2.5            |       727 | [npm](https://registry.npmjs.org/@williamcr01%2Fpi-subagents/0.2.5)        | 原生候选已筛查；未建立完整模型控制证据                      |
| @nativepi/subagents           | 1.1.0            |       123 | [npm](https://registry.npmjs.org/@nativepi%2Fsubagents/1.1.0)              | 有 spawn/status/list/wait/cancel；缺 live steer／完成后继续 |
| @zhcsyncer/pi-subagents       | 0.2.1            |       774 | [npm](https://registry.npmjs.org/@zhcsyncer%2Fpi-subagents/0.2.1)          | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| pi-codebase-reader            | 0.7.1            |       465 | [npm](https://registry.npmjs.org/pi-codebase-reader/0.7.1)                 | 附加组件或专用流程；不是独立通用子代理 runtime              |
| @mammothb/pi-subagents        | 1.1.2            |       449 | [npm](https://registry.npmjs.org/@mammothb%2Fpi-subagents/1.1.2)           | 执行依赖外部后端／终端管理器                                |
| @destiner/pi-subagents        | 0.1.2            |       462 | [npm](https://registry.npmjs.org/@destiner%2Fpi-subagents/0.1.2)           | 前台／批次原生 runner；独立后台控制不完整                   |
| @khanhicetea/pi-dede          | 0.6.1            |       398 | [npm](https://registry.npmjs.org/@khanhicetea%2Fpi-dede/0.6.1)             | 执行依赖外部后端／终端管理器                                |
| @danchamorro/pi-subagents     | 0.9.1            |       332 | [npm](https://registry.npmjs.org/@danchamorro%2Fpi-subagents/0.9.1)        | 多后端／终端模式；reply 不等于完成后继续                    |
| @monopi/subagents             | 0.6.1            |       387 | [npm](https://registry.npmjs.org/@monopi%2Fsubagents/0.6.1)                | 附加组件或专用流程；不是独立通用子代理 runtime              |
| @nilskluewer/pi-subagent      | 0.8.0            |       310 | [npm](https://registry.npmjs.org/@nilskluewer%2Fpi-subagent/0.8.0)         | 会话可恢复；模型 status/stop 较间接                         |
| pi-herdr-live-agents          | 0.3.0            |       334 | [npm](https://registry.npmjs.org/pi-herdr-live-agents/0.3.0)               | 执行依赖外部后端／终端管理器                                |
| pi-goal-expander              | 0.2.1            |       109 | [npm](https://registry.npmjs.org/pi-goal-expander/0.2.1)                   | 附加组件或专用流程；不是独立通用子代理 runtime              |
| @pi-vault/pi-subagents        | 0.4.1            |       276 | [npm](https://registry.npmjs.org/@pi-vault%2Fpi-subagents/0.4.1)           | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| @am_n_n/pi-subagents          | 0.1.2            |        98 | [npm](https://registry.npmjs.org/@am_n_n%2Fpi-subagents/0.1.2)             | 前台／批次原生 runner；独立后台控制不完整                   |
| @diegopetrucci/pi-subagents   | 0.31.14          |       176 | [npm](https://registry.npmjs.org/@diegopetrucci%2Fpi-subagents/0.31.14)    | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| pi-fairy-tales                | 0.15.0           |        83 | [npm](https://registry.npmjs.org/pi-fairy-tales/0.15.0)                    | 附加组件或专用流程；不是独立通用子代理 runtime              |
| pi-subagents-extension        | 1.0.0            |       194 | [npm](https://registry.npmjs.org/pi-subagents-extension/1.0.0)             | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| pi-agent-wait                 | 0.6.0            |       155 | [npm](https://registry.npmjs.org/pi-agent-wait/0.6.0)                      | 附加组件或专用流程；不是独立通用子代理 runtime              |
| pi-brainstorm                 | 0.4.3            |       105 | [npm](https://registry.npmjs.org/pi-brainstorm/0.4.3)                      | 附加组件或专用流程；不是独立通用子代理 runtime              |
| claude-style-subagent         | 0.1.5            |        93 | [npm](https://registry.npmjs.org/claude-style-subagent/0.1.5)              | 原生控制候选；许可／私有 API 问题阻止选用                   |
| @maxedapps/pi-subagents-herdr | 0.1.3            |        95 | [npm](https://registry.npmjs.org/@maxedapps%2Fpi-subagents-herdr/0.1.3)    | 执行依赖外部后端／终端管理器                                |
| @yassimba/pi-subagents        | 0.37.2           |       108 | [npm](https://registry.npmjs.org/@yassimba%2Fpi-subagents/0.37.2)          | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| @yunosukeyoshino/pi-herdr     | 0.1.0            |       123 | [npm](https://registry.npmjs.org/@yunosukeyoshino%2Fpi-herdr/0.1.0)        | 执行依赖外部后端／终端管理器                                |
| @hheei/hepi-subagents         | 0.2.0            |        99 | [npm](https://registry.npmjs.org/@hheei%2Fhepi-subagents/0.2.0)            | 原生 runtime，工作流、持久化或 UI 范围较广                  |
| @maxedapps/pi-subagents       | 0.1.2            |        77 | [npm](https://registry.npmjs.org/@maxedapps%2Fpi-subagents/0.1.2)          | 选中 fork；四个工具、当前输出与日志路径                     |

目录不把同名功能、相似 README 或共同谱系直接当成代码等价，也不把进程内 SDK 当成非原生 Pi。较宽泛的筛查类别只用于划定进一步比较范围。
