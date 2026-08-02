# Mem0 作为 Pi Stuff memory 底座的适配研究

**调研日期：** 2026-08-01<br>
**目标 Host：** Pi 0.83.0<br>
**审计快照：** [`mem0ai/mem0@50bdaae`](https://github.com/mem0ai/mem0/commit/50bdaaea0c02744720ed374d88584fd01494eeb7)<br>
**目的：** 判断 Mem0 是否可以成为 Pi Stuff 的 owned-fork memory core，并明确实际应该 fork 哪一层、运行哪些东西、用户每天会看到什么。

## 结论先行

**Mem0 选为 Pi Stuff memory 的首选 owned-fork 底座；Hermes 保留为实现验证失败时的回退。** 这里的 Mem0 不是它的 Cloud 或 self-hosted 平台，而是一个比“Python sidecar + Docker”自然得多的 Pi 方案：

1. fork 官方 [`@mem0/pi-agent-plugin@0.1.4`](https://pi.dev/packages/%40mem0/pi-agent-plugin)，以它的 Pi lifecycle、CRUD tool 与 command 结构作为 integration 起点；
2. 把它从 Mem0 Cloud client 改为同一官方仓库的 [`mem0ai/oss` TypeScript core](https://docs.mem0.ai/open-source/node-quickstart)；
3. 第一版使用本地 SQLite vector/history store，明确配置到 Pi Stuff 自己的数据目录，并把不兼容 Pi/Bun 的 `better-sqlite3` 替换为 `bun:sqlite`；
4. 删除原插件的全对话自动上传、自动 dream、PostHog 和 Cloud-only dependency；
5. project identity、保存策略和 UI 由 Pi Stuff 重做。

这样部署后，用户平时只启动 Pi，不需要 Python、Postgres、Docker 或网页 Dashboard。若使用远程 embedding，search 会发送 query，add/update/re-index 也会发送相应的 memory 文本；若使用 Ollama 或内置本地 embedding，则这些数据和检索都可以留在本机。

但这不是一个“直接安装即可”的决定：

- **成熟的是 Mem0 core，不是它刚发布两个月的 Pi adapter。** Mem0 主仓库已有很强的采用与维护信号；官方 Pi package 固定 30 日只有 499 次下载。
- **Mem0 的源数据是数据库，不是 Markdown。** 它换来了语义检索、metadata filter、history 与 CRUD，但失去 Hermes 那种随手打开文件就能审阅的特性。Pi Stuff 必须提供可靠的 inspector/export UI。
- **Mem0 不原生认识“代码项目”。** OSS core 的一等 identity 是 `user_id`、`agent_id`、`run_id`；`project_id` 需要由 owned wrapper 作为不可变 metadata 加进去。
- **本地 SQLite vector store 是线性扫描。** 对几百到几千条精炼项目 memory 很合理，对全量 conversation archive 不合理。这反而要求我们坚持“只保存耐久信息”，不能把 Mem0 当 transcript 仓库。
- **发布包不能直接装进当前 Pi。** 真实 Pi 0.83 Host 使用 Bun 1.3.14。官方插件的顶层 `mem0ai`/`axios` import 会让 clean Host 启动失败；上游 OSS store 的 `better-sqlite3` 也无法在该 Bun 中实例化。相反，`bun:sqlite` 已在真实 Host 内成功加载。这是 owned fork 必须解决的实现门槛，不是改用 Mem0 Cloud 的理由。

因此，产品选择已经从 Hermes 改为 **Mem0 embedded owned fork**。下一步原型用于证明它在真实 Pi/Bun Host 中可靠成立，而不是重新进行产品候选投票。不建议 fork Python server，也不建议第一版依赖 Mem0 Cloud。

## 1. 先分清四种完全不同的 Mem0

官方现在同时提供 library、self-hosted server、Cloud 和 Pi plugin；说“使用 Mem0”还不足以形成实现决定。[官方 OSS overview](https://docs.mem0.ai/open-source/overview)

| 形态 | Pi 用户实际运行什么 | 数据在哪里 | 是否适合 Pi Stuff 第一版 |
| --- | --- | --- | --- |
| **Node OSS embedded** | Pi 进程内的 TypeScript `Memory`；本地 SQLite；embedding/LLM 可本地或远程 | 本机，除非主动选远程 provider | **最适合** |
| Python OSS library | Pi 之外再运行 Python bridge/sidecar；embedded Qdrant + SQLite | 本机，除非主动选远程 provider | 能用，但对 TypeScript Pi 多了一层进程边界 |
| Self-hosted REST | Docker Compose：FastAPI、Postgres/pgvector、Next.js Dashboard | 自己的服务器 | 团队服务适合；单人 CLI 第一版过重 |
| Mem0 Cloud | 官方 Pi plugin + `MEM0_API_KEY`；每轮经网络访问 hosted API | Mem0 托管端 | 安装最省事，但不是 owned backend |

### 被容易漏掉的 Node OSS 形态

当前 npm 包 `mem0ai@3.1.3` 不只是 Cloud SDK。它正式导出：

```ts
import { Memory } from "mem0ai/oss";
```

其 OSS 实现与 Python core 同仓维护，包含 add/search/get/getAll/update/delete/deleteAll/history/reset、embedding provider、vector store、SQLite history 与混合搜索。[Node quickstart](https://docs.mem0.ai/open-source/node-quickstart)；[TypeScript OSS source](https://github.com/mem0ai/mem0/tree/ts-v3.1.3/mem0-ts/src/oss/src)

这对 Pi Stuff 很关键：**不需要为了使用 Mem0 而引入 Python。**

## 2. 推荐形态：Pi plugin fork + TypeScript OSS core

### 用户每天实际会遇到的样子

理想的 owned fork 应该是下面这个流程：

1. 用户在某个 repo 中启动 Pi。
2. Pi Stuff 解析稳定的 `project_id`，打开这个项目对应的本地 memory store。
3. 用户发出问题时，插件自动对当前问题做一次小范围 recall，只把最相关的少量 memory 放进 context；没有 statusline，也没有浮动窗口。
4. Agent 完成重要决定、修复或发现后，主动保存一条简短、可读、带来源的 memory。普通聊天和 tool output 不自动入库。
5. 用户用统一的 `/memory` panel 浏览、搜索、修改或删除；这个 panel 使用之前确定的 Claude Code 风格 bordered replacement UI。
6. 下次打开同一 repo，相关约定和过去踩坑可以自动召回；打开另一个 repo 时不会混入。

Mem0 core 在这里负责“存储、语义检索、关键词检索、metadata filtering、history 和 CRUD”；Pi Stuff 负责“什么值得保存、项目身份、权限、UI 和 context budget”。

### 为什么不直接安装官方 Pi plugin

官方 package 的产品能力已经很完整：project/session/global scope、自动 recall、自动 capture、8 个 slash commands、一个 `mem0_memory` tool，以及周期性 dream consolidation。[Pi package 页面](https://pi.dev/packages/%40mem0/pi-agent-plugin)

但当前实现不能原样进入 Pi Stuff：

1. **只连接 Cloud。** 入口构造的是 hosted `MemoryClient`，没有 `mem0ai/oss` local mode；没有 `MEM0_API_KEY` 就直接停用。[entry source](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/src/entry.ts)
2. **默认采集整个 user/assistant conversation。** 每次 `agent_end` 都把事件中可见的 user 与 assistant 文本交给 Cloud `add`。它不采集 tool blocks，但 assistant 文本中的代码、路径或 secret 仍可能被发走。[capture source](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/src/capture/index.ts)
3. **默认每个 prompt 自动远程 search，且 dream 默认开启。** dream 会在达到时间、session、memory 数量门槛后让 Agent 自动 merge、rewrite 和 delete；第一版不应在用户不知情时大批改写 memory。[default config](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/src/config/index.ts)；[dream protocol](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/src/dream/prompt.ts)
4. **project identity 会撞名。** 它先找到 Git root，随后只取 root 的 basename 作为 `app_id`；两个不同位置但都叫 `app` 的 repo 会共享 scope。[scoping source](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/src/memory/scoping.ts)
5. **source-level 测试通过，但 stock package 在真实 Pi 0.83 Host 启动失败。** package 已经使用当前 Pi 的 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` namespace，peer range也是 `*`，只是 upstream dev dependency 固定在 0.79。[package manifest](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/package.json) 本轮把三个 Pi dev dependencies 临时固定到精确 0.83.0 后，11 个 test files、100 tests 与 `tsc --noEmit` 全部通过；但在 clean `PI_CODING_AGENT_DIR` 中安装并由 compiled Pi 启动时，顶层 `mem0ai`/`axios` import 触发 Extension load failure。这证明 API 形状基本兼容，同时证明 Node CI/typecheck 不能替代真实 Bun Host gate。
6. **telemetry 默认打开。** 插件把 API key 的 SHA-256 作为 PostHog distinct ID，并发送 command/tool/latency 等事件；可通过 `MEM0_TELEMETRY=false` 关闭，但 owned fork 应直接移除。[plugin telemetry](https://github.com/mem0ai/mem0/blob/pi-agent-v0.1.4/integrations/pi-agent-plugin/src/telemetry.ts)

所以它是很好的 **fork 起点**，不是可以直接采用的成品。

## 3. Mem0 core 到底提供什么能力

### 写入：自动提炼与原文保存是两条不同路径

`add` 有两个重要模式：

- `infer=true`：把新消息、最近 session 消息和相关旧 memory 交给一个 LLM；当前 v3 pipeline 用一次 extraction call 提取原子事实，再 embedding、去重和写入。
- `infer=false`：直接保存调用者给出的文本，不运行 extraction LLM。

当前算法是 **additive**：自动 extraction 主要新增事实，不再让 extraction 阶段自动 UPDATE/DELETE 旧事实；显式 update/delete API 仍然存在。[Python add pipeline](https://github.com/mem0ai/mem0/blob/v2.0.15/mem0/memory/main.py)；[TypeScript add pipeline](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/memory/index.ts)；[迁移说明](https://docs.mem0.ai/migration/oss-v2-to-v3)

因此，Pi Stuff 不能指望“后来一句新事实”自动替换旧事实。明确纠正时，wrapper 必须在当前 project scope 内找到旧条目，执行 update/supersede，保留可撤销的 history；若命中不唯一，再让 Agent 或用户选择。上游的 `infer=true` 还会保存最近的原始消息作为 extraction context，即使最终没有提取出 memory，因此默认自动写入不能直接沿用这条路径。

对 Pi Stuff，最合适的第一版是：

- Agent 已经明确判断“这是一个应长期记住的决定”时，用 `infer=false` 保存它自己整理的原子条目；
- 不再为每次保存额外调用一次 memory extraction model；
- 后续如果要做 conversation auto-mining，再作为独立可关闭策略加入，而不是 Mem0 的强制默认。

这既保留“Agent 自动记住”的使用体验，又避免原插件把每轮整段对话交给第二个模型。

### 检索：不是单纯 vector search

当前 OSS search 会组合：

- embedding semantic similarity；
- BM25/keyword score；
- entity match boost；
- metadata filters；
- 可选 reranker；
- threshold、top-k、expiration 与 explain score。

[TypeScript search implementation](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/memory/index.ts) 和 [metadata filtering 文档](https://docs.mem0.ai/open-source/features/metadata-filtering) 表明它能够支持“只搜当前用户、当前项目、某种 memory kind、某个时间范围”。

不过默认的 Node `memory` vector store 实际是 SQLite 文件，并在每次 semantic 与 keyword search 时读取候选行、逐条算 cosine/BM25，而不是 ANN index。[SQLite vector store](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/vector_stores/memory.ts)

这意味着：

- 作为精炼的 coding memory 很合适；
- 作为几十万条 transcript archive 不合适；
- 第一原型必须测 100、1,000、10,000 条时的 recall latency 和 Pi event-loop 卡顿。

### CRUD 与可审计性

OSS core 有：

- get / getAll；
- update 文本、metadata、expiration；
- delete 单条、按 identity deleteAll、reset；
- 每条 memory 的 change history；
- sync 与 async Python API；Node API 本身为 async。

显式 update/delete 是按 memory ID 操作，core 不替调用者再次验证 project scope。因此 owned wrapper 必须在修改或删除前，先读取目标并确认其 `user_id + project_id` 属于当前 scope；不能因为 Agent 知道一个 ID 就允许跨项目修改。

### identity 与 project isolation

OSS core 强制 search/getAll 至少带一个 `user_id`、`agent_id` 或 `run_id`。这些字段的实际含义可以具体映射为：

| Mem0 字段 | Pi Stuff 中的含义 |
| --- | --- |
| `user_id` | 当前本机用户或明确配置的 profile |
| `project_id`（自定义 metadata） | 稳定 repo identity；所有正常读写必须带上 |
| `agent_id` | 可选的来源 Agent 类型，不应当决定项目边界 |
| `run_id` | 当前 Pi session；只用于 session scope 和 provenance |
| `memory_kind`（自定义 metadata） | decision / preference / fix / failed-attempt / fact 等 |

`project_id` 不应使用目录 basename。建议优先使用规范化 remote identity；没有 remote 时使用 Git common dir 的稳定本地 ID，并让 worktree 共享。这个 identity 层属于 Pi Stuff wrapper，不应修改 Mem0 的通用 core API。

## 4. 本地运行到底需要哪些东西

### 方案 A：Pi/Bun OSS + 远程模型

最少组件：

- Pi 0.83 自带的 Bun runtime；
- fork 后的 `mem0ai/oss` core；
- 由 `bun:sqlite` 驱动的本地 vector/history files；
- 一个 LLM API（只在 `infer=true` 时需要）；
- 一个 embedding API（每次 add/search/update 都需要）。

官方默认是 OpenAI `gpt-5-mini` 与 `text-embedding-3-small`，并不是“默认完全离线”。[官方默认组件](https://docs.mem0.ai/open-source/overview#default-components)

如果 Pi Stuff 第一版只使用 `infer=false`，则保存时不需要 extraction LLM；但 semantic search 仍需要 embedding provider。

选择远程 embedding 时，出网内容不只是一句 search query：新增 memory、修改文本以及更换模型后的 re-index 都必须把 memory 文本交给 embedding provider。所谓“数据留在本机”只适用于 vector/history 数据库；除非 embedding 也在本机，否则不能把该形态称为完全本地。

### 方案 B：Node OSS + Ollama，完全本地

官方 TypeScript core 已有 Ollama LLM 与 Ollama embedder。它会连接默认 `http://localhost:11434`，缺少模型时还会主动 pull。[Ollama LLM source](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/llms/ollama.ts)；[Ollama embedder source](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/embeddings/ollama.ts)

实际要求是：

- 本地 Ollama daemon；
- 一个能稳定输出 JSON 的 extraction model；
- 一个 embedding model；
- 两个或三个 SQLite 文件。

原代码的自动 pull 对 CLI 产品不友好：第一次启动可能无提示下载数 GB。owned fork 应改成设置页显式选择并下载，或检测不到时给出清楚错误，不在一次普通对话中偷偷拉模型。

### 方案 C：Node OSS + local embedding + curated add

TypeScript core 也已有 `fastembed` provider，并把 provider SDK 作为按需 peer 加载。[factory source](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/utils/factory.ts)

由此可以得到一个更小的 Pi Stuff 专用形态：

- Agent 自己决定并整理 memory；
- `add(..., infer=false)`，不运行第二个 LLM；
- local embedding model 负责 add/search/update；
- SQLite 负责 vector、keyword 与 history；
- 没有 Python、Docker、Postgres 或常驻 Ollama。

这是依据官方 provider 与 API 能力得出的 **owned-fork 组合方案**，不是改一下 stock config 就已经成立的官方 preset。当前 `Memory` constructor 即使最终只调用 `infer=false`，仍会立即构造一个 LLM provider；fork 必须把 LLM 改成 lazy/optional，或注入 Pi 已有的 model callback。[Memory constructor](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/memory/index.ts) 完成这项小改动后，该形态应成为第一原型的默认实验路线。

### 数据文件必须显式收口

当前 TypeScript 默认路径并不适合直接继承：

- vector store 默认 `~/.mem0/vector_store.db`；
- entity store 派生为 `~/.mem0/vector_store_entities.db`；
- history 默认 `memory.db`，是相对当前进程 cwd 的路径。

[path source](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/utils/sqlite.ts)；[default config](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/config/defaults.ts)

Pi Stuff 必须把三者统一放到自己管理的数据根目录，加入 schema version、backup/export、migration 和 doctor 检查；不能在不同 cwd 留下零散 `memory.db`。

官方 Node quickstart 仍把默认 vector store 称作 “in-memory”，而当前 tag 的实际实现已经把它持久化到 SQLite。这种 docs/source 不同步是一个维护信号：fork 决策和 migration 必须以固定 tag 的源码与测试为准，不能只读产品文档。[Node quickstart](https://docs.mem0.ai/open-source/node-quickstart)；[actual store source](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/src/vector_stores/memory.ts)

### 真实 Pi 0.83 runtime 结果

当前 `/opt/pi-coding-agent/pi` 是由 `bun build --compile` 生成的独立可执行文件。通过真实 Pi RPC Host 运行 probe 得到 Bun 1.3.14，并确认 `bun:sqlite` 可以在 Extension runtime 内加载。相同 Bun 环境中，上游 `better-sqlite3` 的 local store 实例化失败；直接安装的 `mem0ai/oss` 还会因未安装的 optional provider peers 失败。

因此 owned fork 不能把 `mem0ai` npm package 当作黑盒 dependency。它应纳入所需 OSS source slice，把 vector store 与 history manager 两处 SQLite 实现统一移植到 `bun:sqlite`，并删除未使用 provider 的 eager imports。接口与 SQL schema可以保留；这是边界明确的 adapter/packaging 改造。local embedding provider 仍需单独做一次真实 Host smoke test。

## 5. 为什么不优先用 Python embedded library

Python `mem0ai@2.0.15` 的能力与测试更完整，且默认 Qdrant 可以 embedded 运行；不需要单独 Qdrant daemon。默认数据是 `/tmp/qdrant` 与 `~/.mem0/history.db`，默认 LLM/embedding 仍是 OpenAI。[Python quickstart](https://docs.mem0.ai/open-source/python-quickstart)

完全本地时，可以把 LLM 与 embedder 都配成 Ollama，再把 Qdrant path 改到耐久目录。需要：

- Python 3.10+；
- `mem0ai` 与 `ollama` Python dependency；
- Ollama daemon 和两个模型；
- embedded Qdrant + SQLite files。

[Python package metadata](https://pypi.org/project/mem0ai/2.0.15/)；[Ollama LLM source](https://github.com/mem0ai/mem0/blob/v2.0.15/mem0/llms/ollama.py)；[default Qdrant config](https://github.com/mem0ai/mem0/blob/v2.0.15/mem0/configs/vector_stores/qdrant.py)

问题不在能力，而在 Pi 是 TypeScript Host：必须再实现 stdio、Unix socket 或 loopback HTTP bridge，处理进程启动、crash recovery、version、venv、日志与 shutdown。既然官方已有功能接近的 TypeScript OSS core，第一版没有必要主动增加这条边界。

只有在后续实测证明 TypeScript core 的 recall quality、migration 或性能明显差于 Python core 时，才应回到 Python sidecar。

## 6. 为什么不优先用 Self-hosted REST stack

官方 self-hosted 不是“一只 memory daemon”，而是三服务 stack：

- FastAPI memory/auth/API 服务；
- PostgreSQL 17 + pgvector；
- Next.js dashboard。

它还维护 JWT、用户、per-user API key、runtime config、Alembic migrations 与 append-only request log。官方文档明确把它定位给需要团队 API key、Dashboard 和 request audit 的部署。[Self-hosted setup](https://docs.mem0.ai/open-source/setup)；[Compose source](https://github.com/mem0ai/mem0/blob/v2.0.15/server/docker-compose.yaml)

默认 container 只内置：

- LLM：OpenAI、Anthropic、Gemini；
- embedder：OpenAI、Gemini。

要用 Ollama 或其他本地 provider，需要改 requirements、provider allowlist 并 rebuild image。[官方 provider 说明](https://docs.mem0.ai/open-source/setup#supported-providers)

这个形态适合以后出现下面需求时再启用：

- Pi、Claude Code、Codex 和多台机器共享同一份 memory；
- 多用户权限与撤销 API key；
- 管理员网页审计；
- 集中备份和运维。

对单人 Pi Stuff 第一版，它把一个本地 library 问题扩大成数据库与 Web 运维问题，因此不选。

## 7. Cloud 形态：最好装，但不是真正 owned

官方 Pi plugin 的唯一现成使用方式是注册 Mem0 Platform、取得 API key，然后由 npm `mem0ai` hosted client 访问 Cloud。[官方安装说明](https://pi.dev/packages/%40mem0/pi-agent-plugin#setup)

优点很具体：

- 不安装本地模型或数据库；
- 跨机器和跨设备自然共享；
- hosted search、reranking 与后台能力由官方维护。

代价也很具体：

- 每个 prompt 的 auto recall 依赖网络延迟和服务可用性；
- conversation/memory 离开本机；
- backend、数据格式和服务价格不是 Pi Stuff owned fork 能控制的；
- fork 客户端并不等于 fork backend。

所以 Cloud 可以以后作为 opt-in sync/backend，不能被描述为 Pi Stuff 的 owned memory core。

## 8. 成熟度、体量与 provenance 快照

数据均为 2026-08-01 快照，来源是官方 GitHub、npm、PyPI 与仓库 tag。

### 当前版本

| 部分 | 稳定版本 | 发布时间 | 分发证据 |
| --- | --- | --- | --- |
| Python OSS | [`v2.0.15`](https://github.com/mem0ai/mem0/releases/tag/v2.0.15) | 2026-08-01 | PyPI wheel 343,050 bytes；sdist 247,301 bytes |
| Node SDK / OSS | [`ts-v3.1.3`](https://github.com/mem0ai/mem0/releases/tag/ts-v3.1.3) | 2026-08-01 | npm unpacked 3,927,563 bytes；SLSA provenance |
| Pi plugin | [`pi-agent-v0.1.4`](https://github.com/mem0ai/mem0/releases/tag/pi-agent-v0.1.4) | 2026-08-01 | npm unpacked 233,210 bytes；SLSA provenance |

### 采用与维护

- 主仓库快照为 [62,256 stars、7,256 forks](https://api.github.com/repos/mem0ai/mem0)，Apache-2.0；这证明 Mem0 不是小众实验。
- `mem0ai` npm package 在固定窗口 2026-07-02 至 2026-07-31 有 [378,585 downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/mem0ai)。
- `@mem0/pi-agent-plugin` 同一窗口只有 [499 downloads](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40mem0%2Fpi-agent-plugin)，且首版发布于 2026-06-09。不能把 core 的成熟度直接转嫁给这个 adapter。
- 对官方 git history 的本地固定快照统计：2026-05-01 后 375 commits，2026-07-01 后 116 commits；其中最近一个月 Pi plugin 相关 19 commits。项目维护非常活跃，也意味着 fork 需要明确的 upstream sync 策略。[commit history](https://github.com/mem0ai/mem0/commits/main/)

### 源码与测试体量

| slice | 非测试 source | test files | 约 source LOC | 维护含义 |
| --- | ---: | ---: | ---: | --- |
| Python core `mem0/` | 148 files | 99 Python test files | 31.6k | 功能面广，provider matrix 大 |
| TypeScript OSS `mem0-ts/src/oss/src` | 89 files | 78 test files | 29.6k | 不算小库，但已有 CRUD/provider/migration tests |
| Pi plugin | 13 source files | 11 test files | 2.6k（含 tests） | source tests pass；stock compiled-Host load fails，必须改造 |

这些数字来自 tag `50bdaae` 的仓库树，不是 npm 包展开后的 generated bundle。

另外，Pi plugin 把 dev dependencies 从 upstream 0.79 临时提升到精确 0.83.0 后，现有 11 个 test files 共 100 tests 全部通过，`tsc --noEmit` 也通过；但 stock package 在 clean compiled Pi 0.83 Host 中加载失败。这组结果共同说明 source/API 可以作为 fork 起点，同时真实 Bun Host 必须是每次发布的硬 gate。

### 许可证与 provenance

- 主仓库、Python distribution、npm `mem0ai` 与 Pi plugin 均声明 [Apache-2.0](https://github.com/mem0ai/mem0/blob/50bdaaea0c02744720ed374d88584fd01494eeb7/LICENSE)。
- npm 当前两个 package 都带 GitHub Actions 生成的 registry provenance attestations；PyPI `2.0.15` wheel SHA-256 为 `d5c0565ea385cecc8643aa4f4ed61dab56d4f60273499fa2b4e43fc0e5e9c273`，sdist 为 `2befbc253cb08ce3d3d71a2b6e6ba046aeff6d4b5cd4577addbf8b46ffb174`。[npm Node package](https://www.npmjs.com/package/mem0ai/v/3.1.3)；[npm Pi plugin](https://www.npmjs.com/package/%40mem0/pi-agent-plugin/v/0.1.4)；[PyPI](https://pypi.org/project/mem0ai/2.0.15/)
- `mem0-ts/src/oss/package.json` 与其 legacy README 内仍写 MIT，但它没有独立 LICENSE，正式根仓库与正式 `mem0ai` distribution 写 Apache-2.0。owned fork 应保留根 LICENSE、NOTICE/provenance manifest，并在引入前对这一 legacy metadata 差异做一次 license inventory，而不是自行把它改成无出处的单一声明。[nested package metadata](https://github.com/mem0ai/mem0/blob/ts-v3.1.3/mem0-ts/src/oss/package.json)

## 9. 到底要 fork 哪些源码

### 推荐的精确 fork 边界

先建立官方 `mem0ai/mem0` 的 owned fork，并固定以下三个 tag/commit：

- upstream repo：`https://github.com/mem0ai/mem0`
- base commit：`50bdaaea0c02744720ed374d88584fd01494eeb7`
- semantic tags：`ts-v3.1.3`、`pi-agent-v0.1.4`；保留 `v2.0.15` 仅作 parity reference

进入 Pi Stuff monorepo 的实际 source slice 应只有：

1. `integrations/pi-agent-plugin/src/**`
2. `integrations/pi-agent-plugin/tests/**`
3. 有选择地保留需要的 `skills/**`；第一版不保留 dream 等多余 skill
4. `mem0-ts/src/oss/src/**`
5. TypeScript OSS 对应 tests，以及构建、license、lockfile/provenance manifest

不要把以下部分带入第一版 runtime：

- `server/**`
- `server/dashboard/**`
- Python `mem0/**`
- Cloud client、CLI、Vercel/OpenClaw/n8n integrations
- 大量不用的 vector/LLM providers

### 第一轮应主动修剪的 core surface

owned fork 第一版只保留：

- one local vector store：SQLite `memory`；
- one local history store：SQLite；
- one default embedder + 一个可替换接口；
- add/search/get/getAll/update/delete/deleteAll/history；
- metadata filters、expiration、hybrid scoring；
- stable schema migrations。

两处 SQLite store 都必须使用 `bun:sqlite`。同时把 LLM/embedder 改为 Pi-owned 可注入接口，删除原始消息 rolling history；semantic provider 失败时允许退化为 BM25，而不是让 memory 故障阻断 Agent 正常回答。

暂不保留：

- 20+ remote vector stores；
- graph memory、rerank provider matrix；
- dream/decay/temporal platform notices；
- telemetry；
- hosted API assumptions；
- server auth/dashboard。

这里的“修剪”必须在 fork 中完成，并保留 upstream commit 与 license 记录；不能重新照着它的代码另写一份而丢掉 provenance。

## 10. Pi Stuff 必须自行决定的产品层

Mem0 解决不了下面这些决定，不能把它们误认为“换底座后自动完成”：

1. **保存策略：** 什么是 durable memory；是否由 Agent 自动调用；哪些信息永不保存。
2. **project identity：** remote、worktree、无 Git 目录、repo rename 如何映射。
3. **context policy：** 每轮召回多少条、多少 token、是否显示一条简短的自动 recall 记录。
4. **trust：** retrieved memory 是不可信历史数据，不能当新的 system instruction 执行。
5. **secret defense：** 保存前 scanner、private block、路径/credential patterns、用户显式 forget。
6. **审计 UI：** 浏览、查来源、纠错、删除、导出、清空；不能要求用户直接开 SQLite。
7. **scope authorization：** update/delete 前验证当前 project；跨项目 search 必须显式请求。
8. **backup/migration：** DB schema 升级、embedding model 更换后的 re-index、损坏恢复。

其中 UI 可以延续已经确定的原则：普通 recall 使用统一 tool renderer；管理 memory 使用 Claude Code 风格 bordered replacement panel；不新增 statusline，不使用浮动窗口。

## 11. 建议的验证顺序

产品方向已经选为 Mem0。正式设为 fresh-install 默认前，只需要做一个严格限定的 throwaway prototype：

1. fork `pi-agent-v0.1.4` 与 `mem0ai/oss` 所需 source slice，把 dev/test matrix 固定到 Pi 0.83；
2. 移除会让 compiled Host 启动失败的 Cloud SDK/provider eager imports，把 vector/history store 移植到 `bun:sqlite`；
3. 只启用 `infer=false` + 一个 local embedding，并在真实 Pi/Bun 中验证 provider 加载；
4. 写入同一批 20 条 Pi Stuff 真实 decision/fix/preference；
5. 测精确词、同义问法、跨项目误召回、错误 update/delete、100/1k/10k 条 latency；
6. 重启 Pi，确认数据、scope 与 history；
7. 再画 `/memory` panel，不先投入完整管理 UI。

### 原型通过门槛

- 同义 recall 显著优于纯文本方案；
- 1,000 条项目 memory 时 recall 不阻塞 Pi UI；
- 两个同名 repo 零串线；
- 没有 memory 内容、prompt、tool output 或 telemetry 意外出网；
- embedding 不可用或超时时，Agent 正常继续，并至少保留关键词检索退化路径；
- update/delete 必须受当前 project scope 限制；
- DB 可以导出为人能读的 JSONL/Markdown，并可完整重建。

这些门槛是采用验证，不是另一轮产品选择。全部通过后 Mem0 成为默认；若 Bun-native store、local embedding、项目隔离或故障退化无法在窄而可维护的 fork 中可靠实现，则回退到 Hermes，并记录具体失败证据。

## 最终判断

用户提出“可以用 Mem0”是合理的，而且官方在 2026-08 已经提供了此前容易遗漏的两块关键材料：`mem0ai/oss` Node core 与官方 Pi plugin。

最合理的产品决定不是：

> 安装官方插件，把所有对话交给 Mem0 Cloud。

而是：

> **fork 官方 Pi plugin 与 TypeScript Mem0 OSS core 的所需 slice；保留成熟的 memory engine，把存储移植到 `bun:sqlite`，并重做 Pi Stuff 自己的 capture policy、纠错、project boundary、权限、故障退化和 UI。**

这条路线在能力上比 Hermes 更强，在部署上又可以保持为“启动 Pi 就直接可用”。它真正的代价是 owned fork 约 30k LOC 的 core、SQLite 而非 Markdown source of truth，以及需要长期跟进快速变化的 upstream。用户已经接受 Mem0 方向；下一步由真实原型证明实现门槛，若失败则使用保留的 Hermes 回退，而不是改用 Mem0 Platform。
