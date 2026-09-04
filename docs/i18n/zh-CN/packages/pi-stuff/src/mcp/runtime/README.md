<!-- translation-source: packages/pi-stuff/src/mcp/runtime/README.md; translation-source-sha256: c0ede4e37a6764327aa52788f539e3bc113c74c6701224b60aa7d4f863f3c8f5 -->

# MCP Runtime

[English](../../../../../../../../packages/pi-stuff/src/mcp/runtime/README.md)

Pi Stuff MCP gateway 背后的配置、transport、认证、生命周期、discovery 与输出处理。

<p align="center">
  <a href="../../../../../../../assets/readme/runtime/mcp.png">
    <img src="../../../../../../../assets/readme/runtime/mcp.png" alt="Pi 中的 MCP runtime 连接状态" width="100%">
  </a>
  <br>
  <em>内置 MCP runtime 通过 Pi 报告服务器配置和连接状态。</em>
</p>

## 快速开始

使用上层 [MCP 指南](../../../../../docs/capabilities/mcp.md)与 `/mcp` 界面。已配置 server 的 lifecycle
或 gateway 使用需要时，runtime 会激活。

## 亮点

- 合并有界 global 与 project configuration，并报告冲突。
- 运行 stdio、HTTP 与受信 shared-socket transport。
- 只在连接或认证时解析 `!command` secret。
- 要求操作系统 credential storage 才能使用 OAuth。
- 把 Tool 与 Resource discovery 各限制为 100 页或 10,000 项。
- 返回结果前验证声明的 `structuredContent` schema。
- 普通 Tool 与 Resource request 不设隐式 deadline；显式正数 request timeout 仍是绝对 deadline。
- 替换过期 runtime ownership，并执行有界 transport cleanup。

## 文档

- [MCP 指南](../../../../../docs/capabilities/mcp.md)
- [MCP Module README](../README.md)
- [上游参考](UPSTREAM.md)
