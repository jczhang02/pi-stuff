<!-- translation-source: docs/reports/terminal-bench-2.1-pi-stuff-latency-2026-08-30.md; translation-source-sha256: 52b4253f4ad49cabe09cd9b2bfa5e44142d8841e4f5c02738e0d56509a09da8e -->

# Terminal-Bench 2.1 Pi Stuff 延迟对比 — 2026-08-30

[English](../../../../../docs/reports/terminal-bench-2.1-pi-stuff-latency-2026-08-30.md)

日期：2026-08-30
Bead：`ps-ljy`
协议状态：已完成；预注册的 48/48 次模型试验均已保留
研究范围：仅运行效率

## 结果

关闭 Code Mode 时，Pi Stuff 平均每次试验耗时 602.6 秒；开启后为 535.4 秒。开启组的点估计不是更慢，
而是快 11.1%。但 task-block bootstrap 区间很宽，从快 42.8% 到慢 25.4% 均有可能，因此按预注册规则只能
判为**结论不确定**。

公开 Codex 结果在完整的 445 次提交中平均耗时 457.3 秒。与之相比，Pi Stuff 开启 Code Mode 的点估计慢
78.1 秒，关闭时慢 145.3 秒。这只能作描述性比较，不能视为受控的 harness 效应：公开提交运行了完整任务集，
Pi Stuff 实验则在本机运行确定性抽取的 12 项任务子集。

| Harness | Code Mode | 试验次数 | 均值 | 中位数 | p90 | 超时 | 解释 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 公开 Codex 0.144.1 | 不适用 | 445 | 457.3 s | 未公布 | 未公布 | 未公布 | 外部完整任务集参照 |
| Pi Stuff | 关闭 | 24 | 602.6 s | 422.8 s | 941.2 s | 3 | 本地受控实验组 |
| Pi Stuff | 开启 | 24 | 535.4 s | 435.1 s | 976.1 s | 5 | 本地受控实验组 |

三组使用同一 Terminal-Bench 2.1 benchmark 系列、同一模型系列和最大推理强度，但公开结果与本实验既没有
任务配对，也没有环境配对。只有 Pi Stuff 关闭/开启两组构成同期配对比较。

## 研究问题与边界

本研究测量 Pi Stuff 在关闭和开启 Code Mode 时，完成一次 Terminal-Bench 2.1 任务需要多长时间。研究不
评价任务质量或功能正确性；reward 只用于说明完成、失败和超时轨迹的背景。

官方参照记录的是 Codex 0.144.1、`openai/gpt-5.6-luna`、`max` 推理强度、445 次试验，以及
`avg_trial_duration_sec = 457.3`。硬件、系统负载、Agent 实现、任务总体和执行日期均不相同。因此，公开
结果无法识别 Pi Stuff 的因果性能损失；本机的 Code Mode 对照实验可以识别其组间效应。

## 冻结协议

机器可读的[冻结协议](../../../../../docs/reports/terminal-bench-2.1-pi-stuff-latency-protocol-2026-08-30.json)
记录了研究设计。逐字节保留的[源清单快照](../../../../../docs/reports/terminal-bench-2.1-pi-stuff-source-manifest-snapshot-2026-08-30.json)
仅用于复核其中记录的哈希；里面的历史 adapter 与 execution 字段只是来源记录，不是当前可运行配置。在任何计入
结果的模型试验开始前，协议验证已固定以下选择。

- 评估器：Harbor 0.17.1；Terminal-Bench 2.1 数据集 digest 为
  `sha256:7d7bdc1cbedad549fc1140404bd4dc45e5fd0ea7c4186773687d177ad3a0699a`。
- Host 与模型：经认证的 Pi 0.84.3；`openai-codex/gpt-5.6-luna`；`max` 推理强度。
- 实验组：`PI_STUFF_CODE_MODE_FROZEN=off` 和 `on`；其余 Agent 参数及挂载资源相同。
- 样本：使用种子 `ps-ljy-terminal-bench-latency-tasks-v1` 对冻结清单中的 89 项任务作 SHA-256 排序，
  选取 12 项；每项任务在每组重复两次，共 48 次模型试验。
- 执行：采用全局固定种子的交错顺序，串行并发数为一；每次使用全新任务容器，每个 job 只尝试一次，使用
  `--no-session`，不重试，也不上传。
- 测量：采用 Harbor 的 `finished_at - started_at`；完成、失败和超时观察均纳入均值。
- 探针：两组使用同一个仅记录时间戳的扩展，记录 Suite 构造、Provider 回合和顶层 Tool 时长，不记录 prompt、
  Tool 参数或 Tool 结果。
- Code Mode runtime：两组挂载同一个预安装 Host 二进制文件，SHA-256 为
  `60bf16414be5333f09ff082540082304c7352931ef64bdeb170d4c35a82e6ef8`。该设置排除首次使用时的网络下载，
  但保留实际调用 Code Mode 时的惰性进程启动。
- 停止条件：完成 48 次模型尝试、观察成本达到 15 美元或累计时间达到 12 小时，以先到者为准。

冻结任务样本为 `nginx-request-logging`、`winning-avg-corewars`、`qemu-alpine-ssh`、
`financial-document-processor`、`chess-best-move`、`cobol-modernization`、`headless-terminal`、
`bn-fit-modify`、`distribution-search`、`build-pov-ray`、`largest-eigenval` 和 `pypi-server`。抽样没有使用
既有的任务速度或成功情况。

## 统计判定

Code Mode 主效应定义为 `(mean(on) - mean(off)) / mean(off)`。确定性的 100,000 次 task-block bootstrap
对 12 项任务重采样，同时保留每项任务内部的两组和重复试验。预注册规则要求：95% 区间整体高于 +10% 才判为
实质变慢，整体低于 -10% 才判为实质变快。

| 比较 | 点估计 | task-block bootstrap 95% 区间 | 判定 |
| --- | ---: | ---: | --- |
| Code Mode 开启相对关闭 | -11.1% | -42.8% 至 +25.4% | 结论不确定 |
| Pi Stuff 关闭相对公开 457.3 s | +31.8% | -12.4% 至 +88.6% | 结论不确定，仅作描述 |
| Pi Stuff 开启相对公开 457.3 s | +17.1% | -16.8% 至 +54.3% | 结论不确定，仅作描述 |

24 个“任务 × 重复”配对中，Code Mode 开启后有 13 个更快、11 个更慢；配对差值的中位数为开启后快 11.1
秒。胜负数接近，区间又很宽，因此不能据此断言 Code Mode 普遍更快或更慢。

## 时间花在了哪里

| 每次试验均值 | Code Mode 关闭 | Code Mode 开启 |
| --- | ---: | ---: |
| 环境初始化 | 4.0 s | 4.2 s |
| Agent 初始化 | 1.6 s | 1.8 s |
| Agent 阶段 | 537.9 s | 465.4 s |
| Verifier | 42.8 s | 46.5 s |
| 已记录阶段之间的未归属时间 | 16.3 s | 17.6 s |
| Provider 回合 | 34.9 | 26.4 |
| 输入 Token | 1,275,516 | 639,188 |
| 顶层 Tool 调用 | 29.5 | 16.8 |
| 顶层 Tool 用时 | 116.5 s | 53.5 s |
| 观察成本均值 | $0.0544 | $0.0367 |

Agent 阶段占关闭组墙钟时间的 89.3%，占开启组的 86.9%。相较开启组，关闭组还多用了 32.2% 的 Provider
回合、99.6% 的输入 Token、76.1% 的顶层 Tool 调用和 48.3% 的成本。这个结果符合“模型轨迹更长”的解释，
不符合“Suite factory 更慢”的解释。

开启组平均有 53.3 秒处于 `codemode` Tool 调用内部。这是通过 Code Mode 实际完成工作的时间，不是一项可以
独立剥离的税：开启组同时减少了调用、回合与 Token，而且墙钟时间点估计更低。若把所有 `codemode` 时间都
记作额外开销，就会重复计算原本需要由普通 Tool 完成的工作。

### Pi Stuff 的固定启动成本

39 份原始探针含有完整 Suite trace。从 cache miss 到模块载入完成的冷导入平均为 40.5 秒，中位数为 33.2
秒；导入完成后的 Suite factory 执行平均为 0.153 秒，中位数为 0.122 秒。另一次全新容器、无模型校准测得
冷导入 26.625 秒，factory 0.114 秒；宿主热态校准的导入时间为 3.976 秒。

因此，冷导入确实是 Pi Stuff 每个全新容器都会支付的成本，约占关闭组均值的 6.7%、开启组均值的 7.6%。
这项成本值得优化，但它只能解释几十秒，无法解释数分钟的任务时长；factory 构造本身可以忽略。九次模型观察
没有完整探针文件，其中包括全部八次超时和一次已完成试验；它们的 Harbor 主计时仍然有效，并已纳入结果。

### 长尾敏感性

关闭组有一次 `winning-avg-corewars` 试验耗时 2,578.6 秒。若只从每组各删除最大观察，关闭组均值从 602.6
降至 516.7 秒，开启组从 535.4 降至 502.5 秒，原本 67.1 秒的差距随即缩小到 14.2 秒。开启组有五次超时，
关闭组有三次，因此开启组较低的“仅完成试验均值”（404.5 秒对 550.7 秒）同样受到选择偏差影响，不能替代
主结果。

任务级变化方向并不一致：开启 Code Mode 后，`winning-avg-corewars` 平均快 1,385.1 秒，
`cobol-modernization` 快 238.4 秒；但 `financial-document-processor` 慢 447.7 秒，
`qemu-alpine-ssh` 慢 249.2 秒。证据指向的是任务相关的轨迹分化和重尾，而不是统一的 harness 减速。

## 根因结论

本实验**没有复现**“Code Mode 会让 Pi Stuff 普遍变慢”的说法。点估计的方向恰好相反，但不确定性又太大，
尚不足以作实质性的速度判断。

Pi Stuff 单次任务缓慢的主因是模型/Provider 轨迹：反复推理回合、大量 Token 和 Tool 调用，以及 900 秒的
Agent 超时。关闭组一次长达 42 分钟的轨迹显著改变了总体均值。Pi Stuff 还存在独立测得的约 40 秒冷导入
成本，但它只是次要固定成本。Code Mode 执行不是本次差距的根因；在这个样本中，它替代了足够多的普通 Tool
交互，从而减少了回合和 Token。

相较公开 Codex 均值所看到的 78–145 秒差距，现有数据无法完整归因。Pi Stuff 固定导入可以解释其中一部分，
但任务构成、硬件、负载、Agent 实现和长尾轨迹仍然混杂。仅根据这三行数据便断言 Pi Stuff 天生比 Codex 慢
17–32%，超出了证据所能支持的范围。

## 运行时修订与有效性

第一次 Provider 请求发生前，校准发现任务容器需要把仓库 Bun store 挂载到 `/node_modules`，并把认证 Bun
runtime 加入 `PATH`。该次失败校准的 Provider Token 为零，保存在 48 条观察之外。我们在冻结顺序开始前修正
依赖布局、Bun 哈希和 Harbor 限定任务名解析器；任务抽样、实验组、顺序、结果指标和判定规则均未改变。

实验使用 Rootless Podman 6.1.0 和 Docker Compose v5.5.0。由于本机环境，网络校准需要使用 Netavark 的
no-firewall driver；模型试验前已验证容器 DNS 和 TLS。完成第 35 条观察后，Podman 的 Docker 兼容
`docker info` 超过 Harbor 的十秒 preflight 上限，但 API ping 和容器操作仍然响应。一个本地、与实验组无关的
wrapper 只从同一 API 回答该 preflight，其余命令仍全部交给 Podman。两次失败启动没有产生 trial 目录或
Provider 请求，也未计数。preflight 发生在 Harbor 的 `started_at` 之前，因此该修订没有进入测量区间，也
没有改变任何既有观察。

这些修订处理的是执行基础设施，不是实验结果。由于本文作为科研证据保留，仍在此完整披露。

## 证据与保留方式

实验开始于 `2026-08-30T06:05:43.075Z`，结束于 `2026-08-30T13:59:50.222Z`；runner 总耗时
28,447.147 秒，即 7 小时 54 分 7 秒。共保留 48 条观察，其中 40 次完成、八次 Agent 超时。观察到的模型
成本为 $2.18698596，未达到 15 美元停止条件。结果没有上传。

脱敏结果保存在 [`terminal-bench-2.1-pi-stuff-latency-results-2026-08-30.json`](../../../../../docs/reports/terminal-bench-2.1-pi-stuff-latency-results-2026-08-30.json)。
文件包含 48 条观察、汇总统计、协议和二进制哈希，以及对应原始文件的哈希。独立完整性审计把全部 48 个结果
哈希逐一匹配到 Harbor `result.json`，全部 48 个 Agent 日志哈希逐一匹配到 `pi.txt`，39 个可用探针哈希
逐一匹配到 `pi-stuff-latency.json`；没有发现错配、重复映射，也没有在受跟踪 JSON 中发现私有绝对路径或
疑似凭据字符串。

Harbor 原始 job、Agent 日志、探针和基础设施失败证据仍保存在被 Git 忽略的本地 artifact 目录中。由于这些
内容含 prompt、trajectory、Session 邻接数据和私有机器路径，因此未提交。恢复运行时会保留已有有效 job，
没有静默重跑。

主要公开来源包括 [Codex 官方提交](https://github.com/harbor-framework/terminal-bench-2-1/blob/main/leaderboard/submissions/2026-07-11-openai-gpt-5-6-luna-max-codex.json)、
[Terminal-Bench 2.1 数据集记录](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench-2-1/6)以及
[Harbor 的计时与结果文档](https://github.com/harbor-framework/harbor/blob/v0.17.1/docs/content/docs/run-jobs/run-evals.mdx)。
