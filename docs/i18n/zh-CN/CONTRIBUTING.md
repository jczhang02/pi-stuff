# 贡献指南

[English](../../../CONTRIBUTING.md)

## 语言与呈现

以英文版为准。面向人的文档须在同一 PR 中成对维护中英版本，两种语言版本互链，含义保持一致。目前的文档对如下：

- `README.md` / `docs/i18n/zh-CN/README.md`。
- `CONTRIBUTING.md` / `docs/i18n/zh-CN/CONTRIBUTING.md`。
- `docs/adr/` / `docs/i18n/zh-CN/adr/`。

中文文档统一放在 `docs/i18n/zh-CN/`。代理指令和技能仅保留英文，不另建中文代理规则。对话使用中文。

GitHub 上新增或实质性更新的面向人的内容须采用**英文在前、中文在后**的双语形式，包括 Issue 和 PR 描述、面向人的标题、评论、审查摘要及未来的发布说明。长文优先在每节内先写英文，再写中文。标识符、命令、规范的机器字段名和状态枚举、URL 及哈希无需翻译或重复。

不批量补译历史讨论或机器生成的机器人元数据；实质性编辑面向人的内容时再补充翻译。历史研究资料无需批量翻译。

使用 Markdown 让证据易于查找：

- 可枚举的事实、步骤和验收标准使用列表。
- 标签和结论按需**加粗**。中文标签的标点放在加粗范围外（`**标签**：内容`），或在其后留空格（`**标签：** 内容`），以便 GitHub 正确渲染。
- 证据和相关工作使用链接。
- 长日志放入可折叠的 `<details>` 块，正文保留简短结果。

简短解释保留为普通段落，不要求每句话都使用富文本格式。

## 创建 Issue

本项目由一位维护者和多个编码代理协作开发。行为变更和多步骤工作需要带验收标准的 Issue。错字和格式修复可直接提交 PR，无需单独创建 Issue。

提交前先搜索已有 Issue，选择对应模板：

- **Bug report**：提供复现步骤、预期与实际行为、版本和相关输出。
- **Feature request**：说明问题及建议方案。
- **Engineering task**：定义范围和可验证的验收标准。

不适合现有模板的请求仍可使用空白 Issue。通过 CLI 创建的 Issue 须包含与网页模板相同的信息，并明确设置分流标签，见[分流标签规则](../../agents/triage-labels.md)。

## 开展任务

开始前阅读 Issue 正文、评论和链接的执行记录。认领前检查归属和阻塞项。一个任务只有一位执行负责人、一个短期分支和一个位于 `.worktrees/` 下的工作树。非简单变更须先约定范围和验收标准。每次变更应聚焦于任务。

及时提交已验证的完整变更单元，并推送任务分支。通过 PR 提交，不直接推送 `main`。不要修改其他代理的工作，也不要移除包含未提交或未推送变更的工作树。

代理须遵守 [AGENTS.md](../../../AGENTS.md)，包括 Sepia 写作要求；Beads、同步和公开更新遵循 [Issue 跟踪流程](../../agents/issue-tracker.md)。其他贡献者无需安装 Beads。

## 提交规范

每个新增 Git 提交及 PR 标题都须符合 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)。PR 标题用于 squash 提交，不重写历史提交。

```text
feat(context): add context selection / 添加上下文选择
fix: preserve empty input / 保留空输入
refactor(api)!: remove the obsolete entry point / 移除旧入口
```

type 由小写字母组成，可选的非空括号 scope、可选的 `!`，再加 `: ` 和非空描述。正文及 footer 与标题之间留空行。type 不限于上述示例；merge、revert、fixup 消息不自动豁免。检查器校验标题、空行分隔和控制字符。正文允许自由文本，不会把也可能是正文或示例的行自动识别为 footer；footer 语法、type 含义及破坏性变更声明仍由作者和审查者负责。

完成下方禁用生命周期脚本的冻结安装后，显式设置 [Husky](https://typicode.github.io/husky/)：

```bash
git config --show-origin --get core.hooksPath
bun run hooks:install
```

第一条命令退出状态为 `1`，表示尚未设置该值。若输出不是本仓库的 `.husky/_`，先停止安装，与维护者确认既有 hook 如何处理。还须检查 `git rev-parse --git-path hooks` 返回的目录；即使 `core.hooksPath` 未设置，存在有效自定义 hook 时也须先确认。设置会检查共享及最终生效的配置作用域，包括覆盖、空值和重复设置；须与维护者协调，不要并发修改 hook 配置。仅在验证并放置 helper 后，安装才修改此克隆的 Git hook 路径。关联工作树共享该设置，但生成的 hook 文件各自独立；每个准备提交的当前工作树都须运行设置命令。生成的 `.husky/_` 不提交；设置命令会拒绝覆盖已有 helper 目录，重装时须先检查，再删除生成的 helper。生成失败不会改变 hook 配置；若最后写配置失败，会留下完整 helper 供检查，重试前须确认配置与 helper 目录两处状态。不能假定尚无此设置的旧工作树已受保护。

`commit-msg` hook 在 Git 清理消息前校验原文件。首行须直接写规范标题，不依赖 Git 删除前面的注释或空行；hook 还会通过 Git 检查首行是否会被当前注释前缀删除，冲突时拒绝；不会用清理后的正文替代原文件。可用 `bun run check:commit --message-file <path>` 直接检查文件。本地 hook 可以被绕过，因此 CI 还会校验新增提交和 PR 标题，草稿 PR 也不例外。PR 检查覆盖从 head 可达、但从 base 不可达的每个提交，支持分支落后于 base，也不会遗漏中间的违规提交。main 推送检查新增集合，`before` 全零的首次推送检查全部可达历史；手动触发只检查选定的 `GITHUB_SHA`。提交消息从原始对象读取，严格解码 UTF-8，并交由 Git 验证对象格式，不使用可能丢失内容的日志呈现输出。历史缺失或浅克隆会失败，不会跳过。保留必需的 CI 检查，squash 时使用已验证的标题；设置不依赖自动运行的依赖生命周期 hook。

## 验证变更

Pi Stuff 使用 TypeScript 和 Bun，仓库检查也使用这套工具链，见[工具链决策](adr/0001-typescript-bun.md)和 [Effect/质量决策](adr/0002-effect-quality.md)。安装 `package.json` 的 `packageManager` 和 `engines.bun` 指定的确切 Bun 版本，目前仍为 `1.4.0`；CI 也读取该文件。直接工具依赖固定版本；`bun.lock` 记录解析后的依赖图和完整性哈希。

修改源码、测试、依赖或检查前，阅读[工程规则](../../agents/engineering.md)。所有自有源码和测试都须将 15 条通用 anti-slop 规则、1 条 Effect 规则以及 Oxlint correctness 规则设为错误，不得通过抑制、放宽设置、借类型推断掩盖宽泛类型或编造安全断言绕过。使用严格 TypeScript 和未使用代码检查。确有规则冲突时须复现并上报，不能绕过检查。

Effect `4.0.0-rc.112` 是选定框架，用于边界解码、类型化错误和必要的 I/O 编排，包括仓库脚本；纯算法保留为普通函数。绝不能仅因 RC 状态拒绝 v4、降级到 v3 或改用其他框架。具体不兼容问题需要实际复现、证据和维护者决定。查阅 v4 文档，不假定 v3 API 仍然适用。

在仓库根目录运行：

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
git diff --check
```

`bun run check` 依次运行 `format:check`、`lint`、`typecheck`、`test` 和 `check:repo`。Bun 执行 TypeScript 时不检查类型，因此类型检查单独运行。安装时禁用依赖生命周期脚本；工具依赖均不需要这些脚本。

| 命令                                               | 用途                                          |
| -------------------------------------------------- | --------------------------------------------- |
| `bun run format`                                   | 在本地用 Oxfmt 写入格式修改                   |
| `bun run format:check`                             | 只检查格式，不写入；CI 使用此命令             |
| `bun run lint`                                     | 运行 Oxlint correctness 和严格 anti-slop 检查 |
| `bun run typecheck`                                | 运行严格 TypeScript 和未使用代码检查          |
| `bun run test`                                     | 运行回归测试和规则生效探针                    |
| `bun run check:repo`                               | 检查仓库约定和安全基线                        |
| `bun run check:pr --body-file /path/to/pr-body.md` | 检查 PR 证据结构                              |

Oxfmt 使用 Google GTS 格式偏好，具体[显式设置和固定上游来源](../../agents/engineering.md#formatting-and-verification)见工程规则，不安装 GTS、ESLint 或 Prettier。CI 只检查格式；写入格式修改的命令在本地运行。本次基线不引入 Knip、硬性覆盖率目标、完整变异测试框架或竞争性的 lint/格式工具。保留现有回归场景和脚本外部可观察行为，不固定测试数量。

发布 PR 描述前，运行 `bun run check:pr --body-file /path/to/pr-body.md`。文件按文本读取，不会执行。CI 会针对拉取请求事件单独运行此检查。

仓库检查器验证已跟踪文本的格式、Markdown 文件链接、YAML/frontmatter、标签和 CI 安全基线。它不是完整的 Markdown 渲染器、外部链接检查器或 GitHub Actions schema 验证器。新文件须先加入暂存区，检查器才会包含它们。其测试使用仓库外的临时夹具。

对受影响区域运行其他适用检查。修复 Bug 时尽可能复现失败并添加回归测试。报告实际运行的命令和观察到的结果。如果行为没有自动检查，说明手工验证方式，或明确写出未测试及原因。不要编造测试命令或结果。

发布日志或截图前，移除凭据和个人信息。

## 创建 PR

阅读 [PR 证据要求](../../agents/pr-evidence.md)，使用 `.github/pull_request_template.md`。先描述变更前后的行为或工作流，再说明实现方式和重要决策。将复现步骤、实际命令、观察结果与证据放在一起，使维护者可以重复验证。

保留 [PR 证据要求](../../agents/pr-evidence.md#required-sections)中五个完全一致的英文 H3 标题。逐节翻译时先写英文，可在每节内用 `#### 中文` 块放置译文。不得翻译或重复机器标题。声明字段名保留英文，在 `Risk and review` 中各出现一次；中文解释不要重复这些字段名。

声明可写成普通行，也可使用无序列表符号和加粗的字段标签，例如 `- **Risk level:** high`。状态值仍为不加格式的规范枚举：`low` 或 `high`；`completed`、`not-required`、`pending` 或 `waived`。这是有限的语法约定，不支持任意 Markdown 解析：不支持加粗状态值或表格声明。重复字段、占位内容、代码围栏中的声明和不完整的审查证据仍不合规。

分节布局示例：

```markdown
### Verification and reproduction

Not tested: this host cannot run the target terminal; the manual check remains pending.

#### 中文

未测试：此环境无法运行目标终端，手工检查仍待完成。
```

标题、声明字段名和枚举值属于机器约定。证据和审查结论必须反映当前变更，不能照抄示例当作事实。

声明风险和独立审查状态。高风险变更需要独立审查上下文，或维护者明确豁免；报告审查范围、发现、修复和未解决的问题。实质性代码变更（包括质量基线 PR）还须使用 `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`，在独立上下文中审查完整差异。上游标准是强制要求。审查只读，实现仍由任务负责人负责。具体结构问题默认阻塞，直到修复或用证据反驳，并经独立复查；未解决的分歧交给维护者。文档或机械变更不会自动触发这一特定深度审查，但高风险审查要求仍然适用。

可见 UI 变更须附实际截图或录屏；适用时提供图示和设计决策。无法提供的证据应明确说明。简单变更保持简短。

PR 打开、编辑、更新、重新打开、标记为就绪或转为草稿时，CI 检查描述结构及风险/审查声明。草稿可暂留不完整证据。检查器不会执行 PR 文本，也不能证明测试、截图、风险评估或豁免的真实性。实质性变更后须更新描述和受影响证据。

只有合并后将满足 Issue 验收标准时，才使用 `Closes #number`；否则用 `Refs #number`。创建 PR 不代表任务完成。无 Issue 的简单修复或经明确授权的初始化变更，应在 PR 中解释原因。

## 合并与交接

所有进入 `main` 的变更，包括文档、模板和 CI 配置，都必须经过 PR。任务分支仍可正常推送。本地 Beads 数据和远程 GitHub 设置不是 Git 提交；修改远程设置仍需授权。

当前主分支规则集没有可绕过规则的主体。不得为推送或合并而禁用规则集。仓库所有者可以通过管理权限修改规则，因此分支保护是当前强制设置，并非不可撤销的限制。

主分支规则集要求 PR、已解决的审查对话，以及在与 `main` 同步的分支上通过 `checks` CI 作业。本单维护者仓库不强制要求独立批准。使用 squash merge；合并后的远程分支会自动删除。

即使 CI 通过，代理合并或发布仍需用户明确授权。共享 GitHub 凭据无法区分人和代理，因此这是代理规则，不是独立的 GitHub 权限边界。尚未配置发布自动化。

交接前，报告验收结果、实际检查、相关文档变更、已推送的提交、PR 链接，以及待处理的跟踪器更新。任务可以已经实现，但仍在等待审查或合并。合并验证和交接后，遵循[工作树清理规则](../../agents/workflow.md#worktree-cleanup)；报告保留的任务工作树及原因。

## 仓库维护

主分支规则集记录在 `.github/rulesets/main.json`，标签清单记录在 `.github/labels.json`。这些文件只记录目标设置，不会自行应用。修改远程约束须先取得维护者授权，再核验线上设置。

Actions 使用只读令牌、GitHub 托管 runner 和以 SHA 固定的外部 action。Dependabot 每周检查 GitHub Actions 和 Bun 依赖。依赖更新 PR 需要通过检查，并遵守相同的合并授权要求。项目自有内容采用 [MIT 许可证](../../../LICENSE)，第三方声明均须保留；支持的 Pi 宿主版本和发布政策仍未确定。

## 模板来源

Bug、功能请求和 PR 模板改编自 [GitHub CLI](https://github.com/cli/cli)：

- [Bug report](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](https://github.com/cli/cli/blob/trunk/.github/ISSUE_TEMPLATE/submit-a-request.md)
- [Pull request](https://github.com/cli/cli/blob/trunk/.github/PULL_REQUEST_TEMPLATE.md)

项目专属说明已替换为本仓库工作流。工程任务模板由本仓库编写。改编模板的上游 MIT 声明保留在 `.github/TEMPLATE_LICENSE`，项目自有内容另由根目录 [MIT 许可证](../../../LICENSE)覆盖。
