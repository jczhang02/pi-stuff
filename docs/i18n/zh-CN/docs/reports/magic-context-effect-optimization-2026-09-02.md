<!-- translation-source: docs/reports/magic-context-effect-optimization-2026-09-02.md; translation-source-sha256: 8a4dcb826d2bb627038b1c2a47521ccf998c807bb13adfa6918a8a966500b6bb -->

# Effect 下的 Magic Context：优化与重新认证

> **结论：保留 Effect，把 Magic Context 升到 0.41.1，不增加 bundle cache 或队列并发。** Effect 让取消、
> 清理、崩溃隔离和 Session 隔离有了更清楚的所有者；它不会让 Magic Context 自己的投影算法变快。0.41.1
> 的投影性能保持不劣，同时带来上游 cache 和 Pi 生命周期修复，代价是 Worker bundle 更大、构建更慢。

- **决定日期：** 2026-09-02
- **对照：** 独立干净 worktree 中的 `@cortexkit/pi-magic-context@0.40.0`
- **候选：** `@cortexkit/pi-magic-context@0.41.1`，保留三项本地补丁行为
- **平台：** Linux x64、Bun 1.4.0、已认证 Pi 0.84.4
- **协议：** 3 轮预热、10 轮配对样本，每轮交替先运行哪个版本；固定 20,000 次配对 bootstrap；ratio ≤0.95
判为改进，95% 区间上界 ≤1.10 判为不劣

## 人话结论

这个升级值得做。Magic Context 的日常工作没有明显变慢：fresh、short、long 和异常图像的首次投影全部通过
不劣门槛。原生 Worker handle 启动和初始化也通过。毫秒级的单命令与排队数据噪声太大，无法分类，但其绝对
耗时仍不足以支持引入更复杂的调度器。上游 0.41.x 增加了 cache 稳定性修复、Pi RPC 与多 Session 修复、
schema v82、捆绑 Pi CLI 检测，以及可选 ONNX 安装加固。

代价有两个。生成的 Worker bundle 从 6,863,704 增至 8,421,328 bytes，增加 22.7%。构建时间从
101.599 ms 的样本中位数升到 136.854 ms；配对中位 ratio 为 1.391。这个构建只在 Context Engine Worker
启动时运行一次，不会在每轮对话或 Session 切换时运行。原生 Worker handle 启动保持在 1 ms 以下且不劣。
扣除 handle 启动后，初始化加 tokenizer preload 的配对中位数只增加约 1.7%，统计上仍不劣。

Effect 在这里改善的是控制，不是算术速度。它让 Worker 生命周期、取消、pending request 失败、有界清理和
fail-open 恢复归一个所有者管理。昂贵的 token 与历史投影仍由上游在 Worker 中完成。这种分离是净收益：
失败和取消更安全，同时没有测出稳态投影损失。

## 配对性能结果

Ratio 小于 1 表示 0.41.1 更好。两个绝对值列分别是十个样本的中位数；分类依据配对 ratio 及其 95%
bootstrap 区间，所以绝对中位数之比不一定等于配对中位 ratio。

| 指标 | 0.40.0 中位数 | 0.41.1 中位数 | 配对 ratio | 95% 区间 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| Worker 构建 | 101.599 ms | 136.854 ms | 1.391 | 1.230–1.452 | 回退 |
| Worker handle 启动 | 0.671 ms | 0.477 ms | 0.648 | 0.438–1.030 | 不劣 |
| 初始化 + tokenizer preload | 769.386 ms | 784.051 ms | 1.017 | 0.978–1.090 | 不劣 |
| Fresh 首次投影 | 38.383 ms | 39.423 ms | 1.002 | 0.955–1.087 | 不劣 |
| Short 首次投影 | 120.828 ms | 118.821 ms | 0.996 | 0.975–1.003 | 不劣 |
| Long 首次投影 | 1,528.344 ms | 1,548.235 ms | 1.015 | 0.973–1.066 | 不劣 |
| 异常图像首次投影 | 132.128 ms | 136.297 ms | 1.019 | 0.956–1.073 | 不劣 |
| Fresh 增量 leaf | 8.546 ms | 9.007 ms | 1.077 | 0.799–1.206 | 无定论 |
| Short 增量 leaf | 13.243 ms | 13.430 ms | 1.077 | 0.668–1.302 | 无定论 |
| Long 增量 leaf | 20.990 ms | 23.626 ms | 1.046 | 0.876–1.142 | 无定论 |
| 异常图像增量 leaf | 26.066 ms | 27.666 ms | 0.977 | 0.851–1.038 | 不劣 |
| 单个排队命令 | 1.229 ms | 1.206 ms | 1.029 | 0.695–1.150 | 无定论 |
| 两个命令总时间 | 2.389 ms | 2.450 ms | 0.928 | 0.788–1.252 | 无定论 |
| 推算的排队等待 | 1.165 ms | 1.251 ms | 0.943 | 0.632–1.415 | 无定论 |

Fresh、short 和 long 增量样本的噪声都较大，并未证明发生回退。它们的配对中位数分别增加约 7.7%、7.7%
和 4.6%，但每个区间都同时跨过改进与回退门槛。它们继续保留在测试矩阵中，本报告不把它们说成胜出；异常
图像增量路径仍然不劣。

## 为什么不加 bundle cache

模块级 cache 不能改善首次激活，因为 import 后仍必须先构建一次 bundle。它只能在 Worker 发生故障或整个
Capability 重启后再次构建时省约 137 ms。正常 Session 切换会复用同一个 Worker。保留 cache 会让 8.4 MB
Blob 常驻整个 Host 生命周期，还要为一个真实负载中没有频繁出现的路径处理失效问题。

目前这个交换不划算。只有 telemetry 显示正常使用中反复重建 Worker，或者重建时间已经占用户可见恢复延迟的
明显部分，才应重新考虑。基准已把构建、Worker handle 启动和初始化拆开输出，触发条件可以直接测量。

## 为什么队列保持串行

两个同时发出的状态命令只推算出约 1.25 ms 排队等待。为了省这一毫秒，需要证明哪些上游 handler 真正只读，
同时保持 Session snapshot、增量 entry、取消、Magic Context 可变状态和 SQLite transaction 的顺序。当前
FIFO 是简单的正确性边界，测得收益远低于拆分它的成本与风险。

只有代表性命令持续出现数十毫秒排队等待，并且上游给出真实只读契约、允许在不猜测的情况下分区时，才重新考虑
并发。

## 升级与故障认证

- 强制执行 `bun install --frozen-lockfile --force` 后，精确 0.41.1 补丁可以应用。
- 三项保留的补丁行为覆盖 tokenizer 根目录发现、初始化 preload 和哈希时复用已知图像 token。
- 真实 SQLite 测试会创建 schema v82，删除 `mapping_origin` 和 migration 82 来重建 v81，再验证 v81 到
  v82 迁移，并确认只支持 v81 的 Worker 面对 v82 存储时不暴露命令或 Tools。
- 0.41.1 的 `pi.events` 要求由 Worker 本地无操作 EventBus 满足，因为 Pi 不会在该 Worker 内初始化 child
  Extensions，所以那里没有事件 publisher。
- Transport 测试证明：一次 Worker 退出会让全部并发 request 失败且只报告一次 fatal；取消会发送协议
  cancel；迟到结果不能复活已经取消的 request。
- Session mirror 测试证明替换或删除 Session A 不会改变 Session B。
- 真实 Pi PTY 测试通过激活、恢复、仅 Magic compaction、fail-open、输入确认和 4 MiB 异常图像历史。

最终真实 Provider 运行在 Pi 0.84.4 上通过。它中止一个活跃 turn 后完成恢复 turn，在同一 Host 中创建新
Session 并切回原 Session，完成冷恢复，保留 paused Goal 与 canary，维持两个不重叠 Magic boundary、零原生
boundary，完成两次 Historian 且零失败，隔离第二个项目，并得到 21.46% Prompt Cache 命中率。最大 Provider
prompt 为 85,670 tokens，占 128k window 的 66.93%。

## 证据身份与源码成本

- 配对基准：`.artifacts/magic-context-040-vs-0411-paired.json`，SHA-256
  `a2150fa9a35950753c51d443804d955fe05e72bdada577dae7ed82fb4bbaeba2`。
- 最终真实 Provider 报告：`.artifacts/magic-context-real-acceptance-0.41.1-final.json`，SHA-256
  `0fffc873cd885372fb07b880a4463a5f7ec56e8c602030c4e4ddda996c7e5670`。
- 生产 Context 适配器增加 15 行：Worker transport 从 250→258，Worker entry 增加 7 行，API type 改动
  行数不变。基准、生命周期 verifier 和故障测试是分开的 Repository-owned Source，均低于适用的硬性大小门槛。

这项工作不会重新讨论更广泛的 [Effect 与 main 取舍结论](effect-v4-mainline-decision-2026-09-01.md)。它关闭了
Magic Context 特有的剩余疑问：Effect 仍是更好的生命周期基础，0.41.1 也是更好的上游引擎，但这两个结论都
不能为投机 cache 或不安全并行提供依据。
