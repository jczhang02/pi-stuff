<!-- translation-source: docs/research/frontierharness-eval-fit-20260905.md; translation-source-sha256: 2bda926fce48c78d5f5939fbaa8197ba10f1e1bb9ccb61e865e36741c20fc648 -->

# FrontierHarness Eval 与 Pi Stuff 的适配评估

日期：2026-09-05。为[测试设计访谈](../adr/0031-organize-test-evidence-and-release-gates.md)进行的一手来源只读调查。
没有执行评测、安装、账号连接或付费 Provider 请求。

## 结论

FrontierHarness Eval 可以作为 Pi Stuff 的外部任务评测候选。它提供现成的任务选择、通过外部任务环境运行的
verifier、执行编排和结果统计。它不认证 Pi Stuff 的 UI、持久化或 Capability 契约。
采用它仍然是一项提案，不代表接入已完成。

本次查看的上游快照为
[`8f11b130c30bbf76ca1f3edeea70abc773bd8d2c`](https://github.com/frontier-harness-eval/eval/tree/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c)。
[冻结的 benchmark 定义](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/benchmark.json)
包含 30 个任务：21 个 Terminal-Bench 任务和 9 个 DeepSWE v1.1 任务。公开评测使用 Fireworks 提供的 Kimi K3，
每个任务与配置组合保留一个规范结果。
[Pi 基线元数据](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/metadata/harness-versions.json)
记录的是 Pi 0.84.2；Pi Stuff 当前面向 Pi 0.85.0。新 Suite 的结果不是历史 Pi 条目的重新运行。

## 已确定的比较方向

维护者强调自用项目以成本为重要约束。比较包括 FrontierHarness Eval 在内的公开 benchmark 已存结果，
以及 Pi Stuff 多次历史运行的数据。此前建议新增 60 次成对试验的方案不作为默认要求，不需要额外运行原生 Pi 对照。
新增运行仍属于低频、显式请求的工作；仅仅缺少历史数据不构成补跑理由。

在可获得时记录任务集、模型、Provider、Host 与 Package 版本、实际 Suite 配置和环境。
对比中保留条件差异，未知字段保持未知。历史结果可以支持实际决策，但不证明差异完全由 Suite 引起。
定义更窄的成对 [Suite Outcome Evaluation](../../CONTEXT.md) 是独立实验，不是历史对比的前提。

已保留的 [Terminal-Bench 证据](../reports/ps-ps3-capability-contract-and-terminal-bench-observation-2026-08-30.md)
包含 89 个首次尝试，其中 71 个成功。另一份
[延迟研究](../reports/terminal-bench-2.1-pi-stuff-latency-2026-08-30.md)保留 48 次试验，
比较 Pi Stuff 内部 Code Mode 关闭与开启，并非不加载 Suite 与加载 Suite 的比较。
这些历史任务集不同于 FrontierHarness 的 30 任务选择，整体通过率不能直接当作同一榜单分数。

## 执行要求

[官方流程](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/SKILL.md)
创建 Runta runtime，并使用已认证的 Provider。它不会自动把 Pi 扩展转换成 Harbor 或 Pier agent。

[执行参考](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/reference.md)
通过 Harbor 运行 Terminal-Bench，通过 Pier 运行 DeepSWE。自定义 harness 需要在安装脚本中注册 runner。
对于 Pi Stuff，这层适配应安装受支持的 Pi 和明确版本的 Package，再使用选定的隔离配置启动 Pi；Pi 仍是 Host。

同一参考文档还描述了本地 Harbor 配合 Runta provider 的替代方式，它改变了共享 checkpoint 属性。
这不等于官方提供了完全本地运行的替代方案。任务 registry 名称也可能不同于数据集宣传版本，
因此精确任务 ID 和环境身份比相似的名称更重要。

[环境准备脚本](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/scripts/provision-golden-checkpoint.sh)
接受固定版本的仓库和安装脚本，准备依赖、任务镜像，然后冻结 checkpoint。
默认资源为 4 vCPU、8 GiB 内存、100 GiB 磁盘。
[试验执行器](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/scripts/run-trials.sh)
为每个任务恢复 runtime，默认任务超时为 5,400 秒。这些是配置边界，不是 Pi Stuff 的实测耗时或费用估计。
正式评测前使用独立 smoke 任务验证适配。

## 评分与完整性

[结果统计脚本](https://github.com/frontier-harness-eval/eval/blob/8f11b130c30bbf76ca1f3edeea70abc773bd8d2c/skills/frontierharness-eval/scripts/normalize-results.mjs)
用成功次数除以可评分试验次数；`infra_invalid` 不参与评分。每次成功的有效成本，是全部计分试验的已记录总费用
除以成功次数；费用覆盖不完整时，该指标保持不可用。部分耗时与效率汇总只使用成功试验，
详细报告仍需保留失败与超时。

公开数据不能重建榜单的首轮缓存归一化，统计脚本会将这些字段留空。它还会跳过无法读取的试验记录，
并根据实际可评分记录生成 expected/completed 数量。因此，生成汇总不代表计划的全部 30 个任务都已执行。
宣称运行完整前，应另行检查计划任务清单、无效或缺失试验及证据完整性。
不能编造缺失费用，也不能把缺失记录当成通过。

## 仍需确定的决策

- 最小历史对比报告，以及哪些条件兼容的记录能支持各项指标。
- 模型与 Provider、官方 Runta 或另一个明确声明的环境，以及 Suite 实际配置。
  基础设施选择是一项设计决策，不等于授权购买资源。
- 正式任务量、重复次数、时间与费用上限、无效运行处理，以及结果保留策略。
- 现有内部脚本先说明测量内容、执行成本与已存结果，再决定保留或删除；目前尚未接受这些脚本的删除决定。
