<!-- translation-source: packages/pi-stuff/src/mcp/runtime/README.md; translation-source-sha256: 8a3ed7527b4e2cc81687d72e79350ebb97ebe9a2d7898f6f0fc4988e894197c7 -->

# MCP Runtime

[English](../../../../../../../../packages/pi-stuff/src/mcp/runtime/README.md)

Pi Stuff MCP gateway 背后的配置、transport、认证、生命周期、discovery 与输出处理。

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
- 替换过期 runtime ownership，并执行有界 transport cleanup。

## 文档

- [MCP 指南](../../../../../docs/capabilities/mcp.md)
- [MCP Module README](../README.md)
- [上游参考](UPSTREAM.md)

