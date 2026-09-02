<!-- translation-source: docs/research/pi-subagents-v0.63-synchronization-20260902.md; translation-source-sha256: 750db5bb0dd0261d360dcc1377fb64675224db490e1f5ec147f7747e9c71d2f4 -->

# pi-subagents v0.63.0 同步台账

[English](../../../../../docs/research/pi-subagents-v0.63-synchronization-20260902.md)

记录于 2026-09-02。对于保留的 Agents 能力，Pi Stuff 已在语义上同步到 `pi-subagents` `v0.63.0`。“同步”
是指从已导入的 `v0.38.0` 基线开始，每项上游变更都经过审查，并被采用、确认已由 Pi Stuff 所有者覆盖，或
依据现有架构边界明确排除。它不表示 Pi Stuff 会公开每个上游产品，也不表示与上游 Package 保持源码兼容。

本次审查最核心的完成语义是明确的：普通委派工作没有隐式轮次限制或 Tool 限制。子 Agent 会一直运行，直到
完成、失败、被停止、达到调用方明确提供的 Tool 预算，或遇到已配置超时、Provider 不可用等真实执行故障。

## 已验证源码快照

| 项目 | 已验证值 |
|---|---|
| 上游仓库 | <https://github.com/nicobailon/pi-subagents> |
| 已导入基线 | `v0.38.0`，提交 `89de10e4bc8895e7948704c38620a5b35ddcd17e` |
| 已审查同步点 | `v0.63.0`，提交 `4f7eb2b56dc5306416920db8c6e222c7aaad3c81` |
| 比较范围 | `v0.38.0..v0.63.0` |
| 已审查版本 | 30 |
| 已审查提交 | 820 |
| npm 软件包 | `pi-subagents@0.63.0` |
| npm 归档大小 | 1,209,401 字节 |
| npm SHA-1 | `85098af67e96b8b31f3ea456daef5637c1c3de5b` |
| npm SHA-256 | `de6aff4af2ca27ffcb396578559b515f252b1050a0c7c5ffe388be1599bf485f` |
| npm 完整性 | `sha512-tS2zpzPnJh/tLODZGMN+XnpElOfN+l+KwDe+PnFcPfqwSd8zbirEjXR3W8uAcNlsaD8BxlDUSLHC//+v4+Ptcg==` |
| 保留的 MIT 许可证 SHA-256 | `2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c` |

Git 标签、Git 提交、npm `latest` 元数据、下载的 npm 归档和许可证均已独立验证。Git 标签与 npm 发布都指向
`0.63.0`；上面的归档 hash 来自实际下载的 npm 发布，而不是根据 Git 推断。

## 审查方法

审查遍历了完整 Git 范围以及全部 30 个版本的完整上游 changelog。逐版本检查变更路径和提交主题，然后把保留
能力的变更与 Pi Stuff 的所有者 seam 比较。每项变更得到以下四种处置之一：

- **已采用：**Pi Stuff 需要该行为，并修改了实现或测试。
- **已覆盖：**Pi Stuff 已通过不同实现或所有者满足同一必要结果。
- **不适用：**变更只属于 Pi Stuff 不包含的上游产品界面。
- **冲突：**采用该上游界面会违反已接受的 Pi Stuff 架构或生命周期边界。

版本表让已遍历范围可以复现。语义表为每个相关系列保留精确的代表性上游提交；仅涉及产品的提交按其上游
所有者分组，而不是把 820 个提交主题复制进维护文档。

```sh
git rev-list --count v0.38.0..v0.63.0
git log --reverse --name-status v0.38.0..v0.63.0
git diff --stat v0.38.0..v0.63.0
git show v0.63.0:CHANGELOG.md
npm view pi-subagents@0.63.0 dist time version
```

## 版本覆盖

每一行都审查到对应标签提交。数量表示相对上一行新增的提交数，第一行从 `v0.38.0` 开始；合计 820。

| 版本 | 日期 | 提交数 | 标签提交 |
|---|---:|---:|---|
| `v0.39.0` | 2026-08-01 | 36 | `ad314315339c` |
| `v0.40.0` | 2026-08-01 | 16 | `d4d2ab706b61` |
| `v0.41.0` | 2026-08-05 | 144 | `92e3a42b1148` |
| `v0.42.0` | 2026-08-06 | 32 | `ebb2917f2b52` |
| `v0.42.1` | 2026-08-06 | 5 | `632e4ac1424e` |
| `v0.43.0` | 2026-08-07 | 24 | `9e8ce9e6af00` |
| `v0.44.0` | 2026-08-08 | 14 | `96c3fec9b502` |
| `v0.45.0` | 2026-08-09 | 20 | `23ba0b61727b` |
| `v0.45.1` | 2026-08-09 | 7 | `165ec1058215` |
| `v0.45.2` | 2026-08-09 | 7 | `7836c0f5ef64` |
| `v0.46.0` | 2026-08-10 | 18 | `4a2d5284a2ac` |
| `v0.47.0` | 2026-08-11 | 20 | `2243d13c052e` |
| `v0.47.1` | 2026-08-11 | 10 | `5d158bf6c8f6` |
| `v0.48.0` | 2026-08-13 | 20 | `56f9723416a6` |
| `v0.49.0` | 2026-08-13 | 39 | `9752fdfd5de0` |
| `v0.50.0` | 2026-08-14 | 31 | `c091da1d9b66` |
| `v0.51.0` | 2026-08-18 | 59 | `10f69cdfd1ec` |
| `v0.52.0` | 2026-08-19 | 19 | `6dc6219797fd` |
| `v0.52.1` | 2026-08-19 | 5 | `afa22c811f81` |
| `v0.53.0` | 2026-08-20 | 23 | `c91f4de5ea95` |
| `v0.54.0` | 2026-08-21 | 19 | `6f0610a6d980` |
| `v0.55.0` | 2026-08-23 | 28 | `c89d86d4db5f` |
| `v0.56.0` | 2026-08-23 | 13 | `a0e2b9e31de5` |
| `v0.57.0` | 2026-08-25 | 49 | `6cb9fb3c82a7` |
| `v0.58.0` | 2026-08-26 | 27 | `a9d0ee1a2189` |
| `v0.59.0` | 2026-08-28 | 59 | `45c0b418a3d0` |
| `v0.60.0` | 2026-08-29 | 27 | `d8c9ceb672fd` |
| `v0.61.0` | 2026-08-30 | 21 | `722bf151d8a0` |
| `v0.62.0` | 2026-08-31 | 14 | `a9b17bb71868` |
| `v0.63.0` | 2026-09-01 | 14 | `4f7eb2b56dc5` |

## 保留的 Agents 能力

| 语义系列 | 上游证据 | 处置与 Pi Stuff 证据 |
|---|---|---|
| 委派完成 | `94ecb66` 删除轮次预算控制 | **已采用**于 `e07a08f`。普通运行不再获得隐式轮次预算或 Tool 预算。旧预算字段只为读取旧产物而保留；调用方明确提供的 Tool 预算仍然有效。70 轮真实运行回归保护超过旧限制后的收敛。 |
| 卡死的 Tool 调用 | `a660ea3` 添加智能 Tool 超时默认值 | **已采用**于 `4323575`。调用、启动、Agent 和环境按优先级解析为一个超时；快速 Tool 默认五分钟，等待型 Tool 豁免。超时证据可持久化和恢复。 |
| 每个 Agent 的 Tool 排除 | `b26da18` | **已采用**于 `d839b29`。排除项从所有 Tool 来源中扣除，可以移除 fanout，也不能静默移除必需的 `read` Tool。 |
| Agent 扫描根目录 | `9433419`、`59d920f` | **已采用**于 `f03c3a6`。配置根目录支持 `~`、一个完整路径段的 `*`、确定性优先级和符号链接循环保护。 |
| 模型解析与 fallback | `6b9ccdb`、`fc6b580`、`5b4a1dd`、`fc17d6e`、`71ba8a5`、`15dc4ea`、`c005779`、`86119c8`、`2297ad0`、`d8d1408`、`85520f4`、`374bb15`、`053999e` | **已采用**于 `931c950`。明确指定的未知模型会失败；不可用的已配置候选会跳过；继承的父模型仍受信任；owner/name 标识和 thinking 后缀正确解析；模型来源在恢复后保留；子 Agent 已产生有效活动后不再进行不安全重试；上下文溢出不可重试。 |
| Fork 中的 Tool-call 标识 | `fd86873`、`e1224d8`、`38cb5e8`、`ce8e171` | **已采用**于 `2c2a517` 和 `960f84c`。继承 ID 对 Provider 可移植且最多 64 字符，调用与结果保持配对；API 支持时，Provider 原生复合 ID 保持现场值。 |
| 原子持久化故障 | `3847dee` 包含清理过程中保留主要写入错误 | **已采用**于 `b34fcb0`。同步与异步原子写入器报告原始写入或重命名错误，不再被清理错误掩盖。 |
| 被 signal 终止的子 Agent | `f9aa1d2` | **已覆盖。**本地进程终态证明区分管理器终止、外部 signal、crash、超时和语义完成；真实进程回归覆盖裸 `SIGTERM`、`SIGKILL` 和 `SIGSEGV`。 |
| 过大的控制输入 | `bc40535` | **已覆盖。**Pi Stuff 使用有界的一请求一文件 claim 和单独有界的控制事件读取器。过大记录不会阻塞下一条有效控制事件。 |
| 过大的嵌套事件 | `35b2b5f` | **已覆盖。**子协议与嵌套事件模型在持久化或 UI 投影前限制记录、聚合投影、深度、步骤和后代数量。 |
| Fork 上下文与 continuation | `v0.51.0`–`v0.60.0` 的上游 fork 裁剪、cache affinity 和恢复修复 | **已覆盖。**Pi Stuff 使用 Pi Session 快照、有界子 continuation 投影、成对的近期 Tool 交换、模型感知输入容量和持久恢复描述符。它不会创建第二套 fork cache。 |
| 路径与结果索引安全 | `84438a1`、`8c5269b` | **已覆盖。**启动 ID 和持久 Session 身份由固定长度 SHA-256 派生，嵌套路径条目经过验证，结果文件位于 Suite 负责的私有目录，而不是用户控制的 URI 路径段。 |
| MCP 直接 Tool 选择 | `e0d5e4b` 及后续 selector 修复 | **已覆盖 / 不适用。**直接 Tool grant 已与能力上限求交，并验证可用 Tool。Pi Stuff 没有上游 MCP 元数据 cache，因此没有需要迁移的协议 hash cache key。 |
| Agent 能力发现 | `f1b338c`、`7ebae72` | **已覆盖。**现有动态 Agent roster 和 Tool 描述会投影发现的 Agent 元数据。第二个公开能力列表 Tool 会复制同一可见权威。 |
| 子输出 timing footer | `bb44244` | **已覆盖。**Pi Stuff 提取子协议输出，并不会把 Pi timing footer 追加到委派结果，因此无需迁移 footer 删除分支。 |
| 存储耗尽 | `3847dee` 还添加了上游容量弹性排队写入器 | **冲突。**Pi Stuff 要求在推进 Agent 所有权前留下持久生命周期证据，因此真实存储写入失败时会 fail closed。观察器和陈旧运行 reconciler 会保留并重试未完成证据；存储已满时不会让没有记录的工作继续运行。上面的原子错误保留修复会让真正的 `ENOSPC`/quota 原因保持可见。 |

## 明确排除的上游产品界面

这些不是未完成的迁移。它们位于 Pi Stuff Package 边界之外，或由其他 Pi Stuff 能力负责。

| 上游界面 | 处置 | 边界 |
|---|---|---|
| Chain、Workflow、`workflowScript`、Missions、Schedules、Fleet、Herdr 和 workflow lanes | **不适用 / 冲突** | Pi 仍是 Host；Pi Stuff 不添加另一套 CLI、runtime、Session 层或编排 shell。Goal 负责 Goal continuation 与终态策略。 |
| `acceptance.report` 输出模式（`7281103`）及上游 reviewer/watchdog acceptance 层 | **不适用** | 结构化输出只保留为内部 kernel；Pi Stuff 不公开已删除的 Workflow/Acceptance 产品。 |
| Watchdog、审查自动化、权限 broker 和 LSP 诊断 | **不适用** | 这些上游产品在初始 fork 时已删除，本地没有保留的所有者。 |
| 外部 CLI runner、Codex/Claude/Grok adapter、外部 job 和 Worktrunk（`c29ae86`） | **冲突** | 委派执行始终留在 Pi 内。Pi Stuff 原生 worktree 隔离仍是唯一 provider。 |
| 上游 Fleet/TUI 面板、token 状态栏、设置 UI、slash alias 和等待/自动排空 Tool | **不适用** | `/agents` 与 Suite 对话 UI 是单一可见权威。普通前台 Agent 运行仍由 Pi 负责。 |
| Memory、Share、Teams、上游提示词库、捆绑 Agents/Skills、Doctor/admin 和 Profile 管理 | **不适用** | 这些是独立上游产品，不是 Agents 生命周期基础。 |
| `defaultProvider`、`maxThinking`、持久模型排除 TTL 及相关上游 Profile 设置 | **不适用** | Pi 的活动模型 registry 与明确的启动/Agent 模型契约负责选择。Pi Stuff 不添加并行的全局 Profile 系统。 |

## 同步结果

保留的 Agents 能力不存在已知但未分类的 `v0.38.0..v0.63.0` 差异。实现采用了此范围内所有适用的完成、
超时、Tool 能力、发现、fallback、fork 历史和持久化修复；现有本地实现覆盖其余保留行为。排除的变更均绑定到
上面具名的产品或生命周期边界，而不是留成未说明的未来工作。

下一次上游同步必须从 `v0.63.0` / `4f7eb2b56dc5306416920db8c6e222c7aaad3c81` 开始，并追加新的带日期
台账；不得把本文档重新解释为上游 API 或产品兼容承诺。
