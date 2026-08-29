<!-- translation-source: packages/pi-stuff/src/mcp/runtime/README.md; translation-source-sha256: 3403dfd630a8f175ce0e1f8bb20ebe0c77749d95b661244a7e4d186f7122d249 -->

# 已吸收的 MCP 实现

本目录是 Pi Stuff `mcp` 模块背后的私有实现。它是从固定且经过本地改编的 `pi-mcp-adapter` 快照吸收的源码；不是软件包、依赖或独立安装的扩展。

Pi Stuff 负责父目录中面向用户的代理工具和命令对话框。本实现提供配置、传输、发现、OAuth、生命周期、输出防护和协议处理。精确来源、完整性记录、许可证和维护差异见 [`UPSTREAM.md`](./UPSTREAM.md)。直接工具、JavaScript 批处理、Prompts、Apps、Sampling 和 Elicitation 被有意删除，而不是藏在标志后。

`implementation.ts` 为每个工厂维护一个适配器状态，并连接有序的会话、命令和网关工具阶段。`init.ts` 负责状态构造和启动投影；只有 `server-manager.ts` 负责连接身份与传输清理。`config-sources.ts` 负责路径与宿主配置发现；`config.ts` 负责优先级安全的加载、范围狭窄的写入及其兼容导出。

`mcp-setup-panel.ts` 负责设置交互、写入和生命周期状态。`mcp-setup-panel-view.ts` 渲染不可变快照与精确写入预览，不修改该状态。

## 保留的运行时约定

- 提供的内存 `config` 是完整隔离快照：每个工厂和会话各自克隆，绝不修改，也绝不与文件或命令行配置合并。
- 配置的 `!command` 凭据来源只在连接或认证时运行。它没有 stdin 或 stderr，截止时间为 10 秒，stdout 上限为 1 MiB；读取、合并、预览、哈希或渲染配置时绝不运行。
- OAuth 凭据要求操作系统凭据存储，不可用时安全关闭。Linux 可以通过打包的 `keyctl`/Node 辅助程序恢复被撤销的会话 Keyring；失败绝不回退到明文。
- 配置的 `rmcp-mux` Socket 是受信共享端点。Pi Stuff 只负责客户端连接，绝不启动、接管、重启或停止 mux 守护进程或上游进程。
- 已启用的 `eager` 和 `keep-alive` 服务器可以在没有 `session_start` 的程序化宿主中初始化；之后会话负责的运行时会取代该加载期运行时。
- 返回的 `structuredContent` 会依据公布的 JSON Schema draft-07 或 2020-12 `outputSchema` 校验。
