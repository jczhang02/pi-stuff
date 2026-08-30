<!-- translation-source: packages/pi-stuff/src/web/runtime/README.md; translation-source-sha256: c64bb0247399d178efd46104d3ee712324fa179b9ec052ffe7164f5c954c24b7 -->

# 已吸收的 Web 实现

本目录是 Pi Stuff `web` 模块背后的私有实现。它是从固定且经过本地改编的 `pi-web-access` 快照吸收的源码；不是软件包、依赖或独立安装的扩展。

Pi Stuff 负责父目录中面向用户的工具界面。本实现提供搜索、HTTP/图像/PDF 提取、有界 GitHub API 读取、存储和 SSRF 强制规则。已删除休眠的上游 Curator、命令、来源检查、页面回答、克隆和视频界面。精确来源、完整性记录、许可证和维护差异见 [`UPSTREAM.md`](./UPSTREAM.md)。[`SECURITY.md`](./SECURITY.md) 记录保留的凭据、远程提取和付费 Provider 边界。

`implementation.ts` 让安装保持为简短有序生命周期，并把每个工具委派给其搜索、抓取或已存储内容处理器。父级 `tool-contracts.ts` 负责共享有界 Schema；该私有运行时只负责执行、存储和会话恢复。

`rsc-extract.ts` 把 Flight 分块解析与防循环节点遍历分开；后者负责渲染引用内容和 Markdown 表格。

`extract.ts` 负责 Effect 内容检索程序：远程校验、安全重定向原生抓取、超时与中断、有界响应读取器终结、有序 Provider 回退，以及保持顺序的三路 URL 并发。它把原始、图像、PDF、文本、HTML 和 RSC 解释委派给聚焦处理器，同时让确定性解析保持普通 TypeScript。`github-api.ts` 是可中断的原生 `gh` 适配器，`pdf-extract.ts` 是原生 PDF 解析器/文件系统适配器；返回的临时 Markdown 文件会有意存续到操作结束之后，以便 Pi 随后读取。父级适配器是唯一 Effect runner，并把存储与发布限制在当前会话。模型支持的提取 Provider 直接加入同一条 Effect 路径，不创建第二套运行时。

`gemini-search.ts` 负责一个带类型的 Effect Provider 注册表及由其构建的路由策略。标准无状态 API Provider、模型支持 Provider 和有状态 Provider 都返回 Effect，不自行启动 runner。直接抓取、凭据解析、Cookie 数据库子进程、顺序上传和重定向处理保留在 Provider 自有的原生适配器中。Effect 负责这些工作的超时与中断，以及顺序分页、路由和回退；请求构造、解码、排序、过滤和结果展示仍使用普通 TypeScript。选定 Provider 的并发调用保留输入顺序、部分成功、Provider 诊断和安全自动回退。Gemini API 与浏览器传输保留在 `gemini-api.ts` 和 `gemini-web.ts` 内；提取 Provider 保持各自内容约定。每次操作都从安装所拥有的 Effect 设置存储读取已经解析的 Web 命名空间，不再重新解析包含凭据的 JSON。
