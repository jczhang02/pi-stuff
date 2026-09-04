<!-- translation-source: packages/pi-stuff/src/mcp/README.md; translation-source-sha256: d8abeb0238c7515623536ca7c745e574e73173761db85563aa7d993e6f873f7b -->

# MCP

[English](../../../../../../../packages/pi-stuff/src/mcp/README.md)

把已配置 MCP server 放在一个可搜索、有界的 gateway Tool 之后。

<p align="center">
  <a href="../../../../../../assets/readme/capabilities/mcp.png">
    <img src="../../../../../../assets/readme/capabilities/mcp.png" alt="Pi 中的 MCP 连接对话框" width="100%">
  </a>
  <br>
  <em>MCP 对话框显示连接状态，只在需要服务器时进入设置。</em>
</p>

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
- 未配置正数 request timeout 时，让普通 Tool 与 Resource request 运行至结算或取消。
- 对 metadata discovery、Tool output、raw detail 与诊断设定上限。

## 文档

- [MCP 指南](../../../../docs/capabilities/mcp.md)
- [命令参考](../../../../docs/reference/commands.md#mcp)
- [故障排查](../../../../docs/troubleshooting.md#mcp)
- [Runtime 契约](runtime/README.md)
- [上游参考](UPSTREAM.md)
