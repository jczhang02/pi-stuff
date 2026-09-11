# 四个指定 Pi subagent 实现的比较

[English authoritative version](../../../research/pi-selected-subagent-comparison.md)。英文版为规范正文。

> 当前选型以[扩大范围后的 fork 复核](pi-subagent-fork-decision.md)为准。本报告保留原有范围和时点，推荐结论已被新报告替代。

调研日期：**2026-09-11**。本文补充[此前按下载量筛选的比较](pi-subagent-fork-comparison.md)。这四个实现由维护者明确指定，下载量仅供参考，不再作为准入门槛。调研问题是：后续使用 Pi Stuff 开发 Pi Stuff，哪个实现最适合作为 fork 基础。

**建议：如果第一个功能是普通 Pi 子代理协作，优先采用 ogul 的任务控制设计。**它用 2,703 行生产代码覆盖了创建、等待、查看、追加指令、打断和继续同一子会话，也不接管仓库的 Git 流程。如果第一版就需要子代理提问、兄弟通信和依赖调度，Arhen 更值得优先考虑。Henry 适合预设角色工作流；Davis 适合明确需要支持多种代理运行时的产品。这是源码层面的选型建议，尚未完成接入或兼容性验证。

从稳定 `main` 加载扩展，与选择代理的工作目录，是两项独立设置。父 Pi 已经在开发 worktree 中时，子代理继承 cwd 即可。只有一个父会话需要派任务到多个不同的已有 worktree 时，才需要公开的子任务目录参数。本次调研不意味着还要增加扩展重载机制。

## 固定版本、使用量与代码规模

三个 npm 包均固定到最新发布版本的 `gitHead`，没有直接使用 GitHub 默认分支上可能更新的代码。Davis 固定到源码仓库当时的默认分支提交；其本地 package 为 private，未声明版本。

| 实现                             | 版本 / 固定提交                                         | 固定 30 天 npm 下载量 | 生产代码行 | 源码物理行 | 生产文件数 | 测试代码行 / 文件数 |
| -------------------------------- | ------------------------------------------------------- | --------------------: | ---------: | ---------: | ---------: | ------------------: |
| [ogul：pi-codex-subagents][O]    | `0.3.5` / `9f2cae165dabf66a62f1579c3422bce21133bb9d`    |             [612][OD] |  **2,703** |      2,908 |          3 |           1,031 / 2 |
| [Henry：pi-subagent][H]          | `15.1.4` / `d7977aa2788fab09f15da5bd29be7d9e48f4e005`   |          [13,383][HD] |  **4,049** |      4,424 |         13 |          7,018 / 10 |
| [Arhen：pi-core-subagent][A]     | `1.3.54` / `de1c8783c2a39b1cbb0f86b412307193de9774c1`   |          [15,782][AD] |  **3,167** |      3,495 |         11 |           1,596 / 8 |
| [Davis：extensions/subagents][D] | 无独立发布 / `5a0863f442402aa35cb0830805d67639957c7172` |                不适用 |  **4,390** |      5,273 |         15 |             599 / 7 |

下载窗口为 **UTC 2026-08-12 至 2026-09-10，含首尾日期**，来自 npm 固定日期 API。数字包含自动化和重复安装，不代表用户数或子代理调用次数。Davis 没有独立下载数据，不等于零。发布身份依据：[ogul][OR]、[Henry][HR]、[Arhen][AR]；三个最新版本分别发布于 9 月 5、8、10 日。

使用 `cloc 2.00` 统计固定提交内被 Git 跟踪的 TS/JS 源码。生产代码行排除空行和纯注释行，物理行包含两者；测试单列。排除生成构建、文档、Markdown 角色/技能、锁文件、依赖、benchmark 和 fixture。测试代码多不等于覆盖率高，也不代表测试已通过。

| 实现  | 精确源码边界                                                                                           | 排除项与集中程度                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ogul  | `packages/pi-codex-subagents/{core,index,peek}.ts`                                                     | `core.test.ts`、`peek.test.ts` 计入测试；`test/fake-rpc-child.js` 作为 fixture 排除。`core.ts` 为 1,736 行代码，约占生产代码 64%。                |
| Henry | `extensions/pi-subagent/src/*.ts` 与 `extensions/pi-subagent/extensions/*.ts`                          | 十个 `test/*.test.ts` 文件单列；排除生成的 `dist` 和三个同仓运行时依赖包。最大文件 `src/ephemeral.ts` 为 876 行代码。                             |
| Arhen | `packages/core/pi-core-subagent/src/*.ts`                                                              | 八个 `test/*.test.ts` 文件单列；排除 `bench/spawn-cost.ts`。`src/manager.ts` 为 1,466 行代码，约占生产代码 46%。                                  |
| Davis | `extensions/subagents/index.ts`、生产 `src/**/*.ts`，**加上 `extensions/shared/tool-call-timeout.ts`** | `src/backends/stub.ts` 属于测试支持，排除。七个测试包含两个不在默认测试命令中执行的真实后端测试。最大文件 `src/backends/codex.ts` 为 936 行代码。 |

复现方式：用 `git ls-files` 枚举跟踪文件，按上述边界生成生产和测试两份清单，再运行 `cloc --config=/dev/null --timeout=0 --quiet --json --by-file --skip-uniqueness --list-file=<list>`。核对所有选定文件均出现在输出中，逐文件确认物理行数等于代码、注释和空行之和。本次已按此核对。数字反映各 subagent 单元自身维护的源码；移到其它包里的实现成本另见依赖表。

## 主模型实际能调用什么

下表按注册工具比较。内部方法或人类界面操作不算主模型可调用的能力。依据：[ogul 入口][OI]、[Henry 入口][HI]及 [flow][HF]、[Arhen 入口][AI]、[Davis 入口][DI]。

| 能力               | ogul                                                                                                                    | Henry                                                          | Arhen                                                                                                                                        | Davis                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 执行引擎           | 每个活动子代理一个独立 **Pi RPC 进程**                                                                                  | 独立、一次性的 **Pi JSON 进程**                                | 父进程内的 **Pi SDK 会话**                                                                                                                   | Pi SDK、Claude Agent SDK 或 Codex app-server                                            |
| 主模型工具         | `spawn_agent`、`wait_agent`、`wait_all_agents`、`list_agents`、`read_agent_response`、`send_message`、`interrupt_agent` | `delegate_task`、`delegate_flow`、`delegate_flow_continue`     | `subagent`、`subagent_status`、`subagent_result`、`await_subagent`、`reply_subagent`、`steer_subagent`、`resume_subagent`、`subagent_cancel` | `subagent_spawn`、`subagent_wait`、`subagent_cancel`、`subagent_check`、`subagent_list` |
| 后台派发、稍后回传 | 支持                                                                                                                    | 可选 `background` 模式                                         | 默认支持                                                                                                                                     | 支持                                                                                    |
| 运行中追加指令     | `send_message` steer 子代理                                                                                             | 无公开工具                                                     | `steer_subagent`                                                                                                                             | 无公开工具；仅人类 TUI/内部 API                                                         |
| 继续已结束的子会话 | `send_message` 重开保存的子会话                                                                                         | 不支持，使用 `--no-session`                                    | `resume_subagent` 仅限 failed/aborted 任务，要求 run 已结束且会话文件存在                                                                    | 仅人类 TUI/内部 API                                                                     |
| 主模型显式取消     | 打断单个子代理                                                                                                          | 无；依赖前台 abort signal 或关闭/重载                          | 取消整个 run；UI 可取消单个 task                                                                                                             | 取消单个子代理                                                                          |
| 调度               | 父模型协调单个代理；无显式并发上限                                                                                      | 单个、并行、链式；默认 5 个活动任务和 FIFO 队列；每次最多 8 项 | 单个、并行、链式、DAG；默认并发 3，上限 8；最多 16 个 task                                                                                   | 三种后端合计 4 个活动任务；无内置链/DAG                                                 |
| 子代理通信         | 父代理发指令，子代理回传完成结果                                                                                        | 最终输出与链式交接                                             | 向父代理提问/通知；同 run 兄弟发送/轮询消息                                                                                                  | 无子代理 mailbox 协议                                                                   |
| 指定已有子任务目录 | 无公开参数，继承父 cwd                                                                                                  | 工具无公开参数，继承 cwd 或创建角色 worktree                   | 公开 `cwd`，但可写 Git 任务会再建 worktree                                                                                                   | 公开 `working_dir`，不自动创建 Git worktree                                             |
| 自动验证/审查/集成 | 无                                                                                                                      | `delegate_flow` 管理这一流程                                   | worktree 提交与结果报告，无验收循环                                                                                                          | 无                                                                                      |

尽管名字包含 Codex，**ogul 实际运行的是 Pi，不是 Codex CLI**。这四个对象中，Davis 才实际把 Codex app-server 作为独立执行后端。Henry 的 `pi-multi-codex` 依赖用于 Pi 的 provider/账号路由，是另一种能力。

四者都创建新的子上下文，不复制父代理完整对话。独立会话、独立进程和父进程退出后继续运行，是三种不同能力。**四者都没有提供承诺跨父 Pi 关闭/重启持续执行的受监管后台服务。**ogul 关闭时终止子进程，后续核对子进程归属并清理遗留状态；Henry 中止一次性子进程；Arhen 中止/释放 SDK 会话，恢复历史快照；Davis 释放 Effect runtime 和子任务资源。会话文件可以保留对话证据，不代表保留执行状态。依据：[ogul shutdown][OI]、[Henry 生命周期][HI]、[Arhen manager][AM]、[Davis manager][DM]。

## 对日常开发有实际影响的差异

### ogul：体量较小、控制功能完整

父代理创建 `worker` 后继续其它工作，再通过 `send_message` 补充要求。子代理仍在运行时，消息成为 Pi RPC steer；任务结束后进程退出，再发消息会用原 JSONL 对话启动新的 Pi 进程。打断结束当前执行，但保留对话。取消等待只停止观察，不会终止子任务。[进程启动与控制][OC]。

这接近我们需要的日常开发循环。它主要负责任务身份、RPC 事件、持久化、结果投递和清理，不规定 Git 分支或合并策略。不过，代码量小也包含集中度高的代价：多数生命周期逻辑位于一个 `core.ts` 文件。

接入时有两项明确缺口。第一，子进程包含 `--no-context-files`，主动关闭自动 `AGENTS.md`/`CLAUDE.md` 加载，同时关闭默认扩展、技能发现。Pi Stuff fork 必须明确必需的仓库指令如何进入子上下文。传递父工具名也不会自动复制提供这些工具的扩展实现。第二，启动器默认使用 `process.execPath` 并可能追加入口脚本，需要在维护者的 Bun 编译版 Pi 上验证启动、打断和重开会话；`PI_SUBAGENT_PI_BIN` 可显式覆盖启动器。[启动策略][OC]、[资源规则说明][O]。

默认十分钟超时约束单次模型响应，不约束工具执行或整个任务。没有显式并发/深度预算。子扩展默认禁用，因此默认无法递归派生；显式加载委派扩展后，这一实际限制可能消失。

### Henry：一次性角色执行，加上 Git 集成工作流

`delegate_task` 提供打包的 scout、reviewer、implementer 角色，明确选择工具、扩展、技能和模型配置。链式任务通过 `{previous}` 传递上一步成功输出，不保留对话，也不自动让各步骤共享 worktree。默认每个 child 限制为 50 轮、空闲十分钟、总计三十分钟；未配置时 token 不限。配置 token 上限后，最后交接仍可能超出额度，不能视为精确费用上限。[角色与运行配置][HS]、[executor][HE]、[workflow][HW]。

额外能力是 `delegate_flow`：要求父 checkout 干净且有提交，创建各单元 worktree，并行执行 implementer，然后按声明顺序执行 **rebase、验证、可选的精确审查判定，再 `git merge --ff-only` 到捕获的父 checkout**。这里的 “Main” 指调用者的 checkout/分支，不一定是字面名称为 `main` 的分支。被阻塞的单元可以通过 `delegate_flow_continue` 明确修复一次。没有持久化 flow 恢复、通用 DAG 调度或合并后验证。[Flow 实现][HF]。

例如两个实现单元可以各自完成，但第二个单元必须针对第一个已集成后的状态重新 rebase 和检查。如果产品希望接管完整本地集成过程，这很有用。对于当前要求通过 PR 交付、合并需明确授权的 Pi Stuff，它增加了一套流程政策。采用普通角色委派并不要求同时采用 flow。

四千行统计还排除了三个直接同仓依赖：共享配置存储、任务模型路由和条件加载的 Codex 账号路由。子进程参数没有关闭 Pi context-file discovery；实际 AGENTS 发现仍取决于宿主 SDK，本次未通过执行确认。

### Arhen：子代理通信与依赖调度

Arhen 用约 3,200 行代码包含更多编排能力。一个 run 可以让两位 scout 并行调查，再要求 writer 等双方成功后开始。`needs` 边会把上游结果添加到后续 prompt。调度按波次执行：当前 ready wave 全部结束后才进入下一波，所以新满足依赖的任务可能仍要等待同波次中无关的慢任务。非法依赖和环会在派发前被拒绝。[依赖调度器][AG]。

子代理可以调用 `ask_parent` 等待 `reply_subagent`，也可以通知父代理或给兄弟发消息。兄弟需要主动轮询 mailbox，消息不会直接推入其活动 prompt。向父代理提问十分钟后超时。父模型能 steer 活动任务；resume 只会在 run 结束后重开 failed/aborted 任务的保存会话，不能继续已成功完成的任务。[子工具][AC]、[manager][AM]。

主要接入成本是随执行附带的 Git 政策。最终工具集含 `bash`、`edit` 或 `write` 就会触发新的托管 worktree、自动提交和清理/恢复行为；传入已有 worktree 的 `cwd` 并不自动关闭这一行为。非 Git 场景可以原地运行。这比单纯指定工作目录多了一层职责。[Worktree 实现][AW]、[任务准备][AM]。

sidecar 在父会话旁保存最多 50 个历史 run。重载会把原活动任务改为 aborted，不会重建正在运行的进程。子资源通过禁用扩展的 `DefaultResourceLoader` 加载。Agent 文件按 description 的词重叠匹配，而不是精确角色名；匹配结果可以提供 prompt/model/tools。移植到 Pi Stuff 的明确代理模板时，需要重新审视这些政策。[Agent 匹配][AA]、[会话准备与持久化][AM]。

### Davis：三种后端共享生命周期接口

Davis 值得借鉴的是封装后端差异的边界。Effect `ManagedRuntime` 负责 scope、事件队列、并发、等待和清理；每个后端提供统一的会话、事件、send 和 interrupt 操作。同一个 manager 供模型工具和人类面板使用。Pi adapter 在进程内运行；Claude、Codex 增加外部运行时及认证要求。[Backend 接口][DB]、[runtime][DR]、[manager][DM]。

使用上的关键限制，是内部接口与五个注册工具不等价。**主模型无法调用 send/steer/resume。**人类通过 `/subagents` takeover 才会调用 manager 的 send 路径。即使走这条路径，各后端语义仍不同：Pi 能实时 steer，Codex 声明不支持 steer，只排队追加一轮。面向父代理自主协作的 fork 需要公开并定义这项能力。[工具注册与 UI][DI]、[manager send][DM]。

复用已有 worktree 最直接的是这个实现：`working_dir` 解析为目录，不会创建 Git worktree。Pi 项目资源受宿主信任决定约束；Codex 后端则请求 `approvalPolicy: "never"`、`sandbox: "danger-full-access"`。若采用该后端，需要评估的是这个明确默认值。[Pi adapter][DP]、[Codex adapter][DC]。

已经使用 Effect v4，并不自动意味着 fork 成本最低。三个协议 adapter、事件顺序和 finalizer 仍需要维护；共享超时 helper 还会修改 Pi 工具定义。如果只保留 Pi，就会去掉多后端接口的很大一部分使用理由。其本地包依赖 Effect `^4.0.0-beta.99`，Pi Stuff 选择 `4.0.0-rc.112`；需要核对具体 API 差异，不能仅因预发布状态否定 Effect v4。

## 依赖、许可与实际观察到的验证

| 实现  | Pi/TypeBox/Node 内置模块之外的依赖                                                                                                  | 声明的 Pi 基线                               | 固定提交的 CI 观察                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| ogul  | 无直接运行时依赖                                                                                                                    | Coding-agent `>=0.80.4`，其它 Pi peer 为通配 | 未观察到 check run；检查的源码树中没有 workflow                                 |
| Henry | `pi-config-store ^1.0.0`、`pi-task-models ^5.0.0`、`pi-multi-codex ^1.0.0`；共享存储/路由还使用 `proper-lockfile`                   | Pi peers `^0.85.1`                           | [GitHub Actions `test` 成功][HC]；Ubuntu/Node 22/pnpm，测试、类型检查和构建打包 |
| Arhen | 无直接运行时依赖；worktree 使用 Git 可执行文件                                                                                      | Pi peers `^0.84.2`                           | [GitHub Actions `check` 成功][AX]；Ubuntu/Bun，类型检查、lint、测试             |
| Davis | 本地 `effect ^4.0.0-beta.99`、`@anthropic-ai/claude-agent-sdk ^0.3.216`；根目录 Pi/TypeBox 和共享 helper；Claude/Codex 需要外部 CLI | 根 Pi 依赖 `^0.82.0`，锁文件为 0.82.0        | 未观察到 check run；检查的源码树中没有 workflow                                 |

清单依据：[ogul][OP]、[Henry][HP]、[Arhen][AP]、[Davis 本地][DPKG]与[根目录][DROOT]。`^0.84.2` 不接受 `0.85.1`，Davis 的 `^0.82.0` 也不接受。这是声明版本范围的缺口，不是已复现的运行失败。Henry 的 CI 成功不能证明 Pi Stuff 的 Bun 编译版 Pi 已通过验收。本次没有在本地安装、类型检查、测试或运行任何候选包，也没有发起子模型调用；只执行了可信的调研和统计脚本。

四者都是 MIT，复制代码时应保留相应源码声明。Arhen 的许可注明 fork 自 `@ghoulm370/pi-subagent-ui`；Davis 使用仓库级 MIT 许可，并明确涵盖历史提交。[ogul 许可][OL]、[Henry 许可][HL]、[Arhen 许可][AL]、[Davis 许可][DL]。

## Fork 选择与第一阶段验收目标

| 第一项需求是……                                                | 优先研究的源码 | 主要适配成本                                                                               |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| 主代理控制 Pi worker，支持追问和打断                          | **ogul**       | 仓库指令、Bun 编译版启动器、并发上限，以及围绕 Pi Stuff 的 Effect I/O 边界拆分生命周期职责 |
| 子代理提问、兄弟协作与依赖图                                  | **Arhen**      | Pi 0.85.1 API 差距、明确的代理选择，以及分离执行与自动 worktree/commit 政策                |
| 一次性的 scout/reviewer/implementer，以及可重复的检查集成流程 | **Henry**      | 共享路由依赖；决定保留哪些 Git 流程；普通 child 缺少公开追问/取消工具                      |
| 用同一面板控制 Pi、Claude Code 和 Codex                       | **Davis**      | Pi/Effect API 迁移、抽取为独立包，并公开主模型 send/continue 工具                          |

Pi Stuff 的第一个功能应保留直接的开发循环：创建独立子会话，查看或等待，完成结果只投递一次，追加修正，打断，再从保存的对话继续。需要时复用已有 worktree cwd。依赖图、托管 worktree、自动审查/合并和其它后端分别作为后续产品选择。

认定 fork 可用之前，应在选定的 **Pi 0.85.1 / Bun 1.4.0 / Effect 4.0.0-rc.112** 宿主上验证这一循环，包含项目指令、取消等待与取消子任务的区别、父进程关闭、子任务失败和会话重开。这些是建议的验收目标，不是本次已执行的测试。本文不包含 fork 实现或依赖变更。

[O]: https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents
[H]: https://github.com/HenryQW/pi-harness/tree/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent
[A]: https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent
[D]: https://github.com/davis7dotsh/my-pi-setup/tree/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents
[OD]: https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40ogulcancelik%2Fpi-codex-subagents
[HD]: https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40henryqw%2Fpi-subagent
[AD]: https://api.npmjs.org/downloads/point/2026-08-12:2026-09-10/%40arhen%2Fpi-core-subagent
[OR]: https://registry.npmjs.org/@ogulcancelik%2Fpi-codex-subagents/0.3.5
[HR]: https://registry.npmjs.org/@henryqw%2Fpi-subagent/15.1.4
[AR]: https://registry.npmjs.org/@arhen%2Fpi-core-subagent/1.3.54
[OI]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/index.ts
[OC]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts
[OP]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/package.json
[OL]: https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/LICENSE
[HI]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/extensions/subagent.ts
[HF]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/extensions/delegate-flow.ts
[HS]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/src/index.ts
[HE]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/src/ephemeral.ts
[HW]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/extensions/workflow.ts
[HP]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/package.json
[HL]: https://github.com/HenryQW/pi-harness/blob/d7977aa2788fab09f15da5bd29be7d9e48f4e005/extensions/pi-subagent/LICENSE
[HC]: https://github.com/HenryQW/pi-harness/actions/runs/34210280575
[AI]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/index.ts
[AM]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts
[AG]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/graph.ts
[AC]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/child.ts
[AW]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts
[AA]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/agentfile.ts
[AP]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/package.json
[AL]: https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/LICENSE
[AX]: https://github.com/arhen/pi-extensions/actions/runs/34469628170/job/102846226743
[DI]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/index.ts
[DM]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/manager.ts
[DB]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/backend.ts
[DR]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/runtime.ts
[DP]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/backends/pi.ts
[DC]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/src/backends/codex.ts
[DPKG]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/extensions/subagents/package.json
[DROOT]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/package.json
[DL]: https://github.com/davis7dotsh/my-pi-setup/blob/5a0863f442402aa35cb0830805d67639957c7172/LICENSE
