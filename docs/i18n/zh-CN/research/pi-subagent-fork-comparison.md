# Pi 子代理 fork 基础的源码比较

[English](../../../research/pi-subagent-fork-comparison.md)

**研究日期：** 2026-09-10

**范围：** 仅比较公开 Pi 子代理包和官方 Pi 示例。所有旧的 `pi-stuff` 研究，包括 `pi-stuff-old`，均排除在外。

**目标：** 未来的 `pi-stuff` 用于日常开发：新鲜上下文的 scouting 和只读 review、真正的后台委派、status/wait/steer/stop/result 收集，以及明确指向现有 stable-main 或开发 worktree 的 `cwd`。目标主机是 Bun 编译的 Linux Pi 0.85.1；仓库使用 Bun 1.4.0、TypeScript 7.0.2 和 Effect 4.0.0-rc.112。

这是一份研究比较，不是已采用的设计、实现方案或 ADR。“只读”只有在源码确实强制工具或策略限制时才这样表述。提示词里写“不要编辑”不是技术上的只读边界。worktree 隔离文件树，也不会隔离 shell、网络或用户权限。

## 结论

首个 fork 验证建议从 `ogulcancelik/pi-extensions` 的 `packages/pi-codex-subagents` 开始。它是本次候选中最窄、同时覆盖目标形状的实现：OS child process、detached 执行、持久任务/session 文件、显式 `cwd`、status 和 wait 工具、steering、interrupt、进程所有权检查与恢复。这个建议是有条件的。当前源码仍有较大的 `core.ts`、宽松类型、未发现的 CI workflow、启动时的 `SYSTEM.md`、关闭 context-files 以及不完整的 timeout 边界；在把它视作可靠底座之前，必须先通过真正的 Pi 0.85.1 Bun 编译主机验收。

这不是全局排名。`nicobailon/pi-subagents` 是最强的 standalone/recovery 参照：它有 detached runner、持久 artifact、父 session reload 恢复、使用真实 Pi binary、SDK 和确定性 provider 的 Linux standalone 测试矩阵，并明确区分结果完成与进程退出。代价是范围很宽，missions、workflow、scheduler、worktree、external jobs、intercom 和 TUI 与有效核心交织。如果持久后台执行和恢复是首要目标，nicobailon 是可信的替代起点，也可能是更值得先研究的来源。

`goofansu/pi-subagent` 是最强的同 Effect 参照。它的 typed lifecycle 和 Pi backend 对选择进程内、session-scoped runtime 很有价值，但它是包含 25,644 个物理源码行（16,351 行代码）的双 backend runtime，ResultStore 只在内存中工作。不能因为 Effect 仍是 release candidate 就排除它；真正的问题是迁移范围，以及缺少目标主机 standalone gate。`j0k3r` 是中等规模、带持久历史的进程内替代；`everyx` 是简洁的持久 RPC 设计，但 peer 范围排除 Pi 0.85.1，扩展继承和 nested delegation 也很宽；`tintinweb` 是能力完整的进程内 manager，但 workflow/worktree/UI 面很大，stop 不是 LLM 工具；`mjakl` 提供前台 RPC 参照，`aefreedman` 提供前台 JSON-print 参照，却没有真正的后台任务。官方示例和 HamdiMaz 说明了简单 foreground 基线；andrea-tomassi 和 giuseppecrj 有参考价值，但解决的是明显不同的问题。

后台执行与持久化是两个维度。前台封装会让父工具调用等待；进程内后台管理器返回任务 ID 后，在宿主内继续运行独立 Pi session；后台 RPC 管理器则让独立子进程继续运行；detached SDK runner 还单独管理运行进程和落盘状态。goofansu、tintinweb、j0k3r 属于进程内后台，everyx、ogulcancelik 属于后台 RPC，nicobailon 使用独立 runner。它们都支持后台执行，区别在于退出、恢复和资源管理。mjakl、aefreedman、HamdiMaz 与官方示例均等待子任务完成才结束父工具调用。

## 版本与来源表

源码链接固定到不可变提交；registry、issue 和 CI 状态是研究日期当时的快照。CI 列记录研究期间查询到的上游状态，不是本机执行结果。检查到的候选都使用 MIT；fork 时必须保留原版权和许可证声明。

| 候选           | 包/发布事实                                                  | 固定源码                                                                                                                                                    | 运行形状                                                     | 上游 CI 观察                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ogulcancelik   | `@ogulcancelik/pi-codex-subagents` 0.3.5                     | [`9f2cae1`](https://github.com/ogulcancelik/pi-extensions/tree/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents)                        | detached Pi RPC child；文件持久化任务/session                | 未发现 `.github/workflows`                                                                                                                                                                         |
| nicobailon     | `pi-subagents` 0.67.0；研究时 npm latest 与源码 release 一致 | [`aa75b33`](https://github.com/nicobailon/pi-subagents/tree/aa75b3353836f7868898e3bd58234d21eaff1463)                                                       | detached runner、持久 artifact 和恢复                        | 固定 HEAD 的 unit/integration、Bun parity、Pi 0.85.0/0.85.1 smoke、Linux standalone receipt 成功；[run](https://github.com/nicobailon/pi-subagents/actions/runs/34438313918)                       |
| goofansu       | `pi-subagent` 2.0.1；可 Git 安装，registry 查询返回 404      | [`74dc62c`](https://github.com/goofansu/pi-subagent/tree/74dc62c5827ed727223fe533f656e35b329b48c2)                                                          | Effect runtime、Pi/Claude backend；内存 ResultStore          | 固定 HEAD Node22/npm 检查成功；观察到的 run 没有 Bun check，[run](https://github.com/goofansu/pi-subagent/actions/runs/34432951533)                                                                |
| j0k3r          | 源码 `package.json` 为 1.0.0；发布包 1.5.15 的 gitHead 相同  | [`ccde60b`](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/tree/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73)                                              | 进程内 Pi nested session；SQLite 任务/历史                   | 固定 HEAD Node24/npm [CI 通过](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/actions/runs/34251597810)；无目标主机验收                                                                       |
| tintinweb      | 源码 0.19.0；npm 0.19.0 使用不同 gitHead                     | [`e955e29`](https://github.com/tintinweb/pi-subagents/tree/e955e29c51b7a6cce37e1108cd2d6c57a77e151c)                                                        | 进程内 AgentManager/Pi session；可选 worktree                | 固定 HEAD CI 观察为成功；最新 Pi compatibility 为 `continue-on-error`，[run](https://github.com/tintinweb/pi-subagents/actions/runs/33753714643)                                                   |
| everyx         | `@everyx/pi-subagent` 1.3.6，tag `pi-subagent-v1.3.6`        | [`6cdaae3`](https://github.com/everyx/pi-extensions/tree/6cdaae394c0458fbce7947a7e8c95c51a9721a8e/packages/pi-subagent)                                     | detached Pi RPC process；持久 session/registry               | 固定 HEAD Node24/pnpm [CI 成功](https://github.com/everyx/pi-extensions/actions/runs/34119410582)；测试使用 fake RPC，非真实 Pi                                                                    |
| mjakl          | 源码包 3.0.3；npm latest 3.0.1 为不同 gitHead                | [`8e1b40b`](https://github.com/mjakl/pi-subagent/tree/8e1b40b51440804246e312ef2a27a6399ded3186)                                                             | foreground Pi RPC child；可选 named session 和 process group | 未发现 `.github/workflows`                                                                                                                                                                         |
| aefreedman     | `@aefree/pi-subagents` 0.8.1，tag `v0.8.1`                   | [`dab12e3`](https://github.com/aefreedman/pi-subagents/tree/dab12e3f13c47d054dd41b6a91c6f315c1215fe2)                                                       | foreground Pi JSON child；single/parallel/chain              | 固定 HEAD [Validation](https://github.com/aefreedman/pi-subagents/actions/runs/31274343347) 与 [release](https://github.com/aefreedman/pi-subagents/actions/runs/31274353575) 成功；Node22.19 矩阵 |
| HamdiMaz       | `pi-sub-agent` 0.1.5                                         | [`f1c0ae2`](https://github.com/HamdiMaz/pi-sub-agent/tree/f1c0ae29f4cf370255530d3d126ec71b0d7a6194)                                                         | foreground JSON child                                        | 有测试文件；无后台 registry                                                                                                                                                                        |
| andrea-tomassi | `pi-open-agents` 0.1.22                                      | [`9273b55`](https://github.com/andrea-tomassi/pi-open-agents/tree/9273b556726a5b86cce9159891094f8c4b3ecc8b)                                                 | foreground runner、primary-agent/OpenCode routing            | 不作为目标 acceptance 信号                                                                                                                                                                         |
| giuseppecrj    | `pi-herdr-agents` 1.7.0                                      | [`371265e`](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)                                                   | 外部 Herdr CLI、pane 和 worktree                             | 另有 live lane；需要不同环境                                                                                                                                                                       |
| Official Pi    | 研究中的官方上游示例；不是候选包                             | [`12f5933`](https://github.com/earendil-works/pi/blob/12f59336afa67af6e996cdb6f220f0bf4cbd571a/packages/coding-agent/examples/extensions/subagent/index.ts) | 简单 foreground JSON child                                   | 官方示例基线，不是后台验收                                                                                                                                                                         |

源码快照与 npm 发布物不一定相同。registry 分别记录 [mjakl 3.0.1](https://registry.npmjs.org/@mjakl/pi-subagent/3.0.1)、[tintinweb 0.19.0](https://registry.npmjs.org/@tintinweb/pi-subagents/0.19.0) 和 [j0k3r 1.5.15](https://registry.npmjs.org/pi-subagents-j0k3r/1.5.15)。前两者的发布 gitHead 与研究源码不同；j0k3r 的 gitHead 一致，但源码版本字段不同。Pi 支持 Git 与 npm 两种包来源，因此 npm 查询限制不影响 goofansu 作为候选。[官方包来源说明](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/packages.md#L1-L4)。

## 实现规模与维护范围

以下数据由本机 cloc 2.00 对上表固定源码提交统计。**代码行**去除注释和空行；**物理行**保留两者。文件数和最大文件只统计实现部分。静态类型和源码中内嵌的字符串计入代码。它们衡量需要阅读、修改的源码规模，不等同于圈复杂度、代码质量或已经实测的 fork 工时。

| 候选           | 实现代码行 / 物理行 | 实现文件数 | 最大实现文件：代码行                                                                                                                                                             | 测试与支撑代码行 / 文件数 |
| -------------- | ------------------: | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------: |
| Pi 官方示例    |       1,027 / 1,195 |          2 | [index.ts](https://github.com/earendil-works/pi/blob/12f59336afa67af6e996cdb6f220f0bf4cbd571a/packages/coding-agent/examples/extensions/subagent/index.ts)：917                  |                     0 / 0 |
| HamdiMaz       |       1,593 / 1,755 |          2 | [index.ts](https://github.com/HamdiMaz/pi-sub-agent/blob/f1c0ae29f4cf370255530d3d126ec71b0d7a6194/extensions/index.ts)：1,414                                                    |                 3,116 / 1 |
| aefreedman     |       2,652 / 2,988 |         11 | [index.ts](https://github.com/aefreedman/pi-subagents/blob/dab12e3f13c47d054dd41b6a91c6f315c1215fe2/extensions/index.ts)：1,383                                                  |                  813 / 10 |
| ogulcancelik   |       2,703 / 2,908 |          3 | [core.ts](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts)：1,736                                |                 1,121 / 3 |
| andrea-tomassi |       2,919 / 4,390 |         22 | [executor.ts](https://github.com/andrea-tomassi/pi-open-agents/blob/9273b556726a5b86cce9159891094f8c4b3ecc8b/src/subagent/executor.ts)：587                                      |                1,988 / 11 |
| everyx         |       3,142 / 4,404 |         18 | [preview.ts](https://github.com/everyx/pi-extensions/blob/6cdaae394c0458fbce7947a7e8c95c51a9721a8e/packages/pi-subagent/preview.ts)：974                                         |                1,821 / 14 |
| mjakl          |       3,463 / 4,106 |         11 | [index.ts](https://github.com/mjakl/pi-subagent/blob/8e1b40b51440804246e312ef2a27a6399ded3186/index.ts)：944                                                                     |                2,936 / 10 |
| j0k3r          |       7,560 / 8,225 |         59 | [manager.ts](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/blob/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73/src/manager.ts)：1,028                                            |                8,934 / 29 |
| giuseppecrj    |     10,339 / 11,577 |         19 | [index.ts](https://github.com/giuseppecrj/pi-herdr-agents/blob/371265e74fb7485afbfbc7c028d60dc4f98d2779/pi-extension/subagents/index.ts)：3,930                                  |               14,976 / 18 |
| tintinweb      |     12,217 / 20,929 |         56 | [index.ts](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts)：2,555                                                          |              28,542 / 115 |
| goofansu       |     16,351 / 25,644 |        112 | [agent-tool-renderers.ts](https://github.com/goofansu/pi-subagent/blob/74dc62c5827ed727223fe533f656e35b329b48c2/extensions/subagent/presentation/agent-tool-renderers.ts)：1,544 |              42,456 / 125 |
| nicobailon     |     90,437 / 99,741 |        283 | [subagent-executor.ts](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/src/runs/foreground/subagent-executor.ts)：6,953                 |             107,765 / 298 |

实现范围是包内 Git 跟踪的 TypeScript/JavaScript 入口和运行源码，包括随包提供的启动、安装脚本。ogulcancelik 和 everyx 只统计对应 package 目录，不计 monorepo 的其他包。nicobailon 计入 `index.ts`、全部 `src/` 和根目录四个 `.mjs` 文件；j0k3r、andrea-tomassi 计入 `index.ts` 与 `src/`；tintinweb 为 `src/`；aefreedman 为 `extensions/` 与 `src/`；goofansu 为 `extensions/subagent/`；HamdiMaz 为 `extensions/`；mjakl 为根目录十一个源码文件；giuseppecrj 为 `pi-extension/`。官方基线只计示例的 `index.ts` 和 `agents.ts`，不计整个 Pi。

测试单列：计入 `*.test.*`、`*.spec.*` 文件，以及 `test`、`tests`、`testing`、`__tests__` 目录中的源码和支撑代码，排除 fixture 与 benchmark 目录。测试路径之外的开发脚本、lint/build 配置、示例、Markdown agents/skills/prompts、生成的依赖文件和外部运行时均不计入两栏。具体而言，nicobailon 复制的 Pi fixture 树、everyx 单独依赖的 `pi-ui` 和 Herdr 外部 CLI 均不在统计范围内。官方示例的 0 表示该示例范围内没有测试；测试行数不代表覆盖率或已经运行通过。

复现时，按上述范围选择 Git 跟踪的源码，分出实现与测试两组，将绝对路径逐行写入文件，执行 `cloc --config=/dev/null --quiet --json --by-file --skip-uniqueness --timeout=0 --list-file=<paths.txt>`。内容相同的不同文件仍分别计数。已逐文件核对代码、注释、空行之和与物理行数一致。首次统计有四个测试文件超过 cloc 默认过滤超时；对受影响的两个测试组取消该超时后，补算成功。本次没有执行候选代码。

这些数字使 fork 的取舍更明确。ogulcancelik 只有 2,703 行代码，但 `core.ts` 占 1,736 行、约 64%；只有三个文件并不能说明职责拆分合理。everyx 总量接近，为 3,142 行、18 个文件；j0k3r 为中等规模的 7,560 行。goofansu 的 25,644 个物理行中有 16,351 行代码，同时列出两种口径可以区分实现与注释、空行。nicobailon 有 90,437 行代码，约为 ogulcancelik 整包的 33.5 倍，最大文件单独就有 6,953 行代码。更宽的功能范围解释了部分实现规模；大量测试单独计数，也需要维护。整体 fork 会带入显著更多需要理解、维护的代码。这些数据支持先验证较窄的 fork，同时有针对性地参考大型实现。

## 能力矩阵

| 需求                | ogulcancelik                                        | nicobailon                                   | goofansu                              | j0k3r                                    | tintinweb                             | everyx                       | mjakl                             | aefreedman                     |
| ------------------- | --------------------------------------------------- | -------------------------------------------- | ------------------------------------- | ---------------------------------------- | ------------------------------------- | ---------------------------- | --------------------------------- | ------------------------------ |
| 新鲜 child 上下文   | 是；独立 child session、受控资源                    | 是；fresh 或过滤后的 fork context            | 是；独立 AgentSession                 | 是；nested session                       | 是；独立 session                      | 是；独立 process/session     | 默认是；可选 parent snapshot      | 是；固定 no-session            |
| 真后台返回          | 是；task ID 和 completion mailbox                   | 是；detached runner 和 watcher               | 是；Run ID 和后台 fiber               | 是；`mode=background`                    | 是；manager `spawn()` 返回 ID         | 是；`run_in_background`      | 否；父端等待 calls                | 否；父端等待 calls             |
| status/wait/result  | `list`、`wait_agent`、`wait_all_agents`、持久 info  | status artifact、wait、watcher               | status/result 工具，但 store 只在内存 | status/result/list 工具                  | result 工具和 manager 状态            | ID、wait chain、notification | 聚合结果                          | 聚合结果                       |
| steer               | active child steer、settled session restart         | control channel/steer                        | Pi backend 原生 steer                 | 有界 message bridge                      | `steer_subagent`；stop 为 UI/RPC      | `agent_send` 直达 child      | 无后台 steering API               | 无 continuation API            |
| stop/cancel         | interrupt、RPC abort、process-group fallback        | stop/interrupt、stale-run reconciliation     | abort/clearQueue/waitForIdle          | 两阶段 stopping/cancelled                | AbortController；stop 为 UI/RPC       | stop、shutdown registry      | AbortSignal/process group         | direct-child SIGTERM/SIGKILL   |
| reload/restart 恢复 | info JSON、ownership reconciliation；mailbox 有边界 | canonical status/events/result artifact      | 否；runtime/store 会清空              | SQLite task/event、orphan reconciliation | session file/tombstone；进程仍在父端  | session file 保留；硬崩未知  | 仅 named session，可能 stale lock | 无持久 task registry           |
| 只读强制            | template 工具选择；无完整 OS sandbox                | reviewer plan 可 fail closed；需 host policy | tool list，无 read-only 字段          | 只有 allowlist；bash 仍有能力            | tool/session policy，无 shell sandbox | tool list；扩展继承宽        | `tools`/`noTools`                 | `tools` 并剥离 delegation 名称 |
| 现有 cwd            | 是                                                  | 是，另有可选 worktree                        | session options 携带 cwd              | runner 接收 cwd；不创建 worktree         | manager/worktree isolation 也可用     | call 传 child cwd            | per-call cwd                      | per-task cwd                   |
| model policy        | Pi provider/model 配置                              | Pi model catalogue/profile                   | model catalogue；双 backend           | model/effort 配置                        | model/thinking profile                | caller 选择                  | provider-agnostic inheritance     | GPT-5.6 硬 allowlist           |
| Bun/目标证据        | 无                                                  | 观察到的 standalone 证据最强，但不是目标仓库 | 无 Bun gate                           | 只有 Bun SQLite fallback                 | Node CI，latest 为 soft canary        | Node24 CI，peer 排除 0.85.1  | Node-oriented                     | Node22.19 CI                   |

## 生命周期与后台语义

### 前台子进程基线

官方 Pi extension 示例用 `--mode json -p --no-session` 创建 child，从临时文件追加 system prompt，发送 task，解析 JSONL 并等待进程关闭。它支持 single、parallel、chain，但没有 task registry、持久 result artifact 或跨调用 status。这个源码适合说明 Pi 设计的 child invocation seam，不应被当作后台编排实现。[官方示例](https://github.com/earendil-works/pi/blob/12f59336afa67af6e996cdb6f220f0bf4cbd571a/packages/coding-agent/examples/extensions/subagent/index.ts#L249-L426)。

HamdiMaz 是这个基线的小型变体：使用 JSON/no-session，将 child 工具集与 parent active tools 求交，通过 stdin 接收 task，并以 TERM/KILL 终止 direct child。它把 parallel/chain 限制为 8、depth 限制为 1，但没有独立 runner 或 result registry。[源码](https://github.com/HamdiMaz/pi-sub-agent/blob/f1c0ae29f4cf370255530d3d126ec71b0d7a6194/extensions/index.ts#L39-L58)。

mjakl 是明显加固过的 foreground 实现。它最多接收 8 个 call、最多 4 路并发；每个 call 可选 `empty` 或特殊的 `parent` context、逻辑 named session、cwd、inactivity timeout 和 absolute timeout。[契约](https://github.com/mjakl/pi-subagent/blob/8e1b40b51440804246e312ef2a27a6399ded3186/contract.ts#L25-L83)。Unix child 进入 detached process group；取消和 timeout 向 group 发 signal，再升级到 SIGKILL。它解析 RPC settlement event，assistant capture 上限 5 MiB，模型侧输出遵守 Pi 的 50 KB/2000 行约定。[runner](https://github.com/mjakl/pi-subagent/blob/8e1b40b51440804246e312ef2a27a6399ded3186/runner.ts#L491-L518)、[termination](https://github.com/mjakl/pi-subagent/blob/8e1b40b51440804246e312ef2a27a6399ded3186/runner.ts#L585-L705)、[capture](https://github.com/mjakl/pi-subagent/blob/8e1b40b51440804246e312ef2a27a6399ded3186/runner-events.js#L90-L150)。但 `executeCalls()` 仍通过 bounded concurrency 等待每个 `runAgent()`，所以它是可靠的 foreground call，而不是 detached task system。named session 有持久化和 lock，却没有跨本次 invocation 的独立 task ID。

aefreedman 比官方示例有更丰富的 frontmatter 和治理：single、parallel、chain、output contract、package agent registration、project trust fallback 和 child-extension containment。但执行路径仍构造 `--mode json -p --no-session`，以普通 pipe spawn，解析 message event，等待 close。[执行](https://github.com/aefreedman/pi-subagents/blob/dab12e3f13c47d054dd41b6a91c6f315c1215fe2/extensions/index.ts#L477-L705)。child 没有 detached，取消只 kill direct process；没有源码证据证明 descendants 会被清理，也没有 timeout watchdog、持久 child session 或跨调用后台 registry。它把模型硬编码为三个 OpenAI Codex GPT-5.6 identifier，对 provider-neutral stable Pi 是必须重做的 fork 策略。[模型策略](https://github.com/aefreedman/pi-subagents/blob/dab12e3f13c47d054dd41b6a91c6f315c1215fe2/src/execution-profile.ts#L1-L76)。

### 进程内后台 manager

tintinweb 在父进程内为每个 child 建立独立 Pi `AgentSession`。`AgentManager.spawn()` 返回 ID，分离 foreground/background pool，后台池满时排队，并在清理完成后才 settle record。[manager](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L430-L705)。它持久化 session 和 transcript，并保留 tombstone 用于 resume。这是可信的进程内后台设计，但父进程失败会带走 session；worktree 功能从 HEAD 开始，因此看不到 parent 未提交 diff。[worktree](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/worktree.ts#L1-L117)。stop 通过 UI/RPC 存在，LLM-facing 工具则提供 result 和 steer，没有直接 stop 工具。workflow、mentions、scheduler、FleetView 和 dynamic-extension 面使完整 fork 对首个切片过宽。

goofansu 是完整 Effect runtime，不是薄 extension。Pi backend 持有长期 AgentSession，支持 prompt、steer、abort、idle wait 和 terminal transcript snapshot，并提供 typed backend seam。[backend session](https://github.com/goofansu/pi-subagent/blob/74dc62c5827ed727223fe533f656e35b329b48c2/extensions/subagent/backend/pi/session.ts#L21-L59)。`agent_start` 和 `agent_resume` 返回 ID，执行在后台 Effect fiber 中进行。admission 将 active run 限制为 8，并限制 control、observation 和内存 result。[runtime policy](https://github.com/goofansu/pi-subagent/blob/74dc62c5827ed727223fe533f656e35b329b48c2/extensions/subagent/runtime/policy.ts#L53-L128)。它对 recovery-oriented 产品的弱点也写得清楚：`ResultStore` 是内存实现，shutdown 会清空；宿主重启会丢失运行时任务索引和存储结果，包括尚未交付的完成结果。[ResultStore](https://github.com/goofansu/pi-subagent/blob/74dc62c5827ed727223fe533f656e35b329b48c2/extensions/subagent/runtime/result-store.ts#L1-L24)。它是最好的同 Effect lifecycle arbitration 参照，但不自动成为最佳首个 fork。

### Detached 与持久任务 manager

ogulcancelik 是最直接的匹配。`spawnAgent()` 为每个任务创建 UUID、session JSONL、info JSON 和 log，并放在 parent-session scope 下；child 使用显式 cwd 和 detached `--mode rpc`。[任务创建](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L1135-L1219)、[启动](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L1222-L1251)。它提供 task list、wait、wait-all、steering 和 interrupt；settled session 可以 hibernate，再从同一 JSONL 重启。进程 info 带 owner token 和 Linux identity check，可降低 PID reuse 误杀。[ownership](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L620-L667)。它最适合作为窄首轮实验，但当前源码没有显式深度上限，模板若重新启用委派扩展，就不能只依靠默认资源关闭策略，边界大量使用 `any`，默认根目录是私有的，但并非所有文件都显式设置权限，且 model-response timeout 不覆盖 tool execution。它的 `process.execPath`/`argv[1]` launcher 也没有在 Bun 编译 Pi binary 上验证。

另有四个具体边界需要验证：RPC 解码器没有单行大小上限；管理器没有活跃子代理数量上限；interrupt 会先写终态，再确认进程终止；进程清理在 `exit` 事件中销毁 stdout 监听，因此需要验证末尾事件是否已经读完。前两项是资源限制缺口，后两项是状态和退出时序问题；本次并未在目标主机复现输出丢失。[解码器](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L931-L955)、[管理器](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L995-L1008)、[中断](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L1788-L1850)、[进程清理](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L1286-L1346)。

nicobailon 是最强的运维参照。父端写 runner 配置和 status sidecar，启动 detached runner，完成 startup/ack handshake 后返回；runner 创建 child session，写 status/events/transcript/output 并发布 result。watcher/poller 负责完成交付，canonical artifact 允许 reload 恢复。[async execution](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/src/runs/background/async-execution.ts#L398-L448)、[runner lifecycle](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/src/runs/background/async-execution.ts#L540-L748)。它有 fork/fresh context、有界 control message、stale-run reconciliation，并清楚区分 process-terminal proof 和 execution success。它还有本次观察到的最强宿主证据：固定 HEAD 的 CI 中，checksum-pinned binary、Pi 0.85.0/0.85.1 smoke 和 Linux standalone matrix 均成功。但这仍是上游 CI，不是新项目主机的 acceptance。

代价是集成面。`async-execution.ts` 超过 2000 行，extension entry 超过 1000 行，外围还有 missions、workflow、scheduler、external jobs、intercom、TUI 和 worktree。正确用法是抽取 single-level background runner、artifact、control protocol 和 recovery 规则，而不是整体合并它的 runtime。它的只读能力也仍然是 host 决策：reviewer/scout plan 可以 fail closed，但 fork 必须真正执行 tool allowlist。

everyx 有清楚的 detached RPC/process 模型和持久 continuation。root call 可以设置 `run_in_background`；完成通过 wait chain 和 follow-up notification 交付。persistent child 保持 idle，`agent_send` steering 同一个 context。[后台返回](https://github.com/everyx/pi-extensions/blob/6cdaae394c0458fbce7947a7e8c95c51a9721a8e/packages/pi-subagent/index.ts#L634-L655)、[持久 process](https://github.com/everyx/pi-extensions/blob/6cdaae394c0458fbce7947a7e8c95c51a9721a8e/packages/pi-subagent/agent-process.ts#L195-L215)。它的 request correlation、UTF-8 framing，以及 1 MiB JSON line/64 KiB stderr 上限很适合复用。问题是 package peer `^0.84.0` 排除 Pi 0.85.1；child 还会加载 Pi 默认扩展环境，没有窄的 inherited-extension policy，nested delegation 也没有 depth 或 concurrency cap。它适合在完成兼容和策略修改后作为协议参照，不适合原样接入。

j0k3r 在进程内候选中提供最明确的 task API：run、continue、send message、status、result、list、cancel。它使用 `queued`、`running`、`stopping`、`completed`、`failed`、`cancelled`、`interrupted` 状态，把 task/attempt/event history 写入 SQLite，并支持 `task` 与 `background` mode。[工具与状态](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/blob/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73/src/types.ts#L1-L4)、[history](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/blob/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73/src/history.ts#L21-L39)。有界 steering bridge 和两阶段 cancel 值得保留。它会过滤 `subagent_*` 工具以阻止嵌套委派；continue 是继续同一任务的后续运行，与嵌套委派不同。它不创建 OS runner 或 worktree；cwd 传给 Pi nested session，适合由 host 管理已有 worktree。只读仍是策略缺口，因为允许的 `bash` 可以写文件。公开 Issue #25 报告 Pi 0.85.1 上可能有 CJK/emoji completion-card 宽度问题；这是未验证的用户报告，不能写成已确认缺陷。[Issue #25](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/issues/25)。

## 其他候选的源码筛查

`andrea-tomassi/pi-open-agents`（0.1.22，MIT，[`9273b55`](https://github.com/andrea-tomassi/pi-open-agents/tree/9273b556726a5b86cce9159891094f8c4b3ecc8b)）是带 primary-agent 和 OpenCode permission routing 的 foreground executor。executor 有窄 permission whitelist，default runner 启动 child 后只发送 SIGTERM；虽然有 session-dir/resume 参数，tool call 仍等待 runner。它适合参考 permission 词汇和 routing，不是目标后台生命周期的基础。[executor](https://github.com/andrea-tomassi/pi-open-agents/blob/9273b556726a5b86cce9159891094f8c4b3ecc8b/src/subagent/executor.ts#L152-L179)。

`giuseppecrj/pi-herdr-agents`（1.7.0，MIT，[`371265e`](https://github.com/giuseppecrj/pi-herdr-agents/tree/371265e74fb7485afbfbc7c028d60dc4f98d2779)）通过外部 Herdr CLI 委派，并用 shell command 配置 pane/worktree。它有真实 Pi/fake-provider integration 材料，但 pane/mux 和 worktree 假设会引入目标不需要的环境。它适合参考 live lane 和进程集成，不是窄 Pi fork 基础。[launcher](https://github.com/giuseppecrj/pi-herdr-agents/blob/371265e74fb7485afbfbc7c028d60dc4f98d2779/pi-extension/subagents/launch.ts#L1-L120)。

## context、工具、worktree 与 nested 限制

新鲜 context 不等于安全。mjakl 的默认 empty context 和 aefreedman 的固定 no-session 会避免 parent transcript authority，但仍继承足够多的 Pi 环境，需要显式工具策略。nicobailon 会过滤 orchestration artifact；ogulcancelik 默认关闭 extensions、skills 和 context files，但模板可以显式加载工具/扩展；j0k3r 的 lean resource mode 收窄 handler，却仍可使用 bash；everyx 继承正常 Pi extension discovery；官方示例也使用普通 child runtime。这些策略不同，不能无意混合。

首个 `pi-stuff` vertical slice 的 reviewer/scout 定义应根据 host inventory fail closed，例如只允许 `read`、`grep`、`find`、`ls`。策略应拒绝缺失工具，拒绝 `edit`、`write`、可写 shell 的 `bash`、任意 extension loading 和 nested delegation。这是 host 强制的选择。没有候选提供完整 OS sandbox，也没有 reviewer prompt 能建立 sandbox。

只允许文件读取工具的 reviewer 仍需要明确输入：base/head 标识，以及提供给它的 diff 或经过批准的只读 Git 访问方式。仅删除 bash，却不提供这些输入，会妨碍实际 diff 审查。新对话还需要显式加载适用的项目指令；ogulcancelik 默认传入 `--no-context-files`，因此这属于必要的集成工作。

目标要求已有 worktree，也说明首轮不应导入 worktree 创建。tintinweb 和其 workflow 从 HEAD 创建 worktree，适合 implementation agent，却看不到 parent 的 staged/unstaged 改动。nicobailon 有 worktree/task 集成，ogulcancelik 和 j0k3r 则自然接受调用方 cwd。调用方传入已有任务 worktree 的绝对路径即可，不需要增加 worktree 管理器。review 未提交改动时应刻意使用当前 checkout 或显式 patch；从 HEAD 新建的干净 worktree 不是正确输入。

首版若限定单层委派，就应保留明确的递归边界。mjakl 有深度和循环检查；aefreedman、j0k3r 过滤委派工具名称；goofansu 在子 session 资源加载期间禁用自身注册；everyx 允许没有深度上限的嵌套委派；tintinweb 支持显式嵌套权限。ogulcancelik 默认关闭子扩展，但模板可重新启用；官方示例也保留普通扩展加载。继续已有 session 与创建孙代理是两个不同能力。

取消等待、取消运行、继续对话与崩溃恢复需要分别定义。goofansu 将等待的 AbortSignal 与 Run 取消分开，并协调结果消费和完成通知；它的结果存储随 session 消失，但已发送给父代理的答案仍可能留在 Pi 自己的对话记录中。ogulcancelik 会保存最终 info，并能继续已完成子代理的对话；父进程死亡后的状态恢复不等于保证活跃子代理跨父进程退出继续运行。nicobailon 则分别记录执行完成和已观察到的进程退出。[goofansu 等待](https://github.com/goofansu/pi-subagent/blob/74dc62c5827ed727223fe533f656e35b329b48c2/extensions/subagent/host/tools.ts#L194-L223)、[ogulcancelik shutdown](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/core.ts#L1853-L1878)、[Pi abort/queue 契约](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/rpc.md#L109-L141)。

## model/provider 可移植性

目标是 stable Pi 主机，因此 provider 选择应留给 host/catalog。mjakl 继承 parent effective provider/model，并接受 per-call override。j0k3r、tintinweb、everyx 和 nicobailon 也通过 Pi 配置或 caller profile 解析。aefreedman 只硬编码三个 OpenAI Codex GPT-5.6 identifier，并在启动前拒绝其他选择；这个策略不应作为 fork 行为带入。goofansu 的双 backend 有架构价值，但 Pi-only fork 不应仅因为它存在就带入 Claude 面。ogulcancelik 的显式 provider/model template 字段有参考价值，但 launcher 和 catalogue 仍需目标主机验证。

## 依赖、TypeScript、Bun 与 Effect

下表区分额外运行依赖与 Pi peer。“未声明额外依赖”仍需要 Pi 宿主及其内置 API，不代表没有运行条件。

| 候选         | 额外运行依赖                                         | 一手证据                                                                                                                                       |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ogulcancelik | 未声明额外依赖                                       | [包清单](https://github.com/ogulcancelik/pi-extensions/blob/9f2cae165dabf66a62f1579c3422bce21133bb9d/packages/pi-codex-subagents/package.json) |
| nicobailon   | pi-server 0.85.0、jiti、yaml、acorn、undici、typebox | [包清单](https://github.com/nicobailon/pi-subagents/blob/aa75b3353836f7868898e3bd58234d21eaff1463/package.json)                                |
| goofansu     | Effect 4.0.0-rc.112 与 Claude Agent SDK              | [包清单](https://github.com/goofansu/pi-subagent/blob/74dc62c5827ed727223fe533f656e35b329b48c2/package.json)                                   |
| j0k3r        | 未声明额外依赖；使用运行时提供的 Node/Bun SQLite     | [包清单](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r/blob/ccde60b51e5ab9ae5ff9ea0bd3eb6bae1eae7c73/package.json)                       |
| tintinweb    | @sinclair/typebox、typebox、croner、nanoid           | [包清单](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/package.json)                                 |
| everyx       | @everyx/pi-ui 1.1.2；发布物 Pi peer 为 ^0.84.0       | [已发布 1.3.6 元数据](https://registry.npmjs.org/@everyx/pi-subagent/1.3.6)                                                                    |
| mjakl        | 未声明额外依赖                                       | [包清单](https://github.com/mjakl/pi-subagent/blob/8e1b40b51440804246e312ef2a27a6399ded3186/package.json)                                      |
| aefreedman   | @aefree/pi-capability-registry                       | [包清单](https://github.com/aefreedman/pi-subagents/blob/dab12e3f13c47d054dd41b6a91c6f315c1215fe2/package.json)                                |

everyx 先前“零运行依赖”的介绍与 1.3.6 发布元数据不一致。goofansu 与本项目使用相同 Effect 版本，能减少框架适配，但是否带入 Claude SDK 仍是单独的产品选择。应保留一个候选完整的生命周期并有目的地缩减范围，而不是整体复制依赖清单。

没有候选已经完全符合目标 toolchain。foreground package 使用 Node builtin 和 TypeBox，脚本主要面向 Node/npm。nicobailon 对 npm Pi 使用 Node runner，对 standalone binary 使用独立 bootstrap；j0k3r 在进程内运行 session，并提供 Bun SQLite fallback。ogulcancelik 使用 `node:child_process`、`fs`、`net`、`os`、`path` 和 timers；package 声明 Node 22.19+，没有 Bun engine 或 compiled-runtime test。everyx 的 Pi peer 范围排除 0.85.1。aefreedman 要求 Node 22.19，并带 `@aefree/pi-capability-registry`。tintinweb 的开发基线是 Pi 0.84.2，peer 范围为 >=0.84.0，并不排除 0.85.1。mjakl 使用 RPC，官方示例使用 JSON print mode，但也不是 Effect 代码。

goofansu 是唯一深度候选，其 runtime 已经使用 Effect 4。这使它的 typed lifecycle 和 scope/finalizer 模式直接相关，但不意味着整体 fork 成本低。实际选择是保留 goofansu 的进程内状态机，还是保留 ogulcancelik/nicobailon 的 detached artifact lifecycle，然后用 Effect 4 重写边界。首轮应靠窄 vertical slice 判断，而不是只做全包 typecheck。

## 测试与 CI：已知范围

本次没有在本机安装候选依赖或运行候选测试。下文的“测试”指源码树里存在的测试；“CI”指研究期间查询到的上游 workflow。两者都不表示 `pi-stuff` 已通过。

nicobailon 的上游 CI 证据最强：固定 HEAD 的 unit/integration、Bun workflow parity、Pi 0.85.0/0.85.1 smoke 和官方 standalone Linux matrix 在查询的 run 中成功。goofansu 固定 HEAD 的 Node22/npm 检查成功，但观察到的 workflow 没有 Bun matrix。tintinweb 的 run 成功，latest Pi compatibility 标为 `continue-on-error`。j0k3r 的测试文件覆盖 real-process cancellation、history、status/result/cancel/continue tools 和 Bun SQLite fallback，但 CI 目标是 Node24，未观察到目标 acceptance。everyx 测试覆盖 fake RPC framing 和 persistent lifecycle，没有真实 Pi。mjakl 有 Node 测试，覆盖 runner、events、locks 和 rendering，但未发现 GitHub workflow。aefreedman 在 Ubuntu、Windows、macOS 上用 Node 22.19 执行 npm test 和 package packing。

官方示例和 HamdiMaz 是 contract 参照，不是生产证据。goofansu 的 conformance 使用 scriptable stand-in session；它的 live smoke 需要真实 Pi、model 和 credentials，但查询到的 CI 没有建立目标 Bun acceptance。ogulcancelik 的测试覆盖 lifecycle、RPC、completion/wait 和 overlay，使用 fake RPC child，且未发现 workflow。因此下一步必须在真正的 Bun 编译 Pi 0.85.1 进程上验收，而不只是 mock child。Pi 0.85.1 的 RPC 文档还要求区分 prompt 接收与完成，并检查 abort/idle 及取消时尚在队列中的 steering。[RPC 文档](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/rpc.md#L39-L67)。

## 选择与下一步验收

建议顺序是有条件的，而且保持窄范围：

1. 将 `ogulcancelik/pi-codex-subagents` 作为首个验证候选。保留 task artifact、detached runner、process ownership、wait/result、interrupt 和 session resume seam；首轮去掉 overlay 和宽泛 template 能力。
2. 为 Bun 编译 Pi binary 建立由 host 管理的 launch adapter。不要假设编译后 `process.execPath` 加 `argv[1]` 仍然有效；支持显式、可验证的 launcher，并避免把 credentials 写进记录。
3. 用严格 TypeScript 和 Effect 4 在 JSONL RPC、Pi event、task-info 和 result-file 边界解码实际需要的字段。替换边界上的 `any`，让 malformed/oversized input 成为 typed failure。
4. 显式接收已有任务 worktree 的绝对 `cwd`。首轮不要创建新 worktree。保留当前 working-tree review 与干净 HEAD checkout 的区别。
5. 在 runtime tool registration 中强制只读 profile。证明 reviewer/scout child 无法加载 edit/write/bash-capable tool 或 delegation extension；继续关闭 nested delegation。
6. 验证子代理后台启动后父代理能继续工作，以及状态、结果获取、steering、中断、父 session reload 和父进程退出。分别定义取消等待与取消子代理的效果；覆盖待投递 steer 与 abort 并发、终止失败，以及短命子进程退出前的末尾事件。
7. 限制 RPC 单行、活跃代理数和结果大小；保留所有权恢复，并按需要补全整个运行过程的超时。验证文件权限、异常 EOF 和长输出。
8. 在已有任务 worktree 中验证该切片，稳定安装仍从 main 加载。只有首选实验暴露出结构性不匹配，才转向 nicobailon 或 goofansu。

验收问题不是“哪个仓库功能最多”，而是所选窄核心能否在真实 Bun Pi 主机上立即返回持久 task identity、使用正确已有 cwd、执行真实只读策略、承受取消和 parent reload，并收集有界结果。当前判断是：ogulcancelik 最适合作为首个实验，nicobailon 是最强的 standalone/recovery 比较基线，goofansu 是最相关的 Effect-native 替代。尚未采用任何 fork。

## 来源与证据状态

行内链接构成本文来源目录：不可变 GitHub 源码、package metadata、license、官方 workflow，以及 j0k3r 的一条未验证 issue。源码事实、观察到的上游 CI、本机 runtime acceptance 明确分开。本次没有执行候选测试或安装候选依赖，也没有建立 Bun 1.4 或 Pi 0.85.1 对新项目的兼容性结论。

完整比较按范围排除了 `pi-stuff-old`。没有创建 ADR、添加依赖、修改候选、发布包，也不表示 fork 已获批准。
