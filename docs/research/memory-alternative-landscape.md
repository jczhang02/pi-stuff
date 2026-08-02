# Pi Stuff memory 备选研究

**调研日期：** 2026-08-01  
**目标 Host：** Pi 0.83.0  
**目的：** 在 `pi-hermes-memory` 与 AgentMemory 之外，寻找真正适合作为 Pi Stuff owned fork 的长期记忆底座或设计参考。

## 结论先行

> **2026-08-01 修正：** 本报告初版把 Mem0 的 Docker self-hosted platform 与可进程内嵌的 TypeScript OSS library 混在了一起，因而错误排除了 Mem0。深入审计后，Mem0 已被用户选为首选 owned-fork 底座；Hermes 是实现门槛失败时的回退，Engram 降为次级备选。完整纠正证据见 [`mem0-pi-stuff-fit.md`](./mem0-pi-stuff-fit.md)。

修正后的候选顺序是：

1. **Mem0 TypeScript OSS core + 官方 Pi plugin slice：首选底座。**
   它可以在 Pi 进程内运行，不需要 Python、Docker、Postgres 或 Dashboard，具备 semantic + BM25 + entity recall、CRUD 和 history。owned fork 必须把 `better-sqlite3` 移植到 `bun:sqlite`，并重做窄采集、纠错、项目隔离、秘密扫描和失败退化。
2. **Hermes：实现门槛失败时的回退。**
   它的 Markdown source of truth 更容易直接审计，fork 边界较小；如果 Mem0 的 Bun-native store、local embedding 或故障退化门槛失败，回到 Hermes。
3. **Engram + `gentle-engram`：次级替代候选。**
   它是一只 Go binary、SQLite + FTS5、已有 Pi connector 和 TUI，适合以后需要跨多种 Agent 共享同一 memory 的方向。
4. **`open-zk-kb`：最值得实装观察的 Pi-native 方案。**
   Markdown 是源数据，SQLite 与本地 embedding 可重建；产品形状很好，但项目太新、采用证据矛盾，不作为当前底座。

另外两个项目只应作为局部设计参考：

- **projectmem**：参考如何记录“问题 → 失败尝试 → 有效修复 → 决策”，避免另一个 Agent 重复走错路；它不是完整通用 memory。
- **Basic Memory**：参考人和 Agent 共用可编辑 Markdown 知识库；其 AGPL、Python 依赖与产品范围使 owned fork 成本过大。

因此，**本报告初版“不推翻 Hermes”的结论已经被后续 Mem0 审计和用户选择取代。** 下一步不再扩充候选名单，而是做一个可丢弃的真实 Pi/Bun 原型，验证 Mem0 的本地 SQLite driver、local embedding、项目隔离、纠错和失败退化。

## 我们比较的不是所有叫作 memory 的东西

这次把工具分为四类，避免把完全不同的产品混在一起：

| 类别 | 用户实际得到什么 | 是否能承担默认 memory |
| --- | --- | --- |
| 精炼的 coding memory | 几天后仍记得项目约定、重要修复、失败路线与偏好 | 是，主比较对象 |
| 长对话压缩与 session recovery | 当前对话太长时保住近期上下文 | 否，是补充能力 |
| 全量历史采集 | 保存 prompt、tool input/output，再后台压缩和检索 | 技术上可以，但已不符合当前产品方向 |
| 通用知识库或 Agent 平台 | 笔记、知识图谱、团队空间、完整 Agent runtime | 通常范围过大，不适合第一版 owned fork |

Pi Stuff 当前要的是第一类：默认安静、项目隔离、可检查、可纠正、可删除，不把整段工作流水当作记忆。

## 最终候选表

数据为 2026-08-01 快照；npm 下载统一使用 2026-07-02 至 2026-07-31 的固定窗口。下载量只表示包被下载的次数，不等于真实用户数或成熟度。

| 候选 | 具体使用形态 | 主要优点 | 主要问题 | 处置 |
| --- | --- | --- | --- | --- |
| [Mem0 TS OSS `3.1.3`](https://github.com/mem0ai/mem0/tree/ts-v3.1.3/mem0-ts/src/oss) + [官方 Pi plugin `0.1.4`](https://pi.dev/packages/%40mem0/pi-agent-plugin) | Agent 保存精炼事实；按项目做 semantic + keyword recall；`/memory` 查看、纠正和删除 | 成熟 core、完整 CRUD/history、hybrid recall、可进程内嵌、无需 daemon | 上游采集过宽且 ADD-only；Pi/Bun 不支持 stock `better-sqlite3`；scope、secret scan、telemetry 和失败退化需重做 | **首选 owned-fork 底座；先过真实 Pi/Bun 门槛** |
| [Engram v1.20.0](https://github.com/Gentleman-Programming/engram/tree/v1.20.0) + [`gentle-engram`](https://pi.dev/packages/gentle-engram) | Agent 主动保存精炼条目；下次按项目 search/context；可用独立 TUI 检查和删除 | 单 Go binary、SQLite/FTS5、CRUD、timeline、Pi connector、跨 Agent 共用 | 默认存用户 prompt；只有关键词检索；project identity 会撞名；HTTP 鉴权、Pi UI 和自动 capture 均需重做 | **次级备选** |
| [`open-zk-kb@1.4.2`](https://pi.dev/packages/open-zk-kb) | preference/decision/gotcha 成为原子 Markdown；新 session 自动加载 active project preferences | Markdown source of truth、本地 hybrid search、Pi-native compact renderer、项目边界清楚 | 只有 5 stars；需要 Bun 与 embedding；Pi 依赖仍在 0.80.10；缺少自然的 update tool | **Pi-native UX 参考** |
| [`@josephakern/pi-memory@0.3.0`](https://pi.dev/packages/%40josephakern/pi-memory) | 全局与项目各有小型 `MEMORY.md`，topic files 按需读；Agent 用普通文件工具编辑 | 零 runtime dependency，最接近 Claude Code 的简单文件模型 | 30 日仅约 120 下载；项目记忆默认写进 repo；writeback/journal 仍有复杂度 | **最小形态参考，不作底座** |
| [projectmem v0.2.0](https://github.com/riponcm/projectmem) | 记录 issue、attempt、fix、decision；修改前提醒过去失败路线 | typed event、append-only JSONL、repo-local、MIT | 很新；只有 substring search；MCP 使用规则过度强制；无 Pi package | **失败历史模块参考** |
| [Basic Memory v0.22.1](https://github.com/basicmachines-co/basic-memory/tree/v0.22.1) | 人和 Agent 共同编辑 Markdown 知识库，支持图谱与 hybrid search | 可读、可编辑、项目隔离、完整 CRUD，工程量与采用度较强 | AGPL-3.0；约 49 个 Python runtime dependencies；首先是知识库而非 coding memory | **书面备选，不作默认 fork** |

## 1. Engram：次级替代候选

### 实际使用是什么样

星期一，Agent 完成一次重要 bug 修复后，保存一条包含 What / Why / Where / Learned 的精炼 memory。星期五打开同一仓库时，Agent 搜索最近 context 或关键词，取回这条结论；用户可以在 `engram tui` 中查看时间线、修改或软/硬删除错误内容。

它不是 AgentMemory 或 claude-mem 那种原始流水仓库。官方流程是完成重要工作后调用 `mem_save`，随后以 SQLite FTS5 检索；官方提供 save/update/delete、search/context/timeline、session、review 与诊断等工具。[Engram 官方说明](https://github.com/Gentleman-Programming/engram#how-it-works)

### 为什么值得认真验证

- `v1.20.0` 为 MIT；核心与 Pi connector 在同一仓库和 tag 中，owned-fork 边界可以固定。
- 官方已有一等 Pi package。Pi extension 使用本地 HTTP server，Pi-native `mem_*` tools 不依赖通用 MCP gateway；本地 SQLite 仍是 source of truth。[`gentle-engram` Pi 文档](https://pi.dev/packages/gentle-engram)
- GitHub 快照为 5,786 stars、615 forks、391 commits；`gentle-engram` 固定 30 日 npm 下载为 [7,027](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/gentle-engram)。这是本轮候选中最强的外部采用信号。
- 独立 Agent 对官方 Linux amd64 release 的隔离实测：压缩包约 7.2 MB，binary 约 19 MB；空闲 RSS 约 15.6 MB，写入少量测试数据后约 17.7 MB；本机 save/search/context/timeline 大致为 0.8–2.2 ms。这证明本地 engine 本身很轻，不代表真实 recall 质量已经合格。
- Pi 0.83 RPC Host 可加载 connector，connector 自身 25 项测试通过。

### 不能原样 fork 的部分

1. **搜索只支持 FTS5/BM25。** 实测精确词可找到，同义表达会漏掉。若我们重视“记得意思而非原词”，它弱于带本地 embedding 的方案。
2. **默认保存用户 prompt。** Pi 在 `before_agent_start` 会保存长度足够的原始 prompt；只有显式 `<private>` block 会遮盖，且当前没有关闭开关。Pi Stuff 默认不应保存原始 prompt。
3. **project identity 不够稳。** remote 或 Git root 最终归一到 repo basename；不同 owner 下两个同名 `app` 可能相撞。同一 repo 的 worktree 可以共享，这是对的，但身份必须改成 host/owner/repo 或稳定 UUID。
4. **没有可靠的 Agent provenance。** 所谓 cross-agent 是多个 Agent 共用同一 project DB，不是每条 memory 都有清晰 `agent_id`。
5. **HTTP trust boundary 不完整。** server 只绑定 loopback，但 token 只保护部分破坏性接口，connector 又没有完整传 token。owned fork 应统一鉴权，或改成 Unix socket/随机本机会话凭证。
6. **capture 与我们的 subagent 机制耦合不上。** passive hook 只识别工具名恰好为 `Task`，再提取结果末尾的 `## Key Learnings`。Pi Stuff 应连接已选 subagent lifecycle，而不是猜工具名。
7. **现有 UI 不属于目标。** connector 写自己的 statusline、注册 19 个 tools，并依赖 Pi TUI 0.74；Pi Stuff 必须移除普通 memory statusline、复用统一 tool renderer，并把依赖收口到 Pi 0.83。
8. **范围需要修剪。** cloud、git sync、Obsidian export、自动 review、LLM conflict scan、upstream update check 都不应进入第一版默认面。

### 对 Pi Stuff 的真实意义

如果目标是“一份 memory 同时供 Pi、Claude Code、Codex 使用，并附一个成熟终端管理器”，Engram 比 Hermes 更自然。如果目标仍是“Markdown 能直接审阅、Pi 内核尽量小，并由 owned fork 自己决定以后怎样扩展检索”，Hermes 更贴近当前决定。

所以 Engram 的地位是次级备选：当未来明确需要跨 Pi、Claude Code 与 Codex 共用一个独立 local service 时再重新评估，不参与当前 Mem0 默认路线的验证。

## 2. open-zk-kb：最好的 Pi 产品形态参考

### 实际使用是什么样

用户说“这个项目以后都使用 pnpm”，Agent 保存一条 project preference。新 session 打开时，Pi 自动加载当前项目的 active preferences，并显示一条诚实的 `knowledge-context` 记录；搜索、保存、context 与 health 都使用 Pi-native 紧凑渲染，可展开细节。它不会为了表示自动注入而伪造一次 tool call。[官方 Pi experience](https://github.com/mrosnerr/open-zk-kb/blob/dev/docs/pi.md)

### 值得借鉴的部分

- Markdown 是 source of truth；SQLite FTS5 与本地 MiniLM embedding 只是可重建索引。
- 默认本地、离线，不需要 API key；hybrid search 可以匹配含义而不只是关键词。
- routine store/search/context 锁定当前项目，同时允许显式发布 global derivative。
- Pi package 已有十个 native knowledge tools 与紧凑渲染。[Pi Package 页面](https://pi.dev/packages/open-zk-kb)
- `1.4.2` 为 MIT；固定 30 日 npm 下载为 [10,476](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/open-zk-kb)。

### 为什么暂不选作底座

- 项目始于 2026-03，GitHub 只有 5 stars。下载量很高但公开采用证据很弱，不能仅凭下载数称为成熟。
- 需要 Bun 和约 23 MB local embedding model，包本身也比简单 Pi extension 大。
- 当前 extension 直接依赖 Pi 0.80.10 时代的包；必须 fork 后改到 Pi 0.83 并做真实 Host 测试。
- Agent 可以 delete，但缺少直接、自然的 update existing memory 路径。
- Obsidian scaffold、网页 ingest、九种 note type 与维护生命周期超过第一版需要。
- runtime telemetry 默认关闭，但交互式 installer 的同意项预选 Yes；owned fork 应完全移除这类意外开启路径。

它值得在隔离环境中真实安装一次，主要为了验证两件事：Pi UI 是否真的像文档一样安静，以及 hybrid recall 是否明显优于 Hermes/Engram。

## 3. projectmem：不要再重复失败路线

projectmem 的核心不是“记得用户说过什么”，而是保存：

```text
issue → attempt (failed / partial / worked) → confirmed fix
decision
note / gotcha
```

这些事件保存在 repo 的 `.projectmem/` 中。另一个 Agent 即将修改同一部分代码时，可以先看到某条路线已经失败。官方称其为 typed events 而非 chat history，并提供 Git hooks 与 pre-commit warning。[projectmem 官方 README](https://github.com/riponcm/projectmem#what-is-ai-coding-memory)

它的 append-only、`supersedes` 和 failure-before-retry 思路值得以后并入统一 memory schema。但它仍是 2026-05 才出现的 v0.2.0 项目，搜索很弱、没有 Pi package，并且默认 MCP 指令要求每个 session 和每次修改都频繁调用工具。它不能单独承担 Pi Stuff 的偏好、结构、命令与跨 session continuity。

## 4. Basic Memory：当 memory 变成一个人的知识库

Basic Memory 的中心体验是：人在 Obsidian 或普通编辑器中维护 Markdown，Agent 通过 MCP 搜索、阅读、创建、编辑、移动与删除同一批 note；系统提供 wikilink、知识图谱和 semantic/hybrid search。[Basic Memory 官方仓库](https://github.com/basicmachines-co/basic-memory)

这对于“我的日常知识库与 coding Agent 共用”很有吸引力，但不是 Pi Stuff 当前已经确认的窄项目 memory：

- AGPL-3.0 会给公开分发 owned fork 带来额外义务；
- Python runtime dependencies 和索引/知识图谱/同步范围远大于 Engram/Hermes；
- fork Python engine 后仍需维护 Pi adapter；
- 产品首先是个人/团队知识库，不是 coding session continuity。

除非以后明确决定把 Obsidian 式个人知识库纳入 Pi Stuff，否则只保留为设计参考。

## 其他 Pi memory packages 的分类

### 最小 Claude-like 参考

[`@josephakern/pi-memory`](https://pi.dev/packages/%40josephakern/pi-memory) 很小、零普通 dependencies，以全局和项目 Markdown 加一个有界 `MEMORY.md` index 工作，topic files 按需读取，Agent 通过普通文件工具修改。它证明“Claude-like memory 可以很小”。但采用量极低，且项目 memory 默认位于 repo 内并建议提交；不适合把个人本地自动 memory 直接带进版本控制。因此用来校准最小范围，不作为 fork base。

### 治理与审计参考

[`pi-persistent-intelligence`](https://pi.dev/packages/pi-persistent-intelligence) 的 JSONL canonical log、evidence、patch、tombstone、privacy purge 与 review browser 值得参考。但它把 memory 变成一套较重的治理系统，并带大量交互面，不符合默认安静的方向。

### 是长对话恢复，不是长期 memory

- [`pi-goosedump`](https://pi.dev/packages/pi-goosedump) 从 compaction 产物提取 typed recall，并支持 session search、provenance 与 tombstone；它更像替代 Pi compaction 的近期上下文层。
- [`pi-observational-memory`](https://pi.dev/packages/pi-observational-memory) 在长 session 内持续观察、反思和压缩；它解决 context window，而不是“几天后重新打开仓库记得项目约定”。

二者以后可以单独讨论，但不能拿来和当前 Mem0 durable-memory 方向作一对一替代比较。

## 明确排除的方向

### 全量历史采集

- [claude-mem](https://github.com/thedotmack/claude-mem) 捕获 raw prompts 与每次 `PostToolUse` 的 input/output，再交给后台 Worker 和 LLM 压缩。它属于 AgentMemory 同类，正是当前决定避免的“工具流水 memory”。
- AgentMemory 已在单独报告中审计，不重复纳入 shortlist：[`agentmemory-vs-hermes-memory.md`](./agentmemory-vs-hermes-memory.md)。

### 大型通用 engine / Agent platform

- Mem0 的 **self-hosted server/platform** 仍排除：它涉及 API、dashboard、Postgres/pgvector 与服务运维。但这不再排除同仓库的 `mem0ai/oss` TypeScript in-process library；后者已经升为首选底座。
- [Graphiti](https://github.com/getzep/graphiti/tree/v0.29.3)：时序 validity、provenance 和 contradiction 很有参考价值，但需要 graph database、LLM/embedder，且不是开箱 coding memory。
- [Letta](https://github.com/letta-ai/letta)、[Cognee](https://github.com/topoteretes/cognee)、[Supermemory](https://github.com/supermemoryai/supermemory) 等首先是更大的 Agent runtime、memory platform 或多服务系统，会与 Pi 保持 Host 的边界冲突。
- `mcp-memory-service` 的原官方仓库在调研日返回 404，无法可靠固定 revision 与 provenance，淘汰。

高 stars 不能抵消 owned fork 的维护边界。Pi Stuff 需要拥有的是一个窄而可控的能力，不是一套第二 Agent 平台。

## Mem0 的实现验证，以及回退顺序

产品方向已经选为 Mem0，不再做 Hermes 与 Engram 的候选投票。应做一个完全可丢弃、不会触碰现有 memory 的实现原型：

1. 从 Pi Stuff 已记录决定中人工挑 20 条不含秘密的测试 memory，覆盖偏好、架构、命令、失败路线、已替换决定和两个同名仓库。
2. 把 Mem0 的 vector/history SQLite store 移植到 `bun:sqlite`，使用 local embedding 与 `infer=false`，在真实 Pi 0.83 Host 中运行。
3. 用三类查询测试：原词、同义改写、容易跨项目误召回的相似问题。
4. 记录命中、漏召回、跨项目串线、首响应延迟、注入 token 数，并验证 embedding 故障时退化到关键词检索而不阻断 Agent。
5. 验证明确定会 update/supersede 旧事实，update/delete 受当前 project scope 限制，原始 conversation、tool output 与 telemetry 不出网也不入库。
6. 同时预览用户会看到的 Pi transcript：save、recall、edit、delete、stale replacement；不采用上游 statusline、Dashboard 或浮动窗口。

### 判定规则

- **Mem0 通过：** `bun:sqlite`、local embedding、scope、纠错和故障退化在真实 Host 中可靠，且同义 recall 的价值足以承担 SQLite canonical store 与较大 fork 边界；它成为默认。
- **Mem0 失败：** 若上述硬门无法在窄而可维护的 fork 中通过，使用 Hermes，不改用 Mem0 Cloud 或完整 server stack。
- **Engram/open-zk-kb：** 保留为以后不同产品需求的备选与设计参考，不参与当前默认选择。

## 当前记录状态

- Mem0 TS OSS owned fork 是首选底座，固定上游 `mem0ai/mem0@50bdaaea0c02744720ed374d88584fd01494eeb7`；只纳入所需 core/plugin slice，不纳入 Platform、server、Dashboard 或 Cloud MCP。
- `pi-hermes-memory@0.9.2` owned fork 改为 Mem0 实现门槛失败时的回退。
- Engram 降为次级备选，不再与 Hermes 进行当前默认底座 A/B。
- open-zk-kb 保留为 Pi-native UX 与 hybrid Markdown architecture 的实装观察对象。
- projectmem、Basic Memory、Graphiti 分别只提供 failure-event、human-editable knowledge base、temporal provenance 的设计参考。
- 不触碰现有 `~/.agentmemory`，不 dual-write，不把原始 prompts/tool outputs 迁入新默认 store。

## 方法与证据边界

三名独立 Agent 分别扫描了 Pi package catalog、轻量本地 engine、coding-agent-specific memory；主 Agent 交叉核查官方仓库、tag、Pi package 页面、npm registry 固定窗口和已发布文档。候选先按真实使用形态分类，再比较项目隔离、可见/可改/可删、自动采集面、daemon/依赖、Pi 0.83、license、fork 边界和采用信号。

本报告中的进程 RSS 与本机 latency 是隔离 smoke evidence，不是完整性能 benchmark；stars、downloads、test-file count 也只是成熟度信号。Mem0 的选择已经记录；它能否成为 fresh-install 默认，取决于 pinned revision 的 source audit 与上述真实 Pi/Bun implementation gates。
