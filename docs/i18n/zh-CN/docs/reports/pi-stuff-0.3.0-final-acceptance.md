<!-- translation-source: docs/reports/pi-stuff-0.3.0-final-acceptance.md; translation-source-sha256: a8be899ad0044716ebea14e126181e4bf24ff3ae5ae5f847880f86b031878567 -->

# Pi Stuff 0.3.0 最终验收

> 这是 2026-08-05 的历史验收记录，不认证当前 Host 或安装路径。当前版本见
> [兼容性指南](../compatibility.md)。

## Release 身份

| 项目 | 记录值 |
| --- | --- |
| Package | `@jczhang02/pi-stuff@0.3.0` |
| Pi Host | `0.83.0` |
| Release archive | `.artifacts/release/jczhang02-pi-stuff-0.3.0.tgz` |
| Archive SHA-256 | `6fdb2a410ad38c202dffd08a416e7119390887d95d06f47748737556dfbcbed0` |
| 已签名 release commit | `1581958e73194e76e89b2121bf4206f442155402` |
| 已签名验收竞态修复 | `2facc4355313d61f5b0340797f2a8a9fe5fc0c47` |

该 archive 通过 Pi Settings layer 安装，并在真实 Pi TUI 和真实 OpenAI Codex 模型中运行。验收覆盖首次使用、
故障、Context 压力和冷 Resume。

## 真实 Host 证据

主 Session 记录在：

```text
.artifacts/final-acceptance-0.3.0/real-model-sessions/2026-08-05T09-43-55-235Z_019fd14e-e063-7d63-a037-81347769fdda.jsonl
```

其 SHA-256 为 `cc14c9770b2a781539cd3f98c54cde2247337410648e248f95b4f28fcbb6b52e`，共 140 条
entry。保留的结果摘要如下：

- Todo 最终为 5/5 completed。Background Shell 和 Monitor 分别产生 `BACKGROUND_REAL_030` 与
  `MONITOR_REAL_030`，前台工作没有停下。
- Web、MCP、Agents 和图片检查在同一次运行中完成；本地 MCP 返回 `MCP_REAL_030`。
- BTW 把 `PI_STUFF_030_REAL_ACCEPTANCE` 留在主 transcript 之外。Goal 按字节写入并验证
  `GOAL_REAL_030\n`。
- Bash、私网 URL 和损坏 MCP 的预期故障保持可见，Agent 随后继续输出 `DEGRADED_RECOVERY_030`。
- Magic Context 在 53,297 tokens 时压缩，来源为 `magic-context`，没有原生 boundary。冷 Resume 后通过
  Context retrieval 找回早期标记。

## Magic-only gate

机器可读的 [Magic Context 报告](../../../../../docs/reports/magic-context-real-acceptance.json)保留完整 artifact
和 Session hash。验收摘要为：

| 测量 | 结果 |
| --- | ---: |
| 模型 Context window | 128,000 tokens |
| 最大 Provider prompt | 94,373 tokens（73.73%） |
| 官方 Magic 原始压力峰值 | 113,765 tokens |
| Boundaries | ordinal 6 和 10；compartment 1–6 和 7–10 |
| Prompt Cache | 461,184 cached-read tokens；命中率 46.64% |
| Pi 原生 compaction | 本 gate 中关闭；原生 boundary 和 lifecycle event 均为 0 |
| 最终结果 | passed |

日用配置只把原生 compaction 留作 Magic 接管前的 fallback，不属于这项 Magic-only gate。

## 打包与闭环

Release check 重建了 13 个不可变 archive，结果为 `544 pass / 0 fail / 0 skip`。最终日志 SHA-256 是
`4ae1dcb537ed6775b0d4d29e6112c7e71c900dcc4ba97aa1292b5f3867a23505`；记录的可执行版本为 RTK
`0.42.4` 和 Pi `0.83.0`。已经完成的 95 项清单覆盖 UI、后台工作、Context、仓库合并、能力回归、打包和
真实模型验收。

详细清单和五张 UI 截图在摘要整理完成后从当前 tree 删除，Git 历史仍保留它们。

## 结果

Pi Stuff 0.3.0 通过了当时的真实 Host、真实模型、打包、故障恢复和 Magic-only gate。这是历史证据，不是
当前兼容性声明。
