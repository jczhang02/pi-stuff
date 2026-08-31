<!-- translation-source: packages/pi-stuff/src/mcp/README.md; translation-source-sha256: a295f8f5720d4dfee50baa4f2974bd5da64c1786452c270900ca45607511afb2 -->

# MCP

[English](../../../../../../../packages/pi-stuff/src/mcp/README.md)

把已配置 MCP server 放在一个可搜索、有界的 gateway Tool 之后。

## 快速开始

添加项目 `.mcp.json`，启动 Pi，然后打开：

```text
/mcp
```

Server 默认按需连接。Dialog 管理 setup、认证、重连、启用状态，以及自动或按需 lifecycle。

## 亮点

- 发现 shared、Agent、Pi 与 project server 声明。
- 支持 stdio、HTTP 与受信 Unix socket transport。
- 通过一个 `mcp` gateway 搜索并调用带前缀的 server Tool。
- 在可选 startup connection 前恢复缓存 metadata。
- 把 OAuth credential 保存到操作系统 credential store。
- 对 metadata discovery、Tool output、raw detail 与诊断设定上限。

## 文档

- [MCP 指南](../../../../docs/capabilities/mcp.md)
- [命令参考](../../../../docs/reference/commands.md#mcp)
- [故障排查](../../../../docs/troubleshooting.md#mcp)
- [Runtime 契约](runtime/README.md)
- [上游参考](UPSTREAM.md)

