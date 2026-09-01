<!-- translation-source: packages/pi-stuff/src/web/runtime/README.md; translation-source-sha256: 1950ece41cfd243622994d4da0ad44fd04d6f89a143154bbd051680b77bf58e4 -->

# Web Runtime

[English](../../../../../../../../packages/pi-stuff/src/web/runtime/README.md)

Pi Stuff Web 的 provider routing、extraction、保存结果读取、credential resolution 与 SSRF enforcement。

<p align="center">
  <a href="../../../../../../../assets/readme/runtime/web.png">
    <img src="../../../../../../../assets/readme/runtime/web.png" alt="Web runtime 使用的共享 Tool 活动视图" width="100%">
  </a>
  <br>
  <em>内置 Web runtime 通过 Suite 的共享 Tool 活动视图报告调用。</em>
</p>

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
