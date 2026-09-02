<!-- translation-source: docs/reports/ps-qer-agent-completion-acceptance-20260902.md; translation-source-sha256: d2e11cfcff7eeb8a4bca1047b19389802caff37639037134a2d11c2644c282ef -->

# ps-qer Agent 完成验收

[English](../../../../../docs/reports/ps-qer-agent-completion-acceptance-20260902.md)

日期：2026-09-02  
Bead：`ps-qer`  
修复前即时基线：`124dcbf92de847e4c5d845509b9b839a283aeb31`  
运行时候选：`c4ab125c750f5d005277c384d15dd506c1609746`  
同步上游：pi-subagents v0.63.0，提交 `4f7eb2b56dc5306416920db8c6e222c7aaad3c81`

## 结论

候选版本满足 Agent 完成控制的验收契约。普通委派工作不再有隐式 Assistant 轮次预算或全局 Tool 预算。
真实六 reviewer 对照在没有 steering 和 transcript 检查的情况下越过已移除的旧边界；六项工作最终都到达预注册的
30 分钟 timeout，并如实返回为可操作、有界的 `timeout` / `incomplete` 结果，附带累计用量和可恢复 Target。
没有任何一项被报告为成功或已完成交付物。

独立的确定性子进程回归在 71 个 Assistant 轮次和 130 次 Tool 调用后完成，证明子 Agent 可以越过两个旧边界，
随后仍返回最终答案。

## 冻结的对照条件

manifest 在候选执行前冻结。基线与候选使用相同的六段任务文本、同一个用户作用域只读 reviewer 定义，
并使用以下选择契约：

| 字段 | 冻结值 |
| --- | --- |
| Agent 定义 SHA-256 | `4eb0402b4a5a96297c5d12d5c9cd17d011aa3dedd40753de2e096da11bcab0c3` |
| Provider / 模型 | `openai-codex` / `gpt-5.6-sol` |
| Thinking | `xhigh` |
| Fallback | 无 |
| Context | `fresh` |
| Reviewer Tools | 五个只读 Tool；没有显式 Tool 预算 |
| Parent | 通过 Code Mode 调用六个任务的确定性零成本 fixture |
| 候选终止边界 | 一个预注册的 30 分钟前台运行 timeout |
| 干预 | 无 steering、resume 或 transcript 检查 |

Parent fixture 既不能改写 reviewer 任务，也不能增加子 Agent 的 Provider 成本。任务文本保持私有；精确身份只通过
SHA-256 确认：

| Reviewer | 任务 SHA-256 |
| --- | --- |
| R1 | `94e398d3fa04298232a2c72106fe395050b824bfa4deb414176299d92b3fbc64` |
| R2 | `bca4094b3c88e7e5d42df175075f8e99cbe32201b32b2f09c41d59e10c5ac925` |
| R3 | `02c5b1ad5fa664a8b70397adac20405b96e0a73e5505b9260c11dbf6b6400759` |
| R4 | `1d7ee687026fd440631349eb6358cb060414f574eb47c4f7057d5cbdac3b4495` |
| R5 | `bf05a0096c788779da0bc590e252ff638e59ce6cb9ec98944c65a5b4917a8313` |
| R6 | `aa483ffc3185edbd53588b76a379887c0b7dec91cd707b38d4a33fbf458f1cbf` |

## 公开指标

修复前即时基线通过已移除的隐式轮次预算，让每名 reviewer 都在第 66 轮停止：

| Reviewer | 首次终止类别 | 轮次 | Tools | 输入 | 输出 | 报告的 USD | 尝试 | 恢复 | 最终交付物 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| R1 | `explicit_budget` | 66 | 72 | 698,286 | 11,266 | 3.946914 | 1 | 0 | 否 |
| R2 | `explicit_budget` | 66 | 70 | 538,685 | 9,442 | 3.177901 | 1 | 0 | 否 |
| R3 | `explicit_budget` | 66 | 66 | 616,125 | 10,163 | 3.530667 | 1 | 0 | 否 |
| R4 | `explicit_budget` | 66 | 66 | 610,164 | 11,148 | 3.549612 | 1 | 0 | 否 |
| R5 | `explicit_budget` | 66 | 67 | 597,245 | 8,711 | 3.415235 | 1 | 0 | 否 |
| R6 | `explicit_budget` | 66 | 94 | 744,502 | 12,180 | 4.163430 | 1 | 0 | 否 |

候选让同一批工作继续运行，直到独立 timeout 生效。只读验证者检查了非空终止输出，并将其归类为有界部分证据，
而不是所请求的最终交付物：

| Reviewer | 首次终止类别 / 状态 | 轮次 | Tools | 输入 | 输出 | 报告的 USD | 尝试 | 恢复 | 最终交付物 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| R1 | `timeout` / `incomplete` | 257 | 304 | 2,654,399 | 53,797 | 15.004177 | 1 | 0 | 否 |
| R2 | `timeout` / `incomplete` | 242 | 242 | 2,381,542 | 46,846 | 13.470658 | 1 | 0 | 否 |
| R3 | `timeout` / `incomplete` | 244 | 246 | 2,454,432 | 48,999 | 13.891826 | 1 | 0 | 否 |
| R4 | `timeout` / `incomplete` | 255 | 266 | 2,652,577 | 52,335 | 14.939687 | 1 | 0 | 否 |
| R5 | `timeout` / `incomplete` | 288 | 318 | 2,844,245 | 49,157 | 15.808063 | 1 | 0 | 否 |
| R6 | `timeout` / `incomplete` | 244 | 259 | 2,468,055 | 52,095 | 14.061973 | 1 | 0 | 否 |

| 汇总 | 轮次 | Tools | 输入 | 输出 | 报告的 USD | 尝试 | 恢复 | 最终交付物 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 基线 | 396 | 435 | 3,805,007 | 62,910 | 21.783759 | 6 | 0 | 0 |
| 候选 | 1,530 | 1,635 | 15,455,250 | 303,229 | 87.176384 | 6 | 0 | 0 |

每项候选结果都保留了有界证据、具体 Target、`resumeSupported: true` 和
`acknowledgementRequired: true`。由于该运行只包含一次尝试且没有恢复，每项结果的首次尝试用量与累计 work unit
用量相同。这里只在 Provider 提供权威成本遥测时记录 USD；Pi Stuff 不推算价格。

## 契约证据

- 新运行不接收隐式轮次预算或全局 Tool 预算。轮次和 Tool 次数只作为遥测。
- 冻结的默认累计 guard 为 1,000,000 个报告 token；有权威 USD 时另设 USD 5.00。它只在后续自动扩展前检查，
  不会终止正在运行的子 Agent。
- 用户直接确认会保留累计总量，并增加恢复与模型尝试计数。
- 显式 Tool 预算仍是可选项。其硬限制只阻止配置的 Tool 名称，并保留最终综合能力。
- timeout、stop、Provider、Context 容量、存储、协议、进程、成本 guard 和显式预算终止仍保持 incomplete 或
  failed，并附带有界原因、部分证据、用量、Target 和恢复资格。
- 无版本旧记录只凭正向物理证据恢复。已死或无法验证的记录会被隔离，不会 signal 或回收未知 owner，
  任何旧路径都不会伪造成功。
- 前台执行仍由 Pi 所有；后台生命周期、恢复和计量仍由 Agents 所有。Goal 与 Context Management 边界不变。

适用的上游变更与有意排除的产品见 [v0.63 同步台账](../research/pi-subagents-v0.63-synchronization-20260902.md)。
动机证据与预声明测量契约保存在[完成控制研究记录](../research/subagent-completion-controls-20260902.md)中。

## 认证

最终分支只有在完整 diff 上通过以下所有仓库门禁后才被接受：

- 聚焦的完成、累计用量、终止结果、Tool 预算、旧恢复、所有权和真实进程控制测试；
- `bun run check`，包括 `check:fast`、逐文件进程隔离测试、Goal 上游/运行时验证、Tool Activity 基准以及
  解包后的 Package 验证；
- 认证 Pi 0.84.4 上的真实 Host Agent 执行矩阵、Agent PTY、Context PTY、fresh/fork、前台/后台、长运行、
  steering 与 Context 投影接缝；
- 对完整最终 diff 连续两轮独立且零发现的 Thermo-Nuclear 审查。

额外的非门禁 `benchmark:lifecycle` 诊断没有满足其历史 reload 和同进程 prompt 预算。对精确 `124dcbf`
基线的顺序运行复现了相同的失败类别和量级，因此这里不把它声称为 ps-qer 生命周期性能认证，也不会通过放宽预算
来“修复”。该 Bead 明确把无关表面重构留在范围之外。

## 隐私

本报告只包含提交身份、配置哈希、任务哈希、公开生命周期字段、汇总指标和结论。凭据、Agent 名称、任务或 prompt
文本、Assistant 输出、私有路径、原始 Session、运行和 Session 标识符、模型存储及私有 artifact 内容均不进入仓库。
