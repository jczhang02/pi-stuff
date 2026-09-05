<!-- translation-source: docs/reports/suite-responsiveness-observer-2026-09-05.md; translation-source-sha256: 239472cc0bbf2237004fb258b89f6ad9d1bdeea75c20df6e6fe81986e82cc406 -->

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
活动 Context 和恢复工作负载仍待覆盖。下文的前台、后台 Agent 场景覆盖成功执行，未覆盖所有 Agent
生命周期或完整资源成本。默认加载了 Capability，不等于执行过其路径。
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

## 后台 Agent 扩展

将同一命令改为 `--agent background`，即可观察父 Agent 收尾后、子 Agent 仍在工作时的父 TUI。
观察器等到可见完成行、自动命名/用量刷新及之后的一次输入和选择均完成才停止采集。
父响应完成到最后一个子响应完成之间，必须实际完成输入和选择反馈。采集结束后，观察器读取合成父 Session
的原生文件，确认每个子 Agent 恰有一条身份不重复、状态为 completed 的规范 `pi-stuff-agent-outcome`。
Provider 请求数量检查排除观察期间未经请求的父回合；出生身份检查核验各子 Pi 退出，但不认证所有 helper 的清理。

后台 fixture 的父、子最终 Provider 响应等待六秒，而非四秒，以保证父活动期和父空闲/子活动期均足够完成
已有观察要求。这没有改变生产调度或响应门槛。只有后台子 Agent 活动时，不要求父 TUI 存在活动 Spinner。

| 样本 | 后台工作负载 | 最长 Spinner 帧 ms | 最慢输入/补全准备 ms | 结论 |
| --- | --- | ---: | ---: | --- |
| `eh1S2n` | 一个 Agent → 子 Bash | 177.973 | 63.629 | 观察器测试；事后比对门槛失败 |
| `H1NZud` | 相同工作负载，全新进程 | 183.665 | 17.929 | Spinner 门槛失败 |
| `O2afCg` | Code Mode 启动两个 Agent，子 Code Mode/Bash，带旧 Ledger | 232.401 | 53.915 | Spinner 和输入门槛失败 |

三个样本均在父 Agent 收尾后继续观察 11.8–13.3 秒，应有的 Spinner 无缺失，最大采样间隙低于 22 ms。
每个子 Agent 均完成 Tool 并退出；规范完成记录分别为一、一、两条。父进程命名和用量刷新各执行一次。
双子 Agent 场景验证了 `--repeat-tool`、`--code-mode`、`--ledger` 与后台观察在 120×40 下的组合，其他尺寸待测。
[Agent 数值证据](../../../../../docs/reports/suite-responsiveness-agents-2026-09-05.json)保留每次源码快照身份。
这些失败将调查扩展至后台委派，但不证明它与前台停顿具有相同根因。

## 原生资源 scope

在具有 cgroup v2 且已配置用户 systemd bus 的 Linux 上，为原生或 Suite 命令添加 `--resource-scope`。
现有观察器只把合成 Pi 命令放进新建的临时 scope。scope 与 service 不同，会保留调用者的终端和网络
命名空间。启动器取得用户 bus 环境；Pi 及其子进程保持原有隔离环境。观察器、tmux 和回环 Usage 服务均在 scope 外。

采集及子进程完成检查结束后，观察器核验父 PID 属于该 scope，再于关闭 Host 前读取 `cpu.stat`、
`memory.current` 和 `memory.peak`。摘要的 `resourceScope` 记录用户态/内核态/总 CPU 微秒数、当前及峰值
**记账内存**字节数，以及观察器时钟上的读取区间。累计 CPU 包含已经退出的 scope 内子进程。
这些是 scope 计数，不是仅父进程 CPU、进程树 RSS、累计分配量或包含关闭阶段的测量；各计数也不是原子快照。
必需计数缺失或无法访问 bus 时直接报错，不记录为零成本，也不静默改用其他方法。

正常清理会停止这个精确的私有 scope，并核验它已不活动。90 秒 scope 生命周期用于观察器死亡时限制合成
进程树存活，不改变任何生产 Agent 限制或响应门槛。该方法先用短命忙循环子进程验证：子进程退出后，scope
累计 CPU 增加 155,364 µs，其中子进程为 154,361 µs；继承终端及隔离命名空间均保持不变。之后确认临时 scope
已卸载。这验证了计量接口，不代表 Suite 资源效率已经通过验收。

| 样本 | scope 内工作负载 | CPU 秒 | 当前 / 峰值记账内存 MB | 最长 Spinner 帧 ms |
| --- | --- | ---: | ---: | ---: |
| `mw5lh2` | Suite Bash | 7.520007 | 445.739 / 989.221 | 117.332 |
| `VjRlYe` | 原生 Bash 对照 | 1.848497 | 138.158 / 154.403 | 115.950 |
| `xGbqRM` | Suite 后台 Agent → 子 Bash | 18.242948 | 434.053 / 1477.685 | 177.025 |

前两行顺序运行，Bash 命令、120×40 尺寸、全新私有目录、隔离网络命名空间及最终观察器源码一致，均通过
锁定响应门槛。差额是加载 Suite 的总成本，包含必要功能，不是可删除浪费的测量。后台行早于这组对照，
使用更早的计数读取器快照；子 Agent 完成并退出，但 Spinner 门槛失败。这里 MB 采用十进制。
[数值证据](../../../../../docs/reports/suite-responsiveness-agents-2026-09-05.json)保留精确计数、源码哈希，
以及最初的原生接入样本 `Wq9PYe`。每个 scope 均在清理后核验不活动且已卸载。
这些单次运行证明测量方法可用，不构成重复的优化前后基线，也未完成资源效率验收。
