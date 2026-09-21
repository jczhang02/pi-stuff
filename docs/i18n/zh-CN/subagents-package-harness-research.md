# Pi subagent 与 coding harness 调研

[English](../../subagents-package-harness-research.md) · 配套阅读: [Subagent UI 决策 spec](subagents-ui-decision-spec.md).

状态: 2026-09-22 整理的 research 文档, 供 review. 本文整理已有证据, 不提出新的实现计划, 不恢复 subagent 开发. 配套 spec 记录既有 UI 决策及仍需审阅的实现落点.

## 1. 先看结论

这些包不是一条从简单到高级的功能阶梯, 它们解决的问题不同.

| 类别              | 代表                                                | 主要解决什么                                      |
| ----------------- | --------------------------------------------------- | ------------------------------------------------- |
| 轻量委派          | Pi 官方示例、`@pi-plugins/subagent`、`pi-sub-agent` | 给一个独立上下文交办任务, 等报告, 由父代理汇总    |
| 小型 SDK runner   | `pi-fast-subagent`                                  | 在进程内创建子会话, 管理前后台执行和状态          |
| 可延续会话        | `pi-submarine`                                      | fresh/fork/resume, 不把后台调度当作必需能力       |
| 调度与通信        | arhen、gotgenes、narumi                             | 生命周期、问答、steer、等待和取消, 各自边界不同   |
| 产品化组合        | tintinweb、herdr                                    | 运行能力加可观察界面、工作区或常驻角色            |
| 工作流            | `pi-subagents`、Dynamic Workflows、Taskflow         | 多步骤编排; 其中回放/恢复能力不能一概而论         |
| 外部 harness 委派 | `pi-harness-delegate`                               | 调用 Claude Code、Codex、OpenCode 等外部进程/协议 |

最值得分开理解的是四条轴:

```text
执行方式    前台等待 / 后台运行
上下文      全新 / 复制父历史 / 继续同一子会话
协作方式    消息 / 阻塞问题 / steer / 依赖 / 工作流步骤
观察方式    状态 / 通知 / transcript / 用量 / 历史报告
```

有后台 ID 不等于支持续聊. 保存 transcript 不等于会话可以恢复. DAG 不等于对话树. 有 FleetView 也不等于宿主能切换当前 agent.

arhen 用较少代码组合了依赖调度、mailbox 和 worktree. gotgenes 的代码更多, 但提供了更清晰的可组合 service、事件、记录和 workspace 接口. 这解释了两者的取舍, 不等于重新选择 fork 或宣布其中一个已经可靠.

## 2. 证据与统计口径

### Package 样本

此前审计包含 **13 个 npm 包, 外加 1 个 Pi 官方示例**. 这不是整个生态的穷尽清单. 功能来自发布源码、包文档和固定提交, 当时没有对这些包逐一运行真实模型任务, 因此不构成性能或可靠性评测.

统计日期为 2026-09-13:

- 下载量来自 npm 官方 API, 窗口为 2026-08-14 至 2026-09-12, 共 30 个完整日, 汇总包的所有版本. 不是用户数, 也不是表中单个版本的下载数.
- SLOC 使用 `cloc 2.00` 的 code 行数, 统计手写 JS/TS 运行实现, 排除空行、注释、测试、Markdown prompt、文档、外部依赖及重复构建产物.
- 只发布 bundle 的包, 在可以对应所引源码提交时使用 source map 中的 `sourcesContent`. 下方保留特殊口径.
- 代码量反映被统计的范围, 不直接衡量质量, 也不能据此估计剥离 UI 后剩多少工作.

### Harness 证据

- **Claude Code**: 2026-09-15 使用官方 Linux CLI 2.1.261 做真实终端交互, 模型回复由本地脚本 fixture 提供. 委派、路由、读文件、排队、取消和渲染由 Claude CLI 执行. 这能证明 UI 路径, 不能证明真实模型表现. [固定版本完整研究](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md) 保留操作证据及官方链接.
- **Pico v3**: 2026-09-22 阅读 [官方设计文档](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/pico/pico-v3.md#85-subagents). 它是暂定提案, 不是已发布 API.
- **Codex**: 2026-09-22 阅读公开 [multi-agent handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents.rs)、[工具 schema](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs) 和 [配置 schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json). `main` 会变化, 以下是有日期边界的源码观察, 不保证所有客户端版本都如此.
- **非官方镜像**: 被称为 leaked source 的镜像不作为官方证据. 本文不据此作实现断言, 也不摘录其中大段代码.

本轮不把 Pi SDK 版本差异当作讨论中的选型障碍. 真正采用代码时再核对兼容性, 不在此扩展.

## 3. 包、下载量与代码量

| 包与测量版本                               | 主要侧重               | 运行边界                     | 30 日下载 | 运行 SLOC | 文件 | 固定源码                                                                                                                                      |
| ------------------------------------------ | ---------------------- | ---------------------------- | --------: | --------: | ---: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi 官方示例 `0.85.1`                       | 轻量委派               | 独立 Pi 进程                 |       n/a |     1,027 |    2 | [源码](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/examples/extensions/subagent) |
| `@pi-plugins/subagent@0.3.0`               | 轻量委派               | 独立 Pi 进程                 |       651 |       702 |    5 | [源码](https://github.com/k3dom/pi-plugins/tree/67dabc6181304af332363f5cb91a6ed0572104a9/plugins/subagent)                                    |
| `pi-sub-agent@0.1.5`                       | 轻量委派               | 独立 Pi 进程                 |       452 |     1,593 |    2 | [源码](https://github.com/HamdiMaz/pi-sub-agent/tree/f1c0ae29f4cf370255530d3d126ec71b0d7a6194)                                                |
| `pi-fast-subagent@0.9.4`                   | 小型进程内 runner      | Pi SDK 会话                  |        96 |     1,876 |   10 | [源码](https://github.com/tuansondinh/pi-fast-subagent/tree/559cc175447b25d1a162cf436875f0c60ac569be)                                         |
| `pi-submarine@0.3.0`                       | 可延续会话             | Pi SDK 会话                  |       717 |     2,430 |   12 | [源码](https://github.com/dnouri/pi-submarine/tree/97d8715ebce695a618d1775d6d3d4b9072396c77)                                                  |
| `@tintinweb/pi-subagents@0.19.0`           | 运行与工作流组合       | 进程内 Pi SDK                |    46,365 |    12,216 |   56 | [源码](https://github.com/tintinweb/pi-subagents/tree/4f572eaa04c09d3dbc16e4a5f13a16b295e84e14)                                               |
| `@gotgenes/pi-subagents@21.7.0`            | 可组合运行服务         | 进程内 Pi SDK                |    12,989 |     6,463 |   68 | [源码](https://github.com/gotgenes/pi-packages/tree/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents)                           |
| `@narumitw/pi-subagents@3.0.1`             | 运行通信               | 独立 Pi RPC 进程             |     5,900 |     2,774 |   13 | [源码](https://github.com/narumiruna/pi-extensions/tree/72df85c54149e07fc204539bc1db38c1bba494f3/packages/pi-subagents)                       |
| `@arhen/pi-core-subagent@1.3.54`           | 运行通信与依赖图       | 进程内 Pi SDK                |    16,195 |     3,167 |   11 | [源码](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent)                   |
| `pi-herdr-agents@1.7.0`                    | 常驻专家会话           | 独立 Pi 进程 / Herdr         |     2,859 |    10,339 |   19 | [源码](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)                                          |
| `pi-subagents@0.67.0`                      | 工作流编排             | 前台 SDK + 后台 runner       |   431,253 |    90,362 |  281 | [源码](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)                                              |
| `@quintinshaw/pi-dynamic-workflows@3.11.0` | 脚本工作流             | 脚本 runner + 子会话         |    40,554 |    13,139 |   46 | [源码](https://github.com/QuintinShaw/pi-dynamic-workflows/tree/3a6c259df96558275dcbac7278e0038aefb5dcbd)                                     |
| `pi-taskflow@0.3.0-beta.1.2`               | 声明式任务图           | Pi adapter + `taskflow-core` |     1,229 |    3,876* |    6 | [源码](https://github.com/heggria/taskflow/tree/d9652629c46ad15f4898dd458867f8e0460f98b5/packages/pi-taskflow)                                |
| `pi-harness-delegate@0.6.1`                | 外部 coding-agent 委派 | 外部 CLI / ACP               |     1,960 |     4,955 |   23 | [源码](https://github.com/yorch/pi-harness-delegate/tree/bc1718d313a8d131a60aac3950c6193e8e4c6709)                                            |

`*` Taskflow 的 3,876 行仅包含 Pi adapter. 独立发布的 `taskflow-core` 为 25,852 行 / 94 个 TS 文件, 两者合计 29,728 行. tag 已对照 release, 但 npm 元数据没有 `gitHead`, 不声称与发布构建逐字节一致.

官方示例没有独立下载量. `@pi-plugins/subagent` 的 702 行包括包内 526 行与直接打包的内部共享模块 176 行. `pi-subagents` 的大体量包含 runs、agents、TUI、watchdog、workflow、intercom 和 inspector, 不是最小 spawn 功能的成本.

## 4. 都有的能力, 与少数包才有的能力

此前矩阵覆盖 **13 个 npm 包 × 57 项能力 = 741 个单元格**, 其中 321 项直接支持、58 项条件或部分支持、362 项包内不提供, 没有遗留问号. 官方示例不计入这 741 项. 包内没有, 不等于外部脚本永远无法补上.

### 共同基础

| 能力           | 真实使用例子                                                     | 有该能力的包                                                                 |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 委派一个任务   | 主代理把 "查清登录失败原因" 交给研究员, 收到报告后再决定是否修改 | 上表 13 个 npm 包, 以及官方示例                                              |
| 独立子上下文   | 研究员读取大量源码和工具日志, 不把所有中间步骤塞入父代理上下文   | 同上; 边界可能是独立 Pi 进程、SDK 会话、工作流会话或外部 harness             |
| 返回最终结果   | 调查员返回发现和错误, 主代理汇总成面向用户的结论                 | 同上; 结果可能是文本、结构化记录或 transcript 引用                           |
| 并行分工与汇总 | 两人分别调查取消和会话保存, 主代理拿到两份报告后再交办审查       | 同上; 可能通过一次调用或 Pi 原生多工具调用完成, 不代表都有持久后台 scheduler |

### 差异能力

| 能力                   | 真实使用例子                                                          | 有该能力的包                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后台运行与查询         | 派出调查员后主代理继续工作, 过一会查询进度                            | fast、tintinweb、gotgenes、narumi、arhen、herdr、nico、Dynamic Workflows、Taskflow、harness-delegate. 官方示例、minimal、sub-agent、submarine 以前台为中心                            |
| 完成后继续同一会话     | reviewer 报告一个竞态, 修复后让它保留上下文复查                       | submarine、tintinweb、gotgenes、nico 直接支持. herdr、minimal、Dynamic Workflows、harness-delegate 有条件路径, 例如保留会话、手动重开、工作流内上下文或特定后端续接, 不能视为同一保证 |
| steer 正在工作的 agent | 调查中补充 "集中检查取消路径, 附文件位置"                             | tintinweb、gotgenes、narumi、arhen、herdr、nico. 可能采用 steer、请求 broker 或中断后续发, 具体交付语义不同                                                                           |
| 向父代理提阻塞问题     | 子代理遇到两种需求解释, 等父代理回答后再继续                          | gotgenes、narumi、arhen、herdr. nico 有 intercom, 要按具体路径核对, 不直接等同                                                                                                        |
| 兄弟间直接消息         | A 找到相关文件, 不经父代理转发就告诉 B                                | arhen 的 sibling mailbox 最明确. 经工作流共享状态或父代理转发是其他机制                                                                                                               |
| 显式依赖               | C 等 A/B 报告, 必需前置失败则跳过 C                                   | arhen 的 `needs` 与 ready waves; Taskflow 声明式 DAG. nico 及部分工作流包有较窄的 lane/依赖构件, 不等于通用 DAG                                                                       |
| 写任务 worktree 隔离   | 两个实现者分别改分支, 父代理检查各自 Git 结果后再整合                 | tintinweb、arhen、herdr、nico、Dynamic Workflows、Taskflow. gotgenes 核心提供 `WorkspaceProvider`, Git 隔离由 companion 或调用方实现                                                  |
| 命名流程与串行链       | 运行 `scout -> planner -> worker`, 或并行调查后进入下一步             | 官方示例和 sub-agent 提供 single/parallel/chain; tintinweb、nico、Dynamic Workflows、Taskflow 提供更丰富流程. arhen `needs` 是调度原语, 不是通用脚本引擎                              |
| 结构化输出约束         | reviewer 返回 `{ findings, severity, files }`, 下一步验证后再使用     | tintinweb、nico、Dynamic Workflows、Taskflow 有相应工作流结果路径. 文本加固定元数据本身不等于模型输出 schema                                                                          |
| 外部 harness 委派      | 从 Pi 调 Claude Code 或 Codex 实现变更, 后端支持时保留外部 session ID | `pi-harness-delegate`, 与进程内 Pi 子会话不同                                                                                                                                         |

表内简称: minimal=`@pi-plugins/subagent`, sub-agent=`pi-sub-agent`, fast=`pi-fast-subagent`, submarine=`pi-submarine`, tintinweb=`@tintinweb/pi-subagents`, gotgenes=`@gotgenes/pi-subagents`, narumi=`@narumitw/pi-subagents`, arhen=`@arhen/pi-core-subagent`, herdr=`pi-herdr-agents`, nico=`pi-subagents`. Dynamic Workflows、Taskflow 和 harness-delegate 的完整包名见统计表.

### 值得单独参考的设计

| 设计                     | 使用例子                                                 | 参考                                                                                     |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 极小进程委派入口         | "请 scout 检查认证代码, 返回 Markdown 报告"              | 官方示例、minimal、sub-agent                                                             |
| fresh 与 fork 显式区分   | 给研究员干净上下文, 或复制派发前父会话讨论               | submarine、gotgenes、tintinweb、herdr、nico                                              |
| 等待超时不等于取消       | 30 秒没结果就返回主代理, 子任务继续运行                  | narumi 的等待合同很清楚                                                                  |
| 依赖同时传递报告         | 两份调查结束后自动带给 reviewer                          | arhen                                                                                    |
| 生命周期事件与 service   | UI 订阅完成/失败/steer, 不侵入 runner                    | gotgenes                                                                                 |
| live widget 与会话查看器 | 看紧凑列表, 选子代理查看 transcript 并 steer             | tintinweb; 样本中的列表在 editor 上方, 不是我们的目标位置                                |
| 常驻 specialist          | 数据库专家处理完一件事, 后续继续交办                     | herdr                                                                                    |
| 工作流恢复/局部重算      | 修改后续步骤, 复用前面已完成的工作流输出                 | tintinweb、Dynamic Workflows、Taskflow. 不等于聊天续接; 审计的 nico 版本没有通用步骤回放 |
| 稳定任务路径与后代寻址   | 派出 research-a/research-b, 等消息, 再向其中一个续发     | Codex, 具体工具名随 backend/version 而变                                                 |
| 单一工具带多个操作       | 一个 `subagent` 入口承担 run/spawn/send/status/wait/stop | Pico v3 提案, 不是发布 API                                                               |

## 5. Arhen 与 gotgenes: 两种核心边界

### Arhen: 紧凑的调度与通信管理器

审计的 `@arhen/pi-core-subagent@1.3.54` 在 3,167 行运行代码中组合了 DAG、mailbox 和 worktree. 任务能前台/后台运行, 按 run/task ID 查询, 使用 `needs` 接收上游报告. 调度采用 ready wave, 当前波次尚有任务工作时, 后一波可能仍要等待.

例子: A/B 并行调查, C 声明 `needs: [A, B]`. 两份报告完成后 C 才启动并收到报告. A 失败时 C 跳过, 独立的 B 仍继续.

它的 resume 是失败/中止恢复, 不是已完成子代理续聊. 审计版本关闭额外 extension 加载. 因此它适合参考 run manager、依赖、通信和 worktree 交接, 不提供完整的扩展工具继承政策.

早期固定版本静态审查记录了三类问题:

1. 异步初始化期间取消, 后续仍可能写回 starting/running.
2. 到 run 完成才写 sidecar, 提前退出可能没有恢复索引.
3. resume 时 agent 文件中的模型可能覆盖本次显式选择.

这是源码发现, 不是所有版本的运行结论. 可借鉴的要求是: 取消覆盖初始化和后续状态转换; 已接受工作要有恢复记录; 生效配置有明确优先级.

### 后续 1.3.55 审计补充

重新开发阶段检查了 [1.3.55 / `676b11e`](https://github.com/arhen/pi-extensions/tree/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent), 记录见 [redevelopment spec](subagents-redevelopment-spec.md). 统计表仍使用早期 1.3.54 的代码量, 没有冒充重新计数.

只读任务直接读指定 cwd. 写任务从 Git HEAD 或选定的前置分支起步, 不包含父目录未提交改动的自动快照. 多个前置会传入多份报告, **不会自动合并多个写入分支**, runner 只选一个代码基线. 波次屏障还可能使已就绪的下游等待同波其他独立任务.

后续源码审查还把 worktree 创建失败后回退源目录、steer 未确认交付却返回成功、取消状态早于实际收尾/保存等列为修复边界. 这些是源码发现及选定要求, 不构成新的独立上游包 E2E 结论. 1.3.55 补充 provider/thinking 元数据, 没有提供我们额外讨论的完成后续聊与 extension 工具政策.

### Gotgenes: 可组合的生命周期 service

`@gotgenes/pi-subagents@21.7.0` 的运行代码约为 arhen 两倍. 额外代码主要提供服务边界, 不是现成的通用 DAG. `spawn` 返回 agent ID, `getRecord/listAgents` 返回快照, `resume/steer/abort/waitForAll` 管生命周期, 事件供外部界面订阅. Session factory 和 workspace provider 可注入, 用量进入类型化记录.

例子: 调用 service 创建 researcher 和 reviewer, 订阅完成事件更新 FleetView, 修复后 resume reviewer. Service 提供句柄与状态, 但 A 如何依赖 B 仍由调用方决定.

可复用基础设施包括 FIFO 并发限制器、session factory、workspace provider、结果记录、`ask_parent/notify_parent` 和创建时工具/模型选择. 核心没有通用 DAG、工作流回放或内建 Git worktree 保证, 不能把 companion 功能算进核心.

早期静态审查也发现取消边界疑点: 初始化后首次 prompt 前没有再次检查取消; `abort(id)` 关联初始 controller, 而 `runResume()` 使用调用方 signal, 可能出现记录已停止但续接执行未停止. 若再参考这套代码, 应复核这些路径. 基础设施多不等于已经正确.

### 对照

| 问题     | Arhen                                 | Gotgenes                          | 启发                                         |
| -------- | ------------------------------------- | --------------------------------- | -------------------------------------------- |
| 核心单位 | run 中的 tasks 与 needs               | agent record 与 service 执行      | 中心究竟是调度, 还是可复用会话服务           |
| 后台工作 | manager、auto-await、查询/结果工具    | service、并发限制、等待           | 都能非阻塞, 通知与状态的归属不同             |
| 续接     | 失败/中止恢复                         | 在保留边界内 resume/follow-up     | 恢复与完成后续聊要分开                       |
| 通信     | parent request、sibling mailbox、通知 | steer、ask/notify parent、事件    | 字符串字段不足以定义交付与问题归属           |
| 依赖     | needs、ready waves、报告交接          | 核心无通用 DAG                    | 可把依赖政策留给调用方                       |
| 工作区   | 包内 worktree 行为                    | WorkspaceProvider, Git 隔离在外部 | 工作区政策可以有独立接口                     |
| 扩展     | 审计版本关闭额外加载                  | 可加载并筛选 child 工具           | 工具继承不同于进程隔离                       |
| UI       | 紧凑 manager 视图                     | 事件供外部组合                    | runtime 应提供足够状态, 不必拥有宿主当前会话 |
| 规模     | 3,167 行 / 11 文件                    | 6,463 行 / 68 文件                | 是边界差异, 不是直接质量排名                 |

## 6. Claude Code: 交互值得参考, 会话切换依赖宿主

### 实際观察到的路径

主对话保留, 委派摘要说明启动了谁, 底部紧凑列表用于选择查看对象. **键盘选中**与**当前正在看的会话**分别表示: 列表指针负责选择, 填充标记表示当前查看对象. Enter 打开所选 child transcript, 输入也指向该 child. Esc 有上下文含义, 可先把焦点从列表退回输入, 再中断正在工作的 child.

输入区域明确显示收件人. steer 内容进入子对话, 列表显示 queued 数量, 因而 "接受投递" 与 "已经应用" 不混为一谈.

`/tasks` 提供另一种管理详情, 包括任务、耗时、tokens、工具数、模型、最新活动、prompt 和操作. Ctrl+O 展开主对话的委派记录. 列表导航、子对话、任务管理和证据展开分别服务不同目的.

紧凑行使用对齐的名称/描述与右侧指标, 不必每行重复 Running. 接受的参考布局中 main 没有 description. 完成、停止、失败、权限请求、问题和跨会话 Agent View 各有语义. 列表里消失不等于 transcript 被删除; 树状显示也不能推断支持递归委派.

### 可移植的部分

1. 主对话保持紧凑, 委派摘要交代启动了谁.
2. 工作时看实际活动, 阻塞时看原问题, 完成时直接看报告.
3. steer 收件人清楚, queued 与 applied 分开.
4. 区分选择、查看、管理与完整证据展开.
5. live 列表即使收缩或移除行, 仍能找到已完成输出.

### 不能直接搬到 Pi 的部分

Claude 的 child-view 转换由宿主掌握, 它能切换 transcript, 将普通输入路由给 child, 同时维持宿主命令与任务管理. Pi 扩展能渲染阅读器和投递自己管理的消息, **但替换底部组件不等于切换 Pi 当前 AgentSession、主编辑器历史、内建命令或 provider 状态**.

因此参考 FleetView 的信息层次是合理的, 真正切换宿主会话是另一项能力. 当前 UI 决策采用底部检查区, 不声称实现了这种切换.

上述终端研究使用脚本模型回复, 未执行每一种官方文档路径. 嵌套限制、权限转交、保留政策和 Agent View 应以对应官方文档为准, 不能由测试截图扩展推断.

## 7. Codex: 原生协作工具与显式任务身份

公开源码把协作作为独立工具接口, 不只是一个黑盒 run-child.

- Handler 将工具调用映射到本地 agent control. 子代理继承 provider、approval、sandbox、cwd 等运行状态, 角色配置可叠加.
- 不同 backend/version 使用 spawn、send-input、wait、close、resume, 或 task-oriented 的 send-message、followup、interrupt、list 等操作.
- V2 schema 使用 task name/message, 返回 canonical task name, 描述了 child 具有工具及继续派发能力. V1 schema 另有 fork context、model 和 reasoning 选择.
- wait 有明确的 timeout/通知合同. V1 返回按 ID 的最终状态, V2 等待 mailbox 更新并返回摘要, 不直接塞完整正文. 等待事件与获取结果可以分开.
- 配置提供并发线程限制, V1 还提供嵌套深度. 任务路径让后代可以稳定寻址, 不靠显示名称猜目标.

例子: root 派出 cancellation/persistence, 等 mailbox 更新, 向 cancellation 续发要求, 最后结束对应分支. 稳定路径与独立 follow-up 操作使模型和 UI 都能追踪归属.

这里值得参考的是所有权与寻址. 友好名称可以重复, 消息必须有稳定目标. 子代理可再派发时需要考虑深度和数量. 这是源码观察, 不要求 Pi 复制 Codex 工具名或加入递归.

## 8. Pico v3: 单一工具, 子代理就是会话

Pico 是设计提案. 其 subagent 部分将多个操作收在一个模型入口中:

```text
subagent.run      前台子会话
subagent.spawn    后台子会话
subagent.send     发消息或排队
subagent.status   看尾部与活跃任务
subagent.wait     等结果或超时
subagent.stop     中止子代理
```

它把 subagent 定义为 conversation, 不额外维护一份 agent registry. 返回 ID 可以解析回 conversation handle. 所有权与历史 fork、前台与后台、等待与取消、持久任务与临时进程分别建模. 其他章节用单写者提交序列和恢复状态记录已接受工作, 不把外部副作用说成 exactly-once.

对我们的讨论有用的是:

- 一个模型工具可以承载多种操作, 不必注册许多顶层工具.
- 子会话是长期身份, task/request 是一次执行.
- send 进入队列, 不等于 agent 已经应用.
- status、wait、result 可以有不同的大小和唤醒语义.
- 归属和取消范围需要明确, 不能从画出的树推断.

它没有定下 Pi 扩展 UI, 存储与 scheduler 章节也不是现成生产保证. 应作为词汇和状态模型参考.

## 9. 可以借鉴什么, 哪些结论不能推出

| 可借鉴的想法                 | 证据来源                                                                   | 用途                                    |
| ---------------------------- | -------------------------------------------------------------------------- | --------------------------------------- |
| 紧凑的父代理委派入口         | Pi 示例、Pico、Claude 委派摘要、Codex tools                                | 编排容易找到, 又不丢 child 结果         |
| 执行、会话、每次交办分别记录 | Arhen、gotgenes、Pico、Codex                                               | 避免续聊、重试、依赖和通知互相覆盖      |
| 明确通信交付阶段             | Claude queued、gotgenes 问答、narumi request ID、Pico queue、Codex mailbox | 发出字符串不等于被消费                  |
| 依赖不同于历史 fork          | Arhen needs、Taskflow DAG、Pico 所有权、Claude task 关系                   | reviewer 可依赖报告, 不必继承不相关历史 |
| 事件与状态快照               | Gotgenes、Codex、Pi SDK、Pico                                              | UI 观察执行, 不成为调度器               |
| 紧凑摘要与展开证据           | Claude、Pi renderer、Codex wait、Pico bounded output                       | 看清当前重点, 保留完整报告              |
| 取消覆盖执行与收尾           | Arhen/gotgenes 源码问题、Pico、Claude stop                                 | 收尾没结束时继续显示 Stopping           |

以下不能从研究推出:

- 下载多就是质量好, 或代码少就是更好的 fork 基础.
- 静态代码看起来清楚就已经通过模型、崩溃和恢复测试.
- 模型报告完成就代表代码已提交、保存或合并.
- workflow replay 等于会话 resume; 会话持久化等于后台调度.
- FleetView 外观相似就能切换 Pi 宿主会话.
- 递归默认安全, 或文档树自动定义取消范围.
- 未核实就等于不支持, 或移动中的 main 就是稳定 release 合同.

## 10. 来源索引

包源码均链接在统计表, 使用固定提交. npm 统计来自 [官方 downloads API](https://api.npmjs.org/), 不作为实时数值展示. 逐文件 SLOC、能力矩阵和静态审计 JSON 来自 2026-09-13 研究工作区; 本文保留其测量结果和限制.

Harness 主要入口:

- [Claude subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude interactive mode](https://code.claude.com/docs/en/interactive-mode)
- [Claude Agent View](https://code.claude.com/docs/en/agent-view)
- [Claude 终端研究固定版本](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md)
- [Pico v3 subagents](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/pico/pico-v3.md#85-subagents)
- [Codex multi-agent handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents.rs)
- [Codex multi-agent tool schema](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)
- [Codex configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)

UI 的已确认布局、交互和概念图集中在 [配套 UI spec](subagents-ui-decision-spec.md). 研究提供依据, 不把当前不满意的实现反过来写成已通过的设计.
