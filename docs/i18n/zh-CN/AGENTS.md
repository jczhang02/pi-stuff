<!-- translation-source: AGENTS.md; translation-source-sha256: c11a049650c1c4081da24cdce63f0ca0959959e64be3d77064f05d2c792dafb4 -->

# 仓库指令

这些指令只在开发本仓库时适用。`AGENTS.md`、`CONTEXT.md` 和 `docs/` 是工程材料，不是 Pi Runtime Resource；
绝不能把它们复制到用户的全局 Pi Agent 目录。

## 按任务阅读

- 修改代码前，阅读 `CONTEXT.md`、相关已接受 ADR 和 `docs/compatibility.md`。
- 执行质量、重构、fork 集成或源码精简工作前，还要阅读 `docs/code-quality.md`。
- 修改可见界面时，还要阅读 `DESIGN.md` 与负责该界面的 Module README 或 ADR。处理工作项时，阅读
  `docs/agents/issue-tracker.md`。
- 使用词汇表中的规范术语。持久术语或架构决策要写入 `CONTEXT.md` 或 ADR，不能只留在 Session 历史中。

## 工作规则

- 修复共享根因，并检查受影响的完整 Capability，而不是只修报告中的例子。优先在负责该问题的 seam 上做最小
  变更，并复用 Pi 的公开 API、原生行为和现有 Suite component。
- 无论来源如何，每份被跟踪的实现、测试、脚本、prototype、生成源码和仓库质量工具都是
  Repository-owned Source。来源绝不允许 Biome、Oxlint/anti-slop、TypeScript、依赖分析、文件大小或可维护性
  豁免。只排除非代码机器状态与产物。
- 遵循 `docs/code-quality.md` 中的大小门槛和行数证据政策。拆分文件必须加深负责它的 Module，并减少概念或
  状态；不能把相同复杂度分散到机械碎片中。
- 面对实质性设计选择，先比较可行选项和证据，再选最小且足够的方案。用直白语言解释陌生术语和结果。
- 显然且可逆的仓库内决定可直接做。只有当范围、权限或实质产品决定确实依赖用户时，才在对话中提出一个
  简短问题，不使用问题 widget。
- 让长时间工作保持可观察。Agent 负责聚焦检查和有代表性的真实 Host 验收；不要把例行验证交还用户。
- 测试范围要与风险相称：只写保护真实行为或已确认回归所需的最小聚焦覆盖，不写重复、推测性或臃肿测试。
- 每次代码变更都必须针对完整最终 diff，通过 `docs/code-quality.md` 中的 Thermo-Nuclear 完成审查。
  小型隔离变更需要一次聚焦且无发现的 review。广泛、跨 Capability、架构、全仓库质量/重构/
  源码精简或 Release 风险工作，需要独立 reviewer 反复审查完整受影响范围，直到连续两轮都无发现。
  任何 finding 在修复或用直接源码证据证明不成立前都会阻止完成；之后任何代码变更都会使无发现结果失效。

## 硬边界

- Pi 是 Host。不要创建另一套 CLI、runtime、Session layer、SDK 或 TUI shell。Pi Stuff 保持一个本地 Package
  和一个默认 Extension factory；Capability Module 仅供内部使用，不独立安装或发布。
- 生命周期权威留在其 owner：Pi 负责普通前台 Agent run，Goal 负责 Goal continuation 和终止政策，Agents
  负责 delegated execution。Context Management 负责 context projection、retrieval、compaction 和压力处理，
  不负责任务收敛、其他生命周期的限制或终止决定。
- 保持 Extension import 纯净。Session startup 不得联网、启动 subprocess、修改 Host 设置，或创建、重写、
  迁移用户配置。首次使用配置必须等待直接 interactive/RPC input、显式命令或 Tool。初始化错误应传播，不能
  加载部分 Suite。
- UI 遵循 `DESIGN.md`，同一状态只能有一个可见权威。只发布 TypeScript 源码，不建立 `dist/` 通道。修改
  `packages/pi-stuff/suite.json` 后运行 `bun run suite:generate`；不得只编辑生成的组合输出。

## 工作流与安全

- 所有 Pi Stuff Git worktree 都放在仓库内的 `.worktrees/` 下。
- 使用 `docs/compatibility.md` 指定的版本；直接依赖必须精确，`trustedDependencies` 必须为空。
- 开发期间，从包含变更的 worktree 根目录运行聚焦测试和 `bun run check:fast`。PR 标记 ready 或合并前，
  在同一 worktree 针对最终变更运行 `bun run check`。其他 worktree 的检查不能认证这些变更。mock 不能用于
  声称公开 seam 已认证。
- 不要仅凭 ancestry 推断已合并。报告 merge 或清理状态前，检查相关 patch 或 commit、每个关联 worktree 的
  tracked/untracked 状态以及目标分支。
- worktree 的变更合并后，先确认其中没有 tracked 或 untracked 工作，再及时删除该 worktree。
- 在相关聚焦检查后及时提交并推送小而完整的 checkpoint；不要把无关工作堆进一个 commit。使用带签名的
  Conventional Commit。
- 人工英文 Markdown 是权威来源。行为、契约、术语、兼容性或流程改变时，在同一次变更中更新负责它的当前
  文档。每份保留的英文 Markdown 都在 `docs/i18n/zh-CN/<仓库路径>` 下拥有镜像，记录源路径与原始源文件
  SHA-256，并在同一次变更中同步。对字节敏感的 Runtime `SKILL.md` 与 `THIRD_PARTY_NOTICES.md` 不翻译；
  历史中文执行清单继续只保留中文。
- 保持 `docs/README.md` 定义的 Wiki 分工：入口和 Package README 描述当前行为，Module README 负责局部契约，
  `CONTEXT.md` 负责规范语言和边界，`DESIGN.md` 负责共享可见界面规则，ADR 解释持久取舍，保留的 research、
  report 和 Release note 是有日期的证据。Git 历史用于归档已删除 prototype、重复渲染产物和冗余证据。
- 创建 Bead 时，要记录足够的对话来源元数据，以便找回源 Session：发起它的 Host 或 Agent 界面（`Pi`、
  `Codex` 或其他具名界面）、可用时的 Session 名称，以及稳定 Session ID 或等价查询键。只记录元数据并
  遵守公开数据政策；绝不能把 transcript 内容或敏感 Session 数据粘贴进 Beads。
- 绝不能提交凭据、auth、model store、Session、cache、`.env`、机器状态或私有绝对路径。安装 Suite 必须由
  维护者显式运行 `pi install`；Suite 代码不得自行安装。

Beads 是规范 issue tracker；GitHub Issues 是只向外推送的公开镜像和外部入口。五个规范 label 与单 context
domain 布局定义在 `docs/agents/` 下。
