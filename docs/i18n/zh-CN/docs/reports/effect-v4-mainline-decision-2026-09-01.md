<!-- translation-source: docs/reports/effect-v4-mainline-decision-2026-09-01.md; translation-source-sha256: e406b43f09d8e513fd056fe2e0015a195502e5e3867c249e901120c5bfb47938 -->

# Effect v4 与 main 的取舍结论

> **结论：把 Effect 实现升为 main。** 修正 acknowledgement 测量并把 Context 激活移到 Host 确认之后，
> 优化后的 Effect 候选没有任何被统计判定的生命周期回退。它在冷 import 上明显优于已经带齐通用优化的
> 原生对照，同时没有突破任何冻结的体积门槛。按约定，预发布版本的稳定性不参与本次决定。

**最终决定日期：** 2026-09-02  
**冻结协议：** [Effect v4 主线对比](../../../../../docs/research/effect-v4-mainline-comparison-protocol-20260901.json)  
**环境：** Linux x64、Bun 1.4.0、认证 Pi 0.84.4 release artifact  
**重新认证的原生对照：** `e4dd26ae250bf6e2d5de80ba9c3f3aefceb878e8`  
**重新认证的 Effect 可执行源码树：** `79155ab273903f1234db8f2dc24f1ad8d91d113c`  
**测试时间上限：** 四小时；计划中的性能批次都在约定上限内完成

## 先说人话

原来的问题不是 Effect 天生慢，而是 Effect 版把 Context 的启动工作放错了位置。用户输入后，Pi 还没返回
确认，候选版就先启动 Effect 生命周期工作。最敏感的首输入路径因此真的变慢：原生 main 约 2.19 ms，
Effect 约 2.56 ms，配对比较慢了约 23%。

现在由真正拥有这条路径的代码只记录输入，再把激活推迟到下一个 Host turn。确实需要 Context 的 hook 仍会在
使用前消费这次待处理激活，所以没有把正确性拖到模型请求之后。修复后，新 Session 的首次确认是原生
2.25 ms、Effect 2.35 ms，统计上不劣；短 Session 恢复后的 100 对确认也不劣，是 2.22 ms 对 2.29 ms。
稳态确认、Provider 启动和响应路径同样不劣。

原生优化对照已经带上 Jiti 缓存和 Agent 扫描缩减这些可移植优化。在这个前提下，Effect 的 Suite import
仍快约 12.9%，import CPU 少约 11.5%，峰值 RSS 低约 9.2%。旧报告的归因缺口由此关闭：剩下的端点优势来自
当前 Effect 实现，主要是收窄后的 Effect 延迟加载，而不是因为对照漏掉了通用优化。

Effect 也不是没有成本。Package TypeScript 代码增加 3.9%，打包归档增加 0.74%，冷 typecheck 慢 3.5%。
Background Work 和 Agent 退出中位数还多约 3.8–4.3 ms。这些成本都在冻结门槛内，也没有在生命周期矩阵中
形成用户可见回退。

## 协议和测量有没有“改规则”

预注册文件保持原样，里面仍是最初冻结的试验臂。之后发现了两个 benchmark 缺陷：

1. fixture 在最后一次 Editor 清屏真正稳定前就开始计时；
2. acknowledgement 指标记下的是稍后一个 Editor-clear microtask 的时间，而不是同步的 Host 确认标记。

两个问题都先修 fixture，再补聚焦回归测试。第一次正确测量暴露出上面那项真实的确认前激活成本，产品代码随后
在对应边界修好。所有决策批次再以前瞻方式重跑，试验臂固定为干净、不可移动的 `e4dd26ae` 和
`79155ab2`。这叫修正测量和产品后的重新认证，不是拿旧样本事后改判。

原生对照的 `fb00fb03` 已经包含研究中找出的全部可移植优化，`e4dd26ae` 又带上与候选相同的 typecheck
进程优化。`79155ab2` 之后的决策文档提交不改变本次测量的 Package 可执行源码树。

## 门槛结果

| 门槛 | 结果 | 证据 |
| --- | --- | --- |
| 确定性行为、安全、数据、取消、清理、启动纯度 | 通过 | 两个可执行试验臂都完成全仓检查和真实 Host 生命周期覆盖 |
| 冷 import 不劣于 main | 通过，而且更好 | 耗时、CPU、RSS 改善，context switch 不劣 |
| 生命周期不劣于 main | 通过 | 143 项筛查没有回退；所有筛查不确定项都由更多样本解决 |
| Package 与依赖增长不超过 5% | 通过 | 归档 +0.74%；TypeScript 代码 +3.89%；依赖树条目 +2.31% |
| Effect 当前独有且有分量的优势 | 通过 | 原生对照带齐所有可移植优化后，Effect 仍明显更好 |
| 试验臂身份准确 | 通过 | 所有最终 artifact 都记录干净、固定、稳定的 `e4dd26ae` 与 `79155ab2` |
| 总结论 | **把 Effect 升为 main** | 所有冻结硬门槛均通过 |

没有凭据的真实外部 Provider 路径仍未测试，也不写成“已经通过”。它们是没有改变的公开接缝，不是本次决定
使用的证据。

## 运行时结果

### Suite 冷 import

每边先暖机五次，再测 20 对全新进程。比值小于 1 表示 Effect 更好。

| 指标 | Effect / 原生配对中位数 | 配对 95% 区间 | 结果 |
| --- | ---: | ---: | --- |
| 耗时 | 0.8709 | 0.8505–0.8803 | 快 12.91% |
| CPU | 0.8853 | 0.8743–0.8979 | 少 11.47% |
| 最大 RSS | 0.9080 | 0.9061–0.9126 | 低 9.20% |
| Context switch | 0.9364 | 0.8962–0.9615 | 不劣 |

这组结果不是说任意 Effect 程序都比原生 TypeScript 快。它只证明：在这个仓库里，当两边都带上能用的通用
优化后，经过审查的 Effect 实现优于经过审查的原生实现。

### 生命周期覆盖与精测

覆盖测试包含四种 Session 场景、七种操作、两种终端尺寸，每个 cell 暖机一次并测三对样本，另有 Host
对照。143 项比较如下：

| 分类 | 数量 |
| --- | ---: |
| 改善 | 16 |
| 不劣 | 107 |
| 筛查阶段无法下结论 | 20 |
| 回退 | 0 |

15 样本精测得到 1 项改善、46 项不劣、2 项无法下结论、0 项回退，并解决了覆盖测试的 9 项不确定结果。
剩余 11 项通过更高样本的定向批次解决：

| 筛查缺口 | 最终证据 | 结果 |
| --- | --- | --- |
| 新 Session 100×32 的首次和稳态确认 | 50 对 prompt | 两项都不劣 |
| degraded 64×28 的稳态确认与响应 | 25 对 prompt | 两项都不劣 |
| 长恢复 64×28 的稳态确认、Provider 启动与响应 | 25 对 prompt | 三项都不劣 |
| 短恢复 100×32 的首次确认、稳态 Provider 启动与响应 | 100 对 prompt | 六项 prompt 指标全部不劣 |
| 短恢复 64×28 的稳态确认 | 独立 25 对确认 | 不劣 |

定向诊断会完整记录 prompt 路径，但它只负责上表列出的未决指标。附带记录的其他诊断指标不会覆盖已经完成分类的
正式 cell。

两组高样本确认可以看出剩余差值有多小：

| 场景 | 原生中位数 | Effect 中位数 | 配对中位数比 | 配对 95% 区间 |
| --- | ---: | ---: | ---: | ---: |
| 新 Session 100×32，首次输入 | 2.25 ms | 2.35 ms | 1.0085 | 0.9652–1.0833 |
| 短恢复 100×32，首次输入 | 2.22 ms | 2.29 ms | 1.0361 | 1.0045–1.0741 |
| 短恢复 100×32，稳态输入 | 1.53 ms | 1.53 ms | 0.9824 | 0.9514–1.0241 |

短恢复首次输入还差约 0.07 ms。继续删除剩下的 pending 状态写入、状态读取或 Host-turn 调度，会失去
“直接输入在分发后启动 Context 准备”的保证。这个接缝已经没有兼顾安全和可测用户收益的改法。

### 退出时还剩多少差距

最大的可重复 shutdown 差值仍然不劣：

| 场景 | 原生 p50 | Effect p50 | 绝对差值 | 配对比值（95% 区间） |
| --- | ---: | ---: | ---: | ---: |
| 新 Session Background Work 退出 | 140.11 ms | 144.45 ms | +4.34 ms | 1.0485（1.0110–1.0719） |
| 新 Session Agent 退出 | 96.78 ms | 100.75 ms | +3.97 ms | 1.0366（1.0060–1.0765） |
| 长恢复 Background Work 退出 | 162.94 ms | 167.26 ms | +4.32 ms | 1.0223（1.0115–1.0443） |
| 长恢复 Agent 退出 | 112.79 ms | 116.56 ms | +3.77 ms | 1.0370（1.0094–1.0684） |

`shutdownMs` 包含父 Pi 进程的完整退出，包括 Host 清理、Session 写入、终端 teardown 和 Effect
finalization。现有 trace 无法把 3.8–4.3 ms 归到某一个阶段。能安全并发的 Effect finalizer 已经并发；
没有分阶段证据就并行化剩余顺序 Scope，可能破坏清理顺序。因此本次采用不加入猜测式 shutdown 改动。

### 旧的绝对预算

旧绝对预算对两边都已经过时：原生有 67 项 finding，Effect 有 28 项。Effect 消除了全部 startup 预算
finding，但两边仍超过旧 reload 和合成 Provider-response 预算。这个结果支持相对对照，但不能把失效门槛
说成绿灯。

## 体积和开发成本

| 指标 | 原生对照 | Effect | 变化 |
| --- | ---: | ---: | ---: |
| 打包字节数 | 4,489,483 | 4,522,708 | +33,225（+0.74%） |
| Package TypeScript 代码行数 | 108,465 | 112,685 | +4,220（+3.89%） |
| 已安装依赖树条目 | 433 | 443 | +10（+2.31%） |
| 冷 typecheck 中位数，3 轮交错样本 | 29,998.32 ms | 31,062.61 ms | +3.55% |
| 暖 typecheck 中位数，3 轮交错样本 | 105.01 ms | 107.73 ms | +2.59% |

每次冷 typecheck 前都删除对应试验臂的 build-info，随后立即再跑一次作为暖样本。这组三样本是描述性对照，
没有置信区间。通用 anti-slop、Effect anti-slop、Biome、Oxlint、TypeScript、依赖分析、生成源码检查、
仓库安全和 Package 验证都作用于完整候选。

## 为什么现在值得采用 Effect

性能优势有用，但长期价值是明确的生命周期所有权。一个共享 foundation 现在统一拥有 root、Session、
Capability 和 operation Scope 树。Fiber 不能在没有明确 owner 的情况下逃出 operation；Session 替换会先
阻止旧工作向新 Session 发布；各 Capability 的原生 shutdown 仍有权先完成自己的协议，再做最终 Scope 清理。

仓库检查会强制执行这条边界：生产副作用工作进入 Effect，纯计算继续用普通 TypeScript，runner 只留在面向
Pi 的边界，外部资源的原生协议仍由对应 Capability adapter 管理。迁移删除了对应的 Promise/Abort/timer
双轨生命周期，而不是在旧机制外包一层 Effect。优化后的原生对照也证明，排除可移植优化后，最终 import
优势依然存在。

成本有界、公开行为保持不变、所有权模型可以由工具检查。这三点一起满足冻结规则，足以让 Effect 成为主线实现。

## 原始证据

原始样本保存在本地 `.artifacts/effect-mainline-comparison/`。SHA-256 如下：

| Artifact | SHA-256 |
| --- | --- |
| `final-native-optimized-vs-effect-lifecycle-coverage-real-ack.json` | `a3c9b5f4b3b3e1381fd913eee999e6946e55aac356a851952288bfbb50a2cb7e` |
| `final-native-optimized-vs-effect-lifecycle-precision-real-ack.json` | `0ac4f6386c7c4742a5be391f1733645c2a43de8d2d16f2181ccf5f9052d3d52e` |
| `final-79155-fresh-prompt-real-ack-combined-r50.json` | `5f6f2b9083032d4133120a30899abef533f58ea7d5fccdd5a5b99ebe89591ba8` |
| `final-79155-resume-short-100x32-prompt-combined-r100.json` | `98888fa6fffb82f404403882ddd269db8f943b587ed9444e536f56522977bb63` |
| `tight-prompt-paired-64x28-context-enabled-degraded-final-79155-gaps-r25.json` | `fa0f43bab1f1df196947cf3c4f6808abff60c33da1b0aad4f8cb5128bcbdafdf` |
| `tight-prompt-paired-64x28-context-enabled-resume-long-final-79155-gaps-r25.json` | `9eed8c552f400933e4df4c21f8c51c781d518844c9614a2e8ddab27d47dfb4ad` |
| `tight-prompt-paired-64x28-context-enabled-resume-short-real-ack-deferred-r25b.json` | `1d79c2c5420053726dfd9505704969315ea9d2378190ed4804972ee715883a4e` |
| `final-79155-native-optimized-vs-effect-import-20x5.json` | `c734a79d50cc0d9ae214bfdb6378f9d37fab1187300d61b07bfe66d31d71b92c` |
| `final-79155-static-and-development.json` | `a0047636b4a61d1b4371423e0dadf8156f2280ade53cce73d7fb7cf64717dcc5` |

冻结协议和被取代的原始 artifact 保持不变。Git 历史保留之前“暂不合并”的报告文本及其证据；本文记录完成
重新认证后的最终主线决定。
