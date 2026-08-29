<!-- translation-source: docs/adr/0023-use-a-closed-operation-block-family.md; translation-source-sha256: 6aa176c14e333c884d2ccea622a7594616eb31b6092389a1e5bd675f2a83a0a7 -->

---
status: accepted
---

# 使用封闭的 Operation Block 家族

## 背景

ADR 0022 拒绝通用的 `Tool(args)` 加 child-status block；与此同时，Bash 和另外几类 evidence-rich Tool
Activity 仍适合使用相同的 parent-and-child 阅读形态。如果没有明确边界，presentation metadata 可能逐步把
这种局部形态变成 ADR 0022 已经拒绝的通用 Tool card。

本决策被接受时，Bash 是唯一已实现的 Operation Block。Write、Edit、Patch、`background` Tool 的
`action: "output"` activity 与 unmatched outer Code Mode issue 仍使用各自既有的 Tool-specific presentation。

## 决策

Pi Stuff 为 Operation Block 采用封闭的 eligibility boundary。本决策被接受时，Bash 仍是唯一已实现的成员。
后续实现只能加入 Write、Edit、Patch、`background` Tool 的 `action: "output"` activity，或没有 nested Tool
或 media projection 表示的外层 Code Mode error、rejection 或 cancellation。每项 specialization 发布时，都必须
同步更新所属 Module contract 与 acceptance evidence。

Code Mode specialization 会替换同一条 Envelope Fallback Row 的 presentation；它不会增加第二条 row，也不会
改变 nested Tool 与 media 的 ownership。candidate 完成 specialization 之前，其既有 semantic shape 仍是权威。
MCP 和其他所有 Tool 家族不能通过 presentation metadata 选择加入该家族。

本决策细化 standalone Tool presentation，但不取代 ADR 0022。只有原生 Read、Grep/Find 与 List 是 Retrieval
Group 成员；已被拒绝的通用 `Tool(args)` 加 child-status block 仍然不采用。

## 后果

- Operation Block 可以共用克制的 parent-and-child grammar，而不会变成通用 Tool abstraction。
- 本决策约束后续 presentation 工作，但不声称尚未实现的 specialization 已经发布。
- 如果要扩展到预留 candidate 以外的 Tool，必须重新审视这一边界，不能增加选择加入的 metadata flag。
