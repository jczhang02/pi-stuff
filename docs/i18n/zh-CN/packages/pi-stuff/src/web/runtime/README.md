<!-- translation-source: packages/pi-stuff/src/web/runtime/README.md; translation-source-sha256: fe031b756958d4d84d0932496d42b678dd15ed1fe430ddc596b5f96f804da452 -->

# Web Runtime

[English](../../../../../../../../packages/pi-stuff/src/web/runtime/README.md)

Pi Stuff Web 的 provider routing、extraction、保存结果读取、credential resolution 与 SSRF enforcement。

## 快速开始

使用上层 [Web 指南](../../../../../docs/capabilities/web.md)及其三个 Tool。Runtime 从一份不可变配置 snapshot
执行每次 search、fetch 或 stored-content request。

## 亮点

- 路由已配置 search provider，同时保持付费 provider 只能显式使用。
- 提取有界 HTTP、image、PDF 与 GitHub 内容。
- 在 outbound HTTP seam 应用 SSRF 与 domain policy。
- 在 credential 或 request body 可能跨 origin 前禁用 redirect。
- 恢复一小时以内的有效 Session result entry。
- 解析有界 credential source，不持久化其值。

## 文档

- [Web 指南](../../../../../docs/capabilities/web.md)
- [Web Module README](../README.md)
- [安全契约](SECURITY.md)
- [上游参考](UPSTREAM.md)

