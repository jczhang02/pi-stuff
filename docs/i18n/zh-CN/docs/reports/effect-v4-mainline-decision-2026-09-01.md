<!-- translation-source: docs/reports/effect-v4-mainline-decision-2026-09-01.md; translation-source-sha256: 2c3747c5eb7d69d2e08808371b86643c4fac0e15bc8e146f2b8a4cffc536c197 -->

# Effect v4 与 main 的取舍结论

> **结论：暂不合并。** 优化后的 Effect 版本在冷启动 import 上确实更快，但生命周期性能没有证明不劣于
> main，也没有证明这些优势只有 Effect 才能带来。按本次约定，候选版本的稳定性不参与否决。

**决定日期：** 2026-09-01  
**测试协议：** [Effect v4 主线对比](../../../../../docs/research/effect-v4-mainline-comparison-protocol-20260901.json)  
**环境：** Linux x64、Bun 1.4.0、认证 Pi 0.84.4 release artifact  
**冻结的 main 基线：** `b338a27f3c40401bdc6e72f42cc46da2813e39c6`  
**冻结的 Effect 候选：** `99e3cd50c8de851446867720cd67d118a9757877`  
**正式测试上限：** 四小时；所有性能批次在 12:50:45 +08:00 前结束

## 先说结论

Effect 不是单纯变慢。最终候选的 Suite import 快了约 11%，CPU 少了约 10%，import 峰值 RSS 低了约 9%。
这些结果可以重复。

问题出在归因和几个慢点上。只看完成结构迁移、尚未优化的 Effect 版本，import 其实明显更慢。后来的延迟加载和
缓存优化不但追回损失，还超过了 main。但其中一部分只是普通的 TypeScript 优化，原生 main 也能照搬。因此，
现有证据不能说“因为用了 Effect，所以更快”。生命周期测试还有两项预注册的恢复后 prompt acknowledgement
回退，shutdown 和其他 acknowledgement 指标也没有排除变慢。三次 Package TypeScript 对照里，Effect 冷检查
慢约 10%，暖检查慢约 19%。

这不符合事先定下的规则：每个决策指标都要证明不劣于 main；能移植回原生 main 的优化，不能单独成为采用
Effect 的理由。

## 门槛结果

| 门槛 | 结果 | 证据 |
| --- | --- | --- |
| 确定性行为、安全、数据、取消、清理、启动纯度 | 通过 | 两边完整检查都通过；真实 V8 生命周期测试均为 10/10 |
| 冷 import 不劣于 main | 通过，而且更好 | 四项里三项明显改善，context switch 不劣 |
| 生命周期不劣于 main | **失败** | 覆盖测试有 2 项回退、22 项无法下结论 |
| Package 与依赖体积增长不超过 5% | 通过 | 归档 +1.02%，依赖树条目 +2.31% |
| Effect 当前独有且有分量的优势 | **尚未证明** | 最终收益混合了 Effect 专属和可移植优化，没有“原生版加同样优化”的对照 |
| 试验臂身份准确 | 部分通过 | import 与覆盖测试准确；精测期间 main 前进到一个只改文档的新提交 |
| 总结论 | **暂不合并** | 一个硬门槛失败，两个硬门槛没解决 |

Effect 第一次完整检查时，一个共用临时锁的垃圾回收测试失败。当时另一个工作树有真实 Pi 进程在运行。该测试
随后单独连续通过 20 次，干净环境下重跑完整检查也通过。因此这里记为测试隔离缺陷，不算产品回退。没有配置
凭据的真实外部 Provider 路径没有测试，也不写成“通过”。

## 运行时结果

### Suite 冷 import

每边先暖机五次，再测 20 组配对的新进程。比值小于 1 表示 Effect 更好。

| 指标 | Effect / main 中位数 | 配对 95% 区间 | 结果 |
| --- | ---: | ---: | --- |
| 耗时 | 0.8872 | 0.8682–0.8994 | 快 11.28% |
| CPU | 0.8970 | 0.8935–0.9171 | 少 10.30% |
| 最大 RSS | 0.9107 | 0.9037–0.9133 | 低 8.93% |
| Context switch | 0.9739 | 0.8963–0.9965 | 不劣 |

### 生命周期覆盖测试

覆盖测试包含四种 Session 场景、七种操作、两种终端尺寸，每个 cell 暖机一次并测三组配对样本，另有 Host
对照。143 项比较结果如下：

| 分类 | 数量 |
| --- | ---: |
| 改善 | 3 |
| 不劣 | 116 |
| 无法下结论 | 22 |
| 回退 | 2 |

两项回退都是短 Session 恢复后的 `steadyAcknowledgementMs`：

| Cell | Effect / main 中位数 | 配对 95% 区间 |
| --- | ---: | ---: |
| `resume-short/prompt/100x32` | 1.4943 | 1.3672–2.7609 |
| `resume-short/prompt/64x28` | 1.3459 | 1.3054–3.6458 |

acknowledgement 的绝对耗时很小，调度噪声会放大这个比值。它依然会挡住本次合并，因为测试前冻结的规则没有
设置“绝对差值太小就忽略”的例外。

旧的生命周期绝对预算对两边都已不合时宜：main 有 54 项发现，Effect 有 32 项。去掉具体数值后，30 类两边
共有，24 类只出现在 main，2 类只出现在 Effect。Effect 整体更好，但两边都不能声称现有绝对预算是绿的。

### 15 样本精测

精测得到 38 项不劣、11 项无法下结论，没有被分类为回退的项目。但下面几项仍有风险：

- 新 Session 的 Background Work shutdown：比值 1.1124，区间 1.0026–1.1529；
- 新 Session 的 prompt acknowledgement：比值 1.1615，区间 1.0072–1.4444；
- 新 Session 的 prompt 稳态 acknowledgement：比值 1.1818，区间 1.0837–1.8667；
- 长 Session 恢复后的 prompt 稳态 acknowledgement：比值 1.5357，区间 1.0960–2.0196。

这批数据只能作为补充，不能当成严格按预注册执行的正式证据。测试期间 main 工作树从 `b338a27f` 快进到
`6f7d9d03`。最终差异没有改 Package 可执行源码或依赖图，只改了文档、仓库检查，并从发布文件列表移除了
`CHANGELOG.md`。所以运行时数据仍有参考价值，但提交身份已经违反预注册。现在的 runner 会拒绝脏工作树、
未锁定提交或测试途中发生移动的正式试验臂。

## 体积与开发成本

| 指标 | Main | Effect | 变化 |
| --- | ---: | ---: | ---: |
| 打包字节数 | 9,610,330 | 9,708,090 | +97,760（+1.02%） |
| Package TypeScript 源码行数 | 120,699 | 124,885 | +4,186（+3.47%） |
| 已安装依赖树条目 | 433 | 443 | +10（+2.31%） |
| Package typecheck 冷检查中位数，3 次 | 6,781 ms | 7,464 ms | +10.07% |
| Package typecheck 暖检查中位数，3 次 | 1,367 ms | 1,632 ms | +19.32% |

每个 typecheck 试验臂和每轮测试都用了独立 build-info 文件。这组三样本只描述当前机器上的差异，没有置信区间。
候选版本通过了通用 anti-slop、Effect anti-slop、Biome、Oxlint、TypeScript、依赖分析、生成源码、仓库安全、
Package 验证和完整仓库检查。

## import 收益从哪里来

另外做了三组 20 样本配对对照，用来拆开历史检查点：

| 比较 | 耗时 | CPU | 最大 RSS | 怎么看 |
| --- | ---: | ---: | ---: | --- |
| 原生 `d45db1a7` → 完成结构迁移的 Effect `5f94be91` | +16.36% | +14.56% | +9.59% | Effect 迁移一开始确实增加了成本 |
| 结构版 Effect → 优化版 Effect `05250080` | -24.72% | -22.25% | -17.41% | 后续优化不但追回损失，还多赚了一截 |
| 原生 → 优化版 Effect | -13.25% | -11.72% | -9.28% | 最终版本明显更好 |

保留下来的优化既有 Effect 专属的延迟 import 收窄，也有可移植的 Jiti 缓存和 Agent 扫描缩减。没有给原生版本
加上同样的可移植优化，就不能把最终版本的全部收益算到 Effect 头上。

## 下一步该优化什么

1. **先查 Background Work shutdown。** 当前流程依次等待进程和存储清理、关闭 Capability Scope，最后再关
   Effect 根 Scope。先给每个阶段计时，确认是否重复等待。当前中位数差约 11%；如果真有重复等待，预计能追回
   几十毫秒。
2. **别让即时 prompt acknowledgement 走多余的生命周期边界。** 绝对收益大概率只有几毫秒，用户不一定能
   感觉到，但这是唯一被统计判为回退的地方。最可疑的是一次不必要的 Fiber 或 Scope 创建。
3. **减少 TypeScript 看到的 Effect 类型。** 收窄 import，把大型 Effect 泛型留在 Module 内部。现在有约
   10–19% 的开发检查差距，但其中一部分可能是 Effect 本身的固定成本。
4. **补“原生版加可移植优化”的对照。** 这是判断 Effect 到底有没有独有收益的最短路径。
5. **给每个生命周期试验分配独立临时锁和进程命名空间。** 这样可以消掉这次完整检查中出现的那次假失败，
   不改产品行为。

现在不该继续盲改。剩下的优化必须先有分阶段计时或缺失的因果对照，否则只是猜。

## 原始证据

原始样本保存在本地 `.artifacts/effect-mainline-comparison/`。SHA-256 如下：

| Artifact | SHA-256 |
| --- | --- |
| `formal-import.json` | `6474182e8516e44d345193bdbb1b4a681547cd145e4757b161123d6661f0f673` |
| `formal-lifecycle-coverage.json` | `9e1ac1186c290a25d376b9f4de4810b6797a191016a69604f96673db48a720c1` |
| `formal-lifecycle-precision.json` | `7d6f977e9042ae89da179e6e80359d9dfd4206fba6b19068f7d0c31696ddf512` |
| `causal-import-native-vs-structural.json` | `d585e9b0b708d215313332c1b2ff3ff307cbf4c7e5c93ab7be97942e85f7d13e` |
| `causal-import-structural-vs-optimized.json` | `2d4a6925833cc853fe56febd272108a95889ffec832dae0ceb66d8abfbc5311d` |
| `causal-import-native-vs-optimized.json` | `1af745bca36febeed7792a100b51ed80e10cb27cec6e7c3fcf482083eac10c26` |

最新 main 文档已经在签名提交 `05f6e2a` 中合入 Effect 分支。试验臂身份保护在 `dc1f983` 中加入；它不会
把此前身份偏移的精测结果倒推成严格正式证据。
