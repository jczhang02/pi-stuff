# 贡献指南

[English](../../../CONTRIBUTING.md)

## 语言与呈现

以英文版为准. docs 下的文档及已有根文档对照在同一 PR 中维护中英版本, 双向链接且含义一致. 当前文档对为:

- `README.md` / `docs/i18n/zh-CN/README.md`.
- `CONTRIBUTING.md` / `docs/i18n/zh-CN/CONTRIBUTING.md`.
- `docs/adr/` / `docs/i18n/zh-CN/adr/`.
- `docs/research/` / [中文研究对照](research/).
- 根 `AGENTS.md` / [中文阅读对照](agent-instructions.md).
- `docs/agents/` / [中文阅读对照目录](agents/).

中文文档放在 `docs/i18n/zh-CN/`, 代理执行指令和技能仅用英文. 根 `AGENTS.md` 和 `docs/agents/` 中的每份文档均配有中文阅读对照, 在同一 PR 中同步更新并双向链接, 不作为另一套代理指令来源. 对话使用中文.

Issue 和 PR 标题仅用英文. 新增或实质更新的描述、评论、审查摘要及未来发布说明先英文后中文, 长文在每节内附译文. 标识符、命令、URL 和哈希无需翻译. 不批量改写历史讨论或机器元数据. docs 下全部文档需要中文对照, 包括明确标为历史记录的研究文档. 该补译范围不扩展至 `.github/`、`tools/` 或 `.agents/skills/`, 保留它们既有的双语内容或上游原文.

可枚举事实用列表, 重要标签按需加粗, 证据使用链接. 中文标点放在粗体标签外（`**标签**：内容`）或增加分隔空格. 长日志折叠进 `<details>`, 短说明保留普通段落.

## 创建 Issue

本项目由一位维护者和多个编码代理协作. 行为变更和多步骤工作需要带验收条件的 Issue, 错字和格式修复可直接提交 PR.

先搜索现有任务, 再选模板：bug 需要复现、预期/实际行为及版本；功能请求需要问题和方案；工程任务需要范围和可验证的验收条件. 仍可创建空白 Issue. CLI 创建的 Issue 须包含同等信息及明确的[分流标签](../../agents/triage-labels.md).

## 开展任务

认领前阅读 Issue、讨论和执行上下文. 每个任务只有一位执行负责人、一个分支及一个 `.worktrees/` 下的工作树. 非简单变更先确认范围和验收条件, 保留其他代理的工作及无关本地修改.

及时提交已验证的完整变更单元, 推送任务分支并开 PR, 不直接推送 main. 代理遵守 [AGENTS.md](../../../AGENTS.md)、Sepia 及[跟踪流程](../../agents/issue-tracker.md), 其他贡献者无需安装 Beads.

## 提交规范

每个新提交和 PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), 使用标准 [`@commitlint/config-conventional`](https://commitlint.js.org/reference/configuration.html) 配置. squash 合并使用已验证的 PR 标题, 不改写历史.

```text
feat(context): add context selection
fix: preserve empty input
refactor(api)!: remove the obsolete entry point
```

标准 type 为 `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、`revert`、`style`、`test`, scope 可省略. 标题上限为 100 字符, 描述不得以句点结尾或使用被禁止的大小写形式. 正文/footer 行长限制与空行警告遵循上游配置. 关闭默认忽略豁免, 避免纯版本号或生成消息跳过校验, 标准配置的规则本身不变. 英文标题、语义准确性和真实破坏性变更声明仍由作者和审查者负责.

### 本地 hooks

完成下方冻结且禁用生命周期脚本的安装后, 先检查共享及最终生效的 Git hook 配置和现有文件. 存在自定义 hook、覆盖或异常值时停止, 向维护者确认. 官方 Husky 命令不提供原自研安装器的配置保全保证.

```bash
git config --show-origin --show-scope --get-all core.hooksPath
git config --local --get-all core.hooksPath
git rev-parse --git-path hooks
bun run hooks:install
```

未设置时查询返回状态 1, 本仓库预期路径为 `.husky/_`. 重新生成前检查已有 helpers, 协调安装而不并发修改共享配置. 关联工作树共享 Git 设置, 但各自需要生成 helpers. 显式调用 Husky 9, 不使用 `prepare` 或依赖生命周期脚本；生成的 `.husky/_` 保持忽略.

- `pre-commit` 执行 `bun run check`, 只检查格式、lint、类型, 不改写或暂存文件. 显式修复失败并核对差异后重试.
- `commit-msg` 用已安装的 commitlint CLI 读取消息文件, 不再使用自研消息解析器、历史读取器或安装器.

本地 hook 可以绕过. CI 独立检查包括草稿在内的 PR 标题, 不再逐个检查分支提交. 代理仍须为每个新提交遵守规范.

## 验证变更

使用 `package.json` 固定的 Bun 版本, 当前为 `1.4.0`. 直接工具依赖固定版本, `bun.lock` 记录依赖图. 修改源码、测试、依赖或检查前阅读[工程规则](../../agents/engineering.md).

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
git diff --check
```

`check` 运行 `format:check`、`lint`、`typecheck`. `bun run format` 显式写入格式修改, hook 和 CI 不写入. Bun 执行代码不替代类型检查.

15 条通用 anti-slop 规则、Effect 规则及 Oxlint correctness 规则在自有源码和测试上保持为错误. 保留严格 TypeScript 和未使用代码检查, 不通过抑制、放宽设置、类型掩盖或编造断言绕过. Oxfmt 保留 [Google GTS 偏好](../../agents/engineering.md#formatting-and-verification), 不安装 GTS、ESLint 或 Prettier. 不为形式增加 Knip、覆盖率目标、变异测试框架或竞争工具.

Effect `4.0.0-rc.112` 仍用于边界解码、类型化错误和必要 I/O, 纯算法保留普通函数. 绝不因 RC 状态拒绝 v4、降级 v3 或改框架. 具体不兼容需要复现、证据和维护者决定, 查阅 v4 API. 见 [ADR 0001](adr/0001-typescript-bun.md) 和 [ADR 0002](adr/0002-effect-quality.md).

当前没有仓库自有自动化测试或 `test` 命令. 已删除治理程序的六组测试不作为占位保留. 自有行为确需维护时再增加测试, 包括有用的 bug 回归；报告实际命令和局限. 标准 hook 接线只做聚焦的集成验证, 不另建测试套件重测 Husky 或 commitlint.

作者和审查者直接核查受影响的 Markdown 链接、模板、标签、依赖和 CI 安全设置, 不再使用自研仓库政策或 PR 正文验证器. 发布证据前移除秘密和个人信息.

## 创建 PR

使用 `.github/pull_request_template.md`, 遵循 [PR 证据要求](../../agents/pr-evidence.md). 说明行为/影响、方案、实际验证、风险/审查和关联任务, 先英文后中文. 这些是人工审查要求, 不是 Markdown 解析契约. 简单变更保持简短, 如实说明未验证行为.

高风险变更需要独立审查或明确授权的豁免. 实质性代码变更须按 `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` 的强制上游标准, 在分离只读上下文审查完整差异. 负责人实施修复；具体发现阻塞, 直到修复或用证据反驳并独立复查. 分歧交维护者决定. 文档/机械变更不自动触发这项特定审查, 高风险要求仍适用.

适用时提供真实 UI 证据或有用的设计图. 实质变更后刷新相关证据. 合并即可满足验收时用 `Closes #number`, 否则用 `Refs #number`; 开 PR 不等于完成任务.

独立的 `title` 工作流与本地 hook 使用相同 commitlint 配置检查 PR 标题. 元数据编辑只重跑这项轻量检查, 不重跑代码检查. 代码工作流在 PR 打开、同步、重开、就绪、main 推送和手动触发时运行. 更换 PR 基线后, 合并前同步分支并重跑代码 CI. PR 证据与审查真实性仍由人和代理负责.

## 合并与交接

所有仓库修改通过 PR 进入 main. 当前规则集没有绕过主体, 要求审查对话已解决、线性历史及与 main 同步分支上的 `checks` 和 `title` 两项作业, 两项必需状态均绑定 GitHub Actions. 不为合并而禁用保护. 维护者已在 #21 中授权新增标题门禁；没有相应规则集设置时, 工作流成功不自动意味着它是合并条件. 仓库所有者能修改设置, 因此这些是当前执行的设置而非不可撤销保证.

squash 使用已验证 PR 标题, 合并后远端分支自动删除. CI 通过也不授权代理合并或 release. 共享凭据不能区分人和代理授权；未配置 release 自动化.

报告验收、实际验证、剩余测试、已推送提交、PR 链接及待处理跟踪器或远端设置工作. 保留未合并的任务工作树. 授权合并、验证及交接后遵循[安全清理](../../agents/workflow.md#worktree-cleanup), 说明保留工作树及原因.

## 仓库维护

`.github/rulesets/main.json` 和 `.github/labels.json` 记录设置, 不自动应用. 远端变更须授权并实际核验. Actions 保持只读令牌、GitHub 托管 runner、固定 SHA, 不引入特权触发器. Dependabot 每周检查 Actions 和 Bun 依赖, 更新仍需要检查及合并授权.

自有内容使用 [MIT](../../../LICENSE), 保留第三方声明. 支持的 Pi 宿主版本和发布政策仍未确定.

## 模板来源

Bug、功能和 PR 模板改编自 [GitHub CLI](https://github.com/cli/cli)：[bug](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md)、[feature](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md)、[PR](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md). 项目指令替换为本仓库流程, 任务模板为本地编写. 上游 MIT 声明保留在 `.github/TEMPLATE_LICENSE`, 与项目根许可证分开.
