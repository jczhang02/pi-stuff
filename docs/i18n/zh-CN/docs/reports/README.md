<!-- translation-source: docs/reports/README.md; translation-source-sha256: 7dedb69af615b70c1858aa7931eb39b4ea323d22fd09bc615e4c75fb636cf971 -->

# 报告

本目录保留带日期的验收、设计与性能证据。标题中的“当前状态”表示文件名或报告日期当时的状态，不构成持续兼容性声明。

当前已验证宿主与工具链见 [`docs/compatibility.md`](../compatibility.md)。历史机器路径、版本、截图和哈希保持不变，因为它们标识产生证据的环境。当前工程权威索引见 [`docs/README.md`](../README.md)。

## 保留报告

- [Skill Discovery 启动边界真实模型确认](../../../../../docs/reports/skill-discovery-startup-bounded-confirmation-20260830.json)——
  Raw/off/on 各 30/30，通过预注册的 non-inferiority gate；30 个 Code Mode Session 全部直接使用选中 Skill，
  timeout 与 safety violation 均为零；方法与解释见其
  [预注册](../../../../../docs/research/skill-discovery-startup-bounded-confirmation-20260830.md)
- [Skill Discovery 隔离真实模型确认](../../../../../docs/reports/skill-discovery-isolated-confirmation-20260830.json)——
  保留的 hard gate 失败研究；完成的 29 个 Code Mode Session 全部通过 direct Skill use，但 4 个 Suite
  Session 在 Provider 请求前超时；解释见其
  [预注册](../../../../../docs/research/skill-discovery-isolated-confirmation-20260830.md)
- [Skill Discovery direct-read 真实模型研究](../../../../../docs/reports/skill-discovery-direct-read-20260830.json)——
  保留的 hard gate 失败研究；完成的 29 个 Code Mode Session 全部通过 direct Skill use，但一个匹配的
  off/on pair 在 Provider 请求前超时；解释见其
  [预注册](../../../../../docs/research/skill-discovery-direct-read-20260830.md)
- [Skill Discovery 真实模型 confirmation](../../../../../docs/reports/skill-discovery-confirmation-20260830.json)——
  保留的 behavioral gate 失败研究；解释见其[预注册](../../../../../docs/research/skill-discovery-confirmation-20260830.md)
- [Skill Discovery 真实模型 benchmark](../../../../../docs/reports/skill-discovery-benchmark-20260830.json)——保留的
  instrumentation failure 研究；解释见其[预注册](../../../../../docs/research/skill-discovery-benchmark-20260830.md)
- [ps-8z1 最终验收](ps-8z1-final-acceptance-2026-08-29.md)
- [Pi Stuff 0.3.0 最终验收](pi-stuff-0.3.0-final-acceptance.md)及其保留的[截图](../../../../../docs/reports/assets/pi-stuff-0.3.0/)
- [单软件包迁移](single-package-migration.md)
- [生命周期性能](pi-stuff-lifecycle-performance.md)
- [上下文提交并发](context-submit-concurrency-research-2026-08-14.md)
- [UI 审查](pi-stuff-ui-review-2026-08-05.md)
- [工具折叠设计依据](tool-folding-comparison-20260806/design_rationale.md)
- [对话框图像交接](dialog-readability-20260817/image-handoff.md)
- [0.3.0 执行清单](../../../../../docs/reports/pi-stuff-0.3.0-execution-checklist.zh-CN.md)——仅中文的历史记录

原始 JSON、ANSI、文本和图像证据留在所属报告或基准旁。重复渲染的 HTML、PDF、CSS 和复制图像包不构成第二条文档通道；Markdown 或原始来源已经足够时会删除。
