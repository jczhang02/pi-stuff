<!-- translation-source: packages/pi-stuff/README.md; translation-source-sha256: 0a3815c64391ef3f9c9a4cfa8b93259128448662ff2469ed65b81ec055f5b700 -->

# `@jczhang02/pi-stuff`

[English](../../../../../packages/pi-stuff/README.md)

Pi Stuff Package 为 Pi 加入界面、工作、上下文和集成能力。

<p align="center">
  <a href="../../../../assets/readme/package/suite.png">
    <img src="../../../../assets/readme/package/suite.png" alt="带有 Session 级 Todo 的 Pi Stuff 对话" width="100%">
  </a>
  <br>
  <em>Suite 把对话、Tool 和 Session 级 Todo 放在同一个 Pi 界面中。</em>
</p>

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

<p align="center">
  <a href="../../../../assets/readme/package/commands.png">
    <img src="../../../../assets/readme/package/commands.png" alt="Pi 编辑器中的 Pi Stuff slash command 补全" width="100%">
  </a>
  <br>
  <em>slash 补全直接展示命令入口，无需额外的启动器。</em>
</p>

## 文档

- [入门](../../docs/getting-started.md)
- [能力指南](../../docs/README.md#能力指南)
- [命令参考](../../docs/reference/commands.md)
- [设置参考](../../docs/reference/settings.md)
- [主题](../../docs/reference/themes.md)
- [架构](../../docs/architecture.md)
- [故障排查](../../docs/troubleshooting.md)
