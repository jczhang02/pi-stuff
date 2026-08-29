<!-- translation-source: packages/pi-stuff/src/web/runtime/SECURITY.md; translation-source-sha256: ad8894b19a88eac87b02b830f228a7807673e674491bdc93dbb1db66989b6aff -->

# 安全政策

请通过本仓库的 GitHub 私有漏洞报告功能报告疑似漏洞。不要在公开 Issue 或拉取请求中发布利用细节、密钥或概念验证载荷。

如果你的账户或本仓库无法使用私有漏洞报告，请创建一个最小公开 Issue，请求私下联系渠道，不要包含技术细节。

## 凭据来源

凭据命令属于受信本地配置，不是进程隔离边界。`!command` 来源只在 Provider 请求需要时运行，截止时间为五秒，输出上限为 16 KiB，支持取消，并使用最小环境。输出必须非空且不能包含控制字符。`op://` 引用通过参数向量调用 `op read`，截止时间为 60 秒，并使用相同输出上限。解析值不会持久化，也不会在 Provider 操作后保留。

诊断可以指出 Provider、配置路径和清理后的失败类别，但不得重复包含凭据的配置文字、来源命令或引用、stderr，或解析值的任何部分。

## 远程提取

本地 URL 校验保护发送给已配置提取服务的请求；它无法控制该服务自身的 DNS 解析、重定向或出口。启用远程提取器会向该 Provider 披露目标 URL 和返回内容。Firecrawl 新鲜抓取只应在隔离或许可列表部署中启用；对于不得披露的 URL，不应配置 Bright Data Web Unlocker。

## 付费 Provider

Bright Data SERP 和 Web Unlocker 是显式付费服务，绝不会作为自动回退。即使响应正文无法使用，请求也可能计费。已计费的 HTTP 200 响应如果无法解释，会报告为错误且不重新分类为可重试；非空 Web Unlocker 正文即使只是同意或付费墙占位内容，也会返回。Provider token 会从引用正文、错误和活动输出中遮盖。
