<!-- translation-source: docs/research/README.md; translation-source-sha256: 9c597802737e936a6cc693def23cff6f48db1f94ee9bab0bcd9632cb6b90d53c -->
# 研究

此目录包含有日期的调查、测量、比较和决策输入。每个文件都是针对其所述仓库快照和源代码修订版本的证据，而不是当前产品或兼容性契约。

不要改写历史 Host 版本或被拒绝的选项，使其看起来像当前行为。当仓库路径发生移动时，保留旧路径作为文本，并使用[单 Package 迁移记录](../reports/single-package-migration.md)查找其当前 Module。当前权威索引位于[`docs/README.md`](../README.md)。

## 保留的研究

### 架构与可行性

- [Code Mode：Cloudflare/OpenAI 设计](code-mode-cloudflare-openai-design-20260815.md)
- [Code Mode 图像基准](code-mode-image-benchmark-20260827.md)
- [Skill Discovery 真实模型 benchmark](skill-discovery-benchmark-20260830.md)
- [仓库代码量缩减](code-volume-reduction-20260823.md)
- [仅 Live 的 Thoughts 可行性](live-only-thoughts-feasibility-20260813.md)
- [Pi 最新 Markdown 转换](pi-latest-markdown-transform-20260820.md)
- [Pi XDG 基础目录行为](pi-xdg-base-directory-20260811.md)
- [tmux/Kitty 图像可行性](pi-tmux-kitty-images-feasibility-20260815.md)

### 产品与 UI 参考

- [Agent 活动 UI](agent-activity-ui-reference.md)
- [Claude Code 分组与 Narrative Boundaries](claude-code-tool-grouping-narrative-boundary-20260826.md)
- [Claude Code Transcript 源代码决策](claude-code-transcript-source-decisions.md)
- [通知 Capability](notification-capability-reference.md)
- [操作块与 Tool 对话框研究](pi-stuff-operation-block-dialog-study-20260829.md)
- [Pi Stuff Tool Activity 分类](pi-stuff-tool-activity-taxonomy-20260806.md)
- [后台 Work 通知 UI](work-background-notification-ui-reference.md)
- [BTW UI](work-btw-ui-reference.md)
- [Todo UI](work-todo-ui-reference.md)

### 上游 Package 参考

- [后台 Work Package](work-background-package-reference.md)
- [BTW Package](work-btw-package-reference.md)

一次性 harness、重复的比较，以及结论已完全由当前 ADR 所拥有的调查，可从 Git 历史中获取，而不是作为并行文档保留。
