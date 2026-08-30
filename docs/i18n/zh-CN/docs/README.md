<!-- translation-source: docs/README.md; translation-source-sha256: d9ecb7075c29ac4a0947f5e73df447db587dc968153c881e9618690d0fdb5035 -->

# 工程文档

[English](../../../../docs/README.md)

本目录与其中链接的仓库文档共同构成 Pi Stuff 工程 Wiki。英文原文是权威来源；简体中文镜像在导航上与其
对应，但不是另一套独立规范。

## 从这里开始

优先阅读能够回答问题的最窄当前权威：

1. [`README.md`](../README.md)——用户入口、安装方式与 Suite 概览。
2. [`packages/pi-stuff/README.md`](../packages/pi-stuff/README.md)——当前 Package 行为与命令。
3. 负责该行为的 Capability Module README——最靠近源码的行为与维护说明。
4. [`CONTEXT.md`](../CONTEXT.md)——规范术语与所有权边界。
5. [`DESIGN.md`](../DESIGN.md)——共享视觉与交互契约。
6. 已接受的 ADR——某个持久架构选择为何存在。

仓库级规则位于 [`AGENTS.md`](../AGENTS.md)、[`code-quality.md`](code-quality.md) 和
[`compatibility.md`](compatibility.md)。贡献与 issue 流程位于
[`CONTRIBUTING.md`](../.github/CONTRIBUTING.md) 和 [`agents/`](agents/)。

## 文档职责

| 文档 | 负责 | 不负责 |
| --- | --- | --- |
| 根目录和 Package README | 当前用户可见行为与导航 | 历史理由 |
| Capability README | 当前局部行为、契约与维护说明 | 跨 Suite 架构 |
| `CONTEXT.md` | 规范语言与所有权边界 | 操作流程 |
| `DESIGN.md` | 共享可见界面规则 | Capability 内部实现 |
| ADR | 持久决策、取舍与后果 | 已能从代码或 README 明显看出的当前行为 |
| Research 与 report | 有日期的外部证据和验收记录 | 当前要求 |
| Release note | 历史发布变化 | 当前兼容性 |

当前行为变化时，要在同一次变更中更新负责它的 README 或契约。只有面对难以逆转且并不显然的真实取舍时才
新增 ADR。已删除 prototype 和冗余证据由 Git 历史归档。

## Capability 文档

| 领域 | 当前文档 |
| --- | --- |
| Conversation UI | [`conversation-ui`](../packages/pi-stuff/src/conversation-ui/README.md) |
| Session Naming | [`session-naming`](../packages/pi-stuff/src/session-naming/README.md) |
| Tool Display | [`tool-display`](../packages/pi-stuff/src/tool-display/README.md) |
| RTK | [`rtk`](../packages/pi-stuff/src/rtk/README.md) |
| Codex Runtime | [`codex`](../packages/pi-stuff/src/codex/README.md) |
| Goal | [`goal`](../packages/pi-stuff/src/goal/README.md) |
| Context Management | [`context-management`](../packages/pi-stuff/src/context-management/README.md) |
| Ponytail | [`ponytail`](../packages/pi-stuff/src/ponytail/README.md) |
| Web | [`web`](../packages/pi-stuff/src/web/README.md) |
| MCP | [`mcp`](../packages/pi-stuff/src/mcp/README.md) |
| Background Work | [`background-work`](../packages/pi-stuff/src/background-work/README.md) |
| Agents | [`subagents`](../packages/pi-stuff/src/subagents/README.md) |
| Todo | [`todo`](../packages/pi-stuff/src/todo/README.md) |
| BTW | [`btw`](../packages/pi-stuff/src/btw/README.md) |
| Notification | [`notification`](../packages/pi-stuff/src/notification/README.md) |
| Code Mode | [`code-mode`](../packages/pi-stuff/src/code-mode/README.md) |

## 当前 ADR 索引

| ADR | 决策 |
| --- | --- |
| [0001](adr/0001-keep-pi-as-the-host.md) | 保持 Pi 为 Host，并让 Pi Stuff 成为一个由仓库负责的 Package |
| [0004](adr/0004-route-suite-diagnostics-through-owned-ui.md) | 通过自有 UI 呈现 Suite diagnostic |
| [0006](adr/0006-cache-unchanged-suite-modules-across-host-reload.md) | 在 Host reload 之间缓存未变化的 Suite Module |
| [0007](adr/0007-initialize-configured-context-before-editor-readiness.md) | 在编辑器就绪前初始化已配置的 Context |
| [0008](adr/0008-own-the-context-command-surface.md) | 统一负责 Context 命令界面 |
| [0009](adr/0009-align-code-mode-with-openai-and-cloudflare.md) | 让 Code Mode 与 OpenAI、Cloudflare 对齐 |
| [0012](adr/0012-merge-pi-stuff-settings-file.md) | 使用一个合并设置文件，并保持启动只读 |
| [0015](adr/0015-certify-the-upstream-release-binary.md) | 认证上游 Release 二进制文件 |
| [0017](adr/0017-project-chart-and-tree-fences-inside-conversation-markdown.md) | 在 Conversation Markdown 内投影 chart/tree fence |
| [0018](adr/0018-end-live-v1-agent-governor-coexistence.md) | 结束 v1 Agent governor 的实时共存 |
| [0019](adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md) | 将 Context engine 工作移出 Host UI 线程 |
| [0020](adr/0020-add-automatic-session-naming.md) | 在用户工作 settled 边界自动命名 Session |
| [0021](adr/0021-fork-ponytail-as-a-suite-capability.md) | 将 Ponytail fork 为 Suite Capability |
| [0022](adr/0022-restrict-folding-to-native-retrieval.md) | 只折叠原生 retrieval |
| [0023](adr/0023-use-a-closed-operation-block-family.md) | 使用封闭的 Operation Block 家族 |
| [0024](adr/0024-adopt-effect-as-the-internal-effect-model.md) | 采用 Effect 作为内部副作用模型 |

## 证据与历史

- [`research/`](research/) 保留选定的外部参考和可行性结论。
- [`reports/`](reports/) 保留验收记录以及必要的原始数据或设计理由。
- [`releases/`](releases/) 记录历史发布。

这些有日期的文档只描述其记录快照，绝不会覆盖当前契约。当有用结论已经进入负责它的当前文档或 ADR 后，
冗余 report、重复渲染产物和一次性 prototype 会被删除。

## 翻译

每份保留的人工英文 Markdown 都在 [`docs/i18n/zh-CN/`](../) 下以相同仓库相对路径拥有简体中文镜像。每个
镜像记录源路径和原始源文件 SHA-256；仓库检查会拒绝缺失或过期的镜像。对字节敏感的 Runtime `SKILL.md`
资源与 `THIRD_PARTY_NOTICES.md` 不翻译。历史中文 0.3.0 执行清单继续只保留中文版本。
