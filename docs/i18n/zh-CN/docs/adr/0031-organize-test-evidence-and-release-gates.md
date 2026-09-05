<!-- translation-source: docs/adr/0031-organize-test-evidence-and-release-gates.md; translation-source-sha256: 3bcd0ca3c2dd6d3783280bba919a37e558403434830c464ee8b7cb84fd54fc01 -->

---
status: proposed
---

# 组织测试证据与发布门槛

Pi Stuff 需要清楚的单元、组件、集成和系统测试，有效的 E2E 与 benchmark 证据，以及更短的开发和 PR
反馈时间。本文记录已确认的范围和仍在进行的设计访谈，不改变现行检查，也不代表允许未经审查地减少验收覆盖。

## 已确认的范围

- 按单元、组件、集成和系统四种验证范围组织测试，以 Capability Module 为组件的主要边界。
- 删除重复或无效的测试，替换薄弱断言，同时保留有意义的行为证据。
- 明确 E2E 与 benchmark 的职责，包括它们与打包、PR 合并的关系。
- 根据实测成本减少等待；测试文件数和删除比例都不是验收目标。
- 不要求在本地和 CI 重复运行完整检查。具体的验证权威与证据失效规则仍需确定。
- 采用以下反馈目标：相关测试不超过 30 秒，提交前常规检查不超过 2 分钟，PR 必需检查不超过 10 分钟，
  并尽量更短。这些是优化目标，不是实测结果；PR 计时包含环境准备，不包含 runner 排队时间。
- 同时保留使用可控 Provider 的确定性 E2E 和真实 Provider、Service 的 E2E，分别执行并如实报告证据。
- E2E 和 benchmark 属于低频验证，与日常开发检查分开。普通 PR 完整运行单元、组件和集成测试；
  相关高风险 PR 增加针对性 E2E；正式发布候选要求完整确定性 E2E。显式验证或关键外部依赖变更触发相关真实服务 E2E。
  生成开发用压缩包只检查包结构，不隐式启动全部 E2E。性能改造和重要版本评估可以请求 benchmark。
- Benchmark 使用现成的外部任务集与评测框架。FrontierHarness Eval 是用户初步提出的候选；
  是否最终采用、实验协议和执行预算尚未确定。现有内部性能检查先说明用途与已存结果，再决定去留。
- 自用项目以成本为重要约束。比较包括 FrontierHarness Eval 在内的公开 benchmark 已存数据，以及 Pi Stuff
  多次历史运行的结果，不要求新增一组原生 Pi 对照。并列注明任务集、模型、版本和环境的差异；缺失数据不要求补跑。

已确认：保留单元、组件、集成和系统四个名称，作为 Pi Stuff 的项目约定。组件以一个 Capability Module
为主要边界；依据用例要证明的行为与交互分类，不依据执行经过的代码、文件名或依赖数量分类。

| 分类 | 验证目标 |
| --- | --- |
| 单元 | 一项局部规则、转换或算法；允许使用紧密协作的真实辅助实现 |
| 组件 | 通过一个 Capability Module 的接口验证其职责，控制边界之外的协作对象 |
| 集成 | 专门验证两个 Module 或某个 Module 与 Host、存储、进程、服务之间的接口及交互 |
| 系统 | 从完整产品外部入口验证组装后的 Pi 与 Suite 的产品级行为 |

这不是行业唯一的四级标准。ISTQB 将组件与单元作为同义词，并区分组件集成与系统集成；
Fowler 的组件范围则可以由团队划定。此处显式区分局部规则与 Capability 职责，以便本项目使用。

分类单位是用例或同目的用例组，文件只是容器。真实 Pi 进程不自动意味着系统测试；临时文件不自动意味着
集成测试；使用 mock 也不自动排除集成测试。窄范围集成使用替身时，需要说明替身与真实接口的一致性证据，
不能据此声称已经通过真实 Host 或服务认证。

每组测试分别记录验证目标、范围分类、实际依赖和执行安排。资源成本、耗时、确定性和执行频率与范围分开；
benchmark 的内部性能或外部任务目的也与范围分开。验收是满足使用或发布要求的证据用途，不必复制另一套测试。
之前的文件清单保留为盘点证据；全部层级标签都需要按此规则重新核对，不仅限于原先带问号的 44 个文件。

依据：[ISTQB CTFL 4.0.1，第 2.2 节](https://www.istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)、
[Fowler：单元测试](https://martinfowler.com/bliki/UnitTest.html)、
[组件测试](https://martinfowler.com/bliki/ComponentTest.html)、
[集成测试](https://martinfowler.com/bliki/IntegrationTest.html)，以及
[Google：测试范围与资源规模](https://abseil.io/resources/swe-book/html/ch11.html)。
这些通用测试术语不需要在 `CONTEXT.md` 中新增领域词条。

## 调查证据，2026-09-05

源码快照：`2610bd4299ecb76b29094587a28dd5af5f020c27`，采用当前 Pi 0.85.0 兼容性配置。
受跟踪的测试 Source 包括 292 个 Bun 测试文件、21 个 Goal Node 测试文件及辅助 Source。
统计受跟踪的 `.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs` 文件，`test/` 下共 380 个文件、88,664 物理行。
辅助文件不等于额外的可执行测试用例。目录与边界调查不代表已完成逐条断言的删除审查，也不代表运行过当前版本测试。

本次查看的最近一次成功 PR CI 是
[33839062989](https://github.com/jczhang02/pi-stuff/actions/runs/33839062989)，运行于 2026-09-04，提交为
`c9524bc7c66620fd8a585f24cd2a9f9d12edc7b3`，使用 Pi 0.84.4 和 286 个 Bun 测试文件。
它的耗时用于定位结构性成本，不认证当前源码与 Host，也不预测当前版本的精确性能。

| 阶段 | 实测耗时 |
| --- | --- |
| Fast job | 1 分 28 秒 |
| Acceptance job，含环境准备 | 29 分 13 秒 |
| 隔离 Bun 测试阶段 | 约 18 分 13 秒 |
| Goal 编译与测试 | 约 1 分 17 秒 |
| Tool Activity benchmark | 约 0.9 秒 |
| 打包验证 | 约 9 分 22 秒 |

该次运行中最慢的九个 Host/PTY 文件合计占隔离阶段约 11 分 40 秒：Agents PTY、Agents execution matrix、
Tools PTY、Context PTY、UI PTY、Tools grouping PTY、BTW PTY、Tools resume PTY 和 Theme PTY。
这些是文件实测耗时，不是配置的超时时限。

已核实的结构性发现：

1. [隔离执行器](../../../../../scripts/run-isolated-tests.ts) 通过 `Bun.spawnSync` 串行启动每个文件。
   逐文件进程隔离与全局串行是两种不同选择。`bun test --timeout 30000` 是默认的逐用例超时，
   不是进程或文件的墙钟时限；具体测试可以覆盖它。
2. [完整检查](../../../../../package.json) 先运行全部测试，再运行[打包验证](../../../../../scripts/verify-package.ts)。
   后者在解压后的 Package 上串行调用 17 个验证函数。因此，许多 Host 与 PTY 流程会分别在源码和打包产物上执行，
   有时使用不同场景或终端尺寸。
3. 打包验证把源码 Package 的 `node_modules` 链接到解压后的 Package。它验证打包资源，
   但不能独立证明依赖可以全新安装。
4. [CI](../../../../../.github/workflows/ci.yml) 在 Fast 完成后才运行 Acceptance，没有测试分片矩阵，也不在 job 间复用
   已认证的打包产物。[仓库指令](../../AGENTS.md) 还要求 PR ready 或合并前在本地运行完整检查；
   调整这份重复工作需要明确的工作流决策。
5. CI 安装了 Code Mode host，但[真实 V8 测试](../../../../../test/code-mode/v8-real.test.ts) 要求
   `PI_STUFF_CODE_MODE_REAL=1`，workflow 没有设置它。独立的真实 Code Mode 验收命令也不属于默认检查。
   安装可执行程序不等于运行了这些测试。
6. 打包验证没有显式调用全部独立源码流程，例如 Tools grouping、Context input-frame，以及专门的 Theme 和
   User Message 检查。合并执行入口时必须保留这些验证义务。
7. [Retrieval 测试](../../../../../test/tools/contract-retrieval-core.test.ts) 的四次固定等待合计 2.17 秒，而
   [runtime](../../../../../packages/pi-stuff/src/tool-display/contract.ts) 已经接受可注入时钟。
   可以改为确定性同步，但不能删除 700 毫秒行为契约。
8. [生成的 connector 源码断言](../../../../../test/code-mode/connector.test.ts) 依赖内部变量名和精确源码片段。
   删除独有覆盖前需要行为验证替代。相反，[769 次调用测试](../../../../../test/code-mode/delegate-runtime.test.ts)
   跨过真实的 768 条 trace 保留边界，保护后续执行；体量本身不是删除理由。
9. [契约目录](../capability-contract-catalog.md) 的当前条目仍为 pending，且包含真实 Provider 与 Service 证据要求。
   结构检查器不会执行或认证这些契约。离线 CI 无论运行多久，都无法满足全部真实服务要求。
10. 验收范围分类器豁免根目录 Markdown 和 `docs/` 下的指定后缀；兼容性文档却承诺验收可执行文档。
    本次重组需要使执行策略与描述一致。

全量文件与入口分类见[测试框架概览](../research/test-framework-inventory-20260905.md)：
覆盖 313 个测试文件、额外 runtime smoke、独立验收与 benchmark 入口、静态门槛和辅助文件。
其中待确认的文件显式标记，不能据此直接删除或迁移测试。

## Benchmark 清单

| 现有入口 | 产生的证据 | 当前默认检查 |
| --- | --- | --- |
| `benchmark:tool-activity` | 合成输入下的规划、流式更新、格式化性能与完整性 | 必跑 |
| `benchmark:magic-context`、`benchmark:magic-context:compare` | Worker、投影、快照、导入与成对性能比较 | 手动 |
| `benchmark:lifecycle` | 真实 Host 配合 fixture Provider 的启动、reload、中断、退出与响应延迟 | 手动 |
| `benchmark:effect-mainline` | 成对导入、资源占用及可选生命周期比较 | 手动 |
| `benchmark:conversation-markdown` | 普通路径与可视化渲染的成对性能比较 | 手动 |
| `benchmark:ponytail` | 真实模型任务结果，以及代码、token、工具使用的取舍 | 手动 |
| `benchmark:skill-discovery` | 真实模型的发现正确性、任务结果与开销 | 手动 |
| `benchmark:code-mode-image` | 真实模型图片任务结果，以及传输、持久化正确性 | 手动 |
| 保留的 Terminal-Bench 研究 | 外部任务上的历史成对结果与耗时 | 仅作为有日期的证据 |

对 benchmark fixture 构造、统计和结果判定的测试，是验证测试设施正确性的测试；通过这些测试并不代表取得了
新的 benchmark 测量。当前真实模型研究不能替代词汇表定义的、基于外部公开任务集的 Suite Outcome Evaluation，
也不能替代 Capability Contract Acceptance。

Benchmark 采用内部性能与外部任务两类；现有自建模型实验的正确性和效果测量仍需分开审查归属。
这不是新增第三类，也不要求重新运行历史对照。

## 决策树

以下决策仍未确定。访谈中的推荐是提案，不是已接受策略。

截至目前的访谈决策：

- 不需要在本地与 CI 各做一次全量检查。
- 接受提出的反馈目标，并希望进一步缩短等待。
- 两类 E2E 证据都保留，已接受上述范围中的低频触发安排。
- Benchmark 指采用现成的外部 benchmark，FrontierHarness Eval 是首个候选。
  这替代了此前关于自建工程性能与模型任务综合 benchmark 的开放问题。

### 具体 E2E 示例

确定性的完整产品证据使用真实产品执行，并控制 Provider 响应。例如现有的
[Code Mode 验收](../../../../../scripts/verify-code-mode-real.ts)：启动真实 Pi 和 Suite，
由 fixture Provider 请求真实 Code Mode 执行，读取临时项目的 `package.json`，发现并读取 Skill，
检查返回值与 Provider 可见的 Tool 接口，然后使用保存的 Session 重新启动。
Provider 响应由脚本预设，被验证的执行和持久化仍然是真实的。文件名中的 `real` 指向可执行程序边界，
不代表使用了真实模型。

[UI 验收](../../../../../test/ui-pty.test.ts) 在真实终端中操作设置、改变窗口尺寸、重启并检查持久化。
这种用户流程无需让真实模型决定按什么键。当前打包验证会在解压后的 Package Source 上运行许多此类流程；
让全部选定的 E2E 使用目标打包产物，并验证全新安装，仍属于后续设计工作。

真实 Provider 证据把产品流程延伸到外部服务。现有
[Magic Context 验收](../../../../../scripts/verify-magic-context-real.ts) 会显式开启真实 Provider 调用。
其[场景](../../../../../scripts/magic-context-real-scenario.ts) 保存随机记忆标记和待办任务，驱动长上下文处理，
在压缩后和冷启动恢复后要求模型检索标记与待办，并检查另一个项目无法检索第一个项目的标记。
它同时验证真实服务行为、模型指令遵循与 Suite 执行，因此成本和波动与确定性证据不同。
这些是对现有脚本的说明，不代表本次重新运行并通过。

当前可讨论的决策：

1. 用最小报告比较公开与 Pi Stuff 的已存结果。
   [FrontierHarness 调查](../research/frontierharness-eval-fit-20260905.md)记录任务范围、执行要求和可比性限制。
   已确定采用历史对比，不要求新增对照运行。
2. 采用外部 benchmark 后，现有内部性能测试和实验性 benchmark 脚本如何保留与归类。
普通 PR 完整运行前三层，这项选择已经确定。

在前置决策确定后讨论的后续分支：

- 每个已接受触发点对应的具体测试选择，以及未知变更范围的兜底；明确证据认证的是哪个候选或合并结果，
  以及如何复用合格结果而不强制本地与 CI 重复运行。
- E2E 流程与失败、恢复覆盖；全新安装；产物身份；条件依赖不可用时如何报告，避免把跳过的契约当成通过。
- 物理目录组织、混合层级文件、进程隔离、有界并行、时间敏感测试的资源隔离、取消、进程墙钟时限和有效失败产物。
- 外部 benchmark 版本、对照组、模型与 Provider、实际 Suite 配置、运行环境、smoke 与正式运行的分离、
  样本、费用与时间边界、结果完整性，以及出现回归后的处理。
- 迁移阶段与每项受影响测试的保留、替换、删除证据；同步更新现行工作流文档、镜像与目录链接，
  随后取得新的耗时测量并完成要求的最终审查。

设计访谈达成共同理解后才开始实施。在对应工作流变更被接受并实现前，现行门槛继续有效。
