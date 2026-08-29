<!-- translation-source: docs/code-quality.md; translation-source-sha256: 1d4521fa116b8d77697a009a857e29a4e18da263b392dd7dc51863759b4840c3 -->

# Repository-owned Source 质量标准

所有被跟踪的 Pi Stuff 代码都是 Repository-owned Source。本地编写、fork、vendored、源自上游、生成、测试、
prototype、脚本和质量工具代码都适用同一可维护性标准。来源只决定归属说明与许可，不构成质量豁免。机器状态、
缓存、worktree、构建产物、二进制资产和正文不是代码，因此不在代码检查范围内。

## 必须达到的标准

- 每个被跟踪的代码目录都必须参与 Biome、带 anti-slop 规则的 Oxlint、适用时的严格 TypeScript，以及未使用
  文件和依赖分析。不得按目录或来源提供整体豁免。
- TypeScript profile 只能因为运行时需要不同的 library、module resolution 或 target 而不同。不得关闭共享
  的严格性、未使用代码、索引访问、可选属性、override、副作用导入或 erasable syntax 规则。
- 格式化后的人工维护文件通常应为 200–400 个物理行。超过 500 行必须进行明确的 cohesion review；800 行是
  合并上限。函数通常应为 20–50 行，超过 80 行必须审查，且不得超过 120 行。
- `check:repository` 对所有仓库代码执行 800 行文件上限，并递归执行 JavaScript/TypeScript 的 120 行函数
  上限。它检查已跟踪文件和未忽略的未跟踪文件，但排除已删除文件、二进制资产、正文和报告产物。
- 拆分文件必须减少同时承担的职责、可变状态、分支或概念。把原有复杂度搬进机械命名的碎片并不满足标准。
- 代码质量工作要报告前后物理行数。行数是审查证据，不是验收配额：应调查无法解释的 Capability 增长，并优先
  删除重复、分支、wrapper、兼容层或状态。当变更形成更深的 Module，或保留必要的说明、验证、安全、数据完整性、
  无障碍或兼容性时，行数不变或增加也可以接受。不得通过压缩语法或削弱保障来改善指标。
- 测试用于证明行为和兼容性。测试通过永远不能代替依据本标准进行源码审查。

## Thermo-Nuclear 完成审查

- 每次代码变更都必须使用 `thermo-nuclear-code-quality-review` Skill 审查。针对固定 base 的完整
  diff 和完整受影响 Capability 进行检查。如果该 Skill 不可用，本节仍然是必须遵守的 approval bar；
  Skill 不可用绝不构成豁免。
- 通过审查要求：没有结构退化，没有遗留明确可行的 code-judo 简化，没有临时分支或边界泄漏，没有
  不必要的 wrapper、cast、optionality 或重复 helper，也没有无法说明的规模增长或机械拆分。必须检查 ownership、
  可变状态、coupling、类型边界、规范归属位置和原子性。
- 小型隔离变更需要一次聚焦且无发现的 review。广泛、跨 Capability、架构、全仓库质量/
  重构/源码精简或 Release 风险工作，需要独立 reviewer 反复审查完整受影响范围，直到连续两轮都无发现。
- 任何 finding 在实现被修复或直接源码证据证明其不适用前，都会阻止完成。无发现结果只认证被审查的精确源码；
  之后任何代码变更都会使结果失效。完成前，必须针对最终源码重新运行相关自动检查和 review。
