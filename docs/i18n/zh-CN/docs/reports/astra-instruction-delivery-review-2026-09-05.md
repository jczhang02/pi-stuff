<!-- translation-source: docs/reports/astra-instruction-delivery-review-2026-09-05.md; translation-source-sha256: 5400f90bfe714d522ecfda808914a85c6344474cc5ffb9b485a31458e3a281a1 -->

# Astra 指令与交付审查 — 2026-09-05

本次指令迁移减少重复读取、验证和完成规则，同时保留 Pi 权限边界、源码质量限制、真实 Host 验收及 Beads 交付契约。运行时模型默认值保持不变。

## 依据与范围

[OpenAI 的 Astra 指导](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)建议检查 Agent 指令和 Skill 中的冲突，并按工作流程调整澄清、委派、输出和测试。本次本地修改侧重自主完成已授权工作及按风险验证，不增加模型专用配置或迁移 API。

审查范围包括根 AGENTS、代码质量、兼容性、贡献指南、受跟踪的 Beads Skill、Issue 跟踪契约、ADR 0032 及其中文镜像。全局 Codex 指令和已安装 Skill 不在修改范围。全局委派规则仍规定角色、上下文继承和等待方式；修改仓库指令不会移除这些全局规则。

## 验证取舍

| 发现 | 决定 |
| --- | --- |
| 本地全量检查后再跑等价 CI 会重复执行 | 开发时运行针对性检查，复用同一版本所需 CI 证据 |
| 固定清洁审查轮数重复已完成的判断 | 一次审查完整受影响范围；发现问题后修复并复审修改和受影响范围 |
| Package 和 Module README 不必要地触发 Acceptance | 扩展既有普通文档白名单，Runtime Resource 和未知变更仍完整检查 |
| 重命名可能将可执行源码藏在文档路径下 | 本地 CI 和 PR 发布都按重命名前后路径分类 |
| Tool Activity 阈值和重复 Host 启动需要更深入证据 | 保留现有 benchmark、源码及解包 Package 验证，不凭成本猜测删除保护 |
| 验证文字可能声称并未通过的检查 | 发布前依据实际 CI workflow 和精确 attempt 验证目标提交 |

隔离测试运行器串行执行，每个文件启动新进程。Package 验证还对源码和解包内容运行真实 Host/PTY 场景。这些是成本线索，不是实测瓶颈。本报告不声称耗时改善，也不否定不同层级检查能发现不同缺陷。

## 交付强制与限制

发布器要求目标提交最新适用 CI 运行中的必需 job 成功。PR 使用当前 head 和完整文件列表；仅分支记录将最终目标放在最后。文档 PR 和直接推送保留仅 Fast 的政策，手动运行要求两项检查。必需检查缺失或失败会阻止发布。评论链接 Actions attempt，并继续要求精确回读评论及 Issue。

CI 证据不能证明审查质量、提交签名、分支保护、合并授权或真实 Provider 验收；适用时它们仍是明确验收条件。无代码工作需要既有证据及原因，不伪造 CI。历史 Actions 证据缺失时，重新发布不能重新认证成功。

## 实现阶段验证

- 发布器、CI 证据与范围分类的针对性测试全部通过：19 项，无失败。
- 完整 `check:fast` 通过，包括仓库安全和翻译 SHA 校验。
- 对真实 GitHub Actions 的只读检查接受成功的直接推送 Fast 结果，并拒绝已知失败记录；不据此推断本次发布或合并成功。
- 最终审查、分支 CI 和公开交付证据记录在 Bead `ps-8l7`，本报告不替代它们的最终结果。

## 物理行数

比较基准为源码版本 `6ddb5cfa` 与本次实现快照。新增验证保护外部信任边界；指令变短不是省略必需证据的理由。

| 文件 | 修改前 | 修改后 |
| --- | ---: | ---: |
| `AGENTS.md` | 85 | 54 |
| `docs/code-quality.md` | 59 | 41 |
| `.github/CONTRIBUTING.md` | 42 | 31 |
| `.agents/skills/beads/SKILL.md` | 65 | 31 |
| `scripts/publish-beads.ts` | 266 | 298 |
| `scripts/beads-delivery-checks.ts` | 0 | 75 |
| `scripts/ci-acceptance-scope.ts` | 60 | 70 |
| `test/publish-beads.test.ts` | 222 | 298 |
| `test/beads-delivery-checks.test.ts` | 0 | 90 |
| `test/ci-acceptance-scope.test.ts` | 30 | 43 |

## 验收跟进 — 2026-09-06

首次[分支 Acceptance 运行](https://github.com/jczhang02/pi-stuff/actions/runs/33976280826)的 Fast 通过，但 `test/goal-pty.test.ts` 失败：Ubuntu 的 tmux 3.4 不支持 `extended-keys-format`。在匹配到的 PTY 初始化中，只有 Goal 验证器未先探测就设置了这个可选项。使用真实 tmux 3.4 在本地运行同一测试，不到一秒即复现错误。复用既有服务器选项探测后，完整 Goal PTY 测试在 tmux 3.4、3.6a 和 Pi 0.85.0 上均通过。修复仅涉及验证环境初始化，不改变 Goal 行为或断言。

`1724b346` 上的[下一次运行](https://github.com/jczhang02/pi-stuff/actions/runs/34000105818)通过了 Fast 和 Goal PTY，但 Context 多步恢复场景失败：fixture 记录了三次 Provider 请求，预期为两次。随后两次本地针对性运行分别失败和通过，确认存在间歇性失败。计数对应实际请求，并非误匹配经过转义的请求文本。本次变更未修改该场景或 Context 运行时；额外请求的原因仍未查明。其他隔离测试文件通过，但失败阻止了后续验收阶段。PR 228 保持草稿、未合并；完整验收与经验证的交付仍未完成。
