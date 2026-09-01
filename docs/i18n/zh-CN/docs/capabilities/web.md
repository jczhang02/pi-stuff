<!-- translation-source: docs/capabilities/web.md; translation-source-sha256: 227ad722fde17ce88fdba52633eef69bce8c6620b24f289dd4ebbdef1d86adcf -->

# Web

[English](../../../../../docs/capabilities/web.md)

Web 搜索已配置 provider、获取公开 HTTP 内容，并从保存结果中读取有界片段。

## 快速开始

搜索：

```json
{ "query": "Pi coding agent extension API" }
```

获取结果：

```json
{ "url": "https://example.com", "mode": "readable" }
```

需要更多内容或匹配段落时，把返回的 `responseId` 传给 `get_search_content`。

## Tool

### `web_search`

| 字段 | 契约 |
| --- | --- |
| `query` 或 `queries` | 一个 query 或最多四个 query |
| `numResults` | 1–20 个结果 |
| `recency` | `day`、`week`、`month` 或 `year` |
| `domainFilter` | 最多 20 个 include 或 exclude domain |
| `provider` | 一个 provider、最多八个 provider、`auto` 或 `all` |

同一个 call 中的 query 会依次运行。结果包含有 citation 的 URL、综合回答，以及可供 continuation 的保存内容。

### `fetch_content`

以 `readable` 或 `raw` mode 获取一个 `url` 或最多十个 `urls`。Web 支持：

- 从 HTML 提取 readable 内容；
- 有界 raw text；
- 图像；
- 优先通过 Gemini 提取 PDF，不可用时使用本地 `unpdf`；
- 有界 GitHub API 读取。

初始 readable 内容最多 30,000 个字符。PDF 会转换为临时 Markdown，并返回供 Pi Read Tool 使用的路径。

### `get_search_content`

通过 `responseId` 与 URL 或 query selector 读取保存内容。使用 `offset` 与 `limit` 读取有界片段，或通过
`findText` 执行 exact、case-insensitive 或 fuzzy matching。返回片段最多 30,000 个字符。

## Provider 路由

自动路由按优先级尝试已配置 provider，并可针对选定的 transient、quota 或 network 错误 fallback。显式 provider
或 provider 列表会绕过自动选择。

支持的 provider ID 为 `openai`、`brave`、`parallel`、`tinyfish`、`search1api`、`searchinfinity`、
`querit`、`tavily`、`searxng`、`perplexity`、`gemini`、`exa`、`serpdive`、`kagi`、`ollama`、
`anysearch`、`xai`、`brightdata` 与 `serpbase`。

`brightdata` 与 `serpbase` 只能显式选择，不进入 `auto` 或 `all`。

## 配置

Web 读取 `<agentDir>/pi-stuff.json` 中的 `web` 对象。Provider 特定字段归各 provider 所有。共享路由识别：

- `provider` 或 `searchProvider`；
- `searchRouting.providers`；
- `searchRouting.fallbackOn`，值为 `transient`、`quota` 或 `network`。

每个 Tool call 使用一份不可变配置 snapshot。

## 安全

Fetch 只接受 HTTP 与 HTTPS URL。它拒绝嵌入凭据、literal IP、本地或私网 host、单标签 domain，以及超过
8,192 个字符的 URL。Direct 与 remote extraction 边界都禁用 redirect。

Domain filter 会规范化 URL 形态的输入，拒绝 IP-like value，只匹配准确 host 或其 subdomain。

Credential 可以来自环境值、设置、有界 `!command` 解析或 `op://` reference。Web 不会持久化它们，并会从
error 与 Activity 中遮盖。Provider request 只接收完成操作所需的 query 或 URL。

Credential、remote extraction 与付费 provider 边界见
[Web runtime security](../../packages/pi-stuff/src/web/runtime/SECURITY.md)。

## 保存结果

Search 与 fetch 结果保存在进程内，并追加为 Session custom entry。恢复的 Session 只加载一小时以内的有效 entry。
更早内容需要重新搜索或获取。

## 相关文档

- [Web Module README](../../packages/pi-stuff/src/web/README.md)
- [设置参考](../reference/settings.md#web)
- [故障排查](../troubleshooting.md#web)
- [Runtime 契约](../../packages/pi-stuff/src/web/runtime/README.md)

