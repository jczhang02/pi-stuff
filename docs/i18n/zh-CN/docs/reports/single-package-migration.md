<!-- translation-source: docs/reports/single-package-migration.md; translation-source-sha256: 4437c7225b236f0ba1858f6c8a48dac6ac37a87bf942a9000ae1e66226aef37f -->

# 单 Package 迁移记录

> 这是已完成 `ps-7lq` 迁移的历史架构记录，不是兼容性声明。当前版本见
> [兼容性指南](../compatibility.md)。

迁移保留 Pi Host，把原有 workspace Package 移入一个本地 Pi Stuff Package。持久的 Host 与 Package 边界记录在
[ADR 0001](../adr/0001-keep-pi-as-the-host.md)。

## Source-to-Module 映射

| 冻结源码 | `packages/pi-stuff` 中的目标位置 |
| --- | --- |
| `packages/pi-stuff-ui` | `src/conversation-ui` |
| `packages/pi-stuff-tools` | `src/tool-display` |
| `packages/pi-stuff-context` | `src/context-management` |
| `packages/pi-stuff-rtk` | `src/rtk` |
| `packages/pi-stuff-codex` | `src/codex` |
| `packages/pi-stuff-goal` | `src/goal` |
| `packages/pi-stuff-web` | `src/web` |
| `packages/pi-web-access` | `src/web/runtime` |
| `packages/pi-stuff-mcp` | `src/mcp` |
| `packages/pi-mcp-adapter` | `src/mcp/runtime` |
| `packages/pi-stuff-work` | `src/background-work` |
| `packages/pi-stuff-agents` | `src/subagents` |
| `packages/pi-stuff-todo` | `src/todo` |
| `packages/pi-stuff-btw` | `src/btw` |
| 同期进行的 `feat/code-mode` 工作 | `src/code-mode` |

后续 Capability 继续使用同一个 Package boundary。当前有序 Capability 清单由
[`suite.json`](../../../../../packages/pi-stuff/suite.json)维护，不在这份历史清单中重复。

## 迁移保留的 Runtime Resource

- `src/btw/prompts/btw-system.txt`
- `src/codex/native/{apply-patch,imagegen,view-image}/linux-x64/*`
- `src/codex/LICENSES/Apache-2.0.txt` 和 `src/codex/THIRD_PARTY_NOTICES.md`
- `src/rtk/upstream/techniques/*.ts`
- `src/background-work/src/process-supervisor.mjs`
- `src/mcp/runtime/mcp-keyring-helper.cjs` 和 `src/mcp/runtime/UPSTREAM.md`
- `src/code-mode/LICENSES/*`、`src/code-mode/THIRD_PARTY_NOTICES.md` 和 `src/code-mode/UPSTREAM.md`
- 各 Module 自己的 `UPSTREAM.md`、`SECURITY.md` 和第三方许可证

原先内置的 `subagents/agents/general-purpose.md` 已删除。各 Package 的旧 changelog 留在 Git 历史中；现在保留的
Package changelog 是 `packages/pi-stuff/CHANGELOG.md`。

## 结果

迁移后只剩一个 Package manifest 和一个默认 Extension factory。改写后的 Web 与 MCP source 留在所属 Module
内部。依赖以 Package manifest 和 lockfile 为准，组合顺序以 `suite.json` 为准。CLI、TUI、Session、Settings、
Package loading 和模型交互仍由 Pi 负责。
