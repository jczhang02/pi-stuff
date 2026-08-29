<!-- translation-source: docs/agents/domain.md; translation-source-sha256: cae3f409f48fd3f049d06b664a29835c3e381cf1875b5c4bec427b44f0cf0158 -->

# 领域文档

本仓库使用单上下文领域布局。

## 探索前

阅读：

- 仓库根目录的 `CONTEXT.md`；
- `docs/adr/` 下相关 ADR。

其中任一位置不存在时，静默继续。只有真正确定了术语或架构决策时，才创建或扩展领域文档。

## 布局

```text
/
├── CONTEXT.md
├── DESIGN.md
├── docs/
│   ├── README.md
│   ├── compatibility.md
│   ├── adr/
│   └── agents/
└── packages/
```

工作区软件包边界不会自动产生分离的领域上下文。只有真正出现相互独立的领域语言时，才引入 `CONTEXT-MAP.md`。报告、研究、发布、原型和本地化翻译是证据或读者辅助材料，不是分离的领域上下文。

## 词汇

在代码、测试、Issue、计划和文档中使用 `CONTEXT.md` 定义的术语。不要悄悄用同义词替换规范术语。

缺少必需概念时，应重新考虑它是否属于该领域，或通过领域建模工作流更新词汇表。

会话确定了持久术语或所有权决策时，应在同一变更中更新 `CONTEXT.md` 或 ADR。会话历史是证据，不是仓库的长期决策记录。

## 架构决策

更改某个区域前，先阅读影响该区域的 ADR。如果拟议工作与 ADR 冲突，应显式指出冲突，而不是悄悄覆盖原决策。
