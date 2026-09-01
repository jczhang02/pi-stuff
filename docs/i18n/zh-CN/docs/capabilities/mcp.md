<!-- translation-source: docs/capabilities/mcp.md; translation-source-sha256: 924ac093d49443ef270a7424e3bf0d567cf737becc00d1bc4300a103fa4b8484 -->

# MCP

[English](../../../../../docs/capabilities/mcp.md)

MCP 发现已配置 server，并通过一个有界 gateway 暴露它们的 Tool。

## 快速开始

添加项目 `.mcp.json`：

```json
{
  "mcpServers": {
    "demo": {
      "command": "node",
      "args": ["./demo-server.mjs"]
    }
  }
}
```

启动 Pi 并打开：

```text
/mcp
```

Server 默认按需连接。Dialog 列出已发现 server，并提供连接、认证、生命周期、启用状态和 setup 操作。

## Gateway Tool

`mcp` Tool 可以列出和搜索缓存的 server Tool、描述 Tool schema、连接 server，以及调用返回的带前缀 Tool 名称。

```json
{ "search": "read file", "limit": 10 }
{ "connect": "demo" }
{ "describe": "demo__read_file" }
{ "tool": "demo__read_file", "args": { "path": "README.md" } }
```

使用 `server` 列出或筛选一个 server。Search 支持 offset、最多 20 个结果和可选 parameter schema。Tool 参数
可以是对象或最多 64 KiB 的 JSON 字符串。

## 配置

Pi Stuff 读取 shared、Agent、Pi 与 project MCP source。主要项目文件为：

- `.mcp.json`：共享项目声明；
- `.pi/mcp.json`：Pi 专属项目 override。

高优先级定义按 server name 替换低优先级定义。每个 server 只声明一种 transport：

| 字段 | Transport |
| --- | --- |
| `command` | stdio 进程 |
| `url` | HTTP 或 Streamable HTTP |
| `socket` | 受信 Unix socket |

Server entry 还可以设置 lifecycle、disabled state、Tool 与 resource filter、approval、authentication、debug
与 trace 选项。

修改 server URL 时会删除继承的 URL-bound header、bearer value 与 OAuth state，避免 credential 跟随 endpoint
变化。

## 命令

| 命令 | 操作 |
| --- | --- |
| `/mcp` 或 `/mcp status` | 打开 server status |
| `/mcp setup` | 写入前检查 import、preset 或 starter configuration |
| `/mcp auth <server>` | 认证符合条件的 server |
| `/mcp reconnect <server>` | 重新连接并刷新 metadata |
| `/mcp logout <server>` | 移除认证 |
| `/mcp disable <server>` | 通过项目 override 禁用 |
| `/mcp enable <server>` | 通过项目 override 启用 |
| `/mcp auto-connect <server>` | 保存 `keep-alive` lifecycle |
| `/mcp on-demand <server>` | 保存 `lazy` lifecycle |

Setup 和持久变更只有在交互确认后才写入，并在需要时 reload Pi。打开 bare dialog 不会连接，也不会写配置。

## 连接生命周期

`lazy` 是默认值。Metadata 缺失时，gateway call 会连接指定 server，可以启动符合条件的认证流程，刷新 metadata，
再重试操作。失败 server 使用 reconnect backoff，不阻止其他 server 或普通 Pi 工作。

`keep-alive` 与 `eager` server 可以在恢复缓存 metadata 后于启动阶段连接。

Tool 与 Resource metadata 各自限制为 100 页或 10,000 项。Change notification 使用同一上限。

## 认证

HTTP server 支持 bearer 与 OAuth 认证。`/mcp auth <server>` 显示 callback URL，并在可行时自动完成本地 callback。

OAuth credential 保存到操作系统 credential store。安全存储不可用时，OAuth 会 fail closed。旧版 plaintext
credential 可以读取，但只有显式 OAuth write 后才会移入安全存储。

`!command` secret 只在连接或认证时执行，不使用 stdin 或 stderr，timeout 为 10 秒，stdout 上限为 1 MiB。

## 输出与诊断

文字结果默认限制为 50 KiB 或 2,000 行。超限文字和大于 16 KiB 的 raw detail 会写入 mode-`0600` 临时文件；
image block 保留 Pi 原生图像路径。Spill file 可能包含敏感 server 输出，需要用户自行清理。

Status snapshot 不包含 server URL、命令、参数、环境值、OAuth 数据或 token。诊断保留有界 stdio stderr tail
和经过清理的 HTTP failure classification。

## 相关文档

- [MCP Module README](../../packages/pi-stuff/src/mcp/README.md)
- [命令参考](../reference/commands.md#mcp)
- [故障排查](../troubleshooting.md#mcp)
- [Runtime 契约](../../packages/pi-stuff/src/mcp/runtime/README.md)

