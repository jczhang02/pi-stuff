# AgentMemory 是否应替代 pi-hermes-memory

**审计日期：** 2026-08-01  
**目标 Host：** Pi 0.83.0  
**结论：** 不替代。Pi Stuff 的第一版长期记忆仍以 `pi-hermes-memory@0.9.2` 的 owned fork 为基础；AgentMemory 作为行为、检索与迁移参考，并保留日后提供可选兼容桥的可能。

## 一句话判断

你以前确实使用过真正的 AgentMemory，但使用方式不是“安装了一个成熟的 Pi memory Package”：

- 后端是独立运行的 `@agentmemory/agentmemory@0.9.27` 服务；
- Pi 端是旧配置仓库中自行维护的专用 connector；
- 该 connector 把每轮对话自动写入服务，并在每次新请求前自动搜索；
- 当前实测暴露出跨项目混搜、约 1 秒检索延迟、噪声命中、session 生命周期没有闭合等问题。

AgentMemory 的能力远多于 Hermes，但它实际上是“常驻服务 + 独立引擎 + REST/MCP + Web Viewer + Pi connector”的整套平台。只 fork connector 并不等于拥有这项能力；若遵守 Pi Stuff 的 owned-fork 规则，就要同时承担大型服务端及其 `iii-engine` 运行时。对 Pi Stuff 第一版而言，这个所有权边界过大。

Hermes 的现有自动记忆策略同样不适合直接使用，但它是较小的 Pi-native 存储与修改内核。我们可以 fork 后删除其周期性全文复盘，同时保留 Markdown、项目/全局作用域、replace/remove、秘密扫描和测试基础。这比把 AgentMemory 平台缩成 Claude Code 式安静记忆更稳妥。

## 调研边界

旧的 [`jczhang02/pi-agent`](https://github.com/jczhang02/pi-agent) 只用于确认用户可见行为、配置、提交历史和来源。没有读取、复述、移植或借用其 `extensions/agentmemory` 实现代码。

确认来源后，本报告独立审计了：

- 官方 AgentMemory 服务 [`rohitg00/agentmemory`](https://github.com/rohitg00/agentmemory/tree/v0.9.28)；
- 官方 npm 包 [`@agentmemory/agentmemory`](https://www.npmjs.com/package/@agentmemory/agentmemory)；
- 独立的 Pi Package [`@estebanforge/pi-agentmemory`](https://pi.dev/packages/%40estebanforge/pi-agentmemory)；
- 已选候选 [`pi-hermes-memory`](https://github.com/chandra447/pi-hermes-memory/tree/5aafe2ca04cb55b62204b159389c8381894038ce)。

## 你以前实际使用的是什么

### 后端身份

本机 Mise 配置固定了：

```text
npm:@agentmemory/agentmemory = 0.9.27
```

2026-08-01 的只读检查确认该服务仍在运行，健康接口返回 `agentmemory 0.9.27`。官方当前最新版是 `0.9.28`，发布于 2026-07-19。版本和发布时间来自 [npm registry](https://registry.npmjs.org/%40agentmemory%2Fagentmemory)。

本机配置启用了 graph extraction 和 consolidation，并为压缩配置了外部模型。因此，你过去体验到的是自动采集、搜索、图谱和整理均开启的 AgentMemory，而不是只提供 `remember`/`recall` 的轻量模式。

这也意味着“本地服务”不等于“所有处理都离线”：当前 consolidation 和 graph extraction 会把需要整理的内容交给已配置的 OpenRouter 模型。关闭这些功能可以收窄外发面，但也会放弃当前体验中的自动整理和图谱生成。

### Pi connector 身份

旧仓库提交 [`180816744a02`](https://github.com/jczhang02/pi-agent/commit/180816744a0245d21611dfc58747f7c9e341e168) 的提交说明明确写着从 Nowledge 切换到 AgentMemory；提交 [`400b5b9436be`](https://github.com/jczhang02/pi-agent/commit/400b5b9436be3c66281e03ea4785bcf60ebb2fba) 又调整了自动 recall 时机和 worktree 隔离。仓库树中该 connector 是三个 TypeScript 文件，没有自己的 npm manifest。

因此，它是你旧配置中的 bespoke connector，不是一个可以原样选入 Pi Stuff 的上游 Package。它可以说明你喜欢或不喜欢怎样的使用体验，但不能作为代码来源。

### 现在存在的独立 Pi Package

目前可 fork 的社区 connector 是 `@estebanforge/pi-agentmemory@1.0.6`。它是一个很小的 Pi Package，但只负责连接外部 AgentMemory 服务：

- npm 解包 47,051 bytes、7 个文件、无普通 runtime dependencies；
- MIT；
- 2026-07-02 至 2026-07-31 有 341 次 npm 下载；
- npm `gitHead` 是 [`765bfe69d3c4667642d6b463738cec16e4f41728`](https://github.com/EstebanForge/pi-agentmemory/commit/765bfe69d3c4667642d6b463738cec16e4f41728)；
- 仓库 HEAD 已前进到 [`e9c8cc4762dd6818070ddc386f489bd8ecaec7b5`](https://github.com/EstebanForge/pi-agentmemory/commit/e9c8cc4762dd6818070ddc386f489bd8ecaec7b5)，但没有 GitHub release 或 tag；HEAD 只新增了一个注册级 smoke test，尚未对应新的 npm 发布。

来源：[npm registry metadata](https://registry.npmjs.org/%40estebanforge%2Fpi-agentmemory)、[connector repository](https://github.com/EstebanForge/pi-agentmemory)。若未来 fork，必须固定 npm `gitHead` 对应的 tree，而不是含糊地写“fork main”，并单独记录后来 HEAD 的测试差异。

AgentMemory 主仓库也有一份 `integrations/pi` 参考 adapter，但 `@agentmemory/agentmemory@0.9.28` 的 npm 包没有包含它，`agentmemory connect pi` 仍只是提示用户从 GitHub 手工复制源码。它不能替代一个有发布、升级和兼容承诺的成熟 Pi Package。

## 具体使用体验对比

| 使用场景 | AgentMemory + Pi connector | 计划中的 Hermes fork |
| --- | --- | --- |
| 周一正常改代码 | 每轮对话自动成为 observation；更完整的宿主可捕获 prompt、工具输入、工具输出、失败和 session | 只在主 Agent 判断出现真正耐久事实时写一条小 memory；不存整轮工具流水 |
| 周五重新打开项目 | 每次请求先做 hybrid smart-search，再把结果注入模型 | 只在任务明显依赖过去选择时 recall；项目 index 小且可直接检查 |
| 说“记住使用 pnpm” | `memory_save` 写结构化 memory | 立即写项目 Markdown memory，并留下 `Saved 1 memory` 记录 |
| 说“现在改用 bun” | 相似度超过阈值时创建新版本并 supersede；否则可能并存 | 按明确 ID/冲突关系原子 replace，避免两条同权结论 |
| 查看记忆 | 浏览器 Viewer 可查看 memory/session/observation；另有底层 iii Console | `/memory` 使用 Pi Stuff 标准 Command Dialog；源文件也是普通 Markdown |
| 修改错误记忆 | Viewer 没有普通 edit；可调用 evolve API，或在 iii Console 中直接改 KV | Command Dialog 中 edit，或直接编辑 Markdown |
| 删除 | Viewer 可逐项永久删除；connector 提供强制确认的 delete tool | Command Dialog 删除并保留可恢复记录；不使用浮动确认窗 |
| 多项目/多 worktree | connector 以当前路径写 session，但 recall/save 没传 project；当前会跨项目混搜 | git common directory + canonical remote/path hash；同仓库 worktree 共享，异名/同名仓库不冲突 |
| 服务维护 | Pi 之外还要保持 AgentMemory worker、iii engine 和多个端口健康 | 随 Pi 启动的本地 Package，无额外 daemon |

## 自动写入策略

AgentMemory 官方主张“silently captures every tool use”。标准 pipeline 会保存原始 observation，做秘密正则过滤，生成 synthetic 或 LLM compression，随后建立 BM25/vector 索引；Stop/SessionEnd 还可总结 session，再做 graph/slot/consolidation。来源：[官方 pipeline 文档](https://github.com/rohitg00/agentmemory/blob/v0.9.28/README.md#memory-pipeline)、[observe 实现](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/observe.ts)、[consolidation 实现](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/consolidation-pipeline.ts)。

独立 Pi connector 没有捕获每个 Pi tool event，而是在 `agent_end` 把本轮 user prompt 和最后 assistant text 作为一条 conversation observation 自动写入；下一轮又自动调用 smart-search。它同时暴露显式 `memory_save`。来源：[connector README at npm gitHead](https://github.com/EstebanForge/pi-agentmemory/blob/765bfe69d3c4667642d6b463738cec16e4f41728/README.md)、[connector entry at npm gitHead](https://github.com/EstebanForge/pi-agentmemory/blob/765bfe69d3c4667642d6b463738cec16e4f41728/extensions/agentmemory/index.ts)。

这更接近此前已经排除的“自动 checkpoint/extraction”方案，而不是 Claude Code 式的“小而安静、在正常工作中按需写一条”。它的优势是几乎不用记得说“记住”；代价是采集面、噪声、成本、服务状态和调试面显著变大。

Hermes 上游当前同样会每若干 turns/tools 复盘 transcript，并在 compaction/shutdown 再 flush；这也不会原样保留。区别在于 Hermes fork 可以直接删掉这些 handler，只留下存储和原子修改内核。来源：[Hermes background review](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/handlers/background-review.ts)、[session flush](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/handlers/session-flush.ts)。

## 存储、可见性和可删除性

### AgentMemory

AgentMemory 把 sessions、observations、memories、indexes、audit、graph、lessons 等写入 iii file-based KV 和 stream store。memory 记录有版本、supersedes、strength、TTL、source observation IDs 和可选 project；observation 则按 session 存储。来源：[state schema](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/state/schema.ts)、[types](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/types.ts)、[remember](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/remember.ts)。

普通用户面对的并不是可编辑 Markdown：

- Viewer 能浏览和删除 memory，但当前没有普通编辑入口；
- `evolve` API 可以程序化创建新版本；
- iii Console 能直接 CRUD 底层 KV，但这是引擎管理界面，不适合作为 Pi Stuff 的日常 `/memory`；
- export/import 存在，但导出的是结构化数据库数据，不是日常维护的项目说明文件。

来源：[Viewer 文档](https://github.com/rohitg00/agentmemory/blob/v0.9.28/README.md#real-time-viewer)、[governance/delete](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/governance.ts)、[API implementation](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/triggers/api.ts)。

### Hermes

Hermes 使用项目/global Markdown 作为可读源，并用 SQLite 做搜索镜像；支持 add、replace、remove 和时间戳。它更接近 Claude Code 的“文件就是可审计界面”，也更容易在 Pi 内提供统一 Command Dialog。来源：[Hermes README](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/README.md)、[memory tool](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/tools/memory-tool.ts)。

Hermes 当前以 repository basename 作为 durable directory 名，会让两个同名 repo 冲突；这仍需在 owned fork 中改为 git common directory + remote/path hash。来源：[Hermes project detection](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/project.ts)。

## 项目和 worktree 作用域

这是 AgentMemory 当前最关键的产品缺陷。

AgentMemory 的 session 本身有 `project` 与 `cwd`，普通 `mem::search` 也能按 project/cwd 过滤。但 `mem::smart-search` 的 hybrid results 路径在 0.9.28 中没有按 project 过滤 observation hits；`project` 只被传给 lesson recall。来源：[regular search](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/search.ts)、[smart-search](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/smart-search.ts)。

更直接的是，独立 Pi connector 调用 `smart-search` 和 `remember` 时根本没有传 project。它只在写 conversation observation 时传 `process.cwd()`。所以：

- recall 会从所有项目中取 top results；
- 显式 memory_save 默认成为 unscoped memory；
- worktree 路径不同会被记录成不同 project；
- 当前行为既不是“同 repo worktree 共享”，也不是严格的项目隔离。

修 connector 还不够；要得到可靠作用域，必须同时修改 AgentMemory engine 的 smart-search/index 语义。这进一步证明 fork 所有权不能只停在 47 KB connector。

## 安全与隐私

AgentMemory 有实际的防护：

- observation 写入前删除 `<private>...</private>` 和一组常见 token/key 正则；
- REST 默认绑定 `127.0.0.1`；
- 可设置 bearer secret；远程 plaintext bearer 可警告或拒绝；
- delete/evolve/consolidate 等会写 audit；
- Viewer 使用 nonce CSP。

来源：[privacy filter](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/functions/privacy.ts)、[auth](https://github.com/rohitg00/agentmemory/blob/v0.9.28/src/auth.ts)、[official configuration](https://github.com/rohitg00/agentmemory/blob/v0.9.28/README.md#configuration)。

边界也必须说清楚：

- 正则过滤不是秘密检测保证；未知格式、短 token、普通敏感文本仍可能进入 observation；
- 自动 capture 的原始面包括 prompt、tool input/output 和错误，远大于“只保存一条耐久事实”；
- 未配置 `AGENTMEMORY_SECRET` 时，所有本地进程都可以调用 loopback API 读写数据；
- 当前本机实例未配置该 secret；
- 数据是本地 plaintext-ish KV/stream 文件，而非加密 store。
- 当前本机的 REST、stream 和 Viewer 分别只监听 loopback，但 `iii-engine` 的 `49134` WebSocket 实测监听 `0.0.0.0`；这需要在任何未来 owned deployment 中改为明确的本机边界。

Hermes 也只能把 secret/prompt-injection scanner 当 defense in depth，但它计划中的采集面更小：只存主 Agent 主动选择的一条 memory，不保存完整工具流水。来源：[Hermes content scanner](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/store/content-scanner.ts)。

## 当前本机实例的只读实测

没有读取或输出任何 memory 正文。只统计状态、数量、延迟和结果类别。

| 指标 | 2026-08-01 实测 |
| --- | ---: |
| 服务版本 | 0.9.27 |
| sessions | 82 |
| observations | 918 |
| memories | 283 |
| distinct project paths | 9 |
| session status | 82/82 都是 `active` |
| 两进程初次检查 RSS | 269,220 KiB |
| 加载并重复检索后的 RSS | 曾升至 678,424 KiB |
| smart-search 8 次延迟 | 627–1244 ms，中位数 963 ms |

质量抽查：

- 宽泛查询的 top 5 中有 3 条 decision-related 命中，也有 2 条普通 conversation noise；
- 一个具体的“为什么卡顿”查询没有命中已经存在的相关历史；
- 918 条 observation 在当前 Pi 接入下都是 `conversation / other`；283 条 memory 中没有一条带有 project、agent 或 source-observation 关联；
- connector 每次 turn 都要等待 recall 才能发起真正的模型调用，所以约 1 秒是用户请求的实际前置延迟，不只是后台统计；
- 82 个 session 全部停留在 `active`，与 connector 只 observe 而没有结束 session 的生命周期相吻合。

这不是一次完整 benchmark，不能证明 AgentMemory 的整体检索能力差；但它足以证明“当前这套你用过的配置”不能直接成为 Pi Stuff 的默认 memory 实现。

## 维护、采用量、测试和 license

固定统计窗口为 2026-07-02 至 2026-07-31；GitHub 数字为 2026-08-01 快照。

| 项目 | AgentMemory engine | EstebanForge Pi connector | pi-hermes-memory |
| --- | ---: | ---: | ---: |
| 当前审计版本 | 0.9.28 | 1.0.6 | 0.9.2 |
| npm 30 日下载 | 32,986 | 341 | 19,357 |
| GitHub stars / forks | 26,316 / 2,220 | 1 / 0 | 265 / 62 |
| 仓库创建 / npm 首发 | 2026-02-25 / 2026-04-05 | 2026-06 | 2026-04 |
| license | Apache-2.0 | MIT | MIT |
| npm 解包 | 5.82 MB / 169 files | 47 KB / 7 files | 1.02 MB / 80 files |
| 测试信号 | README 声称 1,428+；tag tree 有 133 个测试文件 | npm gitHead 无测试；repo HEAD 后加 1 个注册 smoke test | 本地 Pi 0.83 审计通过 40 files / 732 tests |

来源：[AgentMemory npm downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40agentmemory%2Fagentmemory)、[connector downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40estebanforge%2Fpi-agentmemory)、[Hermes downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-hermes-memory)、[AgentMemory repository](https://github.com/rohitg00/agentmemory)、[connector repository](https://github.com/EstebanForge/pi-agentmemory)、[Hermes repository](https://github.com/chandra447/pi-hermes-memory)。

AgentMemory 的采用量和开发速度显著更高，但它仍很年轻且变化很快：0.9.28 的 npm 时间线上已有 47 个版本，GitHub API 的 open issues/PR aggregate 为 428。高活跃度不能等同于“小而稳定、适合 owned fork”。

`0.9.28` 还有一个需要精确记录、但不构成内容风险的 provenance 细节：npm `gitHead` 是 `08f742c13b1813f04ef9ddf38a55b881c5e35792`，`v0.9.28` 标签解引用为 `6761a99ba1e609a9e2e4d5fda54e4b126def0a42`；两者的 Git tree 都是 `a4e382b68d2648001025a44da02f4401b6cbddc6`，内容 diff 为空。未来若 fork，应同时记录 tag commit、npm `gitHead`、tree hash 和 tarball integrity，而不是只写版本号。

## Pi 0.83 适配与 fork 成本

### AgentMemory

社区 connector 已使用 `@earendil-works/pi-*` namespace，API 形状与 Pi 0.83 接近；用户旧实例也证明基本 lifecycle 能运行。可是产品级 fork 至少必须同时拥有：

1. connector；
2. AgentMemory server；
3. state schema 与迁移；
4. search/index 行为；
5. pinned `iii-engine`；
6. worker 启停、崩溃恢复、端口和诊断；
7. Viewer 或重新实现 Pi-native `/memory`；
8. 旧 0.9.27 数据迁移。

官方 0.9.28 仍把 `iii-engine` 固定在 0.11.2，并明确说尚未适配 0.11.6 的 sandbox model。来源：[AgentMemory install/runtime note](https://github.com/rohitg00/agentmemory/blob/v0.9.28/README.md#from-source)。

只 fork `@estebanforge/pi-agentmemory` 会留下核心 memory engine 继续依赖上游 latest，违反“能力必须由 Pi Stuff 的 pinned fork 拥有”的规则。该 connector 甚至保留 `npx -y @agentmemory/agentmemory@latest` fallback；Pi Stuff 必须删除这种未固定 remote-code path。

### Hermes

Hermes 是单进程 Pi Extension。此前的本地审计把 Pi 依赖替换为精确 0.83.0 后，通过 TypeScript、40 个测试文件共 732 tests，并通过真实 Pi RPC Host 的加载/注册检查。它仍需较大修改，但修改集中在 memory module 内：写入策略、repo identity、UI、并发和恢复，不需要维护另一个常驻平台。

## 最终决定

### 第一版：保留 Hermes fork

采用 `pi-hermes-memory@0.9.2` 的 exact tag/commit 作为 owned fork 起点，但只保留：

- Markdown + SQLite search mirror；
- project/global scope；
- add/replace/remove；
- secret/prompt-injection scan；
- timestamps、migration、corruption recovery；
- 已有测试基础。

删除/重做：

- 周期性 transcript review；
- compaction/exit 总结；
- failure diary、skills/session archive 等外围能力；
- basename-only project identity；
- 现有 UI 和 emoji notification。

### AgentMemory：作为三个方面的参考

1. **行为参考：** source provenance、supersession、audit、health degradation、search result expansion。
2. **质量测试参考：** 用你现有 82 sessions 建立不读取正文的检索评测方法，衡量 recall latency、noise、miss 和跨项目泄漏。
3. **迁移来源：** 不删除当前 `~/.agentmemory`。以后做一次显式 importer，把用户选择的 durable memories 转入 Pi Stuff store；默认不导入 raw observations、完整 prompts 或 tool output。

### 暂不做

- 不 fork AgentMemory engine 作为第一版核心；
- 不直接依赖正在运行的 0.9.27 服务；
- 不采用 `@estebanforge/pi-agentmemory` 的 statusline、自动 global recall、硬浮动确认或 `@latest` auto-start；
- 不把 AgentMemory 的 53 tools、graph、team、actions、routines、viewer、replay 等扩张到“长期连续性”这个第一版能力里。

## 对原问题的直接回答

**技术上，AgentMemory 完全能覆盖 Hermes；产品上，它不应替代 Hermes 成为 Pi Stuff 第一版 fork。**

它比 Hermes 强大得多，也证明你确实重视“自动 recall”和“跨 session 不必重讲”；但当前实际使用质量、项目隔离、可编辑性、运行开销和 owned-fork 边界都不符合已经确定的 Pi Stuff 方向。

最合适的处理是：**Hermes 提供小而可拥有的内核；AgentMemory 提供行为参考、真实历史评测集和未来迁移入口。**
