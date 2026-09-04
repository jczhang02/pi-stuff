<!-- translation-source: docs/adr/0028-bound-tool-display-before-projection.md; translation-source-sha256: 0ff774c61e052774e1c9c9d2a71c31f557746f08e3808f9b54e39a7dd78af35b -->

---
status: accepted
amends: 0025-protect-vibe-line-spinner-liveness
---

# 在 projection 前限制 Tool Display

## 背景

Tool Display 曾通过递归排序并哈希完整 Tool argument 来派生失败恢复 identity。在已认证 Pi 0.84.4 PTY 中，
带 100,000 个 object field 的复现会在 Tool row 出现前阻塞 Host 线程 568–681 ms；输入与 Vibe Line Spinner
在同一时段停止。只禁用这项显示计算后，首个 UI 延迟降至约 90 ms。其他 Tool Display 路径也可能先遍历完整
argument、result、nested operation、media 或 Session history，再应用可见 cap。

ADR 0025 把 500 ms 规定为跨 Capability 的严重 stall 门槛。Tool 交互需要更严格的契约，因为 Tool row 出现前
的停顿会让正常运行看起来像是卡死。

## 决策

每一条由 Pi Stuff 所有的 Tool Display 路径，都必须先限制任意数据，再运行 presentation callback、serialization、
parsing、diff projection、wrapping、highlighting 或其他高分配开销工作。Compact、Expanded、Formatted、Raw、
MCP、Operation Block、Code Mode envelope、Agent Tool row、replay、resume 与 `/tools` projection 共享固定的内部
item、key、depth、operation、media、line、byte 与 history budget。超大数据会收到真实的省略证据；只有无需完整
扫描就已经知道时，才显示精确省略数量。规范 Tool argument、result、Provider context 与 Session record 保持完整。

Tool Activity 的 failure recovery 被删除，而不是缓存或延后。后续成功不会改变每次失败的历史事实，混合状态的
Retrieval Group 仍显示警告。该决定不改变 retry 或 Agent recovery。

`/tools` 不接受参数，并且只物化最新的有界 page。显式选择 `Load older activities…` 时加载一个更早 page。
跨 member 或 page budget 的连续 retrieval 会成为有序 continuation segment；可见边界会阻止 continuation 声明。
内部 Tool ID 仍用于 projection 与 selection。

更严格的认证目标是：Tool start 到首个 Tool UI、输入回显及选择反馈不超过 150 ms；同一个可见 Vibe Line
Spinner frame 不得保持不变超过 200 ms。ADR 0025 的 500 ms assertion 仍作为独立严重失败兜底。该保证包含
Suite 所有的 Agent 相关 Tool row，但不包含 `/agents`、委派执行策略、Host 原生 renderer 与第三方 Extension
renderer。

Suite 的辅助 surface 不能把 Tool repaint 变成完整 Context scan。Host 忙碌时，Statusline 保留上一次 settled
context-usage value，并在 Host 恢复 idle 后刷新。对于固定引擎只读取 Session metadata 或 Assistant usage 的
Tool lifecycle 与 Session-only synchronization 路径，Context Engine Worker 会省略 context-usage 读取。

## 拒绝的方案

- 缓存、延后或简化 recovery hash，仍会保留价值不足以抵偿其工作的显示功能。
- 在 stringify、parse、sort 或 render 后才做最终 slice，只限制输出，不限制 Host-thread 工作。
- 后台完整详情 builder 会增加 lifecycle 与 cache ownership，也仍会鼓励无界显示数据。
- 把 500 ms 当作普通 Tool 响应标准，即使严重兜底通过，也会保留肉眼可见的卡顿。

## 后果

正常大小的 Tool content 保留语义呈现；object 形状的 MCP argument 可能显示明确的 preview 省略标记，因为
JavaScript 无法只枚举任意 object key 的有界前缀。长 Session 从最近 activity 打开，并通过显式分页保留早期
记录。Code Mode execution 与 Provider context media、Agent lifecycle、Tool permission 和 Session persistence
继续保留原 owner 与数据。
活动工作期间，Statusline 可以一直显示前一次 settled usage value，直到 Pi 下一次 idle repaint。
