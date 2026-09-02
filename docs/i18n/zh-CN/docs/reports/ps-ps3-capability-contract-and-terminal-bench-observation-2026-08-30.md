<!-- translation-source: docs/reports/ps-ps3-capability-contract-and-terminal-bench-observation-2026-08-30.md; translation-source-sha256: 495bfa601ac28fa24966fcedbf1829ef439cf95ee0f086e1d22e3580b35f7215 -->

# Capability Contract 验收与有界 Terminal-Bench 观察 — 2026-08-30

[English](../../../../../docs/reports/ps-ps3-capability-contract-and-terminal-bench-observation-2026-08-30.md)

证据日期：2026-08-30
合并整理日期：2026-09-02
历史 Bead：`ps-ps3`
整理 Bead：`ps-bhs`
证据来源提交：[`0aee8be48416485d0cf1d2139a2fddd381a35d9d`](https://github.com/jczhang02/pi-stuff/tree/0aee8be48416485d0cf1d2139a2fddd381a35d9d)
研究状态：已完成的历史快照

## 摘要

本文把 `ps-ps3` 实验中的两个独立问题整理为一份报告。RQ1 检验 Pi Stuff 声明的 Capability Contract
在冻结的 Pi 0.84.3 环境中是否通过验收；RQ2 记录同一 Pi Stuff Package 在固定模型预算下运行
Terminal-Bench 2.1 的有界观察。RQ1 覆盖 16 个 Capability Module、144 项合同和 603 个场景分面，其中
141 项合同、600 个分面通过；另有 3 个真实 Service 配置分面因缺少可丢弃凭据而受阻，故汇总结果为
`blocked`。RQ2 对 89 项公开任务各运行一次首次尝试，并保留 11 次重复结果。首次尝试得到 71/89 个
reward 1（79.78%）；100 次含模型尝试合计得到 81 个 reward 1，记录成本为 $6.47079196。这些结果只描述
历史环境，既不能认证当前 Pi 0.84.4，也不能识别加载 Pi Stuff 的因果效果。

## 研究问题

**RQ1 — Capability Contract Acceptance。** 目录中每项面向用户或 Host 的可观察合同，是否在相应
Acceptance Evidence Profile 下满足其正常、失败、恢复、持久化和边界场景？

**RQ2 — 有界 Terminal-Bench 观察。** 冻结的 Pi Stuff 适配器使用
`openai-codex/gpt-5.6-luna`、`max` 推理强度，对公开
[Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1) 任务集运行一次，再执行有界诊断性重复
样本时，观察到了什么结果？

两个问题不互相替代。RQ1 属于合同验收；RQ2 是完整系统的任务观察，不能认证单项合同，也不能估计 Pi Stuff
的处理效应。

## 冻结来源

| 范围 | 组件 | 冻结标识 |
| --- | --- | --- |
| RQ1 与 RQ2 | Pi Host | Pi 0.84.3 Linux x64；来源 `4e58f324fae8`；SHA-256 `ca858fde375ab91531353b22fac6ebdf29c0a153efe754f5f9b8a72a7423ed08` |
| RQ1 与 RQ2 | 打包后的 Pi Stuff Package | SHA-256 `662dff97c3745f3b39f34130286f2a382e5a4cad5ae8c64f696e72ece2f60807` |
| RQ1 | RTK | RTK 0.45.0 Linux x64；SHA-256 `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |
| RQ2 | 评估器 | Harbor 0.17.1 |
| RQ2 | 数据集 | `terminal-bench/terminal-bench-2-1`；`sha256:7d7bdc1cbedad549fc1140404bd4dc45e5fd0ea7c4186773687d177ad3a0699a`；89 项任务 |
| RQ2 | 模型 | `openai-codex/gpt-5.6-luna`；推理强度 `max` |

证据来源提交标识研究采用的实现和冻结工件。本文后来依据保留的报告与 manifest 重新整理，不能据此把该快照
解释为当前认证。

## RQ1 — Capability Contract 验收

### 方法

分析单位是一项稳定、可观察的承诺，不是单个函数或测试。每项合同汇总其适用的正常、失败、恢复、持久化和
边界场景。目录共含 16 个 Capability Module、144 项合同、603 个场景分面。

验收通过认证 Pi 二进制加载打包后的 `@jczhang02/pi-stuff` Package。证据包括完整仓库测试（257 个测试
文件）、Goal 运行时测试、Package 验证、真实 PTY UI 验收、原生 Code Mode Host 验收、Magic Context
冷恢复与隔离验收，以及真实 `openai-codex/gpt-5.6-luna` Provider 验收。基于 fixture 的证据与真实
Provider 或 Service 证据分别记录。

真实 Provider 验证覆盖自动 Session 命名、Codex Fast mode 与 usage、图像生成、前台和后台 Agent、Agent
steering 与持久完成，以及 BTW 的上下文、隔离和提升。Magic Context 验证覆盖冷恢复、Project 隔离、
Goal 暂停状态、两个 context compartment、Historian 成功和有界 prompt 投影。

### 结果

144 项合同中有 141 项通过；603 个场景分面中有 600 个通过。其余 3 项均为 Conditional Capability
Contract 的已配置正常分面：

- `web.credentials`：没有可用于真实外发请求的、可丢弃的兼容 Web Provider 凭据。
- `mcp.oauth`：没有可丢弃且支持 OAuth 的 MCP Service。
- `mcp.credentials`：同一缺失条件阻止了真实凭据交换。

三项合同中由 fixture 支持的失败、恢复、边界及适用的持久化分面均通过。缺少必要依赖属于受阻观察，不属于
通过或失败，因此 RQ1 的汇总结果保持为 `blocked`。

### 解释

RQ1 支持的结论很窄：冻结 Suite 满足了所有实际执行的合同分面，另有 3 个真实 Service 配置分面因明确的
资源条件未被观察。它不能证明 Provider 永久可用，也不能证明当前 Host 兼容。附录 A 保留完整结果矩阵。

## RQ2 — 有界 Terminal-Bench 观察

### 协议

本轮使用 Docker，并发数为 2，不自动重试，也不上传结果。在 100 次含模型尝试的上限内，89 项公开任务各
运行一次首次尝试，并保留 11 次诊断性重复结果。一个 Oracle 任务在不调用模型时通过；随后两个含模型校准
任务通过，再运行其余 87 项首次尝试。Oracle 不计入次数上限。

[冻结 manifest](../../../../../benchmarks/terminal-bench-2.1/manifest.json)记录数据集、任务顺序 seed、重复
样本 seed、模型和执行边界。其中 11 个重复任务名有 10 个与保留的结果表一致；manifest 写的是
`mteb-retrieve`，历史结果表写的是 `mteb-leaderboard`。仓库没有保留可消解该差异的原始 job 或
trajectory。因此，附录按原报告保留结果表，但不能把重复样本视作已完成审计的预注册。

### 结果

首次尝试得到 71/89 个 reward 1（79.78%），使用 129,637,153 个 input token、121,820,032 个 cache-read
token、1,615,016 个 output token，成本 $5.93784404。11 次重复得到 10 个 reward 1（90.91%），使用
11,489,608 个 input token、10,896,896 个 cache-read token、163,723 个 output token，成本
$0.53294792。100 次含模型尝试合计使用 141,126,761 个 input token、132,716,928 个 cache-read token、
1,778,739 个 output token，成本 $6.47079196。由于重复样本经过选择，合并后的 81/100 不是基准比率。

三个含模型 job 的墙钟时间合计约 34,541 秒，即 9 小时 35 分 41 秒。任务报告的 Agent 时间累计
60,094.93 秒，verifier 时间累计 6,564.14 秒；由于并发，累计时长会超过墙钟时间。

89 项首次尝试中，76 项没有 harness 异常。11 项以 `AgentTimeoutError` 结束，1 项为
`VerifierTimeoutError`，1 项为 `NonZeroAgentExitCodeError`。缺少 reward 按未通过处理。重复结果中，
`cancel-async-tasks` 恢复为通过，另有 9 项再次通过，`filter-js-from-html` 第二次仍未通过。附录 B
保留汇总表、首次尝试未通过表和重复结果表。

### 解释

RQ2 只能说明：冻结适配器在有界预算内完成了公开任务集的一轮观察，并暴露了超时与特定任务失败簇。历史
报告引用的一个公开
[GPT-5.6 Luna 结果行](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench-2-1/6/leaderboards/main/rows/e5f3feda-4629-46ba-963f-300dcf7c2a4c)
包含 445 次完成尝试、16 个错误、约 0.77 的平均 reward，以及 $241.45 的记录成本。它只是背景，不是
对照；Agent 实现、设置、任务修订版和重复策略都可能不同。

## 局限与不作出的主张

- 本研究没有纯 Pi 对照组，无法分离 Pi Stuff 的因果效果。
- 每项任务只运行一次首次尝试，不符合官方每项五次的提交流程；结果没有上传，本文不主张排行榜成绩。
- 11 次重复用于诊断，不能估计全套任务的 pass@2。
- 冻结 manifest 与历史结果表有一个重复任务名不一致。
- 原始 Harbor job、trajectory、prompt、Provider payload 和 Session 对话未保留，因此无法只靠仓库工件
  独立重算汇总结果。
- 环境为 Pi 0.84.3。当前 [Capability Contract 目录](../capability-contract-catalog.md)依据当前
  `main` 重建，状态均为 `pending`；本文不是当前验收证据。

## 隐私与公开数据边界

隔离验收配置在使用后删除。本文不保留凭据、prompt、Provider payload、Session 对话、原始 Harbor job、
trajectory 或私有机器路径。不会仅为把真实的受阻结果改成名义通过而消耗个人凭据或可能计费的凭据。

## 复现工件

仓库只保留[冻结的 Terminal-Bench manifest](../../../../../benchmarks/terminal-bench-2.1/manifest.json)和本
报告的中英文版本。历史来源提交保留
[Terminal-Bench runner](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/terminal-bench.ts)、
[Pi 适配器](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/terminal_bench/pi_stuff_agent.py)、
[真实 Provider verifier](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts)
以及原 Catalog checker。这些实验执行工件由 Git 历史归档，不作为当前仓库接口维护。manifest 可以重建
声明的协议，不能重建未保留的原始结果。

## 结论

`ps-ps3` 快照为已执行的 Capability Contract 提供了有力的历史证据，也形成了一次有用的有界
Terminal-Bench 观察。可支持的结论只有：603 个合同分面中 600 个通过，3 个真实 Service 分面受阻；89 项
任务的首次尝试得到 71 个 reward 1。本文不支持当前兼容性、排行榜成绩或 Suite 性能因果主张。

## 附录 A — Capability Contract 完整结果矩阵

| Contract ID | 场景结果 | 证据 |
| --- | --- | --- |
| `conversation-ui.statusline` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [rendering](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/statusline-rendering.test.ts) |
| `conversation-ui.welcome` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/welcome-header.test.ts) |
| `conversation-ui.input` | `normal=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/input-enhancement.test.ts) |
| `conversation-ui.thought` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/live-thought.test.ts) |
| `conversation-ui.transcript` | `normal=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/live-thought.test.ts) |
| `conversation-ui.visualization` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/fenced-visualization.test.ts) |
| `conversation-ui.diagnostics` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/diagnostics.test.ts) |
| `conversation-ui.settings` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/ui-settings-dialog.test.ts) |
| `conversation-ui.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [queue](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/command-dialog-queue.test.ts) |
| `session-naming.automatic` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/session-naming/host.test.ts), [controller](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/session-naming/controller.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `session-naming.policy` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [prompt](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/session-naming/prompt.test.ts), [model](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/session-naming/model.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `session-naming.persistence` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts), [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/session-naming/settings.test.ts) |
| `tool-display.registration` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-pty.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `tool-display.retrieval-groups` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-grouping-pty.test.ts), [verifier](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-tools-grouping-pty.ts) |
| `tool-display.bash` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-pty.test.ts), [verifier](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-tools-pty.ts) |
| `tool-display.inspection` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-grouping-pty.test.ts), [resume](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-resume-pty.test.ts) |
| `tool-display.fallback` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [rendering](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/tool-presentation-rendering.test.ts), [host-tools](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/tool-presentation-host-tools.test.ts) |
| `tool-display.replay` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [resume](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-resume-pty.test.ts), [verifier](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-tools-resume-pty.ts) |
| `tool-display.timer` | `normal=pass; recovery=pass; persistence=pass; boundary=pass` | [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui/ui-settings-dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts) |
| `tool-display.resume` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/tools-resume-pty.test.ts), [verifier](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-tools-resume-pty.ts) |
| `rtk.commands` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-rtk-pty.ts), [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/dialog.test.ts) |
| `rtk.certification` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [real runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/real-rtk.test.ts), [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/runtime.test.ts) |
| `rtk.projection` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [projection](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/projection.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-rtk-pty.ts) |
| `rtk.settings` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/settings.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-rtk-pty.ts) |
| `rtk.rewrite-boundary` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [focused](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/runtime.test.ts), [real runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/rtk/real-rtk.test.ts) |
| `codex.surface` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex-host.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `codex.fast` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/settings.test.ts), [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/dialog.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `codex.usage` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [usage](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/usage.test.ts), [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/dialog.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `codex.apply-patch` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [native](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/native-tools.test.ts), [registration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/tools.test.ts) |
| `codex.view-image` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [native](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/native-tools.test.ts), [registration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/tools.test.ts) |
| `codex.imagegen` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [native](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/native-tools.test.ts), [registration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/tools.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `codex.settings` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/settings.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex-host.test.ts) |
| `codex.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/codex/dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ui-pty.test.ts) |
| `goal.objective` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-pty.test.ts), [lifecycle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-goal-lifecycle.ts) |
| `goal.commands` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-pty.test.ts), [commands](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/command.node.ts) |
| `goal.continuation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [lifecycle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-goal-lifecycle.ts), [protocol](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-continuation.node.ts) |
| `goal.persistence` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [persistence](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/persistence.node.ts), [lifecycle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-goal-lifecycle.ts) |
| `goal.compaction` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [lifecycle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-goal-lifecycle.ts), [run protocol](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-run-protocol.node.ts) |
| `goal.complete` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [terminal Tools](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-terminal-tools.node.ts), [lifecycle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-goal-lifecycle.ts) |
| `goal.blocked` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [terminal Tools](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-terminal-tools.node.ts), [recovery](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-recovery.node.ts) |
| `goal.limits` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [budget](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-budget.node.ts), [accounting](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/goal-accounting.node.ts) |
| `goal.presentation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-pty.test.ts), [UI](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/goal-upstream/menu.node.ts) |
| `context-management.activation` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [activation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/core-activation.test.ts), [config](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/config.test.ts) |
| `context-management.projection` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [projections](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/core-projections.test.ts), [Agents](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/foreground-engine-context.test.ts) |
| `context-management.compaction` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [compaction](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/core-compaction.test.ts), [Host seam](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/native-custom-turn-compaction-host-seam.test.ts) |
| `context-management.prompt` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [prompt](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/prompt-contributions.test.ts), [real acceptance](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-magic-context-real.ts) |
| `context-management.commands` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/dialog.test.ts), [maintenance](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/core-maintenance.test.ts), [activity](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/activity.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context-pty.test.ts) |
| `context-management.custom-turn` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [Host seam](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context/native-custom-turn-compaction-host-seam.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/context-pty.test.ts) |
| `ponytail.mode` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail/runtime.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail-pty.test.ts) |
| `ponytail.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/conversation-ui/ponytail-dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail-pty.test.ts) |
| `ponytail.prompt` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [prompt](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail/prompt.test.ts), [budget](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail/prompt-budget.test.ts) |
| `ponytail.agents` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [propagation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/ponytail-propagation.test.ts), [Agents PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents-pty.test.ts) |
| `ponytail.skills` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail/runtime.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `ponytail.settings` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [config](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail/core.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/ponytail-pty.test.ts) |
| `web.tools` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [adapter](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/adapter.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `web.search` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [integration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-web-integration.ts), [adapter](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/adapter.test.ts) |
| `web.fetch` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [extraction](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/extract.test.ts), [integration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-web-integration.ts) |
| `web.retained-content` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [adapter](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/adapter.test.ts), [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/presentation.test.ts) |
| `web.activity` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [activity](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/activity.test.ts), [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/presentation.test.ts) |
| `web.url-security` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [URL policy](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/url-policy.test.ts), [fake IP](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/fake-ip.test.ts), [SSRF](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/ssrf-protection.test.ts) |
| `web.redirect-security` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [redirects](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/provider-api-redirects.test.ts), [integration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-web-integration.ts) |
| `web.domain-filter` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [domains](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/provider-domain-filter.test.ts), [adapter](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/adapter.test.ts) |
| `web.settings` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [configuration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/config.test.ts), [activity](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/activity.test.ts) |
| `web.credentials` | `normal=blocked; failure=pass; recovery=pass; boundary=pass` | [credentials](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/credential-source.test.ts), [Provider API](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/web/gemini-api.test.ts) |
| `mcp.gateway` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [adapter](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/adapter.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `mcp.connection` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [runtime owner](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/runtime-owner.test.ts), [Host seam](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/host-seam.test.ts) |
| `mcp.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-mcp-pty.ts) |
| `mcp.navigation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-mcp-pty.ts) |
| `mcp.management` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/dialog.test.ts), [persistence](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/config-persistence.test.ts) |
| `mcp.confirmation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/dialog.test.ts), [setup](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/setup-panel.test.ts) |
| `mcp.setup` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [setup](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/setup-panel.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-mcp-pty.ts) |
| `mcp.oauth` | `normal=blocked; failure=pass; recovery=pass; boundary=pass` | [OAuth](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/auth-flow.test.ts), [command secret](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/command-secret.test.ts) |
| `mcp.credentials` | `normal=blocked; failure=pass; recovery=pass; persistence=pass` | [OAuth](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/auth-flow.test.ts), [persistence](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/config-persistence.test.ts) |
| `mcp.discovery` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [probe](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/probe.test.ts), [adapter](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/adapter.test.ts) |
| `mcp.output` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [output guard](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/output-guard.test.ts), [proxy](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/proxy-call.test.ts) |
| `mcp.status` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [status](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/status-store.test.ts), [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/presentation.test.ts) |
| `mcp.configuration` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [paths](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/xdg-paths.test.ts), [persistence](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/config-persistence.test.ts) |
| `mcp.presentation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/mcp/presentation.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-mcp-pty.ts) |
| `background-work.shell` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [launch](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/runtime-launch.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work-host.test.ts) |
| `background-work.handoff` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/host.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-work-pty.ts), [reconciliation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/runtime-reconciliation.test.ts), [settlement](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/runtime-settlement.test.ts) |
| `background-work.monitor` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [monitor](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/monitor.test.ts), [matrix](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-work-monitor-matrix.ts) |
| `background-work.receipts` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [settlement](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/runtime-settlement.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/host.test.ts) |
| `background-work.notifications` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [notifications](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/runtime-notifications.test.ts), [activity](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/activity-presentation.test.ts) |
| `background-work.tasks` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/tasks-dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-work-pty.ts) |
| `background-work.details` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/tasks-dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-work-pty.ts) |
| `background-work.controls` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work/tasks-dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-work-pty.ts) |
| `background-work.scope` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/work-host.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `subagents.schema` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [contract](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/executor-contract.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `subagents.discovery` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [discovery](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-discovery.test.ts), [bundle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-bundle-boundary.test.ts) |
| `subagents.launch` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [foreground](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/foreground-engine-launch.test.ts), [background](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/background-engine-lifecycle.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `subagents.capacity` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [governor](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/session-governor.test.ts), [admission](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/foreground-engine-admission.test.ts) |
| `subagents.budgets` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [governor](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-execution-governor.test.ts), [contract](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/executor-contract.test.ts) |
| `subagents.targets` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [status](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/run-status.test.ts), [controls](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/current-agents-controls.test.ts) |
| `subagents.steering` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [steering](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/steering-wait.test.ts), [control channel](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/control-channel.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `subagents.child-host` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [child protocol](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/child-protocol.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents-host.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `subagents.ponytail` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [propagation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/ponytail-propagation.test.ts), [child protocol](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/child-protocol.test.ts) |
| `subagents.context` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [context](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/foreground-engine-context.test.ts), [fallback](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/background-engine-fallback.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `subagents.protocol` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [protocol](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/child-protocol.test.ts), [transcript](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-transcript.test.ts) |
| `subagents.background-completion` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [delivery](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/result-watcher-delivery.test.ts), [artifacts](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/background-engine-artifacts.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `subagents.foreground-result` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [foreground](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/foreground-engine-context.test.ts), [result](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/final-report-scanner.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `subagents.transcript` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [transcript](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-transcript.test.ts), [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/tool-presentation-rendering.test.ts) |
| `subagents.fleetview` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [roster](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-roster.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-agents-pty.ts) |
| `subagents.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/agent-dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-agents-pty.ts) |
| `subagents.git-attribution` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [lifecycle](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/current-agents-lifecycle.test.ts), [events](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/current-agents-projection.test.ts) |
| `subagents.worktrees` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [worktrees](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/worktree-lifecycle.test.ts), [artifacts](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/artifacts.test.ts) |
| `subagents.artifacts` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [artifacts](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/artifacts.test.ts), [maintenance](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/runtime-maintenance.test.ts) |
| `subagents.scope` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [composition](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/agents/extension-root-composition.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `todo.tools` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [integration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/todo.integration.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo-host.test.ts) |
| `todo.identity` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [reducer](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/state-reducer.test.ts), [store](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/store.test.ts) |
| `todo.dependencies` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [graph](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/task-graph.test.ts), [integration](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/todo.integration.test.ts) |
| `todo.replay` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [replay](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/replay.test.ts), [store](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/store.test.ts) |
| `todo.checklist` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [render](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/todo-overlay.render.test.ts), [activity](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/activity-presentation.test.ts) |
| `todo.scope` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/todo/response-envelope.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `btw.call` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [core](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/core.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw-host.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `btw.context` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [transport](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/transport.test.ts), [core](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/core.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `btw.history` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` | [history](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/history.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw-host.test.ts) |
| `btw.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [UI](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/ui.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-btw-pty.ts) |
| `btw.clear` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [UI](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/ui.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw-pty.test.ts) |
| `btw.promotion` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [core](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/core.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-btw-pty.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `btw.isolation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [transport](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw/transport.test.ts), [Host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/btw-host.test.ts), [真实 Provider 验收](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-live-provider-capabilities.ts) |
| `notification.eligibility` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/runtime.test.ts), [extension](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/extension.test.ts) |
| `notification.cancellation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/runtime.test.ts), [extension](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/extension.test.ts) |
| `notification.transport` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [transport](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/transport.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-notification-pty.ts) |
| `notification.tmux` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [transport](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/transport.test.ts), [format](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/format.test.ts) |
| `notification.settings` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/settings.test.ts), [extension](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/extension.test.ts) |
| `notification.dialog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/dialog.test.ts), [PTY](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-notification-pty.ts) |
| `notification.privacy` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [format](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/format.test.ts), [transport](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/notification/transport.test.ts) |
| `code-mode.envelope` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [extension](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/extension.test.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |
| `code-mode.settings` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/settings.test.ts), [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/dialog.test.ts) |
| `code-mode.child-state` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [delegate](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/delegate-runtime.test.ts), [settings](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/settings.test.ts) |
| `code-mode.execution` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/runtime.test.ts), [V8](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/v8-real.test.ts) |
| `code-mode.catalog` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [search](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/cloudflare-search.test.ts), [codec](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/cloudflare-codec.test.ts) |
| `code-mode.output` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [image](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/image-content.test.ts), [normalization](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/cloudflare-normalize.test.ts) |
| `code-mode.nested-tools` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [connector](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/connector.test.ts), [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/runtime.test.ts) |
| `code-mode.presentation` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [presentation](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/presentation.test.ts), [TUI](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-code-mode-tui.ts) |
| `code-mode.media` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [image](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/image-content.test.ts), [real TUI](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-code-mode-tui.ts) |
| `code-mode.call-limit` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/runtime.test.ts), [connector](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/connector.test.ts) |
| `code-mode.ledger` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [ledger](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/ledger.test.ts), [trace](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/trace-store.test.ts) |
| `code-mode.approval` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [ledger](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/ledger.test.ts), [dialog](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/dialog.test.ts) |
| `code-mode.recovery` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [ledger](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/ledger.test.ts), [connector](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/connector.test.ts) |
| `code-mode.programs` | `normal=pass; failure=pass; recovery=pass; persistence=pass` | [ledger](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/ledger.test.ts), [runtime](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/runtime.test.ts) |
| `code-mode.native-host` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [installer](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/install-host.test.ts), [real host](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-code-mode-real.ts) |
| `code-mode.token-gate` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [extension](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/test/code-mode/extension.test.ts), [real gate](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-code-mode-real.ts) |
| `code-mode.compatibility` | `normal=pass; failure=pass; recovery=pass; boundary=pass` | [real gate](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-code-mode-real.ts), [package](https://github.com/jczhang02/pi-stuff/blob/0aee8be48416485d0cf1d2139a2fddd381a35d9d/scripts/verify-package.ts) |

### 受阻条件

- `web.credentials`：隔离配置中没有可用于真实外发请求的可丢弃兼容 Web Provider 凭据。凭据发现、失败
  行为、恢复和脱敏由 fixture 验证通过。
- `mcp.oauth`：可用 MCP 配置没有支持 OAuth 的可丢弃 Service。OAuth 失败、恢复和 redirect 边界由
  fixture 验证通过。
- `mcp.credentials`：同一缺失条件阻止了正常的真实凭据交换；失败、恢复和持久化行为由 fixture 验证通过。

## 附录 B — Terminal-Bench 完整结果表

### 汇总观察

| 切片 | 尝试次数 | Reward 1 | 观察比率 | Input tokens | Cache-read tokens | Output tokens | 成本 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 全部任务的首次尝试 | 89 | 71 | 79.78% | 129,637,153 | 121,820,032 | 1,615,016 | $5.93784404 |
| 预先声明的重复 | 11 | 10 | 90.91% | 11,489,608 | 10,896,896 | 163,723 | $0.53294792 |
| 全部含模型工作 | 100 | 81 | 不是基准比率 | 141,126,761 | 132,716,928 | 1,778,739 | $6.47079196 |

### 首次尝试未通过项

| 任务 | 首次 reward | Harness 异常 |
| --- | ---: | --- |
| `largest-eigenval` | 0 | `AgentTimeoutError` |
| `path-tracing-reverse` | 0 | `AgentTimeoutError` |
| `make-doom-for-mips` | 0 | `AgentTimeoutError` |
| `schemelike-metacircular-eval` | 0 | `AgentTimeoutError` |
| `pytorch-model-recovery` | 0 | `NonZeroAgentExitCodeError` |
| `filter-js-from-html` | 0 | 无 |
| `extract-moves-from-video` | 0 | `AgentTimeoutError` |
| `query-optimize` | 0 | `AgentTimeoutError` |
| `gcode-to-text` | 0 | `AgentTimeoutError` |
| `torch-tensor-parallelism` | 缺失 | `VerifierTimeoutError` |
| `train-fasttext` | 0 | `AgentTimeoutError` |
| `configure-git-webserver` | 0 | 无 |
| `protein-assembly` | 0 | 无 |
| `video-processing` | 0 | 无 |
| `regex-chess` | 0 | `AgentTimeoutError` |
| `raman-fitting` | 0 | 无 |
| `cancel-async-tasks` | 0 | 无 |
| `portfolio-optimization` | 0 | 无 |

### 保留的重复结果

| 任务 | 首次 | 重复 |
| --- | ---: | ---: |
| `cancel-async-tasks` | 0 | 1 |
| `llm-inference-batching-scheduler` | 1 | 1 |
| `fix-ocaml-gc` | 1 | 1 |
| `nginx-request-logging` | 1 | 1 |
| `build-pmars` | 1 | 1 |
| `sqlite-db-truncate` | 1 | 1 |
| `filter-js-from-html` | 0 | 0 |
| `large-scale-text-editing` | 1 | 1 |
| `kv-store-grpc` | 1 | 1 |
| `mteb-leaderboard` | 1 | 1 |
| `write-compressor` | 1 | 1 |
