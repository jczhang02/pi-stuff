<!-- translation-source: packages/pi-stuff/src/web/runtime/README.md; translation-source-sha256: 28aca70c87992b1898f4d0f8eea87903ba2f61bc699a7e392fd1cc677ec7e1fc -->

# 已吸收的 Web 实现

本目录是 Pi Stuff `web` 模块背后的私有实现。它是从固定且经过本地改编的 `pi-web-access` 快照吸收的源码；不是软件包、依赖或独立安装的扩展。

Pi Stuff 负责父目录中面向用户的工具界面。本实现提供搜索、HTTP/图像/PDF 提取、有界 GitHub API 读取、存储和 SSRF 强制规则。已删除休眠的上游 Curator、命令、来源检查、页面回答、克隆和视频界面。精确来源、完整性记录、许可证和维护差异见 [`UPSTREAM.md`](./UPSTREAM.md)。[`SECURITY.md`](./SECURITY.md) 记录保留的凭据、远程提取和付费 Provider 边界。

`implementation.ts` 让安装保持为简短有序生命周期，并把每个工具委派给其搜索、抓取或已存储内容处理器。父级 `tool-contracts.ts` 负责共享有界 Schema；该私有运行时只负责执行、存储和会话恢复。

`rsc-extract.ts` 把 Flight 分块解析与防循环节点遍历分开；后者负责渲染引用内容和 Markdown 表格。

`extract.ts` 在一个序列中保存有序 Provider 回退策略，并把 HTTP 响应类型委派给聚焦的原始、图像、PDF、文本、HTML 和 RSC 处理器。

`gemini-search.ts` 负责一个带类型 Provider 注册表及由其构建的路由策略。每个 Provider 只声明一次其分派、可用性、标签和自动路由元数据。Gemini API 与浏览器传输保留在 `gemini-api.ts` 和 `gemini-web.ts` 内；提取 Provider 保持各自内容约定。每个 Provider 都从父级设置模块读取已经解析的 Web 命名空间，不再重新解析包含凭据的 JSON。
