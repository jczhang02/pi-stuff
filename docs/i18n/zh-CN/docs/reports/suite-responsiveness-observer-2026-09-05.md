<!-- translation-source: docs/reports/suite-responsiveness-observer-2026-09-05.md; translation-source-sha256: 51c7fd7c73e17611a17b2e1b598219b22232dcf721aeae287c9dc2b2dd50083d -->

# 连续响应观察器与 Ledger 首次加载复现

2026-09-05，仓库内的观察器复现了首次 Code Mode/Bash Tool UI 出现前约 198.672 ms 的 Spinner 停顿。
同样开启 Suite、但不带旧 Ledger 的对照通过了锁定门槛；原生 Pi 加载相同结构的合成历史也通过。
这证明仍有可复现的问题，不代表已经修复或完成了整个 Suite 的资源验收。

生产源码未改动，版本为 `c6b20efb599a953b0b03bc439aa0bee9ab5ea97e`，实现与 `main` 的
`42ceceb8` 相同。该版本已经在普通分支推进时增量处理新 Ledger 条目。此次复现针对首次冷加载，
不能据此声称已有的热路径修复不存在。

## 观察结果

各行都使用精确[认证的 Pi 0.85.0 可执行文件](../compatibility.md)、120×40 全屏终端、全新的私有配置和缓存
目录，以及一次被测 Tool 调用。没有 profiler 或人为阻塞。Suite 样本在隔离网络命名空间中，使用合成的
回环账户，执行了自动 Session Naming 和一次真实 HTTP 用量刷新。没有读取用户 Session、凭据、设置，
也没有操作正在使用的 Pi 进程。

| 样本 | 历史与执行方式 | 最长 Spinner 帧 ms | 最慢输入/补全准备 ms | 最慢选择 ms | 结果 |
| --- | --- | ---: | ---: | ---: | --- |
| `gjIpTt` | Suite，24 次历史执行，Code Mode → Bash | 198.672 | 39.360 | 14.410 | Spinner 门槛失败 |
| `3QdOLF` | Suite，无旧 Ledger，Code Mode → Bash | 113.392 | 14.770 | 13.886 | 锁定门槛全部通过 |
| `8wCzGe` | 原生 Pi，24 次历史执行，Bash | 117.565 | 16.099 | 16.049 | 锁定门槛全部通过 |

合成 Session 包含 96 条规范 Ledger 记录，24 次执行各自成功返回 800,000 个字符，**没有保存任何 snippet**。
准备阶段由另一个原生 Pi 进程通过 `CodeModeSessionLedger` 写入；被观察的进程重新打开该 Session。
即使没有保存 snippet，Suite 仍会在执行前读取 `ledger.snippets()`。原生对照保留相同历史结构；
无历史的 Suite 对照保留 Code Mode 执行路径。

在 `gjIpTt` 中，最长停帧位于观察器启动后 +8,500.742 至 +8,699.414 ms；第一帧
`Bash(sleep 2; printf PSYON_TOOL_RESULT)` 在 +8,751.383 ms 出现。因此停顿发生在 Tool UI 之前。
这三个样本的活动 Spinner 观察均连续完整，最大采样间隙低于 26 ms。

[数值证据](../../../../../docs/reports/suite-responsiveness-observer-2026-09-05.json)也保留了未纳入对照的尝试。
更早的双 Tool Suite 样本 `lBK0DC` 出现 47.225 ms 观察间隙和 60.353 ms 启动反馈，只能判为无结论，
不能算通过，也不能据此归因启动缺陷。原生样本 `qHKlIG` 与前一个故意卡顿测试有重叠，只作为诊断数据。
没有仅因结果不利而丢弃样本。

## 锁定门槛与观察器检查

[锁定门槛](../../../../../docs/reports/suite-responsiveness-gates-2026-09-05.json)于 2026-09-05 00:51:32 UTC
记录，早于生产优化。30 个全新原生样本轮换使用 64×28、120×40、180×50。原生最长停帧加两倍观察间隙，
得到 164.767521 ms；原生输入/选择最大值加一次间隙，得到启动输入 38.124123 ms、后续输入
40.465312 ms、选择 38.311641 ms。这些是本机固定 Host 的对照门槛，并不保证低于它们的延迟都无法感知。

观察器从启动持续采集到收尾后的输入和选择，间隔为 10 ms 加采集/交互耗时。第一帧原生编辑器可见时就开始
输入，不等待 fixture 的就绪通知。输入与命令补全选择使用同一个采集循环，等待反馈不会暂停采集。
统计包含最后一个停帧区间及采集耗时的不确定性。Working 出现前的启动阶段与 `agent_end` 之后，不要求
Spinner 存在。这里的选择指命令补全选项，不是鼠标文本选择。

空或无效记录、活动覆盖不足 9 秒或 600 次采集、间隙超过 40 ms，或者应有的 Spinner 缺失，都会使样本无结论。
只要一次超过锁定门槛就失败。即使验证失败，脚本也会输出摘要，并在私有产物目录保留原始帧、动作、
源码快照和门槛。

原生负对照分别在启动、发出 Tool 调用前和收尾时注入 350 ms 阻塞。回归测试要求**注入阻塞的那个阶段**
出现超过 100 ms 的反馈；Tool 前的用例还要求 Spinner 停帧超过 350 ms。这些是观察器检测下限，
不是产品验收门槛。纯函数测试保护最后停帧的统计，以及无效/缺失观察的处理。

## 运行检查

使用兼容性契约中准备好的可执行文件：

```bash
bun test test/pty-observation.test.ts test/responsiveness-pty.test.ts
bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN" \
  --gates docs/reports/suite-responsiveness-gates-2026-09-05.json
```

复现 Ledger 首次加载问题时，将 `PI_STUFF_CODE_MODE_HOST` 指向准备好的 Code Mode helper，然后运行：

```bash
export PSYON_PARENT_NETNS="$(readlink /proc/self/ns/net)"
unshare --user --map-root-user --net \
  bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN" --suite --code-mode --ledger \
  --gates docs/reports/suite-responsiveness-gates-2026-09-05.json
```

去掉 `--ledger` 得到 Suite 对照；去掉 `--suite --code-mode` 得到带合成 Ledger 历史的原生 Pi 对照。
每次运行自行创建 Session，不接受现有 Session 路径。加 `--snippet` 保存一个 snippet；加 `--repeat-tool`
比较同一进程的首次和后续调用。`--columns` 与 `--rows` 控制终端尺寸。脚本记录复制后的 helper 哈希，
但这不等于重新认证其发布归档。

`--block-ms 350 --block-phase startup|pre-tool|settlement` 是显式故意卡顿对照。`--cpu-profile` 是独立诊断模式，
不能与 `--gates` 同用。上表没有启用 profiler。

## 尚未完成的范围

本检查点保留复现脚本和门槛，没有实现 Ledger 冷加载修复。观察器 CPU 单独报告，不能当成 Pi 或 Suite 的 CPU。
完整进程树 CPU/RSS、分配/GC、I/O、唤醒及最大主线程任务统计仍待完成。
[全部 16 个 Capability 的源码清单](suite-resource-inventory-2026-09-05.md)已记录所有者和待测对象；
后台 Agent、活动 Context 和恢复工作负载仍待覆盖。默认加载了 Capability，不等于执行过其路径。
本次使用共享机器，没有隔离 CPU；完整响应验收还需要更长的重复工作负载。
后续工作由 Beads `ps-yon.3`、`ps-yon.4`、`ps-yon.5` 按
[ADR 0030](../adr/0030-remove-redundant-suite-work-without-feature-cuts.md)持续跟踪。

## 前台 Agent 扩展

观察器现支持 `--suite --agent foreground`。它创建私有命名 Agent 定义，以 fresh context 调用公开 `subagent`
Tool，在真实子 Pi 执行 Bash 时持续采集父 TUI。子进程必须返回预期工具结果和结束标记。每个子 Provider
请求绑定 PID；观察器校验请求顺序，并根据记录的出生身份核验进程退出。
父进程自动命名和用量刷新保持开启，且各执行一次。`--code-mode` 使父、子 Tool 都经过 Code Mode；
`--repeat-tool` 顺序启动第二个子 Agent。场景超时为 60 秒，以覆盖子进程启动，不改变任何输入或 Spinner 门槛。

2026-09-05，首个无 Code Mode、无旧历史的前台样本在 Agent 行出现前停帧 888.131 ms，输入反馈耗时
779.337 ms。生命周期测试通过是因为观察器捕获了完整运行，不是响应性通过。
独立锁定门槛调用再次失败，停帧 188.750 ms、启动输入 40.660 ms。两个子进程均完成并退出；
活动 Spinner 无缺失，采样间隙均未超过 23 ms。[Agent 数值证据](../../../../../docs/reports/suite-responsiveness-agents-2026-09-05.json)
保留这两次失败。

| 样本 | 工作负载 | 最长 Spinner 帧 ms | 最慢输入/补全准备 ms | 结论 |
| --- | --- | ---: | ---: | --- |
| `zmHdBv` | Suite 前台 Agent → 子 Bash | 888.131 | 779.337 | 观察器测试；事后比对门槛失败 |
| `KHWw6O` | 相同前台工作负载，全新进程 | 188.750 | 40.660 | 锁定门槛失败 |
| `ewiJgE` | Code Mode → 前台 Agent → 子 Code Mode/Bash，带旧 Ledger | 194.857 | 97.208 | 锁定门槛失败 |
| `JN8MPG` | Suite Bash，无 Agent 或旧 Ledger | 111.590 | 15.067 | 锁定门槛全部通过 |

这些样本缩小了调查范围，但尚未确定新停顿的根因，也没有认证所有 Agent 生命周期。
普通 Bash 对照缺少子进程负载，不能单独区分父进程启动开销与资源争用。诊断样本 `hQfUTb` 开启 CPU
profiling，完成两个顺序前台 Agent；它不是响应验收样本。父、子 profile 分开。
父进程样本包含启动阶段的 tokenizer 初始化，但这不能证明它导致 Agent UI 前的停顿。
观察器也保留自身时间原点和首个 Agent 行的时间，供后续诊断对照。

沿用前述隔离网络设置复现前台场景：

```bash
unshare --user --map-root-user --net \
  bun scripts/benchmark-responsiveness.ts --pi "$PI_BIN" --suite --agent foreground \
  --gates docs/reports/suite-responsiveness-gates-2026-09-05.json
```
