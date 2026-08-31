<!-- translation-source: packages/pi-stuff/README.md; translation-source-sha256: 6c602466ea8c4efc50fee3253b27fb28c40d2389ed464251394607a0e74d956e -->

# `@jczhang02/pi-stuff`

[English](../../../../../packages/pi-stuff/README.md)

Pi Stuff Package 为 Pi 加入界面、工作、上下文和集成能力。

## 能力

| 分类 | 包含的能力 |
| --- | --- |
| 界面 | [Conversation UI](src/conversation-ui/README.md)、[Session Naming](src/session-naming/README.md)、[Tool Display](src/tool-display/README.md) |
| 工作 | [Goal](src/goal/README.md)、[Background Work](src/background-work/README.md)、[Agents](src/subagents/README.md)、[Todo](src/todo/README.md) |
| 流程 | [BTW](src/btw/README.md)、[Notification](src/notification/README.md)、[Ponytail](src/ponytail/README.md) |
| 上下文与集成 | [Context Management](src/context-management/README.md)、[Web](src/web/README.md)、[MCP](src/mcp/README.md)、[RTK](src/rtk/README.md)、[Codex](src/codex/README.md)、[Code Mode](src/code-mode/README.md) |

## 安装

在仓库根目录运行：

```bash
pi install ./packages/pi-stuff
pi
```

当前已认证的 Pi 与工具链版本见 [`docs/compatibility.md`](../../docs/compatibility.md)。外部服务和可执行文件都
按需配置。

## 文档

- [入门](../../docs/getting-started.md)
- [能力指南](../../docs/README.md#能力指南)
- [命令参考](../../docs/reference/commands.md)
- [设置参考](../../docs/reference/settings.md)
- [主题](../../docs/reference/themes.md)
- [架构](../../docs/architecture.md)
- [故障排查](../../docs/troubleshooting.md)
